import { useEffect, useState } from 'react'
import {
  enablePush,
  type PushAvailability,
  pushAvailability,
  syncPushSubscription,
} from '../../lib/push'
import { PushPromptView } from './PushPromptView'

const DISMISSED_KEY = 'introchat.pushPromptDismissedFor'

function dismissedFor(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function rememberDismissed(sessionId: string) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, sessionId)
  } catch {
    // Storage blocked: the card may come back on reload, which is harmless.
  }
}

interface PushPromptProps {
  sessionId: string
  /** True once the guest has sent or received a chat request (decision: ask in context). */
  relevant: boolean
}

/**
 * Offers notifications at the moment they make sense: after the first chat
 * request, so the guest sees why. "Not now" hides it for this visit. A browser
 * that already allowed notifications is kept subscribed without asking.
 */
export function PushPrompt({ sessionId, relevant }: PushPromptProps) {
  const [availability, setAvailability] = useState<PushAvailability>(() => pushAvailability())
  const [dismissed, setDismissed] = useState(() => dismissedFor() === sessionId)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (availability !== 'on') return
    // Best effort: a failure only means no notifications until the next visit.
    syncPushSubscription().catch(() => undefined)
  }, [availability])

  if (!relevant || dismissed || (availability !== 'ask' && availability !== 'needs_install')) {
    return null
  }

  return (
    <PushPromptView
      variant={availability}
      working={working}
      error={error}
      onTurnOn={() => {
        setWorking(true)
        setError(null)
        enablePush()
          .then(setAvailability)
          .catch(setError)
          .finally(() => setWorking(false))
      }}
      onClose={() => {
        rememberDismissed(sessionId)
        setDismissed(true)
      }}
    />
  )
}
