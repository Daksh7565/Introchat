import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { PRIMARY_BUTTON, StepCard, TEXT_INPUT } from '../../components/StepCard'
import { MAX_TAGS, normalizeTag } from './rules'

interface TagsStepProps {
  stepLabel: string
  initialTags: string[]
  /** Tags to offer for what is typed (popular ones when nothing is typed). */
  suggestions: string[]
  /** The text being typed, so the parent can look up matching suggestions. */
  onQueryChange: (query: string) => void
  /** A tag the server refused (TAG_NOT_ALLOWED), shown marked so it can be removed. */
  rejectedTag: string | null
  saving: boolean
  error: unknown
  onSave: (tags: string[]) => void
}

type InputProblem = 'invalid' | 'limit' | null

export function TagsStep({
  stepLabel,
  initialTags,
  suggestions,
  onQueryChange,
  rejectedTag,
  saving,
  error,
  onSave,
}: TagsStepProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>(initialTags)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<InputProblem>(null)
  const full = selected.length >= MAX_TAGS

  function changeText(value: string) {
    setText(value)
    setProblem(null)
    onQueryChange(value)
  }

  function add(raw: string) {
    const tag = normalizeTag(raw)
    if (tag === null) {
      setProblem('invalid')
      return
    }
    if (!selected.includes(tag)) {
      if (full) {
        setProblem('limit')
        return
      }
      setSelected([...selected, tag])
    }
    changeText('')
  }

  const offered = suggestions.filter((tag) => !selected.includes(tag)).slice(0, 12)

  return (
    <StepCard title={t('onboarding.tags.title')} stepLabel={stepLabel}>
      <p className="text-slate-600">{t('onboarding.tags.help', { max: MAX_TAGS })}</p>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">
          {t('onboarding.tags.selected', { count: selected.length, max: MAX_TAGS })}
        </p>
        {selected.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {selected.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(selected.filter((s) => s !== tag))
                    setProblem(null)
                  }}
                  aria-label={t('onboarding.tags.remove', { tag })}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                    tag === rejectedTag
                      ? 'bg-rose-100 text-rose-800 ring-2 ring-rose-400'
                      : 'bg-teal-700 text-white'
                  }`}
                >
                  {tag}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        noValidate
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          add(text)
        }}
      >
        <label htmlFor="tag-input" className="font-semibold">
          {t('onboarding.tags.inputLabel')}
        </label>
        <div className="flex gap-2">
          <input
            id="tag-input"
            type="text"
            enterKeyHint="done"
            autoComplete="off"
            maxLength={40}
            placeholder={t('onboarding.tags.placeholder')}
            value={text}
            disabled={full}
            onChange={(event) => {
              // A typed comma ends a tag, as in most tag pickers.
              const value = event.target.value
              if (value.endsWith(',')) add(value.slice(0, -1))
              else changeText(value)
            }}
            className={`${TEXT_INPUT} disabled:bg-slate-50`}
          />
          <button
            type="submit"
            disabled={full || text.trim() === ''}
            className="rounded-lg border border-teal-700 px-4 font-semibold text-teal-700 disabled:border-slate-200 disabled:text-slate-400"
          >
            {t('onboarding.tags.add')}
          </button>
        </div>
        {(problem !== null || full) && (
          <p className="text-sm text-slate-600">
            {problem === 'invalid'
              ? t('onboarding.tags.invalid')
              : t('onboarding.tags.limitReached', { max: MAX_TAGS })}
          </p>
        )}
      </form>

      {offered.length > 0 && !full && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-500">{t('onboarding.tags.suggested')}</p>
          <ul className="flex flex-wrap gap-2">
            {offered.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => add(tag)}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
                >
                  + {tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorText error={error} />
      <button
        type="button"
        disabled={saving || selected.length === 0}
        onClick={() => onSave(selected)}
        className={`${PRIMARY_BUTTON} mt-auto md:mt-0`}
      >
        {saving ? t('onboarding.saving') : t('onboarding.tags.save')}
      </button>
    </StepCard>
  )
}
