import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSummary } from '../people/types'

// Sending from the open chat: the message shows at once, a failure keeps it
// as "Not sent", and a retry reuses the same client id (so the server can
// never store it twice).
const rpc = vi.fn()
const channel = { on: () => channel, subscribe: () => channel, send: vi.fn() }
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: () => channel,
    removeChannel: vi.fn(),
  },
}))

const { ChatPanel } = await import('./ChatPanel')

const CONVERSATION: ConversationSummary = {
  id: 'c1',
  partnerHandle: 'Lotus-1234',
  lastMessage: null,
  lastMessageAt: null,
  unread: 0,
  canSend: true,
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ChatPanel conversation={CONVERSATION} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  rpc.mockReset()
})

describe('ChatPanel', () => {
  it('keeps a message that failed to send, and retries it with the same id', async () => {
    let sendAttempts = 0
    rpc.mockImplementation((fn: string) => {
      if (fn === 'send_message') {
        sendAttempts += 1
        return Promise.resolve(
          sendAttempts === 1
            ? {
                data: null,
                error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
              }
            : { data: [{ message_id: 1, created_at: new Date().toISOString() }], error: null },
        )
      }
      return Promise.resolve({ data: [], error: null })
    })
    renderPanel()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox'), 'Hello there{Enter}')
    expect(await screen.findByText(/Not sent/)).toBeInTheDocument()
    expect(screen.getByText('Hello there')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(sendAttempts).toBe(2))
    const [first, second] = rpc.mock.calls.filter(([fn]) => fn === 'send_message')
    expect(second?.[1].p_client_msg_id).toBe(first?.[1].p_client_msg_id)
  })

  it('shows read-only when the other person has left', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ChatPanel conversation={{ ...CONVERSATION, canSend: false }} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Lotus-1234 has left/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
