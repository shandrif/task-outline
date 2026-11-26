/* Verification by topic: which topics (form sections) trainers verified, for how many staff, and how well.
   Admin dashboard section, a trainer's own page (admin), and "My topics" for trainers. Loaded after charts.js. */
"use strict";

const tpPct = (v) => (v == null ? h("span", { class: "muted" }, "—") : h("b", { class: `pct ${pctClass(v)}` }, `${v}%`));
const tpLoading = () => h("p", { class: "muted small", style: "margin:0" }, "Loading topics…");

// a placeholder that fills itself in when the data arrives (the rest of the page does not wait)
function tpSlot(build) { const el = h("div", {}, h("div", { class: "card" }, tpLoading())); build().then((n) => el.replaceChildren(n)).catch((e) => el.replaceChildren(h("div", { class: "card" }, h("p", { class: "err" }, e.message)))); return el; }

// ---------- 1. admin dashboard: Verification by topic ----------
function verifyTopicsSection() {
  return tpSlot(async () => {
    const d = await api("/verify/topics" + rq());
    const per = periodText();
    if (!d.topics.length) return h("div", { class: "card" }, h("h2", {}, "Verification by topic"), h("p", { class: "muted" }, `No topics verified in ${per}.`));
    const positions = [...new Map(d.topics.map((t) => [t.position_id, t.position])).entries()]
      .map(([id, name]) => ({ id, name, staff: d.topics.filter((t) => t.position_id === id).reduce((n, t) => Math.max(n, t.staff), 0) }))
      .sort((a, b) => b.staff - a.staff);
    let pos = positions[0].id, view = "topics";
    const names = new Map(d.trainers.map((t) => [t.id, t.name]));
    const tabs = h("div", { class: "tabs", style: "margin:0" }), views = h("div", { class: "seg2" }), body = h("div");
    const card = h("div", { class: "card" },
      h("div", { class: "row spread", style: "align-items:flex-start" }, h("div", {}, h("h2", {}, "Verification by topic"),
        h("p", { class: "muted small", style: "margin:4px 0 0" }, `Which topics trainers verified in ${per}, for how many staff, and how well they performed. Click a topic to see who verified it.`)), views),
      h("div", { style: "margin:12px 0" }, tabs), body);

    const trainersFor = (t) => {
      const rows = d.matrix.filter((m) => m.section_id === t.section_id).map((m) => ({ name: names.get(m.trainer_id) || "—", n: m.n, evals: m.evals, pct: m.pct })).sort((a, b) => b.n - a.n);
      const max = Math.max(1, ...rows.map((r) => r.n));
      return modal(t.title, h("div", { class: "stack" },
        h("div", { class: "ex-head" }, `${t.staff} staff verified (${t.evals} evaluation${t.evals === 1 ? "" : "s"}) · ${t.trainers} trainer${t.trainers === 1 ? "" : "s"} · ${t.pct}% performed`),
        h("p", { class: "small muted", style: "margin:0" }, `${t.position} · ${per}`),
        h("div", { class: "tp-list" }, rows.map((r) => h("div", { class: "tp-row" }, h("b", {}, r.name),
          h("div", { class: "tp-track" }, h("i", { style: `width:${(100 * r.n) / max}%` })), h("span", { class: "tp-n", title: `${r.evals} evaluation${r.evals === 1 ? "" : "s"}` }, `${r.n} staff`), tpPct(r.pct))))),
        (close) => [h("button", { class: "btn teal", onclick: () => close(true) }, "Close")]);
    };

    const draw = () => {
      tabs.replaceChildren(...positions.map((p) => h("button", { type: "button", class: "tab" + (p.id === pos ? " on" : ""), onclick: () => { pos = p.id; draw(); } }, p.name)));
      views.replaceChildren(...[["topics", "Topics"], ["grid", "Trainer × topic"]].map(([k, l]) => h("button", { type: "button", class: k === view ? "on" : "", onclick: () => { view = k; draw(); } }, l)));
      const topics = d.topics.filter((t) => t.position_id === pos).sort((a, b) => b.staff - a.staff || a.title.localeCompare(b.title));
      if (view === "topics") {
        const max = Math.max(1, ...topics.map((t) => t.staff));
        body.replaceChildren(h("div", { class: "tp-head" }, h("span", {}, "Topic"), h("span", {}, "Staff verified"), h("span", { class: "tp-tr" }, "Trainers"), h("span", {}, "Performed")),
          h("div", { class: "tp-list" }, topics.map((t) => {
            const row = h("div", { class: "tp-row click", role: "button", tabindex: 0, title: "Click to see which trainers verified this topic" },
              h("b", {}, t.title), h("div", { class: "tp-track" }, h("i", { style: `width:${(100 * t.staff) / max}%` }), h("span", { class: "tp-n", title: `${t.staff} different people · ${t.evals} evaluation${t.evals === 1 ? "" : "s"}` }, t.staff)), h("span", { class: "tp-n tp-tr" }, t.trainers), tpPct(t.pct));
            row.addEventListener("click", () => trainersFor(t)); row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); trainersFor(t); } });
            return row;
          })));
      } else {
        const tr = d.trainers.filter((t) => d.matrix.some((m) => m.trainer_id === t.id && topics.some((x) => x.section_id === m.section_id)));
        const cell = new Map(d.matrix.map((m) => [`${m.trainer_id}|${m.section_id}`, m]));
        const max = Math.max(1, ...d.matrix.filter((m) => topics.some((x) => x.section_id === m.section_id)).map((m) => m.n));
        const table = h("table", { class: "tp-grid" },
          h("thead", {}, h("tr", {}, h("th", { class: "tp-corner" }, "Trainer"), topics.map((t) => h("th", { title: t.title }, h("span", {}, t.title))))),
          h("tbody", {}, tr.map((x) => h("tr", {}, h("th", { scope: "row" }, x.name), topics.map((t) => {
            const m = cell.get(`${x.id}|${t.section_id}`);
            if (!m) return h("td", { class: "tp-gap", "data-tip": tipHtml(`${x.name} · ${t.title}`, [["Staff verified", "none"]]) }, "–");
            return h("td", { style: `--a:${(0.12 + 0.88 * (m.n / max)).toFixed(2)}`, "data-tip": tipHtml(`${x.name} · ${t.title}`, [["Staff verified", m.n], ["Evaluations", m.evals], ["Performed", `${m.pct}%`]]) }, m.n);
          })))));
        body.replaceChildren(h("p", { class: "small muted", style: "margin:0 0 8px" }, "Each cell is the number of different staff a trainer verified on that topic (a person evaluated twice counts once). Empty cells (–) are topics the trainer did not cover. Hover a cell for the score."),
          chTip(h("div", { class: "tp-gridwrap" }, table)));
      }
    };
    draw();
    return card;
  });
}

// ---------- 2 & 3. one trainer's topics (admin trainer page, and "My topics") ----------
function trainerTopicsCard(trainerId, mine) {
  return tpSlot(async () => {
    const d = await api("/verify/topics" + rq(trainerId ? `trainer=${trainerId}` : ""));
    const per = periodText();
    const title = mine ? "My topics" : "Topics verified";
    if (!d.topics.length) return h("div", { class: "card" }, h("h2", {}, title), h("p", { class: "muted", style: "margin:0" }, `No topics verified in ${per}.`));
    const done = new Set(d.topics.map((t) => t.section_id));
    const byPos = [...new Map(d.catalog.map((c) => [c.position_id, c.position])).entries()];
    const max = Math.max(1, ...d.topics.map((t) => t.staff));
    return h("div", { class: "card" },
      h("h2", {}, title),
      h("p", { class: "muted small", style: "margin:4px 0 12px" }, mine ? `The topics you verified in ${per}, for how many staff, and how well they performed.` : `What this trainer verified in ${per}, topic by topic.`),
      byPos.map(([pid, pname]) => {
        const got = d.topics.filter((t) => t.position_id === pid).sort((a, b) => b.staff - a.staff);
        const missing = d.catalog.filter((c) => c.position_id === pid && !done.has(c.section_id));
        return h("div", { class: "tp-pos" },
          h("div", { class: "tp-posname" }, pname, h("span", { class: "muted small" }, ` · ${got.length} of ${got.length + missing.length} topics covered`)),
          got.length > 0 && h("div", { class: "tp-list" }, got.map((t) => h("div", { class: "tp-row tp-row3" }, h("b", {}, t.title),
            h("div", { class: "tp-track" }, h("i", { style: `width:${(100 * t.staff) / max}%` }), h("span", { class: "tp-n" }, `${t.staff} staff`)), tpPct(t.pct)))),
          missing.length > 0 && h("div", { class: "tp-missing" }, h("span", { class: "small muted" }, mine ? "Not verified yet:" : "Not covered:"), missing.map((c) => h("span", { class: "chip" }, c.title))));
      }));
  });
}
