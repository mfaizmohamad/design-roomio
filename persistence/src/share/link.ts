/**
 * Share-link + share-state helpers (brief §5/§6).
 *
 * Local-first tier: a "view" / "showcase" link is a self-contained URL to the
 * SEPARATE showcase entry (showcase.html) with the one design's minimal payload
 * in the fragment. There is no backend to resolve a token yet, so the link IS the
 * design — but it is the SHOWCASE projection only (never the editor/library).
 *
 * Share access defaults to the SAFE option (view). Edit links are only meaningful
 * once a backend exists (they need server-side auth to resolve), so locally we
 * record the intent but surface that edit-sharing needs an account.
 */
import type { RoomioDesign, ShareAccess, ShareState } from '../envelope/types'
import { encodeShowcasePayload, toShowcasePayload } from './showcasePayload'
import { shareToken } from '../util/id'

/** Plain-language description of who can do what (brief §6: clarity over icons). */
export function accessSentence(access: ShareAccess): string {
  switch (access) {
    case 'view':
      return 'Anyone with the link can view a read-only walkthrough.'
    case 'edit':
      return 'Anyone with the link can edit (requires a Roomio account).'
    case 'private':
    default:
      return 'Private — only you can open this design.'
  }
}

/**
 * Apply an access change to a design's share state. Choosing "view" ensures a
 * view link id exists; choosing "edit" also ensures an edit link id; "private"
 * keeps the tokens (so re-enabling is stable) but the access gate is closed.
 */
export function withAccess(share: ShareState, access: ShareAccess): ShareState {
  const next: ShareState = { ...share, access }
  if (access === 'view' || access === 'edit') {
    if (!next.view_link_id) next.view_link_id = shareToken()
  }
  if (access === 'edit' && !next.edit_link_id) next.edit_link_id = shareToken()
  return next
}

/**
 * Build the absolute, self-contained view-only SHOWCASE URL for a design.
 * Resolves showcase.html relative to the current page so it works in dev + build.
 * `baseHref` override is for tests / SSR.
 */
export function buildShowcaseUrl(design: RoomioDesign, baseHref?: string): string {
  const encoded = encodeShowcasePayload(toShowcasePayload(design))
  const base = baseHref ?? currentBaseHref()
  const url = resolveShowcaseHref(base)
  return `${url}#s=${encoded}`
}

function currentBaseHref(): string {
  try {
    if (typeof window !== 'undefined' && window.location) return window.location.href
  } catch {
    // ignore
  }
  return 'https://app.roomio.local/index.html'
}

/** Resolve "showcase.html" relative to a page href (drops any existing hash/query). */
export function resolveShowcaseHref(pageHref: string): string {
  try {
    const u = new URL(pageHref)
    u.hash = ''
    u.search = ''
    // replace the last path segment (e.g. index.html or "") with showcase.html
    u.pathname = u.pathname.replace(/[^/]*$/, 'showcase.html')
    return u.href
  } catch {
    return 'https://app.roomio.local/showcase.html'
  }
}

/**
 * Advise on a self-contained showcase URL's size. The link embeds the whole scene
 * in its fragment, so a large multi-room house can exceed what some chat/email
 * channels carry without truncation. We NEVER silently truncate/compress — instead
 * we surface an honest warning and steer to the `.roomio` export (brief: never
 * silently corrupt a share). A future server token makes this moot.
 */
export type ShowcaseSizeLevel = 'ok' | 'soft' | 'hard'
export function showcaseUrlSizeAdvice(url: string): { level: ShowcaseSizeLevel; message?: string } {
  const n = url.length
  if (n >= 16000)
    return {
      level: 'hard',
      message:
        'This design makes a very long link — some apps will shorten it and break it. Send the .roomio file instead for a reliable copy.',
    }
  if (n >= 8000)
    return {
      level: 'soft',
      message: 'This is a large design; some chat/email apps may shorten the link. If it doesn’t open, send the .roomio file.',
    }
  return { level: 'ok' }
}

/** Read the encoded showcase payload from a page hash like "#s=…". */
export function readShowcaseHash(hash: string): string | null {
  const m = /[#&]s=([^&]+)/.exec(hash || '')
  return m ? m[1] : null
}

/** Copy text to the clipboard, returning success. Guarded for non-DOM. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy
  }
  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    }
  } catch {
    // ignore
  }
  return false
}
