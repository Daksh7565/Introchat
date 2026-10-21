import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapPoint } from './PinMap'

// The page's own rules (what blocks Create, what is sent) are under test; the
// database, the address search, the device location and the Leaflet map are replaced.
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  searchAddress: vi.fn(),
  getReading: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('./addressSearch', () => ({ searchAddress: mocks.searchAddress }))
vi.mock('../../../lib/location', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/location')>()),
  getReading: mocks.getReading,
}))
// Leaflet needs a real layout engine; a button stands in for tapping the map.
vi.mock('./PinMap', () => ({
  PinMap: ({ onMove }: { onMove?: (point: MapPoint) => void }) => (
    <button type="button" onClick={() => onMove?.({ latitude: 23.05, longitude: 72.53 })}>
      Tap the map
    </button>
  ),
}))

const { VenueCreatePage } = await import('./VenueCreatePage')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/venues/new']}>
        <Routes>
          <Route path="/admin/venues/new" element={<VenueCreatePage />} />
          <Route path="/admin/venues/:venueId" element={<p>Venue page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name', { exact: true }), 'Chai Spot')
  await user.type(screen.getByLabelText('Address'), 'Panjrapol Char Rasta')
  await user.type(screen.getByLabelText('City'), 'Ahmedabad')
}

describe('VenueCreatePage', () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: 'venue-1', error: null })
    mocks.searchAddress
      .mockReset()
      .mockResolvedValue([{ label: 'Nehru Nagar, Ahmedabad', latitude: 23.01, longitude: 72.54 }])
    // By default the location prompt is never answered, so no pin is placed for the admin.
    mocks.getReading.mockReset().mockReturnValue(new Promise(() => undefined))
  })

  it('searches on Enter in the address box without submitting the venue form', async () => {
    const user = renderPage()
    await user.type(screen.getByLabelText('Name', { exact: true }), 'Chai Spot')
    await user.type(screen.getByLabelText('Search address'), 'nehru nagar{Enter}')

    expect(
      await screen.findByRole('button', { name: 'Nehru Nagar, Ahmedabad' }),
    ).toBeInTheDocument()
    expect(mocks.searchAddress).toHaveBeenCalledWith('nehru nagar', 'en')
    // The form kept what was typed and was not submitted (no problems shown, nothing sent).
    expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('Chai Spot')
    expect(screen.queryByText('Enter the address.')).not.toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('shows what to fix on an empty form and sends nothing', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Create venue' }))

    expect(screen.getByText("Enter the venue's name.")).toBeInTheDocument()
    expect(screen.getByText('Enter a link name.')).toBeInTheDocument()
    expect(screen.getByText('Enter the address.')).toBeInTheDocument()
    expect(screen.getByText('Enter the city.')).toBeInTheDocument()
    expect(screen.getByText(/Place the pin on the venue/)).toBeInTheDocument()
    expect(screen.getByLabelText('Address')).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('will not create the venue until the pin is placed', async () => {
    const user = renderPage()
    await fillDetails(user)
    await user.click(screen.getByRole('button', { name: 'Create venue' }))

    expect(screen.getByText(/Place the pin on the venue/)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('creates the venue at the placed pin, then opens it', async () => {
    const user = renderPage()
    await fillDetails(user)
    await user.click(screen.getByRole('button', { name: 'Tap the map' }))
    await user.click(screen.getByRole('button', { name: 'Create venue' }))

    expect(await screen.findByText('Venue page')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('admin_create_venue', {
      p_slug: 'chai-spot',
      p_name: 'Chai Spot',
      p_type: 'cafe',
      p_address: 'Panjrapol Char Rasta',
      p_city: 'Ahmedabad',
      p_latitude: 23.05,
      p_longitude: 72.53,
    })
  })

  describe('device location on open', () => {
    const reading = (accuracyM: number) => ({
      latitude: 23.025,
      longitude: 72.5439,
      accuracyM,
      ageSeconds: 0,
    })

    it('puts the pin at this device and lets the venue be created there', async () => {
      mocks.getReading.mockResolvedValue(reading(12))
      const user = renderPage()

      expect(
        await screen.findByText(/Pin placed at this device's location \(±12 m\)/),
      ).toBeVisible()
      expect(mocks.getReading).toHaveBeenCalledTimes(1)
      await fillDetails(user)
      await user.click(screen.getByRole('button', { name: 'Create venue' }))

      expect(await screen.findByText('Venue page')).toBeInTheDocument()
      expect(mocks.rpc).toHaveBeenCalledWith(
        'admin_create_venue',
        expect.objectContaining({ p_latitude: 23.025, p_longitude: 72.5439 }),
      )
    })

    it('warns when the location is rough', async () => {
      mocks.getReading.mockResolvedValue(reading(140))
      renderPage()
      expect(await screen.findByText(/location is rough \(±140 m\)/)).toBeVisible()
    })

    it('explains a refused location prompt and offers to ask again', async () => {
      const { AppError } = await import('../../../lib/errors')
      mocks.getReading.mockRejectedValueOnce(new AppError('LOCATION_PERMISSION_DENIED'))
      const user = renderPage()

      expect(await screen.findByText(/Location permission is off for this site/)).toBeVisible()
      mocks.getReading.mockResolvedValueOnce(reading(12))
      await user.click(screen.getByRole('button', { name: "Use this device's location" }))
      expect(await screen.findByText(/Pin placed at this device's location/)).toBeVisible()
    })

    it('keeps a pin the admin placed while the location was on its way', async () => {
      let answer: (value: ReturnType<typeof reading>) => void = () => undefined
      mocks.getReading.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      const user = renderPage()

      await user.click(screen.getByRole('button', { name: 'Tap the map' }))
      answer(reading(12))
      // Typing gives the late reading time to arrive; it must change nothing.
      await fillDetails(user)
      expect(screen.getByRole('button', { name: "Use this device's location" })).toBeVisible()
      expect(screen.queryByText(/Pin placed at this device's location/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Create venue' }))

      await screen.findByText('Venue page')
      expect(mocks.rpc).toHaveBeenCalledWith(
        'admin_create_venue',
        expect.objectContaining({ p_latitude: 23.05, p_longitude: 72.53 }),
      )
    })
  })
})
