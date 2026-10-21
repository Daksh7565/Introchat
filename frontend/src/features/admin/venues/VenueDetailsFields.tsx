import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { VENUE_TYPES, type VenueField, type VenueInput, type VenueProblems } from './api'

interface VenueDetailsFieldsProps {
  value: VenueInput
  onChange: (value: VenueInput) => void
  /** Field the last save failed on (from invalidField), to highlight it. */
  invalidField: string | null
  /** Problems to show under each field (from venueInputProblems), once a save was tried. */
  problems?: VenueProblems
  /** When editing an existing venue: a slug change breaks every printed QR card. */
  slugLocked?: boolean
  onSlugEdited?: () => void
}

export function VenueDetailsFields({
  value,
  onChange,
  invalidField,
  problems = {},
  slugLocked = false,
  onSlugEdited,
}: VenueDetailsFieldsProps) {
  const { t } = useTranslation()
  const ids = { name: useId(), slug: useId(), type: useId(), address: useId(), city: useId() }
  const invalid = (field: VenueField) => invalidField === field || problems[field] !== undefined
  const input = (field: VenueField) =>
    `w-full rounded-lg border px-3 py-2 ${invalid(field) ? 'border-rose-500 bg-rose-50' : 'border-slate-300'}`
  // Links an input to the message under it, so screen readers read both.
  const described = (field: VenueField) => ({
    'aria-invalid': invalid(field),
    'aria-describedby': problems[field] ? `${ids[field]}-problem` : undefined,
  })
  const problem = (field: VenueField) => {
    const key = problems[field]
    return key ? (
      <p id={`${ids[field]}-problem`} className="text-sm text-rose-700">
        {t(key)}
      </p>
    ) : null
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={ids.name} className="text-sm font-semibold text-slate-700">
          {t('admin.venue.name')}
        </label>
        <input
          id={ids.name}
          required
          maxLength={80}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          className={input('name')}
          {...described('name')}
        />
        {problem('name')}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.slug} className="text-sm font-semibold text-slate-700">
          {t('admin.venue.slug')}
        </label>
        <input
          id={ids.slug}
          required
          maxLength={40}
          value={value.slug}
          readOnly={slugLocked}
          onChange={(event) => {
            onSlugEdited?.()
            onChange({ ...value, slug: event.target.value.toLowerCase() })
          }}
          className={`${input('slug')} font-mono ${slugLocked ? 'bg-slate-50 text-slate-500' : ''}`}
          {...described('slug')}
        />
        {problem('slug')}
        <p className="text-xs text-slate-500">
          {slugLocked ? t('admin.venue.slugLocked') : t('admin.venue.slugHelp')}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.type} className="text-sm font-semibold text-slate-700">
          {t('admin.venue.type')}
        </label>
        <select
          id={ids.type}
          value={value.type}
          onChange={(event) => {
            const next = VENUE_TYPES.find((type) => type === event.target.value)
            if (next) onChange({ ...value, type: next })
          }}
          className={input('type')}
        >
          {VENUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`admin.venue.types.${type}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.address} className="text-sm font-semibold text-slate-700">
          {t('admin.venue.address')}
        </label>
        <input
          id={ids.address}
          required
          maxLength={200}
          value={value.address}
          onChange={(event) => onChange({ ...value, address: event.target.value })}
          className={input('address')}
          {...described('address')}
        />
        {problem('address')}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.city} className="text-sm font-semibold text-slate-700">
          {t('admin.venue.city')}
        </label>
        <input
          id={ids.city}
          required
          maxLength={80}
          value={value.city}
          onChange={(event) => onChange({ ...value, city: event.target.value })}
          className={input('city')}
          {...described('city')}
        />
        {problem('city')}
      </div>
    </div>
  )
}
