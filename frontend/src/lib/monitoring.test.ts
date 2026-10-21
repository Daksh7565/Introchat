import { describe, expect, it } from 'vitest'
import { parseMonitoringEnv } from './monitoring'

describe('parseMonitoringEnv', () => {
  it('turns reporting off when no DSN is set', () => {
    expect(parseMonitoringEnv({})).toEqual({ dsn: null, environment: 'local' })
  })

  it('accepts a Sentry DSN and an environment name', () => {
    expect(
      parseMonitoringEnv({
        VITE_SENTRY_DSN: 'https://abc123@o123.ingest.sentry.io/456',
        VITE_APP_ENV: 'production',
      }),
    ).toEqual({ dsn: 'https://abc123@o123.ingest.sentry.io/456', environment: 'production' })
  })

  it('fails loudly on a malformed DSN instead of silently reporting nothing', () => {
    expect(() => parseMonitoringEnv({ VITE_SENTRY_DSN: 'not-a-dsn' })).toThrow(
      /VITE_SENTRY_DSN must look like/,
    )
  })
})
