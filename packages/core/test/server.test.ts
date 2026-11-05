import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import spawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createFakeAdapter } from '@voragent/adapters';
import type { Adapter } from '@voragent/adapters';
import type { ProviderId, Task, VEvent } from '@voragent/shared';
import { freePort, until, withFreePort, rmTmp } from './helpers.js';
import { EventBus } from '../src/bus.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';
import type { Daemon } from '../src/daemon.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { createProjectCatalog } from '../src/projects.js';
import { createServer } from '../src/server.js';
import { openStore } from '../src/store.js';
import type { Store } from '../src/store.js';

const fx = (name: string): string => resolve(import.meta.dirname, '../../adapters/test/fixtures', name);
const KEY = 'k'.repeat(48);

function git(cwd: string, args: string[]): void {
  const r = spawn.sync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}


let root: string;
let repo: string;
let dataDir: string;
const daemons: Daemon[] = [];
const stores: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voragent-srv-'));
  repo = join(root, 'repo');
  dataDir = join(root, 'data');
  mkdirSync(repo);
  mkdirSync(dataDir);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, 'readme.txt'), 'xin chào\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ priority: ['fake-a'] }));
});

afterEach(async () => {
  for (const d of daemons.splice(0)) await d.stop();
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      // đã đóng
    }
  }
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
  rmTmp(root);
});

const fakeAdapters = (fixture = 'fake-ok.jsonl'): Map<ProviderId, Adapter> =>
  new Map([['fake-a', createFakeAdapter({ id: 'fake-a', fixture: fx(fixture) })]]);

async function daemon(fixture = 'fake-ok.jsonl'): Promise<Daemon> {
  const d = await withFreePort((port) => startDaemon({ dataDir, port, adapters: fakeAdapters(fixture) }));
  daemons.push(d);
  return d;
}

const base = (d: Daemon): string => `http://127.0.0.1:${d.port}`;
const authed = (d: Daemon, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'x-voragent-key': d.key, 'content-type': 'application/json', ...(init.headers ?? {}) },
});

describe('createServer (không cần socket)', () => {
  function app() {
    const store = openStore(':memory:');
    stores.push(store);
    const bus = new EventBus();
    const orchestrator = createOrchestrator({
      store, bus, adapters: fakeAdapters(), config: { ...DEFAULT_CONFIG, dataDir, priority: ['fake-a'] },
    });
    orchestrator.tick = async () => undefined; // route gọi tick sau khi tạo task: ở đây không chạy agent thật
    const shutdowns: Array<{ force: boolean }> = [];
    const a = createServer({
      orchestrator, store, bus, key: KEY, webDir: null, onShutdown: (o) => { shutdowns.push(o); },
    });
    return { a, store, orchestrator, shutdowns: () => shutdowns.length, calls: shutdowns };
  }
  const h = { 'x-voragent-key': KEY };

  it('401 khi thiếu hoặc sai khóa, 200 khi có khóa (header, query, cookie)', async () => {
    const { a } = app();
    expect((await a.request('/api/tasks')).status).toBe(401);
    expect((await a.request('/api/tasks', { headers: { 'x-voragent-key': 'x'.repeat(48) } })).status).toBe(401);
    expect((await a.request('/api/tasks', { headers: { 'x-voragent-key': 'ngan' } })).status).toBe(401);
    const ok = await a.request('/api/tasks', { headers: h });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
    expect((await a.request(`/api/tasks?key=${KEY}`)).status).toBe(200);
    expect((await a.request('/api/tasks', { headers: { cookie: `x=1; voragent_key=${KEY}` } })).status).toBe(200);
    const body = (await (await a.request('/api/tasks')).json()) as { error: string };
    expect(body.error).toMatch(/khóa/);
  });

  it('GET /?key= đặt cookie HttpOnly SameSite=Strict và báo chưa build web', async () => {
    const { a } = app();
    const r = await a.request(`/?key=${KEY}`);
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`voragent_key=${KEY}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(await r.text()).toContain('chưa được build');
    expect((await a.request('/')).status).toBe(401);
  });

  it('từ chối Host không phải localhost / 127.0.0.1 bằng 403', async () => {
    const { a } = app();
    const evil = await a.request('/api/tasks', { headers: { ...h, host: 'evil.example.com:4717' } });
    expect(evil.status).toBe(403);
    expect((await a.request('/api/tasks', { headers: { ...h, host: 'localhost:4717' } })).status).toBe(200);
    expect((await a.request('/api/tasks', { headers: { ...h, host: '127.0.0.1:4717' } })).status).toBe(200);
  });

  it('body JSON hỏng hoặc thiếu trường thì 400 kèm thông báo tiếng Việt', async () => {
    const { a } = app();
    const post = (body: string) =>
      a.request('/api/tasks', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body });
    const bad = await post('{không phải json');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/JSON/);
    expect((await post(JSON.stringify({ repoPath: repo }))).status).toBe(400);
    expect((await post(JSON.stringify({ repoPath: join(root, 'khong-co'), message: 'x' }))).status).toBe(400);
    expect((await post(JSON.stringify({ repoPath: repo, message: 'x', mode: 'la' }))).status).toBe(400);
    expect((await post(JSON.stringify({ repoPath: repo, message: 'x', priority: [] }))).status).toBe(400);
  });

  it('task không tồn tại thì 404 ở mọi route theo id', async () => {
    const { a } = app();
    for (const [method, path] of [
      ['GET', '/api/tasks/nope'],
      ['POST', '/api/tasks/nope/messages'],
      ['POST', '/api/tasks/nope/close'],
      ['POST', '/api/tasks/nope/retry'],
      ['GET', '/api/tasks/nope/diff'],
    ] as const) {
      const r = await a.request(path, { method, headers: h, body: method === 'POST' ? '{"message":"x"}' : undefined });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    expect((await a.request('/api/khong-co', { headers: h })).status).toBe(404);
  });

  it('GET /api/providers và /api/config', async () => {
    const { a, store } = app();
    store.upsertProvider({ id: 'fake-a', cooldownUntil: null, usedPercent: 12, installed: true, version: 'v', updatedAt: 1 });
    const p = (await (await a.request('/api/providers', { headers: h })).json()) as Array<{ id: string }>;
    expect(p.map((x) => x.id)).toEqual(['fake-a']);
    const cfg = (await (await a.request('/api/config', { headers: h })).json()) as { port: number };
    expect(cfg.port).toBe(DEFAULT_CONFIG.port);
    const patched = await a.request('/api/config', { method: 'PATCH', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ models: { claude: 'claude-opus-5-5' } }) });
    expect(patched.status).toBe(200);
    const updatedCfg = (await patched.json()) as { models?: Record<string, string> };
    expect(updatedCfg.models?.claude).toBe('claude-opus-5-5');
  });

  it('close, retry và diff trên task có sẵn', async () => {
    const { a, store, orchestrator } = app();
    const { task, turn } = store.createTask({
      title: 't', repoPath: repo, mode: 'head-commit', priority: null, message: 'm',
    });
    // retry khi chưa lỗi: 409
    const early = await a.request(`/api/tasks/${task.id}/retry`, { method: 'POST', headers: h });
    expect(early.status).toBe(409);
    // diff khi chưa có workspace: rỗng
    const d0 = await a.request(`/api/tasks/${task.id}/diff`, { headers: h });
    expect(await d0.json()).toEqual({ status: '', diff: '', commits: [] });
    // retry sau khi lỗi
    store.updateTurn(turn.id, { status: 'failed' });
    store.updateTask(task.id, { status: 'failed' });
    const bad = await a.request(`/api/tasks/${task.id}/retry`, {
      method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"switchProvider":"có"}',
    });
    expect(bad.status).toBe(400);
    const retried = await a.request(`/api/tasks/${task.id}/retry`, {
      method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"switchProvider":false}',
    });
    expect(retried.status).toBe(204);
    expect(['queued', 'running']).toContain(store.getTask(task.id)?.status); // kick() có thể đã khởi động lượt
    // close
    const closed = await a.request(`/api/tasks/${task.id}/close`, { method: 'POST', headers: h });
    expect(closed.status).toBe(204);
    expect(store.getTask(task.id)?.status).toBe('closed');
    await orchestrator.idle();
  });


  it("chặn CSRF: POST cần Origin trống hoặc trùng localhost/127.0.0.1 cùng cổng, và Content-Type JSON", async () => {
    const { a } = app();
    const post = (headers: Record<string, string>, body = JSON.stringify({ repoPath: repo, message: "x" })) =>
      a.request("/api/tasks", { method: "POST", headers: { ...h, "content-type": "application/json", ...headers }, body });
    // Origin lạ, kể cả localhost khác cổng: 403 tiếng Việt
    for (const origin of ["http://localhost:3000", "http://evil.example", "null"]) {
      const r = await post({ origin, host: "localhost:4717" });
      expect(r.status, origin).toBe(403);
      expect(((await r.json()) as { error: string }).error).toMatch(/Origin/);
    }
    // Origin khớp trang web (cùng cổng) hoặc không có Origin: 201
    expect((await post({ origin: "http://localhost:4717", host: "localhost:4717" })).status).toBe(201);
    expect((await post({ origin: "http://127.0.0.1:4717", host: "127.0.0.1:4717" })).status).toBe(201);
    expect((await post({ host: "localhost:4717" })).status).toBe(201);
    // text/plain (form/no-cors đơn giản): 415 tiếng Việt
    const plain = await post({ "content-type": "text/plain" });
    expect(plain.status).toBe(415);
    expect(((await plain.json()) as { error: string }).error).toMatch(/application\/json/);
    // POST không body (close/retry) không cần Content-Type nhưng vẫn bị kiểm Origin
    expect((await a.request('/api/tasks/nope/close', { method: 'POST', headers: { ...h, origin: 'http://localhost:3000' } })).status).toBe(403);
    // GET từ mọi Origin không bị ảnh hưởng
    expect((await a.request("/api/tasks", { headers: { ...h, origin: "http://evil.example" } })).status).toBe(200);
  });

  it('POST /api/shutdown cần khóa và gọi onShutdown', async () => {
    const { a, shutdowns } = app();
    expect((await a.request('/api/shutdown', { method: 'POST' })).status).toBe(401);
    expect(shutdowns()).toBe(0);
    expect((await a.request('/api/shutdown', { method: 'POST', headers: h })).status).toBe(204);
    await until(() => shutdowns() === 1, 'onShutdown');
  });

  it('POST /api/shutdown nhận body {"force":true} tùy chọn; body sai thì 400', async () => {
    const { a, calls } = app();
    const json = { ...h, 'content-type': 'application/json' };
    expect((await a.request('/api/shutdown', { method: 'POST', headers: json, body: JSON.stringify({ force: true }) })).status).toBe(204);
    await until(() => calls.length === 1, 'onShutdown force');
    expect(calls[0]).toEqual({ force: true });
    expect((await a.request('/api/shutdown', { method: 'POST', headers: json, body: '{' })).status).toBe(400);
    expect((await a.request('/api/shutdown', { method: 'POST', headers: { ...h, 'content-type': 'text/plain' }, body: '{"force":true}' })).status).toBe(415);
  });

  it('POST /api/shutdown không body thì force=false', async () => {
    const { a, calls } = app();
    expect((await a.request('/api/shutdown', { method: 'POST', headers: h })).status).toBe(204);
    await until(() => calls.length === 1, 'onShutdown');
    expect(calls[0]).toEqual({ force: false });
  });
});

describe('GET /api/projects', () => {
  function appWith(withCatalog: boolean) {
    const store = openStore(':memory:');
    stores.push(store);
    const bus = new EventBus();
    const orchestrator = createOrchestrator({
      store, bus, adapters: fakeAdapters(), config: { ...DEFAULT_CONFIG, dataDir, priority: ['fake-a'] },
    });
    const pa = join(root, 'proj-a');
    const pb = join(root, 'proj-b');
    mkdirSync(pa);
    mkdirSync(pb);
    const calls = { n: 0 };
    const projects = createProjectCatalog({
      sources: [async () => {
        calls.n += 1;
        return [
          { path: pa, lastUsedAt: 1_000, source: 'claude' as const },
          { path: pb, lastUsedAt: 2_000, source: 'antigravity' as const },
        ];
      }],
      store, dataDir, home: join(root, 'uhome'), tmpDirs: [],
      runGit: async () => null,
    });
    const a = createServer({
      orchestrator, store, bus, key: KEY, webDir: null, ...(withCatalog ? { projects } : {}),
    });
    return { a, calls, pa, pb };
  }
  const h = { 'x-voragent-key': KEY };

  it('401 khi thiếu khóa', async () => {
    const { a } = appWith(true);
    expect((await a.request('/api/projects')).status).toBe(401);
  });

  it('200 với danh sách đúng và thứ tự dùng gần nhất trước', async () => {
    const { a, pa, pb } = appWith(true);
    const r = await a.request('/api/projects', { headers: h });
    expect(r.status).toBe(200);
    const list = (await r.json()) as Array<{ path: string; name: string; sources: Array<{ source: string }> }>;
    expect(list.map((p) => p.name)).toEqual(['proj-b', 'proj-a']);
    expect(list.map((p) => p.path)).toEqual([pb, pa]);
    expect(list[0]?.sources.map((s) => s.source)).toEqual(['antigravity']);
  });

  it('?refresh=1 gọi lại các nguồn, không có thì dùng bộ nhớ đệm', async () => {
    const { a, calls } = appWith(true);
    await a.request('/api/projects', { headers: h });
    await a.request('/api/projects', { headers: h });
    expect(calls.n).toBe(1);
    await a.request('/api/projects?refresh=1', { headers: h });
    expect(calls.n).toBe(2);
  });

  it('không truyền projects thì trả []', async () => {
    const { a } = appWith(false);
    const r = await a.request('/api/projects', { headers: h });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it('Host không hợp lệ bị 403; Host localhost và Origin lạ trên GET vẫn theo luật cũ', async () => {
    const { a } = appWith(true);
    expect((await a.request('/api/projects', { headers: { ...h, host: 'evil.example.com' } })).status).toBe(403);
    expect((await a.request('/api/projects', { headers: { ...h, host: 'localhost:4717' } })).status).toBe(200);
    expect((await a.request('/api/projects', { headers: { ...h, origin: 'http://evil.example.com' } })).status).toBe(200);
    expect((await a.request('/api/projects', { method: 'POST', headers: { ...h, origin: 'http://evil.example.com' } })).status).toBe(403);
  });
});

describe('startDaemon (socket thật)', () => {
  it('ghi daemon.json {port,key,pid}, có khóa dài 48 hex, stop() giải phóng cổng và xóa file', async () => {
    const d = await daemon();
    const info = JSON.parse(readFileSync(join(dataDir, 'daemon.json'), 'utf8')) as Record<string, unknown>;
    expect(info).toEqual({ port: d.port, key: d.key, pid: process.pid });
    expect(d.key).toMatch(/^[0-9a-f]{48}$/);
    expect(d.url).toBe(`http://127.0.0.1:${d.port}/?key=${d.key}`);

    expect((await fetch(`${base(d)}/api/tasks`)).status).toBe(401);
    const ok = await fetch(`${base(d)}/api/tasks`, authed(d));
    expect(ok.status).toBe(200);
    expect(Array.isArray(await ok.json())).toBe(true);

    await d.stop();
    await d.stop(); // gọi hai lần vẫn an toàn
    expect(existsSync(join(dataDir, 'daemon.json'))).toBe(false);
    await expect(fetch(`${base(d)}/api/tasks`)).rejects.toThrow();
    // cổng đã trống: dựng lại được trên cùng cổng
    const again = await startDaemon({ dataDir, port: d.port, adapters: fakeAdapters() });
    daemons.push(again);
    expect(again.port).toBe(d.port);
  });

  it('từ chối Host lạ trên socket thật', async () => {
    const d = await daemon();
    const status = await new Promise<number>((res, rej) => {
      const req = httpRequest(
        {
          host: '127.0.0.1', port: d.port, path: '/api/tasks',
          headers: { host: 'evil.example.com', 'x-voragent-key': d.key },
        },
        (resp) => { resp.resume(); res(resp.statusCode ?? 0); },
      );
      req.once('error', rej);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('không chạy daemon thứ hai khi daemon đầu còn sống', async () => {
    const d = await daemon();
    await expect(
      startDaemon({ dataDir, port: await freePort(), adapters: fakeAdapters() }),
    ).rejects.toThrow(/Daemon đã chạy/);
    // daemon đầu không bị ảnh hưởng
    expect(JSON.parse(readFileSync(join(dataDir, 'daemon.json'), 'utf8')).key).toBe(d.key);
    expect((await fetch(`${base(d)}/api/tasks`, authed(d))).status).toBe(200);
  });

  it('daemon.json cũ (pid đã chết) bị ghi đè', async () => {
    const dead = spawn.sync(process.execPath, ['-e', '0']);
    expect(dead.status).toBe(0);
    // pid rất lớn, gần như chắc chắn không tồn tại
    writeFileSync(join(dataDir, 'daemon.json'), JSON.stringify({ port: 1, key: 'cu', pid: 2_000_000_000 }));
    const d = await daemon();
    const info = JSON.parse(readFileSync(join(dataDir, 'daemon.json'), 'utf8')) as { key: string; pid: number };
    expect(info.key).toBe(d.key);
    expect(info.pid).toBe(process.pid);
  });

  it('cổng đang bận thì báo lỗi tiếng Việt và không để lại daemon.json', async () => {
    const port = await freePort();
    const blocker = createNetServer();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));
    try {
      await expect(startDaemon({ dataDir, port, adapters: fakeAdapters() })).rejects.toThrow(/Cổng .* đang được dùng/);
      expect(existsSync(join(dataDir, 'daemon.json'))).toBe(false);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });


  it('cổng bận: lỗi nhanh, chưa recover/start nên không có lượt agent nào chạy', async () => {
    // Seed: một task đang "running" với run dở trong dataDir; recover() sẽ ghi sự kiện nếu chạy.
    const seed = openStore(join(dataDir, 'voragent.db'));
    const { task } = seed.createTask({ title: 't', repoPath: repo, mode: 'head-commit', priority: null, message: 'm' });
    const run = seed.createRun({ taskId: task.id, provider: 'fake-a', handoff: null });
    seed.updateTask(task.id, { status: 'running' });
    const before = seed.eventsOf(task.id).length;
    seed.close();

    const calls: string[] = [];
    const spy = createFakeAdapter({ id: 'fake-a', fixture: fx('fake-ok.jsonl') });
    const adapters = new Map<ProviderId, Adapter>([['fake-a', {
      id: 'fake-a',
      detect: () => { calls.push('detect'); return spy.detect(); },
      invocation: (i) => { calls.push('invocation'); return spy.invocation(i); },
      createParser: () => spy.createParser(),
    }]]);

    const port = await freePort();
    const blocker = createNetServer();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));
    try {
      const t0 = Date.now();
      await expect(startDaemon({ dataDir, port, adapters })).rejects.toThrow(/Cổng .* đang được dùng/);
      expect(Date.now() - t0).toBeLessThan(5_000);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
    expect(calls).toEqual([]); // không detect, không chạy lượt nào
    const check = openStore(join(dataDir, 'voragent.db'));
    try {
      expect(check.eventsOf(task.id)).toHaveLength(before); // recover() chưa chạy
      expect(check.runsOf(task.id).find((r) => r.id === run.id)?.status).toBe('running');
      expect(check.getTask(task.id)?.status).toBe('running');
    } finally {
      check.close();
    }
  });

  it('tạo adapter ném lỗi thì không rò handle DB (xóa được dataDir ngay)', async () => {
    await expect(startDaemon({
      dataDir,
      port: await freePort(),
      adapters: () => { throw new Error('adapter hỏng'); },
    })).rejects.toThrow(/adapter hỏng/);
    rmSync(dataDir, { recursive: true, force: false }); // trên Windows sẽ EBUSY nếu DB còn mở
    expect(existsSync(dataDir)).toBe(false);
  });

  it('POST /api/shutdown luôn nhận được 204 (lặp 20 lần, không bị ngắt kết nối giữa chừng)', async () => {
    for (let i = 0; i < 20; i++) {
      const dir = join(root, `loop-${i}`);
      mkdirSync(dir);
      const d = await withFreePort((port) => startDaemon({ dataDir: dir, port, adapters: fakeAdapters() }));
      try {
        const r = await fetch(`${base(d)}/api/shutdown`, authed(d, { method: 'POST' }));
        expect(r.status, `lần ${i}`).toBe(204);
        await d.closed;
      } finally {
        await d.stop();
      }
    }
  }, 60_000);

  it('POST /api/shutdown dừng daemon và xóa daemon.json', async () => {
    const d = await daemon();
    expect((await fetch(`${base(d)}/api/shutdown`, { method: 'POST' })).status).toBe(401);
    const r = await fetch(`${base(d)}/api/shutdown`, authed(d, { method: 'POST' }));
    expect(r.status).toBe(204);
    await d.closed;
    expect(existsSync(join(dataDir, 'daemon.json'))).toBe(false);
    await expect(fetch(`${base(d)}/api/tasks`)).rejects.toThrow();
  });

  it('POST /api/shutdown {"force":true} dừng nhanh daemon đang có lượt dài; lượt được xếp lại', async () => {
    const d = await daemon('fake-tree.jsonl');
    const res = await fetch(`${base(d)}/api/tasks`, authed(d, {
      method: 'POST', body: JSON.stringify({ repoPath: repo, message: 'việc dài' }),
    }));
    const task = (await res.json()) as Task;
    const ws = await until(async () => {
      const r = await fetch(`${base(d)}/api/tasks/${task.id}`, authed(d));
      const t = ((await r.json()) as { task: Task }).task;
      return t.workspacePath && existsSync(join(t.workspacePath, '.fake-grandchild.pid')) ? t.workspacePath : undefined;
    }, 'lượt dài đã chạy');
    expect(ws).toBeTruthy();
    const t0 = Date.now();
    const r = await fetch(`${base(d)}/api/shutdown`, authed(d, { method: 'POST', body: JSON.stringify({ force: true }) }));
    expect(r.status).toBe(204);
    await d.closed;
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(existsSync(join(dataDir, 'daemon.json'))).toBe(false);
    const check = openStore(join(dataDir, 'voragent.db'));
    try {
      expect(check.getTask(task.id)?.status).toBe('queued');
      expect(check.turnsOf(task.id)[0]?.status).toBe('queued');
      expect(check.runsOf(task.id).map((x) => x.status)).toEqual(['interrupted']);
    } finally {
      check.close();
    }
  }, 60_000);

  it('POST /api/tasks → 201; WebSocket nhận HELLO, TASK_CREATED, TURN_STARTED, TURN_FINISHED theo thứ tự', async () => {
    const d = await daemon();
    const msgs: Array<{ type: string }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${d.port}/api/events?key=${d.key}`);
    ws.on('message', (m) => msgs.push(JSON.parse(m.toString()) as { type: string }));
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    await until(() => msgs.length > 0, 'HELLO');

    const res = await fetch(`${base(d)}/api/tasks`, authed(d, {
      method: 'POST', body: JSON.stringify({ repoPath: repo, message: 'làm gì đó' }),
    }));
    expect(res.status).toBe(201);
    const task = (await res.json()) as Task;
    expect(task.seq).toBe(1);

    await until(() => msgs.some((m) => m.type === 'TURN_FINISHED'), 'TURN_FINISHED');
    ws.close();
    const types = msgs.map((m) => m.type);
    const idx = ['HELLO', 'TASK_CREATED', 'TURN_STARTED', 'TURN_FINISHED'].map((t) => types.indexOf(t));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
    expect(idx[0]).toBe(0);

    // chi tiết task, rồi gửi tin nhắn tiếp, rồi diff, rồi đóng
    await until(async () => (await getTask(d, task.id)).task.status === 'awaiting_user', 'awaiting_user');
    const detail = await getTask(d, task.id);
    expect(detail.turns).toHaveLength(1);
    expect(detail.runs).toHaveLength(1);
    expect(detail.events.length).toBeGreaterThan(0);

    const diff = await fetch(`${base(d)}/api/tasks/${task.id}/diff`, authed(d));
    expect(diff.status).toBe(200);
    expect(Object.keys((await diff.json()) as object).sort()).toEqual(['commits', 'diff', 'status']);

    const msg = await fetch(`${base(d)}/api/tasks/${task.id}/messages`, authed(d, {
      method: 'POST', body: JSON.stringify({ message: 'tiếp' }),
    }));
    expect(msg.status).toBe(201);
    expect(((await msg.json()) as { index: number }).index).toBe(1);
    await until(async () => (await getTask(d, task.id)).task.status === 'awaiting_user'
      && (await getTask(d, task.id)).turns.length === 2
      && (await getTask(d, task.id)).turns.every((t) => t.status === 'done'), 'lượt 2 xong');

    const closed = await fetch(`${base(d)}/api/tasks/${task.id}/close`, authed(d, { method: 'POST' }));
    expect(closed.status).toBe(204);
    expect((await getTask(d, task.id)).task.status).toBe('closed');
  });

  it('POST /messages khi task đang chạy → 409', async () => {
    const d = await daemon('fake-sleep.jsonl');
    const res = await fetch(`${base(d)}/api/tasks`, authed(d, {
      method: 'POST', body: JSON.stringify({ repoPath: repo, message: 'chạy lâu' }),
    }));
    const task = (await res.json()) as Task;
    await until(async () => (await getTask(d, task.id)).task.status === 'running', 'running');
    const r = await fetch(`${base(d)}/api/tasks/${task.id}/messages`, authed(d, {
      method: 'POST', body: JSON.stringify({ message: 'chen ngang' }),
    }));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/không nhận tin nhắn/);
  });

  it('WebSocket bị từ chối khi thiếu khóa, Origin lạ hoặc Host lạ', async () => {
    const d = await daemon();
    const attempt = (url: string, headers: Record<string, string> = {}): Promise<'open' | number> =>
      new Promise((res) => {
        const w = new WebSocket(url, { headers });
        w.once('open', () => { w.close(); res('open'); });
        w.once('unexpected-response', (_req, resp) => { res(resp.statusCode ?? 0); w.terminate(); });
        w.once('error', () => res(0));
      });
    const u = `ws://127.0.0.1:${d.port}/api/events`;
    expect(await attempt(u)).toBe(401);
    expect(await attempt(`${u}?key=nope`)).toBe(401);
    expect(await attempt(`${u}?key=${d.key}`, { Origin: 'http://evil.example.com' })).toBe(403);
    expect(await attempt(`${u}?key=${d.key}`, { Host: 'evil.example.com' })).toBe(403);
    expect(await attempt(`${u}?key=${d.key}`, { Origin: `http://127.0.0.1:${d.port}` })).toBe('open');
    expect(await attempt(`${u}?key=${d.key}`)).toBe('open');
  });

  it('WebSocket nhận khóa từ cookie voragent_key (trình duyệt không đọc được cookie HttpOnly)', async () => {
    const d = await daemon();
    const origin = `http://127.0.0.1:${d.port}`;
    const url = `ws://127.0.0.1:${d.port}/api/events`; // không có ?key=
    const ws = new WebSocket(url, { headers: { Cookie: `voragent_key=${d.key}`, Origin: origin } });
    const got: Array<{ type: string }> = [];
    ws.on('message', (m) => got.push(JSON.parse(m.toString()) as { type: string }));
    await until(() => got.length > 0, 'HELLO qua cookie');
    expect(got[0]?.type).toBe('HELLO');
    ws.close();

    const attempt = (headers: Record<string, string>): Promise<'open' | number> =>
      new Promise((res) => {
        const w = new WebSocket(url, { headers });
        w.once('open', () => { w.close(); res('open'); });
        w.once('unexpected-response', (_req, resp) => { res(resp.statusCode ?? 0); w.terminate(); });
        w.once('error', () => res(0));
      });
    expect(await attempt({ Origin: origin })).toBe(401); // không khóa, không cookie
    expect(await attempt({ Origin: origin, Cookie: 'voragent_key=sai' })).toBe(401);
    expect(await attempt({ Origin: 'http://evil.example.com', Cookie: `voragent_key=${d.key}` })).toBe(403);
  });

  it('VORAGENT_FAKE=1: hai adapter giả, fake-a hết quota thì fake-b làm tiếp (qua API)', async () => {
    rmSync(join(dataDir, 'config.json'), { force: true }); // không đặt priority: hook tự đặt fake-a, fake-b
    const prev = process.env.VORAGENT_FAKE;
    process.env.VORAGENT_FAKE = '1';
    try {
      const d = await withFreePort((port) => startDaemon({ dataDir, port }));
      daemons.push(d);
      const res = await fetch(`${base(d)}/api/tasks`, authed(d, {
        method: 'POST', body: JSON.stringify({ repoPath: repo, message: 'thử bàn giao' }),
      }));
      expect(res.status).toBe(201);
      const task = (await res.json()) as Task;
      await until(async () => (await getTask(d, task.id)).task.status === 'awaiting_user', 'awaiting_user');
      const detail = await getTask(d, task.id);
      const events = detail.events as VEvent[];
      const handoff = events.find((e) => e.type === 'HANDOFF');
      expect(handoff?.data).toEqual({ from: 'fake-a', to: 'fake-b' });
      expect((detail.runs as Array<{ provider: string; status: string }>).map((r) => [r.provider, r.status]))
        .toEqual([['fake-a', 'quota_exhausted'], ['fake-b', 'completed']]);
      const providers = (await (await fetch(`${base(d)}/api/providers`, authed(d))).json()) as Array<
        { id: string; cooldownUntil: number | null }
      >;
      const a = providers.find((p) => p.id === 'fake-a');
      expect(a?.cooldownUntil).toBeGreaterThan(Date.now());
      expect(providers.find((p) => p.id === 'fake-b')?.cooldownUntil ?? null).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.VORAGENT_FAKE;
      else process.env.VORAGENT_FAKE = prev;
    }
  });

  it('stop() đóng cả kết nối WebSocket đang mở', async () => {
    const d = await daemon();
    const ws = new WebSocket(`ws://127.0.0.1:${d.port}/api/events?key=${d.key}`);
    const got: VEvent[] = [];
    ws.on('message', (m) => got.push(JSON.parse(m.toString()) as VEvent));
    await until(() => got.length > 0, 'HELLO');
    const closedWs = new Promise<void>((r) => ws.once('close', () => r()));
    await d.stop();
    await closedWs;
  });
});

async function getTask(d: Daemon, id: string): Promise<{
  task: Task; turns: Array<{ status: string }>; runs: unknown[]; events: unknown[];
}> {
  const r = await fetch(`${base(d)}/api/tasks/${id}`, authed(d));
  return (await r.json()) as never;
}

describe('startDaemon: cô lập thư mục người dùng', () => {
  function writeAg(appRoot: string, name: string, folderPath: string): void {
    const dir = join(appRoot, 'Antigravity', 'User', 'workspaceStorage', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(folderPath).href }));
  }

  
  it('preview static endpoint phục vụ tệp trong workspace và PATCH cập nhật model', async () => {
    writeFileSync(join(repo, 'index.html'), '<h1>Xin chao</h1>');
    const d = await withFreePort((port) =>
      startDaemon({ dataDir, port, adapters: fakeAdapters(), projectTmpDirs: [] }),
    );
    daemons.push(d);
    const taskRes = await fetch(
      `${base(d)}/api/tasks`,
      authed(d, {
        method: 'POST',
        body: JSON.stringify({ repoPath: repo, message: 'test preview', mode: 'dirty-nocommit' }),
      }),
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as Task;
    const prevRes = await fetch(`${base(d)}/api/tasks/${task.id}/preview/index.html`, authed(d));
    expect(prevRes.status).toBe(200);
    expect(await prevRes.text()).toBe('<h1>Xin chao</h1>');
    expect(prevRes.headers.get('content-type')).toContain('text/html');

    // Cập nhật model bằng PATCH
    const patchRes = await fetch(
      `${base(d)}/api/tasks/${task.id}`,
      authed(d, {
        method: 'PATCH',
        body: JSON.stringify({ model: 'claude-3-5-haiku' }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const updatedTask = (await patchRes.json()) as Task;
    expect(updatedTask.model).toBe('claude-3-5-haiku');
  });

  it('userHome được ghi đè thì không đọc APPDATA thật', async () => {
    const mine = join(root, 'mine');
    const decoy = join(root, 'decoy');
    mkdirSync(mine);
    mkdirSync(decoy);
    const fakeHome = join(root, 'fakehome');
    const otherApp = join(root, 'otherapp');
    mkdirSync(fakeHome);
    writeAg(join(fakeHome, 'AppData', 'Roaming'), 'a', mine);
    writeAg(otherApp, 'b', decoy);
    const oldApp = process.env.APPDATA;
    process.env.APPDATA = otherApp;
    try {
      const d = await withFreePort((port) =>
        startDaemon({ dataDir, port, adapters: fakeAdapters(), userHome: fakeHome, projectTmpDirs: [] }),
      );
      daemons.push(d);
      const r = await fetch(`${base(d)}/api/projects?refresh=1`, authed(d));
      const list = (await r.json()) as Array<{ path: string }>;
      expect(list.map((p) => p.path)).toEqual([realpathSync.native(mine)]);
    } finally {
      if (oldApp === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = oldApp;
    }
  });

  it('không truyền userHome/projectSources: môi trường test trỏ tới home tạm của globalSetup', async () => {
    const home = process.env.VORAGENT_USER_HOME;
    expect(home).toBeTruthy();
    expect(realpathSync.native(home!).toLowerCase()).not.toBe(realpathSync.native(homedir()).toLowerCase());
    const proj = join(root, 'viahome');
    mkdirSync(proj);
    writeFileSync(join(home!, '.claude.json'), JSON.stringify({ projects: { [proj]: {} } }));
    try {
      const d = await withFreePort((port) =>
        startDaemon({ dataDir, port, adapters: fakeAdapters(), projectTmpDirs: [] }),
      );
      daemons.push(d);
      const list = (await (await fetch(`${base(d)}/api/projects?refresh=1`, authed(d))).json()) as Array<{ path: string }>;
      expect(list.map((p) => p.path)).toEqual([realpathSync.native(proj)]);
    } finally {
      rmSync(join(home!, '.claude.json'), { force: true });
    }
  });
});
