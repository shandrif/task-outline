"""Extract positions/sections/questions from the HM SBS workbook into seed/questions.json."""
import json, re, sys, openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src)
positions = []
for ws in wb:
    name = ws.title.replace("Taskoutline", "").strip()
    sections, cur = [], None
    after_number = False
    for row in ws.iter_rows():
        cells = [c for c in row if c.value is not None]
        if not cells:
            continue
        first = cells[0]
        text = str(first.value).strip()
        vals = [c.value for c in cells]
        has_box = any(isinstance(v, bool) or v in ("True", "False") for v in vals[1:])
        is_header = after_number or any("Received" in str(v) for v in vals[1:3])
        if re.fullmatch(r"\d+", text):                  # section number cell precedes the title row
            after_number = True
            continue
        if is_header:                                   # section header row
            after_number = False
            cur = {"title": text, "items": []}
            sections.append(cur)
            continue
        if "Received" in text:
            continue
        if cur is None or text in ("Yes", "Total", "Percent") or text.startswith("OVERALL") \
                or re.fullmatch(r"\d+", text) or text.startswith("="):
            continue
        if any(str(v) in ("Total", "Percent") for v in vals[1:2]) and not has_box:
            kind = "note"
        elif has_box:
            kind = "question"
        elif text.lower() in ("brewing", "serving", "steaming", "preparation", "grinding"):
            kind = "heading"
        else:
            kind = "note"
        cur["items"].append({"kind": kind, "text": re.sub(r"\s+", " ", text)})
    # tidy source quirks: stray checkbox on headings, wrapped lines, unticked numbered rows
    for s in sections:
        items, out_items = s["items"], []
        for it in items:
            prev = out_items[-1] if out_items else None
            if it["kind"] == "question" and it["text"].lower() in ("brewing", "serving", "steaming"):
                it["kind"] = "heading"
            elif it["kind"] == "note" and re.match(r"^\d+\.", it["text"]):
                it["kind"] = "question"
            if prev and prev["kind"] == "question" and (
                    (it["kind"] == "note" and it["text"][:1].islower()) or
                    (it["kind"] == "question" and it["text"].startswith("("))):
                prev["text"] += " " + it["text"]
                continue
            out_items.append(it)
        s["items"] = out_items
    # headings: short note rows directly followed by questions
    for s in sections:
        for i, it in enumerate(s["items"]):
            if it["kind"] == "note" and len(it["text"]) < 25 and not it["text"].lower().startswith(("note", "serve")) \
                    and i + 1 < len(s["items"]) and s["items"][i + 1]["kind"] == "question":
                it["kind"] = "heading"
    positions.append({"name": name, "sections": sections})
json.dump(positions, open(out, "w"), ensure_ascii=False, indent=1)
for p in positions:
    n = sum(1 for s in p["sections"] for i in s["items"] if i["kind"] == "question")
    print(p["name"], len(p["sections"]), "sections", n, "questions")
