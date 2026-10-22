import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { REPORT_REASONS, type ReportReason } from './api'

const NOTE_MAX = 500

interface SafetyDialogProps {
  mode: 'block' | 'report'
  handle: string
  busy: boolean
  error: unknown
  onBlock: () => void
  onReport: (reason: ReportReason, note: string) => void
  onCancel: () => void
}

/**
 * Confirms a block, or collects a report. Both are final in V1 (no unblock),
 * so the dialog says plainly what will happen before anything is sent.
 */
export function SafetyDialog({
  mode,
  handle,
  busy,
  error,
  onBlock,
  onReport,
  onCancel,
}: SafetyDialogProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-title"
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="safety-title" className="text-lg font-semibold">
          {mode === 'block'
            ? t('safety.blockTitle', { handle })
            : t('safety.reportTitle', { handle })}
        </h2>

        {mode === 'block' ? (
          <p className="text-slate-600">{t('safety.blockBody')}</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{t('safety.reasonLabel')}</legend>
              {REPORT_REASONS.map((option) => (
                <label key={option} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="report-reason"
                    value={option}
                    checked={reason === option}
                    onChange={() => setReason(option)}
                    className="h-4 w-4 accent-teal-700"
                  />
                  <span>{t(`safety.reasons.${option}`)}</span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t('safety.noteLabel')}</span>
              <textarea
                value={note}
                maxLength={NOTE_MAX}
                rows={3}
                onChange={(event) => setNote(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <p className="text-sm text-slate-600">{t('safety.reportBody')}</p>
          </>
        )}

        <ErrorText error={error} />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || (mode === 'report' && reason === null)}
            onClick={() => {
              if (mode === 'block') onBlock()
              else if (reason !== null) onReport(reason, note)
            }}
            className="rounded-xl bg-rose-700 px-4 py-3 font-semibold text-white disabled:bg-slate-300"
          >
            {busy
              ? t('safety.sending')
              : mode === 'block'
                ? t('safety.confirmBlock')
                : t('safety.confirmReport')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="py-2 font-semibold text-slate-600 disabled:text-slate-400"
          >
            {t('safety.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
