import { describe, expect, it } from 'vitest';
import type { EventType, ProviderState, Task, TaskStatus, VEvent } from '@voragent/shared';
import { applyEvent, columnOf, isUnisolated, mergeEvents, transcript } from '../src/state';
import type { UiState } from '../src/state';

const task = (id: string, status: TaskStatus = 'queued'): Task => ({
  id, seq: 1, title: 't', repoPath: '/r', workspacePath: null, branch: null, baseCommit: null,
  mode: 'head-dirty-commit', priority: null, status, currentProvider: null, createdAt: 0, updatedAt: 0,
});

let nextId = 1;
const ev = (type: EventType, data: Record<string, unknown> = {}, o: Partial<VEvent> = {}): VEvent => ({
  id: nextId++, taskId: 't1', runId: null, ts: 1000 + nextId, source: 'managed', type, data, ...o,
});

const empty = (): UiState => ({ tasks: new Map(), events: new Map(), providers: new Map<string, ProviderState>() });
const withTask = (status: TaskStatus = 'queued'): UiState => ({ ...empty(), tasks: new Map([['t1', task('t1', status)]]) });

describe('columnOf', () => {
  it('ánh xạ đủ mọi trạng thái', () => {
    const want: Record<TaskStatus, string> = {
      queued: 'Chờ', waiting_quota: 'Chờ', running: 'Đang chạy',
      awaiting_user: 'Chờ bạn', closed: 'Xong', failed: 'Lỗi',
    };
    for (const [s, c] of Object.entries(want)) expect(columnOf(s as TaskStatus)).toBe(c);
  });
});

describe('applyEvent', () => {
  it('STATE_CHANGED đổi status của task và nối event', () => {
    const s0 = withTask('running');
    const e = ev('STATE_CHANGED', { status: 'failed' });
    const s1 = applyEvent(s0, e);
    expect(s1.tasks.get('t1')?.status).toBe('failed');
    expect(s1.events.get('t1')).toEqual([e]);
  });

  it('thuần: không sửa state đầu vào', () => {
    const s0 = withTask('running');
    const before = s0.tasks.get('t1');
    applyEvent(s0, ev('STATE_CHANGED', { status: 'closed' }));
    expect(s0.tasks.get('t1')).toBe(before);
    expect(s0.tasks.get('t1')?.status).toBe('running');
    expect(s0.events.size).toBe(0);
  });

  it('event của task lạ: vẫn lưu event, không bịa task', () => {
    const s1 = applyEvent(empty(), ev('STATE_CHANGED', { status: 'failed' }, { taskId: 'zzz' }));
    expect(s1.tasks.size).toBe(0);
    expect(s1.events.get('zzz')).toHaveLength(1);
  });

  it('sắp theo id và bỏ event trùng id', () => {
    const a = ev('TEXT_MESSAGE_CONTENT', { delta: 'a' }, { id: 10 });
    const b = ev('TEXT_MESSAGE_CONTENT', { delta: 'b' }, { id: 5 });
    let s = applyEvent(withTask(), a);
    s = applyEvent(s, b);
    s = applyEvent(s, a);
    expect(s.events.get('t1')?.map((e) => e.id)).toEqual([5, 10]);
  });

  it('STATE_CHANGED với status không hợp lệ bị bỏ qua; TASK_CREATED không làm gì với task', () => {
    const s = applyEvent(withTask('running'), ev('STATE_CHANGED', { status: 'bogus' }));
    expect(s.tasks.get('t1')?.status).toBe('running');
  });

  it('TURN_STARTED cập nhật nền tảng hiện tại', () => {
    const s = applyEvent(withTask('queued'), ev('TURN_STARTED', { message: 'x', provider: 'codex' }));
    expect(s.tasks.get('t1')?.currentProvider).toBe('codex');
  });
});

describe('transcript', () => {
  it('chuỗi cơ bản: user, agent (gộp), tool, handoff', () => {
    const t = transcript([
      ev('TURN_STARTED', { message: 'làm đi' }),
      ev('TEXT_MESSAGE_CONTENT', { delta: 'Xin ' }),
      ev('TEXT_MESSAGE_CONTENT', { delta: 'chào' }),
      ev('TOOL_CALL_START', { toolCallName: 'Read' }),
      ev('HANDOFF', { from: 'claude', to: 'codex' }),
    ]);
    expect(t.map((x) => x.kind)).toEqual(['user', 'agent', 'tool', 'handoff']);
    expect(t[0]?.text).toBe('làm đi');
    expect(t[1]?.text).toBe('Xin chào');
    expect(t[2]?.text).toContain('Read');
    expect(t[3]?.text).toBe('🔁 chuyển từ claude sang codex');
  });

  it('RUN_ERROR thành kind error', () => {
    const t = transcript([ev('RUN_ERROR', { error: 'hỏng' })]);
    expect(t).toMatchObject([{ kind: 'error', text: 'hỏng' }]);
  });

  it('nhiều lượt: văn bản sau tool không gộp với văn bản trước; lượt mới ngắt khối', () => {
    const t = transcript([
      ev('TURN_STARTED', { message: 'một' }),
      ev('TEXT_MESSAGE_CONTENT', { text: 'a' }),
      ev('TOOL_CALL_START', { toolCallName: 'Bash' }),
      ev('TEXT_MESSAGE_CONTENT', { delta: 'b' }),
      ev('TURN_STARTED', { message: 'hai' }),
      ev('TEXT_MESSAGE_CONTENT', { delta: 'c' }),
    ]);
    expect(t.map((x) => [x.kind, x.text])).toEqual([
      ['user', 'một'], ['agent', 'a'], ['tool', 'Bash'], ['agent', 'b'], ['user', 'hai'], ['agent', 'c'],
    ]);
  });

  it('TOOL_CALL_ARGS và RESULT nối vào dòng tool đúng toolCallId', () => {
    const t = transcript([
      ev('TOOL_CALL_START', { toolCallId: 'x', toolCallName: 'Read' }),
      ev('TOOL_CALL_ARGS', { toolCallId: 'x', delta: '{"path":"a"}' }),
      ev('TOOL_CALL_RESULT', { toolCallId: 'x', content: 'nội dung' }),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]?.text).toBe('Read {"path":"a"}\n→ nội dung');
  });

  it('bỏ qua event không hiển thị và không sửa mảng đầu vào', () => {
    const input = [ev('USAGE', {}), ev('QUOTA_UPDATED', {}), ev('TEXT_MESSAGE_CONTENT', { delta: 'z' }, { id: 1 })];
    const copy = [...input];
    expect(transcript(input)).toHaveLength(1);
    expect(input).toEqual(copy);
  });
});

describe('mergeEvents', () => {
  it('gộp, bỏ trùng, sắp theo id, không đổi status và không sửa đầu vào', () => {
    const s0 = applyEvent(withTask('running'), ev('TEXT_MESSAGE_CONTENT', { delta: 'x' }, { id: 7 }));
    const stale = ev('STATE_CHANGED', { status: 'queued' }, { id: 3 });
    const s1 = mergeEvents(s0, 't1', [ev('TEXT_MESSAGE_CONTENT', { delta: 'x' }, { id: 7 }), stale]);
    expect(s1.events.get('t1')?.map((e) => e.id)).toEqual([3, 7]);
    expect(s1.tasks.get('t1')?.status).toBe('running');
    expect(s0.events.get('t1')).toHaveLength(1);
  });
});

describe('isUnisolated', () => {
  const t = (over: Partial<Task>): Task => ({ ...task('t1'), ...over });
  it('task repo git còn xếp hàng (chưa có worktree) không bị coi là không cách ly', () => {
    expect(isUnisolated(t({ status: 'queued', workspacePath: null, branch: null }))).toBe(false);
    expect(isUnisolated(t({ status: 'waiting_quota', workspacePath: null, branch: null }))).toBe(false);
  });
  it('task không phải repo git đã bắt đầu (có workspacePath, không có branch) là không cách ly', () => {
    expect(isUnisolated(t({ status: 'running', workspacePath: '/plain', branch: null }))).toBe(true);
    expect(isUnisolated(t({ status: 'awaiting_user', workspacePath: '/plain', branch: null }))).toBe(true);
  });
  it('task repo git đã bắt đầu (có nhánh) không bị coi là không cách ly', () => {
    expect(isUnisolated(t({ status: 'running', workspacePath: '/wt', branch: 'voragent/task-1' }))).toBe(false);
  });
});
