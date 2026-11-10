// Onboarding, NPD, Training/Coaching, People Development (generic records) and Store Visit reports.
// Trainers see and change only their own entries; the admin sees and changes everything.

const T = (key, label, extra = {}) => ({ key, label, type: "text", ...extra });
const STORE_FILL = { type: "store" };

const ONB_BASE = [
  T("emp_id", "Employee ID", { required: true }), T("name", "Employee name", { required: true }), T("position", "Position", { required: true }),
  T("doj", "Date of joining", { type: "date", required: true }), T("nationality", "Nationality", { required: true }),
  T("training_start", "Training started", { type: "date" }), T("training_end", "Training ended", { type: "date" }),
  T("theory", "Theory %", { type: "pct" }), T("practical", "Practical %", { type: "pct" }),
];
const PEOPLE = [
  T("name", "Name", { required: true }), T("emp_id", "Employee ID", { required: true }),
  T("branch", "Branch", { ...STORE_FILL, fills: ["am", "rom", "city", "region"], required: true }),
  T("am", "Area manager"), T("rom", "ROM"), T("city", "City"), T("region", "Region"),
];

// Single source of truth: the browser builds its forms and tables from this.
export const MODULES = {
  onboarding: {
    title: "Onboarding",
    kinds: [
      { key: "hm", label: "HM", fields: ONB_BASE },
      { key: "external", label: "External", fields: [...ONB_BASE, T("location", "Location", { required: true, placeholder: "e.g. Qidiya city" })] },
      { key: "international", label: "International", fields: [...ONB_BASE, T("location", "Location", { required: true, placeholder: "e.g. Iraq" })] },
    ],
  },
  npd: {
    title: "NPD",
    kinds: [{ key: "", label: "NPD", fields: [
      T("name", "Employee name", { required: true }), T("emp_id", "Employee ID", { required: true }),
      T("store", "Store", { ...STORE_FILL, fills: ["am", "rom"], required: true }), T("am", "Area manager"), T("rom", "ROM"),
      T("product_name", "Product name", { type: "product", required: true }), T("pct", "Verification %", { type: "pct", required: true }),
    ] }],
  },
  coaching: {
    title: "Training / Coaching",
    kinds: [{ key: "", label: "Training / Coaching", fields: [...PEOPLE, T("topic", "Topic", { required: true }), T("pct", "Verification %", { type: "pct", required: true })] }],
  },
  development: {
    title: "People Development",
    kinds: [
      ["cashier_barista", "Cashier → Barista"], ["barista_tl", "Barista → Team Leader"], ["tl_sm", "Team Leader → Store Manager"],
      ["sm_am", "Store Manager → Area Manager"], ["numo", "Numo"],
    ].map(([key, label]) => ({ key, label, fields: [...PEOPLE, T("notes", "Notes", { type: "textarea" }), T("pct", "Verification %", { type: "pct", required: true })] })),
  },
};

const RATINGS = ["Excellent", "Good", "Satisfactory", "Needs improvement", "Poor"];
const VISIT_TYPES = ["Routine", "Follow-up", "Audit"];
export const SV_CONFIG = { ratings: RATINGS, visitTypes: VISIT_TYPES };

const CORE = new Set(["emp_id", "name", "pct"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function moduleRoutes(c) {
  const { path, method, url, env, session, isAdmin, from, to, wide, page, before, body, bad, HttpError, json, str } = c;
  let m;
  const owner = () => (isAdmin ? null : session.trainer.id);          // NULL = see everything
  const who = () => (isAdmin ? "Admin" : session.trainer.name);
  const canTouch = (createdBy) => isAdmin || createdBy === session.trainer.id;
  const num = (v, lo, hi, label, { int = false } = {}) => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${label} must be a number from ${lo} to ${hi}`);
    return int ? Math.round(n) : Math.round(n * 10) / 10;
  };

  if (path === "/api/modules" && method === "GET") return json({ modules: MODULES, sv: SV_CONFIG });

  // ---------- NPD product names: set by the admin only ----------
  const needAdmin = () => { if (!isAdmin) throw new HttpError(403, "Only the admin can change the product list"); };
  const prodName = (v) => { const s = str(v, 80, "Product name", { required: true }).replace(/\s+/g, " "); return s; };
  if (path === "/api/npd-products" && method === "GET") {
    const rows = (await env.DB.prepare(
      `SELECT p.id, p.name, p.active, (SELECT COUNT(*) FROM records r WHERE r.module='npd' AND lower(json_extract(r.data,'$.product_name'))=lower(p.name)) uses
       FROM npd_products p ${isAdmin ? "" : "WHERE p.active=1"} ORDER BY p.name COLLATE NOCASE`).all()).results;
    return json(rows);
  }
  if (path === "/api/npd-products" && method === "POST") {
    needAdmin();
    const name = prodName((await body()).name);
    try { const r = await env.DB.prepare("INSERT INTO npd_products (name) VALUES (?)").bind(name).run(); return json({ id: r.meta.last_row_id }, 201); }
    catch (e) { if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, `“${name}” is already in the list`); throw e; }
  }
  if ((m = path.match(/^\/api\/npd-products\/(\d+)$/))) {
    needAdmin();
    const id = +m[1];
    const cur = await env.DB.prepare("SELECT id,name FROM npd_products WHERE id=?").bind(id).first();
    if (!cur) throw new HttpError(404, "Product not found");
    if (method === "PATCH") {
      const b = await body();
      if (b.active !== undefined) await env.DB.prepare("UPDATE npd_products SET active=? WHERE id=?").bind(b.active ? 1 : 0, id).run();
      if (b.name !== undefined) {
        const name = prodName(b.name);
        try {
          await env.DB.batch([
            env.DB.prepare("UPDATE npd_products SET name=? WHERE id=?").bind(name, id),
            // records keep the spelling of the list: a rename updates them all
            env.DB.prepare("UPDATE records SET data=json_set(data,'$.product_name',?1) WHERE module='npd' AND lower(json_extract(data,'$.product_name'))=lower(?2)").bind(name, cur.name),
          ]);
        } catch (e) { if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, `“${name}” is already in the list`); throw e; }
      }
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const n = (await env.DB.prepare("SELECT COUNT(*) n FROM records WHERE module='npd' AND lower(json_extract(data,'$.product_name'))=lower(?)").bind(cur.name).first()).n;
      if (n) throw new HttpError(409, `${n} NPD record${n === 1 ? " uses" : "s use"} this product. Disable it instead of deleting.`);
      await env.DB.prepare("DELETE FROM npd_products WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }
  // the product on an NPD record must come from the list (the stored spelling is the list's spelling)
  const checkProduct = async (mod, v, current) => {
    if (mod !== "npd") return;
    const row = await env.DB.prepare("SELECT name, active FROM npd_products WHERE name=? COLLATE NOCASE").bind(v.product_name).first();
    if (row && (row.active || (current && current.toLowerCase() === row.name.toLowerCase()))) { v.product_name = row.name; return; }
    if (!row && current && current.toLowerCase() === String(v.product_name).toLowerCase()) return;    // old record keeps its old name when saved unchanged
    throw bad("Choose the product from the list — only the admin can add product names");
  };

  // ---------- generic records ----------
  const clean = (kindDef, b) => {
    const out = {};
    for (const f of kindDef.fields) {
      const raw = b[f.key];
      if (f.type === "pct") out[f.key] = num(raw, 0, 100, f.label);
      else if (f.type === "date") {
        const s = str(raw, 10, f.label);
        if (s && !DATE.test(s)) throw bad(`${f.label} must be a date`);
        out[f.key] = s;
      } else out[f.key] = str(raw, f.type === "textarea" ? 2000 : 120, f.label);
      if (f.required && (out[f.key] === "" || out[f.key] == null)) throw bad(`${f.label} is required`);
    }
    return out;
  };
  const pack = (mod, kindDef, v) => {
    if (mod === "onboarding") v.pct = v.theory != null && v.practical != null ? Math.round((5 * (v.theory + v.practical))) / 10 : null;   // average of theory and practical
    const data = {};
    for (const [k, val] of Object.entries(v)) if (!CORE.has(k) && val !== "" && val != null) data[k] = val;
    return { emp_id: v.emp_id || null, name: v.name || null, pct: v.pct ?? null, data: JSON.stringify(data) };
  };
  const unpack = (r) => ({ ...JSON.parse(r.data || "{}"), id: r.id, module: r.module, kind: r.kind, emp_id: r.emp_id, name: r.name, pct: r.pct, created_by: r.created_by, created_by_name: r.created_by_name, created_at: r.created_at, updated_at: r.updated_at });
  const kindOf = (mod, kind) => {
    const def = MODULES[mod];
    const k = def && def.kinds.find((x) => x.key === (kind || ""));
    if (!k) throw bad("Unknown section");
    return k;
  };

  if (path === "/api/records" && method === "GET") {
    const mod = url.searchParams.get("module");
    if (!MODULES[mod]) throw bad("Unknown module");
    const rows = (await env.DB.prepare(
      `SELECT * FROM records WHERE module=?1 AND ${wide ? "+" : ""}created_at >= ?2 AND ${wide ? "+" : ""}created_at < ?3 AND (?4 IS NULL OR created_by=?4) AND id < ?5 ORDER BY id DESC LIMIT ${page}`
    ).bind(mod, from, to, owner(), before).all()).results;
    return json(rows.map(unpack));
  }
  if (path === "/api/records" && method === "POST") {
    const b = await body();
    const kd = kindOf(b.module, b.kind);
    const v = clean(kd, b);
    await checkProduct(b.module, v, null);
    const p = pack(b.module, kd, v);
    const r = await env.DB.prepare("INSERT INTO records (module,kind,emp_id,name,pct,data,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?)")
      .bind(b.module, kd.key, p.emp_id, p.name, p.pct, p.data, isAdmin ? null : session.trainer.id, who()).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/records\/(\d+)$/))) {
    const id = +m[1];
    const cur = await env.DB.prepare("SELECT id,module,kind,created_by,json_extract(data,'$.product_name') product FROM records WHERE id=?").bind(id).first();
    if (!cur || !canTouch(cur.created_by)) throw new HttpError(404, "Record not found");
    if (method === "DELETE") { await env.DB.prepare("DELETE FROM records WHERE id=?").bind(id).run(); return json({ ok: true }); }
    if (method === "PATCH") {
      const b = await body();
      const kd = kindOf(cur.module, cur.kind);
      const v = clean(kd, b);
      await checkProduct(cur.module, v, cur.product);
      const p = pack(cur.module, kd, v);
      await env.DB.prepare("UPDATE records SET emp_id=?,name=?,pct=?,data=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(p.emp_id, p.name, p.pct, p.data, id).run();
      return json({ ok: true });
    }
  }

  // ---------- master dashboard numbers ----------
  if (path === "/api/home/summary" && method === "GET") {
    const o = owner();
    const [recs, svs, vis, evs, recent, byRec, bySv, byVis, byEv, trainers] = await env.DB.batch([
      env.DB.prepare(`SELECT module, kind, COUNT(*) n, COUNT(pct) scored, COALESCE(SUM(pct),0) sum_pct, SUM(CASE WHEN pct>=85 THEN 1 ELSE 0 END) good, SUM(CASE WHEN pct<65 THEN 1 ELSE 0 END) low
        FROM records WHERE created_at >= ?1 AND created_at < ?2 AND (?3 IS NULL OR created_by=?3) GROUP BY module, kind`).bind(from, to, o),
      env.DB.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT store_id) stores, COUNT(overall_score) scored, COALESCE(SUM(overall_score),0) sum_score, COALESCE(SUM(follow_up),0) follow_ups
        FROM sv_reports WHERE created_at >= ?1 AND created_at < ?2 AND (?3 IS NULL OR trainer_id=?3)`).bind(from, to, o),
      env.DB.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT store_id) stores FROM visits WHERE started_at >= ?1 AND started_at < ?2 AND (?3 IS NULL OR trainer_id=?3)`).bind(from, to, o),
      env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(score),0) sc, COALESCE(SUM(max_score),0) mx FROM evaluations
        WHERE status='submitted' AND submitted_at >= ?1 AND submitted_at < ?2 AND (?3 IS NULL OR trainer_id=?3)`).bind(from, to, o),
      env.DB.prepare(`SELECT * FROM (
          SELECT 'rec' src, id, module, kind, name, pct, created_by_name by_name, created_at FROM records WHERE (?1 IS NULL OR created_by=?1) ORDER BY id DESC LIMIT 12)
        UNION ALL SELECT * FROM (
          SELECT 'sv' src, r.id, 'storevisit' module, '' kind, st.name name, r.overall_score pct, t.name by_name, r.created_at FROM sv_reports r JOIN stores st ON st.id=r.store_id LEFT JOIN trainers t ON t.id=r.trainer_id WHERE (?1 IS NULL OR r.trainer_id=?1) ORDER BY r.id DESC LIMIT 12)
        ORDER BY created_at DESC LIMIT 12`).bind(o),
      env.DB.prepare(`SELECT created_by tid, module, COUNT(*) n FROM records WHERE created_at >= ?1 AND created_at < ?2 GROUP BY created_by, module`).bind(from, to),
      env.DB.prepare(`SELECT trainer_id tid, COUNT(*) n FROM sv_reports WHERE created_at >= ?1 AND created_at < ?2 GROUP BY trainer_id`).bind(from, to),
      env.DB.prepare(`SELECT trainer_id tid, COUNT(*) n FROM visits WHERE started_at >= ?1 AND started_at < ?2 GROUP BY trainer_id`).bind(from, to),
      env.DB.prepare(`SELECT trainer_id tid, COUNT(*) n FROM evaluations WHERE status='submitted' AND submitted_at >= ?1 AND submitted_at < ?2 GROUP BY trainer_id`).bind(from, to),
      env.DB.prepare("SELECT id,name,employee_id,designation,status FROM trainers ORDER BY name COLLATE NOCASE"),
    ]);
    let team = null;
    if (isAdmin) {
      const rows = new Map(trainers.results.map((t) => [t.id, { id: t.id, name: t.name, employee_id: t.employee_id, designation: t.designation, onboarding: 0, npd: 0, coaching: 0, development: 0, storevisit: 0, visits: 0, evaluations: 0 }]));
      rows.set(null, { id: null, name: "Admin", employee_id: "", designation: "", onboarding: 0, npd: 0, coaching: 0, development: 0, storevisit: 0, visits: 0, evaluations: 0 });
      const add = (list, key) => { for (const r of list.results) { const t = rows.get(r.tid) || rows.get(null); t[r.module || key] += r.n; } };
      add(byRec); add(bySv, "storevisit"); add(byVis, "visits"); add(byEv, "evaluations");
      team = [...rows.values()].filter((t) => t.onboarding + t.npd + t.coaching + t.development + t.storevisit + t.visits + t.evaluations > 0);
    }
    return json({ records: recs.results, sv: svs.results[0], verify: { visits: vis.results[0].n, stores: vis.results[0].stores, evaluations: evs.results[0].n, score: evs.results[0].sc, max: evs.results[0].mx }, recent: recent.results, team, pending: isAdmin ? trainers.results.filter((x) => x.status === "pending").length : 0 });
  }

  // ---------- store visit reports ----------
  const svText = (v, max, label) => str(v, max, label);
  const svRows = (arr, limit, shape) => (Array.isArray(arr) ? arr.slice(0, limit) : []).map(shape).filter((r) => Object.values(r).some((x) => x !== "" && x != null));
  const yn = (v) => (v === 1 || v === true ? 1 : v === 0 || v === false ? 0 : null);
  const buildSv = (b) => {
    const visit_date = svText(b.visit_date, 10, "Visit date");
    if (!DATE.test(visit_date)) throw bad("Visit date is required");
    const time = svText(b.visit_time, 5, "Visit time");
    if (time && !/^\d{2}:\d{2}$/.test(time)) throw bad("Visit time must look like 14:30");
    const readiness = svRows(b.readiness, 40, (r) => ({ item: svText(r?.item, 300, "Checkpoint"), status: yn(r?.status), remarks: svText(r?.remarks, 300, "Remarks") }));
    const quality = svRows(b.quality, 40, (r) => ({ product: svText(r?.product, 200, "Product"), meets: yn(r?.meets), score: num(r?.score, 0, 100, "Score", { int: true }), comments: svText(r?.comments, 300, "Comments") }));
    const t = b.team || {};
    const team = {
      on_duty: num(t.on_duty, 0, 500, "Employees on duty", { int: true }), checked: num(t.checked, 0, 500, "Employees checked", { int: true }),
      rows: svRows(t.rows, 60, (r) => ({ name: svText(r?.name, 120, "Employee name"), position: svText(r?.position, 80, "Position"), score: num(r?.score, 0, 100, "Employee score", { int: true }), observation: svText(r?.observation, 400, "Observation") })),
    };
    const highlights = svRows(b.highlights, 20, (r) => ({ text: svText(r?.text, 300, "Highlight"), status: yn(r?.status), remarks: svText(r?.remarks, 300, "Remarks") }));
    const actions = svRows(b.actions, 40, (r) => ({ issue: svText(r?.issue, 400, "Issue"), action: svText(r?.action, 400, "Action required"), owner: svText(r?.owner, 100, "Owner"), due: (() => { const d = svText(r?.due, 10, "Due date"); if (d && !DATE.test(d)) throw bad("Due date must be a date"); return d; })() }));
    const rating = svText(b.overall_rating, 30, "Overall rating");
    if (rating && !RATINGS.includes(rating)) throw bad("Unknown rating");
    const answered = readiness.filter((r) => r.status !== null);
    const scored = quality.filter((r) => r.score != null);
    const body = { readiness, quality, team, highlights, actions, overall_comment: svText(b.overall_comment, 2000, "Overall comment"), ack_name: svText(b.ack_name, 120, "Acknowledged by"), ack_date: (() => { const d = svText(b.ack_date, 10, "Acknowledgement date"); if (d && !DATE.test(d)) throw bad("Acknowledgement date must be a date"); return d; })() };
    const vt = svText(b.visit_type, 30, "Visit type");
    if (vt && !VISIT_TYPES.includes(vt)) throw bad("Unknown visit type");
    return {
      visit_date, visit_time: time || null, branch_manager: svText(b.branch_manager, 120, "Branch / shift manager") || null, visit_type: vt || null,
      body: JSON.stringify(body),
      readiness_pct: answered.length ? Math.round((1000 * answered.filter((r) => r.status === 1).length) / answered.length) / 10 : null,
      quality_avg: scored.length ? Math.round((10 * scored.reduce((n, r) => n + r.score, 0)) / scored.length) / 10 : null,
      overall_rating: rating || null, overall_score: num(b.overall_score, 0, 100, "Overall score"), follow_up: b.follow_up === 1 || b.follow_up === true ? 1 : 0,
    };
  };
  const SV_LIST = `SELECT r.id,r.store_id,r.trainer_id,r.visit_date,r.visit_time,r.visit_type,r.branch_manager,r.readiness_pct,r.quality_avg,r.overall_rating,r.overall_score,r.follow_up,r.created_at,r.updated_at,
      st.name store_name,st.username store_code,st.area_manager,st.rom,st.region,st.city,t.name trainer_name,t.employee_id trainer_employee_id
    FROM sv_reports r JOIN stores st ON st.id=r.store_id LEFT JOIN trainers t ON t.id=r.trainer_id`;

  if (path === "/api/sv" && method === "GET") {
    return json((await env.DB.prepare(`${SV_LIST} WHERE ${wide ? "+" : ""}r.created_at >= ?1 AND ${wide ? "+" : ""}r.created_at < ?2 AND (?3 IS NULL OR r.trainer_id=?3) AND r.id < ?4 ORDER BY r.id DESC LIMIT ${page}`).bind(from, to, owner(), before).all()).results);
  }
  if (path === "/api/sv/template" && method === "GET") {
    // the checkpoint wording of this trainer's last report, so the same list does not have to be typed every time
    const r = isAdmin ? null : await env.DB.prepare("SELECT body FROM sv_reports WHERE trainer_id=? ORDER BY id DESC LIMIT 1").bind(session.trainer.id).first();
    if (!r) return json({});
    const b = JSON.parse(r.body || "{}");
    return json({ readiness: (b.readiness || []).map((x) => x.item), quality: (b.quality || []).map((x) => x.product), highlights: (b.highlights || []).map((x) => x.text) });
  }
  if (path === "/api/sv" && method === "POST") {
    if (isAdmin) throw new HttpError(403, "Store visit reports are filled in from a trainer account");
    const b = await body();
    const store = await env.DB.prepare("SELECT id FROM stores WHERE id=? AND active=1").bind(+b.store_id).first();
    if (!store) throw bad("Choose a store");
    const v = buildSv(b);
    const r = await env.DB.prepare(
      "INSERT INTO sv_reports (store_id,trainer_id,visit_date,visit_time,branch_manager,visit_type,body,readiness_pct,quality_avg,overall_rating,overall_score,follow_up) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(store.id, session.trainer.id, v.visit_date, v.visit_time, v.branch_manager, v.visit_type, v.body, v.readiness_pct, v.quality_avg, v.overall_rating, v.overall_score, v.follow_up).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/sv\/(\d+)$/))) {
    const id = +m[1];
    const row = await env.DB.prepare("SELECT body, trainer_id FROM sv_reports WHERE id=?").bind(id).first();
    if (!row || !canTouch(row.trainer_id)) throw new HttpError(404, "Report not found");
    if (method === "GET") {
      const head = await env.DB.prepare(`${SV_LIST} WHERE r.id=?`).bind(id).first();
      return json({ ...head, ...JSON.parse(row.body || "{}") });
    }
    if (method === "DELETE") { await env.DB.prepare("DELETE FROM sv_reports WHERE id=?").bind(id).run(); return json({ ok: true }); }
    if (method === "PUT") {
      const b = await body();
      const v = buildSv(b);
      let storeSql = "", extra = [];
      if (b.store_id != null) {
        const store = await env.DB.prepare("SELECT id FROM stores WHERE id=?").bind(+b.store_id).first();
        if (!store) throw bad("Choose a store");
        storeSql = "store_id=?,"; extra = [store.id];
      }
      await env.DB.prepare(
        `UPDATE sv_reports SET ${storeSql}visit_date=?,visit_time=?,branch_manager=?,visit_type=?,body=?,readiness_pct=?,quality_avg=?,overall_rating=?,overall_score=?,follow_up=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(...extra, v.visit_date, v.visit_time, v.branch_manager, v.visit_type, v.body, v.readiness_pct, v.quality_avg, v.overall_rating, v.overall_score, v.follow_up, id).run();
      return json({ ok: true });
    }
  }
  return null;
}
