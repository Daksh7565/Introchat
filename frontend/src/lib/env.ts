// Build-time configuration. Every VITE_* value is compiled into the bundle that
// every guest downloads, so only public values may exist here (see .env.example).

export interface AppEnv {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Origin printed inside every table QR code, e.g. https://introchat.pages.dev (no trailing slash). */
  publicAppUrl: string
}

type RawEnv = Partial<
  Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY' | 'VITE_PUBLIC_APP_URL', string>
>

// http is accepted only for addresses that never leave a development network.
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

function parsePublicAppUrl(value: string, problems: string[]): string {
  if (value === '') {
    problems.push('VITE_PUBLIC_APP_URL is not set')
    return ''
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    problems.push(`VITE_PUBLIC_APP_URL is not a valid URL (got "${value}")`)
    return ''
  }
  const secure = url.protocol === 'https:'
  const localHttp = url.protocol === 'http:' && LOCAL_HOST.test(url.hostname)
  if (!secure && !localHttp) {
    problems.push(`VITE_PUBLIC_APP_URL must use https (got "${value}")`)
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    problems.push(
      `VITE_PUBLIC_APP_URL must be an origin only, like https://example.com (got "${value}")`,
    )
  }
  return url.origin
}

/**
 * Validates the raw values and fails loudly on anything missing or malformed.
 * A build deployed without its settings would otherwise boot, render, and then
 * fail every request with a confusing network error on the guest's phone, or
 * print QR cards that open nowhere; failing here names the exact variable.
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

  const publicAppUrl = parsePublicAppUrl(raw.VITE_PUBLIC_APP_URL?.trim() ?? '', problems)

  if (problems.length > 0) {
    throw new Error(`Invalid app configuration:\n- ${problems.join('\n- ')}`)
  }
  return { supabaseUrl, supabaseAnonKey, publicAppUrl }
}

export const env: AppEnv = parseEnv({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_PUBLIC_APP_URL: import.meta.env.VITE_PUBLIC_APP_URL,
})
