import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { formatPaise } from '../../../lib/format'
import {
  listPayments,
  markRefunded,
  moneyKeys,
  PAYMENT_STATUSES,
  type PaymentRow,
  type PaymentStatus,
} from './api'

const STATUS_STYLE: Record<PaymentStatus, string> = {
  created: 'bg-slate-100 text-slate-700',
  paid: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
  refunded: 'bg-amber-100 text-amber-900',
}

/** Recent payments, newest first, with the refund record for paid ones (§4.10). */
export function PaymentsPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<PaymentStatus | null>('paid')
  const payments = useQuery({
    queryKey: moneyKeys.payments(status),
    queryFn: () => listPayments(status),
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('admin.payments.title')}</h2>
        <label className="flex items-center gap-2 text-sm">
          <span>{t('admin.payments.filter')}</span>
          <select
            value={status ?? ''}
            onChange={(event) => {
              const value = PAYMENT_STATUSES.find((s) => s === event.target.value)
              setStatus(value ?? null)
            }}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="">{t('admin.payments.all')}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.payments.statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm text-slate-600">{t('admin.payments.refundHelp')}</p>

      {payments.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={payments.error} />
      {payments.data?.length === 0 && <p className="text-slate-500">{t('admin.payments.empty')}</p>}
      {payments.data && payments.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
          {payments.data.map((payment) => (
            <PaymentItem key={payment.id} payment={payment} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PaymentItem({ payment }: { payment: PaymentRow }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [refunding, setRefunding] = useState(false)
  const [note, setNote] = useState('')
  const refund = useMutation({
    mutationFn: () => markRefunded(payment.id, note.trim()),
    onSuccess: () => {
      setRefunding(false)
      return queryClient.invalidateQueries({ queryKey: moneyKeys.allPayments })
    },
  })
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <li className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {formatPaise(payment.amountPaise, i18n.language)} ·{' '}
          {t(`admin.payments.purposes.${payment.purpose}`)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[payment.status]}`}
        >
          {t(`admin.payments.statuses.${payment.status}`)}
        </span>
      </div>
      <p className="text-slate-600">
        {payment.venueName} · {payment.guestHandle ?? t('admin.payments.deletedGuest')} ·{' '}
        {when.format(payment.createdAt)}
      </p>
      {payment.providerPaymentId && (
        <p className="font-mono text-xs text-slate-500">{payment.providerPaymentId}</p>
      )}
      {payment.refundNote && (
        <p className="text-xs text-amber-900">
          {t('admin.payments.refundedNote', { note: payment.refundNote })}
        </p>
      )}

      {payment.status === 'paid' && !refunding && (
        <button
          type="button"
          onClick={() => setRefunding(true)}
          className="self-start text-sm font-semibold text-slate-700 underline"
        >
          {t('admin.payments.markRefunded')}
        </button>
      )}
      {refunding && (
        <form
          className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            refund.mutate()
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('admin.payments.refundNote')}</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
            />
          </label>
          {payment.purpose === 'subscription' && (
            <p className="text-xs text-amber-900">{t('admin.payments.subscriptionRefundHelp')}</p>
          )}
          <ErrorText error={refund.error} />
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={note.trim() === '' || refund.isPending}
              className="rounded-lg bg-amber-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
            >
              {t('admin.payments.confirmRefund')}
            </button>
            <button
              type="button"
              disabled={refund.isPending}
              onClick={() => setRefunding(false)}
              className="font-semibold text-slate-600"
            >
              {t('admin.payments.cancel')}
            </button>
          </div>
        </form>
      )}
    </li>
  )
}
