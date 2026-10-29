#!/usr/bin/env node
// One-shot Cloudflare setup: D1 database -> schema -> questions -> deploy -> secrets.
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (CLOUDFLARE_API_KEY is accepted as an alias).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const DB = "hm-staff-evaluation-eu";
const env = { ...process.env };
env.CLOUDFLARE_API_TOKEN ||= env.CLOUDFLARE_API_KEY;
if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
  console.error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first.");
  process.exit(1);
}
if (/^v(2[2-9]|[3-9]\d)/.test(process.version)) env.NODE_USE_ENV_PROXY ||= "1"; // honour HTTPS_PROXY when present

const wr = (args, opts = {}) => execFileSync("npx", ["wrangler", ...args], { env, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], ...opts });
const step = (m) => console.log(`\n▶ ${m}`);

step("Creating D1 database");
try { wr(["d1", "create", DB]); } catch (e) { console.log("  (already exists — reusing)"); }
const list = JSON.parse(wr(["d1", "list", "--json"]));
const db = list.find((d) => d.name === DB);
if (!db) throw new Error("Could not find the D1 database after creating it");
const cfgPath = "wrangler.jsonc";
writeFileSync(cfgPath, readFileSync(cfgPath, "utf8").replace(/"database_id":\s*"[^"]*"/, `"database_id": "${db.uuid}"`));
console.log(`  database_id = ${db.uuid}`);

step("Applying schema");
wr(["d1", "migrations", "apply", DB, "--remote"], { stdio: "inherit" });

step("Loading questions (skipped if already loaded)");
const count = JSON.parse(wr(["d1", "execute", DB, "--remote", "--json", "--command", "SELECT COUNT(*) n FROM positions"]));
if (count[0].results[0].n === 0) wr(["d1", "execute", DB, "--remote", "--file", "seed/seed.sql"], { stdio: "inherit" });
else console.log("  positions already present — leaving your questions untouched");

step("Deploying Worker");
const out = wr(["deploy"]);
console.log(out);

step("Setting secrets");
const adminPassword = env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");
// Only create these once: replacing PASSWORD_KEY would make existing store passwords unreadable.
const have = JSON.parse(wr(["secret", "list", "--format", "json"])).map((x) => x.name);
if (!have.includes("SESSION_SECRET")) wr(["secret", "put", "SESSION_SECRET"], { input: randomBytes(32).toString("hex") });
if (!have.includes("PASSWORD_KEY")) wr(["secret", "put", "PASSWORD_KEY"], { input: randomBytes(32).toString("hex") });
wr(["secret", "put", "ADMIN_PASSWORD"], { input: adminPassword });
writeFileSync("credentials-admin.txt", `username: admin\npassword: ${adminPassword}\n`);
const url = (out.match(/https:\/\/[^\s]+\.workers\.dev/) || [""])[0];
console.log(`\n✅ Done.\n   URL:      ${url}\n   Admin:    admin / ${adminPassword}   (also saved to credentials-admin.txt — keep it private)`);
