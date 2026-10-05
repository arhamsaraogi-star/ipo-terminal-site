"""SEBI adapter (primary source): offer documents filed with SEBI.

smid 10 = Draft offer documents (DRHP), 11 = Red herring documents (RHP), 12 = Final offer documents (Prospectus).
"""
from __future__ import annotations

import html
import re
from datetime import date, datetime

from pipeline.ingestion.http import Client

BASE = "https://www.sebi.gov.in"
LIST = BASE + "/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid={smid}"
AJAX = BASE + "/sebiweb/ajax/home/getnewslistinfo.jsp"
SMID = {"DRHP": 10, "RHP": 11, "PROSPECTUS": 12}
SMTEXT = {10: "Draft Offer Documents filed with SEBI", 11: "Red Herring Documents filed with ROC", 12: "Final Offer Documents transmitted to ROC"}

PDF = re.compile(r"file=(https://www\.sebi\.gov\.in/sebi_data/attachdocs/[^'\"&\s]+\.pdf)", re.I)


def parse_rows(page: str) -> list[dict]:
    """SEBI rows embed malformed nested anchors, so parse each <tr> defensively."""
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        d = re.search(r"<td>\s*([A-Z][a-z]{2} \d{2}, \d{4})\s*</td>", tr)
        u = re.search(r"href=['\"](https://www\.sebi\.gov\.in/filings/public-issues/[^'\"]+\.html)", tr)
        if not (d and u):
            continue
        t = re.search(r"title=\"(.*?)(?:<br|\")", tr, re.S)
        title = t.group(1) if t else re.sub(r"<[^>]+>", " ", tr)
        title = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", title)).split())
        out.append({"date": datetime.strptime(d.group(1), "%b %d, %Y").date().isoformat(), "title": title, "url": u.group(1)})
    return out


def classify(title: str, smid: int) -> tuple[str, str]:
    """-> (doc_kind, company_name) e.g. ('DRHP', 'Deon Energy Limited')."""
    t = title
    kinds = [(r"addendum", "ADDENDUM"), (r"corrigendum", "CORRIGENDUM"), (r"udrhp|updated draft red herring|updated drhp", "UDRHP"),
             (r"\bdrhp\b|draft red herring|draft prospectus|draft letter of offer", "DRHP"), (r"\brhp\b|red herring", "RHP"),
             (r"prospectus", "PROSPECTUS")]
    kind = next((k for p, k in kinds if re.search(p, t, re.I)), {10: "DRHP", 11: "RHP", 12: "PROSPECTUS"}[smid])
    name = re.split(r"\s+[-–]\s+|\s*[-–]\s*(?=(?:drhp|rhp|udrhp|addendum|corrigendum|prospectus|draft|red herring)\b)", t, maxsplit=1, flags=re.I)[0]
    return kind, name.strip(" -–")


class SEBI:
    def __init__(self, client: Client):
        self.c = client

    def filings(self, kind: str, since: date, max_pages: int = 40) -> list[dict]:
        smid = SMID[kind]
        ref = LIST.format(smid=smid)
        first = self.c.request("GET", ref).text
        self.c._warmed.add("www.sebi.gov.in")
        rows = parse_rows(first)
        page = 1
        while rows and rows[-1]["date"] >= since.isoformat() and page < max_pages:
            data = {"nextValue": "1", "next": "n", "search": "", "fromDate": "", "toDate": "", "fromYear": "", "toYear": "",
                    "deptId": "", "sid": "3", "ssid": "15", "smid": str(smid), "ssidhidden": "15", "intmid": "-1",
                    "sText": "Filings", "ssText": "Public Issues", "smText": SMTEXT[smid], "doDirect": str(page)}
            r = self.c.request("POST", AJAX, data=data, headers={"Referer": ref, "X-Requested-With": "XMLHttpRequest"})
            more = parse_rows(r.text)
            if not more:
                break
            rows += more
            page += 1
        out = []
        for r in rows:
            if r["date"] < since.isoformat():
                continue
            k, name = classify(r["title"], smid)
            out.append({**r, "kind": k, "company": name, "list": kind})
        return out

    def pdf_url(self, filing_url: str) -> str | None:
        m = PDF.search(self.c.request("GET", filing_url).text)
        return m.group(1) if m else None
