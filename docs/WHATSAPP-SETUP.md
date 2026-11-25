# Automatic WhatsApp reminders — setup

Change request, 16 Nov 2026 (SCOPE §5: "Automatic WhatsApp / SMS sending (Business API) — add-on: integration from 5,000 EGP").
Confirm with Dr. Waleed before switching it on: WhatsApp charges per message.

The clinic server (`server/whatsapp.mjs`) sends the reminders itself, once a day, through Meta's **WhatsApp Business
Cloud API**. Nothing is sent until the steps below are done **and** an Admin ticks *Send reminders automatically* in
Settings → WhatsApp. Until then, the WhatsApp buttons work as before (click-to-chat).

## What it sends

| Reminder | When | Once? |
|---|---|---|
| Vaccination | The latest dose of each vaccine per pet, next dose due from 14 days ago to 7 days ahead | Yes: stamps `vaccinations.reminder_sent_at` (same as the button) |
| Appointment | Scheduled appointments tomorrow (clinic time) | Yes: stamps `appointments.reminder_sent_at` |

- Once a day per clinic, from the hour chosen in Settings (default 10:00) until 21:00 Cairo time. A server that starts
  later than 21:00 waits for the next day.
- Active pets and owners only. Owners with **No automatic WhatsApp reminders** ticked (owner form) are left out.
- Number: the owner's WhatsApp number, else their phone (010… becomes 2010…).
- Every message sent or failed is listed in Settings → WhatsApp (`wa_messages`, synced to every device). A failed one is tried
  again the next day.

## 1. Meta Business and the clinic number (once, about an hour)

1. <https://business.facebook.com> → create (or use) the clinic's business portfolio. Business verification (commercial
   register or tax card) raises the sending limit; without it Meta allows 250 conversations a day, which is plenty.
2. <https://developers.facebook.com> → *Create app* → type **Business** → add the **WhatsApp** product.
3. WhatsApp → *API Setup* → **Add phone number**. Use a number that is **not** registered on the WhatsApp phone app
   (or remove it from the app first: a number can be on the app or on the API, not both). Verify it by SMS.
4. Copy the **Phone number ID** (not the phone number).
5. Business settings → *Users → System users* → add a system user (Admin) → *Assign assets*: the app (full control) and the
   WhatsApp account → *Generate token* with `whatsapp_business_messaging` and `whatsapp_business_management`, expiry
   **Never**. Copy the token: it is shown once.
6. WhatsApp Manager → *Payment settings*: add a card. (Meta's price per message for Egypt applies; utility templates are
   the cheap category.)

## 2. Message templates (Meta must approve them, usually within minutes)

WhatsApp Manager → *Message templates* → *Create template* → category **Utility**, language **Arabic** (and/or English).
The names and the order of the `{{n}}` parameters must be exactly these:

**`vaccine_reminder`**: {{1}} owner name · {{2}} pet name · {{3}} vaccine · {{4}} due date · {{5}} clinic name

> مرحبًا {{1}}، معكم {{5}}. تذكير: موعد تطعيم {{3}} لـ {{2}} يوم {{4}}. ردّ على هذه الرسالة لحجز موعد.

> Hello {{1}}, this is {{5}}. Reminder: {{2}}'s {{3}} vaccine is due on {{4}}. Reply to this message to book a time.

**`appointment_reminder`**: {{1}} owner name · {{2}} pet name · {{3}} date · {{4}} time · {{5}} clinic name

> مرحبًا {{1}}، معكم {{5}}. نذكّركم بموعد {{2}} يوم {{3}} الساعة {{4}}. ردّ على هذه الرسالة إذا أردت تغييره.

> Hello {{1}}, this is {{5}}. A reminder of {{2}}'s appointment on {{3}} at {{4}}. Reply to this message if you need to change it.

Meta asks for an example value per parameter when you submit: e.g. *Mona*, *Luna*, *Rabies*, *12 Nov 2026*, *Animal Care Clinic*.

## 3. Railway (the clinic server)

Railway → the clinic server service → **Variables**:

| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | the system user token (step 1.5) |
| `WHATSAPP_PHONE_NUMBER_ID` | the phone number ID (step 1.4) |
| `WHATSAPP_DISPLAY_NUMBER` | optional, shown in Settings, e.g. `+20 122 700 7428` |
| `WHATSAPP_TEMPLATE_LANG` | `ar` (default) or `en` — the template language you created |
| `WHATSAPP_TEMPLATE_VACCINE` | only if you named it differently (default `vaccine_reminder`) |
| `WHATSAPP_TEMPLATE_APPOINTMENT` | only if you named it differently (default `appointment_reminder`) |

Railway redeploys by itself. Never put the token in the repository or in the app: it only lives on Railway.

## 4. Switch it on

1. An Admin opens Settings → **WhatsApp**: it now says *Set up: sending from …*.
2. **Send a test** to your own number: Meta's `hello_world` template arrives (English). If it fails, the log shows Meta's reason.
3. Tick **Send reminders automatically**, choose what to send and from which hour.
4. Optional: **Send due reminders now** sends what is due today straight away (still never twice).

## Not included

- Replies: owners reply in the WhatsApp Business app or WhatsApp Manager inbox, not in the clinic app.
- Delivery / read receipts (they need a public webhook): the log shows *Sent* when Meta accepted the message.
- Invoice balance and check-up recall messages: still sent by hand with the WhatsApp buttons.
