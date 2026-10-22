import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import {
  DELETION_STATUSES,
  type DeletionRequest,
  type DeletionStatus,
  deletionRequests,
  opsKeys,
  processDeletion,
} from './api'
import { NoteForm } from './NoteForm'

// Requests must be completed within this many days (§11).
const DEADLINE_DAYS = 30

/** Guests' account deletion requests: check, then delete (§11). */
export function DeletionsPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<DeletionStatus | null>('pending')
  const requests = useQuery({
    queryKey: opsKeys.deletions(status),
    queryFn: () => deletionRequests(status),
  })
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('admin.deletions.title')}</h2>
        <select
          aria-label={t('admin.payments.filter')}
          value={status ?? ''}
          onChange={(event) =>
            setStatus(DELETION_STATUSES.find((s) => s === event.target.value) ?? null)
          }
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">{t('admin.payments.all')}</option>
          {DELETION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`admin.deletions.statuses.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-slate-600">
        {t('admin.deletions.help', { count: DEADLINE_DAYS })}
      </p>
      {requests.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={requests.error} />
      {requests.data?.length === 0 && (
        <p className="text-slate-500">{t('admin.deletions.empty')}</p>
      )}
      <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
        {requests.data?.map((request) => (
          <DeletionItem key={request.id} request={request} />
        ))}
      </ul>
    </section>
  )
}

function DeletionItem({ request }: { request: DeletionRequest }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const process = useMutation({
    mutationFn: (note: string) => processDeletion(request.id, note),
    onSuccess: () => {
      setConfirming(false)
      return queryClient.invalidateQueries({ queryKey: opsKeys.allDeletions })
    },
  })
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })
  const deadline = new Date(request.requestedAt.getTime() + DEADLINE_DAYS * 86_400_000)

  return (
    <li className="flex flex-col gap-1 p-3 text-sm">
      <p className="font-semibold">{request.handle}</p>
      <p className="text-slate-600">
        {t('admin.deletions.requested', { date: day.format(request.requestedAt) })}
        {request.status === 'pending' &&
          ` · ${t('admin.deletions.deadline', { date: day.format(deadline) })}`}
        {request.processedAt &&
          ` · ${t(`admin.deletions.statuses.${request.status}`)} ${day.format(request.processedAt)}`}
      </p>
      {request.openReports > 0 && (
        <p className="text-amber-900">
          {t('admin.deletions.openReports', { count: request.openReports })}
        </p>
      )}
      {request.activeBan && <p className="text-amber-900">{t('admin.deletions.banned')}</p>}
      {request.note && <p className="text-xs text-slate-500">{request.note}</p>}
      {request.status === 'pending' && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start font-semibold text-rose-700 underline"
        >
          {t('admin.deletions.delete')}
        </button>
      )}
      {confirming && (
        <NoteForm
          title={t('admin.deletions.confirmTitle', { handle: request.handle })}
          help={t('admin.deletions.confirmHelp')}
          confirmLabel={t('admin.deletions.delete')}
          pending={process.isPending}
          error={process.error}
          onConfirm={(note) => process.mutate(note)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  )
}
