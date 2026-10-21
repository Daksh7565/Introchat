import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type HomeTab = 'people' | 'requests' | 'chats'

interface GuestHomeViewProps {
  venueName: string
  activeTab: HomeTab
  onTabChange: (tab: HomeTab) => void
  requestCount: number
  unreadCount: number
  timer: ReactNode
  children: ReactNode
  /**
   * Desktop only (lg and up): the right-hand pane, usually the open chat.
   * Omit it on phones and tablets, where a chat opens as its own screen.
   * `null` shows the "pick a chat" placeholder.
   */
  detail?: ReactNode
}

/**
 * The guest's main screen during a session: venue, timer and the three tabs.
 * Phone / tablet: one column. Desktop: lists on the left, chat on the right.
 */
export function GuestHomeView({
  venueName,
  activeTab,
  onTabChange,
  requestCount,
  unreadCount,
  timer,
  children,
  detail,
}: GuestHomeViewProps) {
  const { t } = useTranslation()
  const tabs: { id: HomeTab; label: string; badge: number }[] = [
    { id: 'people', label: t('home.tabs.people'), badge: 0 },
    { id: 'requests', label: t('home.tabs.requests'), badge: requestCount },
    { id: 'chats', label: t('home.tabs.chats'), badge: unreadCount },
  ]
  const twoPane = detail !== undefined

  return (
    <section
      className={`flex flex-1 flex-col gap-4 ${twoPane ? 'lg:grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:gap-6' : ''}`}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-slate-700">{venueName}</span>
          {timer}
        </div>
        <div role="tablist" className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold ${
                activeTab === tab.id ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              {tab.label}
              {tab.badge > 0 && (
                <span className="rounded-full bg-teal-600 px-1.5 text-xs text-white">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          className={twoPane ? 'lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto' : ''}
        >
          {children}
        </div>
      </div>

      {twoPane && (
        <div className="hidden min-h-0 rounded-2xl border border-slate-200 p-4 lg:flex lg:h-[calc(100dvh-7rem)] lg:flex-col">
          {detail ?? (
            <p className="m-auto max-w-xs text-center text-slate-500">{t('chats.selectPrompt')}</p>
          )}
        </div>
      )}
    </section>
  )
}
