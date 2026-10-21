import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { LanguagePicker } from '../components/LanguagePicker'
import { UpdatePrompt } from '../components/UpdatePrompt'

// One width rule for the whole app: full width on phones, up to 6xl on large
// screens. Each screen decides how to use the space (single column, grid, or
// two panes), so a wide monitor never shows a narrow phone strip.
const PAGE_WIDTH = 'mx-auto w-full max-w-6xl px-4 sm:px-6'

export function RootLayout() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-100">
        <div className={`${PAGE_WIDTH} flex items-center justify-between py-3`}>
          <span className="text-lg font-semibold text-teal-700">{t('app.name')}</span>
          <LanguagePicker />
        </div>
      </header>
      <main className={`${PAGE_WIDTH} flex flex-1 flex-col py-4`}>
        <Outlet />
      </main>
      <UpdatePrompt />
    </div>
  )
}
