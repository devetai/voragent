import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Bell,
  Brain,
  Building2,
  ChevronRight,
  Crown,
  Folder,
  FolderGit2,
  KanbanSquare,
  Network,
  Plus,
  Settings,
} from 'lucide-react';
import type { ManagerPlan, MemoryItem, Project, ProviderState, Task, VEvent } from '@voragent/shared';
import { ApiError, api, errText } from './api';
import { Board } from './Board';
import { CustomSelect, type SelectOption } from './components/CustomSelect';
import { Logo } from './components/Logo';
import { GlobalTooltipLayer } from './components/Tooltip';
import { ConnectionOverlay } from './components/ConnectionOverlay';
import { INITIAL_CONNECTION, nextConnectionState } from './connection';
import type { ConnectionEvent, ConnectionState } from './connection';
import { GraphCanvas } from './graph/GraphCanvas';
import { ManagerPanel } from './ManagerPanel';
import { NewTaskForm } from './NewTaskForm';
import { OfficeCanvas } from './office/OfficeCanvas';
import { ProjectList } from './ProjectList';
import { QuotaBar } from './QuotaBar';
import { SharedMemoryPanel } from './SharedMemoryPanel';
import { SettingsView } from './SettingsView';
import { TaskView } from './TaskView';
import { applyEvent, mergeEvents, projectKeyOf, resolveProjectRoute, tasksOfProject } from './state';
import type { UiState } from './state';
import { buildUrl, useAppRoute } from './route';
import type { AppView } from './route';

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

const baseName = (p: string): string => p.replace(/[\/\\]+$/, '').split(/[\/\\]/).pop() ?? p;

type OverlayKind =
  | { kind: 'task'; taskId: string }
  | { kind: 'manager' }
  | { kind: 'memory'; defaultAuthor?: string }
  | null;

export function App() {
  const [state, dispatch] = useReducer(reduce, initial);
  const [conn, setConn] = useState<ConnectionState>(INITIAL_CONNECTION);
  const connRef = useRef<ConnectionState>(INITIAL_CONNECTION);
  const sockRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);

  const [route, navTo] = useAppRoute();
  const nav = useCallback((target: string | { view: AppView; taskId?: string | null; projectPath?: string | null }): void => {
    setNotice(null);
    navTo(target);
  }, [navTo]);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projLoading, setProjLoading] = useState(true);
  const [projError, setProjError] = useState<string | null>(null);
  // Cửa sổ nổi (Modal Overlay) cho Trưởng phòng / Shared Memory / Chi tiết Task nhanh
  const [overlay, setOverlay] = useState<OverlayKind>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [plans, setPlans] = useState<ManagerPlan[]>([]);
  const [listUrl, setListUrl] = useState('/');
  const [notice, setNotice] = useState<string | null>(null);
  const projReq = useRef(0);
  const mounted = useRef(true);

  const isListView = route.view === 'projects' || route.view === 'board' || route.view === 'office';
  useEffect(() => {
    if (isListView) {
      setListUrl(route.pathname + (route.search ? route.search : ''));
    }
  }, [route.view, route.pathname, route.search, isListView]);

  const listView = isListView ? (route.pathname + (route.search ? route.search : '')) : (listUrl || '/');

  const tasks = [...state.tasks.values()];
  const providers = [...state.providers.values()];
  const taskId = route.taskId;
  const open = taskId !== null ? state.tasks.get(taskId) : undefined;

  // Khi đang mở task, dự án ngữ cảnh ưu tiên theo URL hoặc repoPath của task
  const effectiveProjectPath = route.projectPath ?? open?.repoPath ?? null;
  const viewedPath = effectiveProjectPath;
  const viewedProject = viewedPath === null ? undefined
    : projects?.find((p) => projectKeyOf(p.path) === projectKeyOf(viewedPath));
  const viewedName = viewedProject?.name ?? (viewedPath === null ? '' : baseName(viewedPath));

  // Tự động bảo toàn tham số project trong URL query khi đang xem task
  useEffect(() => {
    if (route.view === 'task' && open?.repoPath && !route.projectPath) {
      const canonical = buildUrl({
        view: 'task',
        taskId: open.id,
        projectPath: open.repoPath,
      }, window.location.search);
      window.history.replaceState(null, '', canonical);
    }
  }, [route.view, route.projectPath, open?.id, open?.repoPath]);

  const officeTasks = viewedPath === null ? tasks : tasksOfProject(tasks, { path: viewedPath });
  const officeMemories = viewedPath === null
    ? memories
    : memories.filter((m) => projectKeyOf(m.repoPath) === projectKeyOf(viewedPath));
  const officePlans = viewedPath === null
    ? plans
    : plans.filter((p) => projectKeyOf(p.repoPath) === projectKeyOf(viewedPath));

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
      setProjError(errText(e));
    } finally {
      if (mounted.current && req === projReq.current) setProjLoading(false);
    }
  }, []);

  const loadOfficeMeta = useCallback(async (): Promise<void> => {
    try {
      const [mems, mgrPlans] = await Promise.all([
        api.memories().catch(() => [] as MemoryItem[]),
        api.managerPlans().catch(() => [] as ManagerPlan[]),
      ]);
      if (!mounted.current) return;
      setMemories(mems);
      setPlans(mgrPlans);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadProjects(false);
    void loadOfficeMeta();
    return () => { mounted.current = false; };
  }, [loadProjects, loadOfficeMeta]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [tasks, providers] = await Promise.all([api.tasks(), api.providers()]);
      const details = await Promise.all(tasks.map((t) => api.task(t.id).catch(() => null)));
      const events = new Map<string, VEvent[]>();
      details.forEach((d, i) => {
        const t = tasks[i];
        if (d && t) events.set(t.id, d.events);
      });
      dispatch({ t: 'load', tasks, providers, events });
      void loadOfficeMeta();
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [loadOfficeMeta]);

  const handleRetryConnection = useCallback(() => {
    void api.providers().then(
      () => {
        setConn({ status: 'connected', failures: 0, retryMs: 2000, probe: false });
        void reload();
      },
      (e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          setConn((prev) => ({ ...prev, status: 'auth-failed' }));
        } else {
          setConn((prev) => ({ ...prev, status: 'daemon-down' }));
        }
      }
    );
  }, [reload]);
  const refreshProviders = useCallback((): void => {
    api.providers().then((providers) => dispatch({ t: 'providers', providers }), () => undefined);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      if ((e.key === 'n' || e.key === 'N') && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOverlay(null);
        nav(viewedPath !== null ? `/new?project=${encodeURIComponent(viewedPath)}` : '/new');
      } else if (e.key === 'Escape') {
        if (overlay !== null) {
          e.preventDefault();
          setOverlay(null);
        } else if (route.view === 'task' || route.view === 'new') {
          e.preventDefault();
          nav(listView);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nav, listView, route.view, viewedPath, overlay]);

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
        void reload();
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
        else if (e.type === 'MEMORY_UPDATED' || e.type === 'MANAGER_PLAN_UPDATED') void loadOfficeMeta();
        else dispatch({ t: 'event', e });
        if (REFRESH_PROVIDER_EVENTS.has(e.type)) refreshProviders();
      };
      sock.onclose = () => {
        if (sockRef.current !== sock) return;
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
  }, [reload, refreshProviders, loadOfficeMeta]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const onHistory = useCallback((taskId: string, events: VEvent[]): void => {
    dispatch({ t: 'history', taskId, events });
  }, []);

  const loadState = projError !== null ? 'failed' : projects === null ? 'loading' : 'loaded';
  const resolved = resolveProjectRoute(route.pathname + route.search, projects, loadState);
  const staleNotice = resolved.view === 'list' && viewedPath !== null ? resolved.notice : undefined;
  useEffect(() => {
    if (staleNotice !== undefined) {
      setNotice(staleNotice);
      nav('/');
    }
  }, [staleNotice, nav]);

  const activeTab = route.activeTab;
  const overlayTask = overlay?.kind === 'task' ? state.tasks.get(overlay.taskId) : undefined;

  const managerInboxCount =
    officePlans.filter((p) => p.status === 'draft').length +
    officeTasks.filter((t) => t.status === 'awaiting_user' || t.status === 'failed').length;

  const officeOptions: SelectOption[] = [
    {
      value: '',
      label: `Tất cả dự án (${projects?.length ?? 0})`,
      icon: <FolderGit2 size={14} color="var(--text-secondary)" />,
    },
    ...(projects ?? []).map((p) => ({
      value: p.path,
      label: p.name,
      sublabel: p.path,
      badge: `${tasksOfProject(tasks, p).length} task`,
      icon: <Building2 size={14} color="var(--primary)" />,
    })),
  ];

  const handleSelectOffice = (nextPath: string) => {
    const targetView: AppView =
      activeTab === 'projects' && nextPath !== ''
        ? 'office'
        : activeTab === 'office' && nextPath === ''
        ? 'board'
        : route.view === 'task' || route.view === 'new'
        ? 'board'
        : route.view;
    nav({
      view: targetView,
      projectPath: nextPath === '' ? null : nextPath,
    });
  };

  return (
    <div className={`app ${activeTab === 'office' ? 'is-office-view' : activeTab === 'graph' ? 'is-graph-view' : ''}`}>

      {/* Single-Row Sticky Command Bar — Gọn đúng 1 hàng ngang duy nhất */}
      <div className="sticky-top-header">
        <header className="header-bar">
          <div className="header-left">
            <div
              className="logo-badge"
              onClick={() => { setOverlay(null); nav('/'); }}
            >
              <Logo size={22} />
              <span className="brand-title">voragent</span>
            </div>
            {conn.status !== 'connected' && (
              <span
                className="status-dot-pulse-offline"
                data-tooltip="Mất kết nối tới Daemon cục bộ — Đang tự động thử kết nối lại"
                aria-label="Mất kết nối tới Daemon"
              />
            )}

            <div className="header-divider" />

            {/* Chỉ giữ 4 Tab cốt lõi trên Header để không bao giờ bị rớt dòng */}
            <nav className="view-tabs" aria-label="Chế độ xem">
              <button
                type="button"
                className={`view-tab ${activeTab === 'projects' ? 'active' : ''}`}
                onClick={() => { setOverlay(null); nav('/'); }}
              >
                <FolderGit2 size={15} /> <span className="tab-label">Dự án</span>
              </button>
              <button
                type="button"
                className={`view-tab ${activeTab === 'office' ? 'active' : ''}`}
                onClick={() => {
                  if (viewedPath === null && projects && projects.length > 0) {
                    nav({ view: 'office', projectPath: projects[0]?.path });
                  } else {
                    nav({ view: 'office', projectPath: viewedPath });
                  }
                }}
              >
                <Building2 size={15} /> <span className="tab-label">Văn phòng 3D</span>
              </button>
              <button
                type="button"
                className={`view-tab ${activeTab === 'board' ? 'active' : ''}`}
                onClick={() => nav({ view: 'board', projectPath: viewedPath })}
              >
                <KanbanSquare size={15} /> <span className="tab-label">Bảng Kanban</span>
                {officeTasks.length > 0 && (
                  <span className="tab-count-badge tabular">{officeTasks.length}</span>
                )}
              </button>
              <button
                type="button"
                className={`view-tab ${activeTab === 'graph' ? 'active' : ''}`}
                onClick={() => nav({ view: 'graph', projectPath: viewedPath })}
              >
                <Network size={15} /> <span className="tab-label">Đồ thị</span>
              </button>
            </nav>
          </div>

          <div className="header-right">
            {/* Bộ chọn nhanh Văn phòng Dự án */}
            <div className="header-project-select">
              <CustomSelect
                options={officeOptions}
                value={viewedPath ?? ''}
                onChange={handleSelectOffice}
                placeholder="Chọn dự án..."
                searchPlaceholder="Tìm dự án..."
              />
            </div>

            {/* Nút Popover Quota gọn gàng (chỉ mở chi tiết khi bấm) */}
            <QuotaBar
              providers={providers}
              now={now}
              onProvidersUpdated={(next) => dispatch({ t: 'providers', providers: next })}
            />

            {/* Nút mở Modal Shared Memory — gọn gàng với Icon + số đếm + Tooltip */}
            <button
              type="button"
              className="header-memory-btn"
              onClick={() => setOverlay(overlay?.kind === 'memory' ? null : { kind: 'memory' })}
              data-tooltip="Mở Bộ nhớ chung của Văn phòng (Shared Memory)"
              aria-label="Bộ nhớ chung Văn phòng"
              style={{ padding: '0 8px', gap: '5px' }}
            >
              <Brain size={15} />
              <span className="tabular" style={{ fontSize: '12px', fontWeight: 600 }}>{officeMemories.length}</span>
            </button>

            {/* Nút mở Modal Bàn Trưởng Phòng & Báo cáo tập trung */}
            <button
              type="button"
              className="header-manager-btn"
              onClick={() => setOverlay(overlay?.kind === 'manager' ? null : { kind: 'manager' })}
              data-tooltip="Mở Bàn Trưởng phòng — Duyệt câu hỏi, nghiệm thu & giao mục tiêu"
              style={{
                background: managerInboxCount > 0 ? '#FEF3C7' : 'var(--bg-surface)',
                color: managerInboxCount > 0 ? '#92400E' : 'var(--text-primary)',
                borderColor: managerInboxCount > 0 ? '#F59E0B' : 'var(--border-subtle)',
                fontWeight: 600,
              }}
            >
              {managerInboxCount > 0 ? <Bell size={14} /> : <Crown size={14} />}
              <span className="header-btn-text">Trưởng phòng</span>
              {managerInboxCount > 0 && (
                <span className="tab-count-badge tabular" style={{ background: '#F59E0B', color: '#FFF' }}>
                  {managerInboxCount}
                </span>
              )}
            </button>

            {/* Nút Cài đặt hệ thống & Quản lý lưu trữ */}
            <button
              type="button"
              className={`icon-btn ${route.view === 'settings' ? 'active' : ''}`}
              onClick={() => nav('/settings')}
              data-tooltip="Cài đặt hệ thống, vị trí lưu trữ & dọn dẹp rác"
              aria-label="Cài đặt hệ thống"
              style={{
                width: '32px',
                height: '32px',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: route.view === 'settings' ? 'var(--amber-bg)' : undefined,
                color: route.view === 'settings' ? 'var(--amber-text)' : undefined,
                borderColor: route.view === 'settings' ? 'var(--amber-border)' : undefined,
              }}
            >
              <Settings size={16} />
            </button>

            <button
              className="primary header-new-task-btn"
              onClick={() => nav(viewedPath !== null ? `/new?project=${encodeURIComponent(viewedPath)}` : '/new')}
            >
              <Plus size={15} /> <span className="new-task-text">Task mới</span> <kbd className="header-kbd">N</kbd>
            </button>
          </div>
        </header>

        {/* Lớp phủ toàn màn hình khi mất kết nối / đổi khóa kèm hoạt họa chú rắn dễ thương */}
        <ConnectionOverlay conn={conn} onRetry={handleRetryConnection} />
      </div>

      {error !== null && <div className="error" role="alert">{error}</div>}
      {notice !== null && <div className="notice" role="status">{notice}</div>}

      {/* Breadcrumb mỏng khi đang lọc theo 1 dự án cụ thể ở màn Kanban */}
      {viewedPath !== null && route.view === 'board' && open === undefined && (
        <div className="crumb">
          <Folder size={14} />
          <a href="/" onClick={(e) => { e.preventDefault(); nav('/'); }}>Dự án</a>
          <ChevronRight size={14} />
          <strong>{viewedName}</strong>
          <span className="muted" style={{ fontSize: '12px' }}>({viewedPath})</span>
        </div>
      )}

      {/* Main Content Router */}
      {route.view === 'settings' ? (
        <SettingsView />
      ) : route.view === 'new' ? (
        <NewTaskForm
          providers={providers}
          projects={projects ?? []}
          initialPath={viewedPath}
          onCreated={(id) => { void reload(); nav(`/task/${encodeURIComponent(id)}`); }}
          onCancel={() => nav(listView)}
          onRefreshProjects={() => { void loadProjects(true); }}
        />
      ) : route.view === 'task' || open ? (
        open ? (
          <TaskView
            task={open}
            events={state.events.get(open.id) ?? []}
            providers={providers}
            projectName={viewedName}
            onLoaded={onHistory}
            onBack={() => nav(listView)}
            onDeleted={() => { void reload(); nav(listView); }}
            onSelectProject={(projectPath) => nav({ view: 'board', projectPath })}
          />
        ) : (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', marginTop: '1rem' }}>
            <p style={{ color: 'var(--text-secondary)' }}>
              {loading ? 'Đang tải thông tin task...' : 'Không tìm thấy task yêu cầu (có thể task đã bị xóa hoặc URL không đúng).'}
            </p>
            <button style={{ marginTop: '1rem' }} onClick={() => nav(listView)}>
              Quay lại danh sách
            </button>
          </div>
        )
      ) : activeTab === 'office' ? (
        <OfficeCanvas
          repoPath={viewedPath ?? projects?.[0]?.path ?? null}
          projectName={viewedName || projects?.[0]?.name || ''}
          tasks={officeTasks}
          providers={providers}
          memories={officeMemories}
          plans={officePlans}
          onSelectTask={(id) => setOverlay({ kind: 'task', taskId: id })}
          onOpenManager={() => setOverlay({ kind: 'manager' })}
          onOpenMemory={(author) => setOverlay({ kind: 'memory', ...(author ? { defaultAuthor: author } : {}) })}
          onReload={() => { void reload(); }}
        />
      ) : activeTab === 'manager' ? (
        <ManagerPanel
          repoPath={viewedPath ?? projects?.[0]?.path ?? null}
          projectName={viewedName || projects?.[0]?.name || ''}
          plans={officePlans}
          tasks={officeTasks}
          eventsByTask={state.events}
          providers={providers}
          onChanged={() => { void reload(); }}
          onSelectTask={(id) => setOverlay({ kind: 'task', taskId: id })}
        />
      ) : activeTab === 'memory' ? (
        <SharedMemoryPanel
          repoPath={viewedPath ?? projects?.[0]?.path ?? null}
          projectName={viewedName || projects?.[0]?.name || ''}
          memories={officeMemories}
          providers={providers}
          onChanged={() => { void loadOfficeMeta(); }}
        />
      ) : activeTab === 'graph' ? (
        <GraphCanvas
          tasks={officeTasks}
          providers={providers}
          events={state.events}
          onSelectTask={(id) => setOverlay({ kind: 'task', taskId: id })}
        />
      ) : activeTab === 'projects' && viewedPath === null ? (
        <ProjectList
          projects={projects}
          tasks={tasks}
          providers={providers}
          memories={memories}
          plans={plans}
          loading={projLoading}
          error={projError}
          taskCount={(p) => tasksOfProject(tasks, p).length}
          onOpen={(p) => nav({ view: 'board', projectPath: p.path })}
          onOpenOffice3D={(p) => nav({ view: 'office', projectPath: p.path })}
          onOpenManager={(p) => {
            nav({ view: 'office', projectPath: p.path });
            setOverlay({ kind: 'manager' });
          }}
          onRefresh={() => { void loadProjects(true); }}
        />
      ) : (
        <Board
          tasks={officeTasks}
          events={state.events}
          loading={loading}
          onOpen={(id) => {
            const t = state.tasks.get(id);
            nav({ view: 'task', taskId: id, projectPath: t?.repoPath ?? viewedPath });
          }}
          onCreateNew={() => nav(viewedPath !== null ? `/new?project=${encodeURIComponent(viewedPath)}` : '/new')}
        />
      )}

      {/* MODAL / SLIDE-OVER OVERLAY CHO TRƯỞNG PHÒNG, SHARED MEMORY HOẶC XEM NHANH TASK
          (Không đẩy lệch bố cục trang bên dưới, bấm ra ngoài hoặc nhấn Esc để đóng) */}
      {overlay !== null && (
        <div
          className="office-modal-backdrop"
          onClick={() => setOverlay(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={`office-modal-dialog ${overlay.kind === 'task' ? 'is-task-modal' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {overlay.kind === 'task' && overlayTask ? (
              <TaskView
                task={overlayTask}
                events={state.events.get(overlayTask.id) ?? []}
                providers={providers}
                projectName={projects?.find((p) => projectKeyOf(p.path) === projectKeyOf(overlayTask.repoPath))?.name ?? baseName(overlayTask.repoPath)}
                onLoaded={onHistory}
                onBack={() => setOverlay(null)}
                onDeleted={() => { setOverlay(null); void reload(); }}
                onSelectProject={(projectPath) => {
                  setOverlay(null);
                  nav({ view: 'board', projectPath });
                }}
                inModal={true}
                onMaximize={() => {
                  const id = overlayTask.id;
                  setOverlay(null);
                  nav({ view: 'task', taskId: id, projectPath: overlayTask.repoPath ?? viewedPath });
                }}
              />
            ) : overlay.kind === 'manager' ? (
              <ManagerPanel
                repoPath={viewedPath ?? projects?.[0]?.path ?? null}
                projectName={viewedName || projects?.[0]?.name || ''}
                plans={officePlans}
                tasks={officeTasks}
                eventsByTask={state.events}
                providers={providers}
                onChanged={() => { void reload(); }}
                onSelectTask={(id) => setOverlay({ kind: 'task', taskId: id })}
                onClose={() => setOverlay(null)}
              />
            ) : overlay.kind === 'memory' ? (
              <SharedMemoryPanel
                repoPath={viewedPath ?? projects?.[0]?.path ?? null}
                projectName={viewedName || projects?.[0]?.name || ''}
                memories={officeMemories}
                providers={providers}
                defaultAuthor={overlay.defaultAuthor ?? 'user'}
                onChanged={() => { void loadOfficeMeta(); }}
                onClose={() => setOverlay(null)}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Global Custom UI Tooltip Layer (thay thế hoàn toàn native browser title) */}
      <GlobalTooltipLayer />
    </div>
  );
}
