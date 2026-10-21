// Sends one web push notification to every browser of one guest. Called only
// by the database (queue_push via pg_net), which proves itself with a shared
// secret kept in Vault; no user ever calls this directly.
//
// Secrets (Edge Function secrets, never in code): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto: address push services can use to
// reach us). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come from the platform.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { buildNotification, parseRequest, PushError, secretsMatch } from './logic.ts'

// A notification about a session or a chat is useless after a few minutes.
const TTL_SECONDS = 300

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new PushError(500, 'PUSH_NOT_CONFIGURED')
  return value
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const db = () =>
  createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

// The shared secret, read from the database once per function instance.
let sharedSecret: string | null = null

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' })
  try {
    const client = db()
    if (sharedSecret === null) {
      const { data, error } = await client.rpc('push_send_secret')
      if (error || typeof data !== 'string') throw new PushError(500, 'SECRET_UNAVAILABLE')
      sharedSecret = data
    }
    if (!secretsMatch(request.headers.get('x-push-secret'), sharedSecret)) {
      throw new PushError(401, 'INVALID_SECRET')
    }

    const push = parseRequest(await request.json().catch(() => null))
    const targets = await client.rpc('push_targets', { p_user_id: push.userId })
    if (targets.error) throw new PushError(500, 'TARGETS_UNAVAILABLE')

    webpush.setVapidDetails(
      requiredEnv('VAPID_SUBJECT'),
      requiredEnv('VAPID_PUBLIC_KEY'),
      requiredEnv('VAPID_PRIVATE_KEY'),
    )
    const payload = JSON.stringify(buildNotification(push))
    let sent = 0
    let gone = 0
    let failed = 0
    await Promise.all(
      (targets.data as { endpoint: string; p256dh: string; auth: string }[]).map(async (t) => {
        try {
          await webpush.sendNotification(
            { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
            payload,
            { TTL: TTL_SECONDS, urgency: 'high' },
          )
          sent++
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          // 404 / 410: the browser unsubscribed or was reset. Forget it.
          if (status === 404 || status === 410) {
            await client.rpc('push_subscription_gone', { p_endpoint: t.endpoint })
            gone++
          } else {
            failed++
            // Never log the endpoint (it identifies a browser) or the payload.
            console.error('push failed', { status: status ?? 'network' })
          }
        }
      }),
    )
    return json(200, { sent, gone, failed })
  } catch (error) {
    const pushError = error instanceof PushError ? error : new PushError(500, 'PUSH_FAILED')
    if (!(error instanceof PushError)) {
      console.error('push-send unexpected error', { message: error instanceof Error ? error.message : String(error) })
    }
    return json(pushError.httpCode, { error: pushError.code })
  }
})
