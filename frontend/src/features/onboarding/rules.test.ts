import { describe, expect, it } from 'vitest'
import type { MyProfile } from './api'
import { nextStep, normalizeTag, parseBirthYear } from './rules'

const COMPLETE: MyProfile = {
  handle: 'Mango-4821',
  nickname: null,
  birthYear: 1998,
  gender: null,
  consentCurrent: true,
  ageBlocked: false,
  tags: ['music'],
  profileComplete: true,
}

describe('nextStep', () => {
  it('sends a brand-new guest to consent first', () => {
    expect(
      nextStep({
        ...COMPLETE,
        consentCurrent: false,
        birthYear: null,
        tags: [],
        profileComplete: false,
      }),
    ).toBe('consent')
  })

  it('resumes at the first unfinished step', () => {
    expect(nextStep({ ...COMPLETE, birthYear: null, tags: [] })).toBe('profile')
    expect(nextStep({ ...COMPLETE, tags: [] })).toBe('tags')
  })

  it('takes a returning guest straight to the end', () => {
    expect(nextStep(COMPLETE)).toBe('done')
  })

  it('asks for consent again after the notice changed', () => {
    expect(nextStep({ ...COMPLETE, consentCurrent: false })).toBe('consent')
  })

  it('always shows the refusal to an under-age guest', () => {
    expect(nextStep({ ...COMPLETE, ageBlocked: true, consentCurrent: false })).toBe('under_age')
  })
})

describe('parseBirthYear', () => {
  it('accepts a 4-digit year up to this year', () => {
    expect(parseBirthYear(' 1998 ', 2026)).toBe(1998)
    expect(parseBirthYear('2026', 2026)).toBe(2026)
  })

  it.each(['98', '2027', '1899', '19a8', ''])('refuses %s', (input) => {
    expect(parseBirthYear(input, 2026)).toBeNull()
  })
})

describe('normalizeTag', () => {
  it('trims, collapses spaces and lower-cases', () => {
    expect(normalizeTag('  Indie   Music ')).toBe('indie music')
  })

  it('keeps Hindi and Gujarati letters with their vowel signs', () => {
    expect(normalizeTag('क्रिकेट')).toBe('क्रिकेट')
    expect(normalizeTag('ગરબા')).toBe('ગરબા')
  })

  it.each(['', '   ', 'rock&roll', 'c++', 'a'.repeat(25)])('refuses %j', (input) => {
    expect(normalizeTag(input)).toBeNull()
  })

  it('allows exactly 24 characters', () => {
    expect(normalizeTag('a'.repeat(24))).toBe('a'.repeat(24))
  })
})
