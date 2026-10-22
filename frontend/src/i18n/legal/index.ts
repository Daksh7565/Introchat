import i18n from '..'
import type { Language } from '../languages'
import en from './en.json'
import gu from './gu.json'
import hi from './hi.json'

// The legal pages' text (privacy, terms, refunds, contact), registered under
// `legal.` by the legal pages' own bundle, so the long texts are not in what
// every guest downloads first. Draft wording, pending legal review.
//
// These texts state facts that are also settings or code. Changing one of
// them means updating all three files here:
//   REPORT_EVIDENCE_RETENTION_DAYS (30) and REPORT_EVIDENCE_MESSAGES (50),
//   UNUSED_FEE_VALID_MINUTES (30), MIN_AGE (18), the 30-day account deletion
//   (ARCHITECTURE §11), and the retention table in §11.
const STRINGS: Record<Language, typeof en> = { en, hi, gu }

for (const [language, strings] of Object.entries(STRINGS)) {
  // deep + overwrite: merges into the strings already loaded for that language.
  i18n.addResourceBundle(language, 'translation', { legal: strings }, true, true)
}
