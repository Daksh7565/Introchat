import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'

export type DeletionState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  /** Asked on `since`; an admin completes it within 30 days. */
  | { kind: 'pending'; since: Date }

interface AccountDeletionViewProps {
  state: DeletionState
  busy: boolean
  error: unknown
  onStart: () => void
  onConfirm: () => void
  onBack: () => void
  onCancelRequest: () => void
}

/** "Delete my account" as it looks; AccountDeletionPanel loads and saves the request. */
export function AccountDeletionView({
  state,
  busy,
  error,
  onStart,
  onConfirm,
  onBack,
  onCancelRequest,
}: AccountDeletionViewProps) {
  const { t, i18n } = useTranslation()
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-2 pb-6 text-sm">
      <ErrorText error={error} />
      {state.kind === 'pending' ? (
        <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
          <p>{t('account.pending', { date: day.format(state.since) })}</p>
          <button
            type="button"
            disabled={busy}
            onClick={onCancelRequest}
            className="self-start font-semibold text-teal-700 underline"
          >
            {t('account.cancel')}
          </button>
        </div>
      ) : state.kind === 'confirming' ? (
        <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="font-semibold">{t('account.confirmTitle')}</p>
          <p>{t('account.confirmBody')}</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="rounded-lg bg-rose-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
            >
              {t('account.confirm')}
            </button>
            <button type="button" onClick={onBack} className="font-semibold text-slate-600">
              {t('safety.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onStart} className="self-start text-slate-500 underline">
          {t('account.delete')}
        </button>
      )}
    </section>
  )
}
