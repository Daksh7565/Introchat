import { useTranslation } from 'react-i18next'
import { HandleAvatar } from '../../components/HandleAvatar'
import { TagList } from '../../components/TagList'
import type { Person } from './types'

interface PersonCardProps {
  person: Person
  onSendRequest: (sessionId: string) => void
  onAcceptRequest: (sessionId: string) => void
  onOpenChat: (sessionId: string) => void
}

export function PersonCard({
  person,
  onSendRequest,
  onAcceptRequest,
  onOpenChat,
}: PersonCardProps) {
  const { t } = useTranslation()

  return (
    <li
      className={`flex gap-3 rounded-xl border border-slate-200 p-3 ${person.online ? '' : 'opacity-60'}`}
    >
      <HandleAvatar handle={person.handle} online={person.online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">{person.handle}</span>
          {!person.online && <span className="text-xs text-slate-500">{t('people.offline')}</span>}
        </div>
        {person.sharedTags.length > 0 && (
          <p className="text-xs font-semibold text-teal-700">
            {t('people.inCommon', { count: person.sharedTags.length })}
          </p>
        )}
        <div className="mt-2">
          <TagList tags={person.tags} sharedTags={person.sharedTags} />
        </div>
        <div className="mt-3">
          <PersonAction
            person={person}
            onSendRequest={onSendRequest}
            onAcceptRequest={onAcceptRequest}
            onOpenChat={onOpenChat}
          />
        </div>
      </div>
    </li>
  )
}

function PersonAction({ person, onSendRequest, onAcceptRequest, onOpenChat }: PersonCardProps) {
  const { t } = useTranslation()
  const primary = 'rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white'
  const muted = 'rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-500'

  switch (person.chatState) {
    case 'none':
      return (
        <button type="button" className={primary} onClick={() => onSendRequest(person.sessionId)}>
          {t('people.actions.sayHi')}
        </button>
      )
    case 'request_received':
      return (
        <button type="button" className={primary} onClick={() => onAcceptRequest(person.sessionId)}>
          {t('people.actions.accept')}
        </button>
      )
    case 'chatting':
      return (
        <button
          type="button"
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-semibold text-teal-700"
          onClick={() => onOpenChat(person.sessionId)}
        >
          {t('people.actions.openChat')}
        </button>
      )
    case 'request_sent':
      return (
        <button type="button" className={muted} disabled>
          {t('people.actions.requestSent')}
        </button>
      )
    case 'declined':
      return (
        <button type="button" className={muted} disabled>
          {t('people.actions.notAvailable')}
        </button>
      )
  }
}
