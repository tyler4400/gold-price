import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['worker/tests/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
