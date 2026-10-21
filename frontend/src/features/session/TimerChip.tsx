import { useTranslation } from 'react-i18next'
import { formatCountdown } from '../../lib/format'

interface TimerChipProps {
  /** Computed from the server's expires_at and the server-clock offset, never the phone clock alone. */
  secondsLeft: number
  /** Inside the warning window: the chip turns amber. */
  warning: boolean
}

export function TimerChip({ secondsLeft, warning }: TimerChipProps) {
  const { t } = useTranslation()
  return (
    <span
      role="timer"
      className={`rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${
        warning ? 'bg-amber-100 text-amber-900' : 'bg-teal-50 text-teal-800'
      }`}
    >
      {t('session.timeLeft', { time: formatCountdown(secondsLeft) })}
    </span>
  )
}
