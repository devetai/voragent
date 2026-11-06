import { createHash } from 'node:crypto';
import { realpathSync, promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn as crossSpawn } from 'cross-spawn';
import type { DiscoveredProject, Project, ProjectSource } from '@voragent/shared';
import type { Store } from './store.js';

export interface ProjectCatalogDeps {
  sources: Array<() => Promise<DiscoveredProject[]>>;
  store: Pick<Store, 'listTasks'>;
  dataDir: string;
  home: string;
  tmpDirs?: string[]; // mặc định [os.tmpdir()]
  now?: () => number;
  ttlMs?: number; // mặc định 30_000
  /** Chỉ để thay trong test. Trả stdout, hoặc null nếu lỗi/quá hạn. */
  runGit?: (args: string[], cwd: string, timeoutMs: number) => Promise<string | null>;
  gitTimeoutMs?: number; // mặc định 3000
  /** Chỉ để test: trỏ runner mặc định tới một "git" giả (bin + đối số chèn trước). Bỏ qua nếu có runGit. */
  gitCommand?: { bin: string; prefixArgs?: string[] };
  /** Thời gian tối đa cho mỗi lần dò đường dẫn (realpath/stat); quá hạn coi như không tồn tại. Mặc định 2000. */
  pathTimeoutMs?: number;
  /** Chỉ để test: thay realpath/stat (mặc định fs.promises). */
  fsOps?: { realpath: (p: string) => Promise<string>; stat: (p: string) => Promise<{ isDirectory(): boolean }> };
}

export interface ProjectCatalog {
  list(opts?: { refresh?: boolean }): Promise<Project[]>;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_GIT_TIMEOUT_MS = 3000;
const ENRICH_CONCURRENCY = 4;
const PATH_CONCURRENCY = 8;
const DEFAULT_PATH_TIMEOUT_MS = 2000;
const HOME_DOT_DIRS = ['.claude', '.gemini', '.codex', '.antigravity', '.voragent', '.opencode'];

function realPathOrNull(p: string): string | null {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
}

function stripTrailing(p: string, flavor: typeof path.posix): string {
  const root = flavor.parse(p).root;
  let s = p;
  while (s.length > root.length && (s.endsWith('/') || s.endsWith('\\'))) s = s.slice(0, -1);
  return s;
}

function keyFromString(p: string, platform: NodeJS.Platform): string {
  const flavor = platform === 'win32' ? path.win32 : path.posix;
  const s = stripTrailing(flavor.normalize(p), flavor);
  return platform === 'win32' ? s.toLowerCase() : s;
}

/** Khóa chuẩn hóa: realpath nếu tồn tại, bỏ dấu gạch cuối, viết thường trên win32. */
export function normalizePathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  return keyFromString(realPathOrNull(p) ?? p, platform);
}

function isInside(key: string, base: string, sep: string): boolean {
  if (key === base) return true;
  return key.startsWith(base.endsWith(sep) ? base : base + sep);
}

export interface IgnoreRoots {
  home: string;
  homeDots: string[];
  dataDir: string;
  tmpDirs: string[];
}

/** Phần thuần: các gốc đã chuẩn hóa thành khóa. Giữ nguyên mọi quy tắc loại trừ. */
function ignoredByRoots(k: string, r: IgnoreRoots, platform: NodeJS.Platform): boolean {
  const sep = platform === 'win32' ? '\\' : '/';
  const flavor = platform === 'win32' ? path.win32 : path.posix;
  if (k === r.home) return true;
  for (const dot of r.homeDots) if (isInside(k, dot, sep)) return true;
  if (isInside(k, r.dataDir, sep)) return true;
  for (const t of r.tmpDirs) if (isInside(k, t, sep)) return true;
  // Gốc ổ đĩa và tổ tiên của home/dataDir/tmp không phải dự án.
  if (flavor.parse(k).root === k) return true;
  for (const base of [r.home, r.dataDir, ...r.tmpDirs]) if (isInside(base, k, sep)) return true;
  return false;
}

export function isIgnoredProjectPath(
  key: string,
  d: { dataDir: string; home: string; tmpDirs: string[] },
  platform: NodeJS.Platform = process.platform,
): boolean {
  const flavor = platform === 'win32' ? path.win32 : path.posix;
  const roots: IgnoreRoots = {
    home: normalizePathKey(d.home, platform),
    homeDots: HOME_DOT_DIRS.map((dot) => normalizePathKey(flavor.join(d.home, dot), platform)),
    dataDir: normalizePathKey(d.dataDir, platform),
    tmpDirs: d.tmpDirs.map((t) => normalizePathKey(t, platform)),
  };
  return ignoredByRoots(keyFromString(key, platform), roots, platform);
}

/**
 * Chạy git chỉ đọc bằng cross-spawn (mảng đối số, không qua shell). Quá hạn thì kill đơn giản
 * (child.kill): lệnh ngắn, không sinh cây tiến trình đáng kể, nên không cần taskkill /T như proc.ts.
 */
function makeDefaultRunGit(cmd: { bin: string; prefixArgs?: string[] }) {
  return (args: string[], cwd: string, timeoutMs: number): Promise<string | null> =>
  new Promise((resolve) => {
    let settled = false;
    let out = '';
    const child = crossSpawn(cmd.bin, [...(cmd.prefixArgs ?? []), '-c', 'core.fsmonitor=false', '--no-optional-locks', '-C', cwd, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const done = (v: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      child.kill();
      child.stdout?.destroy();
      done(null);
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      out += c;
    });
    child.on('error', () => done(null));
    child.on('close', (code) => done(code === 0 ? out : null));
  });
}

function countDirty(porcelainZ: string): number {
  const parts = porcelainZ.split('\0').filter((s) => s !== '');
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    n++;
    const status = parts[i]!.slice(0, 2);
    if (status.includes('R') || status.includes('C')) i++; // mục tên cũ đi kèm
  }
  return n;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface Merged {
  key: string;
  path: string;
  lastUsedAt: number | null;
  sources: Map<string, ProjectSource>;
}

function maxTime(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

export function createProjectCatalog(d: ProjectCatalogDeps): ProjectCatalog {
  const now = d.now ?? Date.now;
  const ttlMs = d.ttlMs ?? DEFAULT_TTL_MS;
  const gitTimeoutMs = d.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const runGit = d.runGit ?? makeDefaultRunGit(d.gitCommand ?? { bin: 'git' });
  const platform = process.platform;
  const tmpDirs = d.tmpDirs ?? [tmpdir()];
  const pathTimeoutMs = d.pathTimeoutMs ?? DEFAULT_PATH_TIMEOUT_MS;
  const fsOps = d.fsOps ?? { realpath: (p: string) => fsp.realpath(p), stat: (p: string) => fsp.stat(p) };

  // Mọi truy cập đĩa trong bản dựng đều bất đồng bộ và bị giới hạn thời gian (đường dẫn mạng chết không được làm treo daemon).
  function withTimeout<T>(p: Promise<T>): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<null>((res) => {
      timer = setTimeout(() => res(null), pathTimeoutMs);
    });
    return Promise.race([p.catch(() => null), limit]).finally(() => clearTimeout(timer));
  }
  const probeRealpath = (p: string): Promise<string | null> =>
    withTimeout(Promise.resolve().then(() => fsOps.realpath(p)));
  async function probeDir(p: string): Promise<string | null> {
    const real = await probeRealpath(p);
    if (real === null) return null;
    const st = await withTimeout(Promise.resolve().then(() => fsOps.stat(real)));
    return st !== null && st.isDirectory() ? real : null;
  }

  let cache: { at: number; value: Project[] } | null = null;
  let inflight: Promise<Project[]> | null = null;
  let seq = 0;
  let writtenSeq = 0;

  // Lưới an toàn: kể cả runGit tiêm vào không tự giới hạn thời gian thì vẫn trả null.
  const git = async (args: string[], cwd: string): Promise<string | null> => {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<null>((res) => {
      timer = setTimeout(() => res(null), gitTimeoutMs + 200);
    });
    try {
      return await Promise.race([Promise.resolve().then(() => runGit(args, cwd, gitTimeoutMs)).catch(() => null), limit]);
    } finally {
      clearTimeout(timer);
    }
  };

  const bare = (m: Merged, taskCount: number): Project => build1(m, taskCount, false, null, null);
  const build1 = (m: Merged, taskCount: number, isGit: boolean, branch: string | null, dirtyCount: number | null): Project => ({
    id: createHash('sha1').update(m.key).digest('hex').slice(0, 12),
    path: m.path,
    name: path.basename(m.path) || m.path,
    lastUsedAt: m.lastUsedAt,
    sources: [...m.sources.values()],
    isGit,
    branch,
    dirtyCount,
    taskCount,
  });

  async function enrich(m: Merged, taskCount: number): Promise<Project> {
    let isGit = false;
    let branch: string | null = null;
    let dirtyCount: number | null = null;
    const inside = await git(['rev-parse', '--is-inside-work-tree'], m.path);
    if (inside !== null && inside.trim() === 'true') {
      isGit = true;
      const b = await git(['branch', '--show-current'], m.path);
      const trimmed = b?.trim() ?? '';
      branch = trimmed === '' ? null : trimmed;
      const s = await git(['status', '--porcelain', '-z'], m.path);
      dirtyCount = s === null ? null : countDirty(s);
    }
    return build1(m, taskCount, isGit, branch, dirtyCount);
  }

  async function build(): Promise<Project[]> {
    const lists = await Promise.all(
      d.sources.map(async (s) => {
        try {
          return await s();
        } catch {
          return [] as DiscoveredProject[];
        }
      }),
    );
    const flavor = platform === 'win32' ? path.win32 : path.posix;
    // Gốc loại trừ: realpath MỘT lần cho mỗi bản dựng.
    const rootKey = async (p: string): Promise<string> => keyFromString((await probeRealpath(p)) ?? p, platform);
    const roots: IgnoreRoots = {
      home: await rootKey(d.home),
      homeDots: await Promise.all(HOME_DOT_DIRS.map((dot) => rootKey(flavor.join(d.home, dot)))),
      dataDir: await rootKey(d.dataDir),
      tmpDirs: await Promise.all(tmpDirs.map(rootKey)),
    };
    const items = lists.flat().filter((it) => it.path !== '' && flavor.isAbsolute(it.path));
    const probed = new Map<string, string | null>();
    await mapLimit([...new Set(items.map((it) => it.path))], PATH_CONCURRENCY, async (raw) => {
      probed.set(raw, await probeDir(raw));
    });
    const merged = new Map<string, Merged>();
    for (const item of items) {
      const real = probed.get(item.path) ?? null;
      if (real === null) continue;
      const key = keyFromString(real, platform);
      if (ignoredByRoots(key, roots, platform)) continue;
      let m = merged.get(key);
      if (!m) {
        m = { key, path: stripTrailing(real, flavor), lastUsedAt: null, sources: new Map() };
        merged.set(key, m);
      }
      m.lastUsedAt = maxTime(m.lastUsedAt, item.lastUsedAt);
      const prev = m.sources.get(item.source);
      m.sources.set(item.source, {
        source: item.source,
        lastUsedAt: maxTime(prev?.lastUsedAt ?? null, item.lastUsedAt),
      });
    }
    const counts = new Map<string, number>();
    const taskPaths = d.store.listTasks().map((t) => t.repoPath).filter((p) => p !== '' && flavor.isAbsolute(p));
    const taskKeys = new Map<string, string>();
    await mapLimit([...new Set(taskPaths)], PATH_CONCURRENCY, async (raw) => {
      taskKeys.set(raw, keyFromString((await probeRealpath(raw)) ?? raw, platform));
    });
    for (const p of taskPaths) {
      const k = taskKeys.get(p)!;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const projects = await mapLimit([...merged.values()], ENRICH_CONCURRENCY, (m) =>
      enrich(m, counts.get(m.key) ?? 0).catch(() => bare(m, counts.get(m.key) ?? 0)),
    );
    projects.sort((a, b) => {
      if (a.lastUsedAt !== b.lastUsedAt) {
        if (a.lastUsedAt === null) return 1;
        if (b.lastUsedAt === null) return -1;
        return b.lastUsedAt - a.lastUsedAt;
      }
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    return projects;
  }

  return {
    async list(opts) {
      if (!opts?.refresh && cache && now() - cache.at < ttlMs) return cache.value;
      if (!opts?.refresh && inflight) return inflight;
      const mySeq = ++seq;
      const p = build()
        .then((value) => {
          if (mySeq > writtenSeq) {
            writtenSeq = mySeq;
            cache = { at: now(), value };
          }
          return value;
        })
        .finally(() => {
          if (inflight === p) inflight = null;
        });
      inflight = p;
      return p;
    },
  };
}
