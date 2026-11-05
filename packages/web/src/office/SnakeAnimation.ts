import * as THREE from 'three';

export const LOUNGE_COORDINATES = [
  { x: 6.6, z: 4.8 },   // Vị trí nệm nghỉ Claude (Cam đất)
  { x: 10.2, z: 5.0 },  // Vị trí nệm nghỉ Codex (Xanh ngọc)
  { x: 8.4, z: 7.2 },   // Vị trí nệm nghỉ Antigravity (Xanh dương)
];

export interface SlitherState {
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  progress: number;       // 0 -> 1
  isMoving: boolean;
  headingAngle: number;
}

/** Tạo đường dẫn di chuyển tránh vật cản giữa bàn làm việc và khu nghỉ ngơi */
export function createOfficePath(start: THREE.Vector3, end: THREE.Vector3): THREE.CatmullRomCurve3 {
  // Điểm trung chuyển ở lối đi trung tâm để không đâm xuyên bàn ghế
  const midWay = new THREE.Vector3(
    (start.x + end.x) * 0.5,
    0,
    1.5 // Lối đi giữa phòng
  );

  return new THREE.CatmullRomCurve3([start.clone(), midWay, end.clone()], false, 'centripetal');
}

/** Tính toán độ uốn lượn hình sin của thân rắn khi trườn */
export function applySlitherWave(
  point: THREE.Vector3,
  tangent: THREE.Vector3,
  index: number,
  time: number,
  speed = 8.0,
  amplitude = 0.16
): THREE.Vector3 {
  // Vector vuông góc với hướng di chuyển (trên mặt phẳng nằm ngang XZ)
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const wave = Math.sin(time * speed - index * 0.6) * amplitude;
  return point.clone().addScaledVector(normal, wave);
}
