"""
Milestone M6 as guests see it: one guest reports another from their chat
after the other has left (read-only), the report keeps the chat as evidence,
and the two can no longer see each other.
"""

from playwright.sync_api import expect

from conftest import PHONES, arrive, guest_joins, handle_shown, join, sql


def test_a_report_from_a_read_only_chat_keeps_the_evidence_and_blocks(phone, venue):
    reporter, reported = phone(), phone()
    guest_joins(reporter, venue, PHONES["reporter"], tags=("music",))
    reported_handle = guest_joins(reported, venue, PHONES["reported"], tags=("music",))

    # They meet and chat.
    reporter.get_by_role("button", name="Say hi").click()
    reported.get_by_role("tab", name="Requests").click()
    reported.get_by_role("button", name="Accept").click()
    reported.get_by_placeholder("Type a message").fill("an abusive message")
    reported.keyboard.press("Enter")
    reporter.get_by_role("button", name="Open chat").click()
    expect(reporter.get_by_text("an abusive message")).to_be_visible()

    # The other guest leaves: the chat stays readable, read-only, and reportable.
    reported.get_by_role("button", name="Back").click()
    reported.get_by_role("button", name="Leave").click()
    reported.get_by_role("button", name="Tap again to leave").click()
    expect(reporter.get_by_text(f"{reported_handle} has left. You can still read and report this chat.")).to_be_visible()

    reporter.get_by_role("button", name="More options").click()
    reporter.get_by_role("button", name="Report").click()
    reporter.get_by_label("Harassment or threats").check()
    reporter.get_by_label("Anything we should know? (optional)").fill("Abusive in chat")
    reporter.get_by_role("button", name="Report and block").click()
    expect(reporter.get_by_text("Thank you. Our team will review it", exact=False)).to_be_visible()

    # The report holds the chat, though the reported guest had left.
    rows = sql(
        "select r.evidence -> 'messages' -> -1 ->> 'body' as last_body, r.note "
        f"from public.reports r join public.venues v on v.id = r.venue_id where v.slug = '{venue.slug}'"
    )
    assert rows == [{"last_body": "an abusive message", "note": "Abusive in chat"}]

    # Invisible both ways: the reported guest comes back (still logged in on
    # this phone) and neither sees the other.
    arrive(reported, venue)
    reported.get_by_role("button", name="Continue").click()
    assert handle_shown(reported) == reported_handle
    join(reported, venue)
    expect(reported.get_by_text("No one else is here yet. Check back in a few minutes.")).to_be_visible()
    expect(reporter.get_by_text(reported_handle)).to_be_hidden()

    for page in (reporter, reported):
        page.get_by_role("button", name="Leave").click()
        page.get_by_role("button", name="Tap again to leave").click()
        expect(page.get_by_text("You logged out.")).to_be_visible()
