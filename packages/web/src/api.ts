import type {
  Config,
  ManagerMode,
  ManagerPlan,
  ManagerSubtask,
  MemoryCategory,
  MemoryItem,
  MigrateOptions,
  MigrateResult,
  ModelQuotaInfo,
  Project,
  ProviderState,
  PruneOptions,
  PruneResult,
  Run,
  StorageStats,
  Task,
  Turn,
  VEvent,
  WorkspaceMode,
} from '@voragent/shared';

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
  refreshProviders: () => call<ProviderState[]>('POST', '/api/providers/refresh'),
  resetProviderCooldown: (id: string) => call<ProviderState>('POST', `/api/providers/${encodeURIComponent(id)}/reset-cooldown`),
  modelQuotas: () => call<Record<string, ModelQuotaInfo[]>>('GET', '/api/models/quotas'),
  probeModelQuota: (provider: string, model: string) =>
    call<{ ok: boolean; provider: string; model: string; status: string; cooldownUntil: number | null; note: string }>(
      'POST',
      '/api/models/probe',
      { provider, model },
    ),
  resetModelCooldown: (provider: string, model?: string) =>
    call<{ ok: boolean }>('POST', '/api/models/reset-cooldown', { provider, model }),
  installProvider: (provider: string) =>
    call<{ ok: boolean; provider: string; package: string; output: string; providers: ProviderState[] }>(
      'POST',
      '/api/providers/install',
      { provider },
    ),
  projects: (refresh = false) => call<Project[]>('GET', refresh ? '/api/projects?refresh=1' : '/api/projects'),
  initGit: (repoPath: string) =>
    call<{ ok: boolean; branch: string; commit: string; projects: Project[] }>('POST', '/api/projects/git-init', { repoPath }),
  config: () => call<Config>('GET', '/api/config'),
  storage: () => call<StorageStats>('GET', '/api/system/storage'),
  prune: (options: PruneOptions) => call<PruneResult>('POST', '/api/system/prune', options),
  migrate: (options: MigrateOptions) => call<MigrateResult>('POST', '/api/system/migrate', options),
  pickDirectory: () => call<PickDirectoryResult>('POST', '/api/system/pick-directory'),
  browseFolders: (path?: string | null) =>
    call<BrowseFolderResult>('GET', path ? `/api/system/browse-folders?path=${encodeURIComponent(path)}` : '/api/system/browse-folders'),
  createFolder: (parentPath: string, folderName: string) =>
    call<{ path: string }>('POST', '/api/system/create-folder', { parentPath, folderName }),
  updateConfig: (patch: { models?: Record<string, string>; modelFallbackPolicy?: 'auto' | 'ask' }) =>
    call<Config>('PATCH', '/api/config', patch),
  createTask: (b: {
    repoPath: string;
    message: string;
    title?: string;
    mode: WorkspaceMode;
    priority?: string[];
    role?: string;
    model?: string | null;
  }) => call<Task>('POST', '/api/tasks', b),
  updateTaskModel: (id: string, model: string | null) =>
    call<Task>('PATCH', `/api/tasks/${encodeURIComponent(id)}`, { model }),
  send: (id: string, message: string) =>
    call<Turn>('POST', `/api/tasks/${encodeURIComponent(id)}/messages`, { message }),
  close: (id: string) => call<void>('POST', `/api/tasks/${encodeURIComponent(id)}/close`),
  deleteTask: (id: string) => call<void>('DELETE', `/api/tasks/${encodeURIComponent(id)}`),
  retry: (id: string, switchProvider: boolean) =>
    call<void>('POST', `/api/tasks/${encodeURIComponent(id)}/retry`, { switchProvider }),
  assignTask: (id: string, provider: string) =>
    call<Task>('POST', `/api/tasks/${encodeURIComponent(id)}/assign`, { provider }),
  // Shared Memory của Văn phòng Dự án
  memories: (repoPath?: string) =>
    call<MemoryItem[]>(
      'GET',
      repoPath ? `/api/memories?repoPath=${encodeURIComponent(repoPath)}` : '/api/memories',
    ),
  saveMemory: (b: {
    id?: string;
    repoPath: string;
    category: MemoryCategory;
    title: string;
    content: string;
    author?: string;
    pinned?: boolean;
  }) => call<MemoryItem>('POST', '/api/memories', b),
  deleteMemory: (id: string) =>
    call<void>('DELETE', `/api/memories/${encodeURIComponent(id)}`),
  // Trưởng phòng điều phối (Manager Plans)
  managerPlans: (repoPath?: string) =>
    call<ManagerPlan[]>(
      'GET',
      repoPath ? `/api/manager/plans?repoPath=${encodeURIComponent(repoPath)}` : '/api/manager/plans',
    ),
  createManagerPlan: (b: {
    repoPath: string;
    goal: string;
    mode: ManagerMode;
    subtasks?: Array<{ title: string; message: string; assignedProvider: string; role: string }>;
  }) => call<ManagerPlan>('POST', '/api/manager/plans', b),
  dispatchManagerPlan: (planId: string, subtasks?: ManagerSubtask[]) =>
    call<ManagerPlan>(
      'POST',
      `/api/manager/plans/${encodeURIComponent(planId)}/dispatch`,
      subtasks ? { subtasks } : {},
    ),
  deleteManagerPlan: (id: string) =>
    call<void>('DELETE', `/api/manager/plans/${encodeURIComponent(id)}`),
  updateManagerPlan: (id: string, patch: Partial<ManagerPlan>) =>
    call<ManagerPlan>('PATCH', `/api/manager/plans/${encodeURIComponent(id)}`, patch),
};

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
