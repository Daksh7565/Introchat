// Screen-level shapes for the people, requests and chat screens. They mirror
// what the SQL functions will return (ARCHITECTURE_AND_DATA_FLOW.md §4.7–4.9);
// when those functions exist (M4), the RPC results are mapped into these types
// and the screens do not change.

/** Where the viewer stands with one person (ARCHITECTURE §4.7 `chat_state`). */
export type ChatState = 'none' | 'request_sent' | 'request_received' | 'chatting' | 'declined'

/** One card on the people list. Never carries user id, phone, age, gender or location. */
export interface Person {
  sessionId: string
  handle: string
  tags: string[]
  sharedTags: string[]
  online: boolean
  chatState: ChatState
  /** The request to answer, when chatState is request_received. */
  requestId?: string | null
  /** The open conversation, when chatState is chatting. */
  conversationId?: string | null
}

export interface IncomingRequest {
  id: string
  handle: string
  tags: string[]
  sharedTags: string[]
  expiresAt: Date
}

export interface ConversationSummary {
  id: string
  partnerHandle: string
  lastMessage: string | null
  lastMessageAt: Date | null
  unread: number
  /** false = the other person left (or blocked): read-only, can still be reported. */
  canSend: boolean
}

export interface ChatMessage {
  id: string
  fromMe: boolean
  body: string
  sentAt: Date
  /** Only meaningful for my own messages: the other person has read it. */
  seen: boolean
  /** My message on its way to the server (shown as "Sending…"). */
  pending?: boolean
  /** My message the server did not confirm (shown as "Not sent", can be retried). */
  failed?: boolean
}
