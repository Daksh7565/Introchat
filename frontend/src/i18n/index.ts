import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import gu from './gu.json'
import hi from './hi.json'
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

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    gu: { translation: gu },
  },
  lng: pickInitialLanguage(readSavedLanguage(), navigator.languages),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  // Resources are bundled, so initialise synchronously: the first render is
  // already in the right language, with no flash of English.
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

/** Switch the UI language and remember the choice on this device. */
export async function changeLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language)
  saveLanguage(language)
}

export default i18n
