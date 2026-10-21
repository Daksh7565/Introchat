import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { ErrorText } from '../../../components/ErrorText'
import { TablesSection } from '../tables/TablesSection'
import {
  adminKeys,
  effectiveIntegerSetting,
  getVenue,
  invalidField,
  listVenueSettings,
  setVenueActive,
  setVenuePin,
  updateVenue,
  type VenueDetail,
  type VenueInput,
} from './api'
import { LiveLocationTest } from './LiveLocationTest'
import { PinEditor } from './PinEditor'
import type { MapPoint } from './PinMap'
import { VenueDetailsFields } from './VenueDetailsFields'
import { VenueSettingsOverrides } from './VenueSettingsOverrides'

export function VenueDetailPage() {
  const { t } = useTranslation()
  const { venueId = '' } = useParams()
  const venue = useQuery({ queryKey: adminKeys.venue(venueId), queryFn: () => getVenue(venueId) })
  const settings = useQuery({
    queryKey: adminKeys.settings(venueId),
    queryFn: () => listVenueSettings(venueId),
  })

  if (venue.isPending) return <p className="text-slate-500">{t('admin.loading')}</p>
  if (venue.isError) return <ErrorText error={venue.error} />

  const radiusM = settings.data ? effectiveIntegerSetting(settings.data, 'GEOFENCE_RADIUS_M') : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/admin" className="text-sm text-teal-700 underline">
          ← {t('admin.venues.title')}
        </Link>
        <h2 className="text-xl font-semibold">{venue.data.name}</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Section title={t('admin.status.title')}>
            {/* key: re-mount after a save so local state starts from the new data */}
            <StatusPanel key={String(venue.data.isActive)} venue={venue.data} />
          </Section>
          <Section title={t('admin.venue.detailsTitle')}>
            <DetailsPanel key={venue.data.slug + venue.data.name} venue={venue.data} />
          </Section>
          <Section title={t('admin.tables.title')}>
            <TablesSection venue={venue.data} />
          </Section>
        </div>
        <div className="flex flex-col gap-6">
          <Section title={t('admin.pin.title')}>
            <PinPanel
              key={`${venue.data.latitude},${venue.data.longitude}`}
              venue={venue.data}
              radiusM={radiusM}
            />
          </Section>
          <Section title={t('admin.test.title')}>
            <LiveLocationTest venueId={venue.data.id} />
          </Section>
          <Section title={t('admin.settings.title')}>
            <ErrorText error={settings.error} />
            {settings.data && (
              <VenueSettingsOverrides venueId={venue.data.id} rows={settings.data} />
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function useRefreshVenue(venueId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.venue(venueId) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.venues }),
    ])
}

function StatusPanel({ venue }: { venue: VenueDetail }) {
  const { t } = useTranslation()
  const refresh = useRefreshVenue(venue.id)
  const toggle = useMutation({
    mutationFn: () => setVenueActive(venue.id, !venue.isActive),
    onSuccess: refresh,
  })
  return (
    <div className="flex flex-col gap-2">
      <p className={venue.isActive ? 'text-emerald-700' : 'text-slate-600'}>
        {venue.isActive ? t('admin.status.activeHelp') : t('admin.status.inactiveHelp')}
      </p>
      <ErrorText error={toggle.error} />
      <button
        type="button"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
        className={`self-start rounded-lg px-4 py-2 font-semibold ${venue.isActive ? 'border border-rose-300 text-rose-700' : 'bg-teal-700 text-white'}`}
      >
        {venue.isActive ? t('admin.status.deactivate') : t('admin.status.activate')}
      </button>
    </div>
  )
}

function DetailsPanel({ venue }: { venue: VenueDetail }) {
  const { t } = useTranslation()
  const refresh = useRefreshVenue(venue.id)
  const initial: VenueInput = {
    name: venue.name,
    slug: venue.slug,
    type: venue.type,
    address: venue.address ?? '',
    city: venue.city ?? '',
  }
  const [details, setDetails] = useState(initial)
  const save = useMutation({ mutationFn: () => updateVenue(venue, details), onSuccess: refresh })
  const changed = JSON.stringify(details) !== JSON.stringify(initial)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      {/* The slug is inside every printed QR link; changing it breaks all of them. */}
      <VenueDetailsFields
        value={details}
        onChange={setDetails}
        invalidField={invalidField(save.error)}
        slugLocked
      />
      <ErrorText error={save.error} />
      <button
        type="submit"
        disabled={!changed || save.isPending}
        className="self-start rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
      >
        {save.isPending ? t('admin.saving') : t('admin.settings.save')}
      </button>
    </form>
  )
}

function PinPanel({ venue, radiusM }: { venue: VenueDetail; radiusM: number | null }) {
  const { t } = useTranslation()
  const refresh = useRefreshVenue(venue.id)
  const saved: MapPoint = { latitude: venue.latitude, longitude: venue.longitude }
  const [pin, setPin] = useState(saved)
  const save = useMutation({
    mutationFn: () => setVenuePin(venue.id, pin.latitude, pin.longitude),
    onSuccess: refresh,
  })
  const moved = pin.latitude !== saved.latitude || pin.longitude !== saved.longitude

  return (
    <div className="flex flex-col gap-3">
      <PinEditor pin={pin} onChange={setPin} radiusM={radiusM} />
      {invalidField(save.error) === 'pin' && (
        <p className="text-sm text-rose-700">{t('admin.pin.outsideIndia')}</p>
      )}
      <ErrorText error={save.error} />
      {moved && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white"
          >
            {t('admin.pin.save')}
          </button>
          <button
            type="button"
            onClick={() => setPin(saved)}
            className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
          >
            {t('admin.pin.undo')}
          </button>
        </div>
      )}
    </div>
  )
}
