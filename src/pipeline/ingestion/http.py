"""Polite HTTP client: browser-like headers, cookie warm-up, retries with backoff, per-host pacing.

A failing source raises SourceError; the orchestrator catches it and keeps existing data untouched.
"""
from __future__ import annotations

import os
import sys
import time
from urllib.parse import urlparse

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0 Safari/537.36")


class SourceError(RuntimeError):
    pass


class Client:
    def __init__(self, min_interval: float = 0.5, retries: int = 3, timeout: tuple = (10, 25)):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9"})
        self.min_interval, self.retries, self.timeout = min_interval, retries, timeout
        self._last: dict[str, float] = {}
        self._warmed: set[str] = set()

    def _pace(self, host: str) -> None:
        wait = self.min_interval - (time.monotonic() - self._last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        self._last[host] = time.monotonic()

    def warm(self, url: str) -> None:
        host = urlparse(url).netloc
        if host in self._warmed:
            return
        self.request("GET", url, warm=False)
        self._warmed.add(host)

    def request(self, method: str, url: str, *, warm: bool = False, **kw) -> requests.Response:
        host = urlparse(url).netloc
        last_err: Exception | None = None
        for attempt in range(self.retries):
            self._pace(host)
            try:
                r = self.s.request(method, url, timeout=self.timeout, **kw)
                if r.status_code == 200 and b"Unauthorized Activity Has Been Detected" not in r.content[:4000]:
                    return r
                last_err = SourceError(f"{method} {url} -> HTTP {r.status_code}")
                if r.status_code in (404, 410):
                    raise last_err  # permanent: do not retry
                if r.status_code in (401, 403) and "nseindia" in host:
                    self._warmed.discard(host)  # refresh NSE cookies and retry
                    try:
                        self.s.get("https://www.nseindia.com/market-data/all-upcoming-issues-ipo", timeout=self.timeout)
                    except requests.RequestException:
                        pass
            except requests.RequestException as e:
                last_err = e
            if os.environ.get("INGEST_VERBOSE"):
                print(f"  retry {url[:90]} {attempt + 1}: {last_err}", file=sys.stderr, flush=True)
            time.sleep(1.5 * (attempt + 1))
        raise SourceError(str(last_err))

    def get_json(self, url: str, **kw):
        r = self.request("GET", url, **kw)
        try:
            return r.json()
        except ValueError as e:
            raise SourceError(f"non-JSON response from {url}") from e
