import type { ProviderId, ProviderState, Task, TaskStatus, VEvent } from '@voragent/shared';

export type Column = 'Chờ' | 'Đang chạy' | 'Chờ bạn' | 'Xong' | 'Lỗi';

/** Thứ tự cột trên bảng. */
export const COLUMNS: Column[] = ['Chờ', 'Đang chạy', 'Chờ bạn', 'Xong', 'Lỗi'];

const STATUSES: ReadonlySet<string> = new Set<TaskStatus>([
  'queued', 'running', 'waiting_quota', 'awaiting_user', 'failed', 'closed',
]);

/**
 * Task đã bắt đầu chạy mà không có nhánh riêng: thư mục không phải repo git, agent làm việc trực tiếp ở đó.
 * Task repo git còn xếp hàng chưa có workspacePath nên không bị coi là không cách ly.
 */
export function isUnisolated(task: Task): boolean {
  return task.workspacePath !== null && task.branch === null;
}

export function columnOf(status: TaskStatus): Column {
  switch (status) {
    case 'queued':
    case 'waiting_quota':
      return 'Chờ';
    case 'running':
      return 'Đang chạy';
    case 'awaiting_user':
      return 'Chờ bạn';
    case 'closed':
      return 'Xong';
    case 'failed':
      return 'Lỗi';
  }
}

export interface UiState {
  tasks: Map<string, Task>;
  events: Map<string, VEvent[]>;
  providers: Map<ProviderId, ProviderState>;
}

/**
 * Thuần: trả state mới, không sửa state cũ. Nối event (sắp theo id, bỏ trùng id) và cập nhật task
 * khi gặp STATE_CHANGED {status} hoặc TURN_STARTED {provider}. Event của task chưa biết vẫn được lưu.
 */
export function applyEvent(s: UiState, e: VEvent): UiState {
  const events = new Map(s.events);
  const cur = events.get(e.taskId) ?? [];
  if (!cur.some((x) => x.id === e.id)) {
    events.set(e.taskId, [...cur, e].sort((a, b) => a.id - b.id));
  }

  let tasks = s.tasks;
  const t = s.tasks.get(e.taskId);
  if (t) {
    let patch: Partial<Task> | null = null;
    if (e.type === 'STATE_CHANGED' && typeof e.data.status === 'string' && STATUSES.has(e.data.status)) {
      patch = { status: e.data.status as TaskStatus };
    } else if (e.type === 'TURN_STARTED' && typeof e.data.provider === 'string') {
      patch = { currentProvider: e.data.provider };
    }
    if (patch) {
      tasks = new Map(s.tasks);
      tasks.set(t.id, { ...t, ...patch, updatedAt: e.ts });
    }
  }
  return { ...s, tasks, events };
}

export interface TranscriptItem {
  kind: 'user' | 'agent' | 'tool' | 'handoff' | 'error';
  text: string;
  ts: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Chuyển dòng sự kiện thành danh sách hiển thị. Văn bản liên tiếp của agent được gộp thành một mục. */
export function transcript(events: VEvent[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  const toolIdx = new Map<string, number>();
  const toolParts = new Map<number, { name: string; args: string; result: string | null }>();
  let lastIsAgent = false;

  const renderTool = (i: number): void => {
    const p = toolParts.get(i);
    const item = out[i];
    if (!p || !item) return;
    item.text = [p.name, p.args].filter((x) => x !== '').join(' ') + (p.result !== null ? `\n→ ${p.result}` : '');
  };

  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const d = e.data;
    switch (e.type) {
      case 'TURN_STARTED':
        out.push({ kind: 'user', text: str(d.message), ts: e.ts });
        lastIsAgent = false;
        break;
      case 'TEXT_MESSAGE_CONTENT': {
        const piece = str(d.delta) || str(d.text);
        const last = out[out.length - 1];
        if (lastIsAgent && last) last.text += piece;
        else out.push({ kind: 'agent', text: piece, ts: e.ts });
        lastIsAgent = true;
        break;
      }
      case 'TOOL_CALL_START': {
        const name = str(d.toolCallName);
        out.push({ kind: 'tool', text: name, ts: e.ts });
        const i = out.length - 1;
        toolParts.set(i, { name, args: '', result: null });
        const id = str(d.toolCallId);
        if (id !== '') toolIdx.set(id, i);
        lastIsAgent = false;
        break;
      }
      case 'TOOL_CALL_ARGS':
      case 'TOOL_CALL_RESULT': {
        const i = toolIdx.get(str(d.toolCallId));
        const p = i === undefined ? undefined : toolParts.get(i);
        if (i === undefined || !p) break;
        if (e.type === 'TOOL_CALL_ARGS') p.args += str(d.delta);
        else p.result = str(d.content);
        renderTool(i);
        break;
      }
      case 'HANDOFF':
        out.push({ kind: 'handoff', text: `🔁 chuyển từ ${str(d.from)} sang ${str(d.to)}`, ts: e.ts });
        lastIsAgent = false;
        break;
      case 'RUN_ERROR':
        out.push({ kind: 'error', text: str(d.error), ts: e.ts });
        lastIsAgent = false;
        break;
      default:
        break;
    }
  }
  return out;
}

/** Số lần bàn giao của một task (đếm HANDOFF). */
export function handoffCount(events: VEvent[] | undefined): number {
  return events ? events.filter((e) => e.type === 'HANDOFF').length : 0;
}

/** Gộp event đã tải (GET /api/tasks/:id) vào state mà KHÔNG đổi status task. Thuần; bỏ trùng id, sắp theo id. */
export function mergeEvents(s: UiState, taskId: string, incoming: VEvent[]): UiState {
  const byId = new Map<number, VEvent>();
  for (const e of s.events.get(taskId) ?? []) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  const events = new Map(s.events);
  events.set(taskId, [...byId.values()].sort((a, b) => a.id - b.id));
  return { ...s, events };
}
