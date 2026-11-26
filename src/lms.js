// LMS: multiple-choice quizzes.
//  - the admin writes quizzes and questions (only the admin)
//  - a trainer starts a session at a store: the questions are copied into the session (later edits never change past results)
//    and a QR code with an unguessable link is shown
//  - store staff open the link on their phone (no sign-in), enter name / employee ID / position and answer; the server marks it
//  - trainers see their own sessions and results, the admin sees everyone's
// The correct answers never leave the server before marking, and are not shown afterwards (score only).

const SESSION_HOURS = 2;
const MAX_ATTEMPTS = 300;          // per session: stops a link being flooded
const IP_LIMIT = 120;              // submissions per IP per 15 minutes (a store's staff often share one Wi-Fi)

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const newToken = () => b64u(crypto.getRandomValues(new Uint8Array(18)));
const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const plusHours = (h) => new Date(Date.now() + h * 3600e3).toISOString().slice(0, 19).replace("T", " ");

function cleanQuestion(b, bad, str) {
  const text = str(b.text, 500, "Question", { required: true });
  const options = (Array.isArray(b.options) ? b.options : []).map((o) => String(o ?? "").trim().slice(0, 200)).filter(Boolean);
  if (options.length < 2 || options.length > 5) throw bad("Give between 2 and 5 answer options");
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw bad("Two answer options are the same");
  const correct = Number(b.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw bad("Mark which option is the correct answer");
  return { text, options, correct };
}

// marks one set of answers against a session's question snapshot
function mark(questions, answers, passMark) {
  let score = 0;
  for (const q of questions) if (Number(answers?.[q.id]) === q.correct) score++;
  const total = questions.length, pct = total ? Math.round((1000 * score) / total) / 10 : 0;
  return { score, total, pct, passed: pct >= passMark ? 1 : 0 };
}

// per-question results for a list of sessions + attempts (how many got each question right)
function questionStats(sessions, attempts) {
  const byQ = new Map();
  const sess = new Map(sessions.map((s) => [s.id, s]));
  for (const a of attempts) {
    const s = sess.get(a.session_id); if (!s) continue;
    const ans = typeof a.answers === "string" ? JSON.parse(a.answers || "{}") : a.answers || {};
    for (const q of s.questions) {
      const k = `${s.quiz_id}|${q.text}`;
      const x = byQ.get(k) || { quiz_id: s.quiz_id, quiz: s.title, text: q.text, answered: 0, right: 0 };
      x.answered++; if (Number(ans[q.id]) === q.correct) x.right++; byQ.set(k, x);
    }
  }
  return [...byQ.values()].map((x) => ({ ...x, pct: x.answered ? Math.round((1000 * x.right) / x.answered) / 10 : null }));
}

// ---------- public (no sign-in): the page staff open from the QR code ----------
export async function lmsPublic({ path, method, request, env, ctx, bad, HttpError, json, str }) {
  const m = path.match(/^\/api\/quiz\/([A-Za-z0-9_-]{20,40})$/);
  if (!m) return null;
  const s = await env.DB.prepare(`SELECT ls.id, ls.title, ls.pass_mark, ls.questions, ls.closes_at, ls.closed_at, st.name store_name, st.username store_code
    FROM lms_sessions ls JOIN stores st ON st.id=ls.store_id WHERE ls.token=?`).bind(m[1]).first();
  if (!s) throw new HttpError(404, "This quiz link is not valid.");
  const open = !s.closed_at && s.closes_at > nowSql();
  const questions = JSON.parse(s.questions);
  if (method === "GET") {
    return json({ title: s.title, store: `${s.store_code} · ${s.store_name}`, open, count: questions.length, pass_mark: s.pass_mark,
      questions: open ? questions.map((q) => ({ id: q.id, text: q.text, options: q.options })) : [] });
  }
  if (method !== "POST") throw new HttpError(405, "Method not allowed");
  if (!open) throw new HttpError(410, "This quiz session has closed. Ask your trainer for a new QR code.");
  const ip = request.headers.get("cf-connecting-ip") || "local", key = `quiz:${ip}`, since = Math.floor(Date.now() / 1000) - 900;
  const [, ipCount, attempts] = await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(since),
    env.DB.prepare("SELECT COUNT(*) n FROM login_attempts WHERE key=? AND at>=?").bind(key, since),
    env.DB.prepare("SELECT COUNT(*) n FROM lms_attempts WHERE session_id=?").bind(s.id),
  ]);
  if (ipCount.results[0].n >= IP_LIMIT) throw new HttpError(429, "Too many answers from this network. Please wait a few minutes.");
  if (attempts.results[0].n >= MAX_ATTEMPTS) throw new HttpError(429, "This session is full. Ask your trainer for a new QR code.");
  const b = await request.json().catch(() => { throw bad("Invalid answers"); });
  const name = str(b.name, 100, "Your name", { required: true, min: 2 });
  const empId = str(b.emp_id, 40, "Employee ID", { required: true, min: 1 });
  const position = str(b.position, 60, "Position") || null;
  const answers = b.answers && typeof b.answers === "object" ? b.answers : {};
  const missing = questions.filter((q) => answers[q.id] == null || answers[q.id] === "").length;
  if (missing) throw bad(`Please answer every question (${missing} left)`);
  const r = mark(questions, answers, s.pass_mark);
  const clean = Object.fromEntries(questions.map((q) => [q.id, Number(answers[q.id])]));
  ctx.waitUntil(env.DB.prepare("INSERT INTO login_attempts (key,at) VALUES (?,?)").bind(key, Math.floor(Date.now() / 1000)).run());
  try {
    await env.DB.prepare("INSERT INTO lms_attempts (session_id,staff_name,emp_id,emp_key,position,answers,score,total,pct,passed) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(s.id, name, empId, empId.toLowerCase(), position, JSON.stringify(clean), r.score, r.total, r.pct, r.passed).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, "This employee ID has already answered this quiz.");
    throw e;
  }
  return json({ ok: true, ...r, pass_mark: s.pass_mark });
}

// ---------- signed-in routes ----------
export async function lmsRoutes({ path, method, url, env, session, isAdmin, body, bad, HttpError, json, str, from, to }) {
  let m;
  const needAdmin = () => { if (!isAdmin) throw new HttpError(403, "Only the admin can change quizzes"); };

  // --- admin: quizzes and questions ---
  if (path === "/api/admin/lms/quizzes" && method === "GET") {
    needAdmin();
    return json((await env.DB.prepare(`SELECT q.*, p.name position,
        (SELECT COUNT(*) FROM lms_questions x WHERE x.quiz_id=q.id AND x.active=1) questions,
        (SELECT COUNT(*) FROM lms_sessions s WHERE s.quiz_id=q.id) sessions,
        (SELECT COUNT(*) FROM lms_attempts a JOIN lms_sessions s ON s.id=a.session_id WHERE s.quiz_id=q.id) attempts
      FROM lms_quizzes q LEFT JOIN positions p ON p.id=q.position_id ORDER BY q.active DESC, q.title COLLATE NOCASE`).all()).results);
  }
  if (path === "/api/admin/lms/quizzes" && method === "POST") {
    needAdmin();
    const b = await body();
    const pass = Number(b.pass_mark ?? 80);
    if (!Number.isInteger(pass) || pass < 1 || pass > 100) throw bad("Pass mark must be a whole number from 1 to 100");
    const r = await env.DB.prepare("INSERT INTO lms_quizzes (title, position_id, pass_mark) VALUES (?,?,?)")
      .bind(str(b.title, 120, "Quiz title", { required: true, min: 2 }), b.position_id ? +b.position_id : null, pass).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/admin\/lms\/quizzes\/(\d+)$/))) {
    needAdmin();
    const id = +m[1];
    if (method === "GET") {
      const q = await env.DB.prepare("SELECT q.*, p.name position FROM lms_quizzes q LEFT JOIN positions p ON p.id=q.position_id WHERE q.id=?").bind(id).first();
      if (!q) throw new HttpError(404, "Quiz not found");
      const qs = (await env.DB.prepare("SELECT * FROM lms_questions WHERE quiz_id=? ORDER BY active DESC, sort, id").bind(id).all()).results.map((x) => ({ ...x, options: JSON.parse(x.options) }));
      return json({ ...q, questions: qs });
    }
    if (method === "PATCH") {
      const b = await body();
      const sets = [], vals = [];
      if (b.title !== undefined) { sets.push("title=?"); vals.push(str(b.title, 120, "Quiz title", { required: true, min: 2 })); }
      if (b.pass_mark !== undefined) { const p = Number(b.pass_mark); if (!Number.isInteger(p) || p < 1 || p > 100) throw bad("Pass mark must be a whole number from 1 to 100"); sets.push("pass_mark=?"); vals.push(p); }
      if (b.position_id !== undefined) { sets.push("position_id=?"); vals.push(b.position_id ? +b.position_id : null); }
      if (b.active !== undefined) { sets.push("active=?"); vals.push(b.active ? 1 : 0); }
      if (sets.length) await env.DB.prepare(`UPDATE lms_quizzes SET ${sets.join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...vals, id).run();
      return json({ ok: true });
    }
    // delete: only a quiz that was never run; one with results is turned off instead, so no staff results are lost
    if (method === "DELETE") {
      const used = await env.DB.prepare("SELECT COUNT(*) n, (SELECT COUNT(*) FROM lms_attempts a JOIN lms_sessions s ON s.id=a.session_id WHERE s.quiz_id=?1) answers FROM lms_sessions WHERE quiz_id=?1").bind(id).first();
      if (used.n) throw new HttpError(409, `This quiz has been run ${used.n} time${used.n === 1 ? "" : "s"} (${used.answers} staff answer${used.answers === 1 ? "" : "s"}), so it can't be deleted without losing those results. Turn it off instead — trainers stop seeing it and the results stay.`);
      await env.DB.batch([env.DB.prepare("DELETE FROM lms_questions WHERE quiz_id=?").bind(id), env.DB.prepare("DELETE FROM lms_quizzes WHERE id=?").bind(id)]);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/admin\/lms\/quizzes\/(\d+)\/questions$/)) && method === "POST") {
    needAdmin();
    const q = cleanQuestion(await body(), bad, str);
    const n = (await env.DB.prepare("SELECT COALESCE(MAX(sort),0)+1 n FROM lms_questions WHERE quiz_id=?").bind(+m[1]).first()).n;
    const r = await env.DB.prepare("INSERT INTO lms_questions (quiz_id, text, options, correct, sort) VALUES (?,?,?,?,?)").bind(+m[1], q.text, JSON.stringify(q.options), q.correct, n).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/admin\/lms\/questions\/(\d+)$/))) {
    needAdmin();
    if (method === "PATCH") {
      const b = await body();
      if (b.active !== undefined && b.text === undefined) { await env.DB.prepare("UPDATE lms_questions SET active=? WHERE id=?").bind(b.active ? 1 : 0, +m[1]).run(); return json({ ok: true }); }
      const q = cleanQuestion(b, bad, str);
      await env.DB.prepare("UPDATE lms_questions SET text=?, options=?, correct=? WHERE id=?").bind(q.text, JSON.stringify(q.options), q.correct, +m[1]).run();
      return json({ ok: true });
    }
  }

  // --- trainers (and admin to view): quizzes to run, sessions, results ---
  if (path === "/api/lms/quizzes" && method === "GET") {
    return json((await env.DB.prepare(`SELECT q.id, q.title, q.pass_mark, p.name position, (SELECT COUNT(*) FROM lms_questions x WHERE x.quiz_id=q.id AND x.active=1) questions
      FROM lms_quizzes q LEFT JOIN positions p ON p.id=q.position_id WHERE q.active=1 ORDER BY q.title COLLATE NOCASE`).all()).results.filter((q) => q.questions > 0));
  }
  if (path === "/api/lms/sessions" && method === "POST") {
    if (isAdmin) throw new HttpError(403, "Quiz sessions are started from a trainer account");
    const b = await body();
    const quiz = await env.DB.prepare("SELECT id, title, pass_mark FROM lms_quizzes WHERE id=? AND active=1").bind(+b.quiz_id).first();
    if (!quiz) throw bad("Choose a quiz");
    const store = await env.DB.prepare("SELECT id FROM stores WHERE id=? AND active=1").bind(+b.store_id).first();
    if (!store) throw bad("Choose the store");
    let visitId = null;
    if (b.visit_id) {
      const v = await env.DB.prepare("SELECT id, store_id FROM visits WHERE id=? AND trainer_id=?").bind(+b.visit_id, session.trainer.id).first();
      if (v && v.store_id === store.id) visitId = v.id;
    }
    const qs = (await env.DB.prepare("SELECT id, text, options, correct FROM lms_questions WHERE quiz_id=? AND active=1 ORDER BY sort, id").bind(quiz.id).all()).results
      .map((x) => ({ id: x.id, text: x.text, options: JSON.parse(x.options), correct: x.correct }));
    if (!qs.length) throw bad("This quiz has no questions yet");
    const token = newToken();
    const r = await env.DB.prepare("INSERT INTO lms_sessions (quiz_id, trainer_id, store_id, visit_id, token, title, pass_mark, questions, closes_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(quiz.id, session.trainer.id, store.id, visitId, token, quiz.title, quiz.pass_mark, JSON.stringify(qs), plusHours(SESSION_HOURS)).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  const SESS = `SELECT ls.id, ls.quiz_id, ls.trainer_id, ls.store_id, ls.visit_id, ls.title, ls.pass_mark, ls.opened_at, ls.closes_at, ls.closed_at,
      t.name trainer_name, st.username store_code, st.name store_name, st.region, st.city, st.area_manager,
      (SELECT COUNT(*) FROM lms_attempts a WHERE a.session_id=ls.id) attempts,
      (SELECT ROUND(AVG(a.pct),1) FROM lms_attempts a WHERE a.session_id=ls.id) avg_pct,
      (SELECT SUM(a.passed) FROM lms_attempts a WHERE a.session_id=ls.id) passed
    FROM lms_sessions ls JOIN trainers t ON t.id=ls.trainer_id JOIN stores st ON st.id=ls.store_id`;
  const status = (s) => (!s.closed_at && s.closes_at > nowSql() ? "open" : "closed");
  if (path === "/api/lms/sessions" && method === "GET") {
    const rows = (await env.DB.prepare(`${SESS} WHERE ls.opened_at >= ?1 AND ls.opened_at < ?2 AND (?3 IS NULL OR ls.trainer_id=?3) ORDER BY ls.id DESC LIMIT 500`)
      .bind(from, to, isAdmin ? null : session.trainer.id).all()).results;
    return json(rows.map((s) => ({ ...s, status: status(s) })));
  }
  if ((m = path.match(/^\/api\/lms\/sessions\/(\d+)(\/close)?$/))) {
    const s = await env.DB.prepare(`${SESS} WHERE ls.id=?`).bind(+m[1]).first();
    if (!s || (!isAdmin && s.trainer_id !== session.trainer.id)) throw new HttpError(404, "Session not found");
    if (m[2] && method === "POST") { await env.DB.prepare("UPDATE lms_sessions SET closed_at=CURRENT_TIMESTAMP WHERE id=? AND closed_at IS NULL").bind(s.id).run(); return json({ ok: true }); }
    if (method === "GET") {
      const full = await env.DB.prepare("SELECT token, questions FROM lms_sessions WHERE id=?").bind(s.id).first();
      const attempts = (await env.DB.prepare("SELECT id, session_id, staff_name, emp_id, position, answers, score, total, pct, passed, submitted_at FROM lms_attempts WHERE session_id=? ORDER BY id DESC").bind(s.id).all()).results;
      const questions = JSON.parse(full.questions);
      return json({ ...s, status: status(s), token: full.token,
        attempts: attempts.map(({ answers, ...a }) => a),
        questionStats: questionStats([{ ...s, questions }], attempts) });
    }
  }
  // all results in the period: trainers get their own, the admin gets everyone's (for the LMS dashboard and the reports)
  if (path === "/api/lms/results" && method === "GET") {
    const owner = isAdmin ? null : session.trainer.id;
    const [sess, snap, att] = await env.DB.batch([
      env.DB.prepare(`${SESS} WHERE ls.opened_at >= ?1 AND ls.opened_at < ?2 AND (?3 IS NULL OR ls.trainer_id=?3) ORDER BY ls.id DESC`).bind(from, to, owner),
      env.DB.prepare(`SELECT id, questions FROM lms_sessions WHERE opened_at >= ?1 AND opened_at < ?2 AND (?3 IS NULL OR trainer_id=?3)`).bind(from, to, owner),
      env.DB.prepare(`SELECT a.session_id, a.staff_name, a.emp_id, a.position, a.answers, a.score, a.total, a.pct, a.passed, a.submitted_at
        FROM lms_attempts a JOIN lms_sessions ls ON ls.id=a.session_id WHERE ls.opened_at >= ?1 AND ls.opened_at < ?2 AND (?3 IS NULL OR ls.trainer_id=?3) ORDER BY a.id DESC`).bind(from, to, owner),
    ]);
    const qmap = new Map(snap.results.map((x) => [x.id, JSON.parse(x.questions)]));
    const sessions = sess.results.map((s) => ({ ...s, status: status(s), questions: qmap.get(s.id) || [] }));
    return json({
      sessions: sessions.map(({ questions, ...s }) => ({ ...s, question_count: questions.length })),
      attempts: att.results.map(({ answers, ...a }) => a),
      questionStats: questionStats(sessions, att.results),
    });
  }
  return null;
}
