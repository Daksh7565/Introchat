import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { LegalLinks } from '../../components/LegalLinks'
import { AppError } from '../../lib/errors'
import { useAuthSession } from '../../lib/useAuthSession'
import { getMySession, LIVE_SESSION_KEY, type SessionState } from '../session/api'
import { SessionEndedView } from '../session/SessionEndedView'
import { SessionHome } from '../session/SessionHome'

/**
 * The root URL, and where the installed app opens. A guest with a live
 * session sees it here (timer, tabs); one whose session ended recently sees
 * why; everyone else is asked to scan the QR code on their table.
 */
export function HomePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const auth = useAuthSession()
  const userId = auth.status === 'signed_in' ? auth.userId : null
  const queryKey = [...LIVE_SESSION_KEY, userId]

  const session = useQuery({
    queryKey,
    queryFn: getMySession,
    enabled: userId !== null,
    retry: (failures, error) =>
      error instanceof AppError && error.code === 'NETWORK' && failures < 2,
  })
  const { refetch } = session
  const onRefresh = useCallback(() => void refetch(), [refetch])

  if (auth.status === 'loading' || (userId !== null && session.isPending)) {
    return (
      <p role="status" className="py-16 text-center text-slate-500">
        {t('session.loading')}
      </p>
    )
  }

  // A banned guest is refused on every call (BANNED): say so, plainly.
  if (session.error instanceof AppError && session.error.code === 'BANNED') {
    return <SessionEndedView reason="banned" chatsDeleted={false} />
  }

  // An admin account (NOT_A_GUEST) or no session: the way in is a table QR.
  const notAGuest = session.error instanceof AppError && session.error.code === 'NOT_A_GUEST'
  if (session.isError && !notAGuest) {
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
        <ErrorText error={session.error} />
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
        >
          {t('location.retry')}
        </button>
      </section>
    )
  }

  const state = session.data ?? null
  if (state === null || notAGuest) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
        <p className="text-slate-600">{t('home.scanPrompt')}</p>
        <div className="mt-auto pt-8">
          <LegalLinks />
        </div>
      </section>
    )
  }

  if (state.status === 'ended') {
    // Subscribers (scans left) keep their chats; everyone else's go (decision 10).
    return (
      <SessionEndedView
        reason={state.endReason ?? 'expired'}
        chatsDeleted={state.scanCredits === 0}
      />
    )
  }

  return (
    <SessionHome
      userId={userId ?? ''}
      state={state}
      onState={(next: SessionState) => queryClient.setQueryData(queryKey, next)}
      onRefresh={onRefresh}
    />
  )
}
