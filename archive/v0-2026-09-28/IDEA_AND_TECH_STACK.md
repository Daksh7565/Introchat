# IntroChat — Idea & Tech Stack

> Working name: **IntroChat** (final name and domain not decided yet)
> Date: 2026-09-28 · Status: planning complete, development not started
> The detailed build plan is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

---

## 1. The idea in one line

Put a QR code on every restaurant table and event venue. Guests scan it, join the venue WiFi, and can **chat anonymously with other people at the same place right now**, and **order food** from the same screen.

## 2. The problem

People sit next to each other in cafes, restaurants, Navratri grounds and seminars but rarely start a conversation. Walking up to a stranger is awkward. IntroChat gives them a safe, anonymous first step: see who is here, see shared interests, and say hello by text.

## 3. How it works (guest's view)

1. **Scan** the QR code on the table.
2. The page shows the **venue WiFi name and password**. The guest joins the WiFi, and the **"Go to App"** button unlocks.
3. **Log in with phone number + OTP.**
4. First time only: fill a short profile (all optional except interests):
   - nickname, age, gender
   - **interest tags**, e.g. *football, music, startups*
5. The guest gets a **permanent anonymous ID** like `Mango-4821`. Nobody ever sees their name or phone number.
6. **People list:** everyone currently at this venue, shown only by ID and interest tags. People with the **most shared interests appear at the top**.
7. **Tap anyone and start chatting**: 1-to-1, text and emoji, in English, Hindi or Gujarati.
8. **Menu tab:** order food straight to their table. The bill is paid at the end, the same way as today's table-QR menus.

## 4. The session rules

| Rule | Detail |
|---|---|
| Session length | **1 hour** per scan |
| Warning | At **5 minutes left**, a popup offers: **Order food** · **Buy subscription** · **Not now** |
| Order food | When the restaurant **confirms** the order, the guest gets **+30 minutes**. No limit on how many times. |
| Waiting for the restaurant | After placing an order, the session is protected for **15 minutes**. At 10 minutes, if the order is still not accepted, the guest is told: *"You have 5 minutes. Ask the manager to accept it, or place a new order."* |
| Subscription | **Unlimited sessions for 30 days** at **all partner venues** |
| Not now | The session ends when time is up. The same choices appear one last time, and then the guest is logged out. |
| Leaving the venue | Switching from venue WiFi to mobile data (or leaving the WiFi range) = **logged out** |
| Phone locked | Shown as **Offline** to others. Logged out only after **10 minutes** away. |
| Chat history | **Deleted when the session ends.** A new session starts with an empty chat list. |

## 5. How we know the guest is really inside the venue

Every partner venue has a **static public IP address** on its internet connection. Every request from the guest's phone is checked:

- It comes from the venue's IP → the guest is on the venue WiFi → **allowed**.
- It comes from any other IP (mobile data, home WiFi) → **not allowed / logged out**.

The app sends a small "I'm still here" signal (**heartbeat**) every 30 seconds to keep checking.

> Why not use the IP as the user's identity? Everyone on the same WiFi shares **one** public IP, so the server would see all 30 guests as one person. So the **IP tells us *where* the guest is**, and the **phone OTP tells us *who* they are**.

## 6. Safety

| Feature | What it does |
|---|---|
| Anonymous IDs | Other guests never see name, phone, age, or gender |
| Block | Two people stop seeing each other, permanently |
| Report | Sends the case to our admin team |
| Kick (restaurant staff) | Removes a guest from that venue for **12 hours** |
| Ban (our admin) | Blocks the **phone number** from all venues. Coming back needs a new SIM. |

## 7. Who uses what

| User | What they get |
|---|---|
| **Guest** | Mobile website: people list, chat, menu, orders, bill |
| **Restaurant / event staff** | Venue Dashboard: live guest count, incoming orders (with sound alert), confirm/reject, menu management, bills, table QR codes, revenue |
| **Us (super admin)** | Admin panel: onboard venues, set their IP, handle reports and bans, turn features on or off per venue, platform stats |

## 8. Where it will be used

- **Restaurants and cafes**: menu + chat. Food orders extend the session.
- **Events**, such as Navratri party plots in Ahmedabad and seminars: chat only, no menu. Only a subscription extends the session.
- **Rollout:** start with a few cafes (~30 people each), then scale to events (2,000+ people).

## 9. Business model

| Revenue | Pilot | Later |
|---|---|---|
| Fee per scan (₹19 / ₹29 / ₹59, not decided) | Free | Charged |
| 30-day subscription | "Coming soon" | Charged |
| Commission on food orders | Recorded only | Charged to restaurants |
| Payment gateway | None | **Razorpay** |

The pilot is **free for selected restaurants** so we can collect feedback. All paid features are built from day one and **switched off by settings**. Going live with payments means changing a few settings, not rewriting code.

## 10. Tech stack

| Part | Technology | Why |
|---|---|---|
| **Frontend** | **React + Vite + TypeScript** | Fast, modern, huge ecosystem |
| App type | **Mobile-first PWA** (website that can be "installed" on the phone) | Guests just scan and use it, no app store download |
| Styling | Tailwind CSS | Quick to build a clean, friendly mobile UI |
| Languages | react-i18next | **English, Hindi, Gujarati** interface from day one |
| **Backend** | **Python + FastAPI** | Fast, simple, built-in support for real-time connections |
| Real-time chat | **WebSockets** (built into FastAPI) | Messages, "online/offline", timer alerts appear instantly |
| **Database** | **PostgreSQL + SQLAlchemy** | Reliable main database for users, venues, menus, orders |
| DB changes | **Alembic** | Safe, versioned changes to database structure |
| Fast memory store | **Redis** | Who is online right now, session timers, delivering chat between servers |
| **Login** | **Firebase Authentication** | Phone OTP for guests; email login for restaurant staff and admins |
| Payments (later) | **Razorpay** | Standard in India: UPI, cards, wallets |
| Packaging | **Docker** | Same setup on a laptop and on the server |
| **Hosting** | **DigitalOcean, Bangalore data centre** | See below |

### Hosting in simple words

A **VPS** (Virtual Private Server) is a rented computer in a data centre that runs our app 24×7. DigitalOcean calls it a **Droplet**, and it has a data centre in **Bangalore**, so our server is in India and fast for Indian users.

We chose **DigitalOcean over AWS** for now:
- **Simpler:** a clean dashboard with few choices.
- **Predictable:** a fixed monthly price with no surprise bills.

Because everything runs in Docker, moving to AWS (Mumbai) later for very large scale is straightforward.

**Pilot setup:** one Droplet running the website, API, timer worker, database and Redis, with free HTTPS and daily backups.
**When we grow:** managed database, more servers behind a load balancer. No code rewrite needed.

## 11. Future features

1. **Chat request / accept**: someone must accept before a chat starts
2. **Images in chat**
3. **Auto-translation**: write in Hindi, the other person reads it in English (using an LLM)
4. **Automatic WiFi popup (captive portal)**: joining the WiFi opens our page by itself
5. **Native mobile app** (Android / iOS)
6. **18+ age check**
7. **Avatars**
8. **Online food payment** + commission settlement

## 12. Still to decide

| # | Question | Current default |
|---|---|---|
| 1 | When someone reports a user, do we keep a copy of that chat (last 50 messages, 30 days) so the admin can check it? | Yes |
| 2 | Minimum order value to earn +30 minutes? | No minimum (each venue can set one) |
| 3 | Final product name and domain | "IntroChat", domain TBD |
| 4 | Scan fee and subscription prices | TBD |
