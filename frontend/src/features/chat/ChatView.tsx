import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HandleAvatar } from '../../components/HandleAvatar'
import { formatClockTime } from '../../lib/format'
import type { ChatMessage } from '../people/types'

// Same limit the database enforces on messages.body (ARCHITECTURE §2.4). The
// counter only appears near the end so it does not distract.
export const MAX_MESSAGE_LENGTH = 1000
const SHOW_COUNTER_FROM = 900

interface ChatViewProps {
  partnerHandle: string
  messages: ChatMessage[]
  /** false = the other person left or blocked: read-only, still reportable. */
  canSend: boolean
  partnerTyping: boolean
  onSend: (body: string) => void
  /** Called while the guest types (the parent throttles the "typing…" signal). */
  onTyping?: () => void
  /** Phones/tablets: back to the lists. Omitted in the desktop side pane, which has no "back". */
  onBack?: () => void
  /** Block and Report arrive in M6; without them the menu is not shown. */
  onBlock?: () => void
  onReport?: () => void
}

export function ChatView({
  partnerHandle,
  messages,
  canSend,
  partnerTyping,
  onSend,
  onTyping,
  onBack,
  onBlock,
  onReport,
}: ChatViewProps) {
  const { t, i18n } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const endRef = useRef<HTMLLIElement>(null)
  const lastMine = [...messages].reverse().find((message) => message.fromMe)

  // Keep the newest message in view when one arrives or the chat changes.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, partnerHandle])

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-100 pb-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-1 text-xl"
            aria-label={t('chat.back')}
          >
            ←
          </button>
        )}
        <HandleAvatar handle={partnerHandle} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{partnerHandle}</p>
          {partnerTyping && canSend && <p className="text-xs text-teal-700">{t('chat.typing')}</p>}
        </div>
        {onBlock && onReport && (
          <div className="relative">
            <button
              type="button"
              className="px-2 text-xl"
              aria-label={t('chat.menu')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm"
                  onClick={() => {
                    setMenuOpen(false)
                    onReport()
                  }}
                >
                  {t('chat.report')}
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-rose-700"
                  onClick={() => {
                    setMenuOpen(false)
                    onBlock()
                  }}
                >
                  {t('chat.block')}
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-4">
        {messages.map((message) => (
          <li
            key={message.id}
            className={`flex ${message.fromMe ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 lg:max-w-[65%] ${
                message.fromMe
                  ? 'rounded-br-sm bg-teal-700 text-white'
                  : 'rounded-bl-sm bg-slate-100 text-slate-900'
              }`}
            >
              <p className="break-words whitespace-pre-wrap">{message.body}</p>
              <p
                className={`mt-0.5 text-right text-[11px] ${message.fromMe ? 'text-teal-100' : 'text-slate-500'}`}
              >
                {formatClockTime(message.sentAt, i18n.language)}
                {message === lastMine && (
                  <>
                    {' · '}
                    {message.failed
                      ? t('chat.notSent')
                      : message.pending
                        ? t('chat.sending')
                        : message.seen
                          ? t('chat.seen')
                          : t('chat.sent')}
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ol>

      {canSend ? (
        <Composer onSend={onSend} onTyping={onTyping} />
      ) : (
        <p className="rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-600">
          {t('chat.readOnly', { handle: partnerHandle })}
        </p>
      )}
    </section>
  )
}

function Composer({ onSend, onTyping }: { onSend: (body: string) => void; onTyping?: () => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  const remaining = MAX_MESSAGE_LENGTH - draft.length

  function submit() {
    // The server trims and rejects whitespace-only bodies too; checking here
    // just avoids a pointless round trip.
    if (trimmed === '' || draft.length > MAX_MESSAGE_LENGTH) return
    onSend(trimmed)
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a new line. While an input method is still
    // composing (Hindi/Gujarati transliteration keyboards), Enter confirms the
    // word and must never send a half-typed message.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="flex flex-col gap-1 border-t border-slate-100 pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            onTyping?.()
          }}
          onKeyDown={onKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          enterKeyHint="send"
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          className="field-sizing-content max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={trimmed === ''}
          className="rounded-full bg-teal-700 px-4 py-2 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
        >
          {t('chat.send')}
        </button>
      </div>
      {draft.length >= SHOW_COUNTER_FROM && (
        <p className="text-right text-xs text-slate-500">
          {t('chat.charsLeft', { count: remaining })}
        </p>
      )}
    </form>
  )
}
