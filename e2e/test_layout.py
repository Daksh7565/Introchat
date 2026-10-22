"""
Milestone M9 layout sweep: every guest screen, in every language, at phone
widths. Hindi and Gujarati often run longer than English; this finds where
that breaks a layout before a guest does.

Fails on:
- a page that scrolls sideways (360 px and 320 px);
- text that runs past its box or off the screen (360 px; 320 px may be
  cramped but must not scroll sideways).

Uses the dev preview (/dev/preview, sample data, `npm run dev` only), so it is
skipped against a production build. Screenshots of every screen at 360 px go
to e2e/layout-screenshots/ for checking layouts by eye (not test-results/,
which pytest-playwright empties at the start of every run).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from playwright.sync_api import Browser, Page, Playwright

from conftest import BASE_URL

LANGUAGES = ("en", "hi", "gu")
WIDTH_POLISHED = 360
WIDTH_SMALLEST = 320

# (preview screen button, harness option button or None, file name)
PREVIEW_STATES: list[tuple[str, str | None, str]] = [
    *[("Landing", s, f"landing-{s}") for s in ("idle", "checking", "inside", "outside", "unknown", "denied", "unsupported")],
    ("Login", "phone", "login-phone"),
    ("Login", "code", "login-code"),
    *[("Onboarding", s, f"onboarding-{s}") for s in ("consent", "profile", "tags", "ready", "under_age", "admin")],
    ("Home", None, "home"),
    ("Chat", None, "chat"),
    *[("15-min warning", s, f"warning-payments-{s}") for s in ("off", "on", "subscriber")],
    *[("Time up", s, f"time-up-payments-{s}") for s in ("off", "on", "subscriber")],
    *[("Ended", s, f"ended-{s}") for s in ("expired", "left_venue", "user_logout", "kicked", "banned", "venue_closed")],
    ("Pay to enter", "entry and subscription", "pay-entry-and-subscription"),
    ("Pay to enter", "entry only", "pay-entry-only"),
    ("Report / block", "report", "report"),
    ("Report / block", "block", "block"),
    *[("Delete account", s, f"delete-account-{s}") for s in ("idle", "confirming", "pending")],
    ("Notifications", "ask", "notifications-ask"),
    ("Notifications", "needs_install", "notifications-iphone"),
]

# Real routes, outside the preview.
ROUTES = [("/privacy", "legal-privacy"), ("/terms", "legal-terms"), ("/refunds", "legal-refunds"),
          ("/contact", "legal-contact"), ("/no-such-page", "not-found")]

# Runs in the page: returns what overflows. The preview's own controls are
# left out (English-only test harness, never shown to guests).
FIND_OVERFLOW = """
(checkText) => {
  const width = window.innerWidth
  const problems = []
  const page = document.documentElement.scrollWidth
  if (page > width + 1) problems.push(`page scrolls sideways (${page}px content on a ${width}px screen)`)
  if (!checkText) return problems
  const harness = document.querySelector('[data-preview-controls]')
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
  for (const el of document.querySelectorAll('body *')) {
    if (harness && harness.contains(el)) continue
    if (!hasOwnText(el) && !el.matches('button, a, input, select, textarea, label')) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const box = el.getBoundingClientRect()
    // Screen-reader-only text (sr-only) is a 1px box on purpose.
    if (box.width <= 1 || box.height <= 1) continue
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 70)
    const scrolls = ['auto', 'scroll'].includes(style.overflowX)
    if (box.right > width + 1 || box.left < -1) {
      problems.push(`off screen: "${text}" (${Math.round(box.left)}..${Math.round(box.right)}px)`)
    } else if (
      !scrolls &&
      // "…" is a deliberate shortening (a chat preview, a long venue name).
      style.textOverflow !== 'ellipsis' &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.clientWidth > 0
    ) {
      problems.push(`runs past its box: "${text}" (${el.scrollWidth}px in ${el.clientWidth}px)`)
    } else if (hasOwnText(el)) {
      // Text that fits but presses against the border of its button or card
      // (found by eye in M9: Gujarati help text in a button with no side
      // padding). The nearest box with a border or a background frames it.
      let frame = el
      while (frame && frame !== document.body) {
        const s = getComputedStyle(frame)
        const filled = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'
        if (parseFloat(s.borderLeftWidth) > 0 || parseFloat(s.borderRightWidth) > 0 || filled) break
        frame = frame.parentElement
      }
      if (frame && frame !== document.body) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const ink = range.getBoundingClientRect()
        const f = frame.getBoundingClientRect()
        const fs = getComputedStyle(frame)
        const left = f.left + parseFloat(fs.borderLeftWidth)
        const right = f.right - parseFloat(fs.borderRightWidth)
        if (ink.width > 0 && (ink.left - left < 4 || right - ink.right < 4)) {
          problems.push(`touches the edge of its box: "${text}"`)
        }
      }
    }
  }
  return [...new Set(problems)]
}
"""


def open_phone(browser: Browser, playwright: Playwright, language: str, width: int) -> Page:
    device = playwright.devices["Pixel 7"]
    context = browser.new_context(
        **{**device, "viewport": {"width": width, "height": 780}, "screen": {"width": width, "height": 780}},
        locale={"en": "en-IN", "hi": "hi-IN", "gu": "gu-IN"}[language],
    )
    context.add_init_script(f"localStorage.setItem('introchat.language', '{language}')")
    return context.new_page()


def settle(page: Page) -> None:
    # Measure only once the Devanagari and Gujarati fonts are in: before that
    # the text is in a fallback font with different widths.
    page.evaluate("document.fonts.ready.then(() => true)")
    page.wait_for_timeout(150)


@pytest.mark.parametrize("width", [WIDTH_POLISHED, WIDTH_SMALLEST])
@pytest.mark.parametrize("language", LANGUAGES)
def test_every_screen_fits_a_phone(browser: Browser, playwright: Playwright, language: str, width: int):
    page = open_phone(browser, playwright, language, width)
    page.goto(f"{BASE_URL}/dev/preview")
    controls = page.locator("[data-preview-controls]")
    # The preview is a lazy route: wait for it, or for the not-found page a
    # production build shows instead.
    page.locator("[data-preview-controls], h1").first.wait_for()
    if controls.count() == 0:
        pytest.skip("the dev preview exists only in `npm run dev`")

    shots = Path(__file__).parent / "layout-screenshots"
    shots.mkdir(parents=True, exist_ok=True)
    check_text = width == WIDTH_POLISHED
    found: list[str] = []

    def check(name: str) -> None:
        settle(page)
        for problem in page.evaluate(FIND_OVERFLOW, check_text):
            found.append(f"{name}: {problem}")
        if width == WIDTH_POLISHED:
            # Without the preview's own controls: the screen as a guest sees it.
            page.screenshot(
                path=str(shots / f"{language}-{name}.png"),
                full_page=True,
                style="[data-preview-controls] { display: none !important; }",
            )

    for screen, option, name in PREVIEW_STATES:
        # Dispatched, not clicked: the time-up popups cover the preview's own
        # controls the way they cover a guest's screen.
        controls.get_by_role("button", name=screen, exact=True).dispatch_event("click")
        if option is not None:
            controls.get_by_role("button", name=option, exact=True).dispatch_event("click")
        check(name)
        # The home screen's other tabs, by position (their names are translated).
        if name == "home":
            tabs = page.get_by_role("tab")
            for index, tab_name in [(1, "home-requests"), (2, "home-chats")]:
                tabs.nth(index).click()
                check(tab_name)
            tabs.nth(0).click()

    for path, name in ROUTES:
        page.goto(f"{BASE_URL}{path}")
        page.get_by_role("heading", level=1).first.wait_for()
        check(name)

    page.context.close()
    assert not found, f"{language} at {width}px:\n" + "\n".join(found)
