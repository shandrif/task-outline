// HM Training Division — Cloudflare Worker (API) + D1.
// Trainers sign up, visit stores and evaluate staff; the admin sees everything. Static front-end lives in /public.

import { moduleRoutes } from "./modules.js";

const COOKIE = "hm_session";
const SESSION_TTL = 60 * 60 * 12; // admin: 12 h
const TRAINER_TTL = 60 * 60 * 24 * 7; // trainers: 7 days
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW = 15 * 60; // seconds
const PBKDF2_ITERS = 4000;

// ---------- small helpers ----------
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const now = () => Math.floor(Date.now() / 1000);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

function str(v, max, field, { required = false, min = 0 } = {}) {
  const s = (v ?? "").toString().trim();
  if (required && !s) throw bad(`${field} is required`);
  if (s && s.length < min) throw bad(`${field} is too short (min ${min})`);
  if (s.length > max) throw bad(`${field} is too long (max ${max})`);
  return s;
}
// YYYY-MM-DD or null (used for date-range filters)
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null);
// "YYYY-MM-DD HH:MM:SS" (UTC) or null — range bounds sent by the browser
const ts = (v) => (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(v || "") ? v.replace("T", " ") : null);

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

async function safeEqual(secret, a, b) {
  const [x, y] = await Promise.all([hmac(secret, a), hmac(secret, b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// ---------- trainer passwords (hashed, never recoverable) ----------
// password -> HMAC(PASSWORD_KEY secret) -> PBKDF2. The secret lives in Cloudflare, not in the database, so a leaked database
// cannot be brute-forced offline. The iteration count is deliberately modest to stay inside the Workers Free ~10 ms CPU budget
// and is stored in every hash, so it can be raised later (e.g. on the paid plan).
async function pwBits(env, password, salt, iters, peppered) {
  if (peppered && !env.PASSWORD_KEY) throw new HttpError(500, "PASSWORD_KEY is not configured");
  const material = peppered ? await hmac(env.PASSWORD_KEY, password) : enc.encode(password);
  const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iters }, key, 256));
}
async function hashPassword(env, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2p$${PBKDF2_ITERS}$${b64u(salt)}$${b64u(await pwBits(env, password, salt, PBKDF2_ITERS, true))}`;
}
async function verifyPassword(env, password, stored) {
  const [alg, iters, salt, hash] = (stored || "").split("$");
  if ((alg !== "pbkdf2" && alg !== "pbkdf2p") || !hash) return false;
  const bits = await pwBits(env, password, unb64u(salt), +iters, alg === "pbkdf2p");
  const want = unb64u(hash);
  let d = bits.length ^ want.length;
  for (let i = 0; i < bits.length; i++) d |= bits[i] ^ (want[i] ?? 0);
  return d === 0;
}
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
function tempPassword(len = 10) {
  const r = crypto.getRandomValues(new Uint8Array(len + 2));
  const chars = Array.from(r.slice(0, len), (x) => TEMP_ALPHABET[x % TEMP_ALPHABET.length]);
  // always satisfy the password rule: at least one letter and one number
  chars[r[len] % len] = "ABCDEFGHJKLMNPQRSTUVWXYZ"[r[len] % 24];
  chars[(r[len] + 1 + (r[len + 1] % (len - 1))) % len] = "23456789"[r[len + 1] % 8];
  return chars.join("");
}
function checkPassword(p) {
  if (p.length < 8) throw bad("Password must be at least 8 characters");
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw bad("Password needs at least one letter and one number");
}

// ---------- sessions ----------
async function signSession(env, payload, ttl = SESSION_TTL) {
  const body = b64u(enc.encode(JSON.stringify({ ...payload, exp: now() + ttl })));
  return `${body}.${b64u(await hmac(env.SESSION_SECRET, body))}`;
}

async function readSession(env, request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig || !(await safeEqual(env.SESSION_SECRET, b64u(await hmac(env.SESSION_SECRET, body)), sig))) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(unb64u(body))); } catch { return null; }
  if (!p || p.exp < now()) return null;
  if (p.role === "trainer") {
    // Re-checked on every request: disabling a trainer or resetting a password takes effect immediately.
    const t = await env.DB.prepare("SELECT id,employee_id,name,designation,status,pw_version FROM trainers WHERE id=?").bind(p.tid).first();
    if (!t || t.status !== "approved" || t.pw_version !== p.pv) return null;
    return { role: "trainer", trainer: { id: t.id, employee_id: t.employee_id, name: t.name, designation: t.designation } };
  }
  if (p.role === "admin") return { role: "admin" };
  return null;
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ---------- auth routes ----------
async function login(env, request, ctx) {
  const body = await request.json().catch(() => ({}));
  const username = str(body.username, 80, "Employee ID", { required: true });
  const password = str(body.password, 200, "Password", { required: true });
  const key = username.toLowerCase();
  const since = now() - ATTEMPT_WINDOW;
  // one round trip: purge old attempts, count recent failures, load the trainer
  const [, attempts, found] = await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(since),
    env.DB.prepare("SELECT COUNT(*) n FROM login_attempts WHERE key=? AND at>=?").bind(key, since),
    env.DB.prepare("SELECT id,name,designation,employee_id,password_hash,status,pw_version FROM trainers WHERE employee_id=?").bind(username),
  ]);
  if (attempts.results[0].n >= MAX_ATTEMPTS) throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");
  const fail = () => {
    ctx.waitUntil(env.DB.prepare("INSERT INTO login_attempts (key,at) VALUES (?,?)").bind(key, now()).run());
    throw new HttpError(401, "Wrong employee ID or password");
  };

  const adminUser = (env.ADMIN_USERNAME || "admin").toLowerCase();
  if (key === adminUser) {
    if (!env.ADMIN_PASSWORD || !(await safeEqual(env.SESSION_SECRET, password, env.ADMIN_PASSWORD))) return fail();
    const token = await signSession(env, { role: "admin" });
    return json({ role: "admin" }, 200, { "set-cookie": cookieHeader(request, token, SESSION_TTL) });
  }
  const t = found.results[0];
  if (!t || !(await verifyPassword(env, password, t.password_hash))) return fail();
  if (t.status === "pending") throw new HttpError(403, "Your account is waiting for admin approval.");
  if (t.status !== "approved") throw new HttpError(403, "This account is disabled. Please contact the admin.");
  ctx.waitUntil(env.DB.prepare("UPDATE trainers SET last_login=CURRENT_TIMESTAMP WHERE id=?").bind(t.id).run());
  const token = await signSession(env, { role: "trainer", tid: t.id, pv: t.pw_version }, TRAINER_TTL);
  return json({ role: "trainer", trainer: { id: t.id, name: t.name, designation: t.designation, employee_id: t.employee_id } }, 200, { "set-cookie": cookieHeader(request, token, TRAINER_TTL) });
}

async function signup(env, request, ctx) {
  const b = await request.json().catch(() => ({}));
  const name = str(b.name, 80, "Name", { required: true, min: 2 });
  const employeeId = str(b.employee_id, 30, "Employee ID", { required: true, min: 2 });
  const designation = str(b.designation, 60, "Designation", { required: true, min: 2 });
  const password = str(b.password, 100, "Password", { required: true });
  if (!/^[A-Za-z0-9._-]+$/.test(employeeId)) throw bad("Employee ID can only contain letters, numbers, dots, dashes and underscores");
  if (employeeId.toLowerCase() === (env.ADMIN_USERNAME || "admin").toLowerCase() || employeeId.toUpperCase() === "LEGACY") throw bad("This employee ID is reserved");
  checkPassword(password);
  // light abuse guard: 10 sign-ups per 15 min per address
  const ip = request.headers.get("cf-connecting-ip") || "local", since = now() - ATTEMPT_WINDOW, key = `signup:${ip}`;
  const [, cnt] = await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(since),
    env.DB.prepare("SELECT COUNT(*) n FROM login_attempts WHERE key=? AND at>=?").bind(key, since),
  ]);
  if (cnt.results[0].n >= 10) throw new HttpError(429, "Too many sign-ups from this device. Try again later.");
  ctx.waitUntil(env.DB.prepare("INSERT INTO login_attempts (key,at) VALUES (?,?)").bind(key, now()).run());
  try {
    await env.DB.prepare("INSERT INTO trainers (employee_id,name,designation,password_hash) VALUES (?,?,?,?)").bind(employeeId, name, designation, await hashPassword(env, password)).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, "This employee ID is already registered. Try signing in instead.");
    throw e;
  }
  return json({ ok: true, status: "pending" }, 201);
}

// ---------- questions ----------
async function positionTree(env, positionId) {
  const [pos, secs, items] = await env.DB.batch([
    env.DB.prepare("SELECT id,name FROM positions WHERE id=? AND active=1").bind(positionId),
    env.DB.prepare("SELECT id,title,picker FROM sections WHERE position_id=? AND active=1 ORDER BY sort,id").bind(positionId),
    env.DB.prepare("SELECT i.id,i.section_id,i.kind,i.text FROM items i JOIN sections s ON s.id=i.section_id WHERE s.position_id=? AND s.active=1 AND i.active=1 ORDER BY i.sort,i.id").bind(positionId),
  ]);
  if (!pos.results[0]) throw new HttpError(404, "Position not found");
  const by = new Map(secs.results.map((s) => [s.id, { ...s, items: [] }]));
  for (const it of items.results) by.get(it.section_id)?.items.push({ id: it.id, kind: it.kind, text: it.text });
  return { ...pos.results[0], sections: [...by.values()] };
}

async function listPositions(env) {
  return (await env.DB.prepare(
    `SELECT p.id,p.name,
       (SELECT COUNT(*) FROM sections s WHERE s.position_id=p.id AND s.active=1) sections,
       (SELECT COUNT(*) FROM items i JOIN sections s ON s.id=i.section_id WHERE s.position_id=p.id AND s.active=1 AND i.active=1 AND i.kind='question') questions
     FROM positions p WHERE p.active=1 ORDER BY p.sort,p.id`
  ).all()).results;
}

// ---------- evaluations ----------
const isOwner = (session, ev) => session.role === "admin" || (session.role === "trainer" && ev.trainer_id === session.trainer.id);

// Evaluation detail, with sections/answers. Submitted evaluations keep showing questions that were answered, even if later removed.
async function evaluationDetail(env, session, id) {
  const [evRes, secRes, itemRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.*, p.name position_name, st.name store_name, st.username store_code, st.area_manager, st.rom, st.region, st.city,
              t.name trainer_name, t.employee_id trainer_employee_id, t.designation trainer_designation, v.started_at visit_started_at, v.status visit_status
       FROM evaluations e JOIN positions p ON p.id=e.position_id JOIN stores st ON st.id=e.store_id
       LEFT JOIN trainers t ON t.id=e.trainer_id LEFT JOIN visits v ON v.id=e.visit_id WHERE e.id=?`
    ).bind(id),
    env.DB.prepare("SELECT id,title,active,picker FROM sections WHERE position_id=(SELECT position_id FROM evaluations WHERE id=?) ORDER BY sort,id").bind(id),
    env.DB.prepare(
      "SELECT i.id,i.section_id,i.kind,i.text,i.active FROM items i JOIN sections s ON s.id=i.section_id WHERE s.position_id=(SELECT position_id FROM evaluations WHERE id=?) ORDER BY i.sort,i.id"
    ).bind(id),
  ]);
  const ev = evRes.results[0];
  if (!ev || !isOwner(session, ev)) throw new HttpError(404, "Evaluation not found");

  const stored = JSON.parse(ev.answers_json || "{}");
  const answers = new Map(Object.entries(stored).map(([k, v]) => [+k, { trained: v[0], performed: v[1] }]));
  const skips = new Set(JSON.parse(ev.skips_json || "[]"));
  const submitted = ev.status === "submitted";
  const secs = secRes.results, items = itemRes.results;

  const sections = [];
  for (const s of secs) {
    const mine = items.filter((i) => i.section_id === s.id).filter((i) => {
      if (i.kind !== "question") return i.active && s.active;
      return submitted ? answers.has(i.id) : i.active && s.active;
    });
    if (!mine.some((i) => i.kind === "question")) continue;
    const out = mine.map((i) => ({ id: i.id, kind: i.kind, text: i.text, ...(i.kind === "question" ? { trained: answers.get(i.id)?.trained ?? null, performed: answers.get(i.id)?.performed ?? null } : {}) }));
    const qs = out.filter((i) => i.kind === "question");
    const skipped = skips.has(s.id);
    sections.push({
      id: s.id, title: s.title, picker: s.picker ? 1 : 0, skipped, items: out,
      score: skipped ? null : qs.reduce((n, q) => n + (q.performed === 1 ? 1 : 0), 0),
      max: skipped ? null : qs.length,
    });
  }
  const { answers_json, skips_json, ...rest } = ev;
  return { ...rest, sections };
}

async function submitEvaluation(env, session, id, body) {
  const ev = await evaluationDetail(env, session, id);
  if (ev.status === "submitted") throw bad("Already submitted");
  const incomplete = [], perSection = [];
  let score = 0, max = 0, trained = 0;
  for (const s of ev.sections) {
    if (s.skipped) continue;
    const qs = s.items.filter((i) => i.kind === "question");
    const open = qs.filter((q) => q.performed === null || q.trained === null).length;
    if (open) incomplete.push(`${s.title} (${open} unanswered)`);
    for (const q of qs) { max++; score += q.performed === 1 ? 1 : 0; trained += q.trained === 1 ? 1 : 0; }
    perSection.push([s.id, qs.filter((q) => q.performed === 1).length, qs.length]);
  }
  if (max === 0) throw bad("Every section is marked not applicable — nothing to score.");
  if (incomplete.length) throw new HttpError(400, `Please answer every question first: ${incomplete.slice(0, 5).join("; ")}${incomplete.length > 5 ? "…" : ""}`);
  const notes = body && body.improvement_notes != null ? str(body.improvement_notes, 2000, "Areas for improvement") || null : null;
  await env.DB.batch([
    env.DB.prepare("UPDATE evaluations SET status='submitted',score=?,max_score=?,trained_count=?,submitted_at=CURRENT_TIMESTAMP,improvement_notes=COALESCE(?,improvement_notes) WHERE id=?").bind(score, max, trained, notes, id),
    ...perSection.map(([sid, sc, mx]) => env.DB.prepare("INSERT OR REPLACE INTO eval_sections (evaluation_id,section_id,score,max) VALUES (?,?,?,?)").bind(id, sid, sc, mx)),
  ]);
  return evaluationDetail(env, session, id);
}

async function saveAnswers(env, session, id, body) {
  // Item ids are not checked against the question list (keeps saves to one query); evaluationDetail/submit only ever read known items.
  const tri = (v) => (v === 1 || v === 0 ? v : null);
  const patch = {};
  let n = 0;
  for (const a of (body.answers || []).slice(0, 500)) {
    if (!Number.isInteger(a.item_id) || a.item_id < 1) continue;
    patch[a.item_id] = [tri(a.trained), tri(a.performed)];
    n++;
  }
  const skips = Array.isArray(body.skip) ? JSON.stringify(body.skip.filter((x) => Number.isInteger(x)).slice(0, 100)) : null;
  const notes = body.improvement_notes != null ? str(body.improvement_notes, 2000, "Areas for improvement") : null;
  const r = await env.DB.prepare(
    `UPDATE evaluations SET answers_json=json_patch(answers_json, ?1), skips_json=COALESCE(?2, skips_json), improvement_notes=COALESCE(?5, improvement_notes)
     WHERE id=?3 AND trainer_id=?4 AND status='draft' AND length(answers_json) < 100000`
  ).bind(JSON.stringify(patch), skips, id, session.trainer.id, notes).run();
  if (!r.meta.changes) throw new HttpError(404, "Evaluation not found, or it is already submitted");
  return { saved: n };
}

// ---------- reports (admin) ----------
// ?1 = from (inclusive), ?2 = to (exclusive), UTC timestamps; either may be NULL = unbounded
const RV = (a = "v") => `(?1 IS NULL OR ${a}.started_at >= ?1) AND (?2 IS NULL OR ${a}.started_at < ?2)`;
const RE = (a = "e") => `${a}.status='submitted' AND (?1 IS NULL OR ${a}.submitted_at >= ?1) AND (?2 IS NULL OR ${a}.submitted_at < ?2)`;

const VISITS_SQL = `SELECT v.id,v.status,v.started_at,v.ended_at,v.notes,v.follow_up,v.follow_up_date,v.trainer_id,
    t.name trainer_name,t.employee_id trainer_employee_id,t.designation trainer_designation,
    st.id store_id,st.name store_name,st.username store_code,st.area_manager,st.rom,st.region,st.city,
    (SELECT COUNT(*) FROM evaluations e WHERE e.visit_id=v.id AND e.status='submitted') evals,
    (SELECT COUNT(*) FROM evaluations e WHERE e.visit_id=v.id AND e.status='draft') drafts,
    (SELECT COUNT(DISTINCT lower(e.staff_name)) FROM evaluations e WHERE e.visit_id=v.id AND e.status='submitted') staff,
    (SELECT COALESCE(SUM(e.score),0) FROM evaluations e WHERE e.visit_id=v.id AND e.status='submitted') sum_score,
    (SELECT COALESCE(SUM(e.max_score),0) FROM evaluations e WHERE e.visit_id=v.id AND e.status='submitted') sum_max
  FROM visits v JOIN trainers t ON t.id=v.trainer_id JOIN stores st ON st.id=v.store_id`;

// Weakest areas / notes look at the latest 2,000 submitted evaluations in the period (date-indexed), so their cost stays small however much data builds up.
const WEAK_SQL = (extra = "") => `SELECT p.name position, s.title section, SUM(es.max) answered, ROUND(100.0*SUM(es.score)/SUM(es.max),1) pct
    FROM (SELECT e.id FROM evaluations e WHERE ${RE()} ${extra} ORDER BY e.submitted_at DESC LIMIT 2000) r
    JOIN eval_sections es ON es.evaluation_id=r.id JOIN sections s ON s.id=es.section_id JOIN positions p ON p.id=s.position_id
    GROUP BY s.id HAVING SUM(es.max)>=5 ORDER BY pct ASC LIMIT 8`;

const NOTES_SQL = (extra = "") => `SELECT e.id,e.staff_name,e.improvement_notes,e.submitted_at,p.name position,t.name trainer_name,st.name store_name,st.username store_code
    FROM evaluations e JOIN positions p ON p.id=e.position_id JOIN stores st ON st.id=e.store_id LEFT JOIN trainers t ON t.id=e.trainer_id
    WHERE ${RE()} AND e.improvement_notes IS NOT NULL AND e.improvement_notes<>'' ${extra} ORDER BY e.submitted_at DESC LIMIT 12`;

// One pass over the visits and one over the evaluations in the period (indexed by date), grouped; everything else is derived in memory.
// (Per-trainer / per-store correlated sub-queries re-scanned the same rows dozens of times.)
async function aggregate(env, from, to, trainerId = null) {
  const A = [from, to, trainerId];
  const who = "AND (?3 IS NULL OR e.trainer_id=?3)";
  const [trainers, stores, positions, visitAgg, evalAgg, posAgg, weakest, notes, misc] = await env.DB.batch([
    env.DB.prepare("SELECT id,employee_id,name,designation,status,created_at,approved_at,last_login,last_visit_at FROM trainers WHERE (?1 IS NULL OR id=?1)").bind(trainerId),
    env.DB.prepare("SELECT id,name,username,area_manager,rom,region,city,active,last_visit_at FROM stores WHERE active=1 ORDER BY username COLLATE NOCASE LIMIT 400"),
    env.DB.prepare("SELECT id,name FROM positions WHERE active=1 ORDER BY sort,id"),
    env.DB.prepare(`SELECT v.trainer_id, v.store_id, COUNT(*) n FROM visits v WHERE ${RV()} AND (?3 IS NULL OR v.trainer_id=?3) GROUP BY v.trainer_id, v.store_id`).bind(...A),
    // grouped by (trainer, store) — at most trainers x stores rows — so the Worker's own loop stays tiny
    env.DB.prepare(`SELECT e.trainer_id, e.store_id, COUNT(*) n, SUM(e.score) sc, SUM(e.max_score) mx, SUM(e.trained_count) tr, COUNT(DISTINCT lower(e.staff_name)) staff
                    FROM evaluations e WHERE ${RE()} ${who} GROUP BY e.trainer_id, e.store_id`).bind(...A),
    env.DB.prepare(`SELECT e.position_id, COUNT(*) n, SUM(e.score) sc, SUM(e.max_score) mx FROM evaluations e WHERE ${RE()} ${who} GROUP BY e.position_id`).bind(...A),
    env.DB.prepare(WEAK_SQL(who)).bind(...A),
    env.DB.prepare(NOTES_SQL(who)).bind(...A),
    env.DB.prepare("SELECT (SELECT COUNT(*) FROM trainers WHERE status='pending') pending, (SELECT COUNT(*) FROM trainers WHERE status='approved') approved, (SELECT COUNT(*) FROM evaluations WHERE status='draft') drafts"),
  ]);

  const T = new Map(trainers.results.map((t) => [t.id, { ...t, last_visit: t.last_visit_at, visits: 0, stores: new Set(), evaluations: 0, staff_evaluated: 0, sum_score: 0, sum_max: 0, sum_trained: 0 }]));
  const S = new Map(stores.results.map((x) => [x.id, { ...x, last_visit: x.last_visit_at, visits: 0, evaluations: 0, sum_score: 0, sum_max: 0 }]));
  const P = new Map(positions.results.map((x) => [x.id, { id: x.id, name: x.name, evaluations: 0, sc: 0, mx: 0 }]));
  const tot = { visits: 0, evaluations: 0, sc: 0, mx: 0, tr: 0 };
  for (const r of visitAgg.results) {
    tot.visits += r.n;
    const t = T.get(r.trainer_id); if (t) { t.visits += r.n; t.stores.add(r.store_id); }
    const st = S.get(r.store_id); if (st) st.visits += r.n;
  }
  for (const r of evalAgg.results) {
    tot.evaluations += r.n; tot.sc += r.sc || 0; tot.mx += r.mx || 0; tot.tr += r.tr || 0;
    const t = T.get(r.trainer_id); if (t) { t.evaluations += r.n; t.staff_evaluated += r.staff; t.sum_score += r.sc || 0; t.sum_max += r.mx || 0; t.sum_trained += r.tr || 0; }
    const st = S.get(r.store_id); if (st) { st.evaluations += r.n; st.sum_score += r.sc || 0; st.sum_max += r.mx || 0; }
  }
  for (const r of posAgg.results) { const p = P.get(r.position_id); if (p) { p.evaluations += r.n; p.sc += r.sc || 0; p.mx += r.mx || 0; } }
  const r1 = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const byStore = [...S.values()];
  return {
    totals: {
      stores: byStore.length, trainers: misc.results[0].approved, pending: misc.results[0].pending, drafts: misc.results[0].drafts,
      visits: tot.visits, stores_visited: byStore.filter((x) => x.visits > 0).length, evaluations: tot.evaluations,
      avg_pct: r1(tot.sc, tot.mx), trained_pct: r1(tot.tr, tot.mx), score: tot.sc, max: tot.mx, trained: tot.tr,
    },
    byTrainer: [...T.values()].map(({ stores: set, last_visit_at, ...t }) => ({ ...t, stores_visited: set.size })),
    byPosition: [...P.values()].map((p) => ({ id: p.id, name: p.name, evaluations: p.evaluations, avg_pct: r1(p.sc, p.mx) })),
    byStore, weakest: weakest.results, notes: notes.results,
  };
}

async function summary(env, from, to) {
  return aggregate(env, from, to);
}

async function trainerDetail(env, id, from, to) {
  const [agg, visits] = await Promise.all([
    aggregate(env, from, to, id),
    env.DB.prepare(`${VISITS_SQL} WHERE v.trainer_id=?3 AND ${RV()} ORDER BY v.id DESC LIMIT 1000`).bind(from, to, id).all(),
  ]);
  if (!agg.byTrainer[0]) throw new HttpError(404, "Trainer not found");
  return { trainer: agg.byTrainer[0], visits: visits.results, weakest: agg.weakest, notes: agg.notes, storesTotal: agg.totals.stores };
}

// ----- admin: ordering -----
async function move(env, table, id, dir, scopeCol) {
  const row = await env.DB.prepare(`SELECT id,sort,${scopeCol} scope FROM ${table} WHERE id=?`).bind(id).first();
  if (!row) throw new HttpError(404, "Not found");
  const op = dir === "up" ? "<" : ">";
  const order = dir === "up" ? "DESC" : "ASC";
  const nb = await env.DB.prepare(`SELECT id,sort FROM ${table} WHERE ${scopeCol}=? AND active=1 AND (sort ${op} ? OR (sort = ? AND id ${op} ?)) ORDER BY sort ${order}, id ${order} LIMIT 1`).bind(row.scope, row.sort, row.sort, row.id).first();
  if (!nb) return { moved: false };
  // Give distinct sort values then swap, so equal sorts never stall.
  const a = row.sort === nb.sort ? (dir === "up" ? nb.sort - 1 : nb.sort + 1) : nb.sort;
  await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET sort=? WHERE id=?`).bind(a, row.id),
    env.DB.prepare(`UPDATE ${table} SET sort=? WHERE id=?`).bind(row.sort, nb.id),
  ]);
  return { moved: true };
}

async function nextSort(env, table, col, val) {
  const r = await env.DB.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM ${table} WHERE ${col}=?`).bind(val).first();
  return r.n;
}

const STORE_FIELDS = (b) => ({
  name: b.name != null ? str(b.name, 120, "Store name", { required: true }) : null,
  code: b.code != null ? str(b.code, 40, "Store ID").replace(/\s+/g, "").toUpperCase() : null,
  area_manager: b.area_manager != null ? str(b.area_manager, 80, "Area manager") : null,
  rom: b.rom != null ? str(b.rom, 80, "ROM") : null,
  region: b.region != null ? str(b.region, 80, "Region") : null,
  city: b.city != null ? str(b.city, 80, "City") : null,
});

// ---------- router ----------
async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && !(request.headers.get("content-type") || "").includes("application/json")) throw bad("Expected JSON");
  let m;

  if (path === "/api/login" && method === "POST") return login(env, request, ctx);
  if (path === "/api/signup" && method === "POST") return signup(env, request, ctx);
  if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": cookieHeader(request, "", 0) });

  const session = await readSession(env, request);
  if (path === "/api/me") return json(session ? { role: session.role, trainer: session.trainer || null } : { role: null });
  if (!session) throw new HttpError(401, "Please sign in");
  const isAdmin = session.role === "admin";
  const needAdmin = () => { if (!isAdmin) throw new HttpError(403, "Admin only"); };
  const needTrainer = () => { if (isAdmin) throw new HttpError(403, "This action is done from a trainer account"); };
  const body = () => request.json().catch(() => { throw bad("Invalid JSON"); });
  const from = ts(url.searchParams.get("from")), to = ts(url.searchParams.get("to"));

  // --- onboarding / NPD / coaching / people development / store visit reports ---
  if (/^\/api\/(modules|records|home|sv)(\/|$)/.test(path)) {
    const r = await moduleRoutes({ path, method, url, env, session, isAdmin, from, to, body, bad, HttpError, json, str });
    if (r) return r;
  }

  // --- shared reads ---
  if (path === "/api/positions" && method === "GET") return json(await listPositions(env));
  if ((m = path.match(/^\/api\/positions\/(\d+)$/)) && method === "GET") return json(await positionTree(env, +m[1]));

  // --- stores (read-only list for the dropdown) ---
  if (path === "/api/stores" && method === "GET") {
    const [st, mine] = await env.DB.batch([
      env.DB.prepare("SELECT id,username code,name,region,city,area_manager,rom FROM stores WHERE active=1 ORDER BY name COLLATE NOCASE"),
      env.DB.prepare("SELECT store_id, COUNT(*) n, MAX(started_at) last_at FROM visits WHERE trainer_id=?1 GROUP BY store_id").bind(isAdmin ? null : session.trainer.id),
    ]);
    const by = new Map(mine.results.map((r) => [r.store_id, r]));
    return json(st.results.map((x) => ({ ...x, my_visits: by.get(x.id)?.n || 0, my_last_visit: by.get(x.id)?.last_at || null })));
  }
  if (path === "/api/my/stats" && method === "GET") {
    needTrainer();
    const [v, e] = await env.DB.batch([
      // last 30 days only (date-indexed), so the home page stays cheap however long someone has been visiting
      env.DB.prepare("SELECT COUNT(*) visits, COUNT(DISTINCT store_id) stores FROM visits WHERE trainer_id=? AND started_at >= datetime('now','-30 days')").bind(session.trainer.id),
      env.DB.prepare("SELECT COUNT(*) evaluations, COALESCE(SUM(score),0) sum_score, COALESCE(SUM(max_score),0) sum_max FROM evaluations WHERE trainer_id=? AND status='submitted' AND submitted_at >= datetime('now','-30 days')").bind(session.trainer.id),
    ]);
    return json({ ...v.results[0], ...e.results[0] });
  }
  if ((m = path.match(/^\/api\/stores\/(\d+)\/staff$/)) && method === "GET") {
    return json((await env.DB.prepare(
      `SELECT staff_name name, MAX(staff_code) code, position_id, COUNT(*) times, MAX(created_at) last_at
       FROM evaluations WHERE store_id=? GROUP BY lower(staff_name), position_id ORDER BY last_at DESC LIMIT 300`
    ).bind(+m[1]).all()).results);
  }

  // --- visits ---
  if (path === "/api/visits" && method === "GET") {
    const tid = isAdmin ? (url.searchParams.get("trainer") ? +url.searchParams.get("trainer") : null) : session.trainer.id;
    const more = url.searchParams.get("all") === "1";
    const limit = more ? 2000 : isAdmin ? 300 : 60;   // newest first; older rows load on request (keeps responses small and fast)
    return json((await env.DB.prepare(`${VISITS_SQL} WHERE (?3 IS NULL OR v.trainer_id=?3) AND ${RV()} ORDER BY v.id DESC LIMIT ${limit}`).bind(from, to, tid).all()).results);
  }
  if (path === "/api/visits" && method === "POST") {
    needTrainer();
    const b = await body();
    const store = await env.DB.prepare("SELECT id FROM stores WHERE id=? AND active=1").bind(+b.store_id).first();
    if (!store) throw bad("Choose a store");
    // continue an open visit to the same store (same shift) instead of creating a duplicate
    const open = await env.DB.prepare("SELECT id FROM visits WHERE trainer_id=? AND store_id=? AND status='open' AND started_at >= datetime('now','-18 hours') ORDER BY id DESC LIMIT 1").bind(session.trainer.id, store.id).first();
    if (open) return json({ id: open.id, existing: true });
    const [r] = await env.DB.batch([
      env.DB.prepare("INSERT INTO visits (trainer_id,store_id) VALUES (?,?)").bind(session.trainer.id, store.id),
      env.DB.prepare("UPDATE trainers SET last_visit_at=CURRENT_TIMESTAMP WHERE id=?").bind(session.trainer.id),
      env.DB.prepare("UPDATE stores SET last_visit_at=CURRENT_TIMESTAMP WHERE id=?").bind(store.id),
    ]);
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/visits\/(\d+)$/))) {
    const id = +m[1];
    if (method === "GET") {
      const [v, evs, staff] = await env.DB.batch([
        env.DB.prepare(`${VISITS_SQL} WHERE v.id=?`).bind(id),
        env.DB.prepare(
          `SELECT e.id,e.staff_name,e.staff_code,e.status,e.score,e.max_score,e.trained_count,e.submitted_at,e.created_at,e.improvement_notes,p.name position_name
           FROM evaluations e JOIN positions p ON p.id=e.position_id WHERE e.visit_id=? ORDER BY e.id`).bind(id),
        // people already evaluated at this store, to suggest names (and their usual position) when adding staff
        env.DB.prepare(
          `SELECT staff_name name, MAX(staff_code) code, position_id, MAX(created_at) last_at FROM evaluations
           WHERE store_id=(SELECT store_id FROM visits WHERE id=?) GROUP BY lower(staff_name), position_id ORDER BY last_at DESC LIMIT 300`).bind(id),
      ]);
      const visit = v.results[0];
      if (!visit || (!isAdmin && visit.trainer_id !== session.trainer.id)) throw new HttpError(404, "Visit not found");
      return json({ visit, evaluations: evs.results, staff: staff.results });
    }
    const own = await env.DB.prepare("SELECT trainer_id,store_id,status FROM visits WHERE id=?").bind(id).first();
    if (!own || (!isAdmin && own.trainer_id !== session.trainer.id)) throw new HttpError(404, "Visit not found");
    if (method === "PATCH") {
      const b = await body();
      const fu = b.follow_up ? 1 : 0;
      await env.DB.prepare("UPDATE visits SET notes=?, follow_up=?, follow_up_date=? WHERE id=?")
        .bind(str(b.notes, 3000, "Notes") || null, fu, fu ? day(b.follow_up_date) : null, id).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const { n } = await env.DB.prepare("SELECT COUNT(*) n FROM evaluations WHERE visit_id=? AND status='submitted'").bind(id).first();
      if (!isAdmin && n) throw new HttpError(403, "This visit has submitted evaluations. Ask an admin to remove it.");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM eval_sections WHERE evaluation_id IN (SELECT id FROM evaluations WHERE visit_id=?)").bind(id),
        env.DB.prepare("DELETE FROM evaluations WHERE visit_id=?").bind(id),
        env.DB.prepare("DELETE FROM visits WHERE id=?").bind(id),
        env.DB.prepare("UPDATE trainers SET last_visit_at=(SELECT MAX(started_at) FROM visits WHERE trainer_id=trainers.id) WHERE id=?").bind(own.trainer_id),
        env.DB.prepare("UPDATE stores SET last_visit_at=(SELECT MAX(started_at) FROM visits WHERE store_id=stores.id) WHERE id=?").bind(own.store_id),
      ]);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/visits\/(\d+)\/finish$/)) && method === "POST") {
    needTrainer();
    const id = +m[1];
    const [v, d] = await env.DB.batch([
      env.DB.prepare("SELECT status FROM visits WHERE id=? AND trainer_id=?").bind(id, session.trainer.id),
      env.DB.prepare("SELECT COUNT(*) n FROM evaluations WHERE visit_id=? AND status='draft'").bind(id),
    ]);
    if (!v.results[0]) throw new HttpError(404, "Visit not found");
    if (d.results[0].n) throw bad(`Finish or delete the ${d.results[0].n} unsubmitted evaluation${d.results[0].n === 1 ? "" : "s"} first`);
    const b = await request.json().catch(() => ({}));
    const fu = b.follow_up ? 1 : 0;
    await env.DB.prepare("UPDATE visits SET status='completed', ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP), notes=COALESCE(?,notes), follow_up=?, follow_up_date=? WHERE id=?")
      .bind(b.notes != null ? str(b.notes, 3000, "Notes") || null : null, fu, fu ? day(b.follow_up_date) : null, id).run();
    return json({ ok: true });
  }

  // --- evaluations ---
  if (path === "/api/evals" && method === "GET") {
    const full = url.searchParams.get("full") === "1";
    return json((await env.DB.prepare(
      `SELECT e.id,e.staff_name,e.staff_code,e.status,e.score,e.max_score,e.trained_count,e.created_at,e.submitted_at,${full ? "e.improvement_notes" : "substr(e.improvement_notes,1,200) improvement_notes"},e.position_id,e.visit_id,e.trainer_id,p.name position_name,
              st.id store_id,st.name store_name,st.username store_code,st.area_manager,st.rom,st.region,st.city,t.name trainer_name,t.employee_id trainer_employee_id
       FROM evaluations e JOIN positions p ON p.id=e.position_id JOIN stores st ON st.id=e.store_id LEFT JOIN trainers t ON t.id=e.trainer_id
       WHERE (?2 IS NULL OR e.trainer_id=?2) AND (?1 IS NULL OR e.created_at >= ?1) AND (?3 IS NULL OR e.created_at < ?3) ORDER BY e.id DESC LIMIT ${full || url.searchParams.get("all") === "1" ? 2000 : 300}`
    ).bind(from, isAdmin ? null : session.trainer.id, to).all()).results);
  }
  if (path === "/api/evals" && method === "POST") {
    needTrainer();
    const b = await body();
    const r = await env.DB.prepare(
      `INSERT INTO evaluations (store_id,position_id,staff_name,staff_code,visit_id,trainer_id,evaluator)
       SELECT v.store_id,p.id,?1,?2,v.id,v.trainer_id,?3 FROM visits v, positions p WHERE v.id=?4 AND v.trainer_id=?5 AND v.status='open' AND p.id=?6 AND p.active=1`
    ).bind(str(b.staff_name, 100, "Staff name", { required: true }), str(b.staff_code, 40, "Staff ID") || null, session.trainer.name, +b.visit_id, session.trainer.id, +b.position_id).run();
    if (!r.meta.changes) throw bad("This visit is finished or the position is not valid");
    // drinks are picked per evaluation: start with every drink excluded
    await env.DB.prepare("UPDATE evaluations SET skips_json=(SELECT COALESCE(json_group_array(id),'[]') FROM sections WHERE position_id=?1 AND active=1 AND picker=1) WHERE id=?2").bind(+b.position_id, r.meta.last_row_id).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/evals\/(\d+)$/))) {
    const id = +m[1];
    if (method === "GET") return json(await evaluationDetail(env, session, id));
    if (method === "DELETE") {
      const ev = await env.DB.prepare("SELECT trainer_id,status FROM evaluations WHERE id=?").bind(id).first();
      if (!ev || !isOwner(session, ev)) throw new HttpError(404, "Not found");
      if (!isAdmin && ev.status !== "draft") throw new HttpError(403, "Only drafts can be deleted. Ask an admin to remove a submitted evaluation.");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM eval_sections WHERE evaluation_id=?").bind(id),
        env.DB.prepare("DELETE FROM evaluations WHERE id=?").bind(id),
      ]);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/evals\/(\d+)\/answers$/)) && method === "PUT") { needTrainer(); return json(await saveAnswers(env, session, +m[1], await body())); }
  if ((m = path.match(/^\/api\/evals\/(\d+)\/meta$/)) && method === "PATCH") {
    needTrainer();
    const b = await body();
    const r = await env.DB.prepare("UPDATE evaluations SET staff_name=?,staff_code=?,improvement_notes=? WHERE id=? AND trainer_id=? AND status='draft'")
      .bind(str(b.staff_name, 100, "Staff name", { required: true }), str(b.staff_code, 40, "Staff ID") || null, str(b.improvement_notes, 2000, "Areas for improvement") || null, +m[1], session.trainer.id).run();
    if (!r.meta.changes) throw new HttpError(404, "Not found");
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/evals\/(\d+)\/submit$/)) && method === "POST") {
    needTrainer();
    return json(await submitEvaluation(env, session, +m[1], await request.json().catch(() => ({}))));
  }

  // --- admin-only ---
  if (!path.startsWith("/api/admin/")) throw new HttpError(404, "Not found");
  needAdmin();

  if (path === "/api/admin/summary" && method === "GET") return json(await summary(env, from, to));

  // trainers
  if (path === "/api/admin/trainers" && method === "GET") {
    return json((await aggregate(env, from, to)).byTrainer.sort((a, b) => (b.status === "pending") - (a.status === "pending") || a.name.localeCompare(b.name)));
  }
  if ((m = path.match(/^\/api\/admin\/trainers\/(\d+)$/))) {
    const id = +m[1];
    if (method === "GET") return json(await trainerDetail(env, id, from, to));
    if (method === "PATCH") {
      const b = await body();
      const status = ["pending", "approved", "disabled"].includes(b.status) ? b.status : null;
      let eid = null;
      if (b.employee_id != null) {
        eid = str(b.employee_id, 30, "Employee ID", { required: true, min: 2 });
        if (!/^[A-Za-z0-9._-]+$/.test(eid)) throw bad("Employee ID can only contain letters, numbers, dots, dashes and underscores");
      }
      try {
        await env.DB.prepare(
          `UPDATE trainers SET name=COALESCE(?1,name), designation=COALESCE(?2,designation), employee_id=COALESCE(?3,employee_id), status=COALESCE(?4,status),
             approved_at=CASE WHEN ?4='approved' AND approved_at IS NULL THEN CURRENT_TIMESTAMP ELSE approved_at END,
             pw_version=CASE WHEN ?4 IS NOT NULL AND ?4<>'approved' THEN pw_version+1 ELSE pw_version END
           WHERE id=?5 AND employee_id<>'LEGACY'`
        ).bind(b.name != null ? str(b.name, 80, "Name", { required: true, min: 2 }) : null, b.designation != null ? str(b.designation, 60, "Designation", { required: true, min: 2 }) : null, eid, status, id).run();
      } catch (e) {
        if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, "That employee ID is already used");
        throw e;
      }
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const { n } = await env.DB.prepare("SELECT COUNT(*) n FROM visits WHERE trainer_id=?").bind(id).first();
      if (n) throw new HttpError(409, "This trainer has visits. Disable the account instead of deleting it.");
      await env.DB.prepare("DELETE FROM trainers WHERE id=? AND employee_id<>'LEGACY'").bind(id).run();
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/admin\/trainers\/(\d+)\/reset-password$/)) && method === "POST") {
    const b = await body().catch(() => ({}));
    const password = str(b.password, 100, "Password") || tempPassword();
    checkPassword(password);
    // bumping pw_version signs the trainer out everywhere
    await env.DB.prepare("UPDATE trainers SET password_hash=?, pw_version=pw_version+1 WHERE id=? AND employee_id<>'LEGACY'").bind(await hashPassword(env, password), +m[1]).run();
    return json({ password });
  }

  // stores
  if (path === "/api/admin/stores" && method === "GET") {
    const [last, stores, vc] = await env.DB.batch([
      env.DB.prepare("SELECT at,total,added,disabled FROM sync_log ORDER BY id DESC LIMIT 1"),
      env.DB.prepare("SELECT s.id,s.username code,s.name,s.region,s.city,s.area_manager,s.rom,s.active,s.manual,s.locked,s.last_visit_at last_visit FROM stores s ORDER BY s.name COLLATE NOCASE"),
      env.DB.prepare("SELECT store_id, COUNT(*) n FROM visits GROUP BY store_id"),
    ]);
    const counts = new Map(vc.results.map((r) => [r.store_id, r.n]));
    stores.results = stores.results.map((x) => ({ ...x, visits: counts.get(x.id) || 0 }));
    return json({ lastSync: last.results[0] || null, stores: stores.results });
  }
  if (path === "/api/admin/stores" && method === "POST") {
    const f = STORE_FIELDS(await body());
    if (!f.name) throw bad("Store name is required");
    let code = f.code;
    if (!code) { // next free S### number for hand-added stores
      const { m: mx } = await env.DB.prepare("SELECT MAX(CAST(SUBSTR(username,2) AS INTEGER)) m FROM stores WHERE username GLOB 'S[0-9]*'").first();
      code = `S${String((mx || 0) + 1).padStart(3, "0")}`;
    }
    try {
      const r = await env.DB.prepare("INSERT INTO stores (name,code,username,area_manager,rom,region,city,manual,locked,active) VALUES (?,?,?,?,?,?,?,1,1,1)")
        .bind(f.name, code, code, f.area_manager || null, f.rom || null, f.region || null, f.city || null).run();
      return json({ id: r.meta.last_row_id }, 201);
    } catch (e) {
      if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, `Store ID “${code}” already exists`);
      throw e;
    }
  }
  if ((m = path.match(/^\/api\/admin\/stores\/(\d+)$/))) {
    const id = +m[1];
    if (method === "PATCH") {
      const b = await body();
      const f = STORE_FIELDS(b);
      if (f.code) {
        const cur = await env.DB.prepare("SELECT manual,username FROM stores WHERE id=?").bind(id).first();
        if (!cur) throw new HttpError(404, "Store not found");
        if (!cur.manual && f.code.toLowerCase() !== cur.username.toLowerCase()) throw bad("The Store ID of a store from the mapping file can't be changed (the weekly sync uses it)");
        if (f.code.toLowerCase() === cur.username.toLowerCase()) f.code = null;
      }
      try {
        await env.DB.prepare(
          `UPDATE stores SET name=COALESCE(?1,name), username=COALESCE(?2,username), code=COALESCE(?2,code), area_manager=COALESCE(?3,area_manager), rom=COALESCE(?4,rom),
             region=COALESCE(?5,region), city=COALESCE(?6,city), active=COALESCE(?7,active),
             locked=CASE WHEN ?1 IS NOT NULL OR ?2 IS NOT NULL OR ?3 IS NOT NULL OR ?4 IS NOT NULL OR ?5 IS NOT NULL OR ?6 IS NOT NULL THEN 1 ELSE locked END
           WHERE id=?8`
        ).bind(f.name, f.code || null, f.area_manager, f.rom, f.region, f.city, b.active != null ? (b.active ? 1 : 0) : null, id).run();
      } catch (e) {
        if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, "That Store ID already exists");
        throw e;
      }
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const { n } = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM visits WHERE store_id=?1)+(SELECT COUNT(*) FROM evaluations WHERE store_id=?1) n").bind(id).first();
      if (n) throw new HttpError(409, "This store has visits. Disable it instead of deleting.");
      await env.DB.prepare("DELETE FROM stores WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }

  // positions
  if (path === "/api/admin/positions" && method === "POST") {
    const b = await body();
    const name = str(b.name, 80, "Position name", { required: true });
    const n = (await env.DB.prepare("SELECT COALESCE(MAX(sort),0)+1 n FROM positions").first()).n;
    const r = await env.DB.prepare("INSERT INTO positions (name,sort) VALUES (?,?)").bind(name, n).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/admin\/positions\/(\d+)$/))) {
    if (method === "PATCH") { const b = await body(); await env.DB.prepare("UPDATE positions SET name=? WHERE id=?").bind(str(b.name, 80, "Position name", { required: true }), +m[1]).run(); return json({ ok: true }); }
    if (method === "DELETE") { await env.DB.prepare("UPDATE positions SET active=0 WHERE id=?").bind(+m[1]).run(); return json({ ok: true }); }
  }
  if ((m = path.match(/^\/api\/admin\/positions\/(\d+)\/sections$/)) && method === "POST") {
    const b = await body();
    const r = await env.DB.prepare("INSERT INTO sections (position_id,title,sort) VALUES (?,?,?)")
      .bind(+m[1], str(b.title, 200, "Section title", { required: true }), await nextSort(env, "sections", "position_id", +m[1])).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  // sections
  if ((m = path.match(/^\/api\/admin\/sections\/(\d+)$/))) {
    if (method === "PATCH") {
      const b = await body();
      if (b.picker !== undefined) await env.DB.prepare("UPDATE sections SET picker=? WHERE id=?").bind(b.picker ? 1 : 0, +m[1]).run();
      if (b.title !== undefined) await env.DB.prepare("UPDATE sections SET title=? WHERE id=?").bind(str(b.title, 200, "Section title", { required: true }), +m[1]).run();
      return json({ ok: true });
    }
    if (method === "DELETE") { await env.DB.prepare("UPDATE sections SET active=0 WHERE id=?").bind(+m[1]).run(); return json({ ok: true }); }
  }
  if ((m = path.match(/^\/api\/admin\/sections\/(\d+)\/move$/)) && method === "POST") return json(await move(env, "sections", +m[1], (await body()).dir === "up" ? "up" : "down", "position_id"));
  if ((m = path.match(/^\/api\/admin\/sections\/(\d+)\/items$/)) && method === "POST") {
    const b = await body();
    const kind = ["question", "heading", "note"].includes(b.kind) ? b.kind : "question";
    const r = await env.DB.prepare("INSERT INTO items (section_id,kind,text,sort) VALUES (?,?,?,?)")
      .bind(+m[1], kind, str(b.text, 1500, "Question text", { required: true }), await nextSort(env, "items", "section_id", +m[1])).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  // items
  if ((m = path.match(/^\/api\/admin\/items\/(\d+)$/))) {
    if (method === "PATCH") {
      const b = await body();
      const kind = ["question", "heading", "note"].includes(b.kind) ? b.kind : null;
      await env.DB.prepare("UPDATE items SET text=?, kind=COALESCE(?,kind) WHERE id=?").bind(str(b.text, 1500, "Question text", { required: true }), kind, +m[1]).run();
      return json({ ok: true });
    }
    if (method === "DELETE") { await env.DB.prepare("UPDATE items SET active=0 WHERE id=?").bind(+m[1]).run(); return json({ ok: true }); }
  }
  if ((m = path.match(/^\/api\/admin\/items\/(\d+)\/move$/)) && method === "POST") return json(await move(env, "items", +m[1], (await body()).dir === "up" ? "up" : "down", "section_id"));

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (!env.SESSION_SECRET) throw new HttpError(500, "SESSION_SECRET is not configured");
      return await handle(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  },
};
