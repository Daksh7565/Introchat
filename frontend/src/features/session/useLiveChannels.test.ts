import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
const { onUserNotice } = await import('./useLiveChannels')

// Which data each server notice re-fetches. A wrong mapping would leave a
// screen stale until the next re-fetch, so each event family is pinned here.
function refetchedBy(event: string, payload: Record<string, string> = {}) {
  const client = new QueryClient()
  const spy = vi.spyOn(client, 'invalidateQueries')
  onUserNotice(client, event, payload)
  return spy.mock.calls.map(([filters]) => (filters?.queryKey ?? []).join('/'))
}

describe('onUserNotice', () => {
  it('a new request refreshes the people list and the requests tab', () => {
    expect(refetchedBy('request.received')).toEqual(['people', 'requests'])
  })

  it('an accepted request also refreshes the chats', () => {
    expect(refetchedBy('request.accepted')).toEqual(['people', 'requests', 'conversations'])
  })

  it('a new message refreshes the chat list and that conversation', () => {
    expect(refetchedBy('chat.message', { conversation_id: 'c1' })).toEqual([
      'conversations',
      'messages/c1',
    ])
  })

  it('a chat closed by the other person leaving also refreshes the people list', () => {
    expect(refetchedBy('chat.closed', { conversation_id: 'c1' })).toEqual([
      'conversations',
      'messages/c1',
      'people',
    ])
  })

  it('session notices refresh the session', () => {
    expect(refetchedBy('session.ended')).toEqual(['live-session'])
  })
})
