# End-to-end tests (Playwright, Python)

These drive the real app in a real browser against the **dev** Supabase
project: emulated phones (Pixel 7) with faked GPS, so location rules can be
tested from a laptop.

| File | Covers |
|---|---|
| `test_guest_entry.py` | Unknown QR, outside the venue, bad number and wrong code, first visit (consent → birth year → interests incl. Gujarati → join), reload keeps the session, Leave, returning guest skips onboarding, under-18 refused for good |
| `test_chat.py` | Two phones: see each other, request → accept, notification offer, live message with emoji/Hindi/Gujarati, Seen, reply, one leaves → read-only |
| `test_admin.py` | New venue with the pin from the phone, 2 tables, QR PDF download, activate, on-site live test says INSIDE, a guest scans in, deactivate |

Not covered here (need real devices): push notifications arriving on a locked
phone, real SMS, real GPS accuracy, walking out of a venue.

## One-time set-up

```powershell
cd C:\Users\Dell\Desktop\Project\IntroChat\e2e
& "C:\Users\Dell\AppData\Local\Programs\Python\Python313\python.exe" -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m playwright install chromium
```

For the admin test, sign in once (a browser opens; enter your email, password
and authenticator code there):

```powershell
.venv\Scripts\python save_admin_session.py
```

The session is saved to `e2e/.auth/admin.json` (git-ignored; it is a live admin
login, never share it). If the admin test ever says the session expired, run
this again.

## Run

```powershell
cd C:\Users\Dell\Desktop\Project\IntroChat\e2e
.venv\Scripts\python -m pytest -v
```

- Starts `npm run dev` itself if it is not already running.
- Watch the browsers: add `--headed --slowmo 300`.
- One file: `.venv\Scripts\python -m pytest -v test_chat.py`.
- On a failure, a screenshot and a trace are saved under `e2e/test-results/`;
  open a trace with `.venv\Scripts\python -m playwright show-trace <file>.zip`.

## Data it touches (dev only)

- Test numbers **9000000011–15** (code 123456): their accounts are deleted
  before and after every run.
- A guest-test venue `zz-e2e-…`, created in the database and deleted after.
- The admin test's venue cannot be deleted (audit-log rows must be kept), so it
  is deactivated at the end; each run leaves one inactive "E2E Admin Cafe …".
