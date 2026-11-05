import type { DiscoverySource, Project, ProviderId, ProviderState, Task, TaskStatus, VEvent } from '@voragent/shared';

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

  if (e.type === 'STATE_CHANGED' && e.data.deleted === true) {
    const tasks = new Map(s.tasks);
    tasks.delete(e.taskId);
    events.delete(e.taskId);
    return { ...s, tasks, events };
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

/** Khóa so khớp đường dẫn: đổi `\` thành `/`, bỏ dấu gạch cuối, viết thường. */
export function projectKeyOf(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Task của một dự án: khớp nguyên đường dẫn đã chuẩn hóa (không khớp theo tiền tố). */
export function tasksOfProject(tasks: Task[], project: Pick<Project, 'path'>): Task[] {
  const key = projectKeyOf(project.path);
  return tasks.filter((t) => projectKeyOf(t.repoPath) === key);
}

const SOURCE_LABELS: Array<[DiscoverySource, string]> = [
  ['claude', 'Claude'], ['antigravity', 'Antigravity'], ['codex', 'Codex'],
];

/** Nhãn nguồn của dự án, thứ tự cố định (Claude, Antigravity, Codex), không trùng. */
export function describeProjectSources(p: Project): string[] {
  const have = new Set(p.sources.map((s) => s.source));
  return SOURCE_LABELS.filter(([id]) => have.has(id)).map(([, label]) => label);
}

/** Dùng gần nhất trước, `null` cuối, hòa thì theo tên (không phân biệt hoa thường). Không sửa mảng đầu vào. */
export function sortProjects(ps: Project[]): Project[] {
  return [...ps].sort((a, b) => {
    if (a.lastUsedAt !== b.lastUsedAt) {
      if (a.lastUsedAt === null) return 1;
      if (b.lastUsedAt === null) return -1;
      return b.lastUsedAt - a.lastUsedAt;
    }
    const byName = a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** Lọc phía trình duyệt: khớp tên hoặc đường dẫn, không phân biệt hoa thường. Chuỗi lọc rỗng giữ nguyên. */
export function filterProjects(ps: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  if (q === '') return ps;
  return ps.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:mm` theo giờ máy, hoặc "chưa rõ" khi không có thời điểm. */
export function formatLastUsed(ms: number | null): string {
  if (ms === null) return 'chưa rõ';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Giá trị ô chọn dự án cho lựa chọn "Thư mục khác…". */
export const OTHER = '__other__';

/**
 * Giá trị đang chọn của ô chọn dự án: lựa chọn của người dùng nếu có; không thì dự án đang xem
 * (khớp theo khóa đường dẫn; không có trong danh sách thì "Thư mục khác…"); danh sách rỗng thì "Thư mục khác…";
 * còn lại là rỗng (chưa chọn). Thuần, nên đổi dự án đang xem hay danh sách tải về muộn đều tự cập nhật.
 */
export function effectiveChoice(picked: string | null, projects: Project[], initialPath: string | null): string {
  if (picked !== null) return picked;
  if (initialPath !== null) {
    const key = projectKeyOf(initialPath);
    return projects.find((p) => projectKeyOf(p.path) === key)?.path ?? OTHER;
  }
  return projects.length === 0 ? OTHER : '';
}

const PROJECT_PREFIX = '#/project/';
const TASK_PREFIX = '#/task/';

/**
 * Đường dẫn dự án từ URL: hỗ trợ dạng query param ?project=<mã hóa> (hoặc hash cũ #/project/<mã hóa>).
 * Không phải hoặc mã hóa hỏng thì null.
 */
export function projectPathOf(urlOrHash: string): string | null {
  if (urlOrHash.startsWith(PROJECT_PREFIX)) {
    try {
      return decodeURIComponent(urlOrHash.slice(PROJECT_PREFIX.length));
    } catch {
      return null;
    }
  }
  // Hỗ trợ ?project=... hoặc /board?project=...
  const queryIndex = urlOrHash.indexOf('?');
  if (queryIndex >= 0) {
    const search = urlOrHash.slice(queryIndex);
    const params = new URLSearchParams(search);
    const p = params.get('project');
    if (p !== null) {
      try {
        return decodeURIComponent(p);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Id task từ URL: hỗ trợ dạng path /task/<id mã hóa> hoặc /tasks/<id mã hóa> (kèm hash cũ #/task/<id mã hóa>).
 * Không phải hoặc mã hóa hỏng thì null (không bao giờ ném lỗi).
 */
export function taskIdOf(urlOrHash: string): string | null {
  if (urlOrHash.startsWith(TASK_PREFIX)) {
    try {
      return decodeURIComponent(urlOrHash.slice(TASK_PREFIX.length));
    } catch {
      return null;
    }
  }
  const path = urlOrHash.split('?')[0]?.split('#')[0] ?? '';
  const match = path.match(/^\/(?:task|tasks)\/(.+)$/);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }
  return null;
}

export type ProjectsLoad = 'loading' | 'failed' | 'loaded';

export const PROJECT_NOT_FOUND_NOTICE = 'Không tìm thấy dự án đã chọn (có thể thư mục đã bị xóa hoặc đổi tên).';

/**
 * Quyết định màn hình theo URL hoặc hash. Chỉ khi danh sách đã tải THÀNH CÔNG mà không dự án nào khớp mới đưa về danh sách
 * kèm thông báo; đang tải hoặc tải lỗi thì giữ nguyên để không mất chỗ đang xem.
 */
export function resolveProjectRoute(
  urlOrHash: string, projects: Project[] | null, load: ProjectsLoad,
): { view: 'list'; notice?: string } | { view: 'project'; path: string } {
  const path = projectPathOf(urlOrHash);
  if (path === null) return { view: 'list' };
  if (load !== 'loaded' || projects === null) return { view: 'project', path };
  const key = projectKeyOf(path);
  if (projects.some((p) => projectKeyOf(p.path) === key)) return { view: 'project', path };
  return { view: 'list', notice: PROJECT_NOT_FOUND_NOTICE };
}


/**
 * Kiểm tra xem một nhà cung cấp (Provider) có được cài đặt CLI trên máy hay không.
 * Nếu mảng `providers` rỗng (đang tải lần đầu), tạm coi là true; khi đã có dữ liệu thì bắt buộc `p.installed === true`.
 */
export function isProviderInstalledById(providers: ProviderState[], id: string): boolean {
  if (providers.length === 0) return true;
  const key = id.toLowerCase();
  const found = providers.find((p) => p.id.toLowerCase().includes(key));
  return found ? found.installed : false;
}

/**
 * Kiểm tra xem một nhà cung cấp (Provider) có đang KHẢ DỤNG (đã cài đặt CLI + không bị tạm nghỉ cooldown + chưa cạn 100% quota) hay không.
 */
export function isProviderAvailable(
  providers: ProviderState[],
  id: string,
  nowMs: number = Date.now(),
): boolean {
  if (providers.length === 0) return true;
  const key = id.toLowerCase();
  const found = providers.find((p) => p.id.toLowerCase().includes(key));
  if (!found || !found.installed) return false;
  if (found.cooldownUntil !== null && found.cooldownUntil > nowMs) return false;
  if (found.usedPercent !== null && found.usedPercent >= 1) return false;
  return true;
}

/**
 * Trả về lý do tại sao một Provider không khả dụng (hoặc `null` nếu đang sẵn sàng).
 */
export function getProviderUnavailableReason(
  providers: ProviderState[],
  id: string,
  nowMs: number = Date.now(),
): string | null {
  if (providers.length === 0) return null;
  const key = id.toLowerCase();
  const found = providers.find((p) => p.id.toLowerCase().includes(key));
  if (!found || !found.installed) return 'Chưa cài CLI';
  if (found.cooldownUntil !== null && found.cooldownUntil > nowMs) return 'Đang tạm nghỉ (Quota)';
  if (found.usedPercent !== null && found.usedPercent >= 1) return 'Đã cạn Quota';
  return null;
}
