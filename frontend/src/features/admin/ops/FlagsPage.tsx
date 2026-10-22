import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { banGuest, safetyKeys } from '../safety/api'
import { type FlaggedVisit, kick, opsKeys, spoofFlags } from './api'
import { NoteForm } from './NoteForm'

const FLAG_TYPES = ['speed', 'zero_accuracy', 'repeated_position'] as const
type FlagType = (typeof FLAG_TYPES)[number]
const isFlagType = (value: string): value is FlagType =>
  (FLAG_TYPES as readonly string[]).includes(value)

/**
 * Visits whose location readings looked faked (§3.4), last 7 days. Flags are
 * signals for a person to judge, never automatic: a weak GPS can trip them.
 */
export function FlagsPage() {
  const { t } = useTranslation()
  const visits = useQuery({ queryKey: opsKeys.flags, queryFn: spoofFlags })
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('admin.flags.title')}</h2>
      <p className="text-sm text-slate-600">{t('admin.flags.help')}</p>
      {visits.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={visits.error} />
      {visits.data?.length === 0 && <p className="text-slate-500">{t('admin.flags.empty')}</p>}
      <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
        {visits.data?.map((visit) => (
          <FlaggedItem key={visit.sessionId} visit={visit} />
        ))}
      </ul>
    </section>
  )
}

function FlaggedItem({ visit }: { visit: FlaggedVisit }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<'kick' | 'ban' | null>(null)
  const done = () => {
    setAction(null)
    void queryClient.invalidateQueries({ queryKey: safetyKeys.allBans })
    return queryClient.invalidateQueries({ queryKey: opsKeys.flags })
  }
  const kickVisit = useMutation({
    mutationFn: (note: string) => kick(visit.sessionId, note),
    onSuccess: done,
  })
  const ban = useMutation({
    mutationFn: (note: string) => banGuest(visit.userId, 7, note),
    onSuccess: done,
  })
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <li className="flex flex-col gap-1 p-3 text-sm">
      <p className="font-semibold">
        {visit.handle} · {visit.venueName}
        {visit.live && (
          <span className="font-normal text-teal-700"> · {t('admin.reports.liveNow')}</span>
        )}
      </p>
      <p className="text-slate-600">
        {when.format(visit.startedAt)} ·{' '}
        {visit.flags
          .map((flag) => (isFlagType(flag) ? t(`admin.flags.types.${flag}`) : flag))
          .join(', ')}
      </p>
      {visit.startDistanceM !== null && (
        <p className="text-xs text-slate-500">
          {t('admin.flags.atStart', {
            distance: visit.startDistanceM,
            accuracy: visit.startAccuracyM ?? '?',
          })}
        </p>
      )}
      {action === null && (
        <div className="flex gap-3">
          {visit.live && (
            <button
              type="button"
              onClick={() => setAction('kick')}
              className="font-semibold text-rose-700 underline"
            >
              {t('admin.live.kick')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAction('ban')}
            className="font-semibold text-rose-700 underline"
          >
            {t('admin.reports.banDays', { count: 7 })}
          </button>
        </div>
      )}
      {action && (
        <NoteForm
          title={
            action === 'kick'
              ? t('admin.live.kickTitle', { handle: visit.handle })
              : t('admin.reports.banDays', { count: 7 })
          }
          help={action === 'kick' ? t('admin.reports.kickHelp') : t('admin.reports.banHelp')}
          confirmLabel={t('admin.reports.confirm')}
          pending={kickVisit.isPending || ban.isPending}
          error={kickVisit.error ?? ban.error}
          onConfirm={(note) => (action === 'kick' ? kickVisit.mutate(note) : ban.mutate(note))}
          onCancel={() => setAction(null)}
        />
      )}
    </li>
  )
}
