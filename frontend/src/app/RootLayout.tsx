import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { LanguagePicker } from '../components/LanguagePicker'
import { UpdatePrompt } from '../components/UpdatePrompt'

export function RootLayout() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4">
      <header className="flex items-center justify-between py-3">
        <span className="text-lg font-semibold text-teal-700">{t('app.name')}</span>
        <LanguagePicker />
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <UpdatePrompt />
    </div>
  )
}
