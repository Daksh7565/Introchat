import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const updateUser = vi.fn()
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { updateUser: (...args: unknown[]) => updateUser(...args) },
  },
}))
const { AdminsPage } = await import('./AdminsPage')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AdminsPage currentEmail="me@introchat.test" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  rpc.mockReset()
  updateUser.mockReset()
  rpc.mockResolvedValue({
    data: [
      {
        user_id: 'a1',
        email: 'me@introchat.test',
        is_active: true,
        has_mfa: true,
        last_sign_in_at: null,
        created_at: '2026-10-01T00:00:00Z',
      },
      {
        user_id: 'a2',
        email: 'other@introchat.test',
        is_active: true,
        has_mfa: false,
        last_sign_in_at: null,
        created_at: '2026-10-01T00:00:00Z',
      },
    ],
    error: null,
  })
})

describe('AdminsPage', () => {
  it('never offers to deactivate yourself', async () => {
    renderPage()
    expect(await screen.findByText('2-step not set up yet', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(1)
  })

  it('changes the password only when it is long enough and repeated exactly', async () => {
    updateUser.mockResolvedValue({ data: { user: {} }, error: null })
    renderPage()
    const user = userEvent.setup()
    const save = await screen.findByRole('button', { name: 'Change password' })
    await user.type(screen.getByLabelText('New password'), 'short')
    expect(screen.getByText('The password is too short.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('New password'))
    await user.type(screen.getByLabelText('New password'), 'a-long-enough-password')
    await user.type(screen.getByLabelText('Repeat it'), 'a-long-enough-passwore')
    expect(screen.getByText('The two passwords are not the same.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    await user.clear(screen.getByLabelText('Repeat it'))
    await user.type(screen.getByLabelText('Repeat it'), 'a-long-enough-password')
    await user.click(save)
    expect(updateUser).toHaveBeenCalledWith({ password: 'a-long-enough-password' })
    expect(await screen.findByText('Password changed.')).toBeInTheDocument()
  })
})
