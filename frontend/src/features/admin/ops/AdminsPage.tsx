import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { AppError } from '../../../lib/errors'
import { changePassword } from '../auth/adminAuth'
import { addAdmin, type AdminRow, listAdmins, opsKeys, setAdminActive } from './api'

// Admin passwords guard every venue, payment and report: longer than
// Supabase's project minimum, which applies to the whole project.
const MIN_PASSWORD = 12

/** The team: who can sign in to the Console, adding and deactivating admins, and one's own password. */
export function AdminsPage({ currentEmail }: { currentEmail: string }) {
  const { t } = useTranslation()
  const admins = useQuery({ queryKey: opsKeys.admins, queryFn: listAdmins })
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('admin.admins.title')}</h2>
        {admins.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
        <ErrorText error={admins.error} />
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
          {admins.data?.map((admin) => (
            <AdminItem key={admin.userId} admin={admin} isMe={admin.email === currentEmail} />
          ))}
        </ul>
        <AddAdmin />
      </div>
      <ChangePassword />
    </section>
  )
}

function AdminItem({ admin, isMe }: { admin: AdminRow; isMe: boolean }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const toggle = useMutation({
    mutationFn: () => setAdminActive(admin.userId, !admin.isActive),
    onSuccess: () => {
      setConfirming(false)
      return queryClient.invalidateQueries({ queryKey: opsKeys.admins })
    },
  })
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <li className="flex flex-col gap-1 p-3 text-sm">
      <p className="font-semibold">
        {admin.email}
        {isMe && <span className="font-normal text-slate-500"> ({t('admin.admins.you')})</span>}
      </p>
      <p className="text-slate-600">
        {admin.isActive ? t('admin.admins.active') : t('admin.admins.inactive')} ·{' '}
        {admin.hasMfa ? t('admin.admins.mfaOn') : t('admin.admins.mfaPending')}
        {admin.lastSignInAt &&
          ` · ${t('admin.admins.lastSignIn', { date: when.format(admin.lastSignInAt) })}`}
      </p>
      {!isMe && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start font-semibold underline"
        >
          {admin.isActive ? t('admin.admins.deactivate') : t('admin.admins.reactivate')}
        </button>
      )}
      {confirming && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3">
          <p>
            {admin.isActive ? t('admin.admins.deactivateHelp') : t('admin.admins.reactivateHelp')}
          </p>
          <ErrorText error={toggle.error} />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate()}
              className="rounded-lg bg-amber-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
            >
              {admin.isActive ? t('admin.admins.deactivate') : t('admin.admins.reactivate')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="font-semibold text-slate-600"
            >
              {t('admin.payments.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function AddAdmin() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const add = useMutation({
    mutationFn: () => addAdmin(email),
    onSuccess: () => {
      setEmail('')
      return queryClient.invalidateQueries({ queryKey: opsKeys.admins })
    },
  })
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        if (email.trim() !== '') add.mutate()
      }}
    >
      <p className="font-semibold">{t('admin.admins.add')}</p>
      <p className="text-slate-600">{t('admin.admins.addHelp')}</p>
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          aria-label={t('admin.auth.email')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-56 flex-1 rounded-lg border border-slate-300 px-2 py-1.5"
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
        >
          {t('admin.admins.add')}
        </button>
      </div>
      <ErrorText error={add.error} />
      {add.isSuccess && <p className="text-emerald-700">{t('admin.admins.added')}</p>}
    </form>
  )
}

function ChangePassword() {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const change = useMutation({
    mutationFn: () => changePassword(password),
    onSuccess: () => {
      setPassword('')
      setRepeat('')
    },
  })
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = repeat.length > 0 && repeat !== password
  const localError = tooShort
    ? new AppError('PASSWORD_TOO_SHORT')
    : mismatch
      ? new AppError('PASSWORD_MISMATCH')
      : null

  return (
    <form
      className="flex max-w-md flex-col gap-2 rounded-xl border border-slate-200 p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        if (password.length >= MIN_PASSWORD && password === repeat) change.mutate()
      }}
    >
      <p className="font-semibold">{t('admin.password.title')}</p>
      <p className="text-slate-600">{t('admin.password.help', { count: MIN_PASSWORD })}</p>
      <label className="flex flex-col gap-1">
        <span>{t('admin.password.new')}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{t('admin.password.repeat')}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5"
        />
      </label>
      <ErrorText error={localError ?? change.error} />
      {change.isSuccess && <p className="text-emerald-700">{t('admin.password.changed')}</p>}
      <button
        type="submit"
        disabled={change.isPending || password.length < MIN_PASSWORD || password !== repeat}
        className="self-start rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
      >
        {t('admin.password.save')}
      </button>
    </form>
  )
}
