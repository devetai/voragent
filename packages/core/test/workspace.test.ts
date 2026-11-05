import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import spawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitAll, createWorkspace, workspaceSummary } from '../src/workspace.js';

function git(cwd: string, args: string[]): string {
  const r = spawn.sync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

const BIN = Buffer.from([0, 1, 2, 255, 254, 0, 10, 13, 0, 99]);
const BIN2 = Buffer.from([9, 0, 8, 255, 0, 0, 7]);
const SPACE_NAME = 'tệp có dấu cách.txt';

let root: string;
let repo: string;
let wtDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voragent-ws-'));
  repo = join(root, 'repo');
  wtDir = join(root, 'worktrees');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, '.gitignore'), 'ignored.log\n');
  writeFileSync(join(repo, 'a.txt'), 'một\nhai\nba\n');
  writeFileSync(join(repo, 'b.bin'), BIN);
  writeFileSync(join(repo, 'c.bin'), BIN);
  writeFileSync(join(repo, 'staged.txt'), 'staged-old\n');
  writeFileSync(join(repo, 'del.txt'), 'xoá\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
});

afterEach(() => {
  const r = spawn.sync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  if (r.status === 0) {
    for (const line of r.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        const p = line.slice(9).trim();
        if (p.replace(/\\/g, '/') !== repo.replace(/\\/g, '/')) {
          spawn.sync('git', ['worktree', 'remove', '--force', p], { cwd: repo });
        }
      }
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function makeDirty(): void {
  writeFileSync(join(repo, 'a.txt'), 'một\nhai (sửa)\nba\n');
  writeFileSync(join(repo, 'new.txt'), 'mới\n');
  writeFileSync(join(repo, SPACE_NAME), 'nội dung\n');
  mkdirSync(join(repo, 'sub dir'));
  writeFileSync(join(repo, 'sub dir', 'new.bin'), BIN2);
  writeFileSync(join(repo, 'ignored.log'), 'bỏ qua\n');
  writeFileSync(join(repo, 'c.bin'), BIN2); // modified binary
  git(repo, ['rm', '-q', 'b.bin']); // staged delete
  writeFileSync(join(repo, 'staged.txt'), 'staged-new\n');
  git(repo, ['add', 'staged.txt']); // staged change
  rmSync(join(repo, 'del.txt')); // unstaged delete
}

const snapshot = (): { status: string; files: Record<string, string> } => ({
  status: git(repo, ['status', '--short']),
  files: Object.fromEntries(
    ['a.txt', 'new.txt', SPACE_NAME, 'ignored.log', 'c.bin', 'staged.txt'].map((f) => [
      f,
      existsSync(join(repo, f)) ? readFileSync(join(repo, f)).toString('hex') : 'MISSING',
    ]),
  ),
});

describe('createWorkspace', () => {
  it('head-dirty-commit carries every kind of dirty state and leaves the original repo untouched', async () => {
    makeDirty();
    const before = snapshot();
    const baseBefore = git(repo, ['rev-parse', 'HEAD']).trim();
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 7, mode: 'head-dirty-commit' });
    expect(snapshot()).toEqual(before);
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(baseBefore);

    expect(ws.isolated).toBe(true);
    expect(ws.branch).toBe('voragent/task-7');
    expect(ws.baseCommit).toBe(baseBefore);
    expect(ws.path).toBe(join(wtDir, 'task-7'));
    expect(readFileSync(join(ws.path, 'a.txt'), 'utf8')).toBe('một\nhai (sửa)\nba\n');
    expect(readFileSync(join(ws.path, 'new.txt'), 'utf8')).toBe('mới\n');
    expect(readFileSync(join(ws.path, SPACE_NAME), 'utf8')).toBe('nội dung\n');
    expect(readFileSync(join(ws.path, 'sub dir', 'new.bin')).equals(BIN2)).toBe(true);
    expect(readFileSync(join(ws.path, 'c.bin')).equals(BIN2)).toBe(true);
    expect(readFileSync(join(ws.path, 'staged.txt'), 'utf8')).toBe('staged-new\n');
    expect(existsSync(join(ws.path, 'b.bin'))).toBe(false);
    expect(existsSync(join(ws.path, 'del.txt'))).toBe(false);
    expect(existsSync(join(ws.path, 'ignored.log'))).toBe(false);

    // dirty state is committed on the worktree branch, separate from the base
    expect(git(ws.path, ['status', '--short'])).toBe('');
    expect(git(ws.path, ['log', '-1', '--format=%s']).trim()).toBe('voragent: mang theo thay đổi chưa commit');
    expect(git(ws.path, ['rev-parse', 'HEAD']).trim()).not.toBe(baseBefore);
  });

  it('dirty-nocommit carries the dirty state but leaves it uncommitted', async () => {
    makeDirty();
    const before = snapshot();
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 2, mode: 'dirty-nocommit' });
    expect(snapshot()).toEqual(before);
    expect(git(ws.path, ['rev-parse', 'HEAD']).trim()).toBe(ws.baseCommit);
    expect(readFileSync(join(ws.path, SPACE_NAME), 'utf8')).toBe('nội dung\n');
    expect(existsSync(join(ws.path, 'b.bin'))).toBe(false);
    expect(git(ws.path, ['status', '--short'])).not.toBe('');
  });

  it('head-dirty-commit on a clean repo makes no extra commit', async () => {
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 3, mode: 'head-dirty-commit' });
    expect(git(ws.path, ['rev-parse', 'HEAD']).trim()).toBe(ws.baseCommit);
  });

  it('head-commit carries no dirty files', async () => {
    makeDirty();
    const before = snapshot();
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 7, mode: 'head-commit' });
    expect(snapshot()).toEqual(before);
    expect(ws.branch).toBe('voragent/task-7');
    expect(readFileSync(join(ws.path, 'a.txt'), 'utf8')).toBe('một\nhai\nba\n');
    expect(existsSync(join(ws.path, 'new.txt'))).toBe(false);
    expect(existsSync(join(ws.path, 'b.bin'))).toBe(true);
  });

  it('non-git folder is not isolated and creates nothing', async () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    const ws = await createWorkspace({ repoPath: plain, worktreesDir: wtDir, taskSeq: 1, mode: 'head-dirty-commit' });
    expect(ws).toEqual({ path: plain, branch: null, baseCommit: null, isolated: false });
    expect(existsSync(wtDir)).toBe(false);
    expect(await commitAll(ws, 'x')).toBeNull();
    expect(await workspaceSummary(ws)).toEqual({ status: '', diff: '', commits: [] });
  });

  it('repo without commits fails with a clear Vietnamese error', async () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    git(empty, ['init', '-q']);
    await expect(
      createWorkspace({ repoPath: empty, worktreesDir: wtDir, taskSeq: 1, mode: 'head-commit' }),
    ).rejects.toThrow(/chưa có commit/);
  });
});

describe('commitAll and workspaceSummary', () => {
  it('commitAll returns a sha then null; summary reflects edits', async () => {
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 7, mode: 'head-commit' });
    writeFileSync(join(ws.path, 'a.txt'), 'đã sửa trong worktree\n');
    writeFileSync(join(ws.path, 'fresh file.txt'), 'tươi\n');

    const s1 = await workspaceSummary(ws);
    expect(s1.status).toContain('a.txt');
    expect(s1.diff).toContain('a.txt');
    expect(s1.diff).toContain('fresh file.txt');
    expect(s1.commits).toEqual([]);

    const sha = await commitAll(ws, 'agent: sửa');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await commitAll(ws, 'again')).toBeNull();

    const s2 = await workspaceSummary(ws);
    expect(s2.status).toBe('');
    expect(s2.diff).toContain('a.txt');
    expect(s2.commits).toHaveLength(1);
    expect(s2.commits[0]).toMatch(/^[0-9a-f]+ agent: sửa$/);
  });

  it('summary diff is against the original HEAD, so it includes the carried changes', async () => {
    writeFileSync(join(repo, 'new.txt'), 'mới\n');
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 4, mode: 'head-dirty-commit' });
    const s = await workspaceSummary(ws);
    expect(s.diff).toContain('new.txt');
    expect(s.commits).toEqual([expect.stringContaining('voragent: mang theo thay đổi chưa commit')]);
  });
});

describe('failure cleanup and config independence', () => {
  it('removes the worktree and branch when carry-over fails, so a retry works', async () => {
    writeFileSync(join(repo, 'new.txt'), 'mới\n');
    git(repo, ['config', 'user.name', '']);
    git(repo, ['config', 'user.email', '']);
    await expect(
      createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 5, mode: 'head-dirty-commit' }),
    ).rejects.toThrow();
    expect(existsSync(join(wtDir, 'task-5'))).toBe(false);
    expect(git(repo, ['branch', '--list', 'voragent/task-5'])).toBe('');
    expect(git(repo, ['worktree', 'list', '--porcelain'])).not.toContain('task-5');

    git(repo, ['config', 'user.name', 'Test']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 5, mode: 'head-dirty-commit' });
    expect(readFileSync(join(ws.path, 'new.txt'), 'utf8')).toBe('mới\n');
  });

  it('same seq on an existing workspace throws a Vietnamese error and leaves it untouched', async () => {
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 6, mode: 'head-commit' });
    writeFileSync(join(ws.path, 'mine.txt'), 'giữ\n');
    await expect(
      createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 6, mode: 'head-commit' }),
    ).rejects.toThrow(/đã tồn tại/);
    expect(readFileSync(join(ws.path, 'mine.txt'), 'utf8')).toBe('giữ\n');
    expect(git(repo, ['branch', '--list', 'voragent/task-6'])).toContain('voragent/task-6');
  });

  it('carry-over is independent of diff.noprefix / diff.mnemonicPrefix', async () => {
    git(repo, ['config', 'diff.noprefix', 'true']);
    git(repo, ['config', 'diff.mnemonicPrefix', 'true']);
    makeDirty();
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 8, mode: 'dirty-nocommit' });
    expect(readFileSync(join(ws.path, 'a.txt'), 'utf8')).toBe('một\nhai (sửa)\nba\n');
    expect(readFileSync(join(ws.path, 'c.bin')).equals(BIN2)).toBe(true);
    expect(readFileSync(join(ws.path, 'staged.txt'), 'utf8')).toBe('staged-new\n');
    expect(existsSync(join(ws.path, 'b.bin'))).toBe(false);
    expect(existsSync(join(ws.path, 'del.txt'))).toBe(false);
    const s = await workspaceSummary(ws);
    expect(s.diff).toContain('diff --git a/a.txt b/a.txt');
  });

  it('workspaceSummary is read-only and repeatable', async () => {
    makeDirty();
    const ws = await createWorkspace({ repoPath: repo, worktreesDir: wtDir, taskSeq: 9, mode: 'dirty-nocommit' });
    const idxPath = join(git(ws.path, ['rev-parse', '--git-dir']).trim(), 'index');
    const statusBefore = git(ws.path, ['-c', 'core.quotepath=false', 'status', '--short']);
    const idxBefore = readFileSync(idxPath);
    const s1 = await workspaceSummary(ws);
    const s2 = await workspaceSummary(ws);
    expect(s2).toEqual(s1);
    expect(s1.status).toBe(statusBefore);
    expect(git(ws.path, ['-c', 'core.quotepath=false', 'status', '--short'])).toBe(statusBefore);
    expect(readFileSync(idxPath).equals(idxBefore)).toBe(true);
    expect(s1.diff).toContain('a.txt');
    expect(s1.diff).toContain('new.txt');
  });
});
