import { AppError } from '../../lib/errors'
import { unwrap } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'
import type { ChatState, IncomingRequest, Person } from './types'

export const PEOPLE_KEY = ['people'] as const
export const REQUESTS_KEY = ['requests'] as const

const CHAT_STATES: readonly ChatState[] = [
  'none',
  'request_sent',
  'request_received',
  'chatting',
  'declined',
]

function toChatState(value: string): ChatState {
  const state = CHAT_STATES.find((s) => s === value)
  if (!state) throw new AppError('UNEXPECTED', { field: 'chat_state', value })
  return state
}

/** Everyone else at the guest's venue right now, best matches first. */
export async function getPeople(): Promise<Person[]> {
  // Generated types mark every column non-null; request_id and
  // conversation_id are really NULL unless a request / chat exists, and the
  // Person fields are typed that way.
  const rows = unwrap(await supabase.rpc('get_people'))
  return rows.map((row) => ({
    sessionId: row.session_id,
    handle: row.handle,
    tags: row.tags,
    sharedTags: row.shared_tags,
    online: row.online,
    chatState: toChatState(row.chat_state),
    requestId: row.request_id,
    conversationId: row.conversation_id,
  }))
}

/** Requests waiting for this guest's answer. */
export async function getRequests(): Promise<IncomingRequest[]> {
  const rows = unwrap(await supabase.rpc('get_requests'))
  return rows.map((row) => ({
    id: row.request_id,
    handle: row.handle,
    tags: row.tags,
    sharedTags: row.shared_tags,
    expiresAt: new Date(row.expires_at),
  }))
}

/** "Say hi". Returns the conversation if the two are already chatting. */
export async function sendChatRequest(sessionId: string): Promise<string | null> {
  const rows = unwrap(await supabase.rpc('send_chat_request', { p_target_session_id: sessionId }))
  return rows[0]?.conversation_id ?? null
}

/** Accept (returns the conversation) or decline (returns null). */
export async function respondChatRequest(
  requestId: string,
  accept: boolean,
): Promise<string | null> {
  const rows = unwrap(
    await supabase.rpc('respond_chat_request', { p_request_id: requestId, p_accept: accept }),
  )
  return rows[0]?.conversation_id ?? null
}
