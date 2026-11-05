import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getBootstrapFilePath,
  getDataDirInfo,
  readBootstrapDataDir,
  resolveDataDir,
  writeBootstrapDataDir,
} from '../src/location.js';
import { getDiskSpace, getPathSize, getStorageStats } from '../src/storage.js';
import { pruneStorage } from '../src/cleanup.js';
import { migrateDataDir } from '../src/migration.js';
import { openStore } from '../src/store.js';

describe('Location & Bootstrap Pointer', () => {
  it('reads and writes bootstrap file correctly', () => {
    const tmpHome = join(tmpdir(), `voragent-test-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpHome, { recursive: true });
    try {
      expect(readBootstrapDataDir(tmpHome)).toBeNull();
      const customPath = join(tmpHome, 'custom-data');
      writeBootstrapDataDir(customPath, tmpHome);
      expect(readBootstrapDataDir(tmpHome)).toBe(customPath);

      // Check file content
      const file = getBootstrapFilePath(tmpHome);
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      expect(parsed.dataDir).toBe(customPath);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('respects priority: env > bootstrap > default', () => {
    const tmpHome = join(tmpdir(), `voragent-test-home-prio-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    try {
      const defaultDir = join(tmpHome, '.voragent');
      // 1. Default
      expect(resolveDataDir({}, tmpHome)).toBe(defaultDir);

      // 2. Bootstrap
      const bootstrapDir = join(tmpHome, 'bootstrap-dir');
      writeBootstrapDataDir(bootstrapDir, tmpHome);
      expect(resolveDataDir({}, tmpHome)).toBe(bootstrapDir);

      // 3. Env overrides bootstrap
      const envDir = join(tmpHome, 'env-dir');
      expect(resolveDataDir({ VORAGENT_HOME: envDir }, tmpHome)).toBe(envDir);

      const info = getDataDirInfo({ VORAGENT_HOME: envDir }, tmpHome);
      expect(info.source).toBe('env');
      expect(info.dataDir).toBe(envDir);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

describe('Storage & Disk space', () => {
  it('calculates directory sizes and disk space', async () => {
    const tmpDir = join(tmpdir(), `voragent-test-storage-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const testFile = join(tmpDir, 'test.txt');
      writeFileSync(testFile, 'hello world!'.repeat(100)); // ~1200 bytes
      const size = getPathSize(tmpDir);
      expect(size).toBeGreaterThan(1000);

      const disk = await getDiskSpace(tmpDir);
      expect(disk).not.toBeNull();
      expect(disk!.freeBytes).toBeGreaterThan(0);
      expect(disk!.totalBytes).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('gathers storage breakdown correctly', async () => {
    const tmpDataDir = join(tmpdir(), `voragent-test-breakdown-${Date.now()}`);
    mkdirSync(join(tmpDataDir, 'worktrees', 'task-1'), { recursive: true });
    writeFileSync(join(tmpDataDir, 'voragent.db'), 'sqlite-mock-content');
    writeFileSync(join(tmpDataDir, 'daemon.log'), 'log-line-1\nlog-line-2\n');
    writeFileSync(join(tmpDataDir, 'worktrees', 'task-1', 'sample.txt'), 'some worktree files');

    const dbFile = join(tmpDataDir, 'test-store.db');
    const store = openStore(dbFile);

    try {
      const stats = await getStorageStats(tmpDataDir, store);
      expect(stats.dataDir).toBe(tmpDataDir);
      expect(stats.breakdown.worktreesBytes).toBeGreaterThan(0);
      expect(stats.breakdown.databaseBytes).toBeGreaterThan(0);
      expect(stats.breakdown.logsBytes).toBeGreaterThan(0);
      expect(stats.breakdown.totalBytes).toBe(
        stats.breakdown.worktreesBytes + stats.breakdown.databaseBytes + stats.breakdown.logsBytes,
      );
      expect(stats.orphanWorktreesCount).toBe(1); // task-1 has no DB record
    } finally {
      store.close();
      rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });
});

describe('Storage Cleanup', () => {
  it('prunes orphan worktrees and truncates logs', async () => {
    const tmpDataDir = join(tmpdir(), `voragent-test-cleanup-${Date.now()}`);
    mkdirSync(join(tmpDataDir, 'worktrees', 'orphan-task'), { recursive: true });
    writeFileSync(join(tmpDataDir, 'worktrees', 'orphan-task', 'dummy.js'), 'console.log("orphan");');
    const logPath = join(tmpDataDir, 'daemon.log');
    writeFileSync(logPath, 'heavy log content '.repeat(200));

    const dbFile = join(tmpDataDir, 'test-store.db');
    const store = openStore(dbFile);

    try {
      const result = await pruneStorage({ orphanWorktrees: true, logs: true, vacuum: true }, tmpDataDir, store);
      expect(result.prunedOrphans).toBe(1);
      expect(result.logsTruncated).toBe(true);
      expect(result.vacuumed).toBe(true);
      expect(result.freedBytes).toBeGreaterThan(0);

      // Orphan dir is removed
      expect(existsSync(join(tmpDataDir, 'worktrees', 'orphan-task'))).toBe(false);
      // Log file is truncated to 0 bytes
      expect(readFileSync(logPath, 'utf8')).toBe('');
    } finally {
      store.close();
      rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  it('prunes ended task worktrees and keeps task records in store', async () => {
    const tmpDataDir = join(tmpdir(), `voragent-test-task-cleanup-${Date.now()}`);
    const wtDir = join(tmpDataDir, 'worktrees', 'task-1');
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(join(wtDir, 'app.ts'), 'export const a = 1;');

    const dbFile = join(tmpDataDir, 'test-store.db');
    const store = openStore(dbFile);

    try {
      const { task } = store.createTask({
        title: 'Task to be pruned',
        repoPath: tmpDataDir,
        mode: 'head-dirty-commit',
        priority: null,
        message: 'hello',
      });
      // Mark task as closed and set workspacePath
      store.updateTask(task.id, {
        status: 'closed',
        workspacePath: wtDir,
      });

      const res = await pruneStorage({ olderThanDays: 0 }, tmpDataDir, store);
      expect(res.prunedWorktrees).toBe(1);
      expect(existsSync(wtDir)).toBe(false);

      // Task record still exists in store with workspacePath cleared
      const updated = store.getTask(task.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('closed');
      expect(updated!.workspacePath).toBeNull();
    } finally {
      store.close();
      rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });
});

describe('Data Migration', () => {
  it('migrates data directory to a new path and updates tasks and bootstrap pointer', async () => {
    const tmpHome = join(tmpdir(), `voragent-test-home-mig-${Date.now()}`);
    const sourceDir = join(tmpHome, 'source-data');
    const destDir = join(tmpHome, 'dest-data');

    mkdirSync(join(sourceDir, 'worktrees', 'task-1'), { recursive: true });
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({ port: 4899 }));
    writeFileSync(join(sourceDir, 'worktrees', 'task-1', 'file.txt'), 'content');

    const dbFile = join(sourceDir, 'voragent.db');
    const store = openStore(dbFile);

    try {
      const { task } = store.createTask({
        title: 'Migrated task',
        repoPath: sourceDir,
        mode: 'head-dirty-commit',
        priority: null,
        message: 'test',
      });
      store.updateTask(task.id, {
        workspacePath: join(sourceDir, 'worktrees', 'task-1'),
      });

      // Run migration
      const result = await migrateDataDir({ newPath: destDir, deleteOld: false }, sourceDir, store, tmpHome);
      expect(result.success).toBe(true);
      expect(result.newPath).toBe(destDir);

      // Dest files exist
      expect(existsSync(join(destDir, 'config.json'))).toBe(true);
      expect(existsSync(join(destDir, 'worktrees', 'task-1', 'file.txt'))).toBe(true);

      // Task workspacePath was updated to new path
      const migratedTask = store.getTask(task.id);
      expect(migratedTask!.workspacePath).toBe(join(destDir, 'worktrees', 'task-1'));
    } finally {
      store.close();
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
