// Workshop / Projects tab: workshops, projects, weekly accomplishments, upcoming weekly accomplishments.
// Stored in its own table (workshop_entries), so none of it reaches the dashboards.
// Trainers see and change only their own entries; the admin sees and changes everything.

export const WS_SECTIONS = {
  workshop: { label: "Workshop", titled: true },
  project: { label: "Project", titled: true },
  weekly: { label: "Weekly accomplishments", titled: false },
  upcoming: { label: "Upcoming weekly accomplishments", titled: false },
};
export const WS_STATUSES = ["open", "ongoing", "completed"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const COLS = `w.id, w.section, w.entry_date, w.title, w.details, w.status, w.trainer_id, w.created_by_name, w.created_at, w.updated_at,
  t.name trainer_name, t.employee_id trainer_employee_id, t.designation trainer_designation`;

export async function workshopRoutes({ path, method, url, env, session, isAdmin, body, bad, HttpError, json, str }) {
  if (!/^\/api\/workshop(\/|$)/.test(path)) return null;
  const mine = isAdmin ? null : session.trainer.id;

  const clean = (b, section) => {
    const def = WS_SECTIONS[section];
    if (!def) throw bad("Choose a section");
    const date = str(b.entry_date, 10, "Date", { required: true });
    const dt = new Date(`${date}T00:00:00Z`);
    if (!DATE.test(date) || Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== date) throw bad("Date must be a valid date");
    const status = String(b.status || "").toLowerCase();
    if (!WS_STATUSES.includes(status)) throw bad("Choose a status: Open, Ongoing or Completed");
    const title = def.titled ? str(b.title, 150, `${def.label} name`, { required: true }) : null;
    const details = str(b.details, 4000, def.titled ? "What was done" : "Accomplishments", { required: true });
    return { date, status, title, details };
  };

  // list: optional plain-date period on the entry date (df / dt, inclusive)
  if (path === "/api/workshop" && method === "GET") {
    const d = (k) => (DATE.test(url.searchParams.get(k) || "") ? url.searchParams.get(k) : null);
    const rows = (await env.DB.prepare(
      `SELECT ${COLS} FROM workshop_entries w LEFT JOIN trainers t ON t.id=w.trainer_id
       WHERE (?1 IS NULL OR w.trainer_id=?1) AND (?2 IS NULL OR w.entry_date >= ?2) AND (?3 IS NULL OR w.entry_date <= ?3)
       ORDER BY w.entry_date DESC, w.id DESC LIMIT 5000`
    ).bind(mine, d("df"), d("dt")).all()).results;
    return json(rows);
  }

  if (path === "/api/workshop" && method === "POST") {
    const b = await body();
    const v = clean(b, b.section);
    const r = await env.DB.prepare(
      "INSERT INTO workshop_entries (section,entry_date,title,details,status,trainer_id,created_by_name) VALUES (?,?,?,?,?,?,?)"
    ).bind(b.section, v.date, v.title, v.details, v.status, mine, isAdmin ? "Admin" : session.trainer.name).run();
    return json({ id: r.meta.last_row_id }, 201);
  }

  const m = path.match(/^\/api\/workshop\/(\d+)$/);
  if (m) {
    const id = +m[1];
    const cur = await env.DB.prepare("SELECT id, section, trainer_id FROM workshop_entries WHERE id=?").bind(id).first();
    if (!cur || (!isAdmin && cur.trainer_id !== session.trainer.id)) throw new HttpError(404, "Entry not found");
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM workshop_entries WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
    if (method === "PATCH") {
      const b = await body();
      // status-only change (the quick status picker in the list)
      if (Object.keys(b).length === 1 && "status" in b) {
        const status = String(b.status || "").toLowerCase();
        if (!WS_STATUSES.includes(status)) throw bad("Choose a status: Open, Ongoing or Completed");
        await env.DB.prepare("UPDATE workshop_entries SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, id).run();
        return json({ ok: true });
      }
      const v = clean(b, cur.section);
      await env.DB.prepare("UPDATE workshop_entries SET entry_date=?, title=?, details=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(v.date, v.title, v.details, v.status, id).run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, "Not found");
}
