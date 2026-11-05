import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { ProviderState, Task } from '@voragent/shared';
import { DESK_COORDINATES, OfficeRoom } from './OfficeRoom';
import { LOUNGE_COORDINATES } from './SnakeAnimation';
import { SnakeMesh } from './SnakeMesh';
import { type AgentExpression, DEFAULT_THEME, type OfficeAgentData, PROVIDER_THEMES } from './types';

export function OfficeCanvas({
  tasks,
  providers,
  onSelectTask,
}: {
  tasks: Task[];
  providers: ProviderState[];
  onSelectTask?: (taskId: string) => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [overrideExpr, setOverrideExpr] = useState<AgentExpression | null>(null);
  const [demoHandoff, setDemoHandoff] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(true);

  // Theo dõi trạng thái hiển thị của tab để tạm dừng render tiết kiệm pin (Task 7)
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

  // Ánh xạ trạng thái các agent
  const agentsData = useMemo<OfficeAgentData[]>(() => {
    const knownProviders = ['claude', 'codex', 'antigravity'];

    return knownProviders.map((key, deskIdx) => {
      const theme = PROVIDER_THEMES[key] ?? DEFAULT_THEME;
      const provState = providers.find((p) => p.id.toLowerCase().includes(key));
      const activeTask = tasks.find(
        (t) => (t.currentProvider || '').toLowerCase().includes(key) && t.status === 'running'
      );
      const waitingTask = tasks.find(
        (t) => (t.currentProvider || '').toLowerCase().includes(key) && t.status === 'waiting_quota'
      );
      const failedTask = tasks.find(
        (t) => (t.currentProvider || '').toLowerCase().includes(key) && t.status === 'failed'
      );

      let state: OfficeAgentData['state'] = 'idle';
      let expression: OfficeAgentData['expression'] = 'sleep';
      let actionTag = '💤 Sẵn sàng / Rảnh';
      let targetTask = activeTask || waitingTask || failedTask;

      const isCooldown = (provState?.cooldownUntil ?? 0) > Date.now();

      if (activeTask) {
        state = 'working';
        expression = 'focus';
        actionTag = `⚡ Đang chạy #${activeTask.seq}`;
      } else if (waitingTask) {
        state = 'waiting';
        expression = 'plead';
        actionTag = `⏳ Chờ Quota #${waitingTask.seq}`;
      } else if (failedTask) {
        state = 'error';
        expression = 'sad';
        actionTag = `❌ Lỗi #${failedTask.seq}`;
      } else if (isCooldown) {
        state = 'idle';
        expression = 'dizzy';
        actionTag = '🔋 Hết Quota · Tạm nghỉ';
      }

      // Xử lý demo handoff
      if (demoHandoff) {
        if (key === 'claude') {
          state = 'idle';
          expression = 'dizzy';
          actionTag = '🔋 Hết Quota · Về nghỉ';
        } else if (key === 'codex') {
          state = 'working';
          expression = 'focus';
          actionTag = '⚡ Tiếp quản task bàn giao';
        }
      }

      // Nếu có override biểu cảm đang thử nghiệm
      if (overrideExpr && (selectedAgentId === null || selectedAgentId === `agent-${key}`)) {
        expression = overrideExpr;
      }

      return {
        id: `agent-${key}`,
        name: theme.name,
        provider: key,
        baseColor: theme.base,
        bandColor: theme.band,
        accessory: theme.accessory,
        deskIndex: deskIdx,
        state,
        expression,
        currentTask: targetTask,
        actionTag,
        isOnline: provState?.installed ?? true,
      };
    });
  }, [providers, tasks, demoHandoff, overrideExpr, selectedAgentId]);

  const activeAgentDesks = useMemo(() => {
    return agentsData.map((agent) => {
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
  }, [agentsData]);

  // Vị trí camera mục tiêu khi click chọn một agent
  const cameraTarget = useMemo<[number, number, number] | null>(() => {
    if (!selectedAgentId) return null;
    const ag = agentsData.find((a) => a.id === selectedAgentId);
    if (!ag) return null;
    const desk = DESK_COORDINATES[ag.deskIndex];
    return desk ? [desk.x, 1.2, desk.z] : null;
  }, [selectedAgentId, agentsData]);

  return (
    <div className="office-canvas-wrapper" aria-label="Không gian Văn phòng 3D">
      {/* HUD Header */}
      <div className="office-hud">
        <div className="office-hud-title">
          🏢 Văn Phòng 3D voragent · Smart Snake Agents
        </div>
        <div className="office-hud-hint">
          <span>Xoay: Chuột trái</span> · <span>Thu phóng: Cuộn chuột</span> · <span>Di chuyển: Chuột phải</span> · <span>Click rắn: Tiêu cự camera</span>
        </div>
      </div>

      {/* Thanh điều khiển thử nghiệm biểu cảm & Hoạt cảnh Bàn giao (Expression Tester) */}
      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          padding: '8px 14px',
          borderRadius: '14px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'center',
          zIndex: 10,
          maxWidth: 'calc(100% - 32px)',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginRight: '4px' }}>
          {selectedAgentId ? `Thử biểu cảm (${agentsData.find((a) => a.id === selectedAgentId)?.name}):` : 'Thử biểu cảm:'}
        </span>
        <button
          type="button"
          onClick={() => { setOverrideExpr(null); setDemoHandoff(false); }}
          style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', cursor: 'pointer', backgroundColor: overrideExpr === null && !demoHandoff ? '#E2E8F0' : '#FFFFFF' }}
        >
          Mặc định (Live)
        </button>
        <button
          type="button"
          onClick={() => setOverrideExpr('focus')}
          style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', cursor: 'pointer', backgroundColor: overrideExpr === 'focus' ? '#FEF08A' : '#FFFFFF' }}
        >
          🧐 Tập trung
        </button>
        <button
          type="button"
          onClick={() => setOverrideExpr('plead')}
          style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', cursor: 'pointer', backgroundColor: overrideExpr === 'plead' ? '#FEF08A' : '#FFFFFF' }}
        >
          🥺 Chờ duyệt
        </button>
        <button
          type="button"
          onClick={() => setOverrideExpr('sleep')}
          style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', cursor: 'pointer', backgroundColor: overrideExpr === 'sleep' ? '#FEF08A' : '#FFFFFF' }}
        >
          😴 Ngủ say
        </button>
        <button
          type="button"
          onClick={() => setOverrideExpr('happy')}
          style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', cursor: 'pointer', backgroundColor: overrideExpr === 'happy' ? '#FEF08A' : '#FFFFFF' }}
        >
          😄 Hoàn thành
        </button>
        <button
          type="button"
          onClick={() => setOverrideExpr('sad')}
          style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', cursor: 'pointer', backgroundColor: overrideExpr === 'sad' ? '#FEF08A' : '#FFFFFF' }}
        >
          😢 Lỗi turn
        </button>
        <button
          type="button"
          onClick={() => setOverrideExpr('dizzy')}
          style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', cursor: 'pointer', backgroundColor: overrideExpr === 'dizzy' ? '#FEF08A' : '#FFFFFF' }}
        >
          😵 Hết Quota
        </button>
        <button
          type="button"
          onClick={() => { setDemoHandoff(!demoHandoff); setOverrideExpr(null); }}
          style={{
            fontSize: '12px',
            padding: '5px 12px',
            borderRadius: '8px',
            border: '1px solid #3B82F6',
            backgroundColor: demoHandoff ? '#2563EB' : '#EFF6FF',
            color: demoHandoff ? '#FFFFFF' : '#1D4ED8',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🔄 {demoHandoff ? 'Dừng Demo Handoff' : 'Mô phỏng Bàn giao Handoff'}
        </button>
      </div>

      <Canvas
        shadows
        frameloop={isTabVisible ? 'always' : 'never'}
        camera={{ position: [14, 12, 16], fov: 42 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#FAF8F5']} />

        {/* Hệ thống ánh sáng tự nhiên ấm cúng */}
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
            activeAgentDesks={activeAgentDesks}
            onSelectTask={onSelectTask}
          />

          {/* Các chú Rắn thông minh trườn giữa bàn và khu nghỉ */}
          {agentsData.map((agent) => {
            const deskCoord = DESK_COORDINATES[agent.deskIndex] ?? { x: 0, z: -1 };
            const loungeCoord = LOUNGE_COORDINATES[agent.deskIndex] ?? { x: 8.5, z: 5.5 };

            // Nếu đang ngủ hoặc hết quota: trườn về nệm nghỉ ngơi; nếu đang làm việc/chờ: ở bàn làm việc
            const isResting = agent.state === 'idle' && (agent.expression === 'sleep' || agent.expression === 'dizzy');
            const targetPos: [number, number, number] = isResting
              ? [loungeCoord.x, 0.15, loungeCoord.z]
              : [deskCoord.x, 0.08, deskCoord.z - 1.6];

            return (
              <SnakeMesh
                key={agent.id}
                agent={agent}
                targetPosition={targetPos}
                onClick={() => {
                  setSelectedAgentId(agent.id === selectedAgentId ? null : agent.id);
                  if (agent.currentTask && onSelectTask) {
                    onSelectTask(agent.currentTask.id);
                  }
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

/** Tự động lia camera mượt mà khi người dùng click chọn agent */
function CameraController({ target }: { target: [number, number, number] | null }) {
  useFrame(({ camera }) => {
    if (target) {
      const targetVec = new THREE.Vector3(target[0] + 5, target[1] + 4, target[2] + 7);
      camera.position.lerp(targetVec, 0.04);
    }
  });
  return null;
}
