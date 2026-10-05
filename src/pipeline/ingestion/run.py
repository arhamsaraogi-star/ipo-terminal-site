"""Live ingestion orchestrator: primary sources -> company bundles, events, documents, news, changes.

    PYTHONPATH=src python -m pipeline.ingestion.run --days 183          # incremental (default window 6 months)
    PYTHONPATH=src python -m pipeline.ingestion.run --days 183 --backfill   # first run: no change records

Sources (all primary): NSE offer-document register (Mainboard + SME/Emerge), NSE past/current/upcoming issues,
NSE issue detail, NSE corporate announcements, SEBI offer-document listings (Mainboard).
Any source that fails is skipped and reported; existing data is never deleted because a source failed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date, datetime, timedelta

from pipeline.common.store import IST, DATA, CompanyBundle, company_dirs, load_company, now_ist, read_json, save_company, write_json, write_jsonl, read_jsonl
from pipeline.ingestion.http import Client, SourceError
from pipeline.ingestion import nse as N
from pipeline.ingestion.sebi import SEBI
from pipeline.normalization.entities import Resolver, norm, pretty

VERSION = "ingest-0.2"
TODAY = date.today()
WD_NOTE = "working days per T+N listing timeline; exchange holidays applied where published"


# ───────────────────────── helpers ─────────────────────────
def src(stype: str, url: str, page=None, table=None, tier="primary", doc_id=None) -> dict:
    return {"source_type": stype, "document_id": doc_id, "page": page, "table": table, "section": None,
            "url": url, "sha256": None, "tier": tier}


def ext(method: str) -> dict:
    return {"method": method, "extracted_at": now_ist(), "extractor_version": VERSION, "confidence": "high"}


def fact(oid: str, metric: str, value, unit: str, label: str, source: dict | None, *, kind="reported",
         formula=None, inputs=None, method="exchange:json", note=None, status="ok") -> dict:
    return {"fact_id": f"{oid}:{metric}", "metric": metric, "label": label, "value": value, "unit": unit,
            "period": None, "basis": "offer", "kind": kind, "formula": formula, "inputs": inputs or [],
            "source": source if kind == "reported" else None, "extraction": ext(method) if kind == "reported" else None,
            "status": status, "note": note, "supersedes": None}


class Calendar:
    def __init__(self, holidays: set[str]):
        self.h = holidays

    def is_wd(self, d: date) -> bool:
        return d.weekday() < 5 and d.isoformat() not in self.h

    def add(self, d: date, n: int) -> date:
        step = 1 if n >= 0 else -1
        while n:
            d += timedelta(days=step)
            if self.is_wd(d):
                n -= step
        return d


def ddate(s) -> str | None:
    return N.parse_date(s) if s else None


# ───────────────────────── state ─────────────────────────
class State:
    def __init__(self, backfill: bool):
        self.backfill = backfill
        self.bundles: dict[str, CompanyBundle] = {}
        self.before: dict[str, dict] = {}
        self.res = Resolver()
        self.log: list[str] = []
        self.failures: list[str] = []
        for d in company_dirs():
            b = load_company(d)
            if b.company.get("is_sample"):
                continue
            cid = b.company["company_id"]
            self.bundles[cid] = b
            self.before[cid] = snapshot(b)
            ids = b.company["identifiers"]
            self.res.add(cid, [b.company["name"], b.company.get("legal_name") or "", *b.company.get("aliases", [])],
                         ids.get("isin"), ids.get("nse_symbol"))
            if ids.get("pan"):
                self.res.by_key["p:" + ids["pan"]] = cid

    def company(self, name: str, *, isin=None, symbol=None, pan=None, segment="UNKNOWN", source="") -> CompanyBundle:
        isin = isin if isin and re.match(r"^INE[A-Z0-9]{9}$", isin) else None
        pan = pan if pan and re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", pan) else None
        cid = (self.res.by_key.get("p:" + pan) if pan else None) or self.res.find(name, isin, symbol)
        if cid is None:
            cid = self.res.new_id(name)
            ts = now_ist()
            self.bundles[cid] = CompanyBundle(company={
                "company_id": cid, "name": pretty(name), "legal_name": pretty(name), "aliases": [],
                "identifiers": {"cin": None, "isin": None, "nse_symbol": None, "bse_code": None, "pan": None},
                "sector": None, "industry": None, "segment": segment, "lifecycle": "DRHP_FILED",
                "private_tracker": None, "overview": None, "website": None, "ir_url": None, "registered_office": None,
                "is_sample": False, "created_at": ts, "updated_at": ts, "drhp_status": None, "sources": []})
        b = self.bundles[cid]
        c = b.company
        ids = c["identifiers"]
        if isin and not ids.get("isin"):
            ids["isin"] = isin
        if symbol and symbol not in ("-", "") and not ids.get("nse_symbol"):
            ids["nse_symbol"] = symbol.upper()
        if pan and not ids.get("pan"):
            ids["pan"] = pan
        if segment != "UNKNOWN" and c["segment"] == "UNKNOWN":
            c["segment"] = segment
        if norm(name) != norm(c["name"]) and pretty(name) not in c["aliases"]:
            c["aliases"].append(pretty(name))
        if source and source not in c["sources"]:
            c["sources"].append(source)
        self.res.add(cid, [name], ids.get("isin"), ids.get("nse_symbol"))
        if ids.get("pan"):
            self.res.by_key["p:" + ids["pan"]] = cid
        return b


def offering(b: CompanyBundle) -> dict:
    cid = b.company["company_id"]
    for o in b.offerings:
        if o["type"] == "IPO":
            o["segment"] = b.company["segment"]
            return o
    o = {"offering_id": f"{cid}:ipo", "company_id": cid, "type": "IPO", "segment": b.company["segment"],
         "exchanges": [], "facts": {}, "intermediaries": {"brlms": [], "registrar": None}, "subscription": None,
         "detail_fetched_at": None}
    b.offerings.append(o)
    return o


def upsert_event(b: CompanyBundle, etype: str, d: str | None, kind: str, source: dict | None, detail=None, rule=None) -> None:
    """One event per (type, kind-class). Actual beats scheduled beats derived; a later actual replaces an earlier one."""
    if not d:
        return
    cid = b.company["company_id"]
    rank = {"derived": 0, "scheduled": 1, "actual": 2}
    same = [e for e in b.events if e["event_type"] == etype]
    if etype in ("DOCUMENT_REVISED", "UDRHP_FILED"):
        same = [e for e in same if e["date"] == d and (e.get("detail") or "") == (detail or "")]
    for e in same:
        if rank[kind] < rank[e["date_kind"]]:
            return
    b.events = [e for e in b.events if e not in same]
    b.events.append({"event_id": f"{cid}:{etype}:{d}:{hashlib.md5((detail or '').encode()).hexdigest()[:6]}", "company_id": cid,
                     "offering_id": f"{cid}:ipo", "event_type": etype, "date": d, "date_kind": kind, "detail": detail,
                     "source": source, "rule_id": rule, "detected_at": now_ist()})


def upsert_doc(b: CompanyBundle, doc_type: str, url: str, filing_date: str | None, source: str, title=None, size=None) -> dict:
    cid = b.company["company_id"]
    for d in b.documents:
        if d["url"] == url or (d.get("title") and title and d["title"] == title and d["doc_type"] == doc_type):
            if url.endswith(".pdf") and not d["url"].endswith(".pdf"):
                d["url"] = url
            return d
    prior = [d for d in b.documents if d["doc_type"] == doc_type]
    doc = {"document_id": f"{cid}:{doc_type.lower()}:v{len(prior) + 1}:{source.lower()}", "company_id": cid,
           "doc_type": doc_type, "title": title or f"{doc_type} ({source})", "url": url, "source": source,
           "filing_date": filing_date, "downloaded_at": None, "sha256": None, "pages": None,
           "storage": None, "version": len(prior) + 1,
           "previous_version": prior[-1]["document_id"] if prior else None}
    if size:
        doc["title"] += f" · {size}"
    b.documents.append(doc)
    return doc


# ───────────────────────── adapters → state ─────────────────────────
def ingest_offerdocs(st: State, nse: N.NSE, since: date) -> None:
    for index, segment in (("equities", "MAINBOARD"), ("sme", "SME")):
        try:
            rows = nse._get(f"corporates/offerdocs?index={index}") or []
        except SourceError as e:
            st.failures.append(f"NSE offerdocs/{index}: {e}")
            continue
        n = 0
        for r in rows:
            dates = {k: ddate(r.get(k)) for k in ("drhpDate", "rhpDate", "fpDate", "advDate")}
            if not any(d and d >= since.isoformat() for d in dates.values()):
                continue
            name = (r.get("company") or "").strip()
            if not name:
                continue
            b = st.company(name, isin=r.get("isin"), pan=r.get("pan_no"), symbol=None if r.get("symbol") in (None, "-") else r["symbol"],
                           segment=segment, source="NSE-offerdocs")
            reg = f"https://www.nseindia.com/companies-listing/public-issues-offer-documents"
            if r.get("drhpStatus"):
                b.company["drhp_status"] = r["drhpStatus"]
            for key, dt, etype, label in (("drhpAttach", "drhpDate", "DRHP_FILED", "DRHP"), ("rhpAttach", "rhpDate", "RHP_FILED", "RHP"),
                                          ("fpAttach", "fpDate", "PROSPECTUS_FILED", "PROSPECTUS"), ("advAttach", "advDate", None, "ADVERTISEMENT")):
                d = dates[dt]
                if not d:
                    continue
                url = r.get(key) or reg
                upsert_doc(b, label, url, d, "NSE", title=f"{label} — NSE {'Emerge ' if segment == 'SME' else ''}register",
                           size=r.get(key + "FileSize"))
                if etype:
                    upsert_event(b, etype, d, "actual", src(label if label != "ADVERTISEMENT" else "EXCHANGE_ANNOUNCEMENT", url))
            if (r.get("drhpStatus") or "").lower() == "withdrawn":
                b.company["lifecycle"] = "WITHDRAWN"
            n += 1
        st.log.append(f"NSE offer-document register ({index}): {n} companies in window")


def ingest_sebi(st: State, sebi: SEBI, since: date, pdf_budget: int) -> None:
    kind_map = {"DRHP": ("DRHP", "DRHP_FILED"), "UDRHP": ("UDRHP", "UDRHP_FILED"), "RHP": ("RHP", "RHP_FILED"),
                "PROSPECTUS": ("PROSPECTUS", "PROSPECTUS_FILED"), "ADDENDUM": ("ADDENDUM", "DOCUMENT_REVISED"),
                "CORRIGENDUM": ("CORRIGENDUM", "DOCUMENT_REVISED")}
    for lst in ("DRHP", "RHP", "PROSPECTUS"):
        try:
            rows = sebi.filings(lst, since)
        except SourceError as e:
            st.failures.append(f"SEBI {lst}: {e}")
            continue
        for r in rows:
            if re.search(r"\b(invit|reit|infrastructure investment trust|real estate investment trust|letter of offer|rights)\b", r["title"], re.I):
                continue
            doc_type, etype = kind_map[r["kind"]]
            b = st.company(r["company"], segment="MAINBOARD", source="SEBI")
            doc = upsert_doc(b, doc_type, r["url"], r["date"], "SEBI", title=r["title"])
            if not doc["url"].endswith(".pdf") and pdf_budget > 0:
                pdf_budget -= 1
                try:
                    p = sebi.pdf_url(r["url"])
                    if p:
                        doc["url"] = p
                except SourceError as e:
                    st.failures.append(f"SEBI pdf {r['url']}: {e}")
            upsert_event(b, etype, r["date"], "actual", src(doc_type, doc["url"]),
                         detail=r["title"] if etype == "DOCUMENT_REVISED" else None)
        st.log.append(f"SEBI {lst} list: {len(rows)} filings since {since}")


def ingest_issues(st: State, nse: N.NSE, since: date, cal: Calendar, detail_budget: int) -> None:
    rows: list[dict] = []
    for label, fn in (("past", lambda: nse.past_issues(since, TODAY + timedelta(days=30))), ("current", nse.current_issues),
                      ("upcoming", nse.upcoming_issues)):
        try:
            got = fn()
            for g in got:
                g["_feed"] = label
            rows += got
        except SourceError as e:
            st.failures.append(f"NSE {label} issues: {e}")
    seen = set()
    for r in rows:
        series = (r.get("securityType") or r.get("series") or "").upper()
        if series not in N.EQUITY_TYPES:
            continue  # InvITs, REITs, debt
        sym = (r.get("symbol") or "").upper()
        if not sym or sym in seen and r["_feed"] == "past":
            continue
        seen.add(sym)
        segment = N.EQUITY_TYPES[series]
        name = r.get("company") or r.get("companyName") or sym
        b = st.company(name, symbol=sym, segment=segment, source="NSE-issues")
        o = offering(b)
        exch = "NSE_EMERGE" if segment == "SME" else "NSE"
        if exch not in o["exchanges"]:
            o["exchanges"].append(exch)
        page = N.issue_page(sym, "SME" if segment == "SME" else series)
        s = src("EXCHANGE_ISSUE_PAGE", page)
        lo, hi = N.parse_band(r.get("priceRange") or r.get("issuePrice"))
        if lo is not None:
            o["facts"]["price_band_low"] = fact(o["offering_id"], "price_band_low", lo, "INR", "Price band — low", s)
            o["facts"]["price_band_high"] = fact(o["offering_id"], "price_band_high", hi, "INR", "Price band — high", s)
        ip = N.parse_num(r.get("issuePrice")) if r["_feed"] == "past" and "to" not in str(r.get("issuePrice", "")) else None
        if ip:
            o["facts"]["issue_price"] = fact(o["offering_id"], "issue_price", ip, "INR", "Final issue price", s)
        if r.get("issueSize") and r["_feed"] != "past":
            o["facts"]["shares_offered_ex_anchor"] = fact(o["offering_id"], "shares_offered_ex_anchor", int(float(r["issueSize"])), "shares",
                                                          "Shares offered (excl. anchor)", s)
        op, cl = ddate(r.get("ipoStartDate") or r.get("issueStartDate")), ddate(r.get("ipoEndDate") or r.get("issueEndDate"))
        lst = ddate(r.get("listingDate"))
        today = TODAY.isoformat()
        if op:
            upsert_event(b, "ISSUE_OPEN", op, "actual" if op <= today else "scheduled", s)
            upsert_event(b, "ANCHOR_BIDDING", cal.add(date.fromisoformat(op), -1).isoformat(), "derived", None,
                         detail="One working day before issue opening (Mainboard ICDR timeline)" if segment == "MAINBOARD" else "Anchor portion (if any) bids one working day before opening", rule="T-1")
        if cl:
            upsert_event(b, "ISSUE_CLOSE", cl, "actual" if cl <= today else "scheduled", s)
            c0 = date.fromisoformat(cl)
            upsert_event(b, "BASIS_OF_ALLOTMENT", cal.add(c0, 1).isoformat(), "derived", None, detail=f"T+1 — {WD_NOTE}", rule="T+1")
            upsert_event(b, "REFUND_DEMAT", cal.add(c0, 2).isoformat(), "derived", None, detail=f"T+2 — {WD_NOTE}", rule="T+2")
            if not lst:
                upsert_event(b, "LISTING", cal.add(c0, 3).isoformat(), "derived", None, detail=f"T+3 — {WD_NOTE}", rule="T+3")
        if lst:
            upsert_event(b, "LISTING", lst, "actual" if lst <= today else "scheduled", s)
        # issue detail: fetch for live/recent issues or when never fetched
        recent = cl and (TODAY - date.fromisoformat(cl)).days <= 7
        if detail_budget > 0 and (not o.get("detail_fetched_at") or recent or r["_feed"] != "past"):
            detail_budget -= 1
            try:
                apply_detail(b, o, nse.detail(sym, "SME" if segment == "SME" else series), s)
            except SourceError as e:
                st.failures.append(f"NSE detail {sym}: {e}")
    st.log.append(f"NSE issues: {len(seen)} equity issues (Mainboard + SME) in window")


def apply_detail(b: CompanyBundle, o: dict, d: dict, s: dict) -> None:
    info = N.info_map(d)
    oid, F = o["offering_id"], o["facts"]
    meta = d.get("metaInfo") or {}
    if meta.get("isin") and re.match(r"^INE[A-Z0-9]{9}$", meta["isin"]) and not b.company["identifiers"].get("isin"):
        b.company["identifiers"]["isin"] = meta["isin"]
    if "price_band_high" not in F and info.get("Price Range"):
        lo, hi = N.parse_band(info["Price Range"])
        if lo is not None:
            F["price_band_low"] = fact(oid, "price_band_low", lo, "INR", "Price band — low", s)
            F["price_band_high"] = fact(oid, "price_band_high", hi, "INR", "Price band — high", s)
    if (v := N.parse_num(info.get("Face Value"))) is not None:
        F["face_value"] = fact(oid, "face_value", v, "INR", "Face value", s)
    if (v := N.parse_num(info.get("Bid Lot") or info.get("Minimum Order Quantity"))) is not None:
        F["lot_size"] = fact(oid, "lot_size", int(v), "shares", "Bid lot", s)
    if info.get("Issue Type"):
        F["issue_type"] = fact(oid, "issue_type", info["Issue Type"], "text", "Issue type", s)
    size_text = info.get("Issue Size") or ""
    if size_text:
        F["issue_size_text"] = fact(oid, "issue_size_text", size_text[:600], "text", "Issue size (as published)", s)
        p = N.parse_issue_size(size_text)
        price = (F.get("issue_price") or F.get("price_band_high") or {}).get("value")
        if "fresh_issue_cr" in p:
            F["fresh_issue"] = fact(oid, "fresh_issue", p["fresh_issue_cr"], "INR crore", "Fresh issue", s, method="regex:issue_size")
        if "fresh_issue_shares" in p:
            F["fresh_issue_shares"] = fact(oid, "fresh_issue_shares", p["fresh_issue_shares"], "shares", "Fresh issue shares", s, method="regex:issue_size")
            if price and "fresh_issue_cr" not in p:
                F["fresh_issue"] = fact(oid, "fresh_issue", round(p["fresh_issue_shares"] * price / 1e7, 2), "INR crore", "Fresh issue (at price)", None,
                                        kind="calculated", formula="fresh issue shares × issue price (or upper band) ÷ 10⁷", inputs=[f"{oid}:fresh_issue_shares"])
        if "ofs_cr" in p:
            F["ofs"] = fact(oid, "ofs", p["ofs_cr"], "INR crore", "Offer for sale", s, method="regex:issue_size")
        if "ofs_shares" in p:
            F["ofs_shares"] = fact(oid, "ofs_shares", p["ofs_shares"], "shares", "OFS shares", s, method="regex:issue_size")
            if price and "ofs_cr" not in p:
                F["ofs"] = fact(oid, "ofs", round(p["ofs_shares"] * price / 1e7, 2), "INR crore", "Offer for sale (at price)", None,
                                kind="calculated", formula="OFS shares × issue price (or upper band) ÷ 10⁷", inputs=[f"{oid}:ofs_shares"])
        if "total_issue_cr" in p:
            F["total_issue"] = fact(oid, "total_issue", p["total_issue_cr"], "INR crore", "Total issue", s, method="regex:issue_size")
        elif "fresh_issue" in F or "ofs" in F:
            fr = (F.get("fresh_issue") or {}).get("value") or 0
            of = (F.get("ofs") or {}).get("value") or 0
            if "fresh" not in size_text.lower():
                fr = 0
            F["total_issue"] = fact(oid, "total_issue", round(fr + of, 2), "INR crore", "Total issue", None, kind="calculated",
                                    formula="fresh issue + offer for sale", inputs=[k for k in (f"{oid}:fresh_issue", f"{oid}:ofs") if k.split(":")[-1] in F])
        if "anchor_shares" in p:
            F["anchor_shares"] = fact(oid, "anchor_shares", p["anchor_shares"], "shares", "Anchor investor portion", s, method="regex:issue_size")
    brlm = info.get("Book Running Lead Managers") or info.get("Lead Managers") or info.get("Book Running Lead Manager")
    if brlm:
        o["intermediaries"]["brlms"] = [x.strip(" .") for x in re.split(r",| and (?=[A-Z])", brlm) if x.strip(" .")]
    if info.get("Name of the Registrar"):
        o["intermediaries"]["registrar"] = info["Name of the Registrar"]
    if info.get("Red Herring Prospectus", "").startswith("http"):
        upsert_doc(b, "RHP", info["Red Herring Prospectus"], None, "NSE", title="RHP — NSE issue page (zip)")
    if info.get("Anchor Allocation Report", "").startswith("http"):
        upsert_doc(b, "ANCHOR_ALLOCATION", info["Anchor Allocation Report"], None, "NSE", title="Anchor allocation report (zip)")
    if info.get("Ratios / Basis of Issue Price", "").startswith("http"):
        upsert_doc(b, "RATIOS", info["Ratios / Basis of Issue Price"], None, "NSE", title="Basis of issue price / ratios (zip)")
    sub = N.subscription_total(d)
    if sub is not None:
        o["subscription"] = {"total_times": round(sub, 2), "as_of": now_ist(), "source": s}
    o["detail_fetched_at"] = now_ist()


CATS = [("results", r"financial result|results|outcome of board meeting.*result"), ("board_meeting", r"board meeting"),
        ("lockin", r"lock-?in"), ("shareholding", r"shareholding"), ("insider_trading", r"insider trading|trading window|sast|reg(ulation)? 7|reg(ulation)? 29"),
        ("management_change", r"resign|appoint|cessation|change in (director|management|kmp)"),
        ("order_win", r"order|contract|award|letter of intent|loi"), ("rating", r"credit rating|rating"),
        ("litigation_regulatory", r"litigation|penalty|show cause|sebi order|tax demand|dispute"),
        ("fund_raise", r"qip|preferential|rights issue|fund raising|allotment of"), ("agm_meeting", r"agm|egm|postal ballot|meeting"),
        ("monitoring_agency", r"monitoring agency|utili[sz]ation of (ipo )?proceeds"), ("investor_meet", r"analyst|investor meet|con\.? call|earnings call")]


def classify_news(text: str) -> str:
    t = text.lower()
    return next((c for c, p in CATS if re.search(p, t)), "other")


def ingest_news(st: State, nse: N.NSE, max_companies: int) -> None:
    pf = read_json(DATA / "portfolio" / "holdings.json", {"holdings": [], "watchlist": []})
    priority = {h["company_id"] for h in pf["holdings"]} | set(pf["watchlist"])
    listed = [b for b in st.bundles.values() if b.company["identifiers"].get("nse_symbol") and
              any(e["event_type"] == "LISTING" and e["date_kind"] == "actual" for e in b.events)]
    def listed_on(b):
        return max((e["date"] for e in b.events if e["event_type"] == "LISTING"), default="")
    # holdings/watchlist first, then most recently listed (fresh listings generate the most filings)
    listed.sort(key=lambda b: (b.company["company_id"] not in priority, "".join(chr(255 - ord(c)) for c in listed_on(b))))
    n_new = 0
    for b in listed[:max_companies]:
        sym = b.company["identifiers"]["nse_symbol"]
        try:
            rows = nse.announcements(sym, sme=b.company["segment"] == "SME", since=TODAY - timedelta(days=183))
        except SourceError as e:
            st.failures.append(f"NSE announcements {sym}: {e}")
            continue
        have = {n["news_id"] for n in b.news}
        for r in rows[:100]:
            nid = f"{b.company['company_id']}:nse:{r.get('seq_id') or hashlib.md5(json.dumps(r, sort_keys=True).encode()).hexdigest()[:10]}"
            if nid in have:
                continue
            ts = r.get("sort_date") or ""
            try:
                published = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=IST).isoformat()
            except ValueError:
                continue
            desc = (r.get("desc") or "").strip()
            body = (r.get("attchmntText") or "").strip()
            title = f"{desc}: {body}" if desc and body and not body.lower().startswith(desc.lower()) else (body or desc)
            b.news.append({"news_id": nid, "company_id": b.company["company_id"], "published_at": published,
                           "title": title[:400], "url": r.get("attchmntFile") or N.issue_page(sym, "EQ"),
                           "publisher": "NSE", "tier": "official", "category": classify_news(f"{desc} {body}"),
                           "dedupe_key": r.get("seq_id")})
            n_new += 1
        b.news.sort(key=lambda n: n["published_at"], reverse=True)
        b.news = b.news[:300]
    st.log.append(f"NSE announcements: {min(len(listed), max_companies)} listed companies checked, {n_new} new items")


# ───────────────────────── lifecycle, changes ─────────────────────────
def lifecycle(b: CompanyBundle) -> str:
    if b.company["lifecycle"] == "WITHDRAWN" and not any(e["event_type"] == "ISSUE_OPEN" for e in b.events):
        return "WITHDRAWN"
    t = TODAY.isoformat()
    ev = {}
    for e in b.events:
        if e["date_kind"] != "derived":
            ev.setdefault(e["event_type"], []).append(e["date"])
    first = lambda k: min(ev[k]) if k in ev else None  # noqa: E731
    lst, op, cl = first("LISTING"), first("ISSUE_OPEN"), first("ISSUE_CLOSE")
    if lst and lst <= t:
        return "LISTED"
    if cl and cl < t:
        return "ISSUE_CLOSED"
    if op and op <= t:
        return "ISSUE_OPEN"
    if op:
        return "ISSUE_ANNOUNCED"
    if "RHP_FILED" in ev or "PROSPECTUS_FILED" in ev:
        return "RHP_FILED"
    if (b.company.get("drhp_status") or "").lower() == "approved":
        return "SEBI_OBSERVED"
    if "DRHP_FILED" in ev or "UDRHP_FILED" in ev:
        return "DRHP_FILED"
    return b.company["lifecycle"]


def snapshot(b: CompanyBundle) -> dict:
    o = next((x for x in b.offerings if x["type"] == "IPO"), {"facts": {}})
    f = o.get("facts", {})
    val = lambda k: (f.get(k) or {}).get("value")  # noqa: E731
    ev = {}
    for e in b.events:
        if e["date_kind"] != "derived":
            ev[e["event_type"]] = min(ev.get(e["event_type"], e["date"]), e["date"])
    band = f"₹{val('price_band_low'):g}–{val('price_band_high'):g}" if val("price_band_low") and val("price_band_high") else None
    return {"lifecycle": b.company["lifecycle"], "price_band": band, "issue_price": val("issue_price"),
            "total_issue": val("total_issue"), "ISSUE_OPEN": ev.get("ISSUE_OPEN"), "ISSUE_CLOSE": ev.get("ISSUE_CLOSE"),
            "LISTING": ev.get("LISTING"), "RHP_FILED": ev.get("RHP_FILED"), "DRHP_FILED": ev.get("DRHP_FILED"),
            "drhp_status": b.company.get("drhp_status"), "documents": len(b.documents)}


LABELS = {"lifecycle": "Stage changed", "price_band": "Price band", "issue_price": "Final issue price", "total_issue": "Issue size (₹ cr)",
          "ISSUE_OPEN": "Issue opening date", "ISSUE_CLOSE": "Issue closing date", "LISTING": "Listing date", "RHP_FILED": "RHP filed",
          "DRHP_FILED": "DRHP filed", "drhp_status": "Offer-document status", "documents": "Documents on file"}


def diff_changes(st: State) -> list[dict]:
    out = []
    ts = now_ist()
    for cid, b in st.bundles.items():
        new = snapshot(b)
        old = st.before.get(cid)
        if old is None:
            if not st.backfill:
                out.append({"change_id": f"{cid}:{ts}:new", "company_id": cid, "field": "company", "label": "New company tracked",
                            "old": None, "new": b.company["lifecycle"], "source": None, "detected_at": ts})
            continue
        for k, v in new.items():
            if old.get(k) != v and v is not None:
                out.append({"change_id": f"{cid}:{ts}:{k}", "company_id": cid, "field": k, "label": LABELS[k],
                            "old": old.get(k), "new": v, "source": None, "detected_at": ts})
    return out


# ───────────────────────── main ─────────────────────────
def remove_samples() -> int:
    import shutil
    n = 0
    for d in company_dirs():
        if (read_json(d / "company.json") or {}).get("is_sample"):
            shutil.rmtree(d)
            n += 1
    for p in (DATA / "changes").glob("sample-*.jsonl"):
        p.unlink()
    pf = read_json(DATA / "portfolio" / "holdings.json", {"holdings": [], "watchlist": []})
    ids = {d.name for d in company_dirs()}
    pf["holdings"] = [h for h in pf["holdings"] if h["company_id"] in ids]
    pf["watchlist"] = [w for w in pf["watchlist"] if w in ids]
    write_json(DATA / "portfolio" / "holdings.json", pf)
    return n


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=183)
    ap.add_argument("--backfill", action="store_true")
    ap.add_argument("--detail-budget", type=int, default=250)
    ap.add_argument("--pdf-budget", type=int, default=400)
    ap.add_argument("--news-companies", type=int, default=250)
    ap.add_argument("--cover-budget", type=int, default=40, help="offer documents to download + extract per run")
    ap.add_argument("--skip", default="", help="comma list: sebi,offerdocs,issues,covers,news")
    a = ap.parse_args(argv)
    skip = set(filter(None, a.skip.split(",")))
    since = TODAY - timedelta(days=a.days)

    removed = remove_samples()
    st = State(a.backfill)
    client = Client()
    nse, sebi = N.NSE(client), SEBI(client)
    holidays: set[str] = set()
    try:
        h = nse._get("holiday-master?type=trading")
        holidays = {N.parse_date(x["tradingDate"]) for x in h.get("CM", []) if x.get("tradingDate")}
    except SourceError as e:
        st.failures.append(f"NSE holidays: {e} (weekends only)")
    cal = Calendar(holidays)

    if "offerdocs" not in skip:
        print('▶ ingest_offerdocs', flush=True)
        ingest_offerdocs(st, nse, since)
    if "sebi" not in skip:
        print('▶ ingest_sebi', flush=True)
        ingest_sebi(st, sebi, since, a.pdf_budget)
    if "issues" not in skip:
        print('▶ ingest_issues', flush=True)
        ingest_issues(st, nse, since, cal, a.detail_budget)
    for b in st.bundles.values():
        b.company["lifecycle"] = lifecycle(b)
        save_company(b)  # checkpoint: discovery is never lost if a later phase times out
    if "covers" not in skip:
        print('▶ extract_covers', flush=True)
        extract_covers(st, client, a.cover_budget)
    if "news" not in skip:
        print('▶ ingest_news', flush=True)
        ingest_news(st, nse, a.news_companies)

    changes = diff_changes(st)
    for b in st.bundles.values():
        if snapshot(b) != st.before.get(b.company["company_id"]):
            b.company["updated_at"] = now_ist()
        b.events.sort(key=lambda e: (e["date"], e["event_type"]))
        save_company(b)
    if changes:
        p = DATA / "changes" / f"{TODAY:%Y-%m}.jsonl"
        write_jsonl(p, read_jsonl(p) + changes)

    status = {"ran_at": now_ist(), "window_days": a.days, "companies": len(st.bundles), "changes": len(changes),
              "removed_samples": removed, "log": st.log, "failures": st.failures}
    write_json(DATA / "index" / "ingest_status.json", status)
    print(json.dumps(status, indent=2, ensure_ascii=False))
    # Total failure of every source = non-zero exit so the workflow does not publish an empty refresh.
    return 2 if st.failures and not st.log else 0



# ───────────────────────── offer-document cover extraction ─────────────────────────
MAX_PDF = 80 * 1024 * 1024


def download(client: Client, url: str) -> bytes:
    """Full download with Content-Length verification (truncated PDFs silently corrupt extraction)."""
    for attempt in range(3):
        r = client.request("GET", url, stream=True)
        want = int(r.headers.get("Content-Length") or 0)
        if want > MAX_PDF:
            raise SourceError(f"{url}: {want / 1e6:.0f} MB exceeds limit")
        blob = r.content
        if not want or len(blob) >= want:
            return blob
    raise SourceError(f"{url}: truncated download ({len(blob)} of {want} bytes)")


def extract_covers(st: State, client: Client, budget: int, minutes: float = 25) -> None:
    import gzip
    import time
    deadline = time.monotonic() + minutes * 60
    from pipeline.extraction import drhp_cover as X
    done = failed = 0
    order = {"RHP": 0, "UDRHP": 1, "DRHP": 2, "PROSPECTUS": 3}
    queue = []
    for b in st.bundles.values():
        docs = [d for d in b.documents if d["doc_type"] in order and re.search(r"\.(pdf|zip)$", d["url"], re.I)
                and not (d.get("extraction") or {}).get("status") in ("ok", "failed_permanent")]
        if docs:
            # newest filing first: that is the one an anchor desk needs today
            queue.append((max(d.get("filing_date") or "" for d in docs), b, sorted(docs, key=lambda d: (order[d["doc_type"]], d.get("filing_date") or ""))[0]))
    queue.sort(key=lambda x: x[0], reverse=True)
    for _, b, d in queue[:budget]:
        if time.monotonic() > deadline:
            break
        try:
            blob = download(client, d["url"])
            pdf = X.pdf_bytes(blob)
            if not pdf:
                raise SourceError("no PDF inside download")
            pages, n = X.cover_pages(pdf)
            sha = hashlib.sha256(pdf).hexdigest()
            e = X.extract(pages)
        except Exception as ex:  # noqa: BLE001 — any parser failure is recorded, never fatal
            tries = (d.get("extraction") or {}).get("tries", 0) + 1
            d["extraction"] = {"status": "failed_permanent" if tries >= 3 else "failed", "tries": tries,
                               "error": str(ex)[:200], "extracted_at": now_ist()}
            failed += 1
            continue
        d.update({"sha256": sha, "pages": n, "downloaded_at": now_ist(), "size_bytes": len(pdf)})
        tdir = DATA / "text" / sha[:16]
        tdir.mkdir(parents=True, exist_ok=True)
        for i, p in enumerate(pages, 1):
            (tdir / f"p{i:03d}.txt.gz").write_bytes(gzip.compress(p.encode("utf-8"), mtime=0))
        apply_cover(b, d, e, sha)
        d["extraction"] = {"status": "ok", "extracted_at": now_ist(), "garbled": e["garbled"], "extractor": "drhp_cover/1"}
        done += 1
    st.log.append(f"Offer-document covers: {done} extracted, {failed} failed, {max(0, len(queue) - budget)} queued for next run")


def apply_cover(b: CompanyBundle, d: dict, e: dict, sha: str) -> None:
    o = offering(b)
    oid, F = o["offering_id"], o["facts"]
    st_type = d["doc_type"] if d["doc_type"] in ("DRHP", "RHP", "UDRHP", "PROSPECTUS") else "DRHP"
    pg = e.get("_pages", {})
    s_off = src(st_type, d["url"], page=pg.get("offer") or 1, table="Cover page — details of the offer", doc_id=d["document_id"])
    s_off["sha256"] = sha
    s_brlm = {**s_off, "page": pg.get("brlm") or s_off["page"], "table": "Cover page — book running lead manager(s)"}
    status = "requires_review" if e["garbled"] else "ok"
    note = "Text layer looked corrupted; verify against the PDF" if e["garbled"] else None
    prefix = "drhp_" if st_type in ("DRHP", "UDRHP") else ""
    # Offer-document figures are kept separately from exchange figures; exchange data (final) wins in the UI.
    for k, metric, unit, label in (("fresh_cr", "fresh_issue", "INR crore", "Fresh issue"), ("ofs_cr", "ofs", "INR crore", "Offer for sale"),
                                   ("total_cr", "total_issue", "INR crore", "Total issue"), ("fresh_shares", "fresh_issue_shares", "shares", "Fresh issue shares"),
                                   ("ofs_shares", "ofs_shares", "shares", "OFS shares"), ("total_shares", "total_issue_shares", "shares", "Total issue shares")):
        if e.get(k) is not None:
            key = f"{prefix}{metric}"
            if prefix or key not in F or F[key].get("kind") == "calculated":
                F[key] = fact(oid, key, e[k], unit, f"{label} ({st_type} cover)", s_off, method="pdf:cover", status=status, note=note)
    if e.get("offer_type"):
        F["offer_type"] = fact(oid, "offer_type", e["offer_type"], "text", "Offer type", s_off, method="pdf:cover")
    if e.get("regulation"):
        reg = e["regulation"]
        meaning = {"6(1)": "profitability track record route (ICDR 6(1))", "6(2)": "no track record — ≥75% to QIBs (ICDR 6(2))",
                   "229(1)": "SME route (ICDR 229(1))", "229(2)": "SME route (ICDR 229(2))"}.get(reg, reg)
        F["eligibility_regulation"] = fact(oid, "eligibility_regulation", reg, "text", "Eligibility", s_off, method="pdf:cover", note=meaning)
    F["anchor_portion_contemplated"] = fact(oid, "anchor_portion_contemplated", e["anchor_contemplated"], "bool", "Anchor portion contemplated", s_off, method="pdf:cover")
    F["pre_ipo_placement_contemplated"] = fact(oid, "pre_ipo_placement_contemplated", e["pre_ipo_placement"], "bool", "Pre-IPO placement contemplated", s_off, method="pdf:cover")
    if e.get("dated"):
        F[f"{prefix or st_type.lower() + '_'}dated"] = fact(oid, f"{prefix or st_type.lower() + '_'}dated", e["dated"], "text", f"{st_type} dated", s_off, method="pdf:cover")
    contacts = [{"name": x["name"], "role": "BRLM", "contact_person": x.get("contact_person"), "email": x.get("email"),
                 "phone": x.get("phone"), "source": s_brlm} for x in e.get("brlms", [])]
    if e.get("registrar"):
        r = e["registrar"]
        contacts.append({"name": r["name"], "role": "REGISTRAR", "contact_person": r.get("contact_person"), "email": r.get("email"),
                         "phone": r.get("phone"), "source": s_brlm})
    if contacts:
        o["intermediaries"]["contacts"] = contacts
        if not o["intermediaries"].get("brlms"):
            o["intermediaries"]["brlms"] = [c["name"] for c in contacts if c["role"] == "BRLM"]
        if not o["intermediaries"].get("registrar") and e.get("registrar"):
            o["intermediaries"]["registrar"] = e["registrar"]["name"]
    for ex in e.get("exchanges", []):
        if ex not in o["exchanges"]:
            o["exchanges"].append(ex)
    c = b.company
    if e.get("cin") and not c["identifiers"].get("cin"):
        c["identifiers"]["cin"] = e["cin"]
    if e.get("website") and not c.get("website"):
        c["website"] = "https://" + e["website"]
    if e.get("promoters"):
        c["promoters"] = e["promoters"]
    if "NSE_EMERGE" in e.get("exchanges", []) or "BSE_SME" in e.get("exchanges", []) or (e.get("regulation") or "").startswith("229"):
        c["segment"] = "SME"
        o["segment"] = "SME"


if __name__ == "__main__":
    sys.exit(main())
