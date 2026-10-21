# M0 Phase 7 — SMS gateway test

**Why:** V1 sends login OTPs from a dedicated SIM through the *SMS Gateway for
Android* app (decision 16). Before M2 depends on it, we prove that SMS from that
SIM reaches **Jio, Airtel, Vi and BSNL** numbers quickly, and we learn how the
gateway reports delivery.

**Done when:** every operator shows `Delivered` (or the recipient confirms
arrival) within **30 seconds**.

## Things to know first

- **Use the dedicated SIM, never a personal number.** Automated SMS from a
  personal plan can get the number blocked by the operator.
- **Cloud mode relays each SMS through the app maker's server**
  (`api.sms-gate.app`), so OTP text passes through a third party. Acceptable for
  the pilot per decision 16; Twilio replaces it later.
- **Daily limit:** most plans allow ~100 SMS/day. This test uses 4–10.

## 1. Set up the gateway phone (once)

1. Insert the dedicated SIM in the spare Android phone.
2. Install **SMS Gateway for Android** (Play Store, or the APK from
   github.com/capcom6/android-sms-gateway releases).
3. Open it → allow **SMS** permission → turn off **battery optimisation** for the
   app (Android settings → Apps → SMS Gateway → Battery → Unrestricted), or Android
   will stop it in the background.
4. In the app: **Settings → Cloud server** → enable → **Online** on the home
   screen. The **username and password** appear in the Cloud server section.
   Keep them in your password manager. Don't send them to anyone, including me.

## 2. Run the test from the laptop

Have 4 people (or 4 of your own SIMs) on **Jio, Airtel, Vi and BSNL** ready.

```powershell
cd c:\Users\Dell\Desktop\Project\IntroChat
powershell -ExecutionPolicy Bypass -File tools\sms-check\send-test.ps1
```

It asks for the gateway username and password (typed, not saved) and the
numbers as `Jio=+91...,Airtel=+91...,Vi=+91...,BSNL=+91...`, sends one test
code to each, then waits up to 3 minutes for delivery reports.

It prints a table and saves it to `documents\field-tests\raw\` with numbers
masked to the last 4 digits.

## 3. Send me the table

Copy the printed table here. If any row says *No delivery report*, ask that
person what time the SMS arrived. Some operators do not send delivery reports
even when the SMS arrives.

## If something fails

| Symptom | Likely cause |
|---|---|
| `401` on send | Wrong username/password, or cloud mode not enabled |
| Stuck at `Pending` | Gateway phone offline or app stopped: open it, check *Online*, check battery optimisation |
| `Failed` | SIM has no SMS balance, the number is wrong, or the operator blocked it |
| Arrives after 30+ seconds | Note which operator: this decides whether the SIM is good enough for the pilot |
