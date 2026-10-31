# HM Staff Knowledge Evaluation

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
