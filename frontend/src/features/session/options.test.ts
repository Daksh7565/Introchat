import { describe, expect, it } from 'vitest'
import { sessionStateFixture } from '../../test/sessionState'
import { sessionOptions } from './options'

const BASE = Date.parse('2026-10-22T12:00:00Z')

describe('sessionOptions (ARCHITECTURE §4.11)', () => {
  it('payments off: continue free, subscription coming soon', () => {
    expect(sessionOptions(sessionStateFixture(BASE))).toEqual([
      { kind: 'continue_free', minutes: 60 },
      { kind: 'subscribe_coming_soon' },
    ])
  })

  it('a subscriber continues with a scan, and is never offered to pay', () => {
    expect(
      sessionOptions(sessionStateFixture(BASE, { paymentsEnabled: true, scanCredits: 7 })),
    ).toEqual([{ kind: 'use_scan', minutes: 120, creditsLeft: 7 }])
  })

  it('no scans, payments on: pay to continue, or subscribe', () => {
    expect(
      sessionOptions(
        sessionStateFixture(BASE, { paymentsEnabled: true, subscriptionEnabled: true }),
      ),
    ).toEqual([
      { kind: 'continue_paid', minutes: 60, pricePaise: 1900 },
      { kind: 'subscribe', pricePaise: 40000, scans: 25 },
    ])
  })

  it('subscription switched off: shown as coming soon, never sold', () => {
    expect(
      sessionOptions(
        sessionStateFixture(BASE, { paymentsEnabled: true, subscriptionEnabled: false }),
      )[1],
    ).toEqual({ kind: 'subscribe_coming_soon' })
  })
})
