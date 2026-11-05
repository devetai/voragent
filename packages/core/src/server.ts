import { timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Config, ProviderId, WorkspaceMode } from '@voragent/shared';
import type { EventBus } from './bus.js';
import { DEFAULT_CONFIG } from './config.js';
import type { Orchestrator } from './orchestrator.js';
import type { ProjectCatalog } from './projects.js';
import type { Store } from './store.js';
import { workspaceSummary } from './workspace.js';

export const KEY_COOKIE = 'voragent_key';
export const KEY_HEADER = 'x-voragent-key';

const MODES: WorkspaceMode[] = ['head-dirty-commit', 'head-commit', 'dirty-nocommit'];
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
  /** Cấu hình hiện hành cho GET /api/config. Thiếu thì trả cấu hình mặc định. */
  config?: Config;
  /** Gọi sau khi trả 204 cho POST /api/shutdown. `force`: dừng cứng các lượt đang chạy. Không có thì route trả 501. */
  onShutdown?: (o: { force: boolean }) => void;
  /** Danh mục dự án cho GET /api/projects. Thiếu thì route trả []. */
  projects?: ProjectCatalog;
}): Hono {
  const { orchestrator, store, key } = d;
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
    if (task.status !== 'awaiting_user' && task.status !== 'failed') {
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

  app.get('/api/providers', (c) => c.json(store.listProviders()));

  app.get('/api/projects', async (c) => {
    if (!d.projects) return c.json([]);
    return c.json(await d.projects.list({ refresh: c.req.query('refresh') === '1' }));
  });

  app.get("/api/config", (c) => c.json(d.config ?? { ...DEFAULT_CONFIG, dataDir: "" }));

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
      if (extname(path) !== '') return err(c, 404, 'Không tìm thấy.');
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
  const sockets = new Set<WebSocket>();

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
    if (url.pathname !== '/api/events') return reject(socket, 404, 'Not Found');
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
  };
  server.on('upgrade', onUpgrade);

  return {
    close: () => new Promise<void>((resolveClose) => {
      server.off('upgrade', onUpgrade);
      for (const ws of sockets) ws.terminate();
      wss.close(() => resolveClose());
    }),
  };
}
