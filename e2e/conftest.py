"""
Shared set-up for the IntroChat end-to-end tests (Playwright, Python).

The tests drive the real app (npm run dev on http://localhost:5173) against
the real dev Supabase project. Phones are emulated (Pixel 7) and their GPS is
faked with Playwright's geolocation, so the location rules can be tested from
a laptop. See README.md for how to run them.

Data rules:
  - Guest tests use the dev-only test numbers 9000000011-13 (code 123456,
    supabase/config.toml). Those accounts are deleted before and after each run.
  - Guest tests use a venue created directly in the database and deleted after.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import string
import subprocess
import time
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from playwright.sync_api import Browser, BrowserContext, Page, Playwright, expect

REPO = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:5173")
ADMIN_STATE = Path(__file__).parent / ".auth" / "admin.json"
RESULTS = Path(__file__).parent / "test-results"

# The guest test venue's pin, and points inside / clearly outside it.
VENUE_PIN = (23.022500, 72.571400)
INSIDE = {"latitude": 23.022510, "longitude": 72.571410, "accuracy": 10}
OUTSIDE = {"latitude": 23.032500, "longitude": 72.571400, "accuracy": 10}  # ~1.1 km north

OTP = "123456"
# One number per test: Supabase allows one code per number per 60 s
# (auth.sms.max_frequency), so two tests must never share a number.
PHONES = {
    "asha": "9000000011",
    "ravi": "9000000012",
    "minor": "9000000013",
    "login": "9000000014",
    "first_visit": "9000000015",
}

expect.set_options(timeout=15_000)


# --------------------------------------------------------------------------
# Database access through the Supabase CLI (already linked to dev)
# --------------------------------------------------------------------------
def sql(query: str) -> list[dict]:
    """Runs SQL on the linked dev project and returns the rows."""
    npx = "npx.cmd" if os.name == "nt" else "npx"
    result = subprocess.run(
        [npx, "supabase", "db", "query", "--linked", query],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        stdin=subprocess.DEVNULL,
        timeout=180,
    )
    start = result.stdout.find("{")
    if result.returncode != 0 or start < 0:
        raise RuntimeError(f"SQL failed: {result.stderr[-800:] or result.stdout[-800:]}")
    return json.loads(result.stdout[start:]).get("rows", [])


def delete_test_guests() -> None:
    # Deleting the auth user removes the profile, sessions, requests and chats (cascade).
    numbers = ", ".join(f"'91{n}'" for n in PHONES.values())
    sql(f"delete from auth.users where phone in ({numbers})")


# --------------------------------------------------------------------------
# Session-wide fixtures
# --------------------------------------------------------------------------
def _server_up() -> bool:
    try:
        with urllib.request.urlopen(BASE_URL, timeout=3) as response:
            return response.status == 200
    except OSError:
        return False


@pytest.fixture(scope="session", autouse=True)
def dev_server() -> Iterator[None]:
    """Uses a running `npm run dev`, or starts one for the test run."""
    if _server_up():
        yield
        return
    npm = "npm.cmd" if os.name == "nt" else "npm"
    process = subprocess.Popen(
        [npm, "run", "dev", "--", "--port", "5173", "--strictPort"],
        cwd=REPO / "frontend",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            if _server_up():
                break
            time.sleep(1)
        else:
            raise RuntimeError("npm run dev did not start on port 5173")
        yield
    finally:
        process.terminate()


@pytest.fixture(scope="session", autouse=True)
def fresh_test_guests() -> Iterator[None]:
    delete_test_guests()
    yield
    delete_test_guests()


@dataclass(frozen=True)
class Venue:
    id: str
    slug: str
    name: str
    token: str

    @property
    def url(self) -> str:
        return f"{BASE_URL}/v/{self.slug}/t/{self.token}"


@pytest.fixture(scope="session")
def venue() -> Iterator[Venue]:
    """An active test venue with one table, created in the database and deleted after."""
    suffix = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    token = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
    slug, name = f"zz-e2e-{suffix}", f"E2E Cafe {suffix}"
    rows = sql(
        "insert into public.venues (slug, name, type, latitude, longitude, is_active) "
        f"values ('{slug}', '{name}', 'cafe', {VENUE_PIN[0]}, {VENUE_PIN[1]}, true) returning id"
    )
    venue_id = rows[0]["id"]
    sql(f"insert into public.tables (venue_id, label, qr_token) values ('{venue_id}', 'T1', '{token}')")
    # Normal timings for this venue only, whatever dev is set to (e.g. 3-minute
    # sessions for a timer test), so no time-up popup covers the screen mid-test.
    sql(
        "insert into public.venue_settings (venue_id, key, value) values "
        f"('{venue_id}', 'FREE_SESSION_MINUTES', '60'), ('{venue_id}', 'WARNING_BEFORE_MINUTES', '15')"
    )
    yield Venue(venue_id, slug, name, token)
    delete_test_guests()  # their sessions point at this venue
    sql(f"delete from public.sessions where venue_id = '{venue_id}'")
    sql(f"delete from public.venues where id = '{venue_id}'")


# --------------------------------------------------------------------------
# A guest's phone
# --------------------------------------------------------------------------
@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    # Lets fixtures see whether the test itself failed (for screenshots).
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"rep_{report.when}", report)


@pytest.fixture
def phone(browser: Browser, playwright: Playwright, request: pytest.FixtureRequest) -> Iterator:
    """Opens emulated phones: phone(at=INSIDE) → Page. Each phone is its own browser profile."""
    contexts: list[BrowserContext] = []

    def open_phone(at: dict = INSIDE) -> Page:
        context = browser.new_context(
            **playwright.devices["Pixel 7"],
            geolocation=at,
            permissions=["geolocation"],
            locale="en-IN",
        )
        # English UI, whatever the laptop's language.
        context.add_init_script("localStorage.setItem('introchat.language', 'en')")
        contexts.append(context)
        return context.new_page()

    yield open_phone
    failed = getattr(request.node, "rep_call", None)
    for number, context in enumerate(contexts, start=1):
        if failed is not None and failed.failed:
            # What each phone showed when the test failed.
            for page in context.pages:
                RESULTS.mkdir(exist_ok=True)
                page.screenshot(path=str(RESULTS / f"{request.node.name}-phone{number}.png"), full_page=True)
        context.close()


# --------------------------------------------------------------------------
# Steps shared by the guest tests
# --------------------------------------------------------------------------
def arrive(page: Page, venue: Venue) -> None:
    """Scan → landing → location confirmed inside."""
    page.goto(venue.url)
    inside = page.get_by_text(f"You're at {venue.name}")
    check = page.get_by_role("button", name="Check my location")
    # With permission already granted the app checks by itself.
    expect(inside.or_(check)).to_be_visible()
    if check.is_visible():
        check.click()
    expect(inside).to_be_visible()


def log_in(page: Page, number: str) -> None:
    page.get_by_role("button", name="Continue").click()
    page.get_by_label("Mobile number").fill(number)
    page.get_by_role("button", name="Send code").click()
    # The code submits itself at the 6th digit.
    page.get_by_label("6-digit code").fill(OTP)


def onboard(page: Page, birth_year: str = "1998") -> None:
    expect(page.get_by_role("heading", name="Before you start")).to_be_visible()
    page.get_by_label("I am 18 or older and I agree to this.").check()
    page.get_by_role("button", name="Agree and continue").click()
    page.get_by_label("Year of birth").fill(birth_year)
    page.get_by_role("button", name="Continue").click()


def pick_tags(page: Page, tags: tuple[str, ...]) -> None:
    expect(page.get_by_role("heading", name="What are you into?")).to_be_visible()
    for tag in tags:
        page.get_by_label("Add your own").fill(tag)
        page.keyboard.press("Enter")
    page.get_by_role("button", name="Save and finish").click()


def handle_shown(page: Page) -> str:
    heading = page.get_by_role("heading", name=re.compile(r"^You're [A-Z][a-z]+-\d{4}$"))
    expect(heading).to_be_visible()
    return heading.inner_text().removeprefix("You're ").strip()


def join(page: Page, venue: Venue) -> None:
    page.get_by_role("button", name=f"Join the chat at {venue.name}").click()
    expect(page.get_by_role("timer")).to_be_visible()


def guest_joins(page: Page, venue: Venue, number: str, tags: tuple[str, ...] = ("music",)) -> str:
    """Scan, log in, onboard if this is the first visit, join. Returns the guest's handle."""
    arrive(page, venue)
    log_in(page, number)
    first_visit = page.get_by_role("heading", name="Before you start")
    returning = page.get_by_role("heading", name=re.compile(r"^You're "))
    expect(first_visit.or_(returning)).to_be_visible()
    if first_visit.is_visible():
        onboard(page)
        pick_tags(page, tags)
    handle = handle_shown(page)
    join(page, venue)
    return handle
