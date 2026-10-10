# IntroChat — Implementation Plan (V1)

> **Status:** V1 final draft — all product decisions made, **waiting for approval to start building**. No code written yet.
> **Date:** 2026-10-10
> **Related:** [IDEA_AND_TECH_STACK.md](IDEA_AND_TECH_STACK.md) (what & why, costs, decision log) · [ARCHITECTURE_AND_DATA_FLOW.md](ARCHITECTURE_AND_DATA_FLOW.md) (flows, schema, rules)

---

## 0. How to read this document

| Section | What it covers |
|---|---|
| 1 | V1 scope in one table |
| 2 | Glossary |
| 3 | Stack and environments |
| 4 | Settings and switches (every tunable value) |
| 5 | API surface (SQL functions, Edge Functions, Realtime) |
| 6 | Screens |
| 7 | Folder structure |
| 8 | Milestones with tasks and "done when" checks |
| 9 | Testing |
| 10 | Deploy, backups, monitoring |
| 11 | Risks |
| 12 | Future work |
| 13 | Items to arrange outside the code |

---

## 1. V1 scope

| In | Out (future) |
|---|---|
| Restaurants / cafes, table QR | Events |
| GPS geofence presence check (required) | WiFi / IP check |
| Phone OTP via a SIM SMS gateway | Twilio (later, a settings switch) |
| Profile: consent, 18+ birth year, nickname, gender, 1–5 tags | Avatars |
| People list, chat request → accept, 1-to-1 text + emoji | Groups, images, translation |
| Web push notifications | Native apps |
| ₹19 scan fee, ₹400 / 25-scan subscription, Razorpay — **built behind switches, default OFF** | Food ordering, menu, bills |
| Admin Console (only us) | Restaurant dashboard |
| en / hi / gu | More languages |
| Supabase + Cloudflare Pages free plans | Docker, own servers, Redis |

## 2. Glossary

| Term | Meaning |
|---|---|
| **Venue** | A partner restaurant or cafe: map pin, radius, tables, QR cards |
| **Table** | A physical table with its own QR card (`/v/{slug}/t/{qr_token}`) |
| **Guest** | A person who scans the QR |
| **Handle** | Public anonymous ID, fixed forever, e.g. `Mango-4821` |
| **Session** | One guest's stay at one venue, from start to end |
| **Block (of time)** | The currently paid part of a session: 60 min (₹19 / free) or 120 min (1 scan) |
| **Kind** | What pays for the current block: `free`, `paid_scan`, `subscription` |
| **Scan credit** | One of the 25 scans bought with the subscription; each = a 2-hour block |
| **Subscription active** | Credits > 0, or currently in a `subscription` block |
| **Away** | Location outside the venue; 3-minute grace before logout |
| **Offline** | No heartbeat for 90 s (phone locked / app in background); a label only |
| **Admin** | Us. Email + password + 2-step code (TOTP). |

## 3. Stack and environments

Full table with costs: [IDEA_AND_TECH_STACK.md §11](IDEA_AND_TECH_STACK.md#11-tech-stack-and-cost). Summary:

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite, Tailwind, React Router, TanStack Query, Zustand, react-i18next, vite-plugin-pwa, emoji-mart, Leaflet, `qrcode` + `jsPDF`, `@supabase/supabase-js`, Razorpay Checkout.js |
| Backend | Supabase: Postgres (SQL functions = all business rules), Auth, Realtime, pg_cron, pg_net, Vault, Edge Functions (TypeScript / Deno) |
| SMS | Android phone + dedicated SIM + SMS gateway app (e.g. the open-source *SMS Gateway for Android*), called from the `sms-hook` Edge Function |
| Hosting | Cloudflare Pages (frontend), Supabase (backend) |
| Ops | GitHub + Actions, Cloudflare R2 (backups), Sentry, UptimeRobot |
| Tests | pgTAP (database), Vitest, Playwright |

| Environment | Supabase project | Frontend URL | Payments | SMS |
|---|---|---|---|---|
| **dev** | free project #1 | Cloudflare preview URL | Razorpay **test** keys | Supabase test phone numbers (no SMS) + gateway for real-phone tests |
| **prod** | free project #2 | `<name>.pages.dev` → own domain later | test keys until KYC, then live keys | SIM gateway |

Local development: Node LTS + the Supabase CLI (version pinned in the root `package.json`, run as `npx supabase`). No Docker in development or deployment: the app runs locally against the **dev** project; migrations and Edge Functions are pushed to it with the CLI. The one possible exception is the test runner: `npx supabase test db --linked` may start a pgTAP container on the developer's machine (confirmed in M0); that is a local test tool, never part of what is deployed.

Frontend lint is **oxlint** (the Vite template's linter), with `no-explicit-any`, `ban-ts-comment` and `no-non-null-assertion` as errors; formatting is Prettier.

## 4. Settings and switches

Stored in `app_settings` (global) and `venue_settings` (per-venue override, column "V"). Edited only in the Admin Console; every change is audit-logged. Resolution: venue override ?? global.

| Key | Default | V | Purpose |
|---|---|---|---|
| `PAYMENTS_ENABLED` | `false` | ✓ | Master switch. Off = everything free. |
| `SCAN_FEE_ENABLED` | `true` | ✓ | Charge per scan (only if master is on) |
| `SUBSCRIPTION_ENABLED` | `true` | ✓ | Sell the subscription (only if master is on); off → "Coming soon" |
| `SCAN_FEE_PAISE` | `1900` | ✓ | ₹19 |
| `SCAN_SESSION_MINUTES` | `60` | ✓ | Block bought with ₹19 |
| `CONTINUE_FEE_PAISE` | `1900` | ✓ | ₹19 to continue |
| `CONTINUE_MINUTES` | `60` | ✓ | |
| `SUBSCRIPTION_PRICE_PAISE` | `40000` | | ₹400 |
| `SUBSCRIPTION_SCANS` | `25` | | Credits per purchase |
| `SUBSCRIPTION_SESSION_MINUTES` | `120` | | Block per credit |
| `FREE_SESSION_MINUTES` | `60` | ✓ | Block when payments are off |
| `WARNING_BEFORE_MINUTES` | `15` | ✓ | Alert at 45 min of a 60-min block |
| `FINAL_PROMPT_SECONDS` | `120` | | Final popup |
| `PAYMENT_GRACE_SECONDS` | `300` | | Extra final-prompt time while paying |
| `UNUSED_FEE_VALID_MINUTES` | `30` | | A paid-but-unused ₹19 stays usable this long |
| `HEARTBEAT_INTERVAL_SECONDS` | `30` | | |
| `LOCATION_INTERVAL_SECONDS` | `120` | | Fresh GPS reading |
| `OFFLINE_AFTER_SECONDS` | `90` | | Offline label |
| `AWAY_GRACE_SECONDS` | `180` | ✓ | Outside → logout after this |
| `GEOFENCE_RADIUS_M` | `40` | ✓ | |
| `MAX_ACCURACY_M` | `60` | ✓ | Readings blurrier than this are "unknown" |
| `ACCURACY_BUFFER_M` | `15` | ✓ | Edge tolerance |
| `MAX_LOCATION_AGE_SECONDS` | `120` | | Older readings ignored |
| `MAX_SPEED_MPS` | `50` | | Spoof flag |
| `MIN_AGE` | `18` | | |
| `MAX_TAGS_PER_USER` | `5` | | |
| `CHAT_REQUEST_EXPIRY_MINUTES` | `10` | | |
| `MAX_PENDING_OUTGOING_REQUESTS` | `5` | | |
| `KICK_COOLDOWN_HOURS` | `12` | | |
| `REPORT_EVIDENCE_ENABLED` | `true` | | |
| `REPORT_EVIDENCE_MESSAGES` | `50` | | |
| `REPORT_EVIDENCE_RETENTION_DAYS` | `30` | | |
| `SMS_PROVIDER` | `"phone_gateway"` | | `phone_gateway` \| `twilio` |
| `SMS_DAILY_CAP` | `90` | | Stop before the SIM's ≈100/day cap |
| `SMS_ALERT_AT` | `70` | | Alert admins |
| `OTP_PER_PHONE_PER_HOUR` | `5` | | |

The app reads resolved values for a venue from `venue_public(slug, qr_token)`, so the buttons it shows always match the server.

## 5. API surface

All guest/admin calls are `supabase.rpc('<fn>', {...})` except the Edge Functions. Details of each are in the architecture doc §4.

### 5.1 Guest SQL functions

| Function | Caller | Purpose |
|---|---|---|
| `venue_public(slug, qr_token)` | anon | Venue name, logo, table label, resolved switches and prices |
| `location_check(slug, reading, device_id)` | anon | inside / outside / unknown (UI only) |
| `my_profile()` | guest | Profile, completeness, credits, live session |
| `accept_consent(version)` | guest | |
| `update_profile(birth_year, nickname, gender, language)` | guest | 18+ check |
| `tag_suggestions(slug, q)` / `set_tags(names)` | guest | |
| `start_session(slug, qr_token, reading, device_id, payment_id?)` | guest | §4.5 |
| `current_session()` | guest | Status, kind, times, credits, `server_now` |
| `heartbeat(reading?, permission_state)` | guest | §4.6 |
| `logout_session()` | guest | `end_session('user_logout')` |
| `continue_with_credit()` / `continue_free()` | guest | §4.11 |
| `get_people()` | guest | §4.7 |
| `send_chat_request(target_session_id)` / `respond_chat_request(id, accept)` / `cancel_chat_request(id)` / `get_chat_requests()` | guest | §4.8 |
| `get_conversations()` / `get_messages(conversation_id, before_id?)` / `send_message(...)` / `mark_seen(...)` | guest | §4.9 |
| `block(...)` / `report(...)` | guest | §4.15 |
| `save_push_subscription(...)` / `delete_push_subscription(endpoint)` | guest | §4.14 |
| `request_account_deletion()` | guest | Creates a request for admin action |

### 5.2 Admin SQL functions (`is_admin()` + MFA required)

Venues CRUD · `admin_set_venue_pin` · tables CRUD + `admin_regenerate_qr_token` · settings get/set (global + venue) · `admin_live_guests(venue)` · `admin_kick` · `admin_close_venue_today` · reports list/action/dismiss · bans list/create/lift · blocked tags · `admin_grant_credits` · payments list + `admin_mark_refunded` · stats · audit log · SMS usage · spoof flags · account deletion queue · admins list/invite/deactivate.

### 5.3 Service-only SQL functions (`service_role`)

`sms_hook_check(phone)` · `sms_log_write(...)` · `prepare_payment(...)` · `set_provider_order(...)` · `apply_payment(...)` · `admin_ban_apply(...)`

### 5.4 Edge Functions

| Function | Called by | Does |
|---|---|---|
| `sms-hook` | Supabase Auth (Send SMS Hook) | Verify hook signature → `sms_hook_check` → send via SIM gateway (or Twilio later) → log |
| `payments-create` | Guest | `prepare_payment` → Razorpay Orders API → return checkout data |
| `payments-verify` | Guest | Verify Checkout signature → `apply_payment` |
| `payments-webhook` | Razorpay | Verify webhook signature → `apply_payment` |
| `push-send` | Postgres (`pg_net`) | Send Web Push (VAPID); remove dead subscriptions |
| `admin-auth` | Admin Console | Invite admin (create Auth user), ban/unban Auth user, delete account |

### 5.5 Realtime

Private channels `venue:{id}`, `user:{id}`, `conv:{id}`, `admin`, authorized by RLS on `realtime.messages`. Event list: architecture doc §7.

## 6. Screens

**Guest (mobile-first):**
1. Landing — venue name/logo, table label, language picker
2. Location — why we need it → permission → result; help screens (denied / iPhone Precise Location / inaccurate)
3. Login — phone (+91) → OTP
4. Onboarding — consent → birth year (+ optional nickname, gender) → tags
5. Payment — ₹19 / ₹400 choice (only when switches are on) → Razorpay Checkout
6. Home — tabs **People · Requests · Chats**, timer chip, offline/away banner
7. Chat — messages, typing, seen ticks, read-only state, Block / Report menu
8. Popups — warning (15 min left), final prompt (time up), continue options
9. Ended — reason, "scan again", free resume hint when applicable
10. Settings — language, notifications on/off, "Add to Home Screen" guide (iPhone), credits left, log out, privacy, delete account request

**Admin Console (`/admin`, desktop + phone for on-site work):**
Login + MFA · Venues (list, create, map pin, Test, set pin from phone) · Tables & QR PDF · Settings (global and per venue) · Live guests · Reports · Bans · Tags · Users (credits, grant scans, deletion requests) · Payments & refunds · Stats · Audit log · SMS usage · Admins.

## 7. Folder structure

```
IntroChat/
├── IDEA_AND_TECH_STACK.md
├── ARCHITECTURE_AND_DATA_FLOW.md
├── IMPLEMENTATION_PLAN.md
├── archive/                         # earlier plan versions
├── package.json                     # repo tooling only: pins the Supabase CLI version
├── frontend/
│   ├── package.json  vite.config.ts  tailwind.config.ts  .env.example
│   ├── public/                      # icons, manifest assets
│   └── src/
│       ├── app/                     # router, providers, error boundary
│       ├── i18n/                    # en.json, hi.json, gu.json
│       ├── lib/                     # supabase client, rpc wrappers, realtime, location,
│       │                            # heartbeat, push, razorpay, server-clock offset, device id,
│       │                            # database.types.ts (generated: supabase gen types)
│       ├── features/
│       │   ├── landing/  location/  auth/  onboarding/  payments/
│       │   ├── session/             # timer, popups, ended screen
│       │   ├── people/  requests/  chat/  safety/  settings/
│       │   └── admin/               # venues, map, tables-qr, live, reports, bans, tags,
│       │                            # users, payments, settings, stats, audit, sms, admins
│       ├── components/              # shared UI
│       └── sw.ts                    # service worker (push + offline shell)
├── supabase/
│   ├── config.toml
│   ├── migrations/                  # 0001_... .sql (order: architecture doc §6.4)
│   ├── functions/
│   │   ├── _shared/                 # razorpay, signatures, supabase admin client, errors
│   │   ├── sms-hook/  payments-create/  payments-verify/  payments-webhook/
│   │   ├── push-send/  admin-auth/
│   ├── tests/                       # pgTAP
│   └── seed.sql                     # dev only
├── tools/
│   └── gps-field-test/              # standalone page used in M0
└── .github/workflows/
    ├── db-deploy.yml                # migrations + functions → dev (auto) / prod (manual approval)
    ├── tests.yml                    # pgTAP + Vitest + Playwright on PRs
    └── nightly-backup.yml           # pg_dump → encrypt → Cloudflare R2
```

## 8. Milestones

Every milestone ends with something you can click through on a real phone. All "done when" checks must pass before moving on. Hindi and Gujarati strings are written **as each feature is built**.

### M0 — Accounts, skeleton, field tests
- Create: GitHub repo, two Supabase projects (dev, prod), Cloudflare Pages project, Razorpay account (test mode), Sentry, UptimeRobot.
- Frontend skeleton: Vite + React + TS + Tailwind + router + i18n + PWA; deploys to Cloudflare Pages.
- Supabase CLI: push a first migration and an Edge Function to dev, **without Docker**.
- Confirm on the free plan: pg_cron 10-second schedule, Send SMS Hook, private Realtime channels, Vault.
- **GPS field test** (`tools/gps-field-test`): at 2–3 real pilot restaurants, on one Android and one iPhone, record accuracy and distance at several tables, at the door, outside, and at the neighbouring shop. Use the results to set `GEOFENCE_RADIUS_M` / `MAX_ACCURACY_M` defaults.
- **SMS gateway test**: dedicated SIM + gateway app sends 10 OTP-style SMS to different operators (Jio, Airtel, Vi, BSNL); measure delivery time.
- **Done when:** the empty app is live on `*.pages.dev`; a migration and a function deploy from the CLI; the field-test numbers are recorded in this document; SMS arrives on all four operators within 30 s.

### M1 — Venues, tables, QR, location
- Migrations 0001–0002: settings, admins, audit, rate limits, venues, venue_settings, tables, location functions.
- Admin Console: login + MFA, venue create/edit, map pin + radius, **Test**, **Set pin from my phone**, tables, QR PDF download.
- Guest: landing, language picker, location permission flow + help screens, `location_check`.
- **Done when:** a printed QR card opens the landing page; inside/outside matches reality at the test restaurant on Android and iPhone; an inactive table shows the right message.

### M2 — Login, consent, profile, tags
- Migration 0003; `sms-hook` with the SIM gateway; daily cap + per-phone limit; ban check in the hook.
- Auth trigger → profile + handle + phone hash.
- Onboarding screens: consent, birth year (18+), optional nickname/gender, tag picker with suggestions and bad-word filter.
- **Done when:** a new phone logs in with a real OTP and finishes onboarding; an under-18 birth year is refused; a banned phone gets no SMS; the cap blocks SMS after N per day (tested with a low cap).

### M3 — Sessions, timer, presence
- Migration 0004 + `tick` schedule: `start_session` (free mode), `heartbeat`, offline flag, away grace, `end_session`, warning, final prompt, `continue_free`, logout.
- Frontend: heartbeat + location loop, server-clock offset, countdown, warning and final popups, ended screen, away/offline banners.
- **Done when:** with `FREE_SESSION_MINUTES=3, WARNING_BEFORE_MINUTES=1`: warning → final → logout works; *Continue free* extends; walking out of the restaurant logs out ≈3 min later; locking the phone shows "Offline" to others but does not log out; reopening the app at home ends the session immediately.

### M4 — People, requests, chat, push
- Migration 0005 + 0008: people list, chat requests, conversations/members, messages, Realtime authorization, push subscriptions, `push-send`.
- Frontend: People / Requests / Chats tabs, chat screen, typing, seen ticks, read-only state, emoji, reconnect re-sync, notification permission, iPhone "Add to Home Screen" guide.
- Non-subscriber deletion at session end, read-only chat when the other person leaves.
- **Done when:** 3 phones at the demo venue see each other sorted by shared tags; request → accept → chat works in en/hi/gu + emoji; decline/expiry behave as specified; a locked Android phone (and an iPhone with the app on the home screen) gets a notification; when one guest leaves, the other sees the chat as read-only, and after their own session ends it is gone.

### M5 — Payments and subscription (behind switches)
- Migration 0006; `payments-create`, `payments-verify`, `payments-webhook`; Razorpay Checkout in the app.
- Scan fee at entry, ₹19 continue, ₹400 subscription (+25 credits), upgrade mid-session (2 h from block start), continue with a credit, free resume, payment grace in the final prompt, unused-fee handling, subscriber history retention.
- Admin: payments list, mark refunded, grant scans, switch editor.
- **Done when (Razorpay test mode):** with switches off nothing asks for money; with switches on every paid path works and the verify call and the webhook never double-apply; a subscriber keeps chat history across visits and loses it when credits hit 0; turning the switches on/off needs no code change.

### M6 — Safety
- Migration 0007: block, report (with evidence, also from read-only chats), kick (admin), platform ban (+ Supabase Auth ban), spoof flags, blocked tags, evidence cleanup.
- **Done when:** blocked users are invisible both ways; a report after the other person left still contains the evidence; a kicked user can't rejoin that restaurant for 12 h; a banned phone can't log in or enter anywhere.

### M7 — Admin Console complete
- Live guests, close for today (with the affected-paid-sessions list), reports queue, bans, users (credits, deletion requests), stats, audit log, SMS usage, spoof flags, admin management.
- **Done when:** a new restaurant can be onboarded and operated entirely from the Console, with no database access.

### M8 — Hardening and pilot launch
- Security pass: RLS deny-all test, every `SECURITY DEFINER` function reviewed (`search_path`, `auth.uid()` checks), Edge Function signature checks, CSP headers on Cloudflare Pages.
- Privacy policy, terms, refund policy, contact/grievance page (also required by Razorpay).
- Prod project set up, nightly backup job tested (**including a restore** into the dev project), Sentry, UptimeRobot.
- Load test: 100 simulated guests in one venue (heartbeats + chat) against dev; check Realtime connection count and DB load.
- Buy the domain before printing QR cards (and before Razorpay live activation).
- **Done when:** the pilot restaurant is live; the QR → location → login → chat flow works on real Android and iPhone devices; a backup has been restored successfully.

### M9 — Translation review
- Native-speaker review of all Hindi and Gujarati strings on real phones; fix layouts where text is longer.
- **Done when:** both reviewers sign off.

## 9. Testing

**Database (pgTAP, run against the dev project):**
- RLS: `anon` and `authenticated` cannot read or write any table directly.
- `evaluate_location`: inside / outside / unknown at the boundary, inaccurate and stale readings.
- Sessions: one live per user; resume rules; away grace; offline-then-outside ends immediately; every end reason runs the full cleanup.
- Timer maths: warning, final prompt, payment grace, continue (₹19 / credit / free), subscription upgrade = `block_started_at + 120 min`.
- Credits: never below 0, concurrent spends, ledger = balance.
- Payments: `apply_payment` idempotent, unused fee usable once within 30 min at the same venue only.
- Chat: request rules (block, decline, duplicates, expiry), `can_send`, visibility (`visible_from_message_id`), deletion for non-subscribers, retention for subscribers.
- Bans and kicks matching by user / phone hash / device.

**Edge Functions:** signature verification (valid, invalid, replayed) for the SMS hook, Checkout and webhook.

**Frontend:** Vitest for the location loop, clock offset, popups. Playwright end-to-end against dev with Supabase test phone numbers and Razorpay test mode: landing → location (mocked) → login → onboarding → people → request → chat → payment.

**Manual device tests:** Android Chrome, iPhone Safari, iPhone installed PWA; screen lock; walking out; Precise Location off; permission denied; slow network; notification on lock screen.

## 10. Deploy, backups, monitoring

| What | How |
|---|---|
| Frontend | Cloudflare Pages Git integration: `main` → prod, other branches → preview URLs |
| Database + Edge Functions | GitHub Action: on merge to `main`, `supabase db push` + `supabase functions deploy` to **dev** automatically, then to **prod** after a manual approval |
| Secrets | Edge Function secrets per project (Razorpay, webhook, SMS gateway, VAPID, hook secret); Vault for the phone-hash key; Cloudflare Pages env vars for the public keys (Supabase URL + anon key, Razorpay key id, VAPID public key) |
| Backups | Nightly GitHub Action: `pg_dump` of prod → encrypt → Cloudflare R2, keep 14 days. Restore tested in M8. |
| Errors | Sentry (frontend + Edge Functions) |
| Uptime | UptimeRobot on the site and a health RPC |
| SMS phone | Admin alert when the daily cap is near; admins check the gateway phone is online |

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| GPS inaccurate indoors at a pilot restaurant | Guests can't enter | M0 field test before building; per-venue radius/accuracy; retry guidance |
| Neighbouring restaurant / mall | Someone next door passes | Small strict radius per venue; accepted for V1 |
| Fake-GPS app (Android) | Someone outside gets in | Spoof flags, reports, bans; accepted for V1 |
| SIM blocked by the operator / daily cap | Nobody new can log in | Dedicated SIM (not personal), daily cap below the limit, admin alert, switch to Twilio by setting |
| Gateway phone offline | Nobody new can log in | Keep it charged and online; UptimeRobot-style check of the gateway; returning guests unaffected |
| Free-plan limits (≈200 online at once) | New guests can't connect | Monitor connection count; Supabase Pro ≈ $25/month when needed |
| Supabase free project pause | Dev project sleeps | Only affects dev; prod is used daily |
| iPhone push needs Home Screen install | iPhone users miss notifications | In-app guide; sound + badge while open |
| Location permission denied | Guest can't use the app | Clear explanation screen + platform help |
| Harassment | Safety, reputation | Request → accept, block, report with evidence, kick, phone bans, 18+ |
| Payment applied after the session ended | Guest paid for nothing | Becomes an unused fee (30 min) or credits; manual refund from the Console |
| Legal (DPDP, payments) | Fines, Razorpay rejection | Consent screen, legal review of policies before pilot |

## 12. Future work

1. Food ordering, menu, bills (orders extend sessions)
2. Events (Navratri, seminars) with a different presence check
3. Twilio or another SMS provider (`SMS_PROVIDER` switch)
4. Restaurant dashboard for owners
5. Images in chat, avatars
6. Auto-translation of chat messages
7. Native Android / iOS app
8. Captive portal / WiFi-based presence as an extra signal
9. Supabase Pro, batched presence, paginated people list for large venues
10. Docker / dedicated API service if we outgrow Supabase functions

## 13. Items to arrange outside the code

| # | Item | Needed by |
|---|---|---|
| 1 | Spare Android phone + **dedicated SIM** (not a personal number) | M0 |
| 2 | 2–3 pilot restaurants for the on-site GPS field test | M0 |
| 3 | Final product name | Before printing QR cards (M8) |
| 4 | Domain | M8, before printing QR cards and before Razorpay live |
| 5 | Business KYC documents for Razorpay live mode | Before switching payments on |
| 6 | Privacy policy, terms, refund policy — legal review | M8 |
| 7 | Hindi and Gujarati native-speaker reviewers | M9 |
