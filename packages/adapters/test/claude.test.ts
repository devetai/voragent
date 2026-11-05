import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClaudeAdapter } from '../src/claude.js';
import type { ParsedEvent, TurnResult } from '../src/types.js';

const fixture = (n: string) =>
  readFileSync(resolve(import.meta.dirname, 'fixtures', n), 'utf8').split('\n').filter(Boolean);

function run(name: string, exit: { code: number | null; stderr?: string }) {
  const parser = createClaudeAdapter().createParser();
  const events: ParsedEvent[] = [];
  for (const line of fixture(name)) events.push(...parser.push(line));
  const result: TurnResult = parser.finish({ code: exit.code, stderr: exit.stderr ?? '', timedOut: false });
  return { events, result };
}

test('claude-ok: kết quả ok, có chữ "xong", sessionId lấy từ dòng đầu', () => {
  const sessionId = (JSON.parse(fixture('claude-ok.jsonl')[0]!) as { session_id: string }).session_id;
  const { events, result } = run('claude-ok.jsonl', { code: 0 });
  expect(result.outcome).toBe('ok');
  expect(result.text).toContain('xong');
  expect(result.sessionId).toBe(sessionId);
  expect(events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT' && e.data.delta === 'xong')).toBe(true);
  expect(events.some((e) => e.type === 'USAGE')).toBe(true);
  expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 4 });
});

test('claude-tools: có TOOL_CALL_START của Read và TOOL_CALL_RESULT tương ứng', () => {
  const { events } = run('claude-tools.jsonl', { code: 0 });
  const start = events.find((e) => e.type === 'TOOL_CALL_START' && e.data.toolCallName === 'Read');
  expect(start).toBeDefined();
  const id = start!.data.toolCallId;
  expect(events.some((e) => e.type === 'TOOL_CALL_ARGS' && e.data.toolCallId === id)).toBe(true);
  expect(events.some((e) => e.type === 'TOOL_CALL_RESULT' && e.data.toolCallId === id)).toBe(true);
  expect(events.some((e) => e.type === 'FILE_CHANGED')).toBe(false);
});

test('tool sửa file phát thêm FILE_CHANGED với path', () => {
  const parser = createClaudeAdapter().createParser();
  for (const name of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    const events = parser.push(JSON.stringify({
      type: 'assistant', session_id: 's',
      message: { content: [{ type: 'tool_use', id: `t-${name}`, name, input: { file_path: 'a/b.ts' } }] },
    }));
    expect(events.map((e) => e.type)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'FILE_CHANGED']);
    expect(events[2]!.data).toEqual({ path: 'a/b.ts' });
  }
});

test('claude-quota với code 1: hết quota, đọc được giờ reset', () => {
  const { result } = run('claude-quota.jsonl', { code: 1 });
  expect(result.outcome).toBe('quota_exhausted');
  expect(result.resetsAt).toBe(1762250400000);
});

test('claude-mentions-limit với code 0: câu trả lời nhắc "usage limit reached" vẫn là ok', () => {
  const { result } = run('claude-mentions-limit.jsonl', { code: 0 });
  expect(result.outcome).toBe('ok');
  expect(result.text).toContain('usage limit reached');
});

test('stderr lỗi kết nối với code 1: outcome error', () => {
  const { result } = run('claude-ok.jsonl', { code: 1, stderr: 'Error: connect ECONNREFUSED' });
  expect(result.outcome).toBe('error');
  expect(result.error).toContain('ECONNREFUSED');
});

test('invocation: --resume, --append-system-prompt, stdin là prompt', () => {
  const inv = createClaudeAdapter().invocation({
    prompt: 'làm đi', systemPrompt: 'SP', sessionId: 's1', cwd: '.', network: false,
  });
  expect(inv.bin).toBe('claude');
  expect(inv.args).toEqual([
    '-p', '--resume', 's1', '--output-format', 'stream-json', '--include-partial-messages',
    '--verbose', '--permission-mode', 'auto', '--append-system-prompt', 'SP',
  ]);
  expect(inv.stdin).toBe('làm đi');
  const bare = createClaudeAdapter().invocation({
    prompt: 'p', systemPrompt: '', sessionId: null, cwd: '.', network: false,
  });
  expect(bare.args).not.toContain('--resume');
  expect(bare.args).not.toContain('--append-system-prompt');
});

test('dòng JSON hợp lệ nhưng không phải object bị bỏ qua như JSON hỏng', () => {
  const parser = createClaudeAdapter().createParser();
  for (const line of ['null', '5', '"x"', '[1]', '{not json']) {
    expect(() => parser.push(line)).not.toThrow();
    expect(parser.push(line)).toEqual([]);
  }
  for (const line of fixture('claude-ok.jsonl')) parser.push(line);
  const sessionId = (JSON.parse(fixture('claude-ok.jsonl')[0]!) as { session_id: string }).session_id;
  const result = parser.finish({ code: 0, stderr: '', timedOut: false });
  expect(result).toMatchObject({ outcome: 'ok', text: 'xong', sessionId });
});

test.each([
  ['claude-quota-hit-limit.jsonl'],
  ['claude-quota-limit-reached.jsonl'],
  ['claude-quota-usage-limit.jsonl'],
])('%s với code 1: hết quota', (name) => {
  const { result } = run(name, { code: 1 });
  expect(result.outcome).toBe('quota_exhausted');
});

test('"hit your limit" đọc được giờ reset trong câu', () => {
  const { result } = run('claude-quota-hit-limit.jsonl', { code: 1 });
  expect(result.resetsAt).not.toBeNull();
});

test('câu trả lời thường nhắc "hit your limit"/"limit reached" với code 0 vẫn là ok', () => {
  const parser = createClaudeAdapter().createParser();
  parser.push(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, session_id: 's',
    result: "Tôi đã giải thích: you've hit your limit, usage limit reached, weekly limit reached.",
  }));
  expect(parser.finish({ code: 0, stderr: '', timedOut: false }).outcome).toBe('ok');
});

test('rate_limit_event bị từ chối + thoát lỗi (không có mẫu chữ) là hết quota, quota báo đã cạn', () => {
  const { result } = run('claude-quota-rejected.jsonl', { code: 1 });
  expect(result.outcome).toBe('quota_exhausted');
  expect(result.quota).toEqual({ usedPercent: 1, resetsAt: 1793792400000 });
});

test('rate_limit_event bị từ chối nhưng lượt thoát êm (mã 0, không lỗi) vẫn là ok', () => {
  const parser = createClaudeAdapter().createParser();
  for (const line of fixture('claude-quota-rejected.jsonl')) {
    const m = JSON.parse(line) as { type: string };
    if (m.type !== 'result') parser.push(line);
  }
  parser.push(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'xong', session_id: 's' }));
  expect(parser.finish({ code: 0, stderr: '', timedOut: false }).outcome).toBe('ok');
});

test('rate_limit_event allowed không bao giờ biến lỗi thường thành hết quota', () => {
  const parser = createClaudeAdapter().createParser();
  for (const line of fixture('claude-ok.jsonl')) parser.push(line);
  const r = parser.finish({ code: 1, stderr: 'boom', timedOut: false });
  expect(r.outcome).toBe('error');
  expect(r.quota!.usedPercent).toBeLessThan(1);
});
