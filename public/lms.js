/* LMS (Verification → LMS): the admin writes multiple-choice quizzes; a trainer starts a session at a store and shows a QR code;
   staff answer on their phones (quiz.html); results go to the trainer and to the admin. Loaded after app.js. */
"use strict";

let qrReady;
const loadQr = () => (window.qrcode ? Promise.resolve() : (qrReady ||= new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/vendor/qrcode.js"; s.onload = res; s.onerror = () => { qrReady = null; rej(new Error("Could not load the QR code — check your connection")); }; document.head.append(s); })));
const quizLink = (token) => `${location.origin}/quiz.html?t=${token}`;
const lmsPct = (v) => (v == null ? h("span", { class: "muted" }, "—") : h("b", { class: `pct ${pctClass(v)}` }, `${v}%`));
const passChip = (a) => (a.passed ? h("span", { class: "chip good" }, "Passed") : h("span", { class: "chip bad" }, "Not passed"));
const stChip = (s) => (s.status === "open" ? h("span", { class: "chip warn" }, "Open") : h("span", { class: "chip" }, "Closed"));

// ================= Verification → LMS =================
async function lmsView(query) {
  return session.role === "admin" ? lmsAdmin(query) : lmsTrainer(query);
}

// ---------- trainer: start a session, see own sessions and results ----------
async function lmsTrainer(query) {
  const [quizzes, stores, visits, res] = await Promise.all([api("/lms/quizzes"), cachedGet("/stores", 60000), api("/visits"), api("/lms/results" + rq())]);
  const openVisit = (query.get("visit") && visits.find((v) => v.id === +query.get("visit"))) || visits.find((v) => v.status === "open");
  const byLabel = new Map(stores.map((s) => [storeLabel(s).toLowerCase(), s]));
  const quizSel = h("select", {}, h("option", { value: "" }, quizzes.length ? "Choose a quiz" : "No quizzes yet — the admin adds them"), quizzes.map((q) => h("option", { value: q.id }, `${q.title}${q.position ? ` · ${q.position}` : ""} · ${q.questions} questions`)));
  const storeIn = h("input", { type: "text", list: "lms-stores", autocomplete: "off", placeholder: "Search a store", value: openVisit ? `${openVisit.store_code} · ${openVisit.store_name}` : "" });
  const err = h("p", { class: "err", style: "margin:0" });
  const start = h("button", { class: "btn teal", onclick: async () => {
    err.textContent = "";
    const st = byLabel.get(storeIn.value.trim().toLowerCase());
    if (!quizSel.value) return (err.textContent = "Choose a quiz");
    if (!st) return (err.textContent = "Choose the store from the list");
    start.disabled = true;
    try { const r = await api("/lms/sessions", { method: "POST", body: { quiz_id: +quizSel.value, store_id: st.id, visit_id: openVisit && openVisit.store_id === st.id ? openVisit.id : null } }); location.hash = `#/lms/s/${r.id}`; }
    catch (e) { err.textContent = e.message; start.disabled = false; }
  } }, "Start session · show QR");
  const g = grid({ rows: res.sessions, sort: { key: "opened_at", dir: -1 }, onRow: (s) => (location.hash = `#/lms/s/${s.id}`), empty: "No quiz sessions in this period.", searchIn: (s) => `${s.title} ${s.store_code} ${s.store_name}`,
    cols: [{ key: "opened_at", label: "Started", render: (s) => fmtDateTime(s.opened_at) }, { key: "title", label: "Quiz", render: (s) => h("b", {}, s.title) }, { key: "store_name", label: "Store", render: (s) => `${s.store_code} · ${s.store_name}` },
      { key: "attempts", label: "Staff", num: true }, { key: "avg_pct", label: "Average", num: true, render: (s) => lmsPct(s.avg_pct) }, { key: "passed", label: "Passed", num: true, render: (s) => `${s.passed || 0}/${s.attempts}` }, { key: "status", label: "", render: stChip }] });
  return shell(h("div", {},
    pageHead("LMS quizzes", "Show staff a QR code: they answer the quiz on their own phone, and the results come straight to you.", rangeBar()),
    h("datalist", { id: "lms-stores" }, stores.map((s) => h("option", { value: storeLabel(s) }))),
    h("div", { class: "card" }, h("h2", {}, "Start a quiz session"),
      h("div", { class: "grid g3", style: "margin-top:10px;align-items:end" }, field("Quiz", quizSel), field("Store", storeIn), h("div", {}, start)),
      openVisit && h("p", { class: "small muted", style: "margin:8px 0 0" }, `Linked to your open visit at ${openVisit.store_code} · ${openVisit.store_name}.`), err),
    lmsSummary(res, false),
    h("div", { class: "card" }, h("h2", {}, "My sessions"), g.el)), "#/lms");
}

// ---------- one session: the QR code (while open) and the live results ----------
async function lmsSessionView(id) {
  const s = await api(`/lms/sessions/${id}`);
  const mine = session.role === "trainer";
  const link = quizLink(s.token);
  const box = h("div", { class: "lms-qr" });
  if (s.status === "open") loadQr().then(() => { const q = qrcode(0, "M"); q.addData(link); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); }).catch((e) => box.replaceChildren(h("p", { class: "err" }, e.message)));
  const left = s.status === "open" ? Math.max(0, Math.round((Date.parse(s.closes_at.replace(" ", "T") + "Z") - Date.now()) / 60000)) : 0;
  const rows = h("div");
  const drawRows = (list) => rows.replaceChildren(list.length ? h("div", { class: "table-wrap" }, h("table", { class: "dtable" },
    h("thead", {}, h("tr", {}, ["Time", "Staff", "Employee ID", "Position", "Score", ""].map((x) => h("th", {}, x)))),
    h("tbody", {}, list.map((a) => h("tr", {}, h("td", {}, fmtDateTime(a.submitted_at)), h("td", {}, h("b", {}, a.staff_name)), h("td", {}, a.emp_id), h("td", {}, a.position || "—"), h("td", {}, `${a.score}/${a.total} · `, lmsPct(a.pct)), h("td", {}, passChip(a)))))))
    : h("p", { class: "muted" }, s.status === "open" ? "Waiting for the first answers… this list updates by itself." : "Nobody answered in this session."));
  // the three numbers above the results, worked out from the answers so they stay right as new ones arrive
  const kCount = h("div", { class: "v" }), kAvg = h("div", { class: "v" }), kPass = h("div", { class: "v" });
  const drawKpis = (list) => { kCount.textContent = list.length; kAvg.textContent = list.length ? `${Math.round((10 * list.reduce((n, a) => n + a.pct, 0)) / list.length) / 10}%` : "—"; kPass.textContent = `${list.filter((a) => a.passed).length}/${list.length}`; };
  drawRows(s.attempts); drawKpis(s.attempts);
  // live: refresh every 8 s while the session is open and this page is visible
  if (s.status === "open") {
    const timer = setInterval(async () => {
      if (!document.body.contains(rows)) return clearInterval(timer);
      if (document.hidden) return;
      try { const x = await api(`/lms/sessions/${id}`); drawRows(x.attempts); drawKpis(x.attempts); if (x.status !== "open") { clearInterval(timer); renderRoute(); } } catch {}
    }, 8000);
  }
  const close = mine && s.status === "open" && h("button", { class: "btn danger sm", onclick: async () => { if (!(await confirmBox("Close this session?", "The QR code stops working. Results are kept.", "Close session", true))) return; await api(`/lms/sessions/${id}/close`, { method: "POST" }); renderRoute(); } }, "Close session");
  const qs = [...s.questionStats].sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  return shell(h("div", {},
    pageHead(s.title, `${s.store_code} · ${s.store_name} · ${s.trainer_name} · started ${fmtDateTime(s.opened_at)}`, h("a", { class: "btn ghost sm", href: "#/lms" }, "← LMS"), stChip(s), close),
    s.status === "open" && h("div", { class: "card lms-show" },
      box,
      h("div", { class: "stack" },
        h("h2", { style: "margin:0" }, "Scan to answer"),
        h("p", { style: "margin:0" }, "Staff scan this with their phone camera, enter their name and employee ID, and answer. One go per employee ID."),
        h("div", { class: "small muted", style: "word-break:break-all" }, link),
        h("div", { class: "row" }, h("button", { class: "btn ghost sm", onclick: () => navigator.clipboard?.writeText(link).then(() => toast("Link copied")) }, "Copy link")),
        h("div", { class: "small muted" }, `Closes automatically in about ${left} minute${left === 1 ? "" : "s"}.`))),
    h("div", { class: "grid g3", style: "margin-bottom:16px" },
      h("div", { class: "kpi tealk" }, kCount, h("div", { class: "l" }, "Staff answered")),
      h("div", { class: "kpi" }, kAvg, h("div", { class: "l" }, "Average score")),
      h("div", { class: "kpi tank" }, kPass, h("div", { class: "l" }, `Passed · pass mark ${s.pass_mark}%`))),
    h("div", { class: "card" }, h("h2", {}, "Results"), rows),
    qs.length > 0 && h("div", { class: "card" }, h("h2", {}, "Questions · how many got them right"),
      h("div", { class: "tp-list" }, qs.map((q) => h("div", { class: "tp-row" }, h("b", {}, q.text), h("div", { class: "tp-track" }, h("i", { style: `width:${q.pct ?? 0}%` })), h("span", { class: "tp-n" }, `${q.right}/${q.answered}`), lmsPct(q.pct)))))), "#/lms");
}

// ---------- results summary (trainer: own; admin: everyone) ----------
function lmsSummary(res, admin) {
  const A = res.attempts, staff = new Set(A.map((a) => String(a.emp_id).toLowerCase())).size;
  const avg = A.length ? Math.round((10 * A.reduce((n, a) => n + a.pct, 0)) / A.length) / 10 : null;
  const passed = A.filter((a) => a.passed).length;
  return h("div", { class: "grid g4" },
    h("div", { class: "kpi tealk" }, h("div", { class: "v" }, res.sessions.length), h("div", { class: "l" }, `Quiz sessions${admin ? " · all trainers" : ""}`)),
    h("div", { class: "kpi" }, h("div", { class: "v" }, A.length), h("div", { class: "l" }, `Answers · ${staff} staff`)),
    h("div", { class: "kpi tank" }, h("div", { class: "v" }, fmtPct(avg)), h("div", { class: "l" }, "Average score")),
    h("div", { class: "kpi" }, h("div", { class: "v" }, A.length ? `${Math.round((100 * passed) / A.length)}%` : "—"), h("div", { class: "l" }, `Pass rate · ${passed} passed`)));
}

// ---------- admin: results dashboard + quizzes ----------
async function lmsAdmin(query) {
  const tab = query.get("tab") || "results";
  const seg = h("div", { class: "seg2" }, [["results", "Results"], ["quizzes", "Quizzes"]].map(([k, l]) => h("button", { type: "button", class: tab === k ? "on" : "", onclick: () => (location.hash = `#/lms?tab=${k}`) }, l)));
  if (tab === "quizzes") return lmsQuizList(seg);
  const res = await api("/lms/results" + rq());
  const sess = new Map(res.sessions.map((s) => [s.id, s]));
  const A = res.attempts.map((a) => ({ ...a, s: sess.get(a.session_id) || {} }));
  const roll = (keyFn) => { const m = new Map(); for (const a of A) { const k = keyFn(a) || "—"; const x = m.get(k) || { name: k, n: 0, sum: 0, passed: 0 }; x.n++; x.sum += a.pct; x.passed += a.passed; m.set(k, x); }
    return [...m.values()].map((x) => ({ ...x, avg: Math.round((10 * x.sum) / x.n) / 10, rate: Math.round((100 * x.passed) / x.n) })).sort((a, b) => b.n - a.n); };
  const rollTable = (title, rows, label) => h("div", { class: "card", style: "margin:0" }, h("h3", { style: "margin:0 0 8px" }, title),
    rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, [label, "Answers", "Average", "Pass rate"].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.slice(0, 12).map((x) => h("tr", {}, h("td", {}, h("b", {}, x.name)), h("td", {}, x.n), h("td", {}, lmsPct(x.avg)), h("td", {}, `${x.rate}%`)))))) : h("p", { class: "muted" }, "Nothing yet."));
  const hardest = [...res.questionStats].filter((q) => q.answered >= 3).sort((a, b) => a.pct - b.pct).slice(0, 10);
  const failed = A.filter((a) => !a.passed);
  const g = grid({ rows: res.sessions, sort: { key: "opened_at", dir: -1 }, onRow: (s) => (location.hash = `#/lms/s/${s.id}`), empty: "No quiz sessions in this period.", searchIn: (s) => `${s.title} ${s.trainer_name} ${s.store_code} ${s.store_name}`,
    filters: [{ key: "title", label: "quizzes" }, { key: "trainer_name", label: "trainers" }, { key: "region", label: "regions" }],
    cols: [{ key: "opened_at", label: "Started", render: (s) => fmtDateTime(s.opened_at) }, { key: "title", label: "Quiz", render: (s) => h("b", {}, s.title) }, { key: "trainer_name", label: "Trainer" },
      { key: "store_name", label: "Store", render: (s) => `${s.store_code} · ${s.store_name}` }, { key: "attempts", label: "Staff", num: true }, { key: "avg_pct", label: "Average", num: true, render: (s) => lmsPct(s.avg_pct) },
      { key: "passed", label: "Passed", num: true, render: (s) => `${s.passed || 0}/${s.attempts}` }, { key: "status", label: "", render: stChip }],
    toolbar: [h("button", { class: "btn teal sm", onclick: () => reportLms(res) }, "Export to Excel")] });
  return shell(h("div", {},
    pageHead("LMS", "Quizzes trainers ran in stores, and how staff did. Write and edit quizzes under “Quizzes”.", rangeBar(), seg),
    lmsSummary(res, true),
    h("div", { class: "grid g2", style: "margin-top:16px;align-items:start" }, rollTable("By quiz", roll((a) => a.s.title), "Quiz"), rollTable("By trainer", roll((a) => a.s.trainer_name), "Trainer"),
      rollTable("By store", roll((a) => a.s.store_code && `${a.s.store_code} · ${a.s.store_name}`), "Store"), rollTable("By region", roll((a) => a.s.region), "Region")),
    h("div", { class: "card", style: "margin-top:16px" }, h("h2", {}, "Hardest questions"), h("p", { class: "muted small" }, "Lowest share of staff answering correctly (questions answered 3+ times) — topics to train on."),
      hardest.length ? h("div", { class: "tp-list" }, hardest.map((q) => h("div", { class: "tp-row" }, h("span", {}, h("b", {}, q.text), h("div", { class: "small muted" }, q.quiz)), h("div", { class: "tp-track" }, h("i", { style: `width:${q.pct}%` })), h("span", { class: "tp-n" }, `${q.right}/${q.answered}`), lmsPct(q.pct)))) : h("p", { class: "muted" }, "Not enough answers yet.")),
    h("div", { class: "card" }, h("h2", {}, `Did not pass (${failed.length})`),
      failed.length ? h("div", { class: "table-wrap", style: "max-height:420px;overflow:auto" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, ["Staff", "Employee ID", "Quiz", "Store", "Trainer", "Score"].map((x) => h("th", {}, x)))),
        h("tbody", {}, failed.map((a) => h("tr", {}, h("td", {}, h("b", {}, a.staff_name)), h("td", {}, a.emp_id), h("td", {}, a.s.title), h("td", {}, `${a.s.store_code} · ${a.s.store_name}`), h("td", {}, a.s.trainer_name), h("td", {}, lmsPct(a.pct))))))) : h("p", { class: "muted" }, "Everyone passed. 🎉")),
    h("div", { class: "card" }, h("h2", {}, "Sessions"), g.el)), "#/lms");
}

async function lmsQuizList(seg) {
  const [quizzes, positions] = await Promise.all([api("/admin/lms/quizzes"), cachedGet("/positions")]);
  const title = h("input", { type: "text", maxlength: 120, placeholder: "e.g. Barista basics" });
  const pos = h("select", {}, h("option", { value: "" }, "Any position"), positions.map((p) => h("option", { value: p.id }, p.name)));
  const pass = h("input", { type: "number", min: 1, max: 100, value: 80 });
  const add = h("button", { class: "btn teal", onclick: async () => { try { const r = await api("/admin/lms/quizzes", { method: "POST", body: { title: title.value, position_id: pos.value || null, pass_mark: +pass.value } }); location.hash = `#/admin/lms/q/${r.id}`; } catch (e) { toast(e.message); } } }, "+ Create quiz");
  return shell(h("div", {},
    pageHead("LMS", "Write the quizzes here. Trainers see the active ones and run them in stores by QR code.", seg),
    h("div", { class: "card" }, h("h2", {}, "New quiz"), h("div", { class: "grid g4", style: "margin-top:10px;align-items:end" }, field("Title", title), field("Position (optional)", pos), field("Pass mark %", pass), h("div", {}, add))),
    h("div", { class: "card" }, h("h2", {}, "Quizzes"),
      quizzes.length ? h("div", { class: "table-wrap" }, h("table", { class: "dtable" }, h("thead", {}, h("tr", {}, ["Quiz", "Position", "Questions", "Pass mark", "Sessions", "Answers", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, quizzes.map((q) => h("tr", { class: "click" + (q.active ? "" : " off"), onclick: () => (location.hash = `#/admin/lms/q/${q.id}`) }, h("td", {}, h("b", {}, q.title), !q.active && h("span", { class: "chip bad", style: "margin-left:8px" }, "Off")), h("td", {}, q.position || "Any"),
          h("td", {}, q.questions), h("td", {}, `${q.pass_mark}%`), h("td", {}, q.sessions), h("td", {}, q.attempts), h("td", {}, h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end" }, h("span", { class: "btn ghost sm" }, "Edit"),
            h("button", { class: "icon del", title: q.sessions ? "Already run — turn it off instead" : "Delete quiz", "aria-label": `Delete ${q.title}`, onclick: async (e) => { e.stopPropagation();
              if (!(await confirmBox(`Delete “${q.title}”?`, "The quiz and its questions are removed permanently. A quiz that has already been run can't be deleted (its results are kept) — turn it off instead.", "Delete quiz", true))) return;
              try { await api(`/admin/lms/quizzes/${q.id}`, { method: "DELETE" }); toast("Quiz deleted"); renderRoute(); } catch (err) { toast(err.message); } } }, "🗑"))))))))
        : h("p", { class: "muted" }, "No quizzes yet. Create the first one above."))), "#/lms");
}

// ---------- admin: one quiz and its questions ----------
async function lmsQuizEditor(id) {
  const [q, positions] = await Promise.all([api(`/admin/lms/quizzes/${id}`), cachedGet("/positions")]);
  const reload = () => renderRoute();
  const t = h("input", { type: "text", maxlength: 120, value: q.title });
  const pos = h("select", {}, h("option", { value: "" }, "Any position"), positions.map((p) => h("option", { value: p.id, selected: p.id === q.position_id }, p.name)));
  const pass = h("input", { type: "number", min: 1, max: 100, value: q.pass_mark });
  const saveQuiz = h("button", { class: "btn ghost sm", onclick: async () => { try { await api(`/admin/lms/quizzes/${id}`, { method: "PATCH", body: { title: t.value, position_id: pos.value || null, pass_mark: +pass.value } }); toast("Quiz saved"); } catch (e) { toast(e.message); } } }, "Save");
  const toggle = h("button", { class: q.active ? "btn danger sm" : "btn teal sm", onclick: async () => { await api(`/admin/lms/quizzes/${id}`, { method: "PATCH", body: { active: !q.active } }); reload(); } }, q.active ? "Turn off" : "Turn on");
  const del = h("button", { class: "btn danger sm", onclick: async () => {
    if (!(await confirmBox(`Delete “${q.title}”?`, "The quiz and its questions are removed permanently. A quiz that has already been run can't be deleted (its results are kept) — turn it off instead.", "Delete quiz", true))) return;
    try { await api(`/admin/lms/quizzes/${id}`, { method: "DELETE" }); toast("Quiz deleted"); location.hash = "#/lms?tab=quizzes"; } catch (e) { toast(e.message); }
  } }, "Delete quiz");
  // question form (new or edit)
  const qForm = (existing) => {
    const text = h("textarea", { rows: 2, maxlength: 500, placeholder: "Question" }); text.value = existing?.text || "";
    const opts = [...(existing?.options || ["", "", "", ""])];
    let correct = existing ? existing.correct : 0;
    const list = h("div", { class: "stack" });
    const draw = () => list.replaceChildren(...opts.map((o, i) => h("div", { class: "row", style: "flex-wrap:nowrap;gap:8px" },
      h("input", { type: "radio", name: `c${existing?.id || "new"}`, checked: i === correct, title: "Correct answer", onchange: () => (correct = i) }),
      h("input", { type: "text", maxlength: 200, value: o, placeholder: `Option ${i + 1}`, oninput: (e) => (opts[i] = e.target.value) }),
      opts.length > 2 && h("button", { type: "button", class: "icon del", "aria-label": "Remove option", onclick: () => { opts.splice(i, 1); if (correct >= opts.length) correct = 0; else if (correct > i) correct--; draw(); } }, "✕"))),
      opts.length < 5 && h("button", { type: "button", class: "btn ghost sm", style: "justify-self:start", onclick: () => { opts.push(""); draw(); } }, "+ Option"));
    draw();
    const err = h("p", { class: "err", style: "margin:0" });
    const payload = () => ({ text: text.value, options: opts, correct });
    return { el: h("div", { class: "stack" }, text, h("div", { class: "small muted" }, "Tick the correct answer."), list, err), payload, err };
  };
  const nf = qForm(null);
  const addQ = h("button", { class: "btn teal", onclick: async () => { nf.err.textContent = ""; try { await api(`/admin/lms/quizzes/${id}/questions`, { method: "POST", body: nf.payload() }); toast("Question added"); reload(); } catch (e) { nf.err.textContent = e.message; } } }, "+ Add question");
  const editQ = async (x) => { const f = qForm(x); const ok = await modal("Edit question", f.el, (close) => [h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn teal", onclick: async () => { try { await api(`/admin/lms/questions/${x.id}`, { method: "PATCH", body: f.payload() }); close(true); } catch (e) { f.err.textContent = e.message; } } }, "Save")]); if (ok) reload(); };
  const active = q.questions.filter((x) => x.active);
  return shell(h("div", {},
    pageHead(q.title, `${active.length} question${active.length === 1 ? "" : "s"} · pass mark ${q.pass_mark}% · ${q.active ? "on — trainers can run it" : "off — hidden from trainers"}`, h("a", { class: "btn ghost sm", href: "#/lms?tab=quizzes" }, "← Quizzes"), toggle, del),
    h("div", { class: "card" }, h("h2", {}, "Quiz settings"), h("div", { class: "grid g4", style: "margin-top:10px;align-items:end" }, field("Title", t), field("Position", pos), field("Pass mark %", pass), h("div", {}, saveQuiz))),
    h("div", { class: "card" }, h("h2", {}, "Questions"),
      h("p", { class: "muted small" }, "Staff see the questions in a different order each time. Editing a question never changes results already collected."),
      q.questions.length ? h("div", { class: "stack" }, q.questions.map((x, n) => h("div", { class: "lms-q" + (x.active ? "" : " off") },
        h("div", { class: "row spread" }, h("b", {}, `${n + 1}. ${x.text}`), h("div", { class: "row", style: "flex-wrap:nowrap" },
          h("button", { class: "btn ghost sm", onclick: () => editQ(x) }, "Edit"),
          h("button", { class: "btn ghost sm", onclick: async () => { await api(`/admin/lms/questions/${x.id}`, { method: "PATCH", body: { active: !x.active } }); reload(); } }, x.active ? "Remove" : "Restore"))),
        h("ol", { type: "A", style: "margin:6px 0 0" }, x.options.map((o, i) => h("li", { class: i === x.correct ? "lms-right" : "" }, o, i === x.correct ? " ✓" : "")))))) : h("p", { class: "muted" }, "No questions yet.")),
    h("div", { class: "card" }, h("h2", {}, "Add a question"), nf.el, h("div", { class: "row", style: "justify-content:flex-end;margin-top:10px" }, addQ))), "#/lms");
}

// ---------- Excel ----------
function reportLms(res) {
  const sess = new Map(res.sessions.map((s) => [s.id, s]));
  const A = res.attempts.map((a) => ({ ...a, s: sess.get(a.session_id) || {} }));
  const avg = xAvg(A, (a) => a.pct), passed = A.filter((a) => a.passed).length;
  return hmReport({
    file: xFileName("LMS_Quiz_Results"), title: "LMS Quiz Results", period: periodText(), scope: "All trainers",
    kpis: [{ label: "Sessions", value: res.sessions.length, tone: "ink" }, { label: "Answers", value: A.length, tone: "tan" }, { label: "Staff", value: new Set(A.map((a) => String(a.emp_id).toLowerCase())).size, tone: "card" },
      { label: "Average score", value: avg, pct: true, tone: avg == null ? "card" : avg >= GOOD ? "good" : avg >= WARN ? "teal" : "bad" }, { label: "Pass rate", value: A.length ? Math.round((1000 * passed) / A.length) / 10 : null, pct: true, tone: "teal" }],
    sections: [
      xRollup("By quiz", null, A, (a) => a.s.title, { label: "Quiz", count: "Answers", pctFn: (a) => a.pct, pctLabel: "Average" }),
      xRollup("By trainer", null, A, (a) => a.s.trainer_name, { label: "Trainer", count: "Answers", pctFn: (a) => a.pct, pctLabel: "Average" }),
      xRollup("By region", null, A, (a) => a.s.region, { label: "Region", count: "Answers", pctFn: (a) => a.pct, pctLabel: "Average" }),
      { title: "Hardest questions", note: "lowest share answering correctly (answered 3+ times)", cols: [["Question", 5, "left"], ["Quiz", 2, "left"], ["Answered", 1], ["Correct", 1], ["", 1]],
        rows: [...res.questionStats].filter((q) => q.answered >= 3).sort((a, b) => a.pct - b.pct).slice(0, 12).map((q) => [cText(q.text), { v: q.quiz, align: "left" }, q.answered, cPct(q.pct), ""]), empty: "Not enough answers yet." },
    ],
    sheets: [
      { name: "Answers", title: "Every staff answer", rows: [...A].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))), summary: plural(A.length, "answer"),
        cols: [{ label: "When", get: (a) => a.submitted_at, type: "datetime" }, { label: "Staff", get: (a) => a.staff_name, bold: true, width: 22 }, { label: "Employee ID", get: (a) => a.emp_id, width: 12 }, { label: "Position", get: (a) => a.position, width: 16 },
          { label: "Quiz", get: (a) => a.s.title, width: 24 }, { label: "Score", get: (a) => `${a.score}/${a.total}`, width: 8 }, { label: "%", get: (a) => a.pct, type: "pct" }, { label: "Passed", get: (a) => (a.passed ? "Yes" : "No"), type: "yesno" },
          { label: "Store", get: (a) => `${a.s.store_code} · ${a.s.store_name}`, width: 26 }, { label: "Region", get: (a) => a.s.region, width: 12 }, { label: "Trainer", get: (a) => a.s.trainer_name, width: 20 }] },
      { name: "Sessions", title: "Quiz sessions", rows: res.sessions, summary: plural(res.sessions.length, "session"),
        cols: [{ label: "Started", get: (s) => s.opened_at, type: "datetime" }, { label: "Quiz", get: (s) => s.title, bold: true, width: 24 }, { label: "Trainer", get: (s) => s.trainer_name, width: 20 }, { label: "Store", get: (s) => `${s.store_code} · ${s.store_name}`, width: 26 },
          { label: "Region", get: (s) => s.region, width: 12 }, { label: "Staff", get: (s) => s.attempts, type: "int" }, { label: "Average", get: (s) => s.avg_pct, type: "pct" }, { label: "Passed", get: (s) => s.passed || 0, type: "int" }] },
    ],
  });
}
