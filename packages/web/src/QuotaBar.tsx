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
  if (providers.length === 0) return <div className="quota-bar muted">Chưa có nền tảng nào.</div>;
  return (
    <div className="quota-bar">
      {providers.map((p) => {
        const d = describeProvider(p, now);
        return (
          <div key={p.id} className={`quota-cell ${d.light}`} title={p.version ?? ''}>
            <strong>{p.id}</strong>
            <span>{d.note}</span>
          </div>
        );
      })}
    </div>
  );
}
