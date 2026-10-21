// Labels for bulk table creation: prefix + a numbered range, zero-padded so
// they sort correctly ("T01" … "T20", not "T1", "T10", "T2").

export interface LabelRange {
  prefix: string
  from: number
  to: number
  /** Digits to pad the number to; 0 = no padding. */
  pad: number
}

// Same limit as admin_create_tables (0003).
export const MAX_TABLES_PER_BATCH = 200

export function rangeLabels({ prefix, from, to, pad }: LabelRange): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return []
  if (to - from + 1 > MAX_TABLES_PER_BATCH) return []
  const labels: string[] = []
  for (let n = from; n <= to; n++) {
    labels.push(`${prefix}${String(n).padStart(pad, '0')}`.trim())
  }
  return labels
}
