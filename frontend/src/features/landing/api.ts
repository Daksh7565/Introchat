import { deviceId } from '../../lib/deviceId'
import { AppError } from '../../lib/errors'
import type { Reading } from '../../lib/location'
import { unwrap } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'

/** What the landing page knows about the scanned table (venue_public, migration 0003). */
export interface ScannedVenue {
  venueName: string
  tableLabel: string
  paymentsEnabled: boolean
  scanFeeEnabled: boolean
  subscriptionEnabled: boolean
  scanFeePaise: number
  subscriptionPricePaise: number
  subscriptionScans: number
}

export async function getScannedVenue(slug: string, qrToken: string): Promise<ScannedVenue> {
  const rows = unwrap(await supabase.rpc('venue_public', { p_slug: slug, p_qr_token: qrToken }))
  const row = rows[0]
  // venue_public raises VENUE_NOT_FOUND / VENUE_CLOSED / TABLE_NOT_FOUND itself;
  // an empty result would be a server bug, not a guest situation.
  if (!row) throw new AppError('UNEXPECTED', { reason: 'venue_public returned no row' })
  return {
    venueName: row.venue_name,
    tableLabel: row.table_label,
    paymentsEnabled: row.payments_enabled,
    scanFeeEnabled: row.scan_fee_enabled,
    subscriptionEnabled: row.subscription_enabled,
    scanFeePaise: row.scan_fee_paise,
    subscriptionPricePaise: row.subscription_price_paise,
    subscriptionScans: row.subscription_scans,
  }
}

export type LocationVerdict = 'inside' | 'outside' | 'unknown'

export async function checkLocation(
  slug: string,
  qrToken: string,
  reading: Reading,
): Promise<LocationVerdict> {
  const verdict = unwrap(
    await supabase.rpc('location_check', {
      p_slug: slug,
      p_qr_token: qrToken,
      p_latitude: reading.latitude,
      p_longitude: reading.longitude,
      p_accuracy_m: reading.accuracyM,
      p_age_seconds: reading.ageSeconds,
      p_device_id: deviceId(),
    }),
  )
  if (verdict !== 'inside' && verdict !== 'outside' && verdict !== 'unknown') {
    throw new AppError('UNEXPECTED', { verdict })
  }
  return verdict
}
