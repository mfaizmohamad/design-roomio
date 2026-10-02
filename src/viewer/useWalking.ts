import { useEffect, useReducer } from 'react'
import type { FlythroughController } from '../../camera-flythrough/src/engine/FlythroughController'

/** True while the controller is in first-person walk. Re-renders on every change. */
export function useWalking(controller: FlythroughController | null): boolean {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => (controller ? controller.subscribe(force) : undefined), [controller])
  if (!controller) return false
  const s = controller.snapshot()
  return s.open && s.mode === 'walk'
}
