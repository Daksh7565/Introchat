import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import {
  type Decision,
  REPORT_STATUSES,
  type ReportRow,
  type ReportStatus,
  reportEvidence,
  resolveReport,
  safetyKeys,
  listReports,
} from './api'

// Ban lengths offered in one tap; null = permanent.
const BAN_CHOICES: (number | null)[] = [7, 30, null]

/** Guests' reports, newest first, with their evidence and the decision (§4.15). */
export function ReportsPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ReportStatus | null>('open')
  const reports = useQuery({
    queryKey: safetyKeys.reports(status),
    queryFn: () => listReports(status),
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('admin.reports.title')}</h2>
        <label className="flex items-center gap-2 text-sm">
          <span>{t('admin.payments.filter')}</span>
          <select
            value={status ?? ''}
            onChange={(event) =>
              setStatus(REPORT_STATUSES.find((s) => s === event.target.value) ?? null)
            }
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="">{t('admin.payments.all')}</option>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.reports.statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {reports.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={reports.error} />
      {reports.data?.length === 0 && <p className="text-slate-500">{t('admin.reports.empty')}</p>}
      <ul className="flex flex-col gap-3">
        {reports.data?.map((report) => (
          <ReportItem key={report.id} report={report} />
        ))}
      </ul>
    </section>
  )
}

function ReportItem({ report }: { report: ReportRow }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [showEvidence, setShowEvidence] = useState(false)
  const [decision, setDecision] = useState<{ kind: Decision; banDays: number | null } | null>(null)
  const [note, setNote] = useState('')
  const evidence = useQuery({
    queryKey: safetyKeys.evidence(report.id),
    queryFn: () => reportEvidence(report.id),
    enabled: showEvidence,
  })
  const resolve = useMutation({
    mutationFn: () =>
      decision === null
        ? Promise.reject(new Error('no decision chosen'))
        : resolveReport(report.id, decision.kind, note.trim(), decision.banDays),
    onSuccess: () => {
      setDecision(null)
      void queryClient.invalidateQueries({ queryKey: safetyKeys.allBans })
      return queryClient.invalidateQueries({ queryKey: safetyKeys.allReports })
    },
  })
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  const decisionLabel = (kind: Decision, banDays: number | null) =>
    kind === 'ban'
      ? banDays === null
        ? t('admin.reports.banPermanent')
        : t('admin.reports.banDays', { count: banDays })
      : t(`admin.reports.decisions.${kind}`)

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {report.reportedHandle} · {t(`admin.reports.reasons.${report.reason}`)}
        </span>
        <span className="text-xs text-slate-500">{when.format(report.createdAt)}</span>
      </div>
      <p className="text-slate-600">
        {report.venueName} ·{' '}
        {t('admin.reports.by', {
          handle: report.reporterHandle ?? t('admin.payments.deletedGuest'),
        })}
        {report.reportedLive && ` · ${t('admin.reports.liveNow')}`}
      </p>
      {report.note && <p className="rounded-lg bg-slate-50 p-2">“{report.note}”</p>}
      {report.status !== 'open' && (
        <p className="text-xs text-slate-500">
          {t(`admin.reports.statuses.${report.status}`)}
          {report.action && ` · ${t(`admin.reports.decisions.${report.action}`)}`}
          {report.reviewNote && ` · ${report.reviewNote}`}
        </p>
      )}

      {report.hasEvidence && (
        <button
          type="button"
          onClick={() => setShowEvidence((open) => !open)}
          className="self-start font-semibold text-teal-700 underline"
        >
          {showEvidence ? t('admin.reports.hideEvidence') : t('admin.reports.showEvidence')}
        </button>
      )}
      {showEvidence && (
        <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
          <ErrorText error={evidence.error} />
          {evidence.data === null && (
            <p className="text-slate-500">{t('admin.reports.evidenceErased')}</p>
          )}
          {evidence.data && (
            <>
              <p className="text-xs text-slate-500">{evidence.data.tags.join(', ')}</p>
              {evidence.data.messages === null ? (
                <p className="text-slate-500">{t('admin.reports.noChat')}</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {evidence.data.messages.map((message, index) => (
                    <li
                      key={index}
                      className={message.from === 'reported' ? 'font-semibold text-rose-900' : ''}
                    >
                      <span className="text-xs text-slate-500">
                        {when.format(message.at)} ·{' '}
                        {message.from === 'reported'
                          ? report.reportedHandle
                          : t('admin.reports.reporter')}
                        :
                      </span>{' '}
                      <span className="whitespace-pre-wrap">{message.body}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}

      {report.status === 'open' && (
        <div className="flex flex-wrap gap-2">
          {(['dismiss', 'kick'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setDecision({ kind, banDays: null })}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold"
            >
              {t(`admin.reports.decisions.${kind}`)}
            </button>
          ))}
          {BAN_CHOICES.map((banDays) => (
            <button
              key={banDays ?? 'permanent'}
              type="button"
              onClick={() => setDecision({ kind: 'ban', banDays })}
              className="rounded-lg border border-rose-300 px-3 py-1.5 font-semibold text-rose-800"
            >
              {decisionLabel('ban', banDays)}
            </button>
          ))}
        </div>
      )}
      {decision && (
        <form
          className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            resolve.mutate()
          }}
        >
          <p className="font-semibold">{decisionLabel(decision.kind, decision.banDays)}</p>
          {decision.kind === 'kick' && <p className="text-xs">{t('admin.reports.kickHelp')}</p>}
          {decision.kind === 'ban' && <p className="text-xs">{t('admin.reports.banHelp')}</p>}
          <label className="flex flex-col gap-1">
            <span>{t('admin.payments.refundNote')}</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
            />
          </label>
          <ErrorText error={resolve.error} />
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={note.trim() === '' || resolve.isPending}
              className="rounded-lg bg-amber-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
            >
              {t('admin.reports.confirm')}
            </button>
            <button
              type="button"
              disabled={resolve.isPending}
              onClick={() => setDecision(null)}
              className="font-semibold text-slate-600"
            >
              {t('admin.payments.cancel')}
            </button>
          </div>
        </form>
      )}
    </li>
  )
}
