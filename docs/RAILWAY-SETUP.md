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
6. **Turn on database backups.** Click the **Postgres** service → **Backups** tab → turn on the **Daily** schedule (each backup is kept 6 days) and the **Weekly** schedule (kept 27 days). Our own nightly copy, kept away from Railway, comes in Stage 2.
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
   ```
   `${{Postgres.DATABASE_URL}}` is Railway's reference syntax: it links the app to the database from Stage 1. `ADMIN_EMAIL` / `ADMIN_PASSWORD` create the first Admin account on first start. Change the password in the app afterwards; the app ignores these two variables once an Admin exists.
3. **Region.** Click the app service → **Settings** → **Region** → **EU West Metal**.
4. **Storage for X-rays and lab files.** Right-click the canvas (or press `Ctrl/⌘ + K`) → **Volume**, connect it to the app service, and set the mount path to **`/data`**. Then the app service's **Backups** tab → **Daily** + **Weekly**.
5. **Branch.** App service → **Settings** → **Source**: trigger branch **`main`**. If you see **Wait for CI**, turn it on, so Railway only deploys after the Windows and Mac builds pass.
6. **Public address.** App service → **Settings** → **Networking** → **Generate Domain**. You get `https://<something>.up.railway.app`, with free SSL. Send me that address.
7. **Deploy.** Click **Deploy** at the top of the canvas. The first build takes a few minutes. When the deployment shows **Active**, open the address and sign in with `ADMIN_EMAIL`.

After that, every merge to `main` deploys by itself, the same way the desktop apps already update.

## Later

- **Handing it to Dr. Waleed:** Railway can transfer a project to another user. Add him as a member of the project, then click the three dots next to his name → **Transfer Ownership**. Both accounts need an active Hobby or Pro plan.
- **Your own domain:** app service → **Settings** → **Networking** → custom domain. Railway shows a `CNAME` and a `TXT` record to add at your domain provider; both are required.
- **Cost check:** Railway shows usage per service. Expect about $5–10/month at three laptops and one phone. Look again after the first month.
