import { useEffect, useState } from 'react';
import type { Task, VEvent } from '@voragent/shared';
import { api, errText } from './api';
import type { Diff } from './api';
import { SnakeLoader } from './components/SnakeLoader';
import { isUnisolated, transcript } from './state';

const STATUS_LABEL: Record<Task['status'], { label: string; badgeClass: string }> = {
  queued: { label: 'Hàng đợi', badgeClass: 'badge neutral' },
  waiting_quota: { label: 'Chờ hạn mức', badgeClass: 'badge warn' },
  running: { label: 'Đang chạy', badgeClass: 'badge info' },
  awaiting_user: { label: 'Chờ phản hồi', badgeClass: 'badge warn' },
  closed: { label: 'Đã hoàn tất', badgeClass: 'badge success' },
  failed: { label: 'Thất bại', badgeClass: 'badge warn' },
};

export function TaskView({
  task,
  events,
  onLoaded,
  onBack,
}: {
  task: Task;
  events: VEvent[];
  onLoaded: (taskId: string, events: VEvent[]) => void;
  onBack: () => void;
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tải lịch sử đầy đủ khi mở.
  useEffect(() => {
    let live = true;
    api.task(task.id).then(
      (d) => {
        if (live) onLoaded(task.id, d.events);
      },
      (e: unknown) => {
        if (live) setError(errText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [task.id, onLoaded]);

  // Tải lại diff mỗi khi trạng thái đổi.
  useEffect(() => {
    let live = true;
    api.diff(task.id).then(
      (d) => {
        if (live) setDiff(d);
      },
      (e: unknown) => {
        if (live) setError(errText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [task.id, task.status]);

  const act = (fn: () => Promise<unknown>, after?: () => void): void => {
    setBusy(true);
    setError(null);
    fn().then(
      () => {
        setBusy(false);
        after?.();
      },
      (e: unknown) => {
        setBusy(false);
        setError(errText(e));
      },
    );
  };

  const canSend = task.status === 'awaiting_user' || task.status === 'failed';
  const items = transcript(events);
  const statusInfo = STATUS_LABEL[task.status] ?? { label: task.status, badgeClass: 'badge neutral' };

  const handleSend = (): void => {
    if (canSend && text.trim() !== '' && !busy) {
      act(() => api.send(task.id, text.trim()), () => setText(''));
    }
  };

  return (
    <div className="panel">
      <div className="task-nav">
        <button type="button" onClick={onBack} title="Quay lại bảng Kanban (Phím tắt: Esc)">
          ← Quay lại bảng <kbd>Esc</kbd>
        </button>
        <span className={statusInfo.badgeClass}>{statusInfo.label}</span>
      </div>

      <div className="task-header">
        <div className="task-title-row">
          <h2>
            <span className="mono text-muted">#{task.seq}</span> {task.title}
          </h2>
        </div>

        <div className="task-meta-grid">
          <div className="task-meta-item" title="Đường dẫn làm việc">
            📁 {task.workspacePath ?? task.repoPath}
          </div>
          {task.branch && (
            <div className="task-meta-item" title="Nhánh git cách ly">
              🌿 {task.branch}
            </div>
          )}
          {task.currentProvider && (
            <div className="task-meta-item" title="Nền tảng thực thi hiện hành">
              🤖 {task.currentProvider}
            </div>
          )}
          <div className="task-meta-item" title="Chế độ không gian làm việc">
            ⚙ {task.mode}
          </div>
          {isUnisolated(task) && (
            <div className="badge warn">
              ⚠️ Không cách ly: làm việc trực tiếp trên repo gốc
            </div>
          )}
        </div>
      </div>

      <div className="transcript-container">
        <h3>Nhật ký hội thoại và hành động</h3>
        <div className="transcript">
          {items.map((it, i) =>
            it.kind === 'handoff' ? (
              <div key={i} className="handoff-divider-wrap">
                <div className="handoff-divider-line" />
                <div className="handoff-divider-badge">
                  <span>⚡ Handoff:</span> {it.text}
                </div>
              </div>
            ) : (
              <div key={i} className={`msg ${it.kind}`}>
                {it.text}
              </div>
            ),
          )}
          {items.length === 0 && <div className="muted">Chưa có nội dung trao đổi.</div>}
        </div>
      </div>

      <div className="diff-section">
        <h3>Thay đổi mã nguồn (Git Diff)</h3>
        {diff === null ? (
          <SnakeLoader size="sm" inline label="Đang tải thay đổi…" />
        ) : (
          <div className="diff-container">
            {diff.commits.length > 0 && (
              <div className="diff-header">
                Các commit đã tạo:
                <pre className="diff">{diff.commits.join('\n')}</pre>
              </div>
            )}
            {diff.status !== '' && (
              <div className="diff-header">
                Trạng thái file:
                <pre className="diff">{diff.status}</pre>
              </div>
            )}
            <div className="diff-header">Nội dung diff:</div>
            <pre className="diff">
              {diff.diff === '' ? '(Không có thay đổi mã nguồn chưa commit)' : diff.diff}
            </pre>
          </div>
        )}
      </div>

      {error !== null && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <div className="chat-action-bar">
        <textarea
          value={text}
          rows={3}
          placeholder={
            canSend
              ? 'Nhập hướng dẫn hoặc phản hồi tiếp theo cho agent (Ctrl + Enter để gửi nhanh)…'
              : 'Task đang thực thi hoặc đã kết thúc, không thể gửi thêm tin nhắn.'
          }
          disabled={!canSend}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy || !canSend || text.trim() === ''}
            onClick={handleSend}
            title="Gửi phản hồi (Ctrl + Enter)"
          >
            Gửi phản hồi <kbd>Ctrl+Enter</kbd>
          </button>
          <button
            type="button"
            disabled={busy || task.status === 'closed'}
            onClick={() => act(() => api.close(task.id))}
          >
            Đánh dấu hoàn thành
          </button>
          <button
            type="button"
            disabled={busy || task.status !== 'failed'}
            onClick={() => act(() => api.retry(task.id, false))}
          >
            Thử lại trên nền tảng hiện tại
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy || task.status !== 'failed'}
            onClick={() => act(() => api.retry(task.id, true))}
          >
            Chuyển sang nền tảng kế tiếp
          </button>
        </div>
      </div>
    </div>
  );
}
