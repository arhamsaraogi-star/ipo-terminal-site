"""Lock-in engine: offering facts + allotment date + versioned rules -> lock-in tranches.

Rule version = the one in force on the issue OPENING date. Periods run from the ALLOTMENT date.
Tranches derived from rules with verified: false carry rule_verified = False (shown as a badge).
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

from pipeline.common.store import CompanyBundle, lockin_rules

CATEGORY_SHARE_METRIC = {
    "ANCHOR": "anchor_shares",
    "PROMOTER_MIN_CONTRIBUTION": "promoter_min_contribution_shares",
    "PROMOTER_EXCESS": "promoter_excess_shares",
    "PRE_IPO_NON_PROMOTER": "pre_ipo_non_promoter_shares",
}


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def select_rule(segment: str, category: str, issue_open: date, rules: list[dict] | None = None) -> dict | None:
    for r in rules or lockin_rules():
        if r["segment"] != segment or r["holder_category"] not in (category, "ANY"):
            continue
        start = r["effective_from"]
        end = r["effective_to"]
        if start <= issue_open and (end is None or issue_open <= end):
            return r
    return None


def _first(events: list[dict], etype: str) -> date | None:
    ds = [e["date"] for e in events if e["event_type"] == etype and e["date_kind"] != "derived"]
    return date.fromisoformat(min(ds)) if ds else None


def _calc_fact(fid: str, metric: str, value, unit: str, formula: str, inputs: list[str]) -> dict:
    return {"fact_id": fid, "metric": metric, "value": value, "unit": unit, "kind": "calculated",
            "formula": formula, "inputs": inputs, "source": None, "extraction": None, "status": "ok"}


def compute(b: CompanyBundle, rules: list[dict] | None = None) -> list[dict]:
    out: list[dict] = []
    cid = b.company["company_id"]
    allot, opened = _first(b.events, "BASIS_OF_ALLOTMENT"), _first(b.events, "ISSUE_OPEN")
    if not (allot and opened):
        return out
    for o in b.offerings:
        if o["type"] != "IPO":
            continue
        f = o["facts"]
        post = f.get("post_issue_shares")
        for cat, metric in CATEGORY_SHARE_METRIC.items():
            sf = f.get(metric)
            if not sf or sf.get("status") != "ok":
                continue
            rule = select_rule(o["segment"], cat, opened, rules)
            if not rule or not rule["tranches"]:
                continue
            variant = (rule.get("variants") or {}).get("capex_objects") if f.get("objects_include_capex", {}).get("value") is True else None
            for i, t in enumerate(rule["tranches"], 1):
                shares = round(sf["value"] * t["share_of_holding"])
                if variant:
                    expiry = add_months(allot, variant["period_months"])
                elif "period_days" in t:
                    expiry = allot + timedelta(days=t["period_days"])
                else:
                    expiry = add_months(allot, t["period_months"])
                tid = f"{o['offering_id']}:{cat.lower()}:{i}"
                tranche = {
                    "tranche_id": tid, "company_id": cid, "offering_id": o["offering_id"],
                    "holder_category": cat,
                    "shares": _calc_fact(f"{tid}:shares", "lockin_shares", shares, "shares",
                                         f"{metric} x {t['share_of_holding']}", [sf["fact_id"]]),
                    "start_date": allot.isoformat(), "expiry_date": expiry.isoformat(),
                    "rule_id": rule["rule_id"], "rule_verified": bool(rule["verified"]),
                }
                if post and post.get("status") == "ok" and post["value"]:
                    tranche["pct_post_issue"] = _calc_fact(
                        f"{tid}:pct", "lockin_pct_post_issue", round(100 * shares / post["value"], 2), "%",
                        "lockin_shares / post_issue_shares", [f"{tid}:shares", post["fact_id"]])
                out.append(tranche)
    return sorted(out, key=lambda t: t["expiry_date"])


def urgency(expiry: date, today: date) -> str:
    d = (expiry - today).days
    return "expired" if d < 0 else "lt7" if d < 7 else "7to30" if d <= 30 else "30to90" if d <= 90 else "gt90"
