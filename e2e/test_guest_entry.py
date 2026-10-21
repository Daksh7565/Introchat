"""
A guest's way in: QR landing, location, phone login, onboarding, joining,
and leaving. Milestones M1–M3 as a guest sees them.
"""

import re

from playwright.sync_api import expect

from conftest import (
    BASE_URL,
    OTP,
    OUTSIDE,
    PHONES,
    arrive,
    handle_shown,
    join,
    log_in,
    onboard,
    pick_tags,
)


def test_an_unknown_qr_code_is_explained(phone, venue):
    page = phone()
    page.goto(f"{BASE_URL}/v/no-such-venue/t/AAAAAAAAAAAAAAAA")
    expect(page.get_by_role("heading", name="This QR code is not active")).to_be_visible()
    page.goto(f"{BASE_URL}/v/{venue.slug}/t/AAAAAAAAAAAAAAAA")
    expect(page.get_by_role("heading", name="This table's QR code no longer works")).to_be_visible()


def test_a_guest_outside_the_venue_cannot_continue(phone, venue):
    page = phone(at=OUTSIDE)
    page.goto(venue.url)
    expect(page.get_by_role("heading", name=f"Welcome to {venue.name}")).to_be_visible()
    check = page.get_by_role("button", name="Check my location")
    outside = page.get_by_text(f"You don't seem to be at {venue.name}")
    expect(outside.or_(check)).to_be_visible()
    if check.is_visible():
        check.click()
    expect(outside).to_be_visible()
    expect(page.get_by_role("button", name="Continue")).to_be_disabled()


def test_login_refuses_a_bad_number_and_a_wrong_code(phone, venue):
    page = phone()
    arrive(page, venue)
    page.get_by_role("button", name="Continue").click()
    page.get_by_label("Mobile number").fill("12345")
    page.get_by_role("button", name="Send code").click()
    expect(page.get_by_text("Enter a 10-digit Indian mobile number.")).to_be_visible()

    page.get_by_label("Mobile number").fill(PHONES["login"])
    page.get_by_role("button", name="Send code").click()
    expect(page.get_by_text("We sent a 6-digit code to +91 90000 00014.")).to_be_visible()
    page.get_by_label("6-digit code").fill("000000")
    expect(page.get_by_text(re.compile("That code is wrong or has expired"))).to_be_visible()
    page.get_by_label("6-digit code").fill(OTP)
    expect(page.get_by_role("heading", name="Before you start")).to_be_visible()


def test_first_visit_onboarding_join_and_leave(phone, venue):
    page = phone()
    arrive(page, venue)
    log_in(page, PHONES["first_visit"])
    onboard(page)
    pick_tags(page, ("music", "ગરબા"))
    handle = handle_shown(page)
    expect(page.get_by_text("ગરબા")).to_be_visible()
    join(page, venue)

    expect(page.get_by_text(venue.name)).to_be_visible()
    expect(page.get_by_text("No one else is here yet. Check back in a few minutes.")).to_be_visible()

    # Reload: same session, same timer, no new login.
    page.goto(BASE_URL)
    expect(page.get_by_role("timer")).to_be_visible()

    page.get_by_role("button", name="Leave").click()
    page.get_by_role("button", name="Tap again to leave").click()
    expect(page.get_by_text("You logged out.")).to_be_visible()

    # Coming back: straight past onboarding to the same name.
    arrive(page, venue)
    page.get_by_role("button", name="Continue").click()
    assert handle_shown(page) == handle


def test_an_under_18_birth_year_is_refused_for_good(phone, venue):
    page = phone()
    arrive(page, venue)
    log_in(page, PHONES["minor"])
    onboard(page, birth_year="2012")
    expect(page.get_by_role("heading", name="Sorry, IntroChat is for adults only")).to_be_visible()

    # Reloading does not offer the birth year again.
    page.reload()
    arrive(page, venue)
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", name="Sorry, IntroChat is for adults only")).to_be_visible()
