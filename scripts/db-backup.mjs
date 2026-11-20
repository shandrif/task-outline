#!/usr/bin/env node
// Full backup of the live D1 database "hm-staff-evaluation-eu" (read-only: SELECT statements only).
// Writes <outdir>/hm-backup-YYYY-MM-DD.json.gz containing the schema, every table's rows and a checksum per table.
// Usage: node scripts/db-backup.mjs [outdir]
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (CLOUDFLARE_API_KEY accepted). Never prints them.
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DB_ID = "7da39df4-a4ee-435a-be06-0653f8a1873a", DB_NAME = "hm-staff-evaluation-eu";
const ACC = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY;
if (!ACC || !TOKEN) { console.error("FAILED: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are needed"); process.exit(1); }
const outDir = process.argv[2] || ".";
const URL_Q = `https://api.cloudflare.com/client/v4/accounts/${ACC}/d1/database/${DB_ID}/query`;

async function q(sql, params = []) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(URL_Q, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ sql, params }) });
      const d = await r.json();
      if (!d.success) throw new Error(JSON.stringify(d.errors || d).slice(0, 300));
      return d.result[0].results;
    } catch (e) { if (attempt >= 4) throw e; await new Promise((s) => setTimeout(s, attempt * 2000)); }
  }
}
const sum = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

const schema = await q("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE '_cf_%' ORDER BY type DESC, name");
const names = schema.filter((s) => s.type === "table").map((s) => s.name);
const tables = {}, counts = {}, checksums = {};
const PAGE = 2000;
for (const t of [...names, "sqlite_sequence"]) {
  if (tables[t]) continue;
  const total = (await q(`SELECT COUNT(*) AS n FROM "${t}"`))[0].n;
  const rows = [];
  for (let off = 0; off < total; off += PAGE) rows.push(...(await q(`SELECT * FROM "${t}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${off}`)));
  if (rows.length !== total) { console.error(`FAILED: ${t} returned ${rows.length} of ${total} rows`); process.exit(1); }
  tables[t] = rows; counts[t] = rows.length; checksums[t] = sum(rows);
}
const now = new Date();
const riyadh = new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 10);   // date in Riyadh (UTC+3)
const backup = { app: "HM Training Division", database: DB_NAME, format: 1, created_at: now.toISOString(), counts, checksums, schema, tables };
const gz = gzipSync(JSON.stringify(backup), { level: 9 });
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `hm-backup-${riyadh}.json.gz`);
writeFileSync(file, gz);
const rows = Object.entries(counts).filter(([t]) => t !== "sqlite_sequence").reduce((n, [, v]) => n + v, 0);
console.log(`OK ${file}`);
console.log(`bytes ${gz.length} · tables ${names.length} · rows ${rows}`);
for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(18)} ${n}`);
