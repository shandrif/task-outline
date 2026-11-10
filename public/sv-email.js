/* Email a store visit report to the store (sent through Brevo by the server). Loaded after modules.js. */
"use strict";

const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]{2,}$/;

async function svEmailDialog(r, onSent) {
  let info;
  try { info = await api(`/sv/${r.id}/email`); } catch (e) { toast(e.message); return; }
  const err = h("p", { class: "err ws-err", style: "margin:0" });

  // To: one address, filled with the last one used for this store; suggestions = this store's earlier addresses first
  const to = h("input", { id: "sve-to", type: "email", value: info.to_default, list: "sve-dl-to", placeholder: "store@example.com", autocomplete: "off", spellcheck: "false" });
  const dlTo = h("datalist", { id: "sve-dl-to" }, [...info.to_store, ...info.to_other].map((x) => h("option", { value: x })));

  // CC: typed by hand; each address becomes a chip; earlier CCs are suggested
  const cc = [];
  const chips = h("div", { class: "sve-chips" });
  const ccIn = h("input", { id: "sve-cc", type: "email", list: "sve-dl-cc", placeholder: "Type an address and press Enter", autocomplete: "off", spellcheck: "false" });
  const dlCc = h("datalist", { id: "sve-dl-cc" });
  const recent = h("div", { class: "sve-recent" });
  const paintCc = () => {
    chips.replaceChildren(...cc.map((x) => h("span", { class: "chip sve-chip" }, x, h("button", { type: "button", "aria-label": `Remove ${x}`, onclick: () => { cc.splice(cc.indexOf(x), 1); paintCc(); } }, "✕"))));
    const left = info.cc.filter((x) => !cc.includes(x));
    dlCc.replaceChildren(...left.map((x) => h("option", { value: x })));
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
    h("div", {}, h("label", { for: "sve-to" }, "To — store email *"), to, dlTo, info.to_store.length > 1 && h("div", { class: "small muted", style: "margin-top:4px" }, "Earlier addresses for this store are suggested as you type.")),
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
