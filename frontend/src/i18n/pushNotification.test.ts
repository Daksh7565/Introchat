import { describe, expect, it } from 'vitest'
import { notificationFromPush } from './pushNotification'

// The payload push-send builds (supabase/functions/push-send/logic.ts).
const KINDS = [
  'request.received',
  'request.accepted',
  'chat.message',
  'session.warning',
  'session.final_prompt',
]

function payload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'chat.message',
    handle: 'Mango-4821',
    language: 'en',
    tag: 'chat:1',
    url: '/',
    ...overrides,
  }
}

describe('notificationFromPush', () => {
  it('writes every kind in every language, with nothing left unfilled', () => {
    for (const language of ['en', 'hi', 'gu']) {
      for (const kind of KINDS) {
        const shown = notificationFromPush(payload({ kind, language }))
        expect(shown?.title, `${language} ${kind}`).toBeTruthy()
        expect(shown?.body, `${language} ${kind}`).toBeTruthy()
        expect(`${shown?.title} ${shown?.body}`).not.toContain('{{')
      }
    }
  })

  it('names the other guest in their own words for the language', () => {
    expect(notificationFromPush(payload())).toEqual({
      title: 'New message from Mango-4821',
      body: 'Open IntroChat to read it.',
      tag: 'chat:1',
      url: '/',
    })
    expect(notificationFromPush(payload({ language: 'gu' }))?.title).toBe('Mango-4821 નો નવો મેસેજ')
  })

  it('falls back to English for a language the app does not ship', () => {
    expect(notificationFromPush(payload({ language: 'fr' }))?.title).toBe(
      'New message from Mango-4821',
    )
  })

  it('uses the app name when the handle is missing', () => {
    expect(notificationFromPush(payload({ handle: null }))?.title).toBe(
      'New message from IntroChat',
    )
  })

  it('only opens paths inside the app', () => {
    expect(notificationFromPush(payload({ url: '//evil.example' }))?.url).toBe('/')
    expect(notificationFromPush(payload({ url: 'https://evil.example' }))?.url).toBe('/')
    expect(notificationFromPush(payload({ url: '/v/abc' }))?.url).toBe('/v/abc')
  })

  it('shows nothing for a payload that is not ours', () => {
    expect(notificationFromPush(null)).toBeNull()
    expect(notificationFromPush('hello')).toBeNull()
    expect(notificationFromPush(payload({ kind: 'chat.deleted' }))).toBeNull()
    expect(notificationFromPush(payload({ tag: undefined }))).toBeNull()
    // The shape the service worker read before push text moved to the app (M8).
    expect(
      notificationFromPush({ title: 'Hi', body: 'There', tag: 'requests', url: '/' }),
    ).toBeNull()
  })
})
