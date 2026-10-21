import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../lib/errors'

// api.ts imports the Supabase client; these tests cover only its pure helpers.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

const { effectiveIntegerSetting, invalidField, slugFromName } = await import('./api')

describe('slugFromName', () => {
  it.each([
    ['Café Mocha, CG Road', 'cafe-mocha-cg-road'],
    ['  The   Chai  Spot!! ', 'the-chai-spot'],
    ['ચા ની કીટલી', ''],
  ])('%s → "%s"', (name, slug) => {
    expect(slugFromName(name)).toBe(slug)
  })

  it('never exceeds 40 characters or ends with a hyphen', () => {
    const slug = slugFromName('a'.repeat(39) + ' bcd')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('invalidField', () => {
  it('points a duplicate slug at the slug field', () => {
    expect(invalidField(new AppError('SLUG_TAKEN'))).toBe('slug')
  })

  it('maps a failed CHECK constraint to its field', () => {
    expect(
      invalidField(new AppError('VALIDATION_FAILED', { constraint: 'ck_venues_in_india' })),
    ).toBe('pin')
  })

  it('returns null for errors that are not about a field', () => {
    expect(invalidField(new AppError('NETWORK'))).toBeNull()
  })
})

describe('effectiveIntegerSetting', () => {
  const radius = {
    key: 'GEOFENCE_RADIUS_M',
    valueType: 'integer' as const,
    globalValue: 40,
    overrideValue: 70,
    minValue: 25,
    maxValue: 300,
    description: '',
  }

  it('prefers the venue override', () => {
    expect(effectiveIntegerSetting([radius], 'GEOFENCE_RADIUS_M')).toBe(70)
  })

  it('falls back to the global value', () => {
    expect(effectiveIntegerSetting([{ ...radius, overrideValue: null }], 'GEOFENCE_RADIUS_M')).toBe(
      40,
    )
  })
})
