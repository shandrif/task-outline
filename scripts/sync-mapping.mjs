#!/usr/bin/env node
// Sync stores + Area Manager / ROM / Region / City from the "AM & ROM Mapping" sheet into D1.
// Stores an admin edited by hand (locked) keep their details; stores added by hand are never disabled.
// Usage: node scripts/sync-mapping.mjs <file.tsv|file.json> [--local] [--dry-run] [--master]
//   --master = the file is "Master_Location_Mapping" (header has SYRVE_CODE / AREA_MANAGER / ROM). Existing stores only get their
//              Area Manager and ROM updated (name, region and city stay as they are); stores new to the app are added with the
//              file's name, region and city; nothing is ever disabled.
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
const local = flags.includes("--local"), dry = flags.includes("--dry-run"), master = flags.includes("--master");

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

if (master) await runMaster();

async function runMaster() {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.split("\t").map(clean));
  const hi = lines.findIndex((c) => c.includes("SYRVE_CODE") && c.includes("AREA_MANAGER") && c.includes("ROM"));
  if (hi < 0) throw new Error("Header row (SYRVE_CODE / AREA_MANAGER / ROM) not found");
  const col = (n) => lines[hi].indexOf(n);
  const c = { code: col("SYRVE_CODE"), name: col("SPAN_BRANCH_NAME"), alt: col("BRANCHES_CODES_NAME"), am: col("AREA_MANAGER"), rom: col("ROM"), region: col("REGION"), city: col("CITY") };
  if (Object.values(c).some((i) => i < 0)) throw new Error("Expected columns are missing from the file");
  const norm = (x) => String(x).toUpperCase().replace(/^B0+(\d)/, "B$1");        // B01 and B1 are the same store
  const fileRows = lines.slice(hi + 1).filter((r) => /^B\d+$/i.test(r[c.code] || "") && r[c.am])
    .map((r) => ({ key: norm(r[c.code]), name: r[c.name] || r[c.alt], am: r[c.am], rom: r[c.rom], region: r[c.region], city: r[c.city] }));
  const dupKeys = fileRows.map((r) => r.key).filter((k, i, a) => a.indexOf(k) !== i);
  if (dupKeys.length) throw new Error(`Duplicate store codes in file: ${[...new Set(dupKeys)].join(", ")}`);
  if (fileRows.length < 60) throw new Error(`Only ${fileRows.length} stores found — refusing to sync (file looks wrong)`);

  const env2 = { ...process.env }; env2.CLOUDFLARE_API_TOKEN ||= env2.CLOUDFLARE_API_KEY; env2.NODE_USE_ENV_PROXY ||= "1";
  const wr2 = (args) => execFileSync("npx", ["wrangler", ...args], { env: env2, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], maxBuffer: 1 << 26 });
  const where2 = local ? ["--local"] : ["--remote"];
  const cur = JSON.parse(wr2(["d1", "execute", DB, ...where2, "--json", "--command", "SELECT id,username,name,area_manager,rom,locked,active FROM stores"]))[0].results;
  const byKey = new Map(cur.map((s) => [norm(s.username), s]));
  const seen = new Set(), sql = [], changes = [], added = [];
  for (const r of fileRows) {
    seen.add(r.key);
    const s = byKey.get(r.key);
    if (s) {
      if (s.locked) continue;                                   // an admin edited this store by hand: leave it
      if (clean(s.area_manager) === r.am && clean(s.rom) === r.rom) continue;
      changes.push(`${s.username}: AM ${s.area_manager || "-"} → ${r.am} · ROM ${s.rom || "-"} → ${r.rom}`);
      sql.push(`UPDATE stores SET area_manager=${q(r.am)}, rom=${q(r.rom)} WHERE id=${s.id};`);
    } else {
      const code = r.key.replace(/^B(\d)$/, "B0$1");              // the app writes single-digit codes as B01…B09
      added.push(`${code} ${r.name}`);
      sql.push(`INSERT INTO stores (name,code,username,area_manager,rom,region,city) VALUES (${q(r.name)},${q(code)},${q(code)},${q(r.am)},${q(r.rom)},${q(r.region)},${q(r.city)});`);
    }
  }
  const missing = cur.filter((s) => s.active && !seen.has(norm(s.username))).map((s) => `${s.username} ${s.name}`);
  sql.push(`INSERT INTO sync_log (source,total,added,updated,disabled) VALUES ('Master Location Mapping',${fileRows.length},${added.length},${changes.length},0);`);
  console.log(`${fileRows.length} stores in file · ${added.length} new · ${changes.length} with a changed Area Manager / ROM`);
  if (added.length) console.log("New: " + added.join("; "));
  if (changes.length) console.log("Changed:\n  " + changes.join("\n  "));
  console.log(`Not in the file (left untouched, not disabled): ${missing.join("; ") || "none"}`);
  if (dry) process.exit(0);
  const f = join(mkdtempSync(join(tmpdir(), "sync-")), "sync.sql"); writeFileSync(f, sql.join("\n"));
  wr2(["d1", "execute", DB, ...where2, "--file", f]);
  console.log("Done.");
  process.exit(0);
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
ON CONFLICT(username) DO UPDATE SET
  name=CASE WHEN stores.locked=1 THEN stores.name ELSE excluded.name END,
  area_manager=CASE WHEN stores.locked=1 THEN stores.area_manager ELSE excluded.area_manager END,
  rom=CASE WHEN stores.locked=1 THEN stores.rom ELSE excluded.rom END,
  region=CASE WHEN stores.locked=1 THEN stores.region ELSE excluded.region END,
  city=CASE WHEN stores.locked=1 THEN stores.city ELSE excluded.city END,
  active=CASE WHEN stores.sync_disabled=1 THEN 1 ELSE stores.active END, sync_disabled=0, sync_batch=excluded.sync_batch;`),
  // stores that were synced before but are no longer in the file are disabled (history is kept)
  `UPDATE stores SET active=0, sync_disabled=1 WHERE sync_batch IS NOT NULL AND sync_batch<>${q(batch)} AND active=1 AND manual=0;`,
  `INSERT INTO sync_log (source,total,added,updated,disabled) VALUES ('AM & ROM Mapping',${rows.length},${added},${updated},(SELECT COUNT(*) FROM stores WHERE sync_disabled=1));`,
].join("\n");

console.log(`${rows.length} stores in file · ${added} new · ${updated} existing`);
if (dry) { console.log(sql.split("\n").slice(0, 4).join("\n")); process.exit(0); }
const f = join(mkdtempSync(join(tmpdir(), "sync-")), "sync.sql");
writeFileSync(f, sql);
wr(["d1", "execute", DB, ...where, "--file", f]);
const [t] = query("SELECT COUNT(*) total, SUM(active) active, SUM(sync_disabled) disabled FROM stores");
console.log(`Done. Stores in database: ${t.total} (${t.active} active, ${t.disabled} disabled because they left the file)`);
