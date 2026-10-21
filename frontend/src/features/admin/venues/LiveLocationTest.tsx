import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import type { AppError } from '../../../lib/errors'
import { type Reading, watchReadings } from '../../../lib/location'
import { type LocationTestResult, testLocation } from './api'

// Phones report positions several times a second while moving; asking the
// server about every one would hammer it for no new information.
const MIN_CHECK_INTERVAL_MS = 3_000

const STATE_STYLE: Record<LocationTestResult['state'], string> = {
  inside: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  outside: 'border-rose-200 bg-rose-50 text-rose-900',
  unknown: 'border-amber-200 bg-amber-50 text-amber-900',
}

/**
 * On-site check for admins: walk around with the phone and see, live, what a
 * guest standing here would get, with the numbers behind it. Uses the server's
 * rule (admin_test_location), not a copy of it.
 */
export function LiveLocationTest({ venueId }: { venueId: string }) {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ test: LocationTestResult; reading: Reading } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const lastCheck = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!running) return
    lastCheck.current = 0
    const stop = watchReadings(
      (reading) => {
        const now = Date.now()
        if (inFlight.current || now - lastCheck.current < MIN_CHECK_INTERVAL_MS) return
        lastCheck.current = now
        inFlight.current = true
        testLocation(venueId, reading)
          .then((test) => {
            setResult({ test, reading })
            setError(null)
          })
          .catch((caught: unknown) => setError(caught))
          .finally(() => {
            inFlight.current = false
          })
      },
      (caught: AppError) => {
        setError(caught)
        setRunning(false)
      },
    )
    return stop
  }, [running, venueId])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600">{t('admin.test.help')}</p>
      <button
        type="button"
        onClick={() => setRunning((value) => !value)}
        className={`rounded-lg py-2 font-semibold ${running ? 'border border-slate-300 text-slate-700' : 'bg-teal-700 text-white'}`}
      >
        {running ? t('admin.test.stop') : t('admin.test.start')}
      </button>
      <ErrorText error={error} />
      {result && (
        <div role="status" className={`rounded-xl border p-3 ${STATE_STYLE[result.test.state]}`}>
          <p className="text-lg font-semibold">{t(`admin.test.states.${result.test.state}`)}</p>
          <p className="mt-1 text-sm">
            {t('admin.test.numbers', {
              distance: result.test.distanceM,
              accuracy: Math.round(result.reading.accuracyM),
              radius: result.test.radiusM,
              maxAccuracy: result.test.maxAccuracyM,
            })}
          </p>
          {running && <p className="mt-1 text-xs opacity-75">{t('admin.test.live')}</p>}
        </div>
      )}
    </div>
  )
}
