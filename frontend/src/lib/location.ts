import { AppError } from './errors'

/**
 * One phone location reading, in the shape the SQL functions take
 * (evaluate_location, location_check, admin_test_location).
 *
 * ageSeconds is measured on the phone: phone "now" minus the reading's
 * timestamp, both from the phone's clock, so a phone whose clock is wrong still
 * reports a correct age (ARCHITECTURE §3.1).
 */
export interface Reading {
  latitude: number
  longitude: number
  accuracyM: number
  ageSeconds: number
}

export type LocationErrorCode =
  | 'LOCATION_UNSUPPORTED'
  | 'LOCATION_PERMISSION_DENIED'
  | 'LOCATION_UNAVAILABLE'
  | 'LOCATION_TIMEOUT'
  | 'LOCATION_NO_READINGS'

// High accuracy uses GPS plus WiFi/cell positioning; maximumAge 0 means never a
// cached fix, so every reading is fresh.
const OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }

export function toReading(position: GeolocationPosition, nowMs: number = Date.now()): Reading {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    ageSeconds: Math.max(0, (nowMs - position.timestamp) / 1000),
  }
}

/** Expected failures (permission, no signal) are codes the screen explains; never reported. */
export function locationError(error: GeolocationPositionError): AppError {
  const code: LocationErrorCode =
    error.code === error.PERMISSION_DENIED
      ? 'LOCATION_PERMISSION_DENIED'
      : error.code === error.TIMEOUT
        ? 'LOCATION_TIMEOUT'
        : 'LOCATION_UNAVAILABLE'
  return new AppError(code, null, error)
}

function geolocation(): Geolocation {
  if (!('geolocation' in navigator) || !window.isSecureContext) {
    // Browsers expose location only on HTTPS (or localhost).
    throw new AppError('LOCATION_UNSUPPORTED')
  }
  return navigator.geolocation
}

/** One fresh reading. */
export function getReading(): Promise<Reading> {
  return new Promise((resolve, reject) => {
    try {
      geolocation().getCurrentPosition(
        (position) => resolve(toReading(position)),
        (error) => reject(locationError(error)),
        OPTIONS,
      )
    } catch (error) {
      reject(error)
    }
  })
}

/** Readings as they arrive until the returned function is called. */
export function watchReadings(
  onReading: (reading: Reading) => void,
  onError: (error: AppError) => void,
): () => void {
  let id: number
  try {
    id = geolocation().watchPosition(
      (position) => onReading(toReading(position)),
      (error) => onError(locationError(error)),
      OPTIONS,
    )
  } catch (error) {
    onError(error instanceof AppError ? error : new AppError('LOCATION_UNSUPPORTED', null, error))
    return () => undefined
  }
  return () => navigator.geolocation.clearWatch(id)
}

export interface PinEstimate {
  latitude: number
  longitude: number
  /** How many readings the average used. */
  samples: number
  bestAccuracyM: number
  /** false = no reading was precise enough; the best few were used instead. */
  precise: boolean
}

// Same rule as the GPS field-test page, so a pin set in the Console and a pin
// set during the field test are comparable.
export const PIN_GOOD_ACCURACY_M = 30
const FALLBACK_SAMPLES = 3

/** Average of the precise readings, or of the best few if none were precise. */
export function averagePin(readings: Reading[]): PinEstimate | null {
  if (readings.length === 0) return null
  const precise = readings.filter((r) => r.accuracyM <= PIN_GOOD_ACCURACY_M)
  const used =
    precise.length > 0
      ? precise
      : [...readings].sort((a, b) => a.accuracyM - b.accuracyM).slice(0, FALLBACK_SAMPLES)
  return {
    latitude: used.reduce((sum, r) => sum + r.latitude, 0) / used.length,
    longitude: used.reduce((sum, r) => sum + r.longitude, 0) / used.length,
    samples: used.length,
    bestAccuracyM: Math.round(Math.min(...used.map((r) => r.accuracyM))),
    precise: precise.length > 0,
  }
}

/**
 * Collects readings for `durationMs` and averages them into a pin. The admin
 * stands in the middle of the seating area while this runs.
 */
export function collectPin(
  durationMs: number,
  onProgress: (secondsLeft: number, readings: number) => void,
): Promise<PinEstimate> {
  return new Promise((resolve, reject) => {
    const readings: Reading[] = []
    let failure: AppError | null = null
    const stop = watchReadings(
      (reading) => readings.push(reading),
      (error) => {
        failure = error
      },
    )
    const started = Date.now()
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((durationMs - (Date.now() - started)) / 1000))
      onProgress(left, readings.length)
      if (left > 0 && failure === null) return
      window.clearInterval(timer)
      stop()
      const pin = averagePin(readings)
      if (pin) resolve(pin)
      else reject(failure ?? new AppError('LOCATION_NO_READINGS'))
    }, 500)
  })
}
