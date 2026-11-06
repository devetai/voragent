import { useState } from 'react';
import {
  Brain,
  Building2,
  Code2,
  Crown,
  FileEdit,
  FolderGit2,
  GitBranch,
  KanbanSquare,
  LayoutGrid,
  RefreshCw,
  Search,
  Table2,
  X,
} from 'lucide-react';
import type { ManagerPlan, MemoryItem, Project, ProviderState, Task } from '@voragent/shared';
import { api, errText } from './api';
import { ProviderIcon } from './components/ProviderIcon';
import { describeProjectSources, filterProjects, projectKeyOf, sortProjects, tasksOfProject } from './state';
import { TimeBadge } from './components/TimeBadge';

export type ProjectViewMode = 'grid' | 'table';

const VIEW_MODE_STORAGE_KEY = 'voragent_projects_view_mode';

function readInitialViewMode(): ProjectViewMode {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (raw === 'table' || raw === 'grid') return raw;
  } catch {
    // ignore storage errors
  }
  return 'grid';
}

/**
 * Tầng 1: Đại sảnh các Văn phòng Dự án (Overview -> Detail).
 * Hỗ trợ chuyển đổi linh hoạt giữa 2 chế độ:
 * - Lưới thẻ (Grid View): Trực quan, dễ quét nhanh.
 * - Bảng dữ liệu (Table View): Mật độ cao, so sánh nhanh đường dẫn, nhánh Git, trạng thái task và hoạt động gần nhất.
 * Tuân thủ nghiêm ngặt quy tắc Zero Redundant Noise, Zero Double Scrollbars & Custom UI Tooltip.
 */
export function ProjectList({
  projects,
  tasks = [],
  memories = [],
  plans = [],
  loading,
  error,
  taskCount,
  onOpen,
  onOpenOffice3D,
  onOpenManager,
  onOpenIde,
  onRefresh,
}: {
  projects: Project[] | null;
  tasks?: Task[];
  providers?: ProviderState[];
  memories?: MemoryItem[];
  plans?: ManagerPlan[];
  loading: boolean;
  error: string | null;
  taskCount: (p: Project) => number;
  onOpen: (p: Project) => void;
  onOpenOffice3D?: (p: Project) => void;
  onOpenManager?: (p: Project) => void;
  onOpenIde?: (p: Project) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [viewMode, setViewMode] = useState<ProjectViewMode>(readInitialViewMode);
  const [initGitBusyPath, setInitGitBusyPath] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState<string | null>(null);

  const changeViewMode = (mode: ProjectViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  };

  const handleInitGit = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    setInitGitBusyPath(p.path);
    setGitNotice(null);
    try {
      const res = await api.initGit(p.path);
      setGitNotice(`Đã khởi tạo Git (nhánh ${res.branch}) cho dự án "${p.name}".`);
      onRefresh();
    } catch (err) {
      setGitNotice(errText(err));
    } finally {
      setInitGitBusyPath(null);
    }
  };

  const sorted = projects === null ? [] : filterProjects(sortProjects(projects), filter);
  const shown = onlyActive
    ? sorted.filter((p) => {
        const pKey = projectKeyOf(p.path);
        return (
          taskCount(p) > 0 ||
          plans.some((pl) => projectKeyOf(pl.repoPath) === pKey) ||
          memories.some((m) => projectKeyOf(m.repoPath) === pKey)
        );
      })
    : sorted;

  const totalProjects = projects?.length ?? 0;
  const runningTasks = tasks.filter((t) => t.status === 'running').length;
  const waitingUserTasks = tasks.filter((t) => t.status === 'awaiting_user' || t.status === 'failed').length;
  const draftPlansCount = plans.filter((p) => p.status === 'draft').length;
  const inboxTotal = waitingUserTasks + draftPlansCount;

  return (
    <div className="panel projects">
      {/* Thanh công cụ tìm kiếm, lọc, chuyển chế độ xem (Grid / Table) & chỉ số tóm tắt gọn trên 1 hàng duy nhất */}
      <div className="projects-toolbar">
        <div className="projects-search-wrap">
          <Search size={15} className="projects-search-icon" />
          <input
            className="filter"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Tìm trong ${totalProjects} dự án theo tên hoặc đường dẫn…`}
            aria-label="Lọc dự án"
          />
          {filter && (
            <button
              type="button"
              className="projects-search-clear"
              onClick={() => setFilter('')}
              aria-label="Xóa từ khóa tìm kiếm"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {runningTasks > 0 && (
            <span className="badge info">
              ⚡ {runningTasks} đang làm
            </span>
          )}
          {inboxTotal > 0 && (
            <span className="badge warn">
              🔔 {inboxTotal} chờ bạn duyệt
            </span>
          )}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              userSelect: 'none',
              padding: '0 6px',
            }}
          >
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            <span>Chỉ dự án đang hoạt động</span>
          </label>

          {/* Bộ chuyển đổi Chế độ xem: Lưới thẻ (Grid) | Bảng dữ liệu (Table) */}
          <div className="projects-view-switcher" role="group" aria-label="Chế độ hiển thị danh sách dự án">
            <button
              type="button"
              className={`projects-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => changeViewMode('grid')}
              data-tooltip="Xem dạng Lưới thẻ (Grid)"
              aria-label="Xem dạng Lưới thẻ"
              aria-pressed={viewMode === 'grid'}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              className={`projects-view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => changeViewMode('table')}
              data-tooltip="Xem dạng Bảng dữ liệu (Table)"
              aria-label="Xem dạng Bảng dữ liệu"
              aria-pressed={viewMode === 'table'}
            >
              <Table2 size={14} />
            </button>
          </div>

          <button
            type="button"
            className="icon-btn"
            onClick={onRefresh}
            disabled={loading}
            data-tooltip="Làm mới danh sách dự án"
            aria-label="Làm mới danh sách dự án"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error !== null && <div className="error" role="alert">{error}</div>}
      {gitNotice !== null && (
        <div className="notice" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{gitNotice}</span>
          <button type="button" className="icon-btn-sm" onClick={() => setGitNotice(null)} aria-label="Đóng thông báo">
            ✕
          </button>
        </div>
      )}

      <div className="projects-list-scroll">
        {loading && (
          <div>
            <div className="skeleton-card">
              <div className="skeleton-line short skeleton-shimmer" />
              <div className="skeleton-line full skeleton-shimmer" />
              <div className="skeleton-line medium skeleton-shimmer" />
            </div>
            <div className="skeleton-card">
              <div className="skeleton-line short skeleton-shimmer" />
              <div className="skeleton-line full skeleton-shimmer" />
            </div>
          </div>
        )}

        {!loading && projects !== null && projects.length === 0 && error === null && (
          <div className="board-empty" style={{ margin: '1rem 0' }}>
            <div className="board-empty-icon" style={{ display: 'flex', justifyContent: 'center' }}>
              <FolderGit2 size={44} strokeWidth={1.5} color="var(--text-muted)" />
            </div>
            <h3>Chưa có dự án nào</h3>
            <p>
              Chưa tìm thấy dự án Git nào. Bạn có thể chọn “Thư mục khác…” khi tạo task mới, hoặc chạy lệnh <code>voragent add &lt;thư-mục&gt;</code> qua CLI.
            </p>
          </div>
        )}

        {!loading && projects !== null && projects.length > 0 && shown.length === 0 && (
          <div className="muted" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
            Không có dự án nào khớp với bộ lọc hiện tại.
          </div>
        )}

        {/* CHẾ ĐỘ 1: LƯỚI THẺ (GRID VIEW) */}
        {!loading && shown.length > 0 && viewMode === 'grid' && (
          <div className="office-grid">
            {shown.map((p) => {
              const sources = describeProjectSources(p);
              const pTasks = tasksOfProject(tasks, p);
              const count = taskCount(p);
              const pRunning = pTasks.filter((t) => t.status === 'running').length;
              const pWaiting = pTasks.filter((t) => t.status === 'awaiting_user' || t.status === 'failed').length;
              const pKey = projectKeyOf(p.path);
              const pMemories = memories.filter((m) => projectKeyOf(m.repoPath) === pKey);
              const pPlans = plans.filter((pl) => projectKeyOf(pl.repoPath) === pKey);
              const pDrafts = pPlans.filter((pl) => pl.status === 'draft').length;
              const pInboxCount = pWaiting + pDrafts;
              const isInitBusy = initGitBusyPath === p.path;

              return (
                <div
                  key={p.id}
                  className={`office-project-card ${pInboxCount > 0 ? 'has-inbox' : ''}`}
                  onClick={() => (onOpenOffice3D ? onOpenOffice3D(p) : onOpen(p))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (onOpenOffice3D) onOpenOffice3D(p);
                      else onOpen(p);
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, flex: 1 }}>
                      <FolderGit2 size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                      <strong
                        style={{
                          fontSize: '0.975rem',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.name}
                      </strong>

                      {!p.isGit && (
                        <button
                          type="button"
                          className="office-mini-btn"
                          disabled={isInitBusy}
                          onClick={(e) => { void handleInitGit(e, p); }}
                          data-tooltip="Thư mục này chưa có Git — Bấm để khởi tạo Git (git init) ngay"
                          style={{
                            background: 'var(--amber-bg)',
                            color: 'var(--amber-text)',
                            borderColor: 'var(--amber-border)',
                            fontWeight: 600,
                            height: '22px',
                            minHeight: '22px',
                            padding: '0 7px',
                            fontSize: '11px',
                            flexShrink: 0,
                          }}
                        >
                          <GitBranch size={11} />
                          <span>{isInitBusy ? 'Đang tạo…' : '+ Khởi tạo Git'}</span>
                        </button>
                      )}
                    </div>

                    {/* Chỉ hiển thị các tín hiệu cần hành động ngay ở hàng đầu để không chèn ép tên */}
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
                      {pRunning > 0 && (
                        <span className="badge info">
                          ⚡ {pRunning}
                        </span>
                      )}
                      {pInboxCount > 0 && (
                        <button
                          type="button"
                          className="badge warn"
                          style={{ cursor: 'pointer', height: '24px', minHeight: '24px', padding: '0 8px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenManager?.(p);
                          }}
                        >
                          🔔 {pInboxCount} cần duyệt
                        </button>
                      )}
                    </div>
                  </div>

                  {/* HÀNG 2: ĐƯỜNG DẪN THƯ MỤC TRẢI DÀI 100% CHIỀU RỘNG (Không bị che khuất) */}
                  <div
                    className="path"
                    style={{
                      width: '100%',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      margin: '2px 0 4px',
                    }}
                    data-tooltip={p.path}
                  >
                    {p.path}
                  </div>

                  {/* Dòng thông tin phụ gọn gàng + Nút Icon-Only thao tác nhanh chỉ hiện khi hover */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                    <div className="project-row-meta" style={{ marginTop: 0 }}>
                      <TimeBadge timestamp={p.lastUsedAt} />
                      {sources.map((s) => (
                        <span key={s} className="badge src" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <ProviderIcon provider={s} size={11} /> {s}
                        </span>
                      ))}
                      {p.branch !== null && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                          <GitBranch size={11} /> {p.branch}
                        </span>
                      )}
                      {p.dirtyCount !== null && p.dirtyCount > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: 'var(--amber-text)' }} data-tooltip={`${p.dirtyCount} tệp có thay đổi chưa commit`}>
                          <FileEdit size={11} /> {p.dirtyCount}
                        </span>
                      )}
                    </div>

                    {/* Icon-only buttons + Custom UI Tooltip khi hover (Rule 12) */}
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center', marginRight: '4px' }}>
                        {count > 0 && (
                          <span className="badge neutral">
                            {count} task
                          </span>
                        )}
                        {pMemories.length > 0 && (
                          <span className="badge neutral" data-tooltip={`${pMemories.length} mục Shared Memory`}>
                            <Brain size={11} /> {pMemories.length}
                          </span>
                        )}
                      </div>
                      <div className="office-card-hover-actions" onClick={(e) => e.stopPropagation()}>
                      {onOpenOffice3D && (
                        <button
                          type="button"
                          className="icon-btn-sm"
                          onClick={() => onOpenOffice3D(p)}
                          data-tooltip="Vào Văn phòng 3D"
                          aria-label="Vào Văn phòng 3D"
                        >
                          <Building2 size={13} />
                        </button>
                      )}
                      {onOpenManager && (
                        <button
                          type="button"
                          className="icon-btn-sm"
                          onClick={() => onOpenManager(p)}
                          data-tooltip="Bàn Trưởng phòng (Giao mục tiêu & Duyệt việc)"
                          aria-label="Bàn Trưởng phòng"
                        >
                          <Crown size={13} />
                        </button>
                      )}
                      {onOpenIde && (
                        <button
                          type="button"
                          className="icon-btn-sm"
                          onClick={() => onOpenIde(p)}
                          data-tooltip="Mở Browser IDE (VorStudio)"
                          aria-label="Browser IDE"
                        >
                          <Code2 size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn-sm"
                        onClick={() => onOpen(p)}
                        data-tooltip="Mở Bảng Kanban"
                        aria-label="Mở Bảng Kanban"
                      >
                        <KanbanSquare size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CHẾ ĐỘ 2: BẢNG DỮ LIỆU (TABLE VIEW) — Mật độ cao, cuộn thống nhất trên toàn trang (Rule 10) */}
        {!loading && shown.length > 0 && viewMode === 'table' && (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Dự án &amp; Đường dẫn</th>
                  <th>Git / Nhánh</th>
                  <th>Trạng thái &amp; Task</th>
                  <th>Agent / Nguồn</th>
                  <th>Cập nhật</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const sources = describeProjectSources(p);
                  const pTasks = tasksOfProject(tasks, p);
                  const count = taskCount(p);
                  const pRunning = pTasks.filter((t) => t.status === 'running').length;
                  const pWaiting = pTasks.filter((t) => t.status === 'awaiting_user' || t.status === 'failed').length;
                  const pKey = projectKeyOf(p.path);
                  const pMemories = memories.filter((m) => projectKeyOf(m.repoPath) === pKey);
                  const pPlans = plans.filter((pl) => projectKeyOf(pl.repoPath) === pKey);
                  const pDrafts = pPlans.filter((pl) => pl.status === 'draft').length;
                  const pInboxCount = pWaiting + pDrafts;
                  const isInitBusy = initGitBusyPath === p.path;

                  return (
                    <tr
                      key={p.id}
                      className={`projects-table-row ${pInboxCount > 0 ? 'has-inbox' : ''}`}
                      onClick={() => (onOpenOffice3D ? onOpenOffice3D(p) : onOpen(p))}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (onOpenOffice3D) onOpenOffice3D(p);
                          else onOpen(p);
                        }
                      }}
                    >
                      {/* Cột 1: Tên dự án & Đường dẫn */}
                      <td className="projects-table-cell-main">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <FolderGit2 size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name}
                            </div>
                            <div
                              style={{
                                fontSize: '11.5px',
                                color: 'var(--text-secondary)',
                                fontFamily: 'var(--font-mono)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '380px',
                              }}
                              data-tooltip={p.path}
                            >
                              {p.path}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Cột 2: Git / Nhánh */}
                      <td>
                        {!p.isGit ? (
                          <button
                            type="button"
                            className="office-mini-btn"
                            disabled={isInitBusy}
                            onClick={(e) => { void handleInitGit(e, p); }}
                            data-tooltip="Thư mục này chưa có Git — Bấm để khởi tạo Git (git init) ngay"
                            style={{
                              background: 'var(--amber-bg)',
                              color: 'var(--amber-text)',
                              borderColor: 'var(--amber-border)',
                              fontWeight: 600,
                              height: '24px',
                              minHeight: '24px',
                              padding: '0 8px',
                              fontSize: '11px',
                            }}
                          >
                            <GitBranch size={11} />
                            <span>{isInitBusy ? 'Đang tạo…' : '+ Khởi tạo Git'}</span>
                          </button>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {p.branch !== null ? (
                              <span
                                className="projects-git-pill"
                              >
                                <GitBranch size={11} />
                                <span>{p.branch}</span>
                              </span>
                            ) : (
                              <span className="muted" style={{ fontSize: '12px' }}>Git</span>
                            )}
                            {p.dirtyCount !== null && p.dirtyCount > 0 && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  fontSize: '11.5px',
                                  fontWeight: 600,
                                  color: 'var(--amber-text)',
                                }}
                                data-tooltip={`${p.dirtyCount} tệp có thay đổi chưa commit`}
                              >
                                <FileEdit size={11} /> {p.dirtyCount}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Cột 3: Trạng thái & Task */}
                      <td>
                        {pRunning === 0 && pInboxCount === 0 && count === 0 && pMemories.length === 0 ? (
                          <span className="muted" style={{ fontSize: '12px' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            {pRunning > 0 && (
                              <span className="badge info">
                                ⚡ {pRunning}
                              </span>
                            )}
                            {pInboxCount > 0 && (
                              <button
                                type="button"
                                className="badge warn"
                                style={{ cursor: 'pointer', height: '23px', minHeight: '23px', padding: '0 7px' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenManager?.(p);
                                }}
                              >
                                🔔 {pInboxCount} cần duyệt
                              </button>
                            )}
                            {count > 0 && <span className="badge neutral">{count} task</span>}
                            {pMemories.length > 0 && (
                              <span className="badge neutral" data-tooltip={`${pMemories.length} mục Shared Memory`}>
                                <Brain size={11} /> {pMemories.length}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Cột 4: Agent / Nguồn */}
                      <td>
                        {sources.length === 0 ? (
                          <span className="muted" style={{ fontSize: '12px' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                            {sources.map((s) => (
                              <span
                                key={s}
                                className="badge src"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <ProviderIcon provider={s} size={11} /> {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Cột 5: Hoạt động gần nhất */}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <TimeBadge timestamp={p.lastUsedAt} />
                      </td>

                      {/* Cột 6: Nút thao tác nhanh (Icon-only + Custom UI Tooltip) */}
                      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                          {onOpenOffice3D && (
                            <button
                              type="button"
                              className="icon-btn-sm"
                              onClick={() => onOpenOffice3D(p)}
                              data-tooltip="Vào Văn phòng 3D"
                              aria-label="Vào Văn phòng 3D"
                            >
                              <Building2 size={13} />
                            </button>
                          )}
                          {onOpenManager && (
                            <button
                              type="button"
                              className="icon-btn-sm"
                              onClick={() => onOpenManager(p)}
                              data-tooltip="Bàn Trưởng phòng (Giao mục tiêu & Duyệt việc)"
                              aria-label="Bàn Trưởng phòng"
                            >
                              <Crown size={13} />
                            </button>
                          )}
                          {onOpenIde && (
                            <button
                              type="button"
                              className="icon-btn-sm"
                              onClick={() => onOpenIde(p)}
                              data-tooltip="Mở Browser IDE (VorStudio)"
                              aria-label="Browser IDE"
                            >
                              <Code2 size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn-sm"
                            onClick={() => onOpen(p)}
                            data-tooltip="Mở Bảng Kanban"
                            aria-label="Mở Bảng Kanban"
                          >
                            <KanbanSquare size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
