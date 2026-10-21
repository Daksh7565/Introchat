import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { sendOtp, verifyOtp } from './guestAuth'
import { OtpStep } from './OtpStep'
import { PhoneStep } from './PhoneStep'

interface Sent {
  mobile: string
  at: number
}

/**
 * Phone number → SMS code. Ends when the code is accepted: Supabase stores the
 * session and useAuthSession (in the parent) moves the guest on, so this
 * component has no "done" state of its own.
 */
export function GuestLogin({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState<Sent | null>(null)
  // The last number typed, so "Change number" shows it again for editing.
  const [lastMobile, setLastMobile] = useState('')

  const send = useMutation({
    mutationFn: sendOtp,
    onSuccess: (_data, mobile) => setSent({ mobile, at: Date.now() }),
  })
  const verify = useMutation({
    mutationFn: ({ mobile, code }: { mobile: string; code: string }) => verifyOtp(mobile, code),
  })

  if (sent === null) {
    return (
      <PhoneStep
        initialMobile={lastMobile}
        sending={send.isPending}
        error={send.error}
        onSubmit={(mobile) => {
          setLastMobile(mobile)
          send.mutate(mobile)
        }}
        onBack={onBack}
      />
    )
  }

  return (
    <OtpStep
      key={sent.at}
      mobile={sent.mobile}
      sentAt={sent.at}
      verifying={verify.isPending}
      resending={send.isPending}
      // A failed resend is newer than any verify failure shown before it.
      error={send.error ?? verify.error}
      onVerify={(code) => {
        send.reset()
        verify.mutate({ mobile: sent.mobile, code })
      }}
      onResend={() => {
        verify.reset()
        send.mutate(sent.mobile)
      }}
      onChangeNumber={() => {
        send.reset()
        verify.reset()
        setSent(null)
      }}
    />
  )
}
