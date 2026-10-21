import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { ADMIN_AUTH_QUERY_KEY, loadAdminAuth } from './adminAuth'

/** The admin's current sign-in state, refreshed whenever Supabase Auth changes. */
export function useAdminAuth() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => {
      // Deferred: Supabase holds an auth lock while this callback runs, and the
      // refetch calls supabase.auth again; calling it synchronously from here
      // can deadlock (documented supabase-js behaviour).
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ADMIN_AUTH_QUERY_KEY })
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  return useQuery({
    queryKey: ADMIN_AUTH_QUERY_KEY,
    queryFn: loadAdminAuth,
    // Sign-in state must never be guessed from a stale cache.
    staleTime: 0,
    retry: false,
  })
}
