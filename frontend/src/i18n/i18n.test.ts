import { describe, expect, it } from 'vitest'
import adminEn from './admin/en.json'
import adminGu from './admin/gu.json'
import adminHi from './admin/hi.json'
import en from './en.json'
import glossary from './glossary.json'
import gu from './gu.json'
import hi from './hi.json'
import legalEn from './legal/en.json'
import legalGu from './legal/gu.json'
import legalHi from './legal/hi.json'
import { pickInitialLanguage } from './languages'

type Tree = { [key: string]: string | Tree }

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  )
}

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  )
}

/** {{name}} placeholders in a string, sorted, so two strings can be compared. */
function placeholders(text: string): string {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',')
}

// Each set of files: the English reference and its two translations.
const SETS = [
  { name: '', en, hi, gu },
  { name: 'admin/', en: adminEn, hi: adminHi, gu: adminGu },
  { name: 'legal/', en: legalEn, hi: legalHi, gu: legalGu },
]
const TRANSLATIONS = SETS.flatMap((set) => [
  { file: `${set.name}hi.json`, english: set.en, translation: set.hi },
  { file: `${set.name}gu.json`, english: set.en, translation: set.gu },
])

function leafValues(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : leafValues(value),
  )
}

describe('translation files', () => {
  // A key missing from hi or gu would silently fall back to English for those
  // guests; a key only in hi/gu is dead text. Both fail here instead.
  it.each([
    ['hi', hi],
    ['gu', gu],
  ])('%s.json has exactly the same keys as en.json', (_name, file) => {
    expect(leafKeys(file).sort()).toEqual(leafKeys(en).sort())
  })

  it.each([
    ['admin/hi', adminHi],
    ['admin/gu', adminGu],
  ])('%s.json has exactly the same keys as admin/en.json', (_name, file) => {
    expect(leafKeys(file).sort()).toEqual(leafKeys(adminEn).sort())
  })

  it.each([
    ['legal/hi', legalHi],
    ['legal/gu', legalGu],
  ])('%s.json has exactly the same keys as legal/en.json', (_name, file) => {
    expect(leafKeys(file).sort()).toEqual(leafKeys(legalEn).sort())
  })

  it.each([
    ['en', en],
    ['hi', hi],
    ['gu', gu],
    ['admin/en', adminEn],
    ['admin/hi', adminHi],
    ['admin/gu', adminGu],
    ['legal/en', legalEn],
    ['legal/hi', legalHi],
    ['legal/gu', legalGu],
  ])('%s.json has no empty strings', (_name, file) => {
    expect(leafValues(file).filter((value) => value.trim() === '')).toEqual([])
  })

  // The Console's and legal pages' text is registered under `admin.` and
  // `legal.` by their own bundles; a guest file with a section of the same
  // name would be silently merged into or overwritten.
  it('keeps the Console and legal text out of the guest files', () => {
    expect(Object.keys(en)).not.toContain('admin')
    expect(Object.keys(en)).not.toContain('legal')
  })
})

describe('placeholders', () => {
  // A {{handle}} left out shows a sentence with no name in it; one misspelled
  // shows "{{hande}}" on the guest's screen.
  it.each(TRANSLATIONS)(
    '$file uses the same placeholders as English',
    ({ english, translation }) => {
      const reference = new Map(leaves(english))
      const differ = leaves(translation)
        .filter(([key, text]) => placeholders(text) !== placeholders(reference.get(key) ?? ''))
        .map(([key]) => key)
      expect(differ).toEqual([])
    },
  )
})

describe('glossary', () => {
  // One word per product term (glossary.json, M9): a second spelling or a
  // synonym for the same thing makes guests wonder whether it is the same thing.
  const avoid = glossary.terms.flatMap((term) => term.avoid)

  it.each(TRANSLATIONS)(
    '$file uses none of the words the glossary rules out',
    ({ translation }) => {
      const found = leaves(translation).flatMap(([key, text]) =>
        avoid.filter((word) => text.includes(word)).map((word) => `${key}: ${word}`),
      )
      expect(found).toEqual([])
    },
  )
})

describe('pickInitialLanguage', () => {
  it('uses the saved choice when it is supported', () => {
    expect(pickInitialLanguage('gu', ['en-US'])).toBe('gu')
  })

  it('ignores a saved value that is no longer supported', () => {
    expect(pickInitialLanguage('fr', ['hi-IN'])).toBe('hi')
  })

  it('takes the first supported browser language, matching on the base tag', () => {
    expect(pickInitialLanguage(null, ['fr-FR', 'gu-IN', 'hi-IN'])).toBe('gu')
  })

  it('falls back to English', () => {
    expect(pickInitialLanguage(null, ['fr-FR', 'de'])).toBe('en')
  })
})
