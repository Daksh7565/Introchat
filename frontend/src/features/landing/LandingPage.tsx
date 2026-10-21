import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { ErrorText } from '../../components/ErrorText'
import { AppError } from '../../lib/errors'
import { GuestEntry } from '../onboarding/GuestEntry'
import { getScannedVenue } from './api'
import { useLocationCheck } from './useLocationCheck'
import { VenueLandingView } from './VenueLandingView'

// Situations a guest can actually be in after scanning, each with its own
// explanation. Anything else is shown as a generic error with "Try again".
const SCAN_PROBLEMS = ['VENUE_NOT_FOUND', 'VENUE_CLOSED', 'TABLE_NOT_FOUND'] as const
type ScanProblem = (typeof SCAN_PROBLEMS)[number]

function scanProblem(error: unknown): ScanProblem | null {
  if (!(error instanceof AppError)) return null
  return SCAN_PROBLEMS.find((code) => code === error.code) ?? null
}

/** Target of every table QR card: /v/:slug/t/:token. */
export function LandingPage() {
  const { t } = useTranslation()
  const { slug = '', token = '' } = useParams()
  const venue = useQuery({
    queryKey: ['scan', slug, token],
    queryFn: () => getScannedVenue(slug, token),
    // Retry only a lost connection; "not active" will not change by retrying.
    retry: (failures, error) =>
      error instanceof AppError && error.code === 'NETWORK' && failures < 2,
  })
  const location = useLocationCheck(slug, token, venue.isSuccess)
  // Past the location step: login and onboarding. A reload comes back here,
  // so location is checked again on every visit.
  const [entering, setEntering] = useState(false)

  if (venue.isPending) {
    return (
      <p role="status" className="py-16 text-center text-slate-500">
        {t('landing.loading')}
      </p>
    )
  }

  if (venue.isError) {
    const problem = scanProblem(venue.error)
    return (
      <section className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
        {problem ? (
          <>
            <h1 className="text-xl font-semibold">{t(`landing.problems.${problem}.title`)}</h1>
            <p className="text-slate-600">{t(`landing.problems.${problem}.body`)}</p>
          </>
        ) : (
          <>
            <ErrorText error={venue.error} />
            <button
              type="button"
              onClick={() => void venue.refetch()}
              className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
            >
              {t('location.retry')}
            </button>
          </>
        )}
      </section>
    )
  }

  if (entering) {
    return (
      <GuestEntry
        slug={slug}
        qrToken={token}
        venueName={venue.data.venueName}
        onBack={() => setEntering(false)}
      />
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <VenueLandingView
        venueName={venue.data.venueName}
        tableLabel={venue.data.tableLabel}
        location={location.status}
        onCheck={() => void location.check()}
        onContinue={() => setEntering(true)}
      />
      <ErrorText error={location.error} />
    </div>
  )
}
