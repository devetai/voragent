import { promises as fsp } from 'node:fs';
import { resolve } from 'node:path';
import spawn from 'cross-spawn';
import type {
  GitBranchInfo,
  GitFileStatus,
  GitStatusResult,
  GitStatusType,
  GitWorktreeInfo,
} from '@voragent/shared';

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => out.push(d));
    child.stderr?.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => {
      resolve({ code: 1, stdout: '', stderr: e.message });
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  const isInside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (isInside.code !== 0 || isInside.stdout.trim() !== 'true') {
    return {
      isGit: false,
      branch: null,
      clean: true,
      files: [],
      ahead: 0,
      behind: 0,
      worktrees: [],
    };
  }

  // Branch hiện tại
  const branchRes = await runGit(cwd, ['branch', '--show-current']);
  let branch: string | null = branchRes.stdout.trim() || null;
  if (!branch) {
    const headRes = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
    branch = headRes.code === 0 ? `detached (${headRes.stdout.trim()})` : null;
  }

  // Ahead / Behind
  let ahead = 0;
  let behind = 0;
  const countRes = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (countRes.code === 0) {
    const parts = countRes.stdout.trim().split(/\s+/);
    ahead = parseInt(parts[0] || '0', 10) || 0;
    behind = parseInt(parts[1] || '0', 10) || 0;
  }

  // Files status
  const statusRes = await runGit(cwd, ['status', '--porcelain=v1', '-uall']);
  const files: GitFileStatus[] = [];

  if (statusRes.code === 0 && statusRes.stdout.trim() !== '') {
    const lines = statusRes.stdout.split('\n');
    for (const line of lines) {
      if (line.length < 4) continue;
      const x = line[0];
      const y = line[1];
      const rawPath = line.slice(3).trim();

      let p = rawPath;
      let oldP: string | undefined;
      if (rawPath.includes(' -> ')) {
        const parts = rawPath.split(' -> ');
        oldP = parts[0]?.replace(/^"|"$/g, '');
        p = parts[1]?.replace(/^"|"$/g, '') || rawPath;
      } else {
        p = rawPath.replace(/^"|"$/g, '');
      }

      // Staged changes (X)
      if (x !== ' ' && x !== '?' && x !== '!') {
        let st: GitStatusType = 'modified';
        if (x === 'A') st = 'added';
        else if (x === 'D') st = 'deleted';
        else if (x === 'R') st = 'renamed';
        files.push({ path: p, oldPath: oldP, status: st, staged: true });
      }

      // Unstaged changes (Y)
      if (y !== ' ' && y !== '!') {
        if (x === '?' && y === '?') {
          files.push({ path: p, status: 'untracked', staged: false });
        } else {
          let st: GitStatusType = 'modified';
          if (y === 'D') st = 'deleted';
          else if (y === 'A') st = 'added';
          files.push({ path: p, status: st, staged: false });
        }
      }
    }
  }

  // Worktrees
  const worktrees = await listWorktrees(cwd);

  return {
    isGit: true,
    branch,
    clean: files.length === 0,
    files,
    ahead,
    behind,
    worktrees,
    currentWorktreePath: cwd,
  };
}

export async function listWorktrees(cwd: string): Promise<GitWorktreeInfo[]> {
  const top = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  const mainRoot = top.code === 0 ? top.stdout.trim() : cwd;

  const res = await runGit(cwd, ['worktree', 'list', '--porcelain']);
  if (res.code !== 0) return [];

  const worktrees: GitWorktreeInfo[] = [];
  const entries = res.stdout.split('\n\n');

  for (const block of entries) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let wtPath = '';
    let head = '';
    let branch: string | null = null;
    let isLocked = false;

    for (const l of lines) {
      if (l.startsWith('worktree ')) wtPath = l.slice(9).trim();
      else if (l.startsWith('HEAD ')) head = l.slice(5).trim();
      else if (l.startsWith('branch refs/heads/')) branch = l.slice(18).trim();
      else if (l.startsWith('locked')) isLocked = true;
    }

    if (!wtPath) continue;

    let taskSeq: number | undefined;
    if (branch) {
      const match = branch.match(/^voragent\/task-(\d+)$/);
      if (match?.[1]) {
        taskSeq = parseInt(match[1], 10);
      }
    }

    const normWt = resolve(wtPath).toLowerCase();
    const normMain = resolve(mainRoot).toLowerCase();

    worktrees.push({
      path: wtPath,
      head: head.slice(0, 8),
      branch,
      isMain: normWt === normMain,
      isLocked,
      taskSeq,
    });
  }

  return worktrees;
}

export async function getGitDiff(
  cwd: string,
  filePath?: string,
  staged?: boolean,
): Promise<{ diff: string }> {
  const args = ['diff'];
  if (staged) args.push('--staged');
  if (filePath) {
    args.push('--', filePath);
  }

  const res = await runGit(cwd, args);
  if (res.code !== 0) {
    return { diff: '' };
  }

  // Nếu file là untracked và filePath được chỉ định nhưng diff rỗng, tạo synthetic diff
  if (!res.stdout.trim() && filePath && !staged) {
    try {
      const fullPath = resolve(cwd, filePath);
      const content = await fsp.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      const synthetic = [
        `diff --git a/${filePath} b/${filePath}`,
        `new file mode 100644`,
        `--- /dev/null`,
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((l) => `+${l}`),
      ].join('\n');
      return { diff: synthetic };
    } catch {
      // ignore
    }
  }

  return { diff: res.stdout };
}

export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const res = await runGit(cwd, ['add', '--', ...paths]);
  if (res.code !== 0) {
    throw new Error(`Git add thất bại: ${res.stderr.trim()}`);
  }
}

export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const res = await runGit(cwd, ['restore', '--staged', '--', ...paths]);
  if (res.code !== 0) {
    throw new Error(`Git unstage thất bại: ${res.stderr.trim()}`);
  }
}

export async function discardFiles(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  // Lấy status để phân biệt tracked vs untracked
  const statusRes = await runGit(cwd, ['status', '--porcelain=v1', '-uall']);
  const untrackedSet = new Set<string>();
  if (statusRes.code === 0) {
    for (const l of statusRes.stdout.split('\n')) {
      if (l.startsWith('?? ')) {
        untrackedSet.add(l.slice(3).trim().replace(/^"|"$/g, ''));
      }
    }
  }

  const toRestore: string[] = [];
  for (const p of paths) {
    if (untrackedSet.has(p)) {
      await fsp.rm(resolve(cwd, p), { recursive: true, force: true }).catch(() => undefined);
    } else {
      toRestore.push(p);
    }
  }

  if (toRestore.length > 0) {
    const res = await runGit(cwd, ['restore', '--', ...toRestore]);
    if (res.code !== 0) {
      throw new Error(`Git restore thất bại: ${res.stderr.trim()}`);
    }
  }
}

export async function commitChanges(cwd: string, message: string): Promise<{ commitHash: string }> {
  if (!message.trim()) {
    throw new Error('Nội dung commit không được để trống');
  }
  const res = await runGit(cwd, ['commit', '-m', message]);
  if (res.code !== 0) {
    throw new Error(`Git commit thất bại: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  const hashRes = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  return { commitHash: hashRes.stdout.trim() };
}

export async function listBranches(cwd: string): Promise<GitBranchInfo[]> {
  const res = await runGit(cwd, [
    'branch',
    '-a',
    '--format=%(refname:short)|%(objectname:short)|%(contents:subject)|%(HEAD)',
  ]);
  if (res.code !== 0) return [];

  const branches: GitBranchInfo[] = [];
  const lines = res.stdout.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const [name, commitHash, commitMessage, headIndicator] = line.split('|');
    if (!name) continue;
    branches.push({
      name,
      isCurrent: headIndicator?.trim() === '*',
      commitHash: commitHash || '',
      commitMessage: commitMessage || '',
    });
  }
  return branches;
}

export async function checkoutBranch(
  cwd: string,
  branch: string,
  createNew = false,
): Promise<{ ok: boolean }> {
  const args = ['checkout'];
  if (createNew) args.push('-b');
  args.push(branch);

  const res = await runGit(cwd, args);
  if (res.code !== 0) {
    throw new Error(`Git checkout thất bại: ${res.stderr.trim()}`);
  }
  return { ok: true };
}

export async function removeWorktree(
  cwd: string,
  worktreePath: string,
  force = false,
): Promise<{ ok: boolean }> {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);

  const res = await runGit(cwd, args);
  if (res.code !== 0) {
    throw new Error(`Xóa worktree thất bại: ${res.stderr.trim()}`);
  }
  return { ok: true };
}
