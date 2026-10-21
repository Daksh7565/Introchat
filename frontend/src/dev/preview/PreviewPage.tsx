// DEV ONLY. Click-through preview of the guest screens with sample data, at
// /dev/preview. Loaded by the router only in development builds. The screens
// are the real components; only the data and this harness are fake. Harness
// labels are plain English on purpose: no guest ever sees this page.

import { useEffect, useState } from 'react'
import { OtpStep } from '../../features/auth/OtpStep'
import { PhoneStep } from '../../features/auth/PhoneStep'
import { ChatView } from '../../features/chat/ChatView'
import { ConversationListView } from '../../features/chat/ConversationListView'
import { GuestHomeView, type HomeTab } from '../../features/home/GuestHomeView'
import { type LocationStatus, VenueLandingView } from '../../features/landing/VenueLandingView'
import { ConsentStep } from '../../features/onboarding/ConsentStep'
import { NotAGuestView, ReadyView, UnderAgeView } from '../../features/onboarding/EndViews'
import { ProfileStep } from '../../features/onboarding/ProfileStep'
import { STARTER_TAGS } from '../../features/onboarding/rules'
import { TagsStep } from '../../features/onboarding/TagsStep'
import { PeopleListView } from '../../features/people/PeopleListView'
import type { ChatMessage, ConversationSummary, Person } from '../../features/people/types'
import { RequestListView } from '../../features/requests/RequestListView'
import { SessionEndedView } from '../../features/session/SessionEndedView'
import { SessionPopup } from '../../features/session/SessionPopup'
import { TimerChip } from '../../features/session/TimerChip'
import type { SessionEndReason, SessionOption } from '../../features/session/types'
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import {
  PREVIEW_PEOPLE,
  PREVIEW_VENUE,
  previewConversations,
  previewMessages,
  previewRequests,
} from './fixtures'

type Screen = 'landing' | 'login' | 'onboarding' | 'home' | 'chat' | 'warning' | 'final' | 'ended'
type LoginStep = 'phone' | 'code'
const LOGIN_STEPS: LoginStep[] = ['phone', 'code']
type OnboardingScreen = 'consent' | 'profile' | 'tags' | 'ready' | 'under_age' | 'admin'
const ONBOARDING_SCREENS: OnboardingScreen[] = [
  'consent',
  'profile',
  'tags',
  'ready',
  'under_age',
  'admin',
]

type PaymentsMode = 'off' | 'on' | 'subscriber'

const SCREENS: { id: Screen; label: string }[] = [
  { id: 'landing', label: 'Landing' },
  { id: 'login', label: 'Login' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'home', label: 'Home' },
  { id: 'chat', label: 'Chat' },
  { id: 'warning', label: '15-min warning' },
  { id: 'final', label: 'Time up' },
  { id: 'ended', label: 'Ended' },
]

const LOCATION_STATES: LocationStatus[] = [
  'idle',
  'checking',
  'inside',
  'outside',
  'unknown',
  'denied',
  'unsupported',
]
const END_REASONS: SessionEndReason[] = [
  'expired',
  'left_venue',
  'user_logout',
  'kicked',
  'banned',
  'venue_closed',
]

// Same rules as ARCHITECTURE §4.11, with the default prices from app_settings.
function optionsFor(mode: PaymentsMode): SessionOption[] {
  switch (mode) {
    case 'off':
      return [{ kind: 'continue_free', minutes: 60 }, { kind: 'subscribe_coming_soon' }]
    case 'on':
      return [
        { kind: 'continue_paid', minutes: 60, pricePaise: 1900 },
        { kind: 'subscribe', pricePaise: 40000, scans: 25 },
      ]
    case 'subscriber':
      return [{ kind: 'use_scan', minutes: 120, creditsLeft: 24 }]
  }
}

export function PreviewPage() {
  // Fixed once per mount (a state initialiser runs exactly once), so sample
  // times do not shift on every render.
  const [now] = useState(() => new Date())
  const [screen, setScreen] = useState<Screen>('home')
  const [location, setLocation] = useState<LocationStatus>('inside')
  const [tab, setTab] = useState<HomeTab>('people')
  const [people, setPeople] = useState<Person[]>(PREVIEW_PEOPLE)
  const [requests, setRequests] = useState(() => previewRequests(now))
  const [conversations, setConversations] = useState<ConversationSummary[]>(() =>
    previewConversations(now),
  )
  const [openConversationId, setOpenConversationId] = useState('c-lotus')
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(() => ({
    'c-lotus': previewMessages('c-lotus', now),
    'c-river': previewMessages('c-river', now),
  }))
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(47 * 60 + 12)
  const [payments, setPayments] = useState<PaymentsMode>('off')
  const [endReason, setEndReason] = useState<SessionEndReason>('expired')
  const [note, setNote] = useState<string | null>(null)
  const [loginStep, setLoginStep] = useState<LoginStep>('phone')
  const [codeSentAt, setCodeSentAt] = useState(() => Date.now())
  const [onboarding, setOnboarding] = useState<OnboardingScreen>('consent')
  const [myTags, setMyTags] = useState<string[]>(['music', 'garba'])
  // Desktop opens a chat in the right-hand pane; phones open it as its own screen.
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  // A live countdown, as the real timer will show it.
  useEffect(() => {
    const id = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [])

  function setChatState(sessionId: string, chatState: Person['chatState']) {
    setPeople((list) => list.map((p) => (p.sessionId === sessionId ? { ...p, chatState } : p)))
  }

  function startChatWith(handle: string) {
    const id = `c-${handle}`
    setConversations((list) =>
      list.some((c) => c.partnerHandle === handle)
        ? list
        : [
            {
              id,
              partnerHandle: handle,
              lastMessage: null,
              lastMessageAt: null,
              unread: 0,
              canSend: true,
            },
            ...list,
          ],
    )
    setMessages((all) => (all[id] ? all : { ...all, [id]: [] }))
  }

  function openChat(conversationId: string) {
    setOpenConversationId(conversationId)
    setConversations((list) => list.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)))
    setScreen(isDesktop ? 'home' : 'chat')
  }

  function openChatWithSession(sessionId: string) {
    const handle = people.find((p) => p.sessionId === sessionId)?.handle
    const conversation = conversations.find((c) => c.partnerHandle === handle)
    if (conversation) openChat(conversation.id)
  }

  function send(body: string) {
    const id = openConversationId
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      fromMe: true,
      body,
      sentAt: new Date(),
      seen: false,
    }
    setMessages((all) => ({ ...all, [id]: [...(all[id] ?? []), message] }))
    setConversations((list) =>
      list.map((c) =>
        c.id === id ? { ...c, lastMessage: body, lastMessageAt: message.sentAt } : c,
      ),
    )
    // Simulate the other person reading and replying.
    window.setTimeout(() => {
      setMessages((all) => ({
        ...all,
        [id]: (all[id] ?? []).map((m) => (m.id === message.id ? { ...m, seen: true } : m)),
      }))
      setPartnerTyping(true)
    }, 1200)
    window.setTimeout(() => {
      setPartnerTyping(false)
      setMessages((all) => ({
        ...all,
        [id]: [
          ...(all[id] ?? []),
          {
            id: crypto.randomUUID(),
            fromMe: false,
            body: '😄 nice!',
            sentAt: new Date(),
            seen: true,
          },
        ],
      }))
    }, 3500)
  }

  const openConversation = conversations.find((c) => c.id === openConversationId)
  const unread = conversations.reduce((sum, c) => sum + (c.canSend ? c.unread : 0), 0)
  const timer = <TimerChip secondsLeft={secondsLeft} warning={secondsLeft <= 15 * 60} />
  const chat = (onBack?: () => void) =>
    openConversation ? (
      <ChatView
        partnerHandle={openConversation.partnerHandle}
        messages={messages[openConversation.id] ?? []}
        canSend={openConversation.canSend}
        partnerTyping={partnerTyping}
        onSend={send}
        onBack={onBack}
        onBlock={() => setNote('Block tapped (wired in M6)')}
        onReport={() => setNote('Report tapped (wired in M6)')}
      />
    ) : null
  const showHome = screen === 'home' || (screen === 'chat' && isDesktop)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
        <p className="font-semibold">DEV PREVIEW · sample data · not in production builds</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScreen(s.id)}
              className={`rounded-full px-2.5 py-1 ${screen === s.id ? 'bg-amber-600 text-white' : 'bg-white'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {screen === 'landing' && (
          <HarnessChoice
            label="Location"
            value={location}
            values={LOCATION_STATES}
            onChange={setLocation}
          />
        )}
        {screen === 'login' && (
          <HarnessChoice
            label="Step"
            value={loginStep}
            values={LOGIN_STEPS}
            onChange={setLoginStep}
          />
        )}
        {screen === 'onboarding' && (
          <HarnessChoice
            label="Step"
            value={onboarding}
            values={ONBOARDING_SCREENS}
            onChange={setOnboarding}
          />
        )}
        {(screen === 'warning' || screen === 'final') && (
          <HarnessChoice
            label="Payments"
            value={payments}
            values={['off', 'on', 'subscriber'] as const}
            onChange={setPayments}
          />
        )}
        {screen === 'ended' && (
          <HarnessChoice
            label="Reason"
            value={endReason}
            values={END_REASONS}
            onChange={setEndReason}
          />
        )}
        {note && <p className="mt-2">→ {note}</p>}
      </div>

      {screen === 'landing' && (
        <VenueLandingView
          venueName={PREVIEW_VENUE.name}
          tableLabel={PREVIEW_VENUE.tableLabel}
          location={location}
          onCheck={() => setLocation('checking')}
          onContinue={() => setScreen('login')}
        />
      )}

      {screen === 'login' && loginStep === 'phone' && (
        <PhoneStep
          sending={false}
          error={null}
          onSubmit={() => {
            setCodeSentAt(Date.now())
            setLoginStep('code')
          }}
          onBack={() => setScreen('landing')}
        />
      )}
      {screen === 'login' && loginStep === 'code' && (
        <OtpStep
          key={codeSentAt}
          mobile="9876543210"
          sentAt={codeSentAt}
          verifying={false}
          resending={false}
          error={null}
          onVerify={() => {
            setOnboarding('consent')
            setScreen('onboarding')
          }}
          onResend={() => setCodeSentAt(Date.now())}
          onChangeNumber={() => setLoginStep('phone')}
        />
      )}

      {screen === 'onboarding' && onboarding === 'consent' && (
        <ConsentStep
          stepLabel="Step 1 of 3"
          saving={false}
          error={null}
          onAccept={() => setOnboarding('profile')}
        />
      )}
      {screen === 'onboarding' && onboarding === 'profile' && (
        <ProfileStep
          stepLabel="Step 2 of 3"
          currentYear={now.getFullYear()}
          saving={false}
          error={null}
          onSubmit={(answers) =>
            setOnboarding(now.getFullYear() - answers.birthYear < 18 ? 'under_age' : 'tags')
          }
        />
      )}
      {screen === 'onboarding' && onboarding === 'tags' && (
        <TagsStep
          stepLabel="Step 3 of 3"
          initialTags={myTags}
          suggestions={[...STARTER_TAGS]}
          onQueryChange={() => undefined}
          rejectedTag={null}
          saving={false}
          error={null}
          onSave={(tags) => {
            setMyTags(tags)
            setOnboarding('ready')
          }}
        />
      )}
      {screen === 'onboarding' && onboarding === 'ready' && (
        <ReadyView
          handle="Mango-4821"
          tags={myTags}
          venueName={PREVIEW_VENUE.name}
          joining={false}
          joinError={null}
          onJoin={() => setScreen('home')}
          loggingOut={false}
          logOutError={null}
          onLogOut={() => setScreen('landing')}
        />
      )}
      {screen === 'onboarding' && onboarding === 'under_age' && (
        <UnderAgeView loggingOut={false} logOutError={null} onLogOut={() => setScreen('landing')} />
      )}
      {screen === 'onboarding' && onboarding === 'admin' && (
        <NotAGuestView
          loggingOut={false}
          logOutError={null}
          onLogOut={() => setScreen('landing')}
        />
      )}

      {showHome && (
        <GuestHomeView
          venueName={PREVIEW_VENUE.name}
          activeTab={tab}
          onTabChange={setTab}
          requestCount={requests.length}
          unreadCount={unread}
          timer={timer}
          detail={isDesktop ? chat() : undefined}
        >
          {tab === 'people' && (
            <PeopleListView
              people={people}
              onSendRequest={(id) => setChatState(id, 'request_sent')}
              onAcceptRequest={(id) => {
                const handle = people.find((p) => p.sessionId === id)?.handle
                if (handle) startChatWith(handle)
                setChatState(id, 'chatting')
                setRequests((list) => list.filter((r) => r.handle !== handle))
              }}
              onOpenChat={openChatWithSession}
            />
          )}
          {tab === 'requests' && (
            <RequestListView
              requests={requests}
              now={now}
              onAccept={(requestId) => {
                const request = requests.find((r) => r.id === requestId)
                if (!request) return
                startChatWith(request.handle)
                setPeople((list) =>
                  list.map((p) =>
                    p.handle === request.handle ? { ...p, chatState: 'chatting' } : p,
                  ),
                )
                setRequests((list) => list.filter((r) => r.id !== requestId))
              }}
              onDecline={(requestId) =>
                setRequests((list) => list.filter((r) => r.id !== requestId))
              }
            />
          )}
          {tab === 'chats' && (
            <ConversationListView conversations={conversations} onOpen={openChat} />
          )}
        </GuestHomeView>
      )}

      {screen === 'chat' &&
        !isDesktop &&
        chat(() => {
          setScreen('home')
          setTab('chats')
        })}

      {(screen === 'warning' || screen === 'final') && (
        <>
          <GuestHomeView
            venueName={PREVIEW_VENUE.name}
            activeTab="people"
            onTabChange={() => undefined}
            requestCount={requests.length}
            unreadCount={unread}
            timer={<TimerChip secondsLeft={screen === 'warning' ? 15 * 60 : 0} warning />}
          >
            <PeopleListView
              people={people}
              onSendRequest={() => undefined}
              onAcceptRequest={() => undefined}
              onOpenChat={() => undefined}
            />
          </GuestHomeView>
          <SessionPopup
            variant={screen}
            secondsLeft={screen === 'warning' ? 15 * 60 : 104}
            options={optionsFor(payments)}
            onChoose={(option) => setNote(`Chose "${option.kind}" (wired in M3/M5)`)}
            onDismiss={() => setScreen(screen === 'warning' ? 'home' : 'ended')}
          />
        </>
      )}

      {screen === 'ended' && (
        <SessionEndedView reason={endReason} chatsDeleted={payments !== 'subscriber'} />
      )}
    </div>
  )
}

interface HarnessChoiceProps<T extends string> {
  label: string
  value: T
  values: readonly T[]
  onChange: (value: T) => void
}

function HarnessChoice<T extends string>({
  label,
  value,
  values,
  onChange,
}: HarnessChoiceProps<T>) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="font-semibold">{label}:</span>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded px-2 py-0.5 ${value === v ? 'bg-amber-600 text-white' : 'bg-white'}`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}
