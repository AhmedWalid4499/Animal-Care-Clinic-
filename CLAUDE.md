# CLAUDE.md — Animal Care Clinic Patient Tracker

Vet clinic records app for Dr. Waleed El-Bourgy. Built by Yuto Software House (Ahmed El-Bourgy) as a **Build** package (fixed scope, 3 weeks, 8 screens, 1 integration). Read `SCOPE.md` before touching features and `DATABASE.md` / `src/db/schema.ts` before touching data. The scope is the contract: anything not in `SCOPE.md §4` is a change request — say so instead of building it.

## Stack (changed 3 Nov 2026: Windows desktop app, at Ahmed's request)
The original plan (Next.js 15 + Prisma + Postgres on Railway + PWA) was replaced by a **Windows desktop app**. SCOPE.md §4/§5 still describe a web/PWA delivery; it must be re-confirmed with Dr. Waleed as a change request.
- **Electron** (`electron/main.cjs`, sandboxed renderer, `electron/preload.cjs` is the only bridge) · **React 18 + Vite + TypeScript** · HashRouter
- Data: **SQLite via sql.js**, one file at `%APPDATA%\Animal Care Clinic\data\clinic.sqlite`, written atomically after every transaction; daily backup copy (keep 14). Schema in `src/db/schema.ts` mirrors `DATABASE.md` (money = integer piastres; attachments' bytes in `attachment_blobs`)
- Auth: users with bcryptjs, roles `ADMIN` / `DOCTOR` / `ASSISTANT` (schema v2; old `VET` → `ADMIN`). Admin: everything; Doctor: visits but no Settings/users/archive/void; Assistant: front desk, read-only visits except the pre-diagnosis. Assistants and Doctors record the **pre-diagnosis** (Phase 5; Assistants added 6 Nov 2026 at Ahmed's request, change request): the patient waits in the dashboard's vet queue, Admins and Doctors are notified, and the Admin or a Doctor completes the same visit (`visits.stage`, schema v4). An Assistant may only create a `WAITING` visit in their own name (no vet, diagnosis, treatment, follow-up, invoice) and edit its intake fields while it is still `WAITING` (`assistantIntake` in `server/rules.mjs`). The pre-diagnosis start screen has **New patient** (phone first: an existing owner's pets are offered, else owner + pet are created, `quickPatient` in `repo.ts`). Passwords set by the Admin are temporary (`users.must_change_password`). The UI hides what a role can't do (`isAdmin`, `canVisit`, `canIntake` in `src/lib/app.tsx`), and `server/rules.mjs` enforces it
- **Cloud sync (Phase 1, 4 Nov 2026):** local-first, as in `docs/CLOUD-PLAN.md`. Each device keeps its SQLite and SQLite triggers feed `sync_outbox` (`src/sync/local.ts`); `src/sync/engine.ts` pushes and pulls against `server/` (Node + Postgres on Railway, `railway.json`). Any new table or column syncs automatically if it is in `SYNC_TABLES`, which must match `server/tables.mjs`. Invoice numbers come from the server while linked (`TMP-…` until synced)
- i18n: `src/i18n/ar.json` (default, RTL) + `en.json`; never hard-code UI text
- Charts: `recharts` (weight chart) · receipt / pet summary: print CSS, A5 · export: SheetJS (xlsx/csv)
- Packaging: `electron-builder` → Windows: NSIS installer + portable exe (`.github/workflows/windows.yml`, `windows-latest`) · macOS: universal dmg, ad-hoc signed via `build/mac-adhoc-sign.cjs`, not notarized (`.github/workflows/macos.yml`, `macos-latest`)
- **macOS build (added 3 Nov 2026, so Ahmed can test on his MacBook):** same code, same features. Every change must keep working on both: no Windows-only or Mac-only paths/APIs in the renderer; anything OS-specific lives in `electron/main.cjs` behind `process.platform`. Mac data dir: `~/Library/Application Support/Animal Care Clinic/data/`. Mac needs its app menu (`macMenu()` in `main.cjs`) or copy/paste/quit shortcuts break. Background mode differs per OS and is handled in `main.cjs`: macOS ignores login-item `args`, so a login launch is detected with `getLoginItemSettings().wasOpenedAtLogin` (Windows passes `--hidden`); macOS 13+ may hold the login item for approval (`status: 'requires-approval'` → note + button in the bell panel); the menu-bar icon is 18 pt with a 2× image and opens its menu on click; Mac wording says "menu bar", not "tray" (`notify.backgroundMac`). CI runs `--smoke --smoke-desktop` on both OSes (icon, login item, device name)
- **Auto-update (added 3 Nov 2026):** every push to `main` → `.github/workflows/release.yml` builds both and publishes GitHub Release `v<major.minor>.<run number>` (repo is public, no token in the app). `electron/updater.cjs`: Windows = `electron-updater` (NSIS only; portable just notifies), Mac = own download → SHA-512 → `codesign --verify` → swap after quit (Squirrel.Mac needs a Developer ID). DB copied to `backups/clinic-before-update-*.sqlite` first. Toggle + "check now" in Settings → Data & backup. Don't rename release artifacts (`AnimalCareClinic-*`, no spaces) — the update feeds point at them
- Browser build (`npm run build:web`) = clickable prototype with demo data in IndexedDB
- Timezone: clinic PC local time (Africa/Cairo); currency EGP; dates shown `d MMM yyyy`

## Data rules (do not break)
- Pet belongs to exactly one owner (`pets.owner_id NOT NULL`). Clinical rows hang off `pets`; money hangs off `owners`.
- Never hard-delete owners, pets, visits, invoices — use `status`. Hard delete is allowed only for `prescriptions` / `invoice_items` via cascade from their parent edit.
- Every write goes through `src/db/repo.ts` inside `tx()` and appends to `audit_log`.
- Invoice `total` = Σ `line_total` − `discount`; `status` recomputed on every payment write (`UNPAID` / `PARTIAL` / `PAID`).
- Vaccination `next_due_at` default = `administered_at + vaccine_types.interval_days`; editable.
- Dashboard "due" = latest vaccination per (pet, type) with `next_due_at ≤ today + 7d`, pet `ACTIVE`.
- Reports leave out VOID invoices and their payments, and group days/months in local time (moments are stored UTC). "Taken by" = `payments.received_by`.
- Dose calculator (schema v7): `drugs` is the clinic's own list (Admin only, `server/rules.mjs`); `src/lib/dose.ts` does mg/kg × weight (visit weight, else last recorded), caps at `max_mg`, ÷ concentration, and warns on species / allergy-note matches. Never ship real doses in seeds: demo drugs are marked "(demo)" and seeded only with `SEED_DEMO=1`. Treatment templates (`treatment_templates`, Admin + Doctor) fill diagnosis, treatment and prescriptions; listed drugs' doses are left blank so they are recalculated.
- Stock (schema v8): price items with `track_stock` are counted; `stock_moves` is append-only and on hand = Σ `qty`. Invoices reconcile their own moves in `syncInvoiceStock` (`repo.ts`) on every save and void, so never write INVOICE moves elsewhere. Restock / count correction are Admin only (`server/rules.mjs`); the dashboard shows "Running low" at or below `low_stock`.
- Patient alerts: `pets.alert_flags` (comma-separated, `ALERT_FLAGS` in `src/db/types.ts`) + `pets.alert_note`; render with `PetAlerts` wherever a pet is handled.

## Screens (`SCOPE.md §4`) → routes
Routes are hash routes (`#/owners`) because the app loads from `file://`.

| Route | Screen |
|---|---|
| `/login` | Login |
| `/` | 1 Dashboard |
| `/owners`, `/owners/new` | 2 Owners |
| `/owners/[id]` | 3 Owner detail |
| `/pets/[id]` (+ `?tab=timeline\|vaccinations\|weight\|files`) | 4 Pet record |
| `/pets/[id]/certificate` | Vaccination certificate, A5, English + Arabic (change request 6 Nov) |
| `/pets/[id]/visits/new`, `/visits/[id]/edit` | 5 Visit |
| `/visits/[id]/prescription` | Prescription for the owner, A5, Arabic or English (chosen on the sheet, not the app language) + WhatsApp text (change request 7 Nov) |
| `/intake/new`, `/pets/[id]/intake`, `/visits/[id]/intake` | 5a Pre-diagnosis — Assistants, Doctors, Admin (Phase 5 change request; New patient on `/intake/new`; queue on the dashboard) |
| `/appointments` (`?view=day\|week`) | 6 Appointments |
| `/reminders` (`?tab=recall`) | Reminders: tomorrow's appointments + this week's due vaccinations, each with WhatsApp (change request 6 Nov). Tab "Not seen in a while": active pets with no visit in 6/12/18/24 months and nothing booked, WhatsApp check-up reminder stamps `pets.recall_sent_at` (schema v9, change request 7 Nov) |
| `/invoices`, `/invoices/[id]`, `/invoices/[id]/print` | 7 Invoices |
| `/stock` | Stock — everyone sees levels and history; Admin restocks and corrects counts (change request 6 Nov) |
| `/reports` (`?view=day&date=` \| `?view=month&month=`) | Reports — Admin only: end-of-day cash (by method, by staff, payments, open invoices) and monthly (12-month revenue chart, visits by type, top services, who owes money by age) (change request 6 Nov) |
| `/settings` (clinic, prices, vaccines, drugs, treatment templates, users, devices, activity, export, clinic server) | 8 Settings — Admin only. Activity (`src/screens/Activity.tsx`, change request 7 Nov) reads `audit_log` (synced, so every device) with person / kind / date filters |
| `/account` | Settings for Doctors and Assistants (nav "Settings" for non-Admins): check for updates / restart to update (the auto-update on/off switch stays Admin-only), language, theme, password (`src/screens/MySettings.tsx`) |

## The one integration
WhatsApp click-to-chat: `https://wa.me/<E164>?text=<encoded>` with templates in `lib/whatsapp.ts` (AR/EN): vaccination reminder, appointment reminder, invoice balance. Set `reminder_sent_at` when the button is clicked. **No WhatsApp Business API** — out of scope.

## UI
- Clean, clinical, not a template: Plex Sans Arabic 400/600, 4px corners, rules not boxes, one accent colour = clinic brand (teal `#2e6f73` from the logo, to be confirmed). Light + dark via `prefers-color-scheme` + `data-theme`.
- Mobile first: every form must be completable one-handed on a phone; primary action is a bottom sticky button on mobile.
- Minimum fields to save a visit: pet, date, type. Everything else optional.

## Working agreement
- Branch per screen (`feat/04-pet-record`), PR to `main`; CI builds the Windows exe and the Mac dmg per PR — both must be green. Merging to `main` ships the update to every installed app.
- Commit as `Ahmed El-Bourgy <ahmedwalid4499@gmail.com>`.
- `npm run typecheck`, `npm run walkthrough`, `npm run acceptance` and `npm run sync-test` (needs a local Postgres; see the script header) must pass before any PR.
- Seed: `src/db/seed.ts` loads users, vaccine types, price items, clinic settings from `DATABASE.md` on a fresh database. Demo data only behind `SEED_DEMO=1` (and in the browser prototype).
- Import: Settings → Data & backup → Import reads the owners/pets sheet (columns in `import/TEMPLATE.md`).

## Milestones (from SCOPE.md §6)
Scope sign-off 8 Nov · Prototype 13 Nov · Data sheet 22 Nov · Handover 29 Nov 2026 · Fix window to 29 Dec.

## Open items (fill in, then delete this section)
- [ ] Cloud move: plan in `docs/CLOUD-PLAN.md` (local-first sync via Railway on Ahmed's account, offline, roles Admin/Doctor/Assistant, notifications incl. app closed, `clinic_id` for later clinics). Railway steps in `docs/RAILWAY-SETUP.md`. **Phase 1 live (5 Nov 2026):** server at `https://animal-care-clinic-production.up.railway.app` (Ahmed's Railway, EU West, Hobby), first laptop connected and synced. **Phase 3 (notifications: bell, tray, Web Push) live** (v0.1.7). **Phase 5 live** (v0.1.8). **Phase 2 live** (offline: each queued change keeps its author, `sync_outbox.user_id` schema v5). **Phase 4 built**: files on the volume (`server/files.mjs`, `syncFiles`), nightly backup to the volume + an S3-style bucket with `RESTORE_FROM` restore (`server/backup.mjs`), phone install, `live-check.yml`. Ahmed: set up the R2 bucket + live-check secrets (`docs/RAILWAY-SETUP.md`). Next: the 'Still open' answers
- [x] Clinic name, logo (`src/assets/clinic-logo.png`), phone 01227007428, Giza — seeded in `src/db/seed.ts` (`CLINIC`)
- [ ] Confirm: brand colour = logo teal `#2e6f73`; WhatsApp number = phone; full street address; Arabic clinic name
- [ ] Confirm spelling: logo says "Dr. Waleed ElBoargi", scope says "El-Bourgy"; Arabic spelling used in the how-to is "وليد البرجي"
- [ ] Confirm species list and vaccine catalogue with intervals
- [ ] Price list values
- [ ] Re-confirm with Dr. Waleed: Windows desktop app on the clinic PC instead of web/PWA (SCOPE §4–§5 change request); which PC holds the data; code-signing certificate (optional)
