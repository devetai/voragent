import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  FileCode2,
  Folder,
  GitBranch,
  GitCommit,
  Globe,
  Maximize2,
  MessagesSquare,
  RotateCcw,
  Send,
  Terminal,
  Trash2,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import { PROVIDER_MODELS, type ProviderState, type Task, type Turn, type VEvent } from '@voragent/shared';
import { api, errText } from './api';
import type { Diff } from './api';
import { SnakeLoader } from './components/SnakeLoader';
import { isUnisolated, transcript } from './state';
import { TimeBadge } from './components/TimeBadge';
import { ProviderIcon } from './components/ProviderIcon';
import { MarkdownContent } from './components/MarkdownContent';
import { CustomSelect, type SelectOption } from './components/CustomSelect';

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
    <div className="task-meta-item">
      {icon}
      <span style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
      <button
        type="button"
        className="copy-btn"
        onClick={copy}
        data-tooltip={copied ? 'Đã sao chép!' : 'Sao chép đường dẫn / nhánh'}
        aria-label="Sao chép"
      >
        {copied ? <Check size={11} color="var(--green-base)" /> : <Copy size={11} />}
      </button>
    </div>
  );
}

export function TaskView({
  task,
  events,
  providers = [],
  projectName,
  onLoaded,
  onBack,
  onDeleted,
  onSelectProject,
  inModal = false,
  onMaximize,
}: {
  task: Task;
  events: VEvent[];
  providers?: ProviderState[];
  projectName?: string;
  onLoaded: (taskId: string, events: VEvent[]) => void;
  onBack: () => void;
  onDeleted?: (taskId: string) => void;
  onSelectProject?: (projectPath: string) => void;
  inModal?: boolean;
  onMaximize?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [diffTab, setDiffTab] = useState<'diff' | 'files' | 'commits'>('diff');
  const [modalPane, setModalPane] = useState<'chat' | 'diff'>('chat');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTo({
        top: transcriptRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  const handleTranscriptScroll = () => {
    if (!transcriptRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = transcriptRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 80;
    setUserScrolledUp(!isNearBottom);
  };

  // Cuộn xuống cuối ngay khi mở task mới hoặc vừa nạp xong
  useEffect(() => {
    setUserScrolledUp(false);
    const timer = setTimeout(() => scrollToBottom(false), 60);
    return () => clearTimeout(timer);
  }, [task.id, scrollToBottom]);

  // Cuộn xuống mượt mà khi có nội dung mới (nếu người dùng không chủ động cuộn ngược lên trên)
  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom(true);
    }
  }, [events.length, isSending, task.status, userScrolledUp, scrollToBottom]);

  // Tải lịch sử đầy đủ khi mở.
  useEffect(() => {
    let live = true;
    api.task(task.id).then(
      (d) => {
        if (live) {
          setTurns(d.turns);
          onLoaded(task.id, d.events);
        }
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

  const handleDeleteTask = () => {
    act(
      () => api.deleteTask(task.id),
      () => {
        if (onDeleted) onDeleted(task.id);
        else onBack();
      },
    );
  };

  const handleAssignProvider = (providerId: string) => {
    act(() => api.assignTask(task.id, providerId));
  };

  const canSend =
    task.status === 'awaiting_user' ||
    task.status === 'failed' ||
    task.status === 'waiting_quota' ||
    task.status === 'queued';

  const items = transcript(events).filter((it) => it.text.trim().length > 0);
  const initialPrompt = turns[0]?.message || task.title;

  const displayItems =
    items.length > 0
      ? items
      : initialPrompt
      ? [{ kind: 'user' as const, text: initialPrompt, ts: task.createdAt }]
      : [];

  // Xóa tin nhắn optimistic khi tin nhắn thật đã nạp vào events/turns
  useEffect(() => {
    if (pendingText) {
      const exists = displayItems.some((it) => it.kind === 'user' && it.text.trim() === pendingText.trim());
      if (exists) {
        setPendingText(null);
      }
    }
  }, [displayItems, pendingText]);

  const handleSend = (): void => {
    if (canSend && text.trim() !== '' && !busy && !isSending) {
      const msgToSend = text.trim();
      setText('');
      setPendingText(msgToSend);
      setIsSending(true);
      setUserScrolledUp(false);
      scrollToBottom(true);

      api.send(task.id, msgToSend).then(
        () => {
          setIsSending(false);
          scrollToBottom(true);
        },
        (e: unknown) => {
          setIsSending(false);
          setPendingText(null);
          setText(msgToSend);
          setError(errText(e));
        }
      );
    }
  };

  const isAgentThinking = isSending || task.status === 'running';

  const displayPath = task.workspacePath ?? task.repoPath;
  const changedFileLines = diff?.status ? diff.status.split('\n').filter((l) => l.trim().length > 0) : [];
  const diffBadgeCount = changedFileLines.length || diff?.commits.length || 0;

  // Danh sách các agent khác đã cài đặt sẵn sàng để đổi ngay
  const switchableProviders = providers.filter(
    (p) => p.installed && p.id !== task.currentProvider,
  );

  const latestQuotaEvent = events.filter((e) => e.type === 'QUOTA_EXHAUSTED').at(-1);
  const isModelQuotaExhausted =
    Boolean(latestQuotaEvent?.data?.suggestedModel) &&
    (task.status === 'awaiting_user' || task.status === 'waiting_quota');

  const renderTranscriptPane = () => (
    <div className="task-pane-left">
      <div className="transcript-container">
        {!inModal && (
          <div className="transcript-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.925rem' }}>
              <MessagesSquare size={15} /> Nhật ký trao đổi ({displayItems.length})
            </h3>
          </div>
        )}

        {/* CẢNH BÁO MODEL HẾT HẠN MỨC & QUYẾT ĐỊNH CHUYỂN MODEL HAY DỪNG */}
        {isModelQuotaExhausted && (
          <div
            className="task-recovery-banner"
            style={{
              margin: '0.5rem 0.75rem',
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: '#FFFBEB',
              border: '1px solid #FCD34D',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} color="#D97706" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#92400E' }}>
                  Model {String(latestQuotaEvent?.data?.model ?? 'hiện tại')} đã hết hạn mức (Quota)
                </div>
                <div style={{ fontSize: '0.8rem', color: '#78350F', marginTop: '2px' }}>
                  Hệ thống tạm dừng để bạn quyết định: bạn có muốn chuyển sang <strong>{String(latestQuotaEvent?.data?.suggestedModelName ?? latestQuotaEvent?.data?.suggestedModel)}</strong> (còn quota) để tiếp tục ngay, hay dừng công việc?
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  const targetModel = String(latestQuotaEvent?.data?.suggestedModel);
                  act(async () => {
                    await api.updateTaskModel(task.id, targetModel);
                    await api.retry(task.id, false);
                  });
                }}
                style={{ height: '30px', minHeight: '30px', fontSize: '0.8rem', padding: '0 12px', background: '#D97706', borderColor: '#B45309' }}
              >
                <Zap size={13} />
                <span>Chuyển sang {String(latestQuotaEvent?.data?.suggestedModelName ?? latestQuotaEvent?.data?.suggestedModel)} &amp; Chạy tiếp</span>
              </button>

              <button
                type="button"
                className="office-mini-btn"
                disabled={busy}
                onClick={() => act(() => api.close(task.id))}
                style={{ height: '30px', fontSize: '0.8rem', padding: '0 10px' }}
              >
                <span>Dừng công việc</span>
              </button>

              <button
                type="button"
                className="office-mini-btn"
                disabled={busy}
                onClick={() => act(() => api.retry(task.id, false))}
                style={{ height: '30px', fontSize: '0.8rem', padding: '0 10px' }}
                data-tooltip="Ép thử chạy lại trên model hiện tại"
              >
                <RotateCcw size={13} />
                <span>Thử lại</span>
              </button>
            </div>
          </div>
        )}

        {/* CẢNH BÁO VÀ THANH CỨU HỘ KHI CHỜ HẠN MỨC HOẶC LỖI */}
        {!isModelQuotaExhausted && (task.status === 'waiting_quota' || task.status === 'failed') && (
          <div
            className="task-recovery-banner"
            style={{
              margin: '0.5rem 0.75rem',
              padding: '0.75rem 0.9rem',
              borderRadius: 'var(--radius-md)',
              background: task.status === 'waiting_quota' ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${task.status === 'waiting_quota' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                {task.status === 'waiting_quota' ? (
                  <Clock size={16} color="var(--amber-base)" style={{ flexShrink: 0 }} />
                ) : (
                  <AlertCircle size={16} color="var(--red-base)" style={{ flexShrink: 0 }} />
                )}
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {task.status === 'waiting_quota'
                    ? `Task đang tạm dừng do ${task.currentProvider ? `agent ${task.currentProvider}` : 'nền tảng'} hết hạn mức (quota) hoặc bị giới hạn tốc độ.`
                    : 'Lượt thực thi trước bị lỗi hoặc gián đoạn.'}
                </span>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Bạn có thể chuyển ngay sang Agent khác còn lượt thực thi, ép thử chạy lại, hoặc xóa task này:
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
              {switchableProviders.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="office-mini-btn"
                  disabled={busy}
                  onClick={() => handleAssignProvider(p.id)}
                  style={{
                    background: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                    padding: '0 8px',
                    height: '28px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                  data-tooltip={`Đổi sang agent ${p.id} và tiếp quản chạy task này ngay`}
                >
                  <ProviderIcon provider={p.id} size={13} />
                  <span>Đổi sang {p.id}</span>
                </button>
              ))}

              <button
                type="button"
                className="office-mini-btn"
                disabled={busy}
                onClick={() => act(() => api.retry(task.id, false))}
                style={{ height: '28px', fontSize: '0.78rem', padding: '0 8px' }}
                data-tooltip="Bỏ qua thời gian chờ, ép chạy lại ngay trên nền tảng hiện tại"
              >
                <RotateCcw size={13} className={busy ? 'spin' : ''} />
                <span>Chạy lại ngay</span>
              </button>

              <button
                type="button"
                className="office-mini-btn danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
                style={{ height: '28px', fontSize: '0.78rem', padding: '0 8px' }}
                data-tooltip="Xóa vĩnh viễn task này"
              >
                <Trash2 size={13} />
                <span>Xóa task</span>
              </button>

              {(() => {
                const pKey = (task.currentProvider ?? 'antigravity').toLowerCase();
                const models = PROVIDER_MODELS[pKey] ?? [];
                const otherModels = models.filter((m) => m.id !== task.model);
                if (otherModels.length === 0) return null;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', width: '100%', marginTop: '0.2rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mô hình tiết kiệm:</span>
                    {otherModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="office-mini-btn"
                        onClick={() => {
                          void api.updateTaskModel(task.id, m.id).then(() => {
                            void api.retry(task.id, false);
                          });
                        }}
                        data-tooltip={`Đổi sang ${m.name} và chạy lại ngay`}
                        style={{ fontSize: '0.72rem', height: '24px', padding: '0 6px' }}
                      >
                        <span>⚡ {m.name}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}

            </div>
          </div>
        )}

        <div
          className="transcript"
          ref={transcriptRef}
          onScroll={handleTranscriptScroll}
        >
          {displayItems.map((it, i) => {
            if (it.kind === 'handoff') {
              return (
                <div key={i} className="handoff-divider-wrap">
                  <div className="handoff-divider-line" />
                  <div className="handoff-divider-badge">
                    <Zap size={13} /> <span>Handoff:</span> {it.text}
                  </div>
                </div>
              );
            }
            if (it.kind === 'tool') {
              const firstLine = (it.text.split('\n')[0] || 'Thực thi công cụ').slice(0, 96);
              const hasMore = it.text.includes('\n') || it.text.length > 96;
              return (
                <details key={i} className="msg-tool-collapsible">
                  <summary className="msg-tool-summary">
                    <Terminal size={12} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                    <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {firstLine}
                    </span>
                    {hasMore && (
                      <span className="muted" style={{ fontSize: '11px', flexShrink: 0 }}>
                        Chi tiết ▾
                      </span>
                    )}
                  </summary>
                  <pre className="msg-tool-body">{it.text}</pre>
                </details>
              );
            }
            if (it.kind === 'agent' || it.kind === 'user') {
              return (
                <div key={i} className={`msg ${it.kind}`}>
                  <MarkdownContent content={it.text} />
                </div>
              );
            }
            return (
              <div key={i} className={`msg ${it.kind}`}>
                {it.text}
              </div>
            );
          })}

          {/* Tin nhắn tạm thời (optimistic) của người dùng ngay khi vừa bấm Gửi */}
          {pendingText && (
            <div className="msg user is-sending">
              <MarkdownContent content={pendingText} />
              <div className="msg-sending-indicator">
                <Clock size={11} className="spin" />
                <span>Đang gửi chỉ đạo tới agent…</span>
              </div>
            </div>
          )}

          {/* Bubble hiển thị Agent đang phản hồi / suy nghĩ */}
          {isAgentThinking && (
            <div className="agent-thinking-bubble">
              <div className="agent-thinking-avatar">
                <ProviderIcon provider={task.currentProvider ?? 'antigravity'} size={15} />
              </div>
              <div className="agent-thinking-body">
                <div className="agent-thinking-meta">
                  <span className="agent-thinking-name">
                    {task.currentProvider
                      ? task.currentProvider.charAt(0).toUpperCase() + task.currentProvider.slice(1)
                      : 'Agent'}
                  </span>
                  <span className="agent-thinking-state">
                    {isSending
                      ? 'Đã tiếp nhận chỉ đạo, đang chuẩn bị thực thi…'
                      : task.status === 'running'
                      ? 'Đang suy nghĩ & thực thi công việc…'
                      : 'Đang phản hồi…'}
                  </span>
                </div>
                <div className="agent-typing-dots">
                  <span className="dot dot-1" />
                  <span className="dot dot-2" />
                  <span className="dot dot-3" />
                </div>
              </div>
            </div>
          )}

          {displayItems.length === 0 && !pendingText && !isAgentThinking && (
            <div className="muted" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              Chưa có nội dung trao đổi.
            </div>
          )}
        </div>

        {/* Nút nổi cuộn xuống tin nhắn mới nhất khi người dùng cuộn lên trên */}
        {userScrolledUp && (
          <button
            type="button"
            className="transcript-scroll-bottom-btn"
            onClick={() => {
              setUserScrolledUp(false);
              scrollToBottom(true);
            }}
            data-tooltip="Cuộn xuống tin nhắn mới nhất"
            aria-label="Cuộn xuống tin nhắn mới nhất"
          >
            <ArrowDown size={14} />
            <span>Xuống tin mới nhất</span>
          </button>
        )}
      </div>

      {/* Sticky Bottom Action Dock */}
      <div className={`chat-action-bar ${!canSend || isSending ? 'is-readonly' : ''}`}>
        <div className="chat-input-row">
          <textarea
            value={text}
            rows={canSend && !isSending ? 2 : 1}
            placeholder={
              isSending
                ? 'Đang gửi yêu cầu tới agent…'
                : canSend
                ? 'Nhập hướng dẫn hoặc phản hồi bổ sung (Ctrl + Enter để gửi)…'
                : 'Agent đang thực thi hoặc công việc đã kết thúc.'
            }
            disabled={!canSend || isSending}
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
            className="chat-btn-send"
            disabled={busy || isSending || !canSend || text.trim() === ''}
            onClick={handleSend}
            data-tooltip="Gửi phản hồi cho agent (Ctrl+Enter)"
          >
            <Send size={14} /> <span>Gửi</span> <kbd>Ctrl+↵</kbd>
          </button>
        </div>

        {task.status === 'failed' && (
          <div className="chat-lifecycle-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.retry(task.id, false))}
              data-tooltip="Thử lại trên nền tảng hiện tại"
            >
              <RotateCcw size={14} className={busy ? 'spin' : ''} /> Thử lại
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => act(() => api.retry(task.id, true))}
              data-tooltip="Chuyển sang nền tảng kế tiếp trong danh sách ưu tiên"
            >
              <Zap size={14} /> Chuyển agent kế tiếp
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderDiffPane = () => (
    <div className="task-pane-right">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.925rem' }}>
          <FileCode2 size={15} /> Thay đổi mã nguồn
        </h3>

        {diff !== null && (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className="office-mini-btn"
              onClick={() => setDiffTab('diff')}
              style={{
                fontWeight: diffTab === 'diff' ? 700 : 500,
                background: diffTab === 'diff' ? 'var(--bg-subtle)' : 'var(--bg-surface)',
              }}
            >
              Nội dung Diff
            </button>
            {changedFileLines.length > 0 && (
              <button
                type="button"
                className="office-mini-btn"
                onClick={() => setDiffTab('files')}
                style={{
                  fontWeight: diffTab === 'files' ? 700 : 500,
                  background: diffTab === 'files' ? 'var(--bg-subtle)' : 'var(--bg-surface)',
                }}
              >
                Tệp ({changedFileLines.length})
              </button>
            )}
            {diff.commits.length > 0 && (
              <button
                type="button"
                className="office-mini-btn"
                onClick={() => setDiffTab('commits')}
                style={{
                  fontWeight: diffTab === 'commits' ? 700 : 500,
                  background: diffTab === 'commits' ? 'var(--bg-subtle)' : 'var(--bg-surface)',
                }}
              >
                <GitCommit size={11} /> Commits ({diff.commits.length})
              </button>
            )}
          </div>
        )}
      </div>

      {diff === null ? (
        <div style={{ padding: '2rem 1rem', background: 'var(--bg-canvas)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
          <SnakeLoader size="sm" inline label="Đang tải thay đổi git…" />
        </div>
      ) : (
        <div className="diff-container">
          {diffTab === 'commits' && diff.commits.length > 0 ? (
            <pre className="diff">
              {diff.commits.join('\n')}
            </pre>
          ) : diffTab === 'files' && diff.status !== '' ? (
            <pre className="diff">
              {diff.status}
            </pre>
          ) : (
            <pre className="diff">
              {diff.diff === '' ? '(Không có thay đổi mã nguồn chưa commit)' : diff.diff}
            </pre>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`panel task-view-panel ${inModal ? 'in-modal' : ''}`}>
      {/* Thanh xác nhận xóa task */}
      {confirmDelete && (
        <div
          style={{
            background: 'var(--red-light, #FEE2E2)',
            border: '1px solid var(--red-base)',
            borderRadius: 'var(--radius-md)',
            padding: '0.6rem 0.85rem',
            marginBottom: '0.65rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontSize: '0.85rem', color: 'var(--red-dark, #991B1B)', fontWeight: 600 }}>
            Bạn có chắc chắn muốn xóa vĩnh viễn Task #{task.seq} ("{task.title}") không?
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              type="button"
              className="danger-solid"
              disabled={busy}
              onClick={handleDeleteTask}
              style={{ height: '28px', minHeight: '28px', padding: '0 0.75rem', fontSize: '0.78rem' }}
            >
              Xác nhận xóa
            </button>
            <button
              type="button"
              className="office-mini-btn"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
              style={{ height: '28px', minHeight: '28px', padding: '0 0.75rem', fontSize: '0.78rem' }}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {/* Header gọn gàng kèm breadcrumb ngữ cảnh dự án */}
      <div className="task-header" style={{ marginBottom: '0.65rem', paddingBottom: '0.65rem' }}>
        {/* Breadcrumb dự án khi xem toàn trang */}
        {!inModal && (
          <div className="task-breadcrumb">
            <button
              type="button"
              className="icon-btn-sm"
              onClick={onBack}
              data-tooltip="Quay lại danh sách (Esc)"
              aria-label="Quay lại danh sách"
            >
              <ArrowLeft size={14} />
            </button>
            <div className="task-breadcrumb-trail">
              <button
                type="button"
                className="task-breadcrumb-link"
                onClick={() => {
                  if (onSelectProject && task.repoPath) onSelectProject(task.repoPath);
                  else onBack();
                }}
                data-tooltip={`Dự án: ${projectName || task.repoPath} — Bấm để mở Bảng Kanban của dự án này`}
              >
                <Building2 size={13} style={{ color: 'var(--primary, #2563EB)' }} />
                <span>{projectName || (task.repoPath ? task.repoPath.replace(/[\/\\]+$/, '').split(/[\/\\]/).pop() : 'Dự án')}</span>
              </button>
              <ChevronRight size={13} className="task-breadcrumb-sep" />
              <span className="task-breadcrumb-current">Task #{task.seq}</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
            {inModal && (
              <span className="badge info" style={{ flexShrink: 0 }}>🔍 Task #{task.seq}</span>
            )}
            <h2
              style={{
                fontSize: inModal ? '1.02rem' : '1.15rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                margin: 0,
              }}
            >
              {!inModal && <span className="mono text-muted">#{task.seq} </span>}
              {task.title}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
            {/* Nút Hoàn tất với màu xanh success đúng chuẩn ngữ nghĩa */}
            {task.status !== 'closed' && (
              <button
                type="button"
                className="success"
                disabled={busy}
                onClick={() => act(() => api.close(task.id))}
                style={{ height: '30px', minHeight: '30px', padding: '0 0.8rem', fontSize: '0.78rem', fontWeight: 600 }}
                data-tooltip="Nghiệm thu và đóng hoàn tất công việc này"
              >
                <CheckCircle2 size={13} /> <span>Hoàn tất</span>
              </button>
            )}

            {/* Nút Live Preview giao diện trực tiếp từ daemon voragent */}
            <a
              href={`/api/tasks/${task.id}/preview/index.html${typeof window !== 'undefined' ? window.location.search : ''}`}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-live-preview"
              data-tooltip="Mở Live Preview giao diện web (HTML) trực tiếp từ daemon voragent"
            >
              <Globe size={13} />
              <span>Live Preview</span>
            </a>

            <TaskStatusBadge status={task.status} />

            <button
              type="button"
              className="icon-btn-sm danger"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              data-tooltip="Xóa vĩnh viễn task này"
              aria-label="Xóa task"
            >
              <Trash2 size={13} />
            </button>

            {inModal && onMaximize && (
              <button
                type="button"
                className="icon-btn-sm"
                onClick={onMaximize}
                data-tooltip="Mở chi tiết Task toàn màn hình"
                aria-label="Mở toàn màn hình"
              >
                <Maximize2 size={13} />
              </button>
            )}
            {inModal && (
              <button
                type="button"
                className="icon-btn-sm"
                onClick={onBack}
                data-tooltip="Đóng cửa sổ (Esc)"
                aria-label="Đóng cửa sổ"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="task-meta-grid">
            <CopyableTag
              text={displayPath}
              label="Đường dẫn thư mục làm việc"
              icon={<Folder size={12} style={{ flexShrink: 0 }} />}
            />
            {task.branch && (
              <CopyableTag
                text={task.branch}
                label="Nhánh git cách ly"
                icon={<GitBranch size={12} style={{ flexShrink: 0 }} />}
              />
            )}
            {task.currentProvider && (
              <div className="task-meta-item">
                <ProviderIcon provider={task.currentProvider} size={13} />
                <span style={{ textTransform: 'capitalize' }}>{task.currentProvider}</span>
              </div>
            )}

            {(() => {
              const pKey = (task.currentProvider ?? 'antigravity').toLowerCase();
              const models = PROVIDER_MODELS[pKey] ?? [];
              if (models.length === 0) return null;
              const curModel = task.model || models.find((m) => m.default)?.id || models[0]?.id;
              const modelOpts: SelectOption[] = models.map((m) => ({
                value: m.id,
                label: m.name,
                sublabel: m.description,
                badge: m.default ? 'Mặc định' : undefined,
                badgeType: m.default ? 'info' : undefined,
              }));
              return (
                <div className="task-meta-item" style={{ minWidth: '150px', padding: '0 4px' }} data-tooltip="Mô hình AI thực thi (Bấm để đổi mô hình)">
                  <CustomSelect
                    options={modelOpts}
                    value={curModel || ''}
                    onChange={(newM) => {
                      void api.updateTaskModel(task.id, newM).then(() => {
                        window.location.reload();
                      });
                    }}
                    searchable={false}
                    icon={<Cpu size={12} style={{ color: 'var(--amber-base)' }} />}
                  />
                </div>
              );
            })()}

            <div className="task-meta-item">
              <TimeBadge timestamp={task.updatedAt || task.createdAt} />
            </div>
            {isUnisolated(task) && (
              <div className="badge warn">
                <AlertTriangle size={11} /> Không cách ly Git
              </div>
            )}
          </div>

          {/* Khi mở trong Modal, dùng Tab chuyển đổi mượt mà giữa Nhật ký trao đổi & Thay đổi mã nguồn */}
          {inModal && (
            <div className="projects-view-switcher" role="tablist" aria-label="Chế độ xem chi tiết Task">
              <button
                type="button"
                role="tab"
                aria-selected={modalPane === 'chat'}
                className={`office-mini-btn ${modalPane === 'chat' ? 'active' : ''}`}
                onClick={() => setModalPane('chat')}
                style={{
                  height: '26px',
                  minHeight: '26px',
                  padding: '0 10px',
                  background: modalPane === 'chat' ? 'var(--bg-surface)' : 'transparent',
                  borderColor: modalPane === 'chat' ? 'var(--border-subtle)' : 'transparent',
                  fontWeight: modalPane === 'chat' ? 700 : 500,
                }}
              >
                <MessagesSquare size={12} />
                <span>Nhật ký trao đổi ({displayItems.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={modalPane === 'diff'}
                className={`office-mini-btn ${modalPane === 'diff' ? 'active' : ''}`}
                onClick={() => setModalPane('diff')}
                style={{
                  height: '26px',
                  minHeight: '26px',
                  padding: '0 10px',
                  background: modalPane === 'diff' ? 'var(--bg-surface)' : 'transparent',
                  borderColor: modalPane === 'diff' ? 'var(--border-subtle)' : 'transparent',
                  fontWeight: modalPane === 'diff' ? 700 : 500,
                }}
              >
                <FileCode2 size={12} />
                <span>Thay đổi mã nguồn {diffBadgeCount > 0 ? `(${diffBadgeCount})` : ''}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {error !== null && (
        <div className="error" role="alert" style={{ marginBottom: '0.65rem', flexShrink: 0 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Trong Modal: Hiển thị theo Tab rộng rãi (100% chiều ngang). Toàn màn hình: Chia 2 cột cân đối */}
      {inModal ? (
        <div className="task-modal-body">
          {modalPane === 'chat' ? renderTranscriptPane() : renderDiffPane()}
        </div>
      ) : (
        <div className="task-split-layout">
          {renderTranscriptPane()}
          {renderDiffPane()}
        </div>
      )}
    </div>
  );
}
