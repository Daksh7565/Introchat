import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { auditLog, opsKeys } from './api'

// Action families worth filtering by; '' = everything.
const FAMILIES = [
  '',
  'venue',
  'report',
  'ban',
  'guest',
  'payment',
  'credits',
  'setting',
  'admin',
  'account',
  'session',
  'sms',
  'tag',
] as const

/** Every admin and system action, newest first (§2.2 audit log), 100 at a time. */
export function AuditPage() {
  const { t, i18n } = useTranslation()
  const [family, setFamily] = useState<(typeof FAMILIES)[number]>('')
  // Paging back: the time of the oldest entry shown so far; null = the newest page.
  const [before, setBefore] = useState<Date | null>(null)
  const prefix = family === '' ? '' : `${family}.`
  const entries = useQuery({
    queryKey: [...opsKeys.audit(prefix), before?.toISOString() ?? 'latest'],
    queryFn: () => auditLog(prefix, before),
  })
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' })
  const last = entries.data?.at(-1)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('admin.audit.title')}</h2>
        <select
          aria-label={t('admin.payments.filter')}
          value={family}
          onChange={(event) => {
            setFamily(FAMILIES.find((f) => f === event.target.value) ?? '')
            setBefore(null)
          }}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
          {FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f === '' ? t('admin.payments.all') : f}
            </option>
          ))}
        </select>
      </div>
      {entries.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={entries.error} />
      <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
        {entries.data?.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-0.5 p-2">
            <p>
              <span className="font-mono text-xs font-semibold">{entry.action}</span>{' '}
              <span className="text-slate-600">
                ·{' '}
                {entry.actor ??
                  t(
                    `admin.audit.actors.${entry.actorType === 'admin' || entry.actorType === 'guest' ? entry.actorType : 'system'}`,
                  )}
              </span>
              {entry.venueName && <span className="text-slate-600"> · {entry.venueName}</span>}
            </p>
            <p className="text-xs text-slate-500">
              {when.format(entry.createdAt)} ·{' '}
              <span className="font-mono">{JSON.stringify(entry.meta)}</span>
            </p>
          </li>
        ))}
      </ul>
      <div className="flex gap-3 text-sm">
        {before !== null && (
          <button
            type="button"
            onClick={() => setBefore(null)}
            className="font-semibold text-teal-700 underline"
          >
            {t('admin.audit.newest')}
          </button>
        )}
        {last && entries.data?.length === 100 && (
          <button
            type="button"
            onClick={() => setBefore(last.createdAt)}
            className="font-semibold text-teal-700 underline"
          >
            {t('admin.audit.older')}
          </button>
        )}
      </div>
    </section>
  )
}
