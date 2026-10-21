import { describe, expect, it } from 'vitest'
import { averagePin, type Reading, toReading } from './location'

function reading(latitude: number, accuracyM: number): Reading {
  return { latitude, longitude: 72.5, accuracyM, ageSeconds: 0 }
}

describe('averagePin', () => {
  it('returns nothing without readings', () => {
    expect(averagePin([])).toBeNull()
  })

  it('averages only the precise readings when there are some', () => {
    const pin = averagePin([reading(23.0, 10), reading(23.002, 20), reading(24.0, 200)])
    expect(pin?.latitude).toBeCloseTo(23.001, 6)
    expect(pin?.samples).toBe(2)
    expect(pin?.precise).toBe(true)
    expect(pin?.bestAccuracyM).toBe(10)
  })

  it('falls back to the best three when none is precise, and says so', () => {
    const pin = averagePin([reading(23, 90), reading(23, 40), reading(23, 60), reading(23, 50)])
    expect(pin?.samples).toBe(3)
    expect(pin?.precise).toBe(false)
    expect(pin?.bestAccuracyM).toBe(40)
  })
})

describe('toReading', () => {
  it('measures age against the phone clock, never negative', () => {
    const position = {
      coords: { latitude: 23, longitude: 72.5, accuracy: 12 },
      timestamp: 1_000_000,
    } as GeolocationPosition
    expect(toReading(position, 1_004_500)).toMatchObject({ accuracyM: 12, ageSeconds: 4.5 })
    expect(toReading(position, 999_000).ageSeconds).toBe(0)
  })
})
