import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Task } from '@voragent/shared';
import * as THREE from 'three';
import {
  InteractiveCoffeeMachine,
  InteractiveDeskLamp,
  InteractivePlant,
  OfficeCat,
  RoombaBot,
} from './OfficeNPCs';
import { LOUNGE_COORDINATES } from './SnakeAnimation';

interface OfficeRoomProps {
  queuedTasks: Task[];
  activeAgentDesks: {
    deskIndex: number;
    screenGlowColor: string;
    isBusy: boolean;
  }[];
  onSelectTask?: (id: string) => void;
}

export const DESK_COORDINATES = [
  { x: -5, z: -1 },  // Bàn 1: Claude
  { x: 0, z: -1 },   // Bàn 2: Codex
  { x: 5, z: -1 },   // Bàn 3: Antigravity
];

export function OfficeRoom({ queuedTasks, activeAgentDesks, onSelectTask }: OfficeRoomProps) {
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
      {/* Thảm len khu làm việc (Work Zone) */}
      <mesh receiveShadow position={[0, 0.01, -1]}>
        <boxGeometry args={[16, 0.02, 7]} />
        <meshStandardMaterial color="#F5F0E6" roughness={0.95} />
      </mesh>

      {/* Thảm len khu nghỉ ngơi (Lounge Zone) */}
      <mesh receiveShadow position={[8.5, 0.01, 5.5]}>
        <boxGeometry args={[7, 0.02, 6]} />
        <meshStandardMaterial color="#EAE3D6" roughness={0.95} />
      </mesh>

      {/* ================= BÀN LÀM VIỆC (DESKS) ================= */}
      {DESK_COORDINATES.map((desk, idx) => {
        const activeInfo = activeAgentDesks.find((d) => d.deskIndex === idx);
        const glowColor = activeInfo?.screenGlowColor ?? '#333A48';

        return (
          <group key={`desk-${idx}`} position={[desk.x, 0, desk.z]}>
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

            {/* Màn hình chính: quay về phía chú rắn */}
            <group position={[-0.2, 1.48, 0.35]}>
              <mesh castShadow>
                <boxGeometry args={[1.2, 0.7, 0.05]} />
                <meshStandardMaterial color="#1E293B" />
              </mesh>
              {/* Mặt phát sáng (emissive) phản chiếu trạng thái */}
              <mesh position={[0, 0, -0.026]}>
                <planeGeometry args={[1.14, 0.64]} />
                <meshStandardMaterial
                  color="#111827"
                  emissive={glowColor}
                  emissiveIntensity={activeInfo?.isBusy ? 0.75 : 0.2}
                  side={THREE.DoubleSide}
                />
              </mesh>
              {/* Chân đế màn hình */}
              <mesh position={[0, -0.28, 0.04]}>
                <cylinderGeometry args={[0.03, 0.03, 0.35]} />
                <meshStandardMaterial color="#475569" />
              </mesh>
              <mesh position={[0, -0.42, 0.04]}>
                <boxGeometry args={[0.3, 0.02, 0.2]} />
                <meshStandardMaterial color="#334155" />
              </mesh>
            </group>

            {/* Màn hình phụ xoay chéo */}
            <group position={[0.95, 1.45, 0.2]} rotation={[0, -0.4, 0]}>
              <mesh castShadow>
                <boxGeometry args={[0.85, 0.55, 0.04]} />
                <meshStandardMaterial color="#1E293B" />
              </mesh>
              <mesh position={[0, 0, -0.022]}>
                <planeGeometry args={[0.8, 0.5]} />
                <meshStandardMaterial
                  color="#111827"
                  emissive="#64748B"
                  emissiveIntensity={0.25}
                  side={THREE.DoubleSide}
                />
              </mesh>
              <mesh position={[0, -0.25, 0.04]}>
                <cylinderGeometry args={[0.025, 0.025, 0.3]} />
                <meshStandardMaterial color="#475569" />
              </mesh>
            </group>

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

      {/* ================= TV TREO TƯỜNG (HÀNG ĐỢI TASK) ================= */}
      <group position={[-2, 4.2, -9.8]}>
        {/* Khung viền TV đen mỏng */}
        <mesh castShadow>
          <boxGeometry args={[6.2, 3.2, 0.12]} />
          <meshStandardMaterial color="#111827" roughness={0.3} />
        </mesh>
        {/* Màn hình TV hiển thị thông tin hàng đợi */}
        <mesh position={[0, 0, 0.07]}>
          <planeGeometry args={[6.0, 3.0]} />
          <meshStandardMaterial color="#0F172A" />
        </mesh>

        {/* HTML Overlay render chữ sắc nét trên màn hình TV */}
        <Html
          center
          transform
          occlude
          position={[0, 0, 0.08]}
          distanceFactor={6}
          style={{
            width: '600px',
            height: '300px',
            padding: '16px 20px',
            boxSizing: 'border-box',
            backgroundColor: '#0F172A',
            color: '#F8FAFC',
            fontFamily: 'system-ui, sans-serif',
            userSelect: 'none',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '18px', fontWeight: 600, color: '#38BDF8', letterSpacing: '0.5px' }}>
              📺 HÀNG ĐỢI TASK ({queuedTasks.length})
            </span>
            <span style={{ fontSize: '14px', color: '#94A3B8' }}>{clockText}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {queuedTasks.length === 0 ? (
              <div style={{ color: '#64748B', fontSize: '14px', fontStyle: 'italic', marginTop: '30px', textAlign: 'center' }}>
                Hàng đợi trống · Các agent đang sẵn sàng nhận việc
              </div>
            ) : (
              queuedTasks.slice(0, 4).map((t, i) => (
                <div
                  key={t.id}
                  onClick={() => onSelectTask?.(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: i === 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.7)',
                    border: i === 0 ? '1px solid #0284C7' : '1px solid #334155',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '420px' }}>
                    #{t.seq} {t.title}
                  </span>
                  <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#334155', color: '#93C5FD' }}>
                    {t.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </Html>
      </group>

      {/* Đồng hồ số treo tường */}
      <group position={[5.5, 5.2, -9.8]}>
        <mesh castShadow>
          <boxGeometry args={[1.8, 0.7, 0.08]} />
          <meshStandardMaterial color="#0F172A" roughness={0.3} />
        </mesh>
        <Html
          center
          transform
          position={[0, 0, 0.05]}
          distanceFactor={5}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '140px',
            height: '50px',
            color: '#10B981',
            fontSize: '26px',
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: '1px',
            textShadow: '0 0 10px rgba(16, 185, 129, 0.65)',
            userSelect: 'none',
            textAlign: 'center',
            lineHeight: 1,
            pointerEvents: 'none',
          }}
        >
          {clockText}
        </Html>
      </group>

      {/* ================= GÓC MÁY CHỦ & SERVER RACK ================= */}
      <group position={[-9.5, 0, -8]}>
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

        {/* 3 Nệm lười (Floor Poufs) êm ái cho 3 Agent nghỉ ngơi */}
        {LOUNGE_COORDINATES.map((pos, idx) => {
          const colors = [
            { rim: '#D97757', top: '#FDE68A' }, // Claude (Cam đất)
            { rim: '#10A37F', top: '#D1FAE5' }, // Codex (Xanh ngọc)
            { rim: '#3B82F6', top: '#DBEAFE' }, // Antigravity (Xanh dương)
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
