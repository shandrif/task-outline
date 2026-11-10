/* HM-branded Excel reports: one builder used by every "Export to Excel" in the app.
   Each workbook = a "Dashboard" sheet (logo, KPI tiles, summary tables with progress bars) + clean data sheets.
   Loaded after app.js (uses h, toast, ymd, session, periodText). ExcelJS (~1 MB) is fetched on first export only. */
"use strict";

let excelJsReady;
const loadExcelJs = () => (window.ExcelJS ? Promise.resolve() : (excelJsReady ||= new Promise((resolve, reject) => {
  const el = document.createElement("script"); el.src = "/vendor/exceljs.min.js";
  el.onload = resolve; el.onerror = () => { excelJsReady = null; reject(new Error("Could not load the Excel exporter — check your connection")); };
  document.head.append(el);
})));

// ---------- brand ----------
const XC = { bg: "F5EDE3", card: "FBF7F1", ink: "1D1B17", tan: "D4B38B", teal: "84C6B2", good: "2B8A74", bad: "C2564A", warn: "8A6633", line: "E4D6C2", muted: "6F675B", white: "FFFFFF" };
const XFONT = "Arial";
const xFill = (c) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c } });
const xFont = (o = {}) => ({ name: XFONT, size: o.size || 10, bold: !!o.bold, italic: !!o.italic, color: { argb: "FF" + (o.color || XC.ink) } });
const xHair = { bottom: { style: "hair", color: { argb: "FF" + XC.line } } };
const TONES = {   // KPI tile colours: [fill, value colour, label colour]
  ink: [XC.ink, XC.bg, XC.tan], tan: [XC.tan, XC.ink, XC.ink], teal: [XC.teal, XC.ink, XC.ink],
  good: [XC.good, XC.white, XC.white], bad: [XC.bad, XC.white, XC.white], card: [XC.card, XC.ink, XC.muted],
};
// value colour for a percentage (same thresholds as the app: 85 good, 65 warning)
const xPctColor = (p) => (p == null ? XC.muted : p >= GOOD ? XC.good : p >= WARN ? XC.warn : XC.bad);
const xBar = (p, w = 10) => { if (p == null) return ""; const n = Math.max(0, Math.min(w, Math.round((p / 100) * w))); return "█".repeat(n) + "░".repeat(w - n); };
const xDay = (s) => { if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s || ""; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
// UTC "YYYY-MM-DD HH:MM:SS" from the database → the viewer's local wall-clock time (Excel has no time zones)
const xLocal = (s) => { if (!s) return ""; const d = new Date(s.replace(" ", "T") + "Z"); return Number.isNaN(+d) ? s : new Date(d.getTime() - d.getTimezoneOffset() * 60000); };
const xAvg = (list, get) => { const v = list.map(get).filter((x) => x != null && x !== "" && Number.isFinite(+x)); return v.length ? Math.round((10 * v.reduce((a, b) => a + +b, 0)) / v.length) / 10 : null; };
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// Cell helpers for dashboard tables
const cPct = (p) => ({ v: p == null ? "—" : p / 100, fmt: p == null ? null : "0.0%", bold: true, color: xPctColor(p) });
const cBar = (p) => ({ v: xBar(p), color: p == null ? XC.muted : xPctColor(p) === XC.good ? XC.good : xPctColor(p), align: "left", size: 9 });
const cVol = (n, max, w = 20) => ({ v: "█".repeat(Math.max(n ? 1 : 0, Math.round((n / Math.max(1, max)) * w))), color: XC.tan, align: "left", size: 9 });
const cName = (v) => ({ v: v || "—", bold: true, align: "left" });
const cText = (v) => ({ v: v || "", align: "left", wrap: true });
const cDay = (s) => ({ v: xDay(s), fmt: "dd mmm yyyy" });

/* Summary table: group rows by a key, count them and average a percentage.
   Returns a dashboard section: [name | count | avg % | progress]. */
function xRollup(title, note, rows, keyFn, { label = "Name", count = "Records", pctFn = null, pctLabel = "Average %", top = 15, extra = [] } = {}) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r) || "(not set)"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  let groups = [...m.entries()].map(([k, l]) => ({ k, l, p: pctFn ? xAvg(l, pctFn) : null }));
  groups.sort((a, b) => b.l.length - a.l.length || (b.p ?? -1) - (a.p ?? -1) || String(a.k).localeCompare(String(b.k)));
  const total = groups.length;
  groups = groups.slice(0, top);
  const maxN = Math.max(1, ...groups.map((g) => g.l.length));
  const cols = [[label, 3, "left"], [count, 1], ...extra.map((e) => [e.label, 1]), ...(pctFn ? [[pctLabel, 1], ["Progress", 10 - 4 - 1 - extra.length, "left"]] : [["Share", 10 - 4 - extra.length, "left"]])];
  return {
    title, note: total > top ? `${note ? note + " · " : ""}top ${top} of ${total}` : note, cols,
    rows: groups.map((g) => [cName(g.k), g.l.length, ...extra.map((e) => e.get(g.l)), ...(pctFn ? [cPct(g.p), cBar(g.p)] : [cVol(g.l.length, maxN, 24)])]),
  };
}

/* spec = {
     file, title, scope?, note?,
     kpis: [{ label, value, pct?:bool, tone }],                 up to 5 tiles
     sections: [{ title, note?, cols: [[label, span=1, align]], rows: [[cell]], empty? }],   spans add up to 10
     info?: [[label, value]],                                   key facts shown under the tiles (single-record reports)
     sheets: [{ name, title, cols: [{ label, get(row), type, width }], rows, summary? }],
   }
   cell = value | { v, fmt, bold, color, fill, align, wrap, size }
   column type: text | long | date | datetime | int | num | pct | status | yesno */
async function hmReport(spec) {
  try {
    toast("Preparing Excel report…");
    await loadExcelJs();
    const logo = await fetch("/logo.png").then((r) => r.blob()).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).catch(() => null);
    const wb = new ExcelJS.Workbook();
    wb.creator = "HM Training Division"; wb.created = new Date();
    const logoId = logo ? wb.addImage({ base64: logo, extension: "png" }) : null;
    const who = session.role === "admin" ? "Admin" : session.trainer?.name || "";
    const generated = new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const meta = [spec.scope, spec.period, `Generated ${generated} by ${who}`].filter(Boolean).join("  ·  ");
    const print = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

    // ================= Dashboard =================
    const ws = wb.addWorksheet("Dashboard", { properties: { tabColor: { argb: "FF" + XC.ink } }, views: [{ showGridLines: false }], pageSetup: print });
    ws.columns = [{ width: 2 }, ...Array(10).fill({ width: 13.5 }), { width: 2 }];
    ws.headerFooter.oddFooter = "&L&8HM Training Division&R&8Page &P of &N";
    for (let r = 1; r <= 4; r++) for (let c = 1; c <= 12; c++) ws.getCell(r, c).fill = xFill(XC.bg);
    [16, 30, 20, 14].forEach((ht, i) => { ws.getRow(i + 1).height = ht; });
    if (logoId != null) ws.addImage(logoId, { tl: { col: 1, row: 0.6 }, ext: { width: 128, height: 58 }, editAs: "oneCell" });
    ws.mergeCells("D2:K2"); Object.assign(ws.getCell("D2"), { value: spec.title, font: xFont({ size: 20, bold: true }), alignment: { vertical: "middle" } });
    ws.mergeCells("D3:K3"); Object.assign(ws.getCell("D3"), { value: `Training Division  ·  ${meta}`, font: xFont({ size: 10, color: XC.muted }), alignment: { vertical: "top" } });
    ws.getRow(5).height = 5; ws.getCell(5, 2).fill = xFill(XC.tan); ws.getCell(5, 3).fill = xFill(XC.tan);
    let row = 7;

    // KPI tiles
    const kpis = (spec.kpis || []).slice(0, 5);
    if (kpis.length) {
      const span = Math.floor(10 / kpis.length), off = 2 + Math.floor((10 - span * kpis.length) / 2);
      kpis.forEach((k, i) => {
        const [bg, fg, lc] = TONES[k.tone || "card"], c1 = off + i * span, c2 = c1 + span - 1;
        ws.mergeCells(row, c1, row + 1, c2); ws.mergeCells(row + 2, c1, row + 2, c2);
        const v = ws.getCell(row, c1), l = ws.getCell(row + 2, c1);
        v.value = k.value == null ? "—" : k.pct ? k.value / 100 : k.value;
        if (k.pct && k.value != null) v.numFmt = "0.0%";
        v.font = xFont({ size: 24, bold: true, color: fg }); v.alignment = { horizontal: "center", vertical: "middle" };
        l.value = String(k.label).toUpperCase(); l.font = xFont({ size: 8.5, bold: true, color: lc }); l.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        for (let r = row; r <= row + 2; r++) for (let c = c1; c <= c2; c++) {
          ws.getCell(r, c).fill = xFill(bg);
          if (bg === XC.card) ws.getCell(r, c).border = { top: { style: "thin", color: { argb: "FF" + XC.line } }, bottom: { style: "thin", color: { argb: "FF" + XC.line } }, left: c === c1 ? { style: "thin", color: { argb: "FF" + XC.line } } : undefined, right: c === c2 ? { style: "thin", color: { argb: "FF" + XC.line } } : undefined };
        }
      });
      ws.getRow(row).height = 22; ws.getRow(row + 1).height = 22; ws.getRow(row + 2).height = 20;
      row += 5;
    }

    const heading = (text, note) => {
      ws.mergeCells(row, 2, row, 11);
      const c = ws.getCell(row, 2);
      c.value = { richText: [{ text, font: xFont({ size: 13, bold: true }) }, ...(note ? [{ text: `   ${note}`, font: xFont({ size: 9, color: XC.muted }) }] : [])] };
      c.border = { bottom: { style: "medium", color: { argb: "FF" + XC.tan } } };
      ws.getRow(row).height = 22; row++;
    };
    // key facts (single-record reports): two label/value pairs per row
    if (spec.info?.length) {
      heading(spec.infoTitle || "Details");
      for (let i = 0; i < spec.info.length; i += 2) {
        [spec.info[i], spec.info[i + 1]].forEach((pair, j) => {
          if (!pair) return;
          const c = 2 + j * 5;
          ws.mergeCells(row, c, row, c + 1); ws.mergeCells(row, c + 2, row, c + 4);
          Object.assign(ws.getCell(row, c), { value: pair[0], font: xFont({ size: 9, bold: true, color: XC.muted }), alignment: { vertical: "middle" } });
          Object.assign(ws.getCell(row, c + 2), { value: pair[1] ?? "—", font: xFont({ bold: true }), alignment: { vertical: "middle", wrapText: true } });
          for (let k = c; k <= c + 4; k++) ws.getCell(row, k).border = xHair;
        });
        ws.getRow(row).height = 20; row++;
      }
      row++;
    }
    const table = (sec) => {
      heading(sec.title, sec.note);
      let c = 2;
      for (const [label, span = 1, align = "center"] of sec.cols) {
        if (span > 1) ws.mergeCells(row, c, row, c + span - 1);
        Object.assign(ws.getCell(row, c), { value: label, font: xFont({ size: 9, bold: true, color: XC.bg }), alignment: { horizontal: align, vertical: "middle", wrapText: true } });
        for (let k = c; k < c + span; k++) ws.getCell(row, k).fill = xFill(XC.ink);
        c += span;
      }
      ws.getRow(row).height = 20; row++;
      if (!sec.rows.length) {
        ws.mergeCells(row, 2, row, 11);
        Object.assign(ws.getCell(row, 2), { value: sec.empty || "Nothing to show in this report.", font: xFont({ italic: true, color: XC.muted }), alignment: { horizontal: "center" } });
        row += 2; return;
      }
      sec.rows.forEach((cells, i) => {
        let c = 2, tall = 1;
        cells.forEach((spec_, j) => {
          const o = spec_ != null && typeof spec_ === "object" && !(spec_ instanceof Date) ? spec_ : { v: spec_ };
          const [, span = 1, align = "center"] = sec.cols[j];
          if (span > 1) ws.mergeCells(row, c, row, c + span - 1);
          const cell = ws.getCell(row, c);
          cell.value = o.v ?? "";
          cell.font = xFont({ bold: o.bold, color: o.color, size: o.size, italic: o.italic });
          cell.alignment = { horizontal: o.align || align, vertical: "middle", wrapText: !!o.wrap };
          if (o.fmt) cell.numFmt = o.fmt;
          if (o.wrap && typeof o.v === "string") tall = Math.max(tall, Math.ceil(o.v.length / (span * 13)));
          for (let k = c; k < c + span; k++) { const x = ws.getCell(row, k); x.fill = xFill(o.fill || (i % 2 ? XC.card : XC.white)); x.border = xHair; }
          c += span;
        });
        ws.getRow(row).height = Math.min(120, Math.max(18, tall * 13 + 5)); row++;
      });
      row++;
    };
    (spec.sections || []).filter(Boolean).forEach(table);
    ws.mergeCells(row, 2, row, 11);
    Object.assign(ws.getCell(row, 2), { value: spec.tip || "Every record is on the next sheet(s) — use the filter arrows in the header row to sort or filter.", font: xFont({ size: 9, italic: true, color: XC.muted }) });
    ws.pageSetup.printArea = `A1:L${row}`;

    // ================= data sheets =================
    for (const s of spec.sheets || []) {
      const cols = s.cols, last = cols.length, rows = s.rows;
      const sh = wb.addWorksheet(s.name.replace(/[*?:\\/[\]]+/g, "-").replace(/\s*-\s*/g, " - ").slice(0, 31), { properties: { tabColor: { argb: "FF" + (s.tab || XC.tan) } }, views: [{ state: "frozen", ySplit: 4, showGridLines: false }], pageSetup: { ...print, printTitlesRow: "4:4" } });
      sh.headerFooter.oddFooter = "&L&8HM Training Division&R&8Page &P of &N";
      sh.columns = cols.map((c) => ({ width: c.width || ({ long: 50, date: 13, datetime: 17, int: 10, num: 10, pct: 11, status: 13, yesno: 10 })[c.type] || 16 }));
      sh.mergeCells(1, 1, 1, last);
      const tc = sh.getCell(1, 1);
      tc.value = { richText: [{ text: s.title || s.name, font: xFont({ size: 16, bold: true, color: XC.bg }) }, { text: `    ${s.summary || plural(rows.length, "row")}`, font: xFont({ size: 10, color: XC.tan }) }] };
      tc.alignment = { vertical: "middle", indent: 1 };
      for (let c = 1; c <= last; c++) { sh.getCell(1, c).fill = xFill(XC.ink); sh.getCell(2, c).fill = xFill(XC.bg); }
      sh.getRow(1).height = 34;
      sh.mergeCells(2, 1, 2, last);
      Object.assign(sh.getCell(2, 1), { value: `HM Training Division  ·  ${meta}`, font: xFont({ size: 9, color: XC.muted }), alignment: { indent: 1, vertical: "middle" } });
      sh.getRow(2).height = 18;
      const hr = sh.getRow(4);
      cols.forEach((c, i) => {
        const x = hr.getCell(i + 1);
        x.value = c.label; x.font = xFont({ size: 10, bold: true }); x.fill = xFill(XC.tan);
        x.alignment = { horizontal: c.type === "text" || c.type === "long" || !c.type ? "left" : "center", vertical: "middle", wrapText: true };
        x.border = { bottom: { style: "medium", color: { argb: "FF" + XC.ink } } };
      });
      hr.height = 24;
      if (!rows.length) {
        sh.mergeCells(5, 1, 5, last);
        Object.assign(sh.getCell(5, 1), { value: "No records in this report.", font: xFont({ italic: true, color: XC.muted }), alignment: { horizontal: "center" } });
        continue;
      }
      rows.forEach((r, i) => {
        const xr = sh.getRow(5 + i);
        let tall = 1;
        cols.forEach((c, j) => {
          const cell = xr.getCell(j + 1), raw = c.get(r, i);
          const t = c.type || "text";
          let v = raw, font = { color: c.muted ? XC.muted : XC.ink, bold: !!c.bold }, align = "center", fill = i % 2 ? XC.card : XC.white;
          if (t === "date") { v = xDay(raw); cell.numFmt = "dd mmm yyyy"; }
          else if (t === "datetime") { v = xLocal(raw); cell.numFmt = "dd mmm yyyy  hh:mm"; }
          else if (t === "pct") { const n = raw === "" || raw == null ? null : +raw; v = n == null ? "" : n / 100; cell.numFmt = "0.0%"; font = { bold: true, color: xPctColor(n) }; }
          else if (t === "int" || t === "num") { v = raw === "" || raw == null ? "" : +raw; }
          else if (t === "status") { const st = (c.styles || {})[raw] || { fill: XC.line, font: XC.ink }; v = st.label || raw || ""; if (raw) { fill = st.fill; font = { bold: true, color: st.font }; } }
          else if (t === "yesno") { v = raw === true || raw === "Yes" || raw === 1 ? "Yes" : raw === false || raw === "No" || raw === 0 ? "No" : raw || ""; if (v === "Yes") font = { bold: true, color: c.yesGood === false ? XC.bad : XC.good }; else if (v === "No") font = { bold: true, color: c.yesGood === false ? XC.good : XC.bad }; }
          else { align = "left"; v = raw ?? ""; if (t === "long" && v) tall = Math.max(tall, String(v).split("\n").reduce((n, s) => n + Math.max(1, Math.ceil(s.length / Math.max(10, (c.width || 50) * 1.1))), 0)); }
          cell.value = v === null || v === undefined ? "" : v;
          cell.font = xFont(font);
          cell.alignment = { horizontal: align, vertical: "top", wrapText: t === "long" || t === "text" };
          cell.fill = xFill(fill);
          cell.border = xHair;
        });
        xr.height = Math.min(300, Math.max(18, tall * 13 + 5));
      });
      sh.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: last } };
    }

    const buf = await wb.xlsx.writeBuffer();
    const a = h("a", { href: URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })), download: spec.file });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast("Excel report downloaded");
  } catch (e) { toast(e.message); }
}

// Shared status styles
const XS_VISIT = { open: { label: "Open", fill: "F1E4D2", font: XC.warn }, completed: { label: "Completed", fill: "DCEFE8", font: "1F6E5C" } };
const xFileName = (s) => `HM_${s.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "")}_${ymd(new Date())}.xlsx`;

// ======================================================================
// Report designs, one per export
// ======================================================================
const xMany = (rows, fn) => new Set(rows.map(fn).filter(Boolean)).size > 1;
const xScopeText = (filtered, total, what) => (filtered < total ? `${filtered} of ${total} ${what} (your current filters)` : null);

// ---------- store visits (Verification → Visits, and one trainer's page) ----------
function reportVisits(rows, { title = "Store Visits Report", scope, total = rows.length, file = "Visits", showTrainer = true } = {}) {
  const scored = rows.filter((v) => v.avg != null);
  const fu = rows.filter((v) => v.follow_up);
  const staff = rows.reduce((n, v) => n + (+v.staff || 0), 0);
  const avg = xAvg(scored, (v) => v.avg);
  const multiT = xMany(rows, (v) => v.trainer_name);
  return hmReport({
    file: xFileName(file), title, period: periodText(), scope: [scope, xScopeText(rows.length, total, "visits")].filter(Boolean).join(" · "),
    kpis: [
      { label: "Visits", value: rows.length, tone: "ink" },
      { label: "Stores visited", value: new Set(rows.map((v) => v.store_code)).size, tone: "tan" },
      { label: "Staff evaluated", value: staff, tone: "teal" },
      { label: "Average score", value: avg, pct: true, tone: avg == null ? "card" : avg >= GOOD ? "good" : avg >= WARN ? "card" : "bad" },
      { label: "Follow-ups required", value: fu.length, tone: fu.length ? "tan" : "card" },
    ],
    sections: [
      multiT && xRollup("By trainer", "visits and average staff score", rows, (v) => v.trainer_name, { label: "Trainer", count: "Visits", pctFn: (v) => v.avg, pctLabel: "Avg score",
        extra: [{ label: "Stores", get: (l) => new Set(l.map((v) => v.store_code)).size }, { label: "Staff", get: (l) => l.reduce((n, v) => n + (+v.staff || 0), 0) }] }),
      xRollup("By area manager", "where the visits went and how stores scored", rows, (v) => v.area_manager, { label: "Area manager", count: "Visits", pctFn: (v) => v.avg, pctLabel: "Avg score" }),
      xMany(rows, (v) => v.region) && xRollup("By region", null, rows, (v) => v.region, { label: "Region", count: "Visits", pctFn: (v) => v.avg, pctLabel: "Avg score" }),
      { title: "Lowest-scoring visits", note: "the 10 visits with the lowest average staff score", cols: [["Date", 1], ["Store", 3, "left"], ["Trainer", 2, "left"], ["Staff", 1], ["Avg score", 1], ["Follow-up", 2]],
        rows: [...scored].sort((a, b) => a.avg - b.avg).slice(0, 10).map((v) => [cDay(v.started_at), cName(`${v.store_code} · ${v.store_name}`), { v: v.trainer_name || "", align: "left" }, v.staff, cPct(v.avg), v.follow_up ? { v: v.follow_up_date ? xDay(v.follow_up_date) : "Required", fmt: "dd mmm yyyy", bold: true, color: XC.warn } : { v: "—", color: XC.muted }]),
        empty: "No scored visits in this report." },
      fu.length > 0 && { title: "Follow-ups required", note: "visits marked for a follow-up — soonest first", cols: [["Follow-up", 1], ["Visit date", 1], ["Store", 3, "left"], ["Trainer", 2, "left"], ["Notes", 3, "left"]],
        rows: [...fu].sort((a, b) => String(a.follow_up_date || "9").localeCompare(String(b.follow_up_date || "9"))).slice(0, 20).map((v) => [v.follow_up_date ? cDay(v.follow_up_date) : { v: "No date", color: XC.muted }, cDay(v.started_at), cName(`${v.store_code} · ${v.store_name}`), { v: v.trainer_name || "", align: "left" }, cText(v.notes)]) },
    ],
    sheets: [{ name: "Visits", title: "Store visits", summary: `${plural(rows.length, "visit")}  ·  ${plural(staff, "staff member")} evaluated  ·  average score ${avg == null ? "—" : avg + "%"}`, rows: [...rows].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))),
      cols: [
        { label: "Date", get: (v) => v.started_at, type: "datetime" }, ...(showTrainer ? [{ label: "Trainer", get: (v) => v.trainer_name, bold: true, width: 22 }, { label: "Employee ID", get: (v) => v.trainer_employee_id, width: 12 }] : []),
        { label: "Store ID", get: (v) => v.store_code, width: 10 }, { label: "Store", get: (v) => v.store_name, bold: true, width: 26 },
        { label: "Area manager", get: (v) => v.area_manager, width: 20 }, { label: "ROM", get: (v) => v.rom, width: 18 }, { label: "Region", get: (v) => v.region, width: 12 }, { label: "City", get: (v) => v.city, width: 14 },
        { label: "Staff evaluated", get: (v) => v.staff, type: "int" }, { label: "Avg score", get: (v) => v.avg, type: "pct" },
        { label: "Status", get: (v) => v.status, type: "status", styles: XS_VISIT },
        { label: "Follow-up", get: (v) => (v.follow_up ? (v.follow_up_date || "Required") : ""), type: "date", width: 13 }, { label: "Notes", get: (v) => v.notes, type: "long", width: 45 },
      ] }],
  });
}

// ---------- staff evaluations (Verification → Visits → Staff evaluations) ----------
function reportEvals(list, { total = list.length } = {}) {
  const rows = list.map((e) => ({ ...e, p: pct(e.score, e.max_score), tp: pct(e.trained_count, e.max_score) }));
  const avg = xAvg(rows, (e) => e.p), tavg = xAvg(rows, (e) => e.tp), low = rows.filter((e) => e.p != null && e.p < WARN);
  const band = (lo, hi) => rows.filter((e) => e.p != null && e.p >= lo && e.p < hi).length;
  const bands = [[`Strong · ${GOOD}% or more`, band(GOOD, 101), XC.good], [`OK · ${WARN}–${GOOD - 1}%`, band(WARN, GOOD), XC.warn], [`Needs attention · below ${WARN}%`, band(0, WARN), XC.bad]];
  return hmReport({
    file: xFileName("Staff_Evaluations"), title: "Staff Evaluations Report", period: periodText(), scope: xScopeText(rows.length, total, "evaluations") || "All trainers",
    kpis: [
      { label: "Evaluations", value: rows.length, tone: "ink" },
      { label: "Staff evaluated", value: new Set(rows.map((e) => `${e.store_code}|${(e.staff_name || "").toLowerCase()}`)).size, tone: "tan" },
      { label: "Average score", value: avg, pct: true, tone: avg == null ? "card" : avg >= GOOD ? "good" : avg >= WARN ? "teal" : "bad" },
      { label: "Average training", value: tavg, pct: true, tone: "teal" },
      { label: `Below ${WARN}%`, value: low.length, tone: low.length ? "bad" : "card" },
    ],
    sections: [
      { title: "Score bands", note: "how the evaluations are spread", cols: [["Band", 3, "left"], ["Evaluations", 1], ["Share", 1], ["", 5, "left"]],
        rows: bands.map(([l, n, col]) => [{ v: l, bold: true, align: "left", color: col }, n, { v: rows.length ? n / rows.length : 0, fmt: "0%", bold: true }, { v: "█".repeat(Math.round((rows.length ? n / rows.length : 0) * 40)), color: col, align: "left", size: 9 }]) },
      xRollup("By position", "average score per role", rows, (e) => e.position_name, { label: "Position", count: "Evaluations", pctFn: (e) => e.p, pctLabel: "Avg score", extra: [{ label: "Training", get: (l) => cPct(xAvg(l, (e) => e.tp)) }] }),
      xMany(rows, (e) => e.trainer_name) && xRollup("By trainer", null, rows, (e) => e.trainer_name, { label: "Trainer", count: "Evaluations", pctFn: (e) => e.p, pctLabel: "Avg score" }),
      xRollup("By area manager", null, rows, (e) => e.area_manager, { label: "Area manager", count: "Evaluations", pctFn: (e) => e.p, pctLabel: "Avg score" }),
      { title: "Lowest scores", note: "the 10 people who most need coaching", cols: [["Date", 1], ["Staff", 2, "left"], ["Position", 1], ["Store", 2, "left"], ["Trainer", 2, "left"], ["Score", 1], ["Training", 1]],
        rows: rows.filter((e) => e.p != null).sort((a, b) => a.p - b.p).slice(0, 10).map((e) => [cDay(e.submitted_at), cName(e.staff_name), e.position_name, { v: `${e.store_code} · ${e.store_name}`, align: "left" }, { v: e.trainer_name || "", align: "left" }, cPct(e.p), cPct(e.tp)]) },
    ],
    sheets: [{ name: "Evaluations", title: "Staff evaluations", summary: `${plural(rows.length, "evaluation")}  ·  average score ${avg == null ? "—" : avg + "%"}  ·  ${low.length} below ${WARN}%`,
      rows: [...rows].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))),
      cols: [
        { label: "Date", get: (e) => e.submitted_at, type: "datetime" }, { label: "Staff", get: (e) => e.staff_name, bold: true, width: 22 }, { label: "Staff ID", get: (e) => e.staff_code, width: 11 },
        { label: "Position", get: (e) => e.position_name, width: 16 }, { label: "Score", get: (e) => e.p, type: "pct" }, { label: "Points", get: (e) => `${e.score} / ${e.max_score}`, width: 9, muted: true },
        { label: "Training", get: (e) => e.tp, type: "pct" }, { label: "Trainer", get: (e) => e.trainer_name, width: 20 }, { label: "Employee ID", get: (e) => e.trainer_employee_id, width: 12 },
        { label: "Store ID", get: (e) => e.store_code, width: 10 }, { label: "Store", get: (e) => e.store_name, width: 24 }, { label: "Area manager", get: (e) => e.area_manager, width: 20 },
        { label: "ROM", get: (e) => e.rom, width: 18 }, { label: "Region", get: (e) => e.region, width: 12 }, { label: "City", get: (e) => e.city, width: 14 },
        { label: "Areas for improvement", get: (e) => e.improvement_notes, type: "long", width: 50 },
      ] }],
  });
}

// ---------- one evaluation (result page) ----------
function reportEval(ev) {
  const p = pct(ev.score, ev.max_score), tp = pct(ev.trained_count, ev.max_score);
  const tasks = [];
  for (const s of ev.sections) for (const q of s.items) if (q.kind === "question") tasks.push({ section: s.title, skipped: s.skipped, text: q.text, trained: q.trained, performed: q.performed });
  const live = tasks.filter((t) => !t.skipped), notDone = live.filter((t) => t.performed === 0), notTrained = live.filter((t) => t.trained === 0);
  const secs = ev.sections.map((s) => { const qs = tasks.filter((t) => t.section === s.title); const done = qs.filter((t) => t.performed === 1).length; return { s, n: qs.length, done, p: s.skipped || !qs.length ? null : pct(done, qs.length) }; });
  return hmReport({
    file: xFileName(`Evaluation_${ev.staff_name}`), title: `Evaluation · ${ev.staff_name}`, scope: `${ev.position_name} · ${ev.store_code} ${ev.store_name}`,
    kpis: [
      { label: "Score", value: p, pct: true, tone: p == null ? "card" : p >= GOOD ? "good" : p >= WARN ? "tan" : "bad" },
      { label: "Tasks performed", value: `${ev.score} / ${ev.max_score}`, tone: "ink" },
      { label: "Received training", value: tp, pct: true, tone: "teal" },
      { label: "Not performed", value: notDone.length, tone: notDone.length ? "tan" : "card" },
      { label: "Not trained", value: notTrained.length, tone: "card" },
    ],
    info: [["Staff", ev.staff_name], ["Staff ID", ev.staff_code || "—"], ["Position", ev.position_name], ["Store", `${ev.store_code} · ${ev.store_name}`],
      ["Trainer", `${ev.trainer_name || "—"}${ev.trainer_employee_id ? ` (${ev.trainer_employee_id})` : ""}`], ["Date", ev.submitted_at ? fmtDateTime(ev.submitted_at) : "—"]],
    sections: [
      { title: "By section", note: "tasks performed in each part of the evaluation", cols: [["Section", 4, "left"], ["Tasks", 1], ["Performed", 1], ["Score", 1], ["Progress", 3, "left"]],
        rows: secs.map(({ s, n, done, p: sp }) => s.skipped ? [cName(s.title), { v: "Not applicable", color: XC.muted, italic: true }, "", "", ""] : [cName(s.title), n, done, cPct(sp), cBar(sp)]) },
      { title: "Tasks not performed", note: "what to coach first", cols: [["Section", 3, "left"], ["Task", 6, "left"], ["Trained?", 1]],
        rows: notDone.map((t) => [cName(t.section), cText(t.text), { v: t.trained === 1 ? "Yes" : "No", bold: true, color: t.trained === 1 ? XC.good : XC.bad }]), empty: "Every task was performed. 🎉" },
      { title: "Areas for improvement", cols: [["Notes from the trainer", 10, "left"]], rows: ev.improvement_notes ? [[{ v: ev.improvement_notes, align: "left", wrap: true }]] : [], empty: "No notes were added." },
    ],
    tip: "Every task with its answers is on the next sheet.",
    sheets: [{ name: "All tasks", title: `${ev.staff_name} · all tasks`, summary: `${ev.score} of ${ev.max_score} performed  ·  ${p}%`, rows: tasks,
      cols: [{ label: "#", get: (_, i) => i + 1, type: "int", width: 5, muted: true }, { label: "Section", get: (t) => t.section, bold: true, width: 26 }, { label: "Task", get: (t) => t.text, type: "long", width: 70 },
        { label: "Received training", get: (t) => (t.skipped ? "N/A" : t.trained === 1 ? "Yes" : t.trained === 0 ? "No" : ""), type: "yesno", width: 12 },
        { label: "Performed", get: (t) => (t.skipped ? "N/A" : t.performed === 1 ? "Yes" : t.performed === 0 ? "No" : ""), type: "yesno", width: 12 }] }],
  });
}

// ---------- Onboarding / NPD / Coaching / People development ----------
function reportRecords(key, cfg, rows, cols, { kindLabel = {}, total = rows.length, kind = "" } = {}) {
  const admin = session.role === "admin";
  const ftype = {};
  for (const k of cfg.kinds) for (const f of k.fields) ftype[f.key] = f.type || "text";
  const scored = rows.filter((r) => r.pct != null), avg = xAvg(scored, (r) => r.pct);
  const strong = scored.filter((r) => r.pct >= GOOD), low = scored.filter((r) => r.pct < WARN);
  const what = kind ? kindLabel[kind] : cfg.title;
  const detailKey = { onboarding: "position", npd: "product_name", coaching: "topic", development: "kind" }[key];
  const detail = (r) => (detailKey === "kind" ? kindLabel[r.kind] : r[detailKey]) || "";
  const detailLabel = { onboarding: "Position", npd: "Product", coaching: "Topic", development: "Track" }[key];
  const kpis = [
    { label: "Records", value: rows.length, tone: "ink" },
    { label: "Avg verification", value: avg, pct: true, tone: avg == null ? "card" : avg >= GOOD ? "good" : avg >= WARN ? "teal" : "bad" },
    { label: `Strong · ${GOOD}%+`, value: strong.length, tone: "teal" },
    { label: `Needs attention · <${WARN}%`, value: low.length, tone: low.length ? "bad" : "card" },
  ];
  if (key === "onboarding") kpis.push({ label: "Currently in training", value: rows.filter((r) => r.training_start && !r.training_end).length, tone: "tan" });
  else if (admin) kpis.push({ label: "Trainers contributing", value: new Set(rows.map((r) => r.created_by_name)).size, tone: "tan" });
  const groups = (typeof BREAKDOWNS !== "undefined" && BREAKDOWNS[key]) || [];
  return hmReport({
    file: xFileName(`${what}`), title: `${what} Report`, period: periodText(), scope: [admin ? "All trainers" : null, xScopeText(rows.length, total, "records")].filter(Boolean).join(" · "),
    kpis,
    sections: [
      ...groups.filter(([k]) => (k === "kind" ? xMany(rows, (r) => r.kind) : rows.some((r) => r[k]))).slice(0, 4).map(([k, l]) =>
        xRollup(`By ${l.toLowerCase()}`, null, rows, (r) => (k === "kind" ? kindLabel[r.kind] : r[k]), { label: l, count: "Records", pctFn: (r) => r.pct, pctLabel: "Avg verification", top: 12 })),
      admin && xMany(rows, (r) => r.created_by_name) && xRollup("By trainer", "who entered the records", rows, (r) => r.created_by_name, { label: "Trainer", count: "Records", pctFn: (r) => r.pct, pctLabel: "Avg verification" }),
      { title: "Needs attention", note: `lowest verification % first${low.length > 10 ? ` · 10 of ${low.length}` : ""}`, cols: [["Name", 3, "left"], ["Employee ID", 1], [detailLabel, 3, "left"], ["Entered by", 2, "left"], ["Verification", 1]],
        rows: [...low].sort((a, b) => a.pct - b.pct).slice(0, 10).map((r) => [cName(r.name), r.emp_id || "", { v: detail(r), align: "left" }, { v: r.created_by_name || "", align: "left" }, cPct(r.pct)]),
        empty: `Nobody is below ${WARN}%. 🎉` },
    ],
    sheets: [{ name: what, title: what, summary: `${plural(rows.length, "record")}  ·  average ${avg == null ? "—" : avg + "%"}  ·  ${strong.length} strong  ·  ${low.length} need attention`,
      rows: [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      cols: cols.filter((c) => c.key !== "actions").map((c) => {
        const t = c.key === "kind" ? "text" : c.key === "created_at" ? "datetime" : c.key === "pct" ? "pct" : ({ pct: "pct", date: "date", textarea: "long" })[ftype[c.key]] || "text";
        return { label: c.label, type: t, bold: c.key === "name", width: t === "long" ? 45 : c.key === "name" ? 24 : undefined, get: (r) => (c.key === "kind" ? kindLabel[r.kind] || r.kind : r[c.key]) };
      }) }],
  });
}

// ---------- Store visit reports ----------
function reportSv(rows, { total = rows.length } = {}) {
  const admin = session.role === "admin";
  const avg = xAvg(rows, (r) => r.overall_score), ravg = xAvg(rows, (r) => r.readiness_pct), fu = rows.filter((r) => r.follow_up);
  return hmReport({
    file: xFileName("Store_Visit_Reports"), title: "Store Visit Reports", period: periodText(), scope: [admin ? "All trainers" : null, xScopeText(rows.length, total, "reports")].filter(Boolean).join(" · "),
    kpis: [
      { label: "Reports", value: rows.length, tone: "ink" },
      { label: "Stores visited", value: new Set(rows.map((r) => r.store_code)).size, tone: "tan" },
      { label: "Avg overall score", value: avg, pct: true, tone: avg == null ? "card" : avg >= GOOD ? "good" : avg >= WARN ? "teal" : "bad" },
      { label: "Avg readiness", value: ravg, pct: true, tone: "teal" },
      { label: "Follow-ups required", value: fu.length, tone: fu.length ? "tan" : "card" },
    ],
    sections: [
      xRollup("By area manager", "average overall score", rows, (r) => r.area_manager, { label: "Area manager", count: "Reports", pctFn: (r) => r.overall_score, pctLabel: "Avg overall", extra: [{ label: "Readiness", get: (l) => cPct(xAvg(l, (r) => r.readiness_pct)) }] }),
      admin && xMany(rows, (r) => r.trainer_name) && xRollup("By trainer", null, rows, (r) => r.trainer_name, { label: "Visited by", count: "Reports", pctFn: (r) => r.overall_score, pctLabel: "Avg overall" }),
      xRollup("Ratings", "how stores were rated", rows, (r) => r.overall_rating, { label: "Rating", count: "Reports" }),
      xMany(rows, (r) => r.visit_type) && xRollup("By visit type", null, rows, (r) => r.visit_type, { label: "Visit type", count: "Reports", pctFn: (r) => r.overall_score, pctLabel: "Avg overall" }),
      { title: "Lowest overall scores", note: "the 10 stores that need the most support", cols: [["Report", 1], ["Date", 1], ["Store", 3, "left"], ["Visited by", 2, "left"], ["Overall", 1], ["Readiness", 1], ["Follow-up", 1]],
        rows: rows.filter((r) => r.overall_score != null).sort((a, b) => a.overall_score - b.overall_score).slice(0, 10).map((r) => [{ v: r.report, bold: true }, cDay(r.visit_date), cName(`${r.store_code} · ${r.store_name}`), { v: r.trainer_name || "", align: "left" }, cPct(r.overall_score), cPct(r.readiness_pct), r.follow_up ? { v: "Required", bold: true, color: XC.warn } : { v: "—", color: XC.muted }]) },
    ],
    sheets: [{ name: "Store visits", title: "Store visit reports", summary: `${plural(rows.length, "report")}  ·  average overall ${avg == null ? "—" : avg + "%"}  ·  ${fu.length} follow-up${fu.length === 1 ? "" : "s"}`,
      rows: [...rows].sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date))),
      cols: [
        { label: "Report", get: (r) => r.report, bold: true, width: 10 }, { label: "Visit date", get: (r) => r.visit_date, type: "date" }, { label: "Store ID", get: (r) => r.store_code, width: 10 },
        { label: "Store", get: (r) => r.store_name, bold: true, width: 26 }, { label: "Area manager", get: (r) => r.area_manager, width: 20 }, { label: "ROM", get: (r) => r.rom, width: 18 },
        { label: "Region", get: (r) => r.region, width: 12 }, { label: "City", get: (r) => r.city, width: 14 }, { label: "Visited by", get: (r) => r.trainer_name, width: 20 },
        { label: "Branch manager", get: (r) => r.branch_manager, width: 18 }, { label: "Type", get: (r) => r.visit_type, width: 12 },
        { label: "Readiness", get: (r) => r.readiness_pct, type: "pct" }, { label: "Quality", get: (r) => r.quality_avg, type: "pct" }, { label: "Overall", get: (r) => r.overall_score, type: "pct" },
        { label: "Rating", get: (r) => r.overall_rating, width: 16 }, { label: "Follow-up", get: (r) => (r.follow_up ? "Required" : "No"), type: "text", width: 11 },
      ] }],
  });
}
