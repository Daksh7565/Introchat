import { useTranslation } from 'react-i18next'
import { HandleAvatar } from '../../components/HandleAvatar'
import { TagList } from '../../components/TagList'
import type { IncomingRequest } from '../people/types'

interface RequestListViewProps {
  requests: IncomingRequest[]
  /** Server time "now", so expiry minutes never depend on the phone's clock. */
  now: Date
  onAccept: (requestId: string) => void
  onDecline: (requestId: string) => void
}

export function RequestListView({ requests, now, onAccept, onDecline }: RequestListViewProps) {
  const { t } = useTranslation()

  if (requests.length === 0) {
    return <p className="py-10 text-center text-slate-500">{t('requests.empty')}</p>
  }

  return (
    // Same container rule as the people list: two columns only when this list is wide.
    <div className="@container">
      <ul className="grid gap-3 @2xl:grid-cols-2">
        {requests.map((request) => {
          const minutesLeft = Math.max(
            1,
            Math.ceil((request.expiresAt.getTime() - now.getTime()) / 60000),
          )
          return (
            <li key={request.id} className="rounded-xl border border-teal-200 bg-teal-50/50 p-3">
              <div className="flex gap-3">
                <HandleAvatar handle={request.handle} />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-semibold">{request.handle}</span>{' '}
                    <span className="text-slate-600">{t('requests.wantsToChat')}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('requests.expiresIn', { count: minutesLeft })}
                  </p>
                  <div className="mt-2">
                    <TagList tags={request.tags} sharedTags={request.sharedTags} />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg bg-teal-700 py-2 text-sm font-semibold text-white"
                  onClick={() => onAccept(request.id)}
                >
                  {t('requests.accept')}
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  onClick={() => onDecline(request.id)}
                >
                  {t('requests.decline')}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
