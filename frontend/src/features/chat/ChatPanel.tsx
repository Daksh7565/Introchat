import type { RealtimeChannel } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../components/ErrorText'
import { supabase } from '../../lib/supabase'
import type { ChatMessage, ConversationSummary } from '../people/types'
import { CONVERSATIONS_KEY, getMessages, markSeen, messagesKey, sendMessage } from './api'
import { ChatView } from './ChatView'

// "typing…" is sent at most this often, and shown this long after the last one.
const TYPING_SEND_EVERY_MS = 3000
const TYPING_SHOW_FOR_MS = 4000

interface ChatPanelProps {
  conversation: ConversationSummary
  onBack?: () => void
  onReport: () => void
  onBlock: () => void
}

/** One open conversation: its messages, sending, seen ticks and "typing…". */
export function ChatPanel({ conversation, onBack, onReport, onBlock }: ChatPanelProps) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const id = conversation.id
  const messages = useQuery({ queryKey: messagesKey(id), queryFn: () => getMessages(id) })
  // My messages not yet confirmed by the server (sending, or failed).
  const [outbox, setOutbox] = useState<ChatMessage[]>([])
  const [partnerTyping, setPartnerTyping] = useState(false)
  const channel = useRef<RealtimeChannel | null>(null)
  const typingSentAt = useRef(0)
  const lastMarked = useRef<string | null>(null)

  // "typing…" travels guest to guest on conv:{id} and is never stored.
  useEffect(() => {
    let hideTimer: number | undefined
    const conv = supabase
      .channel(`conv:${id}`, { config: { private: true } })
      .on('broadcast', { event: 'typing' }, () => {
        setPartnerTyping(true)
        window.clearTimeout(hideTimer)
        hideTimer = window.setTimeout(() => setPartnerTyping(false), TYPING_SHOW_FOR_MS)
      })
      .subscribe()
    channel.current = conv
    return () => {
      window.clearTimeout(hideTimer)
      channel.current = null
      void supabase.removeChannel(conv)
    }
  }, [id])

  // Opening the chat (or a new message arriving while it is open) marks it read.
  const latestIncoming = messages.data?.filter((m) => !m.fromMe).at(-1)?.id ?? null
  useEffect(() => {
    if (latestIncoming === null || latestIncoming === lastMarked.current) return
    lastMarked.current = latestIncoming
    markSeen(id, latestIncoming)
      .then(() => client.invalidateQueries({ queryKey: CONVERSATIONS_KEY }))
      // Seen ticks are a nicety: a failure is retried with the next message.
      .catch(() => {
        lastMarked.current = null
      })
  }, [client, id, latestIncoming])

  const send = useMutation({
    mutationFn: (message: ChatMessage) => sendMessage(id, message.body, message.id),
    onSuccess: async (_data, message) => {
      // Fetch the confirmed message before dropping the local copy (no flicker).
      await client.invalidateQueries({ queryKey: messagesKey(id) })
      setOutbox((list) => list.filter((m) => m.id !== message.id))
      void client.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
    onError: (_error, message) =>
      setOutbox((list) =>
        list.map((m) => (m.id === message.id ? { ...m, pending: false, failed: true } : m)),
      ),
  })

  function sendNew(body: string) {
    // The id doubles as client_msg_id: retries of this message reuse it.
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      fromMe: true,
      body,
      sentAt: new Date(),
      seen: false,
      pending: true,
    }
    setOutbox((list) => [...list, message])
    send.mutate(message)
  }

  function retryFailed() {
    for (const message of outbox.filter((m) => m.failed)) {
      setOutbox((list) =>
        list.map((m) => (m.id === message.id ? { ...m, pending: true, failed: false } : m)),
      )
      send.mutate(message)
    }
  }

  const failed = outbox.some((m) => m.failed)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ChatView
        partnerHandle={conversation.partnerHandle}
        messages={[...(messages.data ?? []), ...outbox]}
        canSend={conversation.canSend}
        partnerTyping={partnerTyping}
        onSend={sendNew}
        onTyping={() => {
          const now = Date.now()
          if (now - typingSentAt.current < TYPING_SEND_EVERY_MS) return
          typingSentAt.current = now
          void channel.current?.send({ type: 'broadcast', event: 'typing', payload: {} })
        }}
        onBack={onBack}
        onReport={onReport}
        onBlock={onBlock}
      />
      <ErrorText error={messages.error} />
      {failed && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <span>{t('chat.notSentHelp')}</span>
          <button type="button" onClick={retryFailed} className="font-semibold">
            {t('location.retry')}
          </button>
        </div>
      )}
    </div>
  )
}
