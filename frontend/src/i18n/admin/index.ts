import i18n from '..'
import type { Language } from '../languages'
import en from './en.json'
import gu from './gu.json'
import hi from './hi.json'

// The Admin Console's text, kept out of the guest files so guests' phones never
// download it (M8 bundle budget). Imported by the Console's bundle only
// (AdminPage), and registered under `admin.` before any Console screen renders.
// All three languages at once: the Console is used on a laptop, and switching
// language there must not wait for a download.
const STRINGS: Record<Language, typeof en> = { en, hi, gu }

for (const [language, strings] of Object.entries(STRINGS)) {
  // deep + overwrite: merges into the guest strings already loaded for that language.
  i18n.addResourceBundle(language, 'translation', { admin: strings }, true, true)
}
