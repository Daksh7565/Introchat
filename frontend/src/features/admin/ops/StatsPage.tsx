import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { formatPaise } from '../../../lib/format'
import { adminKeys, listVenues } from '../venues/api'
import { opsKeys, stats } from './api'

// Dates are India dates (YYYY-MM-DD): the venues are in India, and stats are
// counted in each venue's own timezone on the server.
function indiaDate(offsetDays: number): string {
  const day = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(day)
}

/** Visits, people, requests, reports and money for a venue (or all) over a date range. */
export function StatsPage() {
  const { t, i18n } = useTranslation()
  const [venueId, setVenueId] = useState<string | null>(null)
  const [from, setFrom] = useState(() => indiaDate(-6))
  const [to, setTo] = useState(() => indiaDate(0))
  const venues = useQuery({ queryKey: adminKeys.venues, queryFn: listVenues })
  const result = useQuery({
    queryKey: opsKeys.stats(venueId, from, to),
    queryFn: () => stats(venueId, from, to),
    enabled: from !== '' && to !== '' && from <= to,
  })
  const data = result.data
  const tiles: [string, string][] = data
    ? [
        [t('admin.stats.visits'), String(data.visits)],
        [t('admin.stats.uniqueGuests'), String(data.uniqueGuests)],
        [
          t('admin.stats.avgVisit'),
          data.avgVisitMinutes === null
            ? '–'
            : t('admin.stats.minutes', { count: data.avgVisitMinutes }),
        ],
        [t('admin.stats.requests'), `${data.requestsAccepted} / ${data.requestsSent}`],
        [t('admin.stats.reports'), String(data.reports)],
        [
          t('admin.stats.revenue'),
          formatPaise(data.revenuePaise - data.refundedPaise, i18n.language),
        ],
        [t('admin.stats.payments'), String(data.payments)],
        [
          t('admin.stats.gender'),
          t('admin.stats.genderSplit', {
            female: data.guestsFemale,
            male: data.guestsMale,
            other: data.guestsOther,
            undisclosed: data.guestsUndisclosed,
          }),
        ],
      ]
    : []

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('admin.stats.title')}</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t('admin.stats.venue')}</span>
          <select
            value={venueId ?? ''}
            onChange={(event) => setVenueId(event.target.value === '' ? null : event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="">{t('admin.stats.allVenues')}</option>
            {venues.data?.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t('admin.stats.from')}</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t('admin.stats.to')}</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
      </div>
      {result.isFetching && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={result.error ?? venues.error} />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 p-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">{t('admin.stats.noMessages')}</p>
    </section>
  )
}
