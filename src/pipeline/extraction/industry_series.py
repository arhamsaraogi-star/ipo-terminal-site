"""Industry-overview data series, rebuilt from the offer document's own charts and tables.

Commissioned industry reports (CRISIL, Frost & Sullivan, Redseer, Technopak…) are typeset in the DRHP with
vector charts: the year axis and the data labels are real text. We read word positions and rebuild each series:

  • chart  — a row of period labels (CY20 … CY30P) with numeric data labels above it, matched by x-position
  • table  — a header row of periods with labelled numeric rows below it
  • text   — "<subject> increased from X in <year> to Y in <year>" statements (two or more points)

Every series carries its page, so the terminal can link to it. Nothing is estimated: values are exactly as printed;
a printed range (1,944-1,992) is kept as its midpoint with the range retained.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

PERIOD_RE = re.compile(r"^(?:(CY|FY|F|Fiscal|FY'|CY')\s?'?(\d{2}|\d{4})|(\d{4}))((?:-|–)\d{2})?\s?(\(?[EPFB]\)?|E|P)?[:,]?$", re.I)
NUM_RE = re.compile(r"^\(?[-–]?[\d,]*\d(?:\.\d+)?\)?%?$")
RANGE_RE = re.compile(r"^([\d,]*\d(?:\.\d+)?)\s?[-–]\s?([\d,]*\d(?:\.\d+)?)(%?)$")
UNIT_RE = re.compile(r"\(([^()]{1,40})\)\s*$")
SKIP_LINE = re.compile(r"^(source|note|notes|p\s*[-–:]|e\s*[-–:]|\*)", re.I)


@dataclass
class Word:
    x0: float
    y0: float
    x1: float
    y1: float
    t: str

    @property
    def xc(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Series:
    title: str
    unit: str | None
    page: int
    kind: str
    periods: list[str]
    rows: list[dict] = field(default_factory=list)     # [{name, values: [float|None]}]
    projected: list[bool] = field(default_factory=list)
    note: str | None = None

    def as_dict(self) -> dict:
        return {"title": self.title, "unit": self.unit, "page": self.page, "kind": self.kind, "periods": self.periods,
                "rows": self.rows, "projected": self.projected, "note": self.note}


def period_of(tok: str) -> tuple[str, bool] | None:
    """'CY20' → ('CY20', False); '2030P' → ('2030P', True); 'FY26E' → ('FY26E', True). Returns None if not a period."""
    m = PERIOD_RE.match(tok.strip())
    if not m:
        return None
    pre, yy, y4, span, suf = m.groups()
    y = yy or y4
    if y4 is None and pre is None:
        return None
    n = int(y) if len(y) == 4 else 2000 + int(y)
    if not 1995 <= n <= 2050:
        return None
    proj = bool(suf and re.search(r"[EPF]", suf, re.I))
    return tok.strip().rstrip(":,"), proj


def number_of(tok: str) -> tuple[float, bool, str | None] | None:
    """Parse a data label → (value, is_percent, range_text)."""
    t = tok.strip().replace("~", "")
    m = RANGE_RE.match(t)
    if m:
        a, b = float(m.group(1).replace(",", "")), float(m.group(2).replace(",", ""))
        if b >= a:
            return (a + b) / 2, bool(m.group(3)), t
    if not NUM_RE.match(t):
        return None
    neg = t.startswith("(") and t.endswith(")") or t.startswith(("-", "–"))
    core = t.strip("()%").lstrip("-–").replace(",", "")
    try:
        v = float(core)
    except ValueError:
        return None
    return (-v if neg else v), t.endswith("%") or t.endswith("%)"), None


def lines_of(words: list[Word], tol: float = 2.2) -> list[list[Word]]:
    out: list[list[Word]] = []
    for w in sorted(words, key=lambda w: (round(w.y1, 1), w.x0)):
        if out and abs(out[-1][0].y1 - w.y1) <= tol:
            out[-1].append(w)
        else:
            out.append([w])
    return [sorted(line, key=lambda w: w.x0) for line in out]


def _merge_period_words(line: list[Word]) -> list[Word]:
    """'CY' '2025' → 'CY2025'; 'FY' '26E' → 'FY26E'; 'Fiscal' '2025' → 'Fiscal 2025'."""
    out: list[Word] = []
    for w in line:
        if out and re.fullmatch(r"(CY|FY|Fiscal)", out[-1].t, re.I) and w.x0 - out[-1].x1 < 8:
            p = out.pop()
            out.append(Word(p.x0, min(p.y0, w.y0), w.x1, max(p.y1, w.y1), f"{p.t}{'' if p.t.upper() in ('CY', 'FY') else ' '}{w.t}"))
        else:
            out.append(w)
    return out


def _axis(line: list[Word]) -> list[tuple[Word, str, bool]] | None:
    ws = _merge_period_words(line)
    ps = [(w, *period_of(w.t)) for w in ws if period_of(w.t)]
    if len(ps) < 3 or len(ps) < 0.6 * len(ws):
        return None
    xs = [p[0].xc for p in ps]
    if any(b - a < 12 for a, b in zip(xs, xs[1:])):
        return None
    if len({p[1] for p in ps}) != len(ps):           # repeated periods = sub-columns, not an axis
        return None
    return ps


def _text_line(line: list[Word]) -> str:
    return " ".join(w.t for w in line)


def _is_texty(s: str) -> bool:
    return len(re.findall(r"[A-Za-z]{3,}", s)) >= 2


CAPTION_JUNK = re.compile(r"^(?:(?:Figure|Table|Exhibit|Chart|Graph)\s*(?:Error!.*?document\.*\s*)?[\dA-Z]*[.:\-–]?\s*\d*\s*[:.\-–]?\s*)", re.I)
PERIODISH = re.compile(r"\d{4}|\bH[12]\b|FY|CY", re.I)


def clean_title(t: str) -> str:
    t = CAPTION_JUNK.sub("", t.strip()).strip(" :-–")
    return t[:1].upper() + t[1:] if t else t


def _title_and_unit(lines: list[list[Word]], top_idx: int, stop_y: float, page_h: float) -> tuple[str | None, str | None, str | None]:
    """Search upwards from a chart/table for its caption. Returns (title, unit, CAGR annotation)."""
    title = unit = cagr = None
    for k in range(top_idx, max(-1, top_idx - 9), -1):
        line = lines[k]
        if line[0].y1 < stop_y - 140:
            break
        s = _text_line(line)
        if re.search(r"CAGR", s, re.I) and not cagr and len(s) < 80:
            cagr = s
            continue
        if SKIP_LINE.match(s) or not _is_texty(s):
            continue
        if len(s) > 140:                               # body paragraph — caption not found
            break
        prev = _text_line(lines[k - 1]) if k > 0 else ""
        if (k > 0 and _is_texty(prev) and len(prev) < 90 and not re.search(r"[.;:]$", prev) and not SKIP_LINE.match(prev)
                and line[0].y1 - lines[k - 1][0].y1 < 16 and not CAPTION_JUNK.match(s)):
            s = f"{prev} {s}"                          # caption wrapped onto two lines
        elif k + 1 < len(lines) and re.search(r"\b(in|of|by|and|the|for|to|across|vs\.?|vis-à-vis)$", s, re.I):
            nxt = _text_line(lines[k + 1])
            if re.search(r"[A-Za-z]{3,}", nxt) and len(nxt) < 80 and not SKIP_LINE.match(nxt):
                s = f"{s} {nxt}"
        title = clean_title(s)
        m2 = re.search(r",\s*((?:US\$|USD|₹|Rs\.?|INR)\s?(?:mn|bn|million|billion|crore|cr|lakh|tn|trillion)|[A-Z][A-Za-z]{1,6}PA|mn sq\.? ?ft\.?|%)\s*$", s)
        if m2:
            unit = m2.group(1)
        for m in re.finditer(r"\(([^()]{1,40})\)", s):
            if not PERIODISH.search(m.group(1)) and not re.search(r"%\s*split|share", m.group(1), re.I):
                unit = re.sub(r"^in\s+", "", m.group(1), flags=re.I)
        break
    return title, unit, cagr


def scan_page(words_raw, page_no: int, page_h: float = 842) -> list[Series]:
    words = [Word(w[0], w[1], w[2], w[3], w[4]) for w in words_raw]
    lines = lines_of(words)
    out: list[Series] = []
    used_y: set[int] = set()
    for i, line in enumerate(lines):
        ax = _axis(line)
        if not ax:
            continue
        y_axis = line[0].y1
        cols = [(p[0].xc, p[1], p[2]) for p in ax]
        spacing = min(b[0] - a[0] for a, b in zip(cols, cols[1:])) if len(cols) > 1 else 50
        half = spacing * 0.55
        left_edge = cols[0][0] - half

        def colof(w: Word) -> int | None:
            j = min(range(len(cols)), key=lambda j: abs(cols[j][0] - w.xc))
            return j if abs(cols[j][0] - w.xc) <= half else None

        # ── table: labelled numeric rows below the header ──
        rows = []
        for line2 in lines[i + 1:i + 40]:
            s = _text_line(line2)
            if SKIP_LINE.match(s) or (len(s) > 140 and _is_texty(s)):
                break
            if _axis(line2):
                break
            label = " ".join(w.t for w in line2 if w.xc < left_edge and not number_of(w.t)).strip()
            vals: list[float | None] = [None] * len(cols)
            pct = [False] * len(cols)
            for w in line2:
                n = number_of(w.t)
                if not n or w.xc < left_edge:
                    continue
                j = colof(w)
                if j is None:
                    continue
                if vals[j] is None or (pct[j] and not n[1]):
                    vals[j], pct[j] = n[0], n[1]
            filled = sum(v is not None for v in vals)
            if label and filled >= max(2, int(0.6 * len(cols))):
                rows.append({"name": label[:60], "values": vals, "pct": all(p for p, v in zip(pct, vals) if v is not None)})
            elif label and not filled and rows:
                continue                                 # wrapped label line
            elif not label and filled and rows and all(v is None for v in rows[-1]["values"]):
                rows[-1]["values"] = vals
        if len(rows) >= 1:
            title, unit, cagr = _title_and_unit(lines, i - 1, y_axis, page_h)
            if title:
                out.append(Series(title=title, unit=unit, page=page_no, kind="table", periods=[c[1] for c in cols],
                                  projected=[c[2] for c in cols],
                                  rows=[{"name": r["name"], "values": r["values"]} for r in rows[:12]], note=cagr))
                used_y.add(int(y_axis))
                continue

        # ── chart: data labels above the axis, matched by x ──
        per_col: list[list[tuple[float, bool, str | None, float]]] = [[] for _ in cols]
        top = i
        for k in range(i - 1, max(-1, i - 40), -1):
            line2 = lines[k]
            if y_axis - line2[0].y1 > 330:
                break
            s = _text_line(line2)
            nums = [(w, number_of(w.t)) for w in line2]
            numeric = [(w, n) for w, n in nums if n]
            if _is_texty(s) and len(numeric) < max(1, len(line2) // 2):
                if re.search(r"CAGR", s, re.I) and len(s) < 80:
                    continue
                if len(s) < 40 and not re.search(r"[.;]$", s):   # legend / axis caption
                    continue
                break
            top = k
            for w, n in numeric:
                j = colof(w)
                if j is not None:
                    per_col[j].append((n[0], n[1], n[2], w.y1))
        counts = [len(c) for c in per_col]
        if sum(1 for c in counts if c) < max(3, int(0.7 * len(cols))):
            continue
        k_series = max(counts)
        if k_series == 1 or all(c in (0, k_series) for c in counts):
            # prefer non-percent labels when a column mixes values with growth percentages
            def pick(c):
                c2 = [x for x in c if not x[1]] or c
                return sorted(c2, key=lambda x: x[3])                 # top → bottom
            cols_vals = [pick(c) for c in per_col]
            k2 = max(len(c) for c in cols_vals)
            if k2 > 3:
                continue
            title, unit, cagr = _title_and_unit(lines, top - 1, lines[top][0].y1, page_h)
            if not title:
                continue
            rows = []
            for r in range(k2):
                rows.append({"name": "Value" if k2 == 1 else ("Top label" if r == 0 else f"Label {r + 1}"),
                             "values": [c[r][0] if len(c) > r else None for c in cols_vals]})
            if k2 > 1:                                 # stacked bars: keep the top label (usually the total)
                rows = rows[:1]
                rows[0]["name"] = "Total (top label)"
            ranges = [c[0][2] for c in cols_vals if c and c[0][2]]
            out.append(Series(title=title, unit=unit, page=page_no, kind="chart", periods=[c[1] for c in cols],
                              projected=[c[2] for c in cols], rows=rows,
                              note="; ".join(filter(None, [cagr, f"Ranges shown as midpoints: {', '.join(ranges)}" if ranges else None])) or None))
    return out


# ── narrative statements: "X increased from A in 2020 to B in 2025" ──
FROM_TO = re.compile(
    r"(?P<subj>[A-Z][^.;:]{3,110}?)\s+(?:has\s+|have\s+|had\s+)?(?:increased|grew|rose|expanded|declined|decreased|reached|grown|went\s+up|surged|jumped|moved)"
    r"[^.;]{0,40}?\bfrom\s+(?:approximately\s+|about\s+|around\s+|~)?(?P<cur1>₹|Rs\.?|INR|US\$|USD|\$)?\s?(?P<a>[\d,]+(?:\.\d+)?)\s?(?P<u1>%|lakh crore|trillion|billion|million|crore|lakh|bn|mn|tn|[A-Za-z][A-Za-z./ ]{0,18}?)?\s+in\s+(?P<y1>(?:CY|FY|Fiscal\s?)?'?\d{2,4}[EP]?)"
    r"\s+to\s+(?:approximately\s+|about\s+|around\s+|~)?(?P<cur2>₹|Rs\.?|INR|US\$|USD|\$)?\s?(?P<b>[\d,]+(?:\.\d+)?)\s?(?P<u2>%|lakh crore|trillion|billion|million|crore|lakh|bn|mn|tn|[A-Za-z][A-Za-z./ ]{0,18}?)?\s+(?:in|by)\s+(?P<y2>(?:CY|FY|Fiscal\s?)?'?\d{2,4}[EP]?)", re.S)
THEN = re.compile(r"(?:expected|estimated|projected|forecast|likely|anticipated)[^.;]{0,40}?(?:to|reach|reaching)\s+(?:approximately\s+|about\s+|~)?(?:₹|Rs\.?|US\$|\$)?\s?([\d,]+(?:\.\d+)?)\s?(?:%|lakh crore|trillion|billion|million|crore|bn|mn)?[^.;]{0,25}?\s+(?:in|by)\s+((?:CY|FY|Fiscal\s?)?'?\d{2,4}[EP]?)")


def scan_text(page_text: str, page_no: int) -> list[Series]:
    text = " ".join(page_text.split())
    out = []
    for m in FROM_TO.finditer(text):
        p1, p2 = period_of(m["y1"].replace(" ", "")), period_of(m["y2"].replace(" ", ""))
        if not p1 or not p2:
            continue
        subj = re.split(r"(?:,| while | and | whereas |\bwith\b)\s", m["subj"])[-1].strip()
        if " The " in subj:
            subj = subj[subj.rindex(" The ") + 5:]
        subj = re.sub(r"^.*?\b(?=India’s|India's|Indian)", "", subj) if re.search(r"\b(India’s|India's|Indian)\b", subj[12:]) else subj
        subj = re.sub(r"^(Crisil Intelligence|CRISIL|As per [^,]+,?|According to [^,]+,?)\s*", "", subj)
        subj = re.sub(r"^(The|In addition, the|Further, the|Similarly, the)\s+", "", subj).strip(" ,")
        subj = subj[:1].upper() + subj[1:]
        if len(subj) < 6 or not _is_texty(subj):
            continue
        unit = " ".join(filter(None, [m["cur1"] or m["cur2"], (m["u1"] or m["u2"] or "").strip()])) or None
        periods, vals, proj = [p1[0], p2[0]], [float(m["a"].replace(",", "")), float(m["b"].replace(",", ""))], [p1[1], p2[1]]
        tail = re.split(r"\bwhile\b|\bwhereas\b|\bfrom\b|;|\.\s", text[m.end():m.end() + 220])[0]
        for t in THEN.finditer(tail):
            p = period_of(t.group(2).replace(" ", ""))
            if p and p[0] not in periods:
                periods.append(p[0]); vals.append(float(t.group(1).replace(",", ""))); proj.append(p[1])
        out.append(Series(title=subj[:90], unit=unit, page=page_no, kind="text", periods=periods, projected=proj,
                          rows=[{"name": "Value", "values": vals}], note=None))
    return out


MACRO = re.compile(r"\bGDP\b|\bGVA\b|per capita|population|inflation|\bCPI\b|\bIIP\b|repo|urbani[sz]ation|working-age|fiscal deficit|exchange rate|forex|household consumption|\bPFCE\b|\bGFCF\b|economic review|outlook|demographic|investment and consumption|monetary|age group|labou?r force|LFPR|workforce|final consumption|literacy|median age|households?\b", re.I)


def scan(doc, start: int, end: int, limit: int = 60) -> list[dict]:
    """Industry section pages [start, end) → list of series dicts, sector-specific first, macro last."""
    found: list[Series] = []
    seen = set()
    for i in range(start, end):
        page = doc[i]
        try:
            ss = scan_page(page.get_text("words"), i + 1, page.rect.height)
        except Exception:
            ss = []
        ss += scan_text(page.get_text(), i + 1)
        for s in ss:
            key = (s.title.lower()[:50], tuple(s.periods))
            vals = [v for r in s.rows for v in r["values"] if v is not None]
            if key in seen or len(vals) < 2:
                continue
            seen.add(key)
            found.append(s)
    # identical numbers printed twice (chart + statement, or two captions) → keep the first (charts/tables come first per page)
    uniq, seen_v = [], set()
    for s_ in sorted(found, key=lambda x: (x.kind == "text", x.page)):
        sig = tuple(round(v, 3) for r in s_.rows[:1] for v in r["values"] if v is not None)
        if len(sig) >= 2 and sig in seen_v:
            continue
        seen_v.add(sig)
        uniq.append(s_)
    found = uniq
    # a chart beats a text statement for the same subject on the same page
    pages_with_charts = {s.page for s in found if s.kind != "text"}
    found = [s for s in found if not (s.kind == "text" and s.page in pages_with_charts and len(s.periods) <= 2 and
                                      any(t.page == s.page and set(s.periods) <= set(t.periods) for t in found if t.kind != "text"))]
    found.sort(key=lambda s: (bool(MACRO.search(s.title)), s.page))
    return [dict(s.as_dict(), macro=bool(MACRO.search(s.title))) for s in found[:limit]]
