import { test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCodexAdapter } from '../src/codex.js';
import { createAdapters } from '../src/index.js';
import type { ParsedEvent, TurnResult } from '../src/types.js';

const fixture = (n: string) =>
  readFileSync(resolve(import.meta.dirname, 'fixtures', n), 'utf8').split('\n').filter(Boolean);

afterEach(() => { vi.useRealTimers(); });

function run(name: string, exit: { code: number | null; stderr?: string }) {
  const parser = createCodexAdapter().createParser();
  const events: ParsedEvent[] = [];
  for (const line of fixture(name)) events.push(...parser.push(line));
  const result: TurnResult = parser.finish({ code: exit.code, stderr: exit.stderr ?? '', timedOut: false });
  return { events, result };
}

test('codex-ok: ok, có chữ "xong", sessionId từ thread.started, USAGE', () => {
  const { events, result } = run('codex-ok.jsonl', { code: 0 });
  expect(result.outcome).toBe('ok');
  expect(result.text).toBe('xong');
  expect(result.sessionId).toBe('s-demo-1');
  expect(events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT' && e.data.delta === 'xong')).toBe(true);
  expect(events.some((e) => e.type === 'USAGE')).toBe(true);
  expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 8 });
});

test('codex-tools: shell có START/ARGS/RESULT, file_change phát FILE_CHANGED', () => {
  const { events } = run('codex-tools.jsonl', { code: 0 });
  const starts = events.filter((e) => e.type === 'TOOL_CALL_START' && e.data.toolCallName === 'shell');
  expect(starts).toHaveLength(1); // started + completed chỉ mở một lần
  const id = starts[0]!.data.toolCallId;
  expect(events.some((e) => e.type === 'TOOL_CALL_ARGS' && e.data.toolCallId === id)).toBe(true);
  expect(events.some((e) => e.type === 'TOOL_CALL_RESULT' && e.data.toolCallId === id)).toBe(true);
  const changed = events.filter((e) => e.type === 'FILE_CHANGED');
  expect(changed.map((e) => e.data)).toEqual([{ path: 'C:\\work\\demo\\a.ts' }]);
});

test('codex-quota với code 1: hết quota, resetsAt là 15:45 kế tiếp sau now cố định', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0, 0));
  const { result } = run('codex-quota.jsonl', { code: 1 });
  expect(result.outcome).toBe('quota_exhausted');
  expect(result.resetsAt).toBe(new Date(2026, 10, 4, 15, 45, 0).getTime());
});

test('codex-mentions-limit với code 0: câu trả lời nhắc "usage limit" vẫn là ok', () => {
  const { result } = run('codex-mentions-limit.jsonl', { code: 0 });
  expect(result.outcome).toBe('ok');
  expect(result.text).toContain('usage limit');
});

test('turn.failed báo hết quota', () => {
  const parser = createCodexAdapter().createParser();
  parser.push('{"type":"turn.failed","error":{"message":"Quota exceeded for this account"}}');
  const r = parser.finish({ code: 1, stderr: '', timedOut: false });
  expect(r.outcome).toBe('quota_exhausted');
});

test('stderr báo hết quota với code 1', () => {
  const parser = createCodexAdapter().createParser();
  const r = parser.finish({ code: 1, stderr: "You've hit your usage limit.", timedOut: false });
  expect(r.outcome).toBe('quota_exhausted');
});

test('stderr lỗi mạng với code 1: outcome error', () => {
  const { result } = run('codex-ok.jsonl', { code: 1, stderr: 'Error: connect ECONNREFUSED' });
  expect(result.outcome).toBe('error');
  expect(result.error).toContain('ECONNREFUSED');
});

test('rate_limits cho quota và QUOTA_UPDATED, không đổi outcome', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const parser = createCodexAdapter().createParser();
  const events = parser.push('{"type":"token_count","rate_limits":{"primary":{"used_percent":97,"resets_in_seconds":600}}}');
  expect(events).toEqual([{ type: 'QUOTA_UPDATED', data: { usedPercent: 0.97, resetsAt: 1_600_000 } }]);
  const r = parser.finish({ code: 0, stderr: '', timedOut: false });
  expect(r.outcome).toBe('ok');
  expect(r.quota).toEqual({ usedPercent: 0.97, resetsAt: 1_600_000 });
});

test('invocation: exec resume, network_access, stdin gộp system prompt', () => {
  const inv = createCodexAdapter().invocation({
    prompt: 'làm đi', systemPrompt: 'SP', sessionId: 's1', cwd: '.', network: true,
  });
  expect(inv.bin).toBe('codex');
  expect(inv.args).toEqual([
    'exec', 'resume', 's1', '--json', '-c', 'sandbox_mode="workspace-write"',
    '-c', 'sandbox_workspace_write.network_access=true', '-',
  ]);
  expect(inv.stdin).toBe('SP\n\nlàm đi');
  const bare = createCodexAdapter().invocation({
    prompt: 'p', systemPrompt: '', sessionId: null, cwd: '.', network: false,
  });
  expect(bare.args).toEqual(['exec', '--json', '-c', 'sandbox_mode="workspace-write"', '-']);
  expect(bare.stdin).toBe('p');
});

test('dòng JSON hợp lệ nhưng không phải object bị bỏ qua như JSON hỏng', () => {
  const parser = createCodexAdapter().createParser();
  for (const line of ['null', '5', '"x"', '[1]', '{not json']) {
    expect(() => parser.push(line)).not.toThrow();
    expect(parser.push(line)).toEqual([]);
  }
  for (const line of fixture('codex-ok.jsonl')) parser.push(line);
  const result = parser.finish({ code: 0, stderr: '', timedOut: false });
  expect(result).toMatchObject({ outcome: 'ok', text: 'xong', sessionId: 's-demo-1' });
});

test('createAdapters bỏ qua id không biết', () => {
  const m = createAdapters(['claude', 'codex', 'x' as never]);
  expect(m.size).toBe(2);
  expect(m.get('codex')?.id).toBe('codex');
});

test('quota của cả hai adapter là tỉ lệ trong [0,1]', async () => {
  const { createClaudeAdapter } = await import('../src/claude.js');
  const claude = createClaudeAdapter().createParser();
  for (const line of fixture('claude-ok.jsonl')) claude.push(line);
  const cq = claude.finish({ code: 0, stderr: '', timedOut: false }).quota;
  expect(cq!.usedPercent).toBeGreaterThanOrEqual(0);
  expect(cq!.usedPercent).toBeLessThanOrEqual(1);
  expect(cq!.usedPercent).toBe(0.53);
  const codex = createCodexAdapter().createParser();
  codex.push('{"type":"token_count","rate_limits":{"primary":{"used_percent":53,"resets_in_seconds":60}}}');
  const xq = codex.finish({ code: 0, stderr: '', timedOut: false }).quota;
  expect(xq!.usedPercent).toBeGreaterThanOrEqual(0);
  expect(xq!.usedPercent).toBeLessThanOrEqual(1);
});
