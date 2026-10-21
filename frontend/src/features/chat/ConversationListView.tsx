import { useTranslation } from 'react-i18next'
import { HandleAvatar } from '../../components/HandleAvatar'
import { formatClockTime } from '../../lib/format'
import type { ConversationSummary } from '../people/types'

interface ConversationListViewProps {
  conversations: ConversationSummary[]
  onOpen: (conversationId: string) => void
}

export function ConversationListView({ conversations, onOpen }: ConversationListViewProps) {
  const { t, i18n } = useTranslation()

  if (conversations.length === 0) {
    return <p className="py-10 text-center text-slate-500">{t('chats.empty')}</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <button
            type="button"
            onClick={() => onOpen(conversation.id)}
            className="flex w-full items-center gap-3 py-3 text-left"
          >
            <HandleAvatar handle={conversation.partnerHandle} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{conversation.partnerHandle}</span>
                {conversation.lastMessageAt && (
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatClockTime(conversation.lastMessageAt, i18n.language)}
                  </span>
                )}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-slate-600">
                  {conversation.lastMessage ?? t('chats.noMessages')}
                </span>
                {!conversation.canSend && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {t('chats.left')}
                  </span>
                )}
                {conversation.canSend && conversation.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-teal-600 px-2 py-0.5 text-xs font-semibold text-white">
                    {conversation.unread}
                  </span>
                )}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
