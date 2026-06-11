import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import Auth from './components/Auth.jsx'
import Dashboard from './components/Dashboard.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) {
    return <div className="auth-wrap muted">Loading…</div>
  }

  return session ? <Dashboard session={session} /> : <Auth />
}
