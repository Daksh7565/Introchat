import type * as SentryClient from './sentryClient'
import type { RootOptions } from 'react-dom/client'

// Error reporting (Sentry). This app carries chat messages, GPS readings and
// login tokens, so every kind of automatic data collection is switched off
// explicitly: Sentry receives the error, the stack trace and the page route,
// nothing a guest typed or sent. No tracing and no session replay (a replay
// would record chats on screen).
//
// Sentry is ~27 KB gzipped, so it is fetched after the first screen has
// painted rather than before it (M8 bundle budget). Errors from before then
// wait in a short queue and are sent once it has loaded.

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

interface Report {
  error: unknown
  context: string
  componentStack?: string
}

// Enough to cover a burst during start-up; a loop throwing on every render
// would otherwise grow the queue without bound before Sentry arrives.
const QUEUE_LIMIT = 20

let sentry: typeof SentryClient | null = null
/** True while reports are wanted: a DSN is set and Sentry has not failed to load. */
let enabled = false
const queue: Report[] = []

function send(client: typeof SentryClient, report: Report): void {
  client.captureException(report.error, {
    tags: { context: report.context },
    ...(report.componentStack
      ? { contexts: { react: { componentStack: report.componentStack } } }
      : {}),
  })
}

function capture(report: Report): void {
  if (sentry) send(sentry, report)
  else if (enabled && queue.length < QUEUE_LIMIT) queue.push(report)
}

// Until Sentry installs its own global handlers, these catch what nothing else does.
function onEarlyError(event: ErrorEvent): void {
  capture({ error: event.error ?? event.message, context: 'window.error' })
}
function onEarlyRejection(event: PromiseRejectionEvent): void {
  capture({ error: event.reason, context: 'window.unhandledrejection' })
}

async function loadSentry(config: { dsn: string; environment: string }): Promise<void> {
  try {
    const client = await import('./sentryClient')
    client.init({
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
    window.removeEventListener('error', onEarlyError)
    window.removeEventListener('unhandledrejection', onEarlyRejection)
    sentry = client
    for (const report of queue.splice(0)) send(client, report)
  } catch (error) {
    // The Sentry file could not be fetched (offline, or blocked by the
    // browser). There is nowhere else to send this: reporting is off for this
    // visit, and every error still reaches the console (reportError logs first).
    enabled = false
    queue.length = 0
    console.error('Error reporting could not start', error)
  }
}

/** Runs `task` once the page has loaded and the main thread is idle. */
function afterFirstPaint(task: () => void): void {
  const whenIdle = () => {
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(task, { timeout: 5000 })
    } else {
      setTimeout(task, 1000)
    }
  }
  if (document.readyState === 'complete') whenIdle()
  else window.addEventListener('load', whenIdle, { once: true })
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

  enabled = true
  window.addEventListener('error', onEarlyError)
  window.addEventListener('unhandledrejection', onEarlyRejection)
  const dsn = config.dsn
  afterFirstPaint(() => {
    void loadSentry({ dsn, environment: config.environment })
  })
}

/**
 * Logs an error to the console and, when reporting is on, to Sentry. Every
 * error the app chooses to survive goes through here, so none is swallowed.
 */
export function reportError(error: unknown, context: string): void {
  console.error(context, error)
  capture({ error, context })
}

/**
 * React 19 root error hooks for errors no boundary handled, and errors React
 * recovered from. Deliberately no onCaughtError: an error boundary that catches
 * an error reports it itself (RouteErrorPage calls reportError), and hooking
 * onCaughtError as well would send every such error twice.
 */
export const rootErrorHandlers: Pick<RootOptions, 'onUncaughtError' | 'onRecoverableError'> = {
  onUncaughtError: (error, info) => {
    console.error('react.uncaught', error)
    capture({ error, context: 'react.uncaught', componentStack: info.componentStack })
  },
  onRecoverableError: (error, info) => {
    console.error('react.recoverable', error)
    capture({ error, context: 'react.recoverable', componentStack: info.componentStack })
  },
}
