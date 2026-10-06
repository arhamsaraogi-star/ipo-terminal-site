"""Deterministic extraction from the BODY of a DRHP / RHP / Prospectus.

What it pulls (each value keeps document page + table title for provenance):
  * financials   - restated summary financials and KPI tables (revenue, EBITDA, PAT, margins, net worth,
                   borrowings, EPS, NAV, RoNW/ROE, ROCE, D/E ...) for every period column found
  * peers        - "comparison with listed industry peers" table (price, market cap, P/E, EPS, RoNW, NAV)
  * capital      - pre-issue share count (capital structure), used for implied market cap
  * industry     - quantitative statements from INDUSTRY OVERVIEW (market size / CAGR / share), verbatim with page

Nothing is inferred. A value is published only when its row label, its period column and its unit are all
identified; otherwise it is dropped.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ───────────────────────── metric dictionary ─────────────────────────
# (metric, label regex, kind)  kind: money | pct | ratio | per_share
METRICS: list[tuple[str, str, str]] = [
    ("revenue_from_operations", r"^(restated\s+)?revenue\s+from\s+operations?\b(?!.*(growth|%|margin|cagr))", "money"),
    ("total_income", r"^total\s+(income|revenue)\b(?!.*(growth|%))", "money"),
    ("ebitda_margin", r"\bebitda\s+margin(?!.*growth)", "pct"),
    ("ebitda", r"^(adjusted\s+)?ebitda\b(?!.*(margin|growth|%))", "money"),
    ("pat_growth", r"(pat|profit\s+after\s+tax|net\s+profit).*growth|growth.*(pat|profit)", "pct"),
    ("pat_margin", r"\b(pat|net\s+profit|profit\s+after\s+tax)\s+margin(?!.*growth)", "pct"),
    ("pat", r"^(restated\s+)?(net\s+)?(profit|\(loss\)|profit\s*/\s*\(loss\)|profit\s*\(loss\))\s*(/\s*\(loss\)\s*)?(after\s+tax|for\s+the\s+(year|period))|^pat\b(?!.*(margin|growth|%))|^profit\s+after\s+tax\b(?!.*margin)", "money"),
    ("pbt", r"^(restated\s+)?(profit|\(loss\)).*before\s+tax", "money"),
    ("net_worth", r"^(total\s+)?net\s*worth\b|^total\s+equity\b", "money"),
    ("total_borrowings", r"^total\s+borrowings?\b|^borrowings\b(?!.*(current|non))", "money"),
    ("net_debt", r"^net\s+debt\b", "money"),
    ("equity_share_capital", r"^(equity\s+)?share\s+capital\b", "money"),
    ("cash_and_equivalents", r"^cash\s+and\s+cash\s+equivalents\b", "money"),
    ("total_assets", r"^total\s+assets\b", "money"),
    ("eps_diluted", r"\bdiluted\b.*(eps|earnings\s+per\s+share)|(eps|earnings\s+per\s+share).*\bdiluted\b", "per_share"),
    ("eps_basic", r"\bbasic\b.*(eps|earnings\s+per\s+share)|(eps|earnings\s+per\s+share).*\bbasic\b|^(restated\s+)?(eps|earnings\s+per\s+(equity\s+)?share)\b(?!.*diluted)", "per_share"),
    ("nav_per_share", r"net\s+asset\s+value\s+per|^nav\b|nav\s+per\s+(equity\s+)?share", "per_share"),
    ("ronw", r"return\s+on\s+net\s*worth|^ronw\b|^ro\s*nw", "pct"),
    ("roe", r"return\s+on\s+(average\s+)?equity|^roe\b", "pct"),
    ("roce", r"return\s+on\s+(average\s+)?capital\s+employed|^roce\b", "pct"),
    ("debt_equity", r"debt\s*[-/]?\s*(to\s*)?[-/]?\s*equity", "ratio"),
    ("revenue_growth", r"revenue.*growth|growth.*revenue", "pct"),
    # cash flow (net cash from / (used in) operating, investing, financing) and what is needed to derive free cash flow
    ("cfo", r"^(net\s+)?cash\b(?!.*(equivalent|balance)).*\boperating\s+activit", "money"),
    ("cfi", r"^(net\s+)?cash\b(?!.*(equivalent|balance)).*\binvesting\s+activit", "money"),
    ("cff", r"^(net\s+)?cash\b(?!.*(equivalent|balance)).*\bfinancing\s+activit", "money"),
    ("capex", r"^(payments?\s+(for|towards)\s+|purchase\s+of\s+|acquisition\s+of\s+|addition(s)?\s+to\s+)(the\s+)?(property,?\s+plant|fixed\s+assets|tangible|intangible|pp&e|capital\s+assets|plant)|^capital\s+expenditure|^capex\b", "money"),
    ("finance_cost", r"^finance\s+costs?\b", "money"),
    ("current_liabilities", r"^total\s+current\s+liabilities\b", "money"),
]
METRIC_RE = [(m, re.compile(p, re.I), k) for m, p, k in METRICS]
LABELS = {
    "revenue_from_operations": "Revenue from operations", "total_income": "Total income", "ebitda": "EBITDA",
    "ebitda_margin": "EBITDA margin", "pat": "Profit after tax", "pat_margin": "PAT margin", "pbt": "Profit before tax",
    "net_worth": "Net worth", "total_borrowings": "Total borrowings", "net_debt": "Net debt",
    "equity_share_capital": "Equity share capital", "cash_and_equivalents": "Cash & equivalents", "total_assets": "Total assets",
    "eps_basic": "EPS (basic)", "eps_diluted": "EPS (diluted)", "nav_per_share": "NAV per share", "ronw": "Return on net worth",
    "roe": "Return on equity", "roce": "ROCE", "debt_equity": "Debt / equity", "revenue_growth": "Revenue growth", "pat_growth": "PAT growth",
    "cfo": "Cash flow from operations", "cfi": "Cash flow from investing", "cff": "Cash flow from financing", "capex": "Capital expenditure (purchase of fixed assets)",
    "finance_cost": "Finance costs", "current_liabilities": "Current liabilities",
}
KW = re.compile(r"revenue from operations|ebitda|profit after tax|net worth|total borrowings|earnings per share|restated profit|roce|return on|operating activities|investing activities|financing activities", re.I)
UNIT_CR = {"million": 0.1, "millions": 0.1, "mn": 0.1, "lakh": 0.01, "lakhs": 0.01, "lacs": 0.01, "lac": 0.01,
           "crore": 1.0, "crores": 1.0, "cr": 1.0, "billion": 100.0, "bn": 100.0}
UNIT_RE = re.compile(r"(?:₹|rs\.?|inr)\s*(?:in\s+)?(million|millions|mn|lakhs?|lacs?|crores?|cr|billion|bn)\b|in\s+(?:₹|rs\.?|inr)\s*(million|millions|mn|lakhs?|lacs?|crores?|cr|billion|bn)\b|\((?:₹|rs\.?|inr)\s*(million|lakhs?|lacs?|crores?)\)", re.I)
MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
MON_NUM = {m[:3]: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
NUM_RE = re.compile(r"^\(?-?\s*[\d,]*\.?\d+\s*\)?\s*%?$|^[-–—]$|^nil$|^n\.?a\.?$", re.I)


ALL_ROWS: list = []  # every candidate value in priority order (used by validate_consistency)


@dataclass
class Value:
    metric: str
    period: str
    value: float
    unit: str            # INR crore | % | x | INR
    page: int
    table: str
    raw: str


@dataclass
class Result:
    financials: list[Value] = field(default_factory=list)
    peers: list[dict] = field(default_factory=list)
    peers_page: int | None = None
    pre_issue_shares: int | None = None
    pre_issue_page: int | None = None
    industry: list[dict] = field(default_factory=list)
    industry_series: list[dict] = field(default_factory=list)
    overview: str | None = None
    overview_page: int | None = None
    periods: list[str] = field(default_factory=list)


# ───────────────────────── helpers ─────────────────────────
def _clean(c) -> str:
    return " ".join(str(c or "").replace("\n", " ").split())


def parse_number(s: str) -> float | None:
    s = s.strip().replace("₹", "").replace(" ", "")
    if not s or s in {"-", "–", "—"} or s.lower() in {"nil", "na", "n.a.", "n.a"}:
        return None
    neg = s.startswith("(") and s.endswith(")") or s.startswith("-")
    s = s.strip("()%-").replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def period_label(text: str) -> str | None:
    """'March 31, 2026' -> FY2026 ; 'Fiscal 2025' / 'FY 2025' / 'FY25' / '2024-25' -> FY2025 ;
    'June 30, 2026' (stub) -> Jun-2026 ; bare '2026' -> FY2026."""
    t = text.lower().replace("’", "'")
    m = re.search(rf"({MONTHS})\.?\s+(\d{{1,2}}),?\s+(\d{{4}})", t) or re.search(rf"(\d{{1,2}})(?:st|nd|rd|th)?\s+({MONTHS})\.?,?\s+(\d{{4}})", t)
    if m:
        g = m.groups()
        mon, yr = (g[0], g[2]) if not g[0].isdigit() else (g[1], g[2])
        mi = MON_NUM.get(mon[:3])
        if mi == 3:
            return f"FY{yr}"
        return f"{mon[:3].title()}-{yr}"
    m = re.search(r"(?:fiscal|fy|financial\s+year)\s*'?\s*(\d{4}|\d{2})\b", t)
    if m:
        y = m.group(1)
        return f"FY{('20' + y) if len(y) == 2 else y}"
    m = re.search(r"\b(20\d{2})\s*[-–/]\s*(\d{2,4})\b", t)
    if m:
        y2 = m.group(2)
        return f"FY{('20' + y2[-2:])}"
    m = re.fullmatch(r"\s*(20\d{2})\s*", t)
    if m:
        return f"FY{m.group(1)}"
    return None


def _unit_of(text: str) -> float | None:
    m = UNIT_RE.search(text)
    if not m:
        return None
    u = next(g for g in m.groups() if g).lower()
    return UNIT_CR.get(u) or UNIT_CR.get(u.rstrip("s"))


def _title_above(page_text: str, table_first_cell: str) -> str:
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]
    idx = next((i for i, l in enumerate(lines) if table_first_cell and table_first_cell[:20] in l), None)
    window = lines[max(0, (idx or 0) - 6): (idx or 0)] if idx else lines[:6]
    for l in reversed(window):
        if len(l) > 12 and not NUM_RE.match(l) and not re.match(r"^\(?(₹|rs)", l, re.I):
            return l[:120]
    return ""


# ───────────────────────── financial tables ─────────────────────────
PERIOD_PAT = re.compile(rf"(?:(?:{MONTHS})\.?\s+\d{{1,2}},?\s+\d{{4}}|\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{MONTHS})\.?,?\s+\d{{4}}|(?:fiscal|fy|financial year)\s*'?\s*\d{{2,4}}|20\d{{2}}\s*[-–/]\s*\d{{2,4}}|\b20\d{{2}}\b)", re.I)


def _table_periods(rows: list[list[str]]) -> tuple[list[str], int]:
    """Period labels from the header block, read column by column (headers are often split across rows,
    e.g. 'September 30,' / '2025'). Returns (periods in column order, header row count)."""
    best: tuple[list[str], int] = ([], 0)
    ncol = max(len(r) for r in rows)
    for hdr_n in range(1, min(7, len(rows)) + 1):
        # stop extending the header once a row looks like data (label + >=2 numbers)
        r = rows[hdr_n - 1]
        if hdr_n > 1 and sum(bool(NUM_RE.match(c)) for c in r if c) >= 2 and not any(PERIOD_PAT.search(c) for c in r if c):
            break
        labels: list[str] = []
        for c in range(ncol):
            col_text = " ".join(rows[k][c] for k in range(hdr_n) if c < len(rows[k]) and rows[k][c])
            for m in PERIOD_PAT.finditer(col_text):
                lab = period_label(m.group(0))
                if lab and lab not in labels:
                    labels.append(lab)
                    break  # one period per column
        if len(labels) >= 2 and len(labels) >= len(best[0]):
            best = (labels, hdr_n)
    return best


def _row_label_values(row: list[str]) -> tuple[str, list[str], str]:
    label, vals, unit_cell = "", [], ""
    for c in row:
        if not c:
            continue
        if not label:
            if (re.fullmatch(r"\(?[a-zA-Z]{1,3}\)?\.?|\(?[ivx]+\)?\.?|\d{1,2}\.?|\(\d{1,2}\)", c) and len(c) <= 4):
                continue  # list markers (a), A, (iv)
            if NUM_RE.match(c):
                continue
            label = c
            continue
        if re.search(r"gaap", c, re.I):
            continue
        if re.search(r"(₹|rs\.?|inr|million|lakh|crore|percentage|%|times|number|units?)", c, re.I) and not re.search(r"\d", c.replace("%", "")):
            unit_cell = c
            continue
        if re.search(r"^in\s+(₹|rs|times|%)", c, re.I):
            unit_cell = c
            continue
        if NUM_RE.match(c) or re.fullmatch(r"\[?●\]?|\[•\]", c):
            vals.append(c)
        # free text cells (explanations) are ignored
    label = re.sub(r"\s*\(\d+\)\s*$|\(\d+\)$", "", label).strip(" :*#^")
    return label, vals, unit_cell


SKIP_PAGE = re.compile(r"group compan(y|ies)|financial (information|performance|details) of (our )?(group|subsidiar|promoter|associate)|"
                       r"details of (our )?(group|subsidiar)|promoter group (entities|companies)|of our subsidiar(y|ies)\b.*(financial|turnover)|"
                       r"former subsidiar|brief financial (details|information)|% of consolidated|"
                       r"transferor compan|financial (details|information|performance) of (?!(our|the) company)[A-Z][a-z]+ [A-Z]", re.I)
P0 = re.compile(r"summary (of )?(the )?(restated )?(consolidated |standalone )?(financial information|financial statements?|statement of (profit|assets))|"
                r"restated (consolidated |standalone )?summary statement|summary financial information", re.I)
P1 = re.compile(r"key performance indicators|basis for (the )?(offer|issue) price", re.I)


def _page_priority(t: str, i: int) -> int | None:
    if SKIP_PAGE.search(t):
        return None
    head = t[:700]
    if P0.search(head) or re.search(r"SUMMARY OF (RESTATED )?(CONSOLIDATED |STANDALONE )?FINANCIAL INFORMATION|RESTATED (CONSOLIDATED |STANDALONE )?SUMMARY STATEMENT|SUMMARY (RESTATED )?STATEMENT OF", t):
        return 0
    if P1.search(t) and len(KW.findall(t)) >= 3:
        return 1
    if re.search(r"management.s discussion and analysis|results of operations", t, re.I):
        return 2
    return 3


def scan_financial_tables(pages_text: list[str], doc, max_pages: int = 90) -> tuple[list[Value], list[str]]:
    cand = []
    prios = [(_page_priority(tx, i) if i >= 6 else None) for i, tx in enumerate(pages_text)]
    # primary statements continue onto following pages without repeating the heading
    for i in range(len(prios)):
        if prios[i] == 0:
            for k in (i + 1, i + 2):
                if k < len(prios) and prios[k] not in (None, 0) and re.search(r"\d[\d,]*\.\d{2}", pages_text[k]):
                    prios[k] = -1  # marker: continuation of a primary statement
    for i, tx in enumerate(pages_text):
        pr = prios[i]
        if pr is None:
            continue
        if pr == -1:
            pr = 0
        elif pr != 0 and len(KW.findall(tx)) < 2:
            continue
        cand.append((pr, i))
    cand = [i for _, i in sorted(cand)[:max_pages]]  # processed in priority order: summary > KPI > MD&A > rest
    found: dict[tuple[str, str], Value] = {}
    all_periods: list[str] = []
    ALL_ROWS.clear()
    for i in cand:
        page = doc[i]
        hint = _unit_of(pages_text[i - 1]) if i > 0 else None
        try:
            for v in scan_layout(page, pages_text[i], i + 1, hint):
                found.setdefault((v.metric, v.period), v)
                ALL_ROWS.append(v)
                if v.period not in all_periods:
                    all_periods.append(v.period)
        except Exception:  # noqa: BLE001
            pass
        page_unit = _unit_of(pages_text[i]) or hint
        try:
            tables = page.find_tables().tables
        except Exception:  # noqa: BLE001
            tables = []
        for t in tables:
            rows = [[_clean(c) for c in r] for r in t.extract()]
            if len(rows) < 3:
                continue
            periods, hdr_n = _table_periods(rows)
            if not periods:
                continue
            title = _title_above(pages_text[i], rows[0][0] if rows[0] else "")
            stub_note = bool(re.search(r"months? ended|period ended", " ".join(" ".join(r) for r in rows[:hdr_n + 1]), re.I))
            for r in rows[hdr_n:]:
                label, vals, unit_cell = _row_label_values(r)
                if not label or len(vals) != len(periods):
                    continue
                for metric, rx, kind in METRIC_RE:
                    if not rx.search(label):
                        continue
                    row_unit = _unit_of(unit_cell) or _unit_of(label) or page_unit
                    is_pct = kind == "pct" or "%" in label or any("%" in v for v in vals)
                    for p, raw in zip(periods, vals):
                        v = parse_number(raw)
                        if v is None:
                            continue
                        if kind == "money":
                            if is_pct or row_unit is None:
                                break
                            val, unit = round(v * row_unit, 2), "INR crore"
                        elif kind == "pct":
                            val, unit = v, "%"
                        elif kind == "ratio":
                            val, unit = v, "x"
                        else:
                            val, unit = v, "INR"
                        key = (metric, p)
                        vv = Value(metric, p, val, unit, i + 1, title or ("Summary financial information" if not stub_note else ""), raw)
                        ALL_ROWS.append(vv)
                        if key not in found:
                            found[key] = vv
                    break
            for p in periods:
                if p not in all_periods:
                    all_periods.append(p)
    return list(found.values()), all_periods


# ───────────────────────── layout-based rows (works for tables drawn without ruling lines) ─────────────────────────
YEAR_TOK = re.compile(r"^(?:FY|Fiscal)?\s*'?(20\d{2}|\d{2})(?:[-–/](\d{2,4}))?[,)*]*$", re.I)


def _rows_from_words(page) -> list[list[tuple]]:
    words = page.get_text("words")  # x0,y0,x1,y1,text,block,line,wno
    words.sort(key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    rows: list[list[tuple]] = []
    for w in words:
        yc = (w[1] + w[3]) / 2
        if rows and abs(((rows[-1][0][1] + rows[-1][0][3]) / 2) - yc) <= 3.0:
            rows[-1].append(w)
        else:
            rows.append([w])
    for r in rows:
        r.sort(key=lambda w: w[0])
    return rows


def _anchors(rows: list[list[tuple]], idx: int) -> list[tuple[float, str]]:
    """Period anchors (x-centre, label) for a header whose year tokens sit on row idx."""
    out = []
    for w in rows[idx]:
        t = w[4].strip()
        m = YEAR_TOK.match(t)
        if not m:
            continue
        y1, y2 = m.group(1), m.group(2)
        if len(y1) == 2 and not t.lower().startswith(("fy", "fiscal")):
            continue
        year = int(("20" + y1) if len(y1) == 2 else y1)
        if y2:  # 2025-26 -> FY2026
            year = int(("20" + y2[-2:]))
        if not 2005 <= year <= 2040:
            continue
        xc = (w[0] + w[2]) / 2
        # month words directly above (same column) or on the same row to the left
        ctx = []
        for k in (idx - 1, idx - 2, idx):
            if 0 <= k < len(rows):
                ctx += [x[4] for x in rows[k] if abs(((x[0] + x[2]) / 2) - xc) < 45 or (k == idx and xc - 90 < x[0] < w[0])]
        ctx_t = " ".join(ctx).lower()
        mm = re.search(rf"\b({MONTHS})\b", ctx_t)
        if mm and not mm.group(1).startswith("mar"):
            label = f"{mm.group(1)[:3].title()}-{year}"
        else:
            label = f"FY{year}"
        out.append((xc, label))
    labels = [l for _, l in out]
    return out if len(out) >= 2 and len(set(labels)) == len(labels) else []


def scan_layout(page, page_text: str, page_no: int, unit_hint: float | None = None) -> list[Value]:
    rows = _rows_from_words(page)
    page_unit = _unit_of(page_text) or unit_hint
    found: list[Value] = []
    anchors: list[tuple[float, str]] = []
    for i, r in enumerate(rows):
        a = _anchors(rows, i)
        if a:
            anchors = a
            continue
        if not anchors:
            continue
        min_x = min(x for x, _ in anchors)
        gap = min((b[0] - a_[0]) for a_, b in zip(anchors, anchors[1:])) if len(anchors) > 1 else 60
        label_words = [w[4] for w in r if w[2] < min_x - gap * 0.35]
        nums = [w for w in r if w[0] >= min_x - gap * 0.6 and (NUM_RE.match(w[4].strip()) or w[4].strip() in ("-", "–", "—"))]
        label = re.sub(r"\s*\(\d+\)\s*$", "", " ".join(label_words)).strip(" :*#^")
        label = re.sub(r"^(\(?[a-z]{1,3}\)|\d{1,2}\.|[ivx]+\.)\s*", "", label, flags=re.I)
        if not label or not nums:
            continue
        for metric, rx, kind in METRIC_RE:
            if not rx.search(label):
                continue
            row_unit = _unit_of(label) or page_unit
            is_pct = kind == "pct" or "%" in label or any("%" in w[4] for w in nums)
            used: set[str] = set()
            for w in nums:
                xc = (w[0] + w[2]) / 2
                xa, period = min(anchors, key=lambda a_: abs(a_[0] - xc))
                if abs(xa - xc) > max(gap * 0.6, 30) or period in used:
                    continue
                used.add(period)
                v = parse_number(w[4])
                if v is None:
                    continue
                if kind == "money":
                    if is_pct or row_unit is None:
                        break
                    val, unit = round(v * row_unit, 2), "INR crore"
                elif kind == "pct":
                    val, unit = v, "%"
                elif kind == "ratio":
                    val, unit = v, "x"
                else:
                    val, unit = v, "INR"
                found.append(Value(metric, period, val, unit, page_no, _title_above(page_text, label[:20]) or "Financial table", w[4]))
            break
    return found


# ───────────────────────── peers ─────────────────────────
def scan_peers(pages_text: list[str], doc) -> tuple[list[dict], int | None]:
    for i, tx in enumerate(pages_text):
        if i < 20 or not re.search(r"P\s*/\s*E", tx) or not re.search(r"\bEPS\b|earnings per share", tx, re.I):
            continue
        if not re.search(r"peer|listed industry|comparison", tx, re.I):
            continue
        try:
            tables = doc[i].find_tables().tables
        except Exception:  # noqa: BLE001
            continue
        for t in tables:
            rows = [[_clean(c) for c in r] for r in t.extract()]
            hdr = " ".join(" ".join(r) for r in rows[:12]).lower()
            if "p/e" not in hdr.replace(" ", "") or "eps" not in hdr:
                continue
            # header text per column (joined vertically) to map columns
            ncol = max(len(r) for r in rows)
            body = [r for r in rows if r and r[0] and len(r[0]) > 3 and sum(bool(NUM_RE.match(c) or c in ("[●]", "●")) for c in r[1:]) >= 3]
            if len(body) < 2:
                continue
            col_hdr = []
            first_body = rows.index(body[0])
            for c in range(ncol):
                col_hdr.append(" ".join(r[c] for r in rows[:first_body] if c < len(r) and r[c]).lower())
            def col(name_rx):
                for c, h in enumerate(col_hdr):
                    if re.search(name_rx, h):
                        return c
                return None
            idx = {"face_value": col(r"face"), "price": col(r"closing|cmp|price"), "total_income": col(r"total income|revenue"),
                   "mcap": col(r"market\s*cap"), "pb": col(r"p\s*/\s*b"), "pe": col(r"p\s*/\s*e"), "eps_basic": col(r"basic|eps"),
                   "ronw": col(r"ronw|return"), "nav": col(r"nav|net asset")}
            out = []
            for r in body[:12]:
                rec = {"name": r[0]}
                for k, c in idx.items():
                    if c is not None and c < len(r):
                        rec[k] = parse_number(r[c]) if r[c] not in ("[●]", "●") else None
                out.append(rec)
            return out, i + 1
    return [], None


# ───────────────────────── capital structure ─────────────────────────
PRE_RE = re.compile(r"(?:issued,?\s+subscribed\s+and\s+paid[\s-]*up\s+(?:equity\s+)?(?:share\s+)?capital\s+(?:before|prior\s+to)\s+the\s+(?:offer|issue))(.{0,260})", re.I | re.S)


def scan_pre_issue_shares(pages_text: list[str]) -> tuple[int | None, int | None]:
    for i, tx in enumerate(pages_text[:200]):
        for m in PRE_RE.finditer(tx):
            seg = m.group(1)
            n = re.search(r"([\d,]{7,})\s+(?:fully\s+paid[- ]up\s+)?equity\s+shares", seg, re.I)
            if n:
                v = int(n.group(1).replace(",", ""))
                if 10_000 < v < 50_000_000_000:
                    return v, i + 1
    return None, None


# ───────────────────────── industry statements ─────────────────────────
IND_START = re.compile(r"^\s*(SECTION\s+[IVX]+\s*[-–:]?\s*)?INDUSTRY\s+OVERVIEW\s*$", re.M)
IND_END = re.compile(r"^\s*OUR\s+BUSINESS\s*$", re.M)
MACRO_RE = re.compile(r"\bGDP\b|\bGVA\b|gross value added|inflation|repo rate|rupee|depreciat|pound sterling|\beuro\b|per capita income|fiscal deficit|current account", re.I)
CLAIM_RE = re.compile(r"(CAGR|market\s+size|market\s+share|valued\s+at|expected\s+to\s+(reach|grow)|projected\s+to|estimated\s+(at|to))", re.I)
AMOUNT_RE = re.compile(r"(?:₹|rs\.?|inr|usd|us\$|\$)\s?([\d,]+(?:\.\d+)?)\s*(lakh\s+crore|trillion|tn|billion|bn|million|mn|crore|cr)\b", re.I)
CAGR_RE = re.compile(r"CAGR\s+of\s+(?:approximately\s+|~|about\s+|around\s+)?([\d.]+)\s*%|([\d.]+)\s*%\s+CAGR", re.I)
PERIOD_RE = re.compile(r"\b(?:FY|Fiscal|CY|financial year)\s?'?(\d{2,4})(?:E|P|F)?\b|\b(20\d{2})(?:E|P|F)?\b")


def scan_industry(pages_text: list[str], max_claims: int = 40) -> list[dict]:
    start = None
    for i, tx in enumerate(pages_text):
        if i > 10 and IND_START.search(tx):
            start = i
            break
    if start is None:
        return []
    end = next((j for j in range(start + 1, min(len(pages_text), start + 90)) if IND_END.search(pages_text[j])), min(len(pages_text), start + 60))
    claims, seen = [], set()
    for j in range(start, end):
        text = " ".join(pages_text[j].split())
        for s in re.split(r"(?<=[.;])\s+(?=[A-Z(])", text):
            if len(s) < 40 or len(s) > 420 or not CLAIM_RE.search(s):
                continue
            if MACRO_RE.search(s) and not re.search(r"\b(market|industry|segment|sector)\b", s, re.I):
                continue
            amounts = [(float(a.replace(",", "")), u.lower()) for a, u in AMOUNT_RE.findall(s)]
            cagr = next((float(a or b) for a, b in CAGR_RE.findall(s)), None)
            if not amounts and cagr is None:
                continue
            key = s[:80]
            if key in seen:
                continue
            seen.add(key)
            periods = []
            for a, b in PERIOD_RE.findall(s):
                y = a or b
                y = ("20" + y) if len(y) == 2 else y
                if 1990 < int(y) < 2050 and y not in periods:
                    periods.append(y)
            claims.append({"text": s, "page": j + 1, "cagr_pct": cagr,
                           "amounts": [{"value": v, "unit": u} for v, u in amounts[:4]], "years": periods[:4]})
            if len(claims) >= max_claims:
                return claims
    return claims


# ───────────────────────── consistency checks ─────────────────────────
def validate_consistency(vals: list[Value], all_rows: list[Value] | None = None) -> list[Value]:
    """Remove values from pages that contradict the issuer's own primary statements.

    `vals` is in priority order (summary statements first). A page is 'foreign' (group company, subsidiary,
    industry example, wrong unit) if any of its figures disagree with the trusted figures for the same period:
    revenue / PAT differing by >3%, or a stated margin disagreeing with the trusted P&L by >2pp."""
    trusted: dict[tuple[str, str], Value] = {}
    for v in vals:
        trusted.setdefault((v.metric, v.period), v)
    rows = all_rows or vals
    foreign: set[int] = set()
    bad_rows: set[tuple[str, int]] = set()
    for v in rows:
        t = trusted.get((v.metric, v.period))
        if t and t.page != v.page and v.unit == t.unit and t.value:
            if v.metric in ("revenue_from_operations", "pat", "total_income") and abs(v.value - t.value) > abs(t.value) * 0.03:
                foreign.add(v.page)
        for num, marg in (("ebitda", "ebitda_margin"), ("pat", "pat_margin")):
            if v.metric != marg:
                continue
            rev, n = trusted.get(("revenue_from_operations", v.period)), trusted.get((num, v.period))
            if rev and n and rev.value and rev.page != v.page and n.page != v.page:
                if abs(n.value / rev.value * 100 - v.value) > max(2.0, abs(v.value) * 0.2):
                    bad_rows.add((v.metric, v.page))
    out = [v for v in vals if v.page not in foreign and (v.metric, v.page) not in bad_rows]
    # refill gaps from non-foreign pages
    have = {(v.metric, v.period) for v in out}
    for v in rows:
        if v.page not in foreign and (v.metric, v.page) not in bad_rows and (v.metric, v.period) not in have:
            out.append(v)
            have.add((v.metric, v.period))
    return out


# ───────────────────────── entry point ─────────────────────────
def extract(pdf: bytes) -> Result:
    import pymupdf
    pymupdf.TOOLS.mupdf_display_errors(False)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    pages_text = [p.get_text() for p in doc]
    res = Result()
    res.financials, res.periods = scan_financial_tables(pages_text, doc)
    res.financials = validate_consistency(res.financials, list(ALL_ROWS))
    res.peers, res.peers_page = scan_peers(pages_text, doc)
    res.pre_issue_shares, res.pre_issue_page = scan_pre_issue_shares(pages_text)
    res.industry = scan_industry(pages_text)
    try:
        res.overview, res.overview_page = scan_overview(pages_text)
    except Exception:
        pass
    try:
        from .industry_series import scan as scan_series
        st = next((i for i, t in enumerate(pages_text) if i > 10 and IND_START.search(t)), None)
        if st is not None:
            en = next((j for j in range(st + 1, min(len(pages_text), st + 90)) if IND_END.search(pages_text[j])), min(len(pages_text), st + 60))
            res.industry_series = scan_series(doc, st, en)
    except Exception:
        res.industry_series = []
    return res


# ───────────────────────── company overview (Our Business → first substantive paragraphs) ─────────────────────────
BUS_RE = re.compile(r"^\s*(?:OUR\s+BUSINESS|BUSINESS\s+OVERVIEW|OUR\s+BUSINESS\s+OVERVIEW|OVERVIEW)\s*$", re.M | re.I)
BOILER = re.compile(r"forward[- ]looking|should be read|qualified in its entirety|Restated Financial|references to .{0,20}\b(we|us|our)\b|"
                    r"Unless (?:the context|otherwise)|Risk Factors|industry (?:and market )?data|commissioned|paid for by|"
                    r"financial year ends|derived from|page \d+|non-?GAAP|\bInd ?AS\b|\bIFRS\b|\bGAAP\b|supplemental measures|performance indicators|"
                    r"this (?:Draft )?(?:Red Herring )?Prospectus|presentation of (?:financial|industry)|rounded off|\bcrore\b.{0,30}\blakh\b|"
                    r"Certain Conventions|Definitions? and Abbreviations|table of contents", re.I)
# a real business description says what the company is or does early on
BUSINESS_SIGNAL = re.compile(r"\b(we are|we have been|we operate|we manufacture|we provide|we offer|we design|we engage|is engaged in|are engaged in|"
                             r"is (?:a|an|one of|among|the)\b|are (?:a|an|one of|among|the)\b|is a .{0,40}company|incorporated in \d{4}|"
                             r"business of|manufactur\w+|provid\w+ (?:services|solutions)|leading|largest)", re.I)
def _paras(text: str) -> list[str]:
    out, para = [], []
    for line in text.splitlines():
        l = line.strip()
        if not l or re.fullmatch(r"(Page )?\d{1,4}( of \d+)?", l, re.I) or re.search(r"(Draft )?(Red Herring )?Prospectus$", l):
            if para:
                out.append(" ".join(para)); para = []
            continue
        words = l.split()
        if len(l) < 60 and not re.search(r"[.,;:)]$", l) and sum(w[:1].isupper() for w in words) >= max(1, len(words) - 1):
            if para:
                out.append(" ".join(para)); para = []
            out.append("§" + l)                         # heading marker
            continue
        para.append(l)
    if para:
        out.append(" ".join(para))
    return out


def _clean_overview(picked: list[str], max_chars: int) -> str:
    txt = " ".join(picked)
    txt = re.sub(r"\s*[(\[](?:Source|Sources?)\s*:[^)\]]*[)\]]\.?", "", txt)
    txt = re.sub(r"(\w)- (\w)", r"\1\2", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    if len(txt) > max_chars:
        cut = txt[:max_chars]
        txt = cut[:cut.rfind(". ") + 1] if ". " in cut else cut + "…"
    return txt


def good_overview(txt: str) -> bool:
    """True when the text reads like the company describing its own business (not definitions, disclaimers or measures)."""
    head = txt[:500]
    return len(txt) >= 120 and not BOILER.search(head) and bool(BUSINESS_SIGNAL.search(head))


def scan_overview(pages_text: list[str], max_chars: int = 1800) -> tuple[str | None, int | None]:
    """The company's own description: first business paragraphs of the Our Business chapter. Every page carrying the heading is a
    candidate (running headers repeat it); a candidate is accepted only if it reads like a business description."""
    starts = [i for i, t in enumerate(pages_text) if i > 10 and BUS_RE.search(t) and not re.search(r"\.{5,}|…{3,}", t[:800])]
    for s0 in starts[:25]:
        text = "\n".join(pages_text[s0:s0 + 3])
        m = BUS_RE.search(text)
        paras = _paras(text[m.end():] if m else text)
        picked: list[str] = []
        for p_ in paras:
            if p_.startswith("§"):
                if picked and len(" ".join(picked)) > 350:
                    break
                continue
            if len(p_) < 80 or BOILER.search(p_[:400]):
                if picked and len(" ".join(picked)) > 350:
                    break
                continue
            picked.append(p_)
            if len(" ".join(picked)) > max_chars:
                break
        txt = _clean_overview(picked, max_chars)
        if not good_overview(txt):
            continue
        page = next((k + 1 for k in range(s0, min(s0 + 3, len(pages_text))) if picked and picked[0][:40] in " ".join(pages_text[k].split())), s0 + 1)
        return txt, page
    return None, None
