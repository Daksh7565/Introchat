import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../lib/errors'
import type { Reading } from '../../lib/location'

// The page's job: show the right screen for each scan and location outcome.
// The server and the phone's location are replaced; their own rules are tested
// in pgTAP (location_check) and location.test.ts.
const rpc = vi.fn()
const getReading = vi.fn<() => Promise<Reading>>()
// Signed out: Continue leads to the login (GuestEntry has its own tests).
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      onAuthStateChange: (callback: (event: string, session: null) => void) => {
        callback('INITIAL_SESSION', null)
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  },
}))
vi.mock('../../lib/location', () => ({ getReading: () => getReading() }))

const { LandingPage } = await import('./LandingPage')

const VENUE_ROW = {
  venue_name: 'Chai Café',
  table_label: 'T07',
  payments_enabled: false,
  scan_fee_enabled: false,
  subscription_enabled: false,
  scan_fee_paise: 1900,
  subscription_price_paise: 40000,
  subscription_scans: 25,
}
const READING: Reading = { latitude: 23.02, longitude: 72.57, accuracyM: 12, ageSeconds: 1 }

function serverSays(venue: unknown, verdict: unknown = 'inside') {
  rpc.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'venue_public'
        ? venue instanceof Error
          ? { data: null, error: { message: venue.message, details: '', hint: '', code: 'P0001' } }
          : { data: [venue], error: null }
        : { data: verdict, error: null },
    ),
  )
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/v/chai-cafe/t/Ab3dEf6hIj9kLm2n']}>
        <Routes>
          <Route path="/v/:slug/t/:token" element={<LandingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  rpc.mockReset()
  getReading.mockReset()
  // No permission granted yet: the page waits for the guest to tap.
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: 'prompt' }) },
  })
})

describe('LandingPage', () => {
  it('explains why location is needed before asking for it', async () => {
    serverSays(VENUE_ROW)
    renderPage()
    expect(await screen.findByText('Welcome to Chai Café')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check my location' })).toBeInTheDocument()
    expect(getReading).not.toHaveBeenCalled()
  })

  it('shows INSIDE when the server says the phone is at the venue', async () => {
    serverSays(VENUE_ROW, 'inside')
    getReading.mockResolvedValue(READING)
    renderPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check my location' }))
    expect(await screen.findByText("You're at Chai Café")).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith(
      'location_check',
      expect.objectContaining({ p_slug: 'chai-cafe', p_accuracy_m: 12, p_age_seconds: 1 }),
    )
  })

  it('opens the login once inside, and not before', async () => {
    serverSays(VENUE_ROW, 'inside')
    getReading.mockResolvedValue(READING)
    renderPage()
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Check my location' }))
    await screen.findByText("You're at Chai Café")
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByRole('heading', { name: 'Log in with your phone' }),
    ).toBeInTheDocument()
  })

  it('explains OUTSIDE', async () => {
    serverSays(VENUE_ROW, 'outside')
    getReading.mockResolvedValue(READING)
    renderPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check my location' }))
    expect(await screen.findByText("You don't seem to be at Chai Café")).toBeInTheDocument()
  })

  it('explains how to allow location when permission is refused', async () => {
    serverSays(VENUE_ROW)
    getReading.mockRejectedValue(new AppError('LOCATION_PERMISSION_DENIED'))
    renderPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check my location' }))
    expect(await screen.findByText('Location is turned off')).toBeInTheDocument()
  })

  it('checks automatically when permission was already granted', async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: () => Promise.resolve({ state: 'granted' }) },
    })
    serverSays(VENUE_ROW, 'inside')
    getReading.mockResolvedValue(READING)
    renderPage()
    expect(await screen.findByText("You're at Chai Café")).toBeInTheDocument()
  })

  it.each([
    ['VENUE_NOT_FOUND', 'This QR code is not active'],
    ['VENUE_CLOSED', 'Closed for today'],
    ['TABLE_NOT_FOUND', "This table's QR code no longer works"],
  ])('explains %s', async (code, title) => {
    serverSays(new Error(code))
    renderPage()
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
  })
})
