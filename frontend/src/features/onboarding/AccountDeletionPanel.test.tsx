import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))
const { AccountDeletionPanel } = await import('./AccountDeletionPanel')

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AccountDeletionPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => rpc.mockReset())

describe('AccountDeletionPanel', () => {
  it('says what is lost before asking, then asks', async () => {
    let requested: string | null = null
    rpc.mockImplementation((fn: string) => {
      if (fn === 'request_account_deletion') requested = '2026-10-22T10:00:00Z'
      // my_deletion_request and request_account_deletion both answer the request date.
      return Promise.resolve({ data: requested, error: null })
    })
    renderPanel()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }))
    expect(screen.getByText(/any unused scans are deleted within 30 days/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ask to delete' }))
    expect(rpc).toHaveBeenCalledWith('request_account_deletion')
    expect(await screen.findByText(/You asked to delete your account on/)).toBeInTheDocument()
  })

  it('lets a pending request be cancelled', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve({
        data: fn === 'my_deletion_request' ? '2026-10-22T10:00:00Z' : null,
        error: null,
      }),
    )
    renderPanel()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel the request' }))
    expect(rpc).toHaveBeenCalledWith('cancel_account_deletion')
  })
})
