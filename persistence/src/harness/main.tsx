import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useSession, makeSession } from '../app/session'
import { FlakyAdapter, LocalStorageAdapter } from '../storage/adapter'

// The harness wraps localStorage in a fault-injectable adapter so the demo can
// exercise the "simulated save failure → retry, not loss" acceptance. The real
// app would use a plain LocalStorageAdapter (no fault toggle). Data still
// persists across reload when not failing (inner = localStorage).
useSession.setState(makeSession(new FlakyAdapter(0, new LocalStorageAdapter())))

// Debug hooks for the headless verify script (harness-only).
;(window as unknown as { __roomioRev?: () => number | null }).__roomioRev = () =>
  useSession.getState().current?.rev ?? null
;(window as unknown as { __roomioFail?: (on: boolean) => void }).__roomioFail = (on) =>
  useSession.getState().simulateSaveFailure(on)
;(window as unknown as { __roomioUnsaved?: () => boolean }).__roomioUnsaved = () =>
  useSession.getState().autosave.hasUnsaved()

// Global keyframes for the save spinner (kept here so components stay self-contained).
const style = document.createElement('style')
style.textContent = `@keyframes roomio-spin { to { transform: rotate(360deg); } }`
document.head.appendChild(style)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
