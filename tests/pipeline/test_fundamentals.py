import json
from pathlib import Path

from pipeline.ingestion import fundamentals as F
from pipeline.ingestion.http import SourceError

HTML = (Path(__file__).resolve().parents[1] / "fixtures" / "screener_company.html").read_text(encoding="utf-8")


def test_page_is_parsed_into_tables_and_ratios():
    p = F.parse_company_page(HTML)
    assert p["name"] == "Yash Highvoltage Ltd"
    assert p["top"]["Market Cap"].startswith("₹ 612") and p["top"]["ROE"].startswith("21.3")
    assert p["annual"]["periods"] == ["Mar 2024", "Mar 2025", "Mar 2026"]            # TTM column is not a period
    assert p["annual"]["rows"]["Sales"] == [108.0, 150.0, 1190.0]
    assert p["balance"]["rows"]["Total Assets"] == [60.0, 80.0, 100.0]
    assert p["cashflow"]["rows"]["Cash from Investing Activity"] == [-9.0, -14.0, -18.0]
    assert p["quarters"]["rows"]["OPM %"] == [17.0, 18.0]


def test_facts_use_the_terminals_metrics_and_periods():
    p = F.parse_company_page(HTML)
    facts = F.to_facts("YASHHV", p, "https://www.screener.in/company/YASHHV/consolidated/", "2026-10-06T00:00:00+00:00")
    v = lambda m, per: next(f["value"] for f in facts if f["metric"] == m and f["period"] == per)  # noqa: E731
    assert v("revenue_from_operations", "FY2026") == 1190
    assert v("ebitda", "FY2025") == 28 and v("pat", "FY2024") == 12
    assert v("net_worth", "FY2026") == 77 and v("total_assets", "FY2026") == 100
    assert v("cfo", "FY2026") == 22 and v("cfi", "FY2025") == -14 and v("cff", "FY2026") == -2
    assert v("roce", "FY2026") == 22 and v("eps_basic", "FY2026") == 10.4
    assert all(f["source"]["tier"] == "secondary" and f["status"] == "ok" for f in facts)
    q = F.to_quarters(p)
    assert q[0] == {"period_end": "2026-06-30", "income": 58.0, "pat": 8.5, "eps": 3.7, "opm": 18.0}


def test_non_march_year_end_is_labelled_by_month():
    assert F.period_label("Mar 2026") == "FY2026" and F.period_label("Dec 2025") == "Dec-2025"
    assert F.period_end("Feb 2024") == "2024-02-29"


class _Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text = status, text


class _Client:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def request(self, method, url, **kw):
        self.calls.append(url)
        if url not in self.pages:
            return _Resp(404)
        return _Resp(200, self.pages[url])


def test_update_fetches_only_requested_stocks_and_survives_failures(tmp_path, monkeypatch):
    monkeypatch.setattr(F, "OUT", tmp_path / "fundamentals.json")
    c = _Client({"https://www.screener.in/company/YASHHV/consolidated/": HTML})
    log: list[str] = []
    F.update(c, [{"name": "Yash", "symbol": "YASHHV"}, {"name": "Broken", "symbol": "NOPE"}], log, pace=0)
    out = json.loads((tmp_path / "fundamentals.json").read_text())
    assert list(out) == ["YASHHV"] and out["YASHHV"]["basis"] == "consolidated" and out["YASHHV"]["facts"]
    assert any("NOPE" in m for m in log) and any("1 refreshed, 1 failed" in m for m in log)
    n = len(c.calls)
    F.update(c, [{"name": "Yash", "symbol": "YASHHV"}], [], pace=0)           # fresh data is not fetched again
    assert len(c.calls) == n


def test_falls_back_to_standalone_page(tmp_path, monkeypatch):
    monkeypatch.setattr(F, "OUT", tmp_path / "fundamentals.json")
    c = _Client({"https://www.screener.in/company/ABC/": HTML})
    F.update(c, [{"name": "Abc", "symbol": "ABC"}], [], pace=0)
    assert json.loads((tmp_path / "fundamentals.json").read_text())["ABC"]["basis"] == "standalone"
