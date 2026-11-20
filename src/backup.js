// Nightly data backup: the whole database is read (SELECT only) and emailed through Brevo as an attachment.
// The JSON is built by SQLite itself (json_group_array), so the Worker only joins strings and stays inside the free plan's CPU limit.
// The attachment can be checked and restored with scripts/db-restore.mjs.

const PAGE = 200;                       // rows per query, keeps every result far below D1's size limits
const SKIP = (t) => t.startsWith("_cf_") || t === "login_attempts";   // sign-in throttle rows are short-lived, not worth keeping

const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;
const ql = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function buildBackup(env) {
  const DB = env.DB;
  const tables = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results.map((r) => r.name).filter((t) => !SKIP(t));
  const meta = await DB.batch([
    DB.prepare("SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) AS j FROM (SELECT * FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type DESC, name)"),
    ...tables.map((t) => DB.prepare(`SELECT COUNT(*) AS n, (SELECT json_group_array(name) FROM pragma_table_info(${ql(t)})) AS cols FROM ${qi(t)}`)),
  ]);
  const schema = meta[0].results[0].j;
  const info = tables.map((t, i) => ({ t, n: meta[i + 1].results[0].n, cols: JSON.parse(meta[i + 1].results[0].cols) }));

  const stmts = [], where = [];
  for (const { t, n, cols } of info) {
    const obj = `json_object(${cols.map((c) => `${ql(c)},${qi(c)}`).join(",")})`;
    for (let off = 0; off < n; off += PAGE) { stmts.push(DB.prepare(`SELECT json_group_array(${obj}) AS j FROM (SELECT * FROM ${qi(t)} ORDER BY rowid LIMIT ${PAGE} OFFSET ${off})`)); where.push(t); }
  }
  const parts = Object.fromEntries(info.map(({ t }) => [t, []]));
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await DB.batch(stmts.slice(i, i + 50));
    res.forEach((r, k) => { const j = r.results[0].j; if (j.length > 2) parts[where[i + k]].push(j.slice(1, -1)); });
  }
  const counts = Object.fromEntries(info.map(({ t, n }) => [t, n]));
  const created = new Date().toISOString();
  const text = `{"app":"HM Training Division","database":"hm-staff-evaluation-eu","format":1,"created_at":${JSON.stringify(created)},"counts":${JSON.stringify(counts)},"schema":${schema},"tables":{${info.map(({ t }) => `${JSON.stringify(t)}:[${parts[t].join(",")}]`).join(",")}}}`;
  return { text, counts, created };
}

function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const LABEL = { stores: "Stores", trainers: "Trainers", visits: "Visits", evaluations: "Verifications", eval_sections: "Verification topic scores",
  sv_reports: "Store visit reports", sv_emails: "Emails sent", records: "Coaching & records", workshop_entries: "Workshop", positions: "Positions",
  sections: "Topics", items: "Questions", npd_products: "NPD products", branch_emails: "Branch emails", email_book: "Email suggestions", sync_log: "Sync log" };

export async function emailBackup(env, why = "nightly") {
  const to = String(env.BACKUP_TO || "").trim();
  if (!to) throw new Error("BACKUP_TO is not set");
  if (!env.BREVO_API_KEY || !env.MAIL_FROM) throw new Error("Brevo is not set up");
  const { text, counts, created } = await buildBackup(env);
  const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);          // date in Riyadh
  const bytes = new TextEncoder().encode(text);
  const rows = Object.keys(LABEL).filter((t) => t in counts).map((t) => [LABEL[t], counts[t]]);
  const at = new Date(Date.parse(created) + 3 * 3600e3).toISOString().slice(11, 16);   // Riyadh time
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = `<!doctype html><html><body style="margin:0;background:#F5EDE3;font-family:'Segoe UI',Arial,sans-serif;color:#1D1B17">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EDE3;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FBF7F1;border-radius:14px;overflow:hidden;border:1px solid #E4D6C2">
<tr><td style="background:#1D1B17;padding:20px 24px"><div style="color:#fff;font-size:20px;font-weight:700">Data backup · ${esc(day)}</div><div style="color:#D4B38B;font-size:13px;margin-top:4px">HM Training Division app</div></td></tr>
<tr><td style="padding:20px 24px;font-size:14px;line-height:1.5">
<p style="margin:0 0 12px">The full app database is attached (<b>${esc(`hm-backup-${day}.json.txt`)}</b>, ${(bytes.length / 1024).toFixed(0)} KB, ${total.toLocaleString("en")} rows). Keep this email: if the app or its data is ever lost, this file restores everything as it was at ${at} (Saudi time).</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
${rows.map(([k, n], i) => `<tr style="background:${i % 2 ? "#FBF7F1" : "#F5EDE3"}"><td style="padding:6px 10px">${esc(k)}</td><td style="padding:6px 10px;text-align:right;font-weight:700">${n.toLocaleString("en")}</td></tr>`).join("")}
</table>
<p style="margin:14px 0 0;color:#6F675B;font-size:12px">The file holds staff names and the app's sign-in data. Do not forward it outside HM. Sent automatically ${why === "manual" ? "because the admin asked for a backup" : "every night"}.</p>
</td></tr></table></td></tr></table></body></html>`;
  const res = await fetch(env.BREVO_ENDPOINT || "https://api.brevo.com/v3/smtp/email", {   // BREVO_ENDPOINT: local tests only
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "HM Training Division" }, to: [{ email: to }],
      subject: `HM Training app · data backup ${day}`, htmlContent: html,
      textContent: `HM Training app data backup ${day}: ${total} rows. The attached file restores the app's data. Keep this email.`,
      attachment: [{ name: `hm-backup-${day}.json.txt`, content: toBase64(bytes) }], tags: ["data-backup"],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Brevo ${res.status} ${out.code || ""} ${out.message || ""}`.trim());
  return { ok: true, to, day, rows: total, kb: Math.round(bytes.length / 1024) };
}
