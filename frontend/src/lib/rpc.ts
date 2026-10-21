import type { AuthError, PostgrestSingleResponse } from '@supabase/supabase-js'
import { fromAuthError, fromPostgrestError } from './errors'

/**
 * Returns the data of a Supabase database call or throws an AppError. Every
 * screen uses this instead of reading `{ data, error }` itself, so no error is
 * ever silently ignored.
 *
 *   const venues = unwrap(await supabase.rpc('admin_list_venues'))
 */
export function unwrap<T>(result: PostgrestSingleResponse<T>): T {
  if (result.error) {
    throw fromPostgrestError(result.error)
  }
  return result.data
}

/**
 * Throws an AppError if a supabase.auth.* call failed; afterwards TypeScript
 * knows the result is the success variant. (Auth calls do not share one result
 * shape, so this narrows each call's own type instead of returning `data`.)
 *
 *   const result = await supabase.auth.getSession()
 *   assertNoAuthError(result)
 *   result.data.session
 */
export function assertNoAuthError<R extends { error: AuthError | null }>(
  result: R,
): asserts result is Extract<R, { error: null }> {
  if (result.error) {
    throw fromAuthError(result.error)
  }
}
