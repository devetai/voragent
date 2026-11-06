import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROVIDER_NPM_PACKAGES: Record<string, string> = {
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code',
  opencode: '@opencode/cli',
};
import { Hono } from 'hono';
import type { Context } from 'hono';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type {
  Config, ManagerMode, ManagerPlan, ManagerSubtask, MemoryCategory, ModelQuotaInfo, ProviderId, WorkspaceMode, PruneOptions,
} from '@voragent/shared';
import { PROVIDER_MODELS, PROVIDER_QUOTA_TYPE } from '@voragent/shared';
import { getStorageStats, pickSystemDirectory, browseFolders } from './storage.js';
import { pruneStorage } from './cleanup.js';
import { migrateDataDir } from './migration.js';
import { resolveDataDir } from './location.js';
import type { EventBus } from './bus.js';
import { DEFAULT_CONFIG, saveConfig } from './config.js';
import { resolveProviderModel, type Orchestrator } from './orchestrator.js';
import type { ProjectCatalog } from './projects.js';
import type { Store } from './store.js';
import { initGitRepository, workspaceSummary } from './workspace.js';
import {
  browseTree,
  checkoutBranch,
  commitChanges,
  createProjectItem,
  createTerminalSession,
  deleteProjectItem,
  discardFiles,
  getGitDiff,
  getGitStatus,
  listBranches,
  readProjectFile,
  removeWorktree,
  renameProjectItem,
  stageFiles,
  unstageFiles,
  writeProjectFile,
} from './ide/index.js';

export const KEY_COOKIE = 'voragent_key';
export const KEY_HEADER = 'x-voragent-key';

const MODES: WorkspaceMode[] = ['head-dirty-commit', 'head-commit', 'dirty-nocommit'];
const MEMORY_CATEGORIES: MemoryCategory[] = ['architecture', 'decision', 'context', 'finding'];
const MANAGER_MODES: ManagerMode[] = ['semi-auto', 'auto'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>voragent</title></head>
<body style="font-family:sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>voragent đang chạy</h1>
<p>Giao diện web chưa được build. Chạy <code>pnpm -r build</code> rồi khởi động lại voragent.</p>
<p>API vẫn dùng được tại <code>/api</code>.</p>
</body></html>`;

/** So sánh khóa theo thời gian không đổi. */
export function keyMatches(given: string | null | undefined, key: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hostnameOf(hostHeader: string): string {
  // "localhost:4717" | "127.0.0.1:4717" | "[::1]:4717"
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0] ?? '';
}

/** Chặn DNS rebinding: chỉ nhận Host là localhost / 127.0.0.1. */
export function isLocalHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) return false;
  return LOCAL_HOSTS.has(hostnameOf(hostHeader.toLowerCase()));
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function requestKey(get: { header: string | undefined; query: string | null; cookie: string | undefined }): string | null {
  return get.header ?? get.query ?? cookieValue(get.cookie, KEY_COOKIE);
}

const err = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 415 | 500 | 501, error: string): Response =>
  c.json({ error }, status);

class BadRequest extends Error {}
class UnsupportedType extends Error {}

async function readJson(c: Context, optional = false): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (text.trim() !== '' && type !== 'application/json') {
    throw new UnsupportedType('Nội dung yêu cầu phải có Content-Type: application/json.');
  }
  if (text.trim() === '') {
    if (optional) return {};
    throw new BadRequest('Thiếu nội dung JSON trong yêu cầu.');
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new BadRequest('Nội dung yêu cầu không phải JSON hợp lệ.');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new BadRequest('Nội dung yêu cầu phải là một đối tượng JSON.');
  }
  return v as Record<string, unknown>;
}

function reqString(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.trim() === '') throw new BadRequest(`"${k}" phải là một chuỗi không rỗng.`);
  return v;
}

export function createServer(d: {
  orchestrator: Orchestrator;
  store: Store;
  bus: EventBus;
  key: string;
  webDir: string | null;
  dataDir?: string;
  /** Cấu hình hiện hành cho GET /api/config. Thiếu thì trả cấu hình mặc định. */
  config?: Config;
  /** Gọi sau khi trả 204 cho POST /api/shutdown. `force`: dừng cứng các lượt đang chạy. Không có thì route trả 501. */
  onShutdown?: (o: { force: boolean }) => void;
  /** Danh mục dự án cho GET /api/projects. Thiếu thì route trả []. */
  projects?: ProjectCatalog;
}): Hono {
  const { orchestrator, store, bus, key } = d;
  const dataDir = d.dataDir ?? d.config?.dataDir ?? resolveDataDir();
  const app = new Hono();

  const kick = (): void => {
    void orchestrator.tick().catch(() => undefined);
  };

  // DNS rebinding: Host phải là địa chỉ cục bộ. Header Host là nguồn chính; thiếu thì dùng URL.
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!isLocalHost(host)) return err(c, 403, 'Host không hợp lệ: voragent chỉ nhận yêu cầu từ localhost.');
    return next();
  });

  // CSRF: yêu cầu đổi trạng thái chỉ nhận khi không có Origin (CLI, curl) hoặc Origin chính là trang của daemon.
  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      const host = (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
      const port = host.startsWith('[') ? host.slice(host.indexOf(']') + 2) : (host.split(':')[1] ?? '');
      const suffix = port === '' ? '' : `:${port}`;
      const allowed = [`http://localhost${suffix}`, `http://127.0.0.1${suffix}`];
      if (!allowed.includes(origin.toLowerCase())) {
        return err(c, 403, 'Origin không hợp lệ: chỉ nhận yêu cầu từ chính trang của voragent.');
      }
    }
    return next();
  });

  // Mọi route (kể cả trang web) cần khóa.
  app.use('*', async (c, next) => {
    const given = requestKey({
      header: c.req.header(KEY_HEADER),
      query: c.req.query('key') ?? null,
      cookie: c.req.header('cookie'),
    });
    if (!keyMatches(given, key)) {
      return err(c, 401, 'Thiếu hoặc sai khóa. Mở URL do voragent in ra (có ?key=...).');
    }
    return next();
  });

  app.onError((e, c) => {
    if (e instanceof BadRequest) return err(c, 400, e.message);
    if (e instanceof UnsupportedType) return err(c, 415, e.message);
    return err(c, 500, 'Lỗi nội bộ của daemon.');
  });
  app.notFound((c) => err(c, 404, 'Không tìm thấy.'));

  const taskOr404 = (c: Context) => {
    const task = store.getTask(c.req.param('id') ?? '');
    return task;
  };
  const NO_TASK = 'Không tìm thấy task.';

  // ------------------------------------------------------------------ API

  app.get('/api/tasks', (c) => c.json(store.listTasks()));

  app.post('/api/tasks', async (c) => {
    const b = await readJson(c);
    const repoPath = reqString(b, 'repoPath');
    const message = reqString(b, 'message');
    let isDir = false;
    try {
      isDir = statSync(repoPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new BadRequest(`repoPath không phải thư mục tồn tại: ${repoPath}`);
    const input: Parameters<Orchestrator['submitTask']>[0] = { repoPath, message };
    if (b.title !== undefined) input.title = reqString(b, 'title');
    if (b.role !== undefined && typeof b.role === 'string') input.role = b.role.trim();
    if (b.parentTaskId !== undefined && typeof b.parentTaskId === 'string') input.parentTaskId = b.parentTaskId.trim();
    if (b.mode !== undefined) {
      if (!MODES.includes(b.mode as WorkspaceMode)) {
        throw new BadRequest(`"mode" phải là một trong: ${MODES.join(', ')}.`);
      }
      input.mode = b.mode as WorkspaceMode;
    }
    if (b.priority !== undefined) {
      if (!Array.isArray(b.priority) || b.priority.length === 0 || !b.priority.every((p) => typeof p === 'string')) {
        throw new BadRequest('"priority" phải là danh sách chuỗi không rỗng.');
      }
      input.priority = b.priority as ProviderId[];
    }
    let task;
    try {
      task = await orchestrator.submitTask(input);
    } catch (e) {
      throw new BadRequest(e instanceof Error ? e.message : String(e));
    }
    kick();
    return c.json(task, 201);
  });

  app.get('/api/tasks/:id', (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    return c.json({
      task,
      turns: store.turnsOf(task.id),
      runs: store.runsOf(task.id),
      events: store.eventsOf(task.id),
    });
  });

  app.post('/api/tasks/:id/messages', async (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    const b = await readJson(c);
    const message = reqString(b, 'message');
    if (
      task.status !== 'awaiting_user' &&
      task.status !== 'failed' &&
      task.status !== 'waiting_quota' &&
      task.status !== 'queued'
    ) {
      return err(c, 409, `Task không nhận tin nhắn lúc này (trạng thái: ${task.status}).`);
    }
    let turn;
    try {
      turn = orchestrator.sendMessage(task.id, message);
    } catch (e) {
      return err(c, 409, e instanceof Error ? e.message : String(e));
    }
    kick();
    return c.json(turn, 201);
  });

  app.post('/api/tasks/:id/close', (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    orchestrator.closeTask(task.id);
    return c.body(null, 204);
  });

  app.delete('/api/tasks/:id', (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    orchestrator.deleteTask(task.id);
    return c.body(null, 204);
  });

  app.post('/api/tasks/:id/retry', async (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    const b = await readJson(c, true);
    if (b.switchProvider !== undefined && typeof b.switchProvider !== 'boolean') {
      throw new BadRequest('"switchProvider" phải là true hoặc false.');
    }
    try {
      orchestrator.retry(task.id, { switchProvider: b.switchProvider === true });
    } catch (e) {
      return err(c, 409, e instanceof Error ? e.message : String(e));
    }
    kick();
    return c.body(null, 204);
  });

  app.post('/api/tasks/:id/assign', async (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    const b = await readJson(c);
    const provider = reqString(b, 'provider');
    try {
      const updated = orchestrator.assignTask(task.id, provider);
      kick();
      return c.json(updated);
    } catch (e) {
      return err(c, 409, e instanceof Error ? e.message : String(e));
    }
  });

  
  app.patch('/api/tasks/:id', async (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    const b = await readJson(c);
    const patch: Record<string, unknown> = {};
    if (b.model !== undefined) {
      const rawModel = typeof b.model === 'string' && b.model.trim() ? b.model.trim() : null;
      patch.model = task.currentProvider ? resolveProviderModel(task.currentProvider, rawModel, d.config) : rawModel;
    }
    if (typeof b.title === 'string' && b.title.trim()) {
      patch.title = b.title.trim();
    }
    const updated = orchestrator.updateTask(task.id, patch);
    return c.json(updated);
  });

  app.get('/api/tasks/:id/preview/*', async (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    const root = task.workspacePath ?? task.repoPath;
    if (!root || !existsSync(root)) return err(c, 404, 'Thư mục làm việc của task không tồn tại');

    const prefix = `/api/tasks/${task.id}/preview`;
    let subPath = c.req.path.slice(prefix.length);
    if (subPath.startsWith('/')) subPath = subPath.slice(1);
    if (!subPath) subPath = 'index.html';

    const fullPath = resolve(root, subPath);
    const rootResolved = resolve(root);
    const fullNorm = fullPath.toLowerCase();
    const rootNorm = rootResolved.toLowerCase();
    if (!fullNorm.startsWith(rootNorm + sep) && fullNorm !== rootNorm) {
      return err(c, 403, 'Truy cập ngoài thư mục workspace bị cấm.');
    }

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      return err(c, 404, `Không tìm thấy tệp: ${subPath}`);
    }

    let filePath = fullPath;
    if (stat.isDirectory()) {
      filePath = join(fullPath, 'index.html');
      if (!existsSync(filePath)) {
        return err(c, 404, 'Thư mục không có tệp index.html để xem thử.');
      }
    }

    const ext = extname(filePath).toLowerCase();
    const MIME_TYPES: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.htm': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
    };
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const content = readFileSync(filePath);
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  });

  app.get('/api/tasks/:id/diff', async (c) => {
    const task = taskOr404(c);
    if (!task) return err(c, 404, NO_TASK);
    if (task.workspacePath === null) return c.json({ status: '', diff: '', commits: [] });
    try {
      return c.json(await workspaceSummary({
        path: task.workspacePath,
        branch: task.branch,
        baseCommit: task.baseCommit,
        isolated: task.branch !== null,
      }));
    } catch (e) {
      return err(c, 500, `Không đọc được thay đổi: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // ------------------------------------------------ Shared Memory (Văn phòng dự án)

  app.get('/api/memories', (c) => {
    const repoPath = c.req.query('repoPath');
    return c.json(store.listMemories(repoPath));
  });

  app.post('/api/memories', async (c) => {
    const b = await readJson(c);
    const repoPath = reqString(b, 'repoPath');
    const title = reqString(b, 'title');
    const content = reqString(b, 'content');
    const category = (typeof b.category === 'string' && MEMORY_CATEGORIES.includes(b.category as MemoryCategory))
      ? (b.category as MemoryCategory)
      : 'context';
    const author = typeof b.author === 'string' && b.author.trim() !== '' ? b.author.trim() : 'user';
    const pinned = b.pinned === true;
    const id = typeof b.id === 'string' && b.id.trim() !== '' ? b.id.trim() : undefined;

    const item = store.upsertMemory({
      ...(id ? { id } : {}),
      repoPath,
      category,
      title,
      content,
      author,
      pinned,
    });
    try {
      bus.publish({
        id: 0,
        taskId: '',
        runId: null,
        ts: Date.now(),
        source: 'managed',
        type: 'MEMORY_UPDATED',
        data: { repoPath, item },
      });
    } catch { /* ignore */ }
    return c.json(item, 201);
  });

  app.delete('/api/memories/:id', (c) => {
    const id = c.req.param('id') ?? '';
    const deleted = store.deleteMemory(id);
    if (!deleted) return err(c, 404, 'Không tìm thấy mục bộ nhớ.');
    try {
      bus.publish({
        id: 0,
        taskId: '',
        runId: null,
        ts: Date.now(),
        source: 'managed',
        type: 'MEMORY_UPDATED',
        data: { deletedId: id },
      });
    } catch { /* ignore */ }
    return c.body(null, 204);
  });

  // ------------------------------------------------ Trưởng phòng điều phối (Manager Plans)

  app.get('/api/manager/plans', (c) => {
    const repoPath = c.req.query('repoPath');
    return c.json(store.listManagerPlans(repoPath));
  });

  app.post('/api/manager/plans', async (c) => {
    const b = await readJson(c);
    const repoPath = reqString(b, 'repoPath');
    const goal = reqString(b, 'goal');
    let isDir = false;
    try {
      isDir = statSync(repoPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new BadRequest(`repoPath không phải thư mục tồn tại: ${repoPath}`);

    const mode: ManagerMode = (typeof b.mode === 'string' && MANAGER_MODES.includes(b.mode as ManagerMode))
      ? (b.mode as ManagerMode)
      : 'semi-auto';

    let customSubtasks: Array<{ title: string; message: string; assignedProvider: ProviderId; role: string }> | undefined;
    if (Array.isArray(b.subtasks) && b.subtasks.length > 0) {
      customSubtasks = b.subtasks.map((raw) => {
        const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        return {
          title: reqString(s, 'title'),
          message: reqString(s, 'message'),
          assignedProvider: reqString(s, 'assignedProvider'),
          role: typeof s.role === 'string' && s.role.trim() !== '' ? s.role.trim() : 'Nhân viên',
        };
      });
    }

    const plan = await orchestrator.createManagerPlan({
      repoPath,
      goal,
      mode,
      ...(customSubtasks ? { subtasks: customSubtasks } : {}),
    });
    if (mode === 'auto') kick();
    try {
      bus.publish({
        id: 0,
        taskId: '',
        runId: null,
        ts: Date.now(),
        source: 'managed',
        type: 'MANAGER_PLAN_UPDATED',
        data: { repoPath, plan },
      });
    } catch { /* ignore */ }
    return c.json(plan, 201);
  });

  app.post('/api/manager/plans/:id/dispatch', async (c) => {
    const planId = c.req.param('id') ?? '';
    const b = await readJson(c, true);
    let subtasksOverride: ManagerSubtask[] | undefined;
    if (Array.isArray(b.subtasks) && b.subtasks.length > 0) {
      subtasksOverride = b.subtasks as ManagerSubtask[];
    }
    try {
      const updated = await orchestrator.dispatchManagerPlan(planId, subtasksOverride);
      kick();
      try {
        bus.publish({
          id: 0,
          taskId: '',
          runId: null,
          ts: Date.now(),
          source: 'managed',
          type: 'MANAGER_PLAN_UPDATED',
          data: { repoPath: updated.repoPath, plan: updated },
        });
      } catch { /* ignore */ }
      return c.json(updated);
    } catch (e) {
      return err(c, 404, e instanceof Error ? e.message : String(e));
    }
  });

  app.delete('/api/manager/plans/:id', (c) => {
    const planId = c.req.param('id') ?? '';
    const deleted = orchestrator.deleteManagerPlan(planId);
    if (!deleted) return err(c, 404, 'Không tìm thấy kế hoạch');
    return c.body(null, 204);
  });

  app.patch('/api/manager/plans/:id', async (c) => {
    const planId = c.req.param('id') ?? '';
    const b = await readJson(c);
    const patch: Partial<ManagerPlan> = {};
    if (typeof b.goal === 'string') patch.goal = b.goal.trim();
    if (Array.isArray(b.subtasks)) patch.subtasks = b.subtasks as ManagerSubtask[];
    try {
      const updated = orchestrator.updateManagerPlan(planId, patch);
      return c.json(updated);
    } catch (e) {
      return err(c, 404, e instanceof Error ? e.message : String(e));
    }
  });


  app.get('/api/providers', (c) => c.json(store.listProviders()));

  app.get('/api/models/quotas', (c) => {
    const now = Date.now();
    const result: Record<string, ModelQuotaInfo[]> = {};
    for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
      const quotaType = PROVIDER_QUOTA_TYPE[provider] ?? 'shared';
      const p = store.getProvider(provider);
      result[provider] = models.map((m) => {
        if (quotaType === 'shared') {
          const isCooldown = p?.cooldownUntil !== null && p?.cooldownUntil !== undefined && p.cooldownUntil > now;
          const pct = p?.usedPercent !== null && p?.usedPercent !== undefined ? Math.round(p.usedPercent * 100) : null;
          return {
            provider,
            model: m.id,
            name: m.name,
            description: m.description,
            default: m.default,
            quotaType,
            status: isCooldown ? 'cooldown' : 'ready',
            cooldownUntil: p?.cooldownUntil ?? null,
            usedPercent: p?.usedPercent ?? null,
            note: isCooldown
              ? 'Tạm nghỉ cả tài khoản (Dùng chung quota)'
              : pct !== null
                ? `Đã dùng ${pct}% (Dùng chung quota)`
                : 'Sẵn sàng (Dùng chung quota)',
          };
        }
        // per_model (Antigravity)
        const mq = store.getModelQuota(provider, m.id);
        const isCooldown = mq?.cooldownUntil !== null && mq?.cooldownUntil !== undefined && mq.cooldownUntil > now;
        return {
          provider,
          model: m.id,
          name: m.name,
          description: m.description,
          default: m.default,
          quotaType,
          status: isCooldown ? 'cooldown' : 'ready',
          cooldownUntil: mq?.cooldownUntil ?? null,
          usedPercent: mq?.usedPercent ?? null,
          note: isCooldown
            ? 'Hết quota • Tạm nghỉ'
            : 'Hạn mức độc lập • Sẵn sàng',
        };
      });
    }
    return c.json(result);
  });

  app.post('/api/models/probe', async (c) => {
    const b = await readJson(c);
    const provider = reqString(b, 'provider');
    const model = reqString(b, 'model');
    const now = Date.now();
    const quotaType = PROVIDER_QUOTA_TYPE[provider] ?? 'shared';

    if (quotaType === 'per_model') {
      const mq = store.getModelQuota(provider, model);
      if (mq?.cooldownUntil && mq.cooldownUntil > now) {
        return c.json({
          ok: false,
          provider,
          model,
          status: 'cooldown',
          cooldownUntil: mq.cooldownUntil,
          note: `Model ${model} đang hết hạn mức (tạm nghỉ đến ${new Date(mq.cooldownUntil).toLocaleTimeString()}).`,
        });
      }
      return c.json({
        ok: true,
        provider,
        model,
        status: 'ready',
        cooldownUntil: null,
        note: `Model ${model} có hạn mức độc lập và đang SẴN SÀNG!`,
      });
    }

    // shared (Claude, Codex)
    const p = store.getProvider(provider);
    const isCooldown = p?.cooldownUntil !== null && p?.cooldownUntil !== undefined && p.cooldownUntil > now;
    if (isCooldown) {
      return c.json({
        ok: false,
        provider,
        model,
        status: 'cooldown',
        cooldownUntil: p!.cooldownUntil,
        note: `${provider.toUpperCase()} dùng chung quota tài khoản và đang tạm nghỉ đến ${new Date(p!.cooldownUntil!).toLocaleTimeString()}.`,
      });
    }
    const pct = p?.usedPercent !== null && p?.usedPercent !== undefined ? Math.round(p.usedPercent * 100) : null;
    return c.json({
      ok: true,
      provider,
      model,
      status: 'ready',
      cooldownUntil: null,
      note: pct !== null
        ? `${provider.toUpperCase()} dùng chung quota, đã dùng ${pct}%.`
        : `${provider.toUpperCase()} dùng chung quota, đang sẵn sàng.`,
    });
  });

  app.post('/api/models/reset-cooldown', async (c) => {
    const b = await readJson(c);
    const provider = reqString(b, 'provider');
    const model = typeof b.model === 'string' ? b.model : undefined;
    store.resetModelQuota(provider, model);
    if (provider === 'antigravity') {
      const now = Date.now();
      const allModels = PROVIDER_MODELS[provider] ?? [];
      const activeCooldowns = store.listModelQuotas(provider)
        .filter((m) => m.cooldownUntil !== null && m.cooldownUntil > now);
      if (activeCooldowns.length < allModels.length) {
        const p = store.getProvider(provider);
        if (p) store.upsertProvider({ ...p, cooldownUntil: null, updatedAt: now });
      }
    }
    void orchestrator.tick();
    return c.json({ ok: true });
  });

  app.post('/api/providers/:id/reset-cooldown', (c) => {
    const id = c.req.param('id') as ProviderId;
    const p = store.getProvider(id);
    if (!p) return c.json({ error: 'Không tìm thấy provider' }, 404);
    store.upsertProvider({ ...p, cooldownUntil: null, usedPercent: null, updatedAt: Date.now() });
    try {
      bus.publish({
        id: 0,
        taskId: '',
        runId: null,
        ts: Date.now(),
        source: 'managed',
        type: 'QUOTA_UPDATED',
        data: { provider: id, cooldownUntil: null },
      });
    } catch { /* ignore */ }
    void orchestrator.tick();
    return c.json(store.getProvider(id));
  });

  app.post('/api/providers/refresh', async (c) => {
    try {
      await orchestrator.refreshProviders();
      const list = store.listProviders();
      try {
        bus.publish({
          id: 0,
          taskId: '',
          runId: null,
          ts: Date.now(),
          source: 'managed',
          type: 'QUOTA_UPDATED',
          data: { refreshed: true },
        });
      } catch { /* ignore */ }
      return c.json(list);
    } catch (e) {
      return err(c, 500, `Không thể làm mới trạng thái CLI: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  app.post('/api/providers/install', async (c) => {
    const b = await readJson(c);
    const provider = reqString(b, 'provider').toLowerCase();
    const pkg = PROVIDER_NPM_PACKAGES[provider];
    if (!pkg) {
      throw new BadRequest(`Nền tảng "${provider}" không hỗ trợ cài đặt tự động qua npm. Vui lòng xem hướng dẫn cài đặt thủ công.`);
    }
    try {
      const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const { stdout, stderr } = await execFileAsync(npmBin, ['install', '-g', pkg], {
        shell: process.platform === 'win32',
        timeout: 120_000,
        windowsHide: true,
      });
      await orchestrator.refreshProviders();
      const providers = store.listProviders();
      try {
        bus.publish({
          id: 0,
          taskId: '',
          runId: null,
          ts: Date.now(),
          source: 'managed',
          type: 'QUOTA_UPDATED',
          data: { installed: provider },
        });
      } catch { /* ignore */ }
      return c.json({
        ok: true,
        provider,
        package: pkg,
        output: [stdout, stderr].filter(Boolean).join('\n').trim(),
        providers,
      });
    } catch (e) {
      return err(
        c,
        500,
        `Không thể cài đặt tự động ${pkg}: ${e instanceof Error ? e.message : String(e)}. Bạn có thể chạy lệnh "npm install -g ${pkg}" trực tiếp trong Terminal.`,
      );
    }
  });

  app.get('/api/projects', async (c) => {
    if (!d.projects) return c.json([]);
    return c.json(await d.projects.list({ refresh: c.req.query('refresh') === '1' }));
  });

  app.post('/api/projects/git-init', async (c) => {
    const b = await readJson(c);
    const repoPath = reqString(b, 'repoPath');
    let isDir = false;
    try {
      isDir = statSync(repoPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new BadRequest(`Thư mục không tồn tại: ${repoPath}`);
    try {
      const info = await initGitRepository(repoPath);
      const projects = d.projects ? await d.projects.list({ refresh: true }) : [];
      return c.json({ ok: true, ...info, projects }, 201);
    } catch (e) {
      return err(c, 500, `Không thể khởi tạo Git: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  app.get('/api/config', (c) => c.json(d.config ?? { ...DEFAULT_CONFIG, dataDir: '' }));

  app.patch('/api/config', async (c) => {
    const b = await readJson(c);
    if (!d.config) {
      d.config = { ...DEFAULT_CONFIG, dataDir: '' };
    }
    if (b.models && typeof b.models === 'object') {
      d.config.models = { ...d.config.models, ...(b.models as Record<string, string>) };
      if (d.config.dataDir) {
        saveConfig(d.config.dataDir, { models: d.config.models });
      }
    }
    if (b.modelFallbackPolicy === 'auto' || b.modelFallbackPolicy === 'ask') {
      d.config.modelFallbackPolicy = b.modelFallbackPolicy;
      if (d.config.dataDir) {
        saveConfig(d.config.dataDir, { modelFallbackPolicy: d.config.modelFallbackPolicy });
      }
    }
    return c.json(d.config);
  });

  app.get('/api/system/storage', async (c) => {
    const stats = await getStorageStats(dataDir, store);
    return c.json(stats);
  });

  app.post('/api/system/prune', async (c) => {
    const b = await readJson(c, true);
    const options: PruneOptions = {
      ...(b.olderThanDays !== undefined ? { olderThanDays: Number(b.olderThanDays) } : {}),
      ...(b.orphanWorktrees !== undefined ? { orphanWorktrees: Boolean(b.orphanWorktrees) } : {}),
      ...(b.logs !== undefined ? { logs: Boolean(b.logs) } : {}),
      ...(b.vacuum !== undefined ? { vacuum: Boolean(b.vacuum) } : {}),
    };
    const res = await pruneStorage(options, dataDir, store);
    return c.json(res);
  });

  app.post('/api/system/migrate', async (c) => {
    const b = await readJson(c);
    const newPath = reqString(b, 'newPath');
    const deleteOld = b.deleteOld === true;
    try {
      const res = await migrateDataDir({ newPath, deleteOld }, dataDir, store);
      return c.json(res);
    } catch (e) {
      throw new BadRequest(e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/system/browse-folders', (c) => {
    const p = c.req.query('path') ?? null;
    return c.json(browseFolders(p));
  });

  app.post('/api/system/create-folder', async (c) => {
    const b = await readJson(c);
    const parentPath = reqString(b, 'parentPath');
    const folderName = reqString(b, 'folderName');
    const target = join(parentPath, folderName.trim());
    try {
      mkdirSync(target, { recursive: true });
      return c.json({ path: target });
    } catch (e) {
      throw new BadRequest(e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/system/pick-directory', async (c) => {
    const chosen = await pickSystemDirectory();
    return c.json({ path: chosen });
  });

  app.post('/api/shutdown', async (c) => {
    if (!d.onShutdown) return err(c, 501, 'Daemon này không hỗ trợ tắt từ xa.');
    const b = await readJson(c, true);
    if (b.force !== undefined && typeof b.force !== 'boolean') {
      throw new BadRequest('"force" phải là true hoặc false.');
    }
    const force = b.force === true;
    // Chỉ bắt đầu dừng sau khi 204 đã gửi xong, để client nhận được trả lời.
    const stop = d.onShutdown;
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      stop({ force });
    };
    const outgoing = (c.env as { outgoing?: { once(ev: string, fn: () => void): unknown } } | undefined)?.outgoing;
    if (outgoing) {
      outgoing.once('close', once);
      setTimeout(once, 2_000).unref(); // phòng khi 'close' không bao giờ đến
    } else {
      setTimeout(once, 0);
    }
    return c.body(null, 204);
  });

  // ------------------------------------------------------------ ide
  app.get('/api/ide/tree', async (c) => {
    const project = c.req.query('project');
    if (!project) return err(c, 400, 'Thiếu tham số project');
    const dir = c.req.query('dir') || '';
    try {
      const data = await browseTree(project, dir);
      return c.json(data);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/ide/file', async (c) => {
    const project = c.req.query('project');
    const path = c.req.query('path');
    if (!project || !path) return err(c, 400, 'Thiếu tham số project hoặc path');
    try {
      const data = await readProjectFile(project, path);
      return c.json(data);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.put('/api/ide/file', async (c) => {
    const b = await readJson(c);
    const project = reqString(b, 'project');
    const path = reqString(b, 'path');
    const content = typeof b.content === 'string' ? b.content : '';
    try {
      const res = await writeProjectFile(project, path, content);
      return c.json(res);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/ide/item', async (c) => {
    const b = await readJson(c);
    const project = reqString(b, 'project');
    const path = reqString(b, 'path');
    const type = b.type === 'directory' ? 'directory' : 'file';
    try {
      const res = await createProjectItem(project, path, type);
      return c.json(res, 201);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.patch('/api/ide/item', async (c) => {
    const b = await readJson(c);
    const project = reqString(b, 'project');
    const oldPath = reqString(b, 'oldPath');
    const newPath = reqString(b, 'newPath');
    try {
      const res = await renameProjectItem(project, oldPath, newPath);
      return c.json(res);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.delete('/api/ide/item', async (c) => {
    const b = await readJson(c);
    const project = reqString(b, 'project');
    const path = reqString(b, 'path');
    try {
      const res = await deleteProjectItem(project, path);
      return c.json(res);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  // Git & Worktree
  app.get('/api/ide/git/status', async (c) => {
    const cwd = c.req.query('cwd');
    if (!cwd) return err(c, 400, 'Thiếu tham số cwd');
    try {
      const status = await getGitStatus(cwd);
      return c.json(status);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/ide/git/diff', async (c) => {
    const cwd = c.req.query('cwd');
    if (!cwd) return err(c, 400, 'Thiếu tham số cwd');
    const path = c.req.query('path') || undefined;
    const staged = c.req.query('staged') === '1';
    try {
      const diff = await getGitDiff(cwd, path, staged);
      return c.json(diff);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/ide/git/stage', async (c) => {
    const b = await readJson(c);
    const cwd = reqString(b, 'cwd');
    const paths = Array.isArray(b.paths) ? b.paths.map(String) : [];
    try {
      await stageFiles(cwd, paths);
      return c.json({ ok: true });
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/ide/git/unstage', async (c) => {
    const b = await readJson(c);
    const cwd = reqString(b, 'cwd');
    const paths = Array.isArray(b.paths) ? b.paths.map(String) : [];
    try {
      await unstageFiles(cwd, paths);
      return c.json({ ok: true });
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/ide/git/discard', async (c) => {
    const b = await readJson(c);
    const cwd = reqString(b, 'cwd');
    const paths = Array.isArray(b.paths) ? b.paths.map(String) : [];
    try {
      await discardFiles(cwd, paths);
      return c.json({ ok: true });
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/ide/git/commit', async (c) => {
    const b = await readJson(c);
    const cwd = reqString(b, 'cwd');
    const message = reqString(b, 'message');
    try {
      const res = await commitChanges(cwd, message);
      return c.json(res);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/ide/git/branches', async (c) => {
    const cwd = c.req.query('cwd');
    if (!cwd) return err(c, 400, 'Thiếu tham số cwd');
    try {
      const branches = await listBranches(cwd);
      return c.json(branches);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/ide/git/checkout', async (c) => {
    const b = await readJson(c);
    const cwd = reqString(b, 'cwd');
    const branch = reqString(b, 'branch');
    const createNew = b.createNew === true;
    try {
      const res = await checkoutBranch(cwd, branch, createNew);
      return c.json(res);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  app.delete('/api/ide/git/worktree', async (c) => {
    const b = await readJson(c);
    const cwd = reqString(b, 'cwd');
    const worktreePath = reqString(b, 'path');
    const force = b.force === true;
    try {
      const res = await removeWorktree(cwd, worktreePath, force);
      return c.json(res);
    } catch (e) {
      return err(c, 500, e instanceof Error ? e.message : String(e));
    }
  });

  // ------------------------------------------------------------ web (tĩnh)

  app.get('*', async (c) => {
    if (new URL(c.req.url).pathname.startsWith('/api/')) return err(c, 404, 'Không tìm thấy.');
    // Đã qua kiểm tra khóa: nếu khóa đến từ query thì đặt cookie cho lần sau.
    if (c.req.query('key') !== undefined) {
      c.header('Set-Cookie', `${KEY_COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=/`);
    }
    if (d.webDir === null) return c.html(NOT_BUILT_PAGE);
    const root = resolve(d.webDir);
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    let file = resolve(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return err(c, 404, 'Không tìm thấy.');
    let ok = false;
    try {
      ok = statSync(file).isFile();
    } catch {
      ok = false;
    }
    if (!ok) {
      if (extname(path) !== '' && extname(path).toLowerCase() in MIME) return err(c, 404, 'Không tìm thấy.');
      file = join(root, 'index.html'); // SPA fallback
    }
    try {
      const body = await readFile(file);
      c.header('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
      return c.body(body);
    } catch {
      return c.html(NOT_BUILT_PAGE);
    }
  });

  return app;
}

/**
 * Gắn WebSocket `/api/events` vào HTTP server. Mỗi kết nối nhận HELLO rồi mọi VEvent trên bus.
 * Kiểm tra Host, Origin (nếu có phải trùng Host) và khóa trước khi nâng cấp.
 */
export function attachWebSocket(
  server: Server,
  d: { bus: EventBus; key: string },
): { close(): Promise<void> } {
  const wss = new WebSocketServer({ noServer: true });
  const terminalWss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const terminalSockets = new Set<WebSocket>();

  const reject = (socket: Duplex, code: number, text: string): void => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return reject(socket, 400, 'Bad Request');
    }
    if (url.pathname !== '/api/events' && url.pathname !== '/api/terminal/ws') {
      return reject(socket, 404, 'Not Found');
    }
    const host = req.headers.host;
    if (!isLocalHost(host)) return reject(socket, 403, 'Forbidden');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost: string;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        return reject(socket, 403, 'Forbidden');
      }
      if (originHost !== host?.toLowerCase()) return reject(socket, 403, 'Forbidden');
    }
    const given = requestKey({
      header: typeof req.headers[KEY_HEADER] === 'string' ? req.headers[KEY_HEADER] : undefined,
      query: url.searchParams.get('key'),
      cookie: req.headers.cookie,
    });
    if (!keyMatches(given, d.key)) return reject(socket, 401, 'Unauthorized');

    if (url.pathname === '/api/events') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        sockets.add(ws);
        const unsubscribe = d.bus.subscribe((e) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
        });
        const cleanup = (): void => {
          unsubscribe();
          sockets.delete(ws);
        };
        ws.on('close', cleanup);
        ws.on('error', cleanup);
        ws.send(JSON.stringify({ type: 'HELLO' }));
      });
    } else if (url.pathname === '/api/terminal/ws') {
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        terminalSockets.add(ws);
        const cwd = url.searchParams.get('cwd') || process.cwd();
        const cols = parseInt(url.searchParams.get('cols') || '80', 10);
        const rows = parseInt(url.searchParams.get('rows') || '24', 10);
        createTerminalSession({
          id: Math.random().toString(36).slice(2),
          cwd,
          ws,
          cols,
          rows,
        });
        ws.on('close', () => terminalSockets.delete(ws));
      });
    }
  };
  server.on('upgrade', onUpgrade);

  return {
    close: () => new Promise<void>((resolveClose) => {
      server.off('upgrade', onUpgrade);
      for (const ws of sockets) ws.terminate();
      for (const ws of terminalSockets) ws.terminate();
      wss.close(() => {
        terminalWss.close(() => resolveClose());
      });
    }),
  };
}
