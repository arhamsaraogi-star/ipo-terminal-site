"""BSE SME offer documents, straight from the exchange: bsesme.com/PublicIssues/SMEIPODRHP.aspx.

One table lists every BSE SME issuer with links to its Draft (Red Herring) Prospectus — dated the day it was filed —
plus RHP, Prospectus and basis-of-allotment advertisement. This is the BSE SME counterpart of SEBI's DRHP list, so
BSE SME filings are caught on the day they appear (bseindia.com's JSON APIs block automated access; this page doesn't).
"""
from __future__ import annotations

import html
import re
from datetime import datetime

BASE = "https://www.bsesme.com"
URL = f"{BASE}/PublicIssues/SMEIPODRHP.aspx"


def _abs(href: str) -> str:
    href = html.unescape(href).strip()
    if href.startswith("http"):
        return href
    return BASE + "/" + re.sub(r"^(\.\./|\./|/)+", "", href)


def _stamp(href: str) -> str | None:
    """BSE appends _YYYYMMDDhhmmss to uploaded file names."""
    m = re.search(r"_(20\d{2})(\d{2})(\d{2})\d{6}\.(?:pdf|zip)$", href, re.I)
    if not m:
        return None
    try:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date().isoformat()
    except ValueError:
        return None


def parse(page: str) -> list[dict]:
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(tds) < 4 or "hyDRHP" not in row and "hyRHP" not in row:
            continue
        name = html.unescape(re.sub(r"<[^>]+>", " ", tds[0])).strip()
        name = re.sub(r"\s+", " ", name)
        if not name:
            continue
        rec: dict = {"name": name}
        for key, td in zip(("drhp", "rhp", "prospectus", "allotment_ad"), tds[1:5]):
            m = re.search(r'href="([^"]+)"[^>]*>(.*?)</a>', td, re.S)
            if not m:
                continue
            url = _abs(m.group(1))
            txt = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            d = None
            dm = re.match(r"(\d{2})/(\d{2})/(\d{4})", txt)
            if dm:
                d = f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}"
            rec[key] = {"url": url, "date": d or _stamp(url)}
        out.append(rec)
    return out


def fetch(client) -> list[dict]:
    r = client.request("GET", URL, headers={"Referer": BASE + "/"})
    return parse(r.text)
