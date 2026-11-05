import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Build ra packages/web/dist: daemon (core/src/daemon.ts findWebDir) tìm đúng chỗ này.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    include: ['test/**/*.test.ts'],
    env: { NODE_NO_WARNINGS: '1' },
  },
});
