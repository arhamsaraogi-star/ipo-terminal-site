"""Apply a portfolio/watchlist GitHub issue to data/portfolio/holdings.json.

Issue title:  portfolio: <add|remove|watch|unwatch> <company_id>
Issue body (add):  company_id / quantity / avg_cost / acquired_on / route as `key: value` lines.

    python -m pipeline.portfolio --title "$TITLE" --body-file body.txt
Exit 0 = applied (file changed), 2 = rejected (message printed for the issue comment).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from pipeline.common.store import DATA, read_json, schema_errors, write_json

TITLE_RE = re.compile(r"^portfolio:\s*(add|remove|watch|unwatch)\s+([a-z0-9-]+)\s*$", re.I)
PATH = DATA / "portfolio" / "holdings.json"


class Rejected(Exception):
    pass


def parse_body(body: str) -> dict[str, str]:
    out = {}
    for line in body.splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip().lower()] = v.strip()
    return out


def apply(title: str, body: str, data: Path = DATA) -> str:
    m = TITLE_RE.match(title.strip())
    if not m:
        raise Rejected("Title must be `portfolio: <add|remove|watch|unwatch> <company_id>`")
    action, cid = m.group(1).lower(), m.group(2)
    if not (data / "companies" / cid / "company.json").exists():
        raise Rejected(f"Unknown company_id `{cid}`")
    path = data / "portfolio" / "holdings.json"
    pf = read_json(path, {"holdings": [], "watchlist": []})

    if action == "add":
        f = parse_body(body)
        try:
            h = {"company_id": cid, "quantity": int(f["quantity"].replace(",", "")),
                 "avg_cost": float(f["avg_cost"].replace(",", "").lstrip("₹")),
                 "acquired_on": f["acquired_on"], "route": f.get("route", "ALLOTMENT").upper() or "ALLOTMENT",
                 "note": f.get("note") or None}
        except (KeyError, ValueError) as e:
            raise Rejected(f"Could not read holding fields ({e}). Fill quantity, avg_cost, acquired_on (YYYY-MM-DD).")
        pf["holdings"] = [x for x in pf["holdings"] if x["company_id"] != cid] + [h]
        msg = f"Holding set: {cid} — {h['quantity']} @ ₹{h['avg_cost']}"
    elif action == "remove":
        pf["holdings"] = [x for x in pf["holdings"] if x["company_id"] != cid]
        msg = f"Holding removed: {cid}"
    elif action == "watch":
        if cid not in pf["watchlist"]:
            pf["watchlist"].append(cid)
        msg = f"Watching {cid}"
    else:
        pf["watchlist"] = [x for x in pf["watchlist"] if x != cid]
        msg = f"Stopped watching {cid}"

    errs = schema_errors(pf, "records.schema.json", "portfolio_file")
    if errs:
        raise Rejected("Validation failed: " + "; ".join(errs))
    write_json(path, pf)
    return msg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--body-file", type=Path, required=True)
    a = ap.parse_args()
    try:
        print(apply(a.title, a.body_file.read_text(encoding="utf-8")))
        return 0
    except Rejected as e:
        print(f"Rejected: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
