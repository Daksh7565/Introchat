import { AppError } from './errors'

// Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
// Loaded only when a guest pays, so nobody else downloads it. The CSP (M8)
// must allow https://checkout.razorpay.com and its frames.
const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/** What Checkout hands back on success; verified on the server (payments-verify). */
export interface CheckoutSuccess {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

// The part of Checkout's API this app uses.
interface CheckoutOptions {
  key: string
  order_id: string
  amount: number
  currency: string
  name: string
  description: string
  theme: { color: string }
  handler: (response: CheckoutSuccess) => void
  modal: { ondismiss: () => void; confirm_close: boolean }
}
interface CheckoutInstance {
  open: () => void
}
type CheckoutConstructor = new (options: CheckoutOptions) => CheckoutInstance

declare global {
  interface Window {
    Razorpay?: CheckoutConstructor
  }
}

let loading: Promise<CheckoutConstructor> | null = null

function loadCheckout(): Promise<CheckoutConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  loading ??= new Promise<CheckoutConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.async = true
    script.onload = () =>
      window.Razorpay
        ? resolve(window.Razorpay)
        : reject(new AppError('PAYMENT_PROVIDER_UNAVAILABLE'))
    script.onerror = () => {
      // Let the next attempt try again (a flaky connection is the usual cause).
      loading = null
      script.remove()
      reject(new AppError('NETWORK'))
    }
    document.head.append(script)
  })
  return loading
}

export interface CheckoutOrder {
  keyId: string
  orderId: string
  amountPaise: number
  currency: string
  /** Shown at the top of Checkout: the app's name, translated. */
  title: string
  description: string
}

/**
 * Opens Checkout for an order created by payments-create. Resolves with the
 * signed result; rejects with PAYMENT_CANCELLED when the guest closes it.
 * A failed attempt inside Checkout is not final: Checkout lets the guest
 * retry with another method, so only closing ends it.
 */
export async function payWithCheckout(order: CheckoutOrder): Promise<CheckoutSuccess> {
  const Checkout = await loadCheckout()
  return new Promise<CheckoutSuccess>((resolve, reject) => {
    new Checkout({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: order.title,
      description: order.description,
      theme: { color: '#0f766e' },
      handler: resolve,
      modal: {
        ondismiss: () => reject(new AppError('PAYMENT_CANCELLED')),
        confirm_close: true,
      },
    }).open()
  })
}
