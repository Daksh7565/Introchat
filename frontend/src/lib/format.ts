import { isLanguage, type Language } from '../i18n/languages'

// Locale tags for number and date formatting. Indian English/Hindi/Gujarati so
// rupees, digit grouping and times look the way guests expect.
const LOCALE: Record<Language, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  gu: 'gu-IN',
}

export function localeFor(language: string): string {
  return isLanguage(language) ? LOCALE[language] : LOCALE.en
}

/** 1900 paise → "₹19". Money is integer paise everywhere; this is display only. */
export function formatPaise(paise: number, language: string): string {
  return new Intl.NumberFormat(localeFor(language), {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100)
}

/** Seconds → "m:ss" (or "h:mm:ss" past an hour) for the session countdown. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`
}

/** Time of day for chat messages, in the UI language. */
export function formatClockTime(date: Date, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
