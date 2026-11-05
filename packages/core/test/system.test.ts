import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import { openStore } from '../src/store.js';
import { EventBus } from '../src/bus.js';

describe('System Storage & Prune API Endpoints', () => {
  it('handles GET /api/system/storage and POST /api/system/prune', async () => {
    const tmpDataDir = join(tmpdir(), `voragent-api-storage-${Date.now()}`);
    mkdirSync(join(tmpDataDir, 'worktrees', 'orphan-1'), { recursive: true });
    writeFileSync(join(tmpDataDir, 'daemon.log'), 'dummy-log-line\n');
    writeFileSync(join(tmpDataDir, 'worktrees', 'orphan-1', 'test.js'), 'console.log(1);');

    const dbFile = join(tmpDataDir, 'voragent.db');
    const store = openStore(dbFile);
    const bus = new EventBus();
    const key = 'test-key-12345678901234567890123456789012';

    const fakeOrch = {
      tick: async () => {},
      submitTask: async () => ({ id: 't1' }),
    } as any;

    const app = createServer({
      orchestrator: fakeOrch,
      store,
      bus,
      key,
      webDir: null,
      dataDir: tmpDataDir,
    });

    try {
      // 1. GET /api/system/storage
      const res = await app.request('/api/system/storage', {
        headers: { 'x-voragent-key': key },
      });
      expect(res.status).toBe(200);
      const stats = (await res.json()) as any;
      expect(stats.dataDir).toBe(tmpDataDir);
      expect(stats.orphanWorktreesCount).toBe(1);
      expect(stats.breakdown.worktreesBytes).toBeGreaterThan(0);

      // 2. POST /api/system/prune
      const pruneRes = await app.request('/api/system/prune', {
        method: 'POST',
        headers: {
          'x-voragent-key': key,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ orphanWorktrees: true, logs: true }),
      });
      expect(pruneRes.status).toBe(200);
      const pruneData = (await pruneRes.json()) as any;
      expect(pruneData.prunedOrphans).toBe(1);
      expect(pruneData.logsTruncated).toBe(true);

      // Check stats again
      const res2 = await app.request('/api/system/storage', {
        headers: { 'x-voragent-key': key },
      });
      const stats2 = (await res2.json()) as any;
      expect(stats2.orphanWorktreesCount).toBe(0);
    } finally {
      store.close();
      rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });
});
