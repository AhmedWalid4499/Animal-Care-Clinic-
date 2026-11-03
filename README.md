# Animal Care Clinic — Patient Tracker (Windows + macOS desktop app)

Clinic records app for Dr. Waleed El-Bourgy: owners → pets → visits, vaccinations due, appointments, invoices, WhatsApp reminders. Arabic (default, right-to-left) and English. Scope: `SCOPE.md` · data model: `DATABASE.md` · working rules: `CLAUDE.md`.

## What it is

A desktop app (Electron) for **Windows and macOS**, built from the same code, that keeps all clinic data in **one SQLite file on the computer it runs on**:

```
Windows: %APPDATA%\Animal Care Clinic\data\clinic.sqlite                     ← the database
         %APPDATA%\Animal Care Clinic\data\backups\                          ← automatic daily copy, last 14 kept
macOS:   ~/Library/Application Support/Animal Care Clinic/data/clinic.sqlite
         ~/Library/Application Support/Animal Care Clinic/data/backups/
```

Every change builds both versions: CI produces a Windows exe (`windows.yml`) and a Mac dmg (`macos.yml`) on every push to `main` and every PR, so the Mac build is always the same app as the Windows one. The two computers do **not** share data: each has its own database file (move data with Settings → Data & backup → backup/restore).

No server and no internet connection needed, except to open WhatsApp. Backups and Excel export are under **Settings → Data & backup**.

## Install on the clinic PC

Download the build from GitHub Actions (**Actions → Windows build → artifact `animal-care-clinic-windows`**) or from a local build (see below):

- `Animal Care Clinic Setup 0.1.0.exe`: the installer, with Start-menu and desktop shortcuts.
- `AnimalCareClinic-0.1.0-portable.exe`: a single exe that runs without installing (for a USB stick or a trial).

The build is not code-signed yet, so Windows SmartScreen will warn on first run: click **More info → Run anyway**.

## Install on a Mac (for testing)

Download **Actions → macOS build → artifact `animal-care-clinic-macos`** (unzip it to get `AnimalCareClinic-0.1.0-mac.dmg`), or build locally with `npm run dist:mac`.

1. Open the `.dmg` and drag **Animal Care Clinic** into **Applications**.
2. First launch only: in Applications, **right-click (or Control-click) the app → Open → Open**. macOS warns because the app has no Apple Developer ID yet; after this it opens normally.
   - On macOS 15 (Sequoia) and later, if there is no Open button: try to open it once, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
   - If macOS says the app "is damaged", run this once in Terminal, then open it again: `xattr -cr "/Applications/Animal Care Clinic.app"`

The dmg is universal: it runs on Apple-chip (M1–M4) and Intel Macs, macOS 11 or later. Same default logins as below.

First sign-in uses the default logins shown on the login screen:

| Role | Email | Password |
|---|---|---|
| Vet | `waleed@clinic.local` | `vet12345` |
| Assistant | `assistant@clinic.local` | `assist123` |

**Change both passwords right away in Settings → Users.** The login screen stops showing them after the first sign-in.

## Develop

```bash
npm install
npm run dev            # UI in the browser at http://localhost:5173 (data in IndexedDB)
npm start              # build + run the desktop app
SEED_DEMO=1 npm start  # same, with demo owners/pets/visits/invoices on a fresh database
npm run typecheck
```

Build the desktop binaries:

```bash
npm run dist:win       # on Windows (or CI): installer + portable exe in release/
npm run dist:mac       # on a Mac (or CI): universal dmg in release/ (ad-hoc signed, not notarized)
```

The Mac build has to run on macOS (DMG tools and `codesign` exist only there); CI uses `macos-latest`.

On Linux, building the Windows installer needs Wine 32-bit (`wine32:i386`). Add `-c.win.signAndEditExecutable=false` when the exe icon/metadata step fails under Wine. CI (`.github/workflows/windows.yml`) builds on `windows-latest` and smoke-tests the exe.

End-to-end walkthrough (screenshots of every screen, checks the acceptance paths):

```bash
npm run build && xvfb-run -a node scripts/walkthrough.mjs screenshots
```

## Layout

| Path | What |
|---|---|
| `electron/main.cjs` | Desktop shell (Windows + macOS): database file, daily backups, save/open dialogs, opens WhatsApp/links externally, Mac menu |
| `build/mac-adhoc-sign.cjs` | Mac build hook: ad-hoc signs the app so Apple-chip Macs will run it (remove once there is a Developer ID) |
| `electron/preload.cjs` | The only bridge from UI to disk |
| `src/db/schema.ts` | SQLite version of `DATABASE.md` (money in piastres, enums as CHECKs) |
| `src/db/repo.ts` | Every query and write. Writes are transactional and append to `audit_log` |
| `src/db/seed.ts` | Base seed (users, vaccine catalogue, price list, clinic settings) + demo data |
| `src/screens/*` | The 8 screens + login |
| `src/lib/whatsapp.ts` | The one integration: `wa.me` click-to-chat templates |
| `src/i18n/{ar,en}.json` | All UI text |
| `import/TEMPLATE.md` | Columns for the owners/pets import sheet |

## Screens → routes

| Route | Screen |
|---|---|
| login | Login (both roles) |
| `#/` | 1 Dashboard: today's appointments, vaccinations due in 7 days, quick search, New visit |
| `#/owners`, `#/owners/new` | 2 Owners: search/filter, add/edit, duplicate-phone warning, call/WhatsApp |
| `#/owners/:id` | 3 Owner detail: pets (deceased greyed), open invoices, balance |
| `#/pets/:id?tab=timeline\|vaccinations\|weight\|files` | 4 Pet record + print summary |
| `#/pets/:id/visits/new`, `#/visits/:id/edit` | 5 Visit: prescriptions, vaccinations (auto next-due), follow-up appointment, local draft |
| `#/appointments?view=day\|week` | 6 Appointments: create/reschedule, done → new visit, no-show, overlap warning |
| `#/invoices`, `#/invoices/:id`, `#/invoices/:id/print` | 7 Invoices: price-list lines, discount, cash/InstaPay/card payments, A5 receipt |
| `#/settings` | 8 Settings (vet only): clinic, prices, vaccines, users, Excel/CSV export, backup/restore, import |
