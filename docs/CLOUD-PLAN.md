# Cloud plan — shared, live, offline-capable

Status, 5 Nov 2026:
- **Phase 1 live** at `https://animal-care-clinic-production.up.railway.app`; the first laptop syncs.
- **Phase 3 (notifications) built and tested locally.** `scripts/sync-test.mjs` passes 18/18 against Postgres 16 with two desktop apps and a fake phone push service; results are in `docs/acceptance/SYNC-TEST.md`.
- **Phase 5 built and tested locally** (devices, temporary passwords / reset / invite, pre-diagnosis queue): `scripts/sync-test.mjs` passes 23/23.
- **Phase 2 (offline) built and tested locally:** `scripts/sync-test.mjs` passes 31/31, including two laptops working with the server unreachable and ending identical.
- **Phase 4 built and tested locally:** files on the volume, nightly backup (volume + off-site bucket) with a tested restore, phone install, live check. `scripts/sync-test.mjs` passes 35/35. Ahmed's part: the R2 bucket and the live-check secrets (`docs/RAILWAY-SETUP.md`).
- **Phase 6 built and tested locally** (14 Nov): the owner page (QR code) and the prescription archive; see **Phase 6** below.
- Open points are at the end.

## What Ahmed asked for

| Need (Ahmed's words, 4 Nov) | What it means for the design |
|---|---|
| "The vet finishes with the patient, the assistant books the next appointment, and it shows on the doctor's profile. The secretary sees it too, can update it, and the others are notified." | One shared set of records for every login, changes reach the other devices in seconds, and an in-app notification says who changed what. |
| Hosting: Railway, on Ahmed's own account | One Railway project under Ahmed's account (Hobby plan). SCOPE §4 and §8 say Dr. Waleed owns the hosting account, so record this as a change. A Railway project can be handed over to his account later. |
| Must fully work offline | Every device keeps a full local copy and works with no internet. Changes queue up and sync when the connection is back. |
| Free Railway address | `https://<name>.up.railway.app`. It has HTTPS, which the phone install needs. A real domain can be added later without code changes. |

## Decisions (Ahmed, 4 Nov)

| Question | Answer | Effect |
|---|---|---|
| Assistant doctor | **Add a Doctor role** | Three clinic roles; see "Roles and the Admin account" below |
| Notifications | **Also when the app is closed** | Desktop app keeps running in the tray, plus Web Push for browsers and phones; see "Notifications" |
| Devices | **Three laptops now, built to scale** | An Admin adds and removes users in the app. The server is built for many clinics from day one |
| Hosting | **Railway, Ahmed's own paid account** | Setup steps in `docs/RAILWAY-SETUP.md` |
| Offline | **Must fully work offline** | Local-first sync (below) |
| Address | **Free Railway address** | `https://<name>.up.railway.app` |

## The design in one picture

```
 Clinic PC (desktop app)     Phone (installed web app)     Laptop browser
 ┌───────────────────┐       ┌───────────────────┐         ┌──────────────┐
 │ same React screens│       │ same React screens│         │ same screens │
 │ local SQLite file │       │ SQLite in browser │         │ SQLite in    │
 │ + change queue    │       │ + change queue    │         │ browser      │
 └────────┬──────────┘       └────────┬──────────┘         └──────┬───────┘
          │   push my changes · pull everyone's changes · live "something changed" ping
          └──────────────────────┬─────┴──────────────────────────┘
                     ┌───────────▼────────────┐
                     │ Railway: sync server   │  checks every change against the user's role,
                     │ (Node) + Postgres      │  stores it, numbers invoices, sends live pings
                     │ + volume for files     │  and notifications, nightly backup off-site
                     └────────────────────────┘
```

**Why local-first:** the app already runs every screen on a local SQLite database (`src/db/repo.ts`, synchronous). That is exactly what offline needs. We keep it and add sync around it instead of rewriting the screens against a remote API. The screens, the business rules and the acceptance tests stay. The phone gets the same app as an installable web app (PWA) with the database kept in the browser, as the prototype already does.

## How sync works

1. **Every write becomes a change record.** `tx()` in `src/db/core.ts` already funnels every write and appends to `audit_log`. Each change also goes into a local `outbox`: table, row id, the changed columns with new values, user, device, time.
2. **Push:** when online, the device sends its outbox to `POST /sync/push`. The server checks each change against the user's role (an assistant can't write visits or settings), stores it in Postgres with a server sequence number, and answers with what it accepted.
3. **Pull:** the device asks `GET /sync/pull?since=<last seq>` and applies everyone else's changes to its local database. The screens refresh themselves, because `useQuery` already re-runs after every database change.
4. **Live:** each device keeps a WebSocket open. When a change lands, the server pings the others, so they pull within a second or two. With no connection, the device retries in the background and pulls as soon as it's back.
5. **First start on a new device:** after login it downloads a full snapshot, then syncs from there.

### Two people editing the same record

- **Different fields** (the assistant changes an appointment's time, the vet adds a note): both changes are kept. Merging is per column, not per row.
- **Same field:** the later change wins. The audit log keeps the earlier value, and the person whose edit was replaced gets a notification ("Reception changed Luna's appointment time to 17:20").
- **Nothing is ever deleted:** this is already a data rule (status, not delete). Sync never has to settle a "deleted here, edited there" conflict, except for prescriptions and invoice lines, which are replaced as a whole list with their visit or invoice.
- **Double booking while offline:** two devices book the same slot with no internet. Both bookings are kept, and after sync both users are told about the overlap. Today's overlap warning still runs on each device.

### Things that must be decided by the server

| Item | Why | Plan |
|---|---|---|
| Invoice numbers (`INV-2026-0001`) | Two offline devices would both create `0001` | Offline invoices get a temporary number (`INV-2026-T-<device>-<n>`). The server gives the real sequential number on first sync; receipts printed offline say "temporary number". |
| Invoice totals and status | Payments can arrive from two devices | The server recomputes subtotal, total and status from the synced lines and payments, using the existing `recomputeInvoice` logic. |
| Logins and roles | Can't trust the device | The server checks the password and role on every push. Offline login works only for someone who has signed in on that device before (bcrypt hash cached locally). A new user's first login needs internet. |

## Roles and the Admin account

| Role | Who | Can |
|---|---|---|
| **Admin** | Dr. Waleed (and Ahmed for support) | Everything: users, clinic settings, prices, vaccines, export/backup, archive owners, void invoices, plus all Doctor rights |
| **Doctor** (new) | Assistant doctor | Record and edit visits, prescriptions and vaccinations; owners, pets, appointments, invoices, payments. No settings, users, archive or void |
| **Assistant** | Reception / secretary | Owners, pets, appointments, invoices, payments; read visits. No settings, users, archive, void or visit edits |

- **Users:** the Admin adds users in **Settings → Users**: name, email, role and a temporary password. The user changes it at first sign-in. Disabling a user signs them out on every device at the next sync.
- **Upgrade:** today's `VET` users become `ADMIN`, and the role checks move from the screens to the server. A device can't grant itself rights.
- **First Admin:** created from Railway variables on the server's first start (`docs/RAILWAY-SETUP.md`, Stage 2).
- **More clinics later:** every server table carries a `clinic_id` from day one. A platform owner account (Yuto Software House) can create a new clinic and its first Admin without a new deployment. Each clinic only ever sees its own data. One clinic today; adding more later is a setting, not a rebuild.

### Notifications

Notifications reach people even when the app is closed:

| Device | App open | App closed |
|---|---|---|
| Laptop, desktop app | Bell + toast | Closing the window **keeps the app running in the tray** (system tray / menu bar). It starts when the laptop starts, keeps syncing, and shows Windows/Mac system notifications. "Quit" in the tray menu really stops it |
| Phone or browser (installed web app) | Bell + toast | **Web Push**: the server sends a push through the browser's push service; the phone shows it even when the app is closed (Android Chrome; iPhone when the app is added to the Home Screen) |
| Laptop or phone switched off or asleep | — | Nothing can arrive. Notifications wait on the server and show at the next sync, newest first |

- **Bell:** a list in the header ("Reception booked Max for Thu 10:00"); read/unread is kept per user and synced.
- **Triggers:** someone else books, moves, cancels or marks no-show an appointment; a visit is recorded for a pet with an appointment today; a payment is recorded; something you edited was overwritten. Each user can turn kinds off in the bell panel.

How Phase 3 is built:

| Piece | File | Notes |
|---|---|---|
| What becomes a notification | `server/notify.mjs` | Runs inside the same transaction as the accepted changes (`server/sync.mjs`). Never to the person who did it. Stored per user in `notifications`; text in the reader's language. |
| Delivery | `server/index.mjs` | A WebSocket ping to that user's open apps (bell + toast within a second), and Web Push (VAPID keys made once and kept in `server_meta`) to their browsers/phones. Dead push subscriptions (404/410) are dropped. |
| Bell | `src/components/Notifications.tsx`, `src/sync/notify.ts` | Unread count, list, mark read, per-kind on/off (`users.notify_off`, schema v3; the server lets each person change only that on their own row). |
| Desktop tray | `electron/main.cjs` | Closing the window hides it to the tray; "Quit" in the tray menu stops it. Starts with Windows/Mac, hidden (installed app only). A system notification opens the right screen. On by default; switch in the bell panel. A linked laptop stays signed in across restarts so it can notify straight after start-up. |
| Phone / browser | `public-cloud/sw.js`, `manifest.webmanifest` | Service worker for push while the app is closed; installable web app. |
- **Wording:** in the reader's language (AR/EN), with the pet and owner name, and who did it.

## How Phase 1 is built

| Piece | File | Notes |
|---|---|---|
| Change capture | `src/sync/local.ts` | SQLite triggers on every synced table write the old and new row into `sync_outbox`. They are off until the device joins a clinic, and off while server rows are applied. |
| Sync engine | `src/sync/engine.ts` | Online sign-in, first link (upload to an empty clinic, or download), push then pull, a WebSocket ping and a 60 s fallback. A local edit syncs within about 0.4 s; the status shows in the sidebar. |
| Server | `server/index.mjs`, `sync.mjs`, `rules.mjs`, `db.mjs` | Node `http` + `ws` + `pg`. Rows are stored as JSONB keyed by (clinic, table, id) with a version per column, so the device schema stays the single source of columns. Per-column last-writer-wins on the device's edit time. Invoice numbers are assigned in a locked counter. Bearer tokens, stored hashed. |
| Roles | `server/rules.mjs` | Admin / Doctor / Assistant as in the table above; checked on the server for every change. A refused change comes back with the server's row, and the device undoes its edit. |
| Web app | `npm run build:cloud` → `dist-cloud/` | Served by the server at its address; it signs in to the server it came from. |
| Upgrade | `src/db/schema.ts` `MIGRATIONS[2]` | Existing installs: VET → ADMIN, sync tables added. The acceptance suite checks this on a schema-1 database. |

Known limits, handled in later phases:
- File bytes (X-rays, lab PDFs) stayed on the laptop that added them until Phase 4.

How Phase 4 is built:

| Piece | Where | Notes |
|---|---|---|
| Files on the server | `server/files.mjs`, `PUT/GET /api/files/:id`, `src/sync/engine.ts` `syncFiles` | The attachment row syncs as before; its bytes go up once to `FILES_DIR` (the Railway volume). Other devices download files up to 10 MB (2 MB on phones) in the background, so they open offline; bigger ones download when opened. The server pings devices when a file arrives. |
| Nightly backup | `server/backup.mjs`, `server/s3.mjs` (`aws4` signing) | After 02:00 Cairo: the whole database as gzip'd JSON (rows with their versions, file list, sign-ins, push keys) to `/data/backups` (14) and to the bucket (30 days), plus each new file once. Status, **Back up now**, **Download a copy** in Settings (Admin). |
| Restore | `RESTORE_FROM` at boot | Loads the backup into an empty database and fetches the files. A new epoch makes every device offer back its rows stamped with their own `updated_at`; per-column last-writer-wins keeps what is newer than the backup. Tested: database and volume both lost, rebuilt, the owner added after the backup came back, laptops stayed signed in and identical. |
| Phone install | `public-cloud/manifest.webmanifest`, `InstallPrompt.tsx` | Install banner on Android (the browser's prompt), Share → Add to Home Screen hint on iPhone. Chrome reports no installability errors. |
| Live check | `scripts/live-check.mjs`, `.github/workflows/live-check.yml` | Read-only check of the real address, daily and on demand; with an Admin sign-in also sync, backup age/off-site and volume. |
| Fix found on the way | `server/sync.mjs` | Resending a user row unchanged (as after a restore) ended that person's sign-ins; now only a password that really changed, or a deactivation, does. |
- A laptop's clock decided which of two edits to the same field wins. Since Phase 2 the device corrects its edit times by its measured difference from the server's clock, and the server caps edit times from the future.

How Phase 2 is built:

| Piece | Where | Notes |
|---|---|---|
| Who made each change | `sync_outbox.user_id` (schema v5), `src/sync/engine.ts` | Every queued change remembers who was signed in. Each person's changes are sent with their own sign-in, so the server checks their role (a Doctor's offline visit is not refused because the receptionist signed in next). Signing out with unsent changes keeps that person's sign-in on the laptop just long enough to send them, then ends it on the server. Changes of someone with no sign-in left on the laptop wait for them; Settings → Data & backup says whose. |
| Signing in offline | `resumeSync` | Works with the password stored on the laptop (any clinic user once the laptop has synced). The app keeps the typed password in memory only and signs in to the server by itself when it answers, then sends the work. |
| One bad change | `server/sync.mjs` | Each change runs in its own savepoint. A change the server can't store (e.g. text Postgres refuses) is reported back as `failed` and stays queued; the rest of the batch goes in. |
| Clocks | `X-Server-Time` header, `clock_offset` | Devices measure their clock's difference on every reply and shift queued edit times by it; the server caps edit times at now + 1 min. |
| Double booking offline | `server/notify.mjs` | The device sends how far it had synced; an overlapping booking the server got after that is reported to both people ("Double booking … booked on two devices without a connection"). |
| Web / phone app offline | `public-cloud/sw.js` | The service worker keeps the app on the device; the records are already in the browser's database. |
| Temporary invoice numbers | `Invoices.tsx` | An invoice made offline shows, and prints, "Temporary number: the final number is given when this device syncs". |

## Server (Railway)

- **One service:** Node with Fastify. It serves the built web app, the sync API, the WebSocket and file upload/download. One Postgres database. One volume for X-rays and lab files: their metadata syncs, and the file itself downloads when you open it, so phones don't fill up.
- **Secrets:** the session key and the Web Push (VAPID) keys are generated on the server's first start and stored in Postgres, so nobody has to copy secrets around. The first Admin comes from two Railway variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), which are ignored once an Admin exists.
- **Postgres schema:** the same tables as `src/db/schema.ts` and DATABASE.md, plus `clinics`, `changes` (the sync log), `sessions`, `devices`, `push_subscriptions` and `notifications`. Every clinic table has a `clinic_id`. Money stays as integer piastres, as on the devices.
- **Backups:** a nightly `pg_dump` plus the files volume, copied off Railway (Google Drive or an S3-style bucket), keeping 30 days. Restoring one is part of acceptance (SCOPE §7.7). Railway's own scheduled backups need the Pro plan ($20/month), so we don't rely on them on Hobby; every laptop also holds a full copy.
- **Region:** Railway EU West.
- **Cost:** Hobby plan $5/month, which includes $5 of usage. A small app and database should be about $5–10/month in total. Check after the first month.

## What happens to each app

| App | After the change |
|---|---|
| Windows / Mac desktop | Stays and is the main clinic PC client. Same screens, local SQLite, and now it syncs. Auto-update keeps working. |
| Phone | New: the installable web app (PWA) from the Railway address. "Add to Home screen" on Android; works offline after the first login. |
| Browser | The same web app, for the laptop or any PC without the desktop app. |
| Data already in a desktop app | On first sign-in to the cloud, the desktop app uploads its existing database once. Today that's only test data. |

## Work plan

Dates assume 10–15 hours a week, as in SCOPE §8.

| Phase | What | Done when | Rough effort |
|---|---|---|---|
| 0 | Ahmed: Railway Stage 1 (`docs/RAILWAY-SETUP.md`) | Railway shows the project with Postgres in EU West | 10 min (Ahmed) |
| 1 | Sync server + Postgres (`clinic_id` everywhere), logins, roles Admin / Doctor / Assistant enforced on the server, Admin user management, outbox + push/pull + live ping, invoice numbers from the server | Three desktop apps see each other's changes within 2 s; an Assistant's push to visits is refused; Admin adds a user who can sign in on another laptop | 5–6 evenings |
| 2 | Offline: queue and retry, offline sign-in, snapshot for new devices, conflict rules and overwrite notices | Change records on two laptops with Wi-Fi off, reconnect, and both end with the same data; acceptance suite gains offline tests | 3–4 evenings |
| 3 | Notifications: bell + toast, desktop app in the tray with system notifications, Web Push for the installed web app | Assistant books on laptop A while the app on laptop B is closed to the tray, and B shows the notification | 3 evenings |
| 4 | Railway Stage 2 deploy, files on the volume, nightly off-site backup with a tested restore, phone web app install | Acceptance passes on the live address; restore tested once (SCOPE §7.7); installs on the Android phone (§7.8) | 2–3 evenings |
| 5 | Ahmed's additions (5 Nov), see **Phase 5** below. Also the platform owner console: create a clinic and its first Admin | Each item's "done when" below; a second test clinic can't see the first clinic's data | 3–5 evenings, after handover |

**Total: roughly 14–18 evenings for Phases 1–4.** That's more than the 3 weeks to the 29 Nov handover hold at 10–15 h/week. Phases 1–2 (shared live data, roles, Admin, offline) come first. If time runs short, Phases 3–4 finish in the fix window (to 29 Dec), and Phase 5 is after handover.

## Phase 5 — Ahmed's additions (5 Nov 2026)

| Item | Today | Phase 5 adds | Done when |
|---|---|---|---|
| **More than three laptops** | Already no limit. Any number of laptops, phones and browsers can connect with **Connect to clinic server** + their own sign-in | A **Devices** list in Settings (name, user, last seen) with **Sign out this device**, for a lost or replaced laptop; load test with 10 devices | 10 devices sync the same records; a removed device is signed out at its next sync |
| **Admin creates users and assigns roles** | Already works: **Settings → Users** (name, email, role, temporary password); the server accepts user changes from Admins only | **Must change password at first sign-in**, **Reset password** by the Admin, and an **Invite** link sent by WhatsApp or email | A new user signs in with the temporary password and has to set their own |
| **Pre-diagnosis by the assistant doctor** | Not built | A **pre-assessment** step before the vet. The assistant doctor records the intake (complaint, weight, temperature, first observations, urgency). The patient appears in a **Waiting for the vet** queue on the vet's dashboard, the vet opens it, sees the pre-diagnosis at the top of the visit, and continues the same visit. A notification goes to the vet | A visit started by a Doctor shows in the vet's queue with the pre-diagnosis; the vet completes it as one visit |

Decided by Ahmed (5 Nov): the **Doctor** role records the pre-diagnosis (no new role); the patient waits for the Admin or another Doctor. **Changed by Ahmed (6 Nov):** the **Assistant** role records it too, for new and existing patients (New patient on the start screen); Admins and Doctors are notified. Assistants still can't write the diagnosis, treatment or prescriptions, and can edit the pre-diagnosis only while the patient waits (enforced by `server/rules.mjs`). Fields: complaint, history, weight, temperature, heart rate, breathing rate, first observations / provisional diagnosis. Urgency: Routine / Soon / Emergency (emergencies first in the queue, and the notification says so). The vet can correct the pre-diagnosis; the audit log keeps who wrote what.

How Phase 5 is built:

| Piece | Where | Notes |
|---|---|---|
| Pre-diagnosis | `src/screens/IntakeForm.tsx`, routes `/intake/new`, `/pets/:id/intake`, `/visits/:id/intake` | Saved as a visit with `stage = WAITING` (schema v4). The dashboard's **Waiting for the vet** list (emergencies first, minutes waiting, who wrote it); the vet's click takes the patient (`WITH_VET`, shown to the others as "with Dr X") and opens the visit with the pre-diagnosis on top; saving completes it (`DONE`), offers the invoice and marks a linked appointment done. Notification kind `queue` goes to Admins and Doctors. |
| Temporary passwords | `src/components/Account.tsx`, Settings → Users | A new user gets a generated temporary password; **Reset password** makes a new one. Either way the person must choose their own at the next sign-in (`must_change_password`), and the Admin gets the sign-in message (download link, server address, email, temporary password) to send by WhatsApp or email. A changed or reset password signs that person out on their other devices. Everyone can **Change my password** from the sidebar. |
| Devices | `src/components/Devices.tsx`, `GET /api/devices`, `POST /api/devices/revoke` | Settings → Devices (Admin, when connected): every signed-in device with its user, last seen / online now. **Sign out** ends that session at once (live message) or at its next sync; the device needs the password again. No limit on the number of devices; tested with 12 at once. |
| Sign-in brake | `server/index.mjs` | Now counts only wrong passwords (10 per 5 minutes per address): all the clinic's devices share one internet address, so counting every sign-in would have blocked a busy morning. |

## Phase 6 — Owner page and prescription archive (Ahmed, 14 Nov 2026)

| Ahmed asked for | Built |
|---|---|
| A code for each customer that opens a page with their data, their pets, upcoming appointments (add to calendar), prescriptions uploaded automatically, live updates | A **QR code** per owner (a 1-D barcode can't carry a web link a phone opens). It opens `https://<server>/o/<token>`: the owner's details, each pet (species, age, last weight, vaccinations with next due), upcoming appointments with **Google Calendar**, **iPhone / Outlook (.ics)** and **add all to my calendar** (a feed that updates itself, with vaccination due dates), and every prescription. The page is live: the server tells it "changed" (Server-Sent Events) after every push and it fetches again within a second. Arabic / English, phone first, prints. |
| The doctor can't find a prescription again | **Prescriptions** on Owner detail (every prescription of every pet of that owner, newest first, search by drug / pet / diagnosis, filter by pet), a **Prescriptions** tab on the pet record, and **Print** for an A5 reprint of any past prescription. |

| Piece | Where | Notes |
|---|---|---|
| The link | `owners.portal_token` (schema v15), `createOwnerPage` / `replaceOwnerPage` / `disableOwnerPage` in `repo.ts` | 128 random bits made on the device, synced like any owner edit. Anyone at the desk can create it; replacing or switching off a printed code is Admin-only, enforced in `server/rules.mjs`. An archived owner's page is off. |
| Staff side | `src/components/OwnerPage.tsx` | Owner detail → **Owner page**: QR, link, **Print QR card** (`/owners/:id/card`), **Send by WhatsApp** (`wa.portal`), copy, open; Admin: **Replace QR code** (lost card) / **Turn off page**. Needs the device linked to the clinic server. |
| The page | `server/portal.mjs` (routes, data, calendar, live), `server/portal-page.mjs` (the page) | Laid out like a members' portal: top bar (clinic, Live, language), welcome banner with Call / WhatsApp, and five views — **Home** (next appointment with countdown, summary tiles, vaccinations coming up, latest prescription, pets), **Pets**, **Appointments**, **Prescriptions**, **My details** — as a bottom tab bar on phones and top tabs on laptops. Each owner keeps the same QR for good; it changes only when an Admin replaces a lost one. A per-owner manifest lets them add the page to their home screen. Data from `/o/<token>/data`. Only owner-facing fields leave the server: diagnoses yes (Dr. Waleed, 14 Nov: a "Visits and diagnoses" history per pet and the diagnosis on each prescription); never staff notes, complaint, treatment notes, national ID or money. Visits still in the vet's queue are left out until saved. Headers: no-store, no-referrer, noindex, CSP with a nonce. Wrong links are braked per address (30 per 10 min). Postgres indexes for the lookups in `server/db.mjs`. Fonts: Plex Sans Arabic from `@fontsource`. |
| Calendar | `/o/<token>/calendar.ics`, `/o/<token>/a/<id>.ics` | RFC 5545, lines folded at 75 bytes (Arabic), 2-hour reminder on appointments, vaccination due dates as all-day events in the feed. |
| Service worker | `public-cloud/sw.js` | Leaves `/o/…` alone, so a staff phone with the web app installed still opens the owner page and keeps its own app shell. |
| Prescription archive | `src/components/RxArchive.tsx`, `prescriptionArchive()` | Owner detail section, pet tab `?tab=prescriptions`; Print opens the existing prescription sheet `/visits/:id/prescription`. |
| Tests | `scripts/sync-test.mjs` "phase6" | QR made on the doctor's laptop, page opened in a phone-sized browser, a booking on laptop A and a prescription on laptop B appear on the open page without reload, calendar files, archive search and reprint, Doctor's replace refused, Admin's replace kills the old link and the open page says so. `scripts/acceptance.mjs`: new screens in the Arabic RTL pass, prescription prints on one A5 page. |

Decided (14 Nov): **Dr. Waleed approved the change request.** The owner sees prescriptions **and diagnoses**, not the vet's notes; the page needs no password (the QR is the key, like a house key: replace it when lost); each owner keeps the same QR for good; pets that died or moved stay on the page, greyed.

## Change requests of 14 Nov 2026 (Ahmed)

| Asked for | Built | Sync notes |
|---|---|---|
| A unique, searchable, clickable customer ID that appears on the prescription | `owners.code` `AC-00001` (schema v16), on every list, document and the owner page | Numbered by the server like invoices (`TMP-…` offline); existing owners back-filled by the server at start-up; refused if anyone tries to change it |
| Lab results as a printable document (logo, owner name and ID, pet, age, sex, results), and on the owner page | Lab report A5 per test day; owner page → Pets → Lab results (high / low flagged) | `lab_results` read by `server/portal.mjs` (index `rows_by_pet_labs`) |
| Case report for the doctors, A4, with history, diagnoses and attached X-rays / pictures, and the owner's data | Pet → Print & forms → Case report (A4) | Images not on the device yet are fetched from the server (`downloadAttachment`) |
| X-ray request, A5, with boxes to tick and space to write | Pet → Print & forms → X-ray request | Saved since the follow-up below |
| Save X-ray requests in the pet's history; keep previous X-rays and show them to the owner under "Requests"; a printable lab request (the clinic's sheet) also shown to the owner | `test_requests` (schema v17) for X-ray and lab requests; pet record → Requests tab (requests + X-ray images, Upload X-ray); lab request A4 from `src/lib/lab-tests.json`; owner page → Requests tab | New synced table; Admin + Doctor write it; X-ray images reach the owner only once their bytes are on the server (`/o/<token>/f/<id>`, checked against the owner's pets) |

## Scope impact (SCOPE §10)

These are outside SCOPE §4, so they are change requests, quoted at list price and waived at Dr. Waleed's discretion:

- **Full offline with sync:** the scope promised an "offline-tolerant draft" only.
- **Live notifications between users, including when the app is closed** (tray app, Web Push).
- **Doctor role and Admin user management:** the scope has two roles; this adds a third.
- **Built for several clinics** (`clinic_id`, platform owner console): SCOPE §5 lists multi-clinic as v2.
- **Phase 5:** the pre-assessment step (a new workflow), device management, and invite / password reset.
- **Hosting under Ahmed's account** instead of Dr. Waleed's (§4 and §8).
- **Phase 6:** the owner page is the "owner-facing portal" SCOPE §5 puts in v2 (read-only, no booking); the prescription archive is a new view of data already in scope.
- **14 Nov:** customer ID, lab report, case report and X-ray request (one new column, three new documents).

The rest moves the project back towards the scope: the phone install (§4, §7.8), Railway hosting in the EU (§8), and the nightly backup (§7.7).

## Still open

1. **"At scale":** do you mean more users in this clinic, or selling the app to **other clinics** later? The design covers both. The answer decides whether Phase 5 is needed at all.
2. **Secretary:** I assumed the secretary is the **Assistant** role. Say if the secretary should differ from reception.
3. **Ahmed as Admin:** your support login can see patient data. Dr. Waleed should agree to that in writing; a line in the scope sign-off is enough.
