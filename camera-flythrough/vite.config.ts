import { defineConfig } from 'vite'

// Standalone dev/verification harness for the flythrough engine.
// Runs on localhost (WebCodecs / canvas-record requires a secure context:
// HTTPS or localhost — localhost qualifies). Separate port from the main app
// (5173) and the auth server (5181) to avoid collisions.
export default defineConfig({
  root: '.',
  server: { port: 5184, host: 'localhost' },
  build: { target: 'es2021', outDir: 'dist' },
})
