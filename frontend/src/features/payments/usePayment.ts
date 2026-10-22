import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AppError } from '../../lib/errors'
import { formatPaise } from '../../lib/format'
import { payWithCheckout } from '../../lib/razorpay'
import { LIVE_SESSION_KEY } from '../session/api'
import { createPayment, type EntryContext, type PaymentPurpose, verifyPayment } from './api'

export interface PayRequest {
  purpose: PaymentPurpose
  /**
   * At entry: gathers the scanned table and a fresh reading (taken only when
   * the guest taps, so it is current). null when paying inside a live session.
   */
  entry: (() => Promise<EntryContext>) | null
}

/** True for the guest closing Checkout: not an error to show. */
export function isCancelled(error: unknown): boolean {
  return error instanceof AppError && error.code === 'PAYMENT_CANCELLED'
}

/**
 * One payment, start to finish: create (server sets the amount) → Razorpay
 * Checkout → verify (server checks the signature and applies it). Resolves
 * only once the server has applied the payment, so nothing on screen can
 * claim "paid" before it is. Closing Checkout rejects with PAYMENT_CANCELLED.
 */
export function usePayment() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const refreshSession = () => queryClient.invalidateQueries({ queryKey: LIVE_SESSION_KEY })

  return useMutation({
    mutationFn: async ({ purpose, entry }: PayRequest) => {
      const payment = await createPayment(purpose, entry ? await entry() : null)
      // Starting to pay in the final prompt extends its deadline (payment
      // grace); fetch it so the countdown on screen shows the new one.
      void refreshSession()
      const result = await payWithCheckout({
        keyId: payment.keyId,
        orderId: payment.orderId,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        title: t('app.name'),
        description: t(`payments.purposes.${purpose}`, {
          venue: payment.venueName,
          price: formatPaise(payment.amountPaise, i18n.language),
        }),
      })
      await verifyPayment(payment.paymentId, result)
      return payment.paymentId
    },
    onSettled: refreshSession,
  })
}
