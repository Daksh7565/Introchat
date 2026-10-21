import { describe, expect, it } from 'vitest'
import { formatCountdown, formatPaise, localeFor } from './format'

describe('formatPaise', () => {
  it('shows whole rupees without decimals', () => {
    expect(formatPaise(1900, 'en')).toBe('₹19')
    expect(formatPaise(40000, 'en')).toBe('₹400')
  })

  it('keeps paise when there are any', () => {
    expect(formatPaise(1950, 'en')).toBe('₹19.50')
  })
})

describe('formatCountdown', () => {
  it.each([
    [0, '0:00'],
    [59, '0:59'],
    [900, '15:00'],
    [3599, '59:59'],
    [7200, '2:00:00'],
  ])('%i seconds → %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected)
  })

  it('never shows a negative time', () => {
    expect(formatCountdown(-5)).toBe('0:00')
  })
})

describe('localeFor', () => {
  it('falls back to Indian English for an unknown language', () => {
    expect(localeFor('fr')).toBe('en-IN')
  })
})
