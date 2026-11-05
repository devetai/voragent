import { existsSync, statSync, chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import spawn from 'cross-spawn';
import { isPidAlive, readDaemonInfo, startDaemon } from '@voragent/core';
import type { Daemon, DaemonInfo } from '@voragent/core';
import type { Adapter } from '@voragent/adapters';
import { TASK_STATUS_LABEL } from '@voragent/shared';
import type { ProviderId, ProviderState, Project, Task } from '@voragent/shared';

export interface CliContext {
  /** Thư mục dữ liệu (mặc định `$VORAGENT_HOME` hoặc `~/.voragent`). */
  dataDir: string;
  cwd: string;
  out: (s: string) => void;
  err: (s: string) => void;
  /** File JS để chạy lại chính nó ở chế độ nền. */
  entry: string;
  /** Chỉ dùng trong test: adapter thay cho adapter thật. */
  adapters?: Map<ProviderId, Adapter>;
  /** Chỉ dùng trong test. */
  openBrowser?: (url: string) => void;
  backgroundTimeoutMs?: number;
  /** Thời gian `stop` chờ daemon gỡ daemon.json (mặc định 60 s). */
  stopWaitMs?: number;
  /** Chỉ dùng trong test: thay cho process.exit khi thoát cứng. */
  hardExit?: (code: number) => void;
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.VORAGENT_HOME && env.VORAGENT_HOME !== '' ? env.VORAGENT_HOME : join(homedir(), '.voragent');
}

export const NO_DAEMON = 'Daemon chưa chạy. Chạy: voragent';

const USAGE = `Cách dùng:
  voragent [--port N] [--no-open]        chạy daemon trong terminal, mở trình duyệt
  voragent start --background [--port N] chạy daemon nền, in URL rồi thoát
  voragent projects                       liệt kê các dự án đã dùng với Claude Code / Antigravity
  voragent add <dự-án|đường-dẫn> <tin nhắn…> [--mode m] [--agent id]
                                          dự án chọn theo tên (xem: voragent projects)
  voragent status
  voragent stop [--force]                 --force: dừng ngay các lượt đang chạy (xếp lại để chạy tiếp lần sau)`;

/** Mở URL bằng trình duyệt mặc định; mọi lỗi đều bị bỏ qua. */
export function openUrl(url: string): void {
  try {
    const [cmd, args]: [string, string[]] =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]]
          : ['xdg-open', [url]];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // không mở được trình duyệt: URL đã được in ra
  }
}

// ------------------------------------------------------------------ chế độ foreground

async function runForeground(
  ctx: CliContext, o: { port?: number; open: boolean; quiet: boolean },
): Promise<number> {
  let d: Daemon;
  try {
    d = await startDaemon({
      dataDir: ctx.dataDir,
      ...(o.port !== undefined ? { port: o.port } : {}),
      ...(ctx.adapters ? { adapters: ctx.adapters } : {}),
    });
  } catch (e) {
    ctx.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  // Chế độ nền: log có thể bị đính kèm khi báo lỗi, nên không in khóa; tiến trình cha in URL.
  ctx.out(o.quiet ? `voragent đang chạy (nền) trên cổng ${d.port}.\n` : `voragent đang chạy. Mở: ${d.url}\n`);
  if (o.open) (ctx.openBrowser ?? openUrl)(d.url);

  let signals = 0;
  const onSignal = (): void => {
    signals += 1;
    if (signals === 1 && !forced) {
      ctx.out('Đang dừng, chờ các lượt đang chạy xong... Nhấn Ctrl-C lần nữa để dừng ngay.\n');
      void d.stop();
    } else {
      hardStop();
    }
  };
  // Dừng cứng: giết các lượt đang chạy (cả cây tiến trình), chờ tối đa ~5 s rồi mới thoát.
  let forced = false;
  const hardStop = (): void => {
    if (forced) {
      (ctx.hardExit ?? process.exit)(1); // lần thứ ba trở đi: thoát luôn
      return;
    }
    forced = true;
    ctx.out('Đang dừng ngay các lượt đang chạy...\n');
    void d.stop({ force: true });
    setTimeout(() => (ctx.hardExit ?? process.exit)(1), 5_000).unref();
  };
  const onTerm = (): void => {
    signals += 1;
    hardStop();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onTerm);
  try {
    await d.closed;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onTerm);
  }
  ctx.out('Đã dừng voragent.\n');
  return 0;
}

// ------------------------------------------------------------------ chế độ nền

async function runBackground(ctx: CliContext, o: { port?: number }): Promise<number> {
  const running = readDaemonInfo(ctx.dataDir);
  if (running && isPidAlive(running.pid)) {
    ctx.out(`Daemon đã chạy. Mở: ${urlOf(running)}\n`);
    return 0;
  }
  mkdirSync(ctx.dataDir, { recursive: true });
  const logFile = join(ctx.dataDir, 'daemon.log');
  const fd = openSync(logFile, 'a', 0o600);
  try {
    chmodSync(logFile, 0o600); // file có sẵn từ trước có thể rộng quyền hơn
  } catch {
    // Windows hoặc hệ thống không hỗ trợ
  }
  let exited = false;
  const args = [ctx.entry, '--no-open', '--quiet', ...(o.port !== undefined ? ['--port', String(o.port)] : [])];
  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: { ...process.env, VORAGENT_HOME: ctx.dataDir },
    });
    child.on('exit', () => {
      exited = true;
    });
    child.on('error', () => {
      exited = true;
    });
    child.unref();
  } finally {
    closeSync(fd);
  }

  const deadline = Date.now() + (ctx.backgroundTimeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    const info = readDaemonInfo(ctx.dataDir);
    if (info && isPidAlive(info.pid)) {
      ctx.out(`voragent đang chạy nền (pid ${info.pid}). Mở: ${urlOf(info)}\n`);
      return 0;
    }
    if (exited) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  ctx.err(`Daemon không khởi động được. Xem log: ${logFile}\n`);
  return 1;
}

const urlOf = (i: DaemonInfo): string => `http://127.0.0.1:${i.port}/?key=${i.key}`;

// ------------------------------------------------------------------ lệnh gọi daemon

function liveDaemon(ctx: CliContext): DaemonInfo | null {
  const info = readDaemonInfo(ctx.dataDir);
  return info && isPidAlive(info.pid) ? info : null;
}

async function call(
  info: DaemonInfo, method: string, path: string, body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
    method,
    headers: { 'x-voragent-key': info.key, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const errorOf = (json: unknown, fallback: string): string =>
  typeof json === 'object' && json !== null && typeof (json as { error?: unknown }).error === 'string'
    ? (json as { error: string }).error
    : fallback;

async function withDaemon(
  ctx: CliContext, fn: (info: DaemonInfo) => Promise<number>,
): Promise<number> {
  const info = liveDaemon(ctx);
  if (!info) {
    ctx.err(`${NO_DAEMON}\n`);
    return 1;
  }
  try {
    return await fn(info);
  } catch (e) {
    ctx.err(`Không kết nối được daemon (cổng ${info.port}): ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/** Thư mục tồn tại nhưng không nằm trong repo git. */
function isPlainFolder(path: string): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) return false;
  } catch {
    return false;
  }
  const r = spawn.sync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: path, encoding: 'utf8', windowsHide: true });
  return !(r.status === 0 && r.stdout.trim() === 'true');
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => [...(r[i] ?? '')].length)));
  return rows
    .map((r) => r.map((c, i) => c + ' '.repeat(widths[i]! - [...c].length)).join('  ').trimEnd())
    .join('\n');
}

const SOURCE_LABEL: Record<string, string> = { claude: 'Claude', antigravity: 'Antigravity' };

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatProjects(projects: Project[]): string {
  if (projects.length === 0) {
    return 'Không tìm thấy dự án nào. Thêm bằng: voragent add <thư-mục> <tin nhắn…>\n';
  }
  const rows: string[][] = [['Tên', 'Đường dẫn', 'Dùng lần cuối', 'Nguồn', 'Nhánh', 'File sửa dở', 'Task']];
  for (const p of projects) {
    rows.push([
      p.name,
      p.path,
      p.lastUsedAt !== null ? stamp(p.lastUsedAt) : '-',
      p.sources.map((s) => SOURCE_LABEL[s.source] ?? s.source).join(', '),
      p.branch ?? '-',
      p.dirtyCount !== null ? String(p.dirtyCount) : '-',
      String(p.taskCount),
    ]);
  }
  return `${table(rows)}\n`;
}

/** Chuỗi trông như đường dẫn (có dấu phân cách hoặc ký tự ổ đĩa) thì không tra theo tên. */
const looksLikePath = (s: string): boolean => /[\\/:]/.test(s);

/** Tra dự án theo tên: khớp chính xác (không phân biệt hoa thường), nếu không thì khớp một phần duy nhất. */
export function matchProject(
  projects: Project[], name: string,
): { project: Project } | { error: string } {
  // NFC + chữ thường cả hai phía: tên tiếng Việt gõ dạng NFD (dấu tách rời) vẫn khớp dạng NFC.
  const fold = (s: string): string => s.normalize('NFC').toLowerCase();
  const q = fold(name);
  const exact = projects.filter((p) => fold(p.name) === q);
  const hits = exact.length > 0 ? exact : projects.filter((p) => fold(p.name).includes(q));
  if (hits.length === 1) return { project: hits[0]! };
  if (hits.length === 0) {
    return { error: `Không tìm thấy dự án "${name}". Xem danh sách: voragent projects` };
  }
  const list = hits.map((p) => `  ${p.name}  ${p.path}`).join('\n');
  return { error: `Có ${hits.length} dự án khớp "${name}", hãy nhập đường dẫn đầy đủ:\n${list}` };
}

export function formatStatus(providers: ProviderState[], tasks: Task[], now = Date.now()): string {
  const prov: string[][] = [['Nền tảng', 'Đã cài', 'Tạm nghỉ đến', 'Đã dùng']];
  for (const p of providers) {
    prov.push([
      p.id,
      p.installed ? 'có' : 'không',
      p.cooldownUntil !== null && p.cooldownUntil > now ? hhmm(p.cooldownUntil) : '-',
      p.usedPercent !== null ? `${Math.round(p.usedPercent * 100)}%` : '-',
    ]);
  }
  const open = tasks.filter((t) => t.status !== 'closed');
  let out = prov.length > 1 ? table(prov) : 'Chưa có nền tảng nào.';
  out += '\n\n';
  if (open.length === 0) {
    out += 'Không có task nào đang mở.';
  } else {
    const rows: string[][] = [['Task', 'Trạng thái', 'Nền tảng', 'Tiêu đề']];
    for (const t of open) {
      rows.push([`#${t.seq}`, TASK_STATUS_LABEL[t.status], t.currentProvider ?? '-', t.title]);
    }
    out += table(rows);
  }
  return `${out}\n`;
}

// ------------------------------------------------------------------ điểm vào

export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const sub = argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : null;
  const rest = sub === null ? argv : argv.slice(1);
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        port: { type: 'string' },
        force: { type: 'boolean' },
        'no-open': { type: 'boolean' },
        quiet: { type: 'boolean' }, // nội bộ: tiến trình nền không in khóa
        background: { type: 'boolean' },
        mode: { type: 'string' },
        agent: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    ctx.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}\n`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    ctx.out(`${USAGE}\n`);
    return 0;
  }

  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      ctx.err(`--port phải là số nguyên từ 1 đến 65535 (nhận được: ${values.port}).\n`);
      return 1;
    }
  }
  const portOpt = port !== undefined ? { port } : {};

  switch (sub) {
    case null:
      return runForeground(ctx, { ...portOpt, open: values['no-open'] !== true, quiet: values.quiet === true });
    case 'start':
      if (!values.background) {
        ctx.err(`Chỉ hỗ trợ: voragent start --background\n${USAGE}\n`);
        return 1;
      }
      return runBackground(ctx, portOpt);
    case 'add': {
      const [target, ...words] = positionals;
      if (!target || words.length === 0) {
        ctx.err(`Thiếu đối số.\n${USAGE}\n`);
        return 1;
      }
      const asPath = resolve(ctx.cwd, target);
      let isDir = false;
      let isFile = false;
      try {
        const st = statSync(asPath);
        isDir = st.isDirectory();
        isFile = !isDir;
      } catch {
        isDir = false;
      }
      if (isFile) {
        ctx.err(`Lỗi: không phải thư mục: ${asPath}\n`);
        return 1;
      }
      if (!isDir && looksLikePath(target)) {
        ctx.err(`Lỗi: thư mục không tồn tại: ${asPath}\n`);
        return 1;
      }
      return withDaemon(ctx, async (info) => {
        let repoPath = asPath;
        if (!isDir) {
          const r = await call(info, 'GET', '/api/projects');
          if (r.status !== 200) {
            ctx.err(`Không đọc được danh sách dự án: ${errorOf(r.json, `HTTP ${r.status}`)}\n`);
            return 1;
          }
          const m = matchProject(r.json as Project[], target);
          if ('error' in m) {
            ctx.err(`${m.error}\n`);
            return 1;
          }
          repoPath = m.project.path;
        }
        const body: Record<string, unknown> = {
          repoPath,
          message: words.join(' '),
        };
        if (values.mode !== undefined) body.mode = values.mode;
        if (values.agent !== undefined) body.priority = [values.agent];
        const r = await call(info, 'POST', '/api/tasks', body);
        if (r.status !== 201) {
          ctx.err(`Không tạo được task: ${errorOf(r.json, `HTTP ${r.status}`)}\n`);
          return 1;
        }
        const t = r.json as Task;
        if (isPlainFolder(String(body.repoPath))) {
          ctx.err(
            `Cảnh báo: ${String(body.repoPath)} không phải repo git, nên agent sẽ làm việc trực tiếp trong thư mục này, `
            + 'không cách ly (không có worktree, không commit, không hoàn tác được).\n',
          );
        }
        ctx.out(`Đã tạo task #${t.seq}: ${t.title}\n`);
        return 0;
      });
    }
    case 'projects':
      return withDaemon(ctx, async (info) => {
        const r = await call(info, 'GET', '/api/projects');
        if (r.status !== 200) {
          ctx.err(`Không đọc được danh sách dự án: ${errorOf(r.json, `HTTP ${r.status}`)}\n`);
          return 1;
        }
        ctx.out(formatProjects(r.json as Project[]));
        return 0;
      });
    case 'status':
      return withDaemon(ctx, async (info) => {
        const [p, t] = await Promise.all([
          call(info, 'GET', '/api/providers'), call(info, 'GET', '/api/tasks'),
        ]);
        if (p.status !== 200 || t.status !== 200) {
          ctx.err(`Không đọc được trạng thái: ${errorOf(p.status !== 200 ? p.json : t.json, 'lỗi không rõ')}\n`);
          return 1;
        }
        ctx.out(formatStatus(p.json as ProviderState[], t.json as Task[]));
        return 0;
      });
    case 'stop':
      return withDaemon(ctx, async (info) => {
        const r = await call(info, 'POST', '/api/shutdown', values.force ? { force: true } : undefined);
        if (r.status !== 204) {
          ctx.err(`Không dừng được daemon: ${errorOf(r.json, `HTTP ${r.status}`)}\n`);
          return 1;
        }
        // Chờ daemon gỡ daemon.json (nó chờ các lượt đang chạy xong).
        ctx.out('Đang dừng daemon...\n');
        const deadline = Date.now() + (ctx.stopWaitMs ?? 60_000);
        while (Date.now() < deadline && readDaemonInfo(ctx.dataDir)?.key === info.key) {
          await new Promise((res) => setTimeout(res, 50));
        }
        if (readDaemonInfo(ctx.dataDir)?.key === info.key) {
          ctx.err('Daemon vẫn đang dừng (chờ các lượt đang chạy xong). Kiểm tra lại bằng: voragent status\n');
          return 1;
        }
        ctx.out('Đã dừng daemon.\n');
        return 0;
      });
    default:
      ctx.err(`Lệnh không biết: ${sub}\n${USAGE}\n`);
      return 1;
  }
}

