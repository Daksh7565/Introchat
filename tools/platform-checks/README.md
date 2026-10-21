# M0 Phase 4 — Supabase free-plan platform checks

Run on 2026-10-10 against the **dev** project (`kckjteuwwhqifiofyeii`, free plan, Supabase CLI 2.120.0).
Every check created its own temporary objects and removed them afterwards; the
"left behind" column was verified with a query after each cleanup.

| # | What the design relies on | Result | Evidence | Left behind |
|---|---|---|---|---|
| 1 | **pg_cron second-level schedules** (`tick()` every 10 s, M3) | ✅ works | Job `'10 seconds'` inserting timestamps; measured gaps min 10.0 s, max 10.0 s | 0 cron jobs, scratch schema dropped |
| 2 | **Vault** (phone-hash key, M2) | ✅ works | `vault.create_secret` → stored value ≠ plaintext → `vault.decrypted_secrets` returned the original | secret deleted |
| 3 | **Edge Function deploy without Docker** (`--use-api`) | ✅ works | `supabase functions deploy m0-check --use-api` uploaded the source for server-side bundling (no Docker build); call returned `{"ok":true}` HTTP 200 | function deleted remotely and locally |
| 4 | **Private Realtime channels authorized by RLS on `realtime.messages`** (M4) | ✅ works | Policy allowed topic `m0check:<uid>` only for that uid. Owner: `SUBSCRIBED`, received the message sent with `realtime.send(..., private => true)`. Other user: `CHANNEL_ERROR: Unauthorized: You do not have permissions to read from this Channel topic`, received nothing | policy dropped, 2 test users deleted (0 users in `auth.users`) |
| 5 | **Auth Send SMS Hook available on the free plan** (M2) | ⏳ to confirm in the dashboard | See below | — |

## M2 phase 1 — Auth settings (2026-10-10, dev)

Auth settings now live in `supabase/config.toml` and are applied with
`npx supabase config push` (only declared properties; `config diff` first).
Dev-only values (test phone numbers) sit in `[remotes.dev]`.

| Check | Result |
|---|---|
| `config pull` before any push | **Essential.** The default `config.toml` differed from dev in 12 places; pushing it unchanged would have switched admin MFA (TOTP) **off** and weakened email settings. Always pull, then edit, then diff, then push. |
| `auth.email.enable_signup = false` | ✗ **Unusable.** It disables the whole email provider: admin password **sign-in** failed (`email_provider_disabled`). Reverted within 2 minutes. Email sign-ups are refused by the before-user-created hook instead. |
| `auth.sms.enable_signup = true` + test numbers | ✅ `+919000000001` with code `123456` signed in as a phone user, no SMS sent. |
| Real number without an SMS hook/provider | Refused: "Unable to get SMS provider". The Send SMS hook (phase 3) is what supplies one. |
| Admin API `createUser` | ✅ works (whether the before-user-created hook also runs for it is checked in phase 2). |

## M2 phases 2–3 — Auth hooks (2026-10-10, dev)

| Finding | Consequence |
|---|---|
| The before-user-created hook does **not** run for users created through the Admin API (dashboard "Add user") | Admins are always created that way, so the hook simply refuses every public email sign-up; the planned "approved emails" table was removed (migration `remove_email_approvals`) |
| A trigger on `auth.users` is still allowed | Guest profiles + handles are created automatically on first phone login |
| **Send SMS hook answers:** Supabase Auth reads the error from the **body of an HTTP 200** (`{"error": {"http_code", "message"}}`) and passes that status + message to the phone. Non-200 answers are never passed on: 400 → "Invalid payload sent to hook", 401 → "Hook requires authorization token", others → "Unexpected status code" | `sms-hook` answers every refusal/failure as a 200 with an error body (except a bad signature: plain 401). Verified: an existing banned guest sees `BANNED`, a gateway outage shows `SMS_SEND_FAILED` |
| SMS OTP lifetime defaulted to **60 s** on the project | Set to 300 s in `config.toml` (`auth.sms.otp_expiry`), matching the SMS text |
| Advisor: leaked-password protection is off | Applies to admin passwords; believed to be a paid-plan feature. Revisit in M8 |

## Findings to carry into later milestones

- **Realtime (M4):** on the first run the owner's channel reported one
  `CHANNEL_ERROR` before working; the second run was clean. The client must treat
  a channel error as retryable (rejoin with backoff, then re-fetch state), never
  as final.
- **Edge Functions (CI):** deploy with `--use-api` everywhere, so no deploy path
  depends on Docker.
- **pgTAP:** `supabase test db --linked` needs Docker Desktop running and runs as
  the temporary `cli_login_postgres` role (no USAGE on `extensions`); test files
  `set local role postgres` first. See the comment at the top of each test file.

## Check 5 — how to confirm (no changes made)

Supabase dashboard → project `introchat-dev` → **Authentication → Hooks**:
confirm a **Send SMS hook** can be added with type **HTTPS** on the free plan.
Do not save one yet; it is configured in M2 together with the `sms-hook` function.
