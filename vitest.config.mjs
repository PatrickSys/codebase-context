import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // File-heavy subprocess fixtures compete for native resources on Windows.
    ...(process.platform === 'win32' ? { maxWorkers: 1 } : {}),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000
  }
});

