import React, { useId } from 'react';

export type BrandProviderKey = 'claude' | 'codex' | 'antigravity' | 'opencode' | 'manager' | 'user' | 'unknown';

export function resolveProviderKey(raw?: string | null): BrandProviderKey {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase();
  if (s.includes('claude') || s.includes('anthropic')) return 'claude';
  if (s.includes('codex') || s.includes('openai')) return 'codex';
  if (s.includes('antigravity') || s.includes('agy') || s.includes('gemini') || s.includes('google')) {
    return 'antigravity';
  }
  if (s.includes('opencode')) return 'opencode';
  if (s.includes('manager') || s.includes('trưởng phòng') || s.includes('lead')) return 'manager';
  if (s.includes('user') || s.includes('bạn')) return 'user';
  return 'unknown';
}

export const PROVIDER_BRAND_META: Record<
  BrandProviderKey,
  { label: string; color: string; bg: string; border: string }
> = {
  claude: {
    label: 'Claude',
    color: '#D97757',
    bg: '#FDF4ED',
    border: '#F7D2C0',
  },
  codex: {
    label: 'Codex',
    color: '#4F56E8',
    bg: '#EEF2FF',
    border: '#C7D2FE',
  },
  antigravity: {
    label: 'Antigravity',
    color: '#2563EB',
    bg: '#EFF6FF',
    border: '#BFDBFE',
  },
  opencode: {
    label: 'OpenCode',
    color: '#059669',
    bg: '#ECFDF5',
    border: '#A7F3D0',
  },
  manager: {
    label: 'Trưởng phòng',
    color: '#7C3AED',
    bg: '#F5F3FF',
    border: '#DDD6FE',
  },
  user: {
    label: 'Bạn',
    color: '#475569',
    bg: '#F1F5F9',
    border: '#CBD5E1',
  },
  unknown: {
    label: 'Agent',
    color: '#6E655C',
    bg: '#F3EDE2',
    border: '#E8E2D8',
  },
};

const CODEX_LOBES: ReadonlyArray<[number, number]> = [
  [10.36, 6.96],
  [15.55, 8.06],
  [17.18, 13.10],
  [13.64, 17.04],
  [8.45, 15.94],
  [6.82, 10.90],
];

/**
 * Biểu tượng thương hiệu chính thức cho Claude (Anthropic Starburst),
 * Codex (Scalloped Indigo Cloud với dấu nhắc `>_`), Antigravity (Google DeepMind 4-Point Spark) & Trưởng phòng.
 */
export function ProviderIcon({
  provider,
  size = 14,
  style,
}: {
  provider?: string | null;
  size?: number;
  style?: React.CSSProperties;
}) {
  const uid = useId().replace(/:/g, '');
  const key = resolveProviderKey(provider);

  if (key === 'claude') {
    // Anthropic Claude Starburst / Sunburst Logo
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      >
        <g stroke="#D97757" strokeWidth="2.3" strokeLinecap="round">
          <line x1="12" y1="2.5" x2="12" y2="21.5" />
          <line x1="2.5" y1="12" x2="21.5" y2="12" />
          <line x1="5.2" y1="5.2" x2="18.8" y2="18.8" />
          <line x1="18.8" y1="5.2" x2="5.2" y2="18.8" />
          <line x1="8.2" y1="3.2" x2="15.8" y2="20.8" />
          <line x1="3.2" y1="8.2" x2="20.8" y2="15.8" />
        </g>
        <circle cx="12" cy="12" r="2.6" fill="#D97757" />
      </svg>
    );
  }

  if (key === 'codex') {
    // Codex Official Logo: 6-lobe Scalloped Periwinkle-to-Indigo Cloud with `>_` prompt
    const clipId = `codex-cloud-clip-${uid}`;
    const gradId = `codex-cloud-grad-${uid}`;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx="12" cy="12" r="6.4" />
            {CODEX_LOBES.map(([lx, ly], idx) => (
              <circle key={idx} cx={lx} cy={ly} r="4.65" />
            ))}
          </clipPath>
          <linearGradient id={gradId} x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9E97FF" />
            <stop offset="52%" stopColor="#656DF7" />
            <stop offset="100%" stopColor="#2F41E0" />
          </linearGradient>
        </defs>

        <rect x="1" y="1" width="22" height="22" clipPath={`url(#${clipId})`} fill={`url(#${gradId})`} />

        {/* Dấu nhắc Terminal `>_` màu trắng bên trong đám mây Codex */}
        <path
          d="M8.1 9.5L10.35 12.85L8.1 16.2"
          stroke="#FFFFFF"
          strokeWidth="2.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="12.85"
          y1="15.75"
          x2="16.65"
          y2="15.75"
          stroke="#FFFFFF"
          strokeWidth="2.15"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (key === 'antigravity') {
    // Google DeepMind / Antigravity 4-Point Spark & Orbit Mark
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      >
        <path
          d="M12 2C12.7 7.6 16.4 11.3 22 12C16.4 12.7 12.7 16.4 12 22C11.3 16.4 7.6 12.7 2 12C7.6 11.3 11.3 7.6 12 2Z"
          fill="#2563EB"
        />
        <circle cx="18.5" cy="5.5" r="1.6" fill="#60A5FA" />
      </svg>
    );
  }

  if (key === 'opencode') {
    // OpenCode Official Logo (Dark #211E1E and Light Grey #CFCECD)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 240 300"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      >
        <path d="M180 240H60V120H180V240Z" fill="#CFCECD" />
        <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="#211E1E" />
      </svg>
    );
  }

  if (key === 'manager') {
    // Trưởng phòng Crown Mark
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      >
        <path
          d="M3 18H21V20H3V18ZM3 7L7.5 12L12 5L16.5 12L21 7L19.5 16H4.5L3 7Z"
          fill="#7C3AED"
        />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    >
      <circle cx="12" cy="12" r="8" stroke="#6E655C" strokeWidth="2" />
      <circle cx="9.5" cy="11" r="1.3" fill="#6E655C" />
      <circle cx="14.5" cy="11" r="1.3" fill="#6E655C" />
    </svg>
  );
}

/**
 * Vẽ trực tiếp logo vector thương hiệu nhà cung cấp lên HTML5 Canvas 2D (dùng cho Đồ thị GraphCanvas).
 */
export function drawProviderBrandOnCanvas(
  ctx: CanvasRenderingContext2D,
  providerRaw: string,
  cx: number,
  cy: number,
  r: number,
): void {
  const key = resolveProviderKey(providerRaw);
  ctx.save();

  if (key === 'claude') {
    // Anthropic Claude Starburst (10 tia ấm áp)
    const color = '#D97757';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.8, r * 0.12);
    ctx.lineCap = 'round';
    const rays = 10;
    const outer = r * 0.56;
    for (let i = 0; i < rays; i++) {
      const a = (i * Math.PI * 2) / rays;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r * 0.14), cy + Math.sin(a) * (r * 0.14));
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'codex') {
    // Codex 6-lobe Scalloped Cloud + `>_` terminal prompt
    const scale = (r * 1.25) / 24;
    const grad = ctx.createLinearGradient(cx, cy - r * 0.65, cx, cy + r * 0.65);
    grad.addColorStop(0, '#9E97FF');
    grad.addColorStop(0.52, '#656DF7');
    grad.addColorStop(1, '#2F41E0');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.arc(cx, cy, 6.4 * scale, 0, Math.PI * 2);
    for (const [lx, ly] of CODEX_LOBES) {
      const px = cx + (lx - 12) * scale;
      const py = cy + (ly - 12) * scale;
      ctx.moveTo(px + 4.65 * scale, py);
      ctx.arc(px, py, 4.65 * scale, 0, Math.PI * 2);
    }
    ctx.fill();

    // White `>_` terminal prompt inside cloud
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1.6, 2.15 * scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(cx + (8.1 - 12) * scale, cy + (9.5 - 12) * scale);
    ctx.lineTo(cx + (10.35 - 12) * scale, cy + (12.85 - 12) * scale);
    ctx.lineTo(cx + (8.1 - 12) * scale, cy + (16.2 - 12) * scale);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + (12.85 - 12) * scale, cy + (15.75 - 12) * scale);
    ctx.lineTo(cx + (16.65 - 12) * scale, cy + (15.75 - 12) * scale);
    ctx.stroke();
  } else if (key === 'antigravity') {
    // Google DeepMind / Antigravity 4-Point Spark
    const color = '#2563EB';
    const outer = r * 0.6;
    const inner = r * 0.17;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outer);
    ctx.quadraticCurveTo(cx + inner, cy - inner, cx + outer, cy);
    ctx.quadraticCurveTo(cx + inner, cy + inner, cx, cy + outer);
    ctx.quadraticCurveTo(cx - inner, cy + inner, cx - outer, cy);
    ctx.quadraticCurveTo(cx - inner, cy - inner, cx, cy - outer);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#60A5FA';
    ctx.beginPath();
    ctx.arc(cx + r * 0.36, cy - r * 0.36, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'opencode') {
    // OpenCode Official Logo (Dark #211E1E and Light Grey #CFCECD)
    const scale = (r * 1.3) / 300;

    // Khối xám nhạt bên trong (x: 60..180, y: 120..240)
    ctx.fillStyle = '#CFCECD';
    ctx.fillRect(cx - 60 * scale, cy - 30 * scale, 120 * scale, 120 * scale);

    // Khung đen ngoài có lỗ khoét (x: 0..240, y: 0..300, lỗ khoét: x: 60..180, y: 60..240)
    ctx.fillStyle = '#211E1E';
    ctx.beginPath();
    ctx.rect(cx - 120 * scale, cy - 150 * scale, 240 * scale, 300 * scale);
    ctx.rect(cx - 60 * scale, cy - 90 * scale, 120 * scale, 180 * scale);
    ctx.fill('evenodd');
  } else {
    // Fallback Crown / Node icon
    ctx.fillStyle = '#7C3AED';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
