import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['worker/tests/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
