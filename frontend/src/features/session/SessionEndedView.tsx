import { useTranslation } from 'react-i18next'
import type { SessionEndReason } from './types'

interface SessionEndedViewProps {
  reason: SessionEndReason
  /** Non-subscribers lose this visit's chats when the session ends (decision 10). */
  chatsDeleted: boolean
}

export function SessionEndedView({ reason, chatsDeleted }: SessionEndedViewProps) {
  const { t } = useTranslation()
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">{t('ended.title')}</h1>
      <p className="text-slate-700">{t(`ended.reasons.${reason}`)}</p>
      {chatsDeleted && <p className="text-sm text-slate-500">{t('ended.chatsDeleted')}</p>}
      {reason !== 'banned' && <p className="mt-4 text-slate-600">{t('ended.scanAgain')}</p>}
    </section>
  )
}
