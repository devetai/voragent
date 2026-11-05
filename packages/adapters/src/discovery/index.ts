export * from './uri.js';
export * from './claude.js';
export * from './antigravity.js';

import type { DiscoveredProject } from '@voragent/shared';
import { discoverClaudeProjects, type DiscoverOptions } from './claude.js';
import { discoverAntigravityProjects } from './antigravity.js';

/** Gộp mọi nguồn, không dedupe; nguồn lỗi thì bỏ qua. */
export async function discoverAll(o: DiscoverOptions): Promise<DiscoveredProject[]> {
  const sources = [discoverClaudeProjects, discoverAntigravityProjects];
  const results = await Promise.allSettled(sources.map((f) => f(o)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
