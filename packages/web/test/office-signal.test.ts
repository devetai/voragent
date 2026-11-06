import { describe, expect, it } from 'vitest';
import type { EventType, VEvent } from '@voragent/shared';
import {
  IDLE_SIGNAL,
  baseName,
  clip,
  detectClosure,
  detectHandoff,
  deriveSignal,
  recentActivity,
} from '../src/office/liveSignal';

const BASE_TS = 1_700_000_000_000; // chia hết cho 400 nên trùng mốc khung thời gian
let seq = 0;

function ev(
  type: EventType,
  data: Record<string, unknown> = {},
  over: Partial<VEvent> = {},
): VEvent {
  seq += 1;
  return {
    id: seq,
    taskId: 'task-1',
    runId: 'run-1',
    ts: BASE_TS + seq,
    source: 'managed',
    type,
    data,
    ...over,
  };
}

describe('liveSignal - tiện ích chuỗi', () => {
  it('clip gộp khoảng trắng, cắt ngắn kèm dấu ba chấm', () => {
    expect(clip('  xin   chào \n bạn ', 40)).toBe('xin chào bạn');
    expect(clip('abcdef', 4)).toBe('abc…');
    expect(clip('bất kỳ', 1)).toBe('');
  });

  it('baseName lấy tên tệp cuối với cả hai kiểu dấu phân cách', () => {
    expect(baseName('packages/web/src/App.tsx')).toBe('App.tsx');
    expect(baseName('packages\\core\\src\\daemon.ts')).toBe('daemon.ts');
    expect(baseName('')).toBe('');
  });
});

describe('liveSignal - deriveSignal', () => {
  it('không có sự kiện thì trả tín hiệu rảnh', () => {
    expect(deriveSignal(undefined)).toBe(IDLE_SIGNAL);
    expect(deriveSignal([])).toBe(IDLE_SIGNAL);
    expect(deriveSignal([ev('USAGE', { any: 1 })])).toBe(IDLE_SIGNAL);
  });

  it('TURN_STARTED cho thấy agent vừa nhận việc', () => {
    const s = deriveSignal([ev('TURN_STARTED', { message: 'Sửa lỗi đăng nhập' })]);
    expect(s.kind).toBe('thinking');
    expect(s.label).toBe('Nhận việc');
    expect(s.detail).toContain('Sửa lỗi đăng nhập');
    expect(s.severity).toBe(0);
  });

  it('sự kiện mới nhất thắng, không phụ thuộc thứ tự mảng', () => {
    const text = ev('TEXT_MESSAGE_CONTENT', { delta: 'đang viết' });
    const tool = ev('TOOL_CALL_START', { toolCallName: 'Bash' });

    const ordered = deriveSignal([text, tool]);
    const shuffled = deriveSignal([tool, text]);

    expect(ordered.kind).toBe('tool');
    expect(ordered.label).toBe('Bash');
    expect(shuffled.kind).toBe('tool');
    expect(shuffled.key).toBe(ordered.key);
  });

  it('gộp các delta chữ liền nhau thành một câu đọc được', () => {
    const parts = ['Tôi đang ', 'kiểm tra ', 'lại phần ', 'đăng nhập.'];
    const events = parts.map((delta) => ev('TEXT_MESSAGE_CONTENT', { delta }));
    const s = deriveSignal(events);
    expect(s.kind).toBe('thinking');
    expect(s.label).toBe('Đang viết');
    expect(s.detail).toBe('Tôi đang kiểm tra lại phần đăng nhập.');
  });

  it('không cộng dồn chữ của lượt chạy khác', () => {
    const oldRun = ev('TEXT_MESSAGE_CONTENT', { delta: 'câu cũ ' }, { runId: 'run-0' });
    const newRun = ev('TEXT_MESSAGE_CONTENT', { delta: 'câu mới' }, { runId: 'run-1' });
    expect(deriveSignal([oldRun, newRun]).detail).toBe('câu mới');
  });

  it('tín hiệu chữ giữ nguyên key trong cùng khung 400ms để giảm re-render', () => {
    const a = ev('TEXT_MESSAGE_CONTENT', { delta: 'một' }, { ts: BASE_TS });
    const b = ev('TEXT_MESSAGE_CONTENT', { delta: ' hai' }, { ts: BASE_TS + 100 });
    const c = ev('TEXT_MESSAGE_CONTENT', { delta: ' ba' }, { ts: BASE_TS + 500 });

    const sa = deriveSignal([a]);
    const sb = deriveSignal([a, b]);
    const sc = deriveSignal([a, b, c]);

    expect(sb.key).toBe(sa.key);
    expect(sc.key).not.toBe(sa.key);
  });

  it('TOOL_CALL_START hiển thị tên công cụ, thiếu tên không ném lỗi', () => {
    expect(deriveSignal([ev('TOOL_CALL_START', { toolCallName: 'Read' })]).label).toBe('Read');
    const s = deriveSignal([ev('TOOL_CALL_START', {})]);
    expect(s.kind).toBe('tool');
    expect(s.label).toBe('Công cụ');
  });

  it('FILE_CHANGED lấy tên tệp làm nhãn, giữ đường dẫn trong chi tiết', () => {
    const s = deriveSignal([ev('FILE_CHANGED', { path: 'packages\\web\\src\\state.ts' })]);
    expect(s.kind).toBe('file');
    expect(s.label).toBe('state.ts');
    expect(s.detail).toContain('state.ts');
    expect(deriveSignal([ev('FILE_CHANGED', {})]).label).toBe('Sửa tệp');
  });

  it('QUOTA_EXHAUSTED là cảnh báo mức 2 kèm giờ hồi phục', () => {
    const resetsAt = new Date(BASE_TS + 3_600_000).getTime();
    const s = deriveSignal([ev('QUOTA_EXHAUSTED', { resetsAt })]);
    expect(s.kind).toBe('quota');
    expect(s.severity).toBe(2);
    expect(s.detail).toMatch(/\d{2}:\d{2}/);

    const noTime = deriveSignal([ev('QUOTA_EXHAUSTED', {})]);
    expect(noTime.severity).toBe(2);
    expect(noTime.detail).not.toMatch(/\d{2}:\d{2}/);
  });

  it('HANDOFF tạo nhãn bàn giao sang agent đích', () => {
    const s = deriveSignal([ev('HANDOFF', { from: 'claude', to: 'codex' })]);
    expect(s.kind).toBe('handoff');
    expect(s.severity).toBe(1);
    expect(s.label).toContain('codex');
    expect(s.detail).toBe('claude → codex');
  });

  it('RUN_ERROR là cảnh báo mức 2, thiếu nội dung vẫn đọc được', () => {
    expect(deriveSignal([ev('RUN_ERROR', { error: 'exit 1' })]).detail).toBe('exit 1');
    const s = deriveSignal([ev('RUN_ERROR', {})]);
    expect(s.kind).toBe('error');
    expect(s.severity).toBe(2);
    expect(s.label).toBe('Gặp lỗi');
  });

  it('STATE_CHANGED đóng task thành tín hiệu hoàn thành, bỏ qua sự kiện xoá', () => {
    const closed = deriveSignal([ev('STATE_CHANGED', { status: 'closed' })]);
    expect(closed.kind).toBe('done');
    expect(closed.severity).toBe(1);

    const running = ev('TURN_STARTED', { message: 'làm việc' });
    const deleted = ev('STATE_CHANGED', { deleted: true });
    expect(deriveSignal([running, deleted]).kind).toBe('thinking');
  });

  it('STATE_CHANGED thất bại báo lỗi, chờ duyệt báo cần chú ý', () => {
    expect(deriveSignal([ev('STATE_CHANGED', { status: 'failed' })]).kind).toBe('error');
    const waiting = deriveSignal([ev('STATE_CHANGED', { status: 'awaiting_user' })]);
    expect(waiting.label).toBe('Chờ bạn');
    expect(waiting.severity).toBe(1);
  });

  it('không sửa mảng đầu vào', () => {
    const events = [ev('TOOL_CALL_START', { toolCallName: 'Bash' })];
    const snapshot = events.map((e) => e.id);
    deriveSignal(events);
    expect(events.map((e) => e.id)).toEqual(snapshot);
  });
});

describe('liveSignal - recentActivity', () => {
  it('trả hoạt động mới nhất trước, bỏ qua token chữ', () => {
    const events = [
      ev('TURN_STARTED', { message: 'Tạo trang đăng nhập' }),
      ev('TEXT_MESSAGE_CONTENT', { delta: 'a' }),
      ev('TOOL_CALL_START', { toolCallName: 'Bash' }),
      ev('FILE_CHANGED', { path: 'src/login.tsx' }),
    ];
    const items = recentActivity(events, 5);
    expect(items.map((i) => i.kind)).toEqual(['file', 'tool', 'thinking']);
    expect(items[0]?.text).toBe('Sửa login.tsx');
    expect(items[2]?.text).toContain('Tạo trang đăng nhập');
  });

  it('tôn trọng giới hạn và trả rỗng khi không có gì đáng chú ý', () => {
    const events = [
      ev('TOOL_CALL_START', { toolCallName: 'A' }),
      ev('TOOL_CALL_START', { toolCallName: 'B' }),
      ev('TOOL_CALL_START', { toolCallName: 'C' }),
    ];
    expect(recentActivity(events, 2).map((i) => i.text)).toEqual(['Chạy C', 'Chạy B']);
    expect(recentActivity([], 5)).toEqual([]);
    expect(recentActivity(events, 0)).toEqual([]);
    expect(recentActivity([ev('USAGE', {})], 5)).toEqual([]);
  });

  it('mô tả handoff và lỗi bằng tiếng Việt dễ đọc', () => {
    const events = [
      ev('HANDOFF', { from: 'claude', to: 'codex' }),
      ev('RUN_ERROR', { error: 'timeout' }),
    ];
    const items = recentActivity(events, 5);
    expect(items[0]?.text).toBe('timeout');
    expect(items[1]?.text).toBe('Bàn giao claude → codex');
  });
});

describe('liveSignal - phát hiện mốc đặc biệt', () => {
  it('detectHandoff lấy lần bàn giao gần nhất kèm cờ thủ công', () => {
    const events = [
      ev('HANDOFF', { from: 'claude', to: 'codex' }),
      ev('HANDOFF', { from: 'codex', to: 'antigravity', manual: true }, { runId: null }),
    ];
    const info = detectHandoff(events);
    expect(info?.from).toBe('codex');
    expect(info?.to).toBe('antigravity');
    expect(info?.manual).toBe(true);
    expect(detectHandoff([ev('TURN_STARTED', { message: 'x' })])).toBeNull();
  });

  it('detectHandoff bỏ qua bàn giao đã cũ khi có cửa sổ thời gian', () => {
    const events = [ev('HANDOFF', { from: 'a', to: 'b' }, { ts: BASE_TS })];
    expect(detectHandoff(events, { windowMs: 5_000, now: BASE_TS + 1_000 })).not.toBeNull();
    expect(detectHandoff(events, { windowMs: 5_000, now: BASE_TS + 60_000 })).toBeNull();
  });

  it('detectClosure nhận đúng mốc đóng task và lọc theo thời gian', () => {
    const events = [
      ev('STATE_CHANGED', { status: 'running' }),
      ev('STATE_CHANGED', { status: 'closed' }, { ts: BASE_TS + 2_000 }),
    ];
    expect(detectClosure(events)?.ts).toBe(BASE_TS + 2_000);
    expect(detectClosure(events, { windowMs: 500, now: BASE_TS + 10_000 })).toBeNull();
    expect(detectClosure([ev('STATE_CHANGED', { status: 'failed' })])).toBeNull();
  });
});
