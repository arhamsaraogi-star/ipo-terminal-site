"""NSE end-of-day market data from the static archives (robust: no API throttling, no cookies).

  PRddmmyy.zip -> mcapDDMMYYYY.csv   close price, shares outstanding ("Issue Size"), market cap - all series incl. SME
  sec_bhavdata_full_DDMMYYYY.csv     OHLC + prev close per symbol - used for listing-day performance and history
  EQUITY_L.csv / SME_EQUITY_L.csv    symbol, name, ISIN, listing date - identity enrichment

Stored under data/market/ (encrypted with the rest of the state):
  quotes.json    {symbol: {date, close, prev_close, shares, mcap_cr, series, name}}
  listing.json   {symbol: {date, open, high, low, close, prev_close}}
  history/<SYMBOL>.json  [[date, close], ...]   (tracked symbols only)
  days.json      trading days already folded into history
"""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import date, datetime, timedelta

from pipeline.common.store import DATA, read_json, write_json
from pipeline.ingestion.http import Client, SourceError

ARCH = "https://nsearchives.nseindia.com"
MKT = DATA / "market"


def _num(s: str | None) -> float | None:
    try:
        return float(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def fetch_pr(client: Client, d: date) -> dict[str, dict] | None:
    """Quotes for one trading day, or None if the exchange published nothing (holiday / not yet out)."""
    url = f"{ARCH}/archives/equities/bhavcopy/pr/PR{d:%d%m%y}.zip"
    try:
        blob = client.request("GET", url).content
    except SourceError:
        return None
    if blob[:2] != b"PK":
        return None
    z = zipfile.ZipFile(io.BytesIO(blob))
    name = next((n for n in z.namelist() if n.lower().startswith("mcap")), None)
    if not name:
        return None
    out: dict[str, dict] = {}
    rows = csv.reader(io.StringIO(z.read(name).decode("latin-1")))
    header = next(rows, [])
    for r in rows:
        if len(r) < 10 or r[2].strip() in ("IV", "RR", "") or r[1].strip() == "Symbol":
            continue
        sym = r[1].strip().upper()
        shares, close, mcap = _num(r[7]), _num(r[8]), _num(r[9])
        if not sym or close is None:
            continue
        out[sym] = {"date": d.isoformat(), "close": close, "shares": int(shares) if shares else None,
                    "mcap_cr": round(mcap / 1e7, 2) if mcap else None, "series": r[2].strip(), "name": r[3].strip()}
    # previous close from the SME / main price files is optional; bhavdata provides it for history
    return out or None


def fetch_bhav(client: Client, d: date) -> dict[str, dict] | None:
    url = f"{ARCH}/products/content/sec_bhavdata_full_{d:%d%m%Y}.csv"
    try:
        r = client.request("GET", url)
    except SourceError:
        return None
    text = r.text
    if not text.startswith("SYMBOL"):
        return None
    out: dict[str, dict] = {}
    for row in csv.DictReader(io.StringIO(text)):
        row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        sym, series = row.get("SYMBOL", "").upper(), row.get("SERIES", "")
        if series not in ("EQ", "BE", "BZ", "SM", "ST", "SZ"):
            continue
        out[sym] = {"series": series, "prev_close": _num(row.get("PREV_CLOSE")), "open": _num(row.get("OPEN_PRICE")),
                    "high": _num(row.get("HIGH_PRICE")), "low": _num(row.get("LOW_PRICE")), "close": _num(row.get("CLOSE_PRICE")),
                    "volume": _num(row.get("TTL_TRD_QNTY"))}
    return out or None


def fetch_equity_lists(client: Client) -> dict[str, dict]:
    """symbol -> {name, isin, listed_on, segment}"""
    out: dict[str, dict] = {}
    for url, seg in ((f"{ARCH}/content/equities/EQUITY_L.csv", "MAINBOARD"), (f"{ARCH}/emerge/corporates/content/SME_EQUITY_L.csv", "SME")):
        try:
            text = client.request("GET", url).text
        except SourceError:
            continue
        for row in csv.reader(io.StringIO(text)):
            if len(row) < 6 or row[0].strip().upper() == "SYMBOL":
                continue
            sym, name = row[0].strip().upper(), row[1].strip()
            if seg == "MAINBOARD":
                listed, isin = row[3].strip(), row[6].strip() if len(row) > 6 else ""
            else:
                listed, isin = row[3].strip(), row[5].strip()
            dt = None
            for fmt in ("%d-%b-%Y", "%d-%b-%y"):
                try:
                    dt = datetime.strptime(listed.title(), fmt).date().isoformat()
                    break
                except ValueError:
                    pass
            out[sym] = {"name": name, "isin": isin or None, "listed_on": dt, "segment": seg}
    return out


def update(client: Client, symbols: dict[str, str], listing_dates: dict[str, str], *, history_days: int = 400,
           budget_ok=lambda: True, log=print) -> dict:
    """symbols: {SYMBOL: company_id} to track. listing_dates: {SYMBOL: 'YYYY-MM-DD'}."""
    MKT.mkdir(parents=True, exist_ok=True)
    quotes: dict = read_json(MKT / "quotes.json", {})
    listing: dict = read_json(MKT / "listing.json", {})
    days: list = read_json(MKT / "days.json", [])
    done = set(days)
    stats = {"quote_date": None, "history_days_added": 0, "listing_days": 0}

    # 1) latest quotes (try today and walk back to the last published trading day)
    today = date.today()
    for back in range(0, 8):
        d = today - timedelta(days=back)
        if d.weekday() >= 5:
            continue
        q = fetch_pr(client, d)
        if q:
            b = fetch_bhav(client, d) or {}
            for sym in symbols:
                if sym in q:
                    extra = b.get(sym, {})
                    q[sym].update({k: extra.get(k) for k in ("prev_close", "open", "high", "low", "volume")})
                    quotes[sym] = q[sym]
            stats["quote_date"] = d.isoformat()
            break

    # 2) listing-day OHLC for symbols not yet captured
    for sym, ld in listing_dates.items():
        if sym in listing or not ld or ld > today.isoformat() or not budget_ok():
            continue
        b = fetch_bhav(client, date.fromisoformat(ld))
        if b and sym in b:
            listing[sym] = {"date": ld, **{k: b[sym][k] for k in ("open", "high", "low", "close", "prev_close")}}
            stats["listing_days"] += 1

    # 3) daily close history for tracked symbols (each trading day folded in once)
    earliest = min([v for v in listing_dates.values() if v] or [today.isoformat()])
    start = max(date.fromisoformat(earliest), today - timedelta(days=history_days))
    d = start
    hist_cache: dict[str, list] = {}
    while d <= today and budget_ok():
        iso = d.isoformat()
        if d.weekday() < 5 and iso not in done:
            b = fetch_bhav(client, d)
            if b:
                for sym in symbols:
                    if sym in b and b[sym]["close"] is not None and (listing_dates.get(sym) or "0000") <= iso:
                        h = hist_cache.setdefault(sym, read_json(MKT / "history" / f"{sym}.json", []))
                        if not h or h[-1][0] < iso:
                            h.append([iso, b[sym]["close"]])
                stats["history_days_added"] += 1
                done.add(iso)
            elif d < today - timedelta(days=3):
                done.add(iso)  # holiday: nothing will ever be published
        d += timedelta(days=1)
    for sym, h in hist_cache.items():
        h.sort()
        write_json(MKT / "history" / f"{sym}.json", h)
    write_json(MKT / "quotes.json", quotes)
    write_json(MKT / "listing.json", listing)
    write_json(MKT / "days.json", sorted(done))
    log(f"Market data: quotes as of {stats['quote_date']}, {stats['listing_days']} listing days, {stats['history_days_added']} history days")
    return stats
