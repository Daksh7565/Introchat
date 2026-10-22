import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'

interface PushPromptViewProps {
  /** 'needs_install': an iPhone that only gets notifications once IntroChat is on the Home Screen. */
  variant: 'ask' | 'needs_install'
  working: boolean
  error: unknown
  onTurnOn: () => void
  onClose: () => void
}

/** The notification offer as it looks; PushPrompt decides when to show it. */
export function PushPromptView({
  variant,
  working,
  error,
  onTurnOn,
  onClose,
}: PushPromptViewProps) {
  const { t } = useTranslation()

  if (variant === 'needs_install') {
    return (
      <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm">
        <p className="font-semibold">{t('push.installTitle')}</p>
        <p className="mt-1 text-slate-700">{t('push.installBody')}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
          <li>{t('push.installStep1')}</li>
          <li>{t('push.installStep2')}</li>
          <li>{t('push.installStep3')}</li>
        </ol>
        <button type="button" onClick={onClose} className="mt-3 font-semibold text-teal-800">
          {t('push.gotIt')}
        </button>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm">
      <p className="font-semibold">{t('push.askTitle')}</p>
      <p className="mt-1 text-slate-700">{t('push.askBody')}</p>
      <ErrorText error={error} />
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={working}
          onClick={onTurnOn}
          className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:bg-slate-300"
        >
          {t('push.turnOn')}
        </button>
        <button type="button" onClick={onClose} className="font-semibold text-slate-600">
          {t('push.notNow')}
        </button>
      </div>
    </section>
  )
}
