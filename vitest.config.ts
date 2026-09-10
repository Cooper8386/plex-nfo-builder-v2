import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/**/*.test.{ts,tsx}'], testTimeout: 10000 },
});
