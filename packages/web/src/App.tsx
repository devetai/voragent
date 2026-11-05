import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ProviderState, Task, VEvent } from '@voragent/shared';
import { ApiError, api, errText } from './api';
import { Board } from './Board';
import { INITIAL_CONNECTION, nextConnectionState } from './connection';
import type { ConnectionEvent, ConnectionState } from './connection';
import { NewTaskForm } from './NewTaskForm';
import { QuotaBar } from './QuotaBar';
import { TaskView } from './TaskView';
import { applyEvent, mergeEvents } from './state';
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

export function App() {
  const [state, dispatch] = useReducer(reduce, initial);
  const [conn, setConn] = useState<ConnectionState>(INITIAL_CONNECTION);
  const connRef = useRef<ConnectionState>(INITIAL_CONNECTION);
  const sockRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hash, go] = useHash();

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
  const taskId = hash.startsWith('#/task/') ? decodeURIComponent(hash.slice(7)) : null;
  const open = taskId !== null ? state.tasks.get(taskId) : undefined;

  return (
    <div className="app">
      <header>
        <h1>voragent</h1>
        {conn.status !== 'connected' && <span className="offline">mất kết nối</span>}
        <button onClick={() => go('#/new')}>+ Task mới</button>
      </header>
      {conn.status === 'auth-failed' && (
        <div className="error banner" role="alert">
          Khóa truy cập đã đổi (có thể voragent đã khởi động lại). Hãy mở lại URL do voragent in ra.
        </div>
      )}
      <QuotaBar providers={providers} now={now} />
      {error !== null && <div className="error" role="alert">{error}</div>}
      {hash === '#/new' ? (
        <NewTaskForm
          providers={providers}
          onCreated={(id) => { void reload(); go(`#/task/${encodeURIComponent(id)}`); }}
          onCancel={() => go('')}
        />
      ) : open ? (
        <TaskView task={open} events={state.events.get(open.id) ?? []} onLoaded={onHistory} onBack={() => go('')} />
      ) : (
        <Board tasks={tasks} events={state.events} onOpen={(id) => go(`#/task/${encodeURIComponent(id)}`)} />
      )}
    </div>
  );
}
