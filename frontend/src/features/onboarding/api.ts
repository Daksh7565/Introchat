import { AppError } from '../../lib/errors'
import { unwrap } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'

export const GENDERS = ['male', 'female', 'other', 'prefer_not'] as const
export type Gender = (typeof GENDERS)[number]

function isGender(value: string | null): value is Gender {
  return value !== null && (GENDERS as readonly string[]).includes(value)
}

export interface MyProfile {
  handle: string
  nickname: string | null
  birthYear: number | null
  gender: Gender | null
  consentCurrent: boolean
  ageBlocked: boolean
  tags: string[]
  profileComplete: boolean
}

/** Cache key prefix; the user id follows, so one account never sees another's profile. */
export const MY_PROFILE_KEY = ['my-profile'] as const

/** The signed-in guest's own profile. Throws NOT_A_GUEST for an account without one (an admin). */
export async function getMyProfile(): Promise<MyProfile> {
  // Generated types mark every column non-null; nickname, birth_year and
  // gender are really NULL until set, and MyProfile is typed that way.
  const rows = unwrap(await supabase.rpc('my_profile'))
  const row = rows[0]
  if (!row) throw new AppError('NOT_A_GUEST')
  return {
    handle: row.handle,
    nickname: row.nickname,
    birthYear: row.birth_year,
    gender: isGender(row.gender) ? row.gender : null,
    consentCurrent: row.consent_current,
    ageBlocked: row.age_blocked,
    tags: row.tags,
    profileComplete: row.profile_complete,
  }
}

export async function acceptConsent(version: string): Promise<void> {
  unwrap(await supabase.rpc('accept_consent', { p_version: version }))
}

export interface ProfileInput {
  birthYear: number
  nickname: string
  gender: Gender | null
  language: string
}

/** 'under_age' is an answer, not an error: the server records it and the guest is told. */
export async function updateProfile(input: ProfileInput): Promise<'ok' | 'under_age'> {
  const result = unwrap(
    await supabase.rpc('update_profile', {
      p_birth_year: input.birthYear,
      p_language: input.language,
      // Left out = NULL = "not given" (the SQL defaults; migration hardening).
      ...(input.nickname === '' ? {} : { p_nickname: input.nickname }),
      ...(input.gender === null ? {} : { p_gender: input.gender }),
    }),
  )
  return result === 'under_age' ? 'under_age' : 'ok'
}

export async function getTagSuggestions(query: string): Promise<string[]> {
  const rows = unwrap(await supabase.rpc('tag_suggestions', { p_query: query }))
  return rows.map((row) => row.name)
}

/** Replaces the guest's tags; returns them as the server saved them. */
export async function saveTags(names: string[]): Promise<string[]> {
  return unwrap(await supabase.rpc('set_tags', { p_names: names }))
}

export const DELETION_KEY = ['my-deletion-request'] as const

/** When the guest asked for their account to be deleted; null = not asked (or cancelled). */
export async function myDeletionRequest(): Promise<Date | null> {
  const at = unwrap(await supabase.rpc('my_deletion_request'))
  return at === null ? null : new Date(at)
}

/** Asks for deletion (§11); an admin completes it within 30 days. */
export async function requestDeletion(): Promise<Date> {
  return new Date(unwrap(await supabase.rpc('request_account_deletion')))
}

export async function cancelDeletion(): Promise<void> {
  unwrap(await supabase.rpc('cancel_account_deletion'))
}
