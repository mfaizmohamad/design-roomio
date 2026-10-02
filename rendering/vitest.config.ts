import { defineConfig } from 'vitest/config'

// Pure-logic unit tests (presets/store math). Rendering itself is verified empirically
// via the headless puppeteer harness in scripts/verify-app.mjs (real WebGL via SwiftShader).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
