"""BSE-only IPOs (BSE SME + BSE mainboard) — workaround while bseindia.com's APIs block automated access.

ipowatch.in publishes every live / upcoming issue with platform, dates, price band, issue size and links to the
offer documents (BSE-hosted DRHP, and a copy of the RHP). We read its two list pages, keep rows whose platform is
BSE-only (NSE issues come straight from NSE), and read each issue page. Everything is tagged as a secondary source;
offer documents linked from it are then read by the normal document pipeline (cover + financials + industry).
Listed BSE prices come separately from the BSE bhavcopy CSV (static file, reachable).
"""
from __future__ import annotations

import html
import re
from datetime import datetime

BASE = "https://ipowatch.in"
LISTS = [f"{BASE}/upcoming-sme-ipo-list/", f"{BASE}/upcoming-ipo-list/"]
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"


def _cells(row: str) -> list[str]:
    return [html.unescape(re.sub(r"<[^>]+>", " ", c)).replace("\xa0", " ").strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]


def _tables(page: str) -> list[list[tuple[list[str], list[str]]]]:
    out = []
    for t in re.findall(r"<table.*?</table>", page, re.S):
        out.append([(_cells(r), re.findall(r'href="([^"]+)"', r)) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S)])
    return out


def list_rows(client) -> list[dict]:
    rows = []
    for url in LISTS:
        try:
            page = client.request("GET", url).text
        except Exception:  # noqa: BLE001
            continue
        for t in _tables(page):
            if not t or "Platform" not in " ".join(t[0][0]):
                continue
            head = [h.lower() for h in t[0][0]]
            for cells, links in t[1:]:
                if len(cells) < len(head):
                    continue
                r = dict(zip(head, cells))
                plat = r.get("platform", "")
                if "BSE" not in plat.upper() or "NSE" in plat.upper():
                    continue
                link = next((l for l in links if l.startswith(BASE) and l.rstrip("/").endswith("-ipo")), links[0] if links else None)
                rows.append({"name": r.get("ipo") or r.get("ipo name") or cells[0], "platform": plat, "url": link, "list_url": url})
    seen, out = set(), []
    for r in rows:
        if r["url"] and r["url"] not in seen:
            seen.add(r["url"])
            out.append(r)
    return out


def _date(s: str) -> str | None:
    m = re.search(rf"({MONTHS})\s+(\d{{1,2}}),?\s+(\d{{4}})", s or "")
    if not m:
        return None
    try:
        return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date().isoformat()
    except ValueError:
        return None


def _num(s: str) -> float | None:
    m = re.search(r"([\d,]+(?:\.\d+)?)", s or "")
    return float(m.group(1).replace(",", "")) if m else None


def issue_page(client, url: str) -> dict:
    page = client.request("GET", url).text
    kv: dict[str, str] = {}
    links: dict[str, str] = {}
    for t in _tables(page):
        for cells, ls in t:
            if len(cells) == 2 and cells[0]:
                k = cells[0].rstrip(":").strip().lower()
                kv.setdefault(k, cells[1])
                if ls:
                    links.setdefault(k, ls[0])
    pdfs = [l for l in re.findall(r'href="([^"]+\.pdf)"', page, re.I)]
    lo, hi = None, None
    band = kv.get("ipo price band") or kv.get("price band") or ""
    nums = re.findall(r"₹\s?([\d,]+(?:\.\d+)?)", band)
    if nums:
        lo, hi = float(nums[0].replace(",", "")), float(nums[-1].replace(",", ""))
    return {
        "open": _date(kv.get("ipo open date", "")), "close": _date(kv.get("ipo close date", "")),
        "allotment": _date(kv.get("basis of allotment", "")), "listing": _date(kv.get("ipo listing date", "")),
        "band_low": lo, "band_high": hi,
        "issue_cr": _num(kv.get("issue size", "")) if "crore" in kv.get("issue size", "").lower() else None,
        "fresh_cr": _num(kv.get("fresh issue", "")) if "crore" in kv.get("fresh issue", "").lower() else None,
        "ofs_cr": _num(kv.get("offer for sale", "")) if "crore" in kv.get("offer for sale", "").lower() else None,
        "face_value": _num(kv.get("face value", "")),
        "listing_at": kv.get("ipo listing", ""),
        "drhp": next((l for l in pdfs if "drhp" in l.lower()), None),
        "rhp": next((l for l in pdfs if "rhp" in l.lower() and "drhp" not in l.lower()), None),
        "prospectus": next((l for l in pdfs if "prospectus" in l.lower() and "draft" not in l.lower()), None),
    }
