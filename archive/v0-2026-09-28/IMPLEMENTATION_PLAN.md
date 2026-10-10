# IntroChat — Implementation Plan

> **Status:** Draft v2 — decisions Q1–Q4, Q6, Q8–Q10 applied. No code has been written yet.
> **Date:** 2026-09-28
> Items marked **⚠ OPEN Qn** are still waiting on a decision (discussing with partner). For each one, the plan assumes the stated default until you answer.

---

## 0. How to read this document

| Section | What it covers |
|---|---|
| 1–2 | What we are building and the words we use |
| 3 | Every user flow, step by step |
| 4–5 | Architecture and tech stack |
| 6 | Feature flags: how to switch on paid features just by changing a variable |
| 7–8 | Database tables and Redis keys |
| 9 | REST API and WebSocket events |
| 10–16 | Detailed design of each feature |
| 17 | Hosting on DigitalOcean (short, simple explanation) |
| 18 | Folder structure |
| 19 | Milestones with tasks and "done when" checks |
| 20 | Testing |
| 21 | Risks |
| 22 | Future work |
| 23 | Open questions |

---

## 1. Product summary

Many restaurants already put a **QR code on each table** so guests can see the menu, order, and ask for the bill at the end. IntroChat keeps that idea and adds a **social layer**. After scanning, guests can:

1. **Chat anonymously, 1-to-1,** with other people at the **same venue right now**.
2. **Order food** from that venue's menu, the same way table-ordering apps work.

Guests can only use the app while they are **physically inside the venue**. We check this through the venue's WiFi (its **static public IP**).

**Venue types:**
- **Restaurants / cafes**: they have a menu, and ordering food extends the session.
- **Events** (Navratri party plots, seminars): usually no menu, so the only way to extend is a subscription.

**Money model:**

| Stream | Pilot | Later |
|---|---|---|
| Scan fee (₹19 / 29 / 59, amount TBD): 1 hour per scan | **OFF** (free) | ON |
| Subscription: 30 days, unlimited sessions at **all** partner venues | **OFF** | ON |
| Commission on food orders | Recorded only | Invoiced to venues |
| Payment gateway | None | Razorpay |

Everything paid is **built now and hidden behind flags** (see §6). Going live with payments = change env variables and restart.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Venue** | A partner restaurant, cafe, or event ground. Has its own menu (optional), WiFi, static IP, and QR codes. |
| **Table** | A physical table inside a venue. Each table has its own QR code. Events may have no tables. |
| **Guest** | An end user who scans the QR code. |
| **Handle** | The public anonymous ID other guests see, e.g. `Mango-4821`. Never shows the name or phone number. |
| **Session** | One guest's stay at one venue. Starts after entry and ends on expiry, logout, leaving the venue, or a kick. |
| **Extension** | +30 minutes added to a session when the venue **confirms** a food order. |
| **Hold** | Session timer paused because a food order is waiting for the venue to confirm it. |
| **Subscription** | 30 days of unlimited session time at any partner venue. The guest must still be inside the venue. |
| **Venue staff** | Restaurant or event people using the Venue Dashboard. |
| **Super admin** | Us, the platform owners. |

---

## 3. User flows

### 3.1 Entry flow: single QR code (Option B, chosen)

```
Guest scans table QR
   │  QR = https://<our-domain>/v/{venue_slug}/t/{table_code}
   ▼
Landing page (opens on whatever network the phone is on — usually mobile data)
   • Venue name + logo
   • "Step 1: Connect to WiFi"  → shows SSID + [Copy password] button
   • Status pill: "Not on venue WiFi" (red)
   │  Page polls GET /api/v1/venues/{slug}/network-check every 3 s
   ▼
Guest joins the WiFi from phone settings, comes back to the browser
   │  network-check now returns on_venue_network = true
   ▼
Status pill turns green, [Go to App] button unlocks
   ▼
Login: phone number → OTP (Firebase)       (skipped if already logged in on this device)
   ▼
Profile (first time only): nickname, age, gender, interests (tags)
   ▼
[If SCAN_FEE_ENABLED] Pay scan fee → Razorpay           (pilot: skipped)
   ▼
Session starts → Home screen (People list + Menu tab + Chats tab + timer)
```

Notes:
- The QR code is a normal URL. It works with **any** router, and no router config is needed.
- Captive portal (Option A, fully automatic popup) is **future work**. See §22.
- ✅ **Decided (Q1):** one QR per **table**, so every order carries its table number. Events with no tables use one venue-level QR.

### 3.2 Session lifecycle (server-authoritative timer)

The **server** owns the timer. The phone only displays it. This way nobody can cheat by changing their phone's clock.

```
                  start (entry done)
                        │
                        ▼
   ┌──────────────► ACTIVE ──────────── subscription active? ──► UNLIMITED
   │           expires_at = now + 60 min                         (no timer, presence
   │                    │                                         still enforced)
   │         at expires_at − 5 min
   │                    ▼
   │        WARNING popup: [Order food] [Buy subscription] [Not now]
   │                    │
   │     ┌──────────────┼───────────────────────┐
   │  Order placed   Subscribe               Not now / ignore
   │     │              │                       │
   │     │           UNLIMITED            expires_at reached
   │     ▼                                      ▼
   │  order PENDING (placed_at)           FINAL popup (2 min):
   │     │  session guaranteed until      [Order food] [Buy subscription] [Log out]
   │     │  at least placed_at + 15 min         │
   │     │  (HOLD if original time ran    decline / timeout
   │     │   out; chat keeps working)           ▼
   │     │                                ENDED  → logged out, chats deleted
   │     ├─ placed_at + 10 min, still pending:
   │     │    notice "Your order is not accepted yet. You have 5 minutes.
   │     │            Ask the manager to accept it, or place a new order."
   │     ├─ placed_at + 15 min, still pending, no time left → ENDED (expired)
   │     │    (order is NOT auto-rejected — it stays with the restaurant)
   │  venue CONFIRMS
   │     │  expires_at = max(expires_at, now) + 30 min
   └─────┘
      venue REJECTS → back to ACTIVE if time left, else FINAL popup
```

Rules:
1. `SESSION_MINUTES = 60`, `WARNING_BEFORE_MINUTES = 5`, `EXTENSION_MINUTES = 30`. All come from config (§6).
2. **Unlimited extensions.** Every confirmed order adds 30 min.
3. The extension counts only **after the venue confirms** the order.
4. **Pending order protection (✅ decided, Q6):** placing an order guarantees the session lasts until at least `placed_at + ORDER_PENDING_WINDOW_MINUTES (15)`. If the original time runs out first, the session goes to **HOLD** and chat keeps working.
   - At `placed_at + ORDER_PENDING_NOTICE_MINUTES (10)`, if still pending, the guest is told: *"Your order has not been accepted yet. You have 5 minutes. Ask the manager to accept it, or place a new order."* The Venue Dashboard also highlights that order as overdue.
   - A **new order** placed in those 5 minutes starts its own 15-minute window.
   - At `placed_at + 15 min`, if nothing is confirmed and no time is left, the session **ends** (`expired`).
   - The order is **never auto-rejected**. It stays on the dashboard, because the restaurant may still serve it and it stays on the table's bill.
   - Abuse guard: max `MAX_PENDING_ORDERS_PER_SESSION = 3` pending orders at a time.
5. ⚠ **OPEN Q7** (discussing with partner): minimum order value to earn an extension (to stop ₹10-water-bottle tricks)? **Default: config `MIN_ORDER_FOR_EXTENSION_PAISE = 0` (no minimum), changeable per venue.**
6. **Event venues with no menu:** the [Order food] button is hidden, so the choices are [Buy subscription] and [Not now].
7. **After ENDED:** the guest can scan again. With `SCAN_FEE_ENABLED=true` they must pay again. In the pilot it is free.
8. **Pilot and subscription (✅ decided, Q8):** the [Buy subscription] button is visible and shows "Coming soon". A super admin can **grant** a subscription manually for testers.

### 3.3 Presence and "left the venue" (heartbeat)

- Every `HEARTBEAT_INTERVAL_SECONDS = 30`, the app calls `POST /api/v1/presence/heartbeat`.
- The server checks the request's IP against the venue's static IP(s).
  - **IP matches** → still inside, `last_seen` updated.
  - **IP does not match** (switched to mobile data / other WiFi) → **session ENDED immediately**, reason `left_venue`.
- The WebSocket connection is also re-checked on every reconnect.

**Phone screen lock (✅ decided, Q4).**
When a phone screen locks, or the guest switches to WhatsApp, the browser **pauses our page**, so heartbeats stop even though the guest is still at the table. So:
- Heartbeats missing for `HEARTBEAT_OFFLINE_AFTER_SECONDS = 90` → status **OFFLINE**.
  - Others see the guest's card greyed out with an "Offline" label, moved to the bottom of the list.
  - Chats stay intact. Messages sent to them are delivered when they come back.
- The guest reopens the page within 10 min → immediate heartbeat → IP check.
  - Venue IP → back to online.
  - Not venue IP → ENDED.
- No heartbeat for `HEARTBEAT_LOGOUT_AFTER_SECONDS = 600` (10 min) → ENDED, reason `inactive`.
- The session timer keeps running while offline.

### 3.4 People list and matching

- Shows guests currently **ACTIVE / UNLIMITED at the same venue**.
- It excludes yourself, anyone you blocked, and anyone who blocked you. Offline guests are shown greyed at the bottom.
- Each card shows the **handle** and the **interest tags** (✅ decided, Q2). Shared tags are highlighted.
- **Sort order:** online first → number of shared tags (desc) → more recently joined first.
- Tap a card → opens a chat.

### 3.5 Chat

- **1-to-1 only.** No groups, ever.
- **Direct messaging:** anyone can message anyone, with no request/accept step (the request/accept mode is kept behind a flag, `CHAT_MODE=direct|request`, for the future).
- Content: **text + emoji only**. Max 1000 characters. Any language typed from the keyboard (English / Hindi / Gujarati) works because everything is UTF-8.
- Real time over WebSocket. Includes a typing indicator and a "seen" tick.
- **Deletion:** when **either** guest's session ends, that conversation is **hard-deleted** for both. The other guest sees "This user has left". A new session always starts with an empty chat list.
- Because the handle is **fixed per user** (§13), a guest who comes back gets the **same ID** and can be found again, but the old chat is gone. Both start fresh.
- Exception: see **Reports** below (⚠ **OPEN Q5**).

### 3.6 Food ordering (table-ordering style)

```
Guest: Menu tab → add items → Cart → [Place order]
   ▼
Order status PENDING  → Venue Dashboard gets it instantly (sound + highlight)
   ▼
Venue: [Confirm] or [Reject (reason)]
   ▼
Guest sees status live. On CONFIRM → session +30 min.
   ▼
Order is added to the table's running bill.
Guest: [View bill] / [Request bill] → Venue Dashboard shows "Table 7 wants the bill"
   ▼
Venue collects payment offline (cash / UPI at counter) → marks bill PAID
```

- In the pilot, **all food money is paid directly to the restaurant**. We only pass the order along.
- Each order stores `commission_percent` at the time of ordering, so commission reports work later.

### 3.7 Safety: block, report, kick, ban

| Action | Who | Effect |
|---|---|---|
| **Block** | Guest | The two guests stop seeing each other, and the chat between them is deleted. Stored against the **user account**, so it lasts across future sessions. |
| **Report** | Guest | Creates a report for super admin review. It also auto-blocks the user. |
| **Kick** | Venue staff | Ends that guest's session now. They can't re-enter **that venue for 12 hours** (`KICK_COOLDOWN_HOURS = 12`, ✅ decided Q10). Other venues are unaffected. |
| **Ban** | Super admin | Blocks the **phone number** from the whole platform (temporary or permanent). |

**How bans are made to stick (the question you asked):**
- Login is by **phone OTP**. A ban is stored against a **hash of the phone number**, not just the account.
- On every login and session start, the server checks `bans` for (phone_hash, firebase_uid, device_id).
- To come back, a banned person would need a **new SIM**. That is a real cost and slows abuse down.
- A device ID (random ID in browser storage) is also recorded. It is only an extra signal, because clearing the browser resets it.

**Reports vs. chat deletion: ⚠ OPEN Q5 (discussing with partner).** If chats are deleted when the session ends, the admin can't see what was said in a report. **Proposed default:** when a guest reports someone, the server **copies the last 50 messages of that conversation into the report**. This evidence is kept for `REPORT_EVIDENCE_RETENTION_DAYS = 30` and then deleted. No other chats are kept. This is built behind a flag, `REPORT_EVIDENCE_ENABLED`, so either answer is a config change.

### 3.8 Logout triggers (complete list)

| Reason code | When |
|---|---|
| `expired` | Declined/ignored the FINAL popup |
| `left_venue` | Heartbeat or reconnect came from a non-venue IP |
| `inactive` | No heartbeat for 10 min |
| `kicked` | Venue staff kicked |
| `banned` | Super admin banned |
| `user_logout` | Guest tapped Log out |
| `venue_closed` | Venue staff tapped "Close venue for today" (ends all sessions) |

---

## 4. Architecture

```
                 ┌──────────────── Guest phone (browser / PWA) ───────────────┐
                 │ React app: Landing · Login · People · Chat · Menu · Bill   │
                 └───────┬───────────────────────────────┬────────────────────┘
                         │ HTTPS (REST)                   │ WSS (WebSocket)
                         ▼                                ▼
                ┌──────────────────────── Nginx (TLS, real client IP) ─────────┐
                └───────┬────────────────────────────────┬─────────────────────┘
                        ▼                                ▼
            ┌──────────────────────── FastAPI app (uvicorn) ──────────────────┐
            │ REST routers · WebSocket hub · Firebase token check · IP check  │
            └──┬──────────────┬──────────────────────┬────────────────────────┘
               │              │ pub/sub, presence,   │
               │              │ timers, rate limits  │
               ▼              ▼                      ▼
        ┌────────────┐  ┌───────────┐        ┌──────────────────┐
        │ PostgreSQL │  │   Redis   │◄──────►│ Timer worker     │
        │ (source of │  │           │        │ (warnings, expiry│
        │  truth)    │  └───────────┘        │  hold timeouts,  │
        └────────────┘                       │  cleanup jobs)   │
                                             └──────────────────┘
   External: Firebase Auth (phone OTP, staff email login) · Razorpay (later)
```

Same React app, different routes:
- `/v/...` → Guest app
- `/venue/...` → Venue Dashboard
- `/admin/...` → Super Admin panel

**Why a separate timer worker:** API servers can restart or run multiple copies. One worker process owns the "what expires now" loop, so each warning or expiry fires exactly once.

**Why Redis pub/sub for WebSockets:** once we run 2+ API processes (needed for Navratri scale), guest A may be connected to process 1 and guest B to process 2. Redis carries messages between them. We build this from day one so scaling later is only a config change.

---

## 5. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Mobile-first, installable PWA |
| UI | Tailwind CSS | Fast to build a clean mobile UI |
| State / data | TanStack Query (server data) + Zustand (local UI state) | |
| Routing | React Router | |
| i18n | react-i18next | `en`, `hi`, `gu` files; Noto Sans Devanagari / Gujarati fonts |
| Emoji | emoji-mart picker | |
| Backend | Python 3.12 + FastAPI | REST + native WebSockets |
| ORM / migrations | SQLAlchemy 2.0 (async) + Alembic | |
| DB | PostgreSQL 16 | |
| Cache / realtime | Redis 7 | Presence, timers, pub/sub, rate limits |
| Auth | Firebase Auth | Guests: phone OTP. Venue staff/admin: email + password. Backend verifies tokens with `firebase-admin`. |
| Payments (later) | Razorpay | Orders API + Checkout + webhooks |
| QR codes | `qrcode` (Python) → printable PDF per venue | |
| Validation | Pydantic v2 | |
| Tests | pytest + httpx (backend), Vitest + Playwright (frontend) | |
| Deploy | Docker + Docker Compose on DigitalOcean Bangalore | See §17 |

---

## 6. Feature flags and configuration

**Goal:** turn paid features on or off by changing a variable, with no code change.

Two levels:
1. **Global** (env variables, `.env`): platform-wide defaults.
2. **Per venue** (`venue_settings` table, editable by super admin): overrides the global value for one venue. Example: an event sets a 4-hour session.

The server resolves a value as `venue override ?? global value`.

| Variable | Pilot value | Purpose |
|---|---|---|
| `PAYMENTS_ENABLED` | `false` | Master switch for Razorpay |
| `SCAN_FEE_ENABLED` | `false` | Charge per scan |
| `SCAN_FEE_PAISE` | `1900` | ₹19 (amount TBD) |
| `SUBSCRIPTION_ENABLED` | `false` | Show and buy subscription |
| `SUBSCRIPTION_PRICE_PAISE` | TBD | |
| `SUBSCRIPTION_DAYS` | `30` | |
| `SESSION_MINUTES` | `60` | |
| `WARNING_BEFORE_MINUTES` | `5` | |
| `EXTENSION_MINUTES` | `30` | |
| `FINAL_PROMPT_SECONDS` | `120` | FINAL popup duration |
| `ORDER_PENDING_WINDOW_MINUTES` | `15` | Session guaranteed this long after placing an order |
| `ORDER_PENDING_NOTICE_MINUTES` | `10` | "Order not accepted yet, 5 min left" notice |
| `MAX_PENDING_ORDERS_PER_SESSION` | `3` | Abuse guard |
| `MIN_ORDER_FOR_EXTENSION_PAISE` | `0` | ⚠ Q7 open |
| `REPORT_EVIDENCE_ENABLED` | `true` | ⚠ Q5 open |
| `SUPPORTED_LANGUAGES` | `en,hi,gu` | UI languages |
| `HEARTBEAT_INTERVAL_SECONDS` | `30` | |
| `HEARTBEAT_OFFLINE_AFTER_SECONDS` | `90` | |
| `HEARTBEAT_LOGOUT_AFTER_SECONDS` | `600` | |
| `VENUE_IP_CHECK_ENABLED` | `true` | `false` only for local development |
| `CHAT_MODE` | `direct` | `request` = future accept-first mode |
| `MAX_TAGS_PER_USER` | `5` | |
| `KICK_COOLDOWN_HOURS` | `12` | |
| `REPORT_EVIDENCE_RETENTION_DAYS` | `30` | |
| `AGE_GATE_ENABLED` / `MIN_AGE` | `false` / `18` | 18+ later |
| `TRANSLATION_ENABLED` | `false` | Future LLM translation |
| `DEFAULT_COMMISSION_PERCENT` | `0` | Recorded on each order |

The frontend reads the resolved flags from `GET /api/v1/venues/{slug}/config`, so the buttons shown always match the server.

---

## 7. Database schema (PostgreSQL)

All tables have `id UUID PK`, `created_at`, `updated_at` unless noted. Money is stored as **integer paise**. Times are `timestamptz` in UTC.

### 7.1 Platform and venues
```
venues
  slug TEXT UNIQUE            -- used in QR URL
  name TEXT
  type ENUM(restaurant, cafe, event)
  address TEXT, city TEXT
  logo_url TEXT NULL
  wifi_ssid TEXT
  wifi_password_enc TEXT      -- encrypted; shown on landing page
  is_active BOOL
  has_menu BOOL
  commission_percent NUMERIC(5,2)
  timezone TEXT DEFAULT 'Asia/Kolkata'
  event_starts_at / event_ends_at TIMESTAMPTZ NULL   -- events only

venue_networks                 -- allowed public IPs (usually 1 static IPv4)
  venue_id FK
  cidr CIDR                    -- e.g. 49.36.12.5/32
  label TEXT

venue_settings                 -- per-venue flag overrides (§6)
  venue_id FK, key TEXT, value JSONB   UNIQUE(venue_id, key)

tables
  venue_id FK
  code TEXT                    -- short code in QR URL, e.g. 'T07'
  label TEXT                   -- 'Table 7'
  is_active BOOL               UNIQUE(venue_id, code)

staff_accounts
  firebase_uid TEXT UNIQUE
  email TEXT
  role ENUM(super_admin, venue_owner, venue_staff)
  venue_id FK NULL             -- NULL for super_admin
  is_active BOOL
```

### 7.2 Guests
```
users
  firebase_uid TEXT UNIQUE
  phone_hash TEXT UNIQUE       -- HMAC-SHA256(phone, server secret); raw phone stays in Firebase
  handle TEXT UNIQUE           -- public ID, fixed forever, e.g. 'Mango-4821' (§13)
  nickname TEXT NULL           -- private, never shown to other guests
  birth_year INT NULL
  gender ENUM(male, female, other, prefer_not) NULL
  preferred_language ENUM(en, hi, gu) DEFAULT 'en'
  last_device_id TEXT NULL

tags
  name TEXT UNIQUE             -- normalised: lowercase, trimmed, max 24 chars
  is_blocked BOOL              -- admin can block offensive tags

user_tags
  user_id FK, tag_id FK        PK(user_id, tag_id)
```

### 7.3 Sessions and presence
```
sessions
  user_id FK, venue_id FK, table_id FK NULL
  status ENUM(active, hold, final_prompt, unlimited, ended)
  started_at, expires_at TIMESTAMPTZ NULL, ended_at NULL
  end_reason ENUM(expired, left_venue, inactive, kicked, banned, user_logout, venue_closed) NULL
  warning_sent_at NULL
  entry_payment_id FK NULL     -- scan fee (later)
  device_id TEXT
  start_ip INET
  INDEX(venue_id, status)
```
Live presence (`last_seen`, OFFLINE) is kept in **Redis**, not Postgres (§8).

### 7.4 Chat
```
conversations
  venue_id FK
  session_a_id FK, session_b_id FK      -- ordered so a<b; UNIQUE(session_a_id, session_b_id)
  last_message_at

messages
  conversation_id FK ON DELETE CASCADE
  sender_session_id FK
  body TEXT                    -- max 1000 chars
  seen_at NULL
```
When a session ends: `DELETE FROM conversations WHERE session_a_id = :s OR session_b_id = :s` (messages cascade).

### 7.5 Menu, orders, bills
```
menu_categories   venue_id FK, name, sort_order, is_active
menu_items        venue_id FK, category_id FK, name, description, price_paise INT,
                  is_veg BOOL, image_url NULL, is_available BOOL, sort_order

orders
  venue_id FK, table_id FK NULL, session_id FK, user_id FK
  status ENUM(pending, confirmed, rejected, cancelled)   -- never auto-rejected
  placed_at TIMESTAMPTZ
  pending_notice_sent_at NULL
  subtotal_paise INT
  commission_percent NUMERIC(5,2)       -- copied at order time
  extension_applied BOOL
  confirmed_at / rejected_at NULL, reject_reason TEXT NULL
  confirmed_by_staff_id FK NULL
  bill_id FK NULL

order_items
  order_id FK, menu_item_id FK
  name_snapshot TEXT, price_paise_snapshot INT, quantity INT

bills                           -- one open bill per TABLE (shared by everyone at it);
                                -- per session only when there is no table (events)
  venue_id FK, table_id FK NULL, session_id FK NULL
  status ENUM(open, requested, paid)
  total_paise INT
  paid_marked_by_staff_id FK NULL, paid_at NULL
```

### 7.6 Safety
```
blocks     blocker_user_id FK, blocked_user_id FK   UNIQUE(blocker, blocked)

reports
  reporter_user_id FK, reported_user_id FK, venue_id FK
  reason ENUM(harassment, spam, inappropriate, other), note TEXT NULL
  evidence JSONB               -- last 50 messages snapshot (Q5)
  evidence_expires_at
  status ENUM(open, actioned, dismissed), reviewed_by FK NULL

bans
  phone_hash TEXT NULL, firebase_uid TEXT NULL, device_id TEXT NULL
  scope ENUM(platform, venue), venue_id FK NULL
  reason TEXT, expires_at NULL (NULL = permanent)
  created_by_staff_id FK
```

### 7.7 Payments and subscriptions (built now, used later)
```
payments
  user_id FK, purpose ENUM(scan_fee, subscription)
  amount_paise INT, currency 'INR'
  provider 'razorpay', provider_order_id, provider_payment_id NULL
  status ENUM(created, paid, failed, refunded)
  raw_webhook JSONB NULL

subscriptions
  user_id FK, starts_at, ends_at
  source ENUM(purchase, admin_grant)
  payment_id FK NULL
```

### 7.8 Audit
```
audit_log   actor_type, actor_id, action, target_type, target_id, meta JSONB
```
Records every kick, ban, order confirm/reject, flag change, and bill marked paid.

---

## 8. Redis keys

| Key | Type | Purpose |
|---|---|---|
| `presence:venue:{venue_id}` | ZSET session_id → last_seen epoch | Who is live; OFFLINE = score older than 90 s |
| `session:{session_id}` | HASH | Cached handle, venue, status, expires_at, tags |
| `timers:warn` | ZSET session_id → warn_at | Worker pops due warnings |
| `timers:expire` | ZSET session_id → expires_at | Worker pops due expiries |
| `timers:final` | ZSET session_id → final_prompt_deadline | |
| `timers:order_notice` | ZSET order_id → placed_at + 10 min | "Not accepted yet" notice |
| `timers:order_window` | ZSET order_id → placed_at + 15 min | End of pending-order protection |
| `tags:venue:{venue_id}` | ZSET tag → count of live users | Tag suggestions |
| `ws:channel:session:{id}` | pub/sub channel | Deliver events to one guest |
| `ws:channel:venue:{id}` | pub/sub channel | Venue-wide events (presence, dashboard) |
| `rl:{scope}:{id}` | counter with TTL | Rate limits |

**Postgres is the source of truth.** If Redis is wiped, the worker rebuilds the timer sets from `sessions` / `orders` on startup.

---

## 9. API

Base: `/api/v1`. Auth header: `Authorization: Bearer <Firebase ID token>`.

### 9.1 Public / guest
| Method | Path | Purpose |
|---|---|---|
| GET | `/venues/{slug}` | Venue public info (name, logo, SSID, has_menu) |
| GET | `/venues/{slug}/network-check` | `{on_venue_network: bool}` from request IP |
| GET | `/venues/{slug}/config` | Resolved feature flags for the UI |
| POST | `/auth/session-login` | Verify Firebase token, create/find user, check bans |
| GET/PUT | `/me/profile` | Nickname, birth year, gender, language |
| GET | `/tags/suggestions?venue={slug}&q=` | Popular tags at this venue now + global popular |
| PUT | `/me/tags` | Set up to 5 tags |
| POST | `/sessions` | Start a session `{venue_slug, table_code?, device_id}` → IP check, ban check, (scan fee check) |
| GET | `/sessions/current` | Status, expires_at, flags |
| POST | `/sessions/current/logout` | |
| POST | `/presence/heartbeat` | IP check + last_seen |
| GET | `/people` | People list, sorted by shared tags |
| GET | `/conversations` | My chats |
| GET | `/conversations/{id}/messages?before=` | Paged history (this session only) |
| POST | `/conversations` | Open chat with `{target_session_id}` |
| GET | `/menu` | Current venue's menu |
| POST | `/orders` | Place order |
| GET | `/orders` | My orders this session |
| GET | `/bill` | Running bill |
| POST | `/bill/request` | Ask for the bill |
| POST | `/blocks` | Block `{target_session_id}` |
| POST | `/reports` | Report `{target_session_id, reason, note}` |
| POST | `/payments/scan-fee` | (flagged) create Razorpay order |
| POST | `/payments/subscription` | (flagged) create Razorpay order |
| POST | `/payments/razorpay/webhook` | (flagged) signature-verified webhook |

### 9.2 Venue dashboard (`/venue/...`, role venue_owner/venue_staff, scoped to own venue)
`GET live-guests` · `POST guests/{session_id}/kick` · `GET orders?status=` · `POST orders/{id}/confirm` · `POST orders/{id}/reject` · menu CRUD (`categories`, `items`, availability toggle) · `GET bills` · `POST bills/{id}/mark-paid` · `GET tables` · `POST tables` · `GET tables/qr.pdf` · `GET revenue?from=&to=` · `POST close-for-today` · `GET/PUT settings` (SSID, WiFi password)

### 9.3 Super admin (`/admin/...`)
Venues CRUD · venue networks (static IPs) · venue settings/flag overrides · staff accounts · reports queue + actions · bans · blocked tags · grant subscription · platform stats · audit log

### 9.4 WebSocket: `wss://<domain>/ws?token=<firebase token>`
One connection per guest (and one per dashboard screen). Messages are JSON `{type, data}`.

**Client → server:** `chat.send {conversation_id, body, client_msg_id}` · `chat.typing {conversation_id}` · `chat.seen {conversation_id, message_id}` · `ping`

**Server → guest:**
| Event | When |
|---|---|
| `presence.joined` / `presence.left` / `presence.offline` / `presence.online` | People list changes |
| `chat.message` / `chat.ack` / `chat.typing` / `chat.seen` | Chat |
| `chat.conversation_closed` | Other guest's session ended / blocked |
| `session.warning` | 5 min left |
| `session.hold` | Timer frozen for pending order |
| `session.extended {expires_at}` | Order confirmed / subscription |
| `session.final_prompt {deadline}` | Time's up, last chance |
| `session.ended {reason}` | Logout any reason |
| `order.updated` | Order status change |
| `order.pending_notice {minutes_left: 5}` | Order still not accepted after 10 min |

**Server → venue dashboard:** `order.new` · `order.overdue` (pending 10+ min) · `bill.requested` · `guests.count`

---

## 10. Venue network check (the "inside the venue" rule)

1. Each venue gets a **static public IP** from its ISP. We store it in `venue_networks`.
2. Nginx passes the real client IP to FastAPI via `X-Forwarded-For`. Uvicorn runs with `--proxy-headers --forwarded-allow-ips=<nginx only>`, so a guest **cannot fake** the header.
3. `is_on_venue_network(ip, venue_id)` = IP inside any of the venue's CIDRs.
4. It is checked at: network-check (landing), session start, every heartbeat, and every WebSocket (re)connect.
5. **IPv6 trap:** many Indian ISPs (e.g. Jio) also give phones IPv6. If our domain had an IPv6 (AAAA) record, a phone on venue WiFi could reach us via IPv6 and not match the static IPv4. **The API domain will be IPv4-only (no AAAA record)** in the pilot. Supporting venue IPv6 prefixes is future work.
6. **VPN / iCloud Private Relay:** these hide the real IP, so the check fails. The landing page shows a help message: "Turn off VPN / Private Relay for this WiFi".

---

## 11. Session timer, detailed

**Worker loop** (every 2 s):
1. `timers:warn` due → send `session.warning`, set `warning_sent_at`.
2. `timers:expire` due →
   - an order is pending and inside its 15-min window → status `hold`, remove from expire set, send `session.hold`
   - else → status `final_prompt`, add to `timers:final`, send `session.final_prompt`
3. `timers:final` due → end session (`expired`).
4. `timers:order_notice` due and order still pending → send `order.pending_notice` to the guest and `order.overdue` to the dashboard.
5. `timers:order_window` due and order still pending → if the session is in `hold` and **no other** pending order has a window still open → end session (`expired`). The order itself stays `pending` for the restaurant.
6. Cleanup: sessions with presence older than 600 s → end (`inactive`).

**Effective end time** of a session = `max(expires_at, latest open pending-order window)`. The countdown on the guest's screen always shows this value.

**On order confirm:**
`new_expires = max(expires_at, now) + EXTENSION_MINUTES` → status `active` → re-add to `timers:warn`/`timers:expire` → send `session.extended`.

**On subscription active** (purchase or admin grant): status `unlimited`, remove from timer sets. Presence rules still apply.

**Ending a session** is always one function, `end_session(session_id, reason)`:
1. Set status, ended_at, end_reason (DB transaction)
2. Delete that session's conversations and messages
3. Remove from Redis presence, timers, and tag counts
4. Publish `session.ended` to the guest, `presence.left` to the venue, `chat.conversation_closed` to chat partners
5. Close the guest's WebSocket

---

## 12. Tags and matching

- Guests pick **up to 5 tags**. Suggestions come from:
  1. tags of guests live at this venue now (`tags:venue:{id}`, most common first)
  2. globally popular tags
- **Custom tags allowed.** They are normalised: lowercase, trimmed, spaces collapsed, max 24 chars, letters/numbers/spaces in any script (so Hindi/Gujarati tags work).
- A basic bad-word list (English + common Hindi/Gujarati transliterations) rejects offensive tags. A super admin can mark any tag `is_blocked`.
- **Ranking:** `score = number of shared tags`. Ties broken by most recently joined. Shared tags are shown highlighted on the card.

---

## 13. Handles (public IDs)

- Format: `<Word>-<4 digits>`, e.g. `Mango-4821`, `Falcon-0937`, from a curated word list (neutral, non-offensive).
- **Fixed forever per user (✅ decided, Q3).** It is created once, on first login, and stored in `users.handle` (globally unique). A guest who returns after their session ended shows up with the **same ID**, so the person waiting for them recognises them.
- Trade-off (accepted): people can recognise a returning guest across visits and venues. Real identity (name, phone) is still never revealed.
- ~200 words × 10,000 numbers = 2 million handles. If more are needed later, we move to 5 digits.

---

## 14. Venue Dashboard (web, desktop + tablet friendly)

Pages:
1. **Live**: number of guests inside now, list of handles + table + time left. [Kick] button (with confirm).
2. **Orders**: New (sound alert + blinking) / Confirmed / Rejected tabs. [Confirm] / [Reject + reason]. Orders pending 10+ min are marked **Overdue** (the guest's session is at risk).
3. **Bills**: open bills per table, "bill requested" alerts, [Mark paid].
4. **Menu**: categories, items (name, price, veg/non-veg, photo, available toggle), drag to reorder.
5. **Tables & QR**: add tables, download a printable PDF of QR codes (one per table, with venue name + table label + "Scan to chat & order").
6. **Revenue**: confirmed order totals by day/week/month, count of orders, count of sessions, extensions earned.
7. **Settings**: WiFi SSID/password shown to guests, [Close venue for today].

Staff never see guests' phone numbers, names, or chat content.

---

## 15. Super Admin panel

- Venues: create/edit, static IP(s), venue type, commission %, flag overrides, activate/deactivate
- Staff accounts: invite venue owners/staff (Firebase email)
- Reports queue: evidence view → Dismiss / Warn / Ban (temp or permanent)
- Bans list: add/remove
- Tags: block offensive tags
- Grant subscription (testers / promos)
- Stats: live guests per venue, sessions/day, orders/day, extensions, (later) revenue
- Audit log

---

## 16. Languages (i18n)

- **Typing:** guests can type English, Hindi, or Gujarati in chat, nickname, and tags from day one (UTF-8 end to end, Noto fonts loaded).
- **App interface text** (buttons, labels, popups, errors): **English, Hindi and Gujarati from day one (✅ decided, Q9).**
  - Built with `react-i18next`. Every string lives in `en.json`, `hi.json`, `gu.json`, and no text is hard-coded in components.
  - The guest picks a language on the landing page (auto-suggested from the phone's language). The choice is saved to `users.preferred_language`.
  - Server messages (errors, popup text, logout reasons) are sent as **codes**, e.g. `SESSION_ENDED_LEFT_VENUE`, and translated on the phone.
  - The Venue Dashboard and Admin panel follow the same system (English first; Hindi/Gujarati files filled in the same milestone).
  - Translations need a native-speaker review before the pilot (you / your partner).
- **Future:** auto-translation of chat messages via a free/cheap LLM (§22).

---

## 17. Hosting: DigitalOcean, Bangalore (simple explanation)

**What is a VPS?** A "Virtual Private Server" is a rented computer in a data centre that runs 24×7, where we install and run our app. DigitalOcean calls it a **Droplet**. DigitalOcean has a data centre in **Bangalore (region `BLR1`)**, so **"DigitalOcean" and "VPS in India" are the same choice here**. Our server sits in India and is fast for Indian users.

**Why DigitalOcean over AWS for now:**
| | DigitalOcean | AWS |
|---|---|---|
| Setup | Simple dashboard, few choices | Very powerful, many confusing options |
| Pricing | Fixed monthly price per Droplet | Pay-per-use, easy to get surprise bills |
| Good for | Pilot and early growth | Very large scale later |

AWS (Mumbai region) stays an option when we get to Navratri-sized traffic. Because everything runs in Docker, moving later is mostly re-deploying the same containers.

**Pilot setup:**
```
DigitalOcean BLR1
 └─ 1 Droplet (2 vCPU / 4 GB RAM, Ubuntu 24.04)
     └─ Docker Compose:
          nginx     → HTTPS (free Let's Encrypt certificate), serves React build, proxies API/WS
          api       → FastAPI (uvicorn)
          worker    → timer worker
          redis     → Redis 7
          postgres  → PostgreSQL 16 (daily backup to DigitalOcean Spaces)
 └─ Domain DNS: A record only (IPv4), no AAAA (see §10)
```
- Cost: a few tens of US dollars per month at pilot size. We will check current DigitalOcean pricing when we set it up.
- **When we grow:** move Postgres to DigitalOcean **Managed PostgreSQL** (automatic backups/failover), use Managed Redis, run 2+ API Droplets behind a DigitalOcean Load Balancer. No code change is needed because of the Redis pub/sub design (§4).
- **Deploys:** GitHub Actions → build Docker images → SSH to Droplet → `docker compose pull && docker compose up -d` → run `alembic upgrade head`.

---

## 18. Folder structure

```
IntroChat/
├── IMPLEMENTATION_PLAN.md
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, routers, startup
│   │   ├── core/
│   │   │   ├── config.py           # pydantic-settings, all flags (§6)
│   │   │   ├── flags.py            # venue override ?? global resolution
│   │   │   ├── firebase.py         # token verification
│   │   │   ├── security.py         # role deps, phone hashing, encryption
│   │   │   └── ratelimit.py
│   │   ├── db/ (session.py, base.py)
│   │   ├── models/                 # SQLAlchemy models, one file per area
│   │   ├── schemas/                # Pydantic request/response models
│   │   ├── api/v1/
│   │   │   ├── public.py  auth.py  profile.py  tags.py  sessions.py
│   │   │   ├── presence.py  people.py  chat.py  menu.py  orders.py  bills.py
│   │   │   ├── safety.py  payments.py
│   │   │   ├── venue/ (live.py, orders.py, menu.py, bills.py, tables.py, revenue.py, settings.py)
│   │   │   └── admin/ (venues.py, staff.py, reports.py, bans.py, tags.py, subscriptions.py, stats.py)
│   │   ├── ws/ (hub.py, protocol.py, handlers.py)
│   │   ├── services/
│   │   │   ├── venue_network.py  session_service.py  presence_service.py
│   │   │   ├── matching.py  handles.py  chat_service.py  order_service.py
│   │   │   ├── moderation.py  payment_service.py  qr_service.py
│   │   └── workers/timer_worker.py
│   └── tests/
├── frontend/
│   ├── package.json  vite.config.ts  (PWA plugin)
│   └── src/
│       ├── app/ (router, providers)
│       ├── i18n/ (en.json, hi.json, gu.json)
│       ├── lib/ (api client, ws client, firebase, flags)
│       ├── features/
│       │   ├── landing/  auth/  profile/  session/ (timer, popups)
│       │   ├── people/  chat/  menu/  orders/  bill/  safety/
│       │   ├── venue-dashboard/
│       │   └── admin/
│       └── components/ (shared UI)
└── infra/
    ├── docker-compose.yml          # local dev
    ├── docker-compose.prod.yml
    ├── nginx/ (nginx.conf)
    └── scripts/ (backup.sh, deploy.sh)
```

---

## 19. Milestones

Each milestone ends with something you can click through. The "Done when" list must all pass before we move on.

### M0: Project setup
- Backend skeleton (FastAPI, config, health check), Alembic init, Docker Compose (api, worker, postgres, redis, nginx)
- Frontend skeleton (Vite, React, TS, Tailwind, router, i18n, PWA)
- Firebase project (phone auth + email auth), service account in `.env`
- Lint/format (ruff, eslint, prettier), pytest + vitest running
- **Done when:** `docker compose up` shows the React page and `/api/v1/health` returns OK.

### M1: Venues, tables, QR, landing
- Models + migrations: venues, venue_networks, venue_settings, tables, staff_accounts
- Flag resolution (`flags.py`) + `/venues/{slug}/config`
- Network check service + endpoint (+ trusted-proxy config)
- Landing page: venue info, WiFi SSID + copy password, polling status, [Go to App] unlock, VPN/Private Relay help
- QR PDF generation
- Seed script: one demo venue with 5 tables
- **Done when:** scanning a printed QR on a phone shows the landing page, and the button unlocks only on the configured network. In dev we fake it with `VENUE_IP_CHECK_ENABLED=false` or local IP.

### M2: Guest login, profile, tags
- Firebase phone OTP UI (with reCAPTCHA), `/auth/session-login`, phone hashing
- Ban check at login
- Profile form (nickname, birth year, gender; all optional)
- Tag picker with suggestions + custom tags + bad-word filter
- **Done when:** a new phone can log in with OTP, save a profile, and pick tags; a banned phone is refused.

### M3: Sessions, timer, heartbeat, presence
- Session start (IP + ban + scan-fee flag check), handles
- Redis presence, heartbeat endpoint, OFFLINE logic
- Timer worker: warn / expire / final / cleanup; Redis rebuild on startup
- `end_session()` single path
- Frontend: countdown, WARNING popup, FINAL popup, ended screen with reason
- **Done when:** with `SESSION_MINUTES=3, WARNING_BEFORE_MINUTES=1`, the full flow works (warning → final → logout). Switching the phone to mobile data logs out within one heartbeat. Locking the screen for 2 min shows "Offline" to others but does **not** log out, and 10+ min does.

### M4: People list and chat
- `/people` with block filter + tag ranking
- WebSocket hub with Redis pub/sub, auth on connect, IP check on connect
- Conversations/messages, send/ack/typing/seen, emoji picker
- Deletion on session end, "user has left" state
- Rate limit: max 20 messages / 10 s per sender
- **Done when:** 3 phones at the demo venue see each other sorted by shared tags and chat in real time (English, Hindi, Gujarati, emoji). When one leaves, their chats disappear for the others.

### M5: Menu, orders, bills, extension, venue dashboard (core)
- Menu models + dashboard menu CRUD
- Guest menu, cart, place order; dashboard orders with sound alert; confirm/reject
- Extension logic, HOLD state, 10-min "not accepted yet" notice, 15-min pending window, overdue highlight on dashboard
- Bills: running bill, request bill, mark paid
- Dashboard: Live guests, Revenue page, Tables & QR page, Settings
- Staff login (Firebase email) + role checks (staff only see own venue)
- **Done when:** a guest orders, the dashboard confirms, and the guest's timer jumps +30 min. An order placed with 5 min left keeps the session alive. At 10 min the guest gets the "5 minutes left" notice and the dashboard shows the order as overdue. At 15 min with no confirmation the session ends, but the order is still pending on the dashboard.

### M6: Safety
- Block, report (with evidence snapshot), auto-block on report
- Kick with cooldown
- Bans (phone_hash / uid / device), checked at login, session start, and WS connect
- Evidence cleanup job (30 days)
- **Done when:** a blocked user is invisible both ways, a kicked user can't rejoin that venue for 12 h, and a banned phone can't enter any venue.

### M7: Super Admin panel
- Venues, networks, flag overrides, staff invites, reports queue, bans, blocked tags, grant subscription, stats, audit log
- **Done when:** a new venue can be fully onboarded from the admin panel with no database access.

### M8: Hardening and pilot deploy
- Security pass (see §20), input limits, CORS, CSP headers
- Privacy policy + terms + consent checkbox (India DPDP Act 2023: we collect phone numbers)
- DigitalOcean Droplet, domain, HTTPS, backups, uptime monitoring, error tracking (Sentry free tier)
- Load test: 50 simulated guests in one venue chatting
- **Done when:** the pilot venue is live on the real domain and the QR, WiFi, chat, and order flows work end to end on real Android + iPhone devices.

### M9: Translation review
- Hindi and Gujarati strings are written **as each feature is built** (M1–M7), not at the end.
- This milestone is the native-speaker review of all three languages on real phones, and fixing layout where Hindi/Gujarati text is longer.

### M10: Payments (built, flag OFF until you decide)
- Razorpay: create order, Checkout on frontend, webhook with signature verification, idempotent handling
- Scan fee gate on session start; subscription purchase → `subscriptions` row → UNLIMITED
- Admin: payments list, refunds (manual)
- **Done when:** in Razorpay **test mode**, flipping `PAYMENTS_ENABLED=true`, `SCAN_FEE_ENABLED=true`, `SUBSCRIPTION_ENABLED=true` makes the paid flows work with no code change.

---

## 20. Testing and security

**Automated tests (backend):**
- Timer maths: extension from `max(expires_at, now)`, HOLD, 10-min notice, 15-min pending window (single and overlapping orders), FINAL timeout
- Handle stays the same across sessions
- Network check with IPv4, spoofed `X-Forwarded-For` rejected
- Flag resolution (venue override vs global)
- Ban matching by phone_hash / uid / device
- Chat deletion on every end reason
- Role scoping: staff of venue A can't touch venue B

**Automated tests (frontend):** Playwright flows for landing → login (Firebase emulator) → people → chat → order.

**Manual device tests:** Android Chrome, iPhone Safari, screen lock, WiFi ↔ mobile data switch, slow network.

**Security checklist:**
- Firebase ID tokens verified on every request and on WS connect
- Guests never receive other guests' user_id, phone, nickname, age, or gender. They only get handle + tags + session_id.
- Rate limits on OTP, messages, orders, reports
- WiFi passwords and secrets encrypted at rest; `.env` never committed
- Razorpay webhook signature verified; payments processed idempotently
- All admin/venue actions written to `audit_log`

---

## 21. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Venue has no static IP | Can't verify presence | Required during onboarding; small monthly ISP cost for the venue |
| Venue ISP changes IP anyway | Guests locked out | Dashboard warning when many network checks fail; admin updates IP in 1 minute |
| iCloud Private Relay / VPN | IP check fails | Help text on landing page |
| IPv6 | IP mismatch | IPv4-only API domain |
| Phones pause background tabs | False logouts | OFFLINE state, 10-min grace (Q4) |
| Guest places orders just to stay online | Free time without buying | Restaurant rejects; max 3 pending orders; min order value (Q7) |
| Firebase phone OTP cost | SMS billed per verification beyond free limits | Check current Firebase pricing before pilot; rate-limit OTP requests |
| Harassment | User safety, reputation | Block, report + evidence, kick, phone bans; 18+ gate later; request/accept mode ready behind flag |
| Venue WiFi can't handle 2000 people (Navratri) | Nobody can connect | Venue's responsibility; we give a WiFi hardware checklist for events |
| Restaurant slow to confirm orders | Guests lose their session | Sound alerts, overdue highlight at 10 min, guest told to ask the manager |

---

## 22. Future work (not in pilot)

1. **Chat request / accept mode**: `CHAT_MODE=request`; a guest must accept before chatting. Shows "busy" status instead of hiding requests, so no one misses a request.
2. **Images in chat**: upload to DigitalOcean Spaces, auto-moderation, expire with session.
3. **Auto-translation**: guest types in Hindi, the other guest reads it in English (or Gujarati). Uses a free/cheap LLM translation API behind `TRANSLATION_ENABLED`, showing the original text + "translated" label, with per-message caching.
4. **Captive portal (Option A)**: for venues with supporting routers (TP-Link Omada, UniFi, MikroTik). Joining the WiFi auto-opens our landing page, no manual step.
5. **Native mobile app** (React Native), reusing the same API.
6. **18+ age gate**: `AGE_GATE_ENABLED=true`.
7. **Avatars**: pick from a set or generated.
8. **Navratri scale (2000+ per venue)**: multiple API servers, managed Postgres/Redis, virtualised people list with search and tag filters, load test at 3000.
9. **Online food payment** through Razorpay + commission settlement reports.
10. **IPv6 venue prefixes**.

---

## 23. Decisions and open questions

### Decided
| # | Question | Decision |
|---|---|---|
| Q1 | QR per table or per venue? | **Per table**; events with no tables use one venue QR |
| Q2 | Show interest tags on people cards? | **Yes** |
| Q3 | Handle new each session or fixed per user? | **Fixed forever per user** |
| Q4 | Screen lock / app switch? | **Shown as Offline**; logged out only after 10 min without a heartbeat |
| Q6 | Venue doesn't confirm an order? | **Not auto-rejected.** Session protected for 15 min after the order; notice at 10 min ("5 min left, ask the manager or order again"); session ends at 15 min if still unconfirmed |
| Q8 | Subscription button in pilot? | **Visible, "Coming soon"**; admin can grant free subscriptions |
| Q9 | UI languages? | **English, Hindi, Gujarati from day one** |
| Q10 | Kick duration? | **12 hours, that venue only** |

### Open (discussing with partner)
| # | Question | Default used until answered |
|---|---|---|
| Q5 | Keep a chat snapshot when a guest reports someone? | Yes, last 50 messages, 30 days (flag `REPORT_EVIDENCE_ENABLED`) |
| Q7 | Minimum order value to earn +30 min? | No minimum (configurable per venue) |
| Q11 | Product name + domain? | Working name "IntroChat", domain TBD |
