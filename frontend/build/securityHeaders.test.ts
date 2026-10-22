import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, headersFile } from './securityHeaders.ts'

const ENV = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  sentryDsn: '',
  appEnv: 'preview',
}

function directive(policy: string, name: string): string[] {
  const found = policy.split('; ').find((d) => d.startsWith(`${name} `))
  return found ? found.split(' ').slice(1) : []
}

describe('contentSecurityPolicy', () => {
  it('lets the app reach its own Supabase project over https and Realtime', () => {
    const connect = directive(contentSecurityPolicy(ENV), 'connect-src')
    expect(connect).toContain('https://abcdefgh.supabase.co')
    expect(connect).toContain('wss://abcdefgh.supabase.co')
    expect(connect.filter((s) => s.includes('supabase'))).toHaveLength(2)
  })

  it('keeps scripts to this site and Razorpay Checkout, with no inline code or eval', () => {
    expect(directive(contentSecurityPolicy(ENV), 'script-src')).toEqual([
      "'self'",
      'https://checkout.razorpay.com',
      'https://cdn.razorpay.com',
    ])
  })

  it('can never be framed, and runs no plugins', () => {
    const policy = contentSecurityPolicy(ENV)
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"])
    expect(directive(policy, 'object-src')).toEqual(["'none'"])
  })

  it('adds the Sentry host and a violation report address only when a DSN is set', () => {
    expect(contentSecurityPolicy(ENV)).not.toContain('sentry')
    const policy = contentSecurityPolicy({
      ...ENV,
      sentryDsn: 'https://publickey@o42.ingest.de.sentry.io/7',
    })
    expect(directive(policy, 'connect-src')).toContain('https://o42.ingest.de.sentry.io')
    expect(directive(policy, 'report-uri')).toEqual([
      'https://o42.ingest.de.sentry.io/api/7/security/?sentry_key=publickey&sentry_environment=preview',
    ])
  })

  it('leaves Supabase out when the build has no address (CI)', () => {
    expect(contentSecurityPolicy({ ...ENV, supabaseUrl: '' })).not.toContain('supabase')
  })

  it('refuses a malformed address instead of writing a policy that blocks the app', () => {
    expect(() =>
      contentSecurityPolicy({ ...ENV, supabaseUrl: 'http://abcdefgh.supabase.co' }),
    ).toThrow('VITE_SUPABASE_URL')
    expect(() => contentSecurityPolicy({ ...ENV, sentryDsn: 'not-a-dsn' })).toThrow(
      'VITE_SENTRY_DSN',
    )
  })
})

describe('headersFile', () => {
  it('applies the policy to every page and keeps the service worker uncached', () => {
    const file = headersFile(ENV)
    expect(file).toMatch(/^\/\*\n {2}Content-Security-Policy: default-src 'self'; /m)
    expect(file).toMatch(/^\/sw\.js\n {2}Cache-Control: no-cache$/m)
  })
})
