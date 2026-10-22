import type { Json } from '../../../lib/database.types'
import { AppError } from '../../../lib/errors'
import { unwrap } from '../../../lib/rpc'
import { supabase } from '../../../lib/supabase'

// Running venues from the Console (migration console_ops): live guests,
// kicks, close for today, location flags, stats, audit log, SMS usage,
// admins and account deletion. Every function re-checks admin + MFA itself.
//
// Nullability: `supabase gen types` marks every returned column non-null;
// table_label, away_since, handle/payment of a closed visit, start distance /
// accuracy, avg_visit_minutes, actor, target_*, venue_name, reason,
// last_sign_in_at, processed_at and note are really nullable, as typed below.

export const opsKeys = {
  live: (venueId: string) => ['admin', 'live', venueId] as const,
  flags: ['admin', 'spoof-flags'] as const,
  stats: (venueId: string | null, from: string, to: string) =>
    ['admin', 'stats', venueId, from, to] as const,
  audit: (prefix: string) => ['admin', 'audit', prefix] as const,
  sms: ['admin', 'sms'] as const,
  admins: ['admin', 'admins'] as const,
  deletions: (status: DeletionStatus | null) => ['admin', 'deletions', status] as const,
  allDeletions: ['admin', 'deletions'] as const,
}

function date(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

const SESSION_KINDS = ['free', 'paid_scan', 'subscription'] as const
export type SessionKind = (typeof SESSION_KINDS)[number]

function sessionKind(value: string): SessionKind {
  const kind = SESSION_KINDS.find((k) => k === value)
  if (!kind) throw new AppError('UNEXPECTED', { field: 'kind', value })
  return kind
}

export interface LiveGuest {
  sessionId: string
  userId: string
  handle: string
  tableLabel: string | null
  kind: SessionKind
  status: string
  startedAt: Date
  expiresAt: Date
  isOffline: boolean
  awaySince: Date | null
  spoofFlags: number
  scanCredits: number
}

export async function liveGuests(venueId: string): Promise<LiveGuest[]> {
  const rows = unwrap(await supabase.rpc('admin_live_guests', { p_venue_id: venueId }))
  return rows.map((row) => ({
    sessionId: row.session_id,
    userId: row.user_id,
    handle: row.handle,
    tableLabel: row.table_label,
    kind: sessionKind(row.kind),
    status: row.status,
    startedAt: new Date(row.started_at),
    expiresAt: new Date(row.expires_at),
    isOffline: row.is_offline,
    awaySince: date(row.away_since),
    spoofFlags: row.spoof_flags,
    scanCredits: row.scan_credits,
  }))
}

export async function kick(sessionId: string, note: string): Promise<void> {
  unwrap(await supabase.rpc('admin_kick', { p_session_id: sessionId, p_note: note }))
}

export interface ClosedVisit {
  sessionId: string
  handle: string | null
  kind: SessionKind
  paymentId: string | null
  amountPaise: number | null
}

/** Closes the venue until local midnight; returns the paid visits it cut short. */
export async function closeVenueToday(venueId: string, note: string): Promise<ClosedVisit[]> {
  const rows = unwrap(
    await supabase.rpc('admin_close_venue_today', { p_venue_id: venueId, p_note: note }),
  )
  return rows.map((row) => ({
    sessionId: row.session_id,
    handle: row.handle,
    kind: sessionKind(row.kind),
    paymentId: row.payment_id,
    amountPaise: row.amount_paise,
  }))
}

export async function reopenVenue(venueId: string, note: string): Promise<void> {
  unwrap(await supabase.rpc('admin_reopen_venue', { p_venue_id: venueId, p_note: note }))
}

export interface FlaggedVisit {
  sessionId: string
  userId: string
  handle: string
  venueName: string
  startedAt: Date
  live: boolean
  flags: string[]
  startDistanceM: number | null
  startAccuracyM: number | null
}

function flagTypes(flags: Json): string[] {
  if (!Array.isArray(flags)) return []
  return flags.flatMap((flag) =>
    typeof flag === 'object' &&
    flag !== null &&
    !Array.isArray(flag) &&
    typeof flag.type === 'string'
      ? [flag.type]
      : [],
  )
}

export async function spoofFlags(): Promise<FlaggedVisit[]> {
  const rows = unwrap(await supabase.rpc('admin_list_spoof_flags', { p_days: 7 }))
  return rows.map((row) => ({
    sessionId: row.session_id,
    userId: row.user_id,
    handle: row.handle,
    venueName: row.venue_name,
    startedAt: new Date(row.started_at),
    live: row.live,
    flags: flagTypes(row.flags),
    startDistanceM: row.start_distance_m,
    startAccuracyM: row.start_accuracy_m,
  }))
}

export interface Stats {
  visits: number
  uniqueGuests: number
  avgVisitMinutes: number | null
  requestsSent: number
  requestsAccepted: number
  reports: number
  payments: number
  revenuePaise: number
  refundedPaise: number
  guestsMale: number
  guestsFemale: number
  guestsOther: number
  guestsUndisclosed: number
}

/** from / to: local dates YYYY-MM-DD, inclusive. venueId null = all venues. */
export async function stats(venueId: string | null, from: string, to: string): Promise<Stats> {
  const rows = unwrap(
    await supabase.rpc('admin_stats', {
      p_venue_id: venueId ?? undefined,
      p_from: from,
      p_to: to,
    }),
  )
  const row = rows[0]
  if (!row) throw new AppError('UNEXPECTED', { field: 'stats' })
  return {
    visits: row.visits,
    uniqueGuests: row.unique_guests,
    avgVisitMinutes: row.avg_visit_minutes,
    requestsSent: row.requests_sent,
    requestsAccepted: row.requests_accepted,
    reports: row.reports,
    payments: row.payments,
    revenuePaise: row.revenue_paise,
    refundedPaise: row.refunded_paise,
    guestsMale: row.guests_male,
    guestsFemale: row.guests_female,
    guestsOther: row.guests_other,
    guestsUndisclosed: row.guests_undisclosed,
  }
}

export interface AuditEntry {
  id: number
  createdAt: Date
  actorType: string
  actor: string | null
  action: string
  targetType: string | null
  venueName: string | null
  meta: Json
}

export async function auditLog(prefix: string, before: Date | null): Promise<AuditEntry[]> {
  const rows = unwrap(
    await supabase.rpc('admin_list_audit', {
      ...(prefix === '' ? {} : { p_action_prefix: prefix }),
      ...(before === null ? {} : { p_before: before.toISOString() }),
      p_limit: 100,
    }),
  )
  return rows.map((row) => ({
    id: row.audit_id,
    createdAt: new Date(row.created_at),
    actorType: row.actor_type,
    actor: row.actor,
    action: row.action,
    targetType: row.target_type,
    venueName: row.venue_name,
    meta: row.meta,
  }))
}

export interface SmsDay {
  day: string
  sent: number
  failed: number
  refused: number
  pending: number
  refusals: Record<string, number>
}

/** Last 7 India days, newest first, with refusals by reason. */
export async function smsUsage(): Promise<SmsDay[]> {
  const rows = unwrap(await supabase.rpc('admin_sms_usage', { p_days: 7 }))
  const days = new Map<string, SmsDay>()
  for (const row of rows) {
    const day = days.get(row.day) ?? {
      day: row.day,
      sent: 0,
      failed: 0,
      refused: 0,
      pending: 0,
      refusals: {},
    }
    if (row.status === 'sent') day.sent += row.attempts
    else if (row.status === 'failed') day.failed += row.attempts
    else if (row.status === 'refused') {
      day.refused += row.attempts
      const reason = row.reason ?? 'UNKNOWN'
      day.refusals[reason] = (day.refusals[reason] ?? 0) + row.attempts
    } else day.pending += row.attempts
    days.set(row.day, day)
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day))
}

export interface AdminRow {
  userId: string
  email: string
  isActive: boolean
  hasMfa: boolean
  lastSignInAt: Date | null
}

export async function listAdmins(): Promise<AdminRow[]> {
  const rows = unwrap(await supabase.rpc('admin_list_admins'))
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    isActive: row.is_active,
    hasMfa: row.has_mfa,
    lastSignInAt: date(row.last_sign_in_at),
  }))
}

export async function addAdmin(email: string): Promise<void> {
  unwrap(await supabase.rpc('admin_add_admin', { p_email: email }))
}

export async function setAdminActive(userId: string, active: boolean): Promise<void> {
  unwrap(await supabase.rpc('admin_set_admin_active', { p_user_id: userId, p_active: active }))
}

export const DELETION_STATUSES = ['pending', 'completed', 'cancelled'] as const
export type DeletionStatus = (typeof DELETION_STATUSES)[number]

export interface DeletionRequest {
  id: string
  handle: string
  status: DeletionStatus
  requestedAt: Date
  processedAt: Date | null
  note: string | null
  openReports: number
  activeBan: boolean
}

export async function deletionRequests(status: DeletionStatus | null): Promise<DeletionRequest[]> {
  const rows = unwrap(
    await supabase.rpc('admin_list_deletion_requests', { p_status: status ?? undefined }),
  )
  return rows.map((row) => {
    const rowStatus = DELETION_STATUSES.find((s) => s === row.status)
    if (!rowStatus) throw new AppError('UNEXPECTED', { field: 'status', value: row.status })
    return {
      id: row.request_id,
      handle: row.handle,
      status: rowStatus,
      requestedAt: new Date(row.requested_at),
      processedAt: date(row.processed_at),
      note: row.note,
      openReports: row.open_reports,
      activeBan: row.active_ban,
    }
  })
}

export async function processDeletion(requestId: string, note: string): Promise<void> {
  unwrap(await supabase.rpc('admin_process_deletion', { p_request_id: requestId, p_note: note }))
}
