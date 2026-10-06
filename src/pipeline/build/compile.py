"""derive -> validate -> compile -> encrypt.

    python -m pipeline.build.compile --out dist/vault.bin          # passphrase from $TERMINAL_PASSPHRASE
    python -m pipeline.build.compile --check                       # validate only (CI gate)

Exit code 1 if any validation error: nothing is written, nothing deploys.
"""
from __future__ import annotations

import re

import argparse
import os
import sys
from datetime import date
from pathlib import Path

from pipeline.calculations import lockins as lk
from pipeline.common.store import (DATA, ROOT, CompanyBundle, company_dirs, event_types, load_company, now_ist,
                                   read_json, read_jsonl, save_company, schema_errors, write_json)
from pipeline.validation.checks import Report, validate_bundle

SCHEMA_VERSION = 1


MARKET_URL = "https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/"


def market_block(b: CompanyBundle, data: Path) -> dict | None:
    ids = b.company.get("identifiers", {})
    sym = ids.get("nse_symbol") or (f"BSE:{ids['bse_code']}" if ids.get("bse_code") else None)
    if not sym:
        return None
    q = _MKT["quotes"].get(sym)
    lst = _MKT["listing"].get(sym)
    hist = read_json(data / "market" / "history" / f"{sym.replace(':', '_')}.json", [])
    if not (q or lst or hist):
        return None
    if len(hist) > 260:  # keep the chart light: weekly points beyond the last 120 sessions
        hist = hist[:-120][::5] + hist[-120:]
    return {"symbol": sym, "quote": q, "listing": lst, "history": hist,
            "source": ("BSE end-of-day bhavcopy; delayed" if sym.startswith("BSE:") else "NSE end-of-day archives (bhavcopy / market-cap file); delayed")}


def _pnorm(s: str) -> str:
    import re as _re
    from pipeline.normalization.entities import norm
    return norm(_re.sub(r"\(.*?\)|\*|consolidated|standalone|fy ?\d+", " ", s, flags=_re.I))


def peer_symbol(name: str) -> str | None:
    """Offer-document peer name → NSE symbol (exact normalised name, then close fuzzy match)."""
    import difflib
    if not _MKT.get("names") or re.search(r"\bour company\b|^the company", name, re.I):
        return None
    idx = _MKT.get("_name_idx")
    if idx is None:
        idx = _MKT["_name_idx"] = {_pnorm(v): k for k, v in _MKT["names"].items()}
    n = _pnorm(name)
    if not n:
        return None
    if n in idx:
        return idx[n]
    m = difflib.get_close_matches(n, [k for k in idx if k[:3] == n[:3]], n=1, cutoff=0.88)
    return idx[m[0]] if m else None


def derive(b: CompanyBundle, data: Path = DATA) -> CompanyBundle:
    # shares outstanding from the exchange (post-issue share count proxy for listed companies)
    sym = b.company.get("identifiers", {}).get("nse_symbol")
    q = _MKT["quotes"].get(sym) if sym else None
    if q and q.get("shares") and b.offerings:
        o = b.offerings[0]
        o["facts"]["shares_outstanding"] = {
            "fact_id": f"{o['offering_id']}:shares_outstanding", "metric": "shares_outstanding", "label": "Shares outstanding (NSE)",
            "value": q["shares"], "unit": "shares", "period": f"as_of:{q['date']}", "basis": "exchange", "kind": "reported",
            "formula": None, "inputs": [], "source": {"source_type": "EXCHANGE_ISSUE_PAGE", "document_id": None, "page": None,
            "table": "NSE market capitalisation file", "section": None, "url": MARKET_URL, "sha256": None, "tier": "primary"},
            "extraction": {"method": "exchange:mcap_file", "extracted_at": now_ist(), "extractor_version": None, "confidence": "high"},
            "status": "ok", "note": None, "supersedes": None}
    # listed peers: bring the offer document's peer table up to today's NSE close (P/E, P/B recomputed on the doc's EPS / NAV)
    uni = _MKT.get("universe") or {}
    if uni and b.facts and b.facts.get("peers"):
        for p in b.facts["peers"]:
            sym = peer_symbol(p.get("name", ""))
            if not sym or sym not in uni["rows"]:
                p.pop("live", None)
                continue
            close, mcap, _ = uni["rows"][sym]
            eps = p.get("eps_diluted") or p.get("eps_basic") or p.get("eps")
            nav = p.get("nav")
            p["live"] = {"symbol": sym, "date": uni["date"], "price": close, "mcap_cr": mcap,
                         "pe": round(close / eps, 1) if eps and eps > 0 else None,
                         "pb": round(close / nav, 2) if nav and nav > 0 else None}
    b.lockins = lk.compute(b)
    return b


_MKT: dict = {"quotes": {}, "listing": {}}


def derived_events(b: CompanyBundle) -> list[dict]:
    cid = b.company["company_id"]
    out = []
    for t in b.lockins:
        cat = t["holder_category"].replace("_", " ").title()
        pct = t.get("pct_post_issue", {}).get("value")
        out.append({"event_id": f"derived:{t['tranche_id']}", "company_id": cid, "offering_id": t["offering_id"],
                    "event_type": "LOCKIN_EXPIRY", "date": t["expiry_date"], "date_kind": "derived",
                    "detail": f"{cat} lock-in ends" + (f" — {pct}% of post-issue equity eligible for sale" if pct else "") + (" · tradable from the next business day" if t["holder_category"] == "ANCHOR" else ""),
                    "source": None, "rule_id": t["rule_id"], "detected_at": now_ist()})
    listing = [e["date"] for e in b.events if e["event_type"] == "LISTING" and e["date_kind"] == "actual"]
    if listing:
        d = date.fromisoformat(min(listing))
        for n in (1, 2, 3):
            out.append({"event_id": f"derived:{cid}:anniv{n}", "company_id": cid, "offering_id": None,
                        "event_type": "LISTING_ANNIVERSARY", "date": lk.add_months(d, 12 * n).isoformat(),
                        "date_kind": "derived", "detail": f"{n}Y since listing", "source": None,
                        "rule_id": None, "detected_at": now_ist()})
    return out


def listed_index(companies: list[dict], data: Path) -> list[list]:
    """Search-only universe: every NSE-listed security that is NOT already a tracked company. Never listed anywhere in the
    app; it only answers the search box, and a company enters the terminal when you track it or add it to your portfolio.
    Row: [symbol, name, isin, segment, close, mcap_cr, listed_on]."""
    listed = read_json(data / "market" / "listed.json", {})
    rows = (read_json(data / "market" / "universe.json", {}) or {}).get("rows", {})
    have = {c["company"]["identifiers"].get("nse_symbol") for c in companies} | {c["company"]["identifiers"].get("isin") for c in companies}
    out = []
    for sym, rec in sorted(listed.items()):
        name, isin, seg, on = (list(rec) + [None] * 4)[:4]
        if sym in have or (isin and isin in have):
            continue
        px = rows.get(sym) or [None, None, None]
        out.append([sym, name, isin, seg, px[0], px[1], on])
    return out


def build_payload(data: Path = DATA, write_derived: bool = True) -> tuple[dict, Report]:
    report = Report()
    companies = []
    _MKT["quotes"] = read_json(data / "market" / "quotes.json", {})
    _MKT["listing"] = read_json(data / "market" / "listing.json", {})
    _MKT["universe"] = read_json(data / "market" / "universe.json", {})
    _MKT["names"] = read_json(data / "market" / "names.json", {})
    _MKT.pop("_name_idx", None)
    for d in company_dirs(data):
        b = derive(load_company(d), data)
        r = validate_bundle(b)
        report.extend(r)
        if write_derived and r.ok:
            save_company(b, data)
        companies.append({
            "company": b.company, "offerings": b.offerings, "facts": b.facts, "documents": b.documents,
            "events": sorted(b.events + derived_events(b), key=lambda e: e["date"]),
            "lockins": b.lockins, "news": sorted(b.news, key=lambda n: n["published_at"], reverse=True),
            "market": market_block(b, data),
        })

    portfolio = read_json(data / "portfolio" / "holdings.json", {"holdings": [], "watchlist": []})
    report.errors += [f"portfolio: {m}" for m in schema_errors(portfolio, "records.schema.json", "portfolio_file")]
    ids = {c["company"]["company_id"] for c in companies}
    for h in portfolio["holdings"]:
        if h["company_id"] not in ids:
            report.errors.append(f"portfolio: holding for unknown company {h['company_id']}")

    changes = []
    for p in sorted((data / "changes").glob("*.jsonl")):
        changes += read_jsonl(p)
    changes.sort(key=lambda c: c["detected_at"], reverse=True)

    payload = {
        "meta": {"built_at": now_ist(), "schema_version": SCHEMA_VERSION, "companies": len(companies),
                 "has_sample": any(c["company"].get("is_sample") for c in companies),
                 "ingest": read_json(data / "index" / "ingest_status.json", None)},
        "event_types": event_types(),
        "companies": companies,
        "listed_index": listed_index(companies, data),
        "changes": changes[:1000],
        "portfolio": portfolio,
        "redirects": read_json(data / "index" / "redirects.json", {}),
        "private_intel": read_json(data / "private_intel.json", {}),
        "review": report.warnings,
    }
    return payload, report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, help="vault output path")
    ap.add_argument("--check", action="store_true", help="validate only")
    ap.add_argument("--changed-flag", type=Path, help="write true/false: has the published content changed since last deploy")
    a = ap.parse_args(argv)

    payload, report = build_payload(write_derived=not a.check)
    for w in report.warnings:
        print(f"WARN  {w}")
    for e in report.errors:
        print(f"ERROR {e}")
    if not report.ok:
        print(f"validation failed: {len(report.errors)} error(s) — nothing built")
        return 1
    print(f"ok: {payload['meta']['companies']} companies, {len(report.warnings)} warning(s)")
    if a.changed_flag:
        import hashlib, json as _j
        body = {**payload, "meta": {k: v for k, v in payload["meta"].items() if k not in ("built_at", "ingest")},
                "auth": hashlib.sha256(os.environ.get("SYNC_TOKEN", "").encode()).hexdigest()}
        h = hashlib.sha256(_j.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        hp = DATA / "index" / "payload_hash"
        changed = not hp.exists() or hp.read_text().strip() != h
        hp.parent.mkdir(parents=True, exist_ok=True)
        hp.write_text(h)
        a.changed_flag.write_text("true" if changed else "false")
        print(f"published content changed: {changed}")
    if a.check or not a.out:
        return 0

    from pipeline.build.vault import ITERATIONS, seal_v3
    code = os.environ.get("TERMINAL_PASSPHRASE", "")
    if not code:
        print("ERROR TERMINAL_PASSPHRASE (the access code) is not set — refusing to build an unencrypted site")
        return 1
    cfg = read_json(ROOT / "config" / "vault.json", {})
    repo = os.environ.get("GITHUB_REPOSITORY") or cfg.get("repo")
    payload["meta"]["repo"] = repo
    token = os.environ.get("SYNC_TOKEN", "").strip()
    payload["sync"] = {"repo": repo, "branch": "userdata", "token": token} if token and repo else None
    a.out.parent.mkdir(parents=True, exist_ok=True)
    salt = bytes.fromhex(cfg["salt"]) if cfg.get("salt") else os.urandom(16)
    a.out.write_bytes(seal_v3(payload, code, salt, cfg.get("iterations", ITERATIONS), repo))
    write_json(a.out.with_name("vault-meta.json"), {"built_at": payload["meta"]["built_at"], "format": "IPOV3", "sync": bool(payload["sync"])})
    print(f"vault written: {a.out} ({a.out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
