import type { Config, ProviderId, ProviderState } from '@voragent/shared';

export interface PickInput {
  priority: ProviderId[];
  current: ProviderId | null;
  isNewTask: boolean;
  providers: Map<ProviderId, ProviderState>;
  running: Map<ProviderId, number>;
  totalRunning: number;
  config: Config;
  now: number;
}

export type PickResult = { provider: ProviderId } | { wait: 'quota' | 'capacity' };

export function pickProvider(o: PickInput): PickResult {
  if (o.totalRunning >= o.config.concurrency.total) return { wait: 'capacity' };

  const perProvider = o.config.concurrency.perProvider;
  const isAvailable = (id: ProviderId): boolean => {
    const p = o.providers.get(id);
    return !!p && p.installed && (p.cooldownUntil === null || p.cooldownUntil <= o.now);
  };
  const hasRoom = (id: ProviderId): boolean => (o.running.get(id) ?? 0) < perProvider;
  const usable = (id: ProviderId): boolean => isAvailable(id) && hasRoom(id);

  if (o.current !== null && usable(o.current)) return { provider: o.current };

  for (const id of o.priority) {
    if (!usable(id)) continue;
    if (o.isNewTask) {
      const used = o.providers.get(id)?.usedPercent;
      if (used !== null && used !== undefined && used >= o.config.quotaThreshold) continue;
    }
    return { provider: id };
  }

  const candidates = new Set<ProviderId>(o.priority);
  if (o.current !== null) candidates.add(o.current);
  for (const id of candidates) {
    if (isAvailable(id) && !hasRoom(id)) return { wait: 'capacity' };
  }
  return { wait: 'quota' };
}
