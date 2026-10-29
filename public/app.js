/* HM Staff Knowledge Evaluation — single-page front end (no build step). */
"use strict";

// ---------- tiny helpers ----------
const $app = document.getElementById("app");
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const GOOD = 85, WARN = 65;
const pctClass = (p) => (p == null ? "" : p >= GOOD ? "good" : p >= WARN ? "warn" : "bad");
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const fmtPct = (p) => (p == null ? "—" : `${p}%`);
const fmtDate = (s) => (s ? new Date(s.replace(" ", "T") + "Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: method !== "GET" ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") { session = { role: null }; render(); throw new Error(data.error || "Signed out"); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Wrap an admin action: run it, then re-render keeping scroll. "Cancelled"/"No changes" are silent.
const guarded = (fn) => async (...a) => {
  try { await fn(...a); const y = scrollY; await renderRoute(); scrollTo(0, y); }
  catch (e) { if (!["Cancelled", "No changes"].includes(e.message)) toast(e.message); }
};

// Small in-memory cache for data that rarely changes (position list), so "New evaluation" opens instantly.
const cache = new Map();
async function cachedGet(path, ttl = 300000) {
  const c = cache.get(path);
  if (c && Date.now() - c.t < ttl) return c.v;
  const v = await api(path); cache.set(path, { v, t: Date.now() }); return v;
}

function modal(title, bodyNodes, actions) {
  return new Promise((resolve) => {
    const close = (v) => { bg.remove(); resolve(v); };
    const bg = h("div", { class: "modal-bg", onclick: (e) => e.target === bg && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-label": title },
        h("h2", {}, title), bodyNodes,
        h("div", { class: "actions" }, actions(close))));
    document.body.append(bg);
    bg.querySelector("input,textarea,button.teal,button")?.focus();
  });
}
const confirmBox = (title, text, okLabel = "Confirm", danger = false) =>
  modal(title, h("p", {}, text), (close) => [
    h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"),
    h("button", { class: `btn ${danger ? "danger" : "teal"}`, onclick: () => close(true) }, okLabel),
  ]);

// The 880 KB Excel library is only fetched the first time someone exports.
let xlsxReady;
const loadXlsx = () => (window.XLSX ? Promise.resolve() : (xlsxReady ||= new Promise((resolve, reject) => {
  const el = document.createElement("script"); el.src = "/vendor/xlsx.full.min.js";
  el.onload = resolve; el.onerror = () => { xlsxReady = null; reject(new Error("Could not load the Excel exporter — check your connection")); };
  document.head.append(el);
})));
async function download(wbRows, filename, sheetName = "Sheet1") {
  try {
    toast("Preparing Excel file…");
    await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet(wbRows);
    ws["!cols"] = wbRows[0].map((_, i) => ({ wch: Math.min(60, Math.max(10, ...wbRows.map((r) => String(r[i] ?? "").length))) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  } catch (e) { toast(e.message); }
}

// ---------- reusable sortable + filterable table ----------
// cols: [{key,label,num?,get?(row),render?(row)->node,nosort?}]; filters: [{key,label,get?(row),show?(value)}]
function grid({ cols, rows, filters = [], searchIn, sort, initial = {}, onRow, rowClass, empty = "Nothing to show.", toolbar = [], maxHeight }) {
  const st = { sort: sort || null, q: "", f: { ...initial }, limit: 100 };
  const val = (c, r) => (c.get ? c.get(r) : r[c.key]);
  const fval = (f, r) => (f.get ? f.get(r) : r[f.key]);
  const tbody = h("tbody"), count = h("span", { class: "muted small" });
  const heads = cols.map((c) => {
    const arrow = h("span", { class: "arrow" });
    const th = h("th", { class: c.nosort ? "" : "sortable", "aria-sort": "none" }, c.nosort ? c.label : h("button", { type: "button", class: "thbtn", onclick: () => { st.sort = st.sort && st.sort.key === c.key ? { key: c.key, dir: -st.sort.dir } : { key: c.key, dir: 1 }; st.limit = 100; draw(); } }, c.label, arrow));
    th.arrow = arrow; return th;
  });
  const selects = filters.map((f) => {
    const sel = h("select", { class: "flt", "aria-label": f.label, onchange: (e) => { st.f[f.key] = e.target.value; st.limit = 100; draw(); } });
    sel.f = f; return sel;
  });
  const search = searchIn ? h("input", { type: "search", class: "flt-search", placeholder: "Search…", "aria-label": "Search", oninput: (e) => { st.q = e.target.value.trim().toLowerCase(); st.limit = 100; draw(); } }) : null;
  const clear = h("button", { type: "button", class: "btn ghost sm hidden", onclick: () => { st.f = {}; st.q = ""; if (search) search.value = ""; draw(); } }, "Clear filters");

  function view() {
    let out = rows.filter((r) => filters.every((f) => !st.f[f.key] || String(fval(f, r) ?? "") === st.f[f.key]) && (!st.q || searchIn(r).toLowerCase().includes(st.q)));
    if (st.sort) {
      const c = cols.find((x) => x.key === st.sort.key), d = st.sort.dir;
      out = [...out].sort((a, b) => {
        const x = val(c, a), y = val(c, b);
        if (x == null || x === "") return y == null || y === "" ? 0 : 1;   // empty values always last
        if (y == null || y === "") return -1;
        return d * (c.num ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }));
      });
    }
    return out;
  }
  function draw() {
    for (const s of selects) {                       // option lists follow the other active filters
      const f = s.f, others = rows.filter((r) => filters.every((g) => g === f || !st.f[g.key] || String(fval(g, r) ?? "") === st.f[g.key]));
      const vals = [...new Set(others.map((r) => fval(f, r)).filter((v) => v != null && v !== "").map(String))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (st.f[f.key] && !vals.includes(st.f[f.key])) vals.push(st.f[f.key]);
      s.replaceChildren(h("option", { value: "" }, `All ${f.label}`), ...vals.map((v) => h("option", { value: v, selected: st.f[f.key] === v }, f.show ? f.show(v) : v)));
      s.value = st.f[f.key] || "";
      s.classList.toggle("on", !!st.f[f.key]);
    }
    heads.forEach((th, i) => { const on = st.sort && st.sort.key === cols[i].key; th.setAttribute("aria-sort", on ? (st.sort.dir > 0 ? "ascending" : "descending") : "none"); if (th.arrow) th.arrow.textContent = on ? (st.sort.dir > 0 ? " ▲" : " ▼") : ""; });
    const out = view(); draw.rows = out;
    count.textContent = out.length === rows.length ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : `${out.length} of ${rows.length}`;
    clear.classList.toggle("hidden", !(st.q || Object.values(st.f).some(Boolean)));
    const shown = out.length > st.limit ? out.slice(0, st.limit) : out;
    const more = out.length > shown.length ? [h("tr", {}, h("td", { colspan: cols.length, style: "text-align:center" }, h("button", { type: "button", class: "btn ghost sm", onclick: () => { st.limit += 200; draw(); } }, `Show more (${out.length - shown.length} left)`)))] : [];
    tbody.replaceChildren(...(out.length ? [...shown.map((r) => { const tr = h("tr", { class: (onRow ? "click " : "") + (rowClass ? rowClass(r) : ""), onclick: onRow ? () => onRow(r) : null }, cols.map((c) => h("td", { class: c.cls || "" }, c.render ? c.render(r) : (val(c, r) ?? "")))); return tr; }), ...more] : [h("tr", {}, h("td", { colspan: cols.length, class: "muted" }, empty))]));
  }
  const el = h("div", {}, h("div", { class: "gridbar" }, search, selects, clear, h("span", { style: "flex:1" }), count, toolbar),
    h("div", { class: "table-wrap", style: maxHeight ? `max-height:${maxHeight};overflow:auto` : "" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, heads)), tbody)));
  draw();
  return { el, redraw: draw, rows: () => draw.rows, setRows(r) { rows = r; draw(); } };
}

// ---------- shell ----------
let session = { role: null };
const logo = () => h("img", { src: "/logo.png", alt: "½M" });

function shell(content, active) {
  const admin = session.role === "admin";
  const links = admin
    ? [["#/admin", "Dashboard"], ["#/admin/evals", "Evaluations"], ["#/admin/questions", "Questions"], ["#/admin/stores", "Stores"]]
    : [["#/", "My evaluations"], ["#/new", "New evaluation"]];
  return h("div", {},
    h("header", { class: "top no-print" }, h("div", { class: "top-in" },
      h("a", { class: "brand", href: admin ? "#/admin" : "#/" }, logo(), h("div", {}, h("b", {}, "Staff Knowledge", h("br"), "Evaluation"), h("i"))),
      h("nav", { class: "nav" }, links.map(([href, label]) => h("a", { href, class: active === href ? "on" : "" }, label))),
      h("div", { class: "who" }, h("b", {}, admin ? "Admin" : session.store.name), h("a", { href: "#", class: "muted", onclick: async (e) => { e.preventDefault(); await api("/logout", { method: "POST", body: {} }); session = { role: null }; location.hash = ""; render(); } }, "Sign out")))),
    h("main", {}, content));
}

function pageHead(title, sub, ...right) {
  return h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub && h("p", {}, sub), h("div", { class: "tan-bar" })), h("div", { class: "row no-print" }, right));
}

// ---------- login ----------
function loginView() {
  const err = h("div", { class: "err hidden" });
  const user = h("input", { type: "text", autocomplete: "username", autocapitalize: "none", required: true });
  const pass = h("input", { type: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { class: "btn teal", style: "width:100%;justify-content:center" }, "Sign in");
  const form = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.classList.add("hidden");
    try {
      await api("/login", { method: "POST", body: { username: user.value.trim(), password: pass.value } });
      session = await api("/me"); location.hash = session.role === "admin" ? "#/admin" : "#/"; render();
    } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); btn.disabled = false; }
  } },
    h("div", { class: "field" }, h("label", {}, "Username"), user),
    h("div", { class: "field" }, h("label", {}, "Password"), pass), err, btn);
  return h("div", { class: "login" }, h("div", { class: "card login-card" },
    h("img", { class: "logo", src: "/logo.png", alt: "½M" }),
    h("h1", {}, "Staff Knowledge Evaluation"), h("div", { class: "tan-bar" }),
    h("p", { class: "muted" }, "Sign in with the login provided for your store."), form));
}

// ---------- store: dashboard ----------
async function storeHome() {
  const list = await api("/evals");
  (window.requestIdleCallback || setTimeout)(() => cachedGet("/positions").catch(() => {}));   // warm the "New evaluation" page
  const done = list.filter((e) => e.status === "submitted"), drafts = list.filter((e) => e.status === "draft");
  const avg = pct(done.reduce((n, e) => n + e.score, 0), done.reduce((n, e) => n + e.max_score, 0));
  const row = (e) => h("tr", { class: "click", onclick: () => (location.hash = `#/eval/${e.id}`) },
    h("td", {}, h("b", {}, e.staff_name), e.staff_code && h("div", { class: "small muted" }, e.staff_code)),
    h("td", {}, e.position_name), h("td", {}, fmtDate(e.submitted_at || e.created_at)),
    h("td", {}, e.status === "draft" ? h("span", { class: "chip warn" }, "Draft — continue") : h("span", { class: `pct ${pctClass(pct(e.score, e.max_score))}` }, fmtPct(pct(e.score, e.max_score)))));
  return shell(h("div", {},
    pageHead(session.store.name, "Evaluate your team members against the HM task outline.", h("a", { class: "btn teal", href: "#/new" }, "+ New evaluation")),
    h("div", { class: "grid g3", style: "margin-bottom:16px" },
      h("div", { class: "kpi tealk" }, h("div", { class: "v" }, done.length), h("div", { class: "l" }, "Completed evaluations")),
      h("div", { class: "kpi" }, h("div", { class: "v" }, drafts.length), h("div", { class: "l" }, "Drafts in progress")),
      h("div", { class: "kpi tank" }, h("div", { class: "v" }, fmtPct(avg)), h("div", { class: "l" }, "Average score"))),
    h("div", { class: "card" }, list.length
      ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Staff", "Position", "Date", "Score"].map((x) => h("th", {}, x)))), h("tbody", {}, list.map(row))))
      : h("p", { class: "muted" }, "No evaluations yet. Start your first one with “New evaluation”."))), "#/");
}

// ---------- store: new evaluation ----------
async function newEvalView() {
  const positions = await cachedGet("/positions");
  let pos = null;
  const err = h("div", { class: "err hidden" });
  const name = h("input", { type: "text", maxlength: 100, required: true, placeholder: "e.g. Ahmed Ali" });
  const code = h("input", { type: "text", maxlength: 40, placeholder: "Optional" });
  const who = h("input", { type: "text", maxlength: 100, placeholder: "Your name (optional)" });
  const go = h("button", { class: "btn teal", disabled: true }, "Start evaluation");
  const cards = positions.map((p) => {
    const c = h("button", { type: "button", class: "pos-card", onclick: () => { pos = p; cards.forEach((x) => x.classList.toggle("on", x === c)); go.disabled = false; } },
      h("b", {}, p.name), h("span", {}, `${p.questions} questions · ${p.sections} sections`));
    return c;
  });
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault(); err.classList.add("hidden"); go.disabled = true;
    try {
      const r = await api("/evals", { method: "POST", body: { position_id: pos.id, staff_name: name.value, staff_code: code.value, evaluator: who.value } });
      location.hash = `#/eval/${r.id}`;
    } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); go.disabled = false; }
  } },
    h("div", { class: "card" }, h("h2", {}, "1. Choose the position"), h("div", { class: "grid g3", style: "margin-top:14px" }, cards)),
    h("div", { class: "card" }, h("h2", {}, "2. Who are you evaluating?"),
      h("div", { class: "grid g3", style: "margin-top:14px" },
        h("div", {}, h("label", {}, "Staff name *"), name), h("div", {}, h("label", {}, "Staff ID"), code), h("div", {}, h("label", {}, "Evaluator"), who))),
    h("div", { class: "stack", style: "margin-top:16px" }, err, go));
  return shell(h("div", {}, pageHead("New evaluation", "Pick the position and the team member."), form), "#/new");
}

// ---------- evaluation: fill-in form ----------
// Section bodies are built on first open and clicks are handled by one delegated listener per section,
// so a 31-section / 208-question evaluation stays light on phones.
async function evalForm(ev) {
  const dirty = new Map();          // item_id -> {trained, performed}
  let skipDirty = false, timer = null, saving = false;
  const skip = new Set(ev.sections.filter((s) => s.skipped).map((s) => s.id));
  const state = h("span", { class: "savestate", "aria-live": "polite" }, "All changes saved");

  async function flush() {
    if (saving || (!dirty.size && !skipDirty)) return;
    saving = true; state.textContent = "Saving…";
    const answers = [...dirty].map(([item_id, a]) => ({ item_id, ...a })); dirty.clear();
    const sendSkip = skipDirty; skipDirty = false;
    try {
      await api(`/evals/${ev.id}/answers`, { method: "PUT", body: { answers, ...(sendSkip ? { skip: [...skip] } : {}) } });
      state.textContent = "All changes saved";
    } catch (e) {
      answers.forEach((a) => dirty.set(a.item_id, { trained: a.trained, performed: a.performed })); skipDirty ||= sendSkip;
      state.textContent = "Not saved — check connection";
    }
    saving = false;
    if (dirty.size || skipDirty) schedule();
  }
  const schedule = () => { state.textContent = "Saving…"; clearTimeout(timer); timer = setTimeout(flush, 1500); };

  const overall = h("div", { class: "bar" }, h("i", { class: "scalebar", style: "width:100%;transform:scaleX(0)" }));
  const overallTxt = h("b", {}, "");
  const scoreTxt = h("span", { class: "muted small" }, "");

  // ---- per-section state, updated incrementally ----
  const refs = ev.sections.map((s, i) => ({ sec: s, idx: i + 1, qs: s.items.filter((x) => x.kind === "question"), a: 0, sc: 0, body: null }));
  const calc = (r) => { r.a = 0; r.sc = 0; for (const q of r.qs) { if (q.trained !== null && q.performed !== null) r.a++; if (q.performed === 1) r.sc++; } };
  refs.forEach(calc);

  function paintSection(r) {
    const na = skip.has(r.sec.id), n = r.qs.length, done = !na && r.a === n;
    r.el.classList.toggle("na", na); r.el.classList.toggle("done", done);
    r.num.textContent = done ? "✓" : r.idx;
    r.meta.textContent = na ? "Not applicable" : `${r.a}/${n} answered · score ${r.sc}/${n}`;
    r.naBtn.textContent = na ? "Include section" : "Not applicable";
  }
  function paintTotals() {
    let a = 0, total = 0, score = 0;
    for (const r of refs) if (!skip.has(r.sec.id)) { a += r.a; total += r.qs.length; score += r.sc; }
    overall.firstChild.style.transform = `scaleX(${total ? a / total : 0})`;
    overallTxt.textContent = `${a}/${total} answered`;
    scoreTxt.textContent = a ? `Score so far: ${score}/${total} (${Math.round((100 * score) / total)}%)` : "";
  }

  const paintSeg = (seg, v) => { seg.children[0].classList.toggle("on", v === 1); seg.children[1].classList.toggle("on", v === 0); };
  const mkSeg = (field, v) => {
    const y = h("button", { type: "button", class: "y" + (v === 1 ? " on" : ""), "data-f": field, "data-v": 1 }, "Yes");
    const n = h("button", { type: "button", class: "n" + (v === 0 ? " on" : ""), "data-f": field, "data-v": 0 }, "No");
    return h("div", { class: "seg" }, y, n);
  };

  function buildBody(r) {
    if (r.body) return;
    let counter = 0, qi = -1;
    const allBtn = (field, label) => h("button", { type: "button", class: "btn ghost sm", onclick: () => {
      for (const q of r.qs) { q[field] = 1; dirty.set(q.id, { trained: q.trained, performed: q.performed }); }
      r.body.querySelectorAll(".q").forEach((row, i) => { const q = r.qs[i]; paintSeg(row.querySelectorAll(".seg")[field === "trained" ? 0 : 1], q[field]); row.querySelectorAll(".missing").forEach((x) => x.classList.remove("missing")); });
      calc(r); paintSection(r); paintTotals(); schedule();
    } }, label);
    r.body = h("div", { class: "sec-b" },
      h("div", { class: "sec-tools no-print" }, allBtn("trained", "All trained: Yes"), allBtn("performed", "All performed: Yes"), r.naBtn),
      h("div", { class: "colhead" }, h("span", {}, "Task"), h("span", {}, "Received training"), h("span", {}, "Performed")),
      r.sec.items.map((i) => {
        if (i.kind === "heading") { counter = 0; return h("div", { class: "heading" }, i.text); }
        if (i.kind === "note") return h("div", { class: "note", dir: "auto" }, i.text);
        counter++; qi++;
        return h("div", { class: "q", "data-i": qi },
          h("div", { class: "t" }, h("span", { class: "n" }, `${counter}.`), h("span", { dir: "auto" }, i.text)),
          h("div", {}, h("div", { class: "mlabel" }, "Received training"), mkSeg("trained", i.trained)),
          h("div", {}, h("div", { class: "mlabel" }, "Performed"), mkSeg("performed", i.performed)));
      }));
    // one listener for every Yes/No button in the section
    r.body.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]"); if (!b) return;
      const row = b.closest(".q"), q = r.qs[+row.dataset.i], f = b.dataset.f, v = +b.dataset.v;
      q[f] = q[f] === v ? null : v;
      paintSeg(b.parentElement, q[f]); b.parentElement.classList.remove("missing");
      dirty.set(q.id, { trained: q.trained, performed: q.performed });
      calc(r); paintSection(r); paintTotals(); schedule();
    });
    r.el.append(r.body);
  }

  const toggleSection = (r, force) => {
    const open = force ?? !r.el.classList.contains("open");
    if (open) buildBody(r);
    r.el.classList.toggle("open", open);
    r.head.setAttribute("aria-expanded", open);
  };

  const secEls = refs.map((r) => {
    r.meta = h("span", { class: "muted small" });
    r.num = h("div", { class: "num" }, r.idx);
    r.naBtn = h("button", { type: "button", class: "btn ghost sm", onclick: () => { const id = r.sec.id; skip.has(id) ? skip.delete(id) : skip.add(id); skipDirty = true; paintSection(r); paintTotals(); schedule(); } }, "Not applicable");
    r.head = h("div", { class: "sec-h", role: "button", tabindex: 0, "aria-expanded": "false", onclick: () => toggleSection(r), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleSection(r)) },
      r.num, h("div", { style: "flex:1" }, h("h3", {}, r.sec.title), r.meta), h("span", { class: "caret", "aria-hidden": "true" }, "▸"));
    r.el = h("section", { class: "sec" }, r.head);
    return r.el;
  });
  if (refs.length === 1) toggleSection(refs[0], true);
  refs.forEach(paintSection); paintTotals();

  const doSubmit = async () => {
    // jump to the first unanswered question and mark what is missing
    let first = null;
    for (const r of refs) {
      if (skip.has(r.sec.id)) continue;
      if (r.a < r.qs.length) {
        toggleSection(r, true);
        r.body.querySelectorAll(".q").forEach((row) => { const q = r.qs[+row.dataset.i], segs = row.querySelectorAll(".seg"); ["trained", "performed"].forEach((f, k) => { if (q[f] === null) { segs[k].classList.add("missing"); first ||= segs[k]; } }); });
      }
    }
    if (first) { toast("Some questions are still unanswered"); first.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (!(await confirmBox("Submit evaluation?", "Once submitted, the answers can no longer be changed.", "Submit"))) return;
    clearTimeout(timer); saving = false; await flush();
    submitBtns.forEach((b) => (b.disabled = true));
    try { await api(`/evals/${ev.id}/submit`, { method: "POST", body: {} }); toast("Evaluation submitted"); renderRoute(); }
    catch (e) { toast(e.message); submitBtns.forEach((b) => (b.disabled = false)); }
  };
  const submitBtns = [h("button", { class: "btn teal", onclick: doSubmit }, "Submit evaluation"), h("button", { class: "btn teal", onclick: doSubmit }, "Submit evaluation")];

  const del = h("button", { class: "btn danger sm", onclick: async () => {
    if (!(await confirmBox("Delete this draft?", "All answers entered so far will be lost.", "Delete", true))) return;
    await api(`/evals/${ev.id}`, { method: "DELETE" }); location.hash = "#/";
  } }, "Delete draft");

  const bar = h("div", { class: "evbar no-print" },
    h("div", { class: "row spread" }, h("div", {}, h("b", {}, ev.staff_name), " · ", ev.position_name), h("div", { class: "row" }, state, submitBtns[0])),
    h("div", { class: "prog row spread" }, h("div", { style: "flex:1" }, overall), overallTxt), scoreTxt);

  // Expand/collapse all: build a few sections per frame so the page never freezes
  const allOpen = h("button", { class: "btn ghost sm", onclick: async () => {
    const open = refs.some((r) => !r.el.classList.contains("open"));
    for (let i = 0; i < refs.length; i += 3) { refs.slice(i, i + 3).forEach((r) => toggleSection(r, open)); if (open) await new Promise(requestAnimationFrame); }
  } }, "Expand / collapse all");

  window.addEventListener("beforeunload", () => { if (dirty.size) flush(); }, { once: true });
  return shell(h("div", {},
    pageHead(`Evaluating ${ev.staff_name}`, `${ev.position_name}${ev.staff_code ? " · ID " + ev.staff_code : ""}. Answers save automatically.`, allOpen, del),
    bar, secEls, h("div", { class: "row no-print", style: "justify-content:flex-end;margin-top:8px" }, submitBtns[1])), "#/");
}

// ---------- evaluation: result ----------
function evalResult(ev) {
  const secs = ev.sections.filter((s) => !s.skipped);
  const score = ev.score, max = ev.max_score, p = pct(score, max), tp = pct(ev.trained_count, max);
  const gaps = [], untrained = [];
  for (const s of secs) for (const q of s.items) if (q.kind === "question") { if (q.performed === 0) gaps.push([s.title, q.text]); if (q.trained === 0) untrained.push([s.title, q.text]); }
  const list = (arr) => arr.length ? h("ul", { class: "gap-list" }, arr.slice(0, 40).map(([s, t]) => h("li", {}, h("b", {}, s + ": "), t.length > 140 ? t.slice(0, 140) + "…" : t)), arr.length > 40 && h("li", { class: "muted" }, `…and ${arr.length - 40} more`)) : h("p", { class: "muted" }, "None 🎉");
  const exportXlsx = () => {
    const rows = [["Section", "Task", "Received training", "Performed"]];
    for (const s of ev.sections) { if (s.skipped) { rows.push([s.title, "(not applicable)", "", ""]); continue; } for (const q of s.items) if (q.kind === "question") rows.push([s.title, q.text, q.trained ? "Yes" : "No", q.performed ? "Yes" : "No"]); }
    rows.push([], ["Overall score", `${score}/${max}`, `${p}%`]);
    download(rows, `evaluation-${ev.staff_name.replace(/\W+/g, "_")}-${ev.id}.xlsx`, "Evaluation");
  };
  const isAdmin = session.role === "admin";
  return shell(h("div", {},
    pageHead(ev.staff_name, `${ev.position_name} · ${ev.store_name} · ${fmtDate(ev.submitted_at)}${ev.evaluator ? " · evaluated by " + ev.evaluator : ""}`,
      h("button", { class: "btn ghost sm", onclick: () => history.back() }, "← Back"),
      h("button", { class: "btn ghost sm", onclick: () => window.print() }, "Print"),
      h("button", { class: "btn teal sm", onclick: exportXlsx }, "Download Excel"),
      isAdmin && h("button", { class: "btn danger sm", onclick: async () => { if (await confirmBox("Delete evaluation?", "This permanently removes the evaluation and its answers.", "Delete", true)) { await api(`/evals/${ev.id}`, { method: "DELETE" }); location.hash = "#/admin/evals"; } } }, "Delete")),
    h("div", { class: "grid g3", style: "margin-bottom:16px" },
      h("div", { class: "kpi tealk" }, h("div", { class: "score-ring" }, fmtPct(p)), h("div", { class: "l" }, `Overall score · ${score}/${max} tasks performed`)),
      h("div", { class: "kpi" }, h("div", { class: "score-ring" }, fmtPct(tp)), h("div", { class: "l" }, `Received training · ${ev.trained_count}/${max}`)),
      h("div", { class: "kpi tank" }, h("div", { class: "score-ring" }, gaps.length), h("div", { class: "l" }, "Tasks not performed correctly"))),
    h("div", { class: "card" }, h("h2", { style: "margin-bottom:8px" }, "Score by section"),
      ev.sections.map((s) => { const sp = pct(s.score, s.max); return h("div", { class: "secrow" },
        h("b", {}, s.title),
        s.skipped ? h("span", { class: "muted" }, "Not applicable") : h("div", { class: `bar ${pctClass(sp)}` }, h("i", { style: `width:${sp}%` })),
        s.skipped ? "" : h("span", { class: `pct ${pctClass(sp)}` }, `${s.score}/${s.max}`)); })),
    h("div", { class: "grid g2", style: "margin-top:16px" },
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Needs coaching"), h("p", { class: "muted small" }, "Tasks marked “Performed: No”."), list(gaps)),
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Training gaps"), h("p", { class: "muted small" }, "Tasks marked “Received training: No”."), list(untrained))),
    ev.notes && h("div", { class: "card" }, h("h3", {}, "Notes"), h("p", {}, ev.notes))), isAdmin ? "#/admin/evals" : "#/");
}

async function evalRoute(id) {
  const ev = await api(`/evals/${id}`);
  return ev.status === "draft" && session.role === "store" ? evalForm(ev) : ev.status === "draft" ? shell(h("div", { class: "card" }, h("p", {}, "This evaluation is still a draft."), h("a", { class: "btn ghost", href: "#/admin/evals" }, "Back")), "#/admin/evals") : evalResult(ev);
}

// ---------- admin: dashboard ----------
const MAP_COLS = [
  { key: "area_manager", label: "Area manager" }, { key: "rom", label: "ROM" }, { key: "region", label: "Region" }, { key: "city", label: "City" },
];
const MAP_FILTERS = [{ key: "area_manager", label: "area managers" }, { key: "rom", label: "ROMs" }, { key: "region", label: "regions" }, { key: "city", label: "cities" }];
const trunc = (s, n = 22) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "—");
const avgCell = (a) => (a == null ? h("span", { class: "muted" }, "—") : h("span", { class: `pct ${pctClass(a)}` }, fmtPct(a)));

async function adminHome() {
  const d = await api("/admin/summary"), t = d.totals;
  const bars = (rows) => rows.map((r) => h("div", { class: "secrow" },
    h("b", {}, r.name), r.avg_pct == null ? h("span", { class: "muted small" }, "No evaluations yet") : h("div", { class: `bar ${pctClass(r.avg_pct)}` }, h("i", { style: `width:${r.avg_pct}%` })),
    h("span", { class: `pct ${pctClass(r.avg_pct)}` }, fmtPct(r.avg_pct))));
  const stores = d.byStore.map((s) => ({ ...s, avg: s.sum_max ? pct(s.sum_score, s.sum_max) : null }));

  // "View by": roll the stores up by area manager / ROM / region / city
  const groups = { area_manager: "Area manager", rom: "ROM", region: "Region", city: "City" };
  let by = "area_manager";
  const holder = h("div");
  const tabs = h("div", { class: "tabs", style: "margin-bottom:12px" });
  const rollup = () => {
    const m = new Map();
    for (const s of stores) { const k = s[by] || "(none)"; const g = m.get(k) || { name: k, stores: 0, staff: 0, month: 0, evals: 0, sc: 0, mx: 0 }; g.stores++; g.staff += s.total_staff || 0; g.month += s.month_done || 0; g.evals += s.evaluations; g.sc += s.sum_score; g.mx += s.sum_max; m.set(k, g); }
    return [...m.values()].map((g) => ({ ...g, avg: g.mx ? pct(g.sc, g.mx) : null }));
  };
  const drawBy = () => {
    tabs.replaceChildren(...Object.entries(groups).map(([k, l]) => h("button", { type: "button", class: "tab" + (k === by ? " on" : ""), onclick: () => { by = k; drawBy(); } }, l)));
    holder.replaceChildren(grid({
      rows: rollup(), sort: { key: "name", dir: 1 }, empty: "No data yet.",
      cols: [{ key: "name", label: groups[by], render: (r) => h("b", {}, r.name) }, { key: "stores", label: "Stores", num: true },
        { key: "month", label: "Evaluated this month", num: true, render: (r) => (r.staff ? `${r.month} / ${r.staff} staff` : r.month) },
        { key: "evals", label: "All evaluations", num: true }, { key: "avg", label: "Average score", num: true, render: (r) => avgCell(r.avg) }],
    }).el);
  };

  const storeGrid = grid({
    rows: stores, searchIn: (s) => `${s.username} ${s.name} ${s.area_manager} ${s.rom} ${s.region} ${s.city}`, filters: MAP_FILTERS, sort: { key: "avg", dir: 1 },
    onRow: (s) => (location.hash = `#/admin/evals?store=${s.id}`), maxHeight: "560px",
    cols: [{ key: "username", label: "Store ID", render: (s) => h("b", {}, s.username) }, { key: "name", label: "Store" }, ...MAP_COLS,
      { key: "month_done", label: "This month", num: true, render: (s) => (s.total_staff ? `${s.month_done}/${s.total_staff}` : s.month_done) },
      { key: "evaluations", label: "All", num: true }, { key: "avg", label: "Average", num: true, render: (s) => avgCell(s.avg) }],
  });
  drawBy();
  return shell(h("div", {},
    pageHead("Dashboard", "How well your teams know the task outline."),
    h("div", { class: "grid g4" },
      h("div", { class: "kpi tealk" }, h("div", { class: "v" }, fmtPct(t.avg_pct)), h("div", { class: "l" }, "Average score (all evaluations)")),
      h("div", { class: "kpi" }, h("div", { class: "v" }, t.evaluations), h("div", { class: "l" }, `Evaluations completed · ${t.drafts} drafts`)),
      h("div", { class: "kpi tank" }, h("div", { class: "v" }, `${t.active_stores}/${t.stores}`), h("div", { class: "l" }, "Stores that have evaluated staff")),
      h("div", { class: "kpi" }, h("div", { class: "v" }, fmtPct(t.trained_pct)), h("div", { class: "l" }, "Tasks staff say they were trained on"))),
    h("div", { class: "grid g2", style: "margin-top:16px" },
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "By position"), bars(d.byPosition)),
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Weakest sections"), h("p", { class: "muted small" }, "Lowest “performed” rate across all stores."),
        d.weakest.length ? d.weakest.map((w) => h("div", { class: "secrow" }, h("div", {}, h("b", {}, w.section), h("div", { class: "small muted" }, w.position)), h("div", { class: `bar ${pctClass(w.pct)}` }, h("i", { style: `width:${w.pct}%` })), h("span", { class: `pct ${pctClass(w.pct)}` }, fmtPct(w.pct)))) : h("p", { class: "muted" }, "Needs a few more evaluations."))),
    h("div", { class: "card" }, h("h2", {}, "View by"), tabs, holder),
    h("div", { class: "card" }, h("h2", {}, "Stores"), h("p", { class: "muted small" }, "Click a column to sort, use the filters to narrow down, click a store to see its evaluations."), storeGrid.el)), "#/admin");
}

// ---------- admin: evaluations ----------
async function adminEvals(query) {
  const list = await api("/evals");
  const fromStore = query.get("store") && list.find((e) => String(e.store_id) === query.get("store"));
  const exportAll = () => {
    const rows = [["Store ID", "Store", "Area manager", "ROM", "Region", "City", "Position", "Staff", "Staff ID", "Evaluator", "Submitted", "Score", "Max", "Score %", "Training %"]];
    g.rows().filter((e) => e.status === "submitted").forEach((e) => rows.push([e.store_code, e.store_name, e.area_manager, e.rom, e.region, e.city, e.position_name, e.staff_name, e.staff_code || "", e.evaluator || "", e.submitted_at, e.score, e.max_score, pct(e.score, e.max_score), pct(e.trained_count, e.max_score)]));
    download(rows, `hm-evaluations-${new Date().toISOString().slice(0, 10)}.xlsx`, "Evaluations");
  };
  const data = list.map((e) => ({ ...e, store: `${e.store_code} · ${e.store_name}`, pctv: e.status === "submitted" ? pct(e.score, e.max_score) : null, when: e.submitted_at || e.created_at }));
  const removeEval = async (e) => {
    if (!(await confirmBox("Delete evaluation?", `${e.staff_name} · ${e.position_name} · ${e.store_code}. This permanently removes the evaluation and its answers.`, "Delete", true))) return;
    try { await api(`/evals/${e.id}`, { method: "DELETE" }); data.splice(data.indexOf(e), 1); g.setRows(data); toast("Evaluation deleted"); } catch (ex) { toast(ex.message); }
  };
  const g = grid({
    rows: data,
    searchIn: (e) => `${e.staff_name} ${e.staff_code || ""} ${e.store_code} ${e.store_name} ${e.area_manager} ${e.rom}`,
    filters: [{ key: "status", label: "statuses", show: (v) => (v === "draft" ? "Drafts" : "Submitted") }, { key: "position_name", label: "positions" }, ...MAP_FILTERS, { key: "store", label: "stores" }],
    initial: { status: "submitted", ...(fromStore ? { store: `${fromStore.store_code} · ${fromStore.store_name}` } : {}) },
    sort: { key: "when", dir: -1 }, onRow: (e) => (location.hash = `#/eval/${e.id}`), empty: "No evaluations match.",
    toolbar: [h("button", { class: "btn teal sm", onclick: exportAll }, "Export to Excel")],
    cols: [{ key: "staff_name", label: "Staff", render: (e) => h("span", {}, h("b", {}, e.staff_name), e.staff_code && h("div", { class: "small muted" }, e.staff_code)) },
      { key: "store", label: "Store", render: (e) => h("span", {}, h("b", {}, e.store_code), " ", e.store_name) }, { key: "position_name", label: "Position" }, ...MAP_COLS,
      { key: "when", label: "Date", render: (e) => fmtDate(e.when) },
      { key: "pctv", label: "Score", num: true, render: (e) => (e.status === "draft" ? h("span", { class: "chip warn" }, "Draft") : avgCell(e.pctv)) },
      { key: "trainpct", label: "Training", num: true, get: (e) => (e.status === "submitted" ? pct(e.trained_count, e.max_score) : null), render: (e) => h("span", { class: "muted" }, e.status === "submitted" ? fmtPct(pct(e.trained_count, e.max_score)) : "") },
      { key: "del", label: "", nosort: true, render: (e) => h("button", { class: "icon del", title: "Delete evaluation", "aria-label": `Delete evaluation of ${e.staff_name}`, onclick: (ev) => { ev.stopPropagation(); removeEval(e); } }, "🗑") }],
  });
  return shell(h("div", {}, pageHead("Evaluations", "Every evaluation submitted by the stores — sort and filter by store, area manager, ROM, region or city."), h("div", { class: "card" }, g.el)), "#/admin/evals");
}

// ---------- admin: questions ----------
async function adminQuestions(posId) {
  const positions = await api("/positions");
  if (!positions.length) return shell(h("div", {}, pageHead("Questions"), addPositionBox()), "#/admin/questions");
  const cur = positions.find((p) => p.id == posId) || positions[0];
  const tree = await api(`/positions/${cur.id}`);
  const run = guarded;

  const askText = (title, initial = "", multiline = false) => {
    const input = multiline ? h("textarea", { rows: 4, value: initial }) : h("input", { type: "text", value: initial });
    return modal(title, input, (close) => [h("button", { class: "btn ghost", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(input.value.trim() || null) }, "Save")]);
  };

  function itemRow(it) {
    const txt = h("div", { class: "txt", dir: "auto" }, it.text);
    return h("div", { class: `qe-item ${it.kind}-k` },
      it.kind !== "question" && h("span", { class: "kind" }, it.kind), txt,
      h("button", { class: "icon", title: "Edit", onclick: run(async () => { const v = await askText("Edit text", it.text, true); if (v) await api(`/admin/items/${it.id}`, { method: "PATCH", body: { text: v, kind: it.kind } }); else throw new Error("No changes"); }) }, "✎"),
      h("button", { class: "icon", title: "Move up", onclick: run(() => api(`/admin/items/${it.id}/move`, { method: "POST", body: { dir: "up" } })) }, "↑"),
      h("button", { class: "icon", title: "Move down", onclick: run(() => api(`/admin/items/${it.id}/move`, { method: "POST", body: { dir: "down" } })) }, "↓"),
      h("button", { class: "icon del", title: "Remove", onclick: run(async () => { if (!(await confirmBox("Remove this question?", "It disappears from new evaluations. Past results keep their answers.", "Remove", true))) throw new Error("Cancelled"); await api(`/admin/items/${it.id}`, { method: "DELETE" }); }) }, "✕"));
  }

  function sectionBox(s, idx) {
    const text = h("input", { type: "text", placeholder: "Add a question (Arabic or English)…" });
    const kind = h("select", {}, h("option", { value: "question" }, "Question"), h("option", { value: "heading" }, "Sub-heading"), h("option", { value: "note" }, "Note"));
    const add = run(async () => { if (!text.value.trim()) throw new Error("Type the question first"); await api(`/admin/sections/${s.id}/items`, { method: "POST", body: { kind: kind.value, text: text.value } }); });
    text.addEventListener("keydown", (e) => e.key === "Enter" && add());
    const n = s.items.filter((i) => i.kind === "question").length;
    return h("section", { class: "qe-sec" },
      h("header", {}, h("h3", {}, `${idx + 1}. ${s.title}`), h("span", { class: "muted small" }, `${n} question${n === 1 ? "" : "s"}`),
        h("button", { class: "icon", title: "Rename section", onclick: run(async () => { const v = await askText("Rename section", s.title); if (!v) throw new Error("No changes"); await api(`/admin/sections/${s.id}`, { method: "PATCH", body: { title: v } }); }) }, "✎"),
        h("button", { class: "icon", title: "Move up", onclick: run(() => api(`/admin/sections/${s.id}/move`, { method: "POST", body: { dir: "up" } })) }, "↑"),
        h("button", { class: "icon", title: "Move down", onclick: run(() => api(`/admin/sections/${s.id}/move`, { method: "POST", body: { dir: "down" } })) }, "↓"),
        h("button", { class: "icon del", title: "Remove section", onclick: run(async () => { if (!(await confirmBox("Remove this section?", `“${s.title}” and its ${n} questions will no longer appear in new evaluations.`, "Remove", true))) throw new Error("Cancelled"); await api(`/admin/sections/${s.id}`, { method: "DELETE" }); }) }, "✕")),
      s.items.map(itemRow),
      h("div", { class: "qe-add" }, kind, text, h("button", { class: "btn teal sm", onclick: add }, "+ Add")));
  }

  const addSection = h("input", { type: "text", placeholder: "New section title, e.g. “Food safety”", style: "max-width:360px" });
  const addSectionFn = run(async () => { if (!addSection.value.trim()) throw new Error("Type a section title"); await api(`/admin/positions/${cur.id}/sections`, { method: "POST", body: { title: addSection.value } }); });
  addSection.addEventListener("keydown", (e) => e.key === "Enter" && addSectionFn());

  return shell(h("div", {},
    pageHead("Questions", "Add, edit, reorder or remove questions. Changes apply to new evaluations straight away."),
    h("div", { class: "tabs" }, positions.map((p) => h("a", { class: "tab" + (p.id === cur.id ? " on" : ""), href: `#/admin/questions/${p.id}`, style: "text-decoration:none" }, `${p.name} (${p.questions})`)), addPositionBox()),
    h("div", { class: "row spread", style: "margin-bottom:12px" },
      h("h2", {}, `${cur.name} — ${cur.questions} questions`),
      h("div", { class: "row" },
        h("button", { class: "btn ghost sm", onclick: run(async () => { const v = await askText("Rename position", cur.name); if (!v) throw new Error("No changes"); await api(`/admin/positions/${cur.id}`, { method: "PATCH", body: { name: v } }); }) }, "Rename position"),
        h("button", { class: "btn danger sm", onclick: run(async () => { if (!(await confirmBox(`Remove “${cur.name}”?`, "The position disappears from new evaluations. Past results are kept.", "Remove", true))) throw new Error("Cancelled"); await api(`/admin/positions/${cur.id}`, { method: "DELETE" }); location.hash = "#/admin/questions"; }) }, "Remove position"))),
    tree.sections.map(sectionBox),
    h("div", { class: "card row" }, addSection, h("button", { class: "btn teal", onclick: addSectionFn }, "+ Add section"))), "#/admin/questions");
}

function addPositionBox() {
  return h("button", { class: "tab", style: "border-style:dashed", onclick: guarded(async () => {
    const input = h("input", { type: "text", placeholder: "e.g. Shift supervisor" });
    const name = await modal("New position", input, (close) => [h("button", { class: "btn ghost", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(input.value.trim() || null) }, "Create")]);
    if (!name) throw new Error("Cancelled");
    const r = await api("/admin/positions", { method: "POST", body: { name } });
    location.hash = `#/admin/questions/${r.id}`;
  }) }, "+ Position");
}

// ---------- admin: stores ----------
async function adminStores() {
  const loaded = await api("/admin/stores");
  const stores = loaded.stores;
  let passwords = null, show = false;
  const loginUrl = location.origin;
  const copy = (text, what = "Copied") => navigator.clipboard?.writeText(text).then(() => toast(what), () => toast("Copy failed"));

  const showBtn = h("button", { class: "btn ghost sm", onclick: async () => {
    show = !show;
    if (show && !passwords) { try { passwords = await api("/admin/stores/passwords"); } catch (e) { show = false; return toast(e.message); } }
    showBtn.textContent = show ? "🙈 Hide passwords" : "👁 Show passwords"; g.redraw();
  } }, "👁 Show passwords");

  const refresh = async () => { const y = scrollY; const r = await api("/admin/stores"); stores.splice(0, stores.length, ...r.stores); if (show) passwords = await api("/admin/stores/passwords"); g.setRows(stores); scrollTo(0, y); };

  async function resetPw(s) {
    const input = h("input", { type: "text", placeholder: "Leave empty for a random password", maxlength: 40 });
    const v = await modal(`Reset password — ${s.username}`, h("div", {}, h("p", { class: "muted small" }, `${s.name}. Anyone signed in with the old password is signed out.`), input),
      (close) => [h("button", { class: "btn ghost", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(input.value.trim() || "") }, "Reset")]);
    if (v === null) return;
    try {
      const r = await api(`/admin/stores/${s.id}/reset-password`, { method: "POST", body: v ? { password: v } : {} });
      passwords = { ...(passwords || (await api("/admin/stores/passwords"))), [s.id]: r.password };
      toast(`New password for ${s.username}: ${r.password}`);
      if (!show) showBtn.click(); else g.redraw();
    } catch (e) { toast(e.message); }
  }

  const credRows = (rows) => [["Store ID", "Store", "Password", "Area manager", "ROM", "Region", "City", "Total staff", "Login URL"],
    ...rows.map((s) => [s.username, s.name, passwords?.[s.id] ?? "", s.area_manager, s.rom, s.region, s.city, s.total_staff ?? "", loginUrl])];
  const downloadCreds = async () => {
    try { passwords = await api("/admin/stores/passwords"); download(credRows(g.rows()), `store-logins-${new Date().toISOString().slice(0, 10)}.xlsx`, "Stores"); }
    catch (e) { toast(e.message); }
  };

  const g = grid({
    rows: stores, sort: { key: "username", dir: 1 }, rowClass: (s) => (s.active ? "" : "off"), empty: "No stores yet — the weekly sync fills this list.",
    searchIn: (s) => `${s.username} ${s.name} ${s.area_manager || ""} ${s.rom || ""} ${s.region || ""} ${s.city || ""}`,
    filters: [...MAP_FILTERS, { key: "active", label: "statuses", get: (s) => (s.active ? "1" : "0"), show: (v) => (v === "1" ? "Active" : "Disabled") }],
    toolbar: [showBtn, h("button", { class: "btn teal sm", onclick: downloadCreds }, "Download logins (Excel)")],
    cols: [
      { key: "username", label: "Store ID", render: (s) => h("b", {}, s.username) },
      { key: "name", label: "Store", render: (s) => h("span", {}, s.name, !s.active && h("span", { class: "chip bad", style: "margin-left:8px" }, "Disabled")) },
      ...MAP_COLS,
      { key: "pw", label: "Password", nosort: true, cls: "mono", render: (s) => { const pw = passwords?.[s.id]; return show ? (pw ? h("button", { class: "pwcell", title: "Click to copy", onclick: () => copy(pw, `Password for ${s.username} copied`) }, pw) : h("span", { class: "muted" }, "—")) : "••••••"; } },
      { key: "total_staff", label: "Total staff", num: true, render: (s) => h("input", { type: "text", inputmode: "numeric", value: s.total_staff ?? "", placeholder: "—", style: "width:72px", "aria-label": `Total staff for ${s.name}`,
        onclick: (e) => e.stopPropagation(),
        onchange: async (e) => { try { await api(`/admin/stores/${s.id}`, { method: "PATCH", body: { total_staff: e.target.value.trim() } }); s.total_staff = e.target.value.trim() === "" ? null : +e.target.value; toast("Saved"); } catch (ex) { toast(ex.message); e.target.value = s.total_staff ?? ""; } } }) },
      { key: "month_done", label: "This month", num: true, render: (s) => (s.total_staff ? h("span", { class: `pct ${pctClass(pct(s.month_done, s.total_staff))}` }, `${s.month_done}/${s.total_staff}`) : h("span", { class: "muted" }, s.month_done)) },
      { key: "actions", label: "", nosort: true, render: (s) => h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end" },
        h("button", { class: "btn ghost sm", onclick: () => resetPw(s) }, "🔑 Reset"),
        h("button", { class: "btn ghost sm", onclick: async () => { try { await api(`/admin/stores/${s.id}`, { method: "PATCH", body: { active: !s.active } }); await refresh(); } catch (e) { toast(e.message); } } }, s.active ? "Disable" : "Enable"),
        h("button", { class: "icon del", title: "Delete store", "aria-label": `Delete ${s.name}`, onclick: async () => { if (!(await confirmBox("Delete store?", `${s.username} · ${s.name} will be removed. Stores with evaluations can only be disabled.`, "Delete", true))) return; try { await api(`/admin/stores/${s.id}`, { method: "DELETE" }); await refresh(); } catch (e) { toast(e.message); } } }, "🗑")) },
    ],
  });

  const ls = loaded.lastSync;
  return shell(h("div", {},
    pageHead("Stores", "Stores, area managers, ROMs, regions and cities come from the AM & ROM Mapping file. The Store ID is the login; you control every password."),
    h("div", { class: "card" },
      h("div", { class: "row spread small muted", style: "margin-bottom:12px" },
        h("span", {}, ls ? `Synced weekly from “AM & ROM Mapping” · last sync ${fmtDate(ls.at)} · ${ls.total} stores` : "Waiting for the first sync from “AM & ROM Mapping”."),
        h("span", { class: "row" }, `Sign-in page: ${loginUrl}`, h("button", { class: "btn ghost sm", onclick: () => copy(loginUrl, "Link copied") }, "Copy"))),
      g.el)), "#/admin/stores");
}

// ---------- router ----------
async function renderRoute() {
  const slow = setTimeout(() => document.body.classList.add("loading"), 150);   // thin progress bar only if it takes a moment
  try { await renderRouteInner(); } finally { clearTimeout(slow); document.body.classList.remove("loading"); }
}
async function renderRouteInner() {
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const query = new URLSearchParams(qs || "");
  let m, view;
  try {
    if (session.role === "admin") {
      if (path === "/admin" || path === "/") view = await adminHome();
      else if (path === "/admin/evals") view = await adminEvals(query);
      else if ((m = path.match(/^\/admin\/questions(?:\/(\d+))?$/))) view = await adminQuestions(m[1]);
      else if (path === "/admin/stores") view = await adminStores();
      else if ((m = path.match(/^\/eval\/(\d+)$/))) view = await evalRoute(m[1]);
      else view = await adminHome();
    } else {
      if (path === "/new") view = await newEvalView();
      else if ((m = path.match(/^\/eval\/(\d+)$/))) view = await evalRoute(m[1]);
      else view = await storeHome();
    }
  } catch (e) {
    if (!session.role) return;
    view = shell(h("div", { class: "card" }, h("h2", {}, "Something went wrong"), h("p", { class: "err" }, e.message), h("a", { class: "btn ghost", href: "#/" }, "Home")));
  }
  $app.replaceChildren(view);
  window.scrollTo(0, 0);
}

function render() { session.role ? renderRoute() : $app.replaceChildren(loginView()); }
window.addEventListener("hashchange", () => session.role && renderRoute());
api("/me").then((s) => { session = s; render(); }).catch(() => render());
