// HM Staff Knowledge Evaluation — Cloudflare Worker (API) + D1.
// Static front-end lives in /public and is served by the assets binding.

const COOKIE = "hm_session";
const SESSION_TTL = 60 * 60 * 12; // 12 h
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW = 15 * 60; // seconds

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

function str(v, max, field, { required = false } = {}) {
  const s = (v ?? "").toString().trim();
  if (required && !s) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long (max ${max})`);
  return s;
}

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

// Passwords are stored encrypted (not hashed) so the admin can show them again. AES-GCM, key from PASSWORD_KEY secret.
async function aesKey(env) {
  if (!env.PASSWORD_KEY) throw new HttpError(500, "PASSWORD_KEY is not configured");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(env.PASSWORD_KEY)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptPassword(env, password) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(password));
  return `${b64u(iv)}.${b64u(ct)}`;
}
async function decryptPassword(env, stored) {
  if (!stored) return null;
  try {
    const [iv, ct] = stored.split(".");
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(env), unb64u(ct)));
  } catch { return null; }
}

const PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to type on a shared device
function randomPassword(len = 6) {
  const r = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(r, (x) => PW_ALPHABET[x % PW_ALPHABET.length]).join("");
}

function slug(s) {
  return (s || "").toString().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

// ---------- sessions ----------
async function signSession(env, payload) {
  const body = b64u(enc.encode(JSON.stringify({ ...payload, exp: now() + SESSION_TTL })));
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
  if (p.role === "store") {
    // Re-check on every request so deactivating a store or resetting its password takes effect immediately.
    const s = await env.DB.prepare("SELECT id,name,username,active,pw_version FROM stores WHERE id=?").bind(p.sid).first();
    if (!s || !s.active || s.pw_version !== p.pv) return null;
    return { role: "store", store: { id: s.id, name: s.name, username: s.username } };
  }
  if (p.role === "admin") return { role: "admin" };
  return null;
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function throttle(env, key) {
  const since = now() - ATTEMPT_WINDOW;
  await env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(since).run();
  const { n } = await env.DB.prepare("SELECT COUNT(*) n FROM login_attempts WHERE key=? AND at>=?").bind(key, since).first();
  if (n >= MAX_ATTEMPTS) throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");
}

// ---------- routes ----------
async function login(env, request) {
  const body = await request.json().catch(() => ({}));
  const username = str(body.username, 80, "Username", { required: true });
  const password = str(body.password, 200, "Password", { required: true });
  const key = username.toLowerCase();
  await throttle(env, key);
  const fail = async () => {
    await env.DB.prepare("INSERT INTO login_attempts (key,at) VALUES (?,?)").bind(key, now()).run();
    throw new HttpError(401, "Wrong username or password");
  };

  const adminUser = (env.ADMIN_USERNAME || "admin").toLowerCase();
  if (key === adminUser) {
    if (!env.ADMIN_PASSWORD || !(await safeEqual(env.SESSION_SECRET, password, env.ADMIN_PASSWORD))) return fail();
    const token = await signSession(env, { role: "admin" });
    return json({ role: "admin" }, 200, { "set-cookie": cookieHeader(request, token, SESSION_TTL) });
  }
  const s = await env.DB.prepare("SELECT * FROM stores WHERE username=?").bind(username).first();
  const stored = s && s.active ? await decryptPassword(env, s.password_enc) : null;
  if (stored === null || !(await safeEqual(env.SESSION_SECRET, password, stored))) return fail();
  await env.DB.prepare("UPDATE stores SET last_login=CURRENT_TIMESTAMP WHERE id=? AND (last_login IS NULL OR last_login < datetime('now','-1 hour'))").bind(s.id).run();
  const token = await signSession(env, { role: "store", sid: s.id, pv: s.pw_version });
  return json({ role: "store", store: { id: s.id, name: s.name } }, 200, { "set-cookie": cookieHeader(request, token, SESSION_TTL) });
}

// Full question tree for a position (active items only).
async function positionTree(env, positionId) {
  const pos = await env.DB.prepare("SELECT id,name FROM positions WHERE id=? AND active=1").bind(positionId).first();
  if (!pos) throw new HttpError(404, "Position not found");
  const secs = (await env.DB.prepare("SELECT id,title FROM sections WHERE position_id=? AND active=1 ORDER BY sort,id").bind(positionId).all()).results;
  const items = (await env.DB.prepare(
    "SELECT i.id,i.section_id,i.kind,i.text FROM items i JOIN sections s ON s.id=i.section_id WHERE s.position_id=? AND s.active=1 AND i.active=1 ORDER BY i.sort,i.id"
  ).bind(positionId).all()).results;
  const by = new Map(secs.map((s) => [s.id, { ...s, items: [] }]));
  for (const it of items) by.get(it.section_id)?.items.push({ id: it.id, kind: it.kind, text: it.text });
  return { ...pos, sections: [...by.values()] };
}

async function listPositions(env) {
  const rows = (await env.DB.prepare(
    `SELECT p.id,p.name,
       (SELECT COUNT(*) FROM sections s WHERE s.position_id=p.id AND s.active=1) sections,
       (SELECT COUNT(*) FROM items i JOIN sections s ON s.id=i.section_id WHERE s.position_id=p.id AND s.active=1 AND i.active=1 AND i.kind='question') questions
     FROM positions p WHERE p.active=1 ORDER BY p.sort,p.id`
  ).all()).results;
  return rows;
}

// Evaluation detail, with sections/answers. Submitted evaluations keep showing questions that were answered, even if later removed.
async function evaluationDetail(env, session, id) {
  const ev = await env.DB.prepare(
    `SELECT e.*, p.name position_name, st.name store_name FROM evaluations e
     JOIN positions p ON p.id=e.position_id JOIN stores st ON st.id=e.store_id WHERE e.id=?`
  ).bind(id).first();
  if (!ev || (session.role === "store" && ev.store_id !== session.store.id)) throw new HttpError(404, "Evaluation not found");

  const stored = JSON.parse(ev.answers_json || "{}");
  const answers = new Map(Object.entries(stored).map(([k, v]) => [+k, { trained: v[0], performed: v[1] }]));
  const skips = new Set(JSON.parse(ev.skips_json || "[]"));
  const submitted = ev.status === "submitted";
  const secs = (await env.DB.prepare("SELECT id,title,active FROM sections WHERE position_id=? ORDER BY sort,id").bind(ev.position_id).all()).results;
  const items = (await env.DB.prepare(
    "SELECT i.id,i.section_id,i.kind,i.text,i.active FROM items i JOIN sections s ON s.id=i.section_id WHERE s.position_id=? ORDER BY i.sort,i.id"
  ).bind(ev.position_id).all()).results;

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
      id: s.id, title: s.title, skipped, items: out,
      score: skipped ? null : qs.reduce((n, q) => n + (q.performed === 1 ? 1 : 0), 0),
      max: skipped ? null : qs.length,
    });
  }
  const { store_id, answers_json, skips_json, ...rest } = ev;
  return { ...rest, sections };
}

async function submitEvaluation(env, session, id) {
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
  await env.DB.batch([
    env.DB.prepare("UPDATE evaluations SET status='submitted',score=?,max_score=?,trained_count=?,submitted_at=CURRENT_TIMESTAMP WHERE id=?").bind(score, max, trained, id),
    ...perSection.map(([sid, sc, mx]) => env.DB.prepare("INSERT OR REPLACE INTO eval_sections (evaluation_id,section_id,score,max) VALUES (?,?,?,?)").bind(id, sid, sc, mx)),
  ]);
  return evaluationDetail(env, session, id);
}

async function saveAnswers(env, session, id, body) {
  const ev = await env.DB.prepare("SELECT store_id,status,answers_json,skips_json FROM evaluations WHERE id=?").bind(id).first();
  if (!ev || ev.store_id !== session.store.id) throw new HttpError(404, "Evaluation not found");
  if (ev.status !== "draft") throw bad("This evaluation is already submitted");
  // Item ids are not checked against the question list here (saves stay cheap); evaluationDetail/submit only ever read known items.
  const tri = (v) => (v === 1 || v === 0 ? v : null);
  const answers = JSON.parse(ev.answers_json || "{}");
  let n = 0;
  for (const a of (body.answers || []).slice(0, 500)) {
    if (!Number.isInteger(a.item_id) || a.item_id < 1) continue;
    answers[a.item_id] = [tri(a.trained), tri(a.performed)];
    n++;
  }
  let skips = ev.skips_json;
  if (Array.isArray(body.skip)) skips = JSON.stringify(body.skip.filter((x) => Number.isInteger(x)).slice(0, 100));
  const out = JSON.stringify(answers);
  if (out.length > 100000) throw bad("Too much data");
  await env.DB.prepare("UPDATE evaluations SET answers_json=?, skips_json=? WHERE id=?").bind(out, skips, id).run();
  return { saved: n };
}

// ----- admin: stores -----
// Stores arrive from the mapping sync without a password; give each a random one the first time an admin looks.
async function ensurePasswords(env) {
  const rows = (await env.DB.prepare("SELECT id FROM stores WHERE password_enc IS NULL LIMIT 120").all()).results;
  for (let i = 0; i < rows.length; i += 40) {
    const stmts = [];
    for (const r of rows.slice(i, i + 40)) stmts.push(env.DB.prepare("UPDATE stores SET password_enc=? WHERE id=? AND password_enc IS NULL").bind(await encryptPassword(env, randomPassword()), r.id));
    await env.DB.batch(stmts);
  }
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

async function summary(env) {
  const totals = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM stores WHERE active=1) stores,
            (SELECT COUNT(*) FROM evaluations WHERE status='submitted') evaluations,
            (SELECT COUNT(*) FROM evaluations WHERE status='draft') drafts,
            (SELECT ROUND(100.0*SUM(score)/NULLIF(SUM(max_score),0),1) FROM evaluations WHERE status='submitted') avg_pct,
            (SELECT ROUND(100.0*SUM(trained_count)/NULLIF(SUM(max_score),0),1) FROM evaluations WHERE status='submitted') trained_pct,
            (SELECT COUNT(*) FROM stores WHERE active=1 AND id IN (SELECT store_id FROM evaluations WHERE status='submitted')) active_stores`
  ).first();
  const byPosition = (await env.DB.prepare(
    `SELECT p.id,p.name,COUNT(e.id) evaluations,ROUND(100.0*SUM(e.score)/NULLIF(SUM(e.max_score),0),1) avg_pct
     FROM positions p LEFT JOIN evaluations e ON e.position_id=p.id AND e.status='submitted' WHERE p.active=1 GROUP BY p.id ORDER BY p.sort,p.id`
  ).all()).results;
  const byStore = (await env.DB.prepare(
    `SELECT s.id,s.name,s.username,s.total_staff,s.area_manager,s.rom,s.region,s.city,COUNT(e.id) evaluations,
            COALESCE(SUM(e.score),0) sum_score, COALESCE(SUM(e.max_score),0) sum_max,
            SUM(CASE WHEN e.submitted_at >= strftime('%Y-%m-01') THEN 1 ELSE 0 END) month_done,
            ROUND(100.0*SUM(e.score)/NULLIF(SUM(e.max_score),0),1) avg_pct
     FROM stores s LEFT JOIN evaluations e ON e.store_id=s.id AND e.status='submitted' WHERE s.active=1 GROUP BY s.id ORDER BY s.username LIMIT 300`
  ).all()).results;
  // weakest sections across all submitted evaluations
  const weakest = (await env.DB.prepare(
    `SELECT p.name position, s.title section, SUM(es.max) answered, ROUND(100.0*SUM(es.score)/SUM(es.max),1) pct
     FROM eval_sections es JOIN sections s ON s.id=es.section_id JOIN positions p ON p.id=s.position_id
     GROUP BY s.id HAVING SUM(es.max)>=5 ORDER BY pct ASC LIMIT 8`
  ).all()).results;
  return { totals, byPosition, byStore, weakest };
}

// ---------- router ----------
async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && !(request.headers.get("content-type") || "").includes("application/json")) throw bad("Expected JSON");
  let m;

  if (path === "/api/login" && method === "POST") return login(env, request);
  if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": cookieHeader(request, "", 0) });

  const session = await readSession(env, request);
  if (path === "/api/me") return json(session ? { role: session.role, store: session.store || null } : { role: null });
  if (!session) throw new HttpError(401, "Please sign in");
  const isAdmin = session.role === "admin";
  const needAdmin = () => { if (!isAdmin) throw new HttpError(403, "Admin only"); };
  const body = () => request.json().catch(() => { throw bad("Invalid JSON"); });

  // --- shared reads ---
  if (path === "/api/positions" && method === "GET") return json(await listPositions(env));
  if ((m = path.match(/^\/api\/positions\/(\d+)$/)) && method === "GET") return json(await positionTree(env, +m[1]));

  // --- store: evaluations ---
  if (path === "/api/evals" && method === "GET") {
    const where = isAdmin ? "1=1" : "e.store_id=?";
    const q = `SELECT e.id,e.staff_name,e.staff_code,e.status,e.score,e.max_score,e.trained_count,e.created_at,e.submitted_at,e.evaluator,e.position_id,p.name position_name,st.id store_id,st.name store_name,st.username store_code,st.area_manager,st.rom,st.region,st.city
               FROM evaluations e JOIN positions p ON p.id=e.position_id JOIN stores st ON st.id=e.store_id WHERE ${where} ORDER BY e.id DESC LIMIT 1000`;
    const stmt = env.DB.prepare(q);
    return json((await (isAdmin ? stmt : stmt.bind(session.store.id)).all()).results);
  }
  if (path === "/api/evals" && method === "POST") {
    if (isAdmin) throw new HttpError(403, "Evaluations are created from a store account");
    const b = await body();
    const pos = await env.DB.prepare("SELECT id FROM positions WHERE id=? AND active=1").bind(+b.position_id).first();
    if (!pos) throw bad("Choose a position");
    const r = await env.DB.prepare("INSERT INTO evaluations (store_id,position_id,staff_name,staff_code,evaluator,notes) VALUES (?,?,?,?,?,?)")
      .bind(session.store.id, pos.id, str(b.staff_name, 100, "Staff name", { required: true }), str(b.staff_code, 40, "Staff ID") || null, str(b.evaluator, 100, "Evaluator") || null, str(b.notes, 1000, "Notes") || null).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if ((m = path.match(/^\/api\/evals\/(\d+)$/))) {
    const id = +m[1];
    if (method === "GET") return json(await evaluationDetail(env, session, id));
    if (method === "DELETE") {
      const ev = await env.DB.prepare("SELECT store_id,status FROM evaluations WHERE id=?").bind(id).first();
      if (!ev || (!isAdmin && ev.store_id !== session.store.id)) throw new HttpError(404, "Not found");
      if (!isAdmin && ev.status !== "draft") throw new HttpError(403, "Only drafts can be deleted. Ask an admin to remove a submitted evaluation.");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM eval_sections WHERE evaluation_id=?").bind(id),
        env.DB.prepare("DELETE FROM evaluations WHERE id=?").bind(id),
      ]);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/evals\/(\d+)\/answers$/)) && method === "PUT") return json(await saveAnswers(env, session, +m[1], await body()));
  if ((m = path.match(/^\/api\/evals\/(\d+)\/meta$/)) && method === "PATCH") {
    const b = await body();
    const ev = await env.DB.prepare("SELECT store_id,status FROM evaluations WHERE id=?").bind(+m[1]).first();
    if (!ev || ev.store_id !== session.store?.id || ev.status !== "draft") throw new HttpError(404, "Not found");
    await env.DB.prepare("UPDATE evaluations SET staff_name=?,staff_code=?,evaluator=?,notes=? WHERE id=?")
      .bind(str(b.staff_name, 100, "Staff name", { required: true }), str(b.staff_code, 40, "Staff ID") || null, str(b.evaluator, 100, "Evaluator") || null, str(b.notes, 1000, "Notes") || null, +m[1]).run();
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/evals\/(\d+)\/submit$/)) && method === "POST") {
    if (isAdmin) throw new HttpError(403, "Evaluations are submitted from a store account");
    return json(await submitEvaluation(env, session, +m[1]));
  }

  // --- admin-only ---
  if (!path.startsWith("/api/admin/")) throw new HttpError(404, "Not found");
  needAdmin();

  if (path === "/api/admin/summary" && method === "GET") return json(await summary(env));

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
    if (method === "PATCH") { const b = await body(); await env.DB.prepare("UPDATE sections SET title=? WHERE id=?").bind(str(b.title, 200, "Section title", { required: true }), +m[1]).run(); return json({ ok: true }); }
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

  // stores
  if (path === "/api/admin/stores" && method === "GET") {
    await ensurePasswords(env);
    const last = await env.DB.prepare("SELECT at,total,added,disabled FROM sync_log ORDER BY id DESC LIMIT 1").first();
    return json({ lastSync: last || null, stores: (await env.DB.prepare(
      `SELECT s.id,s.name,s.region,s.city,s.area_manager,s.rom,s.username,s.active,s.total_staff,s.created_at,s.last_login,
         (SELECT COUNT(*) FROM evaluations e WHERE e.store_id=s.id AND e.status='submitted') evaluations,
         (SELECT COUNT(*) FROM evaluations e WHERE e.store_id=s.id AND e.status='submitted' AND e.submitted_at >= strftime('%Y-%m-01')) month_done
       FROM stores s ORDER BY s.username COLLATE NOCASE`
    ).all()).results });
  }
  if (path === "/api/admin/stores/passwords" && method === "GET") {
    await ensurePasswords(env);
    const rows = (await env.DB.prepare("SELECT id,password_enc FROM stores").all()).results;
    return json(Object.fromEntries(await Promise.all(rows.map(async (r) => [r.id, await decryptPassword(env, r.password_enc)]))));
  }
  if ((m = path.match(/^\/api\/admin\/stores\/(\d+)$/))) {
    const id = +m[1];
    if (method === "PATCH") {
      const b = await body();
      const total = b.total_staff === "" || b.total_staff === null ? -1 : b.total_staff != null ? parseInt(b.total_staff, 10) : null;
      if (total !== null && (!Number.isFinite(total) || total > 9999)) throw bad("Total staff must be a number");
      await env.DB.prepare("UPDATE stores SET name=COALESCE(?,name), region=COALESCE(?,region), active=COALESCE(?,active), total_staff=CASE WHEN ? IS NULL THEN total_staff WHEN ? < 0 THEN NULL ELSE ? END WHERE id=?")
        .bind(b.name != null ? str(b.name, 120, "Store name", { required: true }) : null, b.region != null ? str(b.region, 80, "Region") : null, b.active != null ? (b.active ? 1 : 0) : null, total, total, total, id).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const { n } = await env.DB.prepare("SELECT COUNT(*) n FROM evaluations WHERE store_id=?").bind(id).first();
      if (n) throw new HttpError(409, "This store has evaluations. Deactivate it instead of deleting.");
      await env.DB.prepare("DELETE FROM stores WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/api\/admin\/stores\/(\d+)\/reset-password$/)) && method === "POST") {
    const b = await body().catch(() => ({}));
    const password = str(b.password, 100, "Password") || randomPassword();
    if (password.length < 4) throw bad("Password must be at least 4 characters");
    // bumping pw_version signs out any device still logged in with the old password
    await env.DB.prepare("UPDATE stores SET password_enc=?, pw_version=pw_version+1 WHERE id=?").bind(await encryptPassword(env, password), +m[1]).run();
    return json({ password });
  }

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (!env.SESSION_SECRET) throw new HttpError(500, "SESSION_SECRET is not configured");
      return await handle(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  },
};
