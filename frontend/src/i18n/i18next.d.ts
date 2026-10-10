import 'i18next'
import type en from './en.json'

// English is the reference file: every `t('...')` key is checked against it at
// compile time, so a typo is a build error rather than a raw key on a guest's
// screen. i18n.test.ts checks that hi.json and gu.json have the same keys.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof en
    }
    returnNull: false
  }
}
