// Pure parts of the Send SMS hook, kept apart from the request handler so they
// can be unit-tested without a server, a database or the gateway.
import { Webhook } from 'npm:standardwebhooks@1.0.0'

/** What Supabase Auth sends to the hook (only the fields we use). */
export interface HookPayload {
  phone: string
  otp: string
}

export class HookError extends Error {
  constructor(
    readonly httpCode: number,
    readonly code: string,
  ) {
    super(code)
  }
}

/**
 * Verifies the Standard Webhooks signature Supabase Auth puts on every hook
 * call, then returns the parsed payload. Anything unsigned or tampered with is
 * refused before any database or SMS work happens.
 *
 * `secret` is the configured value, "v1,whsec_<base64>".
 */
export function verifyAndParse(rawBody: string, headers: Headers, secret: string): HookPayload {
  const base64Secret = secret.replace(/^v1,whsec_/, '')
  let event: unknown
  try {
    event = new Webhook(base64Secret).verify(rawBody, Object.fromEntries(headers))
  } catch {
    throw new HookError(401, 'INVALID_SIGNATURE')
  }
  if (typeof event !== 'object' || event === null) throw new HookError(400, 'INVALID_PAYLOAD')
  const { user, sms } = event as { user?: { phone?: unknown }; sms?: { otp?: unknown } }
  const phone = user?.phone
  const otp = sms?.otp
  if (typeof phone !== 'string' || typeof otp !== 'string' || !/^\d{4,10}$/.test(otp)) {
    throw new HookError(400, 'INVALID_PAYLOAD')
  }
  return { phone, otp }
}

/** The SMS text. Short, says what it is for, warns against sharing. */
export function otpMessage(otp: string): string {
  return `${otp} is your IntroChat code. It expires in 5 minutes. Do not share it with anyone.`
}

/** '919876543210' or '+919876543210' → '+919876543210' (the gateway wants E.164). */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `+${digits}`
}

// How each gatekeeper refusal is reported back to Supabase Auth. The message
// (a code) reaches the phone as the error text; the app translates it.
const REFUSAL_STATUS: Record<string, number> = {
  PHONE_NOT_ALLOWED: 400,
  BANNED: 403,
  RATE_LIMITED: 429,
  SMS_DAILY_LIMIT: 429,
}

export function refusalError(refusal: string): HookError {
  return new HookError(REFUSAL_STATUS[refusal] ?? 403, refusal)
}

/** The response body Supabase Auth expects for a refusal or failure. */
export function errorBody(error: HookError): string {
  return JSON.stringify({ error: { http_code: error.httpCode, message: error.code } })
}
