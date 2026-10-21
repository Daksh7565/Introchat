import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { CONVERSATIONS_KEY, messagesKey } from '../chat/api'
import { PEOPLE_KEY, REQUESTS_KEY } from '../people/api'
import { LIVE_SESSION_KEY } from './api'

interface Payload {
  conversation_id?: string
}

function refetchAll(client: QueryClient) {
  for (const key of [PEOPLE_KEY, REQUESTS_KEY, CONVERSATIONS_KEY, ['messages'], LIVE_SESSION_KEY]) {
    void client.invalidateQueries({ queryKey: key })
  }
}

/** What each server notice means for the screens (ARCHITECTURE §7): which data to re-fetch. */
export function onUserNotice(client: QueryClient, event: string, payload: Payload) {
  const refetch = (key: readonly unknown[]) => void client.invalidateQueries({ queryKey: key })
  if (event.startsWith('request.')) {
    refetch(PEOPLE_KEY)
    refetch(REQUESTS_KEY)
    if (event === 'request.accepted') refetch(CONVERSATIONS_KEY)
  } else if (event.startsWith('chat.')) {
    refetch(CONVERSATIONS_KEY)
    if (payload.conversation_id) refetch(messagesKey(payload.conversation_id))
    if (event === 'chat.closed') refetch(PEOPLE_KEY)
  } else if (event.startsWith('session.')) {
    refetch(LIVE_SESSION_KEY)
  }
}

/**
 * Listens on the guest's private channels for as long as the session is live:
 * user:{id} (requests, messages, session notices) and venue:{id} (who comes
 * and goes). Notices only say what changed; the data is always re-fetched, so
 * a missed notice delays an update but never loses one. Every (re)connect
 * re-fetches everything for the same reason (supabase-js rejoins a dropped
 * channel on its own, with back-off).
 */
export function useLiveChannels(userId: string, venueId: string | null): void {
  const client = useQueryClient()

  useEffect(() => {
    if (venueId === null) return
    const onSubscribed = (status: string) => {
      if (status === 'SUBSCRIBED') refetchAll(client)
    }
    const user = supabase
      .channel(`user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, ({ event, payload }) =>
        onUserNotice(client, event, (payload ?? {}) as Payload),
      )
      .subscribe(onSubscribed)
    const venue = supabase
      .channel(`venue:${venueId}`, { config: { private: true } })
      .on(
        'broadcast',
        { event: '*' },
        () => void client.invalidateQueries({ queryKey: PEOPLE_KEY }),
      )
      .subscribe(onSubscribed)
    return () => {
      void supabase.removeChannel(user)
      void supabase.removeChannel(venue)
    }
  }, [client, userId, venueId])
}
