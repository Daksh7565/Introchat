import 'i18next'
import type adminEn from './admin/en.json'
import type en from './en.json'
import type legalEn from './legal/en.json'

// English is the reference file: every `t('...')` key is checked against it at
// compile time, so a typo is a build error rather than a raw key on a guest's
// screen. i18n.test.ts checks that hi.json and gu.json have the same keys.
// The Console's text lives in admin/*.json under `admin.`, and the legal
// pages' in legal/*.json under `legal.`, each loaded by its own bundle.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof en & { admin: typeof adminEn; legal: typeof legalEn }
    }
    returnNull: false
  }
}
