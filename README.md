# HM Staff Knowledge Evaluation

Web app for evaluating staff knowledge against the HM SBS task outline (Feb 2026): **Cleaner, Cashier, Beverages, Barista, Manager** — 343 questions in 59 sections, loaded from the Excel workbook.

Stack: Cloudflare Workers (API + static front end) · Cloudflare D1 (database) · plain JS front end, HM brand theme (no build step).

## What it does
- **Admin** (`admin` + password): dashboard, add/edit/reorder/remove questions, sections and positions, upload the store list (Excel/CSV) to create one login per store, reset store passwords, view/export every evaluation.
- **Stores**: sign in, pick a position + staff member, answer every question (*Received training* Yes/No, *Performed* Yes/No), autosave, submit, see the score by section, print or download as Excel.
- Scoring follows the workbook: each *Performed = Yes* scores 1; section % and overall % = score ÷ number of questions. Sections can be marked *Not applicable* (excluded from scoring).

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

## Changing the questions
Use the **Questions** page in the admin area. To reload from a new workbook: `XLSX=path/to/file.xlsx npm run seed:rebuild` and re-seed a *fresh* database (the seed does not merge into existing data).

## Security notes
- Passwords are PBKDF2-hashed; generated passwords are shown once. Resetting a password or disabling a store signs out its devices immediately.
- Sessions are signed HttpOnly cookies; login is rate-limited (8 failures / 15 min per username).
- Removing a question/section/position only hides it, so past evaluations keep their answers and scores.
