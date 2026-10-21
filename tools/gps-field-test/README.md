# M0 Phase 6 — GPS field test

**Why:** the whole product depends on phones knowing they are *inside* a restaurant.
Before building M1 we measure it at real pilot restaurants, on one Android and one
iPhone, and set `GEOFENCE_RADIUS_M`, `MAX_ACCURACY_M` and `ACCURACY_BUFFER_M` from
evidence. The page uses the exact rule the app will use (ARCHITECTURE §3.2), so a
reading marked INSIDE here would be INSIDE in the app.

**Privacy:** readings stay in the phone's browser until you export them. Raw CSVs
go in `documents/field-tests/raw/` (git-ignored); only summaries go into the plan.

## 1. Put the page online (once)

Location only works over HTTPS, so the page needs a real address. It has no
server and no dependencies: one file.

```powershell
cd c:\Users\Dell\Desktop\Project\IntroChat\frontend
npx wrangler deploy --assets ..\tools\gps-field-test --name introchat-gps-test --compatibility-date 2026-10-06
```

(Cloudflare Pages is now part of Workers; `wrangler pages deploy` hands off to
Workers and fails, so the page is deployed as a static-assets Worker. Run from
`frontend/` so the project's pinned wrangler version is used; `npx wrangler
login` first if this machine is not logged in.)

Wrangler prints an address like `https://introchat-gps-test.<your-subdomain>.workers.dev`.
A brand-new address can take a few minutes before https works. Open it on both
phones and add it to the home screen for quick access.

## 2. At each restaurant (about 20 minutes)

Do it at a normal busy hour, phones in normal use (WiFi switched on).

**Android first:**
1. Fill in *Restaurant* and check *This phone*.
2. Stand in the **middle** of the seating area → **Set pin here**, hold still 30 s.
3. Record, one tap each (move between taps, wait ~5 s at each spot):

| Where | Label | How many |
|---|---|---|
| Tables spread across the room, including corners and window seats | Table 1, 2, 3… | 6–8 tables, 1 each |
| Counter / billing | Counter | 1 |
| Near the washroom (usually the far end) | Washroom | 1 |
| Just inside the entrance | Door inside | 1 |
| Just outside the entrance | Door outside | 1 |
| ~10 m outside, on the street | Outside 10 m | 2 |
| ~30 m outside | Outside 30 m | 2 |
| Inside the shop/restaurant next door, if any | Neighbour shop | 2 |
| Upstairs / mezzanine / outdoor seating, if any | Other → type it | 1–2 |

4. **Share CSV** (WhatsApp it to yourself) before leaving.

**iPhone:** type the Android's pin numbers into *Pin latitude / longitude* →
**Use these numbers as the pin**, so both phones measure from the same point.
Then repeat step 3. Finally, **once**, turn Precise Location **off** for Safari,
untick the box on the page, record 2 table readings, and turn it back on — that
shows what guests with it off will experience.

## 3. Send the results

Put the CSVs in `documents/field-tests/raw/` and tell me. I will summarise per
restaurant: accuracy indoors, how many tables read INSIDE, how far outside
readings still read INSIDE (false positives), and recommend the defaults.

## What "good" looks like

- Tables: accuracy mostly **≤ 30 m**, all INSIDE.
- Outside 30 m and neighbour: OUTSIDE or UNKNOWN, never INSIDE.
- If indoor accuracy is often worse than ~60 m, we stop and decide together before M1.
