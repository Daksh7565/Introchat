import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../lib/errors'

// api.ts imports the Supabase client; these tests cover only its pure helpers.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

const { effectiveIntegerSetting, invalidField, slugFromName, venueInputProblems } =
  await import('./api')

describe('venueInputProblems', () => {
  const valid = {
    name: 'Chai Spot',
    slug: 'chai-spot',
    type: 'cafe' as const,
    address: 'Panjrapol Char Rasta',
    city: 'Ahmedabad',
  }

  it('finds nothing wrong with complete details', () => {
    expect(venueInputProblems(valid)).toEqual({})
  })

  it('treats blank-only fields as empty, as the server trims them', () => {
    expect(
      venueInputProblems({ ...valid, name: '  ', slug: ' ', address: '\t', city: '' }),
    ).toEqual({
      name: 'admin.venue.problems.nameRequired',
      slug: 'admin.venue.problems.slugRequired',
      address: 'admin.venue.problems.addressRequired',
      city: 'admin.venue.problems.cityRequired',
    })
  })

  it.each(['ab', '-chai', 'chai-', 'chai spot', 'chai_spot', 'a'.repeat(41)])(
    'rejects the link name "%s"',
    (slug) => {
      expect(venueInputProblems({ ...valid, slug }).slug).toBe('admin.venue.problems.slugFormat')
    },
  )

  it('accepts a link name the server will lower-case and trim', () => {
    expect(venueInputProblems({ ...valid, slug: ' Chai-Spot-2 ' })).toEqual({})
  })
})

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
