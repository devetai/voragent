import type { Task, VEvent } from '@voragent/shared';
import { COLUMNS, columnOf, handoffCount, isUnisolated } from './state';

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
        <div className="board-empty-icon">📋</div>
        <h3>Chưa có task nào được giao</h3>
        <p>
          Tạo task mới để voragent tự động khởi tạo Git Worktree độc lập và điều phối
          các AI coding agent (Claude Code, Codex, Antigravity) thực thi yêu cầu của bạn.
        </p>
        {onCreateNew && (
          <button type="button" className="primary" onClick={onCreateNew}>
            + Tạo task đầu tiên <kbd>N</kbd>
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
                Chưa có việc nào
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
                          🤖 {t.currentProvider}
                        </span>
                      )}
                    </div>

                    <div className="card-title">{t.title}</div>

                    <div className="card-meta">
                      <div className="card-path" title={t.repoPath}>
                        📁 {folder}
                        {t.branch ? ` (${t.branch})` : ''}
                      </div>

                      {isUnisolated(t) && (
                        <div className="badge warn">
                          ⚠️ Không cách ly
                        </div>
                      )}
                    </div>

                    <div className="card-footer">
                      <span>
                        {t.status === 'waiting_quota'
                          ? '⏳ Chờ quota'
                          : t.status === 'running'
                          ? '⚡ Đang thực thi'
                          : t.status === 'awaiting_user'
                          ? '✋ Chờ bạn duyệt'
                          : t.status === 'closed'
                          ? '✓ Đã hoàn tất'
                          : t.status === 'failed'
                          ? '✕ Có lỗi'
                          : '🕒 Chờ lượt'}
                      </span>

                      {handoffs > 0 && (
                        <span className="handoff-chip" title="Số lần tự động chuyển nền tảng do hết quota">
                          ⇄ {handoffs} bàn giao
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </section>
        );
      })}
    </div>
  );
}
