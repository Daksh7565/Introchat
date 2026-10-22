import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import type { Json } from '../../../lib/database.types'
import { type AppSettingRow, listAppSettings, moneyKeys, setAppSetting } from './api'

// Shown first: the switches that decide whether anyone is asked for money.
const PAYMENT_SWITCHES = ['PAYMENTS_ENABLED', 'SCAN_FEE_ENABLED', 'SUBSCRIPTION_ENABLED']

function display(value: Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Global settings (ARCHITECTURE §2.3): the payment switches, prices,
 * durations and limits. A venue's own override (on its page) wins over these.
 * The server validates type and bounds and audit-logs every change.
 */
export function SettingsPage() {
  const { t } = useTranslation()
  const settings = useQuery({ queryKey: moneyKeys.settings, queryFn: listAppSettings })
  const rows = settings.data ?? []
  const ordered = [
    ...PAYMENT_SWITCHES.flatMap((key) => rows.filter((row) => row.key === key)),
    ...rows.filter((row) => !PAYMENT_SWITCHES.includes(row.key)),
  ]

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('admin.globalSettings.title')}</h2>
      <p className="text-sm text-slate-600">{t('admin.globalSettings.help')}</p>
      {settings.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={settings.error} />
      <ul className="flex flex-col divide-y divide-slate-100">
        {ordered.map((row) => (
          <SettingItem key={`${row.key}:${display(row.value)}`} row={row} />
        ))}
      </ul>
    </section>
  )
}

function SettingItem({ row }: { row: AppSettingRow }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(display(row.value))
  const save = useMutation({
    mutationFn: () => {
      const value: Json =
        row.valueType === 'boolean'
          ? draft === 'true'
          : row.valueType === 'integer'
            ? Number(draft)
            : draft
      return setAppSetting(row.key, value)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: moneyKeys.settings }),
  })
  const changed = draft !== display(row.value)
  const integerInvalid = row.valueType === 'integer' && !/^-?\d+$/.test(draft)

  return (
    <li className="flex flex-col gap-2 py-3">
      <div>
        <p className="font-mono text-sm font-semibold">{row.key}</p>
        <p className="text-sm text-slate-600">{row.description}</p>
        <p className="text-xs text-slate-500">
          {row.minValue !== null &&
            row.maxValue !== null &&
            t('admin.settings.range', { min: row.minValue, max: row.maxValue })}
          {row.venueOverridable && ` ${t('admin.globalSettings.overridable')}`}
        </p>
      </div>
      {row.adminEditable ? (
        <div className="flex flex-wrap items-center gap-2">
          {row.valueType === 'boolean' ? (
            <select
              aria-label={row.key}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
            >
              <option value="true">{t('admin.settings.on')}</option>
              <option value="false">{t('admin.settings.off')}</option>
            </select>
          ) : row.allowedValues ? (
            <select
              aria-label={row.key}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
            >
              {row.allowedValues.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={row.key}
              inputMode={row.valueType === 'integer' ? 'numeric' : 'text'}
              value={draft}
              onChange={(event) => setDraft(event.target.value.trim())}
              className="w-36 rounded-lg border border-slate-300 px-2 py-1.5"
            />
          )}
          <button
            type="button"
            disabled={!changed || integerInvalid || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
          >
            {t('admin.settings.save')}
          </button>
        </div>
      ) : (
        <p className="text-sm">
          <span className="font-mono">{display(row.value)}</span>{' '}
          <span className="text-xs text-slate-500">{t('admin.globalSettings.locked')}</span>
        </p>
      )}
      <ErrorText error={save.error} />
    </li>
  )
}
