// Store visit report → HM-branded email in the message body, delivered through Brevo's transactional API.
// Routes: GET  /api/sv/:id/email          suggestions, recognition list, send history
//         POST /api/sv/:id/email/preview  the exact email that would be sent
//         POST /api/sv/:id/email          send it
// Config: BREVO_API_KEY (dashboard variable/secret), MAIL_FROM, MAIL_FROM_NAME (wrangler vars).

const EMAIL = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]{2,}$/;
const MAX_CC = 10;
const DAILY_RECIPIENTS = 290;          // Brevo free plan: 300 emails a day; keep a small margin
const RECOGNISE_FROM = 85;             // team members at or above this score are pre-ticked for recognition

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nl = (s) => esc(s).replace(/\r?\n/g, "<br>");
const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const dmy = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d || "");
const svNo = (id) => `SV-${String(id).padStart(4, "0")}`;
const pctColor = (p) => (p == null ? "#6F675B" : p >= 85 ? "#2B8A74" : p >= 65 ? "#8A6633" : "#C2564A");

const teamAvg = (r) => {
  const s = (r.team?.rows || []).map((x) => x.score).filter((x) => x !== null && x !== undefined && x !== "");
  return s.length ? Math.round((10 * s.reduce((a, b) => a + +b, 0)) / s.length) / 10 : null;
};

// ---------- the email ----------
const F = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";
const TD = `${F}font-size:13px;line-height:1.5;color:#1D1B17;padding:9px 10px;border-bottom:1px solid #EFE6D9;vertical-align:top;`;
const TH = `${F}font-size:11px;font-weight:bold;color:#6F675B;text-align:left;padding:6px 10px;border-bottom:2px solid #D4B38B;`;
const heading = (t, color = "#D4B38B") =>
  `<tr><td style="padding:22px 28px 8px;"><div style="${F}font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#1D1B17;border-left:4px solid ${color};padding:2px 0 2px 10px;">${esc(t)}</div></td></tr>`;
const table = (heads, rows) =>
  `<tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
  `<tr>${heads.map(([h, w, align]) => `<th style="${TH}${w ? `width:${w};` : ""}${align ? `text-align:${align};` : ""}">${esc(h)}</th>`).join("")}</tr>` +
  rows.map((cells) => `<tr>${cells.map((c, i) => `<td style="${TD}${heads[i][2] ? `text-align:${heads[i][2]};` : ""}">${c}</td>`).join("")}</tr>`).join("") +
  `</table></td></tr>`;
const yes = (v, y = "✓ Yes", n = "✕ No") => (v === 1 || v === true ? `<b style="color:#2B8A74;">${y}</b>` : v === 0 || v === false ? `<b style="color:#C2564A;">${n}</b>` : `<span style="color:#6F675B;">—</span>`);

export function buildEmail(r, { note = "", recognise = [], senderName, senderTitle } = {}) {
  const store = `${r.store_code} · ${r.store_name}`;
  const subject = `Store Visit Report · ${r.store_code} ${r.store_name} · ${dmy(r.visit_date)}`;
  const tAvg = teamAvg(r);
  const readiness = (r.readiness || []).filter((x) => has(x.item));
  const quality = (r.quality || []).filter((x) => has(x.product));
  const team = (r.team?.rows || []).filter((x) => has(x.name));
  const highlights = (r.highlights || []).filter((x) => has(x.text));
  const actions = (r.actions || []).filter((x) => has(x.issue) || has(x.action));
  const stars = team.filter((_, i) => recognise.includes(i));
  const from = senderName || r.trainer_name || "Training Division";

  const tile = (v, label, bg, fg) =>
    `<td width="25%" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="${bg}" style="background:${bg};border-radius:6px;padding:12px 6px;text-align:center;${bg === "#F7F1E8" ? "border:1px solid #E4D6C2;" : ""}">` +
    `<div style="${F}font-size:22px;font-weight:bold;line-height:1.1;color:${fg};">${v == null ? "—" : esc(v) + "%"}</div>` +
    `<div style="${F}font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${fg};padding-top:4px;">${esc(label)}</div></td></tr></table></td>`;
  const info = (k1, v1, k2, v2) =>
    `<tr><td style="${TD}border:1px solid #E4D6C2;background:#FBF7F1;color:#6F675B;font-weight:bold;width:22%;">${k1}</td><td style="${TD}border:1px solid #E4D6C2;">${v1}</td>` +
    `<td style="${TD}border:1px solid #E4D6C2;background:#FBF7F1;color:#6F675B;font-weight:bold;width:22%;">${k2}</td><td style="${TD}border:1px solid #E4D6C2;">${v2}</td></tr>`;

  let rows = "";
  rows += `<tr><td bgcolor="#1D1B17" style="background:#1D1B17;padding:22px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="${F}font-size:19px;font-weight:bold;letter-spacing:6px;color:#F5EDE3;">HALF MILLION</td>` +
    `<td align="right" style="${F}font-size:10px;font-weight:bold;letter-spacing:3px;color:#D4B38B;">TRAINING DIVISION</td></tr></table></td></tr>`;
  rows += `<tr><td bgcolor="#D4B38B" style="background:#D4B38B;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>`;
  rows += `<tr><td style="padding:26px 28px 0;"><div style="${F}font-size:21px;font-weight:bold;color:#1D1B17;">Store Visit Report &amp; Training Feedback</div>` +
    `<div style="${F}font-size:12px;color:#6F675B;padding-top:4px;">Report ${svNo(r.id)}${r.visit_type ? ` · ${esc(r.visit_type)} visit` : ""}</div></td></tr>`;
  rows += `<tr><td style="padding:18px 28px 0;${F}font-size:14px;line-height:1.6;color:#1D1B17;">Hi ${esc(has(r.branch_manager) ? r.branch_manager : "team")},<br>Please find below the summary of the store visit for your review.` +
    (has(note) ? `<div style="padding-top:12px;font-style:italic;color:#4A443B;">${nl(note)}</div>` : "") + `</td></tr>`;
  rows += `<tr><td style="padding:18px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    info("Store", esc(store), "Date", esc(dmy(r.visit_date)) + (r.visit_time ? ` · ${esc(r.visit_time)}` : "")) +
    info("Visited by", esc(r.trainer_name || from), "MIC / AM", `${esc(r.branch_manager || "—")} / ${esc(r.area_manager || "—")}`) + `</table></td></tr>`;
  if (r.overall_score != null || r.readiness_pct != null || r.quality_avg != null || tAvg != null) {
    rows += `<tr><td style="padding:16px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
      tile(r.overall_score, `Overall${r.overall_rating ? " · " + r.overall_rating : ""}`, "#2B8A74", "#FFFFFF") + tile(r.readiness_pct, "Readiness", "#84C6B2", "#1D1B17") +
      tile(r.quality_avg, "Product quality", "#D4B38B", "#1D1B17") + tile(tAvg, "Team average", "#F7F1E8", "#1D1B17") + `</tr></table></td></tr>`;
  }
  if (highlights.length) rows += heading("Key highlights") + table([["Area", "32%"], ["Observation"]], highlights.map((x) => [`<b>${esc(x.text)}</b>`, nl(x.remarks || "") || (x.status === 1 ? "Achieved" : x.status === 0 ? "Not achieved" : "")]));
  if (readiness.length) rows += heading("Store readiness") + table([["Checkpoint"], ["Result", "16%"], ["Remarks"]], readiness.map((x) => [esc(x.item), yes(x.status), nl(x.remarks)]));
  if (quality.length) rows += heading("Product quality") + table([["Product"], ["Standard", "18%"], ["Score", "12%", "right"], ["Comments"]], quality.map((x) => [esc(x.product), yes(x.meets, "Meets", "Below"), x.score == null || x.score === "" ? "—" : `<b style="color:${pctColor(+x.score)};">${esc(x.score)}%</b>`, nl(x.comments)]));
  if (team.length) {
    const tl = r.team?.on_duty != null || r.team?.checked != null ? `<tr><td style="padding:0 28px 6px;${F}font-size:12px;color:#6F675B;">Employees on duty: ${esc(r.team?.on_duty ?? "—")} · Employees checked: ${esc(r.team?.checked ?? "—")}</td></tr>` : "";
    rows += heading("Team performance") + tl + table([["Team member"], ["Position"], ["Score", "12%", "right"], ["Observation"]], team.map((x) => [esc(x.name), esc(x.position), x.score == null || x.score === "" ? "—" : `<b style="color:${pctColor(+x.score)};">${esc(x.score)}%</b>`, nl(x.observation)]));
  }
  if (stars.length) {
    rows += `<tr><td style="padding:22px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#F7F1E8" style="background:#F7F1E8;border:1px solid #E4D6C2;border-radius:6px;padding:14px 16px;">` +
      `<div style="${F}font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#1D1B17;border-left:4px solid #D4B38B;padding:2px 0 2px 10px;">Recognition</div>` +
      `<div style="${F}font-size:13px;line-height:1.6;color:#1D1B17;padding:10px 0 6px;">On behalf of the Training Division, I would like to recognise the following team members for their hard work and dedication. <b>Excellent job!</b></div>` +
      stars.map((x) => `<div style="${F}font-size:13px;color:#1D1B17;padding:5px 0;border-top:1px solid #E4D6C2;">★ <b>${esc(x.name)}</b>${x.position ? ` <span style="color:#6F675B;">· ${esc(x.position)}</span>` : ""}</div>`).join("") +
      `</td></tr></table></td></tr>`;
  }
  if (actions.length) rows += heading("Action required", "#C2564A") + table([["#", "5%"], ["Topic", "26%"], ["Details"], ["Owner", "16%"], ["Due", "15%"]], actions.map((x, i) => [String(i + 1), `<b>${nl(x.issue)}</b>`, nl(x.action), esc(x.owner), esc(dmy(x.due))]));
  if (has(r.overall_comment)) rows += heading("Overall comment") + `<tr><td style="padding:0 28px;${F}font-size:14px;line-height:1.6;color:#1D1B17;">${nl(r.overall_comment)}</td></tr>`;
  rows += `<tr><td style="padding:24px 28px 0;${F}font-size:14px;line-height:1.6;color:#1D1B17;">Thank you for your continued support.<br><br>Best regards,<br><b>${esc(from)}</b><br><span style="color:#6F675B;">${esc(senderTitle ? senderTitle + " · " : "")}Training Division</span></td></tr>`;
  rows += `<tr><td style="padding:24px 28px 26px;"><div style="border-top:1px solid #E4D6C2;padding-top:14px;${F}font-size:11px;line-height:1.6;letter-spacing:1px;color:#6F675B;">HALF MILLION &nbsp;|&nbsp; Training Division &nbsp;|&nbsp; Store Visit Report ${svNo(r.id)}</div></td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#F5EDE3;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F5EDE3" style="background:#F5EDE3;"><tr><td align="center" style="padding:24px 8px;">` +
    // fluid up to 600px on phones and web mail; Outlook for Windows ignores max-width, so it gets a fixed 600px wrapper
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background:#FFFFFF;border-collapse:collapse;">${rows}</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table></body></html>`;

  // plain-text version for mail apps that do not show HTML
  const L = [`STORE VISIT REPORT & TRAINING FEEDBACK — ${svNo(r.id)}`, "", `Hi ${has(r.branch_manager) ? r.branch_manager : "team"},`, "Please find below the summary of the store visit for your review."];
  if (has(note)) L.push("", note);
  L.push("", `Store: ${store}`, `Date: ${dmy(r.visit_date)}${r.visit_time ? " " + r.visit_time : ""}`, `Visited by: ${r.trainer_name || from}`, `MIC / AM: ${r.branch_manager || "—"} / ${r.area_manager || "—"}`);
  L.push(`Overall: ${r.overall_score ?? "—"}%${r.overall_rating ? " (" + r.overall_rating + ")" : ""} · Readiness: ${r.readiness_pct ?? "—"}% · Product quality: ${r.quality_avg ?? "—"}% · Team average: ${tAvg ?? "—"}%`);
  if (highlights.length) L.push("", "KEY HIGHLIGHTS", ...highlights.map((x) => `- ${x.text}${x.remarks ? ": " + x.remarks : ""}`));
  if (readiness.length) L.push("", "STORE READINESS", ...readiness.map((x) => `- ${x.item}: ${x.status === 1 ? "Yes" : x.status === 0 ? "No" : "—"}${x.remarks ? " (" + x.remarks + ")" : ""}`));
  if (quality.length) L.push("", "PRODUCT QUALITY", ...quality.map((x) => `- ${x.product}: ${x.meets === 1 ? "meets" : x.meets === 0 ? "below" : "—"}${x.score != null && x.score !== "" ? ", " + x.score + "%" : ""}${x.comments ? " (" + x.comments + ")" : ""}`));
  if (team.length) L.push("", "TEAM PERFORMANCE", ...team.map((x) => `- ${x.name}${x.position ? " (" + x.position + ")" : ""}${x.score != null && x.score !== "" ? ": " + x.score + "%" : ""}${x.observation ? " — " + x.observation : ""}`));
  if (stars.length) L.push("", "RECOGNITION", ...stars.map((x) => `* ${x.name}`));
  if (actions.length) L.push("", "ACTION REQUIRED", ...actions.map((x, i) => `${i + 1}. ${x.issue || ""} — ${x.action || ""}${x.owner ? " · Owner: " + x.owner : ""}${x.due ? " · Due: " + dmy(x.due) : ""}`));
  if (has(r.overall_comment)) L.push("", "OVERALL COMMENT", r.overall_comment);
  L.push("", "Thank you for your continued support.", "", "Best regards,", from, `${senderTitle ? senderTitle + " · " : ""}Training Division`);
  return { subject, html, text: L.join("\n") };
}

// ---------- routes ----------
export async function svEmailRoutes({ path, method, env, session, isAdmin, body, bad, HttpError, json, report }) {
  const m = path.match(/^\/api\/sv\/(\d+)\/email(\/preview)?$/);
  if (!m) return null;
  const id = +m[1];
  const r = await report(id);                 // loads the report and checks the person may open it (404 otherwise)
  const sender = isAdmin ? { id: null, name: "Training Division", title: "" } : { id: session.trainer.id, name: session.trainer.name, title: session.trainer.designation };
  const recognisable = (r.team?.rows || []).map((x, i) => ({ i, name: x.name, position: x.position, score: x.score })).filter((x) => has(x.name));

  if (method === "GET" && !m[2]) {
    const [toStore, toAll, cc, hist] = await env.DB.batch([
      env.DB.prepare("SELECT email FROM email_book WHERE role='to' AND store_id=? ORDER BY last_used DESC LIMIT 10").bind(r.store_id),
      env.DB.prepare("SELECT email FROM email_book WHERE role='to' AND store_id<>? GROUP BY email ORDER BY MAX(last_used) DESC LIMIT 40").bind(r.store_id),
      env.DB.prepare("SELECT email FROM email_book WHERE role='cc' ORDER BY uses DESC, last_used DESC LIMIT 60"),
      env.DB.prepare("SELECT to_email, cc, sent_by_name, sent_at, status, error FROM sv_emails WHERE report_id=? ORDER BY id DESC LIMIT 20").bind(id),
    ]);
    const lastCc = hist.results.find((x) => x.status === "sent");
    return json({
      configured: !!(env.BREVO_API_KEY && env.MAIL_FROM), from: env.MAIL_FROM || null, from_name: env.MAIL_FROM_NAME || "HM Training Division",
      to_default: toStore.results[0]?.email || "", to_store: toStore.results.map((x) => x.email), to_other: toAll.results.map((x) => x.email), cc: cc.results.map((x) => x.email),
      cc_default: lastCc ? JSON.parse(lastCc.cc || "[]") : [],
      recognise: recognisable.map((x) => ({ ...x, checked: x.score !== null && x.score !== undefined && x.score !== "" && +x.score >= RECOGNISE_FROM })),
      history: hist.results.map((x) => ({ ...x, cc: JSON.parse(x.cc || "[]") })),
    });
  }
  if (method !== "POST") throw new HttpError(405, "Method not allowed");

  const b = await body();
  const note = String(b.note ?? "").trim().slice(0, 1000);
  const recognise = Array.isArray(b.recognise) ? b.recognise.filter((i) => Number.isInteger(i) && recognisable.some((x) => x.i === i)) : [];
  const mail = buildEmail(r, { note, recognise, senderName: sender.name, senderTitle: sender.title });
  if (m[2]) return json({ subject: mail.subject, html: mail.html });

  // ----- send -----
  const to = String(b.to ?? "").trim().toLowerCase();
  if (!EMAIL.test(to)) throw bad("Enter the store’s email address (for example store@example.com)");
  const ccList = [...new Set((Array.isArray(b.cc) ? b.cc : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].filter((x) => x !== to);
  const badCc = ccList.find((x) => !EMAIL.test(x));
  if (badCc) throw bad(`“${badCc}” is not a valid email address`);
  if (ccList.length > MAX_CC) throw bad(`You can copy up to ${MAX_CC} people`);
  if (!env.BREVO_API_KEY || !env.MAIL_FROM) throw new HttpError(503, "Email sending is not set up yet. Ask the admin to add the Brevo key.");

  const [today, recent] = await env.DB.batch([
    env.DB.prepare("SELECT COALESCE(SUM(recipients),0) n FROM sv_emails WHERE status='sent' AND sent_at >= date('now')"),
    env.DB.prepare("SELECT COUNT(*) n FROM sv_emails WHERE report_id=? AND status='sent' AND to_email=? AND sent_at >= datetime('now','-60 seconds')").bind(id, to),
  ]);
  if (recent.results[0].n) throw new HttpError(409, "This report was just sent to that address. Wait a minute before sending it again.");
  const recipients = 1 + ccList.length;
  if (today.results[0].n + recipients > DAILY_RECIPIENTS) throw new HttpError(429, "Today’s email allowance is used up. Please send this report tomorrow (the allowance resets at 3:00 Saudi time).");

  let status = "sent", messageId = null, error = null;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "HM Training Division" },
        to: [{ email: to }], ...(ccList.length ? { cc: ccList.map((email) => ({ email })) } : {}),
        subject: mail.subject, htmlContent: mail.html, textContent: mail.text, tags: ["store-visit-report"],
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) messageId = out.messageId || null;
    else { status = "failed"; error = `${res.status} ${out.code || ""} ${out.message || ""}`.trim().slice(0, 300); }
  } catch (e) { status = "failed"; error = String(e?.message || e).slice(0, 300); }

  const stmts = [env.DB.prepare("INSERT INTO sv_emails (report_id,to_email,cc,recipients,subject,sent_by,sent_by_name,status,message_id,error) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, to, JSON.stringify(ccList), recipients, mail.subject, sender.id, isAdmin ? "Admin" : sender.name, status, messageId, error)];
  if (status === "sent") {
    const remember = "INSERT INTO email_book (email,role,store_id) VALUES (?,?,?) ON CONFLICT(email,role,store_id) DO UPDATE SET uses=uses+1, last_used=CURRENT_TIMESTAMP";
    stmts.push(env.DB.prepare(remember).bind(to, "to", r.store_id), ...ccList.map((x) => env.DB.prepare(remember).bind(x, "cc", 0)));
  }
  await env.DB.batch(stmts);
  if (status !== "sent") {
    const why = /^401|unauthor|key/i.test(error || "") ? "the Brevo key was not accepted" : /sender|not valid|unverified/i.test(error || "") ? "the sender address is not verified in Brevo" : "the email service did not accept it";
    throw new HttpError(502, `The email was not sent: ${why}. Details: ${error}`);
  }
  return json({ ok: true, to, cc: ccList, message_id: messageId });
}
