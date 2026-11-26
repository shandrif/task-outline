/* Visit coverage & repeats (admin Verification Dashboard): where trainers keep returning, who is evaluated again and again,
   which stores get no visit, and which trainers concentrate on a few stores. Follows the period picker. Loaded after topics.js. */
"use strict";

const CV = { trainerRepeat: 50, trainerWatch: 30, pairHigh: 3, staffHigh: 3 };   // highlight thresholds (explained on screen)
const cvChip = (cls, t, tip) => h("span", { class: `chip ${cls}`, title: tip || "" }, t);
const cvBar = (pctVal, cls) => h("div", { class: "cv-bar" }, h("i", { class: cls, style: `width:${Math.max(2, Math.min(100, pctVal))}%` }), h("span", {}, `${Math.round(pctVal)}%`));
const cvDays = (s) => (s ? Math.floor((Date.now() - Date.parse(String(s).replace(" ", "T") + "Z")) / 864e5) : null);

function trainerFlag(t) {
  const share = t.visits ? (100 * t.repeat_visits) / t.visits : 0;
  if (t.visits >= 4 && share >= CV.trainerRepeat) return { level: 2, chip: cvChip("bad", "Repeating stores", `${Math.round(share)}% of visits were to a store already visited`) };
  if (t.visits >= 3 && share >= CV.trainerWatch) return { level: 1, chip: cvChip("warn", "Watch", `${Math.round(share)}% of visits were repeats`) };
  return { level: 0, chip: cvChip("good", "Spread out") };
}

function coverageSection() {
  return tpSlot(async () => {
    const d = await api("/admin/coverage" + rq());
    const per = periodText();
    const stores = d.stores, visited = stores.filter((s) => s.visits > 0), notVisited = stores.filter((s) => !s.visits);
    const repeatVisits = d.trainers.reduce((n, t) => n + t.repeat_visits, 0), totalVisits = d.trainers.reduce((n, t) => n + t.visits, 0);
    const extraEvals = d.staff.reduce((n, x) => n + x.times - 1, 0);
    const flagged = d.trainers.map((t) => ({ ...t, flag: trainerFlag(t) })).filter((t) => t.flag.level > 0);

    const kpis = h("div", { class: "cv-kpis" },
      h("div", { class: "cv-k" + (notVisited.length ? " warn" : "") }, h("b", {}, `${visited.length}/${stores.length}`), h("span", {}, `stores visited · ${notVisited.length} not visited`)),
      h("div", { class: "cv-k" + (repeatVisits / Math.max(1, totalVisits) >= 0.3 ? " warn" : "") }, h("b", {}, repeatVisits), h("span", {}, `repeat visits · same trainer, same store (${Math.round((100 * repeatVisits) / Math.max(1, totalVisits))}% of ${totalVisits})`)),
      h("div", { class: "cv-k" }, h("b", {}, d.staff.length), h("span", {}, `staff evaluated more than once · ${extraEvals} extra evaluations`)),
      h("div", { class: "cv-k" + (flagged.some((t) => t.flag.level === 2) ? " bad" : "") }, h("b", {}, flagged.length), h("span", {}, `trainer${flagged.length === 1 ? "" : "s"} concentrating on the same stores`)));

    const pairsOf = (tid) => d.pairs.filter((p) => p.trainer_id === tid);
    const trainerDetail = (t) => modal(`${t.name} · where the visits went`, h("div", { class: "stack" },
      h("div", { class: "ex-head" }, `${t.visits} visits to ${t.stores} different store${t.stores === 1 ? "" : "s"} in ${per} · ${t.repeat_visits} repeat visit${t.repeat_visits === 1 ? "" : "s"}`),
      h("p", { class: "small muted", style: "margin:0" }, `${notVisited.length} store${notVisited.length === 1 ? " had" : "s had"} no visit from anyone in this period (see “Not visited”).`),
      pairsOf(t.id).length ? h("div", { class: "table-wrap" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, ["Store", "Visits", "First", "Last"].map((x) => h("th", {}, x)))),
        h("tbody", {}, pairsOf(t.id).map((p) => h("tr", { class: p.visits >= CV.pairHigh ? "cv-hot" : "" }, h("td", {}, h("b", {}, `${p.code} · ${p.store}`)), h("td", {}, p.visits), h("td", {}, fmtDate(p.first_at)), h("td", {}, fmtDate(p.last_at)))))))
        : h("p", { class: "muted" }, "No store was visited twice by this trainer."),
      (() => { const st = d.staff.filter((x) => String(x.trainers || "").split(",").includes(t.name)); return st.length ? h("div", {}, h("h3", { style: "margin:6px 0" }, "Staff this trainer evaluated more than once"),
        h("div", { class: "table-wrap" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, ["Staff", "Store", "Times", "Avg score"].map((x) => h("th", {}, x)))),
          h("tbody", {}, st.slice(0, 30).map((x) => h("tr", { class: x.times >= CV.staffHigh ? "cv-hot" : "" }, h("td", {}, h("b", {}, x.name)), h("td", {}, `${x.code} · ${x.store}`), h("td", {}, x.times), h("td", {}, x.pct == null ? "—" : `${x.pct}%`))))))) : null; })()),
      (close) => [h("button", { class: "btn teal", onclick: () => close(true) }, "Close")]);

    const views = {
      trainers: () => h("div", {},
        h("p", { class: "small muted", style: "margin:0 0 8px" }, `“Repeat visits” = visits to a store the same trainer had already visited in ${per}. Flagged when at least ${CV.trainerRepeat}% of a trainer’s visits are repeats (“Watch” from ${CV.trainerWatch}%). Click a trainer to see which stores.`),
        grid({ maxHeight: "560px", rows: d.trainers.map((t) => ({ ...t, share: t.visits ? Math.round((100 * t.repeat_visits) / t.visits) : 0, flag: trainerFlag(t), re_evals: t.evaluations - t.people })),
          sort: { key: "share", dir: -1 }, onRow: trainerDetail, rowClass: (t) => (t.flag.level === 2 ? "cv-hot" : t.flag.level === 1 ? "cv-warm" : ""), searchIn: (t) => t.name,
          cols: [{ key: "name", label: "Trainer", render: (t) => h("b", {}, t.name) }, { key: "visits", label: "Visits", num: true }, { key: "stores", label: "Different stores", num: true },
            { key: "repeat_visits", label: "Repeat visits", num: true }, { key: "share", label: "Repeat share", render: (t) => cvBar(t.share, t.flag.level === 2 ? "bad" : t.flag.level === 1 ? "warn" : "good") },
            { key: "top_visits", label: "Most-visited store", render: (t) => (t.top_store ? h("span", {}, h("b", {}, `${t.top_visits}×`), ` ${t.top_store}`) : h("span", { class: "muted" }, "no repeats")) },
            { key: "re_evals", label: "Re-evaluations", num: true }, { key: "flag", label: "", nosort: true, render: (t) => t.flag.chip }] }).el,
        d.pairs.filter((p) => p.visits >= CV.pairHigh).length > 0 && h("div", { style: "margin-top:14px" }, h("h3", { style: "margin:0 0 6px" }, `Same trainer, same store ${CV.pairHigh}+ times`),
          h("div", { class: "chips", style: "margin-top:0" }, d.pairs.filter((p) => p.visits >= CV.pairHigh).map((p) => cvChip("bad", `${p.trainer} → ${p.code} ${p.store} · ${p.visits}×`))))),
      stores: () => h("div", {},
        h("p", { class: "small muted", style: "margin:0 0 8px" }, `Visits per store in ${per}. Highlighted: ${CV.pairHigh}+ visits. “Re-evaluations” = evaluations of staff already evaluated in this period.`),
        grid({ maxHeight: "560px", rows: stores.map((s) => ({ ...s, label: `${s.code} · ${s.name}`, re_evals: s.evaluations - s.people })), sort: { key: "visits", dir: -1 }, searchIn: (s) => `${s.label} ${s.region} ${s.city} ${s.area_manager}`,
          filters: [{ key: "region", label: "regions" }, { key: "area_manager", label: "area managers" }], rowClass: (s) => (s.visits >= CV.pairHigh ? "cv-hot" : !s.visits ? "cv-cold" : ""),
          cols: [{ key: "label", label: "Store", render: (s) => h("b", {}, s.label) }, { key: "region", label: "Region" }, { key: "area_manager", label: "Area manager" },
            { key: "visits", label: "Visits", num: true }, { key: "trainers", label: "Trainers", num: true }, { key: "evaluations", label: "Evaluations", num: true }, { key: "people", label: "Staff", num: true },
            { key: "re_evals", label: "Re-evaluations", num: true }, { key: "last_in_period", label: "Last visit", render: (s) => (s.last_in_period ? fmtDate(s.last_in_period) : cvChip("bad", "No visit")) }] }).el),
      staff: () => h("div", {},
        h("p", { class: "small muted", style: "margin:0 0 8px" }, `Staff evaluated more than once in ${per} (same name, same store). Highlighted: ${CV.staffHigh}+ times. Re-evaluating someone who already scores 100% adds evaluations without reaching new staff.`),
        grid({ maxHeight: "560px", rows: d.staff.map((x) => ({ ...x, label: `${x.code} · ${x.store}` })), sort: { key: "times", dir: -1 }, searchIn: (x) => `${x.name} ${x.label} ${x.trainers} ${x.positions}`,
          rowClass: (x) => (x.times >= CV.staffHigh ? "cv-hot" : ""), empty: "Nobody was evaluated twice.",
          cols: [{ key: "name", label: "Staff", render: (x) => h("b", {}, x.name) }, { key: "label", label: "Store" }, { key: "positions", label: "Position" },
            { key: "times", label: "Times evaluated", num: true }, { key: "trainers", label: "By" }, { key: "pct", label: "Avg score", num: true, render: (x) => h("span", {}, avgCell(x.pct), x.pct >= 100 && x.times >= CV.staffHigh ? h("span", { class: "chip warn", style: "margin-left:6px" }, "100% every time") : null) },
            { key: "last_at", label: "Last", render: (x) => fmtDate(x.last_at) }] }).el),
      none: () => {
        const rows = notVisited.map((s) => ({ ...s, label: `${s.code} · ${s.name}`, ago: cvDays(s.last_visit_at) }));
        const rk = (r) => { const t = String(r || "—").trim(); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); };   // "South" and "SOUTH" together
        const byRegion = [...rows.reduce((m, s) => m.set(rk(s.region), (m.get(rk(s.region)) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
        return h("div", {},
          h("p", { class: "small muted", style: "margin:0 0 8px" }, `${rows.length} active store${rows.length === 1 ? "" : "s"} had no visit from any trainer in ${per}. “Last visit ever” shows how long each has gone without one.`),
          h("div", { class: "chips", style: "margin:0 0 10px" }, byRegion.map(([r, n]) => cvChip("bad", `${r} · ${n}`))),
          grid({ maxHeight: "560px", rows, sort: { key: "ago", dir: -1 }, searchIn: (s) => `${s.label} ${s.region} ${s.city} ${s.area_manager}`, filters: [{ key: "region", label: "regions" }, { key: "area_manager", label: "area managers" }], empty: "Every store had a visit. 🎉",
            cols: [{ key: "label", label: "Store", render: (s) => h("b", {}, s.label) }, { key: "region", label: "Region" }, { key: "city", label: "City" }, { key: "area_manager", label: "Area manager" },
              { key: "ago", label: "Last visit ever", get: (s) => (s.ago == null ? 1e9 : s.ago), render: (s) => (s.ago == null ? cvChip("bad", "Never visited") : h("span", {}, `${fmtDate(s.last_visit_at)} · `, h("b", { class: s.ago > 60 ? "pct bad" : "" }, `${s.ago} days ago`))) }] }).el);
      },
    };
    const tabs = [["trainers", "Trainers"], ["stores", "Stores"], ["staff", `Staff (${d.staff.length})`], ["none", `Not visited (${notVisited.length})`]];
    const body = h("div");
    const seg = h("div", { class: "seg2" }, tabs.map(([k, l]) => h("button", { type: "button", "data-k": k, onclick: () => show(k) }, l)));
    const show = (k) => { seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); body.replaceChildren(views[k]()); };
    show("trainers");
    return h("div", { class: "card" },
      h("div", { class: "row spread", style: "align-items:flex-start" }, h("div", {}, h("h2", { style: "margin:0" }, "Visit coverage & repeats"),
        h("p", { class: "muted small", style: "margin:4px 0 0" }, `Where trainers keep going back, who is evaluated again and again, and which stores had no visit in ${per}.`))),
      kpis, h("div", { style: "margin:12px 0" }, seg), body);
  });
}
