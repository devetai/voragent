import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test sinh tiến trình/git chậm trên Windows khi máy tải: cho thời gian thực tế.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // node:sqlite in Node 22 prints an ExperimentalWarning; silence it for test output only.
    env: { NODE_NO_WARNINGS: '1' },
    exclude: ['dist/**', 'node_modules/**'],
    globalSetup: ['./test/global-setup.ts'],
  },
});
