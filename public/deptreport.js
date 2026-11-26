/* Training Department report (admin): one HM-branded workbook with an overview, an analytics page per area and every record,
   for a period picked when downloading (this week, last week, …). Built in the browser from the same data the pages use. */
"use strict";

const DEPT_PERIODS = (() => {
  const t = new Date(), d = (x) => ymd(x), add = (x, n) => { const y = new Date(x); y.setDate(y.getDate() + n); return y; };
  const mon = add(t, -t.getDay());            // this week's Sunday (weeks run Sunday–Saturday)
  const m1 = new Date(t.getFullYear(), t.getMonth(), 1), lm1 = new Date(t.getFullYear(), t.getMonth() - 1, 1), lmEnd = add(m1, -1);
  return [
    ["thisweek", "This week", d(mon), d(t)], ["lastweek", "Last week", d(add(mon, -7)), d(add(mon, -1))], ["7", "Last 7 days", d(add(t, -6)), d(t)],
    ["thismonth", "This month", d(m1), d(t)], ["lastmonth", "Last month", d(lm1), d(lmEnd)], ["30", "Last 30 days", d(add(t, -29)), d(t)],
  ];
})();

async function deptReportDialog() {
  const fmt = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  let pick = "lastweek";
  const opts = h("div", { class: "stack" }, DEPT_PERIODS.map(([k, l, f, to]) => h("label", { class: "row", style: "gap:10px;font-weight:700;cursor:pointer" },
    h("input", { type: "radio", name: "dept-p", value: k, checked: k === pick, onchange: () => (pick = k) }), l, h("span", { class: "muted small", style: "font-weight:400" }, `${fmt(f)} – ${fmt(to)}`))));
  const ok = await modal("Training Department report", h("div", { class: "stack" },
    h("p", { class: "muted small", style: "margin:0" }, "One Excel file for the whole department: an overview, an analytics page for each area (Verification, Onboarding, Coaching, NPD, People dev, Store visits, Workshop, Certification) and every record behind them."),
    opts), (close) => [h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(true) }, "Download")]);
  if (!ok) return;
  const [, label, from, to] = DEPT_PERIODS.find((p) => p[0] === pick);
  await reportDepartment(from, to, label);
}

async function reportDepartment(from, to, label) {
  const saved = { ...range };
  Object.assign(range, { preset: "custom", from, to });
  let d;
  try {
    toast("Collecting the department's data…");
    const [home, charts, admin, topics, cov, visits, evals, onb, npd, coach, dev, sv, ws, cfg, lms] = await Promise.all([
      api("/home/summary" + rq()), api("/home/charts" + rq()), api("/admin/summary" + rq()), api("/verify/topics" + rq()), api("/admin/coverage" + rq()),
      apiPages("/visits" + rq("all=1")), apiPages("/evals" + rq("all=1")),
      apiPages("/records" + rq("module=onboarding")), apiPages("/records" + rq("module=npd")), apiPages("/records" + rq("module=coaching")), apiPages("/records" + rq("module=development")),
      apiPages("/sv" + rq()), api("/workshop"), modCfg(), api("/lms/results" + rq()).catch(() => ({ sessions: [], attempts: [], questionStats: [] })),
    ]);
    d = { home, charts, admin, topics, cov, visits, evals: evals.filter((e) => e.status === "submitted"), onb, npd, coach, dev, sv, ws: ws.filter((w) => w.entry_date >= from && w.entry_date <= to), modules: cfg.modules, lms };
  } catch (e) { toast(e.message); return; } finally { Object.assign(range, saved); }

  const per = `${label} (${new Date(`${from}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(`${to}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })})`;
  const t = d.admin.totals;
  const pctOf = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const evRows = d.evals.map((e) => ({ ...e, p: pctOf(e.score, e.max_score), tp: pctOf(e.trained_count, e.max_score) }));
  const people = new Set(evRows.map((e) => `${e.store_code}|${String(e.staff_name || "").trim().toLowerCase()}`)).size;
  const visitRows = d.visits.map((v) => ({ ...v, avg: v.sum_max ? pctOf(v.sum_score, v.sum_max) : null }));
  const kindLabel = (mod) => Object.fromEntries(d.modules[mod].kinds.map((k) => [k.key, k.label]));
  const avgP = (rs) => xAvg(rs, (r) => r.pct);
  const svScored = d.sv.filter((r) => r.overall_score != null), svAvg = xAvg(svScored, (r) => r.overall_score);
  const notVisited = d.cov.stores.filter((s) => !s.visits);
  const flagged = d.cov.trainers.filter((x) => x.visits >= 4 && x.repeat_visits / x.visits >= 0.5);
  const wsDone = d.ws.filter((w) => w.status === "completed").length;
  const tone = (a) => (a == null ? "card" : a >= GOOD ? "good" : a >= WARN ? "teal" : "bad");

  // ---- trainers: everything each one did ----
  const tmap = new Map();
  const T = (name) => { if (!tmap.has(name)) tmap.set(name, { name, visits: 0, stores: new Set(), evals: 0, people: new Set(), onb: 0, npd: 0, coach: 0, dev: 0, sv: 0, ws: 0, scores: [] }); return tmap.get(name); };
  for (const v of visitRows) { const x = T(v.trainer_name || "—"); x.visits++; x.stores.add(v.store_code); }
  for (const e of evRows) { const x = T(e.trainer_name || "—"); x.evals++; x.people.add(`${e.store_code}|${String(e.staff_name).toLowerCase()}`); if (e.p != null) x.scores.push(e.p); }
  for (const [k, rows] of [["onb", d.onb], ["npd", d.npd], ["coach", d.coach], ["dev", d.dev]]) for (const r of rows) T(r.created_by_name || "—")[k]++;
  for (const r of d.sv) T(r.trainer_name || "—").sv++;
  for (const w of d.ws) T(w.trainer_name || w.created_by_name || "—").ws++;
  const trainers = [...tmap.values()].map((x) => ({ ...x, stores: x.stores.size, people: x.people.size, avg: x.scores.length ? Math.round((10 * x.scores.reduce((a, b) => a + b, 0)) / x.scores.length) / 10 : null,
    total: x.evals + x.onb + x.npd + x.coach + x.dev + x.sv + x.ws })).filter((x) => x.total + x.visits > 0).sort((a, b) => b.total - a.total);
  const maxT = Math.max(1, ...trainers.map((x) => x.total));

  // ---- areas overview ----
  const areas = [
    ["Verification (SBS)", evRows.length, xAvg(evRows, (e) => e.p), `${people} people · ${t.visits} visits · ${t.stores_visited} stores`],
    ["Onboarding", d.onb.length, avgP(d.onb), `${d.onb.filter((r) => r.training_end).length} finished · ${d.onb.filter((r) => r.assigned_store).length} placed in stores`],
    ["NPD", d.npd.length, avgP(d.npd), `${new Set(d.npd.map((r) => String(r.product_name || "").toLowerCase())).size} products`],
    ["Training / Coaching", d.coach.length, avgP(d.coach), `${d.coach.filter((r) => r.visit_id).length} given on the spot during visits`],
    ["People Development", d.dev.length, avgP(d.dev), `${new Set(d.dev.map((r) => r.kind)).size} tracks`],
    ["Store visit reports", d.sv.length, svAvg, `${new Set(d.sv.map((r) => r.store_code)).size} stores · ${d.sv.filter((r) => r.follow_up).length} follow-ups`],
    ["Workshop / projects", d.ws.length, null, `${wsDone} completed`],
    ["Certification", d.lms.attempts.length, xAvg(d.lms.attempts, (a) => a.pct), `${d.lms.sessions.length} sessions · ${d.lms.attempts.filter((a) => a.passed).length} passed`],
  ];
  const maxA = Math.max(1, ...areas.map((a) => a[1]));
  const entries = areas.reduce((n, a) => n + a[1], 0);
  const regions = [...d.cov.stores.reduce((m, s) => { const r = String(s.region || "Other").trim(); const k = r.charAt(0).toUpperCase() + r.slice(1).toLowerCase(); const x = m.get(k) || { r: k, n: 0, v: 0 }; x.n++; if (s.visits) x.v++; return m.set(k, x); }, new Map()).values()].sort((a, b) => b.n - a.n);
  const scoredStores = d.charts.stores.filter((s) => s.evals >= 2 && s.ev_pct != null);
  const trendWk = (w) => new Date(`${w}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const overview = {
    kpis: [
      { label: "Entries · all areas", value: entries, tone: "ink" },
      { label: "Staff evaluated (people)", value: people, tone: "teal" },
      { label: "Verification average", value: xAvg(evRows, (e) => e.p), pct: true, tone: tone(xAvg(evRows, (e) => e.p)) },
      { label: `Stores visited · of ${d.cov.stores.length}`, value: t.stores_visited, tone: "tan" },
      { label: "Coaching sessions", value: d.coach.length, tone: "card" },
    ],
    sections: [
      { title: "By area", note: "everything the department recorded in the period", cols: [["Area", 3, "left"], ["Entries", 1], ["Average", 1], ["Volume", 2, "left"], ["Details", 3, "left"]],
        rows: areas.map(([n, c, a, line]) => [cName(n), c, cPct(a), cVol(c, maxA, 12), { v: line, align: "left", color: XC.muted, size: 9 }]) },
      { title: "Trainers’ contributions", note: "what each trainer delivered", cols: [["Trainer", 2, "left"], ["Visits", 1], ["SBS", 1], ["Onb.", 1], ["Coaching", 1], ["Store rep.", 1], ["Other", 1], ["Total", 1], ["Volume", 1, "left"]],
        rows: trainers.map((x) => [cName(x.name), x.visits, x.evals, x.onb, x.coach, x.sv, x.npd + x.dev + x.ws, { v: x.total, bold: true }, cVol(x.total, maxT, 6)]), empty: "Nothing recorded in this period." },
      d.charts.trend.length > 0 && { title: "Week by week", note: "average scores", cols: [["Week of", 2, "left"], ["SBS evals", 1], ["SBS score", 1], ["SV reports", 1], ["SV score", 1], ["Records", 1], ["Verif. %", 1], ["Trend", 2, "left"]],
        rows: d.charts.trend.map((w) => [cName(trendWk(w.wk)), w.n_ver || 0, cPct(w.ver), w.n_sv || 0, cPct(w.sv), w.n_rec || 0, cPct(w.rec), cBar(w.ver)]) },
      { title: "Store coverage by region", note: `${t.stores_visited} of ${d.cov.stores.length} stores had a trainer`, cols: [["Region", 3, "left"], ["Stores", 1], ["Visited", 1], ["Not visited", 1], ["Coverage", 1], ["Progress", 3, "left"]],
        rows: regions.map((r) => { const p = pctOf(r.v, r.n); return [cName(r.r), r.n, r.v, r.n - r.v, cPct(p), cBar(p)]; }) },
      { title: "Areas of development", note: "lowest-performed sections", cols: [["Section", 4, "left"], ["Position", 2, "left"], ["Answers", 1], ["Performed", 1], ["Progress", 2, "left"]],
        rows: d.charts.weakest.map((w) => [cName(w.section), { v: w.position, align: "left" }, w.answered, cPct(w.pct), cBar(w.pct)]), empty: "No evaluations in this period." },
      { title: "Good highlights · top staff scores", note: "stores with 2+ evaluations", cols: [["Store", 4, "left"], ["Area manager", 3, "left"], ["Evaluations", 1], ["Score", 1], ["", 1]],
        rows: [...scoredStores].sort((a, b) => b.ev_pct - a.ev_pct || b.evals - a.evals).slice(0, 8).map((s) => [cName(`${s.code} · ${s.name}`), { v: s.area_manager || "—", align: "left" }, s.evals, cPct(s.ev_pct), ""]), empty: "Not enough evaluations yet." },
      { title: "Watch list", note: "what needs attention", cols: [["Item", 6, "left"], ["Count", 1], ["Detail", 3, "left"]],
        rows: [
          [cName("Stores with no visit"), { v: notVisited.length, bold: true, color: notVisited.length ? XC.bad : XC.good }, { v: regions.filter((r) => r.n > r.v).map((r) => `${r.r} ${r.n - r.v}`).join(" · "), align: "left", size: 9 }],
          [cName("Trainers repeating the same stores (50%+ repeat visits)"), { v: flagged.length, bold: true, color: flagged.length ? XC.bad : XC.good }, { v: flagged.map((x) => x.name).join(", "), align: "left", size: 9 }],
          [cName("Staff evaluated more than once"), d.cov.staff.length, { v: `${d.cov.staff.reduce((n, x) => n + x.times - 1, 0)} extra evaluations`, align: "left", size: 9 }],
          [cName(`Evaluations below ${WARN}%`), { v: evRows.filter((e) => e.p != null && e.p < WARN).length, bold: true }, { v: "see the Verification page", align: "left", size: 9 }],
          [cName("Store visit follow-ups required"), d.sv.filter((r) => r.follow_up).length, { v: "", align: "left" }],
        ] },
    ],
  };

  // ---- Verification page ----
  const byPos = d.admin.byPosition.filter((p) => p.evaluations > 0);
  const topicsTop = [...d.topics.topics].sort((a, b) => b.staff - a.staff).slice(0, 15);
  const covT = d.cov.trainers.map((x) => ({ ...x, share: x.visits ? Math.round((100 * x.repeat_visits) / x.visits) : 0 })).sort((a, b) => b.share - a.share);
  const verification = {
    sheetName: "Verification", tab: XC.teal, title: "Verification (SBS)",
    kpis: [
      { label: "Visits", value: t.visits, tone: "ink" }, { label: `Stores visited · of ${t.stores}`, value: t.stores_visited, tone: "tan" },
      { label: "Evaluations", value: evRows.length, tone: "teal" }, { label: "Staff evaluated (people)", value: people, tone: "card" },
      { label: "Average score", value: t.avg_pct, pct: true, tone: tone(t.avg_pct) },
    ],
    sections: [
      { title: "By position", cols: [["Position", 2, "left"], ["People", 1], ["Evals", 1], ["Stores", 1], ["Average", 1], ["Strong", 1], ["Low", 1], ["Progress", 2, "left"]],
        rows: byPos.map((p) => [cName(p.name), p.staff, p.evaluations, p.stores, cPct(p.avg_pct), p.strong, { v: p.low, color: p.low ? XC.bad : XC.ink }, cBar(p.avg_pct)]) },
      { title: "By trainer", note: "visits, coverage and scores", cols: [["Trainer", 2, "left"], ["Visits", 1], ["Stores", 1], ["Repeat %", 1], ["Evals", 1], ["People", 1], ["Average", 1], ["Flag", 2, "left"]],
        rows: covT.map((x) => { const tr = trainers.find((y) => y.name === x.name); const f = x.visits >= 4 && x.share >= 50 ? ["Repeating stores", XC.bad] : x.visits >= 3 && x.share >= 30 ? ["Watch", XC.warn] : ["Spread out", XC.good];
          return [cName(x.name), x.visits, x.stores, { v: x.share / 100, fmt: "0%", bold: true, color: f[1] }, tr?.evals ?? 0, tr?.people ?? 0, cPct(tr?.avg ?? null), { v: f[0], bold: true, color: f[1], align: "left" }]; }) },
      { title: "Verification by topic", note: `top 15 of ${d.topics.topics.length} topics`, cols: [["Topic", 4, "left"], ["Position", 2, "left"], ["Staff", 1], ["Trainers", 1], ["Performed", 1], ["", 1]],
        rows: topicsTop.map((x) => [cName(x.title), { v: x.position, align: "left" }, x.staff, x.trainers, cPct(x.pct), ""]) },
      { title: "Same trainer, same store 3+ times", cols: [["Trainer", 3, "left"], ["Store", 5, "left"], ["Visits", 1], ["", 1]],
        rows: d.cov.pairs.filter((p) => p.visits >= 3).map((p) => [cName(p.trainer), { v: `${p.code} · ${p.store}`, align: "left" }, { v: p.visits, bold: true, color: XC.bad }, ""]), empty: "No trainer visited the same store 3+ times." },
      { title: "Most re-evaluated staff", note: "top 10", cols: [["Staff", 3, "left"], ["Store", 3, "left"], ["Times", 1], ["By", 2, "left"], ["Avg", 1]],
        rows: d.cov.staff.slice(0, 10).map((x) => [cName(x.name), { v: `${x.code} · ${x.store}`, align: "left" }, { v: x.times, bold: true }, { v: x.trainers, align: "left", size: 9 }, cPct(x.pct)]), empty: "Nobody was evaluated twice." },
      { title: `Lowest scores · below ${WARN}%`, cols: [["Date", 1], ["Staff", 2, "left"], ["Position", 2, "left"], ["Store", 2, "left"], ["Trainer", 2, "left"], ["Score", 1]],
        rows: evRows.filter((e) => e.p != null && e.p < WARN).sort((a, b) => a.p - b.p).slice(0, 15).map((e) => [cDay(e.submitted_at), cName(e.staff_name), { v: e.position_name, align: "left" }, { v: `${e.store_code} · ${e.store_name}`, align: "left" }, { v: e.trainer_name || "", align: "left" }, cPct(e.p)]), empty: `Nobody scored below ${WARN}%. 🎉` },
    ],
  };

  // ---- Onboarding page ----
  const onbKL = kindLabel("onboarding"), onbS = onboardingSections(d.onb, onbKL, true);
  const onboarding = { sheetName: "Onboarding", tab: XC.tan, title: "Onboarding",
    kpis: [{ label: "New joiners", value: d.onb.length, tone: "ink" }, { label: "Avg verification", value: avgP(d.onb), pct: true, tone: tone(avgP(d.onb)) },
      { label: "Training finished", value: d.onb.filter((r) => r.training_end).length, tone: "teal" }, { label: "In training", value: d.onb.filter((r) => r.training_start && !r.training_end).length, tone: "tan" },
      { label: "Placed in stores", value: d.onb.filter((r) => r.assigned_store).length, tone: "card" }],
    sections: onbS.sections };

  // ---- records pages (Coaching, NPD, People dev) ----
  const recPage = (name, rows, title, groups, tab) => ({ sheetName: name, tab, title,
    kpis: [{ label: "Records", value: rows.length, tone: "ink" }, { label: "Avg verification", value: avgP(rows), pct: true, tone: tone(avgP(rows)) },
      { label: `Strong · ${GOOD}%+`, value: rows.filter((r) => r.pct >= GOOD).length, tone: "teal" }, { label: `Below ${WARN}%`, value: rows.filter((r) => r.pct != null && r.pct < WARN).length, tone: "card" },
      { label: "Trainers", value: new Set(rows.map((r) => r.created_by_name)).size, tone: "tan" }],
    sections: groups.filter(([, fn]) => rows.some((r) => fn(r))).map(([t2, fn, lbl]) => xRollup(t2, null, rows, fn, { label: lbl, count: "Records", pctFn: (r) => r.pct, pctLabel: "Avg verification", top: 12 })),
    tip: "Every record is on its own sheet further on." });
  const coaching = recPage("Coaching", d.coach, "Training / Coaching", [["By topic", (r) => r.topic, "Topic"], ["By trainer", (r) => r.created_by_name, "Trainer"], ["By region", (r) => r.region, "Region"], ["By area manager", (r) => r.am, "Area manager"]], "6250D6");
  const npdKL = kindLabel("npd"), devKL = kindLabel("development");
  const npd = recPage("NPD", d.npd, "NPD", [["By product", (r) => r.product_name, "Product"], ["By trainer", (r) => r.created_by_name, "Trainer"], ["By area manager", (r) => r.am, "Area manager"]], "E87BA4");
  const dev = recPage("People dev", d.dev, "People Development", [["By track", (r) => devKL[r.kind] || r.kind, "Track"], ["By trainer", (r) => r.created_by_name, "Trainer"], ["By region", (r) => r.region, "Region"]], "1BAF7A");

  // ---- Store visit reports page ----
  const svPage = { sheetName: "Store visits", tab: "EB6834", title: "Store Visit Reports",
    kpis: [{ label: "Reports", value: d.sv.length, tone: "ink" }, { label: "Average score", value: svAvg, pct: true, tone: tone(svAvg) },
      { label: "Avg readiness", value: xAvg(d.sv, (r) => r.readiness_pct), pct: true, tone: "teal" }, { label: "Stores", value: new Set(d.sv.map((r) => r.store_code)).size, tone: "tan" },
      { label: "Follow-ups", value: d.sv.filter((r) => r.follow_up).length, tone: "card" }],
    sections: [
      xRollup("By trainer", null, d.sv, (r) => r.trainer_name, { label: "Trainer", count: "Reports", pctFn: (r) => r.overall_score, pctLabel: "Avg score" }),
      xRollup("By region", null, d.sv, (r) => r.region, { label: "Region", count: "Reports", pctFn: (r) => r.overall_score, pctLabel: "Avg score" }),
      { title: "Lowest overall scores", cols: [["Date", 1], ["Store", 4, "left"], ["Trainer", 2, "left"], ["Rating", 2, "left"], ["Score", 1]],
        rows: [...svScored].sort((a, b) => a.overall_score - b.overall_score).slice(0, 10).map((r) => [cDay(r.visit_date), cName(`${r.store_code} · ${r.store_name}`), { v: r.trainer_name || "", align: "left" }, { v: r.overall_rating || "—", align: "left" }, cPct(r.overall_score)]), empty: "No scored reports." },
    ] };

  // ---- Workshop page ----
  const wsByStatus = ["open", "ongoing", "completed"].map((st) => [st, d.ws.filter((w) => w.status === st).length]);
  const workshop = { sheetName: "Workshop", tab: XC.warn, title: "Workshop / Projects",
    kpis: [{ label: "Entries", value: d.ws.length, tone: "ink" }, ...wsByStatus.map(([st, n]) => ({ label: st.charAt(0).toUpperCase() + st.slice(1), value: n, tone: st === "completed" ? "good" : st === "ongoing" ? "teal" : "tan" })),
      { label: "Completion rate", value: pctOf(wsDone, d.ws.length), pct: true, tone: "card" }],
    sections: [xRollup("By section", null, d.ws, (w) => (typeof WS_BY !== "undefined" && WS_BY[w.section]?.label) || w.section, { label: "Section", count: "Entries" }),
      xRollup("By trainer", null, d.ws, (w) => w.trainer_name || w.created_by_name, { label: "Trainer", count: "Entries" })] };

  // ---- LMS page ----
  const lsess = new Map(d.lms.sessions.map((x) => [x.id, x]));
  const LA = d.lms.attempts.map((a) => ({ ...a, s: lsess.get(a.session_id) || {} }));
  const lmsAvg = xAvg(LA, (a) => a.pct);
  const lmsPage = { sheetName: "Certification", tab: "2A78D6", title: "Certification",
    kpis: [{ label: "Sessions", value: d.lms.sessions.length, tone: "ink" }, { label: "Answers", value: LA.length, tone: "tan" }, { label: "Staff", value: new Set(LA.map((a) => String(a.emp_id).toLowerCase())).size, tone: "card" },
      { label: "Average score", value: lmsAvg, pct: true, tone: tone(lmsAvg) }, { label: "Pass rate", value: LA.length ? pctOf(LA.filter((a) => a.passed).length, LA.length) : null, pct: true, tone: "teal" }],
    sections: [
      xRollup("By quiz", null, LA, (a) => a.s.title, { label: "Quiz", count: "Answers", pctFn: (a) => a.pct, pctLabel: "Average" }),
      xRollup("By trainer", null, LA, (a) => a.s.trainer_name, { label: "Trainer", count: "Answers", pctFn: (a) => a.pct, pctLabel: "Average" }),
      xRollup("By region", null, LA, (a) => a.s.region, { label: "Region", count: "Answers", pctFn: (a) => a.pct, pctLabel: "Average" }),
      { title: "Hardest questions", note: "lowest share answering correctly (answered 3+ times)", cols: [["Question", 5, "left"], ["Quiz", 2, "left"], ["Answered", 1], ["Correct", 1], ["", 1]],
        rows: [...d.lms.questionStats].filter((q) => q.answered >= 3).sort((a, b) => a.pct - b.pct).slice(0, 12).map((q) => [cText(q.text), { v: q.quiz, align: "left" }, q.answered, cPct(q.pct), ""]), empty: "Not enough answers yet." },
    ] };

  // ---- data sheets ----
  const recCols = (mod) => { const seen = new Set(), out = []; for (const k of d.modules[mod].kinds) for (const f of k.fields) if (!seen.has(f.key) && f.key !== "pct") { seen.add(f.key); out.push(f); } return out; };
  const recSheet = (name, title, mod, rows, kl) => ({ name, title, rows: [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), summary: plural(rows.length, "record"),
    cols: [...(d.modules[mod].kinds.length > 1 ? [{ label: "Type", get: (r) => kl[r.kind] || r.kind, width: 16 }] : []),
      ...recCols(mod).map((f) => ({ label: f.label, get: (r) => r[f.key], type: f.type === "pct" ? "pct" : f.type === "date" ? "date" : f.type === "textarea" ? "long" : "text", bold: f.key === "name", width: f.key === "name" ? 22 : f.type === "textarea" ? 40 : undefined })),
      ...(mod === "onboarding" ? [{ label: "Placed · region", get: (r) => r.placed_region, width: 12 }, { label: "Placed · city", get: (r) => r.placed_city, width: 14 }] : []),
      { label: "Verification %", get: (r) => r.pct, type: "pct" }, { label: "Entered by", get: (r) => r.created_by_name, width: 20 }, { label: "Entered", get: (r) => r.created_at, type: "datetime" }] });

  hmReport({
    file: xFileName(`Training_Department_Report_${from}_to_${to}`), title: "Training Department Report", sheetName: "Overview", scope: "Whole department · all trainers", period: per,
    ...overview, pages: [verification, onboarding, coaching, npd, dev, svPage, workshop, lmsPage],
    tip: "An analytics page for each area follows (Verification, Onboarding, Coaching, NPD, People dev, Store visits, Workshop, Certification), then every record. Use the filter arrows on the data sheets.",
    sheets: [
      { name: "Data · Visits", title: "Verification visits", rows: [...visitRows].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))), summary: plural(visitRows.length, "visit"), tab: XC.teal,
        cols: [{ label: "Date", get: (v) => v.started_at, type: "datetime" }, { label: "Trainer", get: (v) => v.trainer_name, bold: true, width: 22 }, { label: "Store ID", get: (v) => v.store_code, width: 10 }, { label: "Store", get: (v) => v.store_name, width: 26 },
          { label: "Area manager", get: (v) => v.area_manager, width: 20 }, { label: "Region", get: (v) => v.region, width: 12 }, { label: "City", get: (v) => v.city, width: 14 }, { label: "Staff evaluated", get: (v) => v.staff, type: "int" },
          { label: "Avg score", get: (v) => v.avg, type: "pct" }, { label: "Status", get: (v) => v.status, type: "status", styles: XS_VISIT }, { label: "Notes", get: (v) => v.notes, type: "long", width: 40 }] },
      { name: "Data · Evaluations", title: "Staff evaluations", rows: [...evRows].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))), summary: `${plural(evRows.length, "evaluation")} · ${people} people`, tab: XC.teal,
        cols: [{ label: "Date", get: (e) => e.submitted_at, type: "datetime" }, { label: "Staff", get: (e) => e.staff_name, bold: true, width: 22 }, { label: "Staff ID", get: (e) => e.staff_code, width: 11 }, { label: "Position", get: (e) => e.position_name, width: 16 },
          { label: "Score", get: (e) => e.p, type: "pct" }, { label: "Training", get: (e) => e.tp, type: "pct" }, { label: "Trainer", get: (e) => e.trainer_name, width: 20 }, { label: "Store", get: (e) => `${e.store_code} · ${e.store_name}`, width: 26 },
          { label: "Area manager", get: (e) => e.area_manager, width: 20 }, { label: "Region", get: (e) => e.region, width: 12 }, { label: "Areas for improvement", get: (e) => e.improvement_notes, type: "long", width: 45 }] },
      { name: "Data · Topics", title: "Verification by topic", rows: [...d.topics.topics].sort((a, b) => b.staff - a.staff), summary: plural(d.topics.topics.length, "topic"), tab: XC.teal,
        cols: [{ label: "Topic", get: (x) => x.title, bold: true, width: 36 }, { label: "Position", get: (x) => x.position, width: 20 }, { label: "Staff verified", get: (x) => x.staff, type: "int", width: 12 }, { label: "Trainers", get: (x) => x.trainers, type: "int" }, { label: "Performed", get: (x) => x.pct, type: "pct" }] },
      { name: "Data · Stores", title: "Store coverage", rows: [...d.cov.stores].sort((a, b) => b.visits - a.visits), summary: `${t.stores_visited} of ${d.cov.stores.length} visited`, tab: XC.teal,
        cols: [{ label: "Store", get: (s) => `${s.code} · ${s.name}`, bold: true, width: 28 }, { label: "Region", get: (s) => s.region, width: 12 }, { label: "City", get: (s) => s.city, width: 14 }, { label: "Area manager", get: (s) => s.area_manager, width: 20 },
          { label: "Visits", get: (s) => s.visits, type: "int" }, { label: "Trainers", get: (s) => s.trainers, type: "int" }, { label: "Evaluations", get: (s) => s.evaluations, type: "int" }, { label: "Staff", get: (s) => s.people, type: "int" },
          { label: "Last visit (period)", get: (s) => s.last_in_period, type: "datetime" }, { label: "Last visit ever", get: (s) => s.last_visit_at, type: "datetime" }] },
      recSheet("Data · Onboarding", "Onboarding", "onboarding", d.onb, onbKL),
      ...onbS.sheets.filter((x) => x.name === "Placements").map((x) => ({ ...x, name: "Data · Placements" })),
      recSheet("Data · Coaching", "Training / Coaching", "coaching", d.coach, {}),
      recSheet("Data · NPD", "NPD", "npd", d.npd, npdKL),
      recSheet("Data · People dev", "People Development", "development", d.dev, devKL),
      { name: "Data · Store visits", title: "Store visit reports", rows: [...d.sv].sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date))), summary: plural(d.sv.length, "report"), tab: "EB6834",
        cols: [{ label: "Report", get: (r) => svNo(r.id), width: 10 }, { label: "Visit date", get: (r) => r.visit_date, type: "date" }, { label: "Store", get: (r) => `${r.store_code} · ${r.store_name}`, bold: true, width: 28 }, { label: "Trainer", get: (r) => r.trainer_name, width: 20 },
          { label: "Region", get: (r) => r.region, width: 12 }, { label: "Readiness", get: (r) => r.readiness_pct, type: "pct" }, { label: "Quality", get: (r) => r.quality_avg, type: "pct" }, { label: "Overall", get: (r) => r.overall_score, type: "pct" },
          { label: "Rating", get: (r) => r.overall_rating, width: 16 }, { label: "Follow-up", get: (r) => (r.follow_up ? "Yes" : "No"), type: "yesno", yesGood: false }, { label: "Emailed", get: (r) => (r.emailed_at ? "Yes" : "No"), type: "yesno" }] },
      { name: "Data · Certification", title: "Certification answers", rows: [...LA].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))), summary: plural(LA.length, "answer"), tab: "2A78D6",
        cols: [{ label: "When", get: (a) => a.submitted_at, type: "datetime" }, { label: "Staff", get: (a) => a.staff_name, bold: true, width: 22 }, { label: "Employee ID", get: (a) => a.emp_id, width: 12 }, { label: "Position", get: (a) => a.position, width: 16 },
          { label: "Quiz", get: (a) => a.s.title, width: 24 }, { label: "Score", get: (a) => a.pct, type: "pct" }, { label: "Passed", get: (a) => (a.passed ? "Yes" : "No"), type: "yesno" },
          { label: "Store", get: (a) => `${a.s.store_code} · ${a.s.store_name}`, width: 26 }, { label: "Trainer", get: (a) => a.s.trainer_name, width: 20 }] },
      { name: "Data · Workshop", title: "Workshop / projects", rows: [...d.ws].sort((a, b) => b.entry_date.localeCompare(a.entry_date)), summary: plural(d.ws.length, "entry", "entries"), tab: XC.warn,
        cols: [{ label: "Date", get: (w) => w.entry_date, type: "date" }, { label: "Section", get: (w) => (typeof WS_BY !== "undefined" && WS_BY[w.section]?.label) || w.section, width: 16 }, { label: "Title", get: (w) => w.title, bold: true, width: 30 },
          { label: "Details", get: (w) => w.details, type: "long", width: 45 }, { label: "Status", get: (w) => w.status, width: 12 }, { label: "Trainer", get: (w) => w.trainer_name || w.created_by_name, width: 20 }] },
    ],
  });
}
