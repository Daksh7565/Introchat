import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { formatCountdown } from '../../lib/format'
import { useNow, useOnline } from '../../lib/useNow'
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { CONVERSATIONS_KEY, getConversations } from '../chat/api'
import { ChatPanel } from '../chat/ChatPanel'
import { ConversationListView } from '../chat/ConversationListView'
import { GuestHomeView, type HomeTab } from '../home/GuestHomeView'
import {
  getPeople,
  getRequests,
  PEOPLE_KEY,
  REQUESTS_KEY,
  respondChatRequest,
  sendChatRequest,
} from '../people/api'
import { PeopleListView } from '../people/PeopleListView'
import { blockPerson, type ReportReason, reportPerson, type SafetyTarget } from '../safety/api'
import { SafetyDialog } from '../safety/SafetyDialog'
import { RequestListView } from '../requests/RequestListView'
import { isCancelled, usePayment } from '../payments/usePayment'
import { continueFree, continueWithCredit, endMySession, type SessionState } from './api'
import { sessionOptions } from './options'
import { SessionPopup } from './SessionPopup'
import { awaySecondsLeft, timerAt } from './timer'
import { TimerChip } from './TimerChip'
import type { ConversationSummary } from '../people/types'
import type { SessionOption } from './types'
import { useLiveChannels } from './useLiveChannels'
import { PushPrompt } from './PushPrompt'
import { usePresenceLoop } from './usePresenceLoop'

interface SessionHomeProps {
  userId: string
  state: SessionState
  /** Every newer state from the server (heartbeat, continue, leave). */
  onState: (state: SessionState) => void
  /** Asks the server again, e.g. when the final countdown reaches 0. */
  onRefresh: () => void
}

interface SafetyOpen {
  mode: 'block' | 'report'
  target: SafetyTarget
  handle: string
}

type SafetyRequest =
  | { mode: 'block'; target: SafetyTarget }
  | { mode: 'report'; target: SafetyTarget; reason: ReportReason; note: string }

// How long the "Reported" / "Blocked" confirmation stays.
const SAFETY_DONE_MS = 6000

// How long "Leave" waits for the confirming second tap.
const LEAVE_CONFIRM_MS = 4000

/**
 * The guest's screen during a live session: timer and presence, and the
 * People, Requests and Chats tabs kept current by the live channels.
 * Phones open a chat as its own screen; desktops show it on the right.
 */
export function SessionHome({ userId, state, onState, onRefresh }: SessionHomeProps) {
  const { t } = useTranslation()
  const client = useQueryClient()
  // A ban or an ended session refuses the heartbeat: re-read the session to show why.
  usePresenceLoop(state, onState, onRefresh)
  useLiveChannels(userId, state.venueId)
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const now = useNow()
  const online = useOnline()
  const [tab, setTab] = useState<HomeTab>('people')
  // "Not now" on the warning hides it for this block only (keyed by its end).
  const [warningClosedFor, setWarningClosedFor] = useState<number | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  // The block / report dialog, and the confirmation shown after it.
  const [safety, setSafety] = useState<SafetyOpen | null>(null)
  const [safetyDone, setSafetyDone] = useState<'blocked' | 'reported' | null>(null)

  const people = useQuery({ queryKey: PEOPLE_KEY, queryFn: getPeople })
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: getRequests })
  const conversations = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: getConversations })
  const refetchLists = () => {
    for (const key of [PEOPLE_KEY, REQUESTS_KEY, CONVERSATIONS_KEY]) {
      void client.invalidateQueries({ queryKey: key })
    }
  }
  const openChat = (conversationId: string | null) => {
    if (conversationId === null) return
    setOpenId(conversationId)
    setTab('chats')
  }
  const sayHi = useMutation({
    mutationFn: sendChatRequest,
    onSuccess: openChat,
    onSettled: refetchLists,
  })
  const answer = useMutation({
    mutationFn: ({ requestId, accept }: { requestId: string; accept: boolean }) =>
      respondChatRequest(requestId, accept),
    onSuccess: openChat,
    onSettled: refetchLists,
  })

  const extend = useMutation({ mutationFn: continueFree, onSuccess: onState })
  const useScan = useMutation({ mutationFn: continueWithCredit, onSuccess: onState })
  // Paying to continue or subscribing: the session is re-fetched when the
  // server has applied it (usePayment), and the server's notice confirms it.
  const pay = usePayment()
  const safetyAction = useMutation({
    mutationFn: async (request: SafetyRequest) => {
      if (request.mode === 'block') await blockPerson(request.target)
      else await reportPerson(request.target, request.reason, request.note)
    },
    onSuccess: (_data, request) => {
      setSafety(null)
      setOpenId(null)
      setSafetyDone(request.mode === 'block' ? 'blocked' : 'reported')
      refetchLists()
    },
  })
  const leave = useMutation({ mutationFn: endMySession, onSuccess: onState })
  const timer = timerAt(state, now)
  const away = awaySecondsLeft(state, now)
  const finalExpired = timer.phase === 'final' && timer.secondsLeft === 0

  // At 0 the server's tick ends the session within ~10 s; ask until it has.
  useEffect(() => {
    if (!finalExpired) return
    onRefresh()
    const id = window.setInterval(onRefresh, 5000)
    return () => window.clearInterval(id)
  }, [finalExpired, onRefresh])

  useEffect(() => {
    if (!safetyDone) return
    const id = window.setTimeout(() => setSafetyDone(null), SAFETY_DONE_MS)
    return () => window.clearTimeout(id)
  }, [safetyDone])

  useEffect(() => {
    if (!confirmLeave) return
    const id = window.setTimeout(() => setConfirmLeave(false), LEAVE_CONFIRM_MS)
    return () => window.clearTimeout(id)
  }, [confirmLeave])

  if (timer.phase === 'ended') return null

  const personList = people.data ?? []
  const chatList = conversations.data ?? []
  // A chat that disappeared (deleted when both left) closes by itself.
  const open = chatList.find((c) => c.id === openId) ?? null
  const unread = chatList.reduce((sum, c) => sum + c.unread, 0)
  const listError = people.error ?? requests.error ?? conversations.error
  // Notifications are offered once chatting has started (ARCHITECTURE §4.14).
  const requestsStarted =
    (requests.data?.length ?? 0) > 0 ||
    personList.some((p) => p.chatState !== 'none') ||
    chatList.length > 0

  const openSafety = (mode: 'block' | 'report', target: SafetyTarget, handle: string) => {
    safetyAction.reset()
    setSafety({ mode, target, handle })
  }
  const fromPeople = (mode: 'block' | 'report') => (sessionId: string) => {
    const person = personList.find((p) => p.sessionId === sessionId)
    if (person) openSafety(mode, { sessionId }, person.handle)
  }
  const chatPanel = (conversation: ConversationSummary, onBack?: () => void) => (
    <ChatPanel
      key={conversation.id}
      conversation={conversation}
      onBack={onBack}
      onReport={() =>
        openSafety('report', { conversationId: conversation.id }, conversation.partnerHandle)
      }
      onBlock={() =>
        openSafety('block', { conversationId: conversation.id }, conversation.partnerHandle)
      }
    />
  )

  const choosing = extend.isPending || useScan.isPending || pay.isPending
  const choiceError = extend.error ?? useScan.error ?? (isCancelled(pay.error) ? null : pay.error)
  const choose = (option: SessionOption) => {
    switch (option.kind) {
      case 'continue_free':
        return extend.mutate()
      case 'use_scan':
        return useScan.mutate()
      case 'continue_paid':
        return pay.mutate({ purpose: 'continue', entry: null })
      case 'subscribe':
        return pay.mutate({ purpose: 'subscription', entry: null })
      case 'subscribe_coming_soon':
        return undefined
    }
  }
  const showWarning =
    timer.phase === 'running' && timer.warning && warningClosedFor !== state.expiresAt.getTime()

  const header = (
    <div className="flex shrink-0 items-center gap-2">
      {state.scanCredits > 0 && (
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">
          {t('session.scansLeft', { count: state.scanCredits })}
        </span>
      )}
      <TimerChip
        secondsLeft={timer.secondsLeft}
        warning={timer.phase === 'final' || timer.warning}
      />
      <button
        type="button"
        disabled={leave.isPending}
        onClick={() => (confirmLeave ? leave.mutate() : setConfirmLeave(true))}
        className={`rounded-full px-3 py-1 text-sm font-semibold ${
          confirmLeave ? 'bg-rose-600 text-white' : 'text-slate-600'
        }`}
      >
        {confirmLeave ? t('session.leaveConfirm') : t('session.leave')}
      </button>
    </div>
  )

  return (
    <div className="flex flex-1 flex-col gap-3">
      {!online && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {t('session.offline')}
        </p>
      )}
      {away !== null && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('session.away', { venue: state.venueName, time: formatCountdown(away) })}
        </p>
      )}
      <PushPrompt sessionId={state.sessionId} relevant={requestsStarted} />
      {safetyDone && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {safetyDone === 'blocked' ? t('safety.blocked') : t('safety.reported')}
        </p>
      )}
      <ErrorText error={leave.error ?? sayHi.error ?? answer.error ?? listError} />

      {open && !isDesktop ? (
        chatPanel(open, () => setOpenId(null))
      ) : (
        <GuestHomeView
          venueName={state.venueName}
          activeTab={tab}
          onTabChange={setTab}
          requestCount={requests.data?.length ?? 0}
          unreadCount={unread}
          timer={header}
          detail={isDesktop ? open && chatPanel(open) : undefined}
        >
          {tab === 'people' && (
            <PeopleListView
              people={personList}
              onSendRequest={(sessionId) => sayHi.mutate(sessionId)}
              onAcceptRequest={(sessionId) => {
                const requestId = personList.find((p) => p.sessionId === sessionId)?.requestId
                if (requestId) answer.mutate({ requestId, accept: true })
              }}
              onOpenChat={(sessionId) =>
                openChat(personList.find((p) => p.sessionId === sessionId)?.conversationId ?? null)
              }
              onReport={fromPeople('report')}
              onBlock={fromPeople('block')}
            />
          )}
          {tab === 'requests' && (
            <RequestListView
              requests={requests.data ?? []}
              now={new Date(now)}
              onAccept={(requestId) => answer.mutate({ requestId, accept: true })}
              onDecline={(requestId) => answer.mutate({ requestId, accept: false })}
            />
          )}
          {tab === 'chats' && <ConversationListView conversations={chatList} onOpen={openChat} />}
        </GuestHomeView>
      )}

      {(showWarning || timer.phase === 'final') && (
        <SessionPopup
          variant={timer.phase === 'final' ? 'final' : 'warning'}
          secondsLeft={timer.secondsLeft}
          options={sessionOptions(state)}
          busy={choosing}
          error={choiceError}
          onChoose={choose}
          onDismiss={() =>
            timer.phase === 'final'
              ? leave.mutate()
              : setWarningClosedFor(state.expiresAt.getTime())
          }
        />
      )}

      {safety && (
        <SafetyDialog
          mode={safety.mode}
          handle={safety.handle}
          busy={safetyAction.isPending}
          error={safetyAction.error}
          onBlock={() => safetyAction.mutate({ mode: 'block', target: safety.target })}
          onReport={(reason, note) =>
            safetyAction.mutate({ mode: 'report', target: safety.target, reason, note })
          }
          onCancel={() => setSafety(null)}
        />
      )}
    </div>
  )
}
