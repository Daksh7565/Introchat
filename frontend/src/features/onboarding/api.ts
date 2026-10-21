import { AppError } from '../../lib/errors'
import { unwrap } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'

export const GENDERS = ['male', 'female', 'other', 'prefer_not'] as const
export type Gender = (typeof GENDERS)[number]

function isGender(value: string | null): value is Gender {
  return value !== null && (GENDERS as readonly string[]).includes(value)
}

// Declared here rather than taken from database.types.ts: generated types mark
// every function result column as non-null, but these are null until set.
interface MyProfileRow {
  handle: string
  nickname: string | null
  birth_year: number | null
  gender: string | null
  consent_current: boolean
  age_blocked: boolean
  tags: string[]
  profile_complete: boolean
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
  const rows = unwrap(await supabase.rpc('my_profile')) as MyProfileRow[]
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
      p_nickname: input.nickname,
      // The generated type says string, but the function accepts null ("not given").
      p_gender: input.gender as string,
      p_language: input.language,
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
