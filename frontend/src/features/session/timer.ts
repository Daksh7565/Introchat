import type { SessionState } from './api'

/**
 * What the screen shows at a given moment (ARCHITECTURE §4.12):
 *   running – counting down to the end of the block; `warning` once inside the warning window
 *   final   – time is up: the final popup counts down to the logout
 *   ended   – the server has ended the session
 *
 * The phone moves into "final" on its own the moment expires_at passes; the
 * server's tick confirms it within 10 s. Until then the deadline is estimated
 * as expires_at + FINAL_PROMPT_SECONDS, never earlier than the server's.
 */
export type TimerView =
  | { phase: 'running'; secondsLeft: number; warning: boolean }
  | { phase: 'final'; secondsLeft: number }
  | { phase: 'ended' }

function secondsUntil(target: Date, serverNowMs: number): number {
  return Math.max(0, Math.ceil((target.getTime() - serverNowMs) / 1000))
}

export function timerAt(state: SessionState, phoneNowMs: number): TimerView {
  if (state.status === 'ended') return { phase: 'ended' }
  const serverNowMs = phoneNowMs + state.clockOffsetMs

  if (state.status === 'final_prompt' || serverNowMs >= state.expiresAt.getTime()) {
    const deadline =
      state.finalDeadlineAt ?? new Date(state.expiresAt.getTime() + state.finalPromptSeconds * 1000)
    return { phase: 'final', secondsLeft: secondsUntil(deadline, serverNowMs) }
  }
  return {
    phase: 'running',
    secondsLeft: secondsUntil(state.expiresAt, serverNowMs),
    warning: serverNowMs >= state.warningAt.getTime(),
  }
}

/** Seconds before an away guest's session ends; null while not away. */
export function awaySecondsLeft(state: SessionState, phoneNowMs: number): number | null {
  if (state.status === 'ended' || state.awaySince === null) return null
  const endsAt = new Date(state.awaySince.getTime() + state.awayGraceSeconds * 1000)
  return secondsUntil(endsAt, phoneNowMs + state.clockOffsetMs)
}
