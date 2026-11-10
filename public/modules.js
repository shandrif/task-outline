/* Master dashboard, Onboarding, NPD, Training/Coaching, People Development and Store Visit reports. Loaded after app.js (shares its helpers). */
"use strict";

const fmtDay = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const todayYmd = () => ymd(new Date());
const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const modCfg = () => cachedGet("/modules", 3600e3);
const storeLabel = (s) => `${s.code} · ${s.name}`;
const STORE_KEYS = { am: "area_manager", rom: "rom", city: "city", region: "region" };   // record field -> store column
const r1 = (n) => Math.round(n * 10) / 10;
const field = (label, el, hint) => h("div", {}, h("label", {}, label), el, hint && h("div", { class: "small muted", style: "margin-top:4px" }, hint));
const scoreCell = (v) => (v == null ? h("span", { class: "muted" }, "—") : h("span", { class: `pct ${pctClass(v)}` }, `${v}%`));
const MODULE_ORDER = [["onboarding", "Onboarding"], ["npd", "NPD"], ["verify", "Verification"], ["sv", "Store visit"], ["coaching", "Training / Coaching"], ["development", "People Development"]];

// group rows by a field and average a value (a percentage)
function rollup(rows, key, getV = (r) => r.pct) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || "(none)", g = m.get(k) || { name: k, n: 0, scored: 0, sum: 0 };
    g.n++; const v = getV(r); if (v != null) { g.scored++; g.sum += v; }
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, avg: g.scored ? r1(g.sum / g.scored) : null }));
}
// "View by" tabs + roll-up table
function breakdown(rows, groups, { getV, cell = avgCell, valueLabel = "Avg verification %" } = {}) {
  if (!groups.length) return null;
  let by = groups[0][0];
  const tabs = h("div", { class: "tabs", style: "margin-bottom:12px" }), holder = h("div");
  const draw = () => {
    tabs.replaceChildren(...groups.map(([k, l]) => h("button", { type: "button", class: "tab" + (k === by ? " on" : ""), onclick: () => { by = k; draw(); } }, l)));
    holder.replaceChildren(grid({
      rows: rollup(rows, by, getV), sort: { key: "n", dir: -1 }, empty: "No data in this period.",
      cols: [{ key: "name", label: groups.find((x) => x[0] === by)[1], render: (r) => h("b", {}, r.name) }, { key: "n", label: "Records", num: true }, { key: "avg", label: valueLabel, num: true, render: (r) => cell(r.avg) }],
    }).el);
  };
  draw();
  return h("div", { class: "card" }, h("h2", {}, "View by"), tabs, holder);
}
const kpi = (cls, v, l, info) => tile(cls, v, l, info);
const recRow = (r) => [r.name || "—", r.emp_id || "", r.created_by_name || "", fmtPct(r.pct)];
const emptyCard = (t) => h("div", { class: "card" }, h("p", { class: "muted", style: "margin:0" }, t));

// ================= records modules =================
const BREAKDOWNS = {
  onboarding: [["position", "Position"], ["nationality", "Nationality"], ["location", "Location"], ["kind", "Type"]],
  npd: [["product_name", "Product"], ["am", "Area manager"], ["rom", "ROM"], ["store", "Store"]],
  coaching: [["topic", "Topic"], ["am", "Area manager"], ["rom", "ROM"], ["region", "Region"], ["city", "City"], ["branch", "Branch"]],
  development: [["kind", "Track"], ["am", "Area manager"], ["rom", "ROM"], ["region", "Region"], ["city", "City"]],
};

async function moduleView(key) {
  const { modules } = await modCfg();
  const cfg = modules[key];
  if (!cfg) return shell(emptyCard("Unknown section"), "#/home");
  const admin = session.role === "admin";
  let rows = await apiPages("/records" + rq("module=" + key));
  cachedGet("/stores", 60000).catch(() => {});
  const kindLabel = Object.fromEntries(cfg.kinds.map((k) => [k.key, k.label]));
  let kind = "";
  const holder = h("div");
  const multi = cfg.kinds.length > 1;

  const reload = async () => { rows = await apiPages("/records" + rq("module=" + key)); draw(); };
  const open = (rec) => recordForm(key, cfg, rec, rec ? rec.kind : kind || null, reload);
  const del = async (r) => { if (await confirmBox("Delete this record?", `${r.name || "Record"} will be removed.`, "Delete", true)) { try { await api(`/records/${r.id}`, { method: "DELETE" }); toast("Deleted"); await reload(); } catch (e) { toast(e.message); } } };

  function columns() {
    const fcol = (f) => ({ key: f.key, label: f.label, num: f.type === "pct", render: f.type === "pct" ? (r) => avgCell(r[f.key]) : f.type === "date" ? (r) => fmtDay(r[f.key]) : f.type === "textarea" ? (r) => trunc(r[f.key], 90) : undefined });
    let fields;
    if (kind || !multi) fields = (cfg.kinds.find((k) => k.key === kind) || cfg.kinds[0]).fields;
    else fields = cfg.kinds[0].fields.filter((f) => cfg.kinds.every((k) => k.fields.some((x) => x.key === f.key)) && f.type !== "textarea");
    const cols = [];
    if (multi && !kind) cols.push({ key: "kind", label: key === "development" ? "Track" : "Type", render: (r) => h("span", { class: "chip" }, kindLabel[r.kind] || r.kind) });
    cols.push(...fields.map(fcol));
    if (!cols.some((c) => c.key === "pct")) cols.push({ key: "pct", label: "Verification %", num: true, render: (r) => avgCell(r.pct) });
    if (admin) cols.push({ key: "created_by_name", label: "Entered by" });
    cols.push({ key: "created_at", label: "Entered", render: (r) => fmtDate(r.created_at) });
    cols.push({ key: "actions", label: "", nosort: true, render: (r) => (admin || r.created_by === session.trainer.id) ? h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end" },
      h("button", { class: "btn ghost sm", onclick: (e) => { e.stopPropagation(); open(r); } }, "Edit"),
      h("button", { class: "icon del", title: "Delete", "aria-label": "Delete record", onclick: (e) => { e.stopPropagation(); del(r); } }, "🗑")) : "" });
    return cols;
  }

  function draw() {
    const shown = kind ? rows.filter((r) => r.kind === kind) : rows;
    const scored = shown.filter((r) => r.pct != null);
    const avg = scored.length ? r1(scored.reduce((n, r) => n + r.pct, 0) / scored.length) : null;
    const strong = scored.filter((r) => r.pct >= GOOD).length, low = scored.filter((r) => r.pct < WARN).length;
    const per = periodText(), what = kind ? kindLabel[kind] : cfg.title, unscored = shown.length - scored.length;
    const head = ["Name", "Employee ID", "Entered by", "Verification %"];
    const lowest = [...scored].sort((a, b) => a.pct - b.pct);
    const tiles = [
      kpi("tealk", shown.length, "Records in this period", { title: "Records", headline: `${shown.length} record${shown.length === 1 ? "" : "s"}`,
        text: [`Every ${what} record entered in ${per}${admin ? "" : " by you"} is counted once.`],
        sections: [...(multi && !kind ? [{ title: "By type", head: ["Type", "Records"], rows: cfg.kinds.map((k) => [k.label, shown.filter((r) => r.kind === k.key).length]) }] : []), ...(admin ? [{ title: "Entered by", head: ["Trainer", "Records"], rows: [...rollup(shown, "created_by_name").sort((a, b) => b.n - a.n).map((g) => [g.name, g.n])] }] : [])] }),
      kpi("", fmtPct(avg), "Average verification %", { title: "Average verification %", headline: avg == null ? "No scores yet" : `${avg}%`,
        text: [avg == null ? "None of the records has a verification % yet." : `This is the average of the verification % of the ${scored.length} record${scored.length === 1 ? "" : "s"} that have one.${unscored ? ` ${unscored} record${unscored === 1 ? " has" : "s have"} no score yet (for example onboarding still in progress) and ${unscored === 1 ? "is" : "are"} left out.` : ""}`],
        sections: [{ title: "Lowest first", head, rows: lowest.map(recRow) }] }),
      kpi("tank", strong, `Strong · ${GOOD}% or more`, { title: "Strong results", headline: `${strong} of ${scored.length} scored`, text: [`Records with a verification % of ${GOOD} or more.`], sections: [{ title: "Who", head, rows: lowest.filter((r) => r.pct >= GOOD).reverse().map(recRow) }] }),
      kpi("", low, `Needs attention · below ${WARN}%`, { title: "Needs attention", headline: `${low} of ${scored.length} scored`, text: [`Records with a verification % below ${WARN}. These are the people or products that need more training.`], sections: [{ title: "Who", head, rows: lowest.filter((r) => r.pct < WARN).map(recRow), empty: "Nobody is below the line." }] }),
    ];
    if (key === "onboarding") {
      const inT = shown.filter((r) => r.training_start && !r.training_end), rest = shown.filter((r) => !(r.training_start && !r.training_end));
      const trow = (r) => [r.name, r.emp_id, kindLabel[r.kind], r.training_start ? fmtDay(r.training_start) : "—", r.training_end ? fmtDay(r.training_end) : "—"];
      tiles[2] = kpi("tank", inT.length, "Currently in training", { title: "Currently in training", headline: `${inT.length} employee${inT.length === 1 ? "" : "s"}`, text: ["A training start date is entered but no end date yet."], sections: [{ title: "Who", head: ["Name", "Employee ID", "Type", "Started", "Ended"], rows: inT.map(trow) }] });
      tiles[3] = kpi("", rest.length, "Training finished or not started", { title: "Finished or not started", headline: `${rest.length} employee${rest.length === 1 ? "" : "s"}`, text: ["Either the training has an end date, or no start date has been entered yet."], sections: [{ title: "Who", head: ["Name", "Employee ID", "Type", "Started", "Ended"], rows: rest.map(trow) }] });
    }

    const cols = columns();
    const g = grid({
      rows: shown, cols, sort: { key: "created_at", dir: -1 }, empty: "No records yet. Use “+ Add record”.", onRow: (r) => ((admin || r.created_by === session.trainer.id) ? open(r) : null),
      searchIn: (r) => Object.values(r).filter((v) => typeof v === "string").join(" "),
      filters: [...["position", "nationality", "location", "topic", "product_name", "am", "rom", "region", "city"].filter((k) => cols.some((c) => c.key === k)).map((k) => ({ key: k, label: ({ position: "positions", nationality: "nationalities", location: "locations", topic: "topics", product_name: "products", am: "area managers", rom: "ROMs", region: "regions", city: "cities" })[k] })), ...(admin ? [{ key: "created_by_name", label: "trainers" }] : [])],
      toolbar: [h("button", { class: "btn teal sm", onclick: () => reportRecords(key, cfg, g.rows(), cols, { kindLabel, total: shown.length, kind }) }, "Export to Excel")],
    });
    holder.replaceChildren(
      multi && h("div", { class: "tabs", style: "margin-bottom:12px" }, [["", "All"], ...cfg.kinds.map((k) => [k.key, k.label])].map(([k, l]) => h("button", { type: "button", class: "tab" + (k === kind ? " on" : ""), onclick: () => { kind = k; draw(); } }, l, h("span", { class: "muted small" }, ` ${k ? rows.filter((r) => r.kind === k).length : rows.length}`)))),
      h("div", { class: "grid g4" }, tiles),
      shown.length > 0 && breakdown(shown.map((r) => ({ ...r, kind: kindLabel[r.kind] || r.kind })), [...BREAKDOWNS[key].filter(([k]) => k === "kind" ? multi && !kind : shown.some((r) => r[k])), ...(admin ? [["created_by_name", "Entered by"]] : [])]),
      h("div", { class: "card" }, h("h2", {}, "Records"), g.el));
  }
  draw();
  return shell(h("div", {},
    pageHead(cfg.title, "Add records, then see how each area is doing.", rangeBar(), key === "npd" && admin && h("button", { class: "btn ghost", onclick: () => manageProducts(reload) }, "Manage products"), h("button", { class: "btn teal", onclick: () => open(null) }, "+ Add record")),
    holder), `#/m/${key}`);
}

async function recordForm(modKey, cfg, rec, presetKind, onSaved) {
  const admin = session.role === "admin";
  const stores = await cachedGet("/stores", 60000);
  const products = modKey === "npd" ? (await api("/npd-products")).filter((x) => x.active) : [];
  const byLabel = new Map(stores.map((s) => [storeLabel(s).toLowerCase(), s]));
  let kindKey = rec ? rec.kind : presetKind ?? cfg.kinds[0].key;
  if (!cfg.kinds.some((k) => k.key === kindKey)) kindKey = cfg.kinds[0].key;
  let inputs = {};
  const body = h("div", { class: "stack" }), err = h("p", { class: "err", style: "margin:0" });
  const list = h("datalist", { id: "dl-stores" }, stores.map((s) => h("option", { value: storeLabel(s) }, `${s.city || ""} ${s.area_manager || ""}`.trim())));
  const kindSel = !rec && cfg.kinds.length > 1 ? h("select", { onchange: (e) => { kindKey = e.target.value; build(); } }, cfg.kinds.map((k) => h("option", { value: k.key, selected: k.key === kindKey }, k.label))) : null;

  function build() {
    const kd = cfg.kinds.find((k) => k.key === kindKey);
    const prev = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
    inputs = {};
    const live = h("div", { class: "small", style: "font-weight:700" });
    const refresh = () => {
      if (modKey !== "onboarding") return;
      const t = inputs.theory.value, p = inputs.practical.value;
      live.textContent = t !== "" && p !== "" ? `Verification %: ${r1((+t + +p) / 2)}% (average of theory and practical)` : "Verification % is the average of theory % and practical % — enter both.";
    };
    const els = kd.fields.map((f) => {
      const val = prev[f.key] ?? rec?.[f.key] ?? "";
      let el;
      if (f.type === "textarea") el = h("textarea", { rows: 3, maxlength: 2000, value: val });
      else if (f.type === "date") el = h("input", { type: "date", value: val });
      else if (f.type === "product") {
        // product names are set by the admin: pick from the list, no free typing
        const names = products.map((x) => x.name), cur = String(val || "");
        if (cur && !names.some((n) => n.toLowerCase() === cur.toLowerCase())) names.unshift(cur);   // an older record keeps its name
        el = h("select", { disabled: names.length === 0 }, h("option", { value: "" }, names.length ? "Select a product" : "No products yet"), ...names.map((n) => h("option", { value: n, selected: n.toLowerCase() === cur.toLowerCase() }, n)));
        if (!names.length) el.dataset.empty = "1";
      }
      else if (f.type === "pct") el = h("input", { type: "number", min: 0, max: 100, step: "0.1", inputmode: "decimal", value: val, oninput: refresh });
      else el = h("input", { type: "text", maxlength: 120, value: val, placeholder: f.placeholder || (f.type === "store" ? "Search or pick a store" : ""), list: f.type === "store" ? "dl-stores" : null, autocomplete: "off" });
      if (f.type === "store") {
        const fill = () => { const s = byLabel.get(el.value.trim().toLowerCase()); if (s) for (const k of f.fills || []) if (inputs[k]) inputs[k].value = s[STORE_KEYS[k]] || ""; };
        el.addEventListener("change", fill); el.addEventListener("input", fill);
      }
      inputs[f.key] = el;
      return h("div", { class: f.type === "textarea" ? "span2" : "" }, h("label", {}, f.label, f.required && " *"), el,
        f.type === "product" && el.dataset.empty && h("div", { class: "small muted", style: "margin-top:4px" }, admin ? "Add the product names first: use “Manage products” on this page." : "The admin has not added any product names yet."));
    });
    body.replaceChildren(list, kindSel && field(modKey === "development" ? "Track" : "Type", kindSel), h("div", { class: "grid g2" }, els), modKey === "onboarding" && live, err);
    refresh();
  }
  build();
  await modal(`${rec ? "Edit" : "Add"} record — ${cfg.title}`, body, (close) => {
    const save = h("button", { class: "btn teal", onclick: async () => {
      save.disabled = true; err.textContent = "";
      const data = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
      try {
        if (rec) await api(`/records/${rec.id}`, { method: "PATCH", body: data });
        else await api("/records", { method: "POST", body: { module: modKey, kind: kindKey, ...data } });
        toast(rec ? "Record updated" : "Record added"); close(true); await onSaved();
      } catch (e) { err.textContent = e.message; save.disabled = false; }
    } }, rec ? "Save" : "Add record");
    return [h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"), save];
  });
}

// ================= master dashboard =================
async function homeView() {
  const [d, { modules }] = await Promise.all([api("/home/summary" + rq()), modCfg()]);
  const admin = session.role === "admin";
  const recs = (mod) => d.records.filter((r) => r.module === mod);
  const tot = (rs, f) => rs.reduce((n, r) => n + r[f], 0);
  const avgOf = (rs) => { const s = tot(rs, "scored"); return s ? r1(tot(rs, "sum_pct") / s) : null; };
  const verAvg = d.verify.max ? pct(d.verify.score, d.verify.max) : null;
  const svAvg = d.sv.scored ? r1(d.sv.sum_score / d.sv.scored) : null;
  const trainingRecs = d.records;
  const kindsLine = (mod) => modules[mod].kinds.map((k) => [k.label, tot(recs(mod).filter((r) => r.kind === k.key), "n")]).filter(([, n]) => n > 0).map(([l, n]) => `${l} ${n}`).join(" · ") || "No entries yet";
  const cards = {
    onboarding: { href: "#/m/onboarding", n: tot(recs("onboarding"), "n"), label: "employees onboarded", avg: avgOf(recs("onboarding")), line: kindsLine("onboarding") },
    npd: { href: "#/m/npd", n: tot(recs("npd"), "n"), label: "NPD verifications", avg: avgOf(recs("npd")), line: "New product development" },
    verify: { href: admin ? "#/admin" : "#/verify", n: d.verify.evaluations, label: "staff evaluations", avg: verAvg, line: `${d.verify.visits} store visit${d.verify.visits === 1 ? "" : "s"} · ${d.verify.stores} store${d.verify.stores === 1 ? "" : "s"}` },
    sv: { href: "#/sv", n: d.sv.n, label: "store visit reports", avg: null, score: svAvg, line: `${d.sv.stores} store${d.sv.stores === 1 ? "" : "s"} · ${d.sv.follow_ups} follow-up${d.sv.follow_ups === 1 ? "" : "s"} needed` },
    coaching: { href: "#/m/coaching", n: tot(recs("coaching"), "n"), label: "coaching sessions", avg: avgOf(recs("coaching")), line: "Topics trained and verified" },
    development: { href: "#/m/development", n: tot(recs("development"), "n"), label: "people in development", avg: avgOf(recs("development")), line: kindsLine("development") },
  };
  const card = ([k, title]) => { const c = cards[k]; return h("a", { class: "mcard", href: c.href },
    h("div", { class: "mt" }, title, c.score != null ? h("span", { class: `pct ${pctClass(c.score)}` }, `${c.score}% avg`) : c.avg != null ? h("span", { class: `pct ${pctClass(c.avg)}` }, `${c.avg}% avg`) : h("span", { class: "muted small" }, "no scores yet")),
    h("div", { class: "mv" }, c.n), h("div", { class: "ml" }, c.label), h("div", { class: "mline small muted" }, c.line)); };
  const recent = d.recent.map((r) => {
    const title = r.module === "storevisit" ? "Store visit" : (MODULE_ORDER.find((m) => m[0] === r.module) || [0, r.module])[1];
    return h("a", { class: "note-row", href: r.src === "sv" ? `#/sv/${r.id}` : `#/m/${r.module}`, style: "display:block;text-decoration:none;color:inherit" },
      h("div", { class: "small muted" }, `${title} · ${r.by_name || ""} · ${fmtDateTime(r.created_at)}`), h("b", {}, r.name || "—"), r.pct != null && h("span", { class: "muted" }, `  ${r.pct}%`));
  });
  let team = null;
  if (d.team) {
    team = grid({
      rows: d.team.map((t) => ({ ...t, total: t.onboarding + t.npd + t.coaching + t.development + t.storevisit + t.visits })), sort: { key: "total", dir: -1 }, empty: "Nothing entered yet.",
      searchIn: (t) => `${t.name} ${t.employee_id} ${t.designation}`,
      cols: [{ key: "name", label: "Trainer", render: (t) => h("span", {}, h("b", {}, t.name), t.employee_id && h("div", { class: "small muted" }, `${t.employee_id} · ${t.designation}`)) },
        { key: "onboarding", label: "Onboarding", num: true }, { key: "npd", label: "NPD", num: true }, { key: "evaluations", label: "Staff evaluated", num: true }, { key: "visits", label: "Verification visits", num: true },
        { key: "storevisit", label: "Store visit reports", num: true }, { key: "coaching", label: "Coaching", num: true }, { key: "development", label: "People dev.", num: true }, { key: "total", label: "Total", num: true, render: (t) => h("b", {}, t.total) }],
    });
  }
  const entries = tot(trainingRecs, "n") + d.sv.n + d.verify.evaluations;
  const per = periodText();
  const modRows = ["onboarding", "npd", "coaching", "development"].map((m) => [modules[m].title, tot(recs(m), "n"), tot(recs(m), "scored"), fmtPct(avgOf(recs(m)))]);
  const masterTiles = () => [
    kpi("tealk", entries, "Entries in this period", { title: "Entries", headline: `${entries} in ${per}`, text: ["Everything entered in this period, added together: records in Onboarding, NPD, Coaching and People development, plus store visit reports and staff evaluations (Verification)."],
      sections: [{ title: "By area", head: ["Area", "Entries"], rows: [...modRows.map((r) => [r[0], r[1]]), ["Store visit reports", d.sv.n], ["Staff evaluations (Verification)", d.verify.evaluations]] }] }),
    kpi("", fmtPct(avgOf(trainingRecs)), "Avg verification % · Onboarding, NPD, Coaching, People dev.", { title: "Average verification %", headline: avgOf(trainingRecs) == null ? "No scores yet" : `${avgOf(trainingRecs)}%`,
      text: [`The average of every verification % entered in ${per} across Onboarding, NPD, Training/Coaching and People development (${tot(trainingRecs, "scored")} scored record${tot(trainingRecs, "scored") === 1 ? "" : "s"}). Verification (SBS) and Store visit scores are separate.`],
      sections: [{ title: "By area", head: ["Area", "Records", "With a score", "Average"], rows: modRows }] }),
    kpi("tank", fmtPct(verAvg), "Verification (SBS) average score", { title: "Verification (SBS) average", headline: verAvg == null ? "No score yet" : `${verAvg}%`,
      text: [verAvg == null ? "No staff evaluation was submitted in this period." : `Across ${d.verify.evaluations} submitted staff evaluation${d.verify.evaluations === 1 ? "" : "s"} in ${per}, ${d.verify.score} of ${d.verify.max} tasks were performed correctly (${d.verify.score} ÷ ${d.verify.max} = ${verAvg}%).`],
      sections: [{ title: "Behind the number", head: ["", ""], rows: [["Store visits (Verification)", d.verify.visits], ["Different stores", d.verify.stores], ["Staff evaluations", d.verify.evaluations]] }] }),
    kpi("", svAvg == null ? "—" : `${svAvg}%`, "Store visit average score", { title: "Store visit average score", headline: svAvg == null ? "No score yet" : `${svAvg}%`,
      text: [svAvg == null ? "No store visit report with an overall score was saved in this period." : `The average of the overall score (out of 100%) on ${d.sv.scored} store visit report${d.sv.scored === 1 ? "" : "s"} in ${per}.${d.sv.n > d.sv.scored ? ` ${d.sv.n - d.sv.scored} report${d.sv.n - d.sv.scored === 1 ? " has" : "s have"} no overall score and ${d.sv.n - d.sv.scored === 1 ? "is" : "are"} left out.` : ""}`],
      sections: [{ title: "Behind the number", head: ["", ""], rows: [["Reports", d.sv.n], ["Different stores", d.sv.stores], ["Follow-up visits needed", d.sv.follow_ups]] }] }),
  ];
  return shell(h("div", {},
    pageHead(admin ? "Master dashboard" : "My dashboard", admin ? "All six areas at a glance. Open any card for its own dashboard." : "Your own entries across all six areas.", rangeBar()),
    admin && d.pending > 0 && h("a", { class: "notice", href: "#/admin/trainers" }, `${d.pending} trainer${d.pending === 1 ? " is" : "s are"} waiting for your approval → Review`),
    h("div", { class: "grid g4" }, masterTiles()),
    h("div", { class: "grid g3 mcards", style: "margin-top:16px" }, MODULE_ORDER.map(card)),
    team && h("div", { class: "card" }, h("h2", {}, "Team activity"), h("p", { class: "muted small" }, "What each trainer entered in this period."), team.el),
    h("div", { class: "card" }, h("h2", {}, "Latest activity"), recent.length ? recent : h("p", { class: "muted" }, "Nothing yet."))), "#/home");
}

// ================= store visit reports =================
const svNo = (id) => `SV-${String(id).padStart(4, "0")}`;
async function svList() {
  const admin = session.role === "admin";
  const rows = (await apiPages("/sv" + rq())).map((r) => ({ ...r, report: svNo(r.id), store: `${r.store_code} · ${r.store_name}` }));
  const scored = rows.filter((r) => r.overall_score != null), rd = rows.filter((r) => r.readiness_pct != null);
  const avg = scored.length ? r1(scored.reduce((n, r) => n + r.overall_score, 0) / scored.length) : null;
  const ravg = rd.length ? r1(rd.reduce((n, r) => n + r.readiness_pct, 0) / rd.length) : null;
  const cols = [
    { key: "id", label: "Report", num: true, render: (r) => h("b", {}, r.report) }, { key: "visit_date", label: "Visit date", render: (r) => fmtDay(r.visit_date) },
    { key: "store", label: "Store" }, ...MAP_COLS, ...(admin ? [{ key: "trainer_name", label: "Visited by" }] : []),
    { key: "visit_type", label: "Type" }, { key: "readiness_pct", label: "Readiness", num: true, render: (r) => avgCell(r.readiness_pct) },
    { key: "quality_avg", label: "Quality avg", num: true, render: (r) => scoreCell(r.quality_avg) }, { key: "overall_score", label: "Overall", num: true, render: (r) => scoreCell(r.overall_score) },
    { key: "overall_rating", label: "Rating" }, { key: "follow_up", label: "Follow-up", num: true, render: (r) => (r.follow_up ? h("span", { class: "chip warn" }, "Required") : h("span", { class: "muted" }, "No")) },
    { key: "emailed_at", label: "Emailed", render: (r) => (r.emailed_at ? h("span", { class: "chip good", title: fmtDateTime(r.emailed_at) }, fmtDate(r.emailed_at)) : h("span", { class: "muted" }, "—")) },
  ];
  const g = grid({
    rows, cols, sort: { key: "visit_date", dir: -1 }, onRow: (r) => (location.hash = `#/sv/${r.id}`), empty: "No store visit reports yet.",
    searchIn: (r) => `${r.report} ${r.store} ${r.area_manager || ""} ${r.rom || ""} ${r.city || ""} ${r.trainer_name || ""} ${r.branch_manager || ""}`,
    filters: [...MAP_FILTERS, ...(admin ? [{ key: "trainer_name", label: "trainers" }] : []), { key: "visit_type", label: "visit types" }, { key: "overall_rating", label: "ratings" }, { key: "follow_up", label: "follow-ups", get: (r) => (r.follow_up ? "1" : "0"), show: (v) => (v === "1" ? "Required" : "Not required") }, { key: "emailed", label: "email statuses", get: (r) => (r.emailed_at ? "1" : "0"), show: (v) => (v === "1" ? "Emailed" : "Not emailed yet") }],
    toolbar: [h("button", { class: "btn teal sm", onclick: () => reportSv(g.rows(), { total: rows.length }) }, "Export to Excel")],
  });
  const groups = [["store", "Store"], ["area_manager", "Area manager"], ["rom", "ROM"], ["region", "Region"], ["city", "City"], ["visit_type", "Visit type"], ...(admin ? [["trainer_name", "Visited by"]] : [])];
  const per = periodText(), nStores = new Set(rows.map((r) => r.store_id)).size, rrow = (r) => [r.report, fmtDay(r.visit_date), r.store, r.trainer_name || "", r.overall_score == null ? "—" : `${r.overall_score}%`, r.readiness_pct == null ? "—" : `${r.readiness_pct}%`];
  const rhead = ["Report", "Date", "Store", "Visited by", "Overall", "Readiness"];
  const svTiles = () => [
    kpi("tealk", rows.length, `Reports · ${nStores} store${nStores === 1 ? "" : "s"}`, { title: "Reports", headline: `${rows.length} report${rows.length === 1 ? "" : "s"} on ${nStores} store${nStores === 1 ? "" : "s"}`,
      text: [`Every store visit report saved in ${per}${admin ? "" : " by you"}. A store reported twice counts as two reports but one store.`], sections: [{ title: "Reports per store", head: ["Store", "Reports"], rows: rollup(rows, "store").sort((a, b) => b.n - a.n).map((g) => [g.name, g.n]) }] }),
    kpi("", avg == null ? "—" : `${avg}%`, "Average overall score", { title: "Average overall score", headline: avg == null ? "No score yet" : `${avg}%`,
      text: [avg == null ? "No report has an overall score." : `The average of the overall score (out of 100%) on the ${scored.length} report${scored.length === 1 ? "" : "s"} that have one${rows.length > scored.length ? `; ${rows.length - scored.length} without a score ${rows.length - scored.length === 1 ? "is" : "are"} left out` : ""}.`],
      sections: [{ title: "Lowest scores first", head: rhead, rows: [...scored].sort((a, b) => a.overall_score - b.overall_score).map(rrow) }] }),
    kpi("tank", fmtPct(ravg), "Average store readiness", { title: "Average store readiness", headline: ravg == null ? "No data yet" : `${ravg}%`,
      text: [ravg == null ? "No report has answered readiness checkpoints." : `For each report, readiness is the share of “Yes” among the checkpoints answered Yes or No. This is the average of that share over ${rd.length} report${rd.length === 1 ? "" : "s"}.`],
      sections: [{ title: "Lowest readiness first", head: rhead, rows: [...rd].sort((a, b) => a.readiness_pct - b.readiness_pct).map(rrow) }] }),
    kpi("", rows.filter((r) => r.follow_up).length, "Follow-up visits needed", { title: "Follow-up visits needed", headline: `${rows.filter((r) => r.follow_up).length} report${rows.filter((r) => r.follow_up).length === 1 ? "" : "s"}`,
      text: ["Reports where the trainer marked “Follow-up visit required”."], sections: [{ title: "Which reports", head: rhead, rows: rows.filter((r) => r.follow_up).map(rrow), empty: "No follow-up is needed." }] }),
  ];
  return shell(h("div", {},
    pageHead("Store Visit Reports", "Branch readiness, product quality and team performance.", rangeBar(), !admin && h("a", { class: "btn teal", href: "#/sv/new" }, "+ New report")),
    h("div", { class: "grid g4" }, svTiles()),
    rows.length > 0 && breakdown(rows, groups, { getV: (r) => r.overall_score, cell: scoreCell, valueLabel: "Avg overall score" }),
    h("div", { class: "card" }, h("h2", {}, "Reports"), g.el)), "#/sv");
}

const ynSeg = (get, set) => {
  const y = h("button", { type: "button", class: "y" }, "Yes"), n = h("button", { type: "button", class: "n" }, "No");
  const paint = () => { y.classList.toggle("on", get() === 1); n.classList.toggle("on", get() === 0); };
  y.onclick = () => { set(get() === 1 ? null : 1); paint(); }; n.onclick = () => { set(get() === 0 ? null : 0); paint(); };
  paint(); return h("div", { class: "seg" }, y, n);
};
const textIn = (obj, k, ph, max = 300, attrs = {}) => h("input", { type: "text", maxlength: max, placeholder: ph, value: obj[k] ?? "", oninput: (e) => (obj[k] = e.target.value), ...attrs });
function rowList(arr, rowEl, blank, addLabel) {
  const wrap = h("div", { class: "rl" });
  const draw = (focusLast) => {
    wrap.replaceChildren(...arr.map((r, i) => rowEl(r, () => { arr.splice(i, 1); draw(); })),
      h("button", { type: "button", class: "btn ghost sm", onclick: () => { arr.push(blank()); draw(true); } }, addLabel));
    if (focusLast) wrap.querySelectorAll(".rrow:last-of-type input")[0]?.focus();
  };
  draw(); return wrap;
}
const svBlock = (n, title, hint, ...kids) => h("div", { class: "card svb" }, h("div", { class: "svh" }, h("span", { class: "svn" }, n), h("div", {}, h("h2", {}, title), hint && h("div", { class: "small muted" }, hint))), kids);

async function svForm(id) {
  if (session.role === "admin" && !id) { location.hash = "#/sv"; return h("div"); }
  const [{ sv: cfg }, stores] = await Promise.all([modCfg(), cachedGet("/stores", 60000)]);
  let st;
  const rowsOf = (items, mk) => (items && items.length ? items : [""]).map(mk);
  if (id) {
    st = await api(`/sv/${id}`);
    st.store_label = `${st.store_code} · ${st.store_name}`;
    const ensure = (a, blank) => (a && a.length ? a : [blank()]);
    st.readiness = ensure(st.readiness, () => ({ item: "", status: null, remarks: "" }));
    st.quality = ensure(st.quality, () => ({ product: "", meets: null, score: "", comments: "" }));
    st.team = { on_duty: st.team?.on_duty ?? "", checked: st.team?.checked ?? "", rows: ensure(st.team?.rows, () => ({ name: "", position: "", score: "", observation: "" })) };
    st.highlights = ensure(st.highlights, () => ({ text: "", status: null, remarks: "" }));
    st.actions = ensure(st.actions, () => ({ issue: "", action: "", owner: "", due: "" }));
    st.quality.forEach((q) => (q.score = q.score ?? ""));
  } else {
    const t = await api("/sv/template").catch(() => ({}));
    const pad = (a, n) => (a && a.length ? a : Array(n).fill(""));
    st = {
      store_id: null, store_label: "", visit_date: todayYmd(), visit_time: nowHm(), branch_manager: "", visit_type: "Routine",
      readiness: pad(t.readiness, 5).map((item) => ({ item, status: null, remarks: "" })), quality: pad(t.quality, 5).map((product) => ({ product, meets: null, score: "", comments: "" })),
      team: { on_duty: "", checked: "", rows: [1, 2, 3].map(() => ({ name: "", position: "", score: "", observation: "" })) },
      highlights: pad(t.highlights, 3).map((text) => ({ text, status: null, remarks: "" })), actions: [1, 2].map(() => ({ issue: "", action: "", owner: "", due: "" })),
      overall_rating: "", overall_score: "", follow_up: 0, overall_comment: "", ack_name: "", ack_date: "",
    };
  }
  const byLabel = new Map(stores.map((s) => [storeLabel(s).toLowerCase(), s]));
  const info = h("div", { class: "small muted" });
  const showInfo = () => { const s = stores.find((x) => x.id === st.store_id); info.textContent = s ? [s.area_manager && `AM: ${s.area_manager}`, s.rom && `ROM: ${s.rom}`, s.city, s.region].filter(Boolean).join(" · ") : ""; };
  const storeIn = h("input", { type: "text", list: "dl-sv-stores", autocomplete: "off", placeholder: "Search or pick a store", value: st.store_label || "", oninput: (e) => { const s = byLabel.get(e.target.value.trim().toLowerCase()); st.store_id = s ? s.id : null; showInfo(); } });
  showInfo();

  const summary = h("div", { class: "small", style: "font-weight:700" });
  const calc = () => {
    const a = st.readiness.filter((r) => r.status !== null), q = st.quality.filter((r) => r.score !== "" && r.score != null);
    summary.textContent = `Readiness: ${a.length ? r1((100 * a.filter((r) => r.status === 1).length) / a.length) + "%" : "—"} · Quality average: ${q.length ? r1(q.reduce((n, r) => n + +r.score, 0) / q.length) + "%" : "—"}`;
    return q.length ? r1(q.reduce((n, r) => n + +r.score, 0) / q.length) : null;
  };
  const seg = (obj, k) => ynSeg(() => obj[k], (v) => { obj[k] = v; calc(); });

  const readiness = rowList(st.readiness, (r, rm) => h("div", { class: "rrow r-ready" }, textIn(r, "item", "Checkpoint", 300, { "aria-label": "Checkpoint" }), seg(r, "status"), textIn(r, "remarks", "Remarks"), h("button", { type: "button", class: "icon del", "aria-label": "Remove row", onclick: rm }, "✕")), () => ({ item: "", status: null, remarks: "" }), "+ Add checkpoint");
  const scoreSel = (r) => h("input", { type: "number", min: 0, max: 100, step: "1", inputmode: "numeric", placeholder: "Score %", "aria-label": "Score, percent", value: r.score ?? "", oninput: (e) => { r.score = e.target.value; calc(); } });
  const quality = rowList(st.quality, (r, rm) => h("div", { class: "rrow r-qual" }, textIn(r, "product", "Product", 200, { "aria-label": "Product" }), seg(r, "meets"), scoreSel(r), textIn(r, "comments", "Comments"), h("button", { type: "button", class: "icon del", "aria-label": "Remove row", onclick: rm }, "✕")), () => ({ product: "", meets: null, score: "", comments: "" }), "+ Add product");
  const team = rowList(st.team.rows, (r, rm) => h("div", { class: "rrow r-team" }, textIn(r, "name", "Employee name", 120), textIn(r, "position", "Position", 80), h("input", { type: "number", min: 0, max: 100, step: "1", inputmode: "numeric", placeholder: "Score %", "aria-label": "Score, percent", value: r.score ?? "", oninput: (e) => (r.score = e.target.value) }), textIn(r, "observation", "Observation", 400), h("button", { type: "button", class: "icon del", "aria-label": "Remove row", onclick: rm }, "✕")), () => ({ name: "", position: "", score: "", observation: "" }), "+ Add employee");
  const highlights = rowList(st.highlights, (r, rm) => h("div", { class: "rrow r-ready" }, textIn(r, "text", "Highlight", 300), seg(r, "status"), textIn(r, "remarks", "Remarks"), h("button", { type: "button", class: "icon del", "aria-label": "Remove row", onclick: rm }, "✕")), () => ({ text: "", status: null, remarks: "" }), "+ Add highlight");
  const actions = rowList(st.actions, (r, rm) => h("div", { class: "rrow r-act" }, textIn(r, "issue", "Issue / observation", 400), textIn(r, "action", "Action required", 400), textIn(r, "owner", "Owner", 100), h("input", { type: "date", value: r.due || "", "aria-label": "Due date", onchange: (e) => (r.due = e.target.value) }), h("button", { type: "button", class: "icon del", "aria-label": "Remove row", onclick: rm }, "✕")), () => ({ issue: "", action: "", owner: "", due: "" }), "+ Add action");
  calc();

  const scoreIn = h("input", { type: "number", min: 0, max: 100, step: "0.1", inputmode: "decimal", placeholder: "%", value: st.overall_score ?? "", oninput: (e) => (st.overall_score = e.target.value) });
  const ratingSel = h("select", { onchange: (e) => (st.overall_rating = e.target.value) }, [["", "Select"], ...cfg.ratings.map((x) => [x, x])].map(([v, l]) => h("option", { value: v, selected: (st.overall_rating || "") === v }, l)));
  const save = h("button", { class: "btn teal", onclick: async () => {
    if (!st.store_id) return toast("Choose the store from the list");
    if (!st.visit_date) return toast("Visit date is required");
    save.disabled = true;
    try {
      const out = { ...st, follow_up: st.follow_up ? 1 : 0 };
      const res = id ? await api(`/sv/${id}`, { method: "PUT", body: out }) : await api("/sv", { method: "POST", body: out });
      dirty = false; toast("Report saved"); location.hash = `#/sv/${id || res.id}`;
    } catch (e) { toast(e.message); save.disabled = false; }
  } }, id ? "Save changes" : "Save report");
  let dirty = false;
  $app.addEventListener("input", () => (dirty = true), { once: true });
  window.onbeforeunload = () => (dirty ? "" : undefined);
  window.addEventListener("hashchange", () => (window.onbeforeunload = null), { once: true });

  return shell(h("div", {},
    pageHead(id ? `Edit ${svNo(id)}` : "New store visit report", "Fill in what applies. Rows can be added or left empty.", h("a", { class: "btn ghost sm", href: id ? `#/sv/${id}` : "#/sv" }, "Cancel"), save),
    h("datalist", { id: "dl-sv-stores" }, stores.map((s) => h("option", { value: storeLabel(s) }, `${s.city || ""}`))),
    h("div", { class: "card" }, h("div", { class: "grid g3" },
      h("div", {}, h("label", {}, "Branch / store *"), storeIn, info),
      field("Visit date *", h("input", { type: "date", value: st.visit_date, oninput: (e) => (st.visit_date = e.target.value) })),
      field("Visit time", h("input", { type: "time", value: st.visit_time || "", oninput: (e) => (st.visit_time = e.target.value) })),
      field("Visited by", h("input", { type: "text", value: id ? st.trainer_name || "" : session.trainer.name, disabled: true })),
      field("Branch / shift manager", textIn(st, "branch_manager", "", 120)),
      field("Visit type", h("select", { onchange: (e) => (st.visit_type = e.target.value) }, cfg.visitTypes.map((x) => h("option", { value: x, selected: st.visit_type === x }, x)))))),
    svBlock(1, "Store readiness", "Write your own checkpoints — Yes / No and remarks.", readiness),
    svBlock(2, "Quality check", "Meets Half Million standard? Score out of 100%.", quality),
    svBlock(3, "Team performance", "Employees checked during the visit.", h("div", { class: "grid g2", style: "margin-bottom:10px" },
      field("Employees on duty", h("input", { type: "number", min: 0, value: st.team.on_duty ?? "", oninput: (e) => (st.team.on_duty = e.target.value) })),
      field("Employees checked", h("input", { type: "number", min: 0, value: st.team.checked ?? "", oninput: (e) => (st.team.checked = e.target.value) }))), team),
    svBlock(4, "Visit highlights", null, highlights),
    svBlock(5, "Areas for improvement & action plan", null, actions),
    svBlock(6, "Overall assessment", null, h("div", { class: "grid g3" },
      field("Overall rating", ratingSel),
      field("Overall score (out of 100%)", h("div", { class: "row", style: "flex-wrap:nowrap" }, scoreIn, h("button", { type: "button", class: "btn ghost sm", title: "Use the average of the product scores", onclick: () => { const a = calc(); if (a != null) { st.overall_score = a; scoreIn.value = a; } } }, "Use quality avg"))),
      field("Follow-up visit required", ynSeg(() => (st.follow_up ? 1 : st.follow_up === 0 ? 0 : null), (v) => (st.follow_up = v === 1 ? 1 : 0)))),
      summary,
      field("Overall comment", h("textarea", { rows: 4, maxlength: 2000, value: st.overall_comment || "", oninput: (e) => (st.overall_comment = e.target.value) })),
      h("div", { class: "grid g2", style: "margin-top:10px" }, field("Acknowledged by (branch) — name", textIn(st, "ack_name", "", 120)), field("Acknowledgement date", h("input", { type: "date", value: st.ack_date || "", onchange: (e) => (st.ack_date = e.target.value) })))),
    h("div", { class: "row", style: "justify-content:flex-end" }, h("button", { class: "btn teal", onclick: () => save.click() }, id ? "Save changes" : "Save report"))), "#/sv");
}

async function svView(id) {
  const r = await api(`/sv/${id}`);
  const admin = session.role === "admin", mine = admin || r.trainer_id === session.trainer.id;
  const yn = (v) => (v === 1 ? h("span", { class: "chip good" }, "Yes") : v === 0 ? h("span", { class: "chip bad" }, "No") : h("span", { class: "muted" }, "—"));
  const table = (heads, rows, cell, empty) => (rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, heads.map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((x) => h("tr", {}, cell(x).map((c) => h("td", {}, c))))))) : h("p", { class: "muted small", style: "margin:0" }, empty));
  const kv = (l, v) => h("div", { class: "kv" }, h("div", { class: "k" }, l), h("div", { class: "vv" }, v || "—"));
  const del = async () => { if (await confirmBox("Delete this report?", `${svNo(id)} will be removed for good.`, "Delete", true)) { try { await api(`/sv/${id}`, { method: "DELETE" }); toast("Deleted"); location.hash = "#/sv"; } catch (e) { toast(e.message); } } };
  return shell(h("div", { class: "svview" },
    h("div", { class: "row no-print", style: "justify-content:space-between;margin-bottom:10px" }, h("a", { class: "btn ghost sm", href: "#/sv" }, "← Reports"),
      h("div", { class: "row" }, mine && h("a", { class: "btn ghost sm", href: `#/sv/${id}/edit` }, "Edit"), h("button", { class: "btn ghost sm", onclick: () => window.print() }, "Print / Save as PDF"), h("button", { class: "btn teal sm", onclick: () => svEmailDialog(r, renderRoute) }, "✉ Email to store"), mine && h("button", { class: "btn danger sm", onclick: del }, "Delete"))),
    r.emailed_at && h("div", { class: "sve-sent no-print" }, `✓ Emailed to the store on ${fmtDateTime(r.emailed_at)}`),
    h("div", { class: "card" },
      h("div", { class: "row", style: "justify-content:space-between;align-items:flex-start" }, h("div", {}, h("div", { class: "small muted", style: "letter-spacing:.12em;font-weight:700" }, "HALF MILLION · OPERATIONS"), h("h1", { style: "margin:4px 0 2px" }, "Store Visit Report"), h("div", { class: "muted" }, "Branch readiness, product quality and team performance assessment")), h("div", { style: "text-align:right" }, h("div", { class: "small muted" }, "REPORT NO."), h("b", { style: "font-size:20px" }, svNo(id)))),
      h("div", { class: "grid g3", style: "margin-top:16px" }, kv("Branch / store", `${r.store_code} · ${r.store_name}`), kv("Visit date", fmtDay(r.visit_date)), kv("Visit time", r.visit_time),
        kv("Visited by", r.trainer_name), kv("Branch / shift manager", r.branch_manager), kv("Visit type", r.visit_type), kv("Area manager", r.area_manager), kv("ROM", r.rom), kv("City / region", [r.city, r.region].filter(Boolean).join(" · ")))),
    h("div", { class: "card" }, h("h2", {}, "1 · Store readiness"), table(["Checkpoint", "Status", "Remarks"], r.readiness || [], (x) => [x.item, yn(x.status), x.remarks], "No checkpoints recorded.")),
    h("div", { class: "card" }, h("h2", {}, "2 · Quality check"), table(["Product", "Meets standard", "Score", "Comments"], r.quality || [], (x) => [x.product, yn(x.meets), x.score == null || x.score === "" ? "—" : `${x.score}%`, x.comments], "No products recorded.")),
    h("div", { class: "card" }, h("h2", {}, "3 · Team performance"), h("p", { class: "small", style: "margin:0 0 8px" }, `Employees on duty: ${r.team?.on_duty ?? "—"} · Employees checked: ${r.team?.checked ?? "—"}`), table(["Employee name", "Position", "Score", "Observation"], r.team?.rows || [], (x) => [x.name, x.position, x.score == null || x.score === "" ? "" : `${x.score}%`, x.observation], "No employees recorded.")),
    h("div", { class: "card" }, h("h2", {}, "4 · Visit highlights"), table(["Highlight", "Status", "Remarks"], r.highlights || [], (x) => [x.text, yn(x.status), x.remarks], "No highlights recorded.")),
    h("div", { class: "card" }, h("h2", {}, "5 · Areas for improvement & action plan"), table(["Issue / observation", "Action required", "Owner", "Due date"], r.actions || [], (x) => [x.issue, x.action, x.owner, x.due ? fmtDay(x.due) : ""], "No actions recorded.")),
    h("div", { class: "card" }, h("h2", {}, "6 · Overall assessment"),
      h("div", { class: "grid g3" }, kv("Overall rating", r.overall_rating), kv("Overall score (out of 100%)", r.overall_score == null ? "" : `${r.overall_score}%`), kv("Follow-up visit required", r.follow_up ? "Yes" : "No")),
      h("div", { class: "small muted", style: "margin-top:12px" }, `Store readiness ${r.readiness_pct == null ? "—" : r.readiness_pct + "%"} · Quality average ${r.quality_avg == null ? "—" : r.quality_avg + " / 5"}`),
      h("div", { style: "margin-top:12px" }, h("div", { class: "k small muted" }, "Overall comment"), h("div", { style: "white-space:pre-wrap" }, r.overall_comment || "—"))),
    h("div", { class: "card sign" }, h("div", { class: "grid g2" },
      h("div", {}, h("div", { class: "small muted" }, "Visited by"), h("div", {}, r.trainer_name || ""), h("div", { class: "sigline" }), h("div", { class: "small muted" }, "Signature")),
      h("div", {}, h("div", { class: "small muted" }, "Acknowledged by (branch)"), h("div", {}, r.ack_name || " "), h("div", { class: "small muted" }, r.ack_date ? fmtDay(r.ack_date) : ""), h("div", { class: "sigline" }), h("div", { class: "small muted" }, "Signature"))))), "#/sv");
}

// ================= NPD product list (admin only) =================
const askName = (title, initial) => {
  const inp = h("input", { type: "text", maxlength: 80, value: initial || "" });
  return modal(title, h("div", {}, inp), (close) => { inp.addEventListener("keydown", (e) => e.key === "Enter" && close(inp.value.trim())); return [h("button", { class: "btn ghost", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(inp.value.trim()) }, "Save")]; });
};
async function manageProducts(onChange) {
  const holder = h("div", { class: "stack" }), err = h("p", { class: "err", style: "margin:0" });
  const input = h("input", { type: "text", maxlength: 80, placeholder: "New product name", onkeydown: (e) => e.key === "Enter" && add() });
  let changed = false;
  async function act(fn) { try { err.textContent = ""; await fn(); changed = true; await draw(); } catch (e) { err.textContent = e.message; } }
  const add = () => act(async () => { if (!input.value.trim()) throw new Error("Type the product name first"); await api("/npd-products", { method: "POST", body: { name: input.value } }); input.value = ""; });
  async function draw() {
    const list = await api("/npd-products");
    holder.replaceChildren(
      h("div", { class: "row", style: "flex-wrap:nowrap" }, input, h("button", { class: "btn teal", onclick: add }, "+ Add")),
      err,
      list.length ? h("div", { class: "table-wrap", style: "max-height:46vh;overflow:auto" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, ["Product", "Records", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, list.map((p) => h("tr", { class: p.active ? "" : "off" }, h("td", {}, h("b", {}, p.name), !p.active && h("span", { class: "chip bad", style: "margin-left:8px" }, "Disabled")), h("td", {}, p.uses),
          h("td", {}, h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end" },
            h("button", { class: "btn ghost sm", onclick: async () => { const v = await askName("Rename product", p.name); if (v && v !== p.name) act(() => api(`/npd-products/${p.id}`, { method: "PATCH", body: { name: v } })); } }, "Rename"),
            h("button", { class: "btn ghost sm", onclick: () => act(() => api(`/npd-products/${p.id}`, { method: "PATCH", body: { active: !p.active } })) }, p.active ? "Disable" : "Enable"),
            h("button", { class: "icon del", title: p.uses ? "In use — disable it instead" : "Delete", "aria-label": `Delete ${p.name}`, onclick: () => act(async () => { if (!(await confirmBox("Delete product?", `“${p.name}” will be removed from the list.`, "Delete", true))) throw new Error("Cancelled"); await api(`/npd-products/${p.id}`, { method: "DELETE" }); }) }, "🗑"))))))))
        : h("p", { class: "muted", style: "margin:0" }, "No products yet. Add the first one above."),
      h("p", { class: "small muted", style: "margin:0" }, "Trainers can only pick from this list, so every product is spelled the same way. Renaming a product updates all its records. A product that has records can be disabled (hidden from new entries) but not deleted."));
  }
  await draw();
  await modal("NPD products", holder, (close) => [h("button", { class: "btn teal", onclick: () => close(true) }, "Done")]);
  if (changed) await onChange();
}
