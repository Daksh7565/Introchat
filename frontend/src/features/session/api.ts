import type { Database } from '../../lib/database.types'
import { deviceId } from '../../lib/deviceId'
import { AppError } from '../../lib/errors'
import type { Reading } from '../../lib/location'
import { unwrap } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'
import type { SessionEndReason } from './types'

type SessionStateRow = Database['public']['CompositeTypes']['session_state']

export type SessionStatus = 'active' | 'final_prompt' | 'ended'

/** The server's session_state, with times as Dates and the phone's clock error measured. */
export interface SessionState {
  sessionId: string
  status: SessionStatus
  endReason: SessionEndReason | null
  venueId: string
  venueName: string
  tableLabel: string | null
  expiresAt: Date
  warningAt: Date
  /** Set by the server once the final prompt has started. */
  finalDeadlineAt: Date | null
  finalPromptSeconds: number
  awaySince: Date | null
  awayGraceSeconds: number
  paymentsEnabled: boolean
  continueFreeMinutes: number
  heartbeatSeconds: number
  locationSeconds: number
  /**
   * Server clock minus phone clock, in ms. Every countdown adds this to
   * Date.now(), so a phone whose clock is minutes off still counts down to
   * the server's real deadline (ARCHITECTURE §4.12).
   */
  clockOffsetMs: number
}

export const LIVE_SESSION_KEY = ['live-session'] as const

const END_REASONS: readonly SessionEndReason[] = [
  'expired',
  'left_venue',
  'user_logout',
  'kicked',
  'banned',
  'venue_closed',
]

function required<T>(value: T | null, field: string): T {
  if (value === null) throw new AppError('UNEXPECTED', { field })
  return value
}

/**
 * Converts the server row. sentAtMs / receivedAtMs are the phone's clock
 * around the call: the server's answer was made roughly halfway between them,
 * which is the best estimate of the clock offset one round trip gives.
 */
export function toSessionState(
  row: SessionStateRow,
  sentAtMs: number,
  receivedAtMs: number,
): SessionState {
  const status = required(row.status, 'status')
  if (status !== 'active' && status !== 'final_prompt' && status !== 'ended') {
    throw new AppError('UNEXPECTED', { field: 'status', status })
  }
  const reason = row.end_reason
  const serverNowMs = new Date(required(row.server_now, 'server_now')).getTime()
  return {
    sessionId: required(row.session_id, 'session_id'),
    status,
    endReason: END_REASONS.find((r) => r === reason) ?? null,
    venueId: required(row.venue_id, 'venue_id'),
    venueName: required(row.venue_name, 'venue_name'),
    tableLabel: row.table_label,
    expiresAt: new Date(required(row.expires_at, 'expires_at')),
    warningAt: new Date(required(row.warning_at, 'warning_at')),
    finalDeadlineAt: row.final_deadline_at ? new Date(row.final_deadline_at) : null,
    finalPromptSeconds: required(row.final_prompt_seconds, 'final_prompt_seconds'),
    awaySince: row.away_since ? new Date(row.away_since) : null,
    awayGraceSeconds: required(row.away_grace_seconds, 'away_grace_seconds'),
    paymentsEnabled: required(row.payments_enabled, 'payments_enabled'),
    continueFreeMinutes: required(row.continue_free_minutes, 'continue_free_minutes'),
    heartbeatSeconds: required(row.heartbeat_seconds, 'heartbeat_seconds'),
    locationSeconds: required(row.location_seconds, 'location_seconds'),
    clockOffsetMs: Math.round(serverNowMs - (sentAtMs + receivedAtMs) / 2),
  }
}

/** The live session, or one that ended in the last 30 minutes; null = nothing to show. */
export async function getMySession(): Promise<SessionState | null> {
  const sentAt = Date.now()
  const rows = unwrap(await supabase.rpc('my_session'))
  const receivedAt = Date.now()
  const row = rows[0]
  return row ? toSessionState(row, sentAt, receivedAt) : null
}

export async function startSession(
  slug: string,
  qrToken: string,
  reading: Reading,
): Promise<SessionState> {
  const sentAt = Date.now()
  const row = unwrap(
    await supabase.rpc('start_session', {
      p_slug: slug,
      p_qr_token: qrToken,
      p_latitude: reading.latitude,
      p_longitude: reading.longitude,
      p_accuracy_m: reading.accuracyM,
      p_age_seconds: reading.ageSeconds,
      p_device_id: deviceId(),
    }),
  )
  return toSessionState(row, sentAt, Date.now())
}

export type PermissionState = 'granted' | 'denied' | 'prompt'

/** reading = null: nothing new to report (the server keeps its last location). */
export async function sendHeartbeat(
  reading: Reading | null,
  permission: PermissionState,
): Promise<SessionState> {
  const sentAt = Date.now()
  const row = unwrap(
    await supabase.rpc('heartbeat', {
      p_permission: permission,
      ...(reading && {
        p_latitude: reading.latitude,
        p_longitude: reading.longitude,
        p_accuracy_m: reading.accuracyM,
        p_age_seconds: reading.ageSeconds,
      }),
    }),
  )
  return toSessionState(row, sentAt, Date.now())
}

export async function continueFree(): Promise<SessionState> {
  const sentAt = Date.now()
  const row = unwrap(await supabase.rpc('continue_free'))
  return toSessionState(row, sentAt, Date.now())
}

/** Ends the session now ("Leave" / "Log out"). Safe to repeat. */
export async function endMySession(): Promise<SessionState> {
  const sentAt = Date.now()
  const row = unwrap(await supabase.rpc('end_my_session'))
  return toSessionState(row, sentAt, Date.now())
}
