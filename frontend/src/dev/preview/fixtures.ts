// DEV ONLY. Sample data for /dev/preview. Never imported by production code:
// the router loads the preview only when import.meta.env.DEV is true, so this
// file is not part of a production build (checked in the build output).
//
// The venue is fictional. Handles follow the real format (<Word>-<4 digits>).

import type {
  ChatMessage,
  ConversationSummary,
  IncomingRequest,
  Person,
} from '../../features/people/types'

export const PREVIEW_VENUE = { name: 'Chai & Chatter Café', tableLabel: 'Table 7' }

/** The viewer's own interests, used to compute shared tags below. */
const MY_TAGS = ['football', 'music', 'startups', 'chai']

function person(
  sessionId: string,
  handle: string,
  tags: string[],
  online: boolean,
  chatState: Person['chatState'],
): Person {
  return {
    sessionId,
    handle,
    tags,
    sharedTags: tags.filter((tag) => MY_TAGS.includes(tag)),
    online,
    chatState,
  }
}

// Already in server order: online first, then most shared tags.
export const PREVIEW_PEOPLE: Person[] = [
  person('s-falcon', 'Falcon-0937', ['football', 'startups', 'music', 'travel'], true, 'none'),
  person('s-lotus', 'Lotus-2210', ['music', 'chai', 'ગરબા'], true, 'chatting'),
  person('s-comet', 'Comet-5502', ['football', 'cricket'], true, 'request_received'),
  person('s-tiger', 'Tiger-7781', ['startups', 'photography'], true, 'request_sent'),
  person('s-pebble', 'Pebble-3315', ['bollywood', 'books', 'चाय'], true, 'none'),
  person('s-orbit', 'Orbit-1046', ['gaming', 'anime'], true, 'declined'),
  person('s-maple', 'Maple-6620', ['music', 'yoga'], false, 'none'),
]

export function previewRequests(now: Date): IncomingRequest[] {
  return [
    {
      id: 'r-comet',
      handle: 'Comet-5502',
      tags: ['football', 'cricket'],
      sharedTags: ['football'],
      expiresAt: new Date(now.getTime() + 7 * 60_000),
    },
  ]
}

export function previewConversations(now: Date): ConversationSummary[] {
  return [
    {
      id: 'c-lotus',
      partnerHandle: 'Lotus-2210',
      lastMessage: 'Haha same! Which song is your favourite?',
      lastMessageAt: new Date(now.getTime() - 2 * 60_000),
      unread: 1,
      canSend: true,
    },
    {
      id: 'c-river',
      partnerHandle: 'River-8890',
      lastMessage: 'Nice talking to you!',
      lastMessageAt: new Date(now.getTime() - 25 * 60_000),
      unread: 0,
      canSend: false,
    },
  ]
}

export function previewMessages(conversationId: string, now: Date): ChatMessage[] {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000)
  if (conversationId === 'c-river') {
    return [
      {
        id: 'm1',
        fromMe: false,
        body: 'Hey! Is the cold coffee here good?',
        sentAt: at(40),
        seen: true,
      },
      {
        id: 'm2',
        fromMe: true,
        body: 'The best in the area 😄 try the hazelnut one',
        sentAt: at(38),
        seen: true,
      },
      { id: 'm3', fromMe: false, body: 'Nice talking to you!', sentAt: at(25), seen: true },
    ]
  }
  return [
    { id: 'm1', fromMe: true, body: 'Hi! I saw we both like music 🎵', sentAt: at(9), seen: true },
    {
      id: 'm2',
      fromMe: false,
      body: 'Hey! Yes, mostly Arijit and some indie 🙂',
      sentAt: at(8),
      seen: true,
    },
    {
      id: 'm3',
      fromMe: true,
      body: 'Arijit is the best. Coming to the garba night on Saturday?',
      sentAt: at(5),
      seen: true,
    },
    {
      id: 'm4',
      fromMe: false,
      body: 'Haha same! Which song is your favourite?',
      sentAt: at(2),
      seen: true,
    },
  ]
}
