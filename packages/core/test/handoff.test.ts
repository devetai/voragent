import type { Task, Turn, VEvent } from '@voragent/shared';
import { describe, expect, it } from 'vitest';
import { buildHandoff } from '../src/handoff.js';

const CLOSING = 'Tiếp tục công việc từ đây. Kiểm tra lại trạng thái file trước khi sửa thêm.';

const task: Task = {
  id: 't1', seq: 1, title: 'T', repoPath: '/r', workspacePath: '/w', branch: 'b', baseCommit: null,
  mode: 'head-commit', priority: null, status: 'running', currentProvider: 'claude', createdAt: 0, updatedAt: 0,
};

function turn(index: number, message: string, answer: string | null = null): Turn {
  return { id: `u${index}`, taskId: 't1', index, message, status: answer === null ? 'running' : 'done', runId: null, answer, attempts: 1 };
}

let nextId = 1;
function ev(type: VEvent['type'], data: Record<string, unknown>, runId: string | null = 'r1'): VEvent {
  return { id: nextId++, taskId: 't1', runId, ts: 0, source: 'managed', type, data };
}
function tool(id: string, name: string, args?: string, runId: string | null = 'r1'): VEvent[] {
  const out = [ev('TOOL_CALL_START', { toolCallId: id, toolCallName: name }, runId)];
  if (args !== undefined) out.push(ev('TOOL_CALL_ARGS', { toolCallId: id, delta: args }, runId));
  return out;
}

const summary = { status: ' M a.ts', diff: 'DIFFBODY', commits: ['abc one', 'def two'] };

function build(over: Partial<Parameters<typeof buildHandoff>[0]> = {}): string {
  return buildHandoff({
    task, turns: [turn(0, 'Làm tính năng X', 'xong')], events: [], fromProvider: 'claude', reason: 'quota',
    summary, maxChars: 24000, ...over,
  });
}

describe('buildHandoff', () => {
  it('has all sections in order with verbatim request and closing', () => {
    const out = build({
      events: [...tool('a', 'Read', '{"p":1}'), ev('FILE_CHANGED', { path: 'x' }), ev('TEXT_MESSAGE_CONTENT', { delta: 'final words' })],
    });
    const heads = ['# Bàn giao từ claude', '## Yêu cầu gốc', '## Các lượt trước', '## Những gì đã làm',
      '## Câu trả lời cuối của agent trước', '## Trạng thái git'];
    const pos = heads.map((h) => out.indexOf(h));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(out).toContain('Làm tính năng X');
    expect(out).toContain('hết quota');
    expect(out).toContain('final words');
    expect(out).toContain('abc one');
    expect(out).toContain('DIFFBODY');
    expect(out.trimEnd().endsWith(CLOSING)).toBe(true);
  });

  it('mentions daemon bị ngắt when interrupted', () => {
    expect(build({ reason: 'interrupted' })).toContain('daemon bị ngắt');
  });

  it('keeps a 100000-char diff within maxChars', () => {
    const out = build({ summary: { ...summary, diff: 'd'.repeat(100000) }, maxChars: 24000 });
    expect(out.length).toBeLessThanOrEqual(24000);
    expect(out).toContain('Làm tính năng X');
    expect(out.trimEnd().endsWith(CLOSING)).toBe(true);
    expect(out).toContain('…');
  });

  it('keeps the END of a cut diff', () => {
    const diff = 'a'.repeat(5000) + 'THE_END';
    const out = build({ summary: { ...summary, diff }, maxChars: 1500 });
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out).toContain('THE_END');
  });

  it('cuts the actions list when the diff alone is not enough', () => {
    const events = Array.from({ length: 60 }, (_, i) => tool(`c${i}`, 'Bash', 'x'.repeat(100))).flat();
    const big = { ...summary, diff: 'd'.repeat(5000) };
    const full = build({ events, summary: big });
    const out = build({ events, summary: big, maxChars: 1200 });
    expect(full.length).toBeGreaterThan(1200);
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out).toContain('Làm tính năng X');
    expect(out.trimEnd().endsWith(CLOSING)).toBe(true);
  });

  it('works with only turn 0, no events, no tool calls', () => {
    const out = build({ turns: [turn(0, 'only')] });
    expect(out).toContain('only');
    expect(out).toContain('## Những gì đã làm');
    expect(out).toContain('0 file');
  });

  it('keeps only the last 60 tool lines', () => {
    const events = Array.from({ length: 70 }, (_, i) => tool(`c${i}`, `Tool${i}`)).flat();
    const out = build({ events });
    expect(out).not.toContain('- Tool9\n');
    expect(out).toContain('- Tool10\n');
    expect(out).toContain('- Tool69\n');
    expect(out.match(/^- Tool/gm)).toHaveLength(60);
  });

  it('squeezes args to one line and cuts at 120 chars with ellipsis', () => {
    const out = build({ events: [...tool('a', 'Edit', `{"a":\n   "${'y'.repeat(200)}"}`)] });
    const line = out.split('\n').find((l) => l.startsWith('- Edit '))!;
    const part = line.slice('- Edit '.length);
    expect(part.length).toBe(120);
    expect(part.endsWith('…')).toBe(true);
    expect(part).toContain('{"a": "yyy');
  });

  it('matches args by toolCallId when interleaved', () => {
    const out = build({
      events: [
        ev('TOOL_CALL_START', { toolCallId: 'a', toolCallName: 'One' }),
        ev('TOOL_CALL_START', { toolCallId: 'b', toolCallName: 'Two' }),
        ev('TOOL_CALL_ARGS', { toolCallId: 'b', delta: 'ARGB' }),
        ev('TOOL_CALL_ARGS', { toolCallId: 'a', delta: 'ARGA' }),
      ],
    });
    expect(out).toContain('- One ARGA');
    expect(out).toContain('- Two ARGB');
  });

  it('counts duplicate FILE_CHANGED paths once', () => {
    const out = build({ events: [ev('FILE_CHANGED', { path: 'a' }), ev('FILE_CHANGED', { path: 'a' }), ev('FILE_CHANGED', { path: 'b' })] });
    expect(out).toContain('2 file');
  });

  it('cuts a long final answer to its tail and uses the latest run only', () => {
    const events = [
      ev('TEXT_MESSAGE_CONTENT', { delta: 'OLDRUN' }, 'r1'),
      ev('TEXT_MESSAGE_CONTENT', { delta: 'H'.repeat(1600) }, 'r2'),
      ev('TEXT_MESSAGE_CONTENT', { delta: 'TAIL' }, 'r2'),
      ev('TOOL_CALL_RESULT', {}, null),
    ];
    const out = build({ events });
    expect(out).not.toContain('OLDRUN');
    expect(out).toContain('TAIL');
    const section = out.split('## Câu trả lời cuối của agent trước')[1]!.split('## Trạng thái git')[0]!;
    expect(section.match(/H/g)!.length).toBe(1496);
  });

  it('formats earlier turns and handles a null answer', () => {
    const out = build({
      turns: [turn(0, 'req', 'a0'), turn(1, 'follow', 'Z'.repeat(600)), turn(2, 'pending', null)],
    });
    const sec = out.split('## Các lượt trước')[1]!.split('## Những gì đã làm')[0]!;
    expect(sec).toContain('Người dùng: follow');
    expect(sec.match(/Z/g)!.length).toBe(500);
    expect(sec).not.toContain('pending');
  });

  it('handles an empty diff and markdown headings in the request', () => {
    const msg = '## Yêu cầu gốc\n# Bàn giao từ x';
    const out = build({ turns: [turn(0, msg)], summary: { ...summary, diff: '' } });
    expect(out).toContain(msg);
    expect(out.trimEnd().endsWith(CLOSING)).toBe(true);
  });

  it('does not mutate inputs', () => {
    const turns = [turn(0, 'r', 'a')];
    const events = [...tool('a', 'Read', '{}')];
    const s = { ...summary, commits: ['c'] };
    const snap = JSON.stringify({ turns, events, s });
    build({ turns, events, summary: s });
    expect(JSON.stringify({ turns, events, s })).toBe(snap);
  });

  it('does not merge args of a toolCallId reused by another run', () => {
    const out = build({
      events: [
        ev('TOOL_CALL_START', { toolCallId: 'item_0', toolCallName: 'Bash' }, 'r1'),
        ev('TOOL_CALL_ARGS', { toolCallId: 'item_0', delta: 'FIRSTARGS' }, 'r1'),
        ev('TOOL_CALL_START', { toolCallId: 'item_0', toolCallName: 'Bash' }, 'r2'),
        ev('TOOL_CALL_ARGS', { toolCallId: 'item_0', delta: 'SECONDARGS' }, 'r2'),
      ],
    });
    expect(out).toContain('- Bash FIRSTARGS\n');
    expect(out).toContain('- Bash SECONDARGS\n');
    expect(out).not.toContain('FIRSTARGSSECONDARGS');
  });

  it('marks omitted lines when the 60-line cap applies', () => {
    const events = Array.from({ length: 70 }, (_, i) => tool(`c${i}`, `Tool${i}`)).flat();
    const out = build({ events });
    expect(out.match(/^- Tool/gm)).toHaveLength(60);
    expect(out).toContain('(đã lược 10 dòng cũ)\n- Tool10\n');
    expect(out).not.toContain('(chưa có)\nSố file');
  });

  it('shows the omission line alone when maxChars cuts every action', () => {
    const events = [...Array.from({ length: 5 }, (_, i) => tool(`c${i}`, `Tool${i}`, 'x'.repeat(100))).flat(), ev('FILE_CHANGED', { path: 'a' })];
    const full = build({ events, summary: { ...summary, diff: '' } });
    const out = build({ events, summary: { ...summary, diff: '' }, maxChars: full.length - 500 });
    const sec = out.split('## Những gì đã làm')[1]!.split('## Câu trả lời')[0]!;
    expect(sec).toContain('(đã lược 5 dòng cũ)');
    expect(sec).not.toContain('(chưa có)');
    expect(sec).not.toContain('- Tool');
    expect(sec).toContain('1 file');
    expect(out.length).toBeLessThanOrEqual(full.length - 500);
  });

  it('shows (chưa có) only when there were no tool calls', () => {
    const out = build({ events: [] });
    const sec = out.split('## Những gì đã làm')[1]!.split('## Câu trả lời')[0]!;
    expect(sec).toContain('(chưa có)');
    expect(sec).not.toContain('đã lược');
  });

  it.each([24000, 1500, 1200])('keeps length within %i with many actions and a huge diff', (max) => {
    const events = Array.from({ length: 80 }, (_, i) => tool(`c${i}`, 'Bash', 'x'.repeat(100))).flat();
    const out = build({ events, summary: { ...summary, diff: 'd'.repeat(100000) }, maxChars: max });
    expect(out.length).toBeLessThanOrEqual(max);
    expect(out.trimEnd().endsWith(CLOSING)).toBe(true);
  });
});
