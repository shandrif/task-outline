// Designations: staff positions (Onboarding, Store visit report staff rows) and trainer designations (sign-up).
// Only the admin adds, renames or removes them; everyone else picks from a dropdown, and the server refuses anything else.
// Renaming updates every record that uses the old name, so one designation is never spelled two ways.

export const KINDS = { staff: "Staff positions", trainer: "Trainer designations" };

// SQL that rewrites one designation everywhere it is used (case-insensitive match of the old name)
const RENAME = {
  staff: [
    "UPDATE records SET data=json_set(data,'$.position',?1) WHERE module='onboarding' AND lower(trim(json_extract(data,'$.position')))=lower(?2)",
    `UPDATE sv_reports SET body=json_set(body,'$.team.rows',json((
       SELECT json_group_array(json(CASE WHEN lower(trim(json_extract(value,'$.position')))=lower(?2) THEN json_set(value,'$.position',?1) ELSE value END))
       FROM (SELECT key, value FROM json_each(sv_reports.body,'$.team.rows') ORDER BY key))))
     WHERE EXISTS (SELECT 1 FROM json_each(sv_reports.body,'$.team.rows') j WHERE lower(trim(json_extract(j.value,'$.position')))=lower(?2))`,
  ],
  trainer: ["UPDATE trainers SET designation=?1 WHERE lower(trim(designation))=lower(?2)"],
};
const USES = {
  staff: `(SELECT COUNT(*) FROM records r WHERE r.module='onboarding' AND lower(trim(json_extract(r.data,'$.position')))=lower(d.name))
        + (SELECT COUNT(*) FROM sv_reports s, json_each(s.body,'$.team.rows') j WHERE lower(trim(json_extract(j.value,'$.position')))=lower(d.name))`,
  trainer: "(SELECT COUNT(*) FROM trainers t WHERE lower(trim(t.designation))=lower(d.name))",
};

// Returns the list's spelling of a designation, or throws. A record being edited may keep the value it already has.
export async function checkDesignation(env, kind, value, { current = null, required = false, label = "Designation", bad } = {}) {
  const v = String(value ?? "").trim();
  if (!v) { if (required) throw bad(`${label} is required`); return ""; }
  const row = await env.DB.prepare("SELECT name, active FROM designations WHERE kind=? AND name=? COLLATE NOCASE").bind(kind, v).first();
  if (row && row.active) return row.name;
  if (current != null && String(current).trim().toLowerCase() === v.toLowerCase()) return row ? row.name : String(current);
  throw bad(`Choose the ${label.toLowerCase()} from the list. Only the admin can add new ones.`);
}
// lower-case name -> list spelling, for checking many values at once (store visit staff rows)
export async function designationMap(env, kind) {
  const rows = (await env.DB.prepare("SELECT name FROM designations WHERE kind=? AND active=1").bind(kind).all()).results;
  return new Map(rows.map((r) => [r.name.toLowerCase(), r.name]));
}

// GET /api/designations?kind=staff|trainer: active names, sorted (no sign-in needed: the sign-up form uses it)
export async function publicList(env, url, json) {
  const kind = url.searchParams.get("kind");
  const rows = (await env.DB.prepare("SELECT kind, name FROM designations WHERE active=1 AND (?1 IS NULL OR kind=?1) ORDER BY kind, sort, name COLLATE NOCASE").bind(KINDS[kind] ? kind : null).all()).results;
  return json(rows, 200, { "cache-control": "no-store" });
}

// /api/admin/designations… (the caller has already checked the admin)
export async function adminRoutes({ path, method, env, body, bad, HttpError, json, str }) {
  let m;
  const nameOf = (v) => str(v, 60, "Name", { required: true, min: 2 }).replace(/\s+/g, " ");
  if (path === "/api/admin/designations" && method === "GET") {
    const out = {};
    for (const kind of Object.keys(KINDS)) {
      out[kind] = (await env.DB.prepare(`SELECT d.id, d.name, d.active, d.sort, ${USES[kind]} uses FROM designations d WHERE d.kind=? ORDER BY d.active DESC, d.sort, d.name COLLATE NOCASE`).bind(kind).all()).results;
    }
    // values already saved that are not on the list (typed before the list existed): shown so the admin can merge them
    out.unlisted = {
      staff: (await env.DB.prepare(`SELECT p name, COUNT(*) uses FROM (
          SELECT trim(json_extract(data,'$.position')) p FROM records WHERE module='onboarding'
          UNION ALL SELECT trim(json_extract(j.value,'$.position')) FROM sv_reports s, json_each(s.body,'$.team.rows') j)
        WHERE p IS NOT NULL AND p<>'' AND lower(p) NOT IN (SELECT lower(name) FROM designations WHERE kind='staff') GROUP BY p ORDER BY COUNT(*) DESC, p`).all()).results,
      trainer: (await env.DB.prepare(`SELECT designation name, COUNT(*) uses FROM trainers WHERE designation IS NOT NULL AND designation<>'' AND lower(trim(designation)) NOT IN (SELECT lower(name) FROM designations WHERE kind='trainer') GROUP BY designation ORDER BY COUNT(*) DESC`).all()).results,
    };
    return json(out);
  }
  if (path === "/api/admin/designations" && method === "POST") {
    const b = await body();
    if (!KINDS[b.kind]) throw bad("Unknown list");
    const name = nameOf(b.name);
    const n = (await env.DB.prepare("SELECT COALESCE(MAX(sort),0)+1 n FROM designations WHERE kind=?").bind(b.kind).first()).n;
    try { const r = await env.DB.prepare("INSERT INTO designations (kind,name,sort) VALUES (?,?,?)").bind(b.kind, name, n).run(); return json({ id: r.meta.last_row_id }, 201); }
    catch (e) { if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, `“${name}” is already in the list`); throw e; }
  }
  // merge a value typed before the list existed into a designation on the list
  if (path === "/api/admin/designations/merge" && method === "POST") {
    const b = await body();
    if (!KINDS[b.kind]) throw bad("Unknown list");
    const from = str(b.from, 120, "Old value", { required: true });
    const to = await env.DB.prepare("SELECT name FROM designations WHERE kind=? AND id=?").bind(b.kind, +b.to).first();
    if (!to) throw bad("Choose a designation from the list");
    const res = await env.DB.batch(RENAME[b.kind].map((s) => env.DB.prepare(s).bind(to.name, from)));
    return json({ ok: true, changed: res.reduce((n, r) => n + (r.meta?.changes || 0), 0) });
  }
  if ((m = path.match(/^\/api\/admin\/designations\/(\d+)$/))) {
    const id = +m[1];
    const cur = await env.DB.prepare("SELECT id, kind, name FROM designations WHERE id=?").bind(id).first();
    if (!cur) throw new HttpError(404, "Not found");
    if (method === "PATCH") {
      const b = await body();
      if (b.active !== undefined) await env.DB.prepare("UPDATE designations SET active=? WHERE id=?").bind(b.active ? 1 : 0, id).run();
      if (b.name !== undefined) {
        const name = nameOf(b.name);
        if (name !== cur.name) {
          try {
            await env.DB.batch([env.DB.prepare("UPDATE designations SET name=? WHERE id=?").bind(name, id), ...RENAME[cur.kind].map((s) => env.DB.prepare(s).bind(name, cur.name))]);
          } catch (e) { if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, `“${name}” is already in the list`); throw e; }
        }
      }
      return json({ ok: true });
    }
    if (method === "DELETE") {   // only an unused designation can be deleted; one in use is removed from the dropdown instead
      const n = (await env.DB.prepare(`SELECT ${USES[cur.kind]} n FROM designations d WHERE d.id=?`).bind(id).first()).n;
      if (n) throw new HttpError(409, `“${cur.name}” is used ${n} time${n === 1 ? "" : "s"}. Remove it from the dropdown instead; past records keep it.`);
      await env.DB.prepare("DELETE FROM designations WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, "Not found");
}
