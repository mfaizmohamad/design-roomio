import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

/**
 * Standalone demo harness for Agent H's photo-texture-mapping system (port 5189).
 * Pick a piece → texture it from a (synthetic) photo → adjust tiling → accept / revert.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
