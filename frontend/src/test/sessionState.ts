import type { SessionState } from '../features/session/api'

/**
 * A live 60-minute free session at "Cafe One", for tests. Times are relative
 * to `startMs`; override anything a test is about.
 */
export function sessionStateFixture(
  startMs: number,
  overrides: Partial<SessionState> = {},
): SessionState {
  const at = (seconds: number) => new Date(startMs + seconds * 1000)
  return {
    sessionId: 's1',
    status: 'active',
    endReason: null,
    venueId: 'v1',
    venueName: 'Cafe One',
    tableLabel: 'T1',
    expiresAt: at(3600),
    warningAt: at(2700),
    finalDeadlineAt: null,
    finalPromptSeconds: 120,
    awaySince: null,
    awayGraceSeconds: 180,
    paymentsEnabled: false,
    continueFreeMinutes: 60,
    heartbeatSeconds: 30,
    locationSeconds: 120,
    scanCredits: 0,
    continueFeePaise: 1900,
    continueMinutes: 60,
    subscriptionEnabled: false,
    subscriptionPricePaise: 40000,
    subscriptionScans: 25,
    subscriptionSessionMinutes: 120,
    clockOffsetMs: 0,
    ...overrides,
  }
}

/** The same session as the server's session_state row (snake_case, ISO times). */
export function sessionStateRow(startMs: number, overrides: Record<string, unknown> = {}) {
  const at = (seconds: number) => new Date(startMs + seconds * 1000).toISOString()
  return {
    session_id: 's1',
    status: 'active',
    end_reason: null,
    kind: 'free',
    venue_id: 'v1',
    venue_name: 'Cafe One',
    table_label: 'T1',
    started_at: at(0),
    expires_at: at(3600),
    warning_at: at(2700),
    final_deadline_at: null,
    final_prompt_seconds: 120,
    away_since: null,
    away_grace_seconds: 180,
    payments_enabled: false,
    continue_free_minutes: 60,
    heartbeat_seconds: 30,
    location_seconds: 120,
    scan_credits: 0,
    continue_fee_paise: 1900,
    continue_minutes: 60,
    subscription_enabled: false,
    subscription_price_paise: 40000,
    subscription_scans: 25,
    subscription_session_minutes: 120,
    server_now: at(0),
    ...overrides,
  }
}
