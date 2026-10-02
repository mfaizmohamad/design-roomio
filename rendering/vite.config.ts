import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Agent G — Realistic Rendering island. Standalone harness on port 5188
// (5180 root, 5181 server, 5184 camera-flythrough, 5186 lighting, 5187 persistence).
export default defineConfig({
  plugins: [react()],
  server: { port: 5188 },
})
