import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { AppError } from './errors'
import { reportError } from './monitoring'
import { supabase } from './supabase'

// Edge Functions answer { "error": "SOME_CODE" } on failure, like the SQL
// functions raise codes (ARCHITECTURE §2.5).
const CODE = /^[A-Z][A-Z0-9_]+$/

async function codeFrom(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    const code =
      typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
    return typeof code === 'string' && CODE.test(code) ? code : null
  } catch {
    // Not JSON (a gateway page, an empty body): no code to show.
    return null
  }
}

/**
 * Calls an Edge Function as the signed-in user and returns its JSON answer,
 * or throws an AppError with the function's code (NETWORK when offline).
 */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (!error) {
    if (data === null) throw new AppError('UNEXPECTED', { function: name, reason: 'empty answer' })
    return data
  }
  if (error instanceof FunctionsFetchError) throw new AppError('NETWORK', null, error)
  // supabase-js types `context` as any; it is the function's Response.
  const context: unknown = error instanceof FunctionsHttpError ? error.context : null
  if (context instanceof Response) {
    const response = context
    const code = await codeFrom(response)
    if (code) throw new AppError(code, { status: response.status }, error)
    const appError = new AppError('UNEXPECTED', { function: name, status: response.status }, error)
    reportError(appError, 'function-error-without-code')
    throw appError
  }
  const appError = new AppError('UNEXPECTED', { function: name }, error)
  reportError(appError, 'function-relay-error')
  throw appError
}
