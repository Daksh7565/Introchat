import { useTranslation } from 'react-i18next'
import { Link, Route, Routes } from 'react-router'
import { NotFoundPage } from '../../app/NotFoundPage'
import { AdminGate } from './auth/AdminGate'
import { SignOutButton } from './auth/AdminAuthForms'
import { VenueCreatePage } from './venues/VenueCreatePage'
import { VenueDetailPage } from './venues/VenueDetailPage'
import { VenueListPage } from './venues/VenueListPage'

/**
 * Root of the internal Admin Console (/admin/*). Loaded as its own bundle, so
 * guests never download it.
 */
export default function AdminPage() {
  const { t } = useTranslation()
  return (
    <AdminGate>
      {({ email }) => (
        <section className="flex flex-col gap-6">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <Link to="/admin" className="text-xl font-semibold">
              {t('admin.title')}
            </Link>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span>{t('admin.home.signedInAs', { email })}</span>
              <SignOutButton />
            </div>
          </header>
          <Routes>
            <Route index element={<VenueListPage />} />
            <Route path="venues/new" element={<VenueCreatePage />} />
            <Route path="venues/:venueId" element={<VenueDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </section>
      )}
    </AdminGate>
  )
}
