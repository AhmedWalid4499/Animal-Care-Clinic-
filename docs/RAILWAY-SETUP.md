# Linking the app to Railway — what Ahmed does

Written 4 Nov 2026 from Railway's own docs (github.com/railwayapp/docs). Button names are Railway's; if the dashboard has moved something, tell me what you see.

There are two stages:
- **Stage 1** (now, about 10 minutes) sets up the database.
- **Stage 2** (after I push the server code) connects the GitHub repo.

Don't connect the repo yet. Today the repo only builds the desktop app, so Railway would try to start it, fail, and keep retrying, and those retries use up paid usage.

You don't need to give me any password, token or Railway access. Railway deploys straight from GitHub, and the app makes its own secrets the first time it starts.

---

## Stage 1 — now: project + database

1. **Check your plan.** Open the [Plans page](https://railway.com/workspace/plans) and make sure your workspace is on **Hobby** ($5/month, which includes $5 of usage). The free trial is limited to 1 GB RAM and 5 services per project.
2. **Set Europe as your default region.** Open your workspace / account settings (railway.com/workspace) and set the preferred region to **EU West Metal — Amsterdam, Netherlands**. New services then start there. The scope keeps patient data in an EU region.
3. **Create the project.** On the dashboard, click **New Project** → **Empty project**. Rename it to `animal-care-clinic` (project **Settings**).
4. **Add the database.** On the project canvas, click **`+ New`** (or press `Ctrl/⌘ + K`) → **Database** → **PostgreSQL**.
5. **Check its region.** Click the **Postgres** service → **Settings** → **Region**. It should say **EU West Metal**; if not, pick it now, while it's still empty.
6. **Backups: nothing to do on Hobby.** Railway's scheduled backups (the **Backups** tab) need the **Pro** plan; on Hobby the tab only lists existing backups (checked with Ahmed, 4 Nov). Our backups come from the app itself, see "Backups" below.
7. **Tell me when it's done.** Nothing to copy or send.

## Stage 2 — when I say the server is ready (Phase 1 merged)

The repo will then contain a `railway.json`, so Railway knows how to build and start the server and which health check to use. You only click:

1. **Add the app.** On the canvas, click **`+ New`** → **GitHub Repo** → pick **AhmedWalid4499/Animal-Care-Clinic-**. If Railway asks to link GitHub or install its GitHub app, allow it for this repository. Choose **Add variables**, not Deploy Now.
2. **Variables.** In the new service, open the **Variables** tab → **RAW Editor** and paste:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ADMIN_EMAIL=<your email>
   ADMIN_PASSWORD=<a temporary password, at least 12 characters>
   FILES_DIR=/data
   ELECTRON_SKIP_BINARY_DOWNLOAD=1
   ```
   `ELECTRON_SKIP_BINARY_DOWNLOAD=1` stops the build from downloading the desktop app's 100 MB engine, which the server doesn't need.
   `${{Postgres.DATABASE_URL}}` is Railway's reference syntax: it links the app to the database from Stage 1. `ADMIN_EMAIL` / `ADMIN_PASSWORD` create the first Admin account on first start. Change the password in the app afterwards; the app ignores these two variables once an Admin exists.
3. **Region.** Click the app service → **Settings** → **Region** → **EU West Metal**.
4. **Storage for X-rays and lab files.** Right-click the canvas (or press `Ctrl/⌘ + K`) → **Volume**, connect it to the app service, and set the mount path to **`/data`**.
5. **Branch.** App service → **Settings** → **Source**: trigger branch **`main`**. If you see **Wait for CI**, turn it on, so Railway only deploys after the Windows and Mac builds pass.
6. **Public address.** App service → **Settings** → **Networking** → **Generate Domain**. You get `https://<something>.up.railway.app`, with free SSL. Send me that address.
7. **Deploy.** Click **Deploy** at the top of the canvas. The first build takes a few minutes. When the deployment shows **Active**, open the address and sign in with `ADMIN_EMAIL`.

After that, every merge to `main` deploys by itself, the same way the desktop apps already update.

## Stage 3: connect the laptops (about 2 minutes each)

The desktop app needs version 0.1.6 or later, which installs itself through auto-update.

1. **First laptop: the one with the clinic's records.** On the sign-in screen, click **Connect to clinic server** (الاتصال بخادم العيادة), paste the `https://….up.railway.app` address, and click **Connect**. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. This laptop uploads its records to the empty clinic.
   - The demo logins `waleed@clinic.local` / `assistant@clinic.local` are switched off on the server if they still have their default passwords.
2. **Users.** On that laptop, open **Settings → Users** and add everyone with their own email and role (**Admin**, **Doctor** or **Assistant**).
3. **Other laptops.** Click **Connect to clinic server**, paste the same address, and sign in with that person's own email. The laptop downloads the clinic's records.
   - Its old local records are saved first as a backup file in its data folder.
4. **Check it works.** The sidebar shows a green dot with **Synced** and the time. Add something on one laptop, and it appears on the others within a second or two.

## Can't sign in?

- **The test logins** (`waleed@clinic.local` / `vet12345`, `assistant@clinic.local` / `assist123`) only work on a laptop that is not connected to the clinic server. The server switches them off when the first laptop connects.
- **"Too many attempts. Wait a few minutes."** After 10 wrong passwords in 5 minutes from the clinic's internet address, sign-in is refused, even with the right password. Wait 5 minutes.
- **Admin password lost** (or the one in Railway no longer works because it was changed in the app):
  1. Railway → app service → **Variables** → **New Variable**: `ADMIN_RESET_PASSWORD` = a new temporary password, at least 8 characters. Check that `ADMIN_EMAIL` is your email.
  2. Railway redeploys by itself. Wait until the deployment shows **Active**.
  3. Sign in with `ADMIN_EMAIL` and that temporary password. The app asks you to choose your own password.
  4. Delete `ADMIN_RESET_PASSWORD` from the variables. It works only once per value: a later restart doesn't reset the password again.

  The reset also makes that account an active Admin again, and signs it out on every other device.

## Backups

| Layer | Where | Plan needed |
|---|---|---|
| Full copy on every laptop | Each desktop app keeps the whole database locally, plus its daily backup file (last 14) | none |
| Nightly copy on the server's volume | Every night after 02:00 (Cairo) the server saves the whole database to `/data/backups` (last 14) | Hobby is enough |
| Nightly copy kept away from Railway | The same backup goes to a storage bucket (Cloudflare R2 below; Backblaze B2 or AWS S3 also work), last 30 days, plus every file (X-ray, lab PDF) once. Restore tested by `scripts/sync-test.mjs` (SCOPE §7.7) | Hobby; R2 is free up to 10 GB |
| Railway scheduled backups + point-in-time recovery | Postgres and volume **Backups** tab | **Pro** ($20/month incl. $20 usage). Optional |

The app shows the state in **Settings → Data & backup → Clinic server backup**: last backup, whether it is kept off-site, and whether files are on the volume. **Back up now** and **Download a copy** are there too (Admin only).

### Set up the off-site bucket (Cloudflare R2, about 10 minutes, once)

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (a free account is fine) → **R2 Object Storage**. The first time, Cloudflare asks you to turn R2 on and may ask for a payment card even for the free tier.
2. **Create bucket** → name `animal-care-clinic-backups` → location: **Automatic** (or Eastern Europe) → **Create**.
3. Back on the R2 page → **Manage API tokens** (or **API** → **Manage API tokens**) → **Create API token** → permissions **Object Read & Write** → apply to **Specific bucket** `animal-care-clinic-backups` → **Create**. Copy the **Access Key ID**, the **Secret Access Key** and the **S3 endpoint** (`https://<account id>.r2.cloudflarestorage.com`). The secret is shown only once.
4. Railway → app service → **Variables** → add:
   ```
   BACKUP_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
   BACKUP_S3_BUCKET=animal-care-clinic-backups
   BACKUP_S3_KEY_ID=<Access Key ID>
   BACKUP_S3_SECRET=<Secret Access Key>
   ```
   (`BACKUP_S3_REGION` is `auto` for R2 and can be left out.)
5. When the deployment is **Active**: in the app, **Settings → Data & backup → Back up now**. It should say **Kept off-site: Yes, in the backup bucket**. In Cloudflare the bucket now holds `db/backup-<date>.json.gz` and a `files/` folder.

### Restore after a disaster (database or volume lost)

1. Railway → **+ New** → **Database** → **PostgreSQL** (a new, empty database). If the volume is gone too, add a new one at `/data`.
2. App service → **Variables**: point `DATABASE_URL` at the new database (`${{Postgres-xxxx.DATABASE_URL}}`) and add `RESTORE_FROM=latest` (or a date such as `2026-11-05`).
3. Wait for **Active**. The deploy log says `restored N rows … from the backup of …`; files come back from the bucket in the background.
4. Delete `RESTORE_FROM` from the variables.
5. Nothing to do on the laptops: they stay signed in, notice the restore, and send back anything entered after the backup was taken. Then every laptop has the same records again.

### Live check (optional, from GitHub)

The **Live check** job (`.github/workflows/live-check.yml`) looks at the real address every morning without changing any record: server health, the web app, installable on Android, and, with an Admin sign-in, sync and last night's backup. GitHub emails you if it fails.

1. In the app, add a user **Live check** with the **Admin** role (Settings → Users) and sign in once with it to choose its password.
2. GitHub → the repository → **Settings → Secrets and variables → Actions** → **New repository secret**: `LIVE_EMAIL` and `LIVE_PASSWORD` with that user's email and password.
3. **Actions → Live check → Run workflow** to try it now. The summary lists each check.

## Phones

1. On the phone, open `https://animal-care-clinic-production.up.railway.app` in **Chrome** (Android) or **Safari** (iPhone) and sign in.
2. **Android:** tap **Install the app** in the banner (or Chrome's ⋮ menu → **Install app**). **iPhone:** tap **Share** → **Add to Home Screen**.
3. Open it from the home screen. It works without a connection once signed in, and the bell can turn on notifications for the phone.

## Later

- **Handing it to Dr. Waleed:** Railway can transfer a project to another user. Add him as a member of the project, then click the three dots next to his name → **Transfer Ownership**. Both accounts need an active Hobby or Pro plan.
- **Your own domain:** app service → **Settings** → **Networking** → custom domain. Railway shows a `CNAME` and a `TXT` record to add at your domain provider; both are required.
- **Cost check:** Railway shows usage per service. Expect about $5–10/month at three laptops and one phone. Look again after the first month.
