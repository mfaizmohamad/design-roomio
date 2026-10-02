import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Root suite also owns the shared canonical lib's tests (Agent F dedup).
    include: ['src/**/*.test.ts', 'shared/lib/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
})
