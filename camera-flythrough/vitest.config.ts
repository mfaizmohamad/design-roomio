import { defineConfig } from 'vitest/config'

// Tests live in tests/ (not src/) in this workspace. This config exists so the
// suite runs identically standalone (`npm test` here) and via the root
// vitest.workspace.ts (`npm test` at the repo root), which gates it in CI.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
