import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Dev-only logging for environment variables
if (import.meta.env.DEV) {
  console.log('[Supabase] Environment check:', {
    VITE_SUPABASE_URL: supabaseUrl ? '✓ present' : '✗ missing',
    VITE_SUPABASE_ANON_KEY: supabaseAnonKey ? '✓ present' : '✗ missing',
  })
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[Supabase] Missing environment variables. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.'
  )
}

// Create client
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

// Helper function to get or create anonymous session
export async function ensureAnonymousSession() {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      console.error('[Supabase] Error getting session:', sessionError)
      throw sessionError
    }

    if (session) {
      if (import.meta.env.DEV) {
        console.log('[Supabase] Existing session found:', session.user.id)
      }
      return session
    }

    // No session, sign in anonymously
    if (import.meta.env.DEV) {
      console.log('[Supabase] No session, signing in anonymously...')
    }

    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) {
      console.error('[Supabase] Failed to create anonymous session:', error)
      throw error
    }

    if (import.meta.env.DEV) {
      console.log('[Supabase] Anonymous session created:', data.session?.user.id)
    }

    return data.session
  } catch (error) {
    console.error('[Supabase] ensureAnonymousSession error:', error)
    throw error
  }
}

// Check if Supabase is properly configured
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey)
}
