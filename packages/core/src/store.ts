import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  ProviderId, ProviderState, Run, Task, Turn, VEvent, WorkspaceMode,
} from '@voragent/shared';

export interface NewTask {
  title: string;
  repoPath: string;
  mode: WorkspaceMode;
  priority: ProviderId[] | null;
  message: string;
}

export interface Store {
  createTask(t: NewTask): { task: Task; turn: Turn };
  getTask(id: string): Task | null;
  listTasks(): Task[];
  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'seq' | 'createdAt'>>): Task;
  addTurn(taskId: string, message: string): Turn;
  turnsOf(taskId: string): Turn[];
  queuedTurns(): Turn[];
  updateTurn(id: string, patch: Partial<Omit<Turn, 'id' | 'taskId' | 'index'>>): Turn;
  createRun(r: { taskId: string; provider: ProviderId; handoff: string | null }): Run;
  runsOf(taskId: string): Run[];
  runningRuns(): Run[];
  updateRun(id: string, patch: Partial<Omit<Run, 'id' | 'taskId'>>): Run;
  appendEvent(e: Omit<VEvent, 'id' | 'ts'> & { ts?: number }): VEvent;
  eventsOf(taskId: string, afterId?: number): VEvent[];
  getProvider(id: ProviderId): ProviderState | null;
  upsertProvider(p: ProviderState): void;
  listProviders(): ProviderState[];
  close(): void;
}

type Row = Record<string, unknown>;
type SqlValue = string | number | null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  workspace_path TEXT,
  branch TEXT,
  base_commit TEXT,
  mode TEXT NOT NULL,
  priority TEXT,
  status TEXT NOT NULL,
  current_provider TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  run_id TEXT,
  answer TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_task ON turns(task_id, idx);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  handoff TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS runs_task ON runs(task_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_id TEXT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_task ON events(task_id, id);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  cooldown_until INTEGER,
  used_percent REAL,
  installed INTEGER NOT NULL,
  version TEXT,
  updated_at INTEGER NOT NULL
);
`;

const TASK_COLS: Record<string, string> = {
  title: 'title', repoPath: 'repo_path', workspacePath: 'workspace_path', branch: 'branch',
  baseCommit: 'base_commit', mode: 'mode', priority: 'priority', status: 'status',
  currentProvider: 'current_provider', updatedAt: 'updated_at',
};
const TURN_COLS: Record<string, string> = {
  message: 'message', status: 'status', runId: 'run_id', answer: 'answer', attempts: 'attempts',
};
const RUN_COLS: Record<string, string> = {
  provider: 'provider', sessionId: 'session_id', status: 'status', handoff: 'handoff',
  startedAt: 'started_at', endedAt: 'ended_at',
};

function toTask(r: Row): Task {
  return {
    id: r.id as string,
    seq: r.seq as number,
    title: r.title as string,
    repoPath: r.repo_path as string,
    workspacePath: r.workspace_path as string | null,
    branch: r.branch as string | null,
    baseCommit: r.base_commit as string | null,
    mode: r.mode as WorkspaceMode,
    priority: r.priority === null ? null : (JSON.parse(r.priority as string) as ProviderId[]),
    status: r.status as Task['status'],
    currentProvider: r.current_provider as string | null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function toTurn(r: Row): Turn {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    index: r.idx as number,
    message: r.message as string,
    status: r.status as Turn['status'],
    runId: r.run_id as string | null,
    answer: r.answer as string | null,
    attempts: r.attempts as number,
  };
}

function toRun(r: Row): Run {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    provider: r.provider as string,
    sessionId: r.session_id as string | null,
    status: r.status as Run['status'],
    handoff: r.handoff as string | null,
    startedAt: r.started_at as number,
    endedAt: r.ended_at as number | null,
  };
}

function toEvent(r: Row): VEvent {
  return {
    id: r.id as number,
    taskId: r.task_id as string,
    runId: r.run_id as string | null,
    ts: r.ts as number,
    source: r.source as VEvent['source'],
    type: r.type as VEvent['type'],
    data: JSON.parse(r.data as string) as Record<string, unknown>,
  };
}

function toProvider(r: Row): ProviderState {
  return {
    id: r.id as string,
    cooldownUntil: r.cooldown_until as number | null,
    usedPercent: r.used_percent as number | null,
    installed: r.installed === 1,
    version: r.version as string | null,
    updatedAt: r.updated_at as number,
  };
}

export function openStore(file: string): Store {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(SCHEMA);

  const all = (sql: string, ...p: SqlValue[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const one = (sql: string, ...p: SqlValue[]): Row | null =>
    (db.prepare(sql).get(...p) as Row | undefined) ?? null;
  const exec = (sql: string, ...p: SqlValue[]): void => { db.prepare(sql).run(...p); };

  function update(
    table: string, cols: Record<string, string>, id: string, patch: Record<string, unknown>,
    encode?: (k: string, v: unknown) => SqlValue,
  ): void {
    const sets: string[] = [];
    const vals: SqlValue[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const col = cols[k];
      if (!col) throw new Error(`Unknown field "${k}" for ${table}`);
      sets.push(`${col} = ?`);
      vals.push(encode ? encode(k, v) : (v as SqlValue));
    }
    if (sets.length === 0) return;
    exec(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
  }

  function need<T>(v: T | null, what: string, id: string): T {
    if (v === null) throw new Error(`${what} not found: ${id}`);
    return v;
  }

  const store: Store = {
    createTask(t) {
      const id = randomUUID();
      const now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        const seq = one('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM tasks')!.n as number;
        exec(
          `INSERT INTO tasks (id, seq, title, repo_path, mode, priority, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
          id, seq, t.title, t.repoPath, t.mode, t.priority === null ? null : JSON.stringify(t.priority), now, now,
        );
        const turn = store.addTurn(id, t.message);
        db.exec('COMMIT');
        return { task: store.getTask(id)!, turn };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    getTask(id) {
      const r = one('SELECT * FROM tasks WHERE id = ?', id);
      return r ? toTask(r) : null;
    },
    listTasks() {
      return all('SELECT * FROM tasks ORDER BY seq DESC').map(toTask);
    },
    updateTask(id, patch) {
      update('tasks', TASK_COLS, id, { updatedAt: Date.now(), ...patch }, (k, v) =>
        k === 'priority' ? (v === null ? null : JSON.stringify(v)) : (v as SqlValue));
      return need(store.getTask(id), 'Task', id);
    },
    addTurn(taskId, message) {
      const id = randomUUID();
      const index = one('SELECT COUNT(*) AS n FROM turns WHERE task_id = ?', taskId)!.n as number;
      exec(
        `INSERT INTO turns (id, task_id, idx, message, status, attempts, created_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?)`,
        id, taskId, index, message, Date.now(),
      );
      return toTurn(one('SELECT * FROM turns WHERE id = ?', id)!);
    },
    turnsOf(taskId) {
      return all('SELECT * FROM turns WHERE task_id = ? ORDER BY idx', taskId).map(toTurn);
    },
    queuedTurns() {
      return all("SELECT * FROM turns WHERE status = 'queued' ORDER BY created_at, rowid").map(toTurn);
    },
    updateTurn(id, patch) {
      update('turns', TURN_COLS, id, patch);
      return toTurn(need(one('SELECT * FROM turns WHERE id = ?', id), 'Turn', id));
    },
    createRun(r) {
      const id = randomUUID();
      exec(
        `INSERT INTO runs (id, task_id, provider, status, handoff, started_at)
         VALUES (?, ?, ?, 'running', ?, ?)`,
        id, r.taskId, r.provider, r.handoff, Date.now(),
      );
      return toRun(one('SELECT * FROM runs WHERE id = ?', id)!);
    },
    runsOf(taskId) {
      return all('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at, rowid', taskId).map(toRun);
    },
    runningRuns() {
      return all("SELECT * FROM runs WHERE status = 'running' ORDER BY started_at, rowid").map(toRun);
    },
    updateRun(id, patch) {
      update('runs', RUN_COLS, id, patch);
      return toRun(need(one('SELECT * FROM runs WHERE id = ?', id), 'Run', id));
    },
    appendEvent(e) {
      const ts = e.ts ?? Date.now();
      exec(
        'INSERT INTO events (task_id, run_id, ts, source, type, data) VALUES (?, ?, ?, ?, ?, ?)',
        e.taskId, e.runId, ts, e.source, e.type, JSON.stringify(e.data),
      );
      const id = one('SELECT last_insert_rowid() AS id')!.id as number;
      return { id, taskId: e.taskId, runId: e.runId, ts, source: e.source, type: e.type, data: e.data };
    },
    eventsOf(taskId, afterId = 0) {
      return all('SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id', taskId, afterId).map(toEvent);
    },
    getProvider(id) {
      const r = one('SELECT * FROM providers WHERE id = ?', id);
      return r ? toProvider(r) : null;
    },
    upsertProvider(p) {
      exec(
        `INSERT INTO providers (id, cooldown_until, used_percent, installed, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cooldown_until = excluded.cooldown_until,
           used_percent = excluded.used_percent, installed = excluded.installed,
           version = excluded.version, updated_at = excluded.updated_at`,
        p.id, p.cooldownUntil, p.usedPercent, p.installed ? 1 : 0, p.version, p.updatedAt,
      );
    },
    listProviders() {
      return all('SELECT * FROM providers ORDER BY id').map(toProvider);
    },
    close() {
      db.close();
    },
  };
  return store;
}
