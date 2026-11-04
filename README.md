# HM Training Division

Trainers visit stores and evaluate staff against the HM SBS task outline (Feb 2026): **Cleaner, Cashier, Beverages, Barista, Manager** — 343 questions in 59 sections, loaded from the Excel workbook.

Stack: Cloudflare Workers (API + static front end) · Cloudflare D1 (database) · plain JS front end in the HM brand theme (no build step) · the liquid navbar is a small React island (`npm run build:nav`).

## How it works
**Trainers** create their own account on the sign-in page (name, employee ID, designation, password). The admin approves them. A trainer then:
1. starts a **store visit** (searchable dropdown of the saved stores),
2. adds any number of **staff evaluations** in that visit (staff name + position; the questions match the position; autosave),
3. writes **areas for improvement** per evaluation and notes (and an optional follow-up) per visit, then finishes the visit.

There is no monthly limit — trainers can visit and evaluate as often as needed.

**Admin** (`admin` + password):
- **Dashboard** — visits, stores visited and coverage %, evaluations, average score, per-trainer table, weakest training areas, trainers' notes, roll-up by area manager / ROM / region / city, and stores by last visit (never / over 90 days…). Period filter (today, 7/30 days, this month, custom).
- **Trainers** — approve/reject sign-ups, disable, reset password, edit; click a trainer for every visit, stores, staff, scores and notes.
- **Visits** — all visits and all staff evaluations, sortable/filterable, Excel export, delete.
- **Stores** — add, rename, edit or disable any store. Area manager / ROM / region / city refresh weekly from the shared mapping file; stores edited or added by hand are never overwritten.
- **Questions** — add, edit, reorder, remove tasks, sections and positions.

Scoring follows the workbook: each *Performed = Yes* scores 1; section % and overall % = score ÷ number of questions. Sections can be marked *Not applicable*.

## Deploy to Cloudflare
```bash
npm install
export CLOUDFLARE_ACCOUNT_ID=...   # your account id
export CLOUDFLARE_API_TOKEN=...    # token with Workers + D1 edit permission
npm run setup:cloud                # creates D1, schema, questions, deploys, sets secrets
```
It prints the URL and the generated admin password (also written to `credentials-admin.txt`, git-ignored).

## Run locally
```bash
npm install
printf 'SESSION_SECRET=%s\nADMIN_PASSWORD=choose-one\n' "$(openssl rand -hex 32)" > .dev.vars
npm run setup:local && npm run dev   # http://localhost:8787
```

## Weekly store sync
`node scripts/sync-mapping.mjs <mapping.tsv|json> [--local] [--dry-run]` upserts stores and their Area Manager / ROM / Region / City from the mapping sheet (header row must contain Code, Branch, Area Manager). Stores edited by hand keep their details; stores added by hand are never disabled; stores that leave the file are disabled, not deleted; "NSO & EVENTS" is skipped.

## Security notes
- Trainer passwords are PBKDF2-hashed (the iteration count is stored in each hash and kept moderate for the Workers Free CPU limit; passwords need 8+ characters with a letter and a number). 8 failed sign-ins lock an employee ID for 15 minutes; sign-ups are rate-limited per device.
- New trainers cannot sign in until the admin approves them. Disabling a trainer or resetting a password signs them out immediately.
- Sessions are signed HttpOnly cookies. Trainers only ever see their own visits and evaluations.
- Removing a question/section/position only hides it, so past evaluations keep their answers and scores.

## Cloudflare free-plan notes
Typical load is far below the free limits (Workers 100,000 requests/day · D1 5 million rows read and 100,000 rows written per day · 10 ms CPU per request). The reports are built to stay cheap as data grows: date-range indexes, one grouped pass instead of per-trainer sub-queries, "last visit" stored on the trainer/store row, weakest areas based on the latest 2,000 evaluations in the period, lists that load the newest 300 rows first, and a 30-day default period. Sign-in hashing uses a secret pepper plus a light PBKDF2 so it fits the CPU limit; raise `PBKDF2_ITERS` in `src/worker.js` if you move to the paid plan.

## Six areas (Onboarding · NPD · Verification · Store visit · Training/Coaching · People development)

- **Master dashboard** (`#/home`): one card per area, team activity (admin) and latest activity. Trainers see only their own numbers.
- **Onboarding** (HM / External / International), **NPD**, **Training/Coaching**, **People development** (5 tracks): generic records in the `records` table. Fields are defined once in `src/modules.js` and the forms/tables are built from it. Onboarding verification % = average of theory % and practical %. Trainers add/edit/delete their own records; the admin sees and edits everything.
- **Verification**: the original SBS evaluation. Barista and Beverages are now one position, **Barista verification**, with a search bar for drinks (migration `0008`, existing evaluations keep their answers).
- **Store visit** reports (`sv_reports`): the Half Million Store Visit Report form — readiness, quality check, team performance, highlights, action plan, overall assessment, printable as PDF.

## Store mapping sync

The weekly sync reads the shared **Master_Location_Mapping.xlsx** (sheet `Location_Mapping`): `node scripts/sync-mapping.mjs <file.tsv> --master [--dry-run]`.
Existing stores get only their **Area Manager and ROM** updated (name, region and city stay as maintained here); stores that are new to the app are added with the file's name, region and city;
nothing is ever disabled; stores locked by hand in the admin Stores page are skipped. `B01` and `B1` are treated as the same store. A scheduled task runs it every Sunday ~07:07 (Riyadh).
