import type { AuthError, PostgrestError } from '@supabase/supabase-js'
import { reportError } from './monitoring'

/**
 * Every failure the UI shows is an AppError with a code. The server raises codes
 * (ARCHITECTURE §2.5, §10), never sentences; the screen translates the code with
 * errorMessageKey(). Anything unrecognised becomes UNEXPECTED and is reported.
 */
export class AppError extends Error {
  readonly code: string
  readonly details: unknown

  constructor(code: string, details: unknown = null, cause?: unknown) {
    super(code, { cause })
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

// Codes the UI has a translation for. A code the server raises but the UI does
// not know falls back to UNEXPECTED (and is reported), so a missing translation
// never shows a raw code to anyone.
const KNOWN_CODES = [
  'UNEXPECTED',
  'NETWORK',
  'FORBIDDEN',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'MFA_CODE_INVALID',
  // Venues and tables (migration 0003)
  'SLUG_TAKEN',
  'VALIDATION_FAILED',
  'VENUE_NOT_FOUND',
  'VENUE_CLOSED',
  'TABLE_NOT_FOUND',
  'TABLE_LABEL_TAKEN',
  'VENUE_HAS_NO_TABLES',
  'SETTING_NOT_OVERRIDABLE',
  'SETTING_VALUE_INVALID',
  'INVALID_TIMEZONE',
  'LOCATION_INVALID',
  // Phone location (lib/location.ts) and address search
  'LOCATION_UNSUPPORTED',
  'LOCATION_PERMISSION_DENIED',
  'LOCATION_UNAVAILABLE',
  'LOCATION_TIMEOUT',
  'LOCATION_NO_READINGS',
  'ADDRESS_SEARCH_FAILED',
  // Guest login: the phone form, Supabase Auth, and the sign-up / Send SMS hooks
  'PHONE_INVALID',
  'PHONE_NOT_ALLOWED',
  'SIGNUP_NOT_ALLOWED',
  'BANNED',
  'SMS_DAILY_LIMIT',
  'SMS_SEND_FAILED',
  'OTP_INVALID',
  // Guest profile (migration guest_identity)
  'NOT_A_GUEST',
  'CONSENT_VERSION_OUTDATED',
  'CONSENT_REQUIRED',
  'AGE_BLOCKED',
  'BIRTH_YEAR_LOCKED',
  'PROFILE_INVALID',
  'TAG_INVALID',
  'TAGS_COUNT_INVALID',
  'TAG_NOT_ALLOWED',
  // Sessions (migration sessions)
  'PROFILE_INCOMPLETE',
  'NOT_AT_VENUE',
  'LOCATION_INACCURATE',
  'KICKED_COOLDOWN',
  'PAYMENT_REQUIRED',
  'SESSION_NOT_ACTIVE',
  'CONTINUE_NOT_AVAILABLE',
  'FEATURE_DISABLED',
  // Chat (migration chat)
  'TARGET_NOT_AVAILABLE',
  'NOT_SAME_VENUE',
  'BLOCKED',
  'REQUEST_EXISTS',
  'REQUEST_NOT_ALLOWED',
  'TOO_MANY_PENDING_REQUESTS',
  'REQUEST_NOT_FOUND',
  'REQUEST_NOT_PENDING',
  'CONVERSATION_READ_ONLY',
  'CONVERSATION_NOT_FOUND',
  'MESSAGE_INVALID',
  // Payments (migration payments_credits, payments-* Edge Functions, Checkout)
  'NO_CREDITS',
  'PAYMENT_NOT_NEEDED',
  'PAYMENT_INVALID',
  'PAYMENT_NOT_FOUND',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'PAYMENTS_NOT_CONFIGURED',
  'PAYMENT_CANCELLED',
  'PAYMENT_CONFIRMING',
  'PAYMENT_NOT_REFUNDABLE',
  'NOT_SIGNED_IN',
  // Admin settings editor
  'SETTING_NOT_EDITABLE',
  'UNKNOWN_SETTING',
  // Safety (migration safety)
  'REPORT_NOT_FOUND',
  'REPORT_ALREADY_RESOLVED',
  'BAN_NOT_FOUND',
  'TAG_NOT_FOUND',
  // Console operations (migration console_ops) and admin passwords
  'VENUE_NOT_CLOSED',
  'ADMIN_LOGIN_NOT_FOUND',
  'ADMIN_EXISTS',
  'ADMIN_SELF',
  'ADMIN_NOT_FOUND',
  'LAST_ADMIN',
  'DELETION_NOT_REQUESTED',
  'DELETION_NOT_PENDING',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_MISMATCH',
  'PASSWORD_WEAK',
  'PASSWORD_SAME',
] as const
export type KnownErrorCode = (typeof KNOWN_CODES)[number]

function isKnownCode(code: string): code is KnownErrorCode {
  return (KNOWN_CODES as readonly string[]).includes(code)
}

/** The i18n key for an error, always one that exists in en/hi/gu. */
export function errorMessageKey(error: unknown): `errors.${KnownErrorCode}` {
  const code = error instanceof AppError ? error.code : 'UNEXPECTED'
  return `errors.${isKnownCode(code) ? code : 'UNEXPECTED'}`
}

// SQL functions raise `RAISE EXCEPTION 'SOME_CODE'`: the message is the code.
const SERVER_CODE = /^[A-Z][A-Z0-9_]+$/

function parseDetails(details: string | null | undefined): unknown {
  if (!details) return null
  try {
    return JSON.parse(details)
  } catch {
    // Not every detail is JSON (e.g. a key name); keep it as text.
    return details
  }
}

function looksLikeNetworkFailure(message: string): boolean {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message)
}

/** Converts a database (PostgREST) error into an AppError. */
export function fromPostgrestError(error: PostgrestError): AppError {
  if (SERVER_CODE.test(error.message)) {
    const appError = new AppError(error.message, parseDetails(error.details), error)
    if (!isKnownCode(error.message)) {
      // A real server code the UI cannot translate yet: show UNEXPECTED, but
      // make sure we hear about it.
      reportError(appError, 'untranslated-server-code')
    }
    return appError
  }
  if (looksLikeNetworkFailure(error.message)) {
    return new AppError('NETWORK', null, error)
  }
  const appError = new AppError('UNEXPECTED', { message: error.message, code: error.code }, error)
  reportError(appError, 'unexpected-postgrest-error')
  return appError
}

// Supabase Auth error codes we expect during admin and guest sign-in, and what we show.
const AUTH_CODE_MAP: Record<string, KnownErrorCode> = {
  invalid_credentials: 'INVALID_CREDENTIALS',
  // Supabase uses one code for a wrong SMS code and an expired one (checked on dev).
  otp_expired: 'OTP_INVALID',
  over_sms_send_rate_limit: 'RATE_LIMITED',
  sms_send_failed: 'SMS_SEND_FAILED',
  weak_password: 'PASSWORD_WEAK',
  same_password: 'PASSWORD_SAME',
  email_not_confirmed: 'INVALID_CREDENTIALS',
  user_banned: 'FORBIDDEN',
  mfa_verification_failed: 'MFA_CODE_INVALID',
  mfa_challenge_expired: 'MFA_CODE_INVALID',
  over_request_rate_limit: 'RATE_LIMITED',
  over_email_send_rate_limit: 'RATE_LIMITED',
}

/** Converts a Supabase Auth error into an AppError. */
export function fromAuthError(error: AuthError): AppError {
  const mapped = error.code ? AUTH_CODE_MAP[error.code] : undefined
  if (mapped) {
    return new AppError(mapped, null, error)
  }
  // Our auth hooks (before-user-created, Send SMS) refuse with a code as the
  // message, e.g. "BANNED"; Supabase passes it on with error.code "unknown".
  if (SERVER_CODE.test(error.message)) {
    const appError = new AppError(error.message, null, error)
    if (!isKnownCode(error.message)) {
      reportError(appError, 'untranslated-server-code')
    }
    return appError
  }
  if (looksLikeNetworkFailure(error.message)) {
    return new AppError('NETWORK', null, error)
  }
  const appError = new AppError('UNEXPECTED', { message: error.message, code: error.code }, error)
  reportError(appError, 'unexpected-auth-error')
  return appError
}
