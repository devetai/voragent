import { existsSync, readdirSync, statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import spawn from 'cross-spawn';
import type { AvailableDrive, BrowseFolderResult, DiskSpace, FolderEntry, StorageStats } from '@voragent/shared';
import { getDataDirInfo } from './location.js';
import type { Store } from './store.js';

export function getPathSize(targetPath: string): number {
  if (!existsSync(targetPath)) return 0;
  try {
    const stat = statSync(targetPath);
    if (!stat.isDirectory()) {
      return stat.size;
    }
    let total = 0;
    const entries = readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(targetPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += getPathSize(full);
        } else if (entry.isFile()) {
          total += statSync(full).size;
        }
      } catch {
        // Bỏ qua lỗi quyền hạn hoặc tệp đang bị lock
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function getDiskSpace(targetPath: string): Promise<DiskSpace | null> {
  try {
    const stat = await statfs(targetPath);
    return {
      freeBytes: Number(stat.bavail) * Number(stat.bsize),
      totalBytes: Number(stat.blocks) * Number(stat.bsize),
    };
  } catch {
    return null;
  }
}

export async function getAvailableDrives(): Promise<AvailableDrive[]> {
  const drives: AvailableDrive[] = [];
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const l of letters) {
      const rootPath = `${l}:\\`;
      if (existsSync(rootPath)) {
        const space = await getDiskSpace(rootPath);
        if (space) {
          drives.push({
            drive: `${l}:`,
            path: rootPath,
            freeBytes: space.freeBytes,
            totalBytes: space.totalBytes,
          });
        }
      }
    }
  } else {
    const space = await getDiskSpace('/');
    if (space) {
      drives.push({
        drive: '/',
        path: '/',
        freeBytes: space.freeBytes,
        totalBytes: space.totalBytes,
      });
    }
  }
  return drives;
}

export function listSubdirectories(dirPath: string): FolderEntry[] {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => {
        try {
          return (
            e.isDirectory() &&
            !e.name.startsWith('.') &&
            !e.name.startsWith('$') &&
            e.name !== 'System Volume Information' &&
            e.name !== 'Config.Msi'
          );
        } catch {
          return false;
        }
      })
      .map((e) => ({
        name: e.name,
        path: join(dirPath, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

export function browseFolders(targetPath?: string | null): BrowseFolderResult {
  if (!targetPath || targetPath.trim() === '') {
    if (process.platform === 'win32') {
      const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const drives: FolderEntry[] = [];
      for (const l of letters) {
        const rootPath = `${l}:\\`;
        if (existsSync(rootPath)) {
          drives.push({ name: `Ổ đĩa ${l}:`, path: rootPath });
        }
      }
      return {
        currentPath: null,
        parentPath: null,
        isRoot: true,
        folders: drives,
      };
    } else {
      return {
        currentPath: '/',
        parentPath: null,
        isRoot: true,
        folders: listSubdirectories('/'),
      };
    }
  }

  const resolved = resolve(targetPath);
  const parent = dirname(resolved);
  const isRoot = parent.toLowerCase() === resolved.toLowerCase();

  return {
    currentPath: resolved,
    parentPath: isRoot ? null : parent,
    isRoot,
    folders: listSubdirectories(resolved),
  };
}

export function pickSystemDirectory(): Promise<string | null> {
  return new Promise((resolvePicker) => {
    let child: ReturnType<typeof spawn>;
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolvePicker(null);
    }, 60_000);

    if (process.platform === 'win32') {
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$dialog.Description = 'Chọn thư mục lưu trữ cho voragent'",
        '$dialog.ShowNewFolderButton = $true',
        '$dialog.AutoUpgradeEnabled = $true',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  [Console]::WriteLine($dialog.SelectedPath)',
        '}',
      ].join('\r\n');
      const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
      child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', b64]);
    } else if (process.platform === 'darwin') {
      child = spawn('osascript', ['-e', 'POSIX path of (choose folder with prompt "Chọn thư mục lưu trữ voragent:")']);
    } else {
      child = spawn('zenity', ['--file-selection', '--directory', '--title=Chọn thư mục lưu trữ voragent']);
    }

    let out = '';
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.on('close', () => {
      clearTimeout(timer);
      const chosen = out.trim();
      resolvePicker(chosen !== '' ? chosen : null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolvePicker(null);
    });
  });
}

export async function getStorageStats(dataDir: string, store: Store): Promise<StorageStats> {
  const dirInfo = getDataDirInfo();

  // 1. Dung lượng worktrees
  const worktreesDir = join(dataDir, 'worktrees');
  const worktreesBytes = getPathSize(worktreesDir);

  // 2. Dung lượng database (gồm cả db-wal và db-shm nếu có)
  const dbFile = join(dataDir, 'voragent.db');
  const walFile = join(dataDir, 'voragent.db-wal');
  const shmFile = join(dataDir, 'voragent.db-shm');
  const databaseBytes = getPathSize(dbFile) + getPathSize(walFile) + getPathSize(shmFile);

  // 3. Dung lượng logs
  const logFile = join(dataDir, 'daemon.log');
  let logsBytes = getPathSize(logFile);
  try {
    if (existsSync(dataDir)) {
      const allFiles = readdirSync(dataDir);
      for (const f of allFiles) {
        if (f.startsWith('daemon.log.') || f.endsWith('.log')) {
          if (f !== 'daemon.log') logsBytes += getPathSize(join(dataDir, f));
        }
      }
    }
  } catch {
    // ignore
  }

  const totalBytes = worktreesBytes + databaseBytes + logsBytes;

  // 4. Thống kê prunable worktrees
  const tasks = store.listTasks();
  let prunableWorktreesCount = 0;
  const activeWorktreePaths = new Set<string>();

  for (const t of tasks) {
    if (t.workspacePath) {
      activeWorktreePaths.add(t.workspacePath);
      if (t.status === 'closed' || t.status === 'failed') {
        if (existsSync(t.workspacePath)) {
          prunableWorktreesCount += 1;
        }
      }
    }
  }

  // 5. Thống kê orphan worktrees (thư mục trong worktrees/ không gắn với task nào)
  let orphanWorktreesCount = 0;
  try {
    if (existsSync(worktreesDir)) {
      const subdirs = readdirSync(worktreesDir, { withFileTypes: true });
      for (const entry of subdirs) {
        if (entry.isDirectory()) {
          const fullPath = join(worktreesDir, entry.name);
          if (!activeWorktreePaths.has(fullPath)) {
            orphanWorktreesCount += 1;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 6. Dung lượng ổ đĩa
  const disk = await getDiskSpace(existsSync(dataDir) ? dataDir : process.cwd());
  const availableDrives = await getAvailableDrives();

  return {
    dataDir,
    defaultDataDir: dirInfo.defaultDataDir,
    isCustomLocation: dirInfo.isCustom,
    breakdown: {
      worktreesBytes,
      databaseBytes,
      logsBytes,
      totalBytes,
    },
    disk,
    prunableWorktreesCount,
    orphanWorktreesCount,
    availableDrives,
  };
}
