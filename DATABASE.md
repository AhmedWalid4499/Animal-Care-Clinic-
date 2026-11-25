# Animal Care Clinic Patient Tracker — Database schema v1

Decided 3 Nov 2026. Same conventions as the software-house platform: **Postgres on Railway, Prisma, UUID primary keys, `created_at` / `updated_at` on every table, `status` / `type` as enums, soft-delete via `status` where listed (never hard-delete clinical data).** Money is `Decimal(10,2)` in EGP. Times are `timestamptz`.

## Core rule

```
owners 1 ──< pets 1 ──< visits 1 ──< prescriptions
                   │          └──< vaccinations
                   │          └──< attachments
                   └──< appointments
owners 1 ──< invoices 1 ──< invoice_items
                     └──< payments
users (clinic staff) ──< visits.vet_id, invoices.created_by
```

- An owner has many pets; **a pet belongs to exactly one owner** (`pets.owner_id` NOT NULL). Changing owner = update the FK; history stays with the pet.
- Clinical data (visits, vaccinations, prescriptions, attachments) hangs off **pets**.
- Money (invoices, payments) hangs off **owners**, optionally linked to a visit.
- The "patient" in clinic language = `pets`. The person = `owners`. UI labels can say whatever Dr. Waleed prefers; the schema keeps the distinction.

## Tables

| Table | Key columns | Rule |
|---|---|---|
| **users** | name, email (unique), password_hash, role `ADMIN \| DOCTOR \| ASSISTANT \| LAB` (v2; was `VET \| ASSISTANT`; LAB v24 = a lab doctor's lab-extranet account, never an app sign-in), lab_name? (v24), locale `en \| ar`, is_active, notify_off (v3), must_change_password (v4), roles? (v14: comma-separated list, e.g. `ADMIN,DOCTOR`; role = the highest) | Clinic staff logins only. One ADMIN minimum. A password set by the Admin is temporary: the person chooses their own at the next sign-in. |
| **owners** | full_name, phone (unique-ish, warn on dup), whatsapp, email, address, national_id?, notes, status `ACTIVE \| ARCHIVED`, portal_token? (v15), code (v16: customer ID `AC-00001`, unique, never changes; `TMP-…` on a linked device until the server numbers it) | The human client. Search index on full_name + phone + code. `portal_token` = the secret part of the owner page link / QR code (Phase 6); NULL = no page. |
| **pets** | owner_id → owners, name, species `DOG \| CAT \| BIRD \| RABBIT \| REPTILE \| HAMSTER \| TURTLE \| OTHER` (HAMSTER, TURTLE: v23), breed, sex `MALE \| FEMALE \| UNKNOWN`, is_neutered, date_of_birth, dob_is_estimate, color, eye_color? (v21: `DARK_BROWN \| BROWN \| AMBER \| HAZEL \| GOLD \| COPPER \| GREEN \| BLUE \| ODD`), microchip_no (unique nullable), photo_url, status `ACTIVE \| DECEASED \| TRANSFERRED`, deceased_at, notes, alert_flags (comma-separated `AGGRESSIVE \| ALLERGY \| INFECTIOUS \| DIABETIC \| HEART \| EPILEPSY \| OTHER`), alert_note, recall_sent_at (v9: last WhatsApp check-up reminder), tag_token? (v18: secret of the collar tag QR) | One owner per pet. Age computed from DOB at read time. Alerts (schema v6) show wherever the pet is handled. |
| **visits** | pet_id → pets, vet_id → users, visited_at, type `CHECKUP \| VACCINATION \| SURGERY \| EMERGENCY \| FOLLOW_UP \| OTHER`, complaint, weight_kg, temperature_c, diagnosis, treatment_notes, follow_up_at, invoice_id? → invoices; pre-diagnosis (v4): stage `WAITING \| WITH_VET \| DONE` (default DONE), urgency `ROUTINE \| SOON \| EMERGENCY`, history, heart_rate, resp_rate, intake_notes, intake_by → users, intake_at; physical examination (v19): bp_systolic, bp_diastolic (mmHg), mucous_membrane `PALE \| PINK \| RED \| CONGESTED`, eyes, skin_coat, glands `NORMAL \| ENLARGED`, glands_note, anal_glands `EMPTY \| FULL`, nails `OK \| NEEDS_TRIM`, fleas_ticks `NO \| YES` (NULL = not examined; checked by the app, not CHECK) | The clinical event. Weight chart = `weight_kg` over `visited_at`. A visit can start as a pre-diagnosis by a Doctor (WAITING, in the vet's queue), be taken by the vet (WITH_VET) and completed as the same visit (DONE). |
| **prescriptions** | visit_id → visits, drug, dose, frequency, duration_days, instructions | Free text in v1; no drug catalogue. |
| **vaccine_types** | name, species (array of species enum), interval_days, is_active | Catalogue edited in Settings. e.g. Rabies / DOG,CAT / 365. |
| **vaccinations** | pet_id → pets, visit_id? → visits, vaccine_type_id → vaccine_types, administered_at, next_due_at, batch_no, reminder_sent_at | `next_due_at` defaults to `administered_at + interval_days`; vet may override. Dashboard = `next_due_at` within 7 days and no newer vaccination of same type. |
| **appointments** | pet_id? → pets, owner_id? → owners, scheduled_at, duration_min (default 20), type (same enum as visits), status `REQUESTED \| SCHEDULED \| DONE \| NO_SHOW \| CANCELLED`, notes, visit_id? → visits, reminder_sent_at | Marking DONE opens a new visit pre-filled. Warn on overlap. **Guest** (v25, change request): pet_id/owner_id empty, `guest_name`, `guest_phone`, `guest_pet_name`, `guest_species`, `source` `CLINIC \| ONLINE`; registered on arrival (owner + pet created, or the owner with the same phone reused); may be hard-deleted. `REQUESTED` = from the public page `/book`, waiting for staff to accept (→ SCHEDULED) or decline (→ deleted). |
| **attachments** | pet_id → pets, visit_id? → visits, kind `LAB \| XRAY \| PHOTO \| DOCUMENT \| OTHER`, file_url, file_name, mime_type, size_bytes, uploaded_by → users | Stored on Railway volume or S3-compatible bucket; app only stores the URL. |
| **pet_chart_marks** (v21) | pet_id → pets, chart `DENTAL \| VISION \| BODY` (BODY: v23; part = a body part such as `CHEST`, `FORELEG_R`, `CARAPACE`, `WING_L`, `SKIN`, `CONDITION`, `NOTES`), part (Triadan tooth no. e.g. `108`/`504`, `PALATE`/`GUM_UPPER`/`GUM_LOWER`/`TONGUE`/`MOUTH`, or `OD\|OS.<EYELIDS\|THIRD_EYELID\|CONJUNCTIVA\|CORNEA\|IRIS\|PUPIL\|LENS\|GLOBE>`/`EYES`), conditions (comma-separated), severity 1–3, shade, notes, updated_by → users | The vet's current finding per part (Dental / Vision tabs, change request 19 Nov). Unique (pet, chart, part); id = `<pet_id>:<chart>:<part>`. Never deleted: back to normal = empty conditions. History is in `audit_log`. |
| **price_items** | name_en, name_ar, category `CONSULTATION \| VACCINE \| SURGERY \| MEDICATION \| BOARDING \| GROOMING \| OTHER`, unit_price, is_active, track_stock (v8), low_stock? (v8) | Clinic price list, edited in Settings. `track_stock` = count this item in Stock; `low_stock` = warn at or below (empty = at 0). |
| **invoices** | owner_id → owners, pet_id? → pets, visit_id? → visits, number (sequential, e.g. INV-2026-0001), issued_at, subtotal, discount, total, status `UNPAID \| PARTIAL \| PAID \| VOID`, created_by → users, notes | Totals recomputed from items. `status` derived from payments. |
| **invoice_items** | invoice_id → invoices, price_item_id? → price_items, description, qty, unit_price, line_total | Copy name and price at creation (price list may change later). |
| **payments** | invoice_id → invoices, amount, method `CASH \| INSTAPAY \| CARD \| OTHER`, paid_at, received_by → users, reference | Sum of payments vs total → invoice status. |
| **drugs** (v7) | name, dose_mg_kg, concentration (mg per unit), unit `ml \| tablet \| capsule \| mg`, max_mg, frequency, duration_days, species (comma-separated, empty = all), notes, is_active, stock_qty?, stock_unit?, low_stock? (v13: count kept by the Admin) | The clinic's own list for the dose calculator; Admin only. The app only does the arithmetic. |
| **treatment_templates** (v7) | name, diagnosis, treatment_notes, prescriptions (JSON: drug, dose, frequency, duration_days, instructions), is_active, created_by → users, owner_note (v13: short "how to use" printed for the owner) | Fills a visit in one tap; blank doses of listed drugs are worked out from the pet's weight. Admins and Doctors. |
| **stock_moves** (v8) | price_item_id → price_items, qty (+ in / − out), reason `RESTOCK \| INVOICE \| ADJUST`, invoice_id? → invoices, note, user_id → users, at, batch_no? (v10), expires_at? (v10) | Append-only log; on hand = Σ qty. Saving an invoice adds one INVOICE move per tracked item for the difference to what it already took (editing or voiding gives back). Restock and count corrections (ADJUST = counted − on hand) are Admin only. |
| **expenses** (v10) | spent_at (local date), category `RENT \| SALARIES \| SUPPLIES \| UTILITIES \| EQUIPMENT \| MAINTENANCE \| MARKETING \| OTHER`, amount (piastres), method, payee, note, user_id → users, status `ACTIVE \| VOID` | The clinic's own spending, Admin only. Voided, never deleted. Monthly profit = payments collected − active expenses. |
| **lab_results** (v11) | pet_id → pets, visit_id? → visits, taken_at (date), panel, analyte, value (number) or value_text, unit, ref_low, ref_high, note, user_id → users | One row per result value with the reference range used, so values can be flagged and charted. Admin + Doctor. attachment_id? and request_id? (v24): the scanned report and the request, when the lab sent it from the lab extranet. |
| **consents** (v11) | pet_id → pets, visit_id? → visits, procedure, anaesthesia, estimate? (piastres), notes, signer_name, signature (PNG data URL), signed_at, user_id → users | Signed consent form. Append-only: never changed after signing. |
| **admissions** (v12) | pet_id → pets, visit_id? → visits, admitted_at, reason, cage, vet_id → users, status `IN \| OUT`, discharged_at, discharge_note, user_id → users | A pet staying in the clinic (in-patient board). Admin + Doctor. |
| **care_tasks** (v12) | admission_id → admissions, task, due_at, status `DUE \| DONE \| SKIPPED`, done_at, done_by → users, note | One row per treatment time (a repeating treatment is expanded when added). Assistants may only tick. |
| **clinic_settings** | single row: name_en, name_ar, logo_url, phone, whatsapp, address, currency (EGP), locale_default, receipt_footer, online_booking (v25, 0/1: the public booking page) | Loaded once per request. |
| **test_requests** (v17) | pet_id → pets, visit_id?, kind `XRAY \| LAB`, items (ticked keys, comma-separated), other, notes, status `REQUESTED \| DONE \| CANCELLED`, requested_by → users, requested_at | X-ray and lab requests given to the owner; never deleted. Lab test keys: `src/lib/lab-tests.json`. Shown on the owner page (not cancelled ones). |
| **found_reports** (v18) | pet_id → pets, owner_id?, reported_at, lat?, lng?, accuracy_m?, finder_name?, finder_phone?, message?, status `NEW \| HANDLED`, handled_by → users, handled_at | Written only by the clinic server when someone presses Alert on a collar tag page; devices may only mark it handled. Never deleted. |
| **package_types** (v22) | name, species? (comma-separated, empty = any), price (piastres), valid_days?, items (JSON: key, label, qty, vaccine_type_id?), notes, is_active | Prepaid packages the clinic sells (e.g. puppy package). Admin only. |
| **pet_packages** (v22) | pet_id → pets, owner_id → owners, package_type_id?, name, items (JSON copied at sale), price, started_at, expires_at?, invoice_id → invoices, status `ACTIVE \| CANCELLED`, sold_by → users, notes | A package sold to a pet, with the invoice made for its price. Anyone sells; only an Admin cancels. Never deleted. |
| **package_uses** (v22) | pet_package_id → pet_packages, item_key, visit_id?, used_at, user_id → users, note, status `ACTIVE \| VOID` | One session used. Left per line = qty − active uses. Append-only; VOID (Doctor/Admin) gives it back. |
| **suppliers** (v22) | name, phone, notes, is_active | Who the clinic buys from. Admin only. |
| **purchases** (v22) | supplier_id → suppliers, purchased_at (local date), reference (their invoice no.), total, notes, status `ACTIVE \| VOID`, user_id → users | One delivery. Owed to a supplier = Σ active purchases − Σ active payments. Voided, never deleted. |
| **purchase_items** (v22) | purchase_id → purchases, price_item_id?, description, qty, unit_cost, line_total, batch_no?, expires_at? | Replaced when the purchase is edited (like invoice_items). A line for a tracked price item restocks it: RESTOCK `stock_moves` with `purchase_id`, reconciled on every save and void. |
| **supplier_payments** (v22) | supplier_id → suppliers, purchase_id?, paid_at (local date), amount, method, reference, note, status `ACTIVE \| VOID`, user_id → users | Money paid to a supplier; counted as money spent in the monthly report. |
| **wa_messages** (v22) | kind `VACCINE \| APPOINTMENT \| TEST`, owner_id?, pet_id?, ref_id (vaccination / appointment), phone, template, status `SENT \| FAILED \| SKIPPED`, error, wa_id, sent_at | Automatic WhatsApp log, written only by the clinic server (`server/whatsapp.mjs`); devices read it. Also v22: `owners.wa_opt_out`, `clinic_settings.wa_auto / wa_auto_kinds / wa_auto_hour`, `stock_moves.purchase_id`. |
| **audit_log** | user_id, table_name, record_id, action `CREATE \| UPDATE \| DELETE \| LOGIN`, diff (jsonb), at | Who changed what. Append-only. |

## Indexes worth creating on day one
- `owners (full_name)`, `owners (phone)` — search
- `pets (owner_id)`, `pets (name)`, `pets (microchip_no)` unique
- `visits (pet_id, visited_at desc)`
- `vaccinations (next_due_at)` and `(pet_id, vaccine_type_id, administered_at desc)`
- `appointments (scheduled_at)`
- `invoices (owner_id, status)`, `invoices (number)` unique

## Derived values (compute, don't store)
- Pet age ← `date_of_birth`
- Owner balance ← Σ invoices.total − Σ payments.amount where status ≠ VOID
- Vaccination "due" ← latest vaccination per (pet, vaccine_type) whose `next_due_at` ≤ today + 7 days
- Invoice status ← payments sum (store it, but recompute on every payment write)

## Deliberately out of v1
Owner logins / portal, full inventory (a simple stock count was added in v8, batches and expiry in v10, suppliers and purchases in v22, by change request), multi-branch (`clinic_id` on every table), lab-result structured data, SMS delivery (WhatsApp Business API reminders were added in v22 by change request), boarding kennels. Each is a v2 table that attaches to this schema without changing it.

## Seed data (migration `0001_seed`)
- One VET user (Dr. Waleed), one ASSISTANT
- `vaccine_types`: Rabies (DOG, CAT, 365) · DHPP (DOG, 365; puppies 21-day series handled manually) · FVRCP (CAT, 365) · FeLV (CAT, 365) · Deworming (DOG, CAT, 90) · Flea/tick (DOG, CAT, 30) — **Dr. Waleed to confirm/replace at scoping call**
- `price_items`: Consultation, Vaccine administration, Deworming, Nail trim, Surgery (minor), Surgery (major), Boarding/night, Medication — prices TBD
- `clinic_settings`: placeholders

Prisma source: `prisma/schema.prisma`. Mirrored in `CLAUDE.md`.

## Server-only tables (lab extranet, v24)
- `lab_sessions` (Postgres on the clinic server, not synced): token_hash, clinic_id, user_id, pw (fingerprint of the password hash at sign-in), created_at, last_seen. A lab doctor's browser session for `/lab`; ends on a new password, a reset, deactivation or 12 h idle.
