import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  Bot,
  CheckCircle2,
  Clock,
  Folder,
  GitBranch,
  KanbanSquare,
  Plus,
  UserCheck,
  Zap,
} from 'lucide-react';
import type { Task, VEvent } from '@voragent/shared';
import { COLUMNS, columnOf, handoffCount, isUnisolated } from './state';
import { TimeBadge } from './components/TimeBadge';

const FOLDER_NAME = (path: string): string => {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

const AGENT_CLASS = (provider: string | null): string => {
  if (!provider) return '';
  const p = provider.toLowerCase();
  if (p.includes('claude')) return 'claude';
  if (p.includes('codex')) return 'codex';
  if (p.includes('antigravity') || p.includes('agy')) return 'antigravity';
  return '';
};

function StatusBadge({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'waiting_quota':
      return <span className="badge warn"><Clock size={11} /> Chờ quota</span>;
    case 'running':
      return <span className="badge info"><Zap size={11} /> Đang chạy</span>;
    case 'awaiting_user':
      return <span className="badge warn"><UserCheck size={11} /> Chờ bạn duyệt</span>;
    case 'closed':
      return <span className="badge success"><CheckCircle2 size={11} /> Đã xong</span>;
    case 'failed':
      return <span className="badge danger"><AlertCircle size={11} /> Có lỗi</span>;
    default:
      return <span className="badge neutral"><Clock size={11} /> Chờ lượt</span>;
  }
}

export function Board({
  tasks,
  events,
  loading = false,
  onOpen,
  onCreateNew,
}: {
  tasks: Task[];
  events: Map<string, VEvent[]>;
  loading?: boolean;
  onOpen: (id: string) => void;
  onCreateNew?: () => void;
}) {
  if (!loading && tasks.length === 0) {
    return (
      <div className="board-empty">
        <div className="board-empty-icon" style={{ display: 'flex', justifyContent: 'center' }}>
          <KanbanSquare size={44} strokeWidth={1.5} color="var(--text-muted)" />
        </div>
        <h3>Chưa có task nào được giao</h3>
        <p>
          Tạo task mới để voragent tự động khởi tạo Git Worktree độc lập và điều phối
          các AI coding agent (Claude Code, Codex, Antigravity) thực thi yêu cầu của bạn.
        </p>
        {onCreateNew && (
          <button type="button" className="primary" onClick={onCreateNew}>
            <Plus size={15} /> Tạo task đầu tiên <kbd>N</kbd>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="board" aria-label="Bảng Kanban công việc">
      {COLUMNS.map((col) => {
        const items = tasks
          .filter((t) => columnOf(t.status) === col)
          .sort((a, b) => b.seq - a.seq);

        return (
          <section key={col} className="column" aria-label={`Cột ${col}`}>
            <div className="column-header">
              <span className="column-title">
                {col}
                <span className="column-count tabular">{loading ? '…' : items.length}</span>
              </span>
            </div>

            <div className="column-body">
              {loading ? (
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
              ) : items.length === 0 ? (
                <div className="column-empty">
                  <Clock size={18} strokeWidth={1.5} style={{ marginBottom: '0.35rem', opacity: 0.6 }} />
                  <span>Chưa có việc nào</span>
                </div>
              ) : (
                items.map((t) => {
                  const handoffs = handoffCount(events.get(t.id));
                  const folder = FOLDER_NAME(t.repoPath);
                  const agentClass = AGENT_CLASS(t.currentProvider);

                  return (
                    <button
                      key={t.id}
                      className="card"
                      onClick={() => onOpen(t.id)}
                      type="button"
                    >
                      <div className="card-top">
                        <span className="card-seq">#{t.seq}</span>
                        {t.currentProvider && (
                          <span className={`card-agent-badge ${agentClass}`}>
                            <Bot size={11} /> {t.currentProvider}
                          </span>
                        )}
                      </div>

                      <div className="card-title">{t.title}</div>

                      <div className="card-meta">
                        <div className="card-path" title={t.repoPath} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Folder size={12} style={{ flexShrink: 0 }} />
                          <span>{folder}</span>
                          {t.branch && (
                            <>
                              <GitBranch size={11} style={{ flexShrink: 0, marginLeft: '0.2rem' }} />
                              <span>{t.branch}</span>
                            </>
                          )}
                        </div>

                        {isUnisolated(t) && (
                          <div className="badge warn" style={{ alignSelf: 'flex-start' }}>
                            <AlertTriangle size={11} /> Không cách ly
                          </div>
                        )}
                      </div>

                      <div className="card-footer">
                        <StatusBadge status={t.status} />

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                          <TimeBadge timestamp={t.updatedAt || t.createdAt} />

                          {handoffs > 0 && (
                            <span className="handoff-chip" title="Số lần tự động chuyển nền tảng do hết quota">
                              <ArrowLeftRight size={10} /> {handoffs}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
