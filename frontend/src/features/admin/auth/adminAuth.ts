import { assertNoAuthError, unwrap } from '../../../lib/rpc'
import { supabase } from '../../../lib/supabase'

/**
 * Where an admin stands on the way into the Console (ARCHITECTURE §2.2):
 * password → TOTP (enrol once, then a code at every sign-in) → admins table.
 * The server enforces all of this again on every admin_* call; this state only
 * decides which screen to show.
 */
export type AdminAuthState =
  | { kind: 'signed_out' }
  | { kind: 'needs_enrollment' }
  | { kind: 'needs_verification'; factorId: string }
  | { kind: 'not_admin'; email: string }
  | { kind: 'admin'; email: string }

export const ADMIN_AUTH_QUERY_KEY = ['admin-auth'] as const

export async function loadAdminAuth(): Promise<AdminAuthState> {
  const sessionResult = await supabase.auth.getSession()
  assertNoAuthError(sessionResult)
  const session = sessionResult.data.session
  if (!session) {
    return { kind: 'signed_out' }
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  assertNoAuthError(assurance)
  if (assurance.data.currentLevel !== 'aal2') {
    const factors = await supabase.auth.mfa.listFactors()
    assertNoAuthError(factors)
    // `totp` lists verified factors only; an unverified one is a set-up that
    // was abandoned, so the admin enrols again.
    const verified = factors.data.totp[0]
    return verified
      ? { kind: 'needs_verification', factorId: verified.id }
      : { kind: 'needs_enrollment' }
  }

  const email = session.user.email ?? ''
  const isAdmin = unwrap(await supabase.rpc('is_admin'))
  return isAdmin ? { kind: 'admin', email } : { kind: 'not_admin', email }
}

/** Removes TOTP factors left unverified by an abandoned set-up, then starts a new one. */
export async function startTotpEnrollment(): Promise<{
  factorId: string
  qrCode: string
  secret: string
}> {
  const factors = await supabase.auth.mfa.listFactors()
  assertNoAuthError(factors)
  for (const factor of factors.data.all) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      assertNoAuthError(removed)
    }
  }
  const enrolled = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'IntroChat Admin',
    issuer: 'IntroChat',
  })
  assertNoAuthError(enrolled)
  return {
    factorId: enrolled.data.id,
    qrCode: enrolled.data.totp.qr_code,
    secret: enrolled.data.totp.secret,
  }
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  assertNoAuthError(await supabase.auth.mfa.challengeAndVerify({ factorId, code }))
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  assertNoAuthError(
    await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }),
  )
}

export async function signOut(): Promise<void> {
  assertNoAuthError(await supabase.auth.signOut())
}

/**
 * Changes the signed-in admin's password. The Console only offers this to an
 * admin with 2-step verification done (aal2), so the session itself is the proof.
 */
export async function changePassword(password: string): Promise<void> {
  assertNoAuthError(await supabase.auth.updateUser({ password }))
}
