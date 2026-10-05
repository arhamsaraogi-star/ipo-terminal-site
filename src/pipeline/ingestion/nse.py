"""NSE adapter (primary source): past / current / upcoming issues, issue detail, corporate announcements."""
from __future__ import annotations

import re
from urllib.parse import quote
from datetime import date, datetime

from pipeline.ingestion.http import Client

BASE = "https://www.nseindia.com"
HDR = {"Referer": f"{BASE}/market-data/all-upcoming-issues-ipo", "Accept": "application/json, text/plain, */*"}
EQUITY_TYPES = {"EQ": "MAINBOARD", "BE": "MAINBOARD", "SME": "SME", "SM": "SME", "ST": "SME"}


def issue_page(symbol: str, series: str) -> str:
    return f"{BASE}/market-data/issue-information?symbol={symbol}&series={series}&type=Active"


def parse_date(s: str | None) -> str | None:
    if not s or s.strip() in {"-", ""}:
        return None
    s = s.strip()
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s.title() if "%b" in fmt or "%B" in fmt else s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_band(s: str | None) -> tuple[float | None, float | None]:
    nums = [float(x.replace(",", "")) for x in re.findall(r"(\d[\d,]*\.?\d*)", s or "")]
    if not nums:
        return None, None
    return (nums[0], nums[-1]) if len(nums) > 1 else (nums[0], nums[0])


def parse_num(s) -> float | None:
    if s is None:
        return None
    m = re.search(r"-?\d[\d,]*\.?\d*(?:[Ee][+-]?\d+)?", str(s))
    return float(m.group(0).replace(",", "")) if m else None


class NSE:
    def __init__(self, client: Client):
        self.c = client

    def _get(self, path: str):
        self.c.warm(f"{BASE}/market-data/all-upcoming-issues-ipo")
        return self.c.get_json(f"{BASE}/api/{path}", headers=HDR)

    def past_issues(self, start: date, end: date) -> list[dict]:
        return self._get(f"public-past-issues?from_date={start:%d-%m-%Y}&to_date={end:%d-%m-%Y}&security_type=all") or []

    def current_issues(self) -> list[dict]:
        return self._get("ipo-current-issue") or []

    def upcoming_issues(self) -> list[dict]:
        return self._get("all-upcoming-issues?category=ipo") or []

    def detail(self, symbol: str, series: str) -> dict:
        return self._get(f"ipo-detail?symbol={quote(symbol)}&series={series}") or {}

    def announcements(self, symbol: str, sme: bool = False, since: date | None = None) -> list[dict]:
        q = f"corporate-announcements?index={'sme' if sme else 'equities'}&symbol={quote(symbol)}"
        if since:
            q += f"&from_date={since:%d-%m-%Y}&to_date={date.today():%d-%m-%Y}"
        return self._get(q) or []


# ---------- issue-detail parsing ----------
def info_map(detail: dict) -> dict[str, str]:
    out = {}
    for r in (detail.get("issueInfo") or {}).get("dataList", []):
        t, v = r.get("title"), r.get("value")
        if t and v is not None:
            out[t.strip()] = str(v).strip().strip('"')
    return out


_UNIT = {"lakh": 1e-2, "lakhs": 1e-2, "lacs": 1e-2, "lac": 1e-2, "crore": 1.0, "crores": 1.0, "cr": 1.0,
         "million": 0.1, "mn": 0.1, "billion": 100.0}
_AMT = r"(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|million|mn|billion)"
_SHARES = r"([\d,]+)\s*(?:equity\s+)?shares"


def parse_issue_size(text: str) -> dict:
    """Parse NSE 'Issue Size' prose into fresh/OFS components (₹ crore or shares). Unparsed → absent."""
    t = " ".join((text or "").lower().split())
    out: dict = {}
    m = re.search(r"anchor investor portion of (?:up to )?([\d,]+)", t)
    if m:
        out["anchor_shares"] = int(m.group(1).replace(",", ""))
    fresh_part = re.split(r"offer for sale|ofs", t)[0]
    ofs_part = t[len(fresh_part):] if len(fresh_part) < len(t) else ""
    if "fresh" in fresh_part:
        m = re.search(_AMT, fresh_part)
        if m:
            out["fresh_issue_cr"] = round(float(m.group(1).replace(",", "")) * _UNIT[m.group(2)], 2)
        else:
            m = re.search(_SHARES, fresh_part.split("anchor")[0])
            if m:
                out["fresh_issue_shares"] = int(m.group(1).replace(",", ""))
    if ofs_part:
        seg = ofs_part.split("anchor")[0]
        m = re.search(_AMT, seg)
        if m:
            out["ofs_cr"] = round(float(m.group(1).replace(",", "")) * _UNIT[m.group(2)], 2)
        m = re.search(_SHARES, seg)
        if m:
            out["ofs_shares"] = int(m.group(1).replace(",", ""))
    elif "fresh" not in fresh_part:
        # Pure fresh issue phrased without the word "fresh", e.g. "Public issue of 40,00,000 equity shares"
        m = re.search(_AMT, t)
        if m:
            out["total_issue_cr"] = round(float(m.group(1).replace(",", "")) * _UNIT[m.group(2)], 2)
        else:
            m = re.search(_SHARES, t.split("anchor")[0])
            if m:
                out["fresh_issue_shares"] = int(m.group(1).replace(",", ""))
    return out


def subscription_total(detail: dict) -> float | None:
    for r in (detail.get("activeCat") or {}).get("dataList", []):
        if (r.get("category") or "").strip().lower() == "total":
            return parse_num(r.get("noOfTotalMeant"))
    g = (detail.get("demandGraphALL") or {}).get("noOfTimesIssueSubscribed")
    return parse_num(g)
