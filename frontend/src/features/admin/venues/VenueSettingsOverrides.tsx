import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import type { Json } from '../../../lib/database.types'
import { adminKeys, clearVenueSetting, setVenueSetting, type VenueSettingRow } from './api'

/**
 * Per-venue overrides of the overridable settings (radius, accuracy, prices,
 * durations…). The server validates type and bounds; this screen only collects
 * the value. An empty override means "use the global default".
 */
export function VenueSettingsOverrides({
  venueId,
  rows,
}: {
  venueId: string
  rows: VenueSettingRow[]
}) {
  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {rows.map((row) => (
        <SettingRow key={row.key} venueId={venueId} row={row} />
      ))}
    </ul>
  )
}

function display(value: Json | null): string {
  return value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
}

function SettingRow({ venueId, row }: { venueId: string; row: VenueSettingRow }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(display(row.overrideValue))
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.settings(venueId) })

  const save = useMutation({
    mutationFn: () => {
      const value: Json =
        row.valueType === 'boolean'
          ? draft === 'true'
          : row.valueType === 'integer'
            ? Number(draft)
            : draft
      return setVenueSetting(venueId, row.key, value)
    },
    onSuccess: refresh,
  })
  const clear = useMutation({
    mutationFn: () => clearVenueSetting(venueId, row.key),
    onSuccess: () => {
      setDraft('')
      return refresh()
    },
  })
  const changed = draft !== display(row.overrideValue)
  const integerInvalid = row.valueType === 'integer' && draft !== '' && !/^-?\d+$/.test(draft)

  return (
    <li className="flex flex-col gap-2 py-3">
      <div>
        <p className="font-mono text-sm font-semibold">{row.key}</p>
        <p className="text-sm text-slate-600">{row.description}</p>
        <p className="text-xs text-slate-500">
          {t('admin.settings.global', { value: display(row.globalValue) })}
          {row.minValue !== null &&
            row.maxValue !== null &&
            ` · ${t('admin.settings.range', { min: row.minValue, max: row.maxValue })}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.valueType === 'boolean' ? (
          <select
            aria-label={row.key}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="">{t('admin.settings.useGlobal')}</option>
            <option value="true">{t('admin.settings.on')}</option>
            <option value="false">{t('admin.settings.off')}</option>
          </select>
        ) : (
          <input
            aria-label={row.key}
            inputMode={row.valueType === 'integer' ? 'numeric' : 'text'}
            value={draft}
            placeholder={t('admin.settings.useGlobal')}
            onChange={(event) => setDraft(event.target.value.trim())}
            className="w-36 rounded-lg border border-slate-300 px-2 py-1.5"
          />
        )}
        <button
          type="button"
          disabled={!changed || draft === '' || integerInvalid || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
        >
          {t('admin.settings.save')}
        </button>
        {row.overrideValue !== null && (
          <button
            type="button"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
            className="text-sm font-semibold text-slate-600 underline"
          >
            {t('admin.settings.clear')}
          </button>
        )}
      </div>
      <ErrorText error={save.error ?? clear.error} />
    </li>
  )
}
