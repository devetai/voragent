import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import spawn from 'cross-spawn';
import type { MigrateOptions, MigrateResult } from '@voragent/shared';
import { writeBootstrapDataDir } from './location.js';
import { getDiskSpace, getPathSize } from './storage.js';
import type { Store } from './store.js';

function runGitRepair(repoPath: string, newWorktreePath: string): Promise<void> {
  return new Promise((res) => {
    try {
      if (!existsSync(repoPath) || !existsSync(newWorktreePath)) {
        return res();
      }
      const child = spawn('git', ['worktree', 'repair', newWorktreePath], {
        cwd: repoPath,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('close', () => res());
      child.on('error', () => res());
    } catch {
      res();
    }
  });
}
export async function migrateDataDir(
  options: MigrateOptions,
  currentDataDir: string,
  store: Store,
  home?: string,
): Promise<MigrateResult> {
  const oldPath = resolve(currentDataDir);
  const rawTarget = options.newPath ? options.newPath.trim() : '';

  if (!rawTarget) {
    throw new Error('Đường dẫn thư mục mới không được để trống.');
  }

  const newPath = resolve(rawTarget);
  if (!isAbsolute(newPath)) {
    throw new Error('Đường dẫn thư mục mới phải là đường dẫn tuyệt đối.');
  }

  if (newPath.toLowerCase() === oldPath.toLowerCase()) {
    throw new Error('Thư mục mới trùng với thư mục hiện tại.');
  }

  if (newPath.toLowerCase().startsWith(oldPath.toLowerCase() + sep)) {
    throw new Error('Thư mục mới không được là thư mục con của thư mục hiện tại.');
  }

  if (oldPath.toLowerCase().startsWith(newPath.toLowerCase() + sep)) {
    throw new Error('Thư mục mới không được là thư mục cha của thư mục hiện tại.');
  }

  // Kiểm tra dung lượng đĩa đích
  if (existsSync(oldPath)) {
    const neededBytes = getPathSize(oldPath);
    mkdirSync(newPath, { recursive: true });
    const targetDisk = await getDiskSpace(newPath);
    if (targetDisk && targetDisk.freeBytes < neededBytes + 50 * 1024 * 1024) {
      throw new Error(
        `Ổ đĩa đích không đủ dung lượng trống (cần tối thiểu ${(neededBytes / (1024 * 1024)).toFixed(1)} MB, còn trống ${(targetDisk.freeBytes / (1024 * 1024)).toFixed(1)} MB).`,
      );
    }
  } else {
    mkdirSync(newPath, { recursive: true });
  }

  // 1. Dồn WAL checkpoint của SQLite
  store.checkpoint();

  // 2. Cập nhật đường dẫn workspace trong store hiện tại trước khi sao chép
  const tasks = store.listTasks();
  for (const t of tasks) {
    if (t.workspacePath && t.workspacePath.toLowerCase().startsWith(oldPath.toLowerCase())) {
      const rel = t.workspacePath.slice(oldPath.length).replace(/^[\\/]+/, '');
      const updatedPath = join(newPath, rel);
      store.updateTask(t.id, { workspacePath: updatedPath });
    }
  }
  store.checkpoint();

  // 3. Sao chép dữ liệu an toàn sang thư mục mới (copy từng mục con để tránh crash libuv cross-drive trên Windows)
  if (existsSync(oldPath)) {
    try {
      mkdirSync(newPath, { recursive: true });
      const entries = readdirSync(oldPath);
      for (const entry of entries) {
        const srcItem = join(oldPath, entry);
        const destItem = join(newPath, entry);
        cpSync(srcItem, destItem, { recursive: true, force: true });
      }
    } catch (e) {
      throw new Error(`Sao chép dữ liệu sang thư mục mới thất bại: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 4. Sửa chữa liên kết git worktree cho từng task
  const newTasks = store.listTasks();
  for (const t of newTasks) {
    if (t.workspacePath && existsSync(t.workspacePath)) {
      await runGitRepair(t.repoPath, t.workspacePath);
    }
  }

  // 5. Cập nhật file bootstrap pointer ~/.voragentrc
  writeBootstrapDataDir(newPath, home);

  // 6. Xử lý giải phóng thư mục cũ an toàn (chỉ xóa worktrees cũ để giải phóng dung lượng, không xóa file SQLite/logs đang mở)
  if (options.deleteOld && existsSync(oldPath)) {
    const oldWorktrees = join(oldPath, 'worktrees');
    if (existsSync(oldWorktrees)) {
      try {
        rmSync(oldWorktrees, { recursive: true, force: true });
      } catch {
        // Bỏ qua nếu có worktree đang bận
      }
    }
  }

  return {
    success: true,
    oldPath,
    newPath,
  };
}
