"""Entity resolution: one canonical company_id per real company despite name variations across sources."""
from __future__ import annotations

import re
import unicodedata

SUFFIX = re.compile(r"\b(the|limited|ltd|private|pvt|company|co|india|incorporated|inc)\b\.?", re.I)


def norm(name: str) -> str:
    """Matching key: 'Shah Investor's Home Limited' -> 'shahinvestorshome'."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\(.*?\)", " ", s)
    s = SUFFIX.sub(" ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(limited|ltd|private|pvt)\b\.?", " ", s.replace("&", " and "))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "company"


def pretty(name: str) -> str:
    """Tidy ALL-CAPS names from filings: 'DEON ENERGY LIMITED' -> 'Deon Energy Limited'."""
    name = " ".join(name.split())
    if sum(c.isupper() for c in name) > 0.7 * sum(c.isalpha() for c in name):
        small = {"and", "of", "the", "for", "in", "on"}
        words = [w.lower() if w.lower() in small else w[:1].upper() + w[1:].lower() for w in name.split()]
        name = " ".join(words)
        name = name[:1].upper() + name[1:]
    return name


class Resolver:
    """Index of norm(name|alias) / ISIN / symbol -> company_id."""

    def __init__(self):
        self.by_key: dict[str, str] = {}

    def add(self, cid: str, names: list[str] = (), isin: str | None = None, symbol: str | None = None) -> None:
        for n in names:
            if n:
                self.by_key.setdefault("n:" + norm(n), cid)
        if isin:
            self.by_key["i:" + isin] = cid
        if symbol:
            self.by_key["s:" + symbol.upper()] = cid

    def find(self, name: str | None = None, isin: str | None = None, symbol: str | None = None) -> str | None:
        for k in ([f"i:{isin}"] if isin else []) + ([f"s:{symbol.upper()}"] if symbol else []) + ([f"n:{norm(name)}"] if name else []):
            if k in self.by_key:
                return self.by_key[k]
        return None

    def new_id(self, name: str) -> str:
        base, n = slug(name), 2
        cid = base
        taken = set(self.by_key.values())
        while cid in taken:
            cid, n = f"{base}-{n}", n + 1
        return cid
