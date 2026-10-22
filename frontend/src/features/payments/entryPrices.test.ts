import { describe, expect, it } from 'vitest'
import { parseEntryPrices } from './entryPrices'

// What start_session sends with PAYMENT_REQUIRED (migration payments_credits).
const DETAILS = {
  scan_fee_paise: 1900,
  scan_session_minutes: 60,
  subscription_on: true,
  subscription_price_paise: 40000,
  subscription_scans: 25,
}

describe('parseEntryPrices', () => {
  it("reads the server's prices", () => {
    expect(parseEntryPrices(DETAILS)).toEqual({
      scanFeePaise: 1900,
      scanSessionMinutes: 60,
      subscriptionOn: true,
      subscriptionPricePaise: 40000,
      subscriptionScans: 25,
    })
  })

  it('refuses anything else rather than show a wrong price', () => {
    expect(parseEntryPrices(null)).toBeNull()
    expect(parseEntryPrices({ ...DETAILS, scan_fee_paise: 19.5 })).toBeNull()
    expect(parseEntryPrices({ ...DETAILS, scan_fee_paise: 0 })).toBeNull()
    expect(parseEntryPrices({ ...DETAILS, subscription_on: 'yes' })).toBeNull()
    expect(parseEntryPrices('PAYMENT_REQUIRED')).toBeNull()
  })
})
