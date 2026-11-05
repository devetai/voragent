import { useState } from 'react';
import type { Project } from '@voragent/shared';
import { SnakeLoader } from './components/SnakeLoader';
import { describeProjectSources, filterProjects, formatLastUsed, sortProjects } from './state';

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
      <div className="row">
        <input
          className="filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Lọc theo tên hoặc đường dẫn"
          aria-label="Lọc dự án"
        />
        <button type="button" onClick={onRefresh} disabled={loading}>Làm mới</button>
      </div>
      {error !== null && <div className="error" role="alert">{error}</div>}
      {loading && <SnakeLoader size="md" variant="crawl" label="Đang tải danh sách dự án…" />}
      {!loading && projects !== null && projects.length === 0 && error === null && (
        <div className="muted">
          Chưa tìm thấy dự án nào. Hãy gõ một thư mục qua “Thư mục khác…” khi tạo task, hoặc chạy <code>voragent add</code>.
        </div>
      )}
      {!loading && projects !== null && projects.length > 0 && shown.length === 0 && (
        <div className="muted">Không có dự án nào khớp.</div>
      )}
      {shown.map((p) => {
        const sources = describeProjectSources(p);
        return (
          <button key={p.id} type="button" className="card project-row" onClick={() => onOpen(p)}>
            <div><strong>{p.name}</strong> {!p.isGit && <span className="badge warn">không phải repo git</span>}</div>
            <div className="muted path">{p.path}</div>
            <div className="muted">
              Lần dùng cuối: {formatLastUsed(p.lastUsedAt)}
              {' · '}
              {sources.map((s) => <span key={s} className="badge src">{s}</span>)}
              {p.branch !== null && <> · nhánh: {p.branch}</>}
              {' · '}
              {p.dirtyCount !== null && p.dirtyCount > 0 ? `${p.dirtyCount} file đang sửa` : '-'}
              {' · '}
              task: {taskCount(p)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
