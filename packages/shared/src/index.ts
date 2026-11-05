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
  | 'QUOTA_UPDATED' | 'QUOTA_EXHAUSTED' | 'HANDOFF' | 'FILE_CHANGED' | 'USAGE';

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
