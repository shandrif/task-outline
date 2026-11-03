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
const fmtDateTime = (s) => (s ? new Date(s.replace(" ", "T") + "Z").toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const daysSince = (s) => (s ? Math.floor((Date.now() - new Date(s.replace(" ", "T") + "Z")) / 864e5) : null);

// ---- liquid navbar (React island, loaded after first paint; plain links are the fallback) ----
const NAV_KEYS = { "#/home": "dashboard", "#/m/onboarding": "onboarding", "#/m/npd": "npd", "#/admin": "evaluations", "#/verify": "evaluations", "#/sv": "visits", "#/m/coaching": "coaching", "#/m/development": "growth" };
let navHost = null, navApi = null, navRole = null, navLinks = [];
function syncNav(links, activeIdx) {
  navLinks = links;
  const opts = { items: links.map(([href, label]) => ({ label, key: NAV_KEYS[href] })), active: activeIdx, onChange: (i) => { location.hash = navLinks[i][0]; } };
  if (navHost && navRole !== session.role) { navApi = null; navHost = null; }     // different user: rebuild
  if (!navHost) {
    navHost = h("div", { class: "nav-host" }); navRole = session.role;
    const start = () => { if (window.HMNav && !navApi) { navApi = window.HMNav.mount(navHost, opts); document.body.classList.add("nav-live"); } };
    if (window.HMNav) start();
    else { const el = document.createElement("script"); el.src = "/nav.js"; el.async = true; el.onload = start; document.head.append(el); }
  } else if (navApi) navApi.setOptions(opts);
  return navHost;
}

const VERIFY_SUB = new Set(["#/admin", "#/admin/trainers", "#/admin/visits", "#/admin/stores", "#/admin/questions", "#/verify", "#/visit/new"]);
function shell(content, active) {
  const admin = session.role === "admin";
  if (active === "#/") active = "#/verify";
  const ver = admin ? "#/admin" : "#/verify";
  const links = [["#/home", "Dashboard"], ["#/m/onboarding", "Onboarding"], ["#/m/npd", "NPD"], [ver, "Verification"], ["#/sv", "Store visit"], ["#/m/coaching", "Coaching"], ["#/m/development", "People dev"]];
  const inVerify = VERIFY_SUB.has(active);
  const idx = Math.max(0, links.findIndex(([href]) => href === (inVerify ? ver : active)));
  const sub = inVerify ? (admin
    ? [["#/admin", "Dashboard"], ["#/admin/trainers", "Trainers"], ["#/admin/visits", "Visits"], ["#/admin/stores", "Stores"], ["#/admin/questions", "Questions"]]
    : [["#/verify", "My visits"], ["#/visit/new", "New visit"]]) : null;
  return h("div", {},
    h("header", { class: "top no-print" }, h("div", { class: "top-in" },
      h("a", { class: "brand", href: "#/home" }, logo(), h("div", {}, h("b", {}, "Staff Knowledge", h("br"), "Evaluation"), h("i"))),
      h("nav", { class: "nav" }, links.map(([href, label]) => h("a", { href, class: idx === links.findIndex((l) => l[0] === href) ? "on" : "" }, label))),
      syncNav(links, idx),
      h("div", { class: "who" }, h("b", {}, admin ? "Admin" : session.trainer.name), !admin && h("div", { class: "small muted" }, session.trainer.designation),
        h("a", { href: "#", class: "muted", onclick: async (e) => { e.preventDefault(); await api("/logout", { method: "POST", body: {} }); session = { role: null }; navHost = null; navApi = null; document.body.classList.remove("nav-live"); cache.clear(); location.hash = ""; render(); } }, "Sign out")))),
    h("main", {}, sub && h("nav", { class: "subnav no-print", "aria-label": "Verification sections" }, h("span", { class: "small muted" }, "Verification"), sub.map(([href, label]) => h("a", { href, class: active === href ? "on" : "" }, label))), content));
}

function pageHead(title, sub, ...right) {
  return h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub && h("p", {}, sub), h("div", { class: "tan-bar" })), h("div", { class: "row no-print" }, right));
}

// ---------- sign in / create trainer account ----------
function loginView(initial = "in", prefill = "", notice = "") {
  const wrap = h("div", { class: "login" });
  const card = h("div", { class: "card login-card" });
  wrap.append(card);
  const field = (label, input, hint) => h("div", { class: "field" }, h("label", {}, label), input, hint && h("div", { class: "small muted", style: "margin-top:4px" }, hint));

  function signIn() {
    const err = h("div", { class: "err hidden" });
    const user = h("input", { type: "text", autocomplete: "username", autocapitalize: "none", required: true, value: prefill, placeholder: "e.g. HM1234" });
    const pass = h("input", { type: "password", autocomplete: "current-password", required: true });
    const btn = h("button", { class: "btn teal", style: "width:100%;justify-content:center" }, "Sign in");
    return h("form", { class: "stack", onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.classList.add("hidden");
      try {
        await api("/login", { method: "POST", body: { username: user.value.trim(), password: pass.value } });
        session = await api("/me"); location.hash = "#/home"; render();
      } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); btn.disabled = false; }
    } }, notice && h("div", { class: "ok" }, notice), field("Employee ID", user), field("Password", pass), err, btn,
      h("p", { class: "small muted", style: "margin:0" }, "Admin? Sign in with the admin username."));
  }

  function signUp() {
    const err = h("div", { class: "err hidden" });
    const name = h("input", { type: "text", autocomplete: "name", maxlength: 80, required: true });
    const eid = h("input", { type: "text", autocapitalize: "none", maxlength: 30, required: true, placeholder: "e.g. HM1234" });
    const des = h("input", { type: "text", maxlength: 60, required: true, autocomplete: "off", placeholder: "Type your designation" });
    const pw = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 });
    const pw2 = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 });
    const btn = h("button", { class: "btn teal", style: "width:100%;justify-content:center" }, "Sign up");
    return h("form", { class: "stack", onsubmit: async (e) => {
      e.preventDefault(); err.classList.add("hidden");
      if (pw.value !== pw2.value) { err.textContent = "The two passwords don't match"; err.classList.remove("hidden"); return; }
      btn.disabled = true;
      try {
        await api("/signup", { method: "POST", body: { name: name.value, employee_id: eid.value.trim(), designation: des.value, password: pw.value } });
        card.replaceChildren(...cardBody("in", eid.value.trim(), "Account created. An admin needs to approve it before you can sign in."));
      } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); btn.disabled = false; }
    } },
      field("Full name", name), field("Employee ID", eid, "You will sign in with this"), field("Designation", des),
      field("Create a password", pw, "At least 8 characters, with a letter and a number"), field("Confirm password", pw2), err, btn);
  }

  function cardBody(tab, pre = "", note = "") {
    prefill = pre || prefill; notice = note;
    return [
      h("img", { class: "logo", src: "/logo.png", alt: "½M" }),
      h("h1", {}, "Staff Knowledge Evaluation"), h("div", { class: "tan-bar" }),
      h("div", { class: "tabs", style: "margin:16px 0 14px" },
        h("button", { type: "button", class: "tab" + (tab === "in" ? " on" : ""), onclick: () => card.replaceChildren(...cardBody("in")) }, "Sign in"),
        h("button", { type: "button", class: "tab" + (tab === "up" ? " on" : ""), onclick: () => card.replaceChildren(...cardBody("up")) }, "Sign up")),
      tab === "in" ? signIn() : signUp(),
    ];
  }
  card.replaceChildren(...cardBody(initial));
  return wrap;
}

// ---------- trainer: my visits ----------
const statusChip = (v) => (v.status === "open" ? h("span", { class: "chip warn" }, "Open") : h("span", { class: "chip good" }, "Completed"));

async function trainerHome() {
  const [visits, my] = await Promise.all([api("/visits"), api("/my/stats")]);
  (window.requestIdleCallback || setTimeout)(() => { cachedGet("/positions").catch(() => {}); cachedGet("/stores", 20000).catch(() => {}); });   // warm the next screens
  const stores = my.stores, evals = my.evaluations;
  const avg = pct(my.sum_score, my.sum_max);
  const open = visits.filter((v) => v.status === "open");
  const g = grid({
    rows: visits.map((v) => ({ ...v, store: `${v.store_code} · ${v.store_name}`, avg: v.sum_max ? pct(v.sum_score, v.sum_max) : null })),
    searchIn: (v) => `${v.store_code} ${v.store_name} ${v.city || ""} ${v.area_manager || ""}`,
    filters: [{ key: "status", label: "statuses", show: (x) => (x === "open" ? "Open" : "Completed") }, { key: "city", label: "cities" }],
    sort: { key: "started_at", dir: -1 }, onRow: (v) => (location.hash = `#/visit/${v.id}`), empty: "No visits yet. Start your first one with “Start store visit”.",
    toolbar: visits.length >= 60 ? [h("button", { class: "btn ghost sm", onclick: async (e) => { e.target.disabled = true; const all = await api("/visits?all=1"); g.setRows(all.map((v) => ({ ...v, store: `${v.store_code} · ${v.store_name}`, avg: v.sum_max ? pct(v.sum_score, v.sum_max) : null }))); e.target.remove(); } }, "Show older visits")] : [],
    cols: [{ key: "started_at", label: "Date", render: (v) => fmtDateTime(v.started_at) }, { key: "store", label: "Store", render: (v) => h("span", {}, h("b", {}, v.store_code), " ", v.store_name) },
      { key: "city", label: "City" }, { key: "evals", label: "Staff evaluated", num: true }, { key: "avg", label: "Average", num: true, render: (v) => avgCell(v.avg) }, { key: "status", label: "Status", render: statusChip }],
  });
  return shell(h("div", {},
    pageHead(`Hello, ${session.trainer.name.split(" ")[0]}`, "Visit a store, evaluate the team, and note what needs more training.", h("a", { class: "btn teal", href: "#/visit/new" }, "+ Start store visit")),
    h("div", { class: "grid g4", style: "margin-bottom:16px" },
      h("div", { class: "kpi tealk" }, h("div", { class: "v" }, my.visits), h("div", { class: "l" }, "Store visits · last 30 days")),
      h("div", { class: "kpi" }, h("div", { class: "v" }, stores), h("div", { class: "l" }, "Different stores · last 30 days")),
      h("div", { class: "kpi tank" }, h("div", { class: "v" }, evals), h("div", { class: "l" }, "Staff evaluations · last 30 days")),
      h("div", { class: "kpi" }, h("div", { class: "v" }, fmtPct(avg)), h("div", { class: "l" }, "Average score · last 30 days"))),
    open.length > 0 && h("div", { class: "card" }, h("h2", {}, "Continue where you left off"),
      h("div", { class: "grid g3", style: "margin-top:12px" }, open.map((v) => h("a", { class: "pos-card", href: `#/visit/${v.id}`, style: "text-decoration:none;color:inherit" },
        h("b", {}, v.store_name), h("span", {}, `${v.store_code} · ${v.city || ""} · started ${fmtDateTime(v.started_at)}`))))),
    h("div", { class: "card" }, h("h2", {}, visits.length >= 60 ? "My latest visits" : "My visits"), g.el)), "#/");
}

// ---------- trainer: start a visit (store picker) ----------
async function newVisitView() {
  const stores = await cachedGet("/stores", 20000);
  const input = h("input", { type: "search", class: "pick-search", placeholder: "Search store name, ID, city or area manager…", autocomplete: "off", "aria-label": "Search stores" });
  const list = h("div", { class: "pick-list" });
  let busy = false;
  const start = async (s) => {
    if (busy) return; busy = true;
    try { const r = await api("/visits", { method: "POST", body: { store_id: s.id } }); cache.delete("/stores"); if (r.existing) toast("Continuing your open visit to this store"); location.hash = `#/visit/${r.id}`; }
    catch (e) { toast(e.message); busy = false; }
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const hits = stores.filter((s) => !q || `${s.code} ${s.name} ${s.city || ""} ${s.region || ""} ${s.area_manager || ""} ${s.rom || ""}`.toLowerCase().includes(q));
    list.replaceChildren(...[...hits.slice(0, 60).map((s) => h("button", { type: "button", class: "pick", onclick: () => start(s) },
      h("div", {}, h("b", {}, s.name), h("div", { class: "small muted" }, [s.code, s.city, s.area_manager].filter(Boolean).join(" · "))),
      s.my_visits ? h("span", { class: "chip" }, `Visited ${s.my_visits}× · last ${fmtDate(s.my_last_visit)}`) : h("span", { class: "chip warn" }, "Not visited yet"))),
      hits.length > 60 && h("p", { class: "muted small", style: "padding:10px" }, `Showing 60 of ${hits.length}. Type more to narrow down.`),
      !hits.length && h("p", { class: "muted", style: "padding:10px" }, "No store matches. Ask the admin to add it.")].filter(Boolean));
  };
  input.addEventListener("input", draw); draw();
  const view = shell(h("div", {}, pageHead("Start store visit", "Which store are you visiting?"), h("div", { class: "card" }, input, list)), "#/visit/new");
  setTimeout(() => input.focus(), 50);
  return view;
}

// ---------- visit page (trainer works here; admin can view) ----------
async function visitView(id) {
  const [{ visit: v, evaluations, staff }, positions] = await Promise.all([api(`/visits/${id}`), cachedGet("/positions")]);
  const isTrainer = session.role === "trainer", open = v.status === "open", canWork = isTrainer && open;
  const submitted = evaluations.filter((e) => e.status === "submitted");
  const avg = pct(v.sum_score, v.sum_max);
  const back = isTrainer ? "#/verify" : "#/admin/visits";

  // --- add a staff member (open visit only) ---
  let pos = null;
  const name = h("input", { type: "text", maxlength: 100, required: true, placeholder: "Staff name", list: "staff-names", autocomplete: "off" });
  const code = h("input", { type: "text", maxlength: 40, placeholder: "Optional" });
  const go = h("button", { class: "btn teal", disabled: true }, "Start evaluation");
  const err = h("div", { class: "err hidden" });
  const cards = positions.map((p) => {
    const c = h("button", { type: "button", class: "pos-card", onclick: () => select(p) }, h("b", {}, p.name), h("span", {}, `${p.questions} questions`));
    c.pid = p.id; return c;
  });
  const select = (p) => { pos = p; cards.forEach((x) => x.classList.toggle("on", x.pid === p.id)); go.disabled = !name.value.trim(); };
  name.addEventListener("input", () => {
    go.disabled = !pos || !name.value.trim();
    const known = staff.find((s) => s.name.toLowerCase() === name.value.trim().toLowerCase());
    if (known) { if (!code.value && known.code) code.value = known.code; const p = positions.find((x) => x.id === known.position_id); if (p && !pos) select(p); }
  });
  const addForm = h("form", { onsubmit: async (e) => {
    e.preventDefault(); err.classList.add("hidden"); go.disabled = true;
    try { const r = await api("/evals", { method: "POST", body: { visit_id: v.id, position_id: pos.id, staff_name: name.value, staff_code: code.value } }); location.hash = `#/eval/${r.id}`; }
    catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); go.disabled = false; }
  } },
    h("datalist", { id: "staff-names" }, [...new Set(staff.map((s) => s.name))].map((n) => h("option", { value: n }))),
    h("div", { class: "grid g3" }, h("div", {}, h("label", {}, "Staff name *"), name), h("div", {}, h("label", {}, "Staff ID"), code)),
    h("label", { style: "margin-top:14px" }, "Position (designation) *"), h("div", { class: "grid g3" }, cards),
    h("div", { class: "stack", style: "margin-top:14px" }, err, go));

  // --- notes + follow-up ---
  const notes = h("textarea", { rows: 4, maxlength: 3000, placeholder: "Overall notes for this visit: what you saw, what training is needed, who to follow up with…", value: v.notes || "", disabled: !isTrainer });
  const fu = h("input", { type: "checkbox", checked: !!v.follow_up, disabled: !isTrainer });
  const fuDate = h("input", { type: "date", value: v.follow_up_date || "", disabled: !isTrainer, style: "width:auto" });
  const saveNotes = async () => { try { await api(`/visits/${v.id}`, { method: "PATCH", body: { notes: notes.value, follow_up: fu.checked, follow_up_date: fuDate.value } }); toast("Saved"); } catch (e) { toast(e.message); } };

  const finish = async () => {
    if (!(await confirmBox("Finish this visit?", submitted.length ? `${submitted.length} staff evaluation${submitted.length === 1 ? "" : "s"} will be saved with this visit.` : "No staff were evaluated in this visit. It will still count as a visit to this store.", "Finish visit"))) return;
    try { await api(`/visits/${v.id}/finish`, { method: "POST", body: { notes: notes.value, follow_up: fu.checked, follow_up_date: fuDate.value } }); cache.delete("/stores"); toast("Visit finished"); renderRoute(); }
    catch (e) { toast(e.message); }
  };
  const removeVisit = async () => {
    if (!(await confirmBox("Delete this visit?", "The visit and all its evaluations will be removed permanently.", "Delete", true))) return;
    try { await api(`/visits/${v.id}`, { method: "DELETE" }); cache.delete("/stores"); location.hash = back; } catch (e) { toast(e.message); }
  };

  const rows = h("div", { class: "table-wrap" }, evaluations.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Staff", "Position", "Result", ""].map((x) => h("th", {}, x)))),
    h("tbody", {}, evaluations.map((e) => h("tr", { class: "click", onclick: () => (location.hash = `#/eval/${e.id}`) },
      h("td", {}, h("b", {}, e.staff_name), e.staff_code && h("div", { class: "small muted" }, e.staff_code)), h("td", {}, e.position_name),
      h("td", {}, e.status === "draft" ? h("span", { class: "chip warn" }, isTrainer ? "Draft — continue" : "Draft") : avgCell(pct(e.score, e.max_score))),
      h("td", { style: "text-align:right" }, e.status === "draft" && isTrainer && h("button", { class: "icon del", title: "Delete draft", "aria-label": `Delete draft for ${e.staff_name}`, onclick: async (ev) => { ev.stopPropagation(); if (await confirmBox("Delete this draft?", `${e.staff_name} — all answers so far will be lost.`, "Delete", true)) { await api(`/evals/${e.id}`, { method: "DELETE" }); renderRoute(); } } }, "🗑"))))))
    : h("p", { class: "muted" }, canWork ? "No staff evaluated yet. Add the first one below." : "No staff evaluated in this visit."));

  return shell(h("div", {},
    pageHead(v.store_name, `${[v.store_code, v.city, v.area_manager && "AM " + v.area_manager, v.rom && "ROM " + v.rom].filter(Boolean).join(" · ")} — visit by ${v.trainer_name} · ${fmtDateTime(v.started_at)}`,
      h("a", { class: "btn ghost sm", href: back }, "← Back"), statusChip(v),
      (isTrainer ? !submitted.length : true) && h("button", { class: "btn danger sm", onclick: removeVisit }, "Delete visit")),
    h("div", { class: "grid g3", style: "margin-bottom:16px" },
      h("div", { class: "kpi tealk" }, h("div", { class: "v" }, v.staff || 0), h("div", { class: "l" }, "Staff evaluated")),
      h("div", { class: "kpi" }, h("div", { class: "v" }, fmtPct(avg)), h("div", { class: "l" }, "Average score in this visit")),
      h("div", { class: "kpi tank" }, h("div", { class: "v" }, v.drafts || 0), h("div", { class: "l" }, "Unsubmitted evaluations"))),
    h("div", { class: "card" }, h("h2", {}, "Staff evaluated in this visit"), rows),
    canWork && h("div", { class: "card" }, h("h2", {}, "Evaluate a staff member"), h("p", { class: "muted small", style: "margin:4px 0 14px" }, "Pick their position — the questions match it. You can evaluate as many people as you need."), addForm),
    h("div", { class: "card" }, h("h2", {}, "Visit notes"),
      h("div", { class: "stack", style: "margin-top:10px" }, notes,
        h("label", { class: "row", style: "font-weight:700" }, fu, "Follow-up needed", fuDate),
        isTrainer && h("div", { class: "row" }, h("button", { class: "btn ghost sm", onclick: saveNotes }, "Save notes")))),
    canWork && h("div", { class: "row", style: "justify-content:flex-end;margin-top:8px" }, h("button", { class: "btn teal", onclick: finish }, "Finish visit")),
    isTrainer && !open && h("div", { class: "row", style: "justify-content:flex-end;margin-top:8px" }, h("a", { class: "btn teal", href: "#/visit/new" }, "Start another visit"))),
    isTrainer ? "#/" : "#/admin/visits");
}

// ---------- evaluation: fill-in form ----------
// Section bodies are built on first open and clicks are handled by one delegated listener per section,
// so a 31-section / 208-question evaluation stays light on phones.
async function evalForm(ev) {
  const dirty = new Map();          // item_id -> {trained, performed}
  let skipDirty = false, timer = null, saving = false;
  const skip = new Set(ev.sections.filter((s) => s.skipped).map((s) => s.id));
  const state = h("span", { class: "savestate", "aria-live": "polite" }, "All changes saved");
  let notesDirty = false;
  const notes = h("textarea", { rows: 4, maxlength: 2000, placeholder: "What should this person improve? Which training do they need? (optional, but very useful)", value: ev.improvement_notes || "", oninput: () => { notesDirty = true; schedule(); } });

  async function flush() {
    if (saving || (!dirty.size && !skipDirty && !notesDirty)) return;
    saving = true; state.textContent = "Saving…";
    const answers = [...dirty].map(([item_id, a]) => ({ item_id, ...a })); dirty.clear();
    const sendSkip = skipDirty; skipDirty = false;
    const sendNotes = notesDirty; notesDirty = false;
    try {
      await api(`/evals/${ev.id}/answers`, { method: "PUT", body: { answers, ...(sendSkip ? { skip: [...skip] } : {}), ...(sendNotes ? { improvement_notes: notes.value } : {}) } });
      state.textContent = "All changes saved";
    } catch (e) {
      answers.forEach((a) => dirty.set(a.item_id, { trained: a.trained, performed: a.performed })); skipDirty ||= sendSkip; notesDirty ||= sendNotes;
      state.textContent = "Not saved — check connection";
    }
    saving = false;
    if (dirty.size || skipDirty || notesDirty) schedule();
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
    try { await api(`/evals/${ev.id}/submit`, { method: "POST", body: { improvement_notes: notes.value } }); toast("Evaluation submitted"); renderRoute(); }
    catch (e) { toast(e.message); submitBtns.forEach((b) => (b.disabled = false)); }
  };
  const submitBtns = [h("button", { class: "btn teal", onclick: doSubmit }, "Submit evaluation"), h("button", { class: "btn teal", onclick: doSubmit }, "Submit evaluation")];

  const del = h("button", { class: "btn danger sm", onclick: async () => {
    if (!(await confirmBox("Delete this draft?", "All answers entered so far will be lost.", "Delete", true))) return;
    await api(`/evals/${ev.id}`, { method: "DELETE" }); location.hash = `#/visit/${ev.visit_id}`;
  } }, "Delete draft");

  const bar = h("div", { class: "evbar no-print" },
    h("div", { class: "row spread" }, h("div", {}, h("b", {}, ev.staff_name), " · ", ev.position_name), h("div", { class: "row" }, state, submitBtns[0])),
    h("div", { class: "prog row spread" }, h("div", { style: "flex:1" }, overall), overallTxt), scoreTxt);

  // Expand/collapse all: build a few sections per frame so the page never freezes
  const allOpen = h("button", { class: "btn ghost sm", onclick: async () => {
    const vis = refs.filter((r) => !r.el.hidden), open = vis.some((r) => !r.el.classList.contains("open"));
    for (let i = 0; i < vis.length; i += 3) { vis.slice(i, i + 3).forEach((r) => toggleSection(r, open)); if (open) await new Promise(requestAnimationFrame); }
  } }, "Expand / collapse all");

  const found = h("span", { class: "muted small" });
  const finder = refs.length > 10 && h("div", { class: "card no-print", style: "padding:12px 16px" }, h("div", { class: "row", style: "flex-wrap:nowrap" },
    h("input", { type: "search", class: "flt-search", style: "flex:1;max-width:none", placeholder: "Search drinks or sections…", "aria-label": "Search drinks or sections", oninput: (e) => {
      const q = e.target.value.trim().toLowerCase(); const hits = [];
      for (const r of refs) { const hit = !q || r.sec.title.toLowerCase().includes(q) || r.sec.items.some((i) => i.text.toLowerCase().includes(q)); r.el.hidden = !hit; if (hit) hits.push(r); }
      found.textContent = q ? `${hits.length} of ${refs.length} sections` : "";
      if (q && hits.length <= 2) hits.forEach((r) => toggleSection(r, true));
    } }), found));
  window.addEventListener("beforeunload", () => { if (dirty.size) flush(); }, { once: true });
  return shell(h("div", {},
    pageHead(`Evaluating ${ev.staff_name}`, `${ev.position_name}${ev.staff_code ? " · ID " + ev.staff_code : ""} · ${ev.store_name}. Answers save automatically.`, h("a", { class: "btn ghost sm", href: `#/visit/${ev.visit_id}` }, "← Visit"), allOpen, del),
    bar, finder, secEls,
    h("div", { class: "card no-print" }, h("h2", {}, "Areas for improvement"), h("p", { class: "muted small", style: "margin:4px 0 10px" }, "Note what this person should work on and any training they need. It appears on their result and in the admin reports."), notes),
    h("div", { class: "row no-print", style: "justify-content:flex-end;margin-top:8px" }, submitBtns[1])), "#/");
}

// ---------- evaluation: result ----------
function evalResult(ev) {
  const secs = ev.sections.filter((s) => !s.skipped);
  const score = ev.score, max = ev.max_score, p = pct(score, max), tp = pct(ev.trained_count, max);
  const gaps = [], untrained = [];
  for (const s of secs) for (const q of s.items) if (q.kind === "question") { if (q.performed === 0) gaps.push([s.title, q.text]); if (q.trained === 0) untrained.push([s.title, q.text]); }
  const list = (arr) => arr.length ? h("ul", { class: "gap-list" }, arr.slice(0, 40).map(([s, t]) => h("li", {}, h("b", {}, s + ": "), t.length > 140 ? t.slice(0, 140) + "…" : t)), arr.length > 40 && h("li", { class: "muted" }, `…and ${arr.length - 40} more`)) : h("p", { class: "muted" }, "None 🎉");
  const exportXlsx = () => {
    const rows = [["Store", `${ev.store_code} · ${ev.store_name}`], ["Trainer", `${ev.trainer_name || ""} (${ev.trainer_employee_id || ""})`], ["Staff", ev.staff_name], ["Position", ev.position_name], ["Date", ev.submitted_at], [],
      ["Section", "Task", "Received training", "Performed"]];
    for (const s of ev.sections) { if (s.skipped) { rows.push([s.title, "(not applicable)", "", ""]); continue; } for (const q of s.items) if (q.kind === "question") rows.push([s.title, q.text, q.trained ? "Yes" : "No", q.performed ? "Yes" : "No"]); }
    rows.push([], ["Overall score", `${score}/${max}`, `${p}%`], ["Areas for improvement", ev.improvement_notes || ""]);
    download(rows, `evaluation-${ev.staff_name.replace(/\W+/g, "_")}-${ev.id}.xlsx`, "Evaluation");
  };
  const isAdmin = session.role === "admin";
  const visitHref = `#/visit/${ev.visit_id}`;
  return shell(h("div", {},
    pageHead(ev.staff_name, `${ev.position_name} · ${ev.store_name} (${ev.store_code}) · ${fmtDate(ev.submitted_at)}${ev.trainer_name ? " · trainer " + ev.trainer_name : ""}`,
      h("a", { class: "btn ghost sm", href: visitHref }, "← Back to visit"),
      h("button", { class: "btn ghost sm", onclick: () => window.print() }, "Print"),
      h("button", { class: "btn teal sm", onclick: exportXlsx }, "Download Excel"),
      isAdmin && h("button", { class: "btn danger sm", onclick: async () => { if (await confirmBox("Delete evaluation?", "This permanently removes the evaluation and its answers.", "Delete", true)) { await api(`/evals/${ev.id}`, { method: "DELETE" }); location.hash = visitHref; } } }, "Delete")),
    h("div", { class: "grid g3", style: "margin-bottom:16px" },
      h("div", { class: "kpi tealk" }, h("div", { class: "score-ring" }, fmtPct(p)), h("div", { class: "l" }, `Overall score · ${score}/${max} tasks performed`)),
      h("div", { class: "kpi" }, h("div", { class: "score-ring" }, fmtPct(tp)), h("div", { class: "l" }, `Received training · ${ev.trained_count}/${max}`)),
      h("div", { class: "kpi tank" }, h("div", { class: "score-ring" }, gaps.length), h("div", { class: "l" }, "Tasks not performed correctly"))),
    ev.improvement_notes && h("div", { class: "card" }, h("h2", {}, "Areas for improvement"), h("p", { style: "white-space:pre-wrap;margin:8px 0 0" }, ev.improvement_notes)),
    h("div", { class: "card" }, h("h2", { style: "margin-bottom:8px" }, "Score by section"),
      ev.sections.map((s) => { const sp = pct(s.score, s.max); return h("div", { class: "secrow" },
        h("b", {}, s.title),
        s.skipped ? h("span", { class: "muted" }, "Not applicable") : h("div", { class: `bar ${pctClass(sp)}` }, h("i", { style: `width:${sp}%` })),
        s.skipped ? "" : h("span", { class: `pct ${pctClass(sp)}` }, `${s.score}/${s.max}`)); })),
    h("div", { class: "grid g2", style: "margin-top:16px" },
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Needs coaching"), h("p", { class: "muted small" }, "Tasks marked “Performed: No”."), list(gaps)),
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Training gaps"), h("p", { class: "muted small" }, "Tasks marked “Received training: No”."), list(untrained))),
    !isAdmin && ev.visit_status === "open" && h("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" }, h("a", { class: "btn teal", href: visitHref }, "Evaluate another staff member"))),
    isAdmin ? "#/admin/visits" : "#/");
}

async function evalRoute(id) {
  const ev = await api(`/evals/${id}`);
  if (ev.status === "draft") {
    if (session.role === "trainer") return evalForm(ev);
    return shell(h("div", { class: "card" }, h("p", {}, "This evaluation is still a draft."), h("a", { class: "btn ghost", href: `#/visit/${ev.visit_id}` }, "Back to visit")), "#/admin/visits");
  }
  return evalResult(ev);
}

// ---------- admin: shared period filter ----------
const range = { preset: "30", from: "", to: "" };   // default: last 30 days (keeps the reports fast and cheap as data grows)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const utc = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const rq = (extra = "") => {
  const p = new URLSearchParams(extra);
  if (range.from) p.set("from", utc(new Date(`${range.from}T00:00:00`)));                                   // local midnight, as UTC
  if (range.to) { const d = new Date(`${range.to}T00:00:00`); d.setDate(d.getDate() + 1); p.set("to", utc(d)); }   // up to the end of that local day
  const s = p.toString(); return s ? "?" + s : "";
};
function setPreset(p) {
  const t = new Date(), ago = (n) => { const x = new Date(t); x.setDate(x.getDate() - n); return ymd(x); };
  range.preset = p;
  if (p === "all") range.from = range.to = "";
  else if (p === "today") range.from = range.to = ymd(t);
  else if (p === "7") { range.from = ago(6); range.to = ymd(t); }
  else if (p === "30") { range.from = ago(29); range.to = ymd(t); }
  else if (p === "month") { range.from = ymd(new Date(t.getFullYear(), t.getMonth(), 1)); range.to = ymd(t); }
}
setPreset("30");
function rangeBar() {
  const sel = h("select", { class: "flt", "aria-label": "Period", onchange: (e) => { if (e.target.value === "custom") range.preset = "custom"; else setPreset(e.target.value); renderRoute(); } },
    [["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["month", "This month"], ["custom", "Custom range"]].map(([v, l]) => h("option", { value: v, selected: range.preset === v }, l)));
  const date = (key) => h("input", { type: "date", class: "flt", value: range[key], "aria-label": key === "from" ? "From date" : "To date", onchange: (e) => { range[key] = e.target.value; renderRoute(); } });
  return h("div", { class: "row range" }, h("span", { class: "small muted" }, "Period"), sel, range.preset === "custom" && [date("from"), h("span", { class: "muted" }, "to"), date("to")]);
}

// ---------- admin: dashboard ----------
const MAP_COLS = [
  { key: "area_manager", label: "Area manager" }, { key: "rom", label: "ROM" }, { key: "region", label: "Region" }, { key: "city", label: "City" },
];
const MAP_FILTERS = [{ key: "area_manager", label: "area managers" }, { key: "rom", label: "ROMs" }, { key: "region", label: "regions" }, { key: "city", label: "cities" }];
const trunc = (s, n = 60) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const avgCell = (a) => (a == null ? h("span", { class: "muted" }, "—") : h("span", { class: `pct ${pctClass(a)}` }, fmtPct(a)));
const bucket = (s) => { const n = daysSince(s); return n == null ? "5 · Never visited" : n <= 30 ? "1 · Last 30 days" : n <= 60 ? "2 · 31–60 days ago" : n <= 90 ? "3 · 61–90 days ago" : "4 · Over 90 days ago"; };
const lastVisitCell = (s) => (s ? h("span", {}, fmtDate(s), h("span", { class: "small muted" }, ` · ${daysSince(s)}d ago`)) : h("span", { class: "chip bad" }, "Never"));
const notesList = (rows, empty) => (rows.length ? rows.map((n) => h("div", { class: "note-row" }, h("div", { class: "small muted" }, `${n.staff_name} · ${n.position} · ${n.store_code} ${n.store_name} · ${n.trainer_name || ""} · ${fmtDate(n.submitted_at)}`),
  h("a", { href: `#/eval/${n.id}`, style: "text-decoration:none;color:inherit;white-space:pre-wrap" }, trunc(n.improvement_notes, 260)))) : h("p", { class: "muted" }, empty));

async function adminHome() {
  const d = await api("/admin/summary" + rq()), t = d.totals;
  const barRows = (rows) => rows.map((r) => h("div", { class: "secrow" },
    h("b", {}, r.name), r.avg_pct == null ? h("span", { class: "muted small" }, "No evaluations yet") : h("div", { class: `bar ${pctClass(r.avg_pct)}` }, h("i", { style: `width:${r.avg_pct}%` })),
    h("span", { class: `pct ${pctClass(r.avg_pct)}` }, fmtPct(r.avg_pct))));
  const cov = pct(t.stores_visited, t.stores);
  const stores = d.byStore.map((s) => ({ ...s, avg: s.sum_max ? pct(s.sum_score, s.sum_max) : null }));

  const trainers = d.byTrainer.filter((x) => x.employee_id !== "LEGACY" ? x.status !== "pending" : x.visits > 0).map((x) => ({ ...x, avg: x.sum_max ? pct(x.sum_score, x.sum_max) : null, coverage: pct(x.stores_visited, t.stores), trainedPct: x.sum_max ? pct(x.sum_trained, x.sum_max) : null }));
  const trainerGrid = grid({
    rows: trainers, searchIn: (x) => `${x.name} ${x.employee_id} ${x.designation}`, filters: [{ key: "designation", label: "designations" }], sort: { key: "visits", dir: -1 },
    onRow: (x) => (location.hash = `#/admin/trainer/${x.id}`), empty: "No trainers yet.",
    cols: [{ key: "name", label: "Trainer", render: (x) => h("span", {}, h("b", {}, x.name), h("div", { class: "small muted" }, `${x.employee_id} · ${x.designation}`)) },
      { key: "visits", label: "Visits", num: true }, { key: "stores_visited", label: "Stores visited", num: true },
      { key: "coverage", label: "Store coverage", num: true, render: (x) => h("span", { title: `${x.stores_visited} of ${t.stores} stores` }, fmtPct(x.coverage)) },
      { key: "staff_evaluated", label: "Staff evaluated", num: true }, { key: "evaluations", label: "Evaluations", num: true },
      { key: "avg", label: "Avg score", num: true, render: (x) => avgCell(x.avg) },
      { key: "last_visit", label: "Last visit", render: (x) => (x.last_visit ? fmtDate(x.last_visit) : "—") }],
  });

  // roll the stores up by area manager / ROM / region / city
  const groups = { area_manager: "Area manager", rom: "ROM", region: "Region", city: "City" };
  let by = "area_manager";
  const holder = h("div"), tabs = h("div", { class: "tabs", style: "margin-bottom:12px" });
  const rollup = () => {
    const m = new Map();
    for (const s of stores) { const k = s[by] || "(none)"; const g = m.get(k) || { name: k, stores: 0, visited: 0, visits: 0, evals: 0, sc: 0, mx: 0 }; g.stores++; if (s.visits) g.visited++; g.visits += s.visits; g.evals += s.evaluations; g.sc += s.sum_score; g.mx += s.sum_max; m.set(k, g); }
    return [...m.values()].map((g) => ({ ...g, coverage: pct(g.visited, g.stores), avg: g.mx ? pct(g.sc, g.mx) : null }));
  };
  const drawBy = () => {
    tabs.replaceChildren(...Object.entries(groups).map(([k, l]) => h("button", { type: "button", class: "tab" + (k === by ? " on" : ""), onclick: () => { by = k; drawBy(); } }, l)));
    holder.replaceChildren(grid({
      rows: rollup(), sort: { key: "name", dir: 1 }, empty: "No data yet.",
      cols: [{ key: "name", label: groups[by], render: (r) => h("b", {}, r.name) }, { key: "stores", label: "Stores", num: true },
        { key: "visited", label: "Visited", num: true, render: (r) => `${r.visited} / ${r.stores}` }, { key: "coverage", label: "Coverage", num: true, render: (r) => fmtPct(r.coverage) },
        { key: "visits", label: "Visits", num: true }, { key: "evals", label: "Evaluations", num: true }, { key: "avg", label: "Avg score", num: true, render: (r) => avgCell(r.avg) }],
    }).el);
  };
  drawBy();

  const storeGrid = grid({
    rows: stores, searchIn: (s) => `${s.username} ${s.name} ${s.area_manager || ""} ${s.rom || ""} ${s.region || ""} ${s.city || ""}`,
    filters: [{ key: "recency", label: "last-visit periods", get: (s) => bucket(s.last_visit) }, ...MAP_FILTERS], sort: { key: "last_visit", dir: 1 }, maxHeight: "560px",
    onRow: (s) => (location.hash = `#/admin/visits?store=${encodeURIComponent(s.username)}`),
    cols: [{ key: "username", label: "Store ID", render: (s) => h("b", {}, s.username) }, { key: "name", label: "Store" }, ...MAP_COLS,
      { key: "visits", label: "Visits", num: true }, { key: "evaluations", label: "Evaluations", num: true }, { key: "avg", label: "Avg score", num: true, render: (s) => avgCell(s.avg) },
      { key: "last_visit", label: "Last visit", render: (s) => lastVisitCell(s.last_visit) }],
  });

  return shell(h("div", {},
    pageHead("Dashboard", "Trainer visits to stores, staff evaluated, and where more training is needed.", rangeBar()),
    t.pending > 0 && h("a", { class: "notice", href: "#/admin/trainers" }, `${t.pending} trainer${t.pending === 1 ? " is" : "s are"} waiting for your approval → Review`),
    h("div", { class: "grid g4" },
      h("div", { class: "kpi tealk" }, h("div", { class: "v" }, t.visits), h("div", { class: "l" }, `Store visits · ${t.trainers} active trainer${t.trainers === 1 ? "" : "s"}`)),
      h("div", { class: "kpi" }, h("div", { class: "v" }, `${t.stores_visited}/${t.stores}`), h("div", { class: "l" }, `Stores visited · ${fmtPct(cov)} coverage`)),
      h("div", { class: "kpi tank" }, h("div", { class: "v" }, t.evaluations), h("div", { class: "l" }, `Staff evaluations · ${t.drafts} unsubmitted`)),
      h("div", { class: "kpi" }, h("div", { class: "v" }, fmtPct(t.avg_pct)), h("div", { class: "l" }, `Average score · ${fmtPct(t.trained_pct)} trained`))),
    h("div", { class: "card" }, h("h2", {}, "Trainers"), h("p", { class: "muted small" }, "Click a trainer to see every visit, store, staff member and note."), trainerGrid.el),
    h("div", { class: "grid g2", style: "margin-top:16px" },
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Areas that need more training"), h("p", { class: "muted small" }, "Lowest “performed” rate in the latest evaluations of this period."),
        d.weakest.length ? d.weakest.map((w) => h("div", { class: "secrow" }, h("div", {}, h("b", {}, w.section), h("div", { class: "small muted" }, w.position)), h("div", { class: `bar ${pctClass(w.pct)}` }, h("i", { style: `width:${w.pct}%` })), h("span", { class: `pct ${pctClass(w.pct)}` }, fmtPct(w.pct)))) : h("p", { class: "muted" }, "Needs a few evaluations.")),
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "By position"), barRows(d.byPosition))),
    h("div", { class: "card" }, h("h2", {}, "Trainers’ notes on areas for improvement"), notesList(d.notes, "No notes in this period.")),
    h("div", { class: "card" }, h("h2", {}, "View by"), tabs, holder),
    h("div", { class: "card" }, h("h2", {}, "Stores — visit coverage"), h("p", { class: "muted small" }, "Sorted by oldest visit first. Filter “Never visited” or “Over 90 days” to see which stores need a trainer."), storeGrid.el)), "#/admin");
}

// ---------- admin: trainers ----------
async function adminTrainers() {
  const list = await api("/admin/trainers" + rq());
  const rows = list.filter((t) => t.employee_id !== "LEGACY" || t.visits > 0).map((t) => ({ ...t, avg: t.sum_max ? pct(t.sum_score, t.sum_max) : null }));
  const pending = rows.filter((t) => t.status === "pending");
  const setStatus = guarded(async (t, status) => { await api(`/admin/trainers/${t.id}`, { method: "PATCH", body: { status } }); });
  const reset = async (t) => {
    const input = h("input", { type: "text", placeholder: "Leave empty for a random password", maxlength: 60 });
    const v = await modal(`Reset password — ${t.name}`, h("div", {}, h("p", { class: "muted small" }, `${t.employee_id}. They are signed out everywhere. Share the new password with them privately.`), input),
      (close) => [h("button", { class: "btn ghost", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(input.value.trim()) }, "Reset")]);
    if (v === null) return;
    try {
      const r = await api(`/admin/trainers/${t.id}/reset-password`, { method: "POST", body: v ? { password: v } : {} });
      await modal("New password", h("div", {}, h("p", {}, `${t.name} (${t.employee_id})`), h("p", { class: "mono", style: "font-size:20px;font-weight:700" }, r.password), h("p", { class: "muted small" }, "Shown once — copy it now.")),
        (close) => [h("button", { class: "btn ghost", onclick: () => { navigator.clipboard?.writeText(r.password); toast("Copied"); } }, "Copy"), h("button", { class: "btn teal", onclick: () => close(true) }, "Done")]);
    } catch (e) { toast(e.message); }
  };
  const edit = guarded(async (t) => {
    const name = h("input", { type: "text", value: t.name, maxlength: 80 }), des = h("input", { type: "text", value: t.designation, maxlength: 60 }), eid = h("input", { type: "text", value: t.employee_id, maxlength: 30 });
    const ok = await modal(`Edit ${t.name}`, h("div", { class: "stack" }, h("div", {}, h("label", {}, "Name"), name), h("div", {}, h("label", {}, "Employee ID"), eid), h("div", {}, h("label", {}, "Designation"), des)),
      (close) => [h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(true) }, "Save")]);
    if (!ok) throw new Error("Cancelled");
    await api(`/admin/trainers/${t.id}`, { method: "PATCH", body: { name: name.value, designation: des.value, employee_id: eid.value } });
  });
  const remove = guarded(async (t) => {
    if (!(await confirmBox("Delete trainer?", `${t.name} will be removed. Trainers with visits can only be disabled.`, "Delete", true))) throw new Error("Cancelled");
    await api(`/admin/trainers/${t.id}`, { method: "DELETE" });
  });
  const stChip = (t) => (t.status === "approved" ? h("span", { class: "chip good" }, "Active") : t.status === "pending" ? h("span", { class: "chip warn" }, "Pending") : h("span", { class: "chip bad" }, "Disabled"));
  const g = grid({
    rows, searchIn: (t) => `${t.name} ${t.employee_id} ${t.designation}`, filters: [{ key: "status", label: "statuses", show: (v) => ({ approved: "Active", pending: "Pending", disabled: "Disabled" })[v] }, { key: "designation", label: "designations" }],
    sort: { key: "name", dir: 1 }, onRow: (t) => (location.hash = `#/admin/trainer/${t.id}`), empty: "No trainers yet. They create their own accounts from the sign-in page.",
    cols: [{ key: "employee_id", label: "Employee ID", render: (t) => h("b", {}, t.employee_id) }, { key: "name", label: "Name" }, { key: "designation", label: "Designation" },
      { key: "status", label: "Status", render: stChip }, { key: "created_at", label: "Joined", render: (t) => fmtDate(t.created_at) }, { key: "last_login", label: "Last sign-in", render: (t) => (t.last_login ? fmtDate(t.last_login) : "—") },
      { key: "visits", label: "Visits", num: true }, { key: "stores_visited", label: "Stores", num: true }, { key: "evaluations", label: "Evaluations", num: true }, { key: "avg", label: "Avg score", num: true, render: (t) => avgCell(t.avg) },
      { key: "actions", label: "", nosort: true, render: (t) => (t.employee_id === "LEGACY" ? "" : h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end", onclick: (e) => e.stopPropagation() },
        t.status !== "approved" && h("button", { class: "btn teal sm", onclick: () => setStatus(t, "approved") }, t.status === "pending" ? "Approve" : "Enable"),
        t.status === "approved" && h("button", { class: "btn ghost sm", onclick: () => setStatus(t, "disabled") }, "Disable"),
        h("button", { class: "btn ghost sm", onclick: () => reset(t) }, "🔑 Reset"), h("button", { class: "btn ghost sm", onclick: () => edit(t) }, "Edit"),
        h("button", { class: "icon del", title: "Delete trainer", "aria-label": `Delete ${t.name}`, onclick: () => remove(t) }, "🗑"))) }],
  });
  return shell(h("div", {},
    pageHead("Trainers", "Trainers create their own account (name, employee ID, designation, password). You approve them here. Visit and score columns follow the period you pick.", rangeBar()),
    pending.length > 0 && h("div", { class: "card" }, h("h2", {}, `Waiting for approval (${pending.length})`),
      h("div", { class: "stack", style: "margin-top:10px" }, pending.map((t) => h("div", { class: "row spread pending-row" },
        h("div", {}, h("b", {}, t.name), h("div", { class: "small muted" }, `${t.employee_id} · ${t.designation} · requested ${fmtDate(t.created_at)}`)),
        h("div", { class: "row" }, h("button", { class: "btn teal sm", onclick: () => setStatus(t, "approved") }, "Approve"), h("button", { class: "btn danger sm", onclick: () => setStatus(t, "disabled") }, "Reject")))))),
    h("div", { class: "card" }, g.el)), "#/admin/trainers");
}

// ---------- admin: one trainer ----------
async function adminTrainer(id) {
  const d = await api(`/admin/trainers/${id}` + rq());
  const t = d.trainer, total = d.storesTotal;
  const avg = t.sum_max ? pct(t.sum_score, t.sum_max) : null, trained = t.sum_max ? pct(t.sum_trained, t.sum_max) : null;
  const visits = d.visits.map((v) => ({ ...v, store: `${v.store_code} · ${v.store_name}`, avg: v.sum_max ? pct(v.sum_score, v.sum_max) : null }));
  const g = grid({
    rows: visits, searchIn: (v) => `${v.store_code} ${v.store_name} ${v.city || ""} ${v.notes || ""}`, filters: [{ key: "city", label: "cities" }, { key: "status", label: "statuses", show: (x) => (x === "open" ? "Open" : "Completed") }],
    sort: { key: "started_at", dir: -1 }, onRow: (v) => (location.hash = `#/visit/${v.id}`), empty: "No visits in this period.",
    toolbar: [h("button", { class: "btn teal sm", onclick: () => download([["Date", "Store ID", "Store", "Area manager", "ROM", "Region", "City", "Staff evaluated", "Avg score %", "Status", "Follow-up", "Notes"], ...g.rows().map((v) => [v.started_at, v.store_code, v.store_name, v.area_manager, v.rom, v.region, v.city, v.staff, v.avg, v.status, v.follow_up ? "Yes" : "", v.notes || ""])], `visits-${t.employee_id}.xlsx`, "Visits") }, "Export to Excel")],
    cols: [{ key: "started_at", label: "Date", render: (v) => fmtDateTime(v.started_at) }, { key: "store", label: "Store", render: (v) => h("span", {}, h("b", {}, v.store_code), " ", v.store_name) }, ...MAP_COLS.slice(0, 1), { key: "city", label: "City" },
      { key: "staff", label: "Staff evaluated", num: true }, { key: "avg", label: "Avg score", num: true, render: (v) => avgCell(v.avg) }, { key: "status", label: "Status", render: statusChip },
      { key: "follow_up", label: "Follow-up", render: (v) => (v.follow_up ? h("span", { class: "chip warn" }, v.follow_up_date ? fmtDate(v.follow_up_date) : "Yes") : "") }, { key: "notes", label: "Notes", render: (v) => h("span", { class: "small" }, trunc(v.notes, 80)) }],
  });
  return shell(h("div", {},
    pageHead(t.name, `${t.employee_id} · ${t.designation} · ${t.status === "approved" ? "Active" : t.status}`, rangeBar(), h("a", { class: "btn ghost sm", href: "#/admin/trainers" }, "← Trainers")),
    h("div", { class: "grid g4", style: "margin-bottom:16px" },
      h("div", { class: "kpi tealk" }, h("div", { class: "v" }, t.visits), h("div", { class: "l" }, "Store visits")),
      h("div", { class: "kpi" }, h("div", { class: "v" }, `${t.stores_visited}`), h("div", { class: "l" }, `Stores visited · ${fmtPct(pct(t.stores_visited, total))} of all stores`)),
      h("div", { class: "kpi tank" }, h("div", { class: "v" }, t.staff_evaluated), h("div", { class: "l" }, `Staff evaluated · ${t.evaluations} evaluations`)),
      h("div", { class: "kpi" }, h("div", { class: "v" }, fmtPct(avg)), h("div", { class: "l" }, `Average score · ${fmtPct(trained)} trained`))),
    h("div", { class: "grid g2" },
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Weakest areas found"), h("p", { class: "muted small" }, "Lowest “performed” rate in this trainer’s evaluations."),
        d.weakest.length ? d.weakest.map((w) => h("div", { class: "secrow" }, h("div", {}, h("b", {}, w.section), h("div", { class: "small muted" }, w.position)), h("div", { class: `bar ${pctClass(w.pct)}` }, h("i", { style: `width:${w.pct}%` })), h("span", { class: `pct ${pctClass(w.pct)}` }, fmtPct(w.pct)))) : h("p", { class: "muted" }, "Not enough evaluations yet.")),
      h("div", { class: "card", style: "margin:0" }, h("h2", {}, "Notes on areas for improvement"), notesList(d.notes, "No notes in this period."))),
    h("div", { class: "card" }, h("h2", {}, "Visits"), g.el)), "#/admin/trainers");
}

// ---------- admin: visits + staff evaluations ----------
let visitsTab = "visits";
async function adminVisits(query) {
  const PAGE = 300;
  const visitList = await api("/visits" + rq());
  const fromStore = query.get("store");
  const prep = (v) => ({ ...v, store: `${v.store_code} · ${v.store_name}`, avg: v.sum_max ? pct(v.sum_score, v.sum_max) : null });
  let vMore = visitList.length >= PAGE;
  const loadAllVisits = async () => { const all = await api("/visits" + rq("all=1")); vMore = false; visits.splice(0, visits.length, ...all.map(prep)); vg.setRows(visits); vBtn.remove(); draw(); };
  const vBtn = h("button", { class: "btn ghost sm", onclick: async (e) => { e.target.disabled = true; try { await loadAllVisits(); } catch (ex) { toast(ex.message); e.target.disabled = false; } } }, `Showing newest ${PAGE} — load all`);
  const visits = visitList.map(prep);
  const removeVisit = async (v) => {
    if (!(await confirmBox("Delete visit?", `${v.trainer_name} at ${v.store_name} on ${fmtDate(v.started_at)} — including ${v.evals + v.drafts} evaluation(s). This cannot be undone.`, "Delete", true))) return;
    try { await api(`/visits/${v.id}`, { method: "DELETE" }); visits.splice(visits.indexOf(v), 1); vg.setRows(visits); evalsGrid = null; toast("Visit deleted"); } catch (e) { toast(e.message); }
  };
  const vg = grid({
    rows: visits, searchIn: (v) => `${v.trainer_name} ${v.trainer_employee_id} ${v.store_code} ${v.store_name} ${v.area_manager || ""} ${v.rom || ""} ${v.city || ""} ${v.notes || ""}`,
    filters: [{ key: "trainer_name", label: "trainers" }, { key: "status", label: "statuses", show: (x) => (x === "open" ? "Open" : "Completed") }, ...MAP_FILTERS, { key: "store", label: "stores" }],
    initial: fromStore ? { store: visits.find((v) => v.store_code === fromStore)?.store } : {},
    sort: { key: "started_at", dir: -1 }, onRow: (v) => (location.hash = `#/visit/${v.id}`), empty: "No visits in this period.",
    toolbar: [...(vMore ? [vBtn] : []), h("button", { class: "btn teal sm", onclick: async () => { if (vMore) await loadAllVisits(); download([["Date", "Trainer", "Employee ID", "Designation", "Store ID", "Store", "Area manager", "ROM", "Region", "City", "Staff evaluated", "Evaluations", "Avg score %", "Status", "Follow-up", "Follow-up date", "Notes"],
      ...vg.rows().map((v) => [v.started_at, v.trainer_name, v.trainer_employee_id, v.trainer_designation, v.store_code, v.store_name, v.area_manager, v.rom, v.region, v.city, v.staff, v.evals, v.avg, v.status, v.follow_up ? "Yes" : "", v.follow_up_date || "", v.notes || ""])], `hm-visits-${ymd(new Date())}.xlsx`, "Visits"); } }, "Export to Excel")],
    cols: [{ key: "started_at", label: "Date", render: (v) => fmtDateTime(v.started_at) }, { key: "trainer_name", label: "Trainer", render: (v) => h("span", {}, h("b", {}, v.trainer_name), h("div", { class: "small muted" }, v.trainer_employee_id)) },
      { key: "store", label: "Store", render: (v) => h("span", {}, h("b", {}, v.store_code), " ", v.store_name) }, ...MAP_COLS,
      { key: "staff", label: "Staff evaluated", num: true }, { key: "avg", label: "Avg score", num: true, render: (v) => avgCell(v.avg) }, { key: "status", label: "Status", render: statusChip },
      { key: "follow_up", label: "Follow-up", render: (v) => (v.follow_up ? h("span", { class: "chip warn" }, v.follow_up_date ? fmtDate(v.follow_up_date) : "Yes") : "") },
      { key: "notes", label: "Notes", render: (v) => h("span", { class: "small" }, trunc(v.notes, 70)) },
      { key: "del", label: "", nosort: true, render: (v) => h("button", { class: "icon del", title: "Delete visit", "aria-label": `Delete visit to ${v.store_name}`, onclick: (e) => { e.stopPropagation(); removeVisit(v); } }, "🗑") }],
  });

  // staff evaluations are fetched only when that tab is opened (keeps the page light as data grows)
  let evalsGrid = null, evalCount = null;
  const buildEvals = async () => {
    const list = await api("/evals" + rq());
    let eMore = list.length >= PAGE;
    const loadAllEvals = async () => { const all = await api("/evals" + rq("all=1")); eMore = false; evals.splice(0, evals.length, ...all.map(prepE)); eg.setRows(evals); evalCount = evals.length; eBtn.remove(); draw(); };
    const eBtn = h("button", { class: "btn ghost sm", onclick: async (e) => { e.target.disabled = true; try { await loadAllEvals(); } catch (ex) { toast(ex.message); e.target.disabled = false; } } }, `Showing newest ${PAGE} — load all`);
    const prepE = (e) => ({ ...e, store: `${e.store_code} · ${e.store_name}`, pctv: e.status === "submitted" ? pct(e.score, e.max_score) : null, trainedPct: e.status === "submitted" ? pct(e.trained_count, e.max_score) : null, when: e.submitted_at || e.created_at });
    const evals = list.map(prepE);
    const removeEval = async (e) => {
      if (!(await confirmBox("Delete evaluation?", `${e.staff_name} · ${e.position_name} · ${e.store_code}. This permanently removes the evaluation and its answers.`, "Delete", true))) return;
      try { await api(`/evals/${e.id}`, { method: "DELETE" }); evals.splice(evals.indexOf(e), 1); eg.setRows(evals); evalCount = evals.length; draw(); toast("Evaluation deleted"); } catch (ex) { toast(ex.message); }
    };
    const exportEvals = async () => {
      try {
        const keep = new Set(eg.rows().map((e) => e.id));
        const full = (await api("/evals" + rq("full=1"))).filter((e) => e.status === "submitted" && keep.has(e.id));   // full notes, only what the filters show
        await download([["Date", "Trainer", "Employee ID", "Store ID", "Store", "Area manager", "ROM", "Region", "City", "Staff", "Staff ID", "Position", "Score", "Max", "Score %", "Training %", "Areas for improvement"],
          ...full.map((e) => [e.submitted_at, e.trainer_name, e.trainer_employee_id, e.store_code, e.store_name, e.area_manager, e.rom, e.region, e.city, e.staff_name, e.staff_code || "", e.position_name, e.score, e.max_score, pct(e.score, e.max_score), pct(e.trained_count, e.max_score), e.improvement_notes || ""])], `hm-evaluations-${ymd(new Date())}.xlsx`, "Evaluations");
      } catch (ex) { toast(ex.message); }
    };
    const eg = grid({
      rows: evals, searchIn: (e) => `${e.staff_name} ${e.staff_code || ""} ${e.trainer_name || ""} ${e.store_code} ${e.store_name} ${e.area_manager || ""} ${e.rom || ""} ${e.city || ""} ${e.improvement_notes || ""}`,
      filters: [{ key: "status", label: "statuses", show: (x) => (x === "draft" ? "Drafts" : "Submitted") }, { key: "position_name", label: "positions" }, { key: "trainer_name", label: "trainers" }, ...MAP_FILTERS, { key: "store", label: "stores" }],
      initial: { status: "submitted" }, sort: { key: "when", dir: -1 }, onRow: (e) => (location.hash = `#/eval/${e.id}`), empty: "No evaluations match.",
      toolbar: [...(eMore ? [eBtn] : []), h("button", { class: "btn teal sm", onclick: async () => { if (eMore) await loadAllEvals(); exportEvals(); } }, "Export to Excel")],
      cols: [{ key: "staff_name", label: "Staff", render: (e) => h("span", {}, h("b", {}, e.staff_name), e.staff_code && h("div", { class: "small muted" }, e.staff_code)) }, { key: "position_name", label: "Position" },
        { key: "trainer_name", label: "Trainer" }, { key: "store", label: "Store", render: (e) => h("span", {}, h("b", {}, e.store_code), " ", e.store_name) }, ...MAP_COLS, { key: "when", label: "Date", render: (e) => fmtDate(e.when) },
        { key: "pctv", label: "Score", num: true, render: (e) => (e.status === "draft" ? h("span", { class: "chip warn" }, "Draft") : avgCell(e.pctv)) },
        { key: "trainedPct", label: "Training", num: true, render: (e) => h("span", { class: "muted" }, e.status === "submitted" ? fmtPct(e.trainedPct) : "") },
        { key: "improvement_notes", label: "Areas for improvement", render: (e) => h("span", { class: "small" }, trunc(e.improvement_notes, 70)) },
        { key: "del", label: "", nosort: true, render: (e) => h("button", { class: "icon del", title: "Delete evaluation", "aria-label": `Delete evaluation of ${e.staff_name}`, onclick: (ev) => { ev.stopPropagation(); removeEval(e); } }, "🗑") }],
    });
    evalCount = evals.length; return eg;
  };

  const holder = h("div"), tabBar = h("div", { class: "tabs", style: "margin-bottom:12px" });
  const draw = async () => {
    tabBar.replaceChildren(h("button", { type: "button", class: "tab" + (visitsTab === "visits" ? " on" : ""), onclick: () => { visitsTab = "visits"; draw(); } }, `Visits (${visits.length})`),
      h("button", { type: "button", class: "tab" + (visitsTab === "evals" ? " on" : ""), onclick: () => { visitsTab = "evals"; draw(); } }, `Staff evaluations${evalCount == null ? "" : ` (${evalCount})`}`));
    if (visitsTab === "visits") return holder.replaceChildren(vg.el);
    if (!evalsGrid) { holder.replaceChildren(h("p", { class: "muted" }, "Loading evaluations…")); try { evalsGrid = await buildEvals(); } catch (e) { return holder.replaceChildren(h("p", { class: "err" }, e.message)); } if (visitsTab !== "evals") return; draw(); return; }
    holder.replaceChildren(evalsGrid.el);
  };
  draw();
  return shell(h("div", {}, pageHead("Visits", "Every store visit by every trainer — sort and filter by trainer, store, area manager, ROM, region or city.", rangeBar()), h("div", { class: "card" }, tabBar, holder)), "#/admin/visits");
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
  const refresh = async () => { const y = scrollY; stores.splice(0, stores.length, ...(await api("/admin/stores")).stores); cache.delete("/stores"); g.setRows(stores); scrollTo(0, y); };

  const form = async (s) => {
    const f = {
      name: h("input", { type: "text", value: s?.name || "", maxlength: 120, required: true }),
      code: h("input", { type: "text", value: s?.code || "", maxlength: 40, placeholder: s ? "" : "Leave empty to auto-create", disabled: !!s && !s.manual, title: s && !s.manual ? "From the mapping file — the weekly sync uses this ID" : "" }),
      area_manager: h("input", { type: "text", value: s?.area_manager || "", maxlength: 80 }),
      rom: h("input", { type: "text", value: s?.rom || "", maxlength: 80 }),
      region: h("input", { type: "text", value: s?.region || "", maxlength: 80 }),
      city: h("input", { type: "text", value: s?.city || "", maxlength: 80 }),
    };
    const field = (label, el) => h("div", {}, h("label", {}, label), el);
    const ok = await modal(s ? `Edit store — ${s.name}` : "Add a store", h("div", { class: "stack" },
      field("Store name *", f.name), field("Store ID", f.code), h("div", { class: "grid g2" }, field("Area manager", f.area_manager), field("ROM", f.rom)), h("div", { class: "grid g2" }, field("Region", f.region), field("City", f.city)),
      s && !s.manual && h("p", { class: "small muted", style: "margin:0" }, "Details you change here are kept — the weekly mapping sync will not overwrite them.")),
      (close) => [h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn teal", onclick: () => close(true) }, s ? "Save" : "Add store")]);
    if (!ok) return;
    const body = Object.fromEntries(Object.entries(f).filter(([k, el]) => !el.disabled).map(([k, el]) => [k, el.value.trim()]));
    try { if (s) await api(`/admin/stores/${s.id}`, { method: "PATCH", body }); else await api("/admin/stores", { method: "POST", body }); toast(s ? "Store updated" : "Store added"); await refresh(); }
    catch (e) { toast(e.message); }
  };

  const g = grid({
    rows: stores, sort: { key: "name", dir: 1 }, rowClass: (s) => (s.active ? "" : "off"), empty: "No stores yet.",
    searchIn: (s) => `${s.code} ${s.name} ${s.area_manager || ""} ${s.rom || ""} ${s.region || ""} ${s.city || ""}`,
    filters: [...MAP_FILTERS, { key: "active", label: "statuses", get: (s) => (s.active ? "1" : "0"), show: (v) => (v === "1" ? "Active" : "Disabled") }, { key: "manual", label: "sources", get: (s) => (s.manual ? "1" : "0"), show: (v) => (v === "1" ? "Added by hand" : "Mapping file") }],
    toolbar: [h("button", { class: "btn teal sm", onclick: () => form(null) }, "+ Add store")],
    cols: [
      { key: "code", label: "Store ID", render: (s) => h("b", {}, s.code) },
      { key: "name", label: "Store", render: (s) => h("span", {}, s.name, !s.active && h("span", { class: "chip bad", style: "margin-left:8px" }, "Disabled"), s.manual && h("span", { class: "chip", style: "margin-left:8px" }, "Added by hand")) },
      ...MAP_COLS,
      { key: "visits", label: "Visits", num: true }, { key: "last_visit", label: "Last visit", render: (s) => lastVisitCell(s.last_visit) },
      { key: "actions", label: "", nosort: true, render: (s) => h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end" },
        h("button", { class: "btn ghost sm", onclick: () => form(s) }, "Edit"),
        h("button", { class: "btn ghost sm", onclick: async () => { try { await api(`/admin/stores/${s.id}`, { method: "PATCH", body: { active: !s.active } }); await refresh(); } catch (e) { toast(e.message); } } }, s.active ? "Disable" : "Enable"),
        h("button", { class: "icon del", title: "Delete store", "aria-label": `Delete ${s.name}`, onclick: async () => { if (!(await confirmBox("Delete store?", `${s.code} · ${s.name} will be removed. Stores with visits can only be disabled.`, "Delete", true))) return; try { await api(`/admin/stores/${s.id}`, { method: "DELETE" }); await refresh(); } catch (e) { toast(e.message); } } }, "🗑")) },
    ],
  });
  const ls = loaded.lastSync;
  return shell(h("div", {},
    pageHead("Stores", "The list trainers pick from when they start a visit. Add, rename or disable any store."),
    h("div", { class: "card" },
      h("p", { class: "small muted", style: "margin:0 0 12px" }, ls ? `Area manager, ROM, region and city refresh weekly from “AM & ROM Mapping” · last sync ${fmtDate(ls.at)} · ${ls.total} stores. Stores you edit or add by hand are never overwritten.` : "Waiting for the first sync from “AM & ROM Mapping”."),
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
    if (path === "/home" || path === "/") view = await homeView();
    else if ((m = path.match(/^\/m\/(onboarding|npd|coaching|development)$/))) view = await moduleView(m[1]);
    else if (path === "/sv") view = await svList();
    else if (path === "/sv/new") view = await svForm(null);
    else if ((m = path.match(/^\/sv\/(\d+)\/edit$/))) view = await svForm(m[1]);
    else if ((m = path.match(/^\/sv\/(\d+)$/))) view = await svView(m[1]);
    else if (session.role === "admin") {
      if (path === "/admin") view = await adminHome();
      else if (path === "/admin/trainers") view = await adminTrainers();
      else if ((m = path.match(/^\/admin\/trainer\/(\d+)$/))) view = await adminTrainer(m[1]);
      else if (path === "/admin/visits") view = await adminVisits(query);
      else if ((m = path.match(/^\/admin\/questions(?:\/(\d+))?$/))) view = await adminQuestions(m[1]);
      else if (path === "/admin/stores") view = await adminStores();
      else if ((m = path.match(/^\/visit\/(\d+)$/))) view = await visitView(m[1]);
      else if ((m = path.match(/^\/eval\/(\d+)$/))) view = await evalRoute(m[1]);
      else view = await homeView();
    } else {
      if (path === "/verify") view = await trainerHome();
      else if (path === "/visit/new") view = await newVisitView();
      else if ((m = path.match(/^\/visit\/(\d+)$/))) view = await visitView(m[1]);
      else if ((m = path.match(/^\/eval\/(\d+)$/))) view = await evalRoute(m[1]);
      else view = await homeView();
    }
  } catch (e) {
    if (!session.role) return;
    view = shell(h("div", { class: "card" }, h("h2", {}, "Something went wrong"), h("p", { class: "err" }, e.message), h("a", { class: "btn ghost", href: "#/home" }, "Home")), session.role === "admin" ? "#/admin" : "#/");
  }
  $app.replaceChildren(view);
  window.scrollTo(0, 0);
}

function render() { session.role ? renderRoute() : $app.replaceChildren(loginView()); }
window.addEventListener("hashchange", () => session.role && renderRoute());
api("/me").then((s) => { session = s; render(); }).catch(() => render());
