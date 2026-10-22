import type { Json } from '../../../lib/database.types'
import { AppError } from '../../../lib/errors'
import { unwrap } from '../../../lib/rpc'
import { supabase } from '../../../lib/supabase'

// The Console's reports, bans, tags and blocked words, through the admin_*
// functions of migration safety. Every function re-checks admin + MFA itself.
//
// Nullability: `supabase gen types` marks every returned column non-null;
// note, action, reporter_handle (account deleted), reviewed_at, review_note,
// venue_name and guest_handle of a ban, expires_at (permanent), lifted_at and
// created_by are really nullable, and the types below say so.

export const safetyKeys = {
  reports: (status: ReportStatus | null) => ['admin', 'reports', status] as const,
  allReports: ['admin', 'reports'] as const,
  evidence: (id: string) => ['admin', 'report-evidence', id] as const,
  bans: (activeOnly: boolean) => ['admin', 'bans', activeOnly] as const,
  allBans: ['admin', 'bans'] as const,
  tags: (query: string) => ['admin', 'tags', query] as const,
  allTags: ['admin', 'tags'] as const,
  terms: ['admin', 'blocked-terms'] as const,
}

export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export type ReportReason = 'harassment' | 'spam' | 'inappropriate' | 'other'

function oneOf<T extends string>(values: readonly T[], value: string, field: string): T {
  const found = values.find((v) => v === value)
  if (!found) throw new AppError('UNEXPECTED', { field, value })
  return found
}

function date(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

export interface ReportRow {
  id: string
  createdAt: Date
  status: ReportStatus
  action: 'kick' | 'ban' | null
  reason: ReportReason
  note: string | null
  venueName: string
  /** null: the reporter deleted their account. */
  reporterHandle: string | null
  reportedHandle: string
  reportedLive: boolean
  hasEvidence: boolean
  reviewedAt: Date | null
  reviewNote: string | null
}

export async function listReports(status: ReportStatus | null): Promise<ReportRow[]> {
  const rows = unwrap(await supabase.rpc('admin_list_reports', { p_status: status ?? undefined }))
  return rows.map((row) => ({
    id: row.report_id,
    createdAt: new Date(row.created_at),
    status: oneOf(REPORT_STATUSES, row.status, 'status'),
    action: row.action === null ? null : oneOf(['kick', 'ban'] as const, row.action, 'action'),
    reason: oneOf(['harassment', 'spam', 'inappropriate', 'other'] as const, row.reason, 'reason'),
    note: row.note,
    venueName: row.venue_name,
    reporterHandle: row.reporter_handle,
    reportedHandle: row.reported_handle,
    reportedLive: row.reported_live,
    hasEvidence: row.has_evidence,
    reviewedAt: date(row.reviewed_at),
    reviewNote: row.review_note,
  }))
}

export interface EvidenceMessage {
  from: 'reporter' | 'reported'
  body: string
  at: Date
}

export interface Evidence {
  handle: string
  tags: string[]
  /** null: the two never chatted (the report came from the People list). */
  messages: EvidenceMessage[] | null
}

function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The evidence a report saved; null once erased after its retention. */
export async function reportEvidence(reportId: string): Promise<Evidence | null> {
  const value = unwrap(await supabase.rpc('admin_report_evidence', { p_report_id: reportId }))
  if (value === null) return null
  if (!isRecord(value) || typeof value.handle !== 'string' || !Array.isArray(value.tags)) {
    throw new AppError('UNEXPECTED', { field: 'evidence' })
  }
  const messages = value.messages
  return {
    handle: value.handle,
    tags: value.tags.filter((tag): tag is string => typeof tag === 'string'),
    messages: Array.isArray(messages)
      ? messages.flatMap((m): EvidenceMessage[] =>
          isRecord(m) &&
          (m.from === 'reporter' || m.from === 'reported') &&
          typeof m.body === 'string' &&
          typeof m.at === 'string'
            ? [{ from: m.from, body: m.body, at: new Date(m.at) }]
            : [],
        )
      : null,
  }
}

export type Decision = 'dismiss' | 'kick' | 'ban'

/** banDays: null = permanent (ban only). */
export async function resolveReport(
  reportId: string,
  decision: Decision,
  note: string,
  banDays: number | null,
): Promise<void> {
  unwrap(
    await supabase.rpc('admin_resolve_report', {
      p_report_id: reportId,
      p_decision: decision,
      p_note: note,
      ...(banDays === null ? {} : { p_ban_days: banDays }),
    }),
  )
}

export interface BanRow {
  id: string
  scope: 'platform' | 'venue'
  venueName: string | null
  guestHandle: string | null
  reason: string
  createdAt: Date
  /** null = permanent. */
  expiresAt: Date | null
  liftedAt: Date | null
  createdBy: string | null
}

export async function listBans(activeOnly: boolean): Promise<BanRow[]> {
  const rows = unwrap(await supabase.rpc('admin_list_bans', { p_active_only: activeOnly }))
  return rows.map((row) => ({
    id: row.ban_id,
    scope: oneOf(['platform', 'venue'] as const, row.scope, 'scope'),
    venueName: row.venue_name,
    guestHandle: row.guest_handle,
    reason: row.reason,
    createdAt: new Date(row.created_at),
    expiresAt: date(row.expires_at),
    liftedAt: date(row.lifted_at),
    createdBy: row.created_by,
  }))
}

export async function liftBan(banId: string, note: string): Promise<void> {
  unwrap(await supabase.rpc('admin_lift_ban', { p_ban_id: banId, p_note: note }))
}

/** days: null = permanent. */
export async function banGuest(userId: string, days: number | null, note: string): Promise<void> {
  unwrap(
    await supabase.rpc('admin_ban_guest', {
      p_user_id: userId,
      p_note: note,
      ...(days === null ? {} : { p_days: days }),
    }),
  )
}

export interface TagRow {
  name: string
  users: number
  isBlocked: boolean
}

export async function listTags(query: string): Promise<TagRow[]> {
  const rows = unwrap(await supabase.rpc('admin_list_tags', { p_query: query }))
  return rows.map((row) => ({ name: row.name, users: row.users, isBlocked: row.is_blocked }))
}

export async function setTagBlocked(name: string, blocked: boolean): Promise<void> {
  unwrap(await supabase.rpc('admin_set_tag_blocked', { p_name: name, p_blocked: blocked }))
}

export async function listBlockedTerms(): Promise<string[]> {
  const rows = unwrap(await supabase.rpc('admin_list_blocked_terms'))
  return rows.map((row) => row.term)
}

/** Returns the term as stored (normalised). */
export async function addBlockedTerm(term: string): Promise<string> {
  return unwrap(await supabase.rpc('admin_add_blocked_term', { p_term: term }))
}

export async function removeBlockedTerm(term: string): Promise<void> {
  unwrap(await supabase.rpc('admin_remove_blocked_term', { p_term: term }))
}
