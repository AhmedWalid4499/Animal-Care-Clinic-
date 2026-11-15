# Chromebook app

Added 14 Nov 2026 at Ahmed's request. A Chromebook runs the clinic app as an **installed web app**: it is
served by the clinic server (`https://animal-care-clinic-production.up.railway.app`), installs from Chrome in
one click, and then opens in its own window with an icon on the shelf, like any other Chromebook app. It
works on every Chromebook (Intel or ARM, personal or school/managed), with no Linux mode or Play Store.

> **Scope note:** a Chromebook client is not in `SCOPE.md §4`. It is the same web app the scope already plans
> for phones (PWA), tuned for a laptop. Confirm it with Dr. Waleed as part of the open change request.

## For the clinic: install it (2 minutes)

**English**

1. On the Chromebook, open **Chrome** and go to the clinic address:
   `animal-care-clinic-production.up.railway.app`
2. Sign in with your clinic email and password (the Admin sends them from Settings → Users).
3. Click **Install the app** in the banner at the top. (Or the install icon at the right end of the address
   bar, or Chrome menu ⋮ → *Cast, save and share* → *Install*.)
4. The app opens in its own window. Right-click its shelf icon → **Pin** to keep it there.
   Right-click it again to jump straight to **New visit**, **New owner**, **Appointments** or **Invoices**.

**العربية**

1. على الكروم بوك افتح **Chrome** واذهب إلى عنوان العيادة:
   `animal-care-clinic-production.up.railway.app`
2. سجّل الدخول ببريدك وكلمة المرور (يرسلها المدير من الإعدادات ← المستخدمون).
3. اضغط **تثبيت التطبيق** في الشريط أعلى الصفحة (أو أيقونة التثبيت في نهاية شريط العنوان، أو القائمة ⋮ ← الإرسال والحفظ والمشاركة ← تثبيت).
4. يفتح التطبيق في نافذة خاصة به. اضغط بزر الفأرة الأيمن على أيقونته في الرف ← **تثبيت** لإبقائها هناك،
   ومن نفس القائمة تصل مباشرة إلى **زيارة جديدة** أو **مالك جديد** أو **المواعيد** أو **الفواتير**.

## What it does on a Chromebook

| | |
|---|---|
| Layout | The laptop layout (sidebar, wide tables) from 900 px wide; the phone layout in a narrow window or in tablet mode portrait. No orientation lock. |
| Offline | After the first sign-in the records live on the Chromebook; it opens and works with no connection and sends the work when it is back (same as phones, `docs/CLOUD-PLAN.md` Phase 2). Asks Chrome to keep the records for good (`navigator.storage.persist()`); Settings → **Updates** (or **Settings** for Doctors and Assistants) shows whether it does. |
| One window | Only one window can have the records open: a second window or tab shows "open in another window" with **Use it here**, and the first one saves and steps aside. Opening the installed app again focuses its window. Stops two copies of the database overwriting each other. |
| Shelf shortcuts | New visit, New owner, Appointments, Invoices (manifest `shortcuts`); they open in the window already open. |
| Keyboard | **Ctrl+K** (or **/**) jumps to search from any screen. |
| Notifications | Web Push, also when the app is closed (as on phones). |
| Printing | Receipts and pet summaries print through ChromeOS printing (A5 print CSS as on the desktop). |
| Files | Exports and the backup file go to **Downloads**. X-rays and lab files up to 10 MB are kept on the Chromebook so they open offline (phones: 2 MB). |
| Updates | Every deploy to Railway is picked up the next time the app opens. If it stays open (a Chromebook mostly sleeps), it checks `/version.json` every 30 min and when it wakes, and shows **A new version is ready · Reload**. Nothing entered is lost. |
| Devices list | Shows as **Chromebook** in Settings → Devices, so the Admin can sign it out if lost. |

What it does **not** have, compared with the Windows/Mac app: the daily local `.sqlite` copies in a data folder
(the server's nightly backup covers it), the tray icon, and working with no clinic server at all.

## How it is built

| Piece | Where |
|---|---|
| Device detection (`CrOS` in the user agent / `userAgentData`), device name, file prefetch size | `src/lib/platform.ts` (`deviceKind`, `isChromebook`, `isLaptopLike`), `src/sync/engine.ts` |
| Manifest: no orientation lock, `shortcuts`, `launch_handler: focus-existing`, `screenshots` (wide + narrow), `categories` | `public-cloud/manifest.webmanifest`, pictures from `scripts/install-screenshots.mjs` |
| Shortcut / relaunch routed to the open window (`launchQueue`) | `LaunchHandler` in `src/components/InstallPrompt.tsx` |
| Install banner and sidebar link, per device wording | `src/components/InstallPrompt.tsx` (`useInstall`, `installKind`) |
| One window at a time (Web Locks + BroadcastChannel; the old window stops saving first) | `src/lib/oneWindow.ts`, `stopPersisting()` in `src/db/core.ts`, `OpenElsewhere` in `src/main.tsx` |
| Web updates: build id baked in and written to `version.json` | `vite.config.ts` (`cloudVersion`), `src/lib/webUpdate.ts`, `UpdateBanner` in `src/components/Updates.tsx` |
| Settings → Updates (Admin) and My settings (everyone): This device | `src/components/ThisDevice.tsx` |
| Service worker: manifest fetched fresh, old caches dropped (`clinic-shell-v2`) | `public-cloud/sw.js` |
| Test | `scripts/sync-test.mjs` step **chromebook: installed app** (Chromebook user agent at 1366×768 against the real server + Postgres) |

To refresh the install pictures after a UI change: `npm run build:web && node scripts/install-screenshots.mjs`.
