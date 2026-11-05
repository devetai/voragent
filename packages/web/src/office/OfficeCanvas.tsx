import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { ManagerPlan, MemoryItem, ProviderState, Task } from '@voragent/shared';
import { TASK_STATUS_LABEL } from '@voragent/shared';
import { api, errText } from '../api';
import { ProviderIcon } from '../components/ProviderIcon';
import { isProviderAvailable } from '../state';
import { DESK_COORDINATES, MANAGER_DESK_COORDINATE, OfficeRoom } from './OfficeRoom';
import { LOUNGE_COORDINATES } from './SnakeAnimation';
import { SnakeMesh } from './SnakeMesh';
import { DEFAULT_THEME, type OfficeAgentData, PROVIDER_THEMES } from './types';

export function OfficeCanvas({
  repoPath,
  projectName,
  tasks,
  providers,
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

  const workerAgents = useMemo<OfficeAgentData[]>(() => {
    const knownProviders = ['claude', 'codex', 'antigravity'];

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

      let state: OfficeAgentData['state'] = 'idle';
      let expression: OfficeAgentData['expression'] = 'sleep';
      let actionTag = '💤 Sẵn sàng · Bấm để giao việc';
      const targetTask = activeTask || awaitingUserTask || waitingTask || queuedForAgent || failedTask;

      const isCooldown = (provState?.cooldownUntil ?? 0) > Date.now();

      if (activeTask) {
        state = 'working';
        expression = 'focus';
        actionTag = `⚡ Đang làm #${activeTask.seq}`;
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
      };
    });
  }, [providers, tasks]);

  const managerAgent = useMemo<OfficeAgentData>(() => {
    const theme = PROVIDER_THEMES.manager ?? DEFAULT_THEME;
    const draftPlans = plans.filter((p) => p.status === 'draft');
    const awaitingTasks = tasks.filter((t) => t.status === 'awaiting_user');
    const failedTasks = tasks.filter((t) => t.status === 'failed');
    const runningCount = tasks.filter((t) => t.status === 'running').length;
    const queuedCount = tasks.filter((t) => t.status === 'queued').length;
    const inboxCount = draftPlans.length + awaitingTasks.length + failedTasks.length;

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
    };
  }, [plans, tasks, memories.length]);

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
    const isResting = selectedAgent.state === 'idle' && (selectedAgent.expression === 'sleep' || selectedAgent.expression === 'dizzy');
    if (isResting) {
      const lounge = LOUNGE_COORDINATES[selectedAgent.deskIndex];
      return lounge ? [lounge.x, 1.0, lounge.z] : null;
    }
    const desk = DESK_COORDINATES[selectedAgent.deskIndex];
    return desk ? [desk.x, 1.2, desk.z] : null;
  }, [selectedAgent]);

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
              title={`${ag.name} (${ag.role}) — Bấm để lia camera & giao việc`}
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
                data-tooltip="Đóng (Esc)"
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
                          title={`Bàn giao task #${selectedAgent.currentTask!.seq} sang ${targetAg.name}`}
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
              setSelectedAgentId(selectedAgentId === managerAgent.id ? null : managerAgent.id);
              setQuickNotice(null);
            }}
          />

          {onlineWorkers.map((agent) => {
            const deskCoord = DESK_COORDINATES[agent.deskIndex] ?? { x: 0, z: -1 };
            const loungeCoord = LOUNGE_COORDINATES[agent.deskIndex] ?? { x: 8.5, z: 5.5 };

            const isResting = agent.state === 'idle' && (agent.expression === 'sleep' || agent.expression === 'dizzy');
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
                  setSelectedAgentId(agent.id === selectedAgentId ? null : agent.id);
                  setQuickNotice(null);
                }}
              />
            );
          })}

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
