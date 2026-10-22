import { AppError } from '../../lib/errors'
import { callFunction } from '../../lib/functions'
import type { Reading } from '../../lib/location'
import type { CheckoutSuccess } from '../../lib/razorpay'

export type PaymentPurpose = 'scan_fee' | 'continue' | 'subscription'

/** At entry: the scanned table and a fresh reading taken there (the server checks it). */
export interface EntryContext {
  slug: string
  qrToken: string
  reading: Reading
  deviceId: string
}

export interface CreatedPayment {
  paymentId: string
  orderId: string
  amountPaise: number
  currency: string
  purpose: PaymentPurpose
  venueName: string
  keyId: string
}

// What payments-create answers (supabase/functions/payments-create/index.ts).
interface CreateAnswer {
  payment_id: string
  order_id: string
  amount_paise: number
  currency: string
  purpose: PaymentPurpose
  venue_name: string
  key_id: string
}

export async function createPayment(
  purpose: PaymentPurpose,
  entry: EntryContext | null,
): Promise<CreatedPayment> {
  const answer = await callFunction<CreateAnswer>(
    'payments-create',
    entry
      ? {
          purpose,
          slug: entry.slug,
          qr_token: entry.qrToken,
          device_id: entry.deviceId,
          reading: {
            latitude: entry.reading.latitude,
            longitude: entry.reading.longitude,
            accuracy_m: entry.reading.accuracyM,
            age_seconds: entry.reading.ageSeconds,
          },
        }
      : { purpose },
  )
  return {
    paymentId: answer.payment_id,
    orderId: answer.order_id,
    amountPaise: answer.amount_paise,
    currency: answer.currency,
    purpose: answer.purpose,
    venueName: answer.venue_name,
    keyId: answer.key_id,
  }
}

/**
 * Sends Checkout's signed result to the server, which checks the signature
 * and applies the payment. A dropped connection here does not lose the
 * payment (Razorpay's webhook applies it too), so it surfaces as
 * PAYMENT_CONFIRMING rather than a failure.
 */
export async function verifyPayment(paymentId: string, result: CheckoutSuccess): Promise<void> {
  try {
    await callFunction<{ status: 'applied' | 'already_applied' }>('payments-verify', {
      payment_id: paymentId,
      razorpay_order_id: result.razorpay_order_id,
      razorpay_payment_id: result.razorpay_payment_id,
      razorpay_signature: result.razorpay_signature,
    })
  } catch (error) {
    if (error instanceof AppError && error.code === 'NETWORK') {
      throw new AppError('PAYMENT_CONFIRMING', null, error)
    }
    throw error
  }
}
