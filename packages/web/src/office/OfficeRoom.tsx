import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { MemoryItem, Task } from '@voragent/shared';
import * as THREE from 'three';
import { stripMarkdown } from '../components/MarkdownContent';
import {
  PrimaryDeskMonitor,
  SecondaryDeskMonitor,
  ManagerUltrawideMonitor,
} from './DeskScreen';
import {
  InteractiveCoffeeMachine,
  InteractiveDeskLamp,
  InteractivePlant,
  OfficeCat,
  RoombaBot,
} from './OfficeNPCs';
import { LOUNGE_COORDINATES } from './SnakeAnimation';
import { SIGNAL_TONE, type ActivityItem } from './liveSignal';
import type { OfficeAgentData } from './types';

interface OfficeRoomProps {
  queuedTasks: Task[];
  memories?: MemoryItem[];
  activity?: ActivityItem[];
  activeAgentDesks: {
    deskIndex: number;
    screenGlowColor: string;
    isBusy: boolean;
  }[];
  workerAgents?: OfficeAgentData[];
  managerAgent?: OfficeAgentData;
  onSelectTask?: (id: string) => void;
  onSelectDesk?: (deskIndex: number) => void;
  onOpenMemoryBoard?: () => void;
  onOpenManagerPanel?: () => void;
  onOpenServerRack?: () => void;
}

export const DESK_COORDINATES = [
  { x: -6.0, z: -1 },  // Bàn 1: Claude
  { x: -2.0, z: -1 },  // Bàn 2: Codex
  { x: 2.0, z: -1 },   // Bàn 3: Antigravity
  { x: 6.0, z: -1 },   // Bàn 4: OpenCode
];

export const MANAGER_DESK_COORDINATE = { x: 0, z: -5.2 };

/** Giờ:phút ngắn gọn cho bảng tin TV. */
function clockOf(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function OfficeRoom({
  queuedTasks,
  memories = [],
  activity = [],
  activeAgentDesks,
  workerAgents = [],
  managerAgent,
  onSelectTask,
  onSelectDesk,
  onOpenMemoryBoard,
  onOpenManagerPanel,
  onOpenServerRack,
}: OfficeRoomProps) {
  const [clockText, setClockText] = useState('09:00');
  const ledsRef = useRef<THREE.Mesh[]>([]);

  // Cập nhật đồng hồ mỗi 10 giây
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setClockText(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Hiệu ứng đèn LED server nhấp nháy
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ledsRef.current.forEach((mesh, i) => {
      if (mesh) {
        mesh.visible = Math.sin(t * (2 + (i % 3)) + i * 1.5) > -0.2;
      }
    });
  });

  return (
    <group>
      {/* ================= SÀN & TƯỜNG (WARM COZY TECH) ================= */}
      {/* Sàn gỗ sáng ấm */}
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <boxGeometry args={[26, 0.3, 20]} />
        <meshStandardMaterial color="#EFE7DA" roughness={0.7} metalness={0.05} />
      </mesh>

      {/* Tường chính phía sau */}
      <mesh receiveShadow position={[0, 4, -10]}>
        <boxGeometry args={[26, 8, 0.3]} />
        <meshStandardMaterial color="#FAF8F5" roughness={0.85} />
      </mesh>

      {/* Tường bên trái đón ánh nắng */}
      <mesh receiveShadow position={[-13, 4, 0]}>
        <boxGeometry args={[0.3, 8, 20]} />
        <meshStandardMaterial color="#F5EFE6" roughness={0.85} />
      </mesh>

      {/* Cửa sổ kính lớn đón ánh sáng tự nhiên */}
      <mesh position={[-12.82, 4.2, -1]}>
        <boxGeometry args={[0.05, 4.5, 10]} />
        <meshStandardMaterial color="#E0F2FE" transparent opacity={0.65} roughness={0.1} />
      </mesh>
      {/* Khung viền cửa sổ gỗ sáng */}
      <mesh position={[-12.8, 4.2, -1]}>
        <boxGeometry args={[0.08, 4.6, 0.12]} />
        <meshStandardMaterial color="#CBBBA8" />
      </mesh>
      <mesh position={[-12.8, 4.2, 2.5]}>
        <boxGeometry args={[0.08, 4.6, 0.12]} />
        <meshStandardMaterial color="#CBBBA8" />
      </mesh>
      <mesh position={[-12.8, 4.2, -4.5]}>
        <boxGeometry args={[0.08, 4.6, 0.12]} />
        <meshStandardMaterial color="#CBBBA8" />
      </mesh>

      {/* ================= PHÂN VÙNG THẢM SÀN ================= */}
      {/* Thảm chỉ huy của Trưởng phòng */}
      <mesh receiveShadow position={[MANAGER_DESK_COORDINATE.x, 0.012, MANAGER_DESK_COORDINATE.z - 0.5]}>
        <boxGeometry args={[5.4, 0.02, 3.8]} />
        <meshStandardMaterial color="#EDE9FE" roughness={0.95} />
      </mesh>

      {/* Thảm len khu làm việc nhân viên (Work Zone) */}
      <mesh receiveShadow position={[0, 0.01, -1]}>
        <boxGeometry args={[16, 0.02, 5.2]} />
        <meshStandardMaterial color="#F5F0E6" roughness={0.95} />
      </mesh>

      {/* Thảm len khu nghỉ ngơi (Lounge Zone) */}
      <mesh receiveShadow position={[8.5, 0.01, 5.5]}>
        <boxGeometry args={[7, 0.02, 6]} />
        <meshStandardMaterial color="#EAE3D6" roughness={0.95} />
      </mesh>

      {/* ================= BÀN TRƯỞNG PHÒNG (MANAGER COMMAND DESK) ================= */}
      <group
        position={[MANAGER_DESK_COORDINATE.x, 0, MANAGER_DESK_COORDINATE.z]}
        onClick={(e) => {
          e.stopPropagation();
          onOpenManagerPanel?.();
        }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        {/* Mặt bàn gỗ óc chó ấm áp của Trưởng phòng */}
        <mesh castShadow receiveShadow position={[0, 1.08, 0]}>
          <boxGeometry args={[3.8, 0.1, 1.7]} />
          <meshStandardMaterial color="#D4BFA6" roughness={0.45} />
        </mesh>
        {/* Viền vàng đồng phía trước bàn Trưởng phòng */}
        <mesh position={[0, 1.08, 0.86]}>
          <boxGeometry args={[3.82, 0.06, 0.03]} />
          <meshStandardMaterial color="#D97706" metalness={0.5} roughness={0.3} />
        </mesh>
        {/* 4 chân bàn */}
        <mesh castShadow position={[-1.7, 0.54, -0.7]}>
          <cylinderGeometry args={[0.04, 0.04, 1.08]} />
          <meshStandardMaterial color="#1F1B18" />
        </mesh>
        <mesh castShadow position={[1.7, 0.54, -0.7]}>
          <cylinderGeometry args={[0.04, 0.04, 1.08]} />
          <meshStandardMaterial color="#1F1B18" />
        </mesh>
        <mesh castShadow position={[-1.7, 0.54, 0.7]}>
          <cylinderGeometry args={[0.04, 0.04, 1.08]} />
          <meshStandardMaterial color="#1F1B18" />
        </mesh>
        <mesh castShadow position={[1.7, 0.54, 0.7]}>
          <cylinderGeometry args={[0.04, 0.04, 1.08]} />
          <meshStandardMaterial color="#1F1B18" />
        </mesh>
        {/* Màn hình siêu rộng điều phối của Trưởng phòng (Dynamic Command Center) */}
        <ManagerUltrawideMonitor workers={workerAgents} queuedCount={queuedTasks.length} />
        {/* Biển chức danh Trưởng phòng trên bàn */}
        <mesh position={[-1.2, 1.18, 0.45]}>
          <boxGeometry args={[0.75, 0.14, 0.12]} />
          <meshStandardMaterial color="#F59E0B" metalness={0.35} roughness={0.3} />
        </mesh>
        {/* Nệm chỉ huy màu tím ấm cho Trưởng phòng */}
        <mesh receiveShadow position={[0, 0.045, -1.55]}>
          <cylinderGeometry args={[0.92, 0.98, 0.09, 32]} />
          <meshStandardMaterial color="#DDD6FE" roughness={0.85} />
        </mesh>
      </group>

      {/* ================= BÀN LÀM VIỆC CỦA 3 NHÂN VIÊN (WORKER DESKS) ================= */}
      {DESK_COORDINATES.map((desk, idx) => {
        const activeInfo = activeAgentDesks.find((d) => d.deskIndex === idx);
        const workerAgent = workerAgents.find((w) => w.deskIndex === idx);
        const glowColor = activeInfo?.screenGlowColor ?? '#333A48';

        return (
          <group
            key={`desk-${idx}`}
            position={[desk.x, 0, desk.z]}
            onClick={(e) => {
              e.stopPropagation();
              onSelectDesk?.(idx);
            }}
            onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { document.body.style.cursor = 'auto'; }}
          >
            {/* Mặt bàn gỗ sáng bo nhẹ */}
            <mesh castShadow receiveShadow position={[0, 1.05, 0]}>
              <boxGeometry args={[3.2, 0.08, 1.6]} />
              <meshStandardMaterial color="#E4D7C5" roughness={0.5} />
            </mesh>

            {/* Chân bàn kim loại thanh mảnh */}
            <mesh castShadow position={[-1.45, 0.52, -0.65]}>
              <cylinderGeometry args={[0.035, 0.035, 1.05]} />
              <meshStandardMaterial color="#2B2622" />
            </mesh>
            <mesh castShadow position={[1.45, 0.52, -0.65]}>
              <cylinderGeometry args={[0.035, 0.035, 1.05]} />
              <meshStandardMaterial color="#2B2622" />
            </mesh>
            <mesh castShadow position={[-1.45, 0.52, 0.65]}>
              <cylinderGeometry args={[0.035, 0.035, 1.05]} />
              <meshStandardMaterial color="#2B2622" />
            </mesh>
            <mesh castShadow position={[1.45, 0.52, 0.65]}>
              <cylinderGeometry args={[0.035, 0.035, 1.05]} />
              <meshStandardMaterial color="#2B2622" />
            </mesh>

            {/* Màn hình chính IDE & Code Editor sinh động */}
            <PrimaryDeskMonitor agent={workerAgent} />

            {/* Màn hình phụ Telemetry & Metrics xoay chéo */}
            <SecondaryDeskMonitor agent={workerAgent} />

            {/* Bàn phím & Chuột */}
            <mesh position={[-0.2, 1.1, -0.2]}>
              <boxGeometry args={[0.8, 0.025, 0.25]} />
              <meshStandardMaterial color="#334155" />
            </mesh>
            <mesh position={[0.45, 1.1, -0.2]}>
              <boxGeometry args={[0.09, 0.025, 0.14]} />
              <meshStandardMaterial color="#1E293B" />
            </mesh>

            {/* Đèn bàn ấm áp có thể tương tác bật/tắt */}
            <InteractiveDeskLamp position={[-1.2, 1.1, 0.4]} />

            {/* Cốc cà phê sứ ấm */}
            <mesh position={[1.15, 1.16, -0.35]}>
              <cylinderGeometry args={[0.065, 0.055, 0.14, 16]} />
              <meshStandardMaterial
                color={idx === 0 ? '#D97757' : idx === 1 ? '#10A37F' : '#3B82F6'}
              />
            </mesh>

            {/* Nệm tròn êm ái cho rắn cuộn tròn */}
            <mesh receiveShadow position={[0, 0.04, -1.6]}>
              <cylinderGeometry args={[0.85, 0.9, 0.08, 32]} />
              <meshStandardMaterial color="#E6DDCE" roughness={0.9} />
            </mesh>
          </group>
        );
      })}

      {/* ================= TV TREO TƯỜNG TRÁI SAU (HÀNG ĐỢI TASK - KHÔNG CHE TRƯỞNG PHÒNG) ================= */}
      <group position={[-5.4, 4.7, -9.8]}>
        {/* Khung viền TV đen mỏng */}
        <mesh castShadow>
          <boxGeometry args={[5.0, 2.6, 0.12]} />
          <meshStandardMaterial color="#111827" roughness={0.3} />
        </mesh>
        {/* Màn hình TV hiển thị thông tin hàng đợi */}
        <mesh position={[0, 0, 0.07]}>
          <planeGeometry args={[4.8, 2.4]} />
          <meshStandardMaterial color="#0F172A" />
        </mesh>

        {/* HTML Overlay giới hạn zIndexRange={[5, 0]} và distanceFactor={3.5} để nằm trọn trong khung TV */}
        <Html
          center
          transform
          zIndexRange={[5, 0]}
          position={[0, 0, 0.08]}
          distanceFactor={3.5}
          style={{
            width: '520px',
            height: '260px',
            padding: '12px 16px',
            boxSizing: 'border-box',
            backgroundColor: '#0F172A',
            color: '#F8FAFC',
            fontFamily: 'system-ui, sans-serif',
            userSelect: 'none',
            pointerEvents: 'auto',
            borderRadius: '4px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '6px', marginBottom: '8px' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#38BDF8', letterSpacing: '0.4px' }}>
              📺 HÀNG ĐỢI VĂN PHÒNG ({queuedTasks.length})
            </span>
            <span style={{ fontSize: '12.5px', color: '#94A3B8' }}>{clockText}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {queuedTasks.length === 0 ? (
              <div style={{ color: '#94A3B8', fontSize: '12.5px', fontStyle: 'italic', marginTop: '14px', textAlign: 'center' }}>
                Hàng đợi trống · Bấm vào Trưởng phòng hoặc Nhân viên để giao việc
              </div>
            ) : (
              queuedTasks.slice(0, 3).map((t, i) => (
                <div
                  key={t.id}
                  onClick={() => onSelectTask?.(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    backgroundColor: i === 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.7)',
                    border: i === 0 ? '1px solid #0284C7' : '1px solid #334155',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '360px' }}>
                    #{t.seq} {t.title}
                  </span>
                  <span style={{ fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#334155', color: '#93C5FD' }}>
                    {t.role ?? t.status}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Bảng tin hoạt động thật: chỉ hiện sự kiện có ý nghĩa, bỏ qua từng token chữ */}
          {activity.length > 0 && (
            <div className="office-tv-ticker">
              {activity.slice(0, 3).map((item) => (
                <div key={item.id} className="office-tv-ticker-row">
                  <span
                    className="office-tv-ticker-dot"
                    style={{ backgroundColor: SIGNAL_TONE[item.kind] }}
                  />
                  <span className="office-tv-ticker-time">{clockOf(item.ts)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </Html>
      </group>

      {/* ================= BẢNG TRẮNG BỘ NHỚ DÙNG CHUNG (TƯỜNG PHẢI SAU - KHÔNG CHE TRƯỞNG PHÒNG) ================= */}
      <group
        position={[5.4, 4.7, -9.8]}
        onClick={(e) => {
          e.stopPropagation();
          onOpenMemoryBoard?.();
        }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        {/* Khung gỗ ấm của bảng trắng */}
        <mesh castShadow>
          <boxGeometry args={[5.2, 2.6, 0.1]} />
          <meshStandardMaterial color="#D4BFA6" roughness={0.5} />
        </mesh>
        {/* Mặt bảng trắng ngà */}
        <mesh position={[0, 0, 0.055]}>
          <planeGeometry args={[4.95, 2.4]} />
          <meshStandardMaterial color="#FFFDF9" roughness={0.2} />
        </mesh>

        <Html
          center
          transform
          zIndexRange={[5, 0]}
          position={[0, 0, 0.07]}
          distanceFactor={3.5}
          style={{
            width: '535px',
            height: '260px',
            padding: '12px 16px',
            boxSizing: 'border-box',
            backgroundColor: '#FFFDF9',
            color: '#1F1B18',
            fontFamily: 'system-ui, sans-serif',
            userSelect: 'none',
            pointerEvents: 'auto',
            cursor: 'pointer',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              onOpenMemoryBoard?.();
            }}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #E8E2D8', paddingBottom: '5px', marginBottom: '8px' }}>
              <span style={{ fontSize: '14.5px', fontWeight: 700, color: '#6D28D9' }}>
                🧠 BỘ NHỚ CHUNG VĂN PHÒNG ({memories.length})
              </span>
              <span style={{ fontSize: '10.5px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#F5F3FF', color: '#6D28D9', fontWeight: 600, border: '1px solid #DDD6FE' }}>
                Mở / thêm +
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flex: 1, overflow: 'hidden' }}>
              {memories.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', color: '#6E655C', fontSize: '12px', textAlign: 'center', marginTop: '30px' }}>
                  Chưa có mục nhớ nào · Bấm vào bảng để ghi Kiến trúc & Quyết định chung cho dự án!
                </div>
              ) : (
                memories.slice(0, 4).map((m) => (
                  <div
                    key={m.id}
                    style={{
                      padding: '7px 9px',
                      borderRadius: '8px',
                      backgroundColor: m.pinned ? '#FEF3C7' : '#F3EDE2',
                      border: m.pinned ? '1px solid #FCD34D' : '1px solid #E8E2D8',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#1F1B18', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.pinned ? '📌 ' : ''}{stripMarkdown(m.title)}
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#6E655C', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.35 }}>
                      {stripMarkdown(m.content)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Html>
      </group>

      {/* ================= GÓC MÁY CHỦ & SERVER RACK (BẤM XEM QUOTA) ================= */}
      <group
        position={[-10.2, 0, -8]}
        onClick={(e) => {
          e.stopPropagation();
          onOpenServerRack?.();
        }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        {/* Tủ rack 1 */}
        <mesh castShadow receiveShadow position={[0, 2.2, 0]}>
          <boxGeometry args={[1.5, 4.4, 1.2]} />
          <meshStandardMaterial color="#1E293B" roughness={0.4} />
        </mesh>

        {/* Các khay phiến server */}
        {Array.from({ length: 9 }).map((_, r) => (
          <mesh key={`blade-${r}`} position={[0, 0.7 + r * 0.4, 0.61]}>
            <boxGeometry args={[1.3, 0.28, 0.02]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        ))}

        {/* Đèn LED nhấp nháy trên server */}
        {Array.from({ length: 9 }).map((_, r) => (
          <mesh
            key={`led-green-${r}`}
            ref={(el) => { if (el) ledsRef.current[r] = el; }}
            position={[0.45, 0.7 + r * 0.4, 0.63]}
          >
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial color={r % 3 === 0 ? '#38BDF8' : '#22C55E'} />
          </mesh>
        ))}

        {/* Router wifi với 2 râu ăng-ten */}
        <group position={[0, 4.5, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.9, 0.14, 0.5]} />
            <meshStandardMaterial color="#F1F5F9" />
          </mesh>
          <mesh position={[-0.35, 0.25, -0.15]} rotation={[0, 0, 0.15]}>
            <cylinderGeometry args={[0.015, 0.015, 0.4]} />
            <meshStandardMaterial color="#1E293B" />
          </mesh>
          <mesh position={[0.35, 0.25, -0.15]} rotation={[0, 0, -0.15]}>
            <cylinderGeometry args={[0.015, 0.015, 0.4]} />
            <meshStandardMaterial color="#1E293B" />
          </mesh>
        </group>
      </group>

      {/* ================= KHU NGHỈ NGƠI (LOUNGE) ================= */}
      <group>
        {/* Thảm sàn khu nghỉ ngơi ấm cúng */}
        <mesh receiveShadow position={[8.4, 0.015, 6.0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[5.6, 4.4]} />
          <meshStandardMaterial color="#F3EDE2" roughness={0.95} />
        </mesh>

        {/* 4 Nệm lười (Floor Poufs) êm ái cho 4 Agent nghỉ ngơi */}
        {LOUNGE_COORDINATES.map((pos, idx) => {
          const colors = [
            { rim: '#D97757', top: '#FDE68A' }, // Claude (Cam đất)
            { rim: '#10A37F', top: '#D1FAE5' }, // Codex (Xanh ngọc)
            { rim: '#3B82F6', top: '#DBEAFE' }, // Antigravity (Xanh dương)
            { rim: '#059669', top: '#A7F3D0' }, // OpenCode (Xanh ngọc đậm)
          ][idx] ?? { rim: '#E2E8F0', top: '#FFFFFF' };

          return (
            <group key={`lounge-pouf-${idx}`} position={[pos.x, 0, pos.z]}>
              {/* Vành nệm ngoài êm ái */}
              <mesh castShadow receiveShadow position={[0, 0.07, 0]}>
                <cylinderGeometry args={[0.92, 0.98, 0.14, 32]} />
                <meshStandardMaterial color={colors.rim} roughness={0.85} />
              </mesh>
              {/* Mặt đệm trũng mềm mại phía trên để rắn nằm lên */}
              <mesh receiveShadow position={[0, 0.135, 0]}>
                <cylinderGeometry args={[0.82, 0.85, 0.03, 32]} />
                <meshStandardMaterial color={colors.top} roughness={0.9} />
              </mesh>
            </group>
          );
        })}

        {/* Quầy bar nhỏ và máy pha cà phê */}
        <group position={[8.4, 0, 3.2]}>
          <mesh castShadow receiveShadow position={[0, 0.65, 0]}>
            <boxGeometry args={[2.8, 1.3, 0.8]} />
            <meshStandardMaterial color="#F1F5F9" />
          </mesh>
          {/* Máy pha cà phê tương tác */}
          <InteractiveCoffeeMachine position={[-0.6, 1.3, 0]} />
        </group>
      </group>

      {/* ================= CÁC NHÂN VẬT NPC TƯƠNG TÁC ================= */}
      {/* Chú mèo Paws nằm sưởi nắng trên bệ cửa sổ */}
      <OfficeCat />

      {/* Robot hút bụi Roomba BeepBoop tự hành dọn dẹp sàn nhà */}
      <RoombaBot />

      {/* ================= CÂY XANH TRANG TRÍ (PLANTS) ================= */}
      {/* Cây xanh bên cửa sổ có thể tưới nước tương tác */}
      <InteractivePlant position={[-11.5, 0, 7.5]} />

      {/* Cây xanh bên cạnh máy chủ */}
      <group position={[-11.5, 0, -8.5]}>
        <mesh castShadow position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.35, 0.25, 0.8, 16]} />
          <meshStandardMaterial color="#EFE7DA" />
        </mesh>
        <mesh castShadow position={[0, 1.1, 0]}>
          <sphereGeometry args={[0.65, 16, 16]} />
          <meshStandardMaterial color="#3FA76A" roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}
