import { describe, expect, it } from 'vitest'
import en from './en.json'
import gu from './gu.json'
import hi from './hi.json'
import { pickInitialLanguage } from './languages'

type Tree = { [key: string]: string | Tree }

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  )
}

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
    ['en', en],
    ['hi', hi],
    ['gu', gu],
  ])('%s.json has no empty strings', (_name, file) => {
    expect(leafValues(file).filter((value) => value.trim() === '')).toEqual([])
  })
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
