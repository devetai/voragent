import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OfficeAgentData } from './types';

// ==========================================
// 1. PRIMARY MONITOR (IDE & CODE EDITOR)
// ==========================================
export function PrimaryDeskMonitor({
  agent,
  width = 1.2,
  height = 0.7,
}: {
  agent?: OfficeAgentData;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const lastUpdateRef = useRef(0);
  const frameCountRef = useRef(0);

  // Khởi tạo Canvas và CanvasTexture một lần duy nhất
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 288; // 16:9 ratio
    canvasRef.current = canvas;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    textureRef.current = tex;
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      texture.dispose();
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    };
  }, [texture]);

  // Vẽ giao diện IDE vào canvas theo nhịp (~10 FPS)
  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (now - lastUpdateRef.current < 0.1) return; // giới hạn 10 FPS
    lastUpdateRef.current = now;
    frameCountRef.current++;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = frameCountRef.current;
    const isWorking = agent?.state === 'working';
    const isWaiting = agent?.state === 'waiting';
    const isError = agent?.state === 'error';
    const agentColor = agent?.baseColor || '#8B5CF6';
    const taskSeq = agent?.currentTask?.seq;
    const taskTitle = agent?.currentTask?.title || '';
    const signal = agent?.signal;
    const signalLabel = signal !== undefined && signal.kind !== 'idle' ? signal.label : '';
    const signalDetail = signal?.detail ?? '';

    // Nền IDE đậm chất Modern Dark
    ctx.fillStyle = '#0F141C';
    ctx.fillRect(0, 0, 512, 288);

    // 1. TITLE BAR (macOS / VS Code Style)
    ctx.fillStyle = '#1A2230';
    ctx.fillRect(0, 0, 512, 34);

    // Traffic light dots
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(18, 17, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(34, 17, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#10B981';
    ctx.beginPath();
    ctx.arc(50, 17, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Active File Tab
    ctx.fillStyle = '#0F141C';
    ctx.beginPath();
    ctx.roundRect(70, 6, 210, 28, [6, 6, 0, 0]);
    ctx.fill();

    // Tab Icon + File Name
    ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = agentColor;
    ctx.fillText('⚡', 80, 23);

    ctx.fillStyle = '#E2E8F0';
    const tabName =
      signal?.kind === 'file'
        ? signal.label
        : taskSeq
          ? `task-${taskSeq}.ts`
          : 'workspace.ts';
    ctx.fillText(tabName, 98, 23);

    // Status Badge bên phải thanh tiêu đề
    let badgeText = '● STANDBY';
    let badgeBg = '#334155';
    let badgeFg = '#94A3B8';
    if (isWorking) {
      badgeText = '▶ RUNNING';
      badgeBg = 'rgba(16, 185, 129, 0.2)';
      badgeFg = '#34D399';
    } else if (isWaiting) {
      badgeText = '⏸ AWAITING';
      badgeBg = 'rgba(245, 158, 11, 0.2)';
      badgeFg = '#FBBF24';
    } else if (isError) {
      badgeText = '✕ ERROR';
      badgeBg = 'rgba(239, 68, 68, 0.2)';
      badgeFg = '#F87171';
    }

    ctx.fillStyle = badgeBg;
    ctx.beginPath();
    ctx.roundRect(410, 8, 90, 18, 4);
    ctx.fill();

    ctx.font = 'bold 10px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = badgeFg;
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, 455, 21);
    ctx.textAlign = 'left';

    // 2. CODE EDITOR BODY
    // Line numbers column
    ctx.fillStyle = '#141B26';
    ctx.fillRect(0, 34, 42, 180);

    ctx.font = '11px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#475569';
    for (let i = 1; i <= 8; i++) {
      ctx.fillText(String(i).padStart(2, '0'), 12, 36 + i * 20);
    }

    // Code Lines
    const startY = 36;
    const lineHeight = 20;

    if (isWorking) {
      // Dòng 1: import
      ctx.fillStyle = '#C084FC'; // purple
      ctx.fillText('import', 52, startY + lineHeight);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(' { voragent } ', 98, startY + lineHeight);
      ctx.fillStyle = '#C084FC';
      ctx.fillText('from', 190, startY + lineHeight);
      ctx.fillStyle = '#34D399'; // green string
      ctx.fillText(" '@voragent/core';", 225, startY + lineHeight);

      // Dòng 2: comment task
      ctx.fillStyle = '#64748B';
      const liveLine =
        signalLabel !== ''
          ? `${signalLabel}${signalDetail !== '' ? `: ${signalDetail}` : ''}`
          : taskTitle || 'Executing assigned plan';
      ctx.fillText(`// ${liveLine.slice(0, 52)}`, 52, startY + lineHeight * 2);

      // Dòng 3: async function
      ctx.fillStyle = '#60A5FA'; // blue
      ctx.fillText('export async function', 52, startY + lineHeight * 3);
      ctx.fillStyle = '#FCD34D'; // yellow
      ctx.fillText(' runExecution', 205, startY + lineHeight * 3);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText('() {', 315, startY + lineHeight * 3);

      // Dòng 4: const worktree
      ctx.fillStyle = '#C084FC';
      ctx.fillText('  const', 52, startY + lineHeight * 4);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(' wt = ', 96, startY + lineHeight * 4);
      ctx.fillStyle = '#60A5FA';
      ctx.fillText('await', 135, startY + lineHeight * 4);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(' voragent.', 175, startY + lineHeight * 4);
      ctx.fillStyle = '#38BDF8';
      ctx.fillText('checkout', 242, startY + lineHeight * 4);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText('();', 302, startY + lineHeight * 4);

      // Dòng 5: streaming / typing line with blinking cursor
      ctx.fillStyle = '#E2E8F0';
      const typingText =
        signalDetail !== ''
          ? `  ${signalDetail}`
          : '  await wt.applyPatches({ verify: true });';
      const charCount = (tick % 24) + 10;
      ctx.fillText(typingText.slice(0, charCount), 52, startY + lineHeight * 5);

      // Con trỏ nhấp nháy
      if (Math.sin(tick * 0.8) > 0) {
        ctx.fillStyle = agentColor;
        const cursorX = 52 + ctx.measureText(typingText.slice(0, charCount)).width + 2;
        ctx.fillRect(cursorX, startY + lineHeight * 5 - 11, 7, 13);
      }

      // Dòng 6: return
      ctx.fillStyle = '#C084FC';
      ctx.fillText('  return', 52, startY + lineHeight * 6);
      ctx.fillStyle = '#34D399';
      ctx.fillText(" { status: 'COMPLETED' };", 102, startY + lineHeight * 6);

      // Dòng 7: }
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText('}', 52, startY + lineHeight * 7);
    } else if (isWaiting) {
      // Hiển thị trạng thái chờ duyệt hoặc Quota
      ctx.fillStyle = '#F59E0B';
      ctx.fillText('// ⚠ NHIỆM VỤ ĐANG TẠM DỪNG CHỜ PHẢN HỒI', 52, startY + lineHeight);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText('const reason = ', 52, startY + lineHeight * 2);
      ctx.fillStyle = '#FCD34D';
      ctx.fillText("'AWAITING_USER_CONFIRMATION';", 160, startY + lineHeight * 2);
      ctx.fillStyle = '#64748B';
      ctx.fillText('// Hãy kiểm tra bảng tương tác để duyệt tiếp...', 52, startY + lineHeight * 3);

      // Hộp thoại cảnh báo ấm
      ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(52, startY + lineHeight * 4, 430, 48, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FBBF24';
      ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('⚡ Đang chờ duyệt kế hoạch từ Trưởng Phòng / Bạn', 70, startY + lineHeight * 4 + 28);
    } else if (isError) {
      // Hiển thị trạng thái lỗi
      ctx.fillStyle = '#EF4444';
      ctx.fillText('// ✕ TIẾN TRÌNH GẶP LỖI THỰC THI', 52, startY + lineHeight);
      ctx.fillStyle = '#F87171';
      ctx.fillText('throw new TaskRuntimeError("Quota or process failed");', 52, startY + lineHeight * 2);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(52, startY + lineHeight * 3.5, 430, 52, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FCA5A5';
      ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('⚠ Vui lòng bấm vào Agent để xem chi tiết lỗi', 70, startY + lineHeight * 3.5 + 30);
    } else {
      // Trạng thái nghỉ ngơi / Standby: Màn hình chờ phong cách Dev Aesthetic
      ctx.fillStyle = '#64748B';
      ctx.fillText('/** VORAGENT AGENT WORKSPACE · STANDBY **/', 52, startY + lineHeight);

      ctx.fillStyle = '#C084FC';
      ctx.fillText('const', 52, startY + lineHeight * 2);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(' currentAgent = ', 96, startY + lineHeight * 2);
      ctx.fillStyle = '#34D399';
      ctx.fillText(`'${agent?.name || 'Agent'}';`, 215, startY + lineHeight * 2);

      ctx.fillStyle = '#60A5FA';
      ctx.fillText('voragent.', 52, startY + lineHeight * 3);
      ctx.fillStyle = '#FCD34D';
      ctx.fillText('readyForTask', 125, startY + lineHeight * 3);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText('({ role: ', 218, startY + lineHeight * 3);
      ctx.fillStyle = '#34D399';
      ctx.fillText(`'${agent?.role || 'Lập trình'}'`, 280, startY + lineHeight * 3);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(' });', 420, startY + lineHeight * 3);

      // Ma trận hạt ánh sáng nhẹ nhàng khi rảnh
      const waveX = (Math.sin(tick * 0.15) * 60 + 260);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.fillText('💤 Sẵn sàng nhận việc mới · Bấm để giao việc', 52, startY + lineHeight * 5);

      // Điểm sáng nhẹ
      ctx.fillStyle = agentColor;
      ctx.beginPath();
      ctx.arc(waveX, startY + lineHeight * 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. MINI TERMINAL PANEL (ở đáy màn hình)
    ctx.fillStyle = '#090D13';
    ctx.fillRect(0, 214, 512, 74);
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(0, 214, 512, 1); // Đường kẻ phân cách

    // Tab Terminal Header
    ctx.font = 'bold 10px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText('TERMINAL', 16, 228);
    ctx.fillStyle = '#475569';
    ctx.fillText('OUTPUT · PROBLEMS (0)', 85, 228);

    // Terminal Lines
    ctx.font = '10.5px "JetBrains Mono", Consolas, monospace';
    if (isWorking) {
      ctx.fillStyle = '#38BDF8';
      ctx.fillText(`$ ${signalLabel || 'voragent worker run --watch'}`, 16, 248);
      ctx.fillStyle = '#34D399';
      ctx.fillText(
        signalDetail !== '' ? `› ${signalDetail.slice(0, 72)}` : '✓ test suites passing · build finished in 1.4s',
        16,
        268,
      );
    } else if (isWaiting) {
      ctx.fillStyle = '#F59E0B';
      ctx.fillText(`$ voragent status: ${signalLabel || 'awaiting_approval'}`, 16, 248);
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(
        signalDetail !== '' ? `› ${signalDetail.slice(0, 72)}` : 'Worker thread suspended · waiting signal...',
        16,
        268,
      );
    } else if (isError) {
      ctx.fillStyle = '#EF4444';
      ctx.fillText(
        signalDetail !== '' ? `$ ${signalDetail.slice(0, 72)}` : '$ voragent exit code 1 · Check logs',
        16,
        258,
      );
    } else {
      ctx.fillStyle = '#64748B';
      ctx.fillText('$ voragent daemon connected · ping 1ms', 16, 248);
      ctx.fillStyle = '#10B981';
      ctx.fillText('● idle & ready for assignment', 16, 268);
    }

    // Cập nhật Three.js texture
    texture.needsUpdate = true;
  });

  const glowColor = agent?.state === 'working' ? agent.baseColor : agent?.state === 'waiting' ? '#F59E0B' : '#64748B';
  const emissiveInt = agent?.state === 'working' ? 0.85 : 0.35;

  return (
    <group position={[-0.2, 1.48, 0.35]}>
      {/* Vỏ màn hình viền kim loại tối */}
      <mesh castShadow>
        <boxGeometry args={[width, height, 0.05]} />
        <meshStandardMaterial color="#1E293B" roughness={0.4} />
      </mesh>

      {/* Mặt màn hình hiển thị code (QUAY MẶT VỀ PHÍA CHÚ RẮN VÀ CAMERA: rotation.y = Math.PI) */}
      <mesh position={[0, 0, -0.026]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width - 0.06, height - 0.06]} />
        <meshStandardMaterial
          map={texture}
          emissive={new THREE.Color(glowColor)}
          emissiveMap={texture}
          emissiveIntensity={emissiveInt}
          roughness={0.2}
        />
      </mesh>

      {/* Logo công nghệ phát sáng ở mặt lưng màn hình (thẩm mỹ khi nhìn từ phía sau) */}
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[0.2, 0.2]} />
        <meshStandardMaterial
          color="#0F172A"
          emissive={new THREE.Color(glowColor)}
          emissiveIntensity={0.6}
          roughness={0.3}
        />
      </mesh>

      {/* Chân đế màn hình kim loại sang trọng */}
      <mesh position={[0, -0.28, 0.04]}>
        <cylinderGeometry args={[0.03, 0.03, 0.35]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.42, 0.04]}>
        <boxGeometry args={[0.3, 0.02, 0.2]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
      </mesh>
    </group>
  );
}

// ==========================================
// 2. SECONDARY MONITOR (TELEMETRY & METRICS)
// ==========================================
export function SecondaryDeskMonitor({
  agent,
  width = 0.85,
  height = 0.55,
}: {
  agent?: OfficeAgentData;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const lastUpdateRef = useRef(0);
  const frameCountRef = useRef(0);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 248;
    canvasRef.current = canvas;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    textureRef.current = tex;
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      texture.dispose();
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    };
  }, [texture]);

  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (now - lastUpdateRef.current < 0.12) return;
    lastUpdateRef.current = now;
    frameCountRef.current++;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = frameCountRef.current;
    const isWorking = agent?.state === 'working';
    const agentColor = agent?.baseColor || '#38BDF8';

    // Nền tối công nghệ
    ctx.fillStyle = '#0A0E17';
    ctx.fillRect(0, 0, 384, 248);

    // Header bar
    ctx.fillStyle = '#131B2B';
    ctx.fillRect(0, 0, 384, 28);

    ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#38BDF8';
    ctx.fillText('📊 TELEMETRY', 12, 19);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(agent?.provider?.toUpperCase() || 'NODE', 110, 19);

    // CPU Bar -> Thanh hạn mức thật của CLI
    const quota = typeof agent?.quotaPercent === 'number' ? Math.round(agent.quotaPercent * 100) : null;
    const quotaUsage = quota ?? 0;
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(quota === null ? 'QUOTA: CHƯA RÕ' : `QUOTA ĐÃ DÙNG: ${quota}%`, 12, 52);

    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.roundRect(12, 60, 360, 14, 4);
    ctx.fill();

    const cpuGradient = ctx.createLinearGradient(12, 0, 372, 0);
    cpuGradient.addColorStop(0, quota !== null && quota >= 85 ? '#F59E0B' : '#38BDF8');
    cpuGradient.addColorStop(1, quota !== null && quota >= 100 ? '#EF4444' : '#10B981');
    ctx.fillStyle = cpuGradient;
    ctx.beginPath();
    ctx.roundRect(12, 60, Math.max(2, (360 * quotaUsage) / 100), 14, 4);
    ctx.fill();

    // Memory Bar -> Nhịp tác vụ thật theo trạng thái agent
    const loadPercent = isWorking ? 100 : agent?.state === 'waiting' ? 55 : 12;
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(
      `TÁC VỤ: ${isWorking ? 'ĐANG CHẠY' : agent?.state === 'waiting' ? 'CHỜ DUYỆT' : 'SẴN SÀNG'}`,
      12,
      96,
    );

    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.roundRect(12, 104, 360, 14, 4);
    ctx.fill();

    ctx.fillStyle = agentColor;
    ctx.beginPath();
    ctx.roundRect(12, 104, (360 * loadPercent) / 100, 14, 4);
    ctx.fill();

    // Live Activity Sparkline Graph
    ctx.fillStyle = '#64748B';
    ctx.fillText('ACTIVITY REAL-TIME FLOW:', 12, 142);

    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.roundRect(12, 150, 360, 78, 6);
    ctx.fill();

    // Lưới tọa độ mờ
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, 189);
    ctx.lineTo(372, 189);
    ctx.stroke();

    // Biểu đồ sóng động
    ctx.strokeStyle = isWorking ? agentColor : '#10B981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= 360; x += 10) {
      const graphY = isWorking
        ? 189 + Math.sin((x + tick * 8) * 0.05) * 24 * Math.cos((x + tick * 3) * 0.02)
        : 189 + Math.sin((x + tick * 2) * 0.03) * 6;
      if (x === 0) ctx.moveTo(12 + x, graphY);
      else ctx.lineTo(12 + x, graphY);
    }
    ctx.stroke();

    texture.needsUpdate = true;
  });

  return (
    <group position={[0.95, 1.45, 0.2]} rotation={[0, -0.4, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width, height, 0.04]} />
        <meshStandardMaterial color="#1E293B" roughness={0.4} />
      </mesh>

      {/* Mặt hiển thị phụ hướng về phía chú rắn */}
      <mesh position={[0, 0, -0.022]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width - 0.05, height - 0.05]} />
        <meshStandardMaterial
          map={texture}
          emissive={new THREE.Color('#38BDF8')}
          emissiveMap={texture}
          emissiveIntensity={0.4}
          roughness={0.2}
        />
      </mesh>

      {/* Chân đế */}
      <mesh position={[0, -0.25, 0.04]}>
        <cylinderGeometry args={[0.025, 0.025, 0.3]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

// ==========================================
// 3. MANAGER ULTRAWIDE MONITOR (COMMAND CENTER)
// ==========================================
export function ManagerUltrawideMonitor({
  workers = [],
  queuedCount = 0,
  width = 1.6,
  height = 0.72,
}: {
  workers?: OfficeAgentData[];
  queuedCount?: number;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const lastUpdateRef = useRef(0);
  const frameCountRef = useRef(0);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 672;
    canvas.height = 288; // 21:9 ultrawide
    canvasRef.current = canvas;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    textureRef.current = tex;
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      texture.dispose();
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    };
  }, [texture]);

  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (now - lastUpdateRef.current < 0.12) return;
    lastUpdateRef.current = now;
    frameCountRef.current++;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Nền trung tâm chỉ huy tím hoàng gia tối
    ctx.fillStyle = '#0D0B1C';
    ctx.fillRect(0, 0, 672, 288);

    // Header trung tâm điều hành
    ctx.fillStyle = '#1A1633';
    ctx.fillRect(0, 0, 672, 36);

    ctx.font = 'bold 13px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#A78BFA';
    ctx.fillText('👑 VORAGENT COMMAND CENTER · ĐIỀU PHỐI TỔNG THỂ', 18, 23);

    ctx.fillStyle = '#F59E0B';
    ctx.fillText(`HÀNG ĐỢI: ${queuedCount}`, 540, 23);

    // 3 Cột theo dõi 3 Agent bên dưới
    const colWidth = 206;
    const colGap = 12;
    const startX = 18;

    workers.forEach((worker, i) => {
      const colX = startX + i * (colWidth + colGap);
      const isWorking = worker.state === 'working';
      const isWaiting = worker.state === 'waiting';

      ctx.fillStyle = '#141226';
      ctx.beginPath();
      ctx.roundRect(colX, 48, colWidth, 185, 8);
      ctx.fill();

      // Header card nhân viên
      ctx.fillStyle = isWorking ? worker.baseColor : '#6D28D9';
      ctx.beginPath();
      ctx.roundRect(colX, 48, colWidth, 28, [8, 8, 0, 0]);
      ctx.fill();

      ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(worker.name, colX + 10, 67);

      // Status pill
      ctx.font = '10px "JetBrains Mono", Consolas, monospace';
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(`Vai trò: ${worker.role}`, colX + 10, 96);

      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`Trạng thái:`, colX + 10, 116);
      ctx.fillStyle = isWorking ? '#34D399' : isWaiting ? '#FBBF24' : '#94A3B8';
      ctx.fillText(isWorking ? '● Đang làm việc' : isWaiting ? '⏸ Chờ duyệt' : '○ Nghỉ ngơi', colX + 85, 116);

      // Task hiện tại
      if (worker.currentTask) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.beginPath();
        ctx.roundRect(colX + 8, 130, colWidth - 16, 50, 4);
        ctx.fill();

        ctx.fillStyle = '#FCD34D';
        ctx.fillText(`Task #${worker.currentTask.seq}`, colX + 14, 148);
        ctx.fillStyle = '#CBD5E1';
        const msg = worker.currentTask.title || '';
        ctx.fillText(msg.slice(0, 22), colX + 14, 166);
      } else {
        ctx.fillStyle = '#475569';
        ctx.fillText('Chưa có task gán', colX + 10, 150);
      }
    });

    // Thanh Footer báo cáo hệ thống
    ctx.fillStyle = '#110E24';
    ctx.fillRect(0, 245, 672, 43);
    ctx.strokeStyle = '#2E1065';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 245);
    ctx.lineTo(672, 245);
    ctx.stroke();

    ctx.font = '11px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#10B981';
    ctx.fillText('● SYSTEM STATUS: ONLINE', 18, 270);

    ctx.fillStyle = '#A78BFA';
    ctx.fillText('QUOTA MONITOR: HEALTHY · WORKTREE ISOLATION ACTIVE', 210, 270);

    texture.needsUpdate = true;
  });

  return (
    <group position={[0, 1.52, 0.38]}>
      {/* Khung viền màn hình siêu rộng Trưởng phòng */}
      <mesh castShadow>
        <boxGeometry args={[width, height, 0.05]} />
        <meshStandardMaterial color="#1E1B4B" roughness={0.4} />
      </mesh>

      {/* Mặt hiển thị siêu rộng hướng về phía Trưởng phòng (rotation.y = Math.PI) */}
      <mesh position={[0, 0, -0.028]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width - 0.08, height - 0.07]} />
        <meshStandardMaterial
          map={texture}
          emissive={new THREE.Color('#8B5CF6')}
          emissiveMap={texture}
          emissiveIntensity={0.65}
          roughness={0.2}
        />
      </mesh>

      {/* Logo Vương miện phát sáng sau lưng màn hình Trưởng phòng */}
      <mesh position={[0, 0, 0.028]}>
        <planeGeometry args={[0.26, 0.26]} />
        <meshStandardMaterial
          color="#1E1B4B"
          emissive={new THREE.Color('#A78BFA')}
          emissiveIntensity={0.7}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}
