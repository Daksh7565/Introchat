// Registers the legal text (i18n/legal) before the page renders.
import '../../i18n/legal'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LegalLinks } from '../../components/LegalLinks'
import business from './business.json'

export type LegalPageName = 'privacy' | 'terms' | 'refunds' | 'contact'

// Business details named in the texts. "[...]" placeholders until filled in;
// a production build refuses to ship them (build/legalCheck.ts).
const DETAILS = {
  legalName: business.legalName,
  address: business.address,
  city: business.city,
  supportEmail: business.supportEmail,
  grievanceOfficer: business.grievanceOfficer,
  grievanceEmail: business.grievanceEmail,
}

const CONTACT_FIELDS = [
  ['business', business.legalName],
  ['address', business.address],
  ['support', business.supportEmail],
  ['grievanceOfficer', business.grievanceOfficer],
  ['grievanceEmail', business.grievanceEmail],
] as const

/** Privacy policy, terms, refund policy and contact (/privacy, /terms, /refunds, /contact). */
export function LegalPage({ page }: { page: LegalPageName }) {
  const { t, i18n } = useTranslation()
  const title = t(`legal.${page}.title`)
  const sections = t(`legal.${page}.sections`, { returnObjects: true, ...DETAILS })
  const updated = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
    new Date(`${business.lastUpdated}T00:00:00`),
  )

  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-8">
      <title>{`${title} · ${t('app.name')}`}</title>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-500">{t('legal.updated', { date: updated })}</p>
        {!business.reviewed && (
          <p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {t('legal.draft')}
          </p>
        )}
        <p className="text-slate-700">{t(`legal.${page}.intro`)}</p>
      </header>

      {page === 'contact' && (
        <dl className="grid gap-x-4 gap-y-2 rounded-xl border border-slate-200 p-4 sm:grid-cols-[auto_1fr]">
          {CONTACT_FIELDS.map(([field, value]) => (
            <div key={field} className="contents">
              <dt className="text-sm font-semibold text-slate-600">
                {t(`legal.contact.fields.${field}`)}
              </dt>
              <dd className="break-words text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {Object.entries(sections).map(([key, section]) => {
        // A body with several lines is a list (what we collect, how long we keep it, ...).
        const lines = section.body.split('\n')
        return (
          <section key={key} aria-labelledby={`legal-${key}`} className="flex flex-col gap-2">
            <h2 id={`legal-${key}`} className="text-lg font-semibold">
              {section.heading}
            </h2>
            {lines.length > 1 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-slate-700">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-700">{section.body}</p>
            )}
          </section>
        )
      })}

      <footer className="flex flex-col gap-3 border-t border-slate-100 pt-4">
        <LegalLinks />
        <Link to="/" className="text-sm font-semibold text-teal-700 underline">
          {t('legal.home')}
        </Link>
      </footer>
    </article>
  )
}
