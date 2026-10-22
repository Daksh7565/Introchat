// Registers the Console's own text (i18n/admin) before any screen renders.
import '../../i18n/admin'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Route, Routes } from 'react-router'
import { NotFoundPage } from '../../app/NotFoundPage'
import { AdminGate } from './auth/AdminGate'
import { SignOutButton } from './auth/AdminAuthForms'
import { GuestsPage } from './money/GuestsPage'
import { PaymentsPage } from './money/PaymentsPage'
import { SettingsPage } from './money/SettingsPage'
import { AdminsPage } from './ops/AdminsPage'
import { AuditPage } from './ops/AuditPage'
import { DeletionsPage } from './ops/DeletionsPage'
import { FlagsPage } from './ops/FlagsPage'
import { SmsPage } from './ops/SmsPage'
import { StatsPage } from './ops/StatsPage'
import { BansPage } from './safety/BansPage'
import { ReportsPage } from './safety/ReportsPage'
import { TagsPage } from './safety/TagsPage'
import { VenueCreatePage } from './venues/VenueCreatePage'
import { VenueDetailPage } from './venues/VenueDetailPage'
import { VenueListPage } from './venues/VenueListPage'

const NAV = [
  { to: '/admin', label: 'admin.nav.venues' },
  { to: '/admin/reports', label: 'admin.nav.reports' },
  { to: '/admin/bans', label: 'admin.nav.bans' },
  { to: '/admin/payments', label: 'admin.nav.payments' },
  { to: '/admin/guests', label: 'admin.nav.guests' },
  { to: '/admin/tags', label: 'admin.nav.tags' },
  { to: '/admin/flags', label: 'admin.nav.flags' },
  { to: '/admin/deletions', label: 'admin.nav.deletions' },
  { to: '/admin/stats', label: 'admin.nav.stats' },
  { to: '/admin/sms', label: 'admin.nav.sms' },
  { to: '/admin/audit', label: 'admin.nav.audit' },
  { to: '/admin/admins', label: 'admin.nav.admins' },
  { to: '/admin/settings', label: 'admin.nav.settings' },
] as const

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
          <nav className="flex flex-wrap gap-2 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) =>
                  `rounded-full px-3 py-1.5 font-semibold ${isActive ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700'}`
                }
              >
                {t(item.label)}
              </NavLink>
            ))}
          </nav>
          <Routes>
            <Route index element={<VenueListPage />} />
            <Route path="venues/new" element={<VenueCreatePage />} />
            <Route path="venues/:venueId" element={<VenueDetailPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="bans" element={<BansPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="guests" element={<GuestsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="flags" element={<FlagsPage />} />
            <Route path="deletions" element={<DeletionsPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="sms" element={<SmsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="admins" element={<AdminsPage currentEmail={email} />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </section>
      )}
    </AdminGate>
  )
}
