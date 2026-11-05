export * from './types.js';
export * from './common.js';
export * from './fake.js';
export * from './claude.js';
export * from './codex.js';

import type { ProviderId } from '@voragent/shared';
import type { Adapter } from './types.js';
import { createClaudeAdapter } from './claude.js';
import { createCodexAdapter } from './codex.js';

const FACTORIES: Partial<Record<ProviderId, () => Adapter>> = {
  claude: createClaudeAdapter,
  codex: createCodexAdapter,
};

/** Tạo adapter cho các id đã biết; id không biết thì bỏ qua. */
export function createAdapters(ids: ProviderId[]): Map<ProviderId, Adapter> {
  const map = new Map<ProviderId, Adapter>();
  for (const id of ids) {
    const make = FACTORIES[id];
    if (make) map.set(id, make());
  }
  return map;
}
export * from './discovery/index.js';
