import { useTranslation } from 'react-i18next'

/**
 * Target of every table QR card (/v/:slug/t/:token). Until M1 adds the venue
 * lookup and the location check, nothing can be opened from here, and the page
 * says so plainly instead of pretending to load.
 */
export function LandingPage() {
  const { t } = useTranslation()
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold">{t('landing.title')}</h1>
      <p className="text-slate-600">{t('landing.notOpenYet')}</p>
    </section>
  )
}
