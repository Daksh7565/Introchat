// Run: npx deno test supabase/functions/sms-hook/logic.test.ts
import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { errorBody, HookError, otpMessage, refusalError, toE164, verifyAndParse } from './logic.ts'

// A test-only secret (32 zero bytes), never used anywhere real.
const BASE64_SECRET = btoa(String.fromCharCode(...new Uint8Array(32)))
const CONFIGURED_SECRET = `v1,whsec_${BASE64_SECRET}`

function signedRequest(body: string): Headers {
  const id = 'msg_test'
  const timestamp = new Date()
  const signature = new Webhook(BASE64_SECRET).sign(id, timestamp, body)
  return new Headers({
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': signature,
  })
}

const body = JSON.stringify({ user: { phone: '919876543210' }, sms: { otp: '123456' } })

Deno.test('a correctly signed call is accepted and parsed', () => {
  assertEquals(verifyAndParse(body, signedRequest(body), CONFIGURED_SECRET), {
    phone: '919876543210',
    otp: '123456',
  })
})

Deno.test('a tampered body is refused as INVALID_SIGNATURE', () => {
  const headers = signedRequest(body)
  const tampered = body.replace('919876543210', '919000000000')
  const error = assertThrows(() => verifyAndParse(tampered, headers, CONFIGURED_SECRET), HookError)
  assertEquals([error.httpCode, error.code], [401, 'INVALID_SIGNATURE'])
})

Deno.test('a call with no signature is refused', () => {
  const error = assertThrows(() => verifyAndParse(body, new Headers(), CONFIGURED_SECRET), HookError)
  assertEquals(error.code, 'INVALID_SIGNATURE')
})

Deno.test('a signed call without a phone or a numeric code is refused', () => {
  const bad = JSON.stringify({ user: {}, sms: { otp: 'abc' } })
  const error = assertThrows(() => verifyAndParse(bad, signedRequest(bad), CONFIGURED_SECRET), HookError)
  assertEquals([error.httpCode, error.code], [400, 'INVALID_PAYLOAD'])
})

Deno.test('the SMS text carries the code and a do-not-share warning', () => {
  const text = otpMessage('482913')
  assertEquals(text.startsWith('482913 '), true)
  assertEquals(text.includes('Do not share'), true)
})

Deno.test('numbers are sent to the gateway in E.164', () => {
  assertEquals(toE164('919876543210'), '+919876543210')
  assertEquals(toE164('+91 98765 43210'), '+919876543210')
})

Deno.test('refusals map to the status Supabase Auth expects', () => {
  assertEquals(refusalError('RATE_LIMITED').httpCode, 429)
  assertEquals(refusalError('BANNED').httpCode, 403)
  assertEquals(JSON.parse(errorBody(refusalError('SMS_DAILY_LIMIT'))), {
    error: { http_code: 429, message: 'SMS_DAILY_LIMIT' },
  })
})
