import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '../i18n'
import { reportError } from '../lib/monitoring'
import { isLanguage, SUPPORTED_LANGUAGES } from '../i18n/languages'

export function LanguagePicker() {
  const { t, i18n } = useTranslation()
  const id = useId()

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {t('language.label')}
      </label>
      <select
        id={id}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(event) => {
          const next = event.target.value
          if (isLanguage(next)) {
            // On failure (the language file could not be fetched, e.g. offline)
            // the picker snaps back to the language still on screen.
            changeLanguage(next).catch((error: unknown) => {
              reportError(error, 'language.change')
            })
          }
        }}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`language.names.${language}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
