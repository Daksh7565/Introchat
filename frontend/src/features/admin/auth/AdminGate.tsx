import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { AdminLoginForm, MfaEnrollForm, MfaVerifyForm, NotAdminNotice } from './AdminAuthForms'
import { useAdminAuth } from './useAdminAuth'

/**
 * Shows the Console only to an active admin who has completed MFA; otherwise
 * the step they are on. This is the screen's gate only: every admin_* function
 * checks the same thing on the server.
 */
export function AdminGate({ children }: { children: (admin: { email: string }) => ReactNode }) {
  const { t } = useTranslation()
  const auth = useAdminAuth()

  if (auth.isPending) {
    return (
      <p role="status" className="py-10 text-center text-slate-500">
        {t('admin.loading')}
      </p>
    )
  }

  if (auth.isError) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-3 py-10">
        <ErrorText error={auth.error} />
        <button
          type="button"
          className="rounded-lg border border-slate-300 py-2 font-semibold"
          onClick={() => void auth.refetch()}
        >
          {t('admin.retry')}
        </button>
      </div>
    )
  }

  const state = auth.data
  switch (state.kind) {
    case 'signed_out':
      return <AdminLoginForm />
    case 'needs_enrollment':
      return <MfaEnrollForm />
    case 'needs_verification':
      return <MfaVerifyForm factorId={state.factorId} />
    case 'not_admin':
      return <NotAdminNotice email={state.email} />
    case 'admin':
      return <>{children({ email: state.email })}</>
  }
}
