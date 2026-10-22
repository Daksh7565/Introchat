import { readFileSync } from 'node:fs'
import { loadEnv, type Plugin } from 'vite'

// The legal pages (privacy, terms, refunds, contact) name the business from
// src/features/legal/business.json. Until the real details are filled in, its
// values are "[...]" placeholders; a production build with any of them left
// would publish a privacy policy with no grievance officer and a contact page
// with no address, which Razorpay and the DPDP Act both require.

const PLACEHOLDER = /^\[.*\]$/

/** The business.json fields still holding a "[...]" placeholder. */
export function placeholdersIn(fields: [string, unknown][]): string[] {
  return fields
    .filter(([, value]) => typeof value === 'string' && PLACEHOLDER.test(value))
    .map(([key]) => key)
}

/** Fails a production build (VITE_APP_ENV=production) while placeholders remain. */
export function legalCheck(businessFile: string): Plugin {
  return {
    name: 'introchat-legal-check',
    apply: 'build',
    configResolved(config) {
      const appEnv = loadEnv(config.mode, config.envDir, 'VITE_').VITE_APP_ENV?.trim()
      if (appEnv !== 'production') return
      const business: unknown = JSON.parse(readFileSync(businessFile, 'utf8'))
      if (typeof business !== 'object' || business === null) {
        throw new Error(`${businessFile} must be a JSON object`)
      }
      const fields: [string, unknown][] = Object.entries(business)
      const missing = placeholdersIn(fields)
      if (missing.length > 0) {
        throw new Error(
          `Production build stopped: ${businessFile} still has placeholders for ${missing.join(', ')}. ` +
            'The legal pages would publish them.',
        )
      }
    },
  }
}
