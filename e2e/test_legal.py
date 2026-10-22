"""
Milestone M8 legal pages: privacy, terms, refunds and contact are reachable
from the public home screen (Razorpay's merchant review checks this), open
directly from a link, and follow the chosen language. No login needed.
"""

import re

from playwright.sync_api import expect

from conftest import BASE_URL


def test_policies_are_reachable_from_home_and_by_direct_link(phone):
    page = phone()
    page.goto(f"{BASE_URL}/")
    policies = page.get_by_role("navigation", name="Policies")
    for link, heading in [
        ("Privacy", "Privacy policy"),
        ("Terms", "Terms of use"),
        ("Refunds", "Refund and cancellation policy"),
        ("Contact", "Contact and grievances"),
    ]:
        policies.get_by_role("link", name=link).click()
        expect(page.get_by_role("heading", level=1, name=heading)).to_be_visible()
        expect(page).to_have_title(re.compile(heading))
        page.go_back()

    # A link shared or printed elsewhere opens the page itself, not the home screen.
    page.goto(f"{BASE_URL}/contact")
    expect(page.get_by_role("region", name="Grievance Officer")).to_be_visible()


def test_policies_follow_the_chosen_language(phone):
    page = phone()
    page.goto(f"{BASE_URL}/privacy")
    expect(page.get_by_role("heading", level=1, name="Privacy policy")).to_be_visible()
    page.get_by_label("Language").select_option("gu")
    expect(page.get_by_role("heading", level=1, name="ગોપનીયતા નીતિ")).to_be_visible()
