#!/usr/bin/env node
// Turns a backup made by db-backup.mjs back into SQL, and can prove the backup is complete by loading it into a
// throw-away LOCAL copy of the database. It never touches the live database by itself.
//
//   node scripts/db-restore.mjs <backup.json.gz> --verify      load into a temporary local database and compare every table
//   node scripts/db-restore.mjs <backup.json.gz> --sql out.sql  write the restore SQL (replaces all rows of every data table)
//
// Restoring the LIVE database is a deliberate, manual step done only on the owner's request, after a fresh backup:
//   npx wrangler d1 execute hm-staff-evaluation-eu --remote --file out.sql
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error("Usage: node scripts/db-restore.mjs <backup.json.gz> (--verify | --sql out.sql)"); process.exit(1); }
const raw = readFileSync(file);
const b = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
if (b.app !== "HM Training Division" || !b.tables) { console.error("FAILED: not an HM Training Division backup"); process.exit(1); }

// every table's rows must match the checksum taken when the backup was made
const sum = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
for (const [t, rows] of Object.entries(b.tables)) if (b.checksums?.[t] && sum(rows) !== b.checksums[t]) { console.error(`FAILED: ${t} is damaged (checksum mismatch)`); process.exit(1); }

// data tables (schema comes from migrations); parents before children using the foreign keys in the schema
const SKIP = new Set(["d1_migrations", "sqlite_sequence"]);
const tables = b.schema.filter((s) => s.type === "table" && !SKIP.has(s.name));
const deps = new Map(tables.map((s) => [s.name, [...s.sql.matchAll(/REFERENCES\s+"?(\w+)"?/gi)].map((m) => m[1]).filter((x) => x !== s.name)]));
const order = [], seen = new Set();
const visit = (t) => { if (seen.has(t) || !deps.has(t)) return; seen.add(t); deps.get(t).forEach(visit); order.push(t); };
[...deps.keys()].sort().forEach(visit);

const lit = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
function buildSql() {
  const L = ["PRAGMA defer_foreign_keys = on;"];
  for (const t of [...order].reverse()) L.push(`DELETE FROM "${t}";`);
  for (const t of order) for (const r of b.tables[t] || []) { const c = Object.keys(r); L.push(`INSERT INTO "${t}" (${c.map((x) => `"${x}"`).join(",")}) VALUES (${c.map((x) => lit(r[x])).join(",")});`); }
  L.push(`DELETE FROM sqlite_sequence;`);
  for (const r of b.tables.sqlite_sequence || []) L.push(`INSERT INTO sqlite_sequence (name, seq) VALUES (${lit(r.name)}, ${lit(r.seq)});`);
  return L.join("\n") + "\n";
}
const total = order.reduce((n, t) => n + (b.tables[t] || []).length, 0);
console.log(`backup ${file} · made ${b.created_at} · ${order.length} tables · ${total} rows · checksums OK`);

const at = rest.indexOf("--sql");
if (at >= 0) { const out = rest[at + 1]; if (!out) { console.error("--sql needs a file name"); process.exit(1); } writeFileSync(out, buildSql()); console.log(`OK restore SQL written to ${out}`); }

if (rest.includes("--verify")) {
  const dir = mkdtempSync(join(tmpdir(), "hm-verify-")), sqlFile = join(dir, "restore.sql");
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_API_KEY: "", CI: "1" };
  const w = (...a) => execFileSync("npx", ["wrangler", "d1", ...a, "hm-staff-evaluation-eu", "--local", "--persist-to", dir], { env, stdio: "pipe", maxBuffer: 1 << 28 }).toString();
  try {
    writeFileSync(sqlFile, buildSql());
    w("migrations", "apply");
    w("execute", "--file", sqlFile);
    let bad = 0;
    for (const t of order) {
      const out = w("execute", "--json", "--command", `SELECT * FROM "${t}" ORDER BY rowid`);
      const rows = JSON.parse(out)[0].results;
      const ok = sum(rows) === sum(b.tables[t] || []);
      if (!ok) { bad++; console.log(`  ✗ ${t}: restored ${rows.length}, backup ${(b.tables[t] || []).length}`); }
    }
    console.log(bad ? `VERIFY FAILED: ${bad} table(s) did not restore exactly` : `VERIFY OK: all ${order.length} tables restored exactly (${total} rows) into a temporary local copy`);
    if (bad) process.exitCode = 1;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
