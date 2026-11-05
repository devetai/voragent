import type { ProviderState } from '@voragent/shared';

export type Light = 'green' | 'yellow' | 'red' | 'grey';

const hhmm = (ms: number): string =>
  new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Màu và chữ của một ô nền tảng. `usedPercent` là tỉ lệ 0..1. */
export function describeProvider(p: ProviderState, now: number): { light: Light; note: string } {
  if (!p.installed) return { light: 'grey', note: 'chưa cài' };
  if (p.cooldownUntil !== null && p.cooldownUntil > now) {
    return { light: 'red', note: `tạm nghỉ đến ${hhmm(p.cooldownUntil)}` };
  }
  if (p.usedPercent !== null && p.usedPercent >= 0.9) {
    return { light: 'yellow', note: `đã dùng ${Math.round(p.usedPercent * 100)}%` };
  }
  const note = p.usedPercent !== null ? `đã dùng ${Math.round(p.usedPercent * 100)}%` : 'sẵn sàng';
  return { light: 'green', note };
}

export function QuotaBar({ providers, now }: { providers: ProviderState[]; now: number }) {
  if (providers.length === 0) {
    return <div className="quota-bar-container muted">Đang kết nối danh sách nền tảng…</div>;
  }

  return (
    <div className="quota-bar-container" aria-label="Hạn mức nền tảng">
      {providers.map((p) => {
        const d = describeProvider(p, now);
        const pct = p.usedPercent !== null ? Math.min(100, Math.round(p.usedPercent * 100)) : null;

        return (
          <div
            key={p.id}
            className="quota-pill"
            title={`${p.id} ${p.version ? `(${p.version})` : ''} - ${d.note}`}
          >
            <span className={`quota-pill-indicator ${d.light}`} />
            <span className="quota-pill-title">{p.id}</span>
            <span className="quota-pill-note">{d.note}</span>
            {pct !== null && (
              <div className="quota-pill-bar" title={`${pct}%`}>
                <div
                  className={`quota-pill-bar-fill ${d.light}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
