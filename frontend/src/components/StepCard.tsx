import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface StepCardProps {
  title: string
  /** e.g. "Step 2 of 3"; omitted on screens outside a numbered sequence. */
  stepLabel?: string
  /** Shows a Back link above the title. */
  onBack?: () => void
  children: ReactNode
}

/**
 * The frame of every login and onboarding screen: one centred column, full
 * width on phones, a comfortable reading width on larger screens.
 */
export function StepCard({ title, stepLabel, onBack, children }: StepCardProps) {
  const { t } = useTranslation()
  return (
    <section className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 py-6 md:flex-none md:py-12">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="self-start text-sm font-semibold text-teal-700"
        >
          ← {t('common.back')}
        </button>
      )}
      <div>
        {stepLabel && <p className="text-sm text-slate-500">{stepLabel}</p>}
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>
      {children}
    </section>
  )
}

/** The main action of a step: full width, at the bottom on phones. */
export const PRIMARY_BUTTON =
  'w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500'

export const TEXT_INPUT =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-teal-600 focus:outline-none'
