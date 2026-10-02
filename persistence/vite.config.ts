import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone demo harness for the persistence & sharing system (Agent C, feature 2).
// Port 5187 (A server 5181, B camera 5184, E lighting 5186 — avoid collisions).
// Two entry points: index.html = full demo (editor + My Designs + Share panel);
// showcase.html = the view-only showcase walkthrough (NEVER exposes the editor/library).
export default defineConfig({
  plugins: [react()],
  server: { port: 5187 },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        showcase: 'showcase.html',
      },
    },
  },
})
