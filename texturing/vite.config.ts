import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone demo harness for the photo-texture-mapping system (Agent H).
// Port 5189 (A server 5181, B camera 5184, C multi-room ~5185, E lighting 5186,
// C persistence 5187, G rendering 5188 — avoid collisions).
export default defineConfig({
  plugins: [react()],
  server: { port: 5189 },
})
