import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError } from '../../lib/errors'
import { getReading } from '../../lib/location'
import { checkLocation } from './api'
import type { LocationStatus } from './VenueLandingView'

/** The phone could not give a usable position: how the landing page explains it. */
function statusForLocationError(error: unknown): LocationStatus | null {
  if (!(error instanceof AppError)) return null
  switch (error.code) {
    case 'LOCATION_PERMISSION_DENIED':
      return 'denied'
    case 'LOCATION_UNSUPPORTED':
      return 'unsupported'
    case 'LOCATION_TIMEOUT':
    case 'LOCATION_UNAVAILABLE':
      return 'unknown'
    default:
      return null
  }
}

/**
 * Runs the landing page's location check: one fresh reading, then the server's
 * verdict (location_check). The phone never decides "inside" itself.
 *
 * Starts on its own only when location permission was already granted, so a
 * first-time guest always sees why location is needed before the browser asks.
 */
export function useLocationCheck(slug: string, qrToken: string, enabled: boolean) {
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  // Each check gets a number; only the latest may update the screen, so a slow
  // earlier check can never overwrite a newer result.
  const latest = useRef(0)

  const check = useCallback(async () => {
    const id = ++latest.current
    setStatus('checking')
    setError(null)
    try {
      const reading = await getReading()
      const verdict = await checkLocation(slug, qrToken, reading)
      if (id === latest.current) setStatus(verdict)
    } catch (caught) {
      if (id !== latest.current) return
      const locationStatus = statusForLocationError(caught)
      if (locationStatus) {
        setStatus(locationStatus)
      } else {
        // A server problem (rate limit, network, venue closed meanwhile): show
        // it and let the guest try again from the start.
        setError(caught)
        setStatus('idle')
      }
    }
  }, [slug, qrToken])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function startIfAlreadyAllowed() {
      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' })
        if (!cancelled && permission.state === 'granted') void check()
      } catch {
        // Permissions API missing or not supporting geolocation (older Safari):
        // stay idle and let the guest tap, which is always correct.
      }
    }
    void startIfAlreadyAllowed()
    return () => {
      cancelled = true
    }
  }, [enabled, check])

  return { status, error, check }
}
