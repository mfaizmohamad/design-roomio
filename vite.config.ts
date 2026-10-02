import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Cross-island R3F components (e.g. /lighting, /rendering) are imported by the app. Force a SINGLE
  // copy of React / three / the R3F ecosystem so hook contexts match the app's <Canvas> — otherwise a
  // duplicate @react-three/fiber (from an island's own node_modules) throws "Hooks can only be used
  // within the Canvas component". No-op for islands that already resolve to root; required for any
  // island that ships its own R3F copy. (Added with Agent G's realism-layer mount.)
  base: '/design-roomio/', 
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
      '@react-three/drei',
      '@react-three/postprocessing',
      'postprocessing',
      'three-stdlib',
      'three-mesh-bvh',
      'three-gpu-pathtracer',
      'zustand',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        // Split the LAZY 3D payload (see src/App.tsx — Wizard is React.lazy) into a stable
        // vendor chunk (three core, rarely changes → long-cacheable) and the app's own 3D
        // code. These libraries are only reachable from lazy chunks, so grouping them does
        // NOT make them eager. Deliberately NOT listed here: canvas-record/h264-mp4-encoder
        // (must stay in their own dynamic-import-only chunk, fetched when a video export
        // starts) and three-gpu-pathtracer (already isolated behind a dynamic import).
        manualChunks(id: string) {
          if (!id.includes('node_modules')) {
            // Rollup/Vite VIRTUAL helper modules (\0vite/preload-helper, \0commonjsHelpers…)
            // are shared by eager and lazy chunks alike. Left unassigned, Rollup may colocate
            // them INSIDE a lazy chunk (observed: preload-helper landed in r3f), which makes
            // the entry statically import that chunk — un-splitting the bundle. Pin them to
            // the eager vendor chunk.
            if (id.startsWith('\0')) return 'react-vendor'
            return undefined
          }
          // Shared UI vendor (used by the entry AND the 3D chunks). Pinning it prevents
          // Rollup from colocating react/zustand INSIDE the r3f chunk, which would create
          // a static entry→r3f edge and drag the engine back into first load.
          if (
            /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/.test(
              id,
            )
          ) {
            return 'react-vendor'
          }
          if (/[\\/]node_modules[\\/](three|three-stdlib|three-mesh-bvh)[\\/]/.test(id)) {
            return 'three-core'
          }
          if (/[\\/]node_modules[\\/](@react-three|postprocessing|n8ao)[\\/]/.test(id)) {
            return 'r3f'
          }
          return undefined
        },
      },
    },
  },
  server: {
    host: true,
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
      },
    },
  },
})
