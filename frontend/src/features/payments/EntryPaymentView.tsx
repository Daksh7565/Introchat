import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { PRIMARY_BUTTON, StepCard } from '../../components/StepCard'
import { formatPaise } from '../../lib/format'
import type { PaymentPurpose } from './api'
import type { EntryPrices } from './entryPrices'

interface EntryPaymentViewProps {
  venueName: string
  prices: EntryPrices
  /** The option being paid for right now, if any. */
  paying: PaymentPurpose | null
  error: unknown
  onPay: (purpose: 'scan_fee' | 'subscription') => void
  onBack: () => void
}

/** Shown when entering this venue needs a payment (switches on, no scans left). */
export function EntryPaymentView({
  venueName,
  prices,
  paying,
  error,
  onPay,
  onBack,
}: EntryPaymentViewProps) {
  const { t, i18n } = useTranslation()
  const busy = paying !== null

  return (
    <StepCard
      title={t('payments.entry.title', { venue: venueName })}
      onBack={busy ? undefined : onBack}
    >
      <p className="text-slate-600">{t('payments.entry.body')}</p>

      <button
        type="button"
        disabled={busy}
        onClick={() => onPay('scan_fee')}
        className={`${PRIMARY_BUTTON} flex flex-col items-center`}
      >
        <span>
          {paying === 'scan_fee'
            ? t('payments.paying')
            : t('payments.entry.scanFee', {
                price: formatPaise(prices.scanFeePaise, i18n.language),
                count: prices.scanSessionMinutes,
              })}
        </span>
      </button>

      {prices.subscriptionOn ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPay('subscription')}
          className="flex w-full flex-col items-center rounded-xl border-2 border-teal-700 px-4 py-3 font-semibold text-teal-800 disabled:border-slate-200 disabled:text-slate-400"
        >
          <span>
            {paying === 'subscription'
              ? t('payments.paying')
              : t('payments.entry.subscription', {
                  price: formatPaise(prices.subscriptionPricePaise, i18n.language),
                  count: prices.subscriptionScans,
                })}
          </span>
          <span className="text-xs font-normal">{t('payments.entry.subscriptionHelp')}</span>
        </button>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-center text-slate-500">
          {t('session.options.subscribeComingSoon')}
        </p>
      )}

      <ErrorText error={error} />
      <p className="text-xs text-slate-500">{t('payments.entry.secure')}</p>
    </StepCard>
  )
}
