import { useEffect, useRef } from 'react'
import { AppError } from '../../lib/errors'
import { getReading, type Reading } from '../../lib/location'
import { type PermissionState, type SessionState, sendHeartbeat } from './api'

const LOST = new Set(['BANNED', 'NOT_A_GUEST', 'SESSION_NOT_ACTIVE'])

interface Captured {
  reading: Reading
  capturedAtMs: number
}

/**
 * Keeps a live session alive and its location current (ARCHITECTURE §3.1, §4.6):
 *   - a heartbeat every HEARTBEAT_INTERVAL_SECONDS while the app is on screen;
 *   - a fresh GPS reading every LOCATION_INTERVAL_SECONDS while on screen;
 *   - both at once when the app comes back on screen or back online, so a
 *     guest who reopens the app at home is caught immediately.
 * Nothing runs while the app is hidden: a locked phone simply goes "offline"
 * on the server, which is not an end.
 */
export function usePresenceLoop(
  state: SessionState | null,
  onState: (state: SessionState) => void,
  /** The server refused the heartbeat (banned, session gone): re-read the session. */
  onLost?: () => void,
): void {
  const live = state !== null && state.status !== 'ended'
  const heartbeatMs = (state?.heartbeatSeconds ?? 30) * 1000
  const locationMs = (state?.locationSeconds ?? 120) * 1000
  // The latest callback, without restarting the timers when it changes.
  const onStateRef = useRef(onState)
  const onLostRef = useRef(onLost)
  useEffect(() => {
    onStateRef.current = onState
    onLostRef.current = onLost
  })

  useEffect(() => {
    if (!live) return
    let stopped = false
    let beating = false
    let latest: Captured | null = null
    let permission: PermissionState = 'prompt'
    const onScreen = () => document.visibilityState === 'visible'

    async function readLocation() {
      try {
        latest = { reading: await getReading(), capturedAtMs: Date.now() }
        permission = 'granted'
      } catch (error) {
        // Denied counts as outside on the server. Other failures (no signal,
        // timeout) keep the last reading: the server ignores readings it has
        // already evaluated, so resending one changes nothing.
        if (error instanceof AppError && error.code === 'LOCATION_PERMISSION_DENIED') {
          permission = 'denied'
          latest = null
        }
      }
    }

    // The reading's age when it is sent, not when it was taken.
    function readingNow(): Reading | null {
      if (!latest) return null
      const extra = (Date.now() - latest.capturedAtMs) / 1000
      return { ...latest.reading, ageSeconds: latest.reading.ageSeconds + extra }
    }

    async function beat() {
      if (beating || stopped) return
      beating = true
      try {
        const next = await sendHeartbeat(readingNow(), permission)
        if (!stopped) onStateRef.current(next)
      } catch (error) {
        // A ban (or an account / session that no longer exists) will not pass
        // on retry: let the screen re-read the session and show why. Anything
        // else, mostly a lost connection, is retried by the next beat; the
        // offline banner comes from the browser's own status, and unexpected
        // server errors were already reported by unwrap().
        if (error instanceof AppError && LOST.has(error.code) && !stopped) onLostRef.current?.()
      } finally {
        beating = false
      }
    }

    async function refreshNow() {
      if (!onScreen()) return
      await readLocation()
      await beat()
    }

    const heartbeatTimer = window.setInterval(() => {
      if (onScreen()) void beat()
    }, heartbeatMs)
    const locationTimer = window.setInterval(() => {
      if (onScreen()) void readLocation()
    }, locationMs)
    const onReturn = () => void refreshNow()
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('online', onReturn)
    void refreshNow()

    return () => {
      stopped = true
      window.clearInterval(heartbeatTimer)
      window.clearInterval(locationTimer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('online', onReturn)
    }
  }, [live, heartbeatMs, locationMs])
}
