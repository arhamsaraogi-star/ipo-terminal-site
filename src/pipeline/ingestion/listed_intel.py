"""Data for already-listed companies that members pulled in by search (tracked or held): profile and price range,
a year of closes, quarterly results and exchange announcements — all from NSE, nothing from third-party aggregators.

Symbols come from the encrypted request files (see private_intel.read_requests). Output: data/listed_data.json,
{SYMBOL: {fetched_at, profile, history, results, announcements}}, shipped inside the encrypted vault.
Every NSE call is best-effort: a missing section is simply absent and is retried on the next run.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

from pipeline.common.store import DATA, read_json, write_json

OUT = DATA / "listed_data.json"
REFRESH_HOURS = 3
IST = timezone(timedelta(hours=5, minutes=30))


def _f(x):
    try:
        return float(str(x).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def parse_profile(q: dict) -> dict:
    """NSE quote-equity → compact profile."""
    pi, meta, sec, ind = q.get("priceInfo") or {}, q.get("metadata") or {}, q.get("securityInfo") or {}, q.get("industryInfo") or {}
    wk, day = pi.get("weekHighLow") or {}, pi.get("intraDayHighLow") or {}
    out = {
        "price": _f(pi.get("lastPrice")), "change_pct": _f(pi.get("pChange")), "prev_close": _f(pi.get("previousClose")),
        "open": _f(pi.get("open")), "day_high": _f(day.get("max")), "day_low": _f(day.get("min")), "vwap": _f(pi.get("vwap")),
        "high_52w": _f(wk.get("max")), "high_52w_date": wk.get("maxDate"), "low_52w": _f(wk.get("min")), "low_52w_date": wk.get("minDate"),
        "pe": _f(meta.get("pdSymbolPe")), "sector_pe": _f(meta.get("pdSectorPe")), "sector_index": meta.get("pdSectorInd"),
        "face_value": _f(sec.get("faceValue")), "issued_shares": _f(sec.get("issuedSize")),
        "sector": ind.get("sector") or ind.get("macro") or meta.get("industry"), "industry": ind.get("basicIndustry") or ind.get("industry") or meta.get("industry"),
        "listing_date": meta.get("listingDate"), "name": (q.get("info") or {}).get("companyName"),
    }
    return {k: v for k, v in out.items() if v not in (None, "", "-")}


def parse_history(h: dict) -> list[list]:
    """NSE historical/cm/equity → [[YYYY-MM-DD, close], ...] ascending."""
    rows = []
    for r in (h.get("data") or []):
        d, c = str(r.get("CH_TIMESTAMP") or "")[:10], _f(r.get("CH_CLOSING_PRICE"))
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) and c is not None:
            rows.append([d, c])
    return sorted(rows)


def _d(s):
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(s).strip().title() if "%b" in fmt else str(s).strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_results(rows: list) -> list[dict]:
    """NSE corporates-financial-results (quarterly) → [{period_end, income, pat, eps}] newest first, amounts in ₹ crore."""
    out = []
    for r in rows or []:
        end = _d(r.get("toDate") or r.get("to_date"))
        if not end:
            continue
        inc = _f(r.get("income") or r.get("totalIncome") or r.get("re_income"))
        pat = _f(r.get("profitLossForPeriod") or r.get("re_net_profit") or r.get("netProLossAftTax"))
        eps = _f(r.get("reDilEPS") or r.get("re_dil_eps") or r.get("eps"))
        unit = str(r.get("re_desc_note_fin") or r.get("reDescNoteFin") or "").lower()
        div = 1e7 if "crore" not in unit and "cr" not in unit and (inc or 0) > 1e6 else 1.0   # NSE publishes ₹ lakh / crore / rupees inconsistently
        out.append({"period_end": end, "income": round(inc / div, 2) if inc is not None else None, "pat": round(pat / div, 2) if pat is not None else None,
                    "eps": eps, "audited": str(r.get("audited") or "")[:12] or None})
    out.sort(key=lambda x: x["period_end"], reverse=True)
    return out[:8]


def parse_announcements(sym: str, rows: list, classify) -> list[dict]:
    out = []
    for r in rows[:80]:
        ts = r.get("sort_date") or ""
        try:
            pub = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=IST).isoformat()
        except ValueError:
            continue
        desc, body = (r.get("desc") or "").strip(), (r.get("attchmntText") or "").strip()
        title = f"{desc}: {body}" if desc and body and not body.lower().startswith(desc.lower()) else (body or desc)
        if not title:
            continue
        nid = r.get("seq_id") or hashlib.md5(f"{sym}{ts}{title}".encode()).hexdigest()[:10]
        out.append({"id": str(nid), "published_at": pub, "title": title[:400], "url": r.get("attchmntFile") or None, "category": classify(f"{desc} {body}")})
    return out


def update(nse, reqs: list[dict], log: list[str], classify, budget_ok=lambda: True) -> None:
    cur = read_json(OUT, {}) or {}
    now = datetime.now(timezone.utc)
    wanted = {r["symbol"] for r in reqs if r.get("symbol")}
    done = 0
    for sym in sorted(wanted):
        old = cur.get(sym)
        if old and old.get("fetched_at") and now - datetime.fromisoformat(old["fetched_at"]) < timedelta(hours=REFRESH_HOURS):
            continue
        if not budget_ok():
            break
        rec = dict(old or {})
        today = date.today()
        steps = (("profile", lambda: parse_profile(nse._get(f"quote-equity?symbol={quote(sym)}") or {})),
                 ("history", lambda: parse_history(nse._get(f'historical/cm/equity?symbol={quote(sym)}&series=["EQ"]&from={(today - timedelta(days=365)):%d-%m-%Y}&to={today:%d-%m-%Y}') or {})),
                 ("results", lambda: parse_results(nse._get(f"corporates-financial-results?index=equities&symbol={quote(sym)}&period=Quarterly") or [])),
                 ("announcements", lambda: parse_announcements(sym, nse.announcements(sym, since=today - timedelta(days=120)), classify)))
        for key, fn in steps:
            try:
                val = fn()
                if val:
                    rec[key] = val
            except Exception as e:  # noqa: BLE001 — one failing section never blocks the others
                log.append(f"Listed data {sym}/{key}: {str(e)[:70]}")
        rec["fetched_at"] = now.isoformat()
        cur[sym] = rec
        done += 1
    cur = {k: v for k, v in cur.items() if k in wanted}
    write_json(OUT, cur)
    if wanted:
        log.append(f"Listed companies you follow: {len(wanted)} symbols, {done} refreshed")
