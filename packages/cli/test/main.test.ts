import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import spawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeAdapter } from '@voragent/adapters';
import type { Adapter } from '@voragent/adapters';
import { startDaemon } from '@voragent/core';
import type { Daemon } from '@voragent/core';
import type { ProviderId } from '@voragent/shared';
import { freePort, until, withFreePort } from './helpers.js';
import { formatStatus, NO_DAEMON, runCli } from '../src/cli.js';
import type { CliContext } from '../src/cli.js';

const fx = (name: string): string => resolve(import.meta.dirname, '../../adapters/test/fixtures', name);
const readText = (p: string): string => readFileSync(p, 'utf8');
const MAIN = resolve(import.meta.dirname, '../dist/src/main.js');

function git(cwd: string, args: string[]): void {
  const r = spawn.sync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}


let root: string;
let home: string;
let repo: string;
let outBuf: string;
let errBuf: string;
const daemons: Daemon[] = [];
const foreground: Array<Promise<number>> = [];

const adapters = (): Map<ProviderId, Adapter> =>
  new Map([['fake-a', createFakeAdapter({ id: 'fake-a', fixture: fx('fake-ok.jsonl') })]]);

const ctx = (over: Partial<CliContext> = {}): CliContext => ({
  dataDir: home,
  cwd: root,
  out: (s) => { outBuf += s; },
  err: (s) => { errBuf += s; },
  entry: MAIN,
  adapters: adapters(),
  openBrowser: () => undefined,
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voragent-cli-'));
  home = join(root, 'home');
  repo = join(root, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  outBuf = '';
  errBuf = '';
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, 'a.txt'), 'x\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ priority: ['fake-a'] }));
});

afterEach(async () => {
  // Mọi daemon (kể cả chạy trong runCli hoặc tiến trình nền) phải dừng trước khi xóa thư mục.
  try {
    const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid: number; port: number; key: string };
    if (info.pid !== process.pid) {
      try {
        process.kill(info.pid);
      } catch {
        // đã chết
      }
    } else {
      await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: 'POST', headers: { 'x-voragent-key': info.key } }).catch(() => undefined);
    }
  } catch {
    // không có daemon.json
  }
  for (const p of foreground.splice(0)) {
    await Promise.race([p, new Promise((r) => setTimeout(r, 15_000))]).catch(() => undefined);
  }
  for (const d of daemons.splice(0)) await d.stop();
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
  rmSync(root, { recursive: true, force: true });
});

async function live(): Promise<Daemon> {
  const d = await withFreePort((port) => startDaemon({ dataDir: home, port, adapters: adapters() }));
  daemons.push(d);
  return d;
}

describe('voragent khi chưa có daemon', () => {
  it.each([
    [['add', '.', 'làm gì đó']],
    [['status']],
    [['stop']],
  ])('%j thoát mã 1 và in đúng thông báo', async (argv) => {
    const code = await runCli(argv, ctx());
    expect(code).toBe(1);
    expect(errBuf).toBe(`${NO_DAEMON}\n`);
    expect(NO_DAEMON).toBe('Daemon chưa chạy. Chạy: voragent');
    expect(outBuf).toBe('');
  });

  it('bản build thật (dist/src/main.js) cũng thoát mã 1 với đúng thông báo', () => {
    expect(existsSync(MAIN), 'chạy pnpm -r build trước').toBe(true);
    const r = spawn.sync(process.execPath, [MAIN, 'add', '.', 'xin chào'], {
      encoding: 'utf8', env: { ...process.env, VORAGENT_HOME: home },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(`${NO_DAEMON}\n`);
    expect(readFileSync(MAIN, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('daemon.json cũ (pid đã chết) coi như chưa chạy', async () => {
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: 1, key: 'cu', pid: 2_000_000_000 }));
    expect(await runCli(['status'], ctx())).toBe(1);
    expect(errBuf).toBe(`${NO_DAEMON}\n`);
  });

  it('lệnh không biết hoặc --port sai thì thoát mã 1', async () => {
    expect(await runCli(['bay'], ctx())).toBe(1);
    expect(errBuf).toMatch(/Lệnh không biết/);
    errBuf = '';
    expect(await runCli(['--port', 'abc'], ctx())).toBe(1);
    expect(errBuf).toMatch(/--port/);
    errBuf = '';
    expect(await runCli(['add', '.'], ctx())).toBe(1);
    expect(errBuf).toMatch(/Thiếu đối số/);
  });
});

describe('voragent với daemon đang chạy', () => {
  it('add tạo task, status liệt kê, stop dừng daemon', async () => {
    const d = await live();
    expect(await runCli(['add', repo, 'sửa', 'lỗi', 'đăng nhập', '--agent', 'fake-a', '--mode', 'head-commit'], ctx())).toBe(0);
    expect(outBuf).toBe('Đã tạo task #1: sửa lỗi đăng nhập\n');

    const tasks = (await (await fetch(`http://127.0.0.1:${d.port}/api/tasks`, { headers: { 'x-voragent-key': d.key } })).json()) as Array<{ priority: string[]; mode: string }>;
    expect(tasks[0]?.priority).toEqual(['fake-a']);
    expect(tasks[0]?.mode).toBe('head-commit');

  });

  it('status hiển thị nền tảng và task chưa đóng', async () => {
    await live();
    await runCli(['add', repo, 'việc một', '--agent', 'fake-a'], ctx());
    let text = '';
    for (let i = 0; i < 400; i++) {
      outBuf = '';
      expect(await runCli(['status'], ctx())).toBe(0);
      text = outBuf;
      if (text.includes('Chờ bạn')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(text).toContain('Nền tảng');
    expect(text).toMatch(/fake-a\s+có\s+-\s+-/);
    expect(text).toMatch(/#1\s+Chờ bạn\s+fake-a\s+việc một/);
  });

  it('add báo lỗi từ daemon (mode sai, thư mục không tồn tại) và thoát mã 1', async () => {
    await live();
    expect(await runCli(['add', repo, 'x', '--mode', 'la'], ctx())).toBe(1);
    expect(errBuf).toMatch(/mode/);
    errBuf = '';
    expect(await runCli(['add', join(root, 'khong-co'), 'x'], ctx())).toBe(1);
    expect(errBuf).toMatch(/repoPath/);
  });

  it('stop gửi /api/shutdown và daemon dừng, daemon.json biến mất', async () => {
    const d = await live();
    expect(await runCli(['stop'], ctx())).toBe(0);
    await d.closed;
    expect(existsSync(join(home, 'daemon.json'))).toBe(false);
  });
});

describe('voragent (foreground)', () => {
  /** Chạy runCli ở chế độ foreground trên cổng trống (thử lại khi cổng bị chiếm). */
  async function fg(extra: string[], over: Partial<CliContext> = {}): Promise<{ p: Promise<number>; port: number }> {
    for (let i = 0; i < 5; i++) {
      const port = await freePort();
      const before = errBuf;
      const p = runCli([...extra, '--port', String(port)], ctx(over));
      foreground.push(p);
      const state = await Promise.race([
        until(() => existsSync(join(home, 'daemon.json')), 'daemon.json xuất hiện', 15_000).then(() => 'up' as const),
        p.then(() => 'down' as const),
      ]);
      if (state === 'up') return { p, port };
      if (!/đang được dùng/.test(errBuf)) throw new Error(`Daemon foreground không lên: ${errBuf}`);
      errBuf = before;
    }
    throw new Error('Không có cổng trống cho daemon foreground.');
  }

  it('chạy daemon, in URL kèm khóa, không mở trình duyệt khi --no-open, dừng khi nhận stop', async () => {
    let opened = 0;
    const { p, port } = await fg(['--no-open'], { openBrowser: () => { opened += 1; } });
    const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { port: number; key: string };
    expect(info.port).toBe(port);
    expect(outBuf).toContain(`http://127.0.0.1:${port}/?key=${info.key}`);
    expect(opened).toBe(0);
    expect(await runCli(['stop'], ctx())).toBe(0);
    expect(await p).toBe(0);
    expect(outBuf).toContain('Đã dừng voragent');
  });

  it('không có --no-open thì gọi mở trình duyệt đúng một lần với URL đầy đủ', async () => {
    const urls: string[] = [];
    const { p, port } = await fg([], { openBrowser: (u) => { urls.push(u); } });
    await runCli(['stop'], ctx());
    await p;
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/\\?key=[0-9a-f]{48}$`));
  });

  it('báo lỗi tiếng Việt khi đã có daemon chạy', async () => {
    await live();
    expect(await runCli(['--no-open'], ctx())).toBe(1);
    expect(errBuf).toMatch(/Daemon đã chạy/);
  });
});

describe('voragent stop trung thực', () => {
  it('daemon còn lượt đang chạy: stop quá hạn chờ thì báo đang dừng và thoát mã 1', async () => {
    const d = await withFreePort((port) => startDaemon({
      dataDir: home, port,
      adapters: new Map([['fake-a', createFakeAdapter({ id: 'fake-a', fixture: fx('fake-sleep.jsonl') })]]),
    }));
    daemons.push(d);
    expect(await runCli(['add', repo, 'chạy lâu', '--agent', 'fake-a'], ctx())).toBe(0);
    const get = async () => (await (await fetch(`http://127.0.0.1:${d.port}/api/tasks`, { headers: { 'x-voragent-key': d.key } })).json()) as Array<{ status: string }>;
    await until(async () => (await get())[0]?.status === 'running', 'task chuyển sang running');
    const code = await runCli(['stop'], ctx({ stopWaitMs: 300 }));
    expect(code).toBe(1);
    expect(errBuf).toMatch(/đang dừng/);
    expect(errBuf).toMatch(/lượt đang chạy/);
    expect(outBuf).not.toContain('Đã dừng daemon.');
    expect(existsSync(join(home, 'daemon.json'))).toBe(true);
    await d.closed; // sau khi lượt xong thì daemon dừng thật
    expect(existsSync(join(home, 'daemon.json'))).toBe(false);
  });
});

describe('voragent stop --force và cảnh báo không cách ly', () => {
  it('stop --force dừng nhanh daemon đang có lượt dài và thoát mã 0', async () => {
    const d = await withFreePort((port) => startDaemon({
      dataDir: home, port,
      adapters: new Map([['fake-a', createFakeAdapter({ id: 'fake-a', fixture: fx('fake-tree.jsonl') })]]),
    }));
    daemons.push(d);
    expect(await runCli(['add', repo, 'chạy lâu', '--agent', 'fake-a'], ctx())).toBe(0);
    const get = async () => (await (await fetch(`http://127.0.0.1:${d.port}/api/tasks`, { headers: { 'x-voragent-key': d.key } })).json()) as Array<{ status: string; workspacePath: string | null }>;
    await until(async () => {
      const t = (await get())[0];
      return t?.workspacePath && existsSync(join(t.workspacePath, '.fake-grandchild.pid'));
    }, 'lượt dài đã chạy');
    const t0 = Date.now();
    expect(await runCli(['stop', '--force'], ctx({ stopWaitMs: 30_000 }))).toBe(0);
    expect(Date.now() - t0).toBeLessThan(25_000);
    await d.closed;
    expect(existsSync(join(home, 'daemon.json'))).toBe(false);
    expect(outBuf).toContain('Đã dừng daemon.');
  }, 60_000);

  it('add với thư mục không phải repo git: cảnh báo không cách ly trên stderr, vẫn thoát mã 0', async () => {
    await live();
    const plain = join(root, 'plain');
    mkdirSync(plain);
    expect(await runCli(['add', plain, 'làm gì đó', '--agent', 'fake-a'], ctx())).toBe(0);
    expect(errBuf).toMatch(/không cách ly/);
    expect(errBuf).toContain(plain);
    expect(outBuf).toMatch(/Đã tạo task/);
  });

  it('add với repo git: không cảnh báo', async () => {
    await live();
    expect(await runCli(['add', repo, 'làm gì đó', '--agent', 'fake-a'], ctx())).toBe(0);
    expect(errBuf).toBe('');
  });
});

describe('voragent start --background (tiến trình thật)', () => {
  it('chạy nền: URL do cha in, daemon.log không chứa khóa, daemon.json hợp lệ, stop dừng được', async () => {
    // Không có nền tảng nào để dò (không chạy CLI thật): chỉ kiểm vòng đời tiến trình.
    writeFileSync(join(home, 'config.json'), JSON.stringify({ priority: ['khong-co-nen-tang-nay'] }));
    let code = 1;
    for (let i = 0; i < 5; i++) {
      const port = await freePort();
      errBuf = '';
      code = await runCli(['start', '--background', '--port', String(port)], ctx({ backgroundTimeoutMs: 40_000 }));
      if (code === 0 || !/đang được dùng/.test(readText(join(home, 'daemon.log')))) break;
    }
    expect(code, errBuf).toBe(0);
    const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { port: number; key: string; pid: number };
    expect(info.key).toMatch(/^[0-9a-f]{48}$/);
    expect(typeof info.pid).toBe('number');
    expect(outBuf).toContain(`http://127.0.0.1:${info.port}/?key=${info.key}`);
    const log = readText(join(home, 'daemon.log'));
    expect(log).not.toContain(info.key);
    expect(log).not.toContain('?key=');
    if (process.platform !== 'win32') {
      expect(statSync(join(home, 'daemon.json')).mode & 0o777).toBe(0o600);
      expect(statSync(join(home, 'daemon.log')).mode & 0o777).toBe(0o600);
    }

    outBuf = '';
    expect(await runCli(['status'], ctx())).toBe(0);
    expect(outBuf).toContain('Không có task nào đang mở');
    outBuf = '';
    expect(await runCli(['start', '--background'], ctx())).toBe(0); // đã chạy: không sinh daemon mới
    expect(outBuf).toContain('Daemon đã chạy');
    expect(await runCli(['stop'], ctx({ stopWaitMs: 30_000 }))).toBe(0);
    expect(existsSync(join(home, 'daemon.json'))).toBe(false);
  }, 90_000);

  it('báo lỗi tiếng Việt khi tiến trình nền chết sớm (cổng bận)', async () => {
    const port = await freePort();
    const blocker = createNetServer();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));
    try {
      const code = await runCli(['start', '--background', '--port', String(port)], ctx({ backgroundTimeoutMs: 8_000 }));
      expect(code).toBe(1);
      expect(errBuf).toMatch(/Daemon không khởi động được/);
      expect(readFileSync(join(home, 'daemon.log'), 'utf8')).toMatch(/Cổng .* đang được dùng/);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

describe('formatStatus', () => {
  it('bảng nền tảng và task chưa đóng', () => {
    const now = new Date(2026, 10, 4, 10, 0, 0).getTime();
    const cool = new Date(2026, 10, 4, 14, 5, 0).getTime();
    const task = (seq: number, status: 'running' | 'closed', title: string, cur: string | null) => ({
      id: `t${seq}`, seq, title, repoPath: '/r', workspacePath: null, branch: null, baseCommit: null,
      mode: 'head-commit' as const, priority: null, status, currentProvider: cur, createdAt: 0, updatedAt: 0,
    });
    const out = formatStatus(
      [
        { id: 'claude', cooldownUntil: cool, usedPercent: 0.42, installed: true, version: '1', updatedAt: 0 },
        { id: 'codex', cooldownUntil: null, usedPercent: null, installed: false, version: null, updatedAt: 0 },
      ],
      [task(1, 'running', 'sửa lỗi', 'claude'), task(2, 'closed', 'đã xong', null)],
      now,
    );
    expect(out).toMatch(/claude\s+có\s+14:05\s+42%/);
    expect(out).toMatch(/codex\s+không\s+-\s+-/);
    expect(out).toMatch(/#1\s+Đang chạy\s+claude\s+sửa lỗi/);
    expect(out).not.toContain('đã xong');
  });
});
