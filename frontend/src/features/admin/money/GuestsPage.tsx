import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { findGuest, type GuestRow, grantScans, moneyKeys } from './api'

const MAX_GRANT = 100

/** Find a guest by their public handle and grant scans (goodwill, a problem fixed). */
export function GuestsPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState<string | null>(null)
  const guest = useQuery({
    queryKey: moneyKeys.guest(searched ?? ''),
    queryFn: () => findGuest(searched ?? ''),
    enabled: searched !== null,
  })

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('admin.guests.title')}</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (query.trim() !== '') setSearched(query.trim())
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t('admin.guests.handle')}</span>
          <input
            value={query}
            placeholder="Mango-4821"
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
        >
          {t('admin.guests.find')}
        </button>
      </form>

      {guest.isFetching && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={guest.error} />
      {guest.data === null && <p className="text-slate-500">{t('admin.guests.notFound')}</p>}
      {guest.data && (
        <GuestCard
          key={guest.data.userId}
          guest={guest.data}
          onChanged={() => void guest.refetch()}
        />
      )}
    </section>
  )
}

function GuestCard({ guest, onChanged }: { guest: GuestRow; onChanged: () => void }) {
  const { t, i18n } = useTranslation()
  const [scans, setScans] = useState('1')
  const [note, setNote] = useState('')
  const count = Number(scans)
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX_GRANT && note.trim() !== ''
  const grant = useMutation({
    mutationFn: () => grantScans(guest.userId, count, note.trim()),
    onSuccess: () => {
      setNote('')
      onChanged()
    },
  })
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <div>
        <p className="text-lg font-semibold">{guest.handle}</p>
        <p className="text-sm text-slate-600">
          {t('admin.guests.scans', { count: guest.scanCredits })} ·{' '}
          {t('admin.guests.joined', { date: day.format(guest.joinedAt) })}
          {guest.lastVisitAt &&
            ` · ${t('admin.guests.lastVisit', { date: day.format(guest.lastVisitAt) })}`}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) grant.mutate()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t('admin.guests.grantScans')}</span>
          <input
            inputMode="numeric"
            value={scans}
            onChange={(event) => setScans(event.target.value.replace(/\D/g, ''))}
            className="w-20 rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{t('admin.guests.reason')}</span>
          <input
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button
          type="submit"
          disabled={!valid || grant.isPending}
          className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
        >
          {t('admin.guests.grant')}
        </button>
      </form>
      <ErrorText error={grant.error} />
      {grant.isSuccess && (
        <p className="text-sm text-emerald-700">
          {t('admin.guests.granted', { count: grant.data })}
        </p>
      )}
    </div>
  )
}
