/**
 * An Indian mobile number as typed, in any common form ("98765 43210",
 * "+91 98765-43210", "09876543210"), reduced to its 10 digits; null if it is
 * not one. Same rule as normalize_indian_mobile() in the database, which
 * checks it again.
 */
export function parseIndianMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2)
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1)
  }
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

/** The form Supabase Auth expects: +91XXXXXXXXXX. */
export function toE164(mobile: string): string {
  return `+91${mobile}`
}

/** "+91 98765 43210", for showing the guest which number the code went to. */
export function formatMobile(mobile: string): string {
  return `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`
}
