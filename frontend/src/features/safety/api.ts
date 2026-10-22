import { unwrap } from '../../lib/rpc'
import { supabase } from '../../lib/supabase'

export const REPORT_REASONS = ['harassment', 'spam', 'inappropriate', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

/**
 * Who a block or report is about: a person on the People list (their
 * session), or a conversation (also a read-only one after they left).
 */
export type SafetyTarget = { sessionId: string } | { conversationId: string }

function targetArgs(target: SafetyTarget) {
  return 'sessionId' in target
    ? { p_session_id: target.sessionId }
    : { p_conversation_id: target.conversationId }
}

/** Permanent: neither sees the other again, and their chat is deleted on both sides. */
export async function blockPerson(target: SafetyTarget): Promise<void> {
  unwrap(await supabase.rpc('block_person', targetArgs(target)))
}

/** Reports (with the chat as evidence) and blocks. Returns the report id. */
export async function reportPerson(
  target: SafetyTarget,
  reason: ReportReason,
  note: string,
): Promise<string> {
  const trimmed = note.trim()
  return unwrap(
    await supabase.rpc('report_person', {
      p_reason: reason,
      ...(trimmed === '' ? {} : { p_note: trimmed }),
      ...targetArgs(target),
    }),
  )
}
