import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { VENUE_TYPES, type VenueInput } from './api'

interface VenueDetailsFieldsProps {
  value: VenueInput
  onChange: (value: VenueInput) => void
  /** Field the last save failed on (from invalidField), to highlight it. */
  invalidField: string | null
  /** When editing an existing venue: a slug change breaks every printed QR card. */
  slugLocked?: boolean
  onSlugEdited?: () => void
}

export function VenueDetailsFields({
  value,
  onChange,
  invalidField,
  slugLocked = false,
  onSlugEdited,
}: VenueDetailsFieldsProps) {
  const { t } = useTranslation()
  const ids = { name: useId(), slug: useId(), type: useId(), address: useId(), city: useId() }
  const input = (field: string) =>
    `w-full rounded-lg border px-3 py-2 ${invalidField === field ? 'border-rose-500 bg-rose-50' : 'border-slate-300'}`

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
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.slug} className="text-sm font-semibold text-slate-700">
          {t('admin.venue.slug')}
        </label>
        <input
          id={ids.slug}
          required
          maxLength={40}
          pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
          value={value.slug}
          readOnly={slugLocked}
          onChange={(event) => {
            onSlugEdited?.()
            onChange({ ...value, slug: event.target.value.toLowerCase() })
          }}
          className={`${input('slug')} font-mono ${slugLocked ? 'bg-slate-50 text-slate-500' : ''}`}
        />
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
          maxLength={200}
          value={value.address}
          onChange={(event) => onChange({ ...value, address: event.target.value })}
          className={input('address')}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.city} className="text-sm font-semibold text-slate-700">
          {t('admin.venue.city')}
        </label>
        <input
          id={ids.city}
          maxLength={80}
          value={value.city}
          onChange={(event) => onChange({ ...value, city: event.target.value })}
          className={input('city')}
        />
      </div>
    </div>
  )
}
