import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ErrorText } from '../../../components/ErrorText'
import { formatCountdown, formatPaise } from '../../../lib/format'
import { useNow } from '../../../lib/useNow'
import { adminKeys } from '../venues/api'
import {
  type ClosedVisit,
  closeVenueToday,
  kick,
  type LiveGuest,
  liveGuests,
  opsKeys,
  reopenVenue,
} from './api'
import { NoteForm } from './NoteForm'

// The live list is refreshed this often while the page is open.
const LIVE_REFRESH_MS = 15_000

/** Everyone in the venue now, with a kick for each (§4.16). */
export function LiveGuestsPanel({ venueId }: { venueId: string }) {
  const { t } = useTranslation()
  const guests = useQuery({
    queryKey: opsKeys.live(venueId),
    queryFn: () => liveGuests(venueId),
    refetchInterval: LIVE_REFRESH_MS,
  })
  const now = useNow()

  if (guests.isPending) return <p className="text-slate-500">{t('admin.loading')}</p>
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ErrorText error={guests.error} />
      {guests.data?.length === 0 && <p className="text-slate-500">{t('admin.live.empty')}</p>}
      <ul className="flex flex-col divide-y divide-slate-100">
        {guests.data?.map((guest) => (
          <LiveGuestItem key={guest.sessionId} guest={guest} venueId={venueId} now={now} />
        ))}
      </ul>
    </div>
  )
}

function LiveGuestItem({
  guest,
  venueId,
  now,
}: {
  guest: LiveGuest
  venueId: string
  now: number
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [kicking, setKicking] = useState(false)
  const kickGuest = useMutation({
    mutationFn: (note: string) => kick(guest.sessionId, note),
    onSuccess: () => {
      setKicking(false)
      return queryClient.invalidateQueries({ queryKey: opsKeys.live(venueId) })
    },
  })
  const secondsLeft = Math.max(0, Math.round((guest.expiresAt.getTime() - now) / 1000))
  const state = guest.awaySince
    ? t('admin.live.away')
    : guest.isOffline
      ? t('admin.live.offline')
      : t('admin.live.online')

  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {guest.handle}
          {guest.tableLabel && (
            <span className="font-normal text-slate-500"> · {guest.tableLabel}</span>
          )}
        </span>
        <span className="text-xs text-slate-600">
          {state} · {t('admin.live.timeLeft', { time: formatCountdown(secondsLeft) })} ·{' '}
          {t(`admin.live.kinds.${guest.kind}`)}
          {guest.spoofFlags > 0 && (
            <span className="text-rose-700">
              {' '}
              · {t('admin.live.flags', { count: guest.spoofFlags })}
            </span>
          )}
        </span>
      </div>
      {!kicking ? (
        <button
          type="button"
          onClick={() => setKicking(true)}
          className="self-start text-xs font-semibold text-rose-700 underline"
        >
          {t('admin.live.kick')}
        </button>
      ) : (
        <NoteForm
          title={t('admin.live.kickTitle', { handle: guest.handle })}
          help={t('admin.reports.kickHelp')}
          confirmLabel={t('admin.live.kick')}
          pending={kickGuest.isPending}
          error={kickGuest.error}
          onConfirm={(note) => kickGuest.mutate(note)}
          onCancel={() => setKicking(false)}
        />
      )}
    </li>
  )
}

/** Close for today (or reopen), and the paid visits a closing cut short. */
export function ClosePanel({
  venueId,
  closedUntil,
}: {
  venueId: string
  closedUntil: string | null
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [affected, setAffected] = useState<ClosedVisit[] | null>(null)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.venue(venueId) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.venues }),
      queryClient.invalidateQueries({ queryKey: opsKeys.live(venueId) }),
    ])
  const close = useMutation({
    mutationFn: (note: string) => closeVenueToday(venueId, note),
    onSuccess: (visits) => {
      setConfirming(false)
      setAffected(visits)
      return refresh()
    },
  })
  const reopen = useMutation({
    mutationFn: (note: string) => reopenVenue(venueId, note),
    onSuccess: () => {
      setConfirming(false)
      return refresh()
    },
  })
  const now = useNow(60_000)
  const closedNow = closedUntil !== null && new Date(closedUntil).getTime() > now
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-slate-600">
        {closedNow && closedUntil
          ? t('admin.close.closedUntil', { date: when.format(new Date(closedUntil)) })
          : t('admin.close.help')}
      </p>
      {!confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`self-start rounded-lg px-3 py-1.5 font-semibold ${closedNow ? 'border border-slate-300' : 'bg-rose-700 text-white'}`}
        >
          {closedNow ? t('admin.close.reopen') : t('admin.close.close')}
        </button>
      )}
      {confirming && (
        <NoteForm
          title={closedNow ? t('admin.close.reopen') : t('admin.close.close')}
          help={closedNow ? undefined : t('admin.close.confirmHelp')}
          confirmLabel={closedNow ? t('admin.close.reopen') : t('admin.close.close')}
          pending={close.isPending || reopen.isPending}
          error={close.error ?? reopen.error}
          onConfirm={(note) => (closedNow ? reopen.mutate(note) : close.mutate(note))}
          onCancel={() => setConfirming(false)}
        />
      )}
      {affected && (
        <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
          <p className="font-semibold">
            {affected.length === 0
              ? t('admin.close.noPaid')
              : t('admin.close.paidAffected', { count: affected.length })}
          </p>
          <ul className="flex flex-col gap-1">
            {affected.map((visit) => (
              <li key={visit.sessionId}>
                {visit.handle ?? t('admin.payments.deletedGuest')} ·{' '}
                {t(`admin.live.kinds.${visit.kind}`)}
                {visit.amountPaise !== null &&
                  ` · ${formatPaise(visit.amountPaise, i18n.language)}`}
              </li>
            ))}
          </ul>
          {affected.length > 0 && (
            <p className="text-xs text-slate-600">
              {t('admin.close.refundHint')}{' '}
              <Link to="/admin/payments" className="font-semibold text-teal-700 underline">
                {t('admin.nav.payments')}
              </Link>{' '}
              ·{' '}
              <Link to="/admin/guests" className="font-semibold text-teal-700 underline">
                {t('admin.nav.guests')}
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
