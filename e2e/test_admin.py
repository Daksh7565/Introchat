"""
The Admin Console path for a new venue (milestone M1): create it with the pin
set from the phone, add tables, download the QR cards, activate it, run the
on-site live test, and check a guest can scan in. Needs a saved admin login
(save_admin_session.py); skipped without one.

Venues touched by admin actions cannot be deleted (their audit-log rows must
be kept), so this test's venue is deactivated at the end, not deleted. Each
run leaves one inactive "E2E Admin Cafe ..." venue in the list.
"""

import re
import secrets
import string

import pytest
from playwright.sync_api import Browser, expect

from conftest import ADMIN_STATE, BASE_URL, sql

pytestmark = pytest.mark.skipif(
    not ADMIN_STATE.exists(),
    reason="no saved admin login: run `python save_admin_session.py` first",
)

# Where the emulated admin phone stands when setting the pin (a spot ~1.2 km
# from the guest-test venue, so the two never overlap).
ADMIN_SPOT = {"latitude": 23.030000, "longitude": 72.580000, "accuracy": 8}


def test_admin_sets_up_a_venue_a_guest_can_scan(browser: Browser, phone):
    context = browser.new_context(
        storage_state=str(ADMIN_STATE),
        geolocation=ADMIN_SPOT,
        permissions=["geolocation"],
        viewport={"width": 1280, "height": 900},
    )
    context.add_init_script("localStorage.setItem('introchat.language', 'en')")
    page = context.new_page()
    try:
        page.goto(f"{BASE_URL}/admin")
        expect(
            page.get_by_role("heading", name="Venues"),
            "admin session expired: run `python save_admin_session.py` again",
        ).to_be_visible()

        # Create the venue, with the pin from the "phone" (30 s of readings).
        suffix = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(5))
        name = f"E2E Admin Cafe {suffix}"
        page.get_by_role("link", name="New venue").click()
        page.get_by_label("Name", exact=True).fill(name)
        slug = page.get_by_label("Link name").input_value()
        assert slug == f"e2e-admin-cafe-{suffix}", "the link name follows the venue name"
        page.get_by_label("Address").fill("Test address, Nehru Nagar")
        page.get_by_label("City").fill("Ahmedabad")
        page.get_by_role("button", name=re.compile("Set pin from my phone")).click()
        expect(page.get_by_text(re.compile("Pin set from"))).to_be_visible(timeout=60_000)
        page.get_by_role("button", name="Create venue").click()
        expect(page).to_have_url(re.compile(r"/admin/venues/[0-9a-f-]{36}$"))

        # Two tables, and their QR cards as a PDF.
        page.get_by_label("From").fill("1")
        page.get_by_label("To", exact=True).fill("2")
        page.get_by_role("button", name="Add 2 tables").click()
        download_button = page.get_by_role("button", name="Download QR cards (PDF, 2 tables)")
        expect(download_button).to_be_visible()
        with page.expect_download(timeout=60_000) as download:
            download_button.click()
        assert download.value.suggested_filename.endswith(".pdf")
        assert download.value.path().stat().st_size > 10_000, "the PDF has content"

        # Activate, then the on-site test says a guest here can join.
        page.get_by_role("button", name="Activate venue").click()
        expect(page.get_by_role("button", name="Deactivate venue")).to_be_visible()
        page.get_by_role("button", name="Start live test").click()
        expect(page.get_by_text("INSIDE: a guest here can join")).to_be_visible(timeout=30_000)
        page.get_by_role("button", name="Stop test").click()

        # A guest standing at the pin scans table T01 and is let in.
        token = sql(
            "select t.qr_token from public.tables t join public.venues v on v.id = t.venue_id "
            f"where v.slug = '{slug}' and t.label = 'T01'"
        )[0]["qr_token"]
        guest = phone(at=ADMIN_SPOT)
        guest.goto(f"{BASE_URL}/v/{slug}/t/{token}")
        expect(guest.get_by_role("heading", name=f"Welcome to {name}")).to_be_visible()
        check = guest.get_by_role("button", name="Check my location")
        inside = guest.get_by_text(f"You're at {name}")
        expect(inside.or_(check)).to_be_visible()
        if check.is_visible():
            check.click()
        expect(inside).to_be_visible()

        # Leave nothing scannable behind.
        page.get_by_role("button", name="Deactivate venue").click()
        expect(page.get_by_role("button", name="Activate venue")).to_be_visible()
    finally:
        # Supabase rotates the login token on use; keep the newest for next run.
        context.storage_state(path=str(ADMIN_STATE))
        context.close()
