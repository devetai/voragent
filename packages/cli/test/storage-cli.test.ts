import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import type { CliContext } from '../src/cli.js';

describe('CLI storage, prune, and migrate commands', () => {
  let root: string;
  let home: string;
  let outBuf: string;
  let errBuf: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'voragent-cli-test-'));
    home = join(root, '.voragent');
    mkdirSync(home, { recursive: true });
    outBuf = '';
    errBuf = '';
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const makeCtx = (over: Partial<CliContext> = {}): CliContext => ({
    dataDir: home,
    cwd: root,
    home: root,
    out: (s) => { outBuf += s; },
    err: (s) => { errBuf += s; },
    entry: 'main.js',
    ...over,
  });

  it('voragent storage outputs breakdown and location', async () => {
    mkdirSync(join(home, 'worktrees', 'orphan-1'), { recursive: true });
    writeFileSync(join(home, 'worktrees', 'orphan-1', 'test.txt'), 'hello');
    writeFileSync(join(home, 'daemon.log'), 'test-log');

    const code = await runCli(['storage'], makeCtx());
    expect(code).toBe(0);
    expect(outBuf).toContain('Thư mục dữ liệu:');
    expect(outBuf).toContain('Tổng dung lượng đang dùng:');
    expect(outBuf).toContain('Worktrees:');
  });

  it('voragent prune cleans orphans and truncates logs', async () => {
    mkdirSync(join(home, 'worktrees', 'orphan-2'), { recursive: true });
    writeFileSync(join(home, 'worktrees', 'orphan-2', 'a.js'), 'console.log(1)');
    const logPath = join(home, 'daemon.log');
    writeFileSync(logPath, 'some logs');

    const code = await runCli(['prune', '--logs', '--vacuum'], makeCtx());
    expect(code).toBe(0);
    expect(outBuf).toContain('Đã dọn dẹp thành công!');
    expect(existsSync(join(home, 'worktrees', 'orphan-2'))).toBe(false);
    expect(readFileSync(logPath, 'utf8')).toBe('');
  });

  it('voragent migrate moves data to a new target directory', async () => {
    mkdirSync(join(home, 'worktrees', 'orphan-3'), { recursive: true });
    writeFileSync(join(home, 'config.json'), JSON.stringify({ port: 4999 }));
    writeFileSync(join(home, 'worktrees', 'orphan-3', 'sample.txt'), 'migrated data');

    const newTarget = join(root, 'new-data-location');
    const code = await runCli(['migrate', newTarget], makeCtx());
    expect(code).toBe(0);
    expect(outBuf).toContain('Đã di chuyển thành công dữ liệu');
    expect(existsSync(join(newTarget, 'config.json'))).toBe(true);
    expect(existsSync(join(newTarget, 'worktrees', 'orphan-3', 'sample.txt'))).toBe(true);
  });
});
