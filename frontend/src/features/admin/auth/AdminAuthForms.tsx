import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import {
  ADMIN_AUTH_QUERY_KEY,
  signInWithPassword,
  signOut,
  startTotpEnrollment,
  verifyTotp,
} from './adminAuth'

const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2'
const primaryButton =
  'w-full rounded-lg bg-teal-700 py-2.5 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500'

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto mt-6 flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-slate-200 p-6 sm:mt-16">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </section>
  )
}

/** Re-reads the admin's sign-in state after any step changes it. */
function useRefreshAdminAuth() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ADMIN_AUTH_QUERY_KEY })
}

export function AdminLoginForm() {
  const { t } = useTranslation()
  const refresh = useRefreshAdminAuth()
  const emailId = useId()
  const passwordId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => signInWithPassword(email, password),
    onSuccess: refresh,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    login.mutate()
  }

  return (
    <AuthCard title={t('admin.auth.title')}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <label htmlFor={emailId} className="text-sm font-semibold text-slate-700">
          {t('admin.auth.email')}
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
        <label htmlFor={passwordId} className="text-sm font-semibold text-slate-700">
          {t('admin.auth.password')}
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
        <ErrorText error={login.error} />
        <button type="submit" className={primaryButton} disabled={login.isPending}>
          {login.isPending ? t('admin.auth.signingIn') : t('admin.auth.signIn')}
        </button>
      </form>
    </AuthCard>
  )
}

function CodeForm({ factorId }: { factorId: string }) {
  const { t } = useTranslation()
  const refresh = useRefreshAdminAuth()
  const codeId = useId()
  const [code, setCode] = useState('')
  const verify = useMutation({
    mutationFn: () => verifyTotp(factorId, code),
    onSuccess: refresh,
    // A wrong code should be retyped, not edited.
    onError: () => setCode(''),
  })

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        verify.mutate()
      }}
    >
      <label htmlFor={codeId} className="text-sm font-semibold text-slate-700">
        {t('admin.mfa.codeLabel')}
      </label>
      <input
        id={codeId}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em]`}
      />
      <ErrorText error={verify.error} />
      <button
        type="submit"
        className={primaryButton}
        disabled={code.length !== 6 || verify.isPending}
      >
        {verify.isPending ? t('admin.mfa.verifying') : t('admin.mfa.verify')}
      </button>
    </form>
  )
}

export function MfaEnrollForm() {
  const { t } = useTranslation()
  // Started by a tap, not on mount: React's development double-render would
  // otherwise enrol twice, and the admin should choose when to do this.
  const start = useMutation({ mutationFn: startTotpEnrollment })

  return (
    <AuthCard title={t('admin.mfa.setupTitle')}>
      {!start.data ? (
        <>
          <p className="text-slate-600">{t('admin.mfa.setupBody')}</p>
          <ErrorText error={start.error} />
          <button
            type="button"
            className={primaryButton}
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? t('admin.mfa.starting') : t('admin.mfa.start')}
          </button>
        </>
      ) : (
        <>
          <p className="text-slate-600">{t('admin.mfa.scan')}</p>
          <img
            src={start.data.qrCode}
            alt=""
            className="mx-auto h-48 w-48 rounded-lg border border-slate-200"
          />
          <p className="text-sm text-slate-600">
            {t('admin.mfa.manualKey')}{' '}
            <span className="font-mono break-all select-all">{start.data.secret}</span>
          </p>
          <CodeForm factorId={start.data.factorId} />
        </>
      )}
      <SignOutButton />
    </AuthCard>
  )
}

export function MfaVerifyForm({ factorId }: { factorId: string }) {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('admin.mfa.verifyTitle')}>
      <p className="text-slate-600">{t('admin.mfa.verifyBody')}</p>
      <CodeForm factorId={factorId} />
      <SignOutButton />
    </AuthCard>
  )
}

export function NotAdminNotice({ email }: { email: string }) {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('admin.notAdmin.title')}>
      <p className="text-slate-600">{t('admin.notAdmin.body', { email })}</p>
      <SignOutButton />
    </AuthCard>
  )
}

export function SignOutButton() {
  const { t } = useTranslation()
  const refresh = useRefreshAdminAuth()
  const out = useMutation({ mutationFn: signOut, onSuccess: refresh })
  return (
    <>
      <ErrorText error={out.error} />
      <button
        type="button"
        className="text-sm font-semibold text-slate-600 underline"
        disabled={out.isPending}
        onClick={() => out.mutate()}
      >
        {t('admin.auth.signOut')}
      </button>
    </>
  )
}
