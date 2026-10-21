import { AppError } from '../../../lib/errors'
import type { MapPoint } from './PinMap'

// OpenStreetMap Nominatim address search (free). Its usage policy allows at
// most 1 request per second and forbids search-as-you-type, so the Console
// searches only when the admin presses Search. India only, results in the UI
// language where OSM has them.
const ENDPOINT = 'https://nominatim.openstreetmap.org/search'

export interface AddressResult extends MapPoint {
  label: string
}

export async function searchAddress(query: string, language: string): Promise<AddressResult[]> {
  const params = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'in',
    'accept-language': language,
  })
  let response: Response
  try {
    response = await fetch(`${ENDPOINT}?${params.toString()}`)
  } catch (error) {
    throw new AppError('NETWORK', null, error)
  }
  if (response.status === 429) throw new AppError('RATE_LIMITED')
  if (!response.ok) throw new AppError('ADDRESS_SEARCH_FAILED', { status: response.status })

  const body: unknown = await response.json()
  if (!Array.isArray(body)) throw new AppError('ADDRESS_SEARCH_FAILED', { reason: 'not a list' })
  // Validate each result instead of trusting a third-party response shape.
  return body.flatMap((item: unknown): AddressResult[] => {
    if (typeof item !== 'object' || item === null) return []
    const { display_name: label, lat, lon } = item as Record<string, unknown>
    const latitude = typeof lat === 'string' ? Number(lat) : NaN
    const longitude = typeof lon === 'string' ? Number(lon) : NaN
    if (typeof label !== 'string' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return []
    }
    return [{ label, latitude, longitude }]
  })
}
