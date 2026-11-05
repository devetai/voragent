import { useState } from 'react';
import { Bell, Crown, ExternalLink, FileCode2, Layers, Plus, PlusCircle, RotateCcw, Shuffle, Trash2, X } from 'lucide-react';
import type { ManagerMode, ManagerPlan, ManagerSubtask, ProviderState, Task, VEvent } from '@voragent/shared';
import { TASK_STATUS_LABEL } from '@voragent/shared';
import { api, errText } from './api';
import type { Diff } from './api';
import {
  getProviderUnavailableReason,
  isProviderAvailable,
  isProviderInstalledById,
  transcript,
} from './state';
import { CustomSelect, type SelectOption } from './components/CustomSelect';
import { ProviderIcon } from './components/ProviderIcon';
import { MarkdownContent } from './components/MarkdownContent';
import { ConfirmModal } from './components/ConfirmModal';

const AGENT_OPTIONS = [
  { id: 'claude', label: 'Claude Code (Kiến trúc & Logic)', defaultRole: 'Kiến trúc & Logic lõi' },
  { id: 'antigravity', label: 'Antigravity (Giao diện & Tương tác)', defaultRole: 'Giao diện & Tương tác' },
  { id: 'codex', label: 'Codex (Kiểm thử & Review)', defaultRole: 'Kiểm thử & Review' },
];

/** Trích xuất tin nhắn/báo cáo cuối cùng của Agent hoặc lỗi từ danh sách sự kiện của một Task. */
export function extractLatestSubagentReport(events: VEvent[] | undefined): {
  lastAgentMessage: string;
  lastError: string | null;
  isQuestion: boolean;
} {
  if (!events || events.length === 0) {
    return { lastAgentMessage: '', lastError: null, isQuestion: false };
  }
  const items = transcript(events);
  let lastAgentMessage = '';
  let lastError: string | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (!lastAgentMessage && it.kind === 'agent' && it.text.trim() !== '') {
      lastAgentMessage = it.text.trim();
    }
    if (!lastError && it.kind === 'error' && it.text.trim() !== '') {
      lastError = it.text.trim();
    }
  }
  const lower = lastAgentMessage.toLowerCase();
  const isQuestion =
    lastAgentMessage.includes('?') ||
    lower.includes('bạn muốn') ||
    lower.includes('xin cho biết') ||
    lower.includes('xác nhận') ||
    lower.includes('chọn phương án') ||
    lower.includes('vui lòng cho biết');

  return { lastAgentMessage, lastError, isQuestion };
}

type ManagerSubTab = 'inbox' | 'create' | 'plans';

export function ManagerPanel({
  repoPath,
  projectName,
  plans,
  tasks,
  eventsByTask,
  providers = [],
  onChanged,
  onSelectTask,
  onClose,
}: {
  repoPath: string | null;
  projectName: string;
  plans: ManagerPlan[];
  tasks: Task[];
  eventsByTask?: Map<string, VEvent[]>;
  providers?: ProviderState[];
  onChanged: () => void;
  onSelectTask?: (taskId: string) => void;
  onClose?: () => void;
}) {
  const draftPlans = plans.filter((p) => p.status === 'draft');
  const awaitingTasks = tasks.filter((t) => t.status === 'awaiting_user');
  const failedTasks = tasks.filter((t) => t.status === 'failed');
  const totalActionNeeded = draftPlans.length + awaitingTasks.length + failedTasks.length;

  const [subTab, setSubTab] = useState<ManagerSubTab>(() =>
    totalActionNeeded > 0 ? 'inbox' : plans.length > 0 ? 'plans' : 'create'
  );
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<ManagerMode>('semi-auto');
  const [submitting, setSubmitting] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [planToDelete, setPlanToDelete] = useState<ManagerPlan | null>(null);
  const [draftGoals, setDraftGoals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [editedSubtasks, setEditedSubtasks] = useState<Record<string, ManagerSubtask[]>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, Diff | null>>({});
  const [loadingDiffId, setLoadingDiffId] = useState<string | null>(null);

  // Chỉ giữ các nhân sự ĐÃ CÀI ĐẶT CLI trong danh sách phân công của Trưởng phòng
  const installedList = AGENT_OPTIONS.filter((a) => isProviderInstalledById(providers, a.id));
  const availableList = installedList.filter((a) => isProviderAvailable(providers, a.id));
  const firstAvailableProvider = availableList[0]?.id ?? installedList[0]?.id ?? 'claude';

  // Danh sách SelectOption cho CustomSelect phân công Subtask:
  // - Ẩn hoàn toàn các CLI chưa cài đặt (như Codex khi chưa cài)
  // - Nếu đã cài nhưng đang tạm nghỉ Quota / cạn Quota thì khóa `disabled: true` để không thể chọn
  const subtaskProviderOptions: SelectOption[] = installedList.map((opt) => {
    const unavailReason = getProviderUnavailableReason(providers, opt.id);
    return {
      value: opt.id,
      label: opt.label,
      icon: <ProviderIcon provider={opt.id} size={14} />,
      ...(unavailReason
        ? { badge: unavailReason, badgeType: 'warn' as const, disabled: true }
        : {}),
    };
  });

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath) {
      setError('Vui lòng chọn một Văn phòng Dự án trước khi giao mục tiêu cho Trưởng phòng.');
      return;
    }
    if (!goal.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createManagerPlan({
        repoPath,
        goal: goal.trim(),
        mode,
      });
      setGoal('');
      onChanged();
      setSubTab(mode === 'semi-auto' ? 'inbox' : 'plans');
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const getSubtasksForPlan = (plan: ManagerPlan): ManagerSubtask[] => {
    const raw = editedSubtasks[plan.id] ?? plan.subtasks;
    return raw.map((s) =>
      isProviderAvailable(providers, s.assignedProvider)
        ? s
        : { ...s, assignedProvider: firstAvailableProvider }
    );
  };

  const updateDraftSubtask = (plan: ManagerPlan, idx: number, patch: Partial<ManagerSubtask>) => {
    if (patch.assignedProvider && !isProviderAvailable(providers, patch.assignedProvider)) {
      return;
    }
    const current = [...getSubtasksForPlan(plan)];
    const target = current[idx];
    if (!target) return;
    current[idx] = { ...target, ...patch };
    setEditedSubtasks((prev) => ({ ...prev, [plan.id]: current }));
  };

  
  const handleConfirmDeletePlan = async () => {
    if (!planToDelete) return;
    const planId = planToDelete.id;
    setDeletingPlanId(planId);
    setError(null);
    try {
      await api.deleteManagerPlan(planId);
      setPlanToDelete(null);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setDeletingPlanId(null);
    }
  };

  const handleDeleteSubtask = (plan: ManagerPlan, idx: number) => {
    const current = [...getSubtasksForPlan(plan)];
    if (current.length <= 1) return;
    current.splice(idx, 1);
    setEditedSubtasks((prev) => ({ ...prev, [plan.id]: current }));
  };

  const handleAddSubtask = (plan: ManagerPlan) => {
    const current = [...getSubtasksForPlan(plan)];
    const fallbackProv = firstAvailableProvider;
    const preset = AGENT_OPTIONS.find((a) => a.id === fallbackProv);
    current.push({
      id: Math.random().toString(36).slice(2),
      title: `[Nhiệm vụ mới] ${(draftGoals[plan.id] || plan.goal).slice(0, 30)}`,
      message: `Nhiệm vụ bổ sung cho mục tiêu: ${draftGoals[plan.id] || plan.goal}`,
      assignedProvider: fallbackProv,
      role: preset?.defaultRole ?? 'Nhiệm vụ bổ sung',
      taskId: null,
    });
    setEditedSubtasks((prev) => ({ ...prev, [plan.id]: current }));
  };

  const handleDispatch = async (plan: ManagerPlan) => {
    setDispatchingId(plan.id);
    setError(null);
    try {
      const editedGoal = (draftGoals[plan.id] || plan.goal).trim();
      if (editedGoal && editedGoal !== plan.goal) {
        await api.updateManagerPlan(plan.id, { goal: editedGoal }).catch(() => undefined);
      }
      const subs = getSubtasksForPlan(plan);
      await api.dispatchManagerPlan(plan.id, subs);
      onChanged();
      setSubTab('plans');
    } catch (err) {
      setError(errText(err));
    } finally {
      setDispatchingId(null);
    }
  };

  const handleInlineReply = async (taskId: string) => {
    const msg = (replies[taskId] ?? '').trim();
    if (!msg) return;
    setBusyTaskId(taskId);
    setError(null);
    try {
      await api.send(taskId, msg);
      setReplies((prev) => ({ ...prev, [taskId]: '' }));
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleApproveAndClose = async (task: Task, summaryText: string) => {
    setBusyTaskId(task.id);
    setError(null);
    try {
      if (summaryText.trim() !== '') {
        await api.saveMemory({
          id: `approved-task-${task.id}`,
          repoPath: task.repoPath,
          category: 'decision',
          title: `Đã nghiệm thu #${task.seq}: ${task.title.slice(0, 42)}`,
          content: summaryText.slice(0, 280),
          author: 'manager',
          pinned: true,
        }).catch(() => undefined);
      }
      await api.close(task.id);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleRetryTask = async (taskId: string, switchProvider: boolean) => {
    setBusyTaskId(taskId);
    setError(null);
    try {
      await api.retry(taskId, switchProvider);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleToggleDiff = async (taskId: string) => {
    if (diffs[taskId] !== undefined) {
      setDiffs((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      return;
    }
    setLoadingDiffId(taskId);
    try {
      const d = await api.diff(taskId);
      setDiffs((prev) => ({ ...prev, [taskId]: d }));
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoadingDiffId(null);
    }
  };

  const handleApproveAllInPlan = async (plan: ManagerPlan) => {
    setDispatchingId(plan.id);
    setError(null);
    try {
      for (const sub of plan.subtasks) {
        if (!sub.taskId) continue;
        const t = tasks.find((x) => x.id === sub.taskId);
        if (t && t.status === 'awaiting_user') {
          await api.close(t.id);
        }
      }
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setDispatchingId(null);
    }
  };

  return (
    <div className="office-side-panel">
      <div className="office-side-header">
        <div>
          <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Crown size={17} color="#6D28D9" /> Bàn Trưởng Phòng ({projectName || 'Tất cả dự án'})
          </h3>
          <div className="muted" style={{ fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>Nhân sự khả dụng:</span>
            {availableList.map((a) => (
              <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: 'var(--text-primary)' }}>
                <ProviderIcon provider={a.id} size={12} /> {a.id.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-btn-sm"
            onClick={onClose}
            title="Đóng cửa sổ (Esc)"
            aria-label="Đóng cửa sổ"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Thanh chuyển 3 chế độ con trong Bàn Trưởng Phòng (Progressive Disclosure: chỉ hiện 1 thứ mỗi lúc) */}
      <div className="view-tabs" style={{ marginBottom: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
        <button
          type="button"
          className={`view-tab ${subTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setSubTab('inbox')}
        >
          <Bell size={14} /> Cần bạn duyệt / Trả lời
          {totalActionNeeded > 0 && (
            <span className="badge warn" style={{ padding: '0 6px', fontSize: '11px' }}>{totalActionNeeded}</span>
          )}
        </button>
        <button
          type="button"
          className={`view-tab ${subTab === 'create' ? 'active' : ''}`}
          onClick={() => setSubTab('create')}
        >
          <PlusCircle size={14} /> Giao mục tiêu mới
        </button>
        <button
          type="button"
          className={`view-tab ${subTab === 'plans' ? 'active' : ''}`}
          onClick={() => setSubTab('plans')}
        >
          <Layers size={14} /> Kế hoạch đã giao ({plans.length})
        </button>
      </div>

      {error && <div className="error" role="alert" style={{ margin: '8px 0' }}>{error}</div>}

      {/* =====================================================================
          TAB 1: HỘP THƯ BÁO CÁO & CẦN SẾP QUYẾT ĐỊNH (MANAGER INBOX)
         ===================================================================== */}
      {subTab === 'inbox' && (
        <div className="office-side-scroll">
          {totalActionNeeded === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', background: 'var(--bg-canvas)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                ✨ Không có câu hỏi hay báo cáo nào đang chờ bạn duyệt
              </div>
              <p className="muted" style={{ fontSize: '12.5px', marginBottom: '12px' }}>
                Khi Sub-agent hoàn thành nhiệm vụ hoặc có câu hỏi, Trưởng phòng sẽ gom về đây để bạn trả lời hoặc nghiệm thu tại một chỗ duy nhất.
              </p>
              <button type="button" className="primary" onClick={() => setSubTab('create')}>
                <PlusCircle size={14} /> Giao mục tiêu mới cho Trưởng phòng
              </button>
            </div>
          ) : (
            <>
              {/* 1A. Các kế hoạch nháp chờ bạn duyệt phân công */}
              {draftPlans.map((plan) => {
                const subs = getSubtasksForPlan(plan);
                const currentGoal = draftGoals[plan.id] ?? plan.goal;
                return (
                  <div key={plan.id} className="office-plan-card draft">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '240px' }}>
                        <span className="badge warn" style={{ flexShrink: 0 }}>📝 Kế hoạch chờ duyệt</span>
                        <input
                          type="text"
                          value={currentGoal}
                          onChange={(e) => setDraftGoals((prev) => ({ ...prev, [plan.id]: e.target.value }))}
                          placeholder="Mục tiêu kế hoạch..."
                          title="Bấm để chỉnh sửa mục tiêu chung của kế hoạch"
                          style={{
                            flex: 1,
                            fontWeight: 700,
                            fontSize: '13.5px',
                            padding: '4px 8px',
                            height: '32px',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            background: 'var(--bg-surface)',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          className="office-mini-btn danger"
                          style={{ fontSize: '12px', height: '32px', padding: '0 10px' }}
                          disabled={deletingPlanId === plan.id || dispatchingId === plan.id}
                          onClick={() => setPlanToDelete(plan)}
                          title="Hủy và xóa vĩnh viễn kế hoạch nháp này"
                        >
                          <Trash2 size={13} />
                          <span>{deletingPlanId === plan.id ? 'Đang hủy…' : 'Hủy kế hoạch'}</span>
                        </button>
                        <button
                          type="button"
                          className="primary"
                          style={{ fontSize: '12px', height: '32px', padding: '0 14px' }}
                          disabled={dispatchingId === plan.id || deletingPlanId === plan.id}
                          onClick={() => { void handleDispatch(plan); }}
                        >
                          {dispatchingId === plan.id ? 'Đang phát lệnh…' : '🚀 Duyệt & Giao việc ngay'}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                      {subs.map((sub, idx) => (
                        <div key={sub.id} className="office-subtask-item">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              value={sub.title}
                              onChange={(e) => updateDraftSubtask(plan, idx, { title: e.target.value })}
                              style={{ flex: 1, minWidth: '180px', fontWeight: 600, fontSize: '12.5px', padding: '4px 8px', height: '34px' }}
                            />
                            <div style={{ width: '240px', flexShrink: 0 }}>
                              <CustomSelect
                                options={subtaskProviderOptions}
                                value={sub.assignedProvider}
                                onChange={(picked) => {
                                  if (!isProviderAvailable(providers, picked)) return;
                                  const preset = AGENT_OPTIONS.find((a) => a.id === picked);
                                  updateDraftSubtask(plan, idx, {
                                    assignedProvider: picked,
                                    ...(preset ? { role: preset.defaultRole } : {}),
                                  });
                                }}
                                searchable={false}
                              />
                            </div>
                            {subs.length > 1 && (
                              <button
                                type="button"
                                className="icon-btn-sm danger"
                                onClick={() => handleDeleteSubtask(plan, idx)}
                                title="Xóa nhiệm vụ này khỏi kế hoạch"
                                aria-label="Xóa nhiệm vụ"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* Nút thêm nhiệm vụ mới vào kế hoạch */}
                      <button
                        type="button"
                        className="office-mini-btn"
                        style={{ alignSelf: 'flex-start', marginTop: '4px', fontSize: '12px', height: '28px', padding: '0 10px' }}
                        onClick={() => handleAddSubtask(plan)}
                      >
                        <Plus size={13} />
                        <span>Thêm nhiệm vụ</span>
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* 1B. Các Sub-agent báo cáo hoàn thành hoặc hỏi ý kiến */}
              {awaitingTasks.map((task) => {
                const evs = eventsByTask?.get(task.id);
                const { lastAgentMessage, isQuestion } = extractLatestSubagentReport(evs);
                const runnerId = task.currentProvider ?? task.priority?.[0] ?? 'claude';
                const runner = runnerId.toUpperCase();
                const isBusy = busyTaskId === task.id;
                const taskDiff = diffs[task.id];

                return (
                  <div
                    key={task.id}
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      backgroundColor: isQuestion ? '#FFFBEB' : '#F0FDF4',
                      border: isQuestion ? '1px solid #FCD34D' : '1px solid #A7F3D0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span className={`badge ${isQuestion ? 'warn' : 'success'}`}>
                          <ProviderIcon provider={runnerId} size={11} />
                          <span>{isQuestion ? `${runner} hỏi ý kiến` : `${runner} báo cáo xong`}</span>
                        </span>
                        <strong style={{ fontSize: '13.5px' }}>#{task.seq} {task.title}</strong>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="icon-btn-sm"
                          onClick={() => { void handleToggleDiff(task.id); }}
                          title={taskDiff !== undefined ? 'Ẩn thay đổi mã nguồn (Diff)' : 'Xem thay đổi mã nguồn (Diff)'}
                          aria-label="Xem hoặc ẩn Diff"
                        >
                          <FileCode2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn-sm"
                          onClick={() => onSelectTask?.(task.id)}
                          title="Mở chi tiết Task & Nhật ký"
                          aria-label="Mở chi tiết Task"
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: '8px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '12.5px',
                      }}
                    >
                      {lastAgentMessage ? (
                        <MarkdownContent content={lastAgentMessage} compact />
                      ) : (
                        <span className="muted">(Sub-agent đã hoàn thành lượt chạy. Bấm biểu tượng Diff để kiểm tra các file đã sửa.)</span>
                      )}
                    </div>

                    {loadingDiffId === task.id && (
                      <div className="muted" style={{ marginTop: '6px', fontSize: '12px' }}>Đang tải thay đổi mã nguồn…</div>
                    )}

                    {taskDiff !== undefined && taskDiff !== null && (
                      <div style={{ marginTop: '8px' }}>
                        <pre className="diff" style={{ fontSize: '11.5px', whiteSpace: 'pre-wrap' }}>
                          {taskDiff.commits.length > 0 ? `Commits:\n${taskDiff.commits.join('\n')}\n\n` : ''}
                          {taskDiff.status ? `Files:\n${taskDiff.status}\n\n` : ''}
                          {taskDiff.diff || '(Không có thay đổi chưa commit)'}
                        </pre>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={replies[task.id] ?? ''}
                        onChange={(e) => setReplies((prev) => ({ ...prev, [task.id]: e.target.value }))}
                        placeholder={`Trả lời hoặc giao chỉnh sửa tiếp cho ${runner}...`}
                        style={{ flex: 1, minWidth: '180px', fontSize: '12.5px', height: '34px' }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleInlineReply(task.id);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={isBusy || !(replies[task.id] ?? '').trim()}
                        style={{ fontSize: '12px', height: '34px', minHeight: '34px' }}
                        onClick={() => { void handleInlineReply(task.id); }}
                      >
                        Gửi trả lời
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        style={{
                          fontSize: '12px',
                          height: '34px',
                          minHeight: '34px',
                          backgroundColor: '#059669',
                          color: '#FFFFFF',
                          borderColor: '#059669',
                          fontWeight: 600,
                        }}
                        onClick={() => { void handleApproveAndClose(task, lastAgentMessage); }}
                        title="Nghiệm thu kết quả và lưu quyết định vào Shared Memory"
                      >
                        ✓ Nghiệm thu
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* 1C. Các Sub-agent gặp lỗi */}
              {failedTasks.map((task) => {
                const evs = eventsByTask?.get(task.id);
                const { lastError } = extractLatestSubagentReport(evs);
                const runnerId = task.currentProvider ?? task.priority?.[0] ?? 'claude';
                const runner = runnerId.toUpperCase();
                const isBusy = busyTaskId === task.id;
                const canSwitchProvider = availableList.some((a) => a.id !== runnerId.toLowerCase());

                return (
                  <div
                    key={task.id}
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FCA5A5',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span className="badge warn">
                          <ProviderIcon provider={runnerId} size={11} />
                          <span>⚠️ {runner} báo lỗi</span>
                        </span>
                        <strong style={{ fontSize: '13.5px' }}>#{task.seq} {task.title}</strong>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="icon-btn-sm"
                          disabled={isBusy}
                          onClick={() => { void handleRetryTask(task.id, false); }}
                          title="Thử lại trên nền tảng hiện tại"
                          aria-label="Thử lại"
                        >
                          <RotateCcw size={13} />
                        </button>
                        {canSwitchProvider && (
                          <button
                            type="button"
                            className="icon-btn-sm"
                            disabled={isBusy}
                            onClick={() => { void handleRetryTask(task.id, true); }}
                            title="Đổi nhân viên khả dụng khác tiếp quản"
                            aria-label="Đổi nhân viên khác"
                          >
                            <Shuffle size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn-sm"
                          onClick={() => { void handleApproveAndClose(task, ''); }}
                          title="Đóng công việc lỗi này"
                          aria-label="Đóng công việc"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                    {lastError && (
                      <div style={{ marginTop: '6px', fontSize: '12px', color: '#991B1B' }}>
                        <MarkdownContent content={lastError} compact />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 2: GIAO MỤC TIÊU MỚI CHO TRƯỞNG PHÒNG
         ===================================================================== */}
      {subTab === 'create' && (
        <div>
          {!repoPath ? (
            <div className="notice">
              Hãy chọn một dự án ở thanh trên cùng hoặc Đại sảnh trước khi giao mục tiêu cho Trưởng phòng.
            </div>
          ) : (
            <form onSubmit={(e) => { void handleCreatePlan(e); }} className="office-manager-form" style={{ marginTop: 0 }}>
              <label className="form-label" style={{ marginBottom: '6px' }}>
                🎯 Mục tiêu bạn muốn giao cho Trưởng phòng ({projectName})
              </label>
              <textarea
                rows={4}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="VD: Thiết kế giao diện bảng giá chứng khoán thời gian thực và viết bộ unit test..."
                required
                autoFocus
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '12.5px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="mgrMode"
                      checked={mode === 'semi-auto'}
                      onChange={() => setMode('semi-auto')}
                    />
                    <span><strong>Bán tự động</strong> (Duyệt bảng phân công trước khi chạy)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="mgrMode"
                      checked={mode === 'auto'}
                      onChange={() => setMode('auto')}
                    />
                    <span><strong>Tự động</strong> (Chia việc & chạy ngay)</span>
                  </label>
                </div>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? 'Đang phân tích…' : mode === 'auto' ? '⚡ Chia việc & Chạy ngay' : '📋 Lên kế hoạch chia việc'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 3: TIẾN ĐỘ CÁC KẾ HOẠCH ĐÃ GIAO
         ===================================================================== */}
      {subTab === 'plans' && (
        <div className="office-side-scroll">
          {plans.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: '24px 12px', background: 'var(--bg-subtle)', borderRadius: '8px' }}>
              Chưa có kế hoạch nào được tạo trong văn phòng này.
            </div>
          ) : (
                        plans.map((plan) => {
              const subs = getSubtasksForPlan(plan);
              const isDraft = plan.status === 'draft';
              const linkedTasks = subs.map((s) => (s.taskId ? tasks.find((t) => t.id === s.taskId) : undefined));
              const doneCount = linkedTasks.filter((t) => t?.status === 'closed').length;
              const waitingReviewCount = linkedTasks.filter((t) => t?.status === 'awaiting_user').length;
              const allDone = !isDraft && subs.length > 0 && doneCount === subs.length;

              return (
                <div key={plan.id} className={`office-plan-card ${isDraft ? 'draft' : 'dispatched'}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <span className={`badge ${isDraft ? 'warn' : allDone ? 'success' : 'info'}`} style={{ marginRight: '6px' }}>
                        {isDraft
                          ? '📝 Bản nháp'
                          : allDone
                          ? `🎉 Hoàn tất (${doneCount}/${subs.length})`
                          : `👑 Tiến độ ${doneCount}/${subs.length} hoàn tất`}
                      </span>
                      <strong style={{ fontSize: '13.5px' }}>{plan.goal}</strong>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        className="icon-btn-sm danger"
                        disabled={deletingPlanId === plan.id}
                        onClick={() => setPlanToDelete(plan)}
                        title="Xóa kế hoạch này"
                        aria-label="Xóa kế hoạch"
                      >
                        <Trash2 size={13} />
                      </button>

                      {!isDraft && waitingReviewCount > 0 && (
                        <button
                          type="button"
                          className="primary"
                          style={{ fontSize: '11.5px', height: '28px', minHeight: '28px', backgroundColor: '#059669', borderColor: '#059669' }}
                          disabled={dispatchingId === plan.id}
                          onClick={() => { void handleApproveAllInPlan(plan); }}
                        >
                          ✓ Nghiệm thu tất cả ({waitingReviewCount})
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                    {subs.map((sub) => {
                      const linkedTask = sub.taskId ? tasks.find((t) => t.id === sub.taskId) : undefined;
                      const actualRunner = linkedTask?.currentProvider ?? sub.assignedProvider;
                      return (
                        <div key={sub.id} className="office-subtask-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: 500 }}>{sub.title}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <span className="badge neutral">
                              <ProviderIcon provider={actualRunner} size={11} />
                              <span>{actualRunner.toUpperCase()}</span>
                            </span>
                            {linkedTask && (
                              <button
                                type="button"
                                style={{ fontSize: '11px', height: '24px', minHeight: '24px', padding: '0 8px' }}
                                onClick={() => onSelectTask?.(linkedTask.id)}
                                title="Bấm để mở chi tiết Task"
                              >
                                #{linkedTask.seq} {TASK_STATUS_LABEL[linkedTask.status]}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
      <ConfirmModal
        isOpen={planToDelete !== null}
        title="Hủy kế hoạch Trưởng phòng?"
        message={
          planToDelete ? (
            <span>
              Bạn có chắc chắn muốn hủy và xóa kế hoạch <strong>"{planToDelete.goal}"</strong> không? Toàn bộ danh sách nhiệm vụ dự thảo sẽ bị hủy bỏ.
            </span>
          ) : ''
        }
        confirmText="Xác nhận hủy & xóa"
        cancelText="Giữ lại"
        confirmVariant="danger"
        isLoading={deletingPlanId !== null}
        onConfirm={handleConfirmDeletePlan}
        onCancel={() => setPlanToDelete(null)}
      />
    </div>
  );
}
