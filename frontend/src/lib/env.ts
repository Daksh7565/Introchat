// Build-time configuration. Every VITE_* value is compiled into the bundle that
// every guest downloads, so only public values may exist here (see .env.example).

export interface AppEnv {
  supabaseUrl: string
  supabaseAnonKey: string
}

type RawEnv = Partial<Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY', string>>

/**
 * Validates the raw values and fails loudly on anything missing or malformed.
 * A build deployed without its Supabase settings would otherwise boot, render,
 * and then fail every request with a confusing network error on the guest's
 * phone; failing here names the exact variable to fix.
 */
export function parseEnv(raw: RawEnv): AppEnv {
  const problems: string[] = []

  const supabaseUrl = raw.VITE_SUPABASE_URL?.trim() ?? ''
  if (supabaseUrl === '') {
    problems.push('VITE_SUPABASE_URL is not set')
  } else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) {
    // Only hosted Supabase over HTTPS: the app never talks to a local stack,
    // and browsers refuse location and push on insecure origins anyway.
    problems.push(
      `VITE_SUPABASE_URL must look like https://<project-ref>.supabase.co (got "${supabaseUrl}")`,
    )
  }

  const supabaseAnonKey = raw.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  if (supabaseAnonKey === '') {
    problems.push('VITE_SUPABASE_ANON_KEY is not set')
  }

  if (problems.length > 0) {
    throw new Error(`Invalid app configuration:\n- ${problems.join('\n- ')}`)
  }
  return { supabaseUrl, supabaseAnonKey }
}

export const env: AppEnv = parseEnv({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
})
