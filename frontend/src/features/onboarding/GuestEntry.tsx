import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ErrorText } from '../../components/ErrorText'
import { AppError } from '../../lib/errors'
import { getReading } from '../../lib/location'
import { useAuthSession } from '../../lib/useAuthSession'
import { GuestLogin } from '../auth/GuestLogin'
import { signOutHere } from '../auth/guestAuth'
import { LIVE_SESSION_KEY, startSession } from '../session/api'
import { getMyProfile, MY_PROFILE_KEY } from './api'
import { NotAGuestView } from './EndViews'
import { Onboarding } from './Onboarding'

interface GuestEntryProps {
  /** The scanned table: the session starts there. */
  slug: string
  qrToken: string
  venueName: string
  onBack: () => void
}

/**
 * Everything after "Continue" on the landing page: log in if needed, then
 * onboarding, resuming wherever this guest left off, then Join. A guest
 * already logged in on this phone goes straight past the login.
 */
export function GuestEntry({ slug, qrToken, venueName, onBack }: GuestEntryProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const session = useAuthSession()
  const userId = session.status === 'signed_in' ? session.userId : null

  const profile = useQuery({
    queryKey: [...MY_PROFILE_KEY, userId],
    queryFn: getMyProfile,
    enabled: userId !== null,
    retry: (failures, error) =>
      error instanceof AppError && error.code === 'NETWORK' && failures < 2,
  })
  const logOut = useMutation({
    mutationFn: signOutHere,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: MY_PROFILE_KEY })
      queryClient.removeQueries({ queryKey: LIVE_SESSION_KEY })
    },
  })
  // A fresh reading right now: the session is decided on it, not on the landing check.
  const join = useMutation({
    mutationFn: async () => startSession(slug, qrToken, await getReading()),
    onSuccess: (state) => {
      queryClient.setQueryData([...LIVE_SESSION_KEY, userId], state)
      void navigate('/')
    },
  })
  const joinProps = {
    venueName,
    joining: join.isPending,
    joinError: join.error,
    onJoin: () => join.mutate(),
  }
  const logOutProps = {
    loggingOut: logOut.isPending,
    logOutError: logOut.error,
    onLogOut: () => logOut.mutate(),
  }

  if (session.status === 'signed_out') {
    return <GuestLogin onBack={onBack} />
  }

  if (session.status === 'loading' || profile.isPending) {
    return (
      <p role="status" className="py-16 text-center text-slate-500">
        {t('onboarding.loading')}
      </p>
    )
  }

  if (profile.isError) {
    if (profile.error instanceof AppError && profile.error.code === 'NOT_A_GUEST') {
      return <NotAGuestView {...logOutProps} />
    }
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
        <ErrorText error={profile.error} />
        <button
          type="button"
          onClick={() => void profile.refetch()}
          className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
        >
          {t('location.retry')}
        </button>
      </section>
    )
  }

  return <Onboarding profile={profile.data} join={joinProps} {...logOutProps} />
}
