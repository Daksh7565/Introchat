import type { Json } from '../../../lib/database.types'
import { AppError } from '../../../lib/errors'
import { unwrap } from '../../../lib/rpc'
import { supabase } from '../../../lib/supabase'

// The Console's view of venues and tables, read through the admin_* SQL
// functions (migration 0003). Every function re-checks admin + MFA itself.
//
// Nullability: `supabase gen types` marks every column a SQL function returns as
// non-null, which is wrong for address, city, closed_until and override_value.
// The types below state the real nullability, so screens must handle the
// missing case instead of crashing on it at runtime.

export interface VenueSummary {
  id: string
  slug: string
  name: string
  type: VenueType
  city: string | null
  isActive: boolean
  closedUntil: string | null
  tableCount: number
}

export interface VenueDetail {
  id: string
  slug: string
  name: string
  type: VenueType
  address: string | null
  city: string | null
  latitude: number
  longitude: number
  timezone: string
  isActive: boolean
  closedUntil: string | null
}

export interface VenueSettingRow {
  key: string
  valueType: 'boolean' | 'integer' | 'text'
  globalValue: Json
  overrideValue: Json | null
  minValue: number | null
  maxValue: number | null
  description: string
}

export interface TableRow {
  id: string
  label: string
  qrToken: string
  isActive: boolean
}

export const VENUE_TYPES = ['restaurant', 'cafe'] as const
export type VenueType = (typeof VENUE_TYPES)[number]

function venueType(value: string): VenueType {
  const found = VENUE_TYPES.find((type) => type === value)
  // The database CHECK allows only these; anything else is a schema/app drift.
  if (!found) throw new AppError('UNEXPECTED', { venueType: value })
  return found
}

function settingType(value: string): VenueSettingRow['valueType'] {
  if (value === 'boolean' || value === 'integer' || value === 'text') return value
  throw new AppError('UNEXPECTED', { valueType: value })
}

export const adminKeys = {
  venues: ['admin', 'venues'] as const,
  venue: (id: string) => ['admin', 'venue', id] as const,
  settings: (id: string) => ['admin', 'venue', id, 'settings'] as const,
  tables: (id: string) => ['admin', 'venue', id, 'tables'] as const,
}

export async function listVenues(): Promise<VenueSummary[]> {
  const rows = unwrap(await supabase.rpc('admin_list_venues'))
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: venueType(row.type),
    city: row.city ?? null,
    isActive: row.is_active,
    closedUntil: row.closed_until ?? null,
    tableCount: row.table_count,
  }))
}

export async function getVenue(venueId: string): Promise<VenueDetail> {
  const rows = unwrap(await supabase.rpc('admin_get_venue', { p_venue_id: venueId }))
  const row = rows[0]
  if (!row) throw new AppError('VENUE_NOT_FOUND')
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: venueType(row.type),
    address: row.address ?? null,
    city: row.city ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
    isActive: row.is_active,
    closedUntil: row.closed_until ?? null,
  }
}

export interface VenueInput {
  slug: string
  name: string
  type: VenueType
  address: string
  city: string
}

export async function createVenue(
  input: VenueInput,
  pin: { latitude: number; longitude: number },
): Promise<string> {
  return unwrap(
    await supabase.rpc('admin_create_venue', {
      p_slug: input.slug,
      p_name: input.name,
      p_type: input.type,
      p_address: input.address,
      p_city: input.city,
      p_latitude: pin.latitude,
      p_longitude: pin.longitude,
    }),
  )
}

export async function updateVenue(venue: VenueDetail, input: VenueInput): Promise<void> {
  unwrap(
    await supabase.rpc('admin_update_venue', {
      p_venue_id: venue.id,
      p_slug: input.slug,
      p_name: input.name,
      p_type: input.type,
      p_address: input.address,
      p_city: input.city,
      p_timezone: venue.timezone,
    }),
  )
}

export async function setVenuePin(
  venueId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  unwrap(
    await supabase.rpc('admin_set_venue_pin', {
      p_venue_id: venueId,
      p_latitude: latitude,
      p_longitude: longitude,
    }),
  )
}

export async function setVenueActive(venueId: string, active: boolean): Promise<void> {
  unwrap(await supabase.rpc('admin_set_venue_active', { p_venue_id: venueId, p_active: active }))
}

export async function listVenueSettings(venueId: string): Promise<VenueSettingRow[]> {
  const rows = unwrap(await supabase.rpc('admin_list_venue_settings', { p_venue_id: venueId }))
  return rows.map((row) => ({
    key: row.key,
    valueType: settingType(row.value_type),
    globalValue: row.global_value,
    overrideValue: row.override_value ?? null,
    minValue: row.min_value ?? null,
    maxValue: row.max_value ?? null,
    description: row.description,
  }))
}

export async function setVenueSetting(venueId: string, key: string, value: Json): Promise<void> {
  unwrap(
    await supabase.rpc('admin_set_venue_setting', {
      p_venue_id: venueId,
      p_key: key,
      p_value: value,
    }),
  )
}

export async function clearVenueSetting(venueId: string, key: string): Promise<void> {
  unwrap(await supabase.rpc('admin_clear_venue_setting', { p_venue_id: venueId, p_key: key }))
}

export async function listTables(venueId: string): Promise<TableRow[]> {
  const rows = unwrap(await supabase.rpc('admin_list_tables', { p_venue_id: venueId }))
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    qrToken: row.qr_token,
    isActive: row.is_active,
  }))
}

export async function createTables(venueId: string, labels: string[]): Promise<number> {
  return unwrap(
    await supabase.rpc('admin_create_tables', { p_venue_id: venueId, p_labels: labels }),
  )
}

export async function updateTable(
  tableId: string,
  label: string,
  isActive: boolean,
): Promise<void> {
  unwrap(
    await supabase.rpc('admin_update_table', {
      p_table_id: tableId,
      p_label: label,
      p_is_active: isActive,
    }),
  )
}

export async function regenerateQrToken(tableId: string): Promise<string> {
  return unwrap(await supabase.rpc('admin_regenerate_qr_token', { p_table_id: tableId }))
}

export interface LocationTestResult {
  state: 'inside' | 'outside' | 'unknown'
  distanceM: number
  radiusM: number
  maxAccuracyM: number
  bufferM: number
}

export async function testLocation(
  venueId: string,
  reading: { latitude: number; longitude: number; accuracyM: number; ageSeconds: number },
): Promise<LocationTestResult> {
  const rows = unwrap(
    await supabase.rpc('admin_test_location', {
      p_venue_id: venueId,
      p_latitude: reading.latitude,
      p_longitude: reading.longitude,
      p_accuracy_m: reading.accuracyM,
      p_age_seconds: reading.ageSeconds,
    }),
  )
  const row = rows[0]
  if (!row) throw new AppError('UNEXPECTED', { reason: 'admin_test_location returned no row' })
  const state = row.state
  if (state !== 'inside' && state !== 'outside' && state !== 'unknown') {
    throw new AppError('UNEXPECTED', { state })
  }
  return {
    state,
    distanceM: row.distance_m,
    radiusM: row.radius_m,
    maxAccuracyM: row.max_accuracy_m,
    bufferM: row.buffer_m,
  }
}

/** The radius this venue currently uses: its override, or the global default. */
export function effectiveIntegerSetting(rows: VenueSettingRow[], key: string): number | null {
  const row = rows.find((r) => r.key === key)
  const value = row?.overrideValue ?? row?.globalValue
  return typeof value === 'number' ? value : null
}

// VALIDATION_FAILED carries the CHECK constraint that failed (0003
// raise_admin_write_error); this maps it to the form field to highlight.
const CONSTRAINT_FIELD: Record<string, string> = {
  ck_venues_slug: 'slug',
  ck_venues_name: 'name',
  ck_venues_type: 'type',
  ck_venues_address: 'address',
  ck_venues_city: 'city',
  ck_venues_in_india: 'pin',
  ck_tables_label: 'label',
}

export function invalidField(error: unknown): string | null {
  if (!(error instanceof AppError)) return null
  if (error.code === 'SLUG_TAKEN') return 'slug'
  if (error.code === 'TABLE_LABEL_TAKEN') return 'label'
  if (error.code !== 'VALIDATION_FAILED') return null
  const details = error.details
  if (typeof details === 'object' && details !== null && 'constraint' in details) {
    const constraint = details.constraint
    return typeof constraint === 'string' ? (CONSTRAINT_FIELD[constraint] ?? null) : null
  }
  return null
}

/** "Café Mocha, CG Road" → "cafe-mocha-cg-road". Empty for names with no Latin letters. */
export function slugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}
