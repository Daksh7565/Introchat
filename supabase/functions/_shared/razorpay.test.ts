import { assertEquals } from 'jsr:@std/assert@1'
import { capturedPayment, checkoutSignatureValid, constantTimeEqual, webhookSignatureValid } from './razorpay.ts'

// Known answers computed with a different implementation (Node's crypto):
//   createHmac('sha256', 'test_key_secret').update('order_ABC123|pay_XYZ789').digest('hex')
//   createHmac('sha256', 'whsec_test').update('{"event":"payment.captured"}').digest('hex')
const CHECKOUT_SIGNATURE = '8f3f6d9875510a04884bbd681acc7af52bad387c42cd5a3b0ec78dcbef78b99a'
const WEBHOOK_BODY = '{"event":"payment.captured"}'
const WEBHOOK_SIGNATURE = '4f463a57dd128675850163391f0311888616d57bccca75c774c9cdb28134f851'

Deno.test('a correct Checkout signature is accepted', async () => {
  assertEquals(await checkoutSignatureValid('order_ABC123', 'pay_XYZ789', CHECKOUT_SIGNATURE, 'test_key_secret'), true)
})

Deno.test('a Checkout signature for another payment, or with another secret, is refused', async () => {
  // A real signature replayed for a different payment id.
  assertEquals(await checkoutSignatureValid('order_ABC123', 'pay_OTHER00', CHECKOUT_SIGNATURE, 'test_key_secret'), false)
  assertEquals(await checkoutSignatureValid('order_ABC123', 'pay_XYZ789', CHECKOUT_SIGNATURE, 'wrong_secret'), false)
  assertEquals(await checkoutSignatureValid('order_ABC123', 'pay_XYZ789', '0' + CHECKOUT_SIGNATURE.slice(1), 'test_key_secret'), false)
})

Deno.test('a webhook signature covers the exact body', async () => {
  assertEquals(await webhookSignatureValid(WEBHOOK_BODY, WEBHOOK_SIGNATURE, 'whsec_test'), true)
  assertEquals(await webhookSignatureValid(WEBHOOK_BODY + ' ', WEBHOOK_SIGNATURE, 'whsec_test'), false)
  assertEquals(await webhookSignatureValid(WEBHOOK_BODY, WEBHOOK_SIGNATURE, 'other_secret'), false)
  assertEquals(await webhookSignatureValid(WEBHOOK_BODY, null, 'whsec_test'), false)
})

Deno.test('constant-time comparison still compares correctly', () => {
  assertEquals(constantTimeEqual('abc', 'abc'), true)
  assertEquals(constantTimeEqual('abc', 'abd'), false)
  assertEquals(constantTimeEqual('abc', 'abcd'), false)
})

Deno.test('a captured payment is read from payment.captured and order.paid, without contact details', () => {
  const entity = {
    id: 'pay_1',
    order_id: 'order_1',
    amount: 1900,
    currency: 'INR',
    method: 'upi',
    email: 'guest@example.com',
    contact: '+919999999999',
  }
  for (const event of ['payment.captured', 'order.paid'] as const) {
    assertEquals(capturedPayment({ event, payload: { payment: { entity } } }), {
      event,
      paymentId: 'pay_1',
      orderId: 'order_1',
      amountPaise: 1900,
      currency: 'INR',
      method: 'upi',
    })
  }
})

Deno.test('other events and malformed bodies are ignored', () => {
  assertEquals(capturedPayment({ event: 'payment.failed', payload: {} }), null)
  assertEquals(capturedPayment({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } }), null)
  assertEquals(
    capturedPayment({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'p', order_id: 'o', amount: 19.5, currency: 'INR' } } },
    }),
    null,
  )
  assertEquals(capturedPayment('not an object'), null)
})
