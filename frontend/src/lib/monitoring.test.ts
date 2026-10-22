import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMonitoringEnv } from './monitoring'

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }))
vi.mock('@sentry/react', () => sentry)

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

// Sentry is fetched after the first paint (M8 bundle budget); nothing reported
// before that may be lost.
describe('reporting around the late Sentry load', () => {
  beforeEach(() => {
    vi.resetModules()
    sentry.init.mockClear()
    sentry.captureException.mockClear()
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('holds errors from before Sentry loads and sends them once it has', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://abc123@o123.ingest.sentry.io/456')
    const monitoring = await import('./monitoring')
    monitoring.initMonitoring()

    monitoring.reportError(new Error('early'), 'start-up')
    expect(sentry.captureException).not.toHaveBeenCalled()

    // The page is idle after its first paint: Sentry is fetched and started.
    await vi.runAllTimersAsync()
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledOnce())
    expect(sentry.captureException).toHaveBeenCalledWith(new Error('early'), {
      tags: { context: 'start-up' },
    })

    monitoring.reportError(new Error('later'), 'chat')
    expect(sentry.captureException).toHaveBeenLastCalledWith(new Error('later'), {
      tags: { context: 'chat' },
    })
  })

  it('never fetches Sentry when no DSN is set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const monitoring = await import('./monitoring')
    monitoring.initMonitoring()
    monitoring.reportError(new Error('local'), 'dev')
    await vi.runAllTimersAsync()
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })
})
