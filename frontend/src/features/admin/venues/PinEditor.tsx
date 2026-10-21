import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import {
  collectPin,
  getReading,
  PIN_GOOD_ACCURACY_M,
  type PinEstimate,
  type Reading,
} from '../../../lib/location'
import { searchAddress } from './addressSearch'
import { type MapPoint, PinMap } from './PinMap'

// Long enough for a phone's position to settle indoors; matches the field test.
const PIN_COLLECT_MS = 30_000

interface PinEditorProps {
  pin: MapPoint
  onChange: (pin: MapPoint) => void
  radiusM: number | null
  /**
   * New venue: ask for this device's location as soon as the editor opens and
   * put the pin there, so the admin starts from where they stand.
   */
  locateOnOpen?: boolean
}

/** Places a venue's pin: address search, drag/tap on the map, or average of the phone's own readings. */
export function PinEditor({ pin, onChange, radiusM, locateOnOpen = false }: PinEditorProps) {
  const { t, i18n } = useTranslation()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<MapPoint | null>(null)
  const [progress, setProgress] = useState<{ secondsLeft: number; readings: number } | null>(null)
  const [estimate, setEstimate] = useState<PinEstimate | null>(null)
  const [located, setLocated] = useState<Reading | null>(null)
  // Set once the admin places the pin themselves, so a device reading that
  // arrives later (the location prompt can sit unanswered) never moves it back.
  const placedByAdmin = useRef(false)

  const search = useMutation({ mutationFn: () => searchAddress(query, i18n.language) })
  const fromPhone = useMutation({
    mutationFn: () =>
      collectPin(PIN_COLLECT_MS, (secondsLeft, readings) => setProgress({ secondsLeft, readings })),
    onSuccess: (result) => {
      placedByAdmin.current = true
      setLocated(null)
      setEstimate(result)
      move({ latitude: result.latitude, longitude: result.longitude })
    },
    onSettled: () => setProgress(null),
  })
  // One reading of this device: on a laptop it comes from WiFi and can be tens
  // of metres off, which the message under the search box says.
  const locate = useMutation({
    mutationFn: () => getReading(),
    onSuccess: (reading) => {
      if (placedByAdmin.current) return
      setLocated(reading)
      move({ latitude: reading.latitude, longitude: reading.longitude })
    },
  })

  const { mutate: startLocate } = locate
  const locateStarted = useRef(false)
  useEffect(() => {
    // Once per page; the ref also stops React's development double-run asking twice.
    if (!locateOnOpen || locateStarted.current) return
    locateStarted.current = true
    startLocate()
  }, [locateOnOpen, startLocate])

  function move(point: MapPoint) {
    onChange(point)
    setFocus(point)
  }

  function placeByHand(point: MapPoint) {
    placedByAdmin.current = true
    setLocated(null)
    onChange(point)
  }

  function runSearch() {
    if (query.trim() !== '' && !search.isPending) search.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Not a <form>: the editor sits inside the New venue form, and a form
          inside a form makes the browser submit and reload the whole page. */}
      <div role="search" className="flex gap-2">
        <label htmlFor={searchId} className="sr-only">
          {t('admin.pin.searchLabel')}
        </label>
        <input
          id={searchId}
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter searches, and must not also submit a form around the editor.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              runSearch()
            }
          }}
          placeholder={t('admin.pin.searchPlaceholder')}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={search.isPending}
          className="rounded-lg border border-teal-700 px-3 py-2 font-semibold text-teal-700"
        >
          {t('admin.pin.search')}
        </button>
      </div>
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
                  placeByHand(result)
                  setFocus(result)
                  search.reset()
                }}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {locateOnOpen && (
        <div className="flex flex-col gap-1">
          {locate.isPending ? (
            <p className="text-sm text-slate-600">{t('admin.pin.locating')}</p>
          ) : (
            <button
              type="button"
              onClick={() => {
                // Asked for again on purpose: this reading may replace a hand-placed pin.
                placedByAdmin.current = false
                startLocate()
              }}
              className="self-start text-sm font-semibold text-teal-700 underline"
            >
              {t('admin.pin.useDevice')}
            </button>
          )}
          <ErrorText error={locate.error} />
          {located && located.accuracyM <= PIN_GOOD_ACCURACY_M && (
            <p className="text-sm text-emerald-700">
              {t('admin.pin.locatedPrecise', { accuracy: Math.round(located.accuracyM) })}
            </p>
          )}
          {located && located.accuracyM > PIN_GOOD_ACCURACY_M && (
            <p className="text-sm text-amber-700">
              {t('admin.pin.locatedRough', { accuracy: Math.round(located.accuracyM) })}
            </p>
          )}
        </div>
      )}

      <PinMap pin={pin} radiusM={radiusM} onMove={placeByHand} focus={focus} />
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
