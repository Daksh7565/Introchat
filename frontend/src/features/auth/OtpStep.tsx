import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { PRIMARY_BUTTON, StepCard, TEXT_INPUT } from '../../components/StepCard'
import { formatCountdown } from '../../lib/format'
import { formatMobile } from './phone'

// Supabase refuses a new code for the same number within 60 s
// (auth.sms.max_frequency in supabase/config.toml); keep the two equal.
export const RESEND_AFTER_SECONDS = 60
const CODE_LENGTH = 6

interface OtpStepProps {
  mobile: string
  /** When the last code was sent (Date.now()), for the resend countdown. */
  sentAt: number
  verifying: boolean
  resending: boolean
  /** The verify or resend failure to show, whichever happened last. */
  error: unknown
  onVerify: (code: string) => void
  onResend: () => void
  onChangeNumber: () => void
}

function secondsUntilResend(sentAt: number): number {
  return Math.max(0, RESEND_AFTER_SECONDS - Math.floor((Date.now() - sentAt) / 1000))
}

export function OtpStep({
  mobile,
  sentAt,
  verifying,
  resending,
  error,
  onVerify,
  onResend,
  onChangeNumber,
}: OtpStepProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [waitSeconds, setWaitSeconds] = useState(() => secondsUntilResend(sentAt))

  // The parent remounts this step for every code sent (key={sentAt}), so the
  // field and the countdown start fresh with each new code.
  useEffect(() => {
    const id = window.setInterval(() => setWaitSeconds(secondsUntilResend(sentAt)), 1000)
    return () => window.clearInterval(id)
  }, [sentAt])

  return (
    <StepCard title={t('auth.codeTitle')} onBack={onChangeNumber}>
      <p className="text-slate-600">{t('auth.codeSentTo', { phone: formatMobile(mobile) })}</p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (code.length === CODE_LENGTH) onVerify(code)
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">{t('auth.codeLabel')}</span>
          <input
            type="text"
            inputMode="numeric"
            // Lets iPhone and Android offer the code straight from the SMS.
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
              setCode(digits)
              // Submit as soon as the last digit arrives (typed or autofilled).
              if (digits.length === CODE_LENGTH && !verifying) onVerify(digits)
            }}
            className={`${TEXT_INPUT} text-center text-2xl tracking-[0.5em]`}
          />
        </label>
        <ErrorText error={error} />
        <button
          type="submit"
          disabled={verifying || code.length !== CODE_LENGTH}
          className={PRIMARY_BUTTON}
        >
          {verifying ? t('auth.verifying') : t('auth.verify')}
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {waitSeconds > 0 ? (
          <span className="text-slate-500">
            {t('auth.resendIn', { time: formatCountdown(waitSeconds) })}
          </span>
        ) : (
          <button
            type="button"
            disabled={resending}
            onClick={onResend}
            className="font-semibold text-teal-700 disabled:text-slate-400"
          >
            {resending ? t('auth.sending') : t('auth.resend')}
          </button>
        )}
        <button type="button" onClick={onChangeNumber} className="font-semibold text-teal-700">
          {t('auth.changeNumber')}
        </button>
      </div>
    </StepCard>
  )
}
