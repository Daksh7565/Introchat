import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Reading } from '../../lib/location'

// What a signed-in guest sees at "/" for each session state, and that the
// buttons reach the right server functions. Timer arithmetic is tested in
// timer.test.ts, the server rules in pgTAP (sessions_test.sql).
const rpc = vi.fn()
const READING: Reading = { latitude: 23.0225, longitude: 72.5714, accuracyM: 12, ageSeconds: 1 }
vi.mock('../../lib/location', () => ({ getReading: () => Promise.resolve(READING) }))
// A live channel that never delivers anything: notices are tested in useLiveChannels.test.ts.
const channel = { on: () => channel, subscribe: () => channel, send: vi.fn() }
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: () => channel,
    removeChannel: vi.fn(),
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        callback('INITIAL_SESSION', { user: { id: 'u1' } })
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  },
}))

const { HomePage } = await import('./HomePage')

const MINUTE = 60_000

/** A session_state row as the server sends it, `minutesLeft` before the end. */
function row(minutesLeft: number, overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    session_id: 's1',
    status: 'active',
    end_reason: null,
    kind: 'free',
    venue_name: 'Cafe One',
    table_label: 'T1',
    started_at: new Date(now - 10 * MINUTE).toISOString(),
    expires_at: new Date(now + minutesLeft * MINUTE).toISOString(),
    warning_at: new Date(now + (minutesLeft - 15) * MINUTE).toISOString(),
    final_deadline_at: null,
    final_prompt_seconds: 120,
    away_since: null,
    away_grace_seconds: 180,
    payments_enabled: false,
    continue_free_minutes: 60,
    heartbeat_seconds: 30,
    location_seconds: 120,
    server_now: new Date(now).toISOString(),
    venue_id: 'v1',
    ...overrides,
  }
}

/** my_session answers `initial`; heartbeat and the others answer what each test sets. */
// The list functions answer empty lists unless a test says otherwise.
const LISTS = ['get_people', 'get_requests', 'get_conversations']

function server(initial: unknown[], answers: Record<string, unknown> = {}) {
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      data: fn === 'my_session' ? initial : (answers[fn] ?? (LISTS.includes(fn) ? [] : initial[0])),
      error: null,
    }),
  )
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  rpc.mockReset()
})

describe('HomePage', () => {
  it('asks a guest without a session to scan a table', async () => {
    server([])
    renderHome()
    expect(
      await screen.findByText('Scan the QR code on your table to get started.'),
    ).toBeInTheDocument()
  })

  it('shows the live session and reports presence with a fresh reading', async () => {
    server([row(45)])
    renderHome()
    expect(await screen.findByRole('timer')).toHaveTextContent(/left/)
    expect(screen.getByText('Cafe One')).toBeInTheDocument()
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        'heartbeat',
        expect.objectContaining({ p_latitude: 23.0225, p_permission: 'granted' }),
      ),
    )
  })

  it('shows the warning in the last 15 minutes, and "Not now" closes it', async () => {
    server([row(10)])
    renderHome()
    const user = userEvent.setup()
    expect(await screen.findByRole('dialog')).toHaveTextContent('10 minutes left')
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers to continue free when the time is up', async () => {
    server([row(-0.1)], { continue_free: row(60), heartbeat: row(-0.1) })
    renderHome()
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Your time is up' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue for 60 more minutes' }))
    expect(rpc).toHaveBeenCalledWith('continue_free')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('explains why the session ended when the heartbeat says so', async () => {
    server([row(45)], {
      heartbeat: row(45, { status: 'ended', end_reason: 'left_venue' }),
    })
    renderHome()
    expect(await screen.findByText('You left the restaurant.')).toBeInTheDocument()
  })

  it('lists the people here and sends a request with "Say hi"', async () => {
    server([row(45)], {
      get_people: [
        {
          session_id: 's2',
          handle: 'Lotus-1234',
          tags: ['cricket', 'music'],
          shared_tags: ['music'],
          online: true,
          chat_state: 'none',
          request_id: null,
          conversation_id: null,
        },
      ],
      send_chat_request: [{ request_id: 'r1', conversation_id: null }],
    })
    renderHome()
    const user = userEvent.setup()
    expect(await screen.findByText('Lotus-1234')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Say hi' }))
    expect(rpc).toHaveBeenCalledWith('send_chat_request', { p_target_session_id: 's2' })
  })

  it('leaves only on the second tap', async () => {
    server([row(45)], { end_my_session: row(45, { status: 'ended', end_reason: 'user_logout' }) })
    renderHome()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    expect(rpc).not.toHaveBeenCalledWith('end_my_session')
    await user.click(screen.getByRole('button', { name: 'Tap again to leave' }))
    expect(rpc).toHaveBeenCalledWith('end_my_session')
    expect(await screen.findByText('You logged out.')).toBeInTheDocument()
  })
})
