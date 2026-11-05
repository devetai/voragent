import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveredProject } from '@voragent/shared';
import type { DiscoverOptions } from './claude.js';
import { MAX_DIRS } from './claude.js';
import { fileUriToPath } from './uri.js';

function defaultAppData(o: DiscoverOptions, platform: NodeJS.Platform): string {
  if (o.appData) return o.appData;
  if (platform === 'win32') return join(o.home, 'AppData', 'Roaming');
  if (platform === 'darwin') return join(o.home, 'Library', 'Application Support');
  return join(o.home, '.config');
}

/** Các thư mục từng mở bằng Antigravity IDE. Chỉ đọc; nguồn hỏng trả []. */
export async function discoverAntigravityProjects(o: DiscoverOptions): Promise<DiscoveredProject[]> {
  const platform = o.platform ?? process.platform;
  const root = join(defaultAppData(o, platform), 'Antigravity', 'User', 'workspaceStorage');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  // Giữ MAX_DIRS mục có mtime mới nhất (tốn một stat cho mỗi mục).
  const entries: Array<{ dir: string; mtimeMs: number }> = [];
  for (const name of names) {
    try {
      const dir = join(root, name);
      const st = statSync(dir);
      if (st.isDirectory()) entries.push({ dir, mtimeMs: st.mtimeMs });
    } catch {
      /* bỏ qua */
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const out: DiscoveredProject[] = [];
  for (const { dir, mtimeMs } of entries.slice(0, MAX_DIRS)) {
    try {
      const json = JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8')) as { folder?: unknown };
      if (typeof json?.folder !== 'string') continue;
      const path = fileUriToPath(json.folder, platform);
      if (path) out.push({ path, lastUsedAt: Math.floor(mtimeMs), source: 'antigravity' });
    } catch {
      /* bỏ qua mục này */
    }
  }
  return out;
}
