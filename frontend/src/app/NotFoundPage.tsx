import { useTranslation } from 'react-i18next'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-slate-600">{t('notFound.body')}</p>
    </section>
  )
}
