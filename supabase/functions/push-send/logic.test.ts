import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { buildNotification, parseRequest, PushError, secretsMatch } from './logic.ts'

const USER = '00000000-0000-4000-8000-0000000000f2'
const CONV = '52000000-0000-4000-8000-000000000001'

Deno.test('a message notification names the sender, never the text', () => {
  const n = buildNotification(
    parseRequest({ user_id: USER, kind: 'chat.message', handle: 'Mango-4821', language: 'en', conversation_id: CONV }),
  )
  assertEquals(n.title, 'New message from Mango-4821')
  assertEquals(n.tag, `chat:${CONV}`)
})

Deno.test('the text is in the recipient language', () => {
  const n = buildNotification(parseRequest({ user_id: USER, kind: 'request.received', handle: 'Mango-4821', language: 'gu' }))
  assertEquals(n.title, 'Mango-4821 ચેટ કરવા માંગે છે')
})

Deno.test('an unknown language falls back to English', () => {
  assertEquals(parseRequest({ user_id: USER, kind: 'session.warning', language: 'fr' }).language, 'en')
})

Deno.test('session notifications replace each other', () => {
  const warning = buildNotification(parseRequest({ user_id: USER, kind: 'session.warning' }))
  const final = buildNotification(parseRequest({ user_id: USER, kind: 'session.final_prompt' }))
  assertEquals(warning.tag, final.tag)
})

Deno.test('an unknown kind or a malformed user id is refused', () => {
  assertThrows(() => parseRequest({ user_id: USER, kind: 'chat.deleted' }), PushError)
  assertThrows(() => parseRequest({ user_id: 'nobody', kind: 'chat.message' }), PushError)
})

Deno.test('secrets must match exactly', () => {
  assertEquals(secretsMatch('abc123', 'abc123'), true)
  assertEquals(secretsMatch('abc124', 'abc123'), false)
  assertEquals(secretsMatch('abc12', 'abc123'), false)
  assertEquals(secretsMatch(null, 'abc123'), false)
  assertEquals(secretsMatch('abc123', null), false)
})
