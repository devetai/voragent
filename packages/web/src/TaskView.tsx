import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileCode2,
  Folder,
  GitBranch,
  GitCommit,
  MessagesSquare,
  RotateCcw,
  Send,
  Settings2,
  UserCheck,
  Zap,
} from 'lucide-react';
import type { Task, VEvent } from '@voragent/shared';
import { api, errText } from './api';
import type { Diff } from './api';
import { SnakeLoader } from './components/SnakeLoader';
import { isUnisolated, transcript } from './state';
import { TimeBadge } from './components/TimeBadge';

function TaskStatusBadge({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'waiting_quota':
      return <span className="badge warn"><Clock size={12} /> Chờ hạn mức</span>;
    case 'running':
      return <span className="badge info"><Zap size={12} /> Đang chạy</span>;
    case 'awaiting_user':
      return <span className="badge warn"><UserCheck size={12} /> Chờ phản hồi</span>;
    case 'closed':
      return <span className="badge success"><CheckCircle2 size={12} /> Đã hoàn tất</span>;
    case 'failed':
      return <span className="badge danger"><AlertCircle size={12} /> Thất bại</span>;
    default:
      return <span className="badge neutral"><Clock size={12} /> Hàng đợi</span>;
  }
}

function CopyableTag({ text, label, icon }: { text: string; label: string; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="task-meta-item" title={label}>
      {icon}
      <span>{text}</span>
      <button
        type="button"
        className="copy-btn"
        onClick={copy}
        title={copied ? 'Đã sao chép!' : 'Sao chép'}
      >
        {copied ? <Check size={11} color="var(--green-base)" /> : <Copy size={11} />}
      </button>
    </div>
  );
}

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

  const handleSend = (): void => {
    if (canSend && text.trim() !== '' && !busy) {
      act(() => api.send(task.id, text.trim()), () => setText(''));
    }
  };

  const displayPath = task.workspacePath ?? task.repoPath;

  return (
    <div className="panel">
      <div className="task-nav">
        <button type="button" onClick={onBack} title="Quay lại bảng Kanban (Phím tắt: Esc)">
          <ArrowLeft size={15} /> Quay lại bảng <kbd>Esc</kbd>
        </button>
        <TaskStatusBadge status={task.status} />
      </div>

      <div className="task-header">
        <div className="task-title-row">
          <h2>
            <span className="mono text-muted">#{task.seq}</span> {task.title}
          </h2>
        </div>

        <div className="task-meta-grid">
          <CopyableTag
            text={displayPath}
            label="Đường dẫn thư mục làm việc"
            icon={<Folder size={13} style={{ flexShrink: 0 }} />}
          />
          {task.branch && (
            <CopyableTag
              text={task.branch}
              label="Nhánh git cách ly"
              icon={<GitBranch size={13} style={{ flexShrink: 0 }} />}
            />
          )}
          {task.currentProvider && (
            <div className="task-meta-item" title="Nền tảng thực thi hiện hành">
              <Bot size={13} /> {task.currentProvider}
            </div>
          )}
          <div className="task-meta-item" title="Chế độ không gian làm việc">
            <Settings2 size={13} /> {task.mode}
          </div>
          <div className="task-meta-item" title="Thời gian cập nhật gần nhất">
            <TimeBadge timestamp={task.updatedAt || task.createdAt} />
          </div>
          {isUnisolated(task) && (
            <div className="badge warn">
              <AlertTriangle size={12} /> Không cách ly: làm việc trực tiếp trên repo gốc
            </div>
          )}
        </div>
      </div>

      {error !== null && (
        <div className="error" role="alert" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* 2-Column Split-Screen Layout (Bao phủ tối đa màn hình) */}
      <div className="task-split-layout">
        {/* Left Column: Transcript & Sticky Chat Action Dock */}
        <div className="task-pane-left">
          <div className="transcript-container">
            <div className="transcript-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1rem' }}>
                <MessagesSquare size={16} /> Nhật ký trao đổi & hành động
              </h3>
            </div>
            <div className="transcript">
              {items.map((it, i) =>
                it.kind === 'handoff' ? (
                  <div key={i} className="handoff-divider-wrap">
                    <div className="handoff-divider-line" />
                    <div className="handoff-divider-badge">
                      <Zap size={13} /> <span>Handoff:</span> {it.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className={`msg ${it.kind}`}>
                    {it.text}
                  </div>
                ),
              )}
              {items.length === 0 && (
                <div className="muted" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                  Chưa có nội dung trao đổi.
                </div>
              )}
            </div>
          </div>

          {/* Sticky Bottom Action Dock (Zero Excessive Scrolling) */}
          <div className="chat-action-bar">
            <div className="chat-input-row">
              <textarea
                value={text}
                rows={2}
                placeholder={
                  canSend
                    ? 'Nhập hướng dẫn hoặc phản hồi cho agent (Ctrl + Enter để gửi nhanh)…'
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
              <button
                type="button"
                className="primary chat-btn-send"
                disabled={busy || !canSend || text.trim() === ''}
                onClick={handleSend}
                title="Gửi phản hồi (Ctrl + Enter)"
              >
                <Send size={15} /> Gửi <kbd>Ctrl+↵</kbd>
              </button>
            </div>

            <div className="chat-lifecycle-actions">
              <button
                type="button"
                disabled={busy || task.status === 'closed'}
                onClick={() => act(() => api.close(task.id))}
                title="Đánh dấu công việc đã hoàn thành trọn vẹn"
              >
                <CheckCircle2 size={14} /> Hoàn tất
              </button>
              <button
                type="button"
                disabled={busy || task.status !== 'failed'}
                onClick={() => act(() => api.retry(task.id, false))}
                title="Thử lại trên nền tảng hiện tại"
              >
                <RotateCcw size={14} className={busy ? 'spin' : ''} /> Thử lại
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy || task.status !== 'failed'}
                onClick={() => act(() => api.retry(task.id, true))}
                title="Chuyển sang nền tảng kế tiếp trong danh sách ưu tiên"
              >
                <Zap size={14} /> Chuyển agent kế tiếp
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Source Code Diff & Commits */}
        <div className="task-pane-right">
          <div style={{ marginBottom: '0.75rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1rem' }}>
              <FileCode2 size={16} /> Thay đổi mã nguồn (Git Diff)
            </h3>
          </div>

          {diff === null ? (
            <div style={{ padding: '2rem 1rem', background: 'var(--bg-canvas)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
              <SnakeLoader size="sm" inline label="Đang tải thay đổi git…" />
            </div>
          ) : (
            <div className="diff-container">
              {diff.commits.length > 0 && (
                <div className="diff-header">
                  <GitCommit size={13} /> Các commit đã tạo ({diff.commits.length}):
                </div>
              )}
              {diff.commits.length > 0 && (
                <pre className="diff" style={{ maxHeight: '140px', borderBottom: '1px solid #27272A' }}>
                  {diff.commits.join('\n')}
                </pre>
              )}
              {diff.status !== '' && (
                <div className="diff-header">
                  <FileCode2 size={13} /> Trạng thái file:
                </div>
              )}
              {diff.status !== '' && (
                <pre className="diff" style={{ maxHeight: '140px', borderBottom: '1px solid #27272A' }}>
                  {diff.status}
                </pre>
              )}
              <div className="diff-header">
                Nội dung diff:
              </div>
              <pre className="diff">
                {diff.diff === '' ? '(Không có thay đổi mã nguồn chưa commit)' : diff.diff}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
