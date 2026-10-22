// Confirms a Checkout success from the phone (ARCHITECTURE §4.10): the
// signature must be Razorpay's for exactly this order and payment, and the
// payment must belong to the caller. Then apply_payment gives the guest what
// they paid for. The webhook does the same independently; whichever is first
// applies it, the other is a no-op.
//
// Secrets: RAZORPAY_KEY_SECRET, ALLOWED_ORIGINS.
import {
  callerId,
  corsHeaders,
  errorResponse,
  fromDatabase,
  HttpError,
  json,
  requiredEnv,
  serviceClient,
} from '../_shared/http.ts'
import { checkoutSignatureValid } from '../_shared/razorpay.ts'

interface VerifyRequest {
  paymentId: string
  orderId: string
  razorpayPaymentId: string
  signature: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function parse(value: unknown): VerifyRequest {
  if (typeof value !== 'object' || value === null) throw new HttpError(400, 'VALIDATION_FAILED')
  const v = value as Record<string, unknown>
  if (
    typeof v.payment_id !== 'string' ||
    !UUID.test(v.payment_id) ||
    typeof v.razorpay_order_id !== 'string' ||
    typeof v.razorpay_payment_id !== 'string' ||
    !/^pay_[A-Za-z0-9]{6,40}$/.test(v.razorpay_payment_id) ||
    typeof v.razorpay_signature !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.razorpay_signature)
  ) {
    throw new HttpError(400, 'VALIDATION_FAILED')
  }
  return {
    paymentId: v.payment_id,
    orderId: v.razorpay_order_id,
    razorpayPaymentId: v.razorpay_payment_id,
    signature: v.razorpay_signature,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, 405, { error: 'METHOD_NOT_ALLOWED' })
  try {
    const keySecret = requiredEnv('RAZORPAY_KEY_SECRET')
    const client = serviceClient()
    const userId = await callerId(request, client)
    const input = parse(await request.json().catch(() => null))

    const found = await client.rpc('payment_for_verify', { p_payment_id: input.paymentId }).maybeSingle()
    if (found.error) throw fromDatabase(found.error)
    // One answer for "not yours" and "does not exist": nobody learns other guests' payment ids.
    if (!found.data || found.data.user_id !== userId || found.data.provider_order_id !== input.orderId) {
      throw new HttpError(404, 'PAYMENT_NOT_FOUND')
    }
    if (!(await checkoutSignatureValid(input.orderId, input.razorpayPaymentId, input.signature, keySecret))) {
      throw new HttpError(400, 'PAYMENT_INVALID')
    }

    const applied = await client.rpc('apply_payment', {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.razorpayPaymentId,
      // The order was created for exactly this amount; the signature proves
      // this payment paid that order.
      p_amount_paise: found.data.amount_paise,
      p_raw: { source: 'checkout', razorpay_payment_id: input.razorpayPaymentId, razorpay_order_id: input.orderId },
    })
    if (applied.error) throw fromDatabase(applied.error)
    return json(request, 200, { status: applied.data })
  } catch (error) {
    return errorResponse(request, 'payments-verify', error)
  }
})
