// What the warning / final-prompt popups can offer (ARCHITECTURE §4.11). Which
// options appear is decided by the server from the payment switches and the
// guest's scan credits; the popup only renders them.
export type SessionOption =
  | { kind: 'continue_free'; minutes: number }
  | { kind: 'continue_paid'; minutes: number; pricePaise: number }
  | { kind: 'use_scan'; minutes: number; creditsLeft: number }
  | { kind: 'subscribe'; pricePaise: number; scans: number }
  | { kind: 'subscribe_coming_soon' }

/** Every way a session ends (ARCHITECTURE §4.13). */
export type SessionEndReason =
  'expired' | 'left_venue' | 'user_logout' | 'kicked' | 'banned' | 'venue_closed'
