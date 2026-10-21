import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AdminAuthState } from './adminAuth'

// The gate's job is choosing the right screen for each sign-in state; the
// Supabase calls behind those states are replaced so no project is needed.
let state: AdminAuthState = { kind: 'signed_out' }

vi.mock('./adminAuth', () => ({
  ADMIN_AUTH_QUERY_KEY: ['admin-auth'],
  loadAdminAuth: () => Promise.resolve(state),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  startTotpEnrollment: vi.fn(),
  verifyTotp: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
  },
}))

const { AdminGate } = await import('./AdminGate')

function renderGate(next: AdminAuthState) {
  state = next
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AdminGate>{({ email }) => <p>console for {email}</p>}</AdminGate>
    </QueryClientProvider>,
  )
}

describe('AdminGate', () => {
  it('asks a signed-out visitor to sign in', async () => {
    renderGate({ kind: 'signed_out' })
    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument()
  })

  it('sends a first-time admin to authenticator set-up', async () => {
    renderGate({ kind: 'needs_enrollment' })
    expect(
      await screen.findByRole('heading', { name: 'Set up 2-step verification' }),
    ).toBeInTheDocument()
  })

  it('asks for the 6-digit code when a password session is not yet verified', async () => {
    renderGate({ kind: 'needs_verification', factorId: 'f1' })
    expect(
      await screen.findByRole('heading', { name: 'Enter your verification code' }),
    ).toBeInTheDocument()
  })

  it('refuses a verified account that is not an admin', async () => {
    renderGate({ kind: 'not_admin', email: 'someone@example.com' })
    expect(await screen.findByRole('heading', { name: 'No admin access' })).toBeInTheDocument()
    expect(screen.queryByText(/console for/)).not.toBeInTheDocument()
  })

  it('shows the Console only to a verified admin', async () => {
    renderGate({ kind: 'admin', email: 'admin@example.com' })
    expect(await screen.findByText('console for admin@example.com')).toBeInTheDocument()
  })
})
