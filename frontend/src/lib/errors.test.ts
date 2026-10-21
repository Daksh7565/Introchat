import { AuthError, PostgrestError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { AppError, errorMessageKey, fromAuthError, fromPostgrestError } from './errors'

function postgrestError(message: string, details = ''): PostgrestError {
  return new PostgrestError({ message, details, hint: '', code: 'P0001' })
}

describe('fromPostgrestError', () => {
  it('turns a server code into an AppError with parsed details', () => {
    const error = fromPostgrestError(postgrestError('RATE_LIMITED', '{"retry_after":12}'))
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.details).toEqual({ retry_after: 12 })
  })

  it('recognises a lost connection', () => {
    expect(fromPostgrestError(postgrestError('TypeError: Failed to fetch')).code).toBe('NETWORK')
  })

  it('treats anything else as UNEXPECTED', () => {
    expect(fromPostgrestError(postgrestError('column "x" does not exist')).code).toBe('UNEXPECTED')
  })
})

describe('fromAuthError', () => {
  it('maps wrong email/password to INVALID_CREDENTIALS', () => {
    expect(fromAuthError(new AuthError('Invalid login', 400, 'invalid_credentials')).code).toBe(
      'INVALID_CREDENTIALS',
    )
  })

  it('maps a wrong 6-digit code to MFA_CODE_INVALID', () => {
    expect(fromAuthError(new AuthError('bad code', 422, 'mfa_verification_failed')).code).toBe(
      'MFA_CODE_INVALID',
    )
  })

  it('maps a wrong or expired SMS code to OTP_INVALID', () => {
    expect(
      fromAuthError(new AuthError('Token has expired or is invalid', 403, 'otp_expired')).code,
    ).toBe('OTP_INVALID')
  })

  // Shape observed on dev: the hook's code arrives as the message.
  it('passes on a refusal code from our auth hooks', () => {
    expect(fromAuthError(new AuthError('PHONE_NOT_ALLOWED', 403, 'unknown')).code).toBe(
      'PHONE_NOT_ALLOWED',
    )
  })

  it('treats a plain Supabase message as UNEXPECTED', () => {
    expect(fromAuthError(new AuthError('Something odd', 500, 'unknown')).code).toBe('UNEXPECTED')
  })
})

describe('errorMessageKey', () => {
  it('uses the code when the UI has a translation for it', () => {
    expect(errorMessageKey(new AppError('FORBIDDEN'))).toBe('errors.FORBIDDEN')
  })

  it('falls back to UNEXPECTED for a code the UI does not know', () => {
    expect(errorMessageKey(new AppError('SOME_FUTURE_CODE'))).toBe('errors.UNEXPECTED')
  })

  it('falls back to UNEXPECTED for a non-AppError', () => {
    expect(errorMessageKey(new Error('boom'))).toBe('errors.UNEXPECTED')
  })
})
