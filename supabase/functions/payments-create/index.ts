// Starts a payment for the signed-in guest (ARCHITECTURE §4.10):
// prepare_payment in the database (all rules, amount from settings) → a
// Razorpay order for that amount → what Checkout needs on the phone.
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, ALLOWED_ORIGINS.
// The key id is public (Checkout needs it); the key secret never leaves here.
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
import { createOrder, RazorpayUnavailable } from '../_shared/razorpay.ts'
import { parseCreateRequest } from './request.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, 405, { error: 'METHOD_NOT_ALLOWED' })
  try {
    // Before anything is written: a project without Razorpay keys refuses cleanly.
    const keyId = requiredEnv('RAZORPAY_KEY_ID')
    const keySecret = requiredEnv('RAZORPAY_KEY_SECRET')
    const client = serviceClient()
    const userId = await callerId(request, client)
    const input = parseCreateRequest(await request.json().catch(() => null))

    const prepared = await client
      .rpc('prepare_payment', {
        p_user_id: userId,
        p_purpose: input.purpose,
        p_slug: input.slug,
        p_qr_token: input.qrToken,
        p_latitude: input.reading?.latitude,
        p_longitude: input.reading?.longitude,
        p_accuracy_m: input.reading?.accuracyM,
        p_age_seconds: input.reading?.ageSeconds,
        p_device_id: input.deviceId,
      })
      .single()
    if (prepared.error) throw fromDatabase(prepared.error)
    const payment = prepared.data

    let orderId: string
    try {
      orderId = await createOrder({
        keyId,
        keySecret,
        amountPaise: payment.amount_paise,
        receipt: payment.payment_id,
        notes: { payment_id: payment.payment_id, purpose: payment.purpose },
      })
    } catch (error) {
      if (!(error instanceof RazorpayUnavailable)) throw error
      // The attempt is over; the guest can try again (a new payment row).
      const failed = await client.rpc('payment_mark_failed', {
        p_payment_id: payment.payment_id,
        p_raw: { source: 'order', razorpay_status: String(error.status) },
      })
      if (failed.error) console.error('payment_mark_failed failed', { message: failed.error.message })
      throw new HttpError(503, 'PAYMENT_PROVIDER_UNAVAILABLE')
    }

    const recorded = await client.rpc('payment_set_order', { p_payment_id: payment.payment_id, p_order_id: orderId })
    if (recorded.error) throw fromDatabase(recorded.error)

    return json(request, 200, {
      payment_id: payment.payment_id,
      order_id: orderId,
      amount_paise: payment.amount_paise,
      currency: payment.currency,
      purpose: payment.purpose,
      venue_name: payment.venue_name,
      key_id: keyId,
    })
  } catch (error) {
    return errorResponse(request, 'payments-create', error)
  }
})
