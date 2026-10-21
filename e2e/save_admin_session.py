"""
One-time step before the admin tests: sign in to the Admin Console yourself
(email, password, authenticator code) in the browser this opens. The signed-in
session is saved to e2e/.auth/admin.json (git-ignored) and reused by
test_admin.py, which keeps it fresh after each run.

    .venv\\Scripts\\python save_admin_session.py

Run it again whenever the admin test says the session has expired. The file
is a live admin login: never share or commit it.
"""

from playwright.sync_api import sync_playwright

from conftest import ADMIN_STATE, BASE_URL

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    context = browser.new_context()
    context.add_init_script("localStorage.setItem('introchat.language', 'en')")
    page = context.new_page()
    page.goto(f"{BASE_URL}/admin")
    print("Sign in in the browser window (email, password, authenticator code).")
    print("Waiting up to 5 minutes...")
    page.get_by_role("heading", name="Venues").wait_for(timeout=300_000)
    ADMIN_STATE.parent.mkdir(exist_ok=True)
    context.storage_state(path=str(ADMIN_STATE))
    print(f"Saved the admin session to {ADMIN_STATE}")
    browser.close()
