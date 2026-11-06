import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import spawn from 'cross-spawn';
import type { WorkspaceMode } from '@voragent/shared';

export interface Workspace {
  path: string;
  branch: string | null;
  baseCommit: string | null;
  isolated: boolean;
}

interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** Run git with an argument array (no shell). Never throws on non-zero exit; callers check `code`. */
function runGit(
  cwd: string,
  args: string[],
  input?: Buffer,
  env?: Record<string, string>,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => out.push(d));
    child.stderr?.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      }),
    );
    // EPIPE is possible if git exits early; the exit code reports the failure.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

// Independent of the user's diff.* / color.* config so patches round-trip exactly.
const DIFF_FLAGS = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-renames',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

async function git(
  cwd: string,
  args: string[],
  input?: Buffer,
  env?: Record<string, string>,
): Promise<string> {
  const r = await runGit(cwd, args, input, env);
  if (r.code !== 0) {
    throw new Error(`git ${args[0] ?? ''} thất bại (mã ${r.code}): ${r.stderr.trim()}`);
  }
  return r.stdout.toString('utf8');
}

export async function createWorkspace(o: {
  repoPath: string;
  worktreesDir: string;
  taskSeq: number;
  mode: WorkspaceMode;
  baseBranchOrCommit?: string | null;
}): Promise<Workspace> {
  const top = await runGit(o.repoPath, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) {
    return { path: o.repoPath, branch: null, baseCommit: null, isolated: false };
  }
  const root = top.stdout.toString('utf8').trim();

  let baseCommit: string;
  if (o.baseBranchOrCommit) {
    const res = await runGit(root, ['rev-parse', '--verify', o.baseBranchOrCommit]);
    if (res.code === 0) {
      baseCommit = res.stdout.toString('utf8').trim();
    } else {
      const head = await runGit(root, ['rev-parse', '--verify', 'HEAD']);
      if (head.code !== 0) {
        throw new Error(
          `Kho git tại ${o.repoPath} chưa có commit nào, không thể tạo worktree. Hãy tạo ít nhất một commit rồi thử lại.`,
        );
      }
      baseCommit = head.stdout.toString('utf8').trim();
    }
  } else {
    const head = await runGit(root, ['rev-parse', '--verify', 'HEAD']);
    if (head.code !== 0) {
      throw new Error(
        `Kho git tại ${o.repoPath} chưa có commit nào, không thể tạo worktree. Hãy tạo ít nhất một commit rồi thử lại.`,
      );
    }
    baseCommit = head.stdout.toString('utf8').trim();
  }

  const branch = `voragent/task-${o.taskSeq}`;
  const projectSlug = basename(root).replace(/[^a-zA-Z0-9._-]/g, '_') || 'project';
  const path = join(o.worktreesDir, projectSlug, `task-${o.taskSeq}`);
  const existing = await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (existing.code === 0) {
    throw new Error(`Nhánh ${branch} đã tồn tại; task này đã có worktree.`);
  }
  await mkdir(join(o.worktreesDir, projectSlug), { recursive: true });
  await git(root, ['worktree', 'add', '-b', branch, path, baseCommit]);

  try {
    if (o.mode !== 'head-commit' && !o.baseBranchOrCommit) {
      // Tracked changes (staged + unstaged, deletions, binary) relative to HEAD.
      const diff = await runGit(root, ['diff', 'HEAD', '--binary', ...DIFF_FLAGS]);
      if (diff.code !== 0) throw new Error(`git diff thất bại: ${diff.stderr.trim()}`);
      if (diff.stdout.length > 0) {
        const applied = await runGit(path, ['apply', '--binary', '--whitespace=nowarn', '-'], diff.stdout);
        if (applied.code !== 0) {
          throw new Error(
            `Không thể mang thay đổi chưa commit sang worktree (có thể do submodule hoặc xung đột): ${applied.stderr.trim()}`,
          );
        }
      }
      // Untracked, non-ignored files: copy bytes as-is, keeping relative paths.
      const others = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
      if (others.code !== 0) throw new Error(`git ls-files thất bại: ${others.stderr.trim()}`);
      for (const rel of others.stdout.toString('utf8').split('\0')) {
        if (rel === '') continue;
        const dest = join(path, rel);
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(join(root, rel), dest);
      }

      if (o.mode === 'head-dirty-commit') {
        await commitIfDirty(path, 'voragent: mang theo thay đổi chưa commit', true);
      }
    }
  } catch (err) {
    // Best effort: never mask the original error.
    await runGit(root, ['worktree', 'remove', '--force', path]).catch(() => undefined);
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    await runGit(root, ['worktree', 'prune']).catch(() => undefined);
    await runGit(root, ['branch', '-D', branch]).catch(() => undefined);
    throw err;
  }

  return { path, branch, baseCommit, isolated: true };
}

async function commitIfDirty(cwd: string, message: string, noVerify: boolean): Promise<string | null> {
  await git(cwd, ['add', '-A']);
  const status = await git(cwd, ['status', '--porcelain', '-z']);
  if (status === '') return null;
  await git(cwd, ['commit', '-q', ...(noVerify ? ['--no-verify'] : []), '-m', message]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

export async function commitAll(ws: Workspace, message: string): Promise<string | null> {
  if (!ws.isolated) return null;
  return commitIfDirty(ws.path, message, false);
}

export async function workspaceSummary(
  ws: Workspace,
): Promise<{ status: string; diff: string; commits: string[] }> {
  if (!ws.isolated || ws.baseCommit === null) return { status: '', diff: '', commits: [] };
  const status = await git(ws.path, ['status', '--short']);
  // Read-only: intent-to-add happens on a throwaway copy of the index, never the real one.
  const idxRel = (await git(ws.path, ['rev-parse', '--git-path', 'index'])).trim();
  const tmp = await mkdtemp(join(tmpdir(), 'voragent-idx-'));
  try {
    const tmpIndex = join(tmp, 'index');
    await copyFile(resolve(ws.path, idxRel), tmpIndex);
    const env = { GIT_INDEX_FILE: tmpIndex };
    await git(ws.path, ['add', '-N', '.'], undefined, env);
    const diff = await git(ws.path, ['diff', ...DIFF_FLAGS, ws.baseCommit], undefined, env);
    const log = await git(ws.path, ['log', '--format=%h %s', `${ws.baseCommit}..HEAD`]);
    return { status, diff, commits: log.split('\n').filter((l) => l !== '') };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}


export async function initGitRepository(
  repoPath: string,
): Promise<{ branch: string; commit: string }> {
  const initRes = await runGit(repoPath, ['init', '-b', 'main']);
  if (initRes.code !== 0) {
    await git(repoPath, ['init']);
  }

  const head = await runGit(repoPath, ['rev-parse', '--verify', 'HEAD']);
  if (head.code !== 0) {
    await git(repoPath, [
      '-c',
      'user.name=voragent',
      '-c',
      'user.email=voragent@local',
      'commit',
      '--allow-empty',
      '-m',
      'chore: initialize git repository',
    ]);
  }

  const branchOut = await runGit(repoPath, ['branch', '--show-current']);
  const branch = branchOut.stdout.toString('utf8').trim() || 'main';
  const commit = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
  return { branch, commit };
}
