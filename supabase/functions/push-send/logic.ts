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

/** What the service worker receives and shows (sw.ts). */
export interface PushNotification {
  title: string
  body: string
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

// Draft Hindi and Gujarati, reviewed with the rest of the app's text in M9.
// {h} is the other guest's handle. Never any message text (§4.14).
const TEXT: Record<Language, Record<PushKind, [title: string, body: string]>> = {
  en: {
    'request.received': ['{h} wants to chat', 'Open IntroChat to reply.'],
    'request.accepted': ['{h} accepted your request', 'Say hello!'],
    'chat.message': ['New message from {h}', 'Open IntroChat to read it.'],
    'session.warning': ['Your time is almost up', 'Open IntroChat to keep chatting.'],
    'session.final_prompt': ['Your time is up', 'Open IntroChat in the next 2 minutes to continue.'],
  },
  hi: {
    'request.received': ['{h} चैट करना चाहते हैं', 'जवाब देने के लिए IntroChat खोलें।'],
    'request.accepted': ['{h} ने आपकी रिक्वेस्ट स्वीकार की', 'हैलो कहें!'],
    'chat.message': ['{h} का नया मैसेज', 'पढ़ने के लिए IntroChat खोलें।'],
    'session.warning': ['आपका समय लगभग खत्म है', 'चैट जारी रखने के लिए IntroChat खोलें।'],
    'session.final_prompt': ['आपका समय खत्म हो गया', 'जारी रखने के लिए 2 मिनट में IntroChat खोलें।'],
  },
  gu: {
    'request.received': ['{h} ચેટ કરવા માંગે છે', 'જવાબ આપવા IntroChat ખોલો.'],
    'request.accepted': ['{h} એ તમારી રિક્વેસ્ટ સ્વીકારી', 'હેલો કહો!'],
    'chat.message': ['{h} નો નવો મેસેજ', 'વાંચવા માટે IntroChat ખોલો.'],
    'session.warning': ['તમારો સમય લગભગ પૂરો થયો છે', 'ચેટ ચાલુ રાખવા IntroChat ખોલો.'],
    'session.final_prompt': ['તમારો સમય પૂરો થયો', 'ચાલુ રાખવા 2 મિનિટમાં IntroChat ખોલો.'],
  },
}

export function buildNotification(request: PushRequest): PushNotification {
  const [title, body] = TEXT[request.language][request.kind]
  const handle = request.handle ?? 'IntroChat'
  const tag =
    request.kind === 'chat.message' && request.conversationId
      ? `chat:${request.conversationId}`
      : request.kind.startsWith('session.')
        ? 'session'
        : 'requests'
  return { title: title.replace('{h}', handle), body, tag, url: '/' }
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
