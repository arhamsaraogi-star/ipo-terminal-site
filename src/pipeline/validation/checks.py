"""Validation gates. A non-empty error list blocks the commit; warnings go to the review queue."""
from __future__ import annotations

from dataclasses import dataclass, field

from pipeline.common.store import CompanyBundle, event_types, schema_errors

# event chronology: each pair must satisfy date(a) <= date(b) when both exist (actual/scheduled only)
CHRONOLOGY = ["DRHP_FILED", "RHP_FILED", "ISSUE_OPEN", "ISSUE_CLOSE", "BASIS_OF_ALLOTMENT", "LISTING"]
TOL_CRORE = 0.1


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def extend(self, other: "Report") -> None:
        self.errors += other.errors
        self.warnings += other.warnings

    @property
    def ok(self) -> bool:
        return not self.errors


def _v(facts: dict, key: str):
    f = facts.get(key)
    return f["value"] if f and f.get("status") == "ok" and isinstance(f.get("value"), (int, float)) else None


def check_schema(b: CompanyBundle) -> Report:
    r = Report()
    cid = b.company.get("company_id", "?")
    pairs = [(b.company, "company.schema.json", None), (b.offerings, "offering.schema.json", None),
             (b.documents, "records.schema.json", "documents_file"), (b.lockins, "records.schema.json", "lockins_file")]
    if b.facts is not None:
        pairs.append((b.facts, "facts.schema.json", None))
    pairs += [(e, "records.schema.json", "event") for e in b.events]
    pairs += [(n, "records.schema.json", "news") for n in b.news]
    for obj, sf, ptr in pairs:
        r.errors += [f"{cid} [{sf}{'#' + ptr if ptr else ''}] {m}" for m in schema_errors(obj, sf, ptr)]
    return r


def check_events(b: CompanyBundle) -> Report:
    r = Report()
    cid = b.company["company_id"]
    known = event_types()
    for e in b.events:
        if e["event_type"] not in known:
            r.errors.append(f"{cid}: unknown event_type {e['event_type']} (add it to rules/event_types.yaml)")
    first: dict[str, str] = {}
    for e in b.events:
        if e["date_kind"] != "derived" and e["event_type"] in CHRONOLOGY:
            first.setdefault(e["event_type"], e["date"])
            first[e["event_type"]] = min(first[e["event_type"]], e["date"])
    seq = [(k, first[k]) for k in CHRONOLOGY if k in first]
    for (a, da), (c, dc) in zip(seq, seq[1:]):
        if da > dc:
            r.warnings.append(f"{cid}: chronology break {a} {da} > {c} {dc}")
    return r


def check_offerings(b: CompanyBundle) -> Report:
    r = Report()
    cid = b.company["company_id"]
    for o in b.offerings:
        f = o["facts"]
        fresh, ofs, total = _v(f, "fresh_issue"), _v(f, "ofs"), _v(f, "total_issue")
        if None not in (fresh, ofs, total) and abs(fresh + ofs - total) > TOL_CRORE:
            r.warnings.append(f"{cid}/{o['offering_id']}: fresh {fresh} + OFS {ofs} != total {total}")
        pre, new, post = _v(f, "pre_issue_shares"), _v(f, "fresh_issue_shares"), _v(f, "post_issue_shares")
        if None not in (pre, new, post) and pre + new != post:
            r.warnings.append(f"{cid}/{o['offering_id']}: pre {pre} + fresh shares {new} != post {post}")
        lo, hi = _v(f, "price_band_low"), _v(f, "price_band_high")
        if None not in (lo, hi) and lo > hi:
            r.errors.append(f"{cid}/{o['offering_id']}: price band low {lo} > high {hi}")
    return r


def check_provenance(b: CompanyBundle) -> Report:
    """Every reported, ok fact must carry a source with a URL; primary-number facts need a page."""
    r = Report()
    cid = b.company["company_id"]
    facts = [f for o in b.offerings for f in o["facts"].values()]
    if b.facts:
        facts += b.facts["financials"] + b.facts["industry"] + b.facts.get("operating", [])
    for f in facts:
        if f["kind"] == "reported" and f["status"] == "ok":
            s = f.get("source") or {}
            if not s.get("url"):
                r.errors.append(f"{cid}: {f['fact_id']} has no source URL")
            elif s.get("source_type") in {"DRHP", "RHP", "PROSPECTUS"} and not s.get("page"):
                r.warnings.append(f"{cid}: {f['fact_id']} offer-document fact without page number")
    return r


def check_financials(b: CompanyBundle) -> Report:
    """P&L chain per period: EBITDA - D&A = EBIT; EBIT - finance cost + other income = PBT; PBT - tax = PAT."""
    r = Report()
    if not b.facts:
        return r
    cid = b.company["company_id"]
    by: dict[tuple, dict] = {}
    for f in b.facts["financials"]:
        if f["status"] == "ok" and isinstance(f["value"], (int, float)):
            by.setdefault((f["period"], f["basis"]), {})[f["metric"]] = f["value"]
    rules = [("ebit", lambda m: m["ebitda"] - m["depreciation"], ("ebitda", "depreciation", "ebit")),
             ("pbt", lambda m: m["ebit"] - m["finance_cost"] + m["other_income"], ("ebit", "finance_cost", "other_income", "pbt")),
             ("pat", lambda m: m["pbt"] - m["tax"], ("pbt", "tax", "pat"))]
    for (period, basis), m in by.items():
        for target, fn, need in rules:
            if all(k in m for k in need):
                exp, got = fn(m), m[target]
                if abs(exp - got) > max(0.5, 0.01 * abs(got)):
                    r.warnings.append(f"{cid}: {period} {basis} {target} {got} vs derived {exp:.1f} — requires review")
    return r


def validate_bundle(b: CompanyBundle) -> Report:
    r = check_schema(b)
    if r.errors:  # structural problems make the semantic checks unreliable
        return r
    for fn in (check_events, check_offerings, check_provenance, check_financials):
        r.extend(fn(b))
    return r
