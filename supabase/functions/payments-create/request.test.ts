import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { HttpError } from '../_shared/http.ts'
import { parseCreateRequest } from './request.ts'

const ENTRY = {
  purpose: 'scan_fee',
  slug: 'chai-cafe',
  qr_token: 'Ab3dEf6hIj9kLm2n',
  device_id: 'device-12345678',
  reading: { latitude: 23.02, longitude: 72.57, accuracy_m: 12, age_seconds: 1 },
}

Deno.test('an entry payment carries the scanned table and a reading', () => {
  assertEquals(parseCreateRequest(ENTRY), {
    purpose: 'scan_fee',
    slug: 'chai-cafe',
    qrToken: 'Ab3dEf6hIj9kLm2n',
    deviceId: 'device-12345678',
    reading: { latitude: 23.02, longitude: 72.57, accuracyM: 12, ageSeconds: 1 },
  })
})

Deno.test('an in-session payment needs only its purpose', () => {
  assertEquals(parseCreateRequest({ purpose: 'continue' }).slug, undefined)
})

Deno.test('an amount sent by the phone is ignored, never used', () => {
  // There is no amount field to read: the server takes it from settings.
  assertEquals('amount' in parseCreateRequest({ ...ENTRY, amount: 1 }), false)
})

Deno.test('malformed requests are refused before the database', () => {
  assertThrows(() => parseCreateRequest({ purpose: 'tip' }), HttpError)
  assertThrows(() => parseCreateRequest(null), HttpError)
  assertThrows(() => parseCreateRequest({ ...ENTRY, reading: { ...ENTRY.reading, latitude: 'x' } }), HttpError)
  assertThrows(() => parseCreateRequest({ ...ENTRY, reading: { ...ENTRY.reading, accuracy_m: Number.NaN } }), HttpError)
  assertThrows(() => parseCreateRequest({ ...ENTRY, qr_token: undefined }), HttpError)
})
