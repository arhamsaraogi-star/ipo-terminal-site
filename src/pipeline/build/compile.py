"""derive -> validate -> compile -> encrypt.

    python -m pipeline.build.compile --out dist/vault.bin          # passphrase from $TERMINAL_PASSPHRASE
    python -m pipeline.build.compile --check                       # validate only (CI gate)

Exit code 1 if any validation error: nothing is written, nothing deploys.
"""
from __future__ import annotations

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


def derive(b: CompanyBundle) -> CompanyBundle:
    b.lockins = lk.compute(b)
    return b


def derived_events(b: CompanyBundle) -> list[dict]:
    cid = b.company["company_id"]
    out = []
    for t in b.lockins:
        cat = t["holder_category"].replace("_", " ").title()
        pct = t.get("pct_post_issue", {}).get("value")
        out.append({"event_id": f"derived:{t['tranche_id']}", "company_id": cid, "offering_id": t["offering_id"],
                    "event_type": "LOCKIN_EXPIRY", "date": t["expiry_date"], "date_kind": "derived",
                    "detail": f"{cat} lock-in ends" + (f" — {pct}% of post-issue equity eligible for sale" if pct else ""),
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


def build_payload(data: Path = DATA, write_derived: bool = True) -> tuple[dict, Report]:
    report = Report()
    companies = []
    for d in company_dirs(data):
        b = derive(load_company(d))
        r = validate_bundle(b)
        report.extend(r)
        if write_derived and r.ok:
            save_company(b, data)
        companies.append({
            "company": b.company, "offerings": b.offerings, "facts": b.facts, "documents": b.documents,
            "events": sorted(b.events + derived_events(b), key=lambda e: e["date"]),
            "lockins": b.lockins, "news": sorted(b.news, key=lambda n: n["published_at"], reverse=True),
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
        "changes": changes[:1000],
        "portfolio": portfolio,
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
        body = {**payload, "meta": {k: v for k, v in payload["meta"].items() if k not in ("built_at", "ingest")}}
        h = hashlib.sha256(_j.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        hp = DATA / "index" / "payload_hash"
        changed = not hp.exists() or hp.read_text().strip() != h
        hp.parent.mkdir(parents=True, exist_ok=True)
        hp.write_text(h)
        a.changed_flag.write_text("true" if changed else "false")
        print(f"published content changed: {changed}")
    if a.check or not a.out:
        return 0

    pw = os.environ.get("TERMINAL_PASSPHRASE", "")
    if not pw:
        print("ERROR TERMINAL_PASSPHRASE is not set — refusing to build an unencrypted site")
        return 1
    from pipeline.build.vault import ITERATIONS, seal
    cfg = read_json(ROOT / "config" / "vault.json", {})
    payload["meta"]["repo"] = os.environ.get("GITHUB_REPOSITORY") or cfg.get("repo")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_bytes(seal(payload, pw, cfg.get("iterations", ITERATIONS), bytes.fromhex(cfg["salt"]) if cfg.get("salt") else None))
    write_json(a.out.with_name("vault-meta.json"), {"built_at": payload["meta"]["built_at"], "format": "IPOV1"})
    print(f"vault written: {a.out} ({a.out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
