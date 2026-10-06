"""Latest financials for the stocks a member adds (watchlist / portfolio) — scraped and parsed, nothing for the rest of the market.

Source: the public company page on Screener.in (annual P&L, balance sheet, cash flows, ratios and the last quarters, in ₹ crore),
read once per stock every REFRESH_HOURS with a polite pace. An optional SCREENER_SESSION secret (a logged-in `sessionid`
cookie) is sent when present. NSE's annual-report list is added as links. Everything is best-effort: a stock that cannot be
read keeps its previous data and the reason is logged on the Needs Review page.

Output: data/fundamentals.json  {KEY: {fetched_at, source_url, basis, name, facts[], quarters[], ratios{}, annual_reports[]}}
KEY is the NSE symbol, or the BSE scrip code for BSE-only stocks. The file ships inside the encrypted vault.
"""
from __future__ import annotations

import calendar
import os
import re
import time
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

from pipeline.common.store import DATA, read_json, write_json
from pipeline.ingestion.http import Client, SourceError

OUT = DATA / "fundamentals.json"
REFRESH_HOURS = 12
BASE = "https://www.screener.in/company"
SECTIONS = {"quarters": "quarters", "profit-loss": "annual", "balance-sheet": "balance", "cash-flow": "cashflow", "ratios": "ratios"}
PERIOD = re.compile(r"^([A-Z][a-z]{2})\s+(\d{4})$")


def num(s: str | None) -> float | None:
    s = (s or "").replace("\xa0", " ").replace("₹", "").replace(",", "").replace("%", "").strip()
    if not s or s in ("-", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean_label(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip().rstrip("+").strip()


class _Page(HTMLParser):
    """Collects, per section id, the tables as {header: [...], rows: {label: [cells]}}, and the top-ratios list."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.section: str | None = None
        self.tables: dict[str, dict] = {}
        self._tr: list[str] | None = None
        self._cell: list[str] | None = None
        self._is_th = False
        self._in_table = False
        self.ratios: dict[str, str] = {}
        self._li: dict | None = None
        self._top = False
        self._span_cls: str | None = None
        self.title = ""
        self._in_h1 = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and a.get("id"):
            self.section = a["id"]
        elif tag == "h1":
            self._in_h1 = True
        elif tag == "table" and self.section in SECTIONS:
            self._in_table = True
            self.tables.setdefault(SECTIONS[self.section], {"header": [], "rows": {}})
        elif tag == "tr" and self._in_table:
            self._tr = []
        elif tag in ("td", "th") and self._tr is not None:
            self._cell, self._is_th = [], tag == "th"
        elif tag == "ul" and a.get("id") == "top-ratios":
            self._top = True
        elif tag == "li" and self._top:
            self._li = {"name": "", "value": []}
        elif tag == "span" and self._li is not None:
            self._span_cls = a.get("class") or ""

    def handle_endtag(self, tag):
        if tag == "h1":
            self._in_h1 = False
        elif tag in ("td", "th") and self._cell is not None and self._tr is not None:
            self._tr.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._tr is not None:
            t = self.tables.get(SECTIONS.get(self.section or "", ""))
            if t is not None and self._tr:
                if not t["header"] and any(PERIOD.match(c) or c == "TTM" for c in self._tr[1:]):
                    t["header"] = self._tr[1:]
                elif t["header"] and self._tr[0]:
                    t["rows"].setdefault(clean_label(self._tr[0]), self._tr[1:])
            self._tr = None
        elif tag == "table":
            self._in_table = False
        elif tag == "ul":
            self._top = False
        elif tag == "li" and self._li is not None:
            if self._li["name"]:
                self.ratios.setdefault(self._li["name"], " ".join("".join(self._li["value"]).split()))
            self._li = None
        elif tag == "span":
            self._span_cls = None

    def handle_data(self, data):
        if self._in_h1 and not self.title:
            self.title = data.strip()
        if self._cell is not None:
            self._cell.append(data)
        elif self._li is not None:
            if self._span_cls is not None and "name" in self._span_cls.split():
                self._li["name"] += data.strip()
            else:
                self._li["value"].append(data)


def parse_company_page(html: str) -> dict:
    p = _Page()
    p.feed(html)
    out: dict = {"name": p.title or None, "top": {k: v for k, v in p.ratios.items() if v}}
    for key, t in p.tables.items():
        cols = [(i, c) for i, c in enumerate(t["header"]) if PERIOD.match(c)]
        out[key] = {"periods": [c for _, c in cols], "rows": {lab: [num(cells[i]) if i < len(cells) else None for i, _ in cols] for lab, cells in t["rows"].items()}}
    return out


def period_end(p: str) -> str:
    m = PERIOD.match(p)
    mon, yr = list(calendar.month_abbr).index(m.group(1)), int(m.group(2))
    return f"{yr}-{mon:02d}-{calendar.monthrange(yr, mon)[1]:02d}"


def period_label(p: str) -> str:
    m = PERIOD.match(p)
    return f"FY{m.group(2)}" if m.group(1) == "Mar" else f"{m.group(1)}-{m.group(2)}"


def _first(rows: dict, *names: str):
    for n in names:
        for k, v in rows.items():
            if k.lower() == n.lower() or k.lower().startswith(n.lower() + " "):
                return v
    return None


def to_facts(key: str, parsed: dict, url: str, now: str) -> list[dict]:
    facts: list[dict] = []

    def add(metric: str, label: str, period: str, v: float | None, table: str, unit: str = "INR crore"):
        if v is None:
            return
        facts.append({"fact_id": f"{key}:{metric}:{period}:screener", "metric": metric, "label": label, "value": round(v, 2), "unit": unit, "period": period,
                      "basis": "screener.in", "kind": "reported", "formula": None, "inputs": [],
                      "source": {"source_type": "THIRD_PARTY", "document_id": None, "page": None, "table": f"Screener.in — {table}", "section": None, "url": url, "sha256": None, "tier": "secondary"},
                      "extraction": {"method": "html:screener", "extracted_at": now, "extractor_version": "fund/1", "confidence": "medium"}, "status": "ok", "note": None, "supersedes": None})

    a, b, c, r = parsed.get("annual"), parsed.get("balance"), parsed.get("cashflow"), parsed.get("ratios")
    if a:
        rows = a["rows"]
        series = {"revenue_from_operations": _first(rows, "Sales", "Revenue"), "ebitda": _first(rows, "Operating Profit", "Financing Profit"), "pbt": _first(rows, "Profit before tax"),
                  "pat": _first(rows, "Net Profit"), "finance_cost": _first(rows, "Interest"), "eps_basic": _first(rows, "EPS in Rs"), "ebitda_margin": _first(rows, "OPM %", "Financing Margin %")}
        labels = {"revenue_from_operations": "Revenue from operations", "ebitda": "EBITDA", "pbt": "Profit before tax", "pat": "Profit after tax", "finance_cost": "Finance costs",
                  "eps_basic": "EPS (basic)", "ebitda_margin": "EBITDA margin"}
        for m, vals in series.items():
            for i, p in enumerate(a["periods"]):
                add(m, labels[m], period_label(p), vals[i] if vals else None, "Profit & Loss", "%" if m == "ebitda_margin" else "INR" if m == "eps_basic" else "INR crore")
    if b:
        rows = b["rows"]
        eq, res, bor, ta = _first(rows, "Equity Capital"), _first(rows, "Reserves"), _first(rows, "Borrowings"), _first(rows, "Total Assets")
        for i, p in enumerate(b["periods"]):
            lab = period_label(p)
            add("equity_share_capital", "Equity share capital", lab, eq[i] if eq else None, "Balance Sheet")
            if eq and res and eq[i] is not None and res[i] is not None:
                add("net_worth", "Net worth", lab, eq[i] + res[i], "Balance Sheet")
            add("total_borrowings", "Total borrowings", lab, bor[i] if bor else None, "Balance Sheet")
            add("total_assets", "Total assets", lab, ta[i] if ta else None, "Balance Sheet")
    if c:
        rows = c["rows"]
        for metric, label, names in (("cfo", "Cash flow from operations", ("Cash from Operating Activity",)), ("cfi", "Cash flow from investing", ("Cash from Investing Activity",)),
                                     ("cff", "Cash flow from financing", ("Cash from Financing Activity",))):
            v = _first(rows, *names)
            for i, p in enumerate(c["periods"]):
                add(metric, label, period_label(p), v[i] if v else None, "Cash Flows")
    if r:
        v = _first(r["rows"], "ROCE %")
        for i, p in enumerate(r["periods"]):
            add("roce", "ROCE", period_label(p), v[i] if v else None, "Ratios", "%")
    return facts


def to_quarters(parsed: dict) -> list[dict]:
    q = parsed.get("quarters")
    if not q:
        return []
    rows = q["rows"]
    sales, np_, eps, opm = _first(rows, "Sales", "Revenue"), _first(rows, "Net Profit"), _first(rows, "EPS in Rs"), _first(rows, "OPM %")
    out = [{"period_end": period_end(p), "income": sales[i] if sales else None, "pat": np_[i] if np_ else None, "eps": eps[i] if eps else None, "opm": opm[i] if opm else None}
           for i, p in enumerate(q["periods"])]
    return sorted(out, key=lambda x: x["period_end"], reverse=True)[:12]


def fetch_page(client: Client, key: str) -> tuple[str, str, str]:
    """-> (html, url, basis). Consolidated numbers first (what Screener shows by default), standalone when there are none."""
    headers = {"Accept": "text/html"}
    if os.environ.get("SCREENER_SESSION"):
        headers["Cookie"] = f"sessionid={os.environ['SCREENER_SESSION'].strip()}"
    last = ""
    for basis, suffix in (("consolidated", "/consolidated/"), ("standalone", "/")):
        url = f"{BASE}/{key}{suffix}"
        try:
            r = client.request("GET", url, headers=headers)
        except SourceError as e:
            last = str(e)
            continue
        if r.status_code == 200 and "id=\"profit-loss\"" in r.text:
            return r.text, url, basis
        last = f"HTTP {r.status_code}" if r.status_code != 200 else "no financial tables on the page"
    raise SourceError(f"Screener {key}: {last[:120]}")


def annual_reports(nse, sym: str) -> list[dict]:
    """Links to the annual reports NSE lists for the company (best effort)."""
    try:
        rows = nse._get(f"annual-reports?index=equities&symbol={sym}") or []
    except Exception:  # noqa: BLE001
        return []
    out = []
    for r in rows if isinstance(rows, list) else (rows.get("data") or []):
        url, yr = r.get("fileName") or r.get("attchmntFile"), str(r.get("toYr") or r.get("to_yr") or "")
        if url and yr:
            out.append({"fy": f"FY{yr}", "url": url})
    return sorted(out, key=lambda x: x["fy"], reverse=True)[:6]


def update(client: Client, reqs: list[dict], log: list[str], nse=None, budget_ok=lambda: True, pace: float = 2.5) -> None:
    cur = read_json(OUT, {}) or {}
    now = datetime.now(timezone.utc)
    wanted = {}
    for r in reqs:
        key = r.get("symbol") or r.get("bse")
        if key:
            wanted[key] = r
    done = failed = 0
    for key, r in wanted.items():
        old = cur.get(key)
        if old and old.get("fetched_at") and now - datetime.fromisoformat(old["fetched_at"]) < timedelta(hours=REFRESH_HOURS):
            continue
        if not budget_ok():
            break
        try:
            html, url, basis = fetch_page(client, key)
            parsed = parse_company_page(html)
            facts = to_facts(key, parsed, url, now.isoformat())
            if not facts:
                raise SourceError(f"Screener {key}: page read but no financial rows recognised")
            rec = {"fetched_at": now.isoformat(), "source_url": url, "basis": basis, "name": parsed.get("name"), "facts": facts, "quarters": to_quarters(parsed),
                   "ratios": parsed.get("top", {}), "annual_reports": annual_reports(nse, key) if nse and r.get("symbol") else (old or {}).get("annual_reports", [])}
            cur[key] = rec
            done += 1
        except Exception as e:  # noqa: BLE001 — keep what we had, say why
            failed += 1
            log.append(f"Fundamentals {key}: {str(e)[:110]}")
        time.sleep(pace)
    cur = {k: v for k, v in cur.items() if k in wanted}
    write_json(OUT, cur)
    if wanted:
        log.append(f"Fundamentals (Screener.in) for stocks you follow: {len(wanted)} requested, {done} refreshed, {failed} failed")
