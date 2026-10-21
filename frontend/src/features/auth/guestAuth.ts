import { assertNoAuthError } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'
import { toE164 } from './phone'

/**
 * Asks Supabase Auth for a login code. A new number becomes an account here
 * (the sign-up hook allows +91 only and refuses banned phones); the SMS itself
 * is sent by our sms-hook function, which may also refuse (limits, bans).
 */
export async function sendOtp(mobile: string): Promise<void> {
  assertNoAuthError(
    await supabase.auth.signInWithOtp({ phone: toE164(mobile), options: { channel: 'sms' } }),
  )
}

/** Signs in with the code; the session change is picked up by useAuthSession. */
export async function verifyOtp(mobile: string, code: string): Promise<void> {
  assertNoAuthError(
    await supabase.auth.verifyOtp({ phone: toE164(mobile), token: code, type: 'sms' }),
  )
}

/**
 * Logs out on this browser only. "global" would also end the account's
 * sessions on other devices, e.g. an admin's Console on their laptop.
 */
export async function signOutHere(): Promise<void> {
  assertNoAuthError(await supabase.auth.signOut({ scope: 'local' }))
}
