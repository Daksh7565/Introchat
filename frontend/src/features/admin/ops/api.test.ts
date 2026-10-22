import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}))
const { smsUsage } = await import('./api')

beforeEach(() => rpc.mockReset())

describe('smsUsage', () => {
  it('adds the rows up per day, newest first, with refusals by reason', async () => {
    rpc.mockResolvedValue({
      data: [
        { day: '2026-10-21', status: 'sent', reason: null, attempts: 4 },
        { day: '2026-10-22', status: 'sent', reason: null, attempts: 7 },
        { day: '2026-10-22', status: 'refused', reason: 'RATE_LIMITED', attempts: 2 },
        { day: '2026-10-22', status: 'refused', reason: 'BANNED', attempts: 1 },
        { day: '2026-10-22', status: 'failed', reason: 'GATEWAY_TIMEOUT', attempts: 1 },
      ],
      error: null,
    })
    expect(await smsUsage()).toEqual([
      {
        day: '2026-10-22',
        sent: 7,
        failed: 1,
        refused: 3,
        pending: 0,
        refusals: { RATE_LIMITED: 2, BANNED: 1 },
      },
      { day: '2026-10-21', sent: 4, failed: 0, refused: 0, pending: 0, refusals: {} },
    ])
  })
})
