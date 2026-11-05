import type { Config, ProviderState, Run, Task, Turn, VEvent, WorkspaceMode } from '@voragent/shared';

/** Lỗi API: `message` là chuỗi tiếng Việt trong trường `error` của JSON trả về. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Khóa nằm trong cookie HttpOnly nên JS không đọc được: mọi yêu cầu cùng nguồn, tự mang cookie.
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('Không kết nối được tới voragent.', 0);
  }
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string') msg = j.error;
    } catch {
      // thân không phải JSON
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TaskDetail { task: Task; turns: Turn[]; runs: Run[]; events: VEvent[] }
export interface Diff { status: string; diff: string; commits: string[] }

export const api = {
  tasks: () => call<Task[]>('GET', '/api/tasks'),
  task: (id: string) => call<TaskDetail>('GET', `/api/tasks/${encodeURIComponent(id)}`),
  diff: (id: string) => call<Diff>('GET', `/api/tasks/${encodeURIComponent(id)}/diff`),
  providers: () => call<ProviderState[]>('GET', '/api/providers'),
  config: () => call<Config>('GET', '/api/config'),
  createTask: (b: { repoPath: string; message: string; mode: WorkspaceMode; priority?: string[] }) =>
    call<Task>('POST', '/api/tasks', b),
  send: (id: string, message: string) =>
    call<Turn>('POST', `/api/tasks/${encodeURIComponent(id)}/messages`, { message }),
  close: (id: string) => call<void>('POST', `/api/tasks/${encodeURIComponent(id)}/close`),
  retry: (id: string, switchProvider: boolean) =>
    call<void>('POST', `/api/tasks/${encodeURIComponent(id)}/retry`, { switchProvider }),
};

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
