/* Email a store visit report to the store (sent through Brevo by the server). Loaded after modules.js. */
"use strict";

const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]{2,}$/;

async function svEmailDialog(r, onSent) {
  let info;
  try { info = await api(`/sv/${r.id}/email`); } catch (e) { toast(e.message); return; }
  const err = h("p", { class: "err ws-err", style: "margin:0" });

  // To: one address, filled with the last one used for this store; suggestions = this store's earlier addresses first
  const to = h("input", { id: "sve-to", type: "email", value: info.to_default, list: "sve-dl-to", placeholder: "store@example.com", autocomplete: "off", spellcheck: "false" });
  const dir = info.directory || [];
  const dlTo = h("datalist", { id: "sve-dl-to" }, [...new Set([...info.to_store, ...info.to_other, ...dir.map((b) => b.email)])].map((x) => h("option", { value: x })));

  // CC: typed by hand; each address becomes a chip; earlier CCs are suggested
  const cc = [];
  const chips = h("div", { class: "sve-chips" });
  const ccIn = h("input", { id: "sve-cc", type: "email", list: "sve-dl-cc", placeholder: "Type an address and press Enter", autocomplete: "off", spellcheck: "false" });
  const dlCc = h("datalist", { id: "sve-dl-cc" });
  const recent = h("div", { class: "sve-recent" });
  const paintCc = () => {
    chips.replaceChildren(...cc.map((x) => h("span", { class: "chip sve-chip" }, x, h("button", { type: "button", "aria-label": `Remove ${x}`, onclick: () => { cc.splice(cc.indexOf(x), 1); paintCc(); } }, "✕"))));
    const left = info.cc.filter((x) => !cc.includes(x));
    dlCc.replaceChildren(...[...new Set([...left, ...(info.directory || []).map((b) => b.email.toLowerCase())])].filter((x) => !cc.includes(x)).map((x) => h("option", { value: x })));
    recent.replaceChildren(...(left.length ? [h("span", { class: "small muted" }, "Recent:"), ...left.slice(0, 6).map((x) => h("button", { type: "button", class: "sve-sug", onclick: () => addCc(x) }, "+ " + x))] : []));
  };
  const addCc = (v) => {
    const parts = String(v).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    for (const p of parts) {
      if (!EMAIL_RE.test(p)) { err.textContent = `“${p}” is not a valid email address`; return false; }
      if (!cc.includes(p) && p !== to.value.trim().toLowerCase()) cc.push(p);
    }
    err.textContent = ""; ccIn.value = ""; paintCc(); return true;
  };
  // ---- branch directory: search by branch name or email; likely matches for this store are offered, never filled in silently ----
  const normB = (s) => String(s || "").toLowerCase().replace(/half\s*million|halfm|\bhm\b|\bbranch\b|\bbr\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const grams = (s) => { const t = ` ${normB(s)} `, m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const dice = (a, b) => { const A = grams(a), B = grams(b); let n = 0, ta = 0, tb = 0; for (const v of A.values()) ta += v; for (const v of B.values()) tb += v; for (const [g, v] of A) n += Math.min(v, B.get(g) || 0); return ta + tb ? (2 * n) / (ta + tb) : 0; };
  const byEmail = new Map(dir.map((b) => [b.email.toLowerCase(), b]));
  const toHint = h("div", { class: "small sve-hint" });
  const likelyEl = h("div", { class: "sve-recent" });
  const likely = dir.map((b) => ({ b, s: Math.max(dice(r.store_name, b.name), dice(r.store_name, b.email.split("@")[0])) })).sort((a, b) => b.s - a.s).slice(0, 3).filter((x) => x.s >= 0.35);
  const paintTo = () => {
    const hit = byEmail.get(to.value.trim().toLowerCase());
    toHint.textContent = hit ? `✓ ${hit.name} (from the branch list)` : "";
    likelyEl.replaceChildren(...(!to.value.trim() && likely.length ? [h("span", { class: "small muted" }, `Likely for ${r.store_name}:`), ...likely.map((x) => h("button", { type: "button", class: "sve-sug", onclick: () => pickTo(x.b) }, x.b.name))] : []));
  };
  const search = h("input", { id: "sve-search", type: "search", placeholder: "Search branches by name or email…", autocomplete: "off", spellcheck: "false" });
  const results = h("div", { class: "sve-results", role: "listbox", "aria-label": "Branches" });
  const clearSearch = () => { search.value = ""; results.replaceChildren(); };
  const pickTo = (b) => { to.value = b.email; clearSearch(); err.textContent = ""; paintTo(); };
  const resRow = (b) => h("div", { class: "sve-res", role: "option" },
    h("button", { type: "button", class: "sve-res-main", onclick: () => pickTo(b) }, h("b", {}, b.name), h("span", { class: "muted small" }, b.email)),
    h("button", { type: "button", class: "btn ghost sm", title: `Add ${b.email} as CC`, onclick: () => { addCc(b.email); clearSearch(); } }, "+ CC"));
  let hits = [];
  search.addEventListener("input", () => {
    const words = normB(search.value).split(" ").filter(Boolean);
    if (!words.length) { hits = []; results.replaceChildren(); return; }
    hits = dir.filter((b) => { const hay = `${normB(b.name)} ${b.email.toLowerCase()}`; return words.every((w) => hay.includes(w)); }).slice(0, 8);
    results.replaceChildren(...(hits.length ? hits.map(resRow) : [h("div", { class: "small muted", style: "padding:8px 10px" }, "No branch matches. You can still type any address in To.")]));
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (hits[0]) pickTo(hits[0]); } else if (e.key === "Escape" && search.value) { e.stopPropagation(); clearSearch(); } });
  to.addEventListener("input", paintTo);
  paintTo();

  ccIn.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === "," || e.key === ";") && ccIn.value.trim()) { e.preventDefault(); addCc(ccIn.value); } });
  ccIn.addEventListener("change", () => { if (info.cc.includes(ccIn.value.trim().toLowerCase())) addCc(ccIn.value); });
  ccIn.addEventListener("blur", () => { if (ccIn.value.trim()) addCc(ccIn.value); });
  paintCc();

  const note = h("textarea", { id: "sve-note", rows: 2, maxlength: 1000, placeholder: "Optional — appears under the greeting" });
  const picks = info.recognise.map((x) => {
    const box = h("input", { type: "checkbox", id: `sve-r${x.i}`, checked: x.checked });
    return { i: x.i, box, el: h("label", { class: "sve-check", for: `sve-r${x.i}` }, box, h("span", {}, h("b", {}, x.name), x.position ? ` · ${x.position}` : "", x.score !== null && x.score !== undefined && x.score !== "" ? h("span", { class: "muted" }, ` · ${x.score}%`) : "")) };
  });
  const payload = () => ({ to: to.value.trim(), cc: [...cc], note: note.value.trim(), recognise: picks.filter((p) => p.box.checked).map((p) => p.i) });

  // preview: the exact email, rendered from the server
  const frame = h("iframe", { class: "sve-frame", title: "Email preview", sandbox: "" });
  const previewWrap = h("div", { class: "sve-preview", hidden: true }, frame);
  const previewBtn = h("button", { type: "button", class: "btn ghost sm", onclick: async () => {
    if (!previewWrap.hidden) { previewWrap.hidden = true; previewBtn.textContent = "Preview email"; return; }
    previewBtn.disabled = true;
    try { const p = await api(`/sv/${r.id}/email/preview`, { method: "POST", body: payload() }); frame.srcdoc = p.html; previewWrap.hidden = false; previewBtn.textContent = "Hide preview"; }
    catch (e) { err.textContent = e.message; } finally { previewBtn.disabled = false; }
  } }, "Preview email");

  const history = info.history.length ? h("div", { class: "sve-hist" }, h("div", { class: "small muted", style: "font-weight:700" }, "Sent before"),
    info.history.slice(0, 5).map((x) => h("div", { class: "small" }, x.status === "sent" ? h("span", { class: "chip good" }, "Sent") : h("span", { class: "chip bad", title: x.error || "" }, "Failed"),
      ` ${fmtDateTime(x.sent_at)} · to ${x.to_email}${x.cc.length ? ` · cc ${x.cc.join(", ")}` : ""} · by ${x.sent_by_name || "—"}`))) : null;

  const body = h("div", { class: "stack sve" },
    !info.configured && h("p", { class: "err", style: "margin:0" }, "Email sending is not set up yet: the Brevo key is missing. You can still preview the email."),
    h("div", { class: "small muted" }, `From: ${info.from_name}${info.from ? ` <${info.from}>` : ""}`),
    h("div", { class: "sve-to" }, h("label", { for: "sve-search" }, "To — store email *"), search, results, to, dlTo, toHint, likelyEl),
    h("div", {}, h("label", { for: "sve-cc" }, "CC"), chips, ccIn, dlCc, recent),
    h("div", {}, h("label", { for: "sve-note" }, "Personal note"), note),
    picks.length > 0 && h("div", {}, h("label", {}, "Recognise these team members"), h("div", { class: "sve-checks" }, picks.map((p) => p.el)), h("div", { class: "small muted", style: "margin-top:4px" }, "Ticked automatically at 85% or more. Change as you like.")),
    h("div", { class: "row" }, previewBtn), previewWrap, history, err);

  await modal(`Email ${svNo(r.id)} to the store`, body, (close) => {
    const send = h("button", { class: "btn teal", disabled: !info.configured, onclick: async () => {
      err.textContent = "";
      if (ccIn.value.trim() && !addCc(ccIn.value)) return;
      const p = payload();
      if (!EMAIL_RE.test(p.to)) { err.textContent = "Enter the store’s email address."; to.focus(); return; }
      send.disabled = true; send.textContent = "Sending…";
      try {
        await api(`/sv/${r.id}/email`, { method: "POST", body: p });
        toast(`Report emailed to ${p.to}`); close(true); onSent && onSent();
      } catch (e) { err.textContent = e.message; send.disabled = false; send.textContent = "Send email"; }
    } }, "Send email");
    return [h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"), send];
  });
}
