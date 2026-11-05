import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sourceFiles } from './stale.js';

// Test của CLI chạy bản build thật (dist/src/main.js) và nạp core/adapters/shared qua dist.
// Build thiếu hoặc cũ hơn mã nguồn thì thất bại ngay, thay vì kiểm nhầm mã cũ.
const PACKAGES = resolve(import.meta.dirname, '../..');

export default function setup(): void {
  const stale: string[] = [];
  for (const pkg of ['shared', 'adapters', 'core', 'cli']) {
    const src = join(PACKAGES, pkg, 'src');
    for (const file of sourceFiles(src)) {
      const name = file.slice(src.length + 1).replace(/\\/g, '/').replace(/\.ts$/, '.js');
      const outs = [join(PACKAGES, pkg, 'dist', 'src', name), join(PACKAGES, pkg, 'dist', name)];
      const out = outs.find((p) => existsSync(p));
      if (!out || statSync(out).mtimeMs + 2_000 < statSync(file).mtimeMs) stale.push(`${pkg}/src/${name.replace(/\.js$/, '.ts')}`);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Bản build thiếu hoặc cũ hơn mã nguồn (chạy \`pnpm -r build\` trước): ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', ...' : ''}`,
    );
  }
}
