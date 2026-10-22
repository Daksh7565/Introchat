// Razorpay: signature checks, order creation and webhook parsing, shared by
// payments-create, payments-verify and payments-webhook. Pure except
// createOrder (one HTTPS call), so it is unit-tested without Razorpay.
//
// Razorpay docs: Checkout signature = HMAC_SHA256(order_id + "|" + payment_id,
// key_secret); webhook signature = HMAC_SHA256(raw request body,
// webhook_secret); both hex-encoded.

const ORDERS_URL = 'https://api.razorpay.com/v1/orders'
// Checkout is waiting on this call; a Razorpay that has not answered in 10 s
// is treated as down so the guest can try again instead of staring at a spinner.
const ORDER_TIMEOUT_MS = 10_000

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compares in time that does not depend on where the strings differ. */
export function constantTimeEqual(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

/** The signature Checkout returns on success, for this order and payment. */
export async function checkoutSignatureValid(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): Promise<boolean> {
  return constantTimeEqual(signature, await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`))
}

/** The X-Razorpay-Signature header of a webhook, over the exact raw body. */
export async function webhookSignatureValid(
  rawBody: string,
  signature: string | null,
  webhookSecret: string,
): Promise<boolean> {
  if (!signature) return false
  return constantTimeEqual(signature, await hmacSha256Hex(webhookSecret, rawBody))
}

export class RazorpayUnavailable extends Error {
  constructor(readonly status: number | 'timeout' | 'network') {
    super(`razorpay ${status}`)
  }
}

/** Creates the order Checkout will pay. Returns Razorpay's order id (order_...). */
export async function createOrder(input: {
  keyId: string
  keySecret: string
  amountPaise: number
  receipt: string
  notes: Record<string, string>
}): Promise<string> {
  let response: Response
  try {
    response = await fetch(ORDERS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${btoa(`${input.keyId}:${input.keySecret}`)}`,
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes,
      }),
      signal: AbortSignal.timeout(ORDER_TIMEOUT_MS),
    })
  } catch (error) {
    throw new RazorpayUnavailable(
      error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network',
    )
  }
  if (!response.ok) throw new RazorpayUnavailable(response.status)
  const body: unknown = await response.json()
  const id = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined
  if (typeof id !== 'string' || !id.startsWith('order_')) throw new RazorpayUnavailable(response.status)
  return id
}

/** The payment facts of a webhook we act on; null for events we ignore. */
export interface CapturedPayment {
  event: 'payment.captured' | 'order.paid'
  paymentId: string
  orderId: string
  amountPaise: number
  currency: string
  method: string | null
}

export function capturedPayment(body: unknown): CapturedPayment | null {
  if (typeof body !== 'object' || body === null) return null
  const { event, payload } = body as { event?: unknown; payload?: unknown }
  if (event !== 'payment.captured' && event !== 'order.paid') return null
  const entity =
    typeof payload === 'object' && payload !== null
      ? (payload as { payment?: { entity?: Record<string, unknown> } }).payment?.entity
      : undefined
  if (!entity) return null
  const { id, order_id: orderId, amount, currency, method } = entity
  if (
    typeof id !== 'string' ||
    typeof orderId !== 'string' ||
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    typeof currency !== 'string'
  ) {
    return null
  }
  return {
    event,
    paymentId: id,
    orderId,
    amountPaise: amount,
    currency,
    method: typeof method === 'string' ? method : null,
  }
}
