import { useState } from 'react'
import { useAuth } from '../auth'

export function AuthScreen() {
  const status = useAuth((s) => s.status)
  const error = useAuth((s) => s.error)
  const busy = useAuth((s) => s.busy)
  const login = useAuth((s) => s.login)
  const signup = useAuth((s) => s.signup)
  const continueAsGuest = useAuth((s) => s.continueAsGuest)
  const clearError = useAuth((s) => s.clearError)

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'login') await login(email.trim(), password)
    else await signup(email.trim(), password, name.trim())
  }

  const switchMode = (m: 'login' | 'signup') => {
    setMode(m)
    clearError()
  }

  return (
    <div className="start">
      <div className="start-card" style={{ width: 440 }}>
        <div className="brand">
          <span className="dot" />
          Roomio
        </div>
        <h1 className="start-title" style={{ fontSize: 30 }}>
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="start-sub" style={{ marginBottom: 24 }}>
          {mode === 'login'
            ? 'Log in to access your saved rooms from anywhere.'
            : 'Sign up to save your room designs to your account.'}
        </p>

        <div className="segmented" style={{ marginBottom: 22 }}>
          <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} type="button">
            Log in
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')} type="button">
            Sign up
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <input
              className="auth-input"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
          />

          {error && <div className="auth-error">{error}</div>}

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <button
          className="auth-guest"
          type="button"
          onClick={continueAsGuest}
          title="Designs save to this browser only"
        >
          Continue as guest →
        </button>
        {status === 'offline' && (
          <p className="hint" style={{ textAlign: 'center' }}>
            Server unavailable — you can still design; rooms save locally.
          </p>
        )}
      </div>
    </div>
  )
}
