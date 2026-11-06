import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ProviderIcon } from '../components/ProviderIcon';
import type { AgentAccessory, OfficeAgentData } from './types';

interface SnakeMeshProps {
  agent: OfficeAgentData;
  targetPosition: [number, number, number];
  isSelected?: boolean;
  onClick?: () => void;
}

const N = 14;      // Số điểm kiểm soát thân
const NECK = 5;   // Số điểm đoạn cổ
const TUBE_SEGS = 64;
const RAD_SEGS = 12;
const TAILK = 4;   // Số điểm đoạn đuôi dùng để vẫy
const DARK = '#1E293B';

// Hàm tính bán kính thân ống: cổ ~90% thân, thon dần đều về chóp đuôi
export const calcRadius = (u: number): number => {
  return (0.06 + 0.17 * Math.pow(1 - u, 0.6)) * (0.88 + 0.12 * THREE.MathUtils.smoothstep(u, 0, 0.15));
};

/** Đặt lại tư thế cuộn tròn sạch sẽ mỗi frame để tránh cộng dồn đuôi vô tận */
function updateCoiledSpine(pts: THREE.Vector3[], headPos: THREE.Vector3) {
  const coilCenter = new THREE.Vector3(0, 0.08, -0.2);
  const sPoint = new THREE.Vector3(coilCenter.x + 0.4, 0.08, coilCenter.z);

  pts.forEach((p, i) => {
    const r = calcRadius((i + 1) / N);
    if (i < NECK) {
      const u = (i + 1) / (NECK + 1);
      p.copy(headPos).lerp(sPoint, u);
      p.y = headPos.y * (1 - u) * (1 - u * 0.3) + r * u;
    } else {
      const k = i - NECK;
      const a = k * 0.9;
      const rr = 0.55 - k * 0.035;
      p.set(coilCenter.x + Math.cos(a) * rr, r, coilCenter.z + Math.sin(a) * rr);
    }
  });
}

export function SnakeMesh({ agent, targetPosition, isSelected = false, onClick }: SnakeMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const bodyMeshRef = useRef<THREE.Mesh>(null);
  const tailRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // Vị trí hiện tại của toàn bộ con rắn
  const currentRootPos = useRef<THREE.Vector3>(new THREE.Vector3(...targetPosition));

  // Tham chiếu các thành phần biểu cảm
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const leftPupilRef = useRef<THREE.Mesh>(null);
  const rightPupilRef = useRef<THREE.Mesh>(null);
  const leftLidRef = useRef<THREE.Mesh>(null);
  const rightLidRef = useRef<THREE.Mesh>(null);
  const leftBrowRef = useRef<THREE.Mesh>(null);
  const rightBrowRef = useRef<THREE.Mesh>(null);

  // Mắt vui / ngủ / choáng
  const leftHappyRef = useRef<THREE.Mesh>(null);
  const rightHappyRef = useRef<THREE.Mesh>(null);
  const leftSleepRef = useRef<THREE.Mesh>(null);
  const rightSleepRef = useRef<THREE.Mesh>(null);
  const leftXRef = useRef<THREE.Group>(null);
  const rightXRef = useRef<THREE.Group>(null);

  // Miệng
  const mouthSmileRef = useRef<THREE.Mesh>(null);
  const mouthFrownRef = useRef<THREE.Mesh>(null);
  const mouthORef = useRef<THREE.Mesh>(null);
  const mouthWavyRef = useRef<THREE.Group>(null);

  // Hiệu ứng cảm xúc
  const sweatDropRef = useRef<THREE.Mesh>(null);
  const tearDropRef = useRef<THREE.Mesh>(null);
  const tongueRef = useRef<THREE.Mesh>(null);
  const starsGroupRef = useRef<THREE.Group>(null);
  const zzzGroupRef = useRef<THREE.Group>(null);

  const baseColor = useMemo(() => new THREE.Color(agent.baseColor), [agent.baseColor]);
  const bandColor = useMemo(() => new THREE.Color(agent.bandColor), [agent.bandColor]);

  // Các điểm spline của thân
  const spinePoints = useMemo(() => {
    return Array.from({ length: N }, () => new THREE.Vector3());
  }, []);

  const seed = useMemo(() => Math.random() * 10, []);

  // Render loop cập nhật vị trí trườn, biểu cảm, chớp mắt, nhịp thở và vẫy đuôi
  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    if (!headRef.current || !bodyMeshRef.current || !tailRef.current || !groupRef.current) return;

    // 1. Chuyển động Trườn giữa Bàn làm việc & Khu nghỉ ngơi
    const dest = new THREE.Vector3(...targetPosition);
    const distToDest = currentRootPos.current.distanceTo(dest);
    const isMoving = distToDest > 0.08;

    if (isMoving) {
      // Nội suy vị trí dịch chuyển mượt mà
      const moveStep = Math.min(distToDest, delta * 3.5);
      const moveDir = dest.clone().sub(currentRootPos.current).normalize();
      currentRootPos.current.addScaledVector(moveDir, moveStep);
      groupRef.current.position.copy(currentRootPos.current);

      // Xoay hướng toàn thân về hướng di chuyển
      const targetAngle = Math.atan2(moveDir.x, moveDir.z);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetAngle, delta * 6);

      // Tư thế đang trườn: kéo dài thân về phía sau theo làn sóng sin
      spinePoints.forEach((p, i) => {
        const segDist = (i + 1) * 0.22;
        const wave = Math.sin(t * 10 - i * 0.5) * 0.16;
        p.set(wave, calcRadius((i + 1) / N), -segDist);
      });
      headRef.current.position.set(0, 0.45, 0.2);
    } else {
      groupRef.current.position.copy(dest);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, delta * 4);
    }

    const expr = agent.expression;
    const isSleeping = expr === 'sleep';
    const isPleading = expr === 'plead';
    const isWorking = expr === 'focus';
    const isHappy = expr === 'happy';
    const isSad = expr === 'sad';
    const isDizzy = expr === 'dizzy';
    const isSurprised = expr === 'surprised';

    // 2. Nhịp thở & rướn đầu khi đứng yên cuộn tròn
    if (!isMoving) {
      const baseHeadY = isSleeping ? 0.35 : isPleading ? 1.45 : isSad ? 0.95 : 1.25;
      const breathe = Math.sin(t * (isSleeping ? 1.2 : 2.5) + seed) * (isSleeping ? 0.02 : 0.04);
      headRef.current.position.set(0, baseHeadY + breathe, 0.45);
      headRef.current.rotation.x = isSad ? 0.3 : isPleading ? -0.15 : 0;

      // QUAN TRỌNG: Đặt lại tư thế cuộn tròn tươi mới mỗi frame trước khi vẫy đuôi!
      updateCoiledSpine(spinePoints, headRef.current.position);

      // 3. Chuyển động Vẫy đuôi (Tail Wagging) — tính toán độ lệch tương đối
      const wagSpeed = isSleeping ? 0.8 : isWorking ? 3.0 : isPleading ? 7.0 : isHappy ? 10.0 : isDizzy ? 5.0 : 3.5;
      const wagSwing = isSleeping ? 0.03 : isWorking ? 0.12 : isPleading ? 0.22 : isHappy ? 0.28 : 0.15;
      const wagLift = isSleeping ? 0.01 : isHappy ? 0.12 : 0.06;

      const endIdx = N - TAILK - 1;
      const lastIdx = N - 1;
      const pEnd = spinePoints[endIdx] ?? spinePoints[0];
      const pLast = spinePoints[lastIdx] ?? spinePoints[0];

      if (pEnd && pLast) {
        const dir = new THREE.Vector3().subVectors(pLast, pEnd).setY(0).normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x);

        for (let j = 1; j <= TAILK; j++) {
          const k = j / TAILK;
          const w = Math.sin(t * wagSpeed + seed - j * 0.6) * wagSwing * k * k;
          const pt = spinePoints[endIdx + j];
          if (pt) {
            pt.addScaledVector(side, w);
            pt.y += wagLift * k * k;
          }
        }
      }
    }

    // 4. Tái dựng thân ống TubeGeometry
    const curve = new THREE.CatmullRomCurve3([headRef.current.position, ...spinePoints], false, 'centripetal');
    const tubeGeo = new THREE.TubeGeometry(curve, TUBE_SEGS, 1, RAD_SEGS, false);
    const posAttr = tubeGeo.attributes.position;
    if (posAttr) {
      const colors = new Float32Array(posAttr.count * 3);
      const ptOnCurve = new THREE.Vector3();
      const v = new THREE.Vector3();

      for (let j = 0; j <= TUBE_SEGS; j++) {
        const u = j / TUBE_SEGS;
        curve.getPointAt(u, ptOnCurve);
        const r = calcRadius(u);
        const col = Math.floor(u * 14) % 2 === 1 ? bandColor : baseColor;

        for (let k = 0; k <= RAD_SEGS; k++) {
          const idx = j * (RAD_SEGS + 1) + k;
          v.fromBufferAttribute(posAttr as THREE.BufferAttribute, idx).sub(ptOnCurve).multiplyScalar(r).add(ptOnCurve);
          posAttr.setXYZ(idx, v.x, v.y, v.z);
          colors.set([col.r, col.g, col.b], idx * 3);
        }
      }

      tubeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      tubeGeo.computeVertexNormals();

      bodyMeshRef.current.geometry.dispose();
      bodyMeshRef.current.geometry = tubeGeo;
    }
    const endPoint = spinePoints[N - 1];
    if (endPoint) tailRef.current.position.copy(endPoint);

    // 5. Biểu cảm khuôn mặt
    const isBlinking = !isSleeping && !isHappy && !isDizzy && (t + seed) % 3.8 < 0.14;
    const isNormalEyes = !isSleeping && !isHappy && !isDizzy;

    if (leftEyeRef.current) leftEyeRef.current.visible = isNormalEyes;
    if (rightEyeRef.current) rightEyeRef.current.visible = isNormalEyes;
    if (leftPupilRef.current) leftPupilRef.current.visible = isNormalEyes;
    if (rightPupilRef.current) rightPupilRef.current.visible = isNormalEyes;
    if (leftLidRef.current) leftLidRef.current.visible = isNormalEyes;
    if (rightLidRef.current) rightLidRef.current.visible = isNormalEyes;

    if (leftHappyRef.current) leftHappyRef.current.visible = isHappy;
    if (rightHappyRef.current) rightHappyRef.current.visible = isHappy;
    if (leftSleepRef.current) leftSleepRef.current.visible = isSleeping;
    if (rightSleepRef.current) rightSleepRef.current.visible = isSleeping;
    if (leftXRef.current) {
      leftXRef.current.visible = isDizzy;
      if (isDizzy) leftXRef.current.rotation.z = t * 3.5;
    }
    if (rightXRef.current) {
      rightXRef.current.visible = isDizzy;
      if (isDizzy) rightXRef.current.rotation.z = -t * 3.5;
    }

    const lidAngle = isBlinking ? 0.95 : isWorking ? 0.45 : isSad ? 0.35 : 0.0;
    if (leftLidRef.current) leftLidRef.current.rotation.x = -Math.PI / 2 + lidAngle * Math.PI;
    if (rightLidRef.current) rightLidRef.current.rotation.x = -Math.PI / 2 + lidAngle * Math.PI;

    let px = 0;
    let py = 0;
    if (isWorking) {
      px = Math.sin(t * 2.8) * 0.025;
      py = -0.015;
    } else if (isPleading) {
      py = 0.025;
    } else if (isSad) {
      py = -0.035;
    }
    if (leftPupilRef.current) {
      leftPupilRef.current.position.set(px, py, 0.08);
      const pupilScale = isPleading ? 1.25 : isSurprised ? 0.6 : 1.0;
      leftPupilRef.current.scale.set(pupilScale, pupilScale, pupilScale * 0.4);
    }
    if (rightPupilRef.current) {
      rightPupilRef.current.position.set(px, py, 0.08);
      const pupilScale = isPleading ? 1.25 : isSurprised ? 0.6 : 1.0;
      rightPupilRef.current.scale.set(pupilScale, pupilScale, pupilScale * 0.4);
    }

    const browAngle = isWorking ? -0.3 : isPleading ? 0.4 : isSad ? 0.5 : 0;
    if (leftBrowRef.current) {
      leftBrowRef.current.position.y = 0.24 + (isSurprised ? 0.05 : 0);
      leftBrowRef.current.rotation.z = browAngle;
    }
    if (rightBrowRef.current) {
      rightBrowRef.current.position.y = 0.24 + (isSurprised ? 0.05 : 0);
      rightBrowRef.current.rotation.z = -browAngle;
    }

    if (mouthSmileRef.current) mouthSmileRef.current.visible = isHappy;
    if (mouthFrownRef.current) mouthFrownRef.current.visible = isSad;
    if (mouthORef.current) {
      mouthORef.current.visible = isPleading || isSurprised;
      if (isPleading || isSurprised) {
        mouthORef.current.scale.y = 1.2 + Math.sin(t * 4) * 0.2;
      }
    }
    if (mouthWavyRef.current) mouthWavyRef.current.visible = isDizzy;

    if (sweatDropRef.current) {
      sweatDropRef.current.visible = isPleading;
      if (isPleading) {
        sweatDropRef.current.position.y = 0.3 - ((t * 0.6) % 1) * 0.28;
      }
    }

    if (tearDropRef.current) {
      tearDropRef.current.visible = isSad;
      if (isSad) {
        tearDropRef.current.position.y = 0.05 - ((t * 0.5) % 1) * 0.22;
      }
    }

    if (tongueRef.current) {
      const flickTongue = isWorking && (t * 1.2 + seed) % 2.5 < 0.25;
      tongueRef.current.scale.z = flickTongue ? 1.0 : 0.001;
    }

    if (starsGroupRef.current) {
      starsGroupRef.current.visible = isDizzy;
      if (isDizzy) {
        starsGroupRef.current.children.forEach((star, idx) => {
          const a = idx * ((Math.PI * 2) / 3) + t * 3.0;
          star.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
          star.rotation.y = t * 4;
        });
      }
    }

    if (zzzGroupRef.current) {
      zzzGroupRef.current.visible = isSleeping;
      if (isSleeping) {
        zzzGroupRef.current.children.forEach((zEl, idx) => {
          const cycle = ((t * 0.4 + idx * 0.33) % 1);
          zEl.position.set(0.18 + Math.sin(cycle * 3) * 0.08, 0.45 + cycle * 0.5, 0.2);
          zEl.scale.setScalar(0.7 + cycle * 0.5);
        });
      }
    }
  });

  // Chỉ hiện nhãn nổi khi Agent đang làm việc, chờ duyệt, là Trưởng phòng, hoặc đang được hover/chọn
  // (Tránh để nhãn của các Agent đang nghỉ ở góc phòng trôi lơ lửng che giao diện)
  const showFloatingBadge =
    isSelected || hovered || agent.isManager || (agent.isOnline && agent.state !== 'idle');

  return (
    <group
      ref={groupRef}
      position={targetPosition}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Vòng sáng tương tác dưới chân khi hover hoặc đang được chọn */}
      {(isSelected || hovered) && (
        <mesh position={[0, 0.02, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.92, 1.08, 36]} />
          <meshBasicMaterial
            color={isSelected ? agent.baseColor : '#F59E0B'}
            transparent
            opacity={isSelected ? 0.85 : 0.55}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Thân rắn hình ống có vân màu */}
      <mesh ref={bodyMeshRef} castShadow receiveShadow>
        <bufferGeometry />
        <meshStandardMaterial vertexColors roughness={0.4} />
      </mesh>

      {/* Chóp đuôi tròn */}
      <mesh ref={tailRef} castShadow>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial color={agent.baseColor} roughness={0.4} />
      </mesh>

      {/* Đầu rắn & Khuôn mặt biểu cảm */}
      <group ref={headRef}>
        <mesh castShadow scale={[1.15, 0.95, 1.1]}>
          <sphereGeometry args={[0.34, 24, 20]} />
          <meshStandardMaterial color={agent.baseColor} roughness={0.4} />
        </mesh>

        {/* ================= MẮT TRÁI ================= */}
        <group position={[-0.15, 0.1, 0.28]}>
          <mesh ref={leftEyeRef}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshStandardMaterial color="#FFFFFF" roughness={0.2} />
          </mesh>
          <mesh ref={leftPupilRef} position={[0, 0, 0.09]}>
            <sphereGeometry args={[0.065, 12, 12]} />
            <meshStandardMaterial color={DARK} roughness={0.1} />
          </mesh>
          <mesh ref={leftLidRef} rotation={[-Math.PI / 2, 0, 0]}>
            <sphereGeometry args={[0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={agent.baseColor} roughness={0.4} />
          </mesh>
          <mesh ref={leftHappyRef} visible={false} position={[0, -0.02, 0.06]}>
            <torusGeometry args={[0.07, 0.022, 8, 20, Math.PI]} />
            <meshStandardMaterial color={DARK} />
          </mesh>
          <mesh ref={leftSleepRef} visible={false} position={[0, 0.03, 0.06]} rotation={[0, 0, Math.PI]}>
            <torusGeometry args={[0.07, 0.02, 8, 20, Math.PI]} />
            <meshStandardMaterial color={DARK} />
          </mesh>
          <group ref={leftXRef} visible={false} position={[0, 0, 0.06]}>
            <mesh rotation={[0, 0, 0.8]}>
              <boxGeometry args={[0.16, 0.035, 0.03]} />
              <meshStandardMaterial color={DARK} />
            </mesh>
            <mesh rotation={[0, 0, -0.8]}>
              <boxGeometry args={[0.16, 0.035, 0.03]} />
              <meshStandardMaterial color={DARK} />
            </mesh>
          </group>
        </group>

        {/* Lông mày trái */}
        <mesh ref={leftBrowRef} position={[-0.15, 0.24, 0.25]}>
          <boxGeometry args={[0.14, 0.03, 0.03]} />
          <meshStandardMaterial color={DARK} />
        </mesh>

        {/* ================= MẮT PHẢI ================= */}
        <group position={[0.15, 0.1, 0.28]}>
          <mesh ref={rightEyeRef}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshStandardMaterial color="#FFFFFF" roughness={0.2} />
          </mesh>
          <mesh ref={rightPupilRef} position={[0, 0, 0.09]}>
            <sphereGeometry args={[0.065, 12, 12]} />
            <meshStandardMaterial color={DARK} roughness={0.1} />
          </mesh>
          <mesh ref={rightLidRef} rotation={[-Math.PI / 2, 0, 0]}>
            <sphereGeometry args={[0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={agent.baseColor} roughness={0.4} />
          </mesh>
          <mesh ref={rightHappyRef} visible={false} position={[0, -0.02, 0.06]}>
            <torusGeometry args={[0.07, 0.022, 8, 20, Math.PI]} />
            <meshStandardMaterial color={DARK} />
          </mesh>
          <mesh ref={rightSleepRef} visible={false} position={[0, 0.03, 0.06]} rotation={[0, 0, Math.PI]}>
            <torusGeometry args={[0.07, 0.02, 8, 20, Math.PI]} />
            <meshStandardMaterial color={DARK} />
          </mesh>
          <group ref={rightXRef} visible={false} position={[0, 0, 0.06]}>
            <mesh rotation={[0, 0, 0.8]}>
              <boxGeometry args={[0.16, 0.035, 0.03]} />
              <meshStandardMaterial color={DARK} />
            </mesh>
            <mesh rotation={[0, 0, -0.8]}>
              <boxGeometry args={[0.16, 0.035, 0.03]} />
              <meshStandardMaterial color={DARK} />
            </mesh>
          </group>
        </group>

        {/* Lông mày phải */}
        <mesh ref={rightBrowRef} position={[0.15, 0.24, 0.25]}>
          <boxGeometry args={[0.14, 0.03, 0.03]} />
          <meshStandardMaterial color={DARK} />
        </mesh>

        {/* Má hồng hào */}
        <mesh position={[-0.24, -0.06, 0.24]} scale={[1, 0.6, 0.4]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#FDA4AF" roughness={0.8} />
        </mesh>
        <mesh position={[0.24, -0.06, 0.24]} scale={[1, 0.6, 0.4]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#FDA4AF" roughness={0.8} />
        </mesh>

        {/* ================= MIỆNG BIỂU CẢM ================= */}
        <mesh ref={mouthSmileRef} visible={false} position={[0, -0.09, 0.33]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.07, 0.018, 8, 16, Math.PI]} />
          <meshStandardMaterial color={DARK} />
        </mesh>
        <mesh ref={mouthFrownRef} visible={false} position={[0, -0.15, 0.33]}>
          <torusGeometry args={[0.06, 0.018, 8, 16, Math.PI]} />
          <meshStandardMaterial color={DARK} />
        </mesh>
        <mesh ref={mouthORef} visible={false} position={[0, -0.12, 0.33]} scale={[1, 1.2, 0.5]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial color="#5A1A24" />
        </mesh>
        <group ref={mouthWavyRef} visible={false} position={[0, -0.13, 0.34]}>
          {Array.from({ length: 4 }).map((_, i) => (
            <mesh key={`wavy-${i}`} position={[-0.06 + i * 0.04, 0, 0]} rotation={[0, 0, i % 2 ? 0.6 : -0.6]}>
              <boxGeometry args={[0.04, 0.016, 0.02]} />
              <meshStandardMaterial color={DARK} />
            </mesh>
          ))}
        </group>

        {/* Giọt mồ hôi & Nước mắt */}
        <mesh ref={sweatDropRef} position={[0.3, 0.25, 0.16]} visible={false}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#60A5FA" roughness={0.1} />
        </mesh>
        <mesh ref={tearDropRef} position={[0.18, 0.0, 0.32]} visible={false}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial color="#60A5FA" roughness={0.1} />
        </mesh>

        {/* Lưỡi thò thụt */}
        <mesh ref={tongueRef} position={[0, -0.12, 0.37]} scale={[1, 1, 0.001]}>
          <boxGeometry args={[0.05, 0.02, 0.24]} />
          <meshStandardMaterial color="#E0304A" />
        </mesh>

        {/* Vòng sao khi choáng */}
        <group ref={starsGroupRef} visible={false} position={[0, 0.55, 0]}>
          {Array.from({ length: 3 }).map((_, i) => (
            <mesh key={`star-${i}`}>
              <octahedronGeometry args={[0.06]} />
              <meshStandardMaterial color="#FFE14D" emissive="#F59E0B" emissiveIntensity={0.6} />
            </mesh>
          ))}
        </group>

        {/* Chữ Zzz bay lên khi ngủ (Giới hạn zIndexRange={[4, 0]}) */}
        <group ref={zzzGroupRef} visible={false}>
          {['z', 'Z', 'z'].map((letter, i) => (
            <Html key={`zzz-${i}`} center zIndexRange={[4, 0]} distanceFactor={8} style={{ pointerEvents: 'none' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#93C5FD', textShadow: '0 0 4px rgba(147, 197, 253, 0.8)' }}>
                {letter}
              </span>
            </Html>
          ))}
        </group>

        {/* Phụ kiện đặc trưng cho từng Agent */}
        <Accessory kind={agent.accessory} />

        {/* Nhãn thông tin 1 dòng gọn gàng trên đầu Agent (Giới hạn zIndexRange={[5, 0]}) */}
        {showFloatingBadge && (
          <Html
            position={[0, 0.78, 0]}
            center
            zIndexRange={[5, 0]}
            distanceFactor={7.5}
            style={{
              pointerEvents: 'auto',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              cursor: 'pointer',
            }}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                onClick?.();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 9px',
                borderRadius: '999px',
                backgroundColor: isSelected ? '#FFFBEB' : 'rgba(255, 255, 255, 0.95)',
                color: '#1F1B18',
                fontSize: '11.5px',
                fontWeight: 600,
                boxShadow: isSelected
                  ? `0 0 0 2px ${agent.baseColor}, 0 4px 12px rgba(0, 0, 0, 0.18)`
                  : '0 2px 8px rgba(0, 0, 0, 0.14)',
                border: `1.5px solid ${agent.baseColor}`,
              }}
            >
              <ProviderIcon provider={agent.provider} size={12} />
              <span>{agent.name}</span>
              {agent.currentTask && (
                <span
                  style={{
                    fontSize: '10.5px',
                    padding: '1px 5px',
                    borderRadius: '999px',
                    backgroundColor: agent.state === 'waiting' ? '#FEF3C7' : '#EFF6FF',
                    color: agent.state === 'waiting' ? '#92400E' : '#1D4ED8',
                  }}
                >
                  #{agent.currentTask.seq}
                </span>
              )}
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}

/** Phụ kiện đặc trưng riêng cho từng agent */
function Accessory({ kind }: { kind: AgentAccessory }) {
  if (kind === 'crown') {
    return (
      <group>
        {/* Vương miện vàng ấm của Trưởng phòng */}
        <group position={[0, 0.34, 0]}>
          <mesh>
            <cylinderGeometry args={[0.18, 0.15, 0.12, 16]} />
            <meshStandardMaterial color="#F59E0B" metalness={0.4} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.08, 0.14]}>
            <coneGeometry args={[0.05, 0.1, 8]} />
            <meshStandardMaterial color="#FBBF24" metalness={0.4} roughness={0.3} />
          </mesh>
          <mesh position={[-0.12, 0.08, 0.06]}>
            <coneGeometry args={[0.045, 0.09, 8]} />
            <meshStandardMaterial color="#FBBF24" metalness={0.4} roughness={0.3} />
          </mesh>
          <mesh position={[0.12, 0.08, 0.06]}>
            <coneGeometry args={[0.045, 0.09, 8]} />
            <meshStandardMaterial color="#FBBF24" metalness={0.4} roughness={0.3} />
          </mesh>
          {/* Ngọc đỏ giữa vương miện */}
          <mesh position={[0, 0.01, 0.16]}>
            <sphereGeometry args={[0.03, 10, 10]} />
            <meshStandardMaterial color="#EF4444" emissive="#DC2626" emissiveIntensity={0.3} />
          </mesh>
        </group>
        {/* Cà vạt đỏ lịch lãm của Trưởng phòng */}
        <group position={[0, -0.26, 0.25]} rotation={[0.25, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.07, 0.18, 0.02]} />
            <meshStandardMaterial color="#DC2626" roughness={0.4} />
          </mesh>
        </group>
      </group>
    );
  }

  if (kind === 'glasses') {
    return (
      <group position={[0, 0.1, 0.38]}>
        <mesh position={[-0.15, 0, 0]}>
          <torusGeometry args={[0.12, 0.015, 8, 20]} />
          <meshStandardMaterial color={DARK} roughness={0.3} />
        </mesh>
        <mesh position={[0.15, 0, 0]}>
          <torusGeometry args={[0.12, 0.015, 8, 20]} />
          <meshStandardMaterial color={DARK} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.08, 0.015, 0.015]} />
          <meshStandardMaterial color={DARK} roughness={0.3} />
        </mesh>
      </group>
    );
  }

  if (kind === 'headphones') {
    return (
      <group position={[0, 0.05, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.38, 0.03, 8, 24, Math.PI]} />
          <meshStandardMaterial color={DARK} roughness={0.4} />
        </mesh>
        <mesh position={[-0.38, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.08, 16]} />
          <meshStandardMaterial color="#10A37F" roughness={0.3} />
        </mesh>
        <mesh position={[0.38, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.08, 16]} />
          <meshStandardMaterial color="#10A37F" roughness={0.3} />
        </mesh>
      </group>
    );
  }

  if (kind === 'cap') {
    return (
      <group position={[0, 0.22, 0]}>
        <mesh>
          <sphereGeometry args={[0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#2563EB" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.02, 0.24]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.03, 16]} />
          <meshStandardMaterial color="#1D4ED8" roughness={0.5} />
        </mesh>
      </group>
    );
  }

  if (kind === 'bow') {
    return (
      <group position={[0, -0.16, 0.26]}>
        {/* Nơ cổ công nghệ xanh ngọc của OpenCode */}
        <mesh position={[-0.07, 0, 0]} rotation={[0, 0, 0.35]}>
          <coneGeometry args={[0.07, 0.11, 12]} />
          <meshStandardMaterial color="#059669" roughness={0.4} />
        </mesh>
        <mesh position={[0.07, 0, 0]} rotation={[0, 0, -0.35]}>
          <coneGeometry args={[0.07, 0.11, 12]} />
          <meshStandardMaterial color="#059669" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.015]}>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshStandardMaterial color="#A7F3D0" roughness={0.3} />
        </mesh>
      </group>
    );
  }

  return null;
}
