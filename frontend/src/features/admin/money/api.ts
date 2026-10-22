import type { Json } from '../../../lib/database.types'
import { AppError } from '../../../lib/errors'
import { unwrap } from '../../../lib/rpc'
import { supabase } from '../../../lib/supabase'

// The Console's payments, guests' scans and global settings, through the
// admin_* functions of migration payments_credits. Every function re-checks
// admin + MFA itself.
//
// Nullability: `supabase gen types` marks every returned column non-null;
// paid_at, refunded_at, guest_handle (account deleted), provider_payment_id,
// refund_note, last_visit_at, min/max/allowed values are really nullable,
// and the types below say so.

export const moneyKeys = {
  payments: (status: PaymentStatus | null) => ['admin', 'payments', status] as const,
  allPayments: ['admin', 'payments'] as const,
  guest: (handle: string) => ['admin', 'guest', handle.toLowerCase()] as const,
  settings: ['admin', 'app-settings'] as const,
}

export const PAYMENT_STATUSES = ['created', 'paid', 'failed', 'refunded'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type PaymentPurpose = 'scan_fee' | 'continue' | 'subscription'

export interface PaymentRow {
  id: string
  createdAt: Date
  paidAt: Date | null
  refundedAt: Date | null
  status: PaymentStatus
  purpose: PaymentPurpose
  amountPaise: number
  venueName: string
  /** null: the guest deleted their account. */
  guestHandle: string | null
  providerPaymentId: string | null
  refundNote: string | null
}

function oneOf<T extends string>(values: readonly T[], value: string, field: string): T {
  const found = values.find((v) => v === value)
  if (!found) throw new AppError('UNEXPECTED', { field, value })
  return found
}

function date(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

export async function listPayments(status: PaymentStatus | null): Promise<PaymentRow[]> {
  const rows = unwrap(
    await supabase.rpc('admin_list_payments', status === null ? {} : { p_status: status }),
  )
  return rows.map((row) => ({
    id: row.payment_id,
    createdAt: new Date(row.created_at),
    paidAt: date(row.paid_at),
    refundedAt: date(row.refunded_at),
    status: oneOf(PAYMENT_STATUSES, row.status, 'status'),
    purpose: oneOf(['scan_fee', 'continue', 'subscription'] as const, row.purpose, 'purpose'),
    amountPaise: row.amount_paise,
    venueName: row.venue_name,
    guestHandle: row.guest_handle,
    providerPaymentId: row.provider_payment_id,
    refundNote: row.refund_note,
  }))
}

/** Records a refund already made in the Razorpay dashboard. */
export async function markRefunded(paymentId: string, note: string): Promise<void> {
  unwrap(
    await supabase.rpc('admin_mark_payment_refunded', { p_payment_id: paymentId, p_note: note }),
  )
}

export interface GuestRow {
  userId: string
  handle: string
  scanCredits: number
  joinedAt: Date
  lastVisitAt: Date | null
}

/** A guest by handle; null if there is none. */
export async function findGuest(handle: string): Promise<GuestRow | null> {
  const rows = unwrap(await supabase.rpc('admin_find_guest', { p_handle: handle }))
  const row = rows[0]
  return row
    ? {
        userId: row.user_id,
        handle: row.handle,
        scanCredits: row.scan_credits,
        joinedAt: new Date(row.joined_at),
        lastVisitAt: date(row.last_visit_at),
      }
    : null
}

/** Returns the guest's new balance. */
export async function grantScans(userId: string, scans: number, note: string): Promise<number> {
  return unwrap(
    await supabase.rpc('admin_grant_scans', { p_user_id: userId, p_scans: scans, p_note: note }),
  )
}

export interface AppSettingRow {
  key: string
  valueType: 'boolean' | 'integer' | 'text'
  value: Json
  minValue: number | null
  maxValue: number | null
  allowedValues: string[] | null
  venueOverridable: boolean
  /** false: changes only with a code release (e.g. CONSENT_VERSION). */
  adminEditable: boolean
  description: string
  updatedAt: Date
}

export async function listAppSettings(): Promise<AppSettingRow[]> {
  const rows = unwrap(await supabase.rpc('admin_list_app_settings'))
  return rows.map((row) => ({
    key: row.key,
    valueType: oneOf(['boolean', 'integer', 'text'] as const, row.value_type, 'value_type'),
    value: row.value,
    minValue: row.min_value,
    maxValue: row.max_value,
    allowedValues: row.allowed_values,
    venueOverridable: row.venue_overridable,
    adminEditable: row.admin_editable,
    description: row.description,
    updatedAt: new Date(row.updated_at),
  }))
}

export async function setAppSetting(key: string, value: Json): Promise<void> {
  unwrap(await supabase.rpc('admin_set_app_setting', { p_key: key, p_value: value }))
}
