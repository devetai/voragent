import {
  AlertTriangle,
  ArrowLeftRight,
  Clock,
  Folder,
  GitBranch,
  KanbanSquare,
  Plus,
} from 'lucide-react';
import type { Task, VEvent } from '@voragent/shared';
import { COLUMNS, columnOf, handoffCount, isUnisolated } from './state';
import { TimeBadge } from './components/TimeBadge';
import { ProviderIcon } from './components/ProviderIcon';

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
  if (p.includes('opencode')) return 'opencode';
  return '';
};

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
                  <span>Trống</span>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {t.status === 'waiting_quota' && (
                            <span className="badge warn" style={{ fontSize: '10.5px', padding: '1px 6px' }}>
                              <Clock size={10} /> Chờ quota
                            </span>
                          )}
                          {(() => {
                            if (t.status === 'queued' && t.parentTaskId) {
                              const parent = tasks.find((x) => x.id === t.parentTaskId);
                              if (parent && parent.status !== 'closed') {
                                return (
                                  <span
                                    className="badge"
                                    style={{ fontSize: '10.5px', padding: '1px 6px', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                                    data-tooltip={`Đang chờ #${parent.seq} (${parent.title}) hoàn thành`}
                                  >
                                    <Clock size={10} /> Chờ #${parent.seq}
                                  </span>
                                );
                              }
                            }
                            return null;
                          })()}
                          {isUnisolated(t) && (
                            <span className="badge warn" style={{ fontSize: '10.5px', padding: '1px 6px' }} data-tooltip="Không cách ly Git Worktree">
                              <AlertTriangle size={10} />
                            </span>
                          )}
                          {t.currentProvider && (
                            <span className={`card-agent-badge ${agentClass}`}>
                              <ProviderIcon provider={t.currentProvider} size={11} /> {t.currentProvider}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="card-title">{t.title}</div>

                      <div className="card-footer">
                        <div className="card-path" data-tooltip={t.repoPath} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', minWidth: 0, flex: 1 }}>
                          <Folder size={11} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder}</span>
                          {t.branch && (
                            <>
                              <GitBranch size={10} style={{ flexShrink: 0, marginLeft: '0.15rem' }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>{t.branch}</span>
                            </>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                          {handoffs > 0 && (
                            <span className="handoff-chip" data-tooltip="Số lần tự động chuyển nền tảng do hết quota">
                              <ArrowLeftRight size={10} /> {handoffs}
                            </span>
                          )}
                          <TimeBadge timestamp={t.updatedAt || t.createdAt} />
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
