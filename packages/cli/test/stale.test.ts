import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { rmTmp } from './helpers.js';
import { sourceFiles } from './stale.js';

it('sourceFiles duyệt cả thư mục lồng nhau và bỏ .d.ts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voragent-stale-'));
  try {
    mkdirSync(join(dir, 'discovery', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'a.d.ts'), '');
    writeFileSync(join(dir, 'discovery', 'claude.ts'), '');
    writeFileSync(join(dir, 'discovery', 'deep', 'x.ts'), '');
    writeFileSync(join(dir, 'discovery', 'note.md'), '');
    const rel = sourceFiles(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, '/')).sort();
    expect(rel).toEqual(['a.ts', 'discovery/claude.ts', 'discovery/deep/x.ts']);
    expect(sourceFiles(join(dir, 'missing'))).toEqual([]);
  } finally {
    rmTmp(dir);
  }
});
