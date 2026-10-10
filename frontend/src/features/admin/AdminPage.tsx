import { useTranslation } from 'react-i18next'

/**
 * Entry of the internal Admin Console (/admin/*). Login with MFA and the venue
 * screens arrive in M1; until then the route exists and says it is not open.
 */
export function AdminPage() {
  const { t } = useTranslation()
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
      <p className="text-slate-600">{t('admin.notAvailableYet')}</p>
    </section>
  )
}
