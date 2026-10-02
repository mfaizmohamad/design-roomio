/**
 * Unsaved-exit protection (brief §3 / PS-5). Warns the user before leaving the
 * page while a save is still pending, so nothing is lost on close/navigate.
 * Guarded for non-DOM/test environments.
 */
export function installUnloadGuard(hasUnsaved: () => boolean): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }
  const handler = (e: BeforeUnloadEvent) => {
    if (hasUnsaved()) {
      e.preventDefault()
      // Legacy requirement: a non-empty returnValue triggers the native prompt.
      e.returnValue = ''
      return ''
    }
    return undefined
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}
