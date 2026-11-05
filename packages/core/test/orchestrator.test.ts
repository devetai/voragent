import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isPidAlive } from '../src/daemon.js';
import { until, rmTmp } from './helpers.js';
import spawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeAdapter } from '@voragent/adapters';
import type { Adapter, TurnResult } from '@voragent/adapters';
import type { Config, ProviderId, Task } from '@voragent/shared';
import { EventBus } from '../src/bus.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createOrchestrator } from '../src/orchestrator.js';
import type { Orchestrator } from '../src/orchestrator.js';
import { openStore } from '../src/store.js';
import type { Store } from '../src/store.js';

const fx = (name: string): string => resolve(import.meta.dirname, '../../adapters/test/fixtures', name);
const RESETS_AT = 1762250400000; // resetsAt trong fake-quota.jsonl

function git(cwd: string, args: string[]): string {
  const r = spawn.sync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

let root: string;
let repo: string;
let store: Store;
let clock: number;
let adapters: Map<ProviderId, Adapter>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voragent-orch-'));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, 'readme.txt'), 'xin chào\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
  store = openStore(':memory:');
  clock = RESETS_AT - 3_600_000;
  adapters = new Map();
});

afterEach(() => {
  const r = spawn.sync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  if (r.status === 0) {
    for (const line of r.stdout.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const p = line.slice(9).trim();
      if (p.replace(/\\/g, '/') !== repo.replace(/\\/g, '/')) {
        spawn.sync('git', ['worktree', 'remove', '--force', p], { cwd: repo });
      }
    }
  }
  store.close();
  rmTmp(root);
});

function fake(
  id: string, fixture: string, o: { exitCode?: number; touch?: string } = {},
): Adapter {
  return createFakeAdapter({ id, fixture: fx(fixture), ...o });
}

function make(
  over: Partial<Config> = {},
  extra: { bus?: EventBus; store?: Store; onError?: (err: unknown, ctx: string) => void } = {},
): ReturnType<typeof createOrchestrator> {
  const config: Config = {
    ...DEFAULT_CONFIG,
    dataDir: join(root, 'data'),
    priority: ['fake-a', 'fake-b'],
    ...over,
  };
  return createOrchestrator({
    store: extra.store ?? store,
    bus: extra.bus ?? new EventBus(),
    adapters,
    config,
    now: () => clock,
    onError: extra.onError ?? (() => undefined),
  });
}

async function run(o: Orchestrator, taskId: string, want: Task['status'], max = 10): Promise<Task> {
  for (let i = 0; i < max; i++) {
    await o.tick();
    await o.idle();
    if (store.getTask(taskId)!.status === want) break;
  }
  return store.getTask(taskId)!;
}

const calls = (cwd: string): string[] =>
  readFileSync(join(cwd, '.fake-calls.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
const types = (taskId: string): string[] => store.eventsOf(taskId).map((e) => e.type);

describe('orchestrator', () => {
  it('G1: hết quota ở fake-a thì fake-b làm tiếp trong cùng worktree', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-quota-tools.jsonl', { exitCode: 1, touch: 'a.txt' }));
    adapters.set('fake-b', fake('fake-b', 'fake-ok.jsonl', { touch: 'b.txt' }));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'làm việc X' });
    await o.tick();
    await o.idle(); // một lần idle phải đủ: nó chờ cả tick nối tiếp sau handoff
    const task = store.getTask(t.id)!;
    expect(task.status).toBe('awaiting_user');

    const runs = store.runsOf(t.id);
    expect(runs.map((r) => [r.provider, r.status])).toEqual([
      ['fake-a', 'quota_exhausted'],
      ['fake-b', 'completed'],
    ]);
    const ws = task.workspacePath!;
    const handoffs = store.eventsOf(t.id).filter((e) => e.type === 'HANDOFF');
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.data).toEqual({ from: 'fake-a', to: 'fake-b' });
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('edited by fake');
    expect(readFileSync(join(ws, 'b.txt'), 'utf8')).toBe('edited by fake');
    const stdin = readFileSync(join(ws, '.fake-stdin.txt'), 'utf8');
    expect(stdin).toContain('# Bàn giao từ fake-a');
    expect(stdin).toContain('làm việc X');
    // danh sách việc đã làm và câu trả lời cuối của agent trước phải tới prompt của nền tảng sau
    expect(stdin).toContain('- Edit');
    expect(stdin).toContain('Đã sửa a.txt, hết quota');
    expect(stdin).toContain(`Bạn đang làm việc trong thư mục ${ws}. Chỉ sửa file trong thư mục này.`);
    expect(store.getProvider('fake-a')!.cooldownUntil).toBe(RESETS_AT);
    const log = git(ws, ['log', '--format=%s', `${task.baseCommit}..HEAD`]);
    expect(log).toContain('voragent: lượt 0 (fake-b)');
    expect(log).toContain('voragent: lượt 0 dở dang (fake-a)');
    const ev = types(t.id);
    for (const k of ['TASK_CREATED', 'TURN_STARTED', 'RUN_STARTED', 'RUN_FINISHED', 'QUOTA_EXHAUSTED',
      'TURN_FINISHED', 'STATE_CHANGED']) expect(ev).toContain(k);
    expect(store.queuedTurns()).toEqual([]);
  });

  it('mọi nền tảng tạm nghỉ thì waiting_quota (không failed), rồi chạy lại khi hết cooldown', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-quota.jsonl', { exitCode: 1 }));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc Y' });
    await o.tick();
    await o.idle();
    expect(store.getTask(t.id)!.status).toBe('waiting_quota');
    expect(store.queuedTurns()).toHaveLength(1);

    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    await o.tick(); // chưa hết cooldown: vẫn chờ
    await o.idle();
    expect(store.getTask(t.id)!.status).toBe('waiting_quota');
    clock = RESETS_AT + 1;
    const task = await run(o, t.id, 'awaiting_user');
    expect(task.status).toBe('awaiting_user');
    expect(store.runsOf(t.id)).toHaveLength(2);
  });

  it('bị ngắt giữa chừng: đúng một run mới mang bàn giao, không nhân đôi lượt', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc Z' });
    const turn = store.turnsOf(t.id)[0]!;
    const old = store.createRun({ taskId: t.id, provider: 'fake-a', handoff: null });
    store.updateTurn(turn.id, { status: 'running', runId: old.id });
    store.updateTask(t.id, { status: 'running', currentProvider: 'fake-a' });

    o.recover();
    expect(store.getTask(t.id)!.status).toBe('queued');
    expect(store.runsOf(t.id)[0]!.status).toBe('interrupted');
    expect(store.runningRuns()).toEqual([]);
    const task = await run(o, t.id, 'awaiting_user');
    expect(task.status).toBe('awaiting_user');
    const runs = store.runsOf(t.id);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.handoff).toContain('daemon bị ngắt');
    expect(store.turnsOf(t.id)).toHaveLength(1);
    expect(store.turnsOf(t.id)[0]!.status).toBe('done');
    expect(store.queuedTurns()).toEqual([]);
  });

  it('bị ngắt lần thứ hai thì lượt và task failed', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc W' });
    const turn = store.turnsOf(t.id)[0]!;
    for (let i = 0; i < 2; i++) {
      const r = store.createRun({ taskId: t.id, provider: 'fake-a', handoff: null });
      store.updateTurn(turn.id, { status: 'running', runId: r.id });
      store.updateTask(t.id, { status: 'running' });
      o.recover();
      expect(store.getTask(t.id)!.status).toBe(i === 0 ? 'queued' : 'failed');
    }
    expect(store.turnsOf(t.id)[0]!.status).toBe('failed');
    expect(store.queuedTurns()).toEqual([]);
  });

  it('lỗi thường: thử lại đúng một lần rồi failed; retry switchProvider bàn giao sang nền tảng khác', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl', { exitCode: 1 }));
    adapters.set('fake-b', fake('fake-b', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc E' });
    await o.tick();
    await o.idle();
    const task = store.getTask(t.id)!;
    expect(task.status).toBe('failed');
    expect(calls(task.workspacePath!)).toHaveLength(2);
    expect(store.eventsOf(t.id).filter((e) => e.type === 'RUN_ERROR')).toHaveLength(1);
    expect(store.turnsOf(t.id)[0]!.status).toBe('failed');

    o.retry(t.id, { switchProvider: true });
    expect(store.getTask(t.id)!.status).toBe('queued');
    expect(store.turnsOf(t.id)[0]!.attempts).toBe(0);
    const after = await run(o, t.id, 'awaiting_user');
    expect(after.status).toBe('awaiting_user');
    const last = store.runsOf(t.id).at(-1)!;
    expect(last.provider).toBe('fake-b');
    expect(last.handoff).toContain('# Bàn giao từ fake-a');
  });

  it('trò chuyện: lượt 1 tiếp tục cùng run và phiên; sendMessage khi đang chạy thì ném lỗi', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'lượt đầu' });
    await o.tick();
    expect(() => o.sendMessage(t.id, 'quá sớm')).toThrow(/chờ bạn|lỗi/);
    await o.idle();
    expect(store.getTask(t.id)!.status).toBe('awaiting_user');

    const turn = o.sendMessage(t.id, 'tiếp');
    expect(turn.index).toBe(1);
    expect(store.getTask(t.id)!.status).toBe('queued');
    await run(o, t.id, 'awaiting_user');
    expect(store.runsOf(t.id)).toHaveLength(1);
    expect(store.turnsOf(t.id).map((x) => x.status)).toEqual(['done', 'done']);
    const ws = store.getTask(t.id)!.workspacePath!;
    const lines = calls(ws);
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)).toContain('--session');
    expect(lines.at(-1)).toContain('fake-s1');
    expect(readFileSync(join(ws, '.fake-stdin.txt'), 'utf8')).not.toContain('Bàn giao');
  });

  it('dirty-nocommit không commit gì', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl', { touch: 'b.txt' }));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc N', mode: 'dirty-nocommit' });
    const task = await run(o, t.id, 'awaiting_user');
    expect(git(task.workspacePath!, ['log', '--format=%s', `${task.baseCommit}..HEAD`])).toBe('');
    expect(git(task.workspacePath!, ['status', '--short'])).toContain('b.txt');
  });

  it('tick() gọi chồng nhau không chạy một lượt hai lần', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc D' });
    await Promise.all([o.tick(), o.tick(), o.tick()]);
    await o.idle();
    expect(store.getTask(t.id)!.status).toBe('awaiting_user');
    expect(store.runsOf(t.id)).toHaveLength(1);
    expect(calls(store.getTask(t.id)!.workspacePath!)).toHaveLength(1);
    expect(store.eventsOf(t.id).filter((e) => e.type === 'TURN_STARTED')).toHaveLength(1);
  });

  it('giới hạn mỗi nền tảng được giữ khi có hai task', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make({ priority: ['fake-a'], concurrency: { perProvider: 1, total: 4 } });
    const t1 = await o.submitTask({ repoPath: repo, message: 'một' });
    const t2 = await o.submitTask({ repoPath: repo, message: 'hai' });
    await o.tick();
    await o.tick();
    expect(store.getTask(t1.id)!.status).toBe('running');
    expect(store.getTask(t2.id)!.status).toBe('queued');
    expect(store.turnsOf(t2.id)[0]!.status).toBe('queued');
    await o.idle(); // idle chờ cả lượt thứ hai được tick nối tiếp khởi động
    expect(store.getTask(t1.id)!.status).toBe('awaiting_user');
    expect(store.getTask(t2.id)!.status).toBe('awaiting_user');
  });

  it('lỗi tạo worktree không để task kẹt ở running', async () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    git(empty, ['init', '-q']);
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make({ concurrency: { perProvider: 1, total: 1 } });
    const t = await o.submitTask({ repoPath: empty, message: 'việc R' });
    await o.tick();
    await o.idle();
    expect(store.getTask(t.id)!.status).toBe('failed');
    expect(store.turnsOf(t.id)[0]!.status).toBe('failed');
    expect(store.eventsOf(t.id).some((e) => e.type === 'RUN_ERROR')).toBe(true);
    // chỗ đặt trước đã được trả: task khác vẫn chạy được
    const t2 = await o.submitTask({ repoPath: repo, message: 'việc S' });
    expect((await run(o, t2.id, 'awaiting_user')).status).toBe('awaiting_user');
  });

  it('stop() chờ lượt đang chạy xong; closeTask giữ trạng thái closed', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc T' });
    await o.tick();
    o.closeTask(t.id);
    await o.stop();
    expect(store.getTask(t.id)!.status).toBe('closed');
    expect(store.turnsOf(t.id)[0]!.status).toBe('done');
  });

  it('retry tại chỗ trên run bàn giao vẫn gửi lại bản bàn giao và dùng lại run, phiên', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-quota.jsonl', { exitCode: 1 }));
    const bad = fake('fake-b', 'fake-ok.jsonl', { exitCode: 1 });
    const good = fake('fake-b', 'fake-ok.jsonl');
    let n = 0;
    adapters.set('fake-b', { ...good, invocation: (i) => (n++ === 0 ? bad : good).invocation(i) });
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc H' });
    const task = await run(o, t.id, 'awaiting_user');
    expect(task.status).toBe('awaiting_user');
    const runs = store.runsOf(t.id);
    expect(runs.map((r) => r.provider)).toEqual(['fake-a', 'fake-b']);
    const ws = task.workspacePath!;
    const lines = calls(ws);
    expect(lines).toHaveLength(3); // a, b lỗi, b lại
    expect(lines.at(-1)).toContain('fake-s1');
    const stdin = readFileSync(join(ws, '.fake-stdin.txt'), 'utf8');
    expect(stdin).toContain('# Bàn giao từ fake-a');
    expect(stdin).toContain('việc H');
  });

  it('tracked được dọn khi lượt xong, không cần idle()', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'm0' });
    for (let i = 0; i < 3; i++) {
      await o.tick();
      for (let k = 0; k < 400 && store.getTask(t.id)!.status !== 'awaiting_user'; k++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 50)); // để tick nối tiếp kết thúc
      expect(o.pendingCount()).toBe(0);
      o.sendMessage(t.id, 'm' + (i + 1));
    }
  });

  it('subscriber ném lỗi không làm hỏng lượt', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const bus = new EventBus();
    bus.subscribe(() => {
      throw new Error('ws hỏng');
    });
    const seen: string[] = [];
    const o = make({}, { bus, onError: (e) => seen.push(String(e)) });
    const t = await o.submitTask({ repoPath: repo, message: 'việc B' });
    expect((await run(o, t.id, 'awaiting_user')).status).toBe('awaiting_user');
    expect(seen.length).toBeGreaterThan(0);
  });

  it('lỗi ở đường khởi động một lượt không làm kẹt task đó hay chặn task khác', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    let failId = '';
    let thrown = false;
    const flaky: Store = {
      ...store,
      updateTurn(id, patch) {
        if (id === failId && patch.status === 'running' && !thrown) {
          thrown = true;
          throw new Error('store hỏng');
        }
        return store.updateTurn(id, patch);
      },
    };
    const o = make({ concurrency: { perProvider: 1, total: 1 } }, { store: flaky });
    const t1 = await o.submitTask({ repoPath: repo, message: 'một' });
    const t2 = await o.submitTask({ repoPath: repo, message: 'hai' });
    failId = store.turnsOf(t1.id)[0]!.id;
    await o.tick();
    await o.idle();
    expect(store.getTask(t1.id)!.status).toBe('failed');
    expect(store.turnsOf(t1.id)[0]!.status).toBe('failed');
    expect((await run(o, t2.id, 'awaiting_user')).status).toBe('awaiting_user');
  });

  it('retry switchProvider không rút ngắn cooldown dài hơn đang có', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl', { exitCode: 1 }));
    adapters.set('fake-b', fake('fake-b', 'fake-ok.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc C' });
    await o.tick();
    await o.idle();
    expect(store.getTask(t.id)!.status).toBe('failed');
    const later = clock + 3_600_000;
    const cur = store.getProvider('fake-a')!;
    store.upsertProvider({ ...cur, cooldownUntil: later });
    o.retry(t.id, { switchProvider: true });
    expect(store.getProvider('fake-a')!.cooldownUntil).toBe(later);
  });

  // ---------------------------------------------------------------- cooldown (I2)

  const COOLDOWN = 7_777_000;
  function quotaAdapter(over: Pick<TurnResult, 'resetsAt' | 'quota'>): Adapter {
    const base = fake('fake-a', 'fake-quota.jsonl', { exitCode: 1 });
    return {
      ...base,
      createParser() {
        const p = base.createParser();
        return { push: (l) => p.push(l), finish: (e) => ({ ...p.finish(e), ...over }) };
      },
    };
  }
  async function cooldownAfter(over: Pick<TurnResult, 'resetsAt' | 'quota'>): Promise<number | null> {
    adapters.set('fake-a', quotaAdapter(over));
    const o = make({ priority: ['fake-a'], defaultCooldownMs: COOLDOWN });
    const t = await o.submitTask({ repoPath: repo, message: 'việc Q' });
    await o.tick();
    await o.idle();
    expect(store.getTask(t.id)!.status).toBe('waiting_quota');
    return store.getProvider('fake-a')!.cooldownUntil;
  }

  it('quota đã cạn có resetsAt trong tương lai (không có giờ trong chữ) thì dùng làm cooldown', async () => {
    expect(await cooldownAfter({ resetsAt: null, quota: { usedPercent: 1, resetsAt: clock + 5_000_000 } }))
      .toBe(clock + 5_000_000);
  });

  it('sự kiện quota "allowed" (chưa cạn) không trở thành cooldown', async () => {
    expect(await cooldownAfter({ resetsAt: null, quota: { usedPercent: 0.53, resetsAt: clock + 5_000_000 } }))
      .toBe(clock + COOLDOWN);
  });

  it('resetsAt đã qua thì rơi về now + defaultCooldownMs', async () => {
    expect(await cooldownAfter({ resetsAt: clock - 1000, quota: null })).toBe(clock + COOLDOWN);
    expect(await cooldownAfter({ resetsAt: null, quota: { usedPercent: 1, resetsAt: clock - 1000 } }))
      .toBe(clock + COOLDOWN);
  });

  // ---------------------------------------------------------------- dừng cứng (I1)

  it('stop({force:true}) giết cây tiến trình, xếp lượt lại, commit phần dở; tick sau stop không chạy gì; orchestrator mới tiếp tục bằng bàn giao', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-tree.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc dài' });
    await o.tick();
    const ws = await until(() => store.getTask(t.id)!.workspacePath ?? undefined, 'workspace');
    const pidFile = join(ws, '.fake-pid.txt');
    const gcFile = join(ws, '.fake-grandchild.pid');
    const pids = await until(() => {
      try {
        const a = Number(readFileSync(pidFile, 'utf8'));
        const b = Number(readFileSync(gcFile, 'utf8'));
        return a > 0 && b > 0 ? [a, b] : undefined;
      } catch { return undefined; }
    }, 'pid files');
    writeFileSync(join(ws, 'partial.txt'), 'dở dang');

    const t0 = Date.now();
    await o.stop({ force: true });
    expect(Date.now() - t0).toBeLessThan(15_000);
    await until(() => pids.every((p) => !isPidAlive(p)), 'tiến trình đã chết');

    const turn = store.turnsOf(t.id)[0]!;
    expect(turn.status).toBe('queued');
    expect(turn.attempts).toBe(0);
    expect(store.runsOf(t.id).map((r) => r.status)).toEqual(['interrupted']);
    expect(store.getTask(t.id)!.status).toBe('queued');
    expect(store.runningRuns()).toEqual([]);
    const fin = store.eventsOf(t.id).filter((e) => e.type === 'RUN_FINISHED');
    expect(fin.map((e) => [e.data.status, e.data.turnId])).toEqual([['interrupted', turn.id]]);
    const log = git(ws, ['log', '--format=%s', `${store.getTask(t.id)!.baseCommit}..HEAD`]);
    expect(log).toContain('voragent: lượt 0 dở dang (fake-a)');
    expect(git(ws, ['show', '--name-only', '--format=', 'HEAD'])).toContain('partial.txt');
    expect(store.eventsOf(t.id).some((e) => e.type === 'RUN_ERROR')).toBe(false);

    const before = store.eventsOf(t.id).length;
    await o.tick();
    await o.idle();
    expect(store.eventsOf(t.id).length).toBe(before);
    expect(store.turnsOf(t.id)[0]!.status).toBe('queued');

    adapters.set('fake-a', fake('fake-a', 'fake-ok.jsonl'));
    const o2 = make();
    o2.recover();
    const task = await run(o2, t.id, 'awaiting_user');
    expect(task.status).toBe('awaiting_user');
    const runs = store.runsOf(t.id);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.handoff).toContain('daemon bị ngắt');
    expect(store.turnsOf(t.id)).toHaveLength(1);
    expect(store.turnsOf(t.id)[0]!.status).toBe('done');
  }, 60_000);

  it('stop() êm vẫn chờ lượt đang chạy xong', async () => {
    adapters.set('fake-a', fake('fake-a', 'fake-sleep.jsonl'));
    const o = make();
    const t = await o.submitTask({ repoPath: repo, message: 'việc ngủ' });
    await o.tick();
    const ws = await until(() => store.getTask(t.id)!.workspacePath ?? undefined, 'workspace');
    await until(() => { try { return readFileSync(join(ws, '.fake-pid.txt'), 'utf8'); } catch { return undefined; } }, 'pid');
    let settled = false;
    const p = o.stop().then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 700));
    expect(settled).toBe(false);
    await p;
    expect(store.turnsOf(t.id)[0]!.status).toBe('done');
  }, 60_000);
});
