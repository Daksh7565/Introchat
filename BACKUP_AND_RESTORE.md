# Backup and restore

The free Supabase plan has no downloadable backups. Every night at 03:00 IST the
GitHub Action **backup** (`.github/workflows/backup.yml`) dumps the database,
encrypts the dump with [age](https://age-encryption.org) and keeps it for 30 days
as a workflow artifact. Only the holder of the age private key can read it.

**Restore-tested on 2026-10-22** (dev data, local Supabase stack). All 17
migrations replayed cleanly on an empty database, then the data loaded. Row counts
matched dev in all 27 tables checked: every public table, plus Auth users,
identities and MFA factors. Sequence positions, the Realtime policies and both
cron jobs were correct. One gap is open; see
[The phone-hash key](#the-phone-hash-key-decision-pending).

## What a backup contains, and what it does not

| In the backup (`.tar.gz.age`) | |
|---|---|
| `schema.sql` | Tables, functions, grants (reference; the restore uses the migrations instead, see below) |
| `data.sql` | Every row: all public tables, and **Supabase Auth** (users with phone numbers, MFA factors, sessions) |
| `roles.sql` | Role settings; they are Supabase's defaults, kept for reference only |

| Not in the backup | Where it comes from in a restore |
|---|---|
| Migration history, Realtime channel policies, cron jobs (`introchat-tick`, `introchat-hourly-cleanup`) | `supabase db push` of the repo's migrations (step 3). A `pg_dump` schema has none of them; that is why the restore builds the schema from migrations. |
| Vault `push_send_secret` | Created by the migrations; `push-send` reads it from the database, so a new value works. |
| Vault `phone_hash_key` | **Decision pending.** Without the original key every ban stops matching. See below. |
| Edge Functions and their secrets | Deployed again (step 6) |
| Auth settings (Send SMS hook, test numbers, admin MFA, password rules) | `supabase config push` (step 6) |
| Supabase Storage | Not used by IntroChat; the restore skips its tables |

## The phone-hash key (decision pending)

Bans and report snapshots store phone numbers only as an HMAC, keyed with the
Vault secret `phone_hash_key`. A restored project generates a **new** key. The
restore test showed what happens then: on dev, 4 of 4 guests' stored hashes
matched their phones, and on the restored copy 0 of 4 did. **A banned phone
could sign in again.** Migration `guest_identity` says the key is "never
exported", so keeping a copy changes a written rule. The choice is yours:

- **A)** Copy the key once, by hand, into the same offline place as the age
  private key. The key never changes, so once is enough. *(recommended: the key
  never sits in GitHub, even encrypted)*
- **B)** Add it to every nightly backup, inside the encrypted file.

Until this is decided, restores work but bans do not survive them.

## One-time set-up (owner)

1. Install age and make the key pair (PowerShell):
   ```powershell
   winget install --id FiloSottile.age
   age-keygen -o "$HOME\introchat-backup-key.txt"
   ```
   It prints `Public key: age1...`. Keep `introchat-backup-key.txt` **offline**:
   in a password manager and on a USB stick, not in the repo, not in GitHub. If
   it is lost, every backup is unreadable. If it leaks, every backup is readable.
2. In the Supabase dashboard of the project to back up: **Connect → Session
   pooler**, and copy the URI (port **5432**; the transaction pooler on 6543
   cannot run `pg_dump`). It contains the database password. Special characters
   in the password must be percent-encoded.
3. Save both in GitHub (the secret is typed at a prompt, never shown):
   ```powershell
   cd C:\Users\Dell\Desktop\Project\IntroChat
   gh secret set BACKUP_DB_URL
   gh variable set BACKUP_AGE_RECIPIENT --body "age1...your public key..."
   ```
4. Run it once by hand and check it is green:
   ```powershell
   gh workflow run backup.yml
   gh run list --workflow backup.yml --limit 3
   ```

Point `BACKUP_DB_URL` at **prod** once prod exists. Until then dev is fine for
proving it works. GitHub emails a failed scheduled run to whoever last changed
the schedule line in `backup.yml`. In a public repo, GitHub pauses schedules
after 60 days without any commit.

## Restore (into a new, empty Supabase project)

You need Docker Desktop running, age, the key file and the repo. Commands are
PowerShell, run from `C:\Users\Dell\Desktop\Project\IntroChat`.

1. **Download** the backup you want:
   ```powershell
   gh run list --workflow backup.yml --limit 10
   gh run download <run-id> --dir C:\introchat-restore
   ```
2. **Decrypt and unpack**:
   ```powershell
   cd C:\introchat-restore
   age -d -i "$HOME\introchat-backup-key.txt" -o backup.tar.gz (Get-ChildItem -Recurse -Filter *.age).FullName
   tar -xzf backup.tar.gz
   ```
   You now have `roles.sql`, `schema.sql` and `data.sql`, which include phone
   numbers. Delete the folder when the restore is done.
3. **Schema from the migrations**: create the new project (same region as the
   old one, Postgres 17), then:
   ```powershell
   cd C:\Users\Dell\Desktop\Project\IntroChat
   npx supabase link --project-ref <new-project-ref>
   npx supabase db push
   ```
4. **Data**: build the load file, then run it with the `psql` that ships in
   Supabase's Postgres image (dumps from pg_dump 17.6+ need psql 17.6+):
   ```powershell
   node tools\backup\restore-sql.mjs C:\introchat-restore\data.sql C:\introchat-restore\restore-load.sql
   docker run --rm -v C:\introchat-restore:/restore public.ecr.aws/supabase/postgres:17.11.0.004 `
     psql "<session pooler URI of the NEW project>" -f /restore/restore-load.sql
   ```
   It is one transaction: either everything loads or nothing does. What the
   script does, and why, is at the top of `tools/backup/restore-sql.mjs`.
5. **Phone-hash key**: depends on the decision above. With option A, in the new
   project's SQL editor:
   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'phone_hash_key'),
     '<the saved key>'
   );
   ```
   Check it took: this must return the same number twice.
   ```sql
   select count(*) filter (where p.phone_hash = public.phone_hash(u.phone)), count(*)
   from public.profiles p join auth.users u on u.id = p.id
   where public.normalize_indian_mobile(u.phone) is not null;
   ```
6. **Everything around the database**:
   - `npx supabase config push`, then set the **Send SMS hook** and its secret in
     the dashboard (Authentication → Hooks).
   - Edge Function secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
     `RAZORPAY_WEBHOOK_SECRET`, `SEND_SMS_HOOK_SECRET`, `SMS_GATEWAY_USERNAME`,
     `SMS_GATEWAY_PASSWORD`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
     `VAPID_SUBJECT`, `ALLOWED_ORIGINS` (`npx supabase secrets set ...`). Use the
     **same VAPID keys** as before, or every saved push subscription stops working.
   - Deploy the functions: `npx supabase functions deploy --use-api`.
   - The setting `PUSH_FUNCTION_URL` came back with the **old** project's
     address: set it to the new project's `.../functions/v1/push-send` in the
     Console (Settings).
   - Razorpay dashboard: point the webhook at the new project's `payments-webhook`.
   - Frontend: new `VITE_SUPABASE_URL` and anon key in the deploy env file, then
     rebuild and deploy. Table QR codes do not change: they point at the website,
     not at Supabase.
7. **Verify**:
   - Rows per table in the backup: `node tools\backup\restore-sql.mjs --counts C:\introchat-restore\data.sql`
     (the backup run's log, step "Dump", printed the same list). Compare with the
     new project, for example `select count(*) from public.profiles;`.
   - The database tests: `npx supabase test db --linked`.
   - Delete `C:\introchat-restore`.
