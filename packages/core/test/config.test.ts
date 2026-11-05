import { rmTmp } from './helpers.js';
import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';

function withDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'voragent-cfg-'));
  try {
    return fn(dir);
  } finally {
    rmTmp(dir);
  }
}

test('empty dir gives defaults and returns dataDir', () => {
  withDir((dir) => {
    const c = loadConfig(dir);
    expect(c.dataDir).toBe(dir);
    expect(c.priority).toEqual(['claude', 'codex']);
    expect(c.quotaThreshold).toBe(0.9);
    expect(c.port).toBe(4717);
    expect(c.defaultCooldownMs).toBe(3_600_000);
    expect(c.turnTimeoutMs).toBe(1_800_000);
    expect(c.concurrency).toEqual({ perProvider: 2, total: 4 });
    expect(c.network).toBe(true);
    expect(c.defaultMode).toBe('head-dirty-commit');
    expect(c.handoffMaxChars).toBe(24_000);
  });
});

test('config.json overrides priority and keeps other defaults', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'config.json'), '{"priority":["codex"]}');
    const c = loadConfig(dir);
    expect(c.priority).toEqual(['codex']);
    expect(c.port).toBe(4717);
    expect(c.quotaThreshold).toBe(0.9);
  });
});

test('concurrency deep-merges; unknown keys ignored; defaults not mutated', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'config.json'), '{"concurrency":{"total":8},"bogus":1}');
    const c = loadConfig(dir);
    expect(c.concurrency).toEqual({ perProvider: 2, total: 8 });
    expect('bogus' in c).toBe(false);
    expect(DEFAULT_CONFIG.concurrency.total).toBe(4);
  });
});

test('invalid JSON gives a Vietnamese error', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'config.json'), '{oops');
    expect(() => loadConfig(dir)).toThrow(/không phải JSON hợp lệ/);
  });
});

test('wrong-typed values give a Vietnamese error naming the key', () => {
  withDir((dir) => {
    const bad: Array<[string, RegExp]> = [
      ['{"port":"80"}', /port/],
      ['{"priority":"claude"}', /priority/],
      ['{"priority":[1]}', /priority/],
      ['{"concurrency":{"total":"x"}}', /concurrency\.total/],
      ['{"concurrency":5}', /concurrency/],
      ['{"network":"yes"}', /network/],
      ['{"defaultMode":"nope"}', /defaultMode/],
      ['[]', /đối tượng JSON/],
    ];
    for (const [text, re] of bad) {
      writeFileSync(join(dir, 'config.json'), text);
      expect(() => loadConfig(dir), text).toThrow(re);
      expect(() => loadConfig(dir), text).toThrow(/config\.json/);
    }
  });
});

test('config.json saved with a UTF-8 BOM still loads', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'config.json'), '\uFEFF' + JSON.stringify({ priority: ['codex'] }));
    const c = loadConfig(dir);
    expect(c.priority).toEqual(['codex']);
    expect(c.port).toBe(4717);
    expect(c.quotaThreshold).toBe(0.9);
  });
});
