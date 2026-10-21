"""
Two guests at the same venue: people list, request → accept, live chat with
emoji and Indian scripts, seen ticks, the notification offer, and the chat
turning read-only when one leaves. Milestone M4 as guests see it.
"""

from playwright.sync_api import expect

from conftest import PHONES, guest_joins


def test_two_guests_meet_and_chat(phone, venue):
    asha, ravi = phone(), phone()
    asha_handle = guest_joins(asha, venue, PHONES["asha"], tags=("music", "cricket"))
    ravi_handle = guest_joins(ravi, venue, PHONES["ravi"], tags=("music",))

    # Each sees the other, live, with the interest they share.
    expect(asha.get_by_text(ravi_handle)).to_be_visible()
    expect(ravi.get_by_text(asha_handle)).to_be_visible()

    # Asha says hi; Ravi is told at once and accepts from the Requests tab.
    asha.get_by_role("button", name="Say hi").click()
    expect(asha.get_by_role("button", name="Request sent").or_(asha.get_by_text("Request sent"))).to_be_visible()
    ravi.get_by_role("tab", name="Requests").click()
    expect(ravi.get_by_text(asha_handle)).to_be_visible()
    ravi.get_by_role("button", name="Accept").click()

    # After the first request, notifications are offered, unless this browser
    # already blocks them (headless Chromium reports "denied"; a real phone
    # starts at "default"). Either way the app must do the right thing.
    offer = asha.get_by_text("Get notified when someone replies")
    if asha.evaluate("Notification.permission") == "default":
        expect(offer).to_be_visible()
        asha.get_by_role("button", name="Not now").click()
    expect(offer).to_be_hidden()

    # Accepting opens the chat for Ravi; Asha opens it from her People tab.
    expect(ravi.get_by_placeholder("Type a message")).to_be_visible()
    asha.get_by_role("button", name="Open chat").click()
    message = "Hello 👋 नमस्ते કેમ છો"
    asha.get_by_placeholder("Type a message").fill(message)
    asha.keyboard.press("Enter")

    # Delivered live, intact; Ravi has it open, so Asha sees "Seen".
    expect(ravi.get_by_text(message)).to_be_visible()
    expect(asha.get_by_text("Seen")).to_be_visible()

    ravi.get_by_placeholder("Type a message").fill("Hi Asha!")
    ravi.keyboard.press("Enter")
    expect(asha.get_by_text("Hi Asha!")).to_be_visible()

    # Ravi leaves: Asha can still read, but no longer write.
    ravi.get_by_role("button", name="Back").click()
    ravi.get_by_role("button", name="Leave").click()
    ravi.get_by_role("button", name="Tap again to leave").click()
    expect(ravi.get_by_text("You logged out.")).to_be_visible()
    expect(asha.get_by_text(f"{ravi_handle} has left. You can still read and report this chat.")).to_be_visible()
    expect(asha.get_by_placeholder("Type a message")).to_be_hidden()

    # Asha leaves too, so later tests find the venue empty.
    asha.get_by_role("button", name="Back").click()
    asha.get_by_role("button", name="Leave").click()
    asha.get_by_role("button", name="Tap again to leave").click()
    expect(asha.get_by_text("You logged out.")).to_be_visible()
