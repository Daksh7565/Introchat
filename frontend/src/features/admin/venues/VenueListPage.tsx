import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ErrorText } from '../../../components/ErrorText'
import { adminKeys, listVenues } from './api'

export function VenueListPage() {
  const { t } = useTranslation()
  const venues = useQuery({ queryKey: adminKeys.venues, queryFn: listVenues })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('admin.venues.title')}</h2>
        <Link
          to="/admin/venues/new"
          className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
        >
          {t('admin.venues.new')}
        </Link>
      </div>

      {venues.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={venues.error} />
      {venues.data?.length === 0 && <p className="text-slate-500">{t('admin.venues.empty')}</p>}

      {venues.data && venues.data.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {venues.data.map((venue) => (
            <li key={venue.id}>
              <Link
                to={`/admin/venues/${venue.id}`}
                className="flex h-full flex-col gap-1 rounded-xl border border-slate-200 p-4 hover:border-teal-600"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{venue.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${venue.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {venue.isActive ? t('admin.venues.active') : t('admin.venues.inactive')}
                  </span>
                </span>
                <span className="font-mono text-xs text-slate-500">/{venue.slug}</span>
                <span className="text-sm text-slate-600">
                  {[t(`admin.venue.types.${venue.type}`), venue.city].filter(Boolean).join(' · ')}
                </span>
                <span className="text-sm text-slate-600">
                  {t('admin.venues.tables', { count: venue.tableCount })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
