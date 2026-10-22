import { useTranslation } from 'react-i18next'
import { PersonCard } from './PersonCard'
import type { Person } from './types'

interface PeopleListViewProps {
  /** Already sorted by the server: online first, most shared tags, newest (ARCHITECTURE §4.7). */
  people: Person[]
  onSendRequest: (sessionId: string) => void
  onAcceptRequest: (sessionId: string) => void
  onOpenChat: (sessionId: string) => void
  onReport: (sessionId: string) => void
  onBlock: (sessionId: string) => void
}

export function PeopleListView({ people, ...actions }: PeopleListViewProps) {
  const { t } = useTranslation()

  if (people.length === 0) {
    return <p className="py-10 text-center text-slate-500">{t('people.empty')}</p>
  }

  return (
    // Container query, not a screen breakpoint: two columns when this list itself
    // is wide (tablet), one column in the desktop left pane, which is narrow.
    <div className="@container flex flex-col gap-3">
      <p className="text-sm text-slate-500">{t('people.hereNow', { count: people.length })}</p>
      <ul className="grid gap-3 @2xl:grid-cols-2">
        {people.map((person) => (
          <PersonCard key={person.sessionId} person={person} {...actions} />
        ))}
      </ul>
    </div>
  )
}
