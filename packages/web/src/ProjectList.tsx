import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  FileEdit,
  FolderGit2,
  GitBranch,
  Layers,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { Project } from '@voragent/shared';
import { describeProjectSources, filterProjects, sortProjects } from './state';
import { TimeBadge } from './components/TimeBadge';

/** Danh sách dự án. Mọi văn bản của dự án chỉ render dạng văn bản (React tự thoát ký tự). */
export function ProjectList({
  projects, loading, error, taskCount, onOpen, onRefresh,
}: {
  projects: Project[] | null;
  loading: boolean;
  error: string | null;
  taskCount: (p: Project) => number;
  onOpen: (p: Project) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const shown = projects === null ? [] : filterProjects(sortProjects(projects), filter);

  return (
    <div className="panel projects">
      <div className="projects-toolbar">
        <div className="projects-search-wrap">
          <Search size={15} className="projects-search-icon" />
          <input
            className="filter"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Lọc dự án theo tên hoặc đường dẫn…"
            aria-label="Lọc dự án"
          />
          {filter && (
            <button
              type="button"
              className="projects-search-clear"
              onClick={() => setFilter('')}
              title="Xóa bộ lọc"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} title="Tải lại danh sách dự án">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>Làm mới</span>
        </button>
      </div>

      {error !== null && <div className="error" role="alert">{error}</div>}

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
            Không có dự án nào khớp với bộ lọc &quot;{filter}&quot;.
          </div>
        )}

        {!loading && shown.map((p) => {
          const sources = describeProjectSources(p);
          const count = taskCount(p);

          return (
            <button key={p.id} type="button" className="project-row" onClick={() => onOpen(p)}>
              <div className="project-row-left">
                <div className="project-row-title">
                  <FolderGit2 size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                  <span>{p.name}</span>
                  {!p.isGit && (
                    <span className="badge warn" style={{ fontSize: '0.7rem' }}>
                      <AlertTriangle size={11} /> không phải repo git
                    </span>
                  )}
                </div>
                <div className="path">{p.path}</div>
                <div className="project-row-meta">
                  <TimeBadge timestamp={p.lastUsedAt} />
                  <span>·</span>
                  {sources.map((s) => <span key={s} className="badge src">{s}</span>)}
                  {p.branch !== null && (
                    <>
                      <span>·</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                        <GitBranch size={11} /> {p.branch}
                      </span>
                    </>
                  )}
                  {p.dirtyCount !== null && p.dirtyCount > 0 && (
                    <>
                      <span>·</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: 'var(--amber-text)' }}>
                        <FileEdit size={11} /> {p.dirtyCount} file sửa dở
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Layers size={11} /> {count} task
                  </span>
                </div>
              </div>

              <div className="project-row-actions">
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}>
                  Mở bảng <ArrowRight size={14} />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
