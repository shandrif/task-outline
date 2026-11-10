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

// ================= branded Excel report =================
// ExcelJS (styled workbooks) is only fetched the first time someone exports.
let excelJsReady;
const loadExcelJs = () => (window.ExcelJS ? Promise.resolve() : (excelJsReady ||= new Promise((resolve, reject) => {
  const el = document.createElement("script"); el.src = "/vendor/exceljs.min.js";
  el.onload = resolve; el.onerror = () => { excelJsReady = null; reject(new Error("Could not load the Excel exporter — check your connection")); };
  document.head.append(el);
})));

const XC = { bg: "F5EDE3", card: "FBF7F1", ink: "1D1B17", tan: "D4B38B", teal: "84C6B2", good: "2B8A74", bad: "C2564A", line: "E4D6C2", muted: "6F675B", white: "FFFFFF" };
const XFONT = "Arial";
const xFill = (c) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c } });
const xFont = (o = {}) => ({ name: XFONT, size: o.size || 10, bold: !!o.bold, italic: !!o.italic, color: { argb: "FF" + (o.color || XC.ink) } });
const xBorder = (c = XC.line) => ({ top: { style: "thin", color: { argb: "FF" + c } }, bottom: { style: "thin", color: { argb: "FF" + c } }, left: { style: "thin", color: { argb: "FF" + c } }, right: { style: "thin", color: { argb: "FF" + c } } });
const ST_X = { open: { fill: "F1E4D2", font: "8A6633" }, ongoing: { fill: "DCEFE8", font: "1F6E5C" }, completed: { fill: "2B8A74", font: "FFFFFF" } };
const xDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const xStamp = (s) => (s ? new Date(s.replace(" ", "T") + "Z") : null);
const bar = (p, w = 10) => (p == null ? "" : "█".repeat(Math.round((p / 100) * w)) + "░".repeat(w - Math.round((p / 100) * w)));

async function wsExport(rows, admin) {
  try {
    toast("Preparing Excel report…");
    await loadExcelJs();
    const logo = await fetch("/logo.png").then((r) => r.blob()).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).catch(() => null);
    const wb = new ExcelJS.Workbook();
    wb.creator = "HM Training Division"; wb.created = new Date();
    const logoId = logo ? wb.addImage({ base64: logo, extension: "png" }) : null;
    const who = admin ? "Admin" : session.trainer.name;
    const period = wsPeriodText();
    const generated = new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const trainerOf = (r) => r.trainer_name || r.created_by_name || "—";

    // ---------- 1. Dashboard ----------
    const ws = wb.addWorksheet("Dashboard", { properties: { tabColor: { argb: "FF" + XC.ink } }, views: [{ showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
    ws.columns = [{ width: 2 }, ...Array(10).fill({ width: 13.5 }), { width: 2 }];
    for (let r = 1; r <= 4; r++) for (let c = 1; c <= 12; c++) ws.getCell(r, c).fill = xFill(XC.bg);
    ws.getRow(1).height = 16; ws.getRow(2).height = 30; ws.getRow(3).height = 20; ws.getRow(4).height = 14;
    if (logoId != null) ws.addImage(logoId, { tl: { col: 1, row: 0.6 }, ext: { width: 128, height: 58 }, editAs: "oneCell" });
    ws.mergeCells("D2:K2"); ws.getCell("D2").value = "Workshop / Projects Report";
    ws.getCell("D2").font = xFont({ size: 20, bold: true }); ws.getCell("D2").alignment = { vertical: "middle" };
    ws.mergeCells("D3:K3"); ws.getCell("D3").value = `Training Division  ·  ${period}  ·  ${admin ? "All trainers" : who}  ·  Generated ${generated}`;
    ws.getCell("D3").font = xFont({ size: 10, color: XC.muted }); ws.getCell("D3").alignment = { vertical: "top" };
    for (let c = 2; c <= 3; c++) ws.getCell(5, c).fill = xFill(XC.tan);
    ws.getRow(5).height = 5;

    let row = 7;
    const total = rows.length, cnt = (list, s) => list.filter((r) => r.status === s).length;
    const done = cnt(rows, "completed"), rate = total ? Math.round((100 * done) / total) : null;
    const tiles = [
      [total, "Total entries", XC.ink, XC.bg, XC.tan],
      [cnt(rows, "open"), "Open", XC.tan, XC.ink, XC.ink],
      [cnt(rows, "ongoing"), "Ongoing", XC.teal, XC.ink, XC.ink],
      [done, "Completed", XC.good, XC.white, XC.white],
      [rate == null ? "—" : rate / 100, "Completion rate", XC.card, XC.ink, XC.muted],
    ];
    tiles.forEach(([v, l, bg, fg, lc], i) => {
      const c1 = 2 + i * 2, c2 = c1 + 1;
      ws.mergeCells(row, c1, row + 1, c2); ws.mergeCells(row + 2, c1, row + 2, c2);
      const vc = ws.getCell(row, c1), lc_ = ws.getCell(row + 2, c1);
      vc.value = v; vc.font = xFont({ size: 24, bold: true, color: fg }); vc.alignment = { horizontal: "center", vertical: "middle" };
      if (i === 4 && typeof v === "number") vc.numFmt = "0%";
      lc_.value = l.toUpperCase(); lc_.font = xFont({ size: 8.5, bold: true, color: lc }); lc_.alignment = { horizontal: "center", vertical: "middle" };
      for (let r = row; r <= row + 2; r++) for (let c = c1; c <= c2; c++) { ws.getCell(r, c).fill = xFill(bg); if (bg === XC.card) ws.getCell(r, c).border = xBorder(); }
    });
    ws.getRow(row).height = 22; ws.getRow(row + 1).height = 22; ws.getRow(row + 2).height = 18;
    row += 5;

    const heading = (text, note) => {
      ws.mergeCells(row, 2, row, 11);
      const c = ws.getCell(row, 2);
      c.value = { richText: [{ text, font: xFont({ size: 13, bold: true }) }, ...(note ? [{ text: `   ${note}`, font: xFont({ size: 9, color: XC.muted }) }] : [])] };
      c.border = { bottom: { style: "medium", color: { argb: "FF" + XC.tan } } };
      ws.getRow(row).height = 22; row += 1;
    };
    // a table: heads [[label, span]], body rows of cell specs
    const table = (heads, body, empty = "Nothing in this period.") => {
      let c = 2;
      for (const [label, span = 1, align = "center"] of heads) {
        if (span > 1) ws.mergeCells(row, c, row, c + span - 1);
        const cell = ws.getCell(row, c);
        cell.value = label; cell.font = xFont({ size: 9, bold: true, color: XC.bg }); cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
        for (let k = c; k < c + span; k++) ws.getCell(row, k).fill = xFill(XC.ink);
        c += span;
      }
      ws.getRow(row).height = 20; row++;
      if (!body.length) { ws.mergeCells(row, 2, row, 11); const e = ws.getCell(row, 2); e.value = empty; e.font = xFont({ italic: true, color: XC.muted }); e.alignment = { horizontal: "center" }; row += 2; return; }
      body.forEach((cells, i) => {
        let c = 2;
        cells.forEach((spec, j) => {
          const [v, o = {}] = Array.isArray(spec) ? spec : [spec];
          const span = heads[j][1] || 1;
          if (span > 1) ws.mergeCells(row, c, row, c + span - 1);
          const cell = ws.getCell(row, c);
          cell.value = v ?? "";
          cell.font = xFont({ bold: o.bold, color: o.color, size: o.size });
          cell.alignment = { horizontal: o.align || heads[j][2] || "center", vertical: "middle", wrapText: !!o.wrap };
          if (o.numFmt) cell.numFmt = o.numFmt;
          for (let k = c; k < c + span; k++) {
            const x = ws.getCell(row, k);
            x.fill = xFill(o.fill || (i % 2 ? XC.card : XC.white));
            x.border = { bottom: { style: "hair", color: { argb: "FF" + XC.line } } };
          }
          c += span;
        });
        ws.getRow(row).height = 18; row++;
      });
      row++;
    };
    const statusSpec = (s) => [WS_STATUS_LABEL[s], { fill: ST_X[s].fill, color: ST_X[s].font, bold: true }];
    const pctSpec = (p) => [p == null ? "—" : p / 100, { numFmt: "0%", bold: true, color: p == null ? XC.muted : p >= 85 ? XC.good : p >= 50 ? "8A6633" : XC.bad }];
    const barSpec = (p) => [bar(p), { color: XC.good, align: "left", size: 9 }];

    heading("By section", "how many entries, and how far along they are");
    table([["Section", 3, "left"], ["Entries"], ["Open"], ["Ongoing"], ["Completed"], ["Completed %"], ["Progress", 2, "left"]],
      WS_TABS.map((t) => {
        const l = rows.filter((r) => r.section === t.key), p = l.length ? Math.round((100 * cnt(l, "completed")) / l.length) : null;
        return [[t.plural, { bold: true, align: "left" }], l.length, cnt(l, "open"), cnt(l, "ongoing"), cnt(l, "completed"), pctSpec(p), barSpec(p)];
      }));

    const trainers = [...new Set(rows.map(trainerOf))];
    if (admin || trainers.length > 1) {
      heading("By trainer", "who logged what — sorted by most entries");
      table([["Trainer", 2, "left"], ["Employee ID"], ["Workshops"], ["Projects"], ["Weekly"], ["Upcoming"], ["Total"], ["Completed %"], ["Progress", 1, "left"]],
        trainers.map((name) => {
          const l = rows.filter((r) => trainerOf(r) === name), p = l.length ? Math.round((100 * cnt(l, "completed")) / l.length) : null;
          return { name, l, p };
        }).sort((a, b) => b.l.length - a.l.length || a.name.localeCompare(b.name)).map(({ name, l, p }) => [
          [name, { bold: true, align: "left" }], l[0].trainer_employee_id || "—",
          ...WS_TABS.map((t) => l.filter((r) => r.section === t.key).length), [l.length, { bold: true }], pctSpec(p), barSpec(p),
        ]));
    }

    const pending = rows.filter((r) => r.status !== "completed" && (r.section === "workshop" || r.section === "project")).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    heading("Still open or ongoing", `workshops and projects not completed yet — oldest first${pending.length > 15 ? ` (15 of ${pending.length} shown; see the section sheets for all)` : ""}`);
    table([["Date", 1], ["Section"], ["Name", 3, "left"], ["Trainer", 2, "left"], ["Status"], ["Days since", 2]],
      pending.slice(0, 15).map((r) => [[xDate(r.entry_date), { numFmt: "dd mmm yyyy" }], WS_BY[r.section].label, [r.title || "", { align: "left", bold: true }], [trainerOf(r), { align: "left" }], statusSpec(r.status), wsDays(r.entry_date)]),
      "Everything is completed. 🎉");

    const months = [...new Set(rows.map((r) => r.entry_date.slice(0, 7)))].sort().reverse().slice(0, 12);
    const maxM = Math.max(1, ...months.map((m) => rows.filter((r) => r.entry_date.startsWith(m)).length));
    heading("Activity by month", "entries per month, by date entered on the form");
    table([["Month", 2, "left"], ["Workshops"], ["Projects"], ["Weekly"], ["Upcoming"], ["Total"], ["Volume", 3, "left"]],
      months.map((m) => {
        const l = rows.filter((r) => r.entry_date.startsWith(m));
        return [[new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }), { bold: true, align: "left" }], ...WS_TABS.map((t) => l.filter((r) => r.section === t.key).length), [l.length, { bold: true }],
          ["█".repeat(Math.max(1, Math.round((l.length / maxM) * 24))), { color: XC.tan, align: "left", size: 9 }]];
      }));

    ws.mergeCells(row, 2, row, 11);
    ws.getCell(row, 2).value = "Tip: each section has its own sheet with every entry in full — use the filter arrows in the header row to sort or filter.";
    ws.getCell(row, 2).font = xFont({ size: 9, italic: true, color: XC.muted });
    ws.pageSetup.printArea = `A1:L${row}`;

    // ---------- 2. One sheet per section ----------
    for (const t of WS_TABS) {
      const list = rows.filter((r) => r.section === t.key).sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id);
      const sh = wb.addWorksheet(t.key === "upcoming" ? "Upcoming weekly" : t.key === "weekly" ? "Weekly" : t.plural, {
        properties: { tabColor: { argb: "FF" + (t.titled ? XC.tan : XC.teal) } },
        views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: "4:4" },
      });
      const cols = [
        ["#", 5, "center"], ["Date", 13, "center"], ...(admin || trainers.length > 1 ? [["Trainer", 22, "left"], ["Employee ID", 12, "center"]] : []),
        ...(t.titled ? [[t.nameLabel, 28, "left"]] : []), [t.textLabel, 70, "left"], ["Status", 13, "center"], ["Entered", 13, "center"], ["Last updated", 13, "center"],
      ];
      sh.columns = cols.map(([, w]) => ({ width: w }));
      const last = cols.length;
      sh.mergeCells(1, 1, 1, last);
      const tc = sh.getCell(1, 1);
      tc.value = { richText: [{ text: `${t.plural}`, font: xFont({ size: 16, bold: true, color: XC.bg }) }, { text: `    ${list.length} entr${list.length === 1 ? "y" : "ies"}  ·  ${cnt(list, "open")} open  ·  ${cnt(list, "ongoing")} ongoing  ·  ${cnt(list, "completed")} completed`, font: xFont({ size: 10, color: XC.tan }) }] };
      tc.alignment = { vertical: "middle", indent: 1 };
      for (let c = 1; c <= last; c++) sh.getCell(1, c).fill = xFill(XC.ink);
      sh.getRow(1).height = 34;
      sh.mergeCells(2, 1, 2, last);
      sh.getCell(2, 1).value = `HM Training Division  ·  ${period}  ·  Generated ${generated}`;
      sh.getCell(2, 1).font = xFont({ size: 9, color: XC.muted }); sh.getCell(2, 1).alignment = { indent: 1, vertical: "middle" };
      for (let c = 1; c <= last; c++) sh.getCell(2, c).fill = xFill(XC.bg);
      sh.getRow(2).height = 18;
      const hr = sh.getRow(4);
      cols.forEach(([label, , align], i) => {
        const c = hr.getCell(i + 1);
        c.value = label; c.font = xFont({ size: 10, bold: true }); c.fill = xFill(XC.tan);
        c.alignment = { horizontal: align, vertical: "middle" }; c.border = { bottom: { style: "medium", color: { argb: "FF" + XC.ink } } };
      });
      hr.height = 22;
      if (!list.length) {
        sh.mergeCells(5, 1, 5, last); sh.getCell(5, 1).value = "No entries in this period."; sh.getCell(5, 1).font = xFont({ italic: true, color: XC.muted }); sh.getCell(5, 1).alignment = { horizontal: "center" };
        continue;
      }
      list.forEach((r, i) => {
        const vals = [i + 1, xDate(r.entry_date), ...(admin || trainers.length > 1 ? [trainerOf(r), r.trainer_employee_id || "—"] : []), ...(t.titled ? [r.title || ""] : []), r.details, WS_STATUS_LABEL[r.status], xStamp(r.created_at), xStamp(r.updated_at) || ""];
        const xr = sh.getRow(5 + i);
        vals.forEach((v, j) => {
          const c = xr.getCell(j + 1), [label, , align] = cols[j];
          c.value = v;
          c.font = xFont({ bold: label === t.nameLabel, color: label === "#" ? XC.muted : XC.ink });
          c.alignment = { horizontal: align, vertical: "top", wrapText: label === t.textLabel || label === t.nameLabel };
          c.fill = xFill(i % 2 ? XC.card : XC.white);
          c.border = { bottom: { style: "hair", color: { argb: "FF" + XC.line } } };
          if (label === "Date" || label === "Entered" || label === "Last updated") c.numFmt = "dd mmm yyyy";
          if (label === "Status") { c.fill = xFill(ST_X[r.status].fill); c.font = xFont({ bold: true, color: ST_X[r.status].font }); c.alignment = { horizontal: "center", vertical: "top" }; }
        });
        // roughly fit tall comments
        const lines = String(r.details).split("\n").reduce((n, s) => n + Math.max(1, Math.ceil(s.length / 85)), 0);
        xr.height = Math.min(300, Math.max(18, lines * 13 + 6));
      });
      sh.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + list.length, column: last } };
      const sc = cols.findIndex(([l]) => l === "Status") + 1;
      sh.dataValidations.add(`${sh.getColumn(sc).letter}5:${sh.getColumn(sc).letter}${4 + list.length}`, { type: "list", allowBlank: false, formulae: ['"Open,Ongoing,Completed"'] });
    }

    const buf = await wb.xlsx.writeBuffer();
    const a = h("a", { href: URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })), download: `HM_Workshop_Projects_${ymd(new Date())}.xlsx` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast("Excel report downloaded");
  } catch (e) { toast(e.message); }
}
