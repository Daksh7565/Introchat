// The body payments-create accepts, checked before anything reaches the
// database. Prices and amounts are never accepted from the phone.
import { HttpError } from '../_shared/http.ts'

export type Purpose = 'scan_fee' | 'continue' | 'subscription'

export interface CreateRequest {
  purpose: Purpose
  /** Entry only: the scanned table and a fresh reading taken there. */
  slug: string | undefined
  qrToken: string | undefined
  reading: { latitude: number; longitude: number; accuracyM: number; ageSeconds: number } | undefined
  deviceId: string | undefined
}

const PURPOSES: readonly Purpose[] = ['scan_fee', 'continue', 'subscription']

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseCreateRequest(value: unknown): CreateRequest {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, 'VALIDATION_FAILED')
  const v = value as Record<string, unknown>
  const purpose = PURPOSES.find((p) => p === v.purpose)
  if (!purpose) throw new HttpError(400, 'VALIDATION_FAILED')

  const atEntry = v.slug !== undefined
  if (!atEntry) return { purpose, slug: undefined, qrToken: undefined, reading: undefined, deviceId: undefined }

  const reading = v.reading as Record<string, unknown> | undefined
  if (
    typeof v.slug !== 'string' ||
    typeof v.qr_token !== 'string' ||
    typeof v.device_id !== 'string' ||
    typeof reading !== 'object' ||
    reading === null ||
    !finite(reading.latitude) ||
    !finite(reading.longitude) ||
    !finite(reading.accuracy_m) ||
    !finite(reading.age_seconds)
  ) {
    throw new HttpError(400, 'VALIDATION_FAILED')
  }
  return {
    purpose,
    slug: v.slug,
    qrToken: v.qr_token,
    reading: {
      latitude: reading.latitude,
      longitude: reading.longitude,
      accuracyM: reading.accuracy_m,
      ageSeconds: reading.age_seconds,
    },
    deviceId: v.device_id,
  }
}
