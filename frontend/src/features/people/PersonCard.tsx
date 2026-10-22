import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HandleAvatar } from '../../components/HandleAvatar'
import { TagList } from '../../components/TagList'
import type { Person } from './types'

interface PersonCardProps {
  person: Person
  onSendRequest: (sessionId: string) => void
  onAcceptRequest: (sessionId: string) => void
  onOpenChat: (sessionId: string) => void
  onReport: (sessionId: string) => void
  onBlock: (sessionId: string) => void
}

type ActionProps = Pick<
  PersonCardProps,
  'person' | 'onSendRequest' | 'onAcceptRequest' | 'onOpenChat'
>

export function PersonCard({
  person,
  onSendRequest,
  onAcceptRequest,
  onOpenChat,
  onReport,
  onBlock,
}: PersonCardProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <li
      className={`flex gap-3 rounded-xl border border-slate-200 p-3 ${person.online ? '' : 'opacity-60'}`}
    >
      <HandleAvatar handle={person.handle} online={person.online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">{person.handle}</span>
          <span className="flex items-center gap-2">
            {!person.online && (
              <span className="text-xs text-slate-500">{t('people.offline')}</span>
            )}
            <span className="relative">
              <button
                type="button"
                className="px-1 text-lg leading-none text-slate-500"
                aria-label={t('chat.menu')}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋮
              </button>
              {menuOpen && (
                <span className="absolute right-0 z-10 mt-1 flex w-36 flex-col rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="px-3 py-2 text-left text-sm"
                    onClick={() => {
                      setMenuOpen(false)
                      onReport(person.sessionId)
                    }}
                  >
                    {t('chat.report')}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 text-left text-sm text-rose-700"
                    onClick={() => {
                      setMenuOpen(false)
                      onBlock(person.sessionId)
                    }}
                  >
                    {t('chat.block')}
                  </button>
                </span>
              )}
            </span>
          </span>
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

function PersonAction({ person, onSendRequest, onAcceptRequest, onOpenChat }: ActionProps) {
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
