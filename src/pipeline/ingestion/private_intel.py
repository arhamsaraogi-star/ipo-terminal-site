"""Web news + press-reported valuations for companies members ask about (their private companies, tracked and held names).

Requests: the browser writes requests/<uid>.bin on the `userdata` branch, encrypted with the terminal master key
(MK = PBKDF2(access code)), listing company names only. CI decrypts them here with TERMINAL_PASSPHRASE, fetches
Google News RSS per name, extracts valuation mentions from headlines/snippets, and writes data/private_intel.json,
which compile.py ships inside the encrypted vault. Results are keyed by the normalised name (lowercase, alphanumerics).
"""
from __future__ import annotations

import html
import json
import re
import urllib.parse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

from pipeline.common.store import DATA, ROOT, read_json, write_json

REQ_DIR = DATA / "requests"
OUT = DATA / "private_intel.json"
REFRESH_HOURS = 6


def norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def key_of(name: str) -> str:
    return norm_name(name)          # the whole file is inside the encrypted vault


def read_requests(access_code: str) -> list[dict]:
    """Decrypt every requests/*.bin → unique [{name, country}]."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from pipeline.build.vault import ITERATIONS, derive_key
    if not REQ_DIR.exists():
        return []
    cfg = read_json(ROOT / "config" / "vault.json", {})
    mk = derive_key(access_code, bytes.fromhex(cfg["salt"]), cfg.get("iterations", ITERATIONS))
    seen: dict[str, dict] = {}
    for f in sorted(REQ_DIR.glob("*.bin")):
        b = f.read_bytes()
        if b[:5] != b"IPOR1":
            continue
        try:
            obj = json.loads(AESGCM(mk).decrypt(b[5:17], b[17:], b"IPOR1"))
        except Exception:  # noqa: BLE001 — a stale/foreign file is skipped
            continue
        for it in obj.get("names", [])[:200]:
            n = str(it.get("name", "")).strip()[:120]
            if len(n) >= 2:
                sym = str(it.get("symbol") or "").strip().upper()
                seen.setdefault(key_of(n), {"name": n, "country": str(it.get("country") or "")[:40],
                                            "symbol": sym if re.fullmatch(r"[A-Z0-9&-]{1,20}", sym) else None,
                                            "bse": str(it.get("bse")) if re.fullmatch(r"\d{5,7}", str(it.get("bse") or "")) else None})
    return list(seen.values())


AMT = r"(?:US\$|USD|\$|₹|Rs\.?|INR|€|£)\s?([\d][\d,]*(?:\.\d+)?)[\s-]*(billion|bn|million|mn|crore|cr|lakh crore|trillion)\b"
VAL_RE = re.compile(r"valu(?:ed|ation|ing)[^.;]{0,60}?" + AMT + r"|" + AMT + r"[\s-]*(?:valuation|post-money|pre-money|unicorn)", re.I)


def valuations(text: str) -> list[dict]:
    out = []
    for m in VAL_RE.finditer(text):
        amt, unit = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        cur_m = re.search(r"(US\$|USD|\$|₹|Rs\.?|INR|€|£)", m.group(0))
        cur = {"$": "USD", "US$": "USD", "USD": "USD", "₹": "INR", "Rs": "INR", "Rs.": "INR", "INR": "INR", "€": "EUR", "£": "GBP"}.get(cur_m.group(1) if cur_m else "", "USD")
        v = float(amt.replace(",", ""))
        u = unit.lower()
        mult = {"billion": 1000, "bn": 1000, "million": 1, "mn": 1, "trillion": 1_000_000}.get(u)
        if cur == "INR":
            cr = v * {"crore": 1, "cr": 1, "lakh crore": 100000, "billion": 100, "bn": 100, "million": 0.1, "mn": 0.1, "trillion": 100000}.get(u, 1)
            if cr >= 50:                        # smaller figures are contracts / loans, not company valuations
                out.append({"currency": "INR", "value_cr": round(cr, 2), "text": m.group(0)[:120]})
        elif mult and v * mult >= 20:
            out.append({"currency": cur, "value_mn": round(v * mult, 2), "text": m.group(0)[:120]})
    return out


def google_news(client, name: str, country: str = "", extra: str = "") -> list[dict]:
    q = f'"{name}"' + (f" {extra}" if extra else "")
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"})
    r = client.request("GET", url)
    root = ET.fromstring(r.content)
    items = []
    for it in root.iter("item"):
        title = html.unescape(it.findtext("title") or "").strip()
        link = it.findtext("link") or ""
        src = it.find("source")
        desc = re.sub(r"<[^>]+>", " ", html.unescape(it.findtext("description") or ""))
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(timezone.utc).isoformat()
        except Exception:  # noqa: BLE001
            pub = None
        if not title:
            continue
        pubname = src.text if src is not None else None
        if pubname and title.endswith(f" - {pubname}"):
            title = title[: -len(pubname) - 3]
        items.append({"title": title, "url": link, "publisher": src.text if src is not None else None, "published_at": pub,
                      "valuations": valuations(f"{title}. {desc}")})
    items.sort(key=lambda x: x["published_at"] or "", reverse=True)
    # keep headlines that actually name the company (Google matches loosely)
    toks = [t for t in norm_name(name).split() if t not in ("private", "limited", "ltd", "pvt", "inc", "technologies", "india")]
    if toks:
        items = [x for x in items if all(t in norm_name(x["title"]) for t in toks[:2])] or items[:5]
    return items[:15]


def update(client, access_code: str, log: list[str], budget_ok=lambda: True) -> None:
    reqs = read_requests(access_code)
    cur = read_json(OUT, {}) or {}
    now = datetime.now(timezone.utc)
    fetched = 0
    wanted = {key_of(r["name"]) for r in reqs}
    for r in reqs:
        k = key_of(r["name"])
        old = cur.get(k)
        if old and old.get("fetched_at") and now - datetime.fromisoformat(old["fetched_at"]) < timedelta(hours=REFRESH_HOURS):
            continue
        if not budget_ok():
            break
        try:
            news = google_news(client, r["name"], r.get("country", ""))
            vnews = google_news(client, r["name"], r.get("country", ""), extra="valuation") + google_news(client, r["name"], r.get("country", ""), extra='"valued at"')
        except Exception as e:  # noqa: BLE001
            log.append(f"Web news: {r['name'][:30]} failed ({str(e)[:60]})")
            continue
        vals, seen_u = [], set()
        for n in sorted(news + vnews, key=lambda x: x["published_at"] or "", reverse=True):
            for v in n["valuations"]:
                if n["url"] in seen_u:
                    continue
                seen_u.add(n["url"])
                vals.append({**v, "date": n["published_at"], "title": n["title"], "url": n["url"], "publisher": n["publisher"]})
        cur[k] = {"name": r["name"], "fetched_at": now.isoformat(), "news": [{kk: n[kk] for kk in ("title", "url", "publisher", "published_at")} for n in news],
                  "valuations": vals[:10]}
        fetched += 1
    cur = {k: v for k, v in cur.items() if k in wanted}           # forget names nobody asks about anymore
    write_json(OUT, cur)
    if reqs:
        log.append(f"Web news: {len(reqs)} requested companies, {fetched} refreshed")
