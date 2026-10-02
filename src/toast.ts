// Lightweight app-wide toast notifications (store only — the host component
// lives in Toasts.tsx). Deliberately minimal: transient, non-blocking pills
// used for failure/success feedback where a native alert() would be jarring.
// A full dialog/confirm system is a separate backlog item (CODE-07).

import { create } from 'zustand'

export type ToastKind = 'error' | 'success' | 'info'

/** Optional inline action (e.g. an "Undo") rendered as a button on the toast. */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, kind?: ToastKind, ttlMs?: number, action?: ToastAction) => number
  dismiss: (id: number) => void
  clear: () => void
}

/** How many toasts can be on screen at once — older ones are dropped. */
const MAX_VISIBLE = 3
/** Default lifetimes: errors linger a little longer so they can be read. */
const TTL_MS: Record<ToastKind, number> = { error: 6500, success: 3500, info: 4500 }

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function clearTimer(id: number) {
  const t = timers.get(id)
  if (t !== undefined) {
    clearTimeout(t)
    timers.delete(id)
  }
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],

  push: (message, kind = 'info', ttlMs, action) => {
    const id = nextId++
    set((s) => {
      // Replace an identical pending message instead of stacking duplicates
      // (e.g. clicking a broken row twice shouldn't pile up two errors).
      const kept = s.toasts.filter((t) => {
        const dup = t.message === message && t.kind === kind
        if (dup) clearTimer(t.id)
        return !dup
      })
      const next = [...kept, { id, kind, message, action }]
      for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
        clearTimer(dropped.id)
      }
      return { toasts: next.slice(-MAX_VISIBLE) }
    })
    const ttl = ttlMs ?? TTL_MS[kind]
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), ttl),
    )
    return id
  },

  dismiss: (id) => {
    clearTimer(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  clear: () => {
    for (const t of get().toasts) clearTimer(t.id)
    set({ toasts: [] })
  },
}))

/** Show a toast. Returns its id (usable with useToasts.getState().dismiss). */
export function toast(
  message: string,
  kind: ToastKind = 'info',
  ttlMs?: number,
  action?: ToastAction,
): number {
  return useToasts.getState().push(message, kind, ttlMs, action)
}

export const toastError = (message: string): number => toast(message, 'error')
export const toastSuccess = (message: string): number => toast(message, 'success')
