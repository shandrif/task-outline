#!/usr/bin/env node
// Sync stores + Area Manager / ROM / Region / City from the "AM & ROM Mapping" sheet into D1.
// Usage: node scripts/sync-mapping.mjs <file.tsv|file.json> [--local] [--dry-run]
//   .tsv  = the sheet's cell values, tab-separated (header row must contain Code, Branch, Area Manager)
//   .json = [{code,branch,area_manager,rom,region,city}]
// Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (CLOUDFLARE_API_KEY accepted) unless --local.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DB = "hm-staff-evaluation-eu";
const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error("Usage: node scripts/sync-mapping.mjs <file.tsv|file.json> [--local] [--dry-run]"); process.exit(1); }
const local = flags.includes("--local"), dry = flags.includes("--dry-run");

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const q = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

function parse(text) {
  if (file.endsWith(".json")) return JSON.parse(text).map((r) => ({ code: clean(r.code), branch: clean(r.branch), area_manager: clean(r.area_manager), rom: clean(r.rom), region: clean(r.region), city: clean(r.city) }));
  const lines = text.split(/\r?\n/).map((l) => l.split("\t").map(clean));
  const hi = lines.findIndex((c) => c.some((x) => /^code$/i.test(x)) && c.some((x) => /^branch$/i.test(x)) && c.some((x) => /area\s*manager/i.test(x)));
  if (hi < 0) throw new Error("Header row (Code / Branch / Area Manager) not found");
  const col = (re) => lines[hi].findIndex((x) => re.test(x));
  const c = { code: col(/^code$/i), branch: col(/^branch$/i), am: col(/area\s*manager/i), rom: col(/^rom$/i), region: col(/^re[gi]+on$/i), city: col(/^city$/i) };
  return lines.slice(hi + 1).map((r) => ({ code: r[c.code], branch: r[c.branch], area_manager: r[c.am], rom: r[c.rom], region: r[c.region], city: r[c.city] }));
}

const rows = parse(readFileSync(file, "utf8"))
  .filter((r) => r.branch && r.area_manager)
  .filter((r) => !/\b(NSO|EVENTS?)\b/i.test(r.branch)); // "NSO & EVENTS" is a team, not a store
// Store ID = branch code (B26). A few branches have no code: use the branch name instead.
for (const r of rows) r.id = (r.code || r.branch).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const dup = rows.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) throw new Error(`Duplicate Store IDs in file: ${[...new Set(dup)].join(", ")}`);
if (rows.length < 20) throw new Error(`Only ${rows.length} stores found — refusing to sync (file looks wrong)`);

const env = { ...process.env };
env.CLOUDFLARE_API_TOKEN ||= env.CLOUDFLARE_API_KEY;
env.NODE_USE_ENV_PROXY ||= "1";
const where = local ? ["--local"] : ["--remote"];
const wr = (args) => execFileSync("npx", ["wrangler", ...args], { env, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], maxBuffer: 1 << 26 });
const query = (sql) => JSON.parse(wr(["d1", "execute", DB, ...where, "--json", "--command", sql]))[0].results;

const existing = new Set(query("SELECT username FROM stores").map((r) => r.username.toUpperCase()));
const batch = randomUUID();
const added = rows.filter((r) => !existing.has(r.id)).length, updated = rows.length - added;
const sql = [
  ...rows.map((r) => `INSERT INTO stores (name,code,username,area_manager,rom,region,city,sync_batch) VALUES (${q(r.branch)},${q(r.id)},${q(r.id)},${q(r.area_manager)},${q(r.rom)},${q(r.region)},${q(r.city)},${q(batch)})
ON CONFLICT(username) DO UPDATE SET name=excluded.name, code=excluded.code, area_manager=excluded.area_manager, rom=excluded.rom, region=excluded.region, city=excluded.city,
  active=CASE WHEN stores.sync_disabled=1 THEN 1 ELSE stores.active END, sync_disabled=0, sync_batch=excluded.sync_batch;`),
  // stores that were synced before but are no longer in the file are disabled (history is kept)
  `UPDATE stores SET active=0, sync_disabled=1 WHERE sync_batch IS NOT NULL AND sync_batch<>${q(batch)} AND active=1;`,
  `INSERT INTO sync_log (source,total,added,updated,disabled) VALUES ('AM & ROM Mapping',${rows.length},${added},${updated},(SELECT COUNT(*) FROM stores WHERE sync_disabled=1));`,
].join("\n");

console.log(`${rows.length} stores in file · ${added} new · ${updated} existing`);
if (dry) { console.log(sql.split("\n").slice(0, 4).join("\n")); process.exit(0); }
const f = join(mkdtempSync(join(tmpdir(), "sync-")), "sync.sql");
writeFileSync(f, sql);
wr(["d1", "execute", DB, ...where, "--file", f]);
const [t] = query("SELECT COUNT(*) total, SUM(active) active, SUM(sync_disabled) disabled FROM stores");
console.log(`Done. Stores in database: ${t.total} (${t.active} active, ${t.disabled} disabled because they left the file)`);
