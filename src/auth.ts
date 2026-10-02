import { create } from 'zustand'
import { api, ApiError, backendAvailable, setUnauthorizedHandler } from './api'
import { toast } from './toast'

export interface User {
  id: string
  email: string
  name?: string
}

export type AuthStatus =
  | 'loading' // checking session on boot
  | 'anon' // backend up, not logged in
  | 'authed' // logged in
  | 'offline' // backend unreachable OR remembered-guest — local-only mode

// WIZ-03: a returning guest must not be re-gated at the login wall on every
// visit. When the user explicitly chooses "Continue as guest" we remember it in
// localStorage; on boot, if that flag is set and there's no active session, we
// drop straight into local-only mode instead of showing the wall again.
const GUEST_KEY = 'roomio.guest.v1'

/** Has the user previously chosen to continue as a guest on this browser? */
export function getGuestPreference(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist (or clear) the "continue as guest" choice. Swallows storage errors. */
export function setGuestPreference(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (on) localStorage.setItem(GUEST_KEY, '1')
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    // ignore: storage unavailable / full / private mode
  }
}

interface AuthState {
  status: AuthStatus
  user: User | null
  error: string | null
  busy: boolean
  /** force the auth wall even from inside the app (a guest asking to sign in) */
  promptAuth: boolean
  init: () => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<boolean>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  continueAsGuest: () => void
  /** open the login wall from within the app (WIZ-03: guests can still sign in) */
  requestSignIn: () => void
  clearError: () => void
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  error: null,
  busy: false,
  promptAuth: false,

  init: async () => {
    const up = await backendAvailable()
    if (!up) {
      set({ status: 'offline', user: null })
      return
    }
    try {
      const { user } = await api.get<{ user: User }>('/auth/me')
      set({ status: 'authed', user })
    } catch {
      // Backend reachable but no active session. A user who earlier chose
      // "Continue as guest" is dropped straight into local-only mode rather
      // than being re-gated at the login wall (WIZ-03); everyone else sees it.
      set({ status: getGuestPreference() ? 'offline' : 'anon', user: null })
    }
  },

  signup: async (email, password, name) => {
    set({ busy: true, error: null })
    try {
      const { user } = await api.post<{ user: User }>('/auth/signup', { email, password, name })
      // They now have an account — forget the guest preference so a future
      // session expiry routes back to the login wall, not silent guest mode.
      setGuestPreference(false)
      set({ status: 'authed', user, busy: false, promptAuth: false })
      return true
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Sign up failed'
      set({ error: msg, busy: false })
      return false
    }
  },

  login: async (email, password) => {
    set({ busy: true, error: null })
    try {
      const { user } = await api.post<{ user: User }>('/auth/login', { email, password })
      setGuestPreference(false)
      set({ status: 'authed', user, busy: false, promptAuth: false })
      return true
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Login failed'
      set({ error: msg, busy: false })
      return false
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* ignore */
    }
    // An explicit logout clears the remembered-guest flag and returns to the wall.
    setGuestPreference(false)
    set({ status: 'anon', user: null, promptAuth: false })
  },

  continueAsGuest: () => {
    setGuestPreference(true)
    set({ status: 'offline', promptAuth: false })
  },
  requestSignIn: () => set({ promptAuth: true, error: null }),
  clearError: () => set({ error: null }),
}))

// Session-expiry detection (CODE-04): a 401 from any non-auth endpoint while
// we believe we're logged in means the server no longer honours our session.
// Flip to 'anon' so the app routes back to the login screen (AuthScreen shows
// the message below); in-memory work is untouched and new saves fall back to
// this browser's localStorage until the user logs in again.
setUnauthorizedHandler(() => {
  if (useAuth.getState().status !== 'authed') return
  useAuth.setState({
    status: 'anon',
    user: null,
    error: 'Your session has expired — please log in again.',
  })
  toast('Your session has expired — please log in again. Unsaved work stays on this device.', 'error')
})
