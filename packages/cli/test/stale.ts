import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Mọi file .ts nguồn (không phải .d.ts) trong `dir`, duyệt đệ quy (ví dụ adapters/src/discovery/*). */
export function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
