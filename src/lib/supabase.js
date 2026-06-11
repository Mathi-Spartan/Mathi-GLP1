import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Shown in the browser console if the keys aren't set in Vercel yet.
  console.error(
    'Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Vercel project settings.'
  )
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'public-anon-key')
