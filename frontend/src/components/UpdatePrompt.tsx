import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { reportError } from '../lib/monitoring'

/**
 * Registers the service worker and, when a new version has been downloaded,
 * asks before switching to it. Never reloads on its own: a reload in the middle
 * of a chat would lose what the guest was typing.
 */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      // Not fatal: without a service worker the app still works online; it
      // only loses install/offline-shell support. Reported so we notice.
      reportError(error, 'service-worker-registration')
    },
  })

  if (!needRefresh) {
    return null
  }

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <span className="flex-1">{t('update.available')}</span>
      <button
        type="button"
        className="font-semibold text-teal-300"
        onClick={() => setNeedRefresh(false)}
      >
        {t('update.dismiss')}
      </button>
      <button
        type="button"
        className="rounded-md bg-teal-600 px-3 py-1 font-semibold"
        onClick={() => void updateServiceWorker()}
      >
        {t('update.reload')}
      </button>
    </div>
  )
}
