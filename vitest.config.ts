import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
