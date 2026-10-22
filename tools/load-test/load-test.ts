// Load test (M8): many guests in one venue on the DEV project, behaving like
// the app does, to see whether the free plan holds a busy evening.
//
// Each guest: signs in (no SMS: test users are created through the Auth admin
// API with a password), consents, fills in a profile and interests, joins a
// test venue, listens on its private user and venue channels, heartbeats every
// 30 s, re-fetches what the app re-fetches on each notice
// (useLiveChannels.ts), sends chat requests, accepts some, and chats.
//
// Everything it creates (users, venue) is deleted at the end, also on failure
// or Ctrl+C. Run it with tools/load-test/README.md; it needs the service role
// key in SUPABASE_SERVICE_ROLE_KEY and never prints it.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Database } from '../../frontend/src/lib/database.types.ts'

type Client = SupabaseClient<Database>
type Person = Database['public']['Functions']['get_people']['Returns'][number]

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

const URL = env('SUPABASE_URL')
const ANON_KEY = env('SUPABASE_ANON_KEY')
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const GUESTS = Number(env('LOAD_GUESTS', '100'))
const STEADY_SECONDS = Number(env('LOAD_STEADY_SECONDS', '600'))
const REPORT_PATH = Deno.env.get('LOAD_REPORT') ?? ''

if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(URL)) throw new Error('SUPABASE_URL must be the dev project URL')
if (!Number.isInteger(GUESTS) || GUESTS < 2 || GUESTS > 100) throw new Error('LOAD_GUESTS must be 2..100')

// Test phone numbers 9000002000-9000002099: never real SMS (no OTP is sent),
// and outside the ranges the E2E tests (900000001x) and people (900000000x) use.
const phoneOf = (i: number) => `9190000020${String(i).padStart(2, '0')}`
const FIRST_PHONE = phoneOf(0)
const LAST_PHONE = phoneOf(99)

// Where the test venue is, and where every guest stands (a few metres off).
const VENUE = { latitude: 23.0395, longitude: 72.5605 }
const TAGS = ['music', 'cricket', 'movies', 'travel', 'food', 'garba', 'books', 'gaming', 'coffee', 'fitness']

/** A string field of a notice payload (typed `any` by supabase-js), or null. */
function field(payload: unknown, name: string): string | null {
  if (typeof payload !== 'object' || payload === null || !(name in payload)) return null
  const value: unknown = Reflect.get(payload, name)
  return typeof value === 'string' ? value : null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const between = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------
const timings = new Map<string, number[]>()
const failures = new Map<string, number>()
const channelStatus = new Map<string, number>()
const noticeLatency = new Map<string, number[]>()
const noticesReceived = new Map<string, number>()
const lastMessageSentAt = new Map<string, number>()
const joinedAt = new Map<string, number>()

function count(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}
function record(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** Runs one API call, timing it and counting its error by name and message. */
async function timed<R extends { error: { message: string } | null }>(
  name: string,
  run: () => PromiseLike<R>,
): Promise<R> {
  const start = performance.now()
  const result = await run()
  record(timings, name, performance.now() - start)
  if (result.error) count(failures, `${name}: ${result.error.message}`)
  return result
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

function summary(map: Map<string, number[]>) {
  return [...map].map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return {
      name,
      count: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted.at(-1) ?? 0),
    }
  })
}

// ---------------------------------------------------------------------------
// One guest
// ---------------------------------------------------------------------------
class Guest {
  readonly client: Client
  userId = ''
  sessionId = ''
  people: Person[] = []
  stopped = false
  private fetching = new Set<string>()
  private dirty = new Set<string>()

  constructor(
    readonly index: number,
    readonly phone: string,
    readonly password: string,
  ) {
    this.client = createClient<Database>(URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  async signIn() {
    // Supabase allows 30 sign-ins per 5 minutes per IP; wait and retry when over.
    for (let attempt = 0; attempt < 40; attempt++) {
      const { data, error } = await timed('auth.signIn', () =>
        this.client.auth.signInWithPassword({ phone: this.phone, password: this.password }),
      )
      if (data.session) {
        this.userId = data.session.user.id
        this.client.realtime.setAuth(data.session.access_token)
        return
      }
      if (error && /rate limit|too many|429/i.test(error.message)) {
        await sleep(20_000)
        continue
      }
      throw new Error(`sign-in failed for guest ${this.index}: ${error?.message}`)
    }
    throw new Error(`guest ${this.index} never got past the sign-in rate limit`)
  }

  async onboardAndJoin(slug: string, qrToken: string, consentVersion: string) {
    await timed('accept_consent', () => this.client.rpc('accept_consent', { p_version: consentVersion }))
    await timed('update_profile', () =>
      this.client.rpc('update_profile', { p_birth_year: 1990 + (this.index % 12), p_language: pick(['en', 'hi', 'gu']) ?? 'en' }),
    )
    const tags = [...TAGS].sort(() => Math.random() - 0.5).slice(0, 3)
    await timed('set_tags', () => this.client.rpc('set_tags', { p_names: tags }))
    const { data, error } = await timed('start_session', () =>
      this.client.rpc('start_session', {
        p_slug: slug,
        p_qr_token: qrToken,
        ...this.reading(),
        p_device_id: crypto.randomUUID(),
      }),
    )
    if (error || !data?.session_id || !data.venue_id) {
      throw new Error(`guest ${this.index} could not join: ${error?.message ?? 'no session'}`)
    }
    this.sessionId = data.session_id
    joinedAt.set(this.sessionId, performance.now())
    this.listen(data.venue_id)
  }

  private reading() {
    return {
      p_latitude: VENUE.latitude + between(-0.00008, 0.00008),
      p_longitude: VENUE.longitude + between(-0.00008, 0.00008),
      p_accuracy_m: Math.round(between(8, 20)),
      p_age_seconds: Math.round(between(1, 30)),
    }
  }

  /** The app's live channels (useLiveChannels.ts): user notices and venue notices. */
  private listen(venueId: string) {
    const onStatus = (status: string) => {
      count(channelStatus, status)
      if (status === 'SUBSCRIBED') void this.refetchAll()
    }
    this.client
      .channel(`user:${this.userId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, (message) => this.onUserNotice(message.event, message.payload))
      .subscribe(onStatus)
    this.client
      .channel(`venue:${venueId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, (message) => {
        const event = message.event
        count(noticesReceived, `venue ${event}`)
        const sessionId = field(message.payload, 'session_id')
        const joined = sessionId ? joinedAt.get(sessionId) : undefined
        if (event === 'person.joined' && joined !== undefined) {
          record(noticeLatency, 'person.joined (join → others notified)', performance.now() - joined)
        }
        void this.refetch('people')
      })
      .subscribe(onStatus)
  }

  private onUserNotice(event: string, payload: unknown) {
    count(noticesReceived, `user ${event}`)
    const conversationId = field(payload, 'conversation_id')
    if (event.startsWith('request.')) {
      void this.refetch('people')
      void this.refetch('requests')
      if (event === 'request.accepted') void this.refetch('conversations')
    } else if (event.startsWith('chat.')) {
      if (event === 'chat.message' && conversationId) {
        const sentAt = lastMessageSentAt.get(conversationId)
        if (sentAt !== undefined) record(noticeLatency, 'chat.message (send → partner notified)', performance.now() - sentAt)
        void this.readConversation(conversationId)
      }
      void this.refetch('conversations')
    } else if (event === 'person.removed') {
      void this.refetch('people')
      void this.refetch('requests')
      void this.refetch('conversations')
    } else if (event.startsWith('session.')) {
      void this.refetch('session')
    }
  }

  private async refetchAll() {
    await Promise.all([this.refetch('people'), this.refetch('requests'), this.refetch('conversations'), this.refetch('session')])
  }

  /** Like TanStack Query: one fetch in flight per list; a notice during it means one more after. */
  private async refetch(list: 'people' | 'requests' | 'conversations' | 'session'): Promise<void> {
    if (this.stopped) return
    if (this.fetching.has(list)) {
      this.dirty.add(list)
      return
    }
    this.fetching.add(list)
    try {
      do {
        this.dirty.delete(list)
        if (list === 'people') {
          const { data } = await timed('get_people', () => this.client.rpc('get_people'))
          if (data) this.people = data
        } else if (list === 'requests') {
          const { data } = await timed('get_requests', () => this.client.rpc('get_requests'))
          for (const request of data ?? []) void this.answer(request.request_id)
        } else if (list === 'conversations') {
          await timed('get_conversations', () => this.client.rpc('get_conversations'))
        } else {
          await timed('my_session', () => this.client.rpc('my_session'))
        }
      } while (this.dirty.has(list) && !this.stopped)
    } finally {
      this.fetching.delete(list)
    }
  }

  private answering = new Set<string>()
  /** A guest takes a few seconds to look at a request; most say yes. */
  private async answer(requestId: string) {
    if (this.answering.has(requestId)) return
    this.answering.add(requestId)
    await sleep(between(3_000, 10_000))
    if (this.stopped) return
    await timed('respond_chat_request', () =>
      this.client.rpc('respond_chat_request', { p_request_id: requestId, p_accept: Math.random() < 0.8 }),
    )
  }

  private async readConversation(conversationId: string) {
    const { data } = await timed('get_messages', () =>
      this.client.rpc('get_messages', { p_conversation_id: conversationId, p_limit: 100 }),
    )
    const newest = data?.at(-1)
    if (newest && Math.random() < 0.7) {
      await timed('mark_seen', () =>
        this.client.rpc('mark_seen', { p_conversation_id: conversationId, p_up_to_message_id: newest.message_id }),
      )
    }
  }

  /** Heartbeat every 30 s, as usePresenceLoop does with the app on screen. */
  async heartbeatLoop() {
    await sleep(between(0, 30_000))
    while (!this.stopped) {
      await timed('heartbeat', () => this.client.rpc('heartbeat', { ...this.reading(), p_permission: 'granted' }))
      await sleep(30_000)
    }
  }

  /** Every 20-40 s: maybe ask someone to chat, maybe write in an open chat. */
  async behaviourLoop() {
    await sleep(between(10_000, 30_000))
    while (!this.stopped) {
      const pending = this.people.filter((p) => p.chat_state === 'request_sent').length
      const candidate = pick(this.people.filter((p) => p.chat_state === 'none' && p.online))
      if (pending < 2 && candidate && Math.random() < 0.5) {
        await timed('send_chat_request', () =>
          this.client.rpc('send_chat_request', { p_target_session_id: candidate.session_id }),
        )
      }
      for (const person of this.people.filter((p) => p.chat_state === 'chatting' && p.conversation_id)) {
        if (Math.random() < 0.5) {
          lastMessageSentAt.set(person.conversation_id, performance.now())
          await timed('send_message', () =>
            this.client.rpc('send_message', {
              p_conversation_id: person.conversation_id,
              p_body: pick(['Hi! 👋', 'नमस्ते', 'કેમ છો?', 'Which song is this?', 'Same here 😄']) ?? 'Hi',
              p_client_msg_id: crypto.randomUUID(),
            }),
          )
        }
      }
      await sleep(between(20_000, 40_000))
    }
  }

  async leave() {
    this.stopped = true
    await timed('end_my_session', () => this.client.rpc('end_my_session'))
    await this.client.removeAllChannels()
  }
}

// ---------------------------------------------------------------------------
// Set-up and clean-up
// ---------------------------------------------------------------------------
// Users through the Auth admin API (service role). Tables through SQL on the
// linked project, the way the E2E tests do it (e2e/conftest.py): not even the
// service role may read or write tables directly here.
const admin = createClient<Database>(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const REPO = new globalThis.URL('../../', import.meta.url)

/** Runs SQL on the linked dev project (`supabase db query --linked`) and returns the rows. */
async function sql(query: string): Promise<Record<string, unknown>[]> {
  // The repo's Supabase CLI run by node directly: on Windows, npx is a .cmd
  // file, and Windows refuses quotes and line breaks in a .cmd file's arguments.
  const cli = new globalThis.URL('node_modules/supabase/dist/supabase.js', REPO)
  const output = await new Deno.Command('node', {
    args: [decodeURIComponent(cli.pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'db', 'query', '--linked', query],
    cwd: REPO,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  const text = new TextDecoder().decode(output.stdout)
  const start = text.indexOf('{')
  if (!output.success || start < 0) {
    throw new Error(`SQL failed: ${new TextDecoder().decode(output.stderr).slice(-500) || text.slice(-500)}`)
  }
  const parsed: unknown = JSON.parse(text.slice(start))
  const rows = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'rows') : null
  return Array.isArray(rows) ? rows : []
}

async function deleteTestUsers(): Promise<number> {
  let deleted = 0
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listing users failed: ${error.message}`)
    for (const user of data.users) {
      if (user.phone && user.phone >= FIRST_PHONE && user.phone <= LAST_PHONE) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
        if (deleteError) throw new Error(`deleting a test user failed: ${deleteError.message}`)
        deleted++
      }
    }
    if (data.users.length < 1000) return deleted
  }
}

async function createVenue() {
  // Only [a-z0-9] goes into the SQL below.
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 6)
  const slug = `zz-load-${suffix}`
  const qrToken = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const rows = await sql(
    `insert into public.venues (slug, name, type, latitude, longitude, is_active)
     values ('${slug}', 'Load test ${suffix}', 'cafe', ${VENUE.latitude}, ${VENUE.longitude}, true) returning id`,
  )
  const id = rows[0]?.id
  if (typeof id !== 'string') throw new Error('creating the test venue returned no id')
  // Normal timings for this venue, whatever dev is set to (e.g. 3-minute test sessions).
  await sql(
    `insert into public.tables (venue_id, label, qr_token) values ('${id}', 'L1', '${qrToken}');
     insert into public.venue_settings (venue_id, key, value) values
       ('${id}', 'FREE_SESSION_MINUTES', '60'), ('${id}', 'WARNING_BEFORE_MINUTES', '15')`,
  )
  return { id, slug, qrToken }
}

async function deleteVenue(venueId: string) {
  // Sessions keep their venue (restrict); deleting the users removed theirs.
  await sql(`delete from public.sessions where venue_id = '${venueId}'; delete from public.venues where id = '${venueId}'`)
}

async function consentVersion(): Promise<string> {
  const rows = await sql(`select value #>> '{}' as version from public.app_settings where key = 'CONSENT_VERSION'`)
  const version = rows[0]?.version
  if (typeof version !== 'string') throw new Error('could not read CONSENT_VERSION')
  return version
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
async function main() {
  const started = Date.now()
  const leftover = await deleteTestUsers()
  if (leftover > 0) console.log(`removed ${leftover} test users left from an earlier run`)
  const consent = await consentVersion()
  const venue = await createVenue()
  const guests: Guest[] = []
  const running: Promise<void>[] = []
  let failedToJoin = 0
  let cleanedUp = false

  async function cleanUp() {
    if (cleanedUp) return
    cleanedUp = true
    for (const guest of guests) guest.stopped = true
    await Promise.allSettled(guests.map((guest) => guest.leave()))
    const deleted = await deleteTestUsers()
    await deleteVenue(venue.id)
    console.log(`cleaned up: ${deleted} test users and the test venue deleted`)
  }
  Deno.addSignalListener('SIGINT', () => {
    console.log('stopping: cleaning up first')
    void cleanUp().finally(() => Deno.exit(130))
  })

  try {
    // Users first (admin API, not rate limited), then guests arrive one by one
    // as the sign-in limit lets them in, like an evening filling up.
    for (let i = 0; i < GUESTS; i++) {
      const password = `${crypto.randomUUID()}Aa1!`
      const { error } = await admin.auth.admin.createUser({ phone: phoneOf(i), password, phone_confirm: true })
      if (error) throw new Error(`creating test user ${i} failed: ${error.message}`)
      guests.push(new Guest(i, phoneOf(i), password))
    }
    console.log(`${GUESTS} test users created; guests arriving (sign-in limit: 30 per 5 minutes)`)

    for (const guest of guests) {
      await guest.signIn()
      try {
        await guest.onboardAndJoin(venue.slug, venue.qrToken, consent)
        running.push(guest.heartbeatLoop(), guest.behaviourLoop())
      } catch (error) {
        failedToJoin++
        console.log(error instanceof Error ? error.message : String(error))
      }
      if ((guest.index + 1) % 10 === 0) console.log(`${guest.index + 1} guests in (${Math.round((Date.now() - started) / 1000)} s)`)
    }
    const allIn = Date.now()
    console.log(`all guests in; steady state for ${STEADY_SECONDS} s`)
    await sleep(STEADY_SECONDS * 1000)

    const report = {
      guests: GUESTS,
      failedToJoin,
      arrivalSeconds: Math.round((allIn - started) / 1000),
      steadySeconds: STEADY_SECONDS,
      window: { from: new Date(started).toISOString(), to: new Date().toISOString() },
      calls: summary(timings),
      errors: Object.fromEntries([...failures].sort((a, b) => b[1] - a[1])),
      channels: Object.fromEntries(channelStatus),
      notices: Object.fromEntries(noticesReceived),
      noticeLatency: summary(noticeLatency),
    }
    if (REPORT_PATH) await Deno.writeTextFile(REPORT_PATH, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await cleanUp()
  }
}

await main()
