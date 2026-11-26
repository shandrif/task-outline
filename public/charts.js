/* Dashboard charts: performance trend, outcomes, trainer contributions, areas of development, store gaps, highlights.
   Plain HTML/SVG (no library). Loaded after modules.js; uses h(), pct(), fmtPct(), periodText(). */
"use strict";

// validated categorical order (colour-blind safe on the HM card surface); activities keep their colour everywhere
const CH = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
const CH_REST = "#D9CDBD";                                  // neutral: "not visited"
const ACTS = [
  { key: "onboarding", label: "Onboarding" }, { key: "npd", label: "NPD" }, { key: "evaluations", label: "Staff evaluations" },
  { key: "storevisit", label: "Store visit reports" }, { key: "coaching", label: "Coaching" }, { key: "development", label: "People dev" }, { key: "workshop", label: "Workshop" },
].map((a, i) => ({ ...a, color: CH[i] }));
const chEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// one shared tooltip: any element with data-tip shows it on hover / focus / tap
let chTipEl = null;
function chTip(root) {
  if (!chTipEl) { chTipEl = h("div", { class: "ch-tip", role: "tooltip" }); document.body.append(chTipEl); }
  const show = (e) => { const t = e.target.closest("[data-tip]"); if (!t || !root.contains(t)) return; chTipEl.innerHTML = t.dataset.tip; chTipEl.classList.add("on"); move(e); };
  const move = (e) => { if (!chTipEl.classList.contains("on")) return; const x = e.clientX ?? e.target.getBoundingClientRect().right, y = e.clientY ?? e.target.getBoundingClientRect().top;
    const w = chTipEl.offsetWidth; chTipEl.style.transform = `translate(${Math.min(x + 14, innerWidth - w - 8)}px, ${Math.max(8, y - chTipEl.offsetHeight - 10)}px)`; };
  const hide = (e) => { if (!e.relatedTarget || !e.relatedTarget.closest?.("[data-tip]")) chTipEl.classList.remove("on"); };
  root.addEventListener("pointerover", show); root.addEventListener("pointermove", move); root.addEventListener("pointerout", hide);
  root.addEventListener("focusin", show); root.addEventListener("focusout", () => chTipEl.classList.remove("on"));
  return root;
}
const tipHtml = (title, rows) => `<b>${chEsc(title)}</b>${rows.map(([k, v, c]) => `<div class="ch-tip-row">${c ? `<i style="background:${c}"></i>` : ""}<span>${chEsc(k)}</span><b>${chEsc(v)}</b></div>`).join("")}`;
const legend = (items) => h("div", { class: "ch-legend" }, items.map((a) => h("span", {}, h("i", { style: `background:${a.color}` }), a.label)));
const chCard = (title, sub, ...body) => h("div", { class: "card ch-card" }, h("h3", { class: "ch-title" }, title), sub && h("p", { class: "muted small ch-sub" }, sub), body);
const empty = (t) => h("p", { class: "muted small ch-empty" }, t);

// horizontal bars: rows [{label, value, sub?, tip?, color?}], scale = max of values (or fixed 100 for %)
function hbars(rows, { max, fmt = (v) => v, color = CH[0], pctScale = false } = {}) {
  if (!rows.length) return empty("Nothing in this period.");
  const top = pctScale ? 100 : max ?? Math.max(1, ...rows.map((r) => r.value));
  return chTip(h("div", { class: "ch-hbars" }, rows.map((r) => h("div", { class: "ch-hrow", tabindex: 0, "data-tip": r.tip || tipHtml(r.label, [[pctScale ? "Score" : "Count", fmt(r.value)]]) },
    h("div", { class: "ch-hlabel" }, h("span", {}, r.label), r.sub && h("small", {}, r.sub)),
    h("div", { class: "ch-htrack" }, h("i", { style: `width:${Math.max(1.5, (100 * r.value) / top)}%;background:${r.color || color}` })),
    h("b", { class: "ch-hval" }, fmt(r.value))))));
}

// stacked horizontal bars: rows [{label, parts:[{value,color,label}], total}]
function stackbars(rows, parts) {
  if (!rows.length) return empty("Nothing in this period.");
  const top = Math.max(1, ...rows.map((r) => r.total));
  return h("div", {}, legend(parts), chTip(h("div", { class: "ch-hbars" }, rows.map((r) => h("div", { class: "ch-hrow" },
    h("div", { class: "ch-hlabel" }, h("span", {}, r.label)),
    h("div", { class: "ch-htrack ch-stack" }, r.parts.filter((p) => p.value > 0).map((p) => h("i", { tabindex: 0, style: `width:${(100 * p.value) / top}%;background:${p.color}`,
      "data-tip": tipHtml(r.label, [[p.label, p.value, p.color], ["Total", r.total]]) }))),
    h("b", { class: "ch-hval" }, r.total))))));
}

// line chart (weekly), y in %, one axis; series [{label,color,key}]
function linechart(points, series, { fmtX }) {
  const used = series.filter((s) => points.some((p) => p[s.key] != null));
  if (points.length < 2 || !used.length) return empty("Not enough weeks yet in this period for a trend. Try a longer period.");
  const W = 720, H = 240, L = 40, R = 150, T = 14, B = 30;
  const vals = points.flatMap((p) => used.map((s) => p[s.key]).filter((v) => v != null));
  let lo = Math.max(0, Math.floor((Math.min(...vals) - 4) / 5) * 5); const hi = 100; if (hi - lo < 10) lo = hi - 10;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1), y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks = []; for (let v = lo; v <= hi; v += (hi - lo) / 4) ticks.push(Math.round(v));
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="ch-line" role="img" aria-label="Average scores per week">`;
  svg += ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/><text x="${L - 8}" y="${y(v) + 4}" class="ch-ax" text-anchor="end">${v}%</text>`).join("");
  const step = Math.ceil(points.length / 8);
  svg += points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 8}" class="ch-ax" text-anchor="middle">${chEsc(fmtX(p.wk))}</text>` : "")).join("");
  const ends = [];
  for (const s of used) {
    const pts = points.map((p, i) => (p[s.key] == null ? null : [x(i), y(p[s.key])]));
    let d = "", pen = false; for (const q of pts) { if (!q) { pen = false; continue; } d += `${pen ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`; pen = true; }
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += pts.map((q) => (q ? `<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="${s.color}" stroke="#FBF7F1" stroke-width="2"/>` : "")).join("");
    const last = [...pts].reverse().find(Boolean); if (last) ends.push({ y: last[1], s, v: points[pts.lastIndexOf(last)][s.key] });
  }
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;   // keep end labels apart
  svg += ends.map((e) => `<text x="${W - R + 8}" y="${e.y + 4}" class="ch-end">${chEsc(e.s.short)} ${e.v}%</text>`).join("");
  // hover columns (bigger than the marks)
  const colW = (W - L - R) / Math.max(1, points.length - 1);
  svg += points.map((p, i) => `<rect x="${Math.max(L, x(i) - colW / 2)}" y="${T}" width="${Math.min(W - R, x(i) + colW / 2) - Math.max(L, x(i) - colW / 2)}" height="${H - T - B}" fill="transparent" class="ch-col" tabindex="0" data-tip="${chEsc(tipHtml(`Week of ${fmtX(p.wk)}`, used.map((s) => [s.label, p[s.key] == null ? "—" : `${p[s.key]}% (${p["n_" + s.key]})`, s.color])))}"/>`).join("");
  svg += "</svg>";
  const box = h("div", { class: "ch-linebox" }); box.innerHTML = svg;
  return h("div", {}, legend(used), chTip(box));
}

// ---------- the dashboard section ----------
async function dashboardCharts(d, admin) {
  let c;
  try { c = await api("/home/charts" + rq()); } catch (e) { return h("div", { class: "card" }, h("p", { class: "err" }, `Charts could not load: ${e.message}`)); }
  const per = periodText();
  const fmtX = (wk) => new Date(`${wk}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  // 1. performance trend
  const trend = chCard("Overall performance", `Average scores per week, ${per}. Hover a week for the numbers.`,
    linechart(c.trend, [{ key: "ver", label: "Verification (SBS) score", short: "SBS", color: CH[0] }, { key: "sv", label: "Store visit score", short: "Store visit", color: CH[1] }, { key: "rec", label: "Verification % (onboarding, NPD, coaching, people dev)", short: "Verification %", color: CH[2] }], { fmtX }));

  // 2. outcomes delivered
  const recN = (m) => d.records.filter((r) => r.module === m).reduce((n, r) => n + r.n, 0);
  const wsTotal = c.workshop.reduce((n, r) => n + r.n, 0);
  const outcomes = chCard("Outcomes delivered", `Everything recorded ${per}.`, hbars([
    { label: "Staff evaluated (SBS)", value: d.verify.evaluations, sub: `${d.verify.visits} visits · ${d.verify.stores} stores` },
    { label: "Employees onboarded", value: recN("onboarding") }, { label: "NPD verifications", value: recN("npd") },
    { label: "Store visit reports", value: d.sv.n, sub: `${d.sv.stores} stores` }, { label: "Coaching sessions", value: recN("coaching") },
    { label: "People development", value: recN("development") }, { label: "Workshop / project entries", value: wsTotal },
  ].sort((a, b) => b.value - a.value)));

  // 3. trainer contributions per activity
  let contrib = null;
  if (admin && d.team) {
    const ws = new Map(c.workshop.map((r) => [r.tid, r.n]));
    const rows = d.team.map((t) => {
      const v = { onboarding: t.onboarding, npd: t.npd, evaluations: t.evaluations, storevisit: t.storevisit, coaching: t.coaching, development: t.development, workshop: ws.get(t.id) || 0 };
      const parts = ACTS.map((a) => ({ value: v[a.key] || 0, color: a.color, label: a.label }));
      return { label: t.name, parts, total: parts.reduce((n, p) => n + p.value, 0) };
    }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    contrib = chCard("Trainers’ contributions per activity", `What each trainer delivered ${per}. Hover a colour for the number.`, stackbars(rows, ACTS));
  }

  // 4. areas of development
  const weak = chCard("Areas of development", "Lowest-performed sections in the latest evaluations, and the coaching topics covered.",
    h("div", { class: "ch-two" },
      h("div", {}, h("div", { class: "ch-mini" }, "Weakest sections · tasks performed"),
        hbars(c.weakest.map((w) => ({ label: w.section, sub: w.position, value: w.pct, tip: tipHtml(w.section, [["Position", w.position], ["Tasks performed", `${w.pct}%`], ["Answers", w.answered]]) })), { pctScale: true, fmt: (v) => `${v}%`, color: CH[1] })),
      h("div", {}, h("div", { class: "ch-mini" }, "Coaching topics covered · sessions"),
        hbars(c.topics.map((t) => ({ label: t.topic, value: t.n, tip: tipHtml(t.topic, [["Sessions", t.n], ["Average verification", t.avg == null ? "—" : `${t.avg}%`]]) })), { color: CH[2] }))));

  // 5. store gaps  /  6. highlights
  const st = c.stores, visited = st.filter((s) => s.visits || s.evals || s.sv_n);
  // region names differ only in capitals in some store records ("South" / "SOUTH"): group them together for the chart
  const rname = (s) => { const r = String(s.region || "Other").trim(); return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase(); };
  const regions = [...new Set(st.map(rname))].map((rg) => {
    const all = st.filter((s) => rname(s) === rg), v = all.filter((s) => s.visits || s.evals || s.sv_n).length;
    return { label: rg, total: all.length, parts: [{ value: v, color: CH[0], label: "Visited" }, { value: all.length - v, color: CH_REST, label: "Not visited" }] };
  }).sort((a, b) => b.total - a.total);
  const scored = st.filter((s) => s.evals >= 2 && s.ev_pct != null);
  const storeRow = (s) => ({ label: `${s.code} · ${s.name}`, sub: s.area_manager || "", value: s.ev_pct, tip: tipHtml(`${s.code} · ${s.name}`, [["Staff score", `${s.ev_pct}%`], ["Evaluations", s.evals], ["Store visit score", s.sv_pct == null ? "—" : `${s.sv_pct}%`], ["Area manager", s.area_manager || "—"]]) });
  const lowest = [...scored].sort((a, b) => a.ev_pct - b.ev_pct).slice(0, 8);
  const best = [...scored].sort((a, b) => b.ev_pct - a.ev_pct || b.evals - a.evals).slice(0, 8);
  const svBest = st.filter((s) => s.sv_pct != null).sort((a, b) => b.sv_pct - a.sv_pct).slice(0, 8);
  const gaps = chCard("Store gaps", `${visited.length} of ${st.length} stores had a trainer ${per}; ${st.length - visited.length} had none.`,
    h("div", { class: "ch-two" },
      h("div", {}, h("div", { class: "ch-mini" }, "Coverage by region · stores"), stackbars(regions, [{ color: CH[0], label: "Visited" }, { color: CH_REST, label: "Not visited" }])),
      h("div", {}, h("div", { class: "ch-mini" }, "Lowest staff scores · stores with 2+ evaluations"), hbars(lowest.map(storeRow), { pctScale: true, fmt: (v) => `${v}%`, color: CH[1] }))));
  const highs = chCard("Good highlights", "Where training is paying off.",
    h("div", { class: "ch-two" },
      h("div", {}, h("div", { class: "ch-mini" }, "Top staff scores · stores with 2+ evaluations"), hbars(best.map(storeRow), { pctScale: true, fmt: (v) => `${v}%`, color: CH[2] })),
      h("div", {}, h("div", { class: "ch-mini" }, "Top store visit scores"), hbars(svBest.map((s) => ({ label: `${s.code} · ${s.name}`, sub: s.area_manager || "", value: s.sv_pct, tip: tipHtml(`${s.code} · ${s.name}`, [["Store visit score", `${s.sv_pct}%`], ["Reports", s.sv_n]]) })), { pctScale: true, fmt: (v) => `${v}%`, color: CH[2] }))));

  return h("div", { class: "ch-wrap" },
    h("div", { class: "ch-head" }, h("h2", {}, "Performance at a glance"), h("span", { class: "muted small" }, `Charts follow the period above (${per}).`)),
    h("div", { class: "ch-grid" }, trend, outcomes), contrib, weak, gaps, highs);
}

// ================= Onboarding: numbers shared by the page charts and the Excel export =================
const dayDiff = (a, b) => { if (!a || !b) return null; const d = (Date.parse(b) - Date.parse(a)) / 864e5; return Number.isFinite(d) && d >= 0 ? d : null; };
const avgOfList = (v) => { const x = v.filter((n) => n != null && Number.isFinite(+n)); return x.length ? Math.round((10 * x.reduce((s, n) => s + +n, 0)) / x.length) / 10 : null; };
const weekStart = (s) => { const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`); if (Number.isNaN(+d)) return null; d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
function onbStats(rows, kindLabel) {
  const status = (r) => (r.training_end ? "finished" : r.training_start ? "training" : "not_started");
  const days = (r) => dayDiff(r.training_start, r.training_end);
  const group = (keyFn) => {
    // typed values are grouped without regard to capitals or spaces ("SAUDI", "saudi", "Saudi" are one group)
    const m = new Map(), spell = new Map();
    for (const r of rows) {
      const raw = String(keyFn(r) ?? "").trim().replace(/\s+/g, " ") || "Not set", k = raw.toLowerCase();
      if (!m.has(k)) { m.set(k, []); spell.set(k, new Map()); }
      m.get(k).push(r); spell.get(k).set(raw, (spell.get(k).get(raw) || 0) + 1);
    }
    const nice = (k) => { const best = [...spell.get(k).entries()].sort((a, b) => b[1] - a[1])[0][0]; return best === best.toUpperCase() || best === best.toLowerCase() ? best.toLowerCase().replace(/(^|[\s/-])\S/g, (c) => c.toUpperCase()) : best; };
    return [...m.entries()].map(([k, l]) => ({
      name: nice(k), n: l.length, avg: avgOfList(l.map((r) => r.pct)), theory: avgOfList(l.map((r) => r.theory)), practical: avgOfList(l.map((r) => r.practical)),
      finished: l.filter((r) => status(r) === "finished").length, training: l.filter((r) => status(r) === "training").length, not_started: l.filter((r) => status(r) === "not_started").length,
      days: avgOfList(l.map(days)), strong: l.filter((r) => r.pct != null && r.pct >= GOOD).length, low: l.filter((r) => r.pct != null && r.pct < WARN).length,
    })).sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name)));
  };
  // new joiners per week, by date of joining (entry date if there is none)
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const wk = new Map();
  for (const r of rows) {
    const w = weekStart(r.doj || r.created_at); if (!w) continue;
    if (!wk.has(w)) wk.set(w, { wk: w, total: 0, by: {} });
    const x = wk.get(w); x.total++; x.by[r.kind] = (x.by[r.kind] || 0) + 1;
  }
  const scored = rows.filter((r) => r.pct != null);
  return {
    total: rows.length, kinds: kinds.map((k) => ({ key: k, label: kindLabel[k] || k })),
    weeks: [...wk.values()].sort((a, b) => a.wk.localeCompare(b.wk)),
    status: { finished: rows.filter((r) => status(r) === "finished").length, training: rows.filter((r) => status(r) === "training").length, not_started: rows.filter((r) => status(r) === "not_started").length, days: avgOfList(rows.map(days)) },
    bands: { strong: scored.filter((r) => r.pct >= GOOD).length, ok: scored.filter((r) => r.pct >= WARN && r.pct < GOOD).length, low: scored.filter((r) => r.pct < WARN).length, none: rows.length - scored.length },
    avg: avgOfList(rows.map((r) => r.pct)), theory: avgOfList(rows.map((r) => r.theory)), practical: avgOfList(rows.map((r) => r.practical)),
    positions: group((r) => r.position), nationalities: group((r) => r.nationality), locations: group((r) => r.location),
    types: group((r) => kindLabel[r.kind] || r.kind), trainers: group((r) => r.created_by_name),
    // HM placement: where new joiners went after training
    hm: rows.filter((r) => r.kind === "hm").length,
    placed: rows.filter((r) => r.assigned_store).length,
    waiting: rows.filter((r) => r.kind === "hm" && r.training_end && !r.assigned_store).length,
    hmTraining: rows.filter((r) => r.kind === "hm" && !r.training_end).length,
    placedRegions: group((r) => r.assigned_store && r.placed_region).filter((g) => g.name !== "Not set"),
    placedCities: group((r) => r.assigned_store && r.placed_city).filter((g) => g.name !== "Not set"),
    placedStores: group((r) => r.assigned_store).filter((g) => g.name !== "Not set"),
    placedAMs: group((r) => r.assigned_store && r.placed_am).filter((g) => g.name !== "Not set"),
    placedRows: rows.filter((r) => r.assigned_store),
  };
}

// vertical columns (counts per week), stacked by part
function colchart(points, parts, { fmtX }) {
  if (!points.length) return empty("Nothing in this period.");
  const top = Math.max(1, ...points.map((p) => p.total));
  return h("div", {}, parts.length > 1 && legend(parts), chTip(h("div", { class: "ch-cols" }, points.map((p) => h("div", { class: "ch-col", tabindex: 0,
    "data-tip": tipHtml(`Week of ${fmtX(p.wk)}`, [...parts.filter((a) => p.by[a.key]).map((a) => [a.label, p.by[a.key], a.color]), ["Total", p.total]]) },
    h("b", { class: "ch-colv" }, p.total),
    h("div", { class: "ch-colbar", style: `height:${Math.max(4, (100 * p.total) / top)}%` }, parts.map((a) => p.by[a.key] ? h("i", { style: `flex:${p.by[a.key]};background:${a.color}` }) : null)),
    h("small", {}, fmtX(p.wk)))))));
}

function onboardingCharts(rows, kindLabel, admin, per) {
  if (!rows.length) return null;
  const s = onbStats(rows, kindLabel);
  const fmtX = (w) => new Date(`${w}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const parts = s.kinds.map((k, i) => ({ ...k, color: CH[i] }));
  const pctTip = (g, extra = []) => tipHtml(g.name, [["Employees", g.n], ["Avg verification", g.avg == null ? "—" : `${g.avg}%`], ["Theory", g.theory == null ? "—" : `${g.theory}%`], ["Practical", g.practical == null ? "—" : `${g.practical}%`], ...extra]);
  const ST = [{ key: "finished", label: "Finished", color: CH[2] }, { key: "training", label: "In training", color: CH[3] }, { key: "not_started", label: "Not started", color: CH_REST }];
  const joiners = chCard("New joiners per week", `By date of joining, ${per}. Hover a week for the numbers.`, colchart(s.weeks, parts, { fmtX }));
  const status = chCard("Training status", s.status.days == null ? "Where each new joiner is now." : `Where each new joiner is now · finished trainings took ${s.status.days} days on average.`,
    hbars(ST.map((x) => ({ label: x.label, value: s.status[x.key], color: x.color, tip: tipHtml(x.label, [["Employees", s.status[x.key]], ["Share", `${Math.round((100 * s.status[x.key]) / s.total)}%`]]) })), { max: s.total }));
  const posStatus = chCard("Positions · training progress", "New joiners per position, split by training status.",
    stackbars(s.positions.slice(0, 12).map((g) => ({ label: g.name, total: g.n, parts: ST.map((x) => ({ value: g[x.key], color: x.color, label: x.label })) })), ST));
  const posScore = chCard("Positions · average verification", "Average of theory and practical, per position.",
    hbars(s.positions.filter((g) => g.avg != null).slice(0, 12).map((g) => ({ label: g.name, sub: g.theory != null && g.practical != null ? `theory ${g.theory}% · practical ${g.practical}%` : "", value: g.avg, color: g.avg >= GOOD ? CH[2] : g.avg >= WARN ? CH[3] : CH[1], tip: pctTip(g) })), { pctScale: true, fmt: (v) => `${v}%` }));
  const B = [{ key: "strong", label: `Strong (${GOOD}%+)`, color: CH[2] }, { key: "ok", label: `On track (${WARN}–${GOOD - 1}%)`, color: CH[0] }, { key: "low", label: `Attention (<${WARN}%)`, color: CH[1] }, { key: "none", label: "No score yet", color: CH_REST }];
  const bands = chCard("Verification results", s.avg == null ? "No scores yet." : `Average ${s.avg}% · theory ${s.theory ?? "—"}% · practical ${s.practical ?? "—"}%.`,
    hbars(B.map((x) => ({ label: x.label, value: s.bands[x.key], color: x.color })), { max: s.total }));
  const nat = chCard("Nationalities", "Top 10 by number of new joiners.", hbars(s.nationalities.slice(0, 10).map((g) => ({ label: g.name, value: g.n, color: CH[6], tip: pctTip(g) }))));
  const daysCard = s.positions.some((g) => g.days != null) && chCard("Days in training · by position", "Average from training start to training end (finished trainings only).",
    hbars(s.positions.filter((g) => g.days != null).sort((a, b) => b.days - a.days).map((g) => ({ label: g.name, sub: `${g.finished} finished`, value: g.days, color: CH[3], tip: tipHtml(g.name, [["Average days", g.days], ["Finished trainings", g.finished]]) })), { fmt: (v) => `${v} d` }));
  const byTrainer = admin && s.trainers.length > 1 && chCard("Entered by", "New joiners each trainer recorded.", hbars(s.trainers.map((g) => ({ label: g.name, value: g.n, color: CH[0], tip: pctTip(g) }))));
  // HM placement: trained and sent to a store
  const PL = [{ key: "placed", label: "Assigned to a store", color: CH[2] }, { key: "waiting", label: "Trained · no store yet", color: CH[3] }, { key: "hmTraining", label: "Still in training", color: CH_REST }];
  const placedCard = s.hm > 0 && chCard("HM new joiners · placed in stores", `${s.placed} of ${s.hm} HM new joiners have been assigned to a store after training.`,
    hbars(PL.map((x) => ({ label: x.label, value: s[x.key], color: x.color })), { max: s.hm }));
  const whereCard = s.placed > 0 && chCard("Where they went", "Assigned stores by region and city.",
    h("div", { class: "ch-two" },
      h("div", {}, h("div", { class: "ch-mini" }, "By region"), hbars(s.placedRegions.map((g) => ({ label: g.name, value: g.n, color: CH[0], tip: tipHtml(g.name, [["New joiners placed", g.n], ["Avg verification", g.avg == null ? "—" : `${g.avg}%`]]) })))),
      h("div", {}, h("div", { class: "ch-mini" }, "By city"), hbars(s.placedCities.slice(0, 10).map((g) => ({ label: g.name, value: g.n, color: CH[6], tip: tipHtml(g.name, [["New joiners placed", g.n]]) }))))));
  const storesCard = s.placed > 0 && chCard("Stores receiving new joiners", "Top 10 stores by number of new joiners assigned.",
    hbars(s.placedStores.slice(0, 10).map((g) => { const r0 = s.placedRows.find((r) => r.assigned_store === g.name || String(r.assigned_store).toLowerCase() === g.name.toLowerCase()); return { label: g.name, sub: r0 ? [r0.placed_city, r0.placed_am].filter(Boolean).join(" · ") : "", value: g.n, color: CH[2],
      tip: tipHtml(g.name, [["New joiners", g.n], ["Positions", [...new Set(s.placedRows.filter((r) => String(r.assigned_store).toLowerCase() === g.name.toLowerCase()).map((r) => r.position))].join(", ")]]) }; })));
  const cards = [joiners, status, placedCard, whereCard, storesCard, posStatus, posScore, bands, nat, daysCard, byTrainer].filter(Boolean);
  return h("div", { class: "ch-wrap" }, h("div", { class: "ch-head" }, h("h2", {}, "Onboarding at a glance"), h("span", { class: "muted small" }, `Charts follow the period and the tab above (${per}).`)),
    h("div", { class: "ch-grid" }, cards));
}
