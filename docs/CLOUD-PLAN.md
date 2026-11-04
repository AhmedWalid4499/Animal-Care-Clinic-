# Cloud plan — shared, live, offline-capable

Status: **agreed direction, 4 Nov 2026**; open points at the end. Nothing here is built yet. Railway steps for Ahmed: `docs/RAILWAY-SETUP.md`.

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
- **Triggers:** someone else books, moves, cancels or marks no-show an appointment; a visit is recorded for a pet with an appointment today; a payment is recorded; something you edited was overwritten. Each user can turn kinds off in their profile.
- **Wording:** in the reader's language (AR/EN), with the pet and owner name, and who did it.

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
| 5 | Platform owner console: create a clinic and its first Admin | A second test clinic exists and can't see the first clinic's data | 1–2 evenings, after handover |

**Total: roughly 14–18 evenings for Phases 1–4.** That's more than the 3 weeks to the 29 Nov handover hold at 10–15 h/week. Phases 1–2 (shared live data, roles, Admin, offline) come first. If time runs short, Phases 3–4 finish in the fix window (to 29 Dec), and Phase 5 is after handover.

## Scope impact (SCOPE §10)

These are outside SCOPE §4, so they are change requests, quoted at list price and waived at Dr. Waleed's discretion:

- **Full offline with sync:** the scope promised an "offline-tolerant draft" only.
- **Live notifications between users, including when the app is closed** (tray app, Web Push).
- **Doctor role and Admin user management:** the scope has two roles; this adds a third.
- **Built for several clinics** (`clinic_id`, platform owner console): SCOPE §5 lists multi-clinic as v2.
- **Hosting under Ahmed's account** instead of Dr. Waleed's (§4 and §8).

The rest moves the project back towards the scope: the phone install (§4, §7.8), Railway hosting in the EU (§8), and the nightly backup (§7.7).

## Still open

1. **"At scale":** do you mean more users in this clinic, or selling the app to **other clinics** later? The design covers both. The answer decides whether Phase 5 is needed at all.
2. **Secretary:** I assumed the secretary is the **Assistant** role. Say if the secretary should differ from reception.
3. **Ahmed as Admin:** your support login can see patient data. Dr. Waleed should agree to that in writing; a line in the scope sign-off is enough.
