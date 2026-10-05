"""Generate clearly-labelled DEMO data so the UI and pipeline can be exercised before live ingestion.

Every company is fictional, flagged is_sample = true, and every fact has source_type SAMPLE.
The terminal shows a SAMPLE DATA banner while any sample company exists.
Remove with:  python scripts/make_sample_data.py --remove
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from pipeline.common.store import DATA, CompanyBundle, save_company, write_json, write_jsonl  # noqa: E402

TS = "2026-10-05T08:00:00+05:30"
SAMPLE_URL = "sample://demo-document"


def src(page=None, table=None, stype="SAMPLE"):
    return {"source_type": stype, "document_id": "sample", "page": page, "table": table,
            "section": None, "url": SAMPLE_URL, "sha256": None, "tier": "primary"}


EXT = {"method": "sample", "extracted_at": TS, "extractor_version": "sample", "confidence": "high"}


def fact(cid, metric, value, unit, period=None, basis=None, page=None, table=None, label=None):
    return {"fact_id": f"{cid}:{metric}:{period or 'na'}", "metric": metric, "label": label, "value": value,
            "unit": unit, "period": period, "basis": basis, "kind": "reported", "formula": None, "inputs": [],
            "source": src(page, table), "extraction": EXT, "status": "ok", "note": None, "supersedes": None}


def company(cid, name, sector, industry, segment, lifecycle, **kw):
    c = {"company_id": cid, "name": name, "legal_name": name, "aliases": [], "identifiers": {
        "cin": None, "isin": None, "nse_symbol": kw.pop("nse", None), "bse_code": None},
        "sector": sector, "industry": industry, "segment": segment, "lifecycle": lifecycle,
        "private_tracker": kw.pop("private_tracker", None), "overview": kw.pop("overview", None),
        "website": None, "ir_url": None, "registered_office": None, "is_sample": True,
        "created_at": TS, "updated_at": TS}
    return c


def ev(cid, etype, d, kind="actual", detail=None, oid=None, stype="SAMPLE"):
    return {"event_id": f"{cid}:{etype}:{d}", "company_id": cid, "offering_id": oid, "event_type": etype,
            "date": d, "date_kind": kind, "detail": detail, "source": src(stype=stype), "rule_id": None,
            "detected_at": TS}


def pnl(cid, fy, rev, ebitda, da, fin, oth, tax_rate):
    ebit = round(ebitda - da, 1)
    pbt = round(ebit - fin + oth, 1)
    tax = round(pbt * tax_rate, 1)
    pat = round(pbt - tax, 1)
    T = "Restated Consolidated Statement of Profit and Loss"
    rows = [("revenue_from_operations", rev, "Revenue from operations"), ("ebitda", ebitda, "EBITDA"),
            ("depreciation", da, "Depreciation & amortisation"), ("ebit", ebit, "EBIT"),
            ("finance_cost", fin, "Finance cost"), ("other_income", oth, "Other income"),
            ("pbt", pbt, "Profit before tax"), ("tax", tax, "Tax"), ("pat", pat, "Profit after tax")]
    return [fact(cid, m, v, "INR crore", fy, "restated_consolidated", 212, T, l) for m, v, l in rows]


def aster() -> CompanyBundle:
    cid, oid = "aster-demo-logistics", "aster-demo-logistics:ipo:2026"
    c = company(cid, "Aster Demo Logistics Ltd", "Industrials", "Logistics", "MAINBOARD", "LISTED", nse="ASTERDEMO",
                overview={"summary": "DEMO COMPANY. Fictional asset-light express logistics operator used to test the terminal.",
                          "segments": ["Express parcel", "Part-truck-load", "Warehousing"], "source": src(112)})
    f = {k: fact(cid, k, v, u, None, "offer", p, t, l) for k, v, u, p, t, l in [
        ("fresh_issue", 600.0, "INR crore", 9, "The Offer", "Fresh issue"),
        ("ofs", 900.0, "INR crore", 9, "The Offer", "Offer for sale"),
        ("total_issue", 1500.0, "INR crore", 9, "The Offer", "Total issue"),
        ("price_band_low", 410, "INR", 1, None, "Price band — low"),
        ("price_band_high", 432, "INR", 1, None, "Price band — high"),
        ("issue_price", 432, "INR", 1, None, "Final issue price"),
        ("lot_size", 34, "shares", 1, None, "Lot size"),
        ("face_value", 2, "INR", 1, None, "Face value"),
        ("pre_issue_shares", 186_111_111, "shares", 88, "Capital Structure", "Pre-issue shares"),
        ("fresh_issue_shares", 13_888_889, "shares", 88, "Capital Structure", "Fresh issue shares"),
        ("post_issue_shares", 200_000_000, "shares", 88, "Capital Structure", "Post-issue shares"),
        ("promoter_pre_pct", 72.4, "%", 92, "Shareholding Pattern", "Promoter holding pre-issue"),
        ("promoter_post_pct", 58.1, "%", 92, "Shareholding Pattern", "Promoter holding post-issue"),
        ("anchor_shares", 10_416_666, "shares", 1, "Anchor allocation", "Anchor investor shares"),
        ("promoter_min_contribution_shares", 40_000_000, "shares", 95, "Capital Structure", "Promoters' minimum contribution"),
        ("promoter_excess_shares", 76_200_000, "shares", 95, "Capital Structure", "Promoter shares in excess of minimum"),
        ("pre_ipo_non_promoter_shares", 31_500_000, "shares", 96, "Capital Structure", "Pre-IPO non-promoter shares"),
    ]}
    f["objects_include_capex"] = {**fact(cid, "objects_include_capex", False, "bool", None, "offer", 101), "unit": "bool"}
    offerings = [{"offering_id": oid, "company_id": cid, "type": "IPO", "segment": "MAINBOARD",
                  "exchanges": ["NSE", "BSE"], "facts": f, "intermediaries": {"brlms": ["Demo Capital"], "registrar": "Demo Registrar"}}]
    fin = (pnl(cid, "FY2024", 1180.0, 118.0, 41.0, 18.0, 6.0, 0.25) + pnl(cid, "FY2025", 1490.0, 171.0, 52.0, 16.0, 8.0, 0.25)
           + pnl(cid, "FY2026", 1862.0, 236.0, 63.0, 12.0, 11.0, 0.25))
    for fy, debt, cash in [("FY2024", 210.0, 64.0), ("FY2025", 185.0, 92.0), ("FY2026", 140.0, 131.0)]:
        fin += [fact(cid, "total_debt", debt, "INR crore", fy, "restated_consolidated", 214, "Restated Balance Sheet", "Total borrowings"),
                fact(cid, "cash", cash, "INR crore", fy, "restated_consolidated", 214, "Restated Balance Sheet", "Cash & equivalents")]
    ind = [fact(cid, "industry_market_size", v, "INR trillion", p, "industry", 141, "Industry Overview", "Indian express logistics market")
           for p, v in [("FY2021", 0.42), ("FY2026", 0.81), ("FY2031E", 1.52)]]
    ind += [fact(cid, "industry_organised_share", v, "%", p, "industry", 143, "Industry Overview", "Organised share")
            for p, v in [("FY2021", 38.0), ("FY2026", 49.0), ("FY2031E", 61.0)]]
    ind += [fact(cid, "company_market_share", 2.3, "%", "FY2026", "industry", 158, "Industry Overview", "Company share of express market")]
    events = [ev(cid, "DRHP_FILED", "2026-03-10"), ev(cid, "SEBI_OBSERVATION", "2026-06-02"), ev(cid, "RHP_FILED", "2026-07-20"),
              ev(cid, "PRICE_BAND_ANNOUNCED", "2026-07-22", detail="₹410–432"), ev(cid, "ANCHOR_ALLOCATION", "2026-07-27", detail="₹450 cr raised from anchors"),
              ev(cid, "ISSUE_OPEN", "2026-07-28"), ev(cid, "ISSUE_CLOSE", "2026-07-30", detail="Subscribed 41.2x"),
              ev(cid, "BASIS_OF_ALLOTMENT", "2026-07-31"), ev(cid, "LISTING", "2026-08-04", detail="Listed at ₹498 (+15.3%)"),
              ev(cid, "QUARTERLY_RESULTS", "2026-11-10", kind="scheduled", detail="Q2 FY27 board meeting")]
    news = [{"news_id": f"{cid}:n{i}", "company_id": cid, "published_at": t, "title": title, "url": SAMPLE_URL,
             "publisher": pub, "tier": tier, "category": cat, "dedupe_key": None}
            for i, (t, title, pub, tier, cat) in enumerate([
                ("2026-10-03T17:42:00+05:30", "DEMO: Intimation of board meeting to consider Q2 FY27 results", "NSE", "official", "results"),
                ("2026-09-26T19:05:00+05:30", "DEMO: Company signs warehousing contract with consumer brand", "BSE", "official", "order_win"),
                ("2026-09-18T11:20:00+05:30", "DEMO: Block deal — 0.8% equity changes hands", "Demo Wire", "media", "block_deal"),
                ("2026-08-30T09:00:00+05:30", "DEMO: First anchor lock-in tranche ends", "Demo Wire", "media", "lockin")])]
    return CompanyBundle(c, offerings, {"company_id": cid, "financials": fin, "industry": ind, "operating": []},
                         [{"document_id": "sample", "company_id": cid, "doc_type": "SAMPLE", "title": "Demo offer document",
                           "url": SAMPLE_URL, "source": "SAMPLE", "filing_date": "2026-07-20", "downloaded_at": TS,
                           "sha256": None, "pages": 420, "storage": None, "version": 1, "previous_version": None}],
                         events, [], news)


def borealis() -> CompanyBundle:
    cid, oid = "borealis-demo-foods", "borealis-demo-foods:ipo:2026"
    c = company(cid, "Borealis Demo Foods Ltd", "Consumer Staples", "Packaged foods", "MAINBOARD", "ISSUE_ANNOUNCED",
                overview={"summary": "DEMO COMPANY. Fictional packaged-snacks maker used to test the terminal.",
                          "segments": ["Snacks", "Ready-to-cook"], "source": src(98)})
    f = {k: fact(cid, k, v, u, None, "offer", 9, None, l) for k, v, u, l in [
        ("fresh_issue", 350.0, "INR crore", "Fresh issue"), ("ofs", 650.0, "INR crore", "Offer for sale"),
        ("total_issue", 1000.0, "INR crore", "Total issue"), ("price_band_low", 268, "INR", "Price band — low"),
        ("price_band_high", 282, "INR", "Price band — high"), ("lot_size", 53, "shares", "Lot size"),
        ("face_value", 1, "INR", "Face value")]}
    offerings = [{"offering_id": oid, "company_id": cid, "type": "IPO", "segment": "MAINBOARD", "exchanges": ["NSE", "BSE"],
                  "facts": f, "intermediaries": {"brlms": ["Demo Capital"], "registrar": "Demo Registrar"}}]
    fin = (pnl(cid, "FY2024", 640.0, 58.0, 19.0, 9.0, 3.0, 0.25) + pnl(cid, "FY2025", 742.0, 76.0, 22.0, 8.0, 3.0, 0.25)
           + pnl(cid, "FY2026", 868.0, 97.0, 26.0, 7.0, 4.0, 0.25))
    events = [ev(cid, "DRHP_FILED", "2026-02-14"), ev(cid, "SEBI_OBSERVATION", "2026-05-21"), ev(cid, "RHP_FILED", "2026-10-01"),
              ev(cid, "PRICE_BAND_ANNOUNCED", "2026-10-03", detail="₹268–282"),
              ev(cid, "ANCHOR_BIDDING", "2026-10-08", "scheduled"), ev(cid, "ISSUE_OPEN", "2026-10-09", "scheduled"),
              ev(cid, "ISSUE_CLOSE", "2026-10-13", "scheduled"), ev(cid, "BASIS_OF_ALLOTMENT", "2026-10-14", "scheduled"),
              ev(cid, "LISTING", "2026-10-16", "scheduled")]
    return CompanyBundle(c, offerings, {"company_id": cid, "financials": fin, "industry": [], "operating": []}, [], events, [], [])


def cobalt() -> CompanyBundle:
    cid = "cobalt-demo-fintech"
    c = company(cid, "Cobalt Demo Fintech Ltd", "Financials", "Payments", "MAINBOARD", "DRHP_FILED",
                overview={"summary": "DEMO COMPANY. Fictional merchant-payments platform used to test the terminal.",
                          "segments": ["Payment gateway", "Merchant lending distribution"], "source": src(77)})
    f = {"fresh_issue": fact(cid, "fresh_issue", 1200.0, "INR crore", None, "offer", 8, None, "Fresh issue"),
         "ofs": {**fact(cid, "ofs", None, "INR crore", None, "offer"), "status": "not_available", "kind": "reported",
                 "source": None, "extraction": None, "note": "OFS stated in shares only; value set at RHP"}}
    offerings = [{"offering_id": f"{cid}:ipo:2027", "company_id": cid, "type": "IPO", "segment": "MAINBOARD",
                  "exchanges": ["NSE", "BSE"], "facts": f, "intermediaries": {"brlms": [], "registrar": None}}]
    fin = (pnl(cid, "FY2025", 410.0, -62.0, 18.0, 4.0, 22.0, 0.0) + pnl(cid, "FY2026", 590.0, -14.0, 21.0, 4.0, 31.0, 0.0))
    return CompanyBundle(c, offerings, {"company_id": cid, "financials": fin, "industry": [], "operating": []}, [],
                         [ev(cid, "DRHP_FILED", "2026-09-18")], [], [])


def ember() -> CompanyBundle:
    cid = "ember-demo-mobility"
    c = company(cid, "Ember Demo Mobility Pvt Ltd", "Consumer Discretionary", "EV two-wheelers", "UNKNOWN", "PRIVATE",
                private_tracker={"confidence": "CREDIBLE_REPORT", "expected_timing": "H1 2027",
                                 "sources": [src(stype="SAMPLE")]})
    return CompanyBundle(c, [], None, [], [], [], [])


def build_samples(data) -> None:
    """Write the DEMO dataset into an arbitrary data directory (used by tests)."""
    for b in (aster(), borealis(), cobalt(), ember()):
        save_company(b, data)
    write_json(data / "portfolio" / "holdings.json", {
        "holdings": [{"company_id": "aster-demo-logistics", "quantity": 340, "avg_cost": 432.0,
                      "acquired_on": "2026-07-31", "route": "ALLOTMENT", "note": "DEMO holding"}],
        "watchlist": ["borealis-demo-foods", "cobalt-demo-fintech"]})


def main() -> None:
    root = DATA / "companies"
    if "--remove" in sys.argv:
        for d in root.glob("*-demo-*"):
            shutil.rmtree(d)
        write_json(DATA / "portfolio" / "holdings.json", {"holdings": [], "watchlist": []})
        for p in (DATA / "changes").glob("sample-*.jsonl"):
            p.unlink()
        print("sample data removed")
        return
    for b in (aster(), borealis(), cobalt(), ember()):
        print("wrote", save_company(b).relative_to(DATA.parent))
    write_json(DATA / "portfolio" / "holdings.json", {
        "holdings": [{"company_id": "aster-demo-logistics", "quantity": 340, "avg_cost": 432.0,
                      "acquired_on": "2026-07-31", "route": "ALLOTMENT", "note": "DEMO holding"}],
        "watchlist": ["borealis-demo-foods", "cobalt-demo-fintech"]})
    write_jsonl(DATA / "changes" / "sample-2026-10.jsonl", [
        {"change_id": "s1", "company_id": "borealis-demo-foods", "field": "price_band", "label": "Price band revised",
         "old": "₹260–275", "new": "₹268–282", "source": src(1), "detected_at": "2026-10-03T19:10:00+05:30"},
        {"change_id": "s2", "company_id": "borealis-demo-foods", "field": "lifecycle", "label": "RHP filed",
         "old": "SEBI_OBSERVED", "new": "RHP_FILED", "source": src(1), "detected_at": "2026-10-01T18:00:00+05:30"},
        {"change_id": "s3", "company_id": "cobalt-demo-fintech", "field": "lifecycle", "label": "DRHP filed",
         "old": None, "new": "DRHP_FILED", "source": src(1), "detected_at": "2026-09-18T20:30:00+05:30"},
        {"change_id": "s4", "company_id": "borealis-demo-foods", "field": "total_issue", "label": "Issue size revised",
         "old": "₹1,150 cr", "new": "₹1,000 cr", "source": src(9), "detected_at": "2026-10-01T18:00:00+05:30"}])


if __name__ == "__main__":
    main()
