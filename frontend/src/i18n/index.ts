import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { reportError } from '../lib/monitoring'
import en from './en.json'
import {
  DEFAULT_LANGUAGE,
  type Language,
  pickInitialLanguage,
  SUPPORTED_LANGUAGES,
} from './languages'

const STORAGE_KEY = 'introchat.language'

function readSavedLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage can throw (Safari private mode, storage blocked by the user).
    // Not remembering the choice is the correct degraded behaviour: the guest
    // gets the browser language and can pick again.
    return null
  }
}

function saveLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Same as readSavedLanguage: the switch still applies for this visit;
    // only remembering it across visits is lost.
  }
}

// English is in the main bundle (it is also the fallback for any missing key);
// Hindi and Gujarati are separate files fetched when chosen, so a guest
// downloads one language, not three (M8 bundle budget). `satisfies` keeps
// each file's shape checked against English at compile time.
const LOADERS = {
  hi: () => import('./hi.json'),
  gu: () => import('./gu.json'),
} satisfies Record<Exclude<Language, 'en'>, () => Promise<{ default: typeof en }>>

const loaded = new Set<Language>([DEFAULT_LANGUAGE])

async function loadLanguage(language: Language): Promise<void> {
  if (language === 'en' || loaded.has(language)) return
  const { default: strings } = await LOADERS[language]()
  // deep + overwrite: the Console may already have added its `admin.` text.
  i18n.addResourceBundle(language, 'translation', strings, true, true)
  loaded.add(language)
}

void i18n.use(initReactI18next).init({
  // A copy: i18next merges later bundles (the Console's `admin.` text) into
  // this object in place, which would otherwise change the imported file.
  resources: { en: { translation: structuredClone(en) } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  // English is bundled, so this is synchronous; other languages are added
  // before switching to them (i18nReady, changeLanguage).
  initAsync: false,
  interpolation: {
    // React escapes rendered strings already.
    escapeValue: false,
  },
  returnNull: false,
})

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
})
document.documentElement.lang = i18n.language

/**
 * Settles once the guest's language is loaded and active. main.tsx renders
 * after it, so the first screen is already in the right language, with no
 * flash of English. Never rejects: if the file cannot be fetched (offline on
 * first open), the app starts in English and the failure is reported.
 */
export const i18nReady: Promise<void> = (async () => {
  const language = pickInitialLanguage(readSavedLanguage(), navigator.languages)
  try {
    await loadLanguage(language)
    await i18n.changeLanguage(language)
  } catch (error) {
    reportError(error, 'i18n.initialLanguage')
  }
})()

/**
 * Switch the UI language and remember the choice on this device. Rejects if
 * the language file cannot be fetched; the UI then stays as it was.
 */
export async function changeLanguage(language: Language): Promise<void> {
  await loadLanguage(language)
  await i18n.changeLanguage(language)
  saveLanguage(language)
}

export default i18n
