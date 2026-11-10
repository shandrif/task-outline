/* Workshop / Projects tab: workshops, projects, weekly accomplishments, upcoming weekly accomplishments.
   Its own data (not part of any dashboard). Loaded after app.js and modules.js (shares their helpers). */
"use strict";

const WS_TABS = [
  { key: "workshop", label: "Workshop", plural: "Workshops", titled: true, nameLabel: "Workshop name", textLabel: "What was done" },
  { key: "project", label: "Project", plural: "Projects", titled: true, nameLabel: "Project name", textLabel: "What was done" },
  { key: "weekly", label: "Weekly accomplishments", plural: "Weekly accomplishments", titled: false, textLabel: "Accomplishments" },
  { key: "upcoming", label: "Upcoming weekly accomplishments", plural: "Upcoming weekly accomplishments", titled: false, textLabel: "Accomplishments" },
];
const WS_BY = Object.fromEntries(WS_TABS.map((t) => [t.key, t]));
const WS_STATUS = [["open", "Open"], ["ongoing", "Ongoing"], ["completed", "Completed"]];
const WS_STATUS_LABEL = Object.fromEntries(WS_STATUS);
const wsState = { tab: "workshop", status: "", preset: "all", from: "", to: "" };

const wsChip = (s) => h("span", { class: `chip st-${s}` }, WS_STATUS_LABEL[s] || s);
const wsDays = (d) => Math.max(0, Math.floor((Date.now() - new Date(`${d}T00:00:00`)) / 864e5));

// ---- period on the entry date (its own, so future-dated "upcoming" entries are not cut off) ----
function wsPeriod() {
  const t = new Date(), p = wsState.preset;
  if (p === "custom") return { from: wsState.from || null, to: wsState.to || null };
  if (p === "week") { const s = new Date(t); s.setDate(t.getDate() - ((t.getDay() + 1) % 7)); const e = new Date(s); e.setDate(s.getDate() + 6); return { from: ymd(s), to: ymd(e) }; }   // Saturday-to-Friday week
  if (p === "month") return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to: ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
  if (p === "30") { const s = new Date(t); s.setDate(t.getDate() - 29); return { from: ymd(s), to: null }; }
  return { from: null, to: null };
}
function wsPeriodText() {
  const { from, to } = wsPeriod();
  const lbl = { all: "All time", week: "This week", month: "This month", "30": "Last 30 days" }[wsState.preset];
  if (!from && !to) return "All time";
  return `${lbl ? lbl + " · " : ""}${from ? fmtDay(from) : "the start"} – ${to ? fmtDay(to) : "onwards"}`;
}
const wsInPeriod = (r) => { const { from, to } = wsPeriod(); return (!from || r.entry_date >= from) && (!to || r.entry_date <= to); };

function wsPeriodBar(redraw) {
  const sel = h("select", { class: "flt", "aria-label": "Period", onchange: (e) => { wsState.preset = e.target.value; redraw(); } },
    [["all", "All time"], ["week", "This week"], ["month", "This month"], ["30", "Last 30 days"], ["custom", "Custom range"]].map(([v, l]) => h("option", { value: v, selected: wsState.preset === v }, l)));
  const date = (key) => h("input", { type: "date", class: "flt", value: wsState[key], "aria-label": key === "from" ? "From date" : "To date", onchange: (e) => { wsState[key] = e.target.value; redraw(); } });
  return h("div", { class: "row range" }, h("span", { class: "small muted" }, "Period"), sel, wsState.preset === "custom" && [date("from"), h("span", { class: "muted" }, "to"), date("to")]);
}

async function workshopView() {
  const admin = session.role === "admin";
  let all = await api("/workshop");
  const holder = h("div"), periodHolder = h("div");
  const reload = async () => { all = await api("/workshop"); draw(); };
  const canEdit = (r) => admin || r.trainer_id === session.trainer?.id;

  const del = async (r) => {
    const what = r.title || WS_BY[r.section].label;
    if (!(await confirmBox("Delete this entry?", `“${trunc(what, 60)}” (${fmtDay(r.entry_date)}) will be removed.`, "Delete", true))) return;
    try { await api(`/workshop/${r.id}`, { method: "DELETE" }); toast("Deleted"); await reload(); } catch (e) { toast(e.message); }
  };
  const setStatus = async (r, s, sel) => {
    sel.disabled = true;
    try { await api(`/workshop/${r.id}`, { method: "PATCH", body: { status: s } }); r.status = s; toast(`Marked ${WS_STATUS_LABEL[s].toLowerCase()}`); draw(); }
    catch (e) { toast(e.message); sel.value = r.status; sel.disabled = false; }
  };
  const statusCell = (r) => {
    if (!canEdit(r)) return wsChip(r.status);
    const sel = h("select", { class: `st-sel st-${r.status}`, "aria-label": "Status", onclick: (e) => e.stopPropagation(), onchange: (e) => setStatus(r, e.target.value, sel) },
      WS_STATUS.map(([v, l]) => h("option", { value: v, selected: r.status === v }, l)));
    return sel;
  };

  function draw() {
    periodHolder.replaceChildren(wsPeriodBar(draw));
    const tab = WS_BY[wsState.tab];
    const inPeriod = all.filter(wsInPeriod);
    const shown = inPeriod.filter((r) => r.section === tab.key);
    const n = (s) => shown.filter((r) => r.status === s).length;
    const done = n("completed"), rate = shown.length ? Math.round((100 * done) / shown.length) : null;

    const tileEl = (cls, v, l, status) => {
      const on = wsState.status === status && status !== undefined;
      const el = h("div", { class: `kpi ws-kpi ${cls}${on ? " ws-on" : ""}`, role: "button", tabindex: 0, title: status ? `Show only ${l.toLowerCase()}` : "Show all" },
        h("div", { class: "v" }, v), h("div", { class: "l" }, l));
      const go = () => { wsState.status = on ? "" : status || ""; draw(); };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      return el;
    };

    const cols = [
      { key: "entry_date", label: "Date", render: (r) => h("span", { style: "white-space:nowrap" }, fmtDay(r.entry_date)) },
      ...(tab.titled ? [{ key: "title", label: tab.nameLabel, render: (r) => h("b", {}, r.title) }] : []),
      { key: "details", label: tab.textLabel, render: (r) => h("span", { class: "ws-text", title: r.details }, trunc(r.details, 140)) },
      { key: "status", label: "Status", get: (r) => WS_STATUS.findIndex(([v]) => v === r.status), render: statusCell },
      ...(admin ? [{ key: "trainer_name", label: "Trainer", get: (r) => r.trainer_name || r.created_by_name, render: (r) => r.trainer_name || r.created_by_name || "—" }] : []),
      { key: "updated", label: "Last change", get: (r) => r.updated_at || r.created_at, render: (r) => h("span", { class: "small muted", style: "white-space:nowrap" }, fmtDate(r.updated_at || r.created_at)) },
      { key: "actions", label: "", nosort: true, render: (r) => canEdit(r) ? h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end" },
        h("button", { class: "btn ghost sm", onclick: (e) => { e.stopPropagation(); wsForm(r, reload); } }, "Edit"),
        h("button", { class: "icon del", title: "Delete", "aria-label": "Delete entry", onclick: (e) => { e.stopPropagation(); del(r); } }, "🗑")) : "" },
    ];
    const g = grid({
      rows: wsState.status ? shown.filter((r) => r.status === wsState.status) : shown, cols, sort: { key: "entry_date", dir: -1 },
      empty: wsState.status ? `No ${WS_STATUS_LABEL[wsState.status].toLowerCase()} entries here.` : `Nothing yet. Use “+ Add entry” to log your first ${tab.label.toLowerCase()}.`,
      onRow: (r) => (canEdit(r) ? wsForm(r, reload) : wsShow(r)),
      searchIn: (r) => [r.title, r.details, r.trainer_name, r.created_by_name].filter(Boolean).join(" "),
      filters: admin ? [{ key: "trainer_name", label: "trainers", get: (r) => r.trainer_name || r.created_by_name }] : [],
    });

    holder.replaceChildren(
      h("div", { class: "tabs ws-tabs", role: "tablist" }, WS_TABS.map((t) => h("button", { type: "button", role: "tab", "aria-selected": t.key === tab.key ? "true" : "false", class: "tab" + (t.key === tab.key ? " on" : ""), onclick: () => { wsState.tab = t.key; wsState.status = ""; draw(); } },
        t.plural, h("span", { class: "muted small" }, ` ${inPeriod.filter((r) => r.section === t.key).length}`)))),
      h("div", { class: "grid g4" },
        tileEl("tealk", shown.length, `${tab.plural}${rate != null ? ` · ${rate}% completed` : ""}`, undefined),
        tileEl("tank", n("open"), "Open", "open"),
        tileEl("ws-ongoing", n("ongoing"), "Ongoing", "ongoing"),
        tileEl("ws-done", done, "Completed", "completed")),
      h("div", { class: "card" }, h("div", { class: "row spread", style: "margin-bottom:8px" }, h("h2", {}, tab.plural),
        wsState.status && h("button", { class: "btn ghost sm", onclick: () => { wsState.status = ""; draw(); } }, `Showing ${WS_STATUS_LABEL[wsState.status].toLowerCase()} only · Show all`)), g.el));
  }
  draw();
  return shell(h("div", {},
    pageHead("Workshop / Projects", admin ? "Every trainer’s workshops, projects and weekly accomplishments. This tab is separate from the dashboards." : "Log your workshops, projects and weekly accomplishments. This tab is separate from the dashboards.",
      periodHolder,
      h("button", { class: "btn ghost", onclick: () => wsExport(all.filter(wsInPeriod), admin) }, "Export to Excel"),
      h("button", { class: "btn teal", onclick: () => wsForm(null, reload) }, "+ Add entry")),
    holder), "#/workshop");
}

function wsShow(r) {
  const t = WS_BY[r.section];
  return modal(r.title || t.label, h("div", { class: "stack" },
    h("div", { class: "row" }, wsChip(r.status), h("span", { class: "muted small" }, `${t.label} · ${fmtDay(r.entry_date)} · ${r.trainer_name || r.created_by_name || ""}`)),
    h("p", { style: "white-space:pre-wrap;margin:0" }, r.details)), (close) => [h("button", { class: "btn teal", onclick: () => close(true) }, "Close")]);
}

async function wsForm(rec, onSaved) {
  let section = rec ? rec.section : wsState.tab;
  let status = rec ? rec.status : "open";
  const err = h("p", { class: "err ws-err", style: "margin:0" });
  const date = h("input", { type: "date", value: rec ? rec.entry_date : ymd(new Date()), required: true });
  const title = h("input", { type: "text", maxlength: 150, value: rec?.title || "", autocomplete: "off" });
  const details = h("textarea", { rows: 6, maxlength: 4000, value: rec?.details || "" });
  const counter = h("div", { class: "small muted", style: "text-align:right;margin-top:4px" });
  const count = () => { counter.textContent = `${details.value.length} / 4000`; };
  details.addEventListener("input", count); count();
  const titleWrap = h("div"), detailsLabel = h("label");
  const seg = h("div", { class: "ws-seg", role: "radiogroup", "aria-label": "Status" });
  const paintSeg = () => seg.replaceChildren(...WS_STATUS.map(([v, l]) => h("button", { type: "button", role: "radio", "aria-checked": status === v ? "true" : "false", class: `st-${v}${status === v ? " on" : ""}`, onclick: () => { status = v; paintSeg(); } }, l)));
  const sectionSel = !rec && h("select", { onchange: (e) => { section = e.target.value; paint(); } }, WS_TABS.map((t) => h("option", { value: t.key, selected: t.key === section }, t.label)));
  function paint() {
    const t = WS_BY[section];
    titleWrap.replaceChildren(...(t.titled ? [h("label", {}, t.nameLabel, " *"), title] : []));
    detailsLabel.replaceChildren(t.textLabel, " *");
    details.placeholder = t.titled ? "Describe what was done…" : section === "upcoming" ? "What is planned for the coming week…" : "What was accomplished this week…";
  }
  paint(); paintSeg();
  const body = h("div", { class: "stack" },
    sectionSel ? field("Section", sectionSel) : h("div", {}, h("span", { class: "chip" }, WS_BY[section].label)),
    field("Date *", date), titleWrap, h("div", {}, detailsLabel, details, counter), h("div", {}, h("label", {}, "Status *"), seg), err);
  await modal(rec ? "Edit entry" : "Add entry", body, (close) => {
    const save = h("button", { class: "btn teal", onclick: async () => {
      save.disabled = true; err.textContent = "";
      const data = { entry_date: date.value, title: WS_BY[section].titled ? title.value.trim() : null, details: details.value.trim(), status };
      try {
        if (rec) await api(`/workshop/${rec.id}`, { method: "PATCH", body: data });
        else await api("/workshop", { method: "POST", body: { section, ...data } });
        toast(rec ? "Entry updated" : "Entry added");
        if (!rec) { wsState.tab = section; wsState.status = ""; }
        close(true); await onSaved();
      } catch (e) { err.textContent = e.message; save.disabled = false; }
    } }, rec ? "Save" : "Add entry");
    return [h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"), save];
  });
}

// ================= branded Excel report (shared builder in report.js) =================
const WS_XS = { open: { label: "Open", fill: "F1E4D2", font: "8A6633" }, ongoing: { label: "Ongoing", fill: "DCEFE8", font: "1F6E5C" }, completed: { label: "Completed", fill: "2B8A74", font: "FFFFFF" } };
function wsExport(rows, admin) {
  const trainerOf = (r) => r.trainer_name || r.created_by_name || "—";
  const cnt = (l, s) => l.filter((r) => r.status === s).length;
  const rateOf = (l) => (l.length ? Math.round((1000 * cnt(l, "completed")) / l.length) / 10 : null);
  const total = rows.length, rate = rateOf(rows);
  const multi = admin || new Set(rows.map(trainerOf)).size > 1;
  const stCell = (s) => ({ v: WS_STATUS_LABEL[s], bold: true, fill: WS_XS[s].fill, color: WS_XS[s].font });
  const pending = rows.filter((r) => r.status !== "completed" && WS_BY[r.section].titled).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const months = [...new Set(rows.map((r) => r.entry_date.slice(0, 7)))].sort().reverse().slice(0, 12);
  const maxM = Math.max(1, ...months.map((m) => rows.filter((r) => r.entry_date.startsWith(m)).length));
  return hmReport({
    file: xFileName("Workshop_Projects"), title: "Workshop / Projects Report", period: wsPeriodText(), scope: admin ? "All trainers" : session.trainer.name,
    kpis: [
      { label: "Total entries", value: total, tone: "ink" }, { label: "Open", value: cnt(rows, "open"), tone: "tan" }, { label: "Ongoing", value: cnt(rows, "ongoing"), tone: "teal" },
      { label: "Completed", value: cnt(rows, "completed"), tone: "good" }, { label: "Completion rate", value: rate, pct: true, tone: "card" },
    ],
    sections: [
      { title: "By section", note: "how many entries, and how far along they are", cols: [["Section", 3, "left"], ["Entries", 1], ["Open", 1], ["Ongoing", 1], ["Completed", 1], ["Completed %", 1], ["Progress", 2, "left"]],
        rows: WS_TABS.map((t) => { const l = rows.filter((r) => r.section === t.key), p = rateOf(l); return [cName(t.plural), l.length, cnt(l, "open"), cnt(l, "ongoing"), cnt(l, "completed"), cPct(p), cBar(p)]; }) },
      multi && { title: "By trainer", note: "who logged what — most entries first", cols: [["Trainer", 2, "left"], ["Employee ID", 1], ["Workshops", 1], ["Projects", 1], ["Weekly", 1], ["Upcoming", 1], ["Total", 1], ["Completed %", 1], ["Progress", 1, "left"]],
        rows: [...new Set(rows.map(trainerOf))].map((n) => ({ n, l: rows.filter((r) => trainerOf(r) === n) })).sort((a, b) => b.l.length - a.l.length || a.n.localeCompare(b.n))
          .map(({ n, l }) => { const p = rateOf(l); return [cName(n), l[0].trainer_employee_id || "—", ...WS_TABS.map((t) => l.filter((r) => r.section === t.key).length), { v: l.length, bold: true }, cPct(p), cBar(p)]; }) },
      { title: "Still open or ongoing", note: `workshops and projects not completed yet — oldest first${pending.length > 15 ? ` · 15 of ${pending.length}` : ""}`, cols: [["Date", 1], ["Section", 1], ["Name", 3, "left"], ["Trainer", 2, "left"], ["Status", 1], ["Days since", 2]],
        rows: pending.slice(0, 15).map((r) => [cDay(r.entry_date), WS_BY[r.section].label, cName(r.title), { v: trainerOf(r), align: "left" }, stCell(r.status), wsDays(r.entry_date)]), empty: "Everything is completed. 🎉" },
      { title: "Activity by month", note: "entries per month, by the date on the entry", cols: [["Month", 2, "left"], ["Workshops", 1], ["Projects", 1], ["Weekly", 1], ["Upcoming", 1], ["Total", 1], ["Volume", 3, "left"]],
        rows: months.map((m) => { const l = rows.filter((r) => r.entry_date.startsWith(m)); return [cName(new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })), ...WS_TABS.map((t) => l.filter((r) => r.section === t.key).length), { v: l.length, bold: true }, cVol(l.length, maxM, 24)]; }) },
    ],
    tip: "Each section has its own sheet with every entry in full — use the filter arrows in the header row to sort or filter.",
    sheets: WS_TABS.map((t) => {
      const list = rows.filter((r) => r.section === t.key).sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id);
      return { name: t.key === "upcoming" ? "Upcoming weekly" : t.key === "weekly" ? "Weekly" : t.plural, title: t.plural, tab: t.titled ? XC.tan : XC.teal, rows: list,
        summary: `${plural(list.length, "entry", "entries")}  ·  ${cnt(list, "open")} open  ·  ${cnt(list, "ongoing")} ongoing  ·  ${cnt(list, "completed")} completed`,
        cols: [
          { label: "#", get: (_, i) => i + 1, type: "int", width: 5, muted: true }, { label: "Date", get: (r) => r.entry_date, type: "date" },
          ...(multi ? [{ label: "Trainer", get: trainerOf, width: 22 }, { label: "Employee ID", get: (r) => r.trainer_employee_id || "—", width: 12 }] : []),
          ...(t.titled ? [{ label: t.nameLabel, get: (r) => r.title, bold: true, width: 28 }] : []),
          { label: t.textLabel, get: (r) => r.details, type: "long", width: 70 }, { label: "Status", get: (r) => r.status, type: "status", styles: WS_XS },
          { label: "Entered", get: (r) => r.created_at, type: "datetime" }, { label: "Last updated", get: (r) => r.updated_at, type: "datetime" },
        ] };
    }),
  });
}
