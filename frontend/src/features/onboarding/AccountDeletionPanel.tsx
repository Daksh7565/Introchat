import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AccountDeletionView, type DeletionState } from './AccountDeletionView'
import { cancelDeletion, DELETION_KEY, myDeletionRequest, requestDeletion } from './api'

/**
 * "Delete my account" (§11, DPDP): the guest asks, an admin completes it
 * within 30 days. Says plainly what is lost before asking, and lets a
 * pending request be cancelled.
 */
export function AccountDeletionPanel() {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const pending = useQuery({ queryKey: DELETION_KEY, queryFn: myDeletionRequest })
  const refresh = () => queryClient.invalidateQueries({ queryKey: DELETION_KEY })
  const ask = useMutation({
    mutationFn: requestDeletion,
    onSuccess: () => {
      setConfirming(false)
      return refresh()
    },
  })
  const cancel = useMutation({ mutationFn: cancelDeletion, onSuccess: refresh })

  if (pending.isPending) return null
  const state: DeletionState = pending.data
    ? { kind: 'pending', since: pending.data }
    : confirming
      ? { kind: 'confirming' }
      : { kind: 'idle' }
  return (
    <AccountDeletionView
      state={state}
      busy={ask.isPending || cancel.isPending}
      error={pending.error ?? ask.error ?? cancel.error}
      onStart={() => setConfirming(true)}
      onConfirm={() => ask.mutate()}
      onBack={() => setConfirming(false)}
      onCancelRequest={() => cancel.mutate()}
    />
  )
}
