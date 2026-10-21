import { describe, expect, it } from 'vitest'
import { type SessionState, toSessionState } from './api'
import { awaySecondsLeft, timerAt } from './timer'

const BASE = Date.parse('2026-10-13T12:00:00Z')
const at = (secondsFromBase: number) => new Date(BASE + secondsFromBase * 1000)

// A 60-minute session that started at BASE; warning 15 minutes before the end.
const STATE: SessionState = {
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
  clockOffsetMs: 0,
}

describe('timerAt', () => {
  it('counts down to the end of the block', () => {
    expect(timerAt(STATE, BASE + 60_000)).toEqual({
      phase: 'running',
      secondsLeft: 3540,
      warning: false,
    })
  })

  it('turns to warning at warning_at', () => {
    expect(timerAt(STATE, at(2700).getTime())).toMatchObject({ phase: 'running', warning: true })
  })

  it('goes to the final prompt as soon as the time is up, before the server tick', () => {
    expect(timerAt(STATE, at(3600).getTime())).toEqual({ phase: 'final', secondsLeft: 120 })
  })

  it("uses the server's final deadline once it has one", () => {
    const final = { ...STATE, status: 'final_prompt' as const, finalDeadlineAt: at(3700) }
    expect(timerAt(final, at(3650).getTime())).toEqual({ phase: 'final', secondsLeft: 50 })
  })

  it('never shows negative time', () => {
    expect(timerAt(STATE, at(9999).getTime())).toEqual({ phase: 'final', secondsLeft: 0 })
  })

  it('corrects a phone clock that is 5 minutes slow', () => {
    const slowPhone = { ...STATE, clockOffsetMs: 5 * 60_000 }
    // The phone thinks it is BASE, the server knows it is BASE + 5 min.
    expect(timerAt(slowPhone, BASE)).toMatchObject({ secondsLeft: 3300 })
  })

  it('reports an ended session', () => {
    expect(timerAt({ ...STATE, status: 'ended', endReason: 'expired' }, BASE)).toEqual({
      phase: 'ended',
    })
  })
})

describe('awaySecondsLeft', () => {
  it('is null while the guest is not away', () => {
    expect(awaySecondsLeft(STATE, BASE)).toBeNull()
  })

  it('counts the away grace down from away_since', () => {
    expect(awaySecondsLeft({ ...STATE, awaySince: at(100) }, at(130).getTime())).toBe(150)
  })
})

describe('toSessionState', () => {
  const ROW = {
    session_id: 's1',
    status: 'active',
    end_reason: null,
    kind: 'free',
    venue_name: 'Cafe One',
    table_label: 'T1',
    started_at: at(0).toISOString(),
    expires_at: at(3600).toISOString(),
    warning_at: at(2700).toISOString(),
    final_deadline_at: null,
    final_prompt_seconds: 120,
    away_since: null,
    away_grace_seconds: 180,
    payments_enabled: false,
    continue_free_minutes: 60,
    heartbeat_seconds: 30,
    location_seconds: 120,
    server_now: at(10).toISOString(),
    venue_id: 'v1',
  }

  it('estimates the clock offset from the middle of the round trip', () => {
    // Phone sent at BASE+0 and got the answer at BASE+2 s: answer made ~BASE+1 s
    // on the phone's clock, while the server said BASE+10 s → offset 9 s.
    expect(toSessionState(ROW, BASE, BASE + 2000).clockOffsetMs).toBe(9000)
  })

  it('refuses a status it does not know', () => {
    expect(() => toSessionState({ ...ROW, status: 'paused' }, BASE, BASE)).toThrow()
  })
})
