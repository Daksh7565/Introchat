# Load test (dev only)

Up to 100 guests in one venue on the **dev** project, each doing what the app
does: sign in, consent, profile, interests, join, live channels, a heartbeat
every 30 s, the same re-fetches the app makes on each notice, chat requests,
answers and messages. It reports response times per call, errors, live-channel
connections and how fast notices arrive.

## Run

PowerShell, from the repo root. The service role key goes into this terminal's
environment only; it is never printed or saved.

```powershell
cd C:\Users\Dell\Desktop\Project\IntroChat
$env:SUPABASE_URL = (Select-String -Path frontend\.env.local -Pattern '^VITE_SUPABASE_URL=(.*)$').Matches[0].Groups[1].Value
$env:SUPABASE_ANON_KEY = (Select-String -Path frontend\.env.local -Pattern '^VITE_SUPABASE_ANON_KEY=(.*)$').Matches[0].Groups[1].Value
$env:SUPABASE_SERVICE_ROLE_KEY = (npx supabase projects api-keys --project-ref kckjteuwwhqifiofyeii -o json | ConvertFrom-Json | Where-Object name -eq 'service_role').api_key
cd tools\load-test
npx deno run --allow-net --allow-env --allow-write --allow-run --allow-read load-test.ts
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

Options (environment variables): `LOAD_GUESTS` (2 to 100, default 100),
`LOAD_STEADY_SECONDS` (default 600), `LOAD_REPORT` (a file path for the JSON report).

A full run takes about 30 minutes. Supabase allows 30 sign-ins per 5 minutes
from one IP address, so 100 guests arrive over about 17 minutes, then all of
them stay for the steady period.

## What it touches

- Test users with phone numbers **9000002000 to 9000002099**. No SMS is sent:
  they are created through the Auth admin API with a password.
- One venue `zz-load-…` with timings of 60/15 minutes, whatever dev is set to.
- All of it is deleted at the end, also when the run fails or is stopped with
  Ctrl+C. A run that was killed outright leaves them; the next run deletes
  leftover test users first, and a leftover venue can be removed with
  `delete from public.venues where slug like 'zz-load-%'` (after its sessions).
