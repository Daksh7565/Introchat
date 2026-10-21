import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import {
  enablePush,
  type PushAvailability,
  pushAvailability,
  syncPushSubscription,
} from '../../lib/push'

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
  const { t } = useTranslation()
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

  const close = () => {
    rememberDismissed(sessionId)
    setDismissed(true)
  }

  if (availability === 'needs_install') {
    return (
      <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm">
        <p className="font-semibold">{t('push.installTitle')}</p>
        <p className="mt-1 text-slate-700">{t('push.installBody')}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
          <li>{t('push.installStep1')}</li>
          <li>{t('push.installStep2')}</li>
          <li>{t('push.installStep3')}</li>
        </ol>
        <button type="button" onClick={close} className="mt-3 font-semibold text-teal-800">
          {t('push.gotIt')}
        </button>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm">
      <p className="font-semibold">{t('push.askTitle')}</p>
      <p className="mt-1 text-slate-700">{t('push.askBody')}</p>
      <ErrorText error={error} />
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={working}
          onClick={() => {
            setWorking(true)
            setError(null)
            enablePush()
              .then(setAvailability)
              .catch(setError)
              .finally(() => setWorking(false))
          }}
          className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:bg-slate-300"
        >
          {t('push.turnOn')}
        </button>
        <button type="button" onClick={close} className="font-semibold text-slate-600">
          {t('push.notNow')}
        </button>
      </div>
    </section>
  )
}
