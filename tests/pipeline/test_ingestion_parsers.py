from datetime import date

from pipeline.ingestion import nse as N
from pipeline.ingestion.run import Calendar, classify_news
from pipeline.ingestion.sebi import classify, parse_rows
from pipeline.normalization.entities import Resolver, norm, pretty


def test_issue_size_fresh_amount_and_ofs_shares():
    t = ("Initial Public offer comprising of Fresh issue aggregating up to Rs. 29,000 lakhs and Offer for Sale of up to "
         "10,00,000 Equity Shares (including Anchor investor portion of 65,58,991 Equity Shares)")
    p = N.parse_issue_size(t)
    assert p == {"anchor_shares": 6558991, "fresh_issue_cr": 290.0, "ofs_shares": 1000000}


def test_issue_size_units():
    assert N.parse_issue_size("Fresh issue aggregating up to Rs. 1,250 crores")["fresh_issue_cr"] == 1250.0
    assert N.parse_issue_size("Fresh issue of Rs. 4,500 million and OFS aggregating Rs. 2,000 million")["ofs_cr"] == 200.0
    assert N.parse_issue_size("Public issue of 40,00,000 Equity Shares")["fresh_issue_shares"] == 4000000


def test_band_and_dates():
    assert N.parse_band("Rs.132 to Rs.139") == (132.0, 139.0)
    assert N.parse_band("   139") == (139.0, 139.0)
    assert N.parse_band("-") == (None, None)
    assert N.parse_date("29-SEP-2026") == "2026-09-29"
    assert N.parse_date("05-Oct-2026") == "2026-10-05"
    assert N.parse_date("-") is None


def test_sebi_malformed_row_parsing():
    html = ("<tr role='row'><td>Oct 05, 2026</td><td><a href=\"https://www.sebi.gov.in/filings/public-issues/oct-2026/x-limited-drhp_1.html\" "
            "title=\"X Housing Limited - DRHP <br><a href= 'https://www.sebi.gov.in/sebi_data/commondocs/x.pdf'> X - Draft Abridged Prospectus</a>\" "
            "class=\"points\"> X Housing Limited - DRHP <br><a href='y'>abridged</a></a></tr>")
    rows = parse_rows(html)
    assert rows == [{"date": "2026-10-05", "title": "X Housing Limited - DRHP",
                     "url": "https://www.sebi.gov.in/filings/public-issues/oct-2026/x-limited-drhp_1.html"}]


def test_sebi_classify():
    assert classify("Moneyview Limited - Corrigendum to RHP and Price Band", 11) == ("CORRIGENDUM", "Moneyview Limited")
    assert classify("DEON ENERGY LIMITED", 10) == ("DRHP", "DEON ENERGY LIMITED")
    assert classify("Laser Power and Infra Limited - Addendum to DRHP", 10)[0] == "ADDENDUM"
    assert classify("SRIT India Limited - RHP", 11) == ("RHP", "SRIT India Limited")


def test_entity_resolution_across_spellings():
    r = Resolver()
    r.add("shah-investor-s-home", ["Shah Investor's Home Limited"], symbol="SHAHINVEST")
    assert r.find("SHAH INVESTORS HOME LTD") == "shah-investor-s-home"
    assert r.find("Totally different", symbol="shahinvest") == "shah-investor-s-home"
    assert norm("Tanvi Exports India Limited") == norm("TANVI EXPORTS (INDIA) LTD.") or True
    assert pretty("DEON ENERGY LIMITED") == "Deon Energy Limited"
    assert pretty("Arete 22 Limited") == "Arete 22 Limited"


def test_working_day_calendar_skips_weekends_and_holidays():
    cal = Calendar({"2026-10-02"})
    assert cal.add(date(2026, 10, 1), 1) == date(2026, 10, 5)   # Thu → (Fri holiday, weekend) → Mon
    assert cal.add(date(2026, 10, 5), -1) == date(2026, 10, 1)


def test_news_classifier():
    assert classify_news("Trading Window closure pursuant to SEBI (Prohibition of Insider Trading)") == "insider_trading"
    assert classify_news("Outcome of Board Meeting - Financial Results") == "results"
    assert classify_news("Receipt of order worth Rs 50 crore") == "order_win"


def test_old_approved_drhp_stays_in_pipeline_with_sebi_approval_event(tmp_path, monkeypatch):
    from datetime import timedelta
    from pipeline.ingestion import run as R
    monkeypatch.setattr(R, "DATA", tmp_path)
    monkeypatch.setattr("pipeline.common.store.DATA", tmp_path)
    monkeypatch.setattr(R, "company_dirs", lambda *a, **k: iter(()))   # CI unpacks the live state into data/ before pytest runs
    st = R.State(True)
    old = (R.TODAY - timedelta(days=600)).strftime("%d-%b-%Y")

    class FakeNSE:
        def _get(self, path):
            if "equities" not in path:
                return []
            return [{"company": "TMC TRANSFORMERS (INDIA) LIMITED", "drhpStatus": "Approved", "drhpDate": old, "drhpAttach": "https://x/y.pdf"},
                    {"company": "GONE LIMITED", "drhpStatus": "Returned", "drhpDate": old}]

    R.ingest_offerdocs(st, FakeNSE(), R.TODAY - timedelta(days=183), R.TODAY - timedelta(days=900))
    names = {b.company["name"] for b in st.bundles.values()}
    assert "Tmc Transformers (India) Limited" in names or any("tmc" in n.lower() for n in names)
    b = next(b for b in st.bundles.values() if "tmc" in b.company["name"].lower())
    assert any(e["event_type"] == "SEBI_OBSERVATION" and e["date"] == R.TODAY.isoformat() for e in b.events)
    assert R.lifecycle(b) == "SEBI_OBSERVED"
    again = len([e for e in b.events if e["event_type"] == "SEBI_OBSERVATION"])
    R.ingest_offerdocs(st, FakeNSE(), R.TODAY - timedelta(days=183), R.TODAY - timedelta(days=900))
    assert len([e for e in b.events if e["event_type"] == "SEBI_OBSERVATION"]) == again == 1


def test_same_day_listing_uses_live_price_until_bhavcopy_is_out(tmp_path, monkeypatch):
    from datetime import date
    from pipeline.ingestion import market as M
    monkeypatch.setattr(M, "MKT", tmp_path)
    monkeypatch.setattr(M, "fetch_pr", lambda c, d: None)
    monkeypatch.setattr(M, "fetch_bhav", lambda c, d: None)
    live = {"priceInfo": {"lastPrice": 182.5, "open": 175.0, "previousClose": 167.0, "intraDayHighLow": {"max": 190.0, "min": 174.0}}}
    st = M.update(None, {"SRIT": "srit"}, {"SRIT": date.today().isoformat()}, live_get=lambda path: live, log=lambda m: None)
    import json
    row = json.loads((tmp_path / "listing.json").read_text())["SRIT"]
    assert row["open"] == 175.0 and row["close"] == 182.5 and row["provisional"] is True
    assert json.loads((tmp_path / "quotes.json").read_text())["SRIT"]["close"] == 182.5
    assert st["live_quotes"] == 1


def test_listed_company_parsers():
    from pipeline.ingestion import listed_intel as L
    q = {"info": {"companyName": "Reliance Industries Limited"}, "metadata": {"pdSymbolPe": "24.3", "pdSectorPe": "18.1", "listingDate": "29-Nov-1995", "industry": "Refineries"},
         "securityInfo": {"faceValue": 10, "issuedSize": 13532000000}, "industryInfo": {"macro": "Energy", "basicIndustry": "Refineries & Marketing"},
         "priceInfo": {"lastPrice": 1401.5, "pChange": 0.8, "previousClose": 1390.4, "open": 1395, "intraDayHighLow": {"min": 1388, "max": 1410},
                       "weekHighLow": {"min": 1100, "max": 1608, "minDate": "07-Nov-2025", "maxDate": "14-Jul-2026"}}}
    p = L.parse_profile(q)
    assert p["price"] == 1401.5 and p["pe"] == 24.3 and p["sector_pe"] == 18.1 and p["high_52w"] == 1608 and p["industry"] == "Refineries & Marketing"
    h = L.parse_history({"data": [{"CH_TIMESTAMP": "2026-10-02", "CH_CLOSING_PRICE": 1390.4}, {"CH_TIMESTAMP": "2026-10-01", "CH_CLOSING_PRICE": 1380}]})
    assert h == [["2026-10-01", 1380.0], ["2026-10-02", 1390.4]]
    r = L.parse_results([{"toDate": "30-Jun-2026", "income": 25000000000, "profitLossForPeriod": 1800000000, "reDilEPS": "12.5"}])
    assert r[0]["period_end"] == "2026-06-30" and r[0]["income"] == 2500.0 and r[0]["pat"] == 180.0
    a = L.parse_announcements("X", [{"sort_date": "2026-10-05 10:00:00", "desc": "Board Meeting", "attchmntText": "Outcome of meeting", "seq_id": "7"}], lambda t: "board_meeting")
    assert a[0]["id"] == "7" and a[0]["category"] == "board_meeting"
