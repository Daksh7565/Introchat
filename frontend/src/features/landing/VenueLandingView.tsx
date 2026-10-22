import { useTranslation } from 'react-i18next'

/**
 * The location step as the landing screen shows it (ARCHITECTURE §3, §4.1).
 *   idle         – not asked yet: explain why, then the guest taps to check
 *   checking     – reading the phone's location / asking the server
 *   inside       – the server says this phone is at the venue
 *   outside      – clearly not at the venue
 *   unknown      – location too imprecise or unavailable (e.g. iPhone Precise Location off)
 *   denied       – location permission refused for this site
 *   unsupported  – this browser cannot share location here (no https, very old browser)
 */
export type LocationStatus =
  'idle' | 'checking' | 'inside' | 'outside' | 'unknown' | 'denied' | 'unsupported'

interface VenueLandingViewProps {
  venueName: string
  tableLabel: string
  location: LocationStatus
  /** Starts a check (idle) or repeats it (after a problem). */
  onCheck: () => void
  /** The next step (login, onboarding); enabled only once inside. */
  onContinue: () => void
}

/** What a guest sees right after scanning the table QR. */
export function VenueLandingView({
  venueName,
  tableLabel,
  location,
  onCheck,
  onContinue,
}: VenueLandingViewProps) {
  const { t } = useTranslation()

  return (
    // Phone: stacked, Continue at the bottom of the screen. Tablet and up: the
    // welcome panel and the location step side by side, centred.
    <section className="flex flex-1 flex-col gap-6 py-6 md:mx-auto md:grid md:w-full md:max-w-4xl md:flex-none md:grid-cols-2 md:items-stretch md:py-12">
      <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-teal-800 p-6 text-white md:flex md:flex-col md:justify-end md:p-10">
        <p className="text-sm text-teal-100">{tableLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold md:text-3xl">
          {t('landing.welcomeTo', { venue: venueName })}
        </h1>
        <p className="mt-2 text-teal-50">{t('landing.subtitle')}</p>
      </div>

      <div className="flex flex-1 flex-col gap-6 md:justify-center">
        <LocationStatusCard venueName={venueName} status={location} onCheck={onCheck} />

        <button
          type="button"
          disabled={location !== 'inside'}
          onClick={onContinue}
          className="mt-auto rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500 md:mt-0"
        >
          {t('landing.continue')}
        </button>
      </div>
    </section>
  )
}

interface LocationStatusCardProps {
  venueName: string
  status: LocationStatus
  onCheck: () => void
}

function LocationStatusCard({ venueName, status, onCheck }: LocationStatusCardProps) {
  const { t } = useTranslation()

  if (status === 'idle') {
    return (
      <div className="rounded-xl border border-slate-200 p-4">
        <p className="font-semibold">{t('location.whyTitle')}</p>
        <p className="mt-1 text-sm text-slate-600">{t('location.whyBody', { venue: venueName })}</p>
        <button
          type="button"
          onClick={onCheck}
          className="mt-3 w-full rounded-lg bg-teal-700 py-2.5 font-semibold text-white"
        >
          {t('location.checkButton')}
        </button>
      </div>
    )
  }

  if (status === 'checking') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
        <span>{t('location.checking', { venue: venueName })}</span>
      </div>
    )
  }

  if (status === 'inside') {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
      >
        <span aria-hidden="true" className="text-xl">
          ✓
        </span>
        <span className="font-semibold">{t('location.inside', { venue: venueName })}</span>
      </div>
    )
  }

  const problem = {
    outside: {
      title: t('location.outside', { venue: venueName }),
      help: t('location.outsideHelp'),
    },
    unknown: { title: t('location.unknown'), help: t('location.unknownHelp') },
    denied: { title: t('location.denied'), help: t('location.deniedHelp') },
    unsupported: { title: t('location.unsupported'), help: t('location.unsupportedHelp') },
  }[status]

  return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <p className="font-semibold">{problem.title}</p>
      <p className="mt-1 text-sm">{problem.help}</p>
      {status !== 'unsupported' && (
        <button
          type="button"
          onClick={onCheck}
          className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold"
        >
          {t('location.retry')}
        </button>
      )}
    </div>
  )
}
