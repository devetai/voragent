import { existsSync, readdirSync, truncateSync, unlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import spawn from 'cross-spawn';
import type { PruneOptions, PruneResult } from '@voragent/shared';
import { getPathSize } from './storage.js';
import type { Store } from './store.js';

function runGitPrune(repoPath: string, worktreePath: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoPath,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('close', () => {
        // Tiếp tục chạy git worktree prune
        try {
          const pruneChild = spawn('git', ['worktree', 'prune'], {
            cwd: repoPath,
            stdio: 'ignore',
            windowsHide: true,
          });
          pruneChild.on('close', () => resolve());
          pruneChild.on('error', () => resolve());
        } catch {
          resolve();
        }
      });
      child.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function pruneStorage(
  options: PruneOptions,
  dataDir: string,
  store: Store,
): Promise<PruneResult> {
  let freedBytes = 0;
  let prunedWorktrees = 0;
  let prunedOrphans = 0;
  let logsTruncated = false;
  let vacuumed = false;

  const now = Date.now();
  const maxAgeMs = options.olderThanDays && options.olderThanDays > 0
    ? options.olderThanDays * 24 * 60 * 60 * 1000
    : 0;

  const tasks = store.listTasks();
  const activeWorktreePaths = new Set<string>();

  // 1. Dọn worktrees của task đã kết thúc
  for (const t of tasks) {
    if (t.workspacePath) {
      activeWorktreePaths.add(t.workspacePath);
      const isEnded = t.status === 'closed' || t.status === 'failed';
      const isOldEnough = maxAgeMs === 0 || (now - t.updatedAt >= maxAgeMs);

      if (isEnded && isOldEnough && existsSync(t.workspacePath)) {
        const size = getPathSize(t.workspacePath);
        // Cố gắng remove qua git worktree trước
        await runGitPrune(t.repoPath, t.workspacePath);
        // Xóa sạch thư mục vật lý nếu vẫn còn
        await rm(t.workspacePath, { recursive: true, force: true }).catch(() => undefined);

        freedBytes += size;
        prunedWorktrees += 1;
        store.updateTask(t.id, { workspacePath: null });
        activeWorktreePaths.delete(t.workspacePath);
      }
    }
  }

  // 2. Dọn orphan worktrees nếu được yêu cầu (hoặc mặc định khi không truyền false)
  const worktreesDir = join(dataDir, 'worktrees');
  if (options.orphanWorktrees !== false && existsSync(worktreesDir)) {
    try {
      const subdirs = readdirSync(worktreesDir, { withFileTypes: true });
      for (const entry of subdirs) {
        if (entry.isDirectory()) {
          const fullPath = join(worktreesDir, entry.name);
          if (!activeWorktreePaths.has(fullPath)) {
            const size = getPathSize(fullPath);
            await rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
            freedBytes += size;
            prunedOrphans += 1;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Xoay vòng / thu gọn logs nếu được yêu cầu
  if (options.logs) {
    const logFile = join(dataDir, 'daemon.log');
    if (existsSync(logFile)) {
      const size = getPathSize(logFile);
      try {
        truncateSync(logFile, 0);
        freedBytes += size;
        logsTruncated = true;
      } catch {
        // ignore
      }
    }
    // Xóa các file .log cũ khác
    try {
      if (existsSync(dataDir)) {
        const files = readdirSync(dataDir);
        for (const f of files) {
          if (f.startsWith('daemon.log.') || (f.endsWith('.log') && f !== 'daemon.log')) {
            const p = join(dataDir, f);
            const size = getPathSize(p);
            try {
              unlinkSync(p);
              freedBytes += size;
              logsTruncated = true;
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Vacuum database nếu được yêu cầu
  if (options.vacuum) {
    try {
      store.vacuum();
      vacuumed = true;
    } catch {
      // ignore
    }
  }

  return {
    freedBytes,
    prunedWorktrees,
    prunedOrphans,
    logsTruncated,
    vacuumed,
  };
}
