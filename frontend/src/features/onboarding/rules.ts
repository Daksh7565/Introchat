import type { MyProfile } from './api'

/**
 * Version of the notice shown in ConsentStep. Must equal the CONSENT_VERSION
 * setting in the database: accepting an older text is refused
 * (CONSENT_VERSION_OUTDATED). When the notice changes, change the text, this
 * constant and the setting together.
 */
export const CONSENT_VERSION = 'v1-draft'

/** Default of the MAX_TAGS_PER_USER setting; the server enforces the real value. */
export const MAX_TAGS = 5

/**
 * Offered on the interests step while the database has few popular tags (a
 * new installation). Tags are what guests type, not translated text, so this
 * list is the same in every language.
 */
export const STARTER_TAGS = [
  'music',
  'cricket',
  'movies',
  'travel',
  'food',
  'football',
  'books',
  'gaming',
  'fitness',
  'photography',
  'coffee',
  'dance',
] as const

export type OnboardingStep = 'consent' | 'profile' | 'tags' | 'under_age' | 'done'

/** The screen a guest resumes on: a returning guest with everything done goes straight to the end. */
export function nextStep(profile: MyProfile): OnboardingStep {
  if (profile.ageBlocked) return 'under_age'
  if (!profile.consentCurrent) return 'consent'
  if (profile.birthYear === null) return 'profile'
  if (profile.tags.length === 0) return 'tags'
  return 'done'
}

/** Birth year as typed: a 4-digit year from 1900 to this year, else null. */
export function parseBirthYear(input: string, currentYear: number): number | null {
  if (!/^\d{4}$/.test(input.trim())) return null
  const year = Number(input.trim())
  return year >= 1900 && year <= currentYear ? year : null
}

/**
 * Same rule as normalize_tag() in the database, so the picker shows a tag the
 * way it will be saved: NFC, trimmed, single spaces, lower case, 1–24
 * characters, no ASCII punctuation or control characters (Hindi and Gujarati
 * letters and vowel signs are fine). Null = not a valid tag. Blocked words are
 * checked only on the server.
 */
export function normalizeTag(input: string): string | null {
  const tag = input.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
  const characters = [...tag]
  if (characters.length < 1 || characters.length > 24) return null
  const isControl = (char: string) => {
    const code = char.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f
  }
  // The four ASCII punctuation ranges, as in the SQL: !-/ :-@ [-` {-~
  if (characters.some(isControl) || /[!-/:-@[-`{-~]/.test(tag)) return null
  return tag
}
