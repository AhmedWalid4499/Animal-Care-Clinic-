# Cloud plan — shared, live, offline-capable

Status: **draft for Ahmed's review**, 4 Nov 2026. Nothing here is built yet.

## What Ahmed asked for

| Need (Ahmed's words, 4 Nov) | What it means for the design |
|---|---|
| "The vet finishes with the patient, the assistant books the next appointment, and it shows on the doctor's profile. The secretary sees it too, can update it, and the others are notified." | One shared set of records for every login, changes reach the other devices in seconds, and an in-app notification says who changed what. |
| Hosting: Railway, on Ahmed's own account | One Railway project under Ahmed's account (Hobby plan). SCOPE §4 and §8 say Dr. Waleed owns the hosting account, so record this as a change. A Railway project can be handed over to his account later. |
| Must fully work offline | Every device keeps a full local copy and works with no internet. Changes queue up and sync when the connection is back. |
| Free Railway address | `https://<name>.up.railway.app`. It has HTTPS, which the phone install needs. A real domain can be added later without code changes. |

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

### Notifications

- **In the app:** a bell in the header with a list ("Reception booked Max for Thu 10:00", "Dr. Waleed recorded a visit for Luna"), plus a toast when it arrives. Read/unread is kept per user.
- **On the PC:** the desktop app also shows a Windows/Mac system notification while it's running.
- **On the phone:** notifications show while the app is open. Push notifications to a closed phone (Web Push) are a later step.
- **Default triggers, to confirm with Ahmed:** an appointment booked, moved, cancelled or marked no-show by someone else; a visit recorded for a pet with an appointment today; a payment recorded; a sync conflict on something you edited.

## Server (Railway)

- **One service:** Node with Fastify. It serves the built web app, the sync API, the WebSocket and file upload/download. One Postgres database. One volume for X-rays and lab files: their metadata syncs, and the file itself downloads when you open it, so phones don't fill up.
- **Postgres schema:** the same tables as `src/db/schema.ts` and DATABASE.md, plus `changes` (the sync log), `sessions`, `devices` and `notifications`. Money stays as integer piastres, as on the devices.
- **Backups:** a nightly `pg_dump` plus the files volume, copied off Railway (Google Drive or an S3-style bucket), keeping 30 days. Restoring one is part of acceptance (SCOPE §7.7).
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
| 0 | Decisions below answered; Ahmed creates the Railway project and connects the GitHub repo | Railway shows an empty project linked to `main` | 1 evening (Ahmed) |
| 1 | Sync server + Postgres + logins; outbox, push/pull and live ping on the devices; invoice numbering on the server | Two desktop apps on two computers see each other's changes within 2 s; an assistant's push to visits is refused | 4–5 evenings |
| 2 | Offline: queue and retry, offline login, snapshot for new devices, conflict rules, merge-conflict and overlap notices | Change things on two devices with the network off, reconnect, and both end with the same data; acceptance suite gains offline tests | 3–4 evenings |
| 3 | Notifications (bell, toast, system notifications) and the phone app (PWA install, offline storage) | Assistant books on the phone, vet's PC shows the notification; app installs on the Android phone (SCOPE §7.8) | 3 evenings |
| 4 | Files on the volume, nightly off-site backup with a tested restore, deploy to Railway, move existing data | Acceptance on the live Railway address passes; restore tested once (SCOPE §7.7) | 2–3 evenings |

**Total: roughly 12–15 evenings.** Starting after the 8 Nov sign-off, that runs to about the 29 Nov handover with little slack. If it slips, Phase 3's phone install and Phase 4 are what move into the fix window; the shared live data from Phases 1–2 comes first.

## Scope impact (SCOPE §10)

These are outside SCOPE §4, so they are change requests, quoted at list price and waived at Dr. Waleed's discretion:

- **Full offline with sync:** the scope promised an "offline-tolerant draft" only.
- **Live notifications between users.**
- **Hosting under Ahmed's account** instead of Dr. Waleed's (§4 and §8).

The rest moves the project back towards the scope: the phone install (§4, §7.8), Railway hosting in the EU (§8), and the nightly backup (§7.7).

## Open questions for Ahmed

1. **Roles:** you mentioned an *assistant doctor* and a *secretary*. The scope has two roles: Vet (everything) and Assistant (owners, pets, appointments, invoices; read-only visits). Can the assistant doctor record visits? If yes, we need a third role, e.g. **Doctor**: visits yes, settings no.
2. **Notifications:** are the default triggers above right? Anything to add or drop?
3. **Phone push when the app is closed:** needed for the handover, or is "while the app is open" enough for v1?
4. **Devices:** how many PCs and phones will use it at the clinic? This sizes the testing and helps choose the Railway plan.
