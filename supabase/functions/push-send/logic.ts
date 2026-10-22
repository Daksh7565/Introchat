// Pure parts of push-send, kept apart from the request handler so they can be
// unit-tested without a server, a database or a push service.

export type PushKind =
  | 'request.received'
  | 'request.accepted'
  | 'chat.message'
  | 'session.warning'
  | 'session.final_prompt'

const KINDS: readonly PushKind[] = [
  'request.received',
  'request.accepted',
  'chat.message',
  'session.warning',
  'session.final_prompt',
]

export type Language = 'en' | 'hi' | 'gu'

/** What queue_push() in the database sends. */
export interface PushRequest {
  userId: string
  kind: PushKind
  handle: string | null
  language: Language
  conversationId: string | null
}

/**
 * What the service worker receives (sw.ts). Facts only: the phone writes the
 * text from the app's translation files (push.notifications in en/hi/gu.json),
 * so every user-facing string lives in one place.
 */
export interface PushNotification {
  kind: PushKind
  /** The other guest's handle, for request and message notifications. */
  handle: string | null
  language: Language
  /** Same tag = replaces the earlier notification instead of stacking. */
  tag: string
  url: string
}

export class PushError extends Error {
  constructor(
    readonly httpCode: number,
    readonly code: string,
  ) {
    super(code)
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function parseRequest(value: unknown): PushRequest {
  if (typeof value !== 'object' || value === null) throw new PushError(400, 'INVALID_PAYLOAD')
  const v = value as Record<string, unknown>
  const kind = KINDS.find((k) => k === v.kind)
  if (typeof v.user_id !== 'string' || !UUID.test(v.user_id) || !kind) {
    throw new PushError(400, 'INVALID_PAYLOAD')
  }
  const language: Language = v.language === 'hi' || v.language === 'gu' ? v.language : 'en'
  return {
    userId: v.user_id,
    kind,
    handle: typeof v.handle === 'string' ? v.handle : null,
    language,
    conversationId:
      typeof v.conversation_id === 'string' && UUID.test(v.conversation_id)
        ? v.conversation_id
        : null,
  }
}

export function buildNotification(request: PushRequest): PushNotification {
  const tag =
    request.kind === 'chat.message' && request.conversationId
      ? `chat:${request.conversationId}`
      : request.kind.startsWith('session.')
        ? 'session'
        : 'requests'
  return { kind: request.kind, handle: request.handle, language: request.language, tag, url: '/' }
}

/** Compares two secrets in time that does not depend on where they differ. */
export function secretsMatch(given: string | null, expected: string | null): boolean {
  if (!given || !expected) return false
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}
