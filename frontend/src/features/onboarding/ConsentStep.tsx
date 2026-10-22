import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { PRIMARY_BUTTON, StepCard } from '../../components/StepCard'

// The notice itself, version CONSENT_VERSION (rules.ts). Draft wording: needs
// legal review before the pilot (IMPLEMENTATION_PLAN §6).
const POINTS = ['phone', 'location', 'anonymous', 'chats', 'adults'] as const

interface ConsentStepProps {
  stepLabel: string
  saving: boolean
  error: unknown
  onAccept: () => void
}

export function ConsentStep({ stepLabel, saving, error, onAccept }: ConsentStepProps) {
  const { t } = useTranslation()
  const [agreed, setAgreed] = useState(false)

  return (
    <StepCard title={t('onboarding.consent.title')} stepLabel={stepLabel}>
      <ul className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
        {POINTS.map((point) => (
          <li key={point} className="flex gap-2 text-sm text-slate-700">
            <span aria-hidden="true" className="text-teal-700">
              •
            </span>
            <span>{t(`onboarding.consent.points.${point}`)}</span>
          </li>
        ))}
      </ul>
      {/* Plain links, not a sentence with links inside (Trans): that one
          component would add 2 KB to every guest's first download. A new tab,
          so reading them does not lose this step. */}
      <p className="flex flex-wrap gap-x-3 text-sm text-slate-600">
        <span>{t('onboarding.consent.policies.lead')}</span>
        <a href="/privacy" target="_blank" rel="noopener" className="underline">
          {t('onboarding.consent.policies.privacy')}
        </a>
        <a href="/terms" target="_blank" rel="noopener" className="underline">
          {t('onboarding.consent.policies.terms')}
        </a>
      </p>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-teal-700"
        />
        <span>{t('onboarding.consent.agree')}</span>
      </label>
      <ErrorText error={error} />
      <button
        type="button"
        disabled={!agreed || saving}
        onClick={onAccept}
        className={PRIMARY_BUTTON}
      >
        {saving ? t('onboarding.saving') : t('onboarding.consent.continue')}
      </button>
    </StepCard>
  )
}
