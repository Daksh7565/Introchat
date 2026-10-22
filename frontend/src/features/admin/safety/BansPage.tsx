import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { findGuest, type GuestRow } from '../money/api'
import { banGuest, type BanRow, liftBan, listBans, safetyKeys } from './api'

/** Active bans (platform and venue kicks), lifting them, and banning a guest by handle. */
export function BansPage() {
  const { t } = useTranslation()
  const [activeOnly, setActiveOnly] = useState(true)
  const bans = useQuery({
    queryKey: safetyKeys.bans(activeOnly),
    queryFn: () => listBans(activeOnly),
  })

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('admin.bans.title')}</h2>
      <BanByHandle />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(event) => setActiveOnly(event.target.checked)}
          className="h-4 w-4 accent-teal-700"
        />
        <span>{t('admin.bans.activeOnly')}</span>
      </label>
      {bans.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={bans.error} />
      {bans.data?.length === 0 && <p className="text-slate-500">{t('admin.bans.empty')}</p>}
      <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
        {bans.data?.map((ban) => (
          <BanItem key={ban.id} ban={ban} />
        ))}
      </ul>
    </section>
  )
}

function BanItem({ ban }: { ban: BanRow }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [lifting, setLifting] = useState(false)
  const [note, setNote] = useState('')
  const lift = useMutation({
    mutationFn: () => liftBan(ban.id, note.trim()),
    onSuccess: () => {
      setLifting(false)
      return queryClient.invalidateQueries({ queryKey: safetyKeys.allBans })
    },
  })
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  // Read once per row (a render must not read the clock); the server list
  // is re-fetched after every change, which re-creates the row.
  const [now] = useState(() => Date.now())
  const active = ban.liftedAt === null && (ban.expiresAt === null || ban.expiresAt.getTime() > now)

  return (
    <li className="flex flex-col gap-1 p-3 text-sm">
      <p className="font-semibold">
        {ban.guestHandle ?? t('admin.payments.deletedGuest')} ·{' '}
        {ban.scope === 'venue'
          ? t('admin.bans.venueScope', { venue: ban.venueName ?? '' })
          : t('admin.bans.platformScope')}
      </p>
      <p className="text-slate-600">
        {ban.expiresAt === null
          ? t('admin.bans.permanent')
          : t('admin.bans.until', { date: when.format(ban.expiresAt) })}
        {ban.liftedAt && ` · ${t('admin.bans.liftedOn', { date: when.format(ban.liftedAt) })}`}
      </p>
      <p className="text-xs text-slate-500">
        {ban.reason}
        {ban.createdBy && ` · ${ban.createdBy}`}
      </p>
      {active && !lifting && (
        <button
          type="button"
          onClick={() => setLifting(true)}
          className="self-start font-semibold text-slate-700 underline"
        >
          {t('admin.bans.lift')}
        </button>
      )}
      {lifting && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            lift.mutate()
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span>{t('admin.payments.refundNote')}</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
            />
          </label>
          <button
            type="submit"
            disabled={note.trim() === '' || lift.isPending}
            className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
          >
            {t('admin.bans.lift')}
          </button>
          <button
            type="button"
            onClick={() => setLifting(false)}
            className="font-semibold text-slate-600"
          >
            {t('admin.payments.cancel')}
          </button>
          <ErrorText error={lift.error} />
        </form>
      )}
    </li>
  )
}

const BAN_LENGTHS = ['7', '30', 'permanent'] as const

function BanByHandle() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [handle, setHandle] = useState('')
  const [guest, setGuest] = useState<GuestRow | null>(null)
  const [length, setLength] = useState<(typeof BAN_LENGTHS)[number]>('7')
  const [note, setNote] = useState('')
  const find = useMutation({ mutationFn: () => findGuest(handle.trim()), onSuccess: setGuest })
  const ban = useMutation({
    mutationFn: (target: GuestRow) =>
      banGuest(target.userId, length === 'permanent' ? null : Number(length), note.trim()),
    onSuccess: () => {
      setGuest(null)
      setNote('')
      return queryClient.invalidateQueries({ queryKey: safetyKeys.allBans })
    },
  })

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 text-sm">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (handle.trim() !== '') find.mutate()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t('admin.bans.banByHandle')}</span>
          <input
            value={handle}
            placeholder="Mango-4821"
            onChange={(event) => setHandle(event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold"
        >
          {t('admin.guests.find')}
        </button>
      </form>
      <ErrorText error={find.error} />
      {find.isSuccess && guest === null && (
        <p className="text-slate-500">{t('admin.guests.notFound')}</p>
      )}
      {guest && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            ban.mutate(guest)
          }}
        >
          <span className="font-semibold">{guest.handle}</span>
          <select
            aria-label={t('admin.bans.length')}
            value={length}
            onChange={(event) =>
              setLength(BAN_LENGTHS.find((l) => l === event.target.value) ?? '7')
            }
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="7">{t('admin.reports.banDays', { count: 7 })}</option>
            <option value="30">{t('admin.reports.banDays', { count: 30 })}</option>
            <option value="permanent">{t('admin.reports.banPermanent')}</option>
          </select>
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span>{t('admin.payments.refundNote')}</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
            />
          </label>
          <button
            type="submit"
            disabled={note.trim() === '' || ban.isPending}
            className="rounded-lg bg-rose-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
          >
            {t('admin.bans.ban')}
          </button>
          <ErrorText error={ban.error} />
        </form>
      )}
    </div>
  )
}
