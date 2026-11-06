import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Adapter, ParsedEvent, TurnResult } from '@voragent/adapters';
import type {
  Config, EventType, ManagerMode, ManagerPlan, ManagerSubtask, MemoryItem,
  ProviderId, ProviderState, Run, Task, Turn, WorkspaceMode,
} from '@voragent/shared';
import { MEMORY_CATEGORY_LABEL, PROVIDER_MODELS } from '@voragent/shared';
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
    parentTaskId?: string | null;
    role?: string | null;
    model?: string | null;
  }): Promise<Task>;
  sendMessage(taskId: string, message: string): Turn; // chỉ khi status 'awaiting_user' hoặc 'failed'
  closeTask(taskId: string): void;
  updateTask(taskId: string, patch: Partial<Task>): Task;
  deleteTask(taskId: string): boolean;
  retry(taskId: string, o?: { switchProvider?: boolean }): void;
  /** Chuyển giao hoặc chỉ định trực tiếp một agent cụ thể cho task (từ menu 3D/2D). */
  assignTask(taskId: string, provider: ProviderId): Task;
  /** Trưởng phòng lập kế hoạch chia việc cho các nhân viên trong văn phòng dự án. */
  createManagerPlan(i: {
    repoPath: string;
    goal: string;
    mode?: ManagerMode;
    subtasks?: Array<{ title: string; message: string; assignedProvider: ProviderId; role: string }>;
  }): Promise<ManagerPlan>;
  /** Duyệt và phát lệnh thực thi kế hoạch của Trưởng phòng tới các sub-agent. */
  dispatchManagerPlan(planId: string, subtasksOverride?: ManagerSubtask[]): Promise<ManagerPlan>;
  deleteManagerPlan(planId: string): boolean;
  updateManagerPlan(planId: string, patch: Partial<ManagerPlan>): ManagerPlan;
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
const SYSTEM_PROMPT = (path: string, memories: MemoryItem[] = [], role?: string | null, taskId?: string): string => {
  const base = `Bạn đang làm việc trong thư mục ${path}. Chỉ sửa file trong thư mục này.`;
  const guidelines = [
    '## QUY CHUẨN TRÌNH BÀY HƯỚNG DẪN NGƯỜI DÙNG:',
    '- Khi hướng dẫn chạy lệnh terminal: Luôn đặt lệnh trong khối mã fenced code block chuẩn (ví dụ ```bash\nnpm test\n```) để người dùng sao chép bằng 1 click. Không viết lệnh lửng lơ trên dòng văn bản.',
    '- Khi hướng dẫn xem file giao diện HTML hoặc tệp trong dự án:',
    `  + Luôn cung cấp đường dẫn tệp tuyệt đối định dạng file:/// (ví dụ [Mở file giao diện](file:///${path.replace(/\\/g, '/')}/index.html)).`,
    ...(taskId ? [`  + Hoặc cung cấp đường dẫn Live Preview trực tiếp trên voragent: http://127.0.0.1:4717/api/tasks/${taskId}/preview/index.html`] : []),
    '- Luôn trả lời ngắn gọn, trực diện, không dài dòng triết lý.',
  ].join('\n');
  const parts = [base, guidelines];
  if (role) {
    parts.push(`Vai trò của bạn trong văn phòng dự án: ${role}.`);
  }
  if (memories.length > 0) {
    const memLines = memories.slice(0, 12).map(
      (m) => `- [${MEMORY_CATEGORY_LABEL[m.category] ?? m.category}] ${m.title}: ${m.content} (bởi ${m.author})`,
    );
    parts.push(
      `## BỘ NHỚ DÙNG CHUNG CỦA VĂN PHÒNG DỰ ÁN (Shared Memory)\nCác nhân viên (Claude, Codex, Antigravity) và Trưởng phòng đang chia sẻ các ngữ cảnh sau:\n${memLines.join('\n')}`,
    );
  }
  return parts.join('\n\n');
};

/**
 * Trưởng phòng tự động phân rã mục tiêu lớn thành các nhiệm vụ chuyên môn,
 * CHỈ phân công cho các nền tảng đã thực sự được cài đặt trên máy (`installedProviders`).
 */
export function buildDefaultSubtasks(goal: string, installedProviders: ProviderId[]): ManagerSubtask[] {
  const cleanGoal = goal.trim();
  const shortGoal = (cleanGoal.split('\n')[0] ?? cleanGoal).slice(0, 48);
  const pool = installedProviders.length > 0 ? installedProviders : ['claude'];

  const pArch = pool.find((p) => p.includes('claude')) ?? pool[0]!;
  const pUi = pool.find((p) => p.includes('antigravity') || p.includes('agy')) ?? pool[1 % pool.length]!;
  const pQa = pool.find((p) => p.includes('codex')) ?? pool[2 % pool.length]!;

  const subtasks: ManagerSubtask[] = [
    {
      id: randomUUID(),
      title: `[Kiến trúc & Lõi] ${shortGoal}`,
      message: `Trưởng phòng giao việc (Vai trò: Kiến trúc & Lõi):\nMục tiêu chung của dự án: "${cleanGoal}"\n\nNhiệm vụ của bạn:\n1. Phân tích cấu trúc hiện tại và thiết kế/cập nhật tầng dữ liệu, API hoặc logic nghiệp vụ cốt lõi.\n2. Đảm bảo tương thích với quy chuẩn trong Shared Memory của văn phòng.`,
      assignedProvider: pArch,
      role: 'Kiến trúc & Logic lõi',
      taskId: null,
    },
    {
      id: randomUUID(),
      title: `[Giao diện & Tương tác] ${shortGoal}`,
      message: `Trưởng phòng giao việc (Vai trò: Giao diện & Trải nghiệm):\nMục tiêu chung của dự án: "${cleanGoal}"\n\nNhiệm vụ của bạn:\n1. Xây dựng hoặc cập nhật giao diện người dùng và luồng tương tác trực quan.\n2. Tuân thủ quy chuẩn thiết kế Warm Cozy Tech và đồng bộ với tầng lõi.`,
      assignedProvider: pUi,
      role: 'Giao diện & Tương tác',
      taskId: null,
    },
    {
      id: randomUUID(),
      title: `[Kiểm thử & Đánh giá] ${shortGoal}`,
      message: `Trưởng phòng giao việc (Vai trò: Kiểm thử & Đảm bảo chất lượng):\nMục tiêu chung của dự án: "${cleanGoal}"\n\nNhiệm vụ của bạn:\n1. Rà soát các trường hợp biên, viết bổ sung unit/integration test và kiểm tra chất lượng.\n2. Báo cáo phát hiện quan trọng để lưu vào Shared Memory.`,
      assignedProvider: pQa,
      role: 'Kiểm thử & Review',
      taskId: null,
    },
  ];

  if (pool.some((p) => p.includes('opencode'))) {
    const pExec = pool.find((p) => p.includes('opencode'))!;
    subtasks.push({
      id: randomUUID(),
      title: `[Đa mô hình & Thực thi] ${shortGoal}`,
      message: `Trưởng phòng giao việc (Vai trò: Đa mô hình & Thực thi):\nMục tiêu chung của dự án: "${cleanGoal}"\n\nNhiệm vụ của bạn:\n1. Tích hợp các thành phần, kiểm tra tính tương thích đa môi trường và hỗ trợ thực thi.\n2. Báo cáo tiến độ và đồng bộ kết quả vào Shared Memory.`,
      assignedProvider: pExec,
      role: 'Đa mô hình & Thực thi',
      taskId: null,
    });
  }

  return subtasks;
}

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

  /** Danh sách nền tảng đã được cài đặt trên máy theo đúng thứ tự ưu tiên. */
  function getInstalledPriority(): ProviderId[] {
    const byId = new Map(store.listProviders().map((p) => [p.id, p]));
    const installed = config.priority.filter((id) => {
      const p = byId.get(id);
      return p ? p.installed : adapters.has(id);
    });
    return installed.length > 0 ? installed : config.priority;
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

      // Pipeline tuần tự: Task có parentTaskId chỉ được chạy khi task cha đã hoàn tất ('closed').
      // Nếu task cha chưa xong hoặc gặp lỗi ('failed'), task con không được phép chạy trước.
      if (task.parentTaskId) {
        const parent = store.getTask(task.parentTaskId);
        if (parent && parent.status !== 'closed') {
          return;
        }
      }

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
      let baseBranchOrCommit: string | null = null;
      if (task.parentTaskId) {
        const parent = store.getTask(task.parentTaskId);
        if (parent?.branch) {
          baseBranchOrCommit = parent.branch;
        }
      }
      const ws = await createWorkspace({
        repoPath: task.repoPath,
        worktreesDir,
        taskSeq: task.seq,
        mode: task.mode,
        baseBranchOrCommit,
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

    // 5. prompt & Shared Memory của Văn phòng Dự án
    const prompt = handoff !== null
      ? `${handoff}\n\n## Tin nhắn hiện tại của người dùng\n${turn.message}`
      : turn.message;
    const memories = store.listMemories(task.repoPath);

    // 6. chạy
    const signal = inflight.get(taskId)?.abort.signal;
    const result: TurnResult = signal?.aborted
      ? { outcome: 'error', text: '', sessionId: run.sessionId, resetsAt: null, error: null, usage: null, quota: null, aborted: true }
      : await runTurn(
      adapter,
      {
        prompt,
        systemPrompt: SYSTEM_PROMPT(ws.path, memories, task.role, task.id),
        sessionId: run.sessionId,
        cwd: ws.path,
        network: config.network,
        model: task.model ?? config.models?.[provider] ?? null,
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

  /**
   * Trưởng phòng tự động giám sát tiến độ Sub-agents:
   * - Khi một lượt (turn) của Sub-agent vừa xong (`awaiting_user`), ghi tóm tắt báo cáo vào Shared Memory của dự án.
   * - Khi tất cả Sub-tasks của một kế hoạch đã đóng (`closed`), tự động cập nhật kế hoạch sang `completed`.
   */
  function syncManagerOnTaskUpdate(task: Task, latestAnswer?: string): void {
    try {
      const plans = store.listManagerPlans(task.repoPath);
      const linkedPlan = plans.find((p) => p.subtasks.some((s) => s.taskId === task.id));

      if (latestAnswer && latestAnswer.trim() !== '') {
        const cleanSnippet = latestAnswer.trim().replace(/\s+/g, ' ').slice(0, 260);
        const runner = (task.currentProvider ?? 'sub-agent').toUpperCase();
        store.upsertMemory({
          id: `report-task-${task.id}`,
          repoPath: task.repoPath,
          category: 'finding',
          title: `Báo cáo từ ${runner} (#${task.seq} ${task.title.slice(0, 38)})`,
          content: cleanSnippet,
          author: task.currentProvider ?? 'manager',
          pinned: false,
        });
        try {
          bus.publish({
            id: 0,
            taskId: task.id,
            runId: null,
            ts: now(),
            source: 'managed',
            type: 'MEMORY_UPDATED',
            data: { repoPath: task.repoPath },
          });
        } catch { /* ignore */ }
      }

      if (linkedPlan && linkedPlan.mode === 'auto' && task.status === 'awaiting_user') {
        // Trong chế độ tự động hoàn toàn (auto), khi task vừa xong 1 lượt,
        // Trưởng phòng tự động đóng task để kích hoạt giai đoạn tiếp theo.
        closeTask(task.id);
        return;
      }

      if (linkedPlan && linkedPlan.status === 'dispatched') {
        const allTasks = store.listTasks();
        const byId = new Map(allTasks.map((t) => [t.id, t]));
        const allClosed = linkedPlan.subtasks.every((s) => {
          if (!s.taskId) return false;
          const st = byId.get(s.taskId);
          return st?.status === 'closed';
        });
        if (allClosed) {
          const updatedPlan = store.updateManagerPlan(linkedPlan.id, { status: 'completed' });
          try {
            bus.publish({
              id: 0,
              taskId: task.id,
              runId: null,
              ts: now(),
              source: 'managed',
              type: 'MANAGER_PLAN_UPDATED',
              data: { repoPath: task.repoPath, plan: updatedPlan },
            });
          } catch { /* ignore */ }
        }
      }
    } catch {
      // Không chặn luồng chính nếu đồng bộ báo cáo gặp lỗi
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
      const updatedTask = setStatus(taskId, 'awaiting_user');
      syncManagerOnTaskUpdate(updatedTask, result.text);
      return;
    }

    if (result.outcome === 'quota_exhausted') {
      const t = now();
      // Giờ reset trong quota chỉ đáng tin khi cửa sổ đã cạn; sự kiện "allowed" mô tả cửa sổ khác.
      const exhausted = result.quota !== null && result.quota.usedPercent >= 1;
      const resetsAt = result.resetsAt ?? (exhausted ? result.quota!.resetsAt : null);
      const cooldownUntil = resetsAt !== null && resetsAt > t ? resetsAt : t + config.defaultCooldownMs;
      const currentModel = task.model ?? config.models?.[provider] ?? null;
      if (provider === 'antigravity') {
        if (currentModel) {
          store.upsertModelQuota({
            provider,
            model: currentModel,
            cooldownUntil,
            usedPercent: 1.0,
            updatedAt: t,
            lastError: result.error ?? 'RESOURCE_EXHAUSTED',
          });
        }
        const allModels = PROVIDER_MODELS[provider] ?? [];
        const availableModel = allModels.find((m) => {
          if (m.id === currentModel) return false;
          const q = store.getModelQuota(provider, m.id);
          return q === null || q.cooldownUntil === null || q.cooldownUntil <= t;
        });

        const policy = config.modelFallbackPolicy ?? 'auto';

        if (availableModel && policy === 'auto') {
          // CHẾ ĐỘ 1: TỰ ĐỘNG CHUYỂN SANG MODEL CÒN QUOTA
          store.updateTask(taskId, { model: availableModel.id });
          emit(taskId, run.id, 'STATE_CHANGED', {
            status: 'queued',
            fallbackModel: availableModel.id,
            reason: `Model ${currentModel} hết quota. Đã tự động chuyển sang ${availableModel.name} để tiếp tục.`,
          });
          putProvider(provider, { cooldownUntil: null });
          if (commitMode) {
            await safeCommit(taskId, run.id, ws, `voragent: tự động chuyển sang ${availableModel.name} (${provider})`);
          }
          store.updateRun(run.id, { status: 'quota_exhausted', sessionId, endedAt: now() });
          emit(taskId, run.id, 'RUN_FINISHED', { status: 'quota_exhausted', provider });
          emit(taskId, run.id, 'QUOTA_EXHAUSTED', {
            provider, resetsAt, model: currentModel,
            switchedTo: availableModel.id, policy: 'auto',
          });
          store.updateTurn(turn.id, { status: 'queued' });
          setStatus(taskId, 'queued', { currentProvider: null });
          return;
        }

        if (availableModel && policy === 'ask') {
          // CHẾ ĐỘ 2: DỪNG & HỎI Ý KIẾN NGƯỜI DÙNG
          putProvider(provider, { cooldownUntil: null });
          if (commitMode) {
            await safeCommit(taskId, run.id, ws, `voragent: tạm dừng chờ chọn chuyển model`);
          }
          store.updateRun(run.id, { status: 'quota_exhausted', sessionId, endedAt: now() });
          emit(taskId, run.id, 'RUN_FINISHED', { status: 'quota_exhausted', provider });
          emit(taskId, run.id, 'QUOTA_EXHAUSTED', {
            provider,
            resetsAt,
            model: currentModel,
            suggestedModel: availableModel.id,
            suggestedModelName: availableModel.name,
            policy: 'ask',
          });
          setStatus(taskId, 'awaiting_user');
          return;
        }

        const activeCooldowns = store.listModelQuotas(provider)
          .filter((m) => m.cooldownUntil !== null && m.cooldownUntil > t);

        if (allModels.length > 0 && activeCooldowns.length >= allModels.length) {
          putProvider(provider, { cooldownUntil });
        } else {
          putProvider(provider, { cooldownUntil: null });
        }
      } else {
        putProvider(provider, { cooldownUntil });
      }
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
    repoPath: string;
    message: string;
    title?: string;
    mode?: WorkspaceMode;
    priority?: ProviderId[];
    parentTaskId?: string | null;
    role?: string | null;
    model?: string | null;
  }): Promise<Task> {
    const title = i.title ?? (i.message.split('\n')[0] ?? '').trim().slice(0, TITLE_MAX) ?? '';
    const mode = i.mode ?? config.defaultMode;
    const { task, turn } = store.createTask({
      title: title || 'Task mới',
      repoPath: i.repoPath,
      mode,
      priority: i.priority ?? null,
      message: i.message,
      parentTaskId: i.parentTaskId ?? null,
      role: i.role ?? null,
      model: i.model ?? null,
    });
    emit(task.id, null, 'TASK_CREATED', { title: task.title, mode, turnId: turn.id });
    return task;
  }

  function sendMessage(taskId: string, message: string): Turn {
    const task = store.getTask(taskId);
    if (!task) throw new Error(`Không tìm thấy task ${taskId}`);
    if (task.status === 'waiting_quota' || task.status === 'queued') {
      const pending = store.turnsOf(taskId).filter((t) => t.status === 'queued').at(-1);
      if (pending) {
        const updatedTurn = store.updateTurn(pending.id, { message, attempts: 0 });
        setStatus(taskId, 'queued');
        return updatedTurn;
      }
    }
    if (task.status !== 'awaiting_user' && task.status !== 'failed') {
      throw new Error(
        `Chỉ gửi được tin nhắn khi task đang chờ bạn, chờ hạn mức hoặc bị lỗi (hiện tại: ${task.status}).`,
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
    const updated = store.updateTask(taskId, { status: 'closed' });
    emit(taskId, null, 'STATE_CHANGED', { status: 'closed' });
    syncManagerOnTaskUpdate(updated);
    void tick(); // Kích hoạt ngay lập tức cho các task phụ thuộc tiếp theo
  }

  function updateTask(taskId: string, patch: Partial<Task>): Task {
    const updated = store.updateTask(taskId, patch);
    emit(taskId, null, 'STATE_CHANGED', { ...patch });
    return updated;
  }

  function deleteTask(taskId: string): boolean {
    const task = store.getTask(taskId);
    if (!task) return false;
    const active = inflight.get(taskId);
    if (active) {
      active.abort.abort();
      inflight.delete(taskId);
    }
    avoid.delete(taskId);
    const deleted = store.deleteTask(taskId);
    if (deleted) {
      try {
        bus.publish({
          id: 0,
          taskId,
          runId: null,
          ts: now(),
          source: 'managed',
          type: 'STATE_CHANGED',
          data: { deleted: true },
        });
      } catch {
        // ignore
      }
    }
    return deleted;
  }

  function retry(taskId: string, o: { switchProvider?: boolean } = {}): void {
    const task = store.getTask(taskId);
    if (!task) throw new Error(`Không tìm thấy task ${taskId}`);
    if (task.status !== 'failed' && task.status !== 'waiting_quota' && task.status !== 'awaiting_user') {
      throw new Error(`Chỉ thử lại được task đang bị lỗi hoặc đang chờ hạn mức (hiện tại: ${task.status}).`);
    }
    const turns = store.turnsOf(taskId);
    const targetTurn =
      turns.filter((t) => t.status === 'failed').at(-1) ??
      turns.filter((t) => t.status === 'queued').at(-1) ??
      turns.at(-1);
    if (!targetTurn) throw new Error('Task không có lượt nào để thử lại.');
    store.updateTurn(targetTurn.id, { status: 'queued', attempts: 0 });

    if (o.switchProvider) {
      const current = task.currentProvider ?? store.runsOf(taskId).at(-1)?.provider ?? null;
      if (current !== null) {
        putProvider(current, {
          cooldownUntil: Math.max(store.getProvider(current)?.cooldownUntil ?? 0, now()),
        });
        avoid.set(taskId, current);
      }
      const installedPool = getInstalledPriority();
      const nextPrio = current ? installedPool.filter((p) => p !== current) : installedPool;
      const effectivePrio = nextPrio.length > 0 ? [...nextPrio, ...(current ? [current] : [])] : installedPool;
      setStatus(taskId, 'queued', { currentProvider: null, priority: effectivePrio });
    } else {
      // Force retry: xóa cooldown của nền tảng mục tiêu (hoặc tất cả nền tảng đã cài đặt trong priority) để có thể thử chạy ngay
      const candidates = task.currentProvider
        ? [task.currentProvider]
        : (task.priority && task.priority.length > 0 ? task.priority : getInstalledPriority());
      for (const pid of candidates) {
        const pState = store.getProvider(pid);
        if (pState && pState.installed && pState.cooldownUntil !== null) {
          putProvider(pid, { cooldownUntil: null });
        }
      }
      avoid.delete(taskId);
      setStatus(taskId, 'queued');
    }
  }

  function assignTask(taskId: string, provider: ProviderId): Task {
    const task = store.getTask(taskId);
    if (!task) throw new Error(`Không tìm thấy task ${taskId}`);
    if (task.status === 'closed') throw new Error('Không thể chuyển giao task đã đóng.');

    const provState = store.getProvider(provider);
    if (provState && !provState.installed) {
      throw new Error(`Nền tảng "${provider}" chưa được cài đặt trên máy này.`);
    }
    // Khi người dùng chủ động chỉ định nền tảng này, xóa cooldown tạm thời (nếu có) để thử chạy ngay
    if (provState && provState.cooldownUntil !== null) {
      putProvider(provider, { cooldownUntil: null });
    }
    avoid.delete(taskId);

    const installedPool = getInstalledPriority();
    const rest = installedPool.filter((p) => p !== provider);
    const nextPriority = [provider, ...rest];

    // Nếu đang chạy trên agent khác thì hủy lượt hiện tại để bàn giao sang agent mới
    const active = inflight.get(taskId);
    if (active && active.provider !== provider) {
      store.updateTask(taskId, { priority: nextPriority, currentProvider: provider });
      active.abort.abort();
      return store.getTask(taskId)!;
    }

    const prevProvider = task.currentProvider;
    const updated = store.updateTask(taskId, {
      priority: nextPriority,
      currentProvider: provider,
    });
    if (prevProvider && prevProvider !== provider) {
      emit(taskId, null, 'HANDOFF', { from: prevProvider, to: provider, manual: true });
    }
    // Nếu task đang bị lỗi hoặc đang chờ hạn mức thì tự xếp lại lượt để agent mới tiếp quản ngay
    if (task.status === 'failed' || task.status === 'waiting_quota' || task.status === 'queued') {
      const turns = store.turnsOf(taskId);
      const target =
        turns.filter((t) => t.status === 'failed').at(-1) ??
        turns.filter((t) => t.status === 'queued').at(-1);
      if (target) {
        store.updateTurn(target.id, { status: 'queued', attempts: 0 });
      }
      return setStatus(taskId, 'queued', { priority: nextPriority, currentProvider: provider });
    }
    return updated;
  }

  async function createManagerPlan(i: {
    repoPath: string;
    goal: string;
    mode?: ManagerMode;
    subtasks?: Array<{ title: string; message: string; assignedProvider: ProviderId; role: string }>;
  }): Promise<ManagerPlan> {
    await ensureProviders();
    const installedPool = getInstalledPriority();
    const fallbackProvider = installedPool[0] ?? 'claude';
    const isInstalled = (id: ProviderId): boolean => {
      const p = store.getProvider(id);
      return p ? p.installed : installedPool.includes(id);
    };

    const mode = i.mode ?? 'semi-auto';
    const subtasks: ManagerSubtask[] = i.subtasks && i.subtasks.length > 0
      ? i.subtasks.map((s) => ({
          id: randomUUID(),
          title: s.title,
          message: s.message,
          assignedProvider: isInstalled(s.assignedProvider) ? s.assignedProvider : fallbackProvider,
          role: s.role,
          taskId: null,
        }))
      : buildDefaultSubtasks(i.goal, installedPool);

    const plan = store.createManagerPlan({
      repoPath: i.repoPath,
      goal: i.goal,
      mode,
      subtasks,
    });

    // Ghi mục tiêu của Trưởng phòng vào Shared Memory của văn phòng dự án
    store.upsertMemory({
      repoPath: i.repoPath,
      category: 'context',
      title: `Kế hoạch Trưởng phòng: ${(i.goal.split('\n')[0] ?? i.goal).slice(0, 50)}`,
      content: `Mục tiêu: ${i.goal} — Chia thành ${subtasks.length} nhiệm vụ cho các nhân viên đã cài đặt: ${subtasks.map((s) => `${s.assignedProvider} (${s.role})`).join(', ')}.`,
      author: 'manager',
      pinned: true,
    });

    if (mode === 'auto') {
      return dispatchManagerPlan(plan.id);
    }
    return plan;
  }

  async function dispatchManagerPlan(planId: string, subtasksOverride?: ManagerSubtask[]): Promise<ManagerPlan> {
    await ensureProviders();
    const plan = store.getManagerPlan(planId);
    if (!plan) throw new Error(`Không tìm thấy kế hoạch Trưởng phòng: ${planId}`);
    if (plan.status === 'dispatched' || plan.status === 'completed') {
      return plan;
    }

    const installedPool = getInstalledPriority();
    const fallbackProvider = installedPool[0] ?? 'claude';
    const isInstalled = (id: ProviderId): boolean => {
      const p = store.getProvider(id);
      return p ? p.installed : installedPool.includes(id);
    };

    const list = subtasksOverride ?? plan.subtasks;
    const dispatchedSubtasks: ManagerSubtask[] = [];
    let prevTaskId: string | null = null;

    for (const sub of list) {
      const effectiveProvider = isInstalled(sub.assignedProvider) ? sub.assignedProvider : fallbackProvider;
      const rest = installedPool.filter((p) => p !== effectiveProvider);
      const priority = [effectiveProvider, ...rest];
      const created = await submitTask({
        repoPath: plan.repoPath,
        title: sub.title,
        message: sub.message,
        priority,
        role: sub.role,
        parentTaskId: prevTaskId,
      });
      dispatchedSubtasks.push({ ...sub, assignedProvider: effectiveProvider, taskId: created.id });
      prevTaskId = created.id;
    }

    const updated = store.updateManagerPlan(plan.id, {
      status: 'dispatched',
      subtasks: dispatchedSubtasks,
    });
    return updated;
  }

  function deleteManagerPlan(planId: string): boolean {
    const plan = store.getManagerPlan(planId);
    if (!plan) return false;
    const deleted = store.deleteManagerPlan(planId);
    if (deleted) {
      try {
        bus.publish({
          id: 0,
          taskId: '',
          runId: null,
          ts: now(),
          source: 'managed',
          type: 'MANAGER_PLAN_UPDATED',
          data: { repoPath: plan.repoPath, planId, deleted: true },
        });
      } catch { /* ignore */ }
    }
    return deleted;
  }

  function updateManagerPlan(planId: string, patch: Partial<ManagerPlan>): ManagerPlan {
    const updated = store.updateManagerPlan(planId, patch);
    try {
      bus.publish({
        id: 0,
        taskId: '',
        runId: null,
        ts: now(),
        source: 'managed',
        type: 'MANAGER_PLAN_UPDATED',
        data: { repoPath: updated.repoPath, plan: updated },
      });
    } catch { /* ignore */ }
    return updated;
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
    submitTask, sendMessage, updateTask, closeTask, deleteTask, retry, assignTask, createManagerPlan, dispatchManagerPlan, deleteManagerPlan, updateManagerPlan,
    tick, idle, recover, refreshProviders, start, stop,
    pendingCount: () => tracked.size,
  };
}
