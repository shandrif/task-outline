#!/usr/bin/env node
// Weekly store mapping sync from SharePoint, as read by the Microsoft 365 connector (read_resource text, saved unchanged):
//   Area Manager + ROM  ← "UPDATED Span of control (Store Level).xlsx", sheet "New"
//   City                ← "Master_Location_Mapping.xlsx", sheet "Location_Mapping"
// Region is NOT synced: the app keeps its own five regions (Riyadh / Western / Eastern / North / South); the master file's
// provinces are only used to give a brand-new store its region.
// Usage: node scripts/soc-sync.mjs <soc-read.txt> <master-read.txt> [--dry-run] [--local]
// Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (CLOUDFLARE_API_KEY accepted) unless --local.
//
// Rules: store names are never changed; stores an admin locked by hand are skipped; nothing is ever disabled or deleted.
// A row is matched by its store code; when the code is missing, repeated in the file or unknown, an exact name match against
// the app and the master file is used instead. Anything still unclear is skipped and reported, never guessed.
// New stores are added only when the master file also has them (so city and region are known).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB = "hm-staff-evaluation-eu";
const args = process.argv.slice(2);
const [socFile, masterFile] = args.filter((a) => !a.startsWith("--"));
const dry = args.includes("--dry-run"), local = args.includes("--local");
const refuse = (msg) => { console.log(`REFUSED: ${msg}`); process.exit(2); };
if (!socFile || !masterFile) { console.error("Usage: node scripts/soc-sync.mjs <soc-read.txt> <master-read.txt> [--dry-run] [--local]"); process.exit(1); }

const clean = (v) => String(v ?? "").replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
const same = (a, b) => clean(a).toUpperCase() === clean(b).toUpperCase();
const squash = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9]/g, "");          // "AL AHSA-2" → "ALAHSA2"
const codeKey = (c) => clean(c).toUpperCase().replace(/^B0+(\d)/, "B$1");          // B01 and B1 are the same store
// master province → the app's region label (only for stores added by the sync)
const REGION = { "RIYADH": "Riyadh", "MAKKAH": "Western", "AL MADINAH": "Western", "MADINAH": "Western", "EASTERN PROVINCE": "Eastern", "EASTERN": "Eastern",
  "AL-QASSIM": "North", "QASSIM": "North", "HAIL": "North", "TABUK": "North", "AL-JOUF": "North", "AL JOUF": "North", "NORTHERN BORDERS": "North",
  "ASIR": "South", "JAZAN": "South", "NAJRAN": "South", "AL-BAHA": "South", "AL BAHA": "South" };
const appRegion = (p) => REGION[clean(p).toUpperCase()] || null;
const q = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// one worksheet from the connector text: header row + data rows until the next section
function sheet(text, name, mustHave) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## Sheet: ${name} `) || l === `## Sheet: ${name}`);
  if (start < 0) return null;
  let hi = start + 1;
  while (hi < lines.length && !mustHave.every((h) => lines[hi].split("\t").map(clean).includes(h))) { if (lines[hi].startsWith("## Sheet")) return null; hi++; }
  if (hi >= lines.length) return null;
  const head = lines[hi].split("\t").map(clean);
  const declared = +((lines[start].match(/—\s*(\d+)\s+rows/) || [])[1] || 0);   // "## Sheet: New — 104 rows × 7 columns"
  const rows = [];
  for (const l of lines.slice(hi + 1)) {
    if (l.startsWith("## Sheet") || l.startsWith("Formulas:") || l.startsWith("[")) break;
    if (!l.trim()) continue;
    const c = l.split("\t");
    rows.push(Object.fromEntries(head.map((h, i) => [h, clean(c[i])])));
  }
  rows.declared = declared ? declared - (hi - start) : 0;              // data rows the sheet says it has (header rows excluded)
  return rows;
}

// ---------- read the two files ----------
const soc = sheet(readFileSync(socFile, "utf8"), "New", ["BRANCH NAME", "AREA MANAGER", "REGIONAL MANAGER"]);
if (!soc) refuse(`sheet "New" with columns BRANCH NAME / AREA MANAGER / REGIONAL MANAGER not found in ${socFile}`);
if (soc.declared && soc.length !== soc.declared) refuse(`the "New" sheet says it has ${soc.declared} rows but ${soc.length} were found — the saved text is incomplete`);
const master = sheet(readFileSync(masterFile, "utf8"), "Location_Mapping", ["SYRVE_CODE", "CITY", "REGION"]);
if (!master) refuse(`sheet "Location_Mapping" with columns SYRVE_CODE / CITY / REGION not found in ${masterFile}`);

const socRows = soc.filter((r) => r["BRANCH NAME"] && r["AREA MANAGER"]).map((r) => {
  const m = r["BRANCH NAME"].match(/^\s*(B\d+)\s*[-–,]?\s*(.*)$/i);
  return { raw: r["BRANCH NAME"], code: m ? codeKey(m[1]) : null, name: clean(m ? m[2] : r["BRANCH NAME"]), am: clean(r["AREA MANAGER"]), rom: clean(r["REGIONAL MANAGER"]), incharge: r["STORE IN-CHARGE"], emp: r["EMPLOYEE ID"] };
});
if (socRows.length < 60) refuse(`only ${socRows.length} branches in the Span of Control sheet — the file looks wrong`);
if (socRows.filter((r) => !r.rom).length > 10) refuse("many rows have no Regional Manager — the file looks wrong");
const masterByCode = new Map(master.filter((r) => /^B\d+$/i.test(r.SYRVE_CODE || "")).map((r) => [codeKey(r.SYRVE_CODE), r]));
if (masterByCode.size < 60) refuse(`only ${masterByCode.size} coded stores in the master file — the file looks wrong`);

// ---------- current stores ----------
const env = { ...process.env }; env.CLOUDFLARE_API_TOKEN ||= env.CLOUDFLARE_API_KEY; env.NODE_USE_ENV_PROXY ||= "1";
const wr = (a) => execFileSync("npx", ["wrangler", ...a], { env, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], maxBuffer: 1 << 26 });
const where = local ? ["--local"] : ["--remote"];
const app = JSON.parse(wr(["d1", "execute", DB, ...where, "--json", "--command", "SELECT id,username,name,area_manager,rom,region,city,locked,active FROM stores"]))[0].results;
const appByCode = new Map(app.map((s) => [codeKey(s.username), s]));

// name index: every name a store goes by (app name, master names) → set of codes
const names = new Map();
const addName = (n, code) => { const k = squash(n); if (k.length < 3 || k === "NA" || k === "NONEXISTING") return; if (!names.has(k)) names.set(k, new Set()); names.get(k).add(code); };
for (const s of app) addName(s.name, codeKey(s.username));
for (const [code, r] of masterByCode) for (const f of ["SPAN_BRANCH_NAME", "BRANCHES_CODES_NAME", "HM_APP_NAME", "SYRVE_NAME"]) addName(r[f], code);
const byName = (n) => {
  const k = squash(n);
  const exact = names.get(k);
  if (exact && exact.size === 1) return [...exact][0];
  if (exact && exact.size > 1) return null;
  // whole name inside a longer one, e.g. "SAUDI INVESTMENT BANK" in "RIY, Saudi Investment Bank"
  if (k.length >= 8) { const hits = new Set(); for (const [nk, codes] of names) if (nk.includes(k)) codes.forEach((c) => hits.add(c)); if (hits.size === 1) return [...hits][0]; }
  return null;
};

// ---------- resolve each row to one store ----------
const warnings = [], skipped = [];
const dupCodes = new Set(socRows.map((r) => r.code).filter((c, i, a) => c && a.indexOf(c) !== i));
const resolved = [];
const label = (code) => appByCode.get(code)?.username || code.replace(/^B(\d)$/, "B0$1");
for (const r of socRows) {
  if (/^EVENT\b/i.test(r.raw)) { skipped.push(`${r.raw} (event branch)`); continue; }
  let code = null;
  if (r.code && !dupCodes.has(r.code) && (appByCode.has(r.code) || masterByCode.has(r.code))) code = r.code;
  else {
    code = byName(r.name);
    if (code && r.code && code !== r.code) warnings.push(`“${r.raw}”: code ${r.code} ${dupCodes.has(r.code) ? "is used twice in the file" : "is not a known store"}; matched by name to ${label(code)}`);
    else if (code && !r.code) warnings.push(`“${r.raw}” has no code; matched by name to ${label(code)}`);
  }
  if (!code) { skipped.push(`${r.raw} (${r.code && !dupCodes.has(r.code) ? "not in the app or the master file" : "could not tell which store this is"})`); continue; }
  resolved.push({ ...r, key: code });
}
const taken = new Map();
for (const r of resolved) taken.set(r.key, [...(taken.get(r.key) || []), r]);
for (const [k, rs] of taken) if (rs.length > 1) { skipped.push(...rs.map((r) => `${r.raw} (two rows point to the same store ${k})`)); }
const final = resolved.filter((r) => taken.get(r.key).length === 1);
const people = new Map();
for (const r of socRows) if (r.emp) people.set(r.emp, [...(people.get(r.emp) || []), r.raw]);
for (const [emp, rs] of people) if (rs.length > 1) warnings.push(`employee ${emp} is store in-charge for ${rs.length} stores: ${rs.join(" · ")}`);

// a manager name that is new to the app and used for only one store may be a typo: report it
const known = new Set(app.flatMap((s) => [s.area_manager, s.rom]).filter(Boolean).map((x) => clean(x).toUpperCase()));
for (const field of ["am", "rom"]) {
  const count = new Map(); for (const r of final) { const k = r[field].toUpperCase(); count.set(k, (count.get(k) || 0) + 1); }
  for (const r of final) if (r[field] && !known.has(r[field].toUpperCase()) && count.get(r[field].toUpperCase()) === 1)
    warnings.push(`check spelling: ${field === "am" ? "Area Manager" : "ROM"} “${r[field]}” (${r.raw}) is new and used for only one store`);
}

// ---------- build changes ----------
const sql = [], changes = [], added = [];
let lockedSkipped = 0;
for (const r of final) {
  const m = masterByCode.get(r.key), s = appByCode.get(r.key);
  if (s) {
    if (s.locked) { lockedSkipped++; continue; }
    const set = [], what = [];
    if (r.am && !same(s.area_manager, r.am)) { set.push(`area_manager=${q(r.am)}`); what.push(`AM ${s.area_manager || "—"} → ${r.am}`); }
    if (r.rom && !same(s.rom, r.rom)) { set.push(`rom=${q(r.rom)}`); what.push(`ROM ${s.rom || "—"} → ${r.rom}`); }
    if (m?.CITY && !same(s.city, m.CITY)) { set.push(`city=${q(m.CITY)}`); what.push(`City ${s.city || "—"} → ${m.CITY}`); }
    if (set.length) { sql.push(`UPDATE stores SET ${set.join(", ")} WHERE id=${s.id} AND locked=0;`); changes.push(`${s.username} ${s.name}: ${what.join(" · ")}`); }
  } else if (m) {
    const code = r.key.replace(/^B(\d)$/, "B0$1");                // the app writes single-digit codes as B01…B09
    const name = clean(m.SPAN_BRANCH_NAME) && !/^N\/?A$/i.test(m.SPAN_BRANCH_NAME) ? m.SPAN_BRANCH_NAME : r.name;
    const region = appRegion(m.REGION);
    if (!region) warnings.push(`new store ${code} ${name}: province “${m.REGION}” has no app region — set it on the Stores page`);
    sql.push(`INSERT INTO stores (name,code,username,area_manager,rom,region,city) VALUES (${q(name)},${q(code)},${q(code)},${q(r.am)},${q(r.rom)},${q(region)},${q(m.CITY)});`);
    added.push(`${code} ${name} (${m.CITY}, ${region || "no region"}) · AM ${r.am} · ROM ${r.rom}`);
  } else skipped.push(`${r.raw} (new branch, but not in the master file yet, so its city and region are unknown — add it by hand on the Stores page if needed)`);
}
const matched = new Set(final.map((r) => r.key));
const notInFile = app.filter((s) => s.active && !matched.has(codeKey(s.username))).map((s) => `${s.username} ${s.name}`);
sql.push(`INSERT INTO sync_log (source,total,added,updated,disabled) VALUES ('Span of Control (AM, ROM) + Master Location Mapping (city)',${final.length},${added.length},${changes.length},0);`);

// ---------- report ----------
console.log(`Span of Control: ${socRows.length} branches · matched ${final.length} · new ${added.length} · changed ${changes.length} · unchanged ${final.length - added.length - changes.length - lockedSkipped}${lockedSkipped ? ` · locked by hand (skipped) ${lockedSkipped}` : ""}`);
if (changes.length) console.log("\nChanged:\n  " + changes.join("\n  "));
if (added.length) console.log("\nNew stores added:\n  " + added.join("\n  "));
if (skipped.length) console.log("\nNot synced:\n  " + skipped.join("\n  "));
if (warnings.length) console.log("\nWarnings:\n  " + warnings.join("\n  "));
console.log(`\nIn the app but not in the Span of Control file (left as they are): ${notInFile.join("; ") || "none"}`);
if (dry) { console.log("\nDRY RUN — nothing was written."); process.exit(0); }
const f = join(mkdtempSync(join(tmpdir(), "soc-")), "soc.sql"); writeFileSync(f, sql.join("\n"));
wr(["d1", "execute", DB, ...where, "--file", f, "-y"]);
console.log("\nDone: the database is updated.");
