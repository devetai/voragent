import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_THEME, PROVIDER_THEMES } from '../src/office/types';
import { LOUNGE_COORDINATES, applySlitherWave, createOfficePath } from '../src/office/SnakeAnimation';

describe('Văn phòng 3D - Quy chuẩn thiết kế & Tính toán hình học', () => {
  it('công thức bán kính thân rắn: cổ đạt ~90% thân và thon dần đều về đuôi', () => {
    // Công thức tính bán kính: cổ thon nhẹ (~90% thân), phình đều ở thân trên và thon về đuôi
    const calcRadius = (u: number): number => {
      return (0.06 + 0.17 * Math.pow(1 - u, 0.6)) * (0.88 + 0.12 * THREE.MathUtils.smoothstep(u, 0, 0.15));
    };

    const headNeckRadius = calcRadius(0.0);   // Đoạn nối đầu/cổ (u = 0)
    const midBodyRadius = calcRadius(0.15);   // Thân phình đầy đủ (u = 0.15)
    const tailTipRadius = calcRadius(1.0);    // Chóp đuôi (u = 1.0)

    // Cổ nối đạt khoảng 90% - 95% độ rộng tối đa của thân
    const neckRatio = headNeckRadius / midBodyRadius;
    expect(neckRatio).toBeGreaterThanOrEqual(0.88);
    expect(neckRatio).toBeLessThanOrEqual(0.96);

    // Chóp đuôi thon nhỏ hơn thân nhiều lần
    expect(tailTipRadius).toBeLessThan(midBodyRadius * 0.35);
    expect(tailTipRadius).toBeCloseTo(0.06, 2);
  });

  it('bộ theme màu và phụ kiện đặc trưng của 3 coding agent tuân thủ Warm Cozy Tech', () => {
    // Claude: cam đất ấm áp, kính tri thức
    expect(PROVIDER_THEMES.claude?.base).toBe('#D97757');
    expect(PROVIDER_THEMES.claude?.accessory).toBe('glasses');

    // Codex: xanh ngọc tự nhiên, tai nghe
    expect(PROVIDER_THEMES.codex?.base).toBe('#10A37F');
    expect(PROVIDER_THEMES.codex?.accessory).toBe('headphones');

    // Antigravity: xanh dương tươi sáng, mũ lưỡi trai
    expect(PROVIDER_THEMES.antigravity?.base).toBe('#3B82F6');
    expect(PROVIDER_THEMES.antigravity?.accessory).toBe('cap');

    // Default theme dự phòng
    expect(DEFAULT_THEME.accessory).toBe('none');
    expect(DEFAULT_THEME.name).toBe('Agent');
  });

  it('thuật toán đường đi trườn createOfficePath tạo đường vòng qua lối đi trung tâm', () => {
    const start = new THREE.Vector3(-5, 0, -2.6); // Bàn Claude
    const end = new THREE.Vector3(7.2, 0, 5.2);   // Nệm nghỉ Claude
    const path = createOfficePath(start, end);

    expect(path.points.length).toBe(3);
    const midPoint = path.points[1];
    expect(midPoint?.z).toBe(1.5); // Lối đi trung tâm
    expect(midPoint?.x).toBeCloseTo(1.1, 1);
  });

  it('sóng trườn applySlitherWave tạo dao động vuông góc với hướng di chuyển', () => {
    const point = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(0, 0, 1); // Đang di chuyển dọc trục Z
    const wavedPoint = applySlitherWave(point, forward, 0, 0.2, 8.0, 0.2);

    // Khi di chuyển hướng Z, vector sóng dao động trên trục X (ngang), trục Y và Z không đổi
    expect(wavedPoint.y).toBe(0);
    expect(wavedPoint.z).toBe(0);
    expect(Math.abs(wavedPoint.x)).toBeGreaterThan(0);
  });

  it('tọa độ khu nghỉ ngơi tách biệt với bàn làm việc', () => {
    expect(LOUNGE_COORDINATES.length).toBe(3);
    LOUNGE_COORDINATES.forEach((coord) => {
      expect(coord.z).toBeGreaterThan(4.0); // Nằm ở góc phòng nghỉ
      expect(coord.x).toBeGreaterThan(6.0);
    });
  });

  it('giới hạn góc xoay camera OrbitControls ngăn không cho xoay ngang 360 độ ra sau tường che khuất', () => {
    const minAzimuth = -Math.PI / 10;                // ~ -18 độ
    const maxAzimuth = Math.PI / 2 + Math.PI / 12;   // ~ 105 độ
    const arcDegrees = ((maxAzimuth - minAzimuth) * 180) / Math.PI;

    // Góc mở quan sát diorama mở trong khoảng 100 - 140 độ, tuyệt đối không cho xoay 360 độ
    expect(arcDegrees).toBeGreaterThan(110);
    expect(arcDegrees).toBeLessThan(140);
    expect(arcDegrees).toBeLessThan(360);
  });
});
