import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { PRIMARY_BUTTON, StepCard } from '../../components/StepCard'
import { AppError } from '../../lib/errors'
import { parseIndianMobile } from './phone'

interface PhoneStepProps {
  /** Prefilled when the guest comes back with "Change number". */
  initialMobile?: string
  sending: boolean
  error: unknown
  /** Called with the 10-digit number. */
  onSubmit: (mobile: string) => void
  onBack: () => void
}

export function PhoneStep({
  initialMobile = '',
  sending,
  error,
  onSubmit,
  onBack,
}: PhoneStepProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialMobile)
  const [invalid, setInvalid] = useState(false)

  return (
    <StepCard title={t('auth.phoneTitle')} onBack={onBack}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const mobile = parseIndianMobile(value)
          setInvalid(mobile === null)
          if (mobile !== null) onSubmit(mobile)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="guest-phone" className="font-semibold">
            {t('auth.phoneLabel')}
          </label>
          <div className="flex rounded-lg border border-slate-300 focus-within:border-teal-600">
            <span
              aria-hidden="true"
              className="border-r border-slate-200 px-3 py-2.5 text-slate-600"
            >
              +91
            </span>
            <input
              id="guest-phone"
              aria-describedby="guest-phone-help"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              // Room for spaces and a leading +91 or 0 pasted from contacts.
              maxLength={16}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setInvalid(false)
              }}
              aria-invalid={invalid}
              className="min-w-0 flex-1 rounded-r-lg px-3 py-2.5 text-base focus:outline-none"
            />
          </div>
        </div>
        <p id="guest-phone-help" className="text-sm text-slate-600">
          {t('auth.phoneHelp')}
        </p>
        <ErrorText error={invalid ? new AppError('PHONE_INVALID') : error} />
        <button type="submit" disabled={sending} className={PRIMARY_BUTTON}>
          {sending ? t('auth.sending') : t('auth.sendCode')}
        </button>
      </form>
    </StepCard>
  )
}
