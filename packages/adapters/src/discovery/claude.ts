import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveredProject } from '@voragent/shared';

export interface DiscoverOptions {
  home: string;
  appData?: string;
  platform?: NodeJS.Platform;
}

export const MAX_DIRS = 500;
const MAX_READ = 64 * 1024;

function readHead(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(MAX_READ);
    const n = readSync(fd, buf, 0, MAX_READ, 0);
    return buf.toString('utf8', 0, n);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* bỏ qua */
      }
    }
  }
}

function firstCwd(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { cwd?: unknown };
      if (obj && typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
    } catch {
      /* dòng cụt hoặc hỏng: bỏ qua */
    }
  }
  return null;
}

function newestJsonl(dir: string): { file: string; mtimeMs: number } | null {
  let best: { file: string; mtimeMs: number } | null = null;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const file = join(dir, name);
      const st = statSync(file);
      if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: st.mtimeMs };
    } catch {
      /* bỏ qua */
    }
  }
  return best;
}

/** Các dự án từng mở bằng Claude Code. Chỉ đọc; nguồn hỏng trả []. */
export async function discoverClaudeProjects(o: DiscoverOptions): Promise<DiscoveredProject[]> {
  const claudeJson = join(o.home, '.claude.json');
  const projectsDir = join(o.home, '.claude', 'projects');
  const found = new Map<string, number | null>();
  const add = (path: string, t: number | null) => {
    const prev = found.get(path);
    if (prev === undefined) found.set(path, t);
    else if (t !== null && (prev === null || t > prev)) found.set(path, t);
  };

  try {
    const json = JSON.parse(readFileSync(claudeJson, 'utf8')) as { projects?: unknown };
    if (json && typeof json.projects === 'object' && json.projects && !Array.isArray(json.projects)) {
      for (const key of Object.keys(json.projects)) if (key) add(key, null);
    }
  } catch {
    /* thiếu hoặc hỏng */
  }

  // Giữ MAX_DIRS thư mục có mtime mới nhất (không theo thứ tự readdir); tốn một stat cho mỗi thư mục.
  const dirs: Array<{ dir: string; mtimeMs: number }> = [];
  try {
    for (const d of readdirSync(projectsDir)) {
      try {
        const dir = join(projectsDir, d);
        const st = statSync(dir);
        if (st.isDirectory()) dirs.push({ dir, mtimeMs: st.mtimeMs });
      } catch {
        /* bỏ qua */
      }
    }
  } catch {
    /* thiếu */
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { dir } of dirs.slice(0, MAX_DIRS)) {
    try {
      const newest = newestJsonl(dir);
      if (!newest) continue;
      const head = readHead(newest.file);
      if (head === null) continue;
      const cwd = firstCwd(head);
      if (cwd) add(cwd, Math.floor(newest.mtimeMs));
    } catch {
      /* bỏ qua thư mục này */
    }
  }

  return [...found].map(([path, lastUsedAt]) => ({ path, lastUsedAt, source: 'claude' as const }));
}
