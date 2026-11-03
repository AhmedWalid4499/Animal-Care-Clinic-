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

No server needed. Internet is used only to open WhatsApp and to fetch app updates. Backups and Excel export are under **Settings → Data & backup**.

## Install on the clinic PC

Download the latest version from **[Releases](https://github.com/AhmedWalid4499/Animal-Care-Clinic-/releases/latest)**. A test build of any PR is under **Actions → Windows build → artifact `animal-care-clinic-windows`**.

- `AnimalCareClinic-Setup-<version>.exe`: the installer, with Start-menu and desktop shortcuts. **Updates itself** (see *Updates* below).
- `AnimalCareClinic-<version>-portable.exe`: a single exe that runs without installing (for a USB stick or a trial). It can't update itself; it only tells you when a new version is out.

The build is not code-signed yet, so Windows SmartScreen will warn on first run: click **More info → Run anyway**.

## Install on a Mac (for testing)

Download `AnimalCareClinic-<version>-mac.dmg` from **[Releases](https://github.com/AhmedWalid4499/Animal-Care-Clinic-/releases/latest)**. A test build of any PR is under **Actions → macOS build → artifact `animal-care-clinic-macos`** (unzip it to get the dmg). Or build locally with `npm run dist:mac`.

1. Open the `.dmg` and drag **Animal Care Clinic** into **Applications**.
2. First launch only: in Applications, **right-click (or Control-click) the app → Open → Open**. macOS warns because the app has no Apple Developer ID yet; after this it opens normally.
   - On macOS 15 (Sequoia) and later, if there is no Open button: try to open it once, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
   - If macOS says the app "is damaged", run this once in Terminal, then open it again: `xattr -cr "/Applications/Animal Care Clinic.app"`

The dmg is universal: it runs on Apple-chip (M1–M4) and Intel Macs, macOS 11 or later. Same default logins as below. Run it from **Applications** (not from the open dmg) or it can't update itself. If it is started from the dmg, or macOS runs a temporary copy of a downloaded app, it offers **Move to Applications** at start (also under Settings → Data & backup → Updates) and moves and reopens itself.

## Updates

Every merge to `main` publishes a new version to [Releases](https://github.com/AhmedWalid4499/Animal-Care-Clinic-/releases) (`.github/workflows/release.yml`, version `0.1.<run number>`). Installed apps on Windows and Mac pick it up by themselves:

- With **Settings → Data & backup → Updates → Update automatically** on (the default), the app checks when it opens and every 4 hours, then downloads the update in the background.
- When the update is ready, a bar at the top says so: **Restart and update** now, or **Later**. With Later, it installs the next time the app is closed.
- **Check for updates now** works whether or not automatic updates are on.
- Clinic data is never replaced: it lives outside the app (see the folders above). As a precaution, a copy `backups/clinic-before-update-<old>-to-<new>.sqlite` is taken before every update (the last 5 are kept).

How it works: on Windows `electron-updater` runs the new installer silently. On the Mac, `electron/updater.cjs` downloads the zip, checks its SHA-512 against `latest-mac.yml`, verifies the signature and swaps the app after it quits; if the swap fails, the old app is put back. Apple's own updater can't be used without an Apple Developer ID. To publish a bigger version jump, raise `major.minor` in `package.json` (for example `0.2.0`); the patch number always comes from CI.

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
| `electron/updater.cjs` | Automatic updates from GitHub Releases (Windows: electron-updater; Mac: download, verify, swap) |
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
