import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone demo harness for the lighting system (Agent E).
// Port 5186 (A server 5181, B camera 5184, C multi-room 5185-ish — avoid collisions).
export default defineConfig({
  plugins: [react()],
  server: { port: 5186 },
})
