import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type AuthSessionState =
  { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; userId: string }

/**
 * Whether this browser has a Supabase session, kept current as it changes
 * (OTP verified, logged out, session expired in another tab).
 * onAuthStateChange reports the stored session first (INITIAL_SESSION), so no
 * separate getSession() call is needed.
 */
export function useAuthSession(): AuthSessionState {
  const [state, setState] = useState<AuthSessionState>({ status: 'loading' })

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null
      // A token refresh reports the same user again; keep the same object so
      // nothing re-renders for it.
      setState((current) => {
        if (userId === null) {
          return current.status === 'signed_out' ? current : { status: 'signed_out' }
        }
        return current.status === 'signed_in' && current.userId === userId
          ? current
          : { status: 'signed_in', userId }
      })
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return state
}
