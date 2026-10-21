import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { collectPin, type PinEstimate } from '../../../lib/location'
import { searchAddress } from './addressSearch'
import { type MapPoint, PinMap } from './PinMap'

// Long enough for a phone's position to settle indoors; matches the field test.
const PIN_COLLECT_MS = 30_000

interface PinEditorProps {
  pin: MapPoint
  onChange: (pin: MapPoint) => void
  radiusM: number | null
}

/** Places a venue's pin: address search, drag/tap on the map, or average of the phone's own readings. */
export function PinEditor({ pin, onChange, radiusM }: PinEditorProps) {
  const { t, i18n } = useTranslation()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<MapPoint | null>(null)
  const [progress, setProgress] = useState<{ secondsLeft: number; readings: number } | null>(null)
  const [estimate, setEstimate] = useState<PinEstimate | null>(null)

  const search = useMutation({ mutationFn: () => searchAddress(query, i18n.language) })
  const fromPhone = useMutation({
    mutationFn: () =>
      collectPin(PIN_COLLECT_MS, (secondsLeft, readings) => setProgress({ secondsLeft, readings })),
    onSuccess: (result) => {
      setEstimate(result)
      move({ latitude: result.latitude, longitude: result.longitude })
    },
    onSettled: () => setProgress(null),
  })

  function move(point: MapPoint) {
    onChange(point)
    setFocus(point)
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (query.trim() !== '') search.mutate()
        }}
      >
        <label htmlFor={searchId} className="sr-only">
          {t('admin.pin.searchLabel')}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('admin.pin.searchPlaceholder')}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={search.isPending}
          className="rounded-lg border border-teal-700 px-3 py-2 font-semibold text-teal-700"
        >
          {t('admin.pin.search')}
        </button>
      </form>
      <ErrorText error={search.error} />
      {search.data && search.data.length === 0 && (
        <p className="text-sm text-slate-500">{t('admin.pin.noResults')}</p>
      )}
      {search.data && search.data.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-slate-200 p-1">
          {search.data.map((result) => (
            <li key={`${result.latitude},${result.longitude}`}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  move(result)
                  search.reset()
                }}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <PinMap pin={pin} radiusM={radiusM} onMove={onChange} focus={focus} />
      <p className="text-xs text-slate-500">
        {t('admin.pin.coordinates', {
          latitude: pin.latitude.toFixed(6),
          longitude: pin.longitude.toFixed(6),
        })}{' '}
        · {t('admin.pin.dragHint')}
      </p>

      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-sm text-slate-600">{t('admin.pin.fromPhoneHelp')}</p>
        <button
          type="button"
          disabled={fromPhone.isPending}
          onClick={() => fromPhone.mutate()}
          className="mt-2 w-full rounded-lg bg-teal-700 py-2 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
        >
          {progress
            ? t('admin.pin.collecting', { seconds: progress.secondsLeft, count: progress.readings })
            : t('admin.pin.fromPhone')}
        </button>
        <ErrorText error={fromPhone.error} />
        {estimate && !fromPhone.isPending && (
          <p className={`mt-2 text-sm ${estimate.precise ? 'text-emerald-700' : 'text-amber-700'}`}>
            {estimate.precise
              ? t('admin.pin.fromPhoneDone', {
                  count: estimate.samples,
                  accuracy: estimate.bestAccuracyM,
                })
              : t('admin.pin.fromPhoneImprecise', { accuracy: estimate.bestAccuracyM })}
          </p>
        )}
      </div>
    </div>
  )
}
