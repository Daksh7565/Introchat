import { AuthError } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The flow after "Continue": which screen shows for each sign-in and profile
// state, and that what the guest types reaches Supabase in the right form.
// Server rules themselves are tested in pgTAP (guest_identity_test.sql).
type Listener = (event: string, session: { user: { id: string } } | null) => void
let listener: Listener = () => undefined
let session: { user: { id: string } } | null = null
const rpc = vi.fn()
const signInWithOtp = vi.fn()
const verifyOtp = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      onAuthStateChange: (callback: Listener) => {
        listener = callback
        callback('INITIAL_SESSION', session)
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => verifyOtp(...args),
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}))

const { GuestEntry } = await import('./GuestEntry')

interface ProfileRow {
  handle: string
  nickname: string | null
  birth_year: number | null
  gender: string | null
  preferred_language: string
  consent_current: boolean
  age_blocked: boolean
  tags: string[]
  profile_complete: boolean
}

const PROFILE_ROW: ProfileRow = {
  handle: 'Mango-4821',
  nickname: null,
  birth_year: 1998,
  gender: null,
  preferred_language: 'en',
  consent_current: true,
  age_blocked: false,
  tags: ['music'],
  profile_complete: true,
}

function renderEntry() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GuestEntry slug="cafe-one" qrToken="Tok" venueName="Cafe One" onBack={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  session = null
  rpc.mockReset()
  signInWithOtp.mockReset()
  verifyOtp.mockReset()
})

describe('GuestEntry — login', () => {
  it('refuses a number that is not an Indian mobile without calling the server', async () => {
    renderEntry()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '12345')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(screen.getByText('Enter a 10-digit Indian mobile number.')).toBeInTheDocument()
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('sends the code to +91… and then asks for it', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null })
    renderEntry()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '98765 43210')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: '+919876543210',
      options: { channel: 'sms' },
    })
    expect(
      await screen.findByText('We sent a 6-digit code to +91 98765 43210.'),
    ).toBeInTheDocument()
  })

  it('explains a refusal from the SMS hook', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: new AuthError('BANNED', 403, 'unknown') })
    renderEntry()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '9876543210')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText("This number can't be used on IntroChat.")).toBeInTheDocument()
  })

  it('submits the code as soon as 6 digits are in, and explains a wrong one', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null })
    verifyOtp.mockResolvedValue({
      data: {},
      error: new AuthError('Token has expired or is invalid', 403, 'otp_expired'),
    })
    renderEntry()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '9876543210')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    expect(verifyOtp).toHaveBeenCalledWith({ phone: '+919876543210', token: '123456', type: 'sms' })
    expect(await screen.findByText(/That code is wrong or has expired/)).toBeInTheDocument()
  })
})

describe('GuestEntry — after login', () => {
  it('takes a returning guest with a finished profile straight to the end', async () => {
    session = { user: { id: 'u1' } }
    rpc.mockResolvedValue({ data: [PROFILE_ROW], error: null })
    renderEntry()
    expect(await screen.findByRole('heading', { name: "You're Mango-4821" })).toBeInTheDocument()
  })

  it('asks an admin account to log out before continuing as a guest', async () => {
    session = { user: { id: 'admin' } }
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'NOT_A_GUEST', details: '', hint: '', code: 'P0001' },
    })
    renderEntry()
    expect(
      await screen.findByRole('heading', { name: "You're logged in as an admin" }),
    ).toBeInTheDocument()
  })

  it('shows the refusal for good once an under-18 birth year is given', async () => {
    session = { user: { id: 'u2' } }
    let profile: ProfileRow = {
      ...PROFILE_ROW,
      birth_year: null,
      tags: [],
      profile_complete: false,
    }
    rpc.mockImplementation((fn: string) => {
      if (fn === 'update_profile') {
        profile = { ...profile, birth_year: 2012, age_blocked: true }
        return Promise.resolve({ data: 'under_age', error: null })
      }
      return Promise.resolve({ data: [profile], error: null })
    })
    renderEntry()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Year of birth'), '2012')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByRole('heading', { name: 'Sorry, IntroChat is for adults only' }),
    ).toBeInTheDocument()
  })

  it('moves on to the profile once the code is accepted', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null })
    verifyOtp.mockImplementation(() => {
      listener('SIGNED_IN', { user: { id: 'u3' } })
      return Promise.resolve({ data: {}, error: null })
    })
    rpc.mockResolvedValue({
      data: [{ ...PROFILE_ROW, consent_current: false, birth_year: null, tags: [] }],
      error: null,
    })
    renderEntry()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '9000000001')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeInTheDocument()
  })
})
