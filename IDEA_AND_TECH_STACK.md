# IntroChat — Idea & Tech Stack (V1)

> Working name: **IntroChat** (final name and domain not decided yet)
> Date: 2026-10-10 · Version: **V1 final draft — waiting for approval** · No code written yet
> Related: [ARCHITECTURE_AND_DATA_FLOW.md](ARCHITECTURE_AND_DATA_FLOW.md) (how it works inside) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (build order)
> The earlier version of these documents is kept in `archive/v0-2026-09-28/`.

---

## 1. The idea in one line

Put a QR code on every restaurant table. Guests scan it and can **chat anonymously, 1-to-1, with other people sitting in the same restaurant right now**.

## 2. The problem

People sit next to each other in cafes and restaurants but rarely start a conversation. Walking up to a stranger is awkward. IntroChat gives a safe, anonymous first step: see who is here, see shared interests, send a chat request, and say hello by text.

## 3. What V1 is (and is not)

| In V1 | Not in V1 (future) |
|---|---|
| Restaurants and cafes | Events (Navratri, seminars) |
| Table QR + **GPS location check** | WiFi / IP check, captive portal |
| Phone OTP login | Native Android / iOS app |
| People list, chat **request → accept**, 1-to-1 text + emoji chat | Group chat, images, auto-translation |
| ₹19 scan fee and ₹400 subscription (**built, switched off until we decide**) | Food ordering, menu, bills |
| Web push notifications | Restaurant-facing dashboard |
| Our own **Admin Console** (only we use it) | Docker, multiple servers |
| English, Hindi, Gujarati | |

**Restaurants get no login in V1.** We onboard them, print their QR cards, and run everything from our Admin Console. If a restaurant has a problem guest, they call us and we act.

## 4. How it works (guest's view)

1. **Scan** the QR code on the table.
2. Pick a language. The page explains why it needs location and asks for it.
3. The phone's location is checked: **you must be inside this restaurant.**
4. **Log in with phone number + OTP** (first time on this phone only).
5. First time only: accept the privacy notice, enter **birth year (18+ only)**, optional nickname and gender, and **1–5 interest tags** (e.g. *football, music, startups*).
6. You get a **permanent anonymous ID** like `Mango-4821`. Nobody ever sees your name or phone number.
7. If payments are switched on: pay **₹19 for 1 hour**, or buy the **₹400 subscription (25 scans × 2 hours)**.
8. **People list:** everyone currently in this restaurant, shown only by ID and interest tags. People with the most shared interests are at the top.
9. **Send a chat request.** If the other person accepts, you chat 1-to-1 (text + emoji, any language).
10. When the phone is locked, you still get a **notification** for new requests and messages.

## 5. Session and money rules

All prices and times below are **settings**, changeable from the Admin Console without code changes.

| Rule | Detail |
|---|---|
| Payment switch | `PAYMENTS_ENABLED` master switch, plus separate `SCAN_FEE_ENABLED` and `SUBSCRIPTION_ENABLED`. Can be set for the whole platform or per restaurant. **Default for the pilot: OFF.** |
| Scan fee (switch ON) | **₹19 → 1-hour session** |
| Alert | **15 minutes before the end** (at 45 min for a 1-hour session): *Continue +1 hour (₹19)* · *Buy subscription (₹400)* · *Not now* |
| Time up | Final popup for 2 minutes with the same choices, then the guest is logged out |
| Continue | Pay ₹19 again → +1 hour, no rescanning |
| Subscription | **₹400 = 25 scans. Each scan = a 2-hour session.** No expiry date. Valid at all partner restaurants. |
| Buying the subscription during a ₹19 session | The current session becomes **2 hours from when it started**, and uses 1 of the 25 scans |
| End of a 2-hour subscription session | Use the next scan to continue +2 hours without rescanning |
| Paid session ended early (location false alarm, logged out by mistake) | Scan again **at the same restaurant before the paid time runs out** → resume **free** for the remaining time |
| Switch OFF (pilot) | Sessions are free, 1 hour, with a free *Continue* button. The subscription button shows "Coming soon". We can **grant** scans to testers from the Admin Console. |
| Phone locked | Shown as **Offline** to others. The session keeps running until its time is up (no inactivity logout). |
| Leaving the restaurant | Outside the restaurant for **3 minutes** → logged out |

## 6. How we know the guest is really inside

We use the **phone's location (GPS)**. No special hardware and no WiFi needed.

- For each restaurant we store a **map pin and a radius** (default **40 m**). Our team sets the pin on-site with a phone.
- The phone sends its location when the guest enters, and **every 2 minutes** while the app is open.
- The **server** decides, never the phone:
  - inside the radius → allowed
  - clearly outside → a 3-minute grace starts; still outside after 3 minutes → logged out
  - location too blurry (worse than **±60 m**) → not counted either way; at entry the guest is asked to retry
- **Location is required.** No location permission = no chat.
- Coming back to the app after the phone was locked: if the first location is outside the restaurant, the session ends immediately.
- We never store the guest's exact location after the session, and nobody else ever sees it.

**Known limits (accepted for V1):**
- In a mall or next to another restaurant (20–30 m apart), GPS cannot always tell the two apart. We keep the radius small and strict per restaurant.
- On Android, a fake-GPS app can trick any website. We flag suspicious patterns for review; reports and bans are the real deterrent.

## 7. Chat rules

| Rule | Detail |
|---|---|
| Start | **Chat request → accept.** Nobody can message you without your OK. |
| Request | Shows the sender's ID and tags. Expires after 10 minutes if ignored. If declined, the sender cannot ask again during this visit. |
| Content | Text + emoji, max 1000 characters, typing indicator, "seen" ticks |
| Other person leaves | The chat stays readable for you but you can't send more. You can still **report** it. |
| **Without subscription** | Your chats are **deleted when your session ends**. A new visit starts with an empty chat list. |
| **With subscription** | Your chat history is **kept while your subscription is active** (scans left, or in a subscription session). When it runs out, the history is deleted. |
| Meeting again later | A new request is needed every visit. A subscriber sees the old history above the new messages; a non-subscriber only sees new messages. |
| Fairness note | If you chat with a subscriber, they may keep a copy of the chat. The privacy notice says this clearly. |

## 8. Safety

| Feature | Who | What it does |
|---|---|---|
| Anonymous IDs | — | Other guests never see name, phone, age, gender or location |
| Request → accept | Guest | No unwanted messages |
| Block | Guest | Both stop seeing each other, permanently. The chat is deleted. |
| Report | Guest | Sends the last 50 messages to us for review (kept 30 days), and blocks the person |
| Kick | **Us** (Admin Console) | Ends the guest's session; they cannot enter **that restaurant for 12 hours** |
| Ban | **Us** | Blocks the **phone number** from all restaurants, temporary or permanent |
| 18+ only | — | Birth year required at sign-up |

## 9. Who uses what

| User | What they get |
|---|---|
| **Guest** | Mobile website (installable as an app): people list, requests, chats, timer, payments |
| **Us (admin)** | Admin Console: onboard restaurants (map pin, radius, tables, QR PDF), switches and prices, live guests, kick, close a restaurant for the day, reports, bans, scans/subscriptions, payments and refunds, stats, SMS usage |
| **Restaurant** | Printed QR cards. No login in V1. |

## 10. Business model

| Revenue | Pilot | Later |
|---|---|---|
| ₹19 per scan (1 hour) | Switched off (free) | On |
| ₹400 subscription (25 scans × 2 hours) | "Coming soon"; we can grant scans to testers | On |
| Payment gateway | Razorpay, built and tested in test mode | Live (needs business KYC) |

Turning payments on = flipping the switches in the Admin Console. No code change.

## 11. Tech stack and cost

**Everything is on free plans until we outgrow them.** No server of our own, no Docker.

| # | Part | Technology | Cost now | Paid when |
|---|---|---|---|---|
| 1 | Guest app + Admin Console | React + TypeScript + Vite + Tailwind | Free | — |
| 2 | App routing / data / state | React Router, TanStack Query, Zustand | Free | — |
| 3 | Languages | react-i18next + Noto fonts (en, hi, gu) | Free | — |
| 4 | Installable app + notifications | PWA (vite-plugin-pwa) + Web Push | Free | — |
| 5 | Location | Browser location API (built into phones) | Free | — |
| 6 | Map in the Admin Console | Leaflet + OpenStreetMap | Free | — |
| 7 | QR code PDFs | Made in the browser (`qrcode` + `jsPDF`) | Free | — |
| 8 | Website hosting | **Cloudflare Pages** (free HTTPS) | Free | — |
| 9 | Database | **Supabase** Postgres | Free (≈500 MB) | Supabase Pro ≈ $25/month |
| 10 | Login | **Supabase Auth**: guests by phone OTP, admins by email + password + 2-step code | Free (≈50k users/month) | Same Pro plan |
| 11 | Live chat, online/offline | **Supabase Realtime** | Free (≈200 people online at once) | Same Pro plan |
| 12 | Timers (alerts, logouts) | **pg_cron** inside Supabase | Free | — |
| 13 | Payments + notifications code | **Supabase Edge Functions** | Free (≈500k calls/month) | Same Pro plan |
| 14 | OTP SMS | **Android phone with a dedicated SIM** running an SMS-gateway app | Free (SIM plan, ≈100 SMS/day cap) | Twilio later (paid per SMS) |
| 15 | Payments | **Razorpay** | No monthly fee; test mode free | ≈2% + GST per successful payment (≈ ₹0.45 on ₹19, ≈ ₹9.50 on ₹400) |
| 16 | Code, deploys, nightly backup job | GitHub + GitHub Actions | Free | — |
| 17 | Backup storage | Cloudflare R2 | Free (10 GB) | — |
| 18 | Error tracking / uptime alerts | Sentry / UptimeRobot | Free | — |
| 19 | Web address | `*.pages.dev` | Free | Own domain ≈ ₹800–1,500/year, **before printing QR cards and before Razorpay goes live** |

Free-plan limits are approximate and checked again at sign-up.

### What we will actually pay

| Stage | Cost |
|---|---|
| Building and testing | **₹0** (test phone numbers, Razorpay test mode) |
| Pilot, payments off | **₹0** (SIM plan you already have) |
| Payments on | ≈2% of each payment, taken from money already received |
| Before printing QR cards | Domain ≈ ₹800–1,500/year |
| More than ≈200 guests online at the same moment | Supabase Pro ≈ $25/month |

## 12. Future features

1. Food ordering + menu + bills (orders extend the session)
2. Events (Navratri, seminars)
3. Twilio (or another SMS provider) instead of the SIM
4. Restaurant dashboard for owners
5. Images in chat
6. Auto-translation (write in Hindi, read in English)
7. Native Android / iOS app
8. Avatars
9. Captive portal (WiFi opens our page automatically)
10. Own servers / Docker when we outgrow the free plans

## 13. Decision log

| # | Question | Decision |
|---|---|---|
| 1 | QR per table or venue? | Per table, with a random code that can't be guessed |
| 2 | Show interest tags on cards? | Yes |
| 3 | Public ID | Fixed forever per user (e.g. `Mango-4821`) |
| 4 | Location method | GPS (table QR + GPS). No WiFi / IP check. |
| 5 | Location required? | Yes |
| 6 | Leaving the restaurant | 3-minute grace, then logged out |
| 7 | Phone locked | Offline label; no inactivity logout; push notifications |
| 8 | Chat start | Request → accept |
| 9 | Age | 18+ only, birth year required |
| 10 | Chat history | Deleted at session end, except for subscribers (kept while subscription active) |
| 11 | Scan fee / subscription | ₹19 = 1 hour; ₹400 = 25 scans × 2 hours, no expiry; built with on/off switches |
| 12 | Subscription bought mid-session | Session becomes 2 hours from its start, uses 1 scan |
| 13 | Continue without rescanning | Yes: ₹19 for +1 hour, or 1 scan for +2 hours |
| 14 | Paid session ended early | Free resume at the same restaurant within the paid time |
| 15 | Payment gateway | Razorpay |
| 16 | Login | Phone OTP; SMS from a dedicated SIM now, Twilio later |
| 17 | Hosting | Supabase + Cloudflare Pages, free plans, no Docker |
| 18 | Restaurant access | None in V1; we run everything |
| 19 | Mall / neighbouring restaurants | Accepted risk; strict per-restaurant radius |
| 20 | Kick | 12 hours, that restaurant only |
| 21 | Report evidence | Last 50 messages, kept 30 days |
| 22 | Languages | English, Hindi, Gujarati from day one |

## 14. To arrange before launch (not code)

| # | Item | Needed for |
|---|---|---|
| 1 | Dedicated SIM + spare Android phone that stays on | OTP SMS |
| 2 | 2–3 pilot restaurants willing to let us test on-site | GPS field test (first milestone) |
| 3 | Domain name | Before printing QR cards |
| 4 | Registered business, PAN, bank account (Razorpay KYC) | Before switching payments on |
| 5 | Privacy policy, terms, refund policy, contact page — legal review | Before the pilot (Razorpay also requires them) |
| 6 | Native speakers to review Hindi and Gujarati text | Before the pilot |
| 7 | Final product name | Before printing QR cards |
