import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Project, ProviderState, Task, VEvent } from '@voragent/shared';
import { ApiError, api, errText } from './api';
import { Board } from './Board';
import { INITIAL_CONNECTION, nextConnectionState } from './connection';
import type { ConnectionEvent, ConnectionState } from './connection';
import { NewTaskForm } from './NewTaskForm';
import { ProjectList } from './ProjectList';
import { QuotaBar } from './QuotaBar';
import { TaskView } from './TaskView';
import { applyEvent, mergeEvents, projectKeyOf, projectPathOf, resolveProjectRoute, taskIdOf, tasksOfProject } from './state';
import type { UiState } from './state';

type Action =
  | { t: 'load'; tasks: Task[]; providers: ProviderState[]; events: Map<string, VEvent[]> }
  | { t: 'event'; e: VEvent }
  | { t: 'providers'; providers: ProviderState[] }
  | { t: 'history'; taskId: string; events: VEvent[] };

const initial: UiState = { tasks: new Map(), events: new Map(), providers: new Map() };

function reduce(s: UiState, a: Action): UiState {
  switch (a.t) {
    case 'load': {
      let next: UiState = {
        tasks: new Map(a.tasks.map((t) => [t.id, t])),
        events: new Map(s.events),
        providers: new Map(a.providers.map((p) => [p.id, p])),
      };
      for (const [id, evs] of a.events) next = mergeEvents(next, id, evs);
      return next;
    }
    case 'event':
      return applyEvent(s, a.e);
    case 'providers':
      return { ...s, providers: new Map(a.providers.map((p) => [p.id, p])) };
    case 'history':
      return mergeEvents(s, a.taskId, a.events);
  }
}

const REFRESH_PROVIDER_EVENTS = new Set(['QUOTA_UPDATED', 'QUOTA_EXHAUSTED', 'RUN_FINISHED']);

function useHash(): [string, (h: string) => void] {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [hash, (h) => { window.location.hash = h; }];
}

const PROJECT_PREFIX = '#/project/';

const baseName = (p: string): string => p.replace(/[\/]+$/, '').split(/[\/]/).pop() ?? p;

export function App() {
  const [state, dispatch] = useReducer(reduce, initial);
  const [conn, setConn] = useState<ConnectionState>(INITIAL_CONNECTION);
  const connRef = useRef<ConnectionState>(INITIAL_CONNECTION);
  const sockRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hash, go] = useHash();
  const nav = (h: string): void => {
    setNotice(null);
    go(h);
  };
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projLoading, setProjLoading] = useState(true);
  const [projError, setProjError] = useState<string | null>(null);
  // Màn danh sách gần nhất (dự án / bảng tất cả / bảng một dự án): nơi quay về khi thoát task hoặc form.
  const [listHash, setListHash] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const projReq = useRef(0);
  const mounted = useRef(true);

  const loadProjects = useCallback(async (refresh: boolean): Promise<void> => {
    const req = ++projReq.current;
    setProjLoading(true);
    try {
      const list = await api.projects(refresh);
      if (!mounted.current || req !== projReq.current) return;
      setProjects(list);
      setProjError(null);
    } catch (e) {
      if (!mounted.current || req !== projReq.current) return;
      setProjError(errText(e)); // giữ danh sách cũ, không làm trắng trang
    } finally {
      if (mounted.current && req === projReq.current) setProjLoading(false);
    }
  }, []);

  // Tải danh sách dự án đúng một lần khi mở; lọc chữ không đụng tới đây.
  useEffect(() => {
    mounted.current = true;
    void loadProjects(false);
    return () => { mounted.current = false; };
  }, [loadProjects]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [tasks, providers] = await Promise.all([api.tasks(), api.providers()]);
      // Thẻ cần số lần bàn giao, nên tải lịch sử từng task (lỗi lẻ không làm hỏng cả lần tải).
      const details = await Promise.all(tasks.map((t) => api.task(t.id).catch(() => null)));
      const events = new Map<string, VEvent[]>();
      details.forEach((d, i) => {
        const t = tasks[i];
        if (d && t) events.set(t.id, d.events);
      });
      dispatch({ t: 'load', tasks, providers, events });
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  const refreshProviders = useCallback((): void => {
    api.providers().then((providers) => dispatch({ t: 'providers', providers }), () => undefined);
  }, []);

  // Tải dữ liệu đầu tiên ngay, không phụ thuộc WebSocket (WS lỗi thì bảng vẫn có dữ liệu hoặc báo lỗi).
  useEffect(() => {
    void reload();
  }, [reload]);

  // WebSocket cùng nguồn: trình duyệt tự gửi cookie khóa, URL không mang khóa.
  // Trình duyệt không cho thấy mã 401 của WebSocket, nên sau vài lần thất bại ta dò bằng một GET có xác thực.
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (ev: ConnectionEvent): ConnectionState => {
      const next = nextConnectionState(connRef.current, ev);
      connRef.current = next;
      setConn(next);
      return next;
    };
    const probe = (): Promise<void> =>
      api.providers().then(
        () => { apply('probe-ok'); },
        (e: unknown) => { apply(e instanceof ApiError && e.status === 401 ? 'probe-401' : 'probe-error'); },
      );
    const schedule = (): void => {
      if (!disposed) timer = setTimeout(connect, connRef.current.retryMs);
    };

    const connect = (): void => {
      if (disposed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${scheme}://${window.location.host}/api/events`);
      sockRef.current = sock;
      sock.onopen = () => {
        if (sockRef.current !== sock) return;
        apply('open');
        void reload(); // mỗi lần kết nối lại: tải lại GET /api/tasks
      };
      sock.onmessage = (m: MessageEvent<string>) => {
        if (sockRef.current !== sock) return;
        let msg: { type?: string };
        try {
          msg = JSON.parse(m.data) as { type?: string };
        } catch {
          return;
        }
        if (msg.type === undefined || msg.type === 'HELLO') return;
        const e = msg as VEvent;
        if (e.type === 'TASK_CREATED') void reload();
        else dispatch({ t: 'event', e });
        if (REFRESH_PROVIDER_EVENTS.has(e.type)) refreshProviders();
      };
      sock.onclose = () => {
        if (sockRef.current !== sock) return; // socket đã bị thay thế (kể cả StrictMode chạy effect hai lần)
        sockRef.current = null;
        const next = apply('closed');
        if (next.probe) void probe().finally(schedule);
        else schedule();
      };
      sock.onerror = () => sock.close();
    };
    connect();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      const s = sockRef.current;
      sockRef.current = null;
      s?.close();
    };
  }, [reload, refreshProviders]);

  // Cập nhật đồng hồ để ô "tạm nghỉ" tự chuyển màu khi hết hạn.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const onHistory = useCallback((taskId: string, events: VEvent[]): void => {
    dispatch({ t: 'history', taskId, events });
  }, []);

  const tasks = [...state.tasks.values()];
  const providers = [...state.providers.values()];
  const taskId = taskIdOf(hash);
  const open = taskId !== null ? state.tasks.get(taskId) : undefined;
  const isListHash = hash === '' || hash === '#/board' || projectPathOf(hash) !== null;
  useEffect(() => {
    if (isListHash) setListHash(hash);
  }, [hash, isListHash]);
  const listView = isListHash ? hash : listHash;
  const viewedPath = projectPathOf(listView);
  const viewedProject = viewedPath === null ? undefined
    : projects?.find((p) => projectKeyOf(p.path) === projectKeyOf(viewedPath));
  const viewedName = viewedProject?.name ?? (viewedPath === null ? '' : baseName(viewedPath));
  const boardTasks = viewedPath === null ? tasks : tasksOfProject(tasks, { path: viewedPath });
  // Dự án đã chọn không còn trong danh sách (đã tải thành công): về danh sách kèm thông báo.
  const loadState = projError !== null ? 'failed' : projects === null ? 'loading' : 'loaded';
  const route = resolveProjectRoute(hash, projects, loadState);
  const staleNotice = route.view === 'list' ? route.notice : undefined;
  useEffect(() => {
    if (staleNotice !== undefined) {
      setNotice(staleNotice);
      go('');
    }
  }, [staleNotice]);
  const activeTab = listView === '#/board' ? 'board' : 'projects';

  return (
    <div className="app">
      <header>
        <h1>voragent</h1>
        {conn.status !== 'connected' && <span className="offline">mất kết nối</span>}
        <button onClick={() => nav('#/new')}>+ Task mới</button>
      </header>
      <nav className="tabs">
        <button type="button" className={activeTab === 'projects' ? 'active' : ''} onClick={() => nav('')}>Dự án</button>
        <button type="button" className={activeTab === 'board' ? 'active' : ''} onClick={() => nav('#/board')}>Bảng task</button>
      </nav>
      {conn.status === 'auth-failed' && (
        <div className="error banner" role="alert">
          Khóa truy cập đã đổi (có thể voragent đã khởi động lại). Hãy mở lại URL do voragent in ra.
        </div>
      )}
      <QuotaBar providers={providers} now={now} />
      {error !== null && <div className="error" role="alert">{error}</div>}
      {notice !== null && <div className="notice" role="status">{notice}</div>}
      {viewedPath !== null && hash !== '#/new' && open === undefined && (
        <div className="crumb"><a href="#" onClick={(e) => { e.preventDefault(); nav(''); }}>Dự án</a> › {viewedName}</div>
      )}
      {hash === '#/new' ? (
        <NewTaskForm
          providers={providers}
          projects={projects ?? []}
          initialPath={viewedPath}
          onCreated={(id) => { void reload(); nav(`#/task/${encodeURIComponent(id)}`); }}
          onCancel={() => nav(listView)}
        />
      ) : open ? (
        <TaskView task={open} events={state.events.get(open.id) ?? []} onLoaded={onHistory} onBack={() => nav(listView)} />
      ) : activeTab === 'projects' && viewedPath === null ? (
        <ProjectList
          projects={projects}
          loading={projLoading}
          error={projError}
          taskCount={(p) => tasksOfProject(tasks, p).length}
          onOpen={(p) => nav(PROJECT_PREFIX + encodeURIComponent(p.path))}
          onRefresh={() => { void loadProjects(true); }}
        />
      ) : (
        <Board tasks={boardTasks} events={state.events} onOpen={(id) => nav(`#/task/${encodeURIComponent(id)}`)} />
      )}
    </div>
  );
}
