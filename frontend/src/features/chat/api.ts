import { unwrap } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'
import type { ChatMessage, ConversationSummary } from '../people/types'

export const CONVERSATIONS_KEY = ['conversations'] as const
export const messagesKey = (conversationId: string) => ['messages', conversationId] as const

// Declared here: generated types mark last_message / last_message_at non-null.
interface ConversationRow {
  conversation_id: string
  partner_handle: string
  last_message: string | null
  last_message_at: string | null
  unread: number
  can_send: boolean
}

export async function getConversations(): Promise<ConversationSummary[]> {
  const rows = unwrap(await supabase.rpc('get_conversations')) as ConversationRow[]
  return rows.map((row) => ({
    id: row.conversation_id,
    partnerHandle: row.partner_handle,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
    unread: row.unread,
    canSend: row.can_send,
  }))
}

/** The latest messages of a conversation, oldest first. */
export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const rows = unwrap(
    await supabase.rpc('get_messages', { p_conversation_id: conversationId, p_limit: 100 }),
  )
  return rows.map((row) => ({
    id: String(row.message_id),
    fromMe: row.from_me,
    body: row.body,
    sentAt: new Date(row.created_at),
    seen: row.seen,
  }))
}

/**
 * Sends one message. clientMsgId is made once per message by the phone, so a
 * retry after a dropped connection can never store it twice.
 */
export async function sendMessage(
  conversationId: string,
  body: string,
  clientMsgId: string,
): Promise<void> {
  unwrap(
    await supabase.rpc('send_message', {
      p_conversation_id: conversationId,
      p_body: body,
      p_client_msg_id: clientMsgId,
    }),
  )
}

export async function markSeen(conversationId: string, upToMessageId: string): Promise<void> {
  unwrap(
    await supabase.rpc('mark_seen', {
      p_conversation_id: conversationId,
      p_up_to_message_id: Number(upToMessageId),
    }),
  )
}
