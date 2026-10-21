import { useTranslation } from 'react-i18next'
import { formatPaise } from '../../lib/format'
import type { SessionOption } from './types'

interface SessionPopupProps {
  /** warning = 15 min left; final = time is up, the guest has `secondsLeft` to choose. */
  variant: 'warning' | 'final'
  secondsLeft: number
  options: SessionOption[]
  onChoose: (option: SessionOption) => void
  /** warning: close the popup (server state unchanged). final: log out now. */
  onDismiss: () => void
}

export function SessionPopup({
  variant,
  secondsLeft,
  options,
  onChoose,
  onDismiss,
}: SessionPopupProps) {
  const { t, i18n } = useTranslation()
  const minutesLeft = Math.max(1, Math.ceil(secondsLeft / 60))

  function label(option: SessionOption): string {
    switch (option.kind) {
      case 'continue_free':
        return t('session.options.continueFree', { count: option.minutes })
      case 'continue_paid':
        return t('session.options.continuePaid', {
          count: option.minutes,
          price: formatPaise(option.pricePaise, i18n.language),
        })
      case 'use_scan':
        return t('session.options.useScan', { count: option.minutes })
      case 'subscribe':
        return t('session.options.subscribe', {
          scans: option.scans,
          price: formatPaise(option.pricePaise, i18n.language),
        })
      case 'subscribe_coming_soon':
        return t('session.options.subscribeComingSoon')
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-popup-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="session-popup-title" className="text-lg font-semibold">
          {variant === 'warning'
            ? t('session.warningTitle', { count: minutesLeft })
            : t('session.finalTitle')}
        </h2>
        <p className="mt-1 text-slate-600">
          {variant === 'warning'
            ? t('session.warningBody')
            : t('session.finalBody', { count: Math.max(0, Math.ceil(secondsLeft)) })}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {options.map((option) => {
            const comingSoon = option.kind === 'subscribe_coming_soon'
            return (
              <button
                key={option.kind}
                type="button"
                disabled={comingSoon}
                onClick={() => onChoose(option)}
                className={
                  comingSoon
                    ? 'rounded-xl border border-dashed border-slate-300 py-3 text-slate-500'
                    : 'rounded-xl bg-teal-700 py-3 font-semibold text-white'
                }
              >
                {label(option)}
                {option.kind === 'use_scan' && (
                  <span className="block text-xs font-normal text-teal-100">
                    {t('session.options.scansLeft', { count: option.creditsLeft })}
                  </span>
                )}
              </button>
            )
          })}
          <button type="button" onClick={onDismiss} className="py-2 font-semibold text-slate-600">
            {variant === 'warning' ? t('session.options.notNow') : t('session.options.logOut')}
          </button>
        </div>
      </div>
    </div>
  )
}
