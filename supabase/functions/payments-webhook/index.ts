// Razorpay's server-to-server notice of a captured payment (ARCHITECTURE
// §4.10): the reliable path when the phone closed before payments-verify ran.
// Only payment.captured and order.paid are acted on; everything else is
// acknowledged and ignored.
//
// Answer codes matter: Razorpay retries non-2xx answers, so a temporary
// database failure answers 500 (retry), while a request that can never
// succeed (bad signature aside) answers 200 and is logged for a person.
//
// Secrets: RAZORPAY_WEBHOOK_SECRET. Called by Razorpay, never by browsers.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { capturedPayment, webhookSignatureValid } from '../_shared/razorpay.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' })
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !url || !serviceKey) {
    console.error('payments-webhook not configured')
    return json(503, { error: 'PAYMENTS_NOT_CONFIGURED' })
  }

  // The signature covers the exact bytes received: read the body as text first.
  const rawBody = await request.text()
  if (!(await webhookSignatureValid(rawBody, request.headers.get('x-razorpay-signature'), secret))) {
    return json(401, { error: 'INVALID_SIGNATURE' })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    console.error('payments-webhook: signed body is not JSON')
    return json(200, { ignored: 'malformed' })
  }
  const payment = capturedPayment(body)
  if (!payment) return json(200, { ignored: 'event' })
  if (payment.currency !== 'INR') {
    console.error('payments-webhook: unexpected currency', { currency: payment.currency })
    return json(200, { ignored: 'currency' })
  }

  const client = createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const ours = await client.rpc('payment_by_order', { p_order_id: payment.orderId }).maybeSingle()
  if (ours.error) {
    console.error('payments-webhook: lookup failed', { message: ours.error.message })
    return json(500, { error: 'DATABASE_ERROR' })
  }
  if (!ours.data) {
    // An order this project did not create (another app on the same Razorpay account).
    return json(200, { ignored: 'unknown_order' })
  }

  const applied = await client.rpc('apply_payment', {
    p_payment_id: ours.data.payment_id,
    p_provider_payment_id: payment.paymentId,
    p_amount_paise: payment.amountPaise,
    p_raw: {
      source: 'webhook',
      event: payment.event,
      razorpay_payment_id: payment.paymentId,
      razorpay_order_id: payment.orderId,
      method: payment.method,
    },
  })
  if (applied.error) {
    if (applied.error.message === 'PAYMENT_AMOUNT_MISMATCH') {
      // Retrying cannot fix this; it needs a person (refund or investigate).
      console.error('payments-webhook: amount mismatch', { payment_id: ours.data.payment_id })
      return json(200, { ignored: 'amount_mismatch' })
    }
    console.error('payments-webhook: apply failed', { message: applied.error.message })
    return json(500, { error: 'DATABASE_ERROR' })
  }
  return json(200, { status: applied.data })
})
