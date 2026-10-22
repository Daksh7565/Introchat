import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

const PAGES = ['privacy', 'terms', 'refunds', 'contact'] as const

/**
 * Links to the legal pages. Shown where someone who has not signed in can find
 * them (home, venue landing, the pages themselves): Razorpay checks the site
 * for them, and the DPDP Act needs the grievance contact reachable.
 */
export function LegalLinks() {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('legalLinks.label')}>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-slate-500">
        {PAGES.map((page) => (
          <li key={page}>
            <Link to={`/${page}`} className="underline hover:text-teal-700">
              {t(`legalLinks.${page}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
