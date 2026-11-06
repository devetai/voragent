import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { ManagerPlan, MemoryItem, ProviderState, Task, VEvent } from '@voragent/shared';
import { TASK_STATUS_LABEL } from '@voragent/shared';
import { api, errText } from '../api';
import { ProviderIcon } from '../components/ProviderIcon';
import { isProviderAvailable } from '../state';
import { DESK_COORDINATES, MANAGER_DESK_COORDINATE, OfficeRoom } from './OfficeRoom';
import {
  IDLE_SIGNAL,
  deriveSignal,
  detectClosure,
  detectHandoff,
  recentActivity,
  type ActivityItem,
  type ClosureInfo,
  type HandoffInfo,
} from './liveSignal';
import { LOUNGE_COORDINATES } from './SnakeAnimation';
import { SnakeMesh } from './SnakeMesh';
import { DEFAULT_THEME, type OfficeAgentData, PROVIDER_THEMES } from './types';

const EMPTY_ACTIVITY: ActivityItem[] = [];

/** Tìm sự kiện bàn giao gần đây nhất giữa hai Agent để tạo hoạt cảnh chuyển giao. */
function findRecentHandoff(
  tasks: Task[],
  eventsByTask: Map<string, VEvent[]> | undefined,
  now: number,
  windowMs = 25_000,
): { info: HandoffInfo; task: Task } | null {
  if (!eventsByTask) return null;
  let bestInfo: HandoffInfo | null = null;
  let bestTask: Task | null = null;

  for (const task of tasks) {
    const events = eventsByTask.get(task.id);
    const info = detectHandoff(events, { windowMs, now });
    if (info && (bestInfo === null || info.ts > bestInfo.ts)) {
      bestInfo = info;
      bestTask = task;
    }
  }

  return bestInfo && bestTask ? { info: bestInfo, task: bestTask } : null;
}

/** Tìm sự kiện hoàn tất task gần đây nhất để hiển thị hiệu ứng ăn mừng. */
function findRecentClosure(
  tasks: Task[],
  eventsByTask: Map<string, VEvent[]> | undefined,
  now: number,
  windowMs = 15_000,
): { info: ClosureInfo; task: Task } | null {
  if (!eventsByTask) return null;
  let bestInfo: ClosureInfo | null = null;
  let bestTask: Task | null = null;

  for (const task of tasks) {
    const events = eventsByTask.get(task.id);
    const info = detectClosure(events, { windowMs, now });
    if (info && (bestInfo === null || info.ts > bestInfo.ts)) {
      bestInfo = info;
      bestTask = task;
    }
  }

  return bestInfo && bestTask ? { info: bestInfo, task: bestTask } : null;
}

/** Nhãn hạn mức ngắn gọn của một CLI, dùng cho thẻ hover và HUD. */function quotaTextOf(p: ProviderState | undefined, now: number): string | undefined {
  if (!p) return undefined;
  if ((p.cooldownUntil ?? 0) > now) {
    const d = new Date(p.cooldownUntil as number);
    const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `Nghỉ đến ${at}`;
  }
  if (typeof p.usedPercent === 'number') {
    const percent = Math.round(Math.max(0, Math.min(1, p.usedPercent)) * 100);
    return percent > 0 ? `Quota ${percent}%` : undefined;
  }
  return undefined;
}

/** So sánh hai agent theo đúng các trường hiển thị; tín hiệu so theo khoá đã throttle. */
function sameAgent(a: OfficeAgentData, b: OfficeAgentData): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.provider === b.provider &&
    a.role === b.role &&
    a.isManager === b.isManager &&
    a.baseColor === b.baseColor &&
    a.bandColor === b.bandColor &&
    a.accessory === b.accessory &&
    a.deskIndex === b.deskIndex &&
    a.state === b.state &&
    a.expression === b.expression &&
    a.actionTag === b.actionTag &&
    a.isOnline === b.isOnline &&
    a.currentTask?.id === b.currentTask?.id &&
    a.currentTask?.seq === b.currentTask?.seq &&
    a.currentTask?.status === b.currentTask?.status &&
    a.signal.key === b.signal.key &&
    a.modelText === b.modelText &&
    a.quotaText === b.quotaText &&
    a.quotaPercent === b.quotaPercent
  );
}

/**
 * Giữ nguyên tham chiếu của agent không đổi để `React.memo` trong `SnakeMesh` chặn được
 * hàng trăm lần render mỗi giây do token văn bản đổ về.
 */
function useStableAgents(next: OfficeAgentData[]): OfficeAgentData[] {
  const cache = useRef<OfficeAgentData[]>([]);
  const prev = cache.current;
  const merged: OfficeAgentData[] = [];
  let changed = prev.length !== next.length;

  for (let i = 0; i < next.length; i++) {
    const fresh = next[i] as OfficeAgentData;
    const old = prev[i];
    if (old !== undefined && sameAgent(old, fresh)) {
      merged.push(old);
    } else {
      merged.push(fresh);
      changed = true;
    }
  }

  if (!changed) return prev;
  cache.current = merged;
  return merged;
}

/** Như `useStableAgents` cho một agent duy nhất (Trưởng phòng). */
function useStableAgent(next: OfficeAgentData): OfficeAgentData {
  const cache = useRef<OfficeAgentData>(next);
  if (!sameAgent(cache.current, next)) cache.current = next;
  return cache.current;
}

/** Tín hiệu sống của Trưởng phòng: phản chiếu sự kiện mới nhất trong các task đang hoạt động. */
function managerSignalOf(eventsByTask: Map<string, VEvent[]> | undefined, activeTaskIds: Set<string>) {
  if (!eventsByTask) return IDLE_SIGNAL;
  let winnerId: string | null = null;
  let winnerTs = -1;
  for (const taskId of activeTaskIds) {
    const events = eventsByTask.get(taskId);
    const last = events?.[events.length - 1];
    if (last !== undefined && last.ts > winnerTs) {
      winnerTs = last.ts;
      winnerId = taskId;
    }
  }
  if (winnerId === null) return IDLE_SIGNAL;
  const signal = deriveSignal(eventsByTask.get(winnerId));
  return signal.kind === 'done' ? IDLE_SIGNAL : signal;
}

export function OfficeCanvas({
  repoPath,
  projectName,
  tasks,
  providers,
  eventsByTask,
  memories = [],
  plans = [],
  onSelectTask,
  onOpenManager,
  onOpenMemory,
  onReload,
}: {
  repoPath?: string | null;
  projectName?: string;
  tasks: Task[];
  providers: ProviderState[];
  /** Dòng sự kiện theo task, dùng để suy ra tín hiệu sống cho từng nhân vật. */
  eventsByTask?: Map<string, VEvent[]>;
  memories?: MemoryItem[];
  plans?: ManagerPlan[];
  onSelectTask?: (taskId: string) => void;
  onOpenManager?: () => void;
  onOpenMemory?: (defaultAuthor?: string) => void;
  onReload?: () => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isTabVisible, setIsTabVisible] = useState(true);

  const [quickMsg, setQuickMsg] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const queuedTasks = useMemo(() => {
    return tasks.filter((t) => t.status === 'queued');
  }, [tasks]);

  /** Bảng tin TV: gom vài sự kiện mới nhất của mọi task, bỏ qua token chữ để khỏi ngập. */
  const activity = useMemo<ActivityItem[]>(() => {
    if (!eventsByTask || eventsByTask.size === 0) return EMPTY_ACTIVITY;
    const items: ActivityItem[] = [];
    for (const events of eventsByTask.values()) {
      if (events.length === 0) continue;
      const tail = events.length > 8 ? events.slice(-8) : events;
      items.push(...recentActivity(tail, 3));
    }
    if (items.length === 0) return EMPTY_ACTIVITY;
    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, 6);
  }, [eventsByTask]);

  const computedWorkers = useMemo<OfficeAgentData[]>(() => {
    const knownProviders = ['claude', 'codex', 'antigravity', 'opencode'];

    return knownProviders.map((key, deskIdx) => {
      const theme = PROVIDER_THEMES[key] ?? DEFAULT_THEME;
      const provState = providers.find((p) => p.id.toLowerCase().includes(key));
      const isInstalled = provState ? provState.installed : true;

      if (!isInstalled) {
        return {
          id: `agent-${key}`,
          name: theme.name,
          provider: key,
          role: 'Chưa cài CLI',
          isManager: false,
          baseColor: theme.base,
          bandColor: theme.band,
          accessory: theme.accessory,
          deskIndex: deskIdx,
          state: 'idle',
          expression: 'sleep',
          currentTask: undefined,
          actionTag: '🔌 Chưa cài CLI · Đang nghỉ',
          isOnline: false,
          signal: IDLE_SIGNAL,
        };
      }

      const activeTask = tasks.find(
        (t) => (t.currentProvider || '').toLowerCase().includes(key) && t.status === 'running'
      );
      const awaitingUserTask = tasks.find(
        (t) => (t.currentProvider || '').toLowerCase().includes(key) && t.status === 'awaiting_user'
      );
      const waitingTask = tasks.find(
        (t) => (t.currentProvider || '').toLowerCase().includes(key) && t.status === 'waiting_quota'
      );
      const queuedForAgent = tasks.find(
        (t) => t.status === 'queued' && (t.priority?.[0] || '').toLowerCase().includes(key)
      );
      const failedTask = tasks.find(
        (t) => (t.currentProvider || '').toLowerCase().includes(key) && t.status === 'failed'
      );

      const now = Date.now();
      const recentHandoff = findRecentHandoff(tasks, eventsByTask, now, 25_000);
      const isHandoffFrom =
        recentHandoff !== null &&
        (recentHandoff.info.from.toLowerCase().includes(key) ||
          (key === 'claude' && recentHandoff.info.from.toLowerCase().includes('claude')) ||
          (key === 'codex' && recentHandoff.info.from.toLowerCase().includes('codex')) ||
          (key === 'antigravity' && (recentHandoff.info.from.toLowerCase().includes('antigravity') || recentHandoff.info.from.toLowerCase().includes('agy'))));
      const isHandoffTo =
        recentHandoff !== null &&
        (recentHandoff.info.to.toLowerCase().includes(key) ||
          (key === 'claude' && recentHandoff.info.to.toLowerCase().includes('claude')) ||
          (key === 'codex' && recentHandoff.info.to.toLowerCase().includes('codex')) ||
          (key === 'antigravity' && (recentHandoff.info.to.toLowerCase().includes('antigravity') || recentHandoff.info.to.toLowerCase().includes('agy'))));

      const recentClosure = findRecentClosure(tasks, eventsByTask, now, 15_000);
      const isRecentlyClosed =
        recentClosure !== null &&
        (recentClosure.task.currentProvider || '').toLowerCase().includes(key);

      let state: OfficeAgentData['state'] = 'idle';
      let expression: OfficeAgentData['expression'] = 'sleep';
      let actionTag = '💤 Sẵn sàng · Bấm để giao việc';
      const targetTask = activeTask || awaitingUserTask || waitingTask || queuedForAgent || failedTask || (isHandoffFrom ? recentHandoff?.task : undefined) || (isRecentlyClosed ? recentClosure?.task : undefined);
      const signal = targetTask ? deriveSignal(eventsByTask?.get(targetTask.id)) : IDLE_SIGNAL;
      const quotaText = quotaTextOf(provState, now);

      const isCooldown = (provState?.cooldownUntil ?? 0) > now;

      if (activeTask) {
        state = 'working';
        expression = 'focus';
        actionTag = `⚡ Đang làm #${activeTask.seq}`;
        if (signal.kind === 'error') {
          expression = 'sad';
        } else if (signal.kind === 'done') {
          expression = 'happy';
        } else if (signal.kind === 'quota') {
          expression = 'dizzy';
        } else if (signal.kind === 'handoff') {
          state = 'handoff';
          expression = 'dizzy';
        }
      } else if (isHandoffFrom) {
        state = 'handoff';
        expression = 'dizzy';
        actionTag = `📦 Bàn giao → ${recentHandoff.info.to} (#${recentHandoff.task.seq})`;
      } else if (isHandoffTo && targetTask) {
        state = 'working';
        expression = 'focus';
        actionTag = `⚡ Nhận bàn giao #${targetTask.seq} từ ${recentHandoff.info.from}`;
      } else if (isRecentlyClosed && !awaitingUserTask) {
        state = 'working';
        expression = 'happy';
        actionTag = `🎉 Nghiệm thu xong #${recentClosure.task.seq}!`;
      } else if (awaitingUserTask) {
        state = 'waiting';
        expression = 'plead';
        actionTag = `✋ Chờ bạn #${awaitingUserTask.seq}`;
      } else if (waitingTask) {
        state = 'waiting';
        expression = 'plead';
        actionTag = `⏳ Chờ Quota #${waitingTask.seq}`;
      } else if (queuedForAgent) {
        state = 'working';
        expression = 'surprised';
        actionTag = `📥 Đã nhận #${queuedForAgent.seq}`;
      } else if (failedTask) {
        state = 'error';
        expression = 'sad';
        actionTag = `❌ Lỗi #${failedTask.seq}`;
      } else if (isCooldown) {
        state = 'idle';
        expression = 'dizzy';
        actionTag = '🔋 Hết Quota · Tạm nghỉ';
      }

      return {
        id: `agent-${key}`,
        name: theme.name,
        provider: key,
        role: targetTask?.role ?? theme.defaultRole ?? 'Nhân viên',
        isManager: false,
        baseColor: theme.base,
        bandColor: theme.band,
        accessory: theme.accessory,
        deskIndex: deskIdx,
        state,
        expression,
        currentTask: targetTask,
        actionTag,
        isOnline: true,
        signal,
        ...(targetTask?.model ? { modelText: targetTask.model } : {}),
        ...(quotaText !== undefined ? { quotaText } : {}),
        ...(typeof provState?.usedPercent === 'number'
          ? { quotaPercent: Math.max(0, Math.min(1, provState.usedPercent)) }
          : {}),
      };
    });
  }, [providers, tasks, eventsByTask]);

  const workerAgents = useStableAgents(computedWorkers);

  const computedManager = useMemo<OfficeAgentData>(() => {
    const theme = PROVIDER_THEMES.manager ?? DEFAULT_THEME;
    const draftPlans = plans.filter((p) => p.status === 'draft');
    const awaitingTasks = tasks.filter((t) => t.status === 'awaiting_user');
    const failedTasks = tasks.filter((t) => t.status === 'failed');
    const runningCount = tasks.filter((t) => t.status === 'running').length;
    const queuedCount = tasks.filter((t) => t.status === 'queued').length;
    const inboxCount = draftPlans.length + awaitingTasks.length + failedTasks.length;
    const activeTaskIds = new Set(
      tasks
        .filter((t) => t.status === 'running' || t.status === 'awaiting_user' || t.status === 'waiting_quota')
        .map((t) => t.id),
    );

    let state: OfficeAgentData['state'] = 'working';
    let expression: OfficeAgentData['expression'] = 'focus';
    let actionTag = `Điều phối (${tasks.length} task · ${memories.length} nhớ)`;

    if (inboxCount > 0) {
      state = 'waiting';
      expression = 'plead';
      actionTag = `🔔 Có ${inboxCount} báo cáo/câu hỏi cần duyệt`;
    } else if (runningCount > 0 || queuedCount > 0) {
      state = 'working';
      expression = 'focus';
      actionTag = `Giám sát ${runningCount} đang chạy · ${queuedCount} chờ`;
    } else if (tasks.length > 0) {
      state = 'working';
      expression = 'happy';
      actionTag = `Đã nghiệm thu ổn định · Bấm để giao mục tiêu`;
    }

    return {
      id: 'agent-manager',
      name: theme.name,
      provider: 'manager',
      role: theme.defaultRole ?? 'Điều phối & Kế hoạch',
      isManager: true,
      baseColor: theme.base,
      bandColor: theme.band,
      accessory: theme.accessory,
      deskIndex: -1,
      state,
      expression,
      actionTag,
      isOnline: true,
      signal: managerSignalOf(eventsByTask, activeTaskIds),
    };
  }, [plans, tasks, memories.length, eventsByTask]);

  const managerAgent = useStableAgent(computedManager);

  // Chỉ cho phép tương tác và hiển thị các Agent đã cài CLI (online) hoặc Trưởng phòng
  const onlineWorkers = useMemo(() => workerAgents.filter((a) => a.isOnline), [workerAgents]);
  const hudAgents = useMemo(() => [managerAgent, ...onlineWorkers], [managerAgent, onlineWorkers]);
  const selectedAgent = useMemo(
    () => hudAgents.find((a) => a.id === selectedAgentId) ?? null,
    [hudAgents, selectedAgentId],
  );

  const activeAgentDesks = useMemo(() => {
    return workerAgents.map((agent) => {
      let glow = '#333A48';
      let busy = false;

      if (agent.state === 'working') {
        glow = agent.baseColor;
        busy = true;
      } else if (agent.state === 'waiting') {
        glow = '#F59E0B';
        busy = true;
      } else if (agent.state === 'error') {
        glow = '#EF4444';
        busy = true;
      }

      return {
        deskIndex: agent.deskIndex,
        screenGlowColor: glow,
        isBusy: busy,
      };
    });
  }, [workerAgents]);

  const cameraTarget = useMemo<[number, number, number] | null>(() => {
    if (!selectedAgent) return null;
    if (selectedAgent.isManager) {
      return [MANAGER_DESK_COORDINATE.x, 1.3, MANAGER_DESK_COORDINATE.z - 0.8];
    }
    const isResting =
      (selectedAgent.state === 'idle' || selectedAgent.state === 'handoff') &&
      (selectedAgent.expression === 'sleep' || selectedAgent.expression === 'dizzy');
    if (isResting) {
      const lounge = LOUNGE_COORDINATES[selectedAgent.deskIndex];
      return lounge ? [lounge.x, 1.0, lounge.z] : null;
    }
    const desk = DESK_COORDINATES[selectedAgent.deskIndex];
    return desk ? [desk.x, 1.2, desk.z] : null;
  }, [selectedAgent]);

  const recentHandoff = useMemo(
    () => findRecentHandoff(tasks, eventsByTask, Date.now(), 25_000),
    [tasks, eventsByTask],
  );

  const recentClosure = useMemo(
    () => findRecentClosure(tasks, eventsByTask, Date.now(), 15_000),
    [tasks, eventsByTask],
  );

  const handoffFromAgent = useMemo(() => {
    if (!recentHandoff) return null;
    return (
      workerAgents.find((a) =>
        (a.provider || '').toLowerCase().includes(recentHandoff.info.from.toLowerCase()),
      ) ?? null
    );
  }, [recentHandoff, workerAgents]);

  const handoffToAgent = useMemo(() => {
    if (!recentHandoff) return null;
    return (
      workerAgents.find((a) =>
        (a.provider || '').toLowerCase().includes(recentHandoff.info.to.toLowerCase()),
      ) ?? null
    );
  }, [recentHandoff, workerAgents]);

  const handoffFromCoord = handoffFromAgent ? DESK_COORDINATES[handoffFromAgent.deskIndex] : null;
  const handoffToCoord = handoffToAgent ? DESK_COORDINATES[handoffToAgent.deskIndex] : null;

  const closureAgent = useMemo(() => {
    if (!recentClosure) return null;
    return (
      workerAgents.find((a) =>
        (a.provider || '').toLowerCase().includes((recentClosure.task.currentProvider || '').toLowerCase()),
      ) ?? null
    );
  }, [recentClosure, workerAgents]);

  const closureDeskCoord = closureAgent ? DESK_COORDINATES[closureAgent.deskIndex] : null;

  const handleQuickAssignToAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !quickMsg.trim()) return;
    if (!selectedAgent.isManager && !isProviderAvailable(providers, selectedAgent.provider)) {
      setQuickNotice(`Nền tảng ${selectedAgent.name} hiện không khả dụng (chưa cài hoặc đang tạm nghỉ Quota).`);
      return;
    }
    const targetRepo = repoPath || selectedAgent.currentTask?.repoPath || tasks[0]?.repoPath;
    if (!targetRepo) {
      setQuickNotice('Hãy chọn một dự án ở thanh trên cùng trước khi giao việc.');
      return;
    }
    setQuickBusy(true);
    setQuickNotice(null);
    try {
      if (selectedAgent.isManager) {
        await api.createManagerPlan({
          repoPath: targetRepo,
          goal: quickMsg.trim(),
          mode: 'semi-auto',
        });
        setQuickMsg('');
        onReload?.();
        onOpenManager?.();
      } else {
        const created = await api.createTask({
          repoPath: targetRepo,
          message: quickMsg.trim(),
          mode: 'head-dirty-commit',
          priority: [selectedAgent.provider],
          role: selectedAgent.role,
        });
        setQuickMsg('');
        setQuickNotice(`Đã giao task #${created.seq} trực tiếp cho ${selectedAgent.name}!`);
        onReload?.();
      }
    } catch (err) {
      setQuickNotice(errText(err));
    } finally {
      setQuickBusy(false);
    }
  };

  const handleHandoffTo = async (taskId: string, targetProvider: string) => {
    if (!isProviderAvailable(providers, targetProvider)) return;
    setQuickBusy(true);
    setQuickNotice(null);
    try {
      await api.assignTask(taskId, targetProvider);
      setQuickNotice(`Đã chuyển giao task sang ${targetProvider.toUpperCase()}!`);
      onReload?.();
    } catch (err) {
      setQuickNotice(errText(err));
    } finally {
      setQuickBusy(false);
    }
  };

  return (
    <div className="office-canvas-wrapper" aria-label="Không gian Văn phòng 3D">
      {/* HUD 1 dòng duy nhất với Logo thương hiệu chính thức cho các Agent khả dụng */}
      <div className="office-hud">
        <span className="office-hud-title">
          🏢 {projectName || 'Văn phòng 3D'}
        </span>
        <span style={{ color: '#D0C6B8' }}>·</span>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', pointerEvents: 'auto' }}>
          {hudAgents.map((ag) => (
            <button
              key={ag.id}
              type="button"
              onClick={() => {
                setSelectedAgentId(ag.id === selectedAgentId ? null : ag.id);
                setQuickNotice(null);
              }}
              data-tooltip={`${ag.name} (${ag.role}) — Bấm để lia camera & giao việc`}
              style={{
                fontSize: '12px',
                height: '28px',
                minHeight: '28px',
                padding: '0 10px',
                borderRadius: '999px',
                border: selectedAgentId === ag.id ? `1.5px solid ${ag.baseColor}` : '1px solid #E8E2D8',
                backgroundColor: selectedAgentId === ag.id ? '#FFFBEB' : 'rgba(255,255,255,0.92)',
                fontWeight: selectedAgentId === ag.id ? 700 : 500,
              }}
            >
              <ProviderIcon provider={ag.provider} size={13} />
              <span>{ag.name}</span>
              {ag.currentTask && (
                <span className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  #{ag.currentTask.seq}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* CONTEXTUAL POPOVER KHI BẤM VÀO MỘT AGENT TRONG 3D */}
      {selectedAgent && (
        <div
          className="office-agent-popover"
          role="dialog"
          aria-label={`Tùy chọn cho ${selectedAgent.name}`}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', borderBottom: '1px solid #E8E2D8', paddingBottom: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ProviderIcon provider={selectedAgent.provider} size={16} />
                <strong style={{ fontSize: '14.5px' }}>
                  {selectedAgent.name}
                </strong>
                <span className="badge neutral">
                  {selectedAgent.role}
                </span>
              </div>
              <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>
                {selectedAgent.actionTag}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                className="icon-btn-sm"
                onClick={() => setSelectedAgentId(null)}

                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
          </div>

          {quickNotice && (
            <div className="notice" style={{ margin: '8px 0', padding: '6px 10px', fontSize: '12px' }}>
              {quickNotice}
            </div>
          )}

          {selectedAgent.isManager ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <form onSubmit={(e) => { void handleQuickAssignToAgent(e); }} style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={quickMsg}
                  onChange={(e) => setQuickMsg(e.target.value)}
                  placeholder="Giao mục tiêu lớn để Trưởng phòng chia việc..."
                  style={{ fontSize: '12.5px', height: '34px' }}
                />
                <button type="submit" className="primary" disabled={quickBusy} style={{ flexShrink: 0, fontSize: '12px', height: '34px', minHeight: '34px' }}>
                  {quickBusy ? '...' : 'Chia việc'}
                </button>
              </form>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="primary"
                  style={{ fontSize: '12px', flex: 1, height: '32px', minHeight: '32px' }}
                  onClick={() => onOpenManager?.()}
                >
                  <ProviderIcon provider="manager" size={13} /> Hộp thư & Kế hoạch ({plans.length})
                </button>
                <button
                  type="button"
                  style={{ fontSize: '12px', flex: 1, height: '32px', minHeight: '32px' }}
                  onClick={() => onOpenMemory?.('manager')}
                >
                  🧠 Bộ nhớ chung ({memories.length})
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <form onSubmit={(e) => { void handleQuickAssignToAgent(e); }} style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={quickMsg}
                  onChange={(e) => setQuickMsg(e.target.value)}
                  placeholder={`Giao việc trực tiếp cho ${selectedAgent.name}...`}
                  disabled={!isProviderAvailable(providers, selectedAgent.provider)}
                  style={{ fontSize: '12.5px', height: '34px' }}
                />
                <button
                  type="submit"
                  className="primary"
                  disabled={quickBusy || !isProviderAvailable(providers, selectedAgent.provider)}
                  style={{ flexShrink: 0, fontSize: '12px', height: '34px', minHeight: '34px' }}
                >
                  {quickBusy ? '...' : '⚡ Giao ngay'}
                </button>
              </form>

              {selectedAgent.currentTask && (
                <div style={{ padding: '8px 10px', borderRadius: '8px', backgroundColor: '#F3EDE2', border: '1px solid #E8E2D8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      #{selectedAgent.currentTask.seq} {selectedAgent.currentTask.title}
                    </span>
                    <span className="badge info" style={{ fontSize: '10.5px' }}>
                      {TASK_STATUS_LABEL[selectedAgent.currentTask.status]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="office-mini-btn"
                      style={{ background: 'var(--text-primary)', color: '#fff', borderColor: 'var(--text-primary)' }}
                      onClick={() => onSelectTask?.(selectedAgent.currentTask!.id)}
                    >
                      💬 Chi tiết
                    </button>
                    {onlineWorkers
                      .filter((w) => w.provider !== selectedAgent.provider && isProviderAvailable(providers, w.provider))
                      .map((targetAg) => (
                        <button
                          key={targetAg.provider}
                          type="button"
                          className="office-mini-btn"
                          disabled={quickBusy}

                          onClick={() => { void handleHandoffTo(selectedAgent.currentTask!.id, targetAg.provider); }}
                        >
                          <ProviderIcon provider={targetAg.provider} size={11} /> → {targetAg.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Canvas
        shadows
        frameloop={isTabVisible ? 'always' : 'never'}
        camera={{ position: [14, 12, 16], fov: 42 }}
        dpr={[1, 2]}
        onPointerMissed={() => setSelectedAgentId(null)}
      >
        <color attach="background" args={['#FAF8F5']} />

        <ambientLight intensity={0.75} color="#FFFBF0" />
        <directionalLight
          position={[12, 18, 10]}
          intensity={1.25}
          color="#FFFDF7"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={0.5}
          shadow-camera-far={45}
          shadow-camera-left={-16}
          shadow-camera-right={16}
          shadow-camera-top={16}
          shadow-camera-bottom={-16}
          shadow-bias={-0.0005}
        />
        <directionalLight position={[-12, 10, -10]} intensity={0.4} color="#EFF6FF" />
        <pointLight position={[0, 6, 0]} intensity={0.35} color="#FEF3C7" distance={20} />

        <Suspense fallback={null}>
          <OfficeRoom
            queuedTasks={queuedTasks}
            memories={memories}
            activity={activity}
            activeAgentDesks={activeAgentDesks}
            workerAgents={workerAgents}
            managerAgent={managerAgent}
            onSelectTask={onSelectTask}
            onSelectDesk={(idx) => {
              const ag = workerAgents[idx];
              if (ag && ag.isOnline) setSelectedAgentId(ag.id);
            }}
            onOpenMemoryBoard={() => onOpenMemory?.()}
            onOpenManagerPanel={() => {
              setSelectedAgentId('agent-manager');
              onOpenManager?.();
            }}
            onOpenServerRack={() => setSelectedAgentId('agent-manager')}
          />

          <SnakeMesh
            key={managerAgent.id}
            agent={managerAgent}
            isSelected={selectedAgentId === managerAgent.id}
            targetPosition={[MANAGER_DESK_COORDINATE.x, 0.09, MANAGER_DESK_COORDINATE.z - 1.55]}
            onClick={() => {
              setSelectedAgentId((cur) => (cur === managerAgent.id ? null : managerAgent.id));
              setQuickNotice(null);
            }}
          />

          {onlineWorkers.map((agent) => {
            const deskCoord = DESK_COORDINATES[agent.deskIndex] ?? { x: 0, z: -1 };
            const loungeCoord = LOUNGE_COORDINATES[agent.deskIndex] ?? { x: 8.5, z: 5.5 };

            const isResting =
              (agent.state === 'idle' || agent.state === 'handoff') &&
              (agent.expression === 'sleep' || agent.expression === 'dizzy');
            const targetPos: [number, number, number] = isResting
              ? [loungeCoord.x, 0.15, loungeCoord.z]
              : [deskCoord.x, 0.08, deskCoord.z - 1.6];

            return (
              <SnakeMesh
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                targetPosition={targetPos}
                onClick={() => {
                  setSelectedAgentId((cur) => (cur === agent.id ? null : agent.id));
                  setQuickNotice(null);
                }}
              />
            );
          })}

          {recentHandoff && handoffFromCoord && handoffToCoord && (
            <HandoffRibbon
              fromCoord={handoffFromCoord}
              toCoord={handoffToCoord}
              fromName={handoffFromAgent?.name ?? recentHandoff.info.from}
              toName={handoffToAgent?.name ?? recentHandoff.info.to}
              taskSeq={recentHandoff.task.seq}
            />
          )}

          {recentClosure && closureDeskCoord && (
            <CelebrationBurst
              coord={closureDeskCoord}
              taskSeq={recentClosure.task.seq}
            />
          )}

          <CameraController target={cameraTarget} />
        </Suspense>

        <OrbitControls
          makeDefault
          target={[0, 1.2, 0]}
          minDistance={8}
          maxDistance={30}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.15}
          minAzimuthAngle={-Math.PI / 10}
          maxAzimuthAngle={Math.PI / 2 + Math.PI / 12}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  );
}

function CameraController({ target }: { target: [number, number, number] | null }) {
  useFrame(({ camera }) => {
    if (target) {
      const targetVec = new THREE.Vector3(target[0] + 4.5, target[1] + 3.6, target[2] + 6.5);
      camera.position.lerp(targetVec, 0.045);
    }
  });
  return null;
}

interface HandoffRibbonProps {
  fromCoord: { x: number; z: number };
  toCoord: { x: number; z: number };
  fromName: string;
  toName: string;
  taskSeq?: number;
}

/** Đường cong chuyển giao 3D nối giữa hai bàn làm việc khi có sự kiện bàn giao ca. */
function HandoffRibbon({ fromCoord, toCoord, fromName, toName, taskSeq }: HandoffRibbonProps) {
  const curve = useMemo(() => {
    const start = new THREE.Vector3(fromCoord.x, 1.15, fromCoord.z);
    const end = new THREE.Vector3(toCoord.x, 1.15, toCoord.z);
    const mid = new THREE.Vector3(
      (fromCoord.x + toCoord.x) / 2,
      2.6,
      (fromCoord.z + toCoord.z) / 2 - 0.4,
    );
    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [fromCoord.x, fromCoord.z, toCoord.x, toCoord.z]);

  const pulseMeshRef = useRef<THREE.Mesh>(null);
  const midPoint = useMemo(() => curve.getPoint(0.5), [curve]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (pulseMeshRef.current) {
      const u = (t * 0.6) % 1;
      const pt = curve.getPoint(u);
      pulseMeshRef.current.position.copy(pt);
      const scale = 0.8 + Math.sin(u * Math.PI) * 0.4;
      pulseMeshRef.current.scale.set(scale, scale, scale);
    }
  });

  return (
    <group>
      {/* Đường cong 3D chuyển giao phát sáng nhẹ */}
      <mesh>
        <tubeGeometry args={[curve, 32, 0.035, 8, false]} />
        <meshStandardMaterial
          color="#A855F7"
          emissive="#7E22CE"
          emissiveIntensity={0.6}
          roughness={0.3}
          transparent
          opacity={0.75}
        />
      </mesh>
      {/* Hạt năng lượng chuyển giao di chuyển từ bàn A sang bàn B */}
      <mesh ref={pulseMeshRef}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color="#FBBF24" emissive="#F59E0B" emissiveIntensity={0.9} />
      </mesh>
      {/* Thẻ chip thông tin bàn giao nổi tại đỉnh đường cong */}
      <Html
        center
        position={[midPoint.x, midPoint.y + 0.35, midPoint.z]}
        distanceFactor={12}
        zIndexRange={[5, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="office-handoff-chip">
          <span>⇄ Bàn giao {taskSeq !== undefined ? `#${taskSeq}: ` : ''}</span>
          <strong>{fromName}</strong>
          <span>→</span>
          <strong>{toName}</strong>
        </div>
      </Html>
    </group>
  );
}

interface CelebrationBurstProps {
  coord: { x: number; z: number };
  taskSeq: number;
}

/** Hiệu ứng chúc mừng confetti nhẹ nhàng trên bàn khi task vừa hoàn tất nghiệm thu. */
function CelebrationBurst({ coord, taskSeq }: CelebrationBurstProps) {
  const particlesRef = useRef<THREE.Group>(null);
  const colors = ['#F59E0B', '#10B981', '#3B82F6', '#EC4899', '#8B5CF6'];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (particlesRef.current) {
      particlesRef.current.children.forEach((child, i) => {
        const speed = 0.5 + (i % 3) * 0.2;
        const progress = (t * speed + i * 0.15) % 1;
        const radius = 0.3 + progress * 0.6;
        const angle = (i / 10) * Math.PI * 2 + t * 0.5;
        child.position.set(
          Math.cos(angle) * radius,
          1.4 + progress * 1.5,
          Math.sin(angle) * radius,
        );
        child.rotation.x = t * (i % 2 === 0 ? 3 : -3);
        child.rotation.y = t * 2;
        child.scale.setScalar(Math.sin(progress * Math.PI) * 0.8 + 0.2);
      });
    }
  });

  return (
    <group position={[coord.x, 0, coord.z]}>
      <group ref={particlesRef}>
        {Array.from({ length: 10 }).map((_, i) => (
          <mesh key={`confetti-${i}`}>
            <planeGeometry args={[0.07, 0.05]} />
            <meshBasicMaterial color={colors[i % colors.length]} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      <Html
        center
        position={[0, 2.5, 0]}
        distanceFactor={11}
        zIndexRange={[5, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="office-closure-chip">
          <span>🎉 Hoàn tất #{taskSeq}!</span>
        </div>
      </Html>
    </group>
  );
}
