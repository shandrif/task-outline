#!/usr/bin/env python3
"""Readable HM-branded Excel copy of a backup made by db-backup.mjs (for people to open; restores use the .json.gz).
Usage: python3 scripts/backup-xlsx.py <hm-backup-DATE.json.gz> <out.xlsx>
Passwords and password hashes are left out of the Excel copy (they stay only in the .json.gz)."""
import gzip, json, sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

src, out = sys.argv[1], sys.argv[2]
b = json.load(gzip.open(src) if src.endswith(".gz") else open(src))
T = b["tables"]
INK, TAN, BG, CARD, LINE, TEAL, GOOD = "1D1B17", "D4B38B", "F5EDE3", "FBF7F1", "E4D6C2", "84C6B2", "2B8A74"
FONT = "Segoe UI"
thin = Side(style="thin", color=LINE)

stores = {r["id"]: r["name"] for r in T.get("stores", [])}
trainers = {r["id"]: r["name"] for r in T.get("trainers", [])}
positions = {r["id"]: r["name"] for r in T.get("positions", [])}
sections = {r["id"]: r["title"] for r in T.get("sections", [])}
NAMES = {"store_id": ("Store", stores), "trainer_id": ("Trainer", trainers), "position_id": ("Position", positions), "section_id": ("Topic", sections)}
HIDE = {"password_hash", "password_enc", "pw_version", "answers_json", "skips_json"}
SHEETS = [  # (table, sheet title, what it holds)
    ("stores", "Stores", "Every store with its Area Manager, ROM, city and region"),
    ("trainers", "Trainers", "Trainer accounts (no passwords)"),
    ("visits", "Visits", "Store visits by trainers"),
    ("evaluations", "Verifications", "Staff verifications with score"),
    ("eval_sections", "Verification topics", "Score per topic for each verification"),
    ("sv_reports", "Store visit reports", "Store visit report forms"),
    ("sv_emails", "Emails sent", "Store visit report emails"),
    ("records", "Coaching & records", "Coaching, NPD and other records"),
    ("workshop_entries", "Workshop", "Workshop and project entries"),
    ("positions", "Positions", "Positions"),
    ("sections", "Topics", "Verification topics per position"),
    ("items", "Questions", "Questions in each topic"),
    ("npd_products", "NPD products", "NPD products"),
    ("branch_emails", "Branch emails", "Branch email directory"),
    ("email_book", "Email suggestions", "Remembered email addresses"),
    ("sync_log", "Sync log", "Store mapping syncs"),
]
def title(c): return {"id": "ID"}.get(c, c.replace("_", " ").capitalize())
def cell(v):
    if isinstance(v, str) and len(v) > 32000: return v[:32000] + " …"
    return v

wb = Workbook()
ws = wb.active; ws.title = "Summary"; ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 3; ws.column_dimensions["B"].width = 28; ws.column_dimensions["C"].width = 12; ws.column_dimensions["D"].width = 60
for r in range(1, 6):
    for c in range(1, 6): ws.cell(r, c).fill = PatternFill("solid", fgColor=INK)
ws["B2"] = "HM Training Division — Data backup"; ws["B2"].font = Font(name=FONT, size=18, bold=True, color="FFFFFF")
ws["B3"] = f"Taken {b['created_at'][:16].replace('T', ' ')} UTC  ·  database {b['database']}"; ws["B3"].font = Font(name=FONT, size=11, color=TAN)
ws["B4"] = "Readable copy. To restore the app, use the .json.gz file with the same date."; ws["B4"].font = Font(name=FONT, size=10, italic=True, color="DDDDDD")
ws.row_dimensions[2].height = 30
hdr = 7
for i, h in enumerate(["Sheet", "Rows", "What it holds"]):
    c = ws.cell(hdr, 2 + i, h); c.font = Font(name=FONT, bold=True, color=INK); c.fill = PatternFill("solid", fgColor=TAN); c.border = Border(bottom=thin)
r = hdr + 1
for t, name, what in SHEETS:
    if t not in T: continue
    ws.cell(r, 2, name).hyperlink = f"#'{name}'!A1"; ws.cell(r, 2).font = Font(name=FONT, color=GOOD, underline="single")
    ws.cell(r, 3, len(T[t])).font = Font(name=FONT, bold=True); ws.cell(r, 4, what).font = Font(name=FONT, color="6F675B")
    for c in range(2, 5):
        ws.cell(r, c).border = Border(bottom=thin)
        if r % 2 == 0: ws.cell(r, c).fill = PatternFill("solid", fgColor=CARD)
    r += 1
ws.cell(r, 2, "Total rows").font = Font(name=FONT, bold=True); ws.cell(r, 3, sum(len(T[t]) for t, _, _ in SHEETS if t in T)).font = Font(name=FONT, bold=True)

for t, name, _ in SHEETS:
    rows = T.get(t)
    if rows is None: continue
    s = wb.create_sheet(name); s.sheet_view.showGridLines = False; s.freeze_panes = "A2"
    cols = [c for c in (rows[0].keys() if rows else []) if c not in HIDE]
    heads = []
    for c in cols:
        heads.append(title(c))
        if c in NAMES and t != {"store_id": "stores", "trainer_id": "trainers"}.get(c): heads.append(NAMES[c][0] + " name")
    for i, h in enumerate(heads, 1):
        x = s.cell(1, i, h); x.font = Font(name=FONT, bold=True, color="FFFFFF"); x.fill = PatternFill("solid", fgColor=INK)
        x.alignment = Alignment(vertical="center"); x.border = Border(bottom=Side(style="medium", color=TAN))
    s.row_dimensions[1].height = 22
    widths = [len(h) + 2 for h in heads]
    band = PatternFill("solid", fgColor=CARD)
    for ri, row in enumerate(rows, 2):
        vals = []
        for c in cols:
            vals.append(cell(row.get(c)))
            if c in NAMES and t != {"store_id": "stores", "trainer_id": "trainers"}.get(c): vals.append(NAMES[c][1].get(row.get(c)))
        for ci, v in enumerate(vals, 1):
            x = s.cell(ri, ci, v); x.font = Font(name=FONT, size=10)
            if ri % 2 == 1: x.fill = band
            widths[ci - 1] = min(48, max(widths[ci - 1], len(str(v)) + 2 if v is not None else 0))
    for i, w in enumerate(widths, 1): s.column_dimensions[get_column_letter(i)].width = w
    if rows: s.auto_filter.ref = f"A1:{get_column_letter(len(heads))}{len(rows) + 1}"
    s.sheet_properties.tabColor = TEAL
wb.save(out)
print("OK", out)
