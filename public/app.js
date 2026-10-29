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
  const res = await fetch(`/api${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
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

function download(wbRows, filename, sheetName = "Sheet1") {
  const ws = XLSX.utils.aoa_to_sheet(wbRows);
  ws["!cols"] = wbRows[0].map((_, i) => ({ wch: Math.min(60, Math.max(10, ...wbRows.map((r) => String(r[i] ?? "").length))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
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
  const positions = await api("/positions");
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
async function evalForm(ev) {
  const dirty = new Map();          // item_id -> {trained, performed}
  let skipDirty = false, timer = null, saving = false;
  const skip = new Set(ev.sections.filter((s) => s.skipped).map((s) => s.id));
  const open = new Set(ev.sections.length === 1 ? [ev.sections[0].id] : []);
  const refs = [];                  // per section UI refs
  const state = h("span", { class: "savestate" }, "All changes saved");

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
  const schedule = () => { state.textContent = "Saving…"; clearTimeout(timer); timer = setTimeout(flush, 2000); };

  const overall = h("div", { class: "bar" }, h("i", { style: "width:0" }));
  const overallTxt = h("b", {}, "");
  const scoreTxt = h("span", { class: "muted small" }, "");

  function refresh() {
    let answered = 0, total = 0, score = 0;
    for (const r of refs) {
      const s = r.sec, qs = s.items.filter((i) => i.kind === "question");
      const a = qs.filter((q) => q.trained !== null && q.performed !== null).length;
      const sc = qs.filter((q) => q.performed === 1).length;
      const na = skip.has(s.id);
      r.el.classList.toggle("na", na); r.el.classList.toggle("done", !na && a === qs.length);
      r.num.textContent = !na && a === qs.length ? "✓" : r.idx;
      r.meta.textContent = na ? "Not applicable" : `${a}/${qs.length} answered · score ${sc}/${qs.length}`;
      r.naBtn.textContent = na ? "Include section" : "Not applicable";
      if (!na) { answered += a; total += qs.length; score += sc; }
    }
    const p = total ? Math.round((100 * answered) / total) : 0;
    overall.firstChild.style.width = `${p}%`;
    overallTxt.textContent = `${answered}/${total} answered`;
    scoreTxt.textContent = answered ? `Score so far: ${score}/${total} (${Math.round((100 * score) / total)}%)` : "";
  }

  function seg(q, field, missingEls) {
    const y = h("button", { type: "button", class: "y", "aria-label": "Yes" }, "Yes"), n = h("button", { type: "button", class: "n", "aria-label": "No" }, "No");
    const el = h("div", { class: "seg" }, y, n);
    const paint = () => { y.classList.toggle("on", q[field] === 1); n.classList.toggle("on", q[field] === 0); el.classList.toggle("missing", false); };
    const set = (v) => { q[field] = q[field] === v ? null : v; dirty.set(q.id, { trained: q.trained, performed: q.performed }); paint(); schedule(); refresh(); };
    y.onclick = () => set(1); n.onclick = () => set(0); paint();
    el.paint = paint; missingEls.push([q, field, el]);
    return el;
  }

  const secEls = ev.sections.map((s, idx) => {
    const marks = [];
    let counter = 0;
    const meta = h("span", { class: "muted small" });
    const num = h("div", { class: "num" }, idx + 1);
    const naBtn = h("button", { type: "button", class: "btn ghost sm", onclick: () => { skip.has(s.id) ? skip.delete(s.id) : skip.add(s.id); skipDirty = true; schedule(); refresh(); } }, "Not applicable");
    const allBtn = (field, label) => h("button", { type: "button", class: "btn ghost sm", onclick: () => {
      s.items.filter((i) => i.kind === "question").forEach((q) => { q[field] = 1; dirty.set(q.id, { trained: q.trained, performed: q.performed }); });
      marks.forEach(([q, , el]) => el.paint()); schedule(); refresh();
    } }, label);
    const body = h("div", { class: "sec-b" },
      h("div", { class: "sec-tools no-print" }, allBtn("trained", "All trained: Yes"), allBtn("performed", "All performed: Yes"), naBtn),
      h("div", { class: "colhead" }, h("span", {}, "Task"), h("span", {}, "Received training"), h("span", {}, "Performed")),
      s.items.map((i) => {
        if (i.kind === "heading") { counter = 0; return h("div", { class: "heading" }, i.text); }
        if (i.kind === "note") return h("div", { class: "note", dir: "auto" }, i.text);
        counter++;
        return h("div", { class: "q" },
          h("div", { class: "t" }, h("span", { class: "n" }, `${counter}.`), h("span", { dir: "auto" }, i.text)),
          h("div", {}, h("div", { class: "mlabel" }, "Received training"), seg(i, "trained", marks)),
          h("div", {}, h("div", { class: "mlabel" }, "Performed"), seg(i, "performed", marks)));
      }));
    const el = h("section", { class: "sec" + (open.has(s.id) ? " open" : "") },
      h("div", { class: "sec-h", role: "button", tabindex: 0, onclick: () => el.classList.toggle("open"), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), el.classList.toggle("open")) },
        num, h("div", { style: "flex:1" }, h("h3", {}, s.title), meta), h("span", { class: "caret" }, "▸")),
      body);
    refs.push({ el, sec: s, num, meta, naBtn, body, idx: idx + 1, marks });
    return el;
  });

  const doSubmit = async () => {
    // highlight what is still missing and jump to it
    let first = null;
    for (const r of refs) {
      if (skip.has(r.sec.id)) continue;
      for (const [q, field, el] of r.marks) if (q[field] === null) { el.classList.add("missing"); if (!first) { first = el; r.el.classList.add("open"); } }
    }
    if (first) { toast("Some questions are still unanswered"); first.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (!(await confirmBox("Submit evaluation?", "Once submitted, the answers can no longer be changed.", "Submit"))) return;
    clearTimeout(timer); saving = false; await flush();
    submit.disabled = true;
    try { await api(`/evals/${ev.id}/submit`, { method: "POST", body: {} }); toast("Evaluation submitted"); renderRoute(); }
    catch (e) { toast(e.message); submit.disabled = false; }
  };
  const submit = h("button", { class: "btn teal", onclick: doSubmit }, "Submit evaluation");

  const del = h("button", { class: "btn danger sm", onclick: async () => {
    if (!(await confirmBox("Delete this draft?", "All answers entered so far will be lost.", "Delete", true))) return;
    await api(`/evals/${ev.id}`, { method: "DELETE" }); location.hash = "#/";
  } }, "Delete draft");

  const bar = h("div", { class: "evbar no-print" },
    h("div", { class: "row spread" }, h("div", {}, h("b", {}, ev.staff_name), " · ", ev.position_name), h("div", { class: "row" }, state, submit)),
    h("div", { class: "prog row spread" }, h("div", { style: "flex:1" }, overall), overallTxt), scoreTxt);

  const allOpen = h("button", { class: "btn ghost sm", onclick: () => { const anyClosed = refs.some((r) => !r.el.classList.contains("open")); refs.forEach((r) => r.el.classList.toggle("open", anyClosed)); } }, "Expand / collapse all");
  refresh();
  window.addEventListener("beforeunload", () => { if (dirty.size) flush(); }, { once: true });
  return shell(h("div", {},
    pageHead(`Evaluating ${ev.staff_name}`, `${ev.position_name}${ev.staff_code ? " · ID " + ev.staff_code : ""}. Answers save automatically.`, allOpen, del),
    bar, secEls, h("div", { class: "row no-print", style: "justify-content:flex-end;margin-top:8px" }, h("button", { class: "btn teal", onclick: doSubmit }, "Submit evaluation"))), "#/");
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
async function adminHome() {
  const d = await api("/admin/summary"), t = d.totals;
  const bars = (rows, link) => rows.map((r) => h("div", { class: "secrow" },
    h("b", {}, r.name), r.avg_pct == null ? h("span", { class: "muted small" }, "No evaluations yet") : h("div", { class: `bar ${pctClass(r.avg_pct)}` }, h("i", { style: `width:${r.avg_pct}%` })),
    h("span", { class: `pct ${pctClass(r.avg_pct)}` }, fmtPct(r.avg_pct))));
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
    h("div", { class: "card" }, h("h2", {}, "Stores — lowest score first"),
      d.byStore.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Store", "Evaluations", "Average"].map((x) => h("th", {}, x)))),
        h("tbody", {}, d.byStore.map((s) => h("tr", { class: "click", onclick: () => (location.hash = `#/admin/evals?store=${s.id}`) }, h("td", {}, h("b", {}, s.name)), h("td", {}, s.evaluations), h("td", {}, h("span", { class: `pct ${pctClass(s.avg_pct)}` }, fmtPct(s.avg_pct)))))))) : h("p", { class: "muted" }, "No stores yet — upload your store list under “Stores”."))), "#/admin");
}

// ---------- admin: evaluations ----------
async function adminEvals(query) {
  const [list, stores, positions] = await Promise.all([api("/evals"), api("/admin/stores"), api("/positions")]);
  const f = { store: query.get("store") || "", position: "", status: "submitted", q: "" };
  const tbody = h("tbody");
  const count = h("span", { class: "muted small" });
  const draw = () => {
    const rows = list.filter((e) => (!f.store || e.store_id == f.store) && (!f.position || e.position_id == f.position) && (!f.status || e.status === f.status) && (!f.q || (e.staff_name + e.staff_code + e.store_name).toLowerCase().includes(f.q)));
    count.textContent = `${rows.length} evaluation${rows.length === 1 ? "" : "s"}`;
    tbody.replaceChildren(...rows.map((e) => { const p = pct(e.score, e.max_score); return h("tr", { class: "click", onclick: () => (location.hash = `#/eval/${e.id}`) },
      h("td", {}, h("b", {}, e.staff_name), e.staff_code && h("div", { class: "small muted" }, e.staff_code)), h("td", {}, e.store_name), h("td", {}, e.position_name), h("td", {}, fmtDate(e.submitted_at || e.created_at)),
      h("td", {}, e.status === "draft" ? h("span", { class: "chip warn" }, "Draft") : h("span", { class: `pct ${pctClass(p)}` }, `${fmtPct(p)}`)), h("td", { class: "muted" }, e.status === "draft" ? "" : fmtPct(pct(e.trained_count, e.max_score)))); }));
    draw.rows = rows;
  };
  const sel = (opts, key, allLabel) => h("select", { onchange: (e) => { f[key] = e.target.value; draw(); }, style: "width:auto" }, h("option", { value: "" }, allLabel), opts.map(([v, l]) => h("option", { value: v, selected: String(f[key]) === String(v) }, l)));
  const exportAll = () => {
    const rows = [["Store", "Position", "Staff", "Staff ID", "Evaluator", "Submitted", "Score", "Max", "Score %", "Training %"]];
    draw.rows.filter((e) => e.status === "submitted").forEach((e) => rows.push([e.store_name, e.position_name, e.staff_name, e.staff_code || "", e.evaluator || "", e.submitted_at, e.score, e.max_score, pct(e.score, e.max_score), pct(e.trained_count, e.max_score)]));
    download(rows, `hm-evaluations-${new Date().toISOString().slice(0, 10)}.xlsx`, "Evaluations");
  };
  const view = shell(h("div", {}, pageHead("Evaluations", "Every evaluation submitted by the stores.", h("button", { class: "btn teal sm", onclick: exportAll }, "Export to Excel")),
    h("div", { class: "card" },
      h("div", { class: "row", style: "margin-bottom:12px" },
        sel(stores.map((s) => [s.id, s.name]), "store", "All stores"), sel(positions.map((p) => [p.id, p.name]), "position", "All positions"),
        sel([["submitted", "Submitted"], ["draft", "Drafts"]], "status", "All statuses"),
        h("input", { type: "search", placeholder: "Search staff or store…", style: "max-width:260px", oninput: (e) => { f.q = e.target.value.toLowerCase(); draw(); } }), count),
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Staff", "Store", "Position", "Date", "Score", "Training"].map((x) => h("th", {}, x)))), tbody)))), "#/admin/evals");
  draw();
  return view;
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
function parseStoreSheet(buf) {
  const wb = XLSX.read(buf, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: false });
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  let hi = rows.slice(0, 6).findIndex((r) => r.some((c) => /store|branch|name/i.test(String(c))));
  let cols = { name: 0, code: -1, region: -1, username: -1, password: -1 };
  if (hi >= 0) {
    const head = rows[hi].map((c) => String(c).toLowerCase());
    const find = (re) => head.findIndex((c) => re.test(c));
    cols = { name: Math.max(0, find(/name|store|branch/)), code: find(/code|number|no\.?$|id/), region: find(/region|city|area/), username: find(/user/), password: find(/pass/) };
    if (cols.code === cols.name) cols.code = -1;
  }
  return rows.slice(hi + 1).map((r) => ({ name: cell(r, cols.name), code: cell(r, cols.code), region: cell(r, cols.region), username: cell(r, cols.username), password: cell(r, cols.password) })).filter((r) => r.name);
}

async function adminStores() {
  const stores = await api("/admin/stores");
  const out = h("div");
  const loginUrl = location.origin;

  const showCreds = (results) => {
    const created = results.filter((r) => r.status === "created");
    const copy = () => navigator.clipboard?.writeText(created.map((c) => `${c.name}\t${c.username}\t${c.password}`).join("\n")).then(() => toast("Copied"));
    out.replaceChildren(h("div", { class: "card" },
      h("div", { class: "row spread" }, h("h2", {}, `${created.length} login${created.length === 1 ? "" : "s"} created`),
        h("div", { class: "row" }, created.length > 0 && h("button", { class: "btn teal sm", onclick: () => download([["Store", "Username", "Password", "Login URL"], ...created.map((c) => [c.name, c.username, c.password, loginUrl])], `store-credentials-${new Date().toISOString().slice(0, 10)}.xlsx`, "Credentials") }, "Download credentials (Excel)"), created.length > 0 && h("button", { class: "btn ghost sm", onclick: copy }, "Copy"))),
      created.length > 0 && h("p", { class: "ok", style: "margin:10px 0" }, "Save these now — passwords are stored encrypted and cannot be shown again. You can always reset a store's password later."),
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Store", "Username", "Password", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, results.map((r) => h("tr", {}, h("td", {}, r.name), h("td", { class: "mono" }, r.username), h("td", { class: "mono" }, r.password || "—"), h("td", {}, r.status === "exists" ? h("span", { class: "chip warn" }, "already exists") : h("span", { class: "chip good" }, "new")))))))));
  };

  async function importRows(rows) {
    const results = []; const btnState = h("p", { class: "muted" }, "Creating logins…"); out.replaceChildren(btnState);
    try {
      for (let i = 0; i < rows.length; i += 5) {
        btnState.textContent = `Creating logins… ${Math.min(i + 5, rows.length)}/${rows.length}`;
        results.push(...(await api("/admin/stores/import", { method: "POST", body: { stores: rows.slice(i, i + 5) } })).results);
      }
    } catch (e) { toast(e.message); }
    showCreds(results);
    const fresh = await api("/admin/stores"); tableHolder.replaceChildren(storeTable(fresh));
  }

  async function onFile(file) {
    if (!file) return;
    try {
      const rows = parseStoreSheet(await file.arrayBuffer());
      if (!rows.length) return toast("No store names found in that file");
      out.replaceChildren(h("div", { class: "card" }, h("h2", {}, `${rows.length} store${rows.length === 1 ? "" : "s"} found`),
        h("p", { class: "muted small" }, "Stores that already exist are skipped. A username and a random password are generated for each new store."),
        h("div", { class: "table-wrap", style: "max-height:260px;overflow:auto" }, h("table", {}, h("thead", {}, h("tr", {}, ["Store", "Code", "Region"].map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, r.name), h("td", {}, r.code), h("td", {}, r.region)))))),
        h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "btn teal", onclick: () => importRows(rows) }, `Create ${rows.length} login${rows.length === 1 ? "" : "s"}`), h("button", { class: "btn ghost", onclick: () => out.replaceChildren() }, "Cancel"))));
    } catch (e) { toast("Could not read that file — use .xlsx or .csv"); }
  }

  const fileInput = h("input", { type: "file", accept: ".xlsx,.xls,.csv", class: "hidden", onchange: (e) => onFile(e.target.files[0]) });
  const drop = h("div", { class: "drop", onclick: () => fileInput.click(),
    ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); }, ondragleave: () => drop.classList.remove("over"),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); onFile(e.dataTransfer.files[0]); } },
    h("b", {}, "Drop your store list here, or click to choose a file"), h("div", { class: "muted small" }, "Excel (.xlsx) or CSV · first column = store name · optional columns: Store Code, Region"), fileInput);

  const storeTable = (rows) => rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Store", "Username", "Region", "Evaluations", "Last login", "Status", ""].map((x) => h("th", {}, x)))),
    h("tbody", {}, rows.map((s) => h("tr", {},
      h("td", {}, h("b", {}, s.name), s.code && h("div", { class: "small muted" }, s.code)), h("td", { class: "mono" }, s.username), h("td", {}, s.region || "—"), h("td", {}, s.evaluations), h("td", {}, fmtDate(s.last_login)),
      h("td", {}, s.active ? h("span", { class: "chip good" }, "Active") : h("span", { class: "chip bad" }, "Disabled")),
      h("td", { class: "row", style: "flex-wrap:nowrap" },
        h("button", { class: "btn ghost sm", onclick: async () => {
          if (!(await confirmBox("Reset password?", `A new password will be created for ${s.name}. Anyone signed in with the old one is signed out.`, "Reset"))) return;
          try { const r = await api(`/admin/stores/${s.id}/reset-password`, { method: "POST", body: {} });
            await modal("New password", h("div", {}, h("p", {}, s.name), h("p", { class: "mono" }, `Username: ${s.username}`), h("p", { class: "mono" }, `Password: ${r.password}`), h("p", { class: "muted small" }, "Shown once — copy it now.")), (close) => [h("button", { class: "btn teal", onclick: () => close(true) }, "Done")]);
          } catch (e) { toast(e.message); } } }, "Reset password"),
        h("button", { class: "btn ghost sm", onclick: async () => { try { await api(`/admin/stores/${s.id}`, { method: "PATCH", body: { active: !s.active } }); renderRoute(); } catch (e) { toast(e.message); } } }, s.active ? "Disable" : "Enable"),
        h("button", { class: "icon del", title: "Delete store", onclick: async () => { if (!(await confirmBox("Delete store?", `${s.name} will be removed. Stores with evaluations can only be disabled.`, "Delete", true))) return; try { await api(`/admin/stores/${s.id}`, { method: "DELETE" }); renderRoute(); } catch (e) { toast(e.message); } } }, "✕"))))))) : h("p", { class: "muted" }, "No stores yet.");
  const tableHolder = h("div", {}, storeTable(stores));

  const template = () => download([["Store Name", "Store Code", "Region"], ["HM Riyadh – Olaya", "RYD-01", "Riyadh"], ["HM Jeddah – Tahlia", "JED-01", "Jeddah"]], "stores-template.xlsx", "Stores");
  return shell(h("div", {}, pageHead("Stores", "Upload your store list to create one login per store.", h("button", { class: "btn ghost sm", onclick: template }, "Download template")),
    h("div", { class: "card" }, drop), out, h("div", { class: "card" }, h("h2", { style: "margin-bottom:10px" }, `All stores (${stores.length})`), tableHolder),
    h("p", { class: "muted small" }, `Stores sign in at ${loginUrl} with their username and password. Every store sees all questions for every position.`)), "#/admin/stores");
}

// ---------- router ----------
async function renderRoute() {
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
