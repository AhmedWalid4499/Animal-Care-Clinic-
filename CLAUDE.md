# CLAUDE.md — [CLINIC NAME] Patient Tracker

Vet clinic records app for Dr. Waleed El-Bourgy. Built by [BUSINESS NAME] (Ahmed El-Bourgy) as a **Build** package (fixed scope, 3 weeks, 8 screens, 1 integration). Read `SCOPE.md` before touching features and `DATABASE.md` / `src/db/schema.ts` before touching data. The scope is the contract: anything not in `SCOPE.md §4` is a change request — say so instead of building it.

## Stack (changed 3 Nov 2026: Windows desktop app, at Ahmed's request)
The original plan (Next.js 15 + Prisma + Postgres on Railway + PWA) was replaced by a **Windows desktop app**. SCOPE.md §4/§5 still describe a web/PWA delivery; it must be re-confirmed with Dr. Waleed as a change request.
- **Electron** (`electron/main.cjs`, sandboxed renderer, `electron/preload.cjs` is the only bridge) · **React 18 + Vite + TypeScript** · HashRouter
- Data: **SQLite via sql.js**, one file at `%APPDATA%\Animal Care Clinic\data\clinic.sqlite`, written atomically after every transaction; daily backup copy (keep 14). Schema in `src/db/schema.ts` mirrors `DATABASE.md` (money = integer piastres; attachments' bytes in `attachment_blobs`)
- Auth: local users, bcryptjs, roles `VET` / `ASSISTANT` (assistant: no Settings, no archive/void, no visit writes)
- i18n: `src/i18n/ar.json` (default, RTL) + `en.json`; never hard-code UI text
- Charts: `recharts` (weight chart) · receipt / pet summary: print CSS, A5 · export: SheetJS (xlsx/csv)
- Packaging: `electron-builder` → Windows: NSIS installer + portable exe (`.github/workflows/windows.yml`, `windows-latest`) · macOS: universal dmg, ad-hoc signed via `build/mac-adhoc-sign.cjs`, not notarized (`.github/workflows/macos.yml`, `macos-latest`)
- **macOS build (added 3 Nov 2026, so Ahmed can test on his MacBook):** same code, same features. Every change must keep working on both: no Windows-only or Mac-only paths/APIs in the renderer; anything OS-specific lives in `electron/main.cjs` behind `process.platform`. Mac data dir: `~/Library/Application Support/Animal Care Clinic/data/`. Mac needs its app menu (`macMenu()` in `main.cjs`) or copy/paste/quit shortcuts break
- Browser build (`npm run build:web`) = clickable prototype with demo data in IndexedDB
- Timezone: clinic PC local time (Africa/Cairo); currency EGP; dates shown `d MMM yyyy`

## Data rules (do not break)
- Pet belongs to exactly one owner (`pets.owner_id NOT NULL`). Clinical rows hang off `pets`; money hangs off `owners`.
- Never hard-delete owners, pets, visits, invoices — use `status`. Hard delete is allowed only for `prescriptions` / `invoice_items` via cascade from their parent edit.
- Every write goes through `src/db/repo.ts` inside `tx()` and appends to `audit_log`.
- Invoice `total` = Σ `line_total` − `discount`; `status` recomputed on every payment write (`UNPAID` / `PARTIAL` / `PAID`).
- Vaccination `next_due_at` default = `administered_at + vaccine_types.interval_days`; editable.
- Dashboard "due" = latest vaccination per (pet, type) with `next_due_at ≤ today + 7d`, pet `ACTIVE`.

## Screens (`SCOPE.md §4`) → routes
Routes are hash routes (`#/owners`) because the app loads from `file://`.

| Route | Screen |
|---|---|
| `/login` | Login |
| `/` | 1 Dashboard |
| `/owners`, `/owners/new` | 2 Owners |
| `/owners/[id]` | 3 Owner detail |
| `/pets/[id]` (+ `?tab=timeline\|vaccinations\|weight\|files`) | 4 Pet record |
| `/pets/[id]/visits/new`, `/visits/[id]/edit` | 5 Visit |
| `/appointments` (`?view=day\|week`) | 6 Appointments |
| `/invoices`, `/invoices/[id]`, `/invoices/[id]/print` | 7 Invoices |
| `/settings` (clinic, prices, vaccines, users, export) | 8 Settings — VET only |

## The one integration
WhatsApp click-to-chat: `https://wa.me/<E164>?text=<encoded>` with templates in `lib/whatsapp.ts` (AR/EN): vaccination reminder, appointment reminder, invoice balance. Set `reminder_sent_at` when the button is clicked. **No WhatsApp Business API** — out of scope.

## UI
- Clean, clinical, not a template: Plex Sans Arabic 400/600, 4px corners, rules not boxes, one accent colour = clinic brand (placeholder `#0078d4` until Dr. Waleed picks). Light + dark via `prefers-color-scheme` + `data-theme`.
- Mobile first: every form must be completable one-handed on a phone; primary action is a bottom sticky button on mobile.
- Minimum fields to save a visit: pet, date, type. Everything else optional.

## Working agreement
- Branch per screen (`feat/04-pet-record`), PR to `main`; CI builds the Windows exe and the Mac dmg per PR — both must be green.
- Commit as `Ahmed El-Bourgy <ahmedwalid4499@gmail.com>`.
- `npm run typecheck` and `npm run build && xvfb-run -a node scripts/walkthrough.mjs` must pass before any PR.
- Seed: `src/db/seed.ts` loads users, vaccine types, price items, clinic settings from `DATABASE.md` on a fresh database. Demo data only behind `SEED_DEMO=1` (and in the browser prototype).
- Import: Settings → Data & backup → Import reads the owners/pets sheet (columns in `import/TEMPLATE.md`).

## Milestones (from SCOPE.md §6)
Scope sign-off 8 Nov · Prototype 13 Nov · Data sheet 22 Nov · Handover 29 Nov 2026 · Fix window to 29 Dec.

## Open items (fill in, then delete this section)
- [ ] Clinic name EN/AR, logo, brand colour, phone/WhatsApp, address
- [ ] Dr. Waleed's title/affiliation for the scope header
- [ ] Confirm species list and vaccine catalogue with intervals
- [ ] Price list values
- [ ] Re-confirm with Dr. Waleed: Windows desktop app on the clinic PC instead of web/PWA (SCOPE §4–§5 change request); which PC holds the data; code-signing certificate (optional)
