import type { VEvent } from '@voragent/shared';

/**
 * Tín hiệu "đang sống" của một agent, suy ra thuần từ dòng sự kiện.
 * Không phụ thuộc three.js để có thể kiểm thử bằng vitest mà không cần WebGL.
 */
export type SignalKind =
  | 'idle'     // Không có việc gì đáng chú ý
  | 'thinking' // Nhận việc / đang viết
  | 'tool'     // Đang chạy công cụ
  | 'file'     // Vừa sửa tệp
  | 'quota'    // Cạn hạn mức, tạm nghỉ
  | 'handoff'  // Vừa bàn giao
  | 'error'    // Lỗi
  | 'done';    // Vừa đóng task

export interface AgentSignal {
  kind: SignalKind;
  /** Nhãn ngắn hiển thị trên chip trên đầu nhân vật. */
  label: string;
  /** Chi tiết một dòng cho thẻ hover. */
  detail: string;
  /** 0 = bình thường, 1 = cần chú ý, 2 = cảnh báo. */
  severity: 0 | 1 | 2;
  /** Mốc thời gian của sự kiện tạo tín hiệu (đã làm tròn với tín hiệu chữ). */
  since: number;
  /** id sự kiện mới nhất đã quét. */
  eventId: number;
  /**
   * Khoá ổn định để memo hoá component: cùng khoá nghĩa là không cần vẽ lại.
   * Tín hiệu chữ dùng khoá theo khung thời gian nên không làm re-render mỗi token.
   */
  key: string;
}

export const IDLE_SIGNAL: AgentSignal = {
  kind: 'idle',
  label: 'Rảnh',
  detail: '',
  severity: 0,
  since: 0,
  eventId: 0,
  key: 'idle',
};

/** Màu ngữ nghĩa của từng loại tín hiệu (Warm Cozy Tech, không neon). */
export const SIGNAL_TONE: Record<SignalKind, string> = {
  idle: '#94A3B8',
  thinking: '#2563EB',
  tool: '#7C3AED',
  file: '#059669',
  quota: '#EA580C',
  handoff: '#8B5CF6',
  error: '#DC2626',
  done: '#16A34A',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Gộp khoảng trắng và cắt bớt để nhãn luôn nằm gọn một dòng. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (max <= 1) return '';
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Tên tệp cuối cùng của một đường dẫn, chấp nhận cả `\` và `/`. */
export function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter((part) => part !== '');
  return parts.length > 0 ? (parts[parts.length - 1] as string) : path;
}

function clockOf(ts: number | null): string {
  if (ts === null) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface DeriveSignalOptions {
  /**
   * Gộp các tín hiệu chữ vào cùng một khung thời gian (ms) để tránh re-render mỗi token.
   * Mặc định 400ms ~ 2.5 lần cập nhật/giây. Đặt 0 để tắt.
   */
  textBucketMs?: number;
}

/**
 * Chọn sự kiện đáng chú ý mới nhất (id lớn nhất) rồi dịch thành tín hiệu hiển thị.
 * Không sửa mảng đầu vào; bỏ qua mọi sự kiện thiếu trường thay vì ném lỗi.
 */
export function deriveSignal(
  events: VEvent[] | null | undefined,
  opts: DeriveSignalOptions = {},
): AgentSignal {
  if (!events || events.length === 0) return IDLE_SIGNAL;
  const bucketMs = Math.max(0, opts.textBucketMs ?? 400);

  let best: VEvent | null = null;
  let bestIndex = -1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || !isSignalEvent(e)) continue;
    if (best === null || e.id > best.id) {
      best = e;
      bestIndex = i;
    }
  }
  if (best === null) return IDLE_SIGNAL;

  // Ghép các delta chữ liền nhau để chip/hover có câu đọc được thay vì một mảnh vụn.
  const trailingText = (): string => {
    let out = '';
    for (let i = bestIndex; i >= 0 && out.length < 200; i--) {
      const e = events[i];
      if (!e || e.type !== 'TEXT_MESSAGE_CONTENT') break;
      if (e.runId !== best?.runId) break;
      out = (str(e.data.delta) || str(e.data.text)) + out;
    }
    return out;
  };

  const make = (
    kind: SignalKind,
    label: string,
    detail: string,
    severity: 0 | 1 | 2,
    since: number,
  ): AgentSignal => ({
    kind,
    label: clip(label, 28),
    detail: clip(detail, 120),
    severity,
    since,
    eventId: best ? best.id : 0,
    key: kind === 'thinking' ? `${kind}:${since}` : `${kind}:${best ? best.id : 0}`,
  });

  const ts = best.ts;
  const bucketedTs = bucketMs > 0 ? Math.floor(ts / bucketMs) * bucketMs : ts;

  switch (best.type) {
    case 'TURN_STARTED': {
      const message = str(best.data.message);
      return make('thinking', 'Nhận việc', message || 'Bắt đầu một lượt mới', 0, bucketedTs);
    }
    case 'RUN_STARTED': {
      const provider = str(best.data.provider);
      return make('thinking', 'Khởi động', provider ? `Đang chạy ${provider}` : 'Đang chạy', 0, bucketedTs);
    }
    case 'TEXT_MESSAGE_CONTENT': {
      const text = trailingText();
      return make('thinking', 'Đang viết', text || 'Đang viết câu trả lời', 0, bucketedTs);
    }
    case 'TOOL_CALL_START': {
      const name = str(best.data.toolCallName);
      return make('tool', name || 'Công cụ', name ? `Đang chạy ${name}` : 'Đang chạy công cụ', 0, ts);
    }
    case 'FILE_CHANGED': {
      const path = str(best.data.path);
      return make('file', path ? baseName(path) : 'Sửa tệp', path || 'Vừa thay đổi tệp', 0, ts);
    }
    case 'QUOTA_EXHAUSTED': {
      const resetsAt = num(best.data.resetsAt);
      const at = clockOf(resetsAt);
      return make('quota', 'Hết hạn mức', at ? `Tạm nghỉ đến ${at}` : 'Tạm nghỉ chờ hạn mức mới', 2, ts);
    }
    case 'HANDOFF': {
      const from = str(best.data.from);
      const to = str(best.data.to);
      const label = to ? `Bàn giao → ${to}` : 'Bàn giao';
      const detail = from && to ? `${from} → ${to}` : from || to || 'Bàn giao công việc';
      return make('handoff', label, detail, 1, ts);
    }
    case 'RUN_ERROR': {
      return make('error', 'Gặp lỗi', str(best.data.error) || 'Lượt chạy thất bại', 2, ts);
    }
    case 'STATE_CHANGED': {
      const status = str(best.data.status);
      if (status === 'closed') return make('done', 'Xong việc', 'Task đã đóng', 1, ts);
      if (status === 'failed') return make('error', 'Thất bại', 'Task chuyển sang trạng thái lỗi', 2, ts);
      if (status === 'awaiting_user') return make('handoff', 'Chờ bạn', 'Đang chờ bạn duyệt', 1, ts);
      return IDLE_SIGNAL;
    }
    default:
      return IDLE_SIGNAL;
  }
}

/** Sự kiện có mang thông tin hiển thị hay không. */
function isSignalEvent(e: VEvent): boolean {
  switch (e.type) {
    case 'TURN_STARTED':
    case 'RUN_STARTED':
    case 'TEXT_MESSAGE_CONTENT':
    case 'TOOL_CALL_START':
    case 'FILE_CHANGED':
    case 'QUOTA_EXHAUSTED':
    case 'HANDOFF':
    case 'RUN_ERROR':
      return true;
    case 'STATE_CHANGED':
      return e.data.deleted !== true && str(e.data.status) !== '';
    default:
      return false;
  }
}

export interface ActivityItem {
  id: number;
  ts: number;
  kind: Exclude<SignalKind, 'idle'>;
  text: string;
}

/**
 * Dòng hoạt động gần nhất cho màn hình TV / bảng tin, mới nhất đứng đầu.
 * Bỏ qua `TEXT_MESSAGE_CONTENT` vì mỗi token là một sự kiện, sẽ làm ngập bảng tin.
 * Đầu vào phải sắp xếp tăng dần theo `id` (đúng như `state.events`).
 */
export function recentActivity(
  events: VEvent[] | null | undefined,
  limit = 6,
): ActivityItem[] {
  if (!events || events.length === 0 || limit <= 0) return [];
  const out: ActivityItem[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i];
    if (!e) continue;
    const item = activityOf(e);
    if (item !== null) out.push(item);
  }
  return out;
}

function activityOf(e: VEvent): ActivityItem | null {
  const make = (kind: Exclude<SignalKind, 'idle'>, text: string): ActivityItem | null => {
    const flat = clip(text, 90);
    return flat === '' ? null : { id: e.id, ts: e.ts, kind, text: flat };
  };
  switch (e.type) {
    case 'TURN_STARTED':
      return make('thinking', `Nhận việc: ${str(e.data.message)}`);
    case 'RUN_STARTED': {
      const provider = str(e.data.provider);
      return make('thinking', provider ? `Khởi động ${provider}` : 'Khởi động lượt chạy');
    }
    case 'TOOL_CALL_START': {
      const name = str(e.data.toolCallName);
      return make('tool', name ? `Chạy ${name}` : 'Chạy công cụ');
    }
    case 'FILE_CHANGED': {
      const path = str(e.data.path);
      return make('file', path ? `Sửa ${baseName(path)}` : 'Sửa tệp');
    }
    case 'HANDOFF': {
      const from = str(e.data.from);
      const to = str(e.data.to);
      if (from !== '' && to !== '') return make('handoff', `Bàn giao ${from} → ${to}`);
      return make('handoff', 'Bàn giao công việc');
    }
    case 'QUOTA_EXHAUSTED': {
      const at = clockOf(num(e.data.resetsAt));
      return make('quota', at ? `Cạn hạn mức, nghỉ đến ${at}` : 'Cạn hạn mức');
    }
    case 'RUN_ERROR':
      return make('error', str(e.data.error) || 'Lượt chạy thất bại');
    case 'STATE_CHANGED': {
      const status = str(e.data.status);
      if (status === 'closed') return make('done', 'Đóng task');
      if (status === 'failed') return make('error', 'Task thất bại');
      if (status === 'awaiting_user') return make('handoff', 'Chờ người dùng duyệt');
      return null;
    }
    default:
      return null;
  }
}

export interface HandoffInfo {
  from: string;
  to: string;
  ts: number;
  eventId: number;
  manual: boolean;
}

export interface HandoffOptions {
  /** Chỉ nhận bàn giao trong khoảng này tính đến `now` (ms). Bỏ trống = lấy lần gần nhất. */
  windowMs?: number;
  now?: number;
}

/** Lần bàn giao gần nhất, dùng để chạy hoạt cảnh "cây bút" nối hai bàn. */
export function detectHandoff(
  events: VEvent[] | null | undefined,
  opts: HandoffOptions = {},
): HandoffInfo | null {
  if (!events || events.length === 0) return null;
  const now = opts.now ?? Date.now();
  let best: VEvent | null = null;
  for (const e of events) {
    if (e.type !== 'HANDOFF') continue;
    if (best === null || e.id > best.id) best = e;
  }
  if (best === null) return null;
  if (opts.windowMs !== undefined && now - best.ts > opts.windowMs) return null;
  return {
    from: str(best.data.from),
    to: str(best.data.to),
    ts: best.ts,
    eventId: best.id,
    manual: best.data.manual === true,
  };
}

export interface ClosureInfo {
  ts: number;
  eventId: number;
}

/** Task vừa được đóng hay chưa (để bắn confetti + biển DONE). */
export function detectClosure(
  events: VEvent[] | null | undefined,
  opts: { windowMs?: number; now?: number } = {},
): ClosureInfo | null {
  if (!events || events.length === 0) return null;
  const now = opts.now ?? Date.now();
  let best: VEvent | null = null;
  for (const e of events) {
    if (e.type !== 'STATE_CHANGED' || str(e.data.status) !== 'closed') continue;
    if (best === null || e.id > best.id) best = e;
  }
  if (best === null) return null;
  if (opts.windowMs !== undefined && now - best.ts > opts.windowMs) return null;
  return { ts: best.ts, eventId: best.id };
}
