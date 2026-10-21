import { describe, expect, it } from 'vitest'
import { formatMobile, parseIndianMobile, toE164 } from './phone'

describe('parseIndianMobile', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['6000000000', '6000000000'],
  ])('accepts %s', (input, expected) => {
    expect(parseIndianMobile(input)).toBe(expected)
  })

  it.each([
    ['', 'empty'],
    ['987654321', '9 digits'],
    ['5876543210', 'starts with 5 (not a mobile)'],
    ['+1 415 555 0123', 'a US number'],
    ['98765432101', '11 digits without a leading 0'],
  ])('refuses %s (%s)', (input) => {
    expect(parseIndianMobile(input)).toBeNull()
  })
})

describe('toE164 / formatMobile', () => {
  it('formats for Supabase and for display', () => {
    expect(toE164('9876543210')).toBe('+919876543210')
    expect(formatMobile('9876543210')).toBe('+91 98765 43210')
  })
})
