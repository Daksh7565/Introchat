/** The prices start_session sent with PAYMENT_REQUIRED (from settings, per venue). */
export interface EntryPrices {
  scanFeePaise: number
  scanSessionMinutes: number
  subscriptionOn: boolean
  subscriptionPricePaise: number
  subscriptionScans: number
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Reads PAYMENT_REQUIRED's details; null if they are not what the server sends. */
export function parseEntryPrices(details: unknown): EntryPrices | null {
  if (typeof details !== 'object' || details === null) return null
  const d = details as Record<string, unknown>
  if (
    !positiveInt(d.scan_fee_paise) ||
    !positiveInt(d.scan_session_minutes) ||
    typeof d.subscription_on !== 'boolean' ||
    !positiveInt(d.subscription_price_paise) ||
    !positiveInt(d.subscription_scans)
  ) {
    return null
  }
  return {
    scanFeePaise: d.scan_fee_paise,
    scanSessionMinutes: d.scan_session_minutes,
    subscriptionOn: d.subscription_on,
    subscriptionPricePaise: d.subscription_price_paise,
    subscriptionScans: d.subscription_scans,
  }
}
