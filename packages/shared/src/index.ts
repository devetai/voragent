export type ProviderId = string; // 'claude' | 'codex' | 'fake-a' …
export type WorkspaceMode = 'head-dirty-commit' | 'head-commit' | 'dirty-nocommit';
export type TaskStatus = 'queued' | 'running' | 'waiting_quota' | 'awaiting_user' | 'failed' | 'closed';
export type TurnStatus = 'queued' | 'running' | 'done' | 'failed';
export type RunStatus = 'running' | 'completed' | 'quota_exhausted' | 'failed' | 'interrupted';
export type EventType =
  | 'TASK_CREATED' | 'TURN_STARTED' | 'TURN_FINISHED' | 'STATE_CHANGED'
  | 'RUN_STARTED' | 'RUN_FINISHED' | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START' | 'TEXT_MESSAGE_CONTENT' | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START' | 'TOOL_CALL_ARGS' | 'TOOL_CALL_END' | 'TOOL_CALL_RESULT'
  | 'QUOTA_UPDATED' | 'QUOTA_EXHAUSTED' | 'HANDOFF' | 'FILE_CHANGED' | 'USAGE'
  | 'MEMORY_UPDATED' | 'MANAGER_PLAN_UPDATED';

export interface VEvent {
  id: number;
  taskId: string;
  runId: string | null;
  ts: number;
  source: 'managed' | 'observed';
  type: EventType;
  data: Record<string, unknown>;
}

export interface Task {
  id: string;
  seq: number;
  title: string;
  repoPath: string;
  workspacePath: string | null;
  branch: string | null;
  baseCommit: string | null;
  mode: WorkspaceMode;
  priority: ProviderId[] | null;
  status: TaskStatus;
  currentProvider: ProviderId | null;
  parentTaskId?: string | null;
  role?: string | null;
  model?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Turn {
  id: string;
  taskId: string;
  index: number;
  message: string;
  status: TurnStatus;
  runId: string | null;
  answer: string | null;
  attempts: number;
}

export interface Run {
  id: string;
  taskId: string;
  provider: ProviderId;
  sessionId: string | null;
  status: RunStatus;
  handoff: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface ProviderState {
  id: ProviderId;
  cooldownUntil: number | null;
  usedPercent: number | null;
  installed: boolean;
  version: string | null;
  updatedAt: number;
}

export type QuotaFallbackPolicy = 'auto' | 'ask';

export interface Config {
  dataDir: string;
  port: number;
  priority: ProviderId[];
  concurrency: { perProvider: number; total: number };
  quotaThreshold: number;
  defaultCooldownMs: number;
  turnTimeoutMs: number;
  network: boolean;
  defaultMode: WorkspaceMode;
  handoffMaxChars: number;
  models?: Record<ProviderId, string>;
  modelFallbackPolicy?: QuotaFallbackPolicy;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Chờ',
  running: 'Đang chạy',
  waiting_quota: 'Chờ quota',
  awaiting_user: 'Chờ bạn',
  failed: 'Lỗi',
  closed: 'Xong',
};

export type DiscoverySource = 'claude' | 'antigravity' | 'codex';

export interface DiscoveredProject {
  path: string;
  lastUsedAt: number | null;
  source: DiscoverySource;
}

export interface ProjectSource {
  source: DiscoverySource;
  lastUsedAt: number | null;
}

export interface Project {
  id: string;
  path: string;
  name: string;
  lastUsedAt: number | null;
  sources: ProjectSource[];
  isGit: boolean;
  branch: string | null;
  dirtyCount: number | null;
  taskCount: number;
}

// =========================================================================
// VĂN PHÒNG DỰ ÁN: SHARED MEMORY & TRƯỞNG PHÒNG ĐIỀU PHỐI SUB-AGENT
// =========================================================================

export type MemoryCategory = 'architecture' | 'decision' | 'context' | 'finding';

export const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = {
  architecture: '🏛 Kiến trúc & Quy ước',
  decision: '⚖️ Quyết định chung',
  context: '📌 Ngữ cảnh đang làm',
  finding: '💡 Nhật ký phát hiện',
};

export interface MemoryItem {
  id: string;
  repoPath: string;
  category: MemoryCategory;
  title: string;
  content: string;
  author: string; // 'user' | 'manager' | 'claude' | 'codex' | 'antigravity'
  pinned: boolean;
  updatedAt: number;
}

export type ManagerMode = 'semi-auto' | 'auto';
export type ManagerPlanStatus = 'draft' | 'dispatched' | 'completed';

export interface ManagerSubtask {
  id: string;
  title: string;
  message: string;
  assignedProvider: ProviderId;
  role: string;
  taskId: string | null;
}

export interface ManagerPlan {
  id: string;
  repoPath: string;
  goal: string;
  mode: ManagerMode;
  status: ManagerPlanStatus;
  subtasks: ManagerSubtask[];
  createdAt: number;
  updatedAt: number;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  default?: boolean;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  claude: [
    { id: 'sonnet-5.5', name: 'Sonnet 5.5', description: 'Mô hình thông minh cân bằng (Mặc định)', default: true },
    { id: 'opus-5.5', name: 'Opus 5.5', description: 'Mô hình mạnh mẽ, tư duy chuyên sâu' },
    { id: 'haiku-5.5', name: 'Haiku 5.5', description: 'Tốc độ cực nhanh, tiết kiệm hạn mức' },
  ],
  codex: [
    { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', description: 'Older fast and efficient model (Mặc định)', default: true },
    { id: 'gpt-6-luna', name: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', description: 'Older balanced model for straightforward work.' },
  ],
  antigravity: [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', description: 'Phản hồi cực nhanh, tối ưu hạn mức (Mặc định)', default: true },
    { id: 'gemini-4-argon', name: 'Gemini 4 Argon', description: 'Mô hình thế hệ mới tư duy kỹ thuật' },
  ],
};


export type QuotaSharingType = 'shared' | 'per_model';

export const PROVIDER_QUOTA_TYPE: Record<string, QuotaSharingType> = {
  claude: 'shared',
  codex: 'shared',
  antigravity: 'per_model',
};

export interface ModelQuotaState {
  provider: string;
  model: string;
  cooldownUntil: number | null;
  usedPercent: number | null;
  updatedAt: number;
  lastError?: string | null;
}

export interface ModelQuotaInfo {
  provider: string;
  model: string;
  name: string;
  description: string;
  default?: boolean;
  quotaType: QuotaSharingType;
  status: 'ready' | 'cooldown' | 'exhausted';
  cooldownUntil: number | null;
  usedPercent: number | null;
  note?: string;
}

export interface StorageBreakdown {
  worktreesBytes: number;
  databaseBytes: number;
  logsBytes: number;
  totalBytes: number;
}

export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
}

export interface AvailableDrive {
  drive: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
}

export interface PickDirectoryResult {
  path: string | null;
}

export interface FolderEntry {
  name: string;
  path: string;
}

export interface BrowseFolderResult {
  currentPath: string | null;
  parentPath: string | null;
  isRoot: boolean;
  folders: FolderEntry[];
}

export interface StorageStats {
  dataDir: string;
  defaultDataDir: string;
  isCustomLocation: boolean;
  breakdown: StorageBreakdown;
  disk: DiskSpace | null;
  prunableWorktreesCount: number;
  orphanWorktreesCount: number;
  availableDrives?: AvailableDrive[];
}

export interface PruneOptions {
  olderThanDays?: number;
  orphanWorktrees?: boolean;
  logs?: boolean;
  vacuum?: boolean;
}

export interface PruneResult {
  freedBytes: number;
  prunedWorktrees: number;
  prunedOrphans: number;
  logsTruncated: boolean;
  vacuumed: boolean;
}

export interface MigrateOptions {
  newPath: string;
  deleteOld?: boolean;
}

export interface MigrateResult {
  success: boolean;
  oldPath: string;
  newPath: string;
}
