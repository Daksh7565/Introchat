import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import { listAppSettings, moneyKeys } from '../money/api'
import { opsKeys, smsUsage } from './api'

/** Login codes sent through the SIM gateway: today against the daily limit, and the last 7 days. */
export function SmsPage() {
  const { t } = useTranslation()
  const usage = useQuery({ queryKey: opsKeys.sms, queryFn: smsUsage })
  const settings = useQuery({ queryKey: moneyKeys.settings, queryFn: listAppSettings })
  const cap = settings.data?.find((s) => s.key === 'SMS_DAILY_CAP')?.value
  const alertAt = settings.data?.find((s) => s.key === 'SMS_ALERT_AT')?.value
  // 'Today' is the India date when the numbers were fetched (the SIM's limit runs on IST).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    usage.dataUpdatedAt,
  )
  const todaySent = usage.data?.find((day) => day.day === today)?.sent ?? 0

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('admin.sms.title')}</h2>
      {typeof cap === 'number' && (
        <p
          className={`rounded-xl p-3 text-sm ${typeof alertAt === 'number' && todaySent >= alertAt ? 'bg-amber-50 text-amber-900' : 'bg-slate-50'}`}
        >
          {t('admin.sms.today', { sent: todaySent, cap })}
        </p>
      )}
      {usage.isPending && <p className="text-slate-500">{t('admin.loading')}</p>}
      <ErrorText error={usage.error ?? settings.error} />
      {usage.data?.length === 0 && <p className="text-slate-500">{t('admin.sms.empty')}</p>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1">{t('admin.sms.day')}</th>
            <th>{t('admin.sms.sent')}</th>
            <th>{t('admin.sms.failed')}</th>
            <th>{t('admin.sms.refused')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {usage.data?.map((day) => (
            <tr key={day.day}>
              <td className="py-1.5 font-mono">{day.day}</td>
              <td>{day.sent}</td>
              <td>{day.failed}</td>
              <td>
                {day.refused}
                {day.refused > 0 && (
                  <span className="text-xs text-slate-500">
                    {' '}
                    (
                    {Object.entries(day.refusals)
                      .map(([reason, count]) => `${reason} ${count}`)
                      .join(', ')}
                    )
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
