import { useTranslation } from 'react-i18next'

/**
 * The root URL. Guests normally arrive through a table QR link, so this is what
 * someone sees when they open the installed app or type the address directly:
 * the only way in is scanning a table.
 */
export function HomePage() {
  const { t } = useTranslation()
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <p className="text-slate-600">{t('home.scanPrompt')}</p>
    </section>
  )
}
