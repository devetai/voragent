import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFakeAdapter } from '../src/fake.js';
import type { Adapter } from '../src/types.js';

const fx = (n: string) => resolve(import.meta.dirname, 'fixtures', n);
const input = (cwd: string, sessionId: string | null = null) =>
  ({ prompt: 'làm đi', systemPrompt: 'sys', sessionId, cwd, network: false });

function run(adapter: Adapter, cwd: string, sessionId: string | null = null) {
  const inv = adapter.invocation(input(cwd, sessionId));
  const r = spawnSync(inv.bin, inv.args, { cwd, input: inv.stdin, encoding: 'utf8' });
  const parser = adapter.createParser();
  for (const line of r.stdout.split('\n')) if (line) parser.push(line);
  return { r, result: parser.finish({ code: r.status, stderr: r.stderr, timedOut: false }) };
}

function withDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'vor dir-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('fixture ok', () => withDir((dir) => {
  const a = createFakeAdapter({ id: 'fake-a', fixture: fx('fake-ok.jsonl'), touch: 'out.txt' });
  const { result } = run(a, dir);
  expect(result).toMatchObject({ outcome: 'ok', text: 'xong', sessionId: 'fake-s1' });
  expect(readFileSync(join(dir, '.fake-stdin.txt'), 'utf8')).toBe('sys\n\nlàm đi');
  expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('edited by fake');
  expect(readFileSync(join(dir, '.fake-calls.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
}));

test('fixture quota với --exit 1', () => withDir((dir) => {
  const a = createFakeAdapter({ id: 'fake-a', fixture: fx('fake-quota.jsonl'), exitCode: 1 });
  const { result } = run(a, dir);
  expect(result).toMatchObject({ outcome: 'quota_exhausted', resetsAt: 1762250400000 });
  expect(existsSync(join(dir, 'out.txt'))).toBe(false);
}));

test('tiếp tục phiên truyền --session và ghi lại lệnh gọi', () => withDir((dir) => {
  const a = createFakeAdapter({ id: 'fake-a', fixture: fx('fake-ok.jsonl') });
  run(a, dir);
  const { result } = run(a, dir, 'sess-9');
  expect(result.sessionId).toBe('fake-s1');
  const calls = readFileSync(join(dir, '.fake-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain('--session');
  expect(calls[1]![calls[1]!.indexOf('--session') + 1]).toBe('sess-9');
  expect(calls[0]).not.toContain('--session');
}));

test('thoát khác 0 không quota là error', () => withDir((dir) => {
  const a = createFakeAdapter({ id: 'fake-a', fixture: fx('fake-ok.jsonl'), exitCode: 2 });
  expect(run(a, dir).result.outcome).toBe('error');
}));
