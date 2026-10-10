import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouteError } from 'react-router'

/**
 * Shown when rendering a route throws. The guest gets a translated message and
 * a reload button, never a stack trace. The error is logged once per error;
 * Sentry (M0 phase 5) will capture it from the same effect.
 */
export function RouteErrorPage() {
  const { t } = useTranslation()
  const error = useRouteError()

  useEffect(() => {
    console.error('Route error', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">{t('routeError.title')}</h1>
      <p className="text-slate-600">{t('routeError.body')}</p>
      <button
        type="button"
        className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white"
        onClick={() => window.location.reload()}
      >
        {t('routeError.reload')}
      </button>
    </div>
  )
}
