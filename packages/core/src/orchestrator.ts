import { join } from 'node:path';
import type { Adapter, ParsedEvent, TurnResult } from '@voragent/adapters';
import type {
  Config, EventType, ProviderId, ProviderState, Run, Task, Turn, WorkspaceMode,
} from '@voragent/shared';
import type { EventBus } from './bus.js';
import { buildHandoff } from './handoff.js';
import { runTurn } from './proc.js';
import { pickProvider } from './scheduler.js';
import type { Store } from './store.js';
import { commitAll, createWorkspace, workspaceSummary } from './workspace.js';
import type { Workspace } from './workspace.js';

export interface Orchestrator {
  submitTask(i: {
    repoPath: string;
    message: string;
    title?: string;
    mode?: WorkspaceMode;
    priority?: ProviderId[];
  }): Promise<Task>;
  sendMessage(taskId: string, message: string): Turn; // chỉ khi status 'awaiting_user' hoặc 'failed'
  closeTask(taskId: string): void;
  retry(taskId: string, o?: { switchProvider?: boolean }): void;
  tick(): Promise<void>; // khởi động các lượt đủ điều kiện; không chờ chúng chạy xong
  idle(): Promise<void>; // chờ mọi lượt đang chạy xong (dùng trong test)
  recover(): void; // gọi một lần lúc khởi động
  refreshProviders(): Promise<void>; // gọi detect() rồi cập nhật installed/version
  start(intervalMs?: number): void;
  /** Dừng êm (chờ lượt đang chạy). `force`: dừng ngay các lượt đang chạy, xếp chúng lại để chạy tiếp sau. */
  stop(opts?: { force?: boolean }): Promise<void>;
}

const DEFAULT_TICK_MS = 2000;
const TITLE_MAX = 60;
const SYSTEM_PROMPT = (path: string): string =>
  `Bạn đang làm việc trong thư mục ${path}. Chỉ sửa file trong thư mục này.`;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createOrchestrator(d: {
  store: Store;
  bus: EventBus;
  adapters: Map<ProviderId, Adapter>;
  config: Config;
  now?: () => number;
  /** Báo lỗi không nghiêm trọng (vd. subscriber của bus ném lỗi). Mặc định: console.error. */
  onError?: (err: unknown, context: string) => void;
}): Orchestrator & { pendingCount(): number } {
  const { store, bus, adapters, config } = d;
  const now = d.now ?? Date.now;
  const report = d.onError ?? ((err: unknown, ctx: string) => console.error(`[orchestrator] ${ctx}:`, err));
  const worktreesDir = join(config.dataDir, 'worktrees');

  /** Lượt đang chạy trong tiến trình này, theo task. Nguồn duy nhất cho giới hạn song song. */
  const inflight = new Map<string, { provider: ProviderId; turnId: string; abort: AbortController }>();
  /** Mọi công việc của một lượt (gồm commit và tick nối tiếp); idle() chờ tập này rỗng. */
  const tracked = new Set<Promise<void>>();
  /** Task vừa được retry với switchProvider: lần chọn tới tránh nền tảng này (chỉ trong bộ nhớ). */
  const avoid = new Map<string, ProviderId>();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let refreshing: Promise<void> | null = null;

  // ---------------------------------------------------------------- helpers

  function emit(
    taskId: string, runId: string | null, type: EventType, data: Record<string, unknown>,
  ): void {
    const ev = store.appendEvent({ taskId, runId, source: 'managed', type, data });
    try {
      bus.publish(ev);
    } catch (err) {
      report(err, 'subscriber của bus ném lỗi'); // subscriber hỏng không được làm hỏng điều phối
    }
  }

  /** Đổi trạng thái task và phát STATE_CHANGED khi có đổi. Task đã `closed` không bị ghi đè. */
  function setStatus(taskId: string, status: Task['status'], patch: Partial<Task> = {}): Task {
    const t = store.getTask(taskId);
    if (!t) throw new Error(`Không tìm thấy task ${taskId}`);
    if (t.status === 'closed') return t;
    if (t.status === status && Object.keys(patch).length === 0) return t;
    const updated = store.updateTask(taskId, { ...patch, status });
    if (t.status !== status) emit(taskId, null, 'STATE_CHANGED', { status });
    return updated;
  }

  function wsOf(task: Task): Workspace {
    return {
      path: task.workspacePath ?? task.repoPath,
      branch: task.branch,
      baseCommit: task.baseCommit,
      isolated: task.branch !== null,
    };
  }

  function putProvider(id: ProviderId, patch: Partial<ProviderState>): void {
    const cur = store.getProvider(id);
    store.upsertProvider({
      id,
      cooldownUntil: cur?.cooldownUntil ?? null,
      usedPercent: cur?.usedPercent ?? null,
      installed: cur?.installed ?? true,
      version: cur?.version ?? null,
      updatedAt: now(),
      ...patch,
    });
  }

  // -------------------------------------------------------------- providers

  function refreshProviders(): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      for (const [id, adapter] of adapters) {
        let installed = false;
        let version: string | null = null;
        try {
          const r = await adapter.detect();
          installed = r.installed;
          version = r.version;
        } catch {
          // detect lỗi coi như chưa cài
        }
        putProvider(id, { installed, version });
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** tick() nạp bảng providers một lần nếu còn thiếu nền tảng nào chưa có dòng. */
  async function ensureProviders(): Promise<void> {
    const have = new Set(store.listProviders().map((p) => p.id));
    if ([...adapters.keys()].some((id) => !have.has(id))) await refreshProviders();
  }

  // ------------------------------------------------------------------- tick

  /**
   * Phần đồng bộ của tick: chọn nền tảng, đánh dấu lượt `running`, đặt chỗ trong `inflight`
   * rồi mới giao cho `launch`. Vì không có `await` giữa lúc đọc và lúc đánh dấu nên hai lần
   * gọi tick chồng nhau không bao giờ chạy một lượt hai lần hay vượt giới hạn song song.
   */
  function scheduleSync(): void {
    if (stopped) return;
    const providers = new Map<ProviderId, ProviderState>();
    for (const p of store.listProviders()) if (adapters.has(p.id)) providers.set(p.id, p);

    const seen = new Set<string>();
    for (const turn of store.queuedTurns()) {
      try {
        scheduleOne(turn, seen, providers);
      } catch (err) {
        report(err, `lỗi khi xếp lịch task ${turn.taskId}`);
      }
    }
  }

  function scheduleOne(turn: Turn, seen: Set<string>, providers: Map<ProviderId, ProviderState>): void {
    {
      if (seen.has(turn.taskId)) return;
      seen.add(turn.taskId);
      if (inflight.has(turn.taskId)) return;
      const task = store.getTask(turn.taskId);
      if (!task || (task.status !== 'queued' && task.status !== 'waiting_quota')) return;

      const running = new Map<ProviderId, number>();
      for (const f of inflight.values()) running.set(f.provider, (running.get(f.provider) ?? 0) + 1);
      const priority = task.priority ?? config.priority;
      const pick = (prio: ProviderId[], current: ProviderId | null) =>
        pickProvider({
          priority: prio,
          current,
          isNewTask: store.runsOf(task.id).length === 0,
          providers,
          running,
          totalRunning: inflight.size,
          config,
          now: now(),
        });

      const skip = avoid.get(task.id);
      let result = skip === undefined
        ? pick(priority, task.currentProvider)
        : pick(priority.filter((p) => p !== skip), null);
      // Không còn nền tảng nào khác thì đành dùng lại nền tảng vừa bị tránh.
      if (skip !== undefined && 'wait' in result && result.wait === 'quota') {
        result = pick(priority, null);
      }

      if ('wait' in result) {
        if (result.wait === 'quota') setStatus(task.id, 'waiting_quota');
        else if (task.status === 'waiting_quota') setStatus(task.id, 'queued');
        return;
      }

      const provider = result.provider;
      avoid.delete(task.id);
      inflight.set(task.id, { provider, turnId: turn.id, abort: new AbortController() });
      try {
        store.updateTurn(turn.id, { status: 'running' });
        setStatus(task.id, 'running', { currentProvider: provider });
        emit(task.id, null, 'TURN_STARTED', {
          turnId: turn.id, index: turn.index, message: turn.message, provider,
        });
      } catch (err) {
        // Khởi động hỏng giữa chừng: trả chỗ đặt trước và đưa lượt về trạng thái nhất quán.
        inflight.delete(task.id);
        report(err, `không khởi động được lượt ${turn.id}`);
        failTurn(task.id, turn.id, `Không khởi động được lượt: ${errMsg(err)}`);
        return;
      }
      launch(task.id, turn.id, provider);
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    await ensureProviders();
    scheduleSync();
  }

  function launch(taskId: string, turnId: string, provider: ProviderId): void {
    const work = (async () => {
      try {
        await execute(taskId, turnId, provider);
      } catch (err) {
        failTurn(taskId, turnId, errMsg(err));
      } finally {
        inflight.delete(taskId);
      }
      try {
        await tick(); // giải phóng chỗ trước, rồi mới xét tiếp (handoff, hàng đợi)
      } catch {
        // tick lỗi không được làm hỏng lượt đã xong
      }
    })();
    tracked.add(work);
    void work.finally(() => tracked.delete(work)); // work không bao giờ reject
  }

  /** Đường lỗi chung: lượt, run (nếu còn running) và task đều sang failed, không bao giờ kẹt ở running. */
  function failTurn(taskId: string, turnId: string, error: string): void {
    try {
      const turn = store.turnsOf(taskId).find((t) => t.id === turnId);
      let runId: string | null = null;
      if (turn) {
        runId = turn.runId;
        store.updateTurn(turnId, { status: 'failed' });
      }
      if (runId !== null) {
        const run = store.runsOf(taskId).find((r) => r.id === runId);
        if (run && run.status === 'running') store.updateRun(runId, { status: 'failed', endedAt: now() });
      }
      emit(taskId, runId, 'RUN_ERROR', { error });
      setStatus(taskId, 'failed');
    } catch {
      // store đã đóng: không còn gì để làm
    }
  }

  // ---------------------------------------------------------------- execute

  async function execute(taskId: string, turnId: string, provider: ProviderId): Promise<void> {
    let task = store.getTask(taskId)!;
    const turn = store.turnsOf(taskId).find((t) => t.id === turnId)!;
    const adapter = adapters.get(provider);
    if (!adapter) throw new Error(`Không có adapter cho nền tảng ${provider}`);

    // 3. workspace
    if (task.workspacePath === null) {
      const ws = await createWorkspace({
        repoPath: task.repoPath, worktreesDir, taskSeq: task.seq, mode: task.mode,
      });
      task = store.updateTask(taskId, {
        workspacePath: ws.path, branch: ws.branch, baseCommit: ws.baseCommit,
      });
    }
    const ws = wsOf(task);
    const commitMode = task.mode !== 'dirty-nocommit';

    // 4. chọn run
    const last = store.runsOf(taskId).at(-1);
    let run: Run;
    let handoff: string | null = null;
    if (last && last.provider === provider && last.status === 'completed') {
      run = store.updateRun(last.id, { status: 'running', endedAt: null });
      // Run mang bản bàn giao mà chưa có lượt nào xong (thử lại tại chỗ): gửi lại bản bàn giao.
      if (run.handoff !== null && !store.turnsOf(taskId).some((t) => t.runId === run.id && t.status === 'done')) {
        handoff = run.handoff;
      }
    } else {
      if (last) {
        let summary = { status: '', diff: '', commits: [] as string[] };
        try {
          summary = await workspaceSummary(ws);
        } catch {
          // thiếu tóm tắt git vẫn bàn giao được
        }
        handoff = buildHandoff({
          task,
          turns: store.turnsOf(taskId),
          events: store.eventsOf(taskId),
          fromProvider: last.provider,
          reason: last.status === 'interrupted' ? 'interrupted' : 'quota',
          summary,
          maxChars: config.handoffMaxChars,
        });
      }
      run = store.createRun({ taskId, provider, handoff });
      if (last) emit(taskId, run.id, 'HANDOFF', { from: last.provider, to: provider });
    }
    store.updateTurn(turnId, { runId: run.id });
    emit(taskId, run.id, 'RUN_STARTED', { provider, sessionId: run.sessionId, turnId });

    // 5. prompt
    const prompt = handoff !== null
      ? `${handoff}\n\n## Tin nhắn hiện tại của người dùng\n${turn.message}`
      : turn.message;

    // 6. chạy
    const signal = inflight.get(taskId)?.abort.signal;
    const result: TurnResult = signal?.aborted
      ? { outcome: 'error', text: '', sessionId: run.sessionId, resetsAt: null, error: null, usage: null, quota: null, aborted: true }
      : await runTurn(
      adapter,
      {
        prompt,
        systemPrompt: SYSTEM_PROMPT(ws.path),
        sessionId: run.sessionId,
        cwd: ws.path,
        network: config.network,
      },
      {
        timeoutMs: config.turnTimeoutMs,
        ...(signal ? { signal } : {}),
        onEvent: (e: ParsedEvent) => {
          try {
            emit(taskId, run.id, e.type, e.data);
          } catch {
            // một sự kiện hỏng không được làm sập tiến trình đọc stream
          }
        },
      },
    );

    // 7. kết quả
    await settle(task, turn, run, provider, ws, commitMode, result);
  }

  async function safeCommit(
    taskId: string, runId: string, ws: Workspace, message: string,
  ): Promise<void> {
    try {
      await commitAll(ws, message);
    } catch (err) {
      emit(taskId, runId, 'RUN_ERROR', { error: `Commit thất bại: ${errMsg(err)}` });
    }
  }

  async function settle(
    task: Task, turn: Turn, run: Run, provider: ProviderId, ws: Workspace,
    commitMode: boolean, result: TurnResult,
  ): Promise<void> {
    const taskId = task.id;
    const sessionId = result.sessionId ?? run.sessionId;

    if (result.usage) {
      emit(taskId, run.id, 'USAGE', {
        provider, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      });
    }
    if (result.quota) {
      putProvider(provider, { usedPercent: result.quota.usedPercent });
      emit(taskId, run.id, 'QUOTA_UPDATED', {
        provider, usedPercent: result.quota.usedPercent, resetsAt: result.quota.resetsAt,
      });
    }

    if (result.aborted) {
      // Dừng cứng: không phải lỗi. Commit phần dở, run `interrupted`, lượt và task về hàng đợi để chạy tiếp sau.
      if (commitMode) {
        await safeCommit(taskId, run.id, ws, `voragent: lượt ${turn.index} dở dang (${provider})`);
      }
      store.updateRun(run.id, { status: 'interrupted', sessionId, endedAt: now() });
      emit(taskId, run.id, 'RUN_FINISHED', { status: 'interrupted', turnId: turn.id, provider });
      store.updateTurn(turn.id, { status: 'queued' });
      setStatus(taskId, 'queued');
      return;
    }

    if (result.outcome === 'ok') {
      if (commitMode) await safeCommit(taskId, run.id, ws, `voragent: lượt ${turn.index} (${provider})`);
      store.updateRun(run.id, { status: 'completed', sessionId, endedAt: now() });
      store.updateTurn(turn.id, { status: 'done', answer: result.text });
      emit(taskId, run.id, 'RUN_FINISHED', { status: 'completed', provider });
      emit(taskId, run.id, 'TURN_FINISHED', { turnId: turn.id, index: turn.index, status: 'done' });
      setStatus(taskId, 'awaiting_user');
      return;
    }

    if (result.outcome === 'quota_exhausted') {
      const t = now();
      // Giờ reset trong quota chỉ đáng tin khi cửa sổ đã cạn; sự kiện "allowed" mô tả cửa sổ khác.
      const exhausted = result.quota !== null && result.quota.usedPercent >= 1;
      const resetsAt = result.resetsAt ?? (exhausted ? result.quota!.resetsAt : null);
      const cooldownUntil = resetsAt !== null && resetsAt > t ? resetsAt : t + config.defaultCooldownMs;
      putProvider(provider, { cooldownUntil });
      if (commitMode) {
        await safeCommit(taskId, run.id, ws, `voragent: lượt ${turn.index} dở dang (${provider})`);
      }
      store.updateRun(run.id, { status: 'quota_exhausted', sessionId, endedAt: now() });
      emit(taskId, run.id, 'RUN_FINISHED', { status: 'quota_exhausted', provider });
      emit(taskId, run.id, 'QUOTA_EXHAUSTED', { provider, resetsAt });
      store.updateTurn(turn.id, { status: 'queued' });
      setStatus(taskId, 'queued', { currentProvider: null });
      return;
    }

    // error
    const error = result.error ?? 'Lỗi không rõ';
    if (turn.attempts < 1) {
      // Giữ run và phiên: run về `completed` để lần chạy lại dùng tiếp sessionId.
      store.updateRun(run.id, { status: 'completed', sessionId, endedAt: now() });
      store.updateTurn(turn.id, { status: 'queued', attempts: turn.attempts + 1 });
      setStatus(taskId, 'queued');
      return;
    }
    store.updateRun(run.id, { status: 'failed', sessionId, endedAt: now() });
    store.updateTurn(turn.id, { status: 'failed' });
    emit(taskId, run.id, 'RUN_ERROR', { error });
    setStatus(taskId, 'failed');
  }

  // ------------------------------------------------------------- public API

  async function submitTask(i: {
    repoPath: string; message: string; title?: string; mode?: WorkspaceMode; priority?: ProviderId[];
  }): Promise<Task> {
    const title = i.title ?? (i.message.split('\n')[0] ?? '').trim().slice(0, TITLE_MAX) ?? '';
    const mode = i.mode ?? config.defaultMode;
    const { task, turn } = store.createTask({
      title: title || 'Task mới',
      repoPath: i.repoPath,
      mode,
      priority: i.priority ?? null,
      message: i.message,
    });
    emit(task.id, null, 'TASK_CREATED', { title: task.title, mode, turnId: turn.id });
    return task;
  }

  function sendMessage(taskId: string, message: string): Turn {
    const task = store.getTask(taskId);
    if (!task) throw new Error(`Không tìm thấy task ${taskId}`);
    if (task.status !== 'awaiting_user' && task.status !== 'failed') {
      throw new Error(
        `Chỉ gửi được tin nhắn khi task đang chờ bạn hoặc bị lỗi (hiện tại: ${task.status}).`,
      );
    }
    const turn = store.addTurn(taskId, message);
    setStatus(taskId, 'queued');
    return turn;
  }

  function closeTask(taskId: string): void {
    const task = store.getTask(taskId);
    if (!task) throw new Error(`Không tìm thấy task ${taskId}`);
    if (task.status === 'closed') return;
    store.updateTask(taskId, { status: 'closed' });
    emit(taskId, null, 'STATE_CHANGED', { status: 'closed' });
  }

  function retry(taskId: string, o: { switchProvider?: boolean } = {}): void {
    const task = store.getTask(taskId);
    if (!task) throw new Error(`Không tìm thấy task ${taskId}`);
    if (task.status !== 'failed') {
      throw new Error(`Chỉ thử lại được task đang bị lỗi (hiện tại: ${task.status}).`);
    }
    const failed = store.turnsOf(taskId).filter((t) => t.status === 'failed').at(-1);
    if (!failed) throw new Error('Task không có lượt lỗi nào để thử lại.');
    store.updateTurn(failed.id, { status: 'queued', attempts: 0 });
    if (o.switchProvider) {
      const current = task.currentProvider ?? store.runsOf(taskId).at(-1)?.provider ?? null;
      if (current !== null) {
        putProvider(current, {
          cooldownUntil: Math.max(store.getProvider(current)?.cooldownUntil ?? 0, now()),
        });
        avoid.set(taskId, current);
      }
      setStatus(taskId, 'queued', { currentProvider: null });
    } else {
      setStatus(taskId, 'queued');
    }
  }

  /**
   * Lược đồ chạy lại sau gián đoạn: mỗi lần một run bị ngắt, ghi một sự kiện RUN_FINISHED
   * {status:'interrupted', turnId}. Lượt có sẵn một sự kiện như vậy (đã bị ngắt một lần) mà
   * bị ngắt tiếp thì chuyển `failed`. Không dùng `turn.attempts` (dành cho luật thử lại khi lỗi).
   */
  function recover(): void {
    const interruptedTurns = new Set<string>();
    for (const run of store.runningRuns()) {
      store.updateRun(run.id, { status: 'interrupted', endedAt: now() });
      const turn = store.turnsOf(run.taskId).find((t) => t.status === 'running' && t.runId === run.id);
      if (turn) interruptedTurns.add(turn.id);
    }
    for (const task of store.listTasks()) {
      const turns = store.turnsOf(task.id);
      for (const turn of turns) if (turn.status === 'running') interruptedTurns.add(turn.id);
      const running = turns.filter((t) => interruptedTurns.has(t.id));
      if (running.length === 0 && task.status !== 'running') continue;
      let failed = false;
      for (const turn of running) {
        const before = store.eventsOf(task.id).filter(
          (e) => e.type === 'RUN_FINISHED' && e.data.status === 'interrupted' && e.data.turnId === turn.id,
        ).length;
        emit(task.id, turn.runId, 'RUN_FINISHED', { status: 'interrupted', turnId: turn.id });
        if (before >= 1) {
          store.updateTurn(turn.id, { status: 'failed' });
          emit(task.id, turn.runId, 'RUN_ERROR', {
            error: 'Lượt bị ngắt hai lần (daemon khởi động lại), không chạy lại nữa.',
          });
          failed = true;
        } else {
          store.updateTurn(turn.id, { status: 'queued' });
        }
      }
      if (task.status === 'running' || running.length > 0) {
        setStatus(task.id, failed ? 'failed' : 'queued');
      }
    }
  }

  async function idle(): Promise<void> {
    while (tracked.size > 0) {
      const snapshot = [...tracked];
      await Promise.allSettled(snapshot);
      for (const p of snapshot) tracked.delete(p);
    }
  }

  function start(intervalMs: number = DEFAULT_TICK_MS): void {
    stopped = false;
    if (timer) clearInterval(timer);
    void refreshProviders().then(() => tick()).catch(() => undefined);
    timer = setInterval(() => {
      void tick().catch(() => undefined);
    }, intervalMs);
    timer.unref();
  }

  async function stop(opts: { force?: boolean } = {}): Promise<void> {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = undefined;
    if (opts.force) for (const f of inflight.values()) f.abort.abort();
    await idle();
  }

  return {
    submitTask, sendMessage, closeTask, retry, tick, idle, recover, refreshProviders, start, stop,
    pendingCount: () => tracked.size,
  };
}
