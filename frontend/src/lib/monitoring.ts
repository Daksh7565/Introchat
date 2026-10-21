import * as Sentry from '@sentry/react'

// Error reporting (Sentry). This app carries chat messages, GPS readings and
// login tokens, so every kind of automatic data collection is switched off
// explicitly: Sentry receives the error, the stack trace and the page route,
// nothing a guest typed or sent. No tracing and no session replay (a replay
// would record chats on screen).

declare const __APP_RELEASE__: string

type RawMonitoringEnv = Partial<Record<'VITE_SENTRY_DSN' | 'VITE_APP_ENV', string>>

export interface MonitoringConfig {
  dsn: string | null
  environment: string
}

/**
 * A missing DSN disables reporting (normal for local development). A malformed
 * one is a deployment mistake and fails loudly.
 */
export function parseMonitoringEnv(raw: RawMonitoringEnv): MonitoringConfig {
  const dsn = raw.VITE_SENTRY_DSN?.trim() ?? ''
  if (dsn !== '' && !/^https:\/\/[^@\s]+@[^/\s]+\/\d+$/.test(dsn)) {
    throw new Error(
      'Invalid app configuration:\n- VITE_SENTRY_DSN must look like https://<key>@<host>/<project-id>',
    )
  }
  const environment = raw.VITE_APP_ENV?.trim() || 'local'
  return { dsn: dsn === '' ? null : dsn, environment }
}

export function initMonitoring(): void {
  const config = parseMonitoringEnv({
    VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
    VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
  })

  if (config.dsn === null) {
    if (import.meta.env.PROD) {
      // A production build without a DSN still works for guests; we just stop
      // hearing about its errors. Say so where a developer will see it.
      console.warn('Error reporting is disabled: VITE_SENTRY_DSN is not set for this build.')
    }
    return
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: __APP_RELEASE__,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
  })
}

/**
 * Logs an error to the console and, when reporting is on, to Sentry. Every
 * error the app chooses to survive goes through here, so none is swallowed.
 */
export function reportError(error: unknown, context: string): void {
  console.error(context, error)
  Sentry.captureException(error, { tags: { context } })
}

/**
 * React 19 root error hooks for errors no boundary handled, and errors React
 * recovered from. Deliberately no onCaughtError: an error boundary that catches
 * an error reports it itself (RouteErrorPage calls reportError), and hooking
 * onCaughtError as well would send every such error twice.
 */
export const rootErrorHandlers = {
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}
