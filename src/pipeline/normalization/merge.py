"""Duplicate-company merge: the same company reached through different sources/spellings becomes one record.

Keys that prove identity (any one is enough): ISIN, PAN, CIN, NSE symbol, normalised name (incl. aliases).
The surviving record is the most advanced one (listed > issue > RHP > DRHP); nothing is discarded: events,
documents, news and aliases are unioned; facts and identifiers fill gaps.
"""
from __future__ import annotations

import shutil

from pipeline.common.store import DATA, CompanyBundle
from pipeline.normalization.entities import norm

RANK = {"LISTED": 9, "ISSUE_CLOSED": 8, "ISSUE_OPEN": 7, "ISSUE_ANNOUNCED": 6, "RHP_FILED": 5, "SEBI_OBSERVED": 4,
        "DRHP_FILED": 3, "WITHDRAWN": 2, "LAPSED": 1, "PRIVATE": 0}


def _keys(b: CompanyBundle) -> set[str]:
    c = b.company
    ids = c.get("identifiers", {})
    keys = {"n:" + norm(n) for n in [c["name"], c.get("legal_name") or "", *c.get("aliases", [])] if n and len(norm(n)) >= 4}
    for k in ("isin", "pan", "cin", "nse_symbol"):
        if ids.get(k):
            keys.add(f"{k}:{ids[k]}")
    return keys


def _score(b: CompanyBundle) -> tuple:
    return (RANK.get(b.company["lifecycle"], 0), len(b.documents) + len(b.events), bool(b.facts and b.facts.get("financials")))


def merge_into(a: CompanyBundle, b: CompanyBundle) -> None:
    """Merge b into a (a survives). Rewrites company_id references."""
    aid, bid = a.company["company_id"], b.company["company_id"]
    ca, cb = a.company, b.company
    for n in [cb["name"], *(cb.get("aliases") or [])]:
        if n and n != ca["name"] and n not in ca["aliases"]:
            ca["aliases"].append(n)
    for k, v in (cb.get("identifiers") or {}).items():
        if v and not ca["identifiers"].get(k):
            ca["identifiers"][k] = v
    for k in ("sector", "industry", "website", "ir_url", "registered_office", "drhp_status", "overview", "private_tracker"):
        if cb.get(k) and not ca.get(k):
            ca[k] = cb[k]
    if cb.get("promoters") and not ca.get("promoters"):
        ca["promoters"] = cb["promoters"]
    if ca.get("segment") == "UNKNOWN" and cb.get("segment") != "UNKNOWN":
        ca["segment"] = cb["segment"]
    ca["sources"] = sorted(set(ca.get("sources", [])) | set(cb.get("sources", [])))

    def rid(x: dict) -> dict:
        x = dict(x)
        x["company_id"] = aid
        if x.get("offering_id"):
            x["offering_id"] = x["offering_id"].replace(bid, aid, 1)
        return x

    seen = {(e["event_type"], e["date"], e["date_kind"], e.get("detail")) for e in a.events}
    for e in b.events:
        k = (e["event_type"], e["date"], e["date_kind"], e.get("detail"))
        if k not in seen:
            e2 = rid(e)
            e2["event_id"] = e2["event_id"].replace(bid, aid, 1)
            a.events.append(e2)
            seen.add(k)
    urls = {d["url"] for d in a.documents}
    for d in b.documents:
        if d["url"] not in urls:
            d2 = rid(d)
            d2["document_id"] = d2["document_id"].replace(bid, aid, 1)
            a.documents.append(d2)
    ids_ = {n["news_id"] for n in a.news}
    for n in b.news:
        if n.get("dedupe_key") and any(m.get("dedupe_key") == n["dedupe_key"] for m in a.news):
            continue
        n2 = rid(n)
        n2["news_id"] = n2["news_id"].replace(bid, aid, 1)
        if n2["news_id"] not in ids_:
            a.news.append(n2)
    # offerings: fill missing facts / intermediaries
    if b.offerings:
        if not a.offerings:
            a.offerings = [rid(o) for o in b.offerings]
            for o in a.offerings:
                o["facts"] = {k: {**f, "fact_id": f["fact_id"].replace(bid, aid, 1)} for k, f in o["facts"].items()}
        else:
            oa, ob = a.offerings[0], b.offerings[0]
            for k, f in ob["facts"].items():
                if k not in oa["facts"]:
                    oa["facts"][k] = {**f, "fact_id": f["fact_id"].replace(bid, aid, 1)}
            ia, ib = oa.setdefault("intermediaries", {}), ob.get("intermediaries", {})
            for k, v in ib.items():
                if v and not ia.get(k):
                    ia[k] = v
            for k in ("subscription", "detail_fetched_at"):
                if ob.get(k) and not oa.get(k):
                    oa[k] = ob[k]
            oa["exchanges"] = sorted(set(oa.get("exchanges", [])) | set(ob.get("exchanges", [])))
    if b.facts and (not a.facts or (not a.facts.get("financials") and b.facts.get("financials"))):
        a.facts = {**b.facts, "company_id": aid}
        for f in a.facts.get("financials", []):
            f["fact_id"] = f["fact_id"].replace(bid, aid, 1)


def merge_duplicates(bundles: dict[str, CompanyBundle], data=DATA) -> list[tuple[str, str]]:
    """In-place merge; returns [(survivor, removed)]. Removed company directories are deleted."""
    owner: dict[str, str] = {}
    merged: list[tuple[str, str]] = []
    for cid in sorted(bundles, key=lambda c: _score(bundles[c]), reverse=True):
        if cid not in bundles:
            continue
        b = bundles[cid]
        hit = next((owner[k] for k in _keys(b) if k in owner and owner[k] != cid and owner[k] in bundles), None)
        if hit:
            merge_into(bundles[hit], b)
            del bundles[cid]
            shutil.rmtree(data / "companies" / cid, ignore_errors=True)
            merged.append((hit, cid))
            for k in _keys(bundles[hit]):
                owner.setdefault(k, hit)
        else:
            for k in _keys(b):
                owner.setdefault(k, cid)
    return merged
