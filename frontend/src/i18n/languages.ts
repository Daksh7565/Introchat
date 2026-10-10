// The languages the UI can render. This is a code fact, not a setting: a
// language can only be offered once its translation file ships in the bundle,
// so adding one is always a deploy. The database mirrors this list in the
// `profiles.preferred_language` check (M2); keep the two in step.
export const SUPPORTED_LANGUAGES = ['en', 'hi', 'gu'] as const

export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en'

export function isLanguage(value: string): value is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/**
 * The language to start in: the guest's saved choice if it is still
 * supported, otherwise the first browser language we support (so a phone set
 * to Gujarati opens in Gujarati), otherwise English.
 */
export function pickInitialLanguage(
  saved: string | null,
  browserLanguages: readonly string[],
): Language {
  if (saved !== null && isLanguage(saved)) {
    return saved
  }
  for (const tag of browserLanguages) {
    // "gu-IN" → "gu"
    const base = tag.toLowerCase().split('-')[0] ?? ''
    if (isLanguage(base)) {
      return base
    }
  }
  return DEFAULT_LANGUAGE
}
