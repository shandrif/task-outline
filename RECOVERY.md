# HM Training Division app: recovery guide

**App:** Cloudflare Worker `hm-staff-evaluation`
**Database:** Cloudflare D1 `hm-staff-evaluation-eu`
**Code:** GitHub `shandrif/task-outline`

## What protects the app

| Protection | What it covers | Where it lives | How long |
|---|---|---|---|
| **Code on GitHub** | Every version of the app's code | GitHub | Always |
| **Previous app versions** | A bad update to the website | Cloudflare (Workers → Deployments) | About the last 100 versions |
| **Database restore points (Time Travel)** | Any minute of the database | Cloudflare D1 | Last 7 days (free plan) |
| **Nightly backup email** | A full copy of all data | Admin's Outlook inbox (subject "HM Training app · data backup <date>") | As long as the emails are kept |

You can get an extra backup any time from **Verification → Dashboard**: scroll to the bottom, find **Data backup**, and click **Email a backup now**.

**Keep the backup emails.** Each attachment, `hm-backup-<date>.json.txt`, restores all app data as it was at that time. The file holds staff names and sign-in data, so don't forward it outside HM.

## Which recovery to use

| What happened | Do this | Backup file needed? | Time |
|---|---|---|---|
| The website broke after an update | **A. Roll back the app** | No | ~1 min |
| Data deleted or changed by mistake in the last 7 days | **B. Time Travel restore** | No | ~5 min |
| Database damaged or lost, or the problem is older than 7 days | **C. Restore from a backup email** | Yes | ~15 min |
| Cloudflare account lost | **D. Rebuild on a new account** | Yes | ~1 hour |

To start any of these, ask Claude Code (or a developer) and say what happened. For C or D, attach the backup file from the email.

## Technical steps (for the developer or Claude)

**Setup.** Run every command below from the repo root, with these set:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`, a token with Workers and D1 edit rights.

**Before changing the live database**, always take a fresh copy of it as it is now:

```bash
node scripts/db-backup.mjs backups-now
```

### A. Roll back the app (data is not touched)

```bash
npx wrangler deployments list
```

```bash
npx wrangler rollback <previous-version-id>
```

### B. Time Travel restore (last 7 days)

```bash
npx wrangler d1 time-travel info hm-staff-evaluation-eu --timestamp "2026-11-20T09:00:00+03:00"
```

```bash
npx wrangler d1 time-travel restore hm-staff-evaluation-eu --timestamp "2026-11-20T09:00:00+03:00"
```

The restore prints a bookmark for the state just before it ran. To undo the restore, run it again with `--bookmark <that bookmark>`.

### C. Restore from a backup email

1. Save the attachment, for example as `hm-backup-2026-11-20.json.txt`.
2. Check it is complete. This loads it into a temporary local database and compares every table; the live database is not touched:

   ```bash
   node scripts/db-restore.mjs hm-backup-2026-11-20.json.txt --verify
   ```

   It must end with `VERIFY OK`.

3. Take a fresh copy of the live database:

   ```bash
   node scripts/db-backup.mjs backups-now
   ```

4. Write the restore SQL. It replaces every row in every data table with the backup's rows:

   ```bash
   node scripts/db-restore.mjs hm-backup-2026-11-20.json.txt --sql restore.sql
   ```

5. Make sure the live database has the current tables:

   ```bash
   npx wrangler d1 migrations apply hm-staff-evaluation-eu --remote
   ```

6. Run the restore:

   ```bash
   npx wrangler d1 execute hm-staff-evaluation-eu --remote --file restore.sql
   ```

7. Open the app and check the Dashboard numbers against the backup email's table.

### D. Rebuild on a new Cloudflare account

1. Clone the GitHub repo. Create a D1 database:

   ```bash
   npx wrangler d1 create hm-staff-evaluation-eu
   ```

   Put the new `database_id` in `wrangler.jsonc`.

2. Apply the migrations:

   ```bash
   npx wrangler d1 migrations apply hm-staff-evaluation-eu --remote
   ```

3. Load the backup with steps C2, C4 and C6.

4. Deploy:

   ```bash
   npx wrangler deploy
   ```

5. Set `APP_URL` in `wrangler.jsonc` to the new address and deploy again.

6. Add the settings as **Secrets** in the Cloudflare dashboard (Worker → Settings → Variables and Secrets):
   - `SESSION_SECRET` and `PASSWORD_KEY`: use the old values if you still have them. A new `SESSION_SECRET` only signs everyone out. A new `PASSWORD_KEY` means every trainer's password must be reset by the admin, because it is part of how passwords are checked.
   - `ADMIN_PASSWORD`
   - `BREVO_API_KEY`
   - `BACKUP_TO`

   Never put these in `wrangler.jsonc` or in GitHub.

7. Re-add `training@hmreport.com` as a sender in Brevo if the Brevo account also changed.

## Helpful files

| File | What it does |
|---|---|
| `scripts/db-backup.mjs` | Full backup of the live database to a `.json.gz` file. Read-only. |
| `scripts/db-restore.mjs` | Checks a backup with `--verify` and writes restore SQL with `--sql`. Never touches the live database by itself. |
| `scripts/backup-xlsx.py` | Turns a backup into a readable HM-branded Excel file. Passwords are left out. |
| `src/backup.js` | The nightly backup email (02:17 Saudi time, set in `triggers` in `wrangler.jsonc`). |
