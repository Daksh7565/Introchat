// Supabase Auth "Send SMS" hook: delivers login OTPs through the SIM gateway
// phone (SMS Gateway for Android, cloud mode; decision 16). Twilio later
// replaces this hook entirely (disable the hook, enable Supabase's Twilio
// provider), so no provider switch lives here.
//
// Flow: verify signature → sms_hook_check (ban, +91, per-phone and daily
// limits; records the attempt) → send via gateway → sms_hook_finish.
// Secrets (Edge Function secrets, never in code): SEND_SMS_HOOK_SECRET,
// SMS_GATEWAY_USERNAME, SMS_GATEWAY_PASSWORD. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { errorBody, HookError, otpMessage, refusalError, toE164, verifyAndParse } from './logic.ts'

const GATEWAY_URL = 'https://api.sms-gate.app/3rdparty/v1/messages'
// The OTP itself expires in 5 minutes; a gateway that has not answered in 10 s
// is treated as failed so the guest can ask again instead of waiting.
const GATEWAY_TIMEOUT_MS = 10_000

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new HookError(500, 'SMS_HOOK_NOT_CONFIGURED')
  return value
}

function json(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

async function sendViaGateway(phone: string, text: string): Promise<string | null> {
  const username = Deno.env.get('SMS_GATEWAY_USERNAME')
  const password = Deno.env.get('SMS_GATEWAY_PASSWORD')
  if (!username || !password) return 'SMS_GATEWAY_NOT_CONFIGURED'
  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${btoa(`${username}:${password}`)}`,
      },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [toE164(phone)] }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    })
    // 2xx = the gateway accepted the message for the SIM phone to send.
    return response.ok ? null : `GATEWAY_HTTP_${response.status}`
  } catch (error) {
    return error instanceof DOMException && error.name === 'TimeoutError' ? 'GATEWAY_TIMEOUT' : 'GATEWAY_UNREACHABLE'
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, errorBody(new HookError(405, 'METHOD_NOT_ALLOWED')))
  try {
    const payload = verifyAndParse(await request.text(), request.headers, requiredEnv('SEND_SMS_HOOK_SECRET'))

    const db = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const check = await db.rpc('sms_hook_check', { p_phone: payload.phone }).single()
    if (check.error) throw new HookError(500, 'SMS_CHECK_FAILED')
    const { log_id: logId, allowed, refusal } = check.data as { log_id: number; allowed: boolean; refusal: string | null }
    if (!allowed) throw refusalError(refusal ?? 'REFUSED')

    const failure = await sendViaGateway(payload.phone, otpMessage(payload.otp))
    const finish = await db.rpc('sms_hook_finish', { p_log_id: logId, p_sent: failure === null, p_error: failure })
    if (finish.error) {
      // The SMS outcome is already decided; a failed bookkeeping write must not
      // hide it, but it must be visible in the function logs.
      console.error('sms_hook_finish failed', { logId, message: finish.error.message })
    }
    // A gateway that is offline or out of credit is an expected outage the guest
    // should be told about ("couldn't send the code, try again shortly").
    if (failure !== null) throw new HookError(503, 'SMS_SEND_FAILED')
    return json(200, '{}')
  } catch (error) {
    const hookError = error instanceof HookError ? error : new HookError(500, 'SMS_HOOK_FAILED')
    if (!(error instanceof HookError)) {
      console.error('sms-hook unexpected error', { message: error instanceof Error ? error.message : String(error) })
    } else if (error.httpCode >= 500) {
      // Never log the phone number or the code.
      console.error('sms-hook error', { code: error.code })
    }
    // How Supabase Auth reads hook answers (verified on dev, M2 phase 3): it
    // takes the error from the BODY of an HTTP 200 answer ({"error": {http_code,
    // message}}) and passes that status and message to the phone. A non-200
    // answer is never passed on: 400 becomes "Invalid payload sent to hook",
    // 401 "Hook requires authorization token", anything else "Unexpected status
    // code". So every refusal and failure is a 200 carrying an error, except a
    // bad signature, which did not come from Auth and gets a plain 401.
    const status = hookError.code === 'INVALID_SIGNATURE' ? 401 : 200
    return json(status, errorBody(hookError))
  }
})
