import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'

interface NoteFormProps {
  /** What is about to happen, in one line. */
  title: string
  help?: string
  confirmLabel: string
  pending: boolean
  error: unknown
  onConfirm: (note: string) => void
  onCancel: () => void
}

/**
 * The "say why, then confirm" step every consequential Console action has
 * (kick, close, reopen, delete an account…): the note goes to the audit log.
 */
export function NoteForm({
  title,
  help,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: NoteFormProps) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        if (note.trim() !== '') onConfirm(note.trim())
      }}
    >
      <p className="font-semibold">{title}</p>
      {help && <p className="text-xs">{help}</p>}
      <label className="flex flex-col gap-1">
        <span>{t('admin.payments.refundNote')}</span>
        <input
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <ErrorText error={error} />
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={note.trim() === '' || pending}
          className="rounded-lg bg-amber-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="font-semibold text-slate-600"
        >
          {t('admin.payments.cancel')}
        </button>
      </div>
    </form>
  )
}
