/**
 * VIEW-ONLY SHOWCASE entry. Mounts ONLY the read-only Showcase — no editor, no
 * library, no session store. The isolation guarantee starts at this import graph:
 * nothing reachable from here can open the editor or list other designs.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Showcase } from './Showcase'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
)
