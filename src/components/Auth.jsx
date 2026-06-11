import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Auth() {
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function submit() {
    setMsg(null)
    if (!email || !password) {
      setMsg({ type: 'err', text: 'Enter your email and a password.' })
      return
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg({ type: 'ok', text: 'Account created. You can sign in now.' })
        setMode('signin')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">✚</div>
          <div>
            <h1>Weekly Health Tracker</h1>
            <small>Your GLP-1 journey, ready for Tuesday</small>
          </div>
        </div>

        {msg && <div className={`note ${msg.type}`}>{msg.text}</div>}

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        <div className="auth-switch">
          {mode === 'signin' ? (
            <button className="link" onClick={() => setMode('signup')}>
              New here? Create an account
            </button>
          ) : (
            <button className="link" onClick={() => setMode('signin')}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
