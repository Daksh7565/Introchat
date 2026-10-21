import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { PRIMARY_BUTTON, StepCard, TEXT_INPUT } from '../../components/StepCard'
import { GENDERS, type Gender } from './api'
import { parseBirthYear } from './rules'

export interface ProfileAnswers {
  birthYear: number
  nickname: string
  gender: Gender | null
}

interface ProfileStepProps {
  stepLabel: string
  /** This year, in India (the server checks the age the same way). */
  currentYear: number
  saving: boolean
  error: unknown
  onSubmit: (answers: ProfileAnswers) => void
}

const NICKNAME_MAX = 30

export function ProfileStep({ stepLabel, currentYear, saving, error, onSubmit }: ProfileStepProps) {
  const { t } = useTranslation()
  const [year, setYear] = useState('')
  const [yearInvalid, setYearInvalid] = useState(false)
  const [nickname, setNickname] = useState('')
  const [gender, setGender] = useState<Gender | null>(null)

  return (
    <StepCard title={t('onboarding.profile.title')} stepLabel={stepLabel}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          const birthYear = parseBirthYear(year, currentYear)
          setYearInvalid(birthYear === null)
          if (birthYear !== null) onSubmit({ birthYear, nickname: nickname.trim(), gender })
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-birth-year" className="font-semibold">
            {t('onboarding.profile.birthYear')}
          </label>
          <input
            id="profile-birth-year"
            aria-describedby="profile-birth-year-help"
            type="text"
            inputMode="numeric"
            autoComplete="bday-year"
            maxLength={4}
            placeholder={t('onboarding.profile.birthYearPlaceholder')}
            value={year}
            onChange={(event) => {
              setYear(event.target.value.replace(/\D/g, ''))
              setYearInvalid(false)
            }}
            aria-invalid={yearInvalid}
            className={`${TEXT_INPUT} max-w-40`}
          />
          <span
            id="profile-birth-year-help"
            className={`text-sm ${yearInvalid ? 'text-rose-700' : 'text-slate-600'}`}
          >
            {yearInvalid
              ? t('onboarding.profile.birthYearInvalid')
              : t('onboarding.profile.birthYearHelp')}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-nickname" className="font-semibold">
            {t('onboarding.profile.nickname')}
          </label>
          <input
            id="profile-nickname"
            aria-describedby="profile-nickname-help"
            type="text"
            autoComplete="nickname"
            maxLength={NICKNAME_MAX}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            className={TEXT_INPUT}
          />
          <span id="profile-nickname-help" className="text-sm text-slate-600">
            {t('onboarding.profile.nicknameHelp')}
          </span>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-semibold">{t('onboarding.profile.gender')}</legend>
          <div className="flex flex-wrap gap-2">
            {GENDERS.map((option) => (
              <label
                key={option}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm has-focus-visible:ring-2 has-focus-visible:ring-teal-600 ${
                  gender === option
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-slate-300 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="gender"
                  value={option}
                  checked={gender === option}
                  onChange={() => setGender(option)}
                  className="sr-only"
                />
                {t(`onboarding.profile.genders.${option}`)}
              </label>
            ))}
          </div>
          <span className="text-sm text-slate-600">{t('onboarding.profile.genderHelp')}</span>
        </fieldset>

        <ErrorText error={error} />
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? t('onboarding.saving') : t('onboarding.continue')}
        </button>
      </form>
    </StepCard>
  )
}
