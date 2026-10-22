import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { HandleAvatar } from '../../components/HandleAvatar'
import { PRIMARY_BUTTON, StepCard } from '../../components/StepCard'
import { TagList } from '../../components/TagList'

interface LogOutProps {
  loggingOut: boolean
  logOutError: unknown
  onLogOut: () => void
}

function LogOutButton({ loggingOut, onLogOut }: Omit<LogOutProps, 'logOutError'>) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      disabled={loggingOut}
      onClick={onLogOut}
      className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 disabled:text-slate-400"
    >
      {loggingOut ? t('auth.loggingOut') : t('auth.logOut')}
    </button>
  )
}

interface ReadyViewProps extends LogOutProps {
  handle: string
  tags: string[]
  venueName: string
  joining: boolean
  joinError: unknown
  /** Starts the session (a fresh location reading, then start_session). */
  onJoin: () => void
}

/** The end of onboarding, and where a returning guest lands straight away. */
export function ReadyView({
  handle,
  tags,
  venueName,
  joining,
  joinError,
  onJoin,
  ...logOut
}: ReadyViewProps) {
  const { t } = useTranslation()
  return (
    <StepCard title={t('onboarding.ready.title', { handle })}>
      <div className="flex items-center gap-4 rounded-2xl bg-teal-50 p-4">
        <HandleAvatar handle={handle} size="lg" />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-lg font-semibold">{handle}</p>
          <TagList tags={tags} sharedTags={[]} />
        </div>
      </div>
      <p className="text-slate-600">{t('onboarding.ready.body')}</p>
      <ErrorText error={joinError ?? logOut.logOutError} />
      <button type="button" disabled={joining} onClick={onJoin} className={PRIMARY_BUTTON}>
        {joining ? t('onboarding.ready.joining') : t('onboarding.ready.join', { venue: venueName })}
      </button>
      <LogOutButton loggingOut={logOut.loggingOut} onLogOut={logOut.onLogOut} />
    </StepCard>
  )
}

/** Shown for good to a guest who gave a birth year under 18 (the server records it). */
export function UnderAgeView(logOut: LogOutProps) {
  const { t } = useTranslation()
  return (
    <StepCard title={t('onboarding.underAge.title')}>
      <p className="text-slate-600">{t('onboarding.underAge.body')}</p>
      <ErrorText error={logOut.logOutError} />
      <LogOutButton loggingOut={logOut.loggingOut} onLogOut={logOut.onLogOut} />
    </StepCard>
  )
}

/** This browser is signed in with an account that is not a guest, e.g. an admin's. */
export function NotAGuestView(logOut: LogOutProps) {
  const { t } = useTranslation()
  return (
    <StepCard title={t('onboarding.notAGuest.title')}>
      <p className="text-slate-600">{t('onboarding.notAGuest.body')}</p>
      <ErrorText error={logOut.logOutError} />
      <LogOutButton loggingOut={logOut.loggingOut} onLogOut={logOut.onLogOut} />
    </StepCard>
  )
}
