import type { SessionState } from './api'
import type { SessionOption } from './types'

/**
 * What the warning and final popups offer (ARCHITECTURE §4.11). The server
 * enforces the same rules again (continue_free, continue_with_credit,
 * prepare_payment), so this only decides what to show.
 *
 *   payments off      → continue free · subscription "coming soon"
 *   has scan credits  → use 1 scan
 *   no credits        → pay to continue · subscribe (or "coming soon")
 */
export function sessionOptions(state: SessionState): SessionOption[] {
  if (!state.paymentsEnabled) {
    return [
      { kind: 'continue_free', minutes: state.continueFreeMinutes },
      { kind: 'subscribe_coming_soon' },
    ]
  }
  if (state.scanCredits > 0) {
    return [
      {
        kind: 'use_scan',
        minutes: state.subscriptionSessionMinutes,
        creditsLeft: state.scanCredits,
      },
    ]
  }
  return [
    { kind: 'continue_paid', minutes: state.continueMinutes, pricePaise: state.continueFeePaise },
    state.subscriptionEnabled
      ? {
          kind: 'subscribe',
          pricePaise: state.subscriptionPricePaise,
          scans: state.subscriptionScans,
        }
      : { kind: 'subscribe_coming_soon' },
  ]
}
