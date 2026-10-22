import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE, isLanguage } from '../../i18n/languages'
import { AppError } from '../../lib/errors'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import {
  acceptConsent,
  getTagSuggestions,
  MY_PROFILE_KEY,
  type MyProfile,
  saveTags,
  updateProfile,
} from './api'
import { AccountDeletionPanel } from './AccountDeletionPanel'
import { ConsentStep } from './ConsentStep'
import { ReadyView, UnderAgeView } from './EndViews'
import { ProfileStep } from './ProfileStep'
import { CONSENT_VERSION, nextStep, STARTER_TAGS } from './rules'
import { TagsStep } from './TagsStep'

const TOTAL_STEPS = 3

// The server checks the age against the year in India; use the same year here.
function currentYearInIndia(): number {
  return Number(
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(
      new Date(),
    ),
  )
}

function rejectedTagOf(error: unknown): string | null {
  if (!(error instanceof AppError) || error.code !== 'TAG_NOT_ALLOWED') return null
  const details = error.details
  return typeof details === 'object' &&
    details !== null &&
    'tag' in details &&
    typeof details.tag === 'string'
    ? details.tag
    : null
}

export interface JoinProps {
  venueName: string
  joining: boolean
  joinError: unknown
  onJoin: () => void
}

interface OnboardingProps {
  profile: MyProfile
  join: JoinProps
  loggingOut: boolean
  logOutError: unknown
  onLogOut: () => void
}

/**
 * Consent → about you → interests → "You're Mango-4821" → Join. Each step saves to
 * the server and then reloads the profile; nextStep() picks the screen from
 * what the server holds, so a guest who closes the app resumes where they left.
 */
export function Onboarding({ profile, join, ...logOut }: OnboardingProps) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  // Returned from onSuccess so each save stays "saving" until the profile has reloaded.
  const reloadProfile = () => queryClient.invalidateQueries({ queryKey: MY_PROFILE_KEY })

  const consent = useMutation({
    mutationFn: () => acceptConsent(CONSENT_VERSION),
    onSuccess: reloadProfile,
  })
  const details = useMutation({ mutationFn: updateProfile, onSuccess: reloadProfile })
  const tags = useMutation({ mutationFn: saveTags, onSuccess: reloadProfile })

  const [tagQuery, setTagQuery] = useState('')
  const debouncedQuery = useDebouncedValue(tagQuery.trim(), 250)
  const step = nextStep(profile)
  const suggestions = useQuery({
    queryKey: ['tag-suggestions', debouncedQuery],
    queryFn: () => getTagSuggestions(debouncedQuery),
    enabled: step === 'tags',
    staleTime: 60_000,
    // Keep the previous list on screen while the next one loads.
    placeholderData: keepPreviousData,
  })

  const stepLabel = (current: number) => t('onboarding.step', { current, total: TOTAL_STEPS })

  switch (step) {
    case 'under_age':
      return <UnderAgeView {...logOut} />
    case 'consent':
      return (
        <ConsentStep
          stepLabel={stepLabel(1)}
          saving={consent.isPending}
          error={consent.error}
          onAccept={() => consent.mutate()}
        />
      )
    case 'profile':
      return (
        <ProfileStep
          stepLabel={stepLabel(2)}
          currentYear={currentYearInIndia()}
          saving={details.isPending}
          error={details.error}
          onSubmit={(answers) => {
            const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
            details.mutate({
              ...answers,
              language: isLanguage(language) ? language : DEFAULT_LANGUAGE,
            })
          }}
        />
      )
    case 'tags': {
      // Until guests have created tags, the popular list is empty; offer a
      // starter set instead so the step is never a blank box.
      const fromServer = suggestions.data ?? []
      const offered =
        debouncedQuery === '' && fromServer.length < 8
          ? [...new Set([...fromServer, ...STARTER_TAGS])]
          : fromServer
      return (
        <TagsStep
          stepLabel={stepLabel(3)}
          initialTags={profile.tags}
          suggestions={offered}
          onQueryChange={setTagQuery}
          rejectedTag={rejectedTagOf(tags.error)}
          saving={tags.isPending}
          error={tags.error}
          onSave={(names) => tags.mutate(names)}
        />
      )
    }
    case 'done':
      return (
        <>
          <ReadyView handle={profile.handle} tags={profile.tags} {...join} {...logOut} />
          <AccountDeletionPanel />
        </>
      )
  }
}
