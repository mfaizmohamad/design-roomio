// In-app confirmation dialogs (store only — the host lives in ConfirmDialog.tsx).
// A promise-based alternative to the browser's blocking confirm(): call
// `await confirmDialog({...})` and get back true (confirmed) / false (cancelled).
// Used for destructive/irreversible actions (deleting a saved room, discarding
// unsaved edits) where a native confirm() would be jarring and off-brand.

import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** style the confirm button as destructive (red) */
  danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  current: ConfirmRequest | null
  request: (opts: ConfirmOptions) => Promise<boolean>
  resolve: (ok: boolean) => void
}

let nextId = 1

export const useConfirm = create<ConfirmState>((set, get) => ({
  current: null,

  request: (opts) =>
    new Promise<boolean>((resolve) => {
      // Never stack dialogs: an outstanding request resolves as "cancelled".
      const cur = get().current
      if (cur) cur.resolve(false)
      set({ current: { ...opts, id: nextId++, resolve } })
    }),

  resolve: (ok) => {
    const cur = get().current
    if (!cur) return
    set({ current: null })
    cur.resolve(ok)
  },
}))

/** Show a confirm dialog. Resolves true if the user confirms, false otherwise. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return useConfirm.getState().request(opts)
}
