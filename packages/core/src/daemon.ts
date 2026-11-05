import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import { createAdapters, createFakeAdapter, discoverAll, fakeFixturePath } from '@voragent/adapters';
import type { Adapter } from '@voragent/adapters';
import type { ProviderId } from '@voragent/shared';
import { EventBus } from './bus.js';
import { DEFAULT_CONFIG, loadConfig } from './config.js';
import { createOrchestrator } from './orchestrator.js';
import { createProjectCatalog } from './projects.js';
import type { ProjectCatalogDeps } from './projects.js';
import { attachWebSocket, createServer } from './server.js';
import { openStore } from './store.js';

export interface DaemonInfo {
  port: number;
  key: string;
  pid: number;
}

export interface Daemon {
  /** URL đầy đủ kèm `?key=`. */
  url: string;
  key: string;
  port: number;
  /**
   * Dừng có trật tự (chờ các lượt đang chạy). An toàn khi gọi nhiều lần; gọi lại với `force` khi đang dừng êm
   * sẽ nâng lên dừng cứng (giết các lượt đang chạy, xếp chúng lại để chạy tiếp ở lần khởi động sau).
   */
  stop(opts?: { force?: boolean }): Promise<void>;
  /** Resolve khi daemon đã dừng xong (do stop() hoặc POST /api/shutdown). */
  closed: Promise<void>;
}

export const DAEMON_FILE = 'daemon.json';

/** Đọc `<dataDir>/daemon.json`; null nếu không có hoặc hỏng. */
export function readDaemonInfo(dataDir: string): DaemonInfo | null {
  try {
    const v = JSON.parse(readFileSync(join(dataDir, DAEMON_FILE), 'utf8')) as Partial<DaemonInfo>;
    if (typeof v.port === 'number' && typeof v.key === 'string' && typeof v.pid === 'number') {
      return { port: v.port, key: v.key, pid: v.pid };
    }
  } catch {
    // không có hoặc hỏng
  }
  return null;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // tồn tại nhưng không có quyền
  }
}

/** Thư mục `packages/web/dist` nếu đã build; tìm theo vị trí của file này (dist/src hoặc src). */
export function findWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../../web/dist', '../../web/dist']) {
    const dir = resolve(here, rel);
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

function createFakeAdapters(): Map<ProviderId, Adapter> {
  return new Map<ProviderId, Adapter>([
    ['fake-a', createFakeAdapter({ id: 'fake-a', fixture: fakeFixturePath('fake-quota.jsonl'), exitCode: 1 })],
    ['fake-b', createFakeAdapter({ id: 'fake-b', fixture: fakeFixturePath('fake-ok.jsonl') })],
  ]);
}

export async function startDaemon(o: {
  dataDir: string;
  port?: number;
  /** Map adapter có sẵn, hoặc hàm dựng từ `config.priority` (mặc định: `createAdapters`). */
  adapters?: Map<ProviderId, Adapter> | ((ids: ProviderId[]) => Map<ProviderId, Adapter>);
  /** Mặc định: tự tìm `packages/web/dist`. */
  webDir?: string | null;
  /** Chỉ để test: nguồn dự án thay cho `discoverAll`. */
  projectSources?: ProjectCatalogDeps['sources'];
  /** Thư mục home dùng để dò dự án (mặc định `$VORAGENT_USER_HOME` hoặc `os.homedir()`). */
  userHome?: string;
  /** Thư mục tạm bị loại khỏi danh sách dự án (mặc định: `os.tmpdir()`). */
  projectTmpDirs?: string[];
}): Promise<Daemon> {
  const { dataDir } = o;
  mkdirSync(dataDir, { recursive: true });

  const existing = readDaemonInfo(dataDir);
  if (existing && isPidAlive(existing.pid)) {
    throw new Error(
      `Daemon đã chạy (pid ${existing.pid}, cổng ${existing.port}). Dừng bằng: voragent stop`,
    );
  }

  const config = loadConfig(dataDir);
  const store = openStore(join(dataDir, 'voragent.db'));
  const bus = new EventBus();
  const key = randomBytes(24).toString('hex');
  const port = o.port ?? config.port;
  let orchestrator: ReturnType<typeof createOrchestrator> | null = null;

  let stopPromise: Promise<void> | null = null;
  let markClosed: () => void = () => undefined;
  const closed = new Promise<void>((r) => {
    markClosed = r;
  });
  let ws: { close(): Promise<void> } | null = null;
  let http: Server | null = null;
  let wrote = false;

  const stop = (opts: { force?: boolean } = {}): Promise<void> => {
    const force = opts.force === true;
    if (force) void orchestrator?.stop({ force: true }).catch(() => undefined); // nâng cấp cả khi đang dừng êm
    stopPromise ??= (async () => {
      try {
        await orchestrator?.stop({ force });
      } catch {
        // vẫn đóng phần còn lại
      }
      if (ws) await ws.close();
      const server = http;
      if (server?.listening) {
        // Đóng êm: kết nối rảnh đóng ngay, kết nối đang trả lời (vd. 204 của /api/shutdown) được xả xong;
        // sau 1,5 s còn sót thì ngắt hẳn.
        await new Promise<void>((r) => {
          const force = setTimeout(() => server.closeAllConnections(), 1_500);
          server.close(() => {
            clearTimeout(force);
            r();
          });
          server.closeIdleConnections();
        });
      }
      try {
        store.close();
      } catch {
        // đã đóng
      }
      if (wrote) {
        const cur = readDaemonInfo(dataDir);
        if (cur?.pid === process.pid && cur.key === key) {
          rmSync(join(dataDir, DAEMON_FILE), { force: true });
        }
      }
      markClosed();
    })();
    return stopPromise;
  };

  try {
    // HOOK PHÁT TRIỂN/KIỂM THỬ: VORAGENT_FAKE=1 (khi không truyền adapters) thay adapter thật bằng hai adapter giả:
    // `fake-a` (fixture hết quota, thoát mã 1) và `fake-b` (fixture chạy ổn). Nếu config.json chưa đổi `priority`
    // (còn là mặc định) thì ưu tiên là ['fake-a', 'fake-b']. Dùng để thử bàn giao trên giao diện web mà không tốn quota.
    const fakeMode = o.adapters === undefined && process.env.VORAGENT_FAKE === '1';
    if (fakeMode && config.priority.join() === DEFAULT_CONFIG.priority.join()) {
      config.priority = ['fake-a', 'fake-b'];
    }
    const adapters = typeof o.adapters === 'function'
      ? o.adapters(config.priority)
      : o.adapters ?? (fakeMode ? createFakeAdapters() : createAdapters(config.priority));
    const orch = createOrchestrator({ store, bus, adapters, config });
    orchestrator = orch;

    const envHome = process.env.VORAGENT_USER_HOME;
    const home = o.userHome ?? (envHome !== undefined && envHome !== '' ? envHome : homedir());
    // Home bị ghi đè thì KHÔNG đọc APPDATA thật: dẫn xuất từ home đó (chỉ win32 cần; nền tảng khác dùng mặc định dưới home).
    const homeOverridden = o.userHome !== undefined || (envHome !== undefined && envHome !== '');
    const appData = homeOverridden
      ? (process.platform === 'win32' ? join(home, 'AppData', 'Roaming') : undefined)
      : process.env.APPDATA;
    const projects = createProjectCatalog({
      sources: o.projectSources ?? [() => discoverAll({ home, ...(appData ? { appData } : {}) })],
      store, dataDir, home,
      ...(o.projectTmpDirs !== undefined ? { tmpDirs: o.projectTmpDirs } : {}),
    });

    const app = createServer({
      orchestrator: orch, store, bus, key, config, projects,
      webDir: o.webDir === undefined ? findWebDir() : o.webDir,
      onShutdown: (o) => {
        void stop(o);
      },
    });
    const server = createAdaptorServer({ fetch: app.fetch, hostname: '127.0.0.1' }) as Server;
    http = server;
    ws = attachWebSocket(server, { bus, key });

    // Chiếm cổng TRƯỚC: cổng bận thì báo lỗi ngay, chưa recover hay chạy lượt nào.
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        rejectListen(
          e.code === 'EADDRINUSE'
            ? new Error(`Cổng ${port} đang được dùng. Chọn cổng khác: voragent --port <số>`)
            : e,
        );
      });
      server.listen(port, '127.0.0.1', resolveListen);
    });
    // Lỗi socket về sau không được làm sập tiến trình.
    server.on('error', (e) => console.error('[server]', e));

    orch.recover();
    await orch.refreshProviders();
    orch.start();

    const actualPort = (server.address() as AddressInfo).port;
    const info: DaemonInfo = { port: actualPort, key, pid: process.pid };
    // Ghi nguyên tử (file tạm rồi đổi tên) và chỉ chủ sở hữu đọc được: file chứa khóa.
    const file = join(dataDir, DAEMON_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(info, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    wrote = true;

    return {
      url: `http://127.0.0.1:${actualPort}/?key=${key}`,
      key,
      port: actualPort,
      stop,
      closed,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
