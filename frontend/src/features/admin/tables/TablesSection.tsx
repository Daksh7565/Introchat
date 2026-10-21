import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { env } from '../../../lib/env'
import { SUPPORTED_LANGUAGES } from '../../../i18n/languages'
import {
  adminKeys,
  createTables,
  listTables,
  regenerateQrToken,
  type TableRow,
  updateTable,
  type VenueDetail,
} from '../venues/api'
import { MAX_TABLES_PER_BATCH, rangeLabels } from './labels'
import { type CardContent, downloadCardsPdf, tableUrl } from './qrCards'

const PAGES_DEV = /\.pages\.dev$/

/** Why cards printed right now may not work for guests, or null if they will. */
function cardUrlWarning(origin: string): 'local' | 'temporary' | null {
  const { hostname, protocol } = new URL(origin)
  if (protocol !== 'https:') return 'local'
  if (PAGES_DEV.test(hostname)) return 'temporary'
  return null
}

export function TablesSection({ venue }: { venue: VenueDetail }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const tables = useQuery({
    queryKey: adminKeys.tables(venue.id),
    queryFn: () => listTables(venue.id),
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.tables(venue.id) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.venues }),
    ])

  const cards = (rows: TableRow[]): CardContent[] =>
    rows.map((row) => ({
      venueName: venue.name,
      tableLabel: row.label,
      url: tableUrl(env.publicAppUrl, venue.slug, row.qrToken),
      // Every guest reads the same printed card, so it carries every language.
      callToAction: SUPPORTED_LANGUAGES.map((language) =>
        i18n.getFixedT(language)('qrCard.callToAction'),
      ),
      footer: t('app.name'),
    }))
  const pdf = useMutation({
    mutationFn: (rows: TableRow[]) => downloadCardsPdf(cards(rows), `qr-cards-${venue.slug}.pdf`),
  })

  const activeRows = tables.data?.filter((row) => row.isActive) ?? []
  const warning = cardUrlWarning(env.publicAppUrl)

  return (
    <div className="flex flex-col gap-4">
      <BulkCreate venueId={venue.id} onCreated={refresh} />

      {tables.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={tables.error} />
      {tables.data?.length === 0 && <p className="text-slate-500">{t('admin.tables.empty')}</p>}

      {tables.data && tables.data.length > 0 && (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
            {warning && (
              <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                {t(`admin.tables.urlWarning.${warning}`, { url: env.publicAppUrl })}
              </p>
            )}
            <button
              type="button"
              disabled={activeRows.length === 0 || pdf.isPending}
              onClick={() => pdf.mutate(activeRows)}
              className="rounded-lg bg-teal-700 py-2 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
            >
              {pdf.isPending
                ? t('admin.tables.buildingPdf')
                : t('admin.tables.downloadPdf', { count: activeRows.length })}
            </button>
            <ErrorText error={pdf.error} />
          </div>

          <ul className="flex flex-col divide-y divide-slate-100">
            {tables.data.map((row) => (
              <TableRowEditor
                key={`${row.id}:${row.label}:${row.isActive}:${row.qrToken}`}
                row={row}
                onChanged={refresh}
                onDownload={() => pdf.mutate([row])}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function BulkCreate({
  venueId,
  onCreated,
}: {
  venueId: string
  onCreated: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const ids = { prefix: useId(), from: useId(), to: useId(), pad: useId() }
  const [prefix, setPrefix] = useState('T')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('10')
  const [pad, setPad] = useState('2')
  const labels = rangeLabels({
    prefix,
    from: Number(from),
    to: Number(to),
    pad: Number(pad),
  })
  const create = useMutation({
    mutationFn: () => createTables(venueId, labels),
    onSuccess: onCreated,
  })
  const field = 'w-full rounded-lg border border-slate-300 px-2 py-1.5'

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate()
      }}
    >
      <p className="font-semibold">{t('admin.tables.addTitle')}</p>
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            [ids.prefix, 'prefix', prefix, setPrefix],
            [ids.from, 'from', from, setFrom],
            [ids.to, 'to', to, setTo],
            [ids.pad, 'pad', pad, setPad],
          ] as const
        ).map(([id, name, value, set]) => (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs font-semibold text-slate-600">
              {t(`admin.tables.fields.${name}`)}
            </label>
            <input
              id={id}
              value={value}
              inputMode={name === 'prefix' ? 'text' : 'numeric'}
              onChange={(event) => set(event.target.value)}
              className={field}
            />
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-600">
        {labels.length > 0
          ? t('admin.tables.preview', {
              count: labels.length,
              first: labels[0],
              last: labels.at(-1),
            })
          : t('admin.tables.invalidRange', { max: MAX_TABLES_PER_BATCH })}
      </p>
      <ErrorText error={create.error} />
      <button
        type="submit"
        disabled={labels.length === 0 || create.isPending}
        className="self-start rounded-lg border border-teal-700 px-3 py-1.5 font-semibold text-teal-700 disabled:border-slate-200 disabled:text-slate-400"
      >
        {t('admin.tables.add', { count: labels.length })}
      </button>
    </form>
  )
}

function TableRowEditor({
  row,
  onChanged,
  onDownload,
}: {
  row: TableRow
  onChanged: () => Promise<unknown>
  onDownload: () => void
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const [label, setLabel] = useState(row.label)
  const save = useMutation({
    mutationFn: (next: { label: string; isActive: boolean }) =>
      updateTable(row.id, next.label, next.isActive),
    onSuccess: onChanged,
  })
  const regenerate = useMutation({
    mutationFn: () => regenerateQrToken(row.id),
    onSuccess: onChanged,
  })

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={labelId} className="sr-only">
          {t('admin.tables.label')}
        </label>
        <input
          id={labelId}
          value={label}
          maxLength={40}
          onChange={(event) => setLabel(event.target.value)}
          className={`w-40 rounded-lg border border-slate-300 px-2 py-1.5 ${row.isActive ? '' : 'text-slate-400 line-through'}`}
        />
        {label.trim() !== row.label && (
          <button
            type="button"
            disabled={label.trim() === '' || save.isPending}
            onClick={() => save.mutate({ label: label.trim(), isActive: row.isActive })}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white"
          >
            {t('admin.settings.save')}
          </button>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={row.isActive}
            disabled={save.isPending}
            onChange={(event) => save.mutate({ label: row.label, isActive: event.target.checked })}
          />
          {t('admin.tables.active')}
        </label>
        <button
          type="button"
          disabled={!row.isActive}
          onClick={onDownload}
          className="text-sm font-semibold text-teal-700 underline disabled:text-slate-400"
        >
          {t('admin.tables.card')}
        </button>
        <button
          type="button"
          disabled={regenerate.isPending}
          onClick={() => {
            // The printed card for this table stops working immediately.
            if (window.confirm(t('admin.tables.regenerateConfirm', { label: row.label })))
              regenerate.mutate()
          }}
          className="text-sm font-semibold text-slate-600 underline"
        >
          {t('admin.tables.regenerate')}
        </button>
      </div>
      <ErrorText error={save.error ?? regenerate.error} />
    </li>
  )
}
