import { app, push as enPush } from './en.json'
import { push as guPush } from './gu.json'
import { push as hiPush } from './hi.json'
import { DEFAULT_LANGUAGE, isLanguage, type Language } from './languages'

// Push notification text (ARCHITECTURE §4.14). push-send sends facts only (the
// kind, the other guest's handle, the guest's language) and the service worker
// writes the sentence from the same translation files as the app, so every
// user-facing string lives in en/hi/gu.json. The named imports keep only the
// `push` section in the service worker bundle, not every screen's text.

// Typed by the English file: a key missing in Hindi or Gujarati fails to compile.
const TEXT: Record<Language, typeof enPush.notifications> = {
  en: enPush.notifications,
  hi: hiPush.notifications,
  gu: guPush.notifications,
}

/** The kinds queue_push() sends, mapped to their translation keys. */
const KEYS = {
  'request.received': 'requestReceived',
  'request.accepted': 'requestAccepted',
  'chat.message': 'chatMessage',
  'session.warning': 'sessionWarning',
  'session.final_prompt': 'sessionFinalPrompt',
} as const satisfies Record<string, keyof typeof enPush.notifications>

type PushKind = keyof typeof KEYS

function isPushKind(value: string): value is PushKind {
  return Object.hasOwn(KEYS, value)
}

export interface NotificationToShow {
  title: string
  body: string
  /** Same tag = replaces the earlier notification instead of stacking. */
  tag: string
  /** A path inside the app; anything else falls back to the home page. */
  url: string
}

/** What push-send sent, as text to show; null when it is not ours or is malformed. */
export function notificationFromPush(value: unknown): NotificationToShow | null {
  if (typeof value !== 'object' || value === null) return null
  const kind =
    'kind' in value && typeof value.kind === 'string' && isPushKind(value.kind) ? value.kind : null
  const tag = 'tag' in value && typeof value.tag === 'string' ? value.tag : null
  if (kind === null || tag === null) return null

  const language =
    'language' in value && typeof value.language === 'string' && isLanguage(value.language)
      ? value.language
      : DEFAULT_LANGUAGE
  // queue_push sends a handle with every request and message notification; the
  // app name stands in rather than a sentence with a blank where a name goes.
  const handle = 'handle' in value && typeof value.handle === 'string' ? value.handle : app.name
  // Only a path in this app: "//host" would open another site from our notification.
  const url =
    'url' in value &&
    typeof value.url === 'string' &&
    value.url.startsWith('/') &&
    !value.url.startsWith('//')
      ? value.url
      : '/'

  const text = TEXT[language][KEYS[kind]]
  return {
    title: text.title.replaceAll('{{handle}}', handle),
    body: text.body.replaceAll('{{handle}}', handle),
    tag,
    url,
  }
}
