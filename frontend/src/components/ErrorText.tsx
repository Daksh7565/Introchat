import { useTranslation } from 'react-i18next'
import { errorMessageKey } from '../lib/errors'

/** A failed action's message, translated from its error code. Renders nothing without an error. */
export function ErrorText({ error }: { error: unknown }) {
  const { t } = useTranslation()
  if (error === null || error === undefined) return null
  return (
    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {t(errorMessageKey(error))}
    </p>
  )
}
