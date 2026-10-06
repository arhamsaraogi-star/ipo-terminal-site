import copy
from datetime import date

import pytest

from pipeline.build import vault
from pipeline.build.compile import build_payload
from pipeline.calculations import lockins as lk
import sys
import tempfile
from pathlib import Path

from pipeline.common.store import company_dirs, load_company
from pipeline.validation.checks import validate_bundle

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from make_sample_data import build_samples  # noqa: E402

SAMPLE = Path(tempfile.mkdtemp()) / "data"
build_samples(SAMPLE)
BUNDLES = {d.name: load_company(d) for d in company_dirs(SAMPLE)}


@pytest.mark.parametrize("cid", sorted(BUNDLES))
def test_every_company_validates(cid):
    r = validate_bundle(BUNDLES[cid])
    assert r.ok, r.errors


def test_payload_builds_without_errors():
    payload, report = build_payload(SAMPLE, write_derived=False)
    assert report.ok, report.errors
    assert payload["meta"]["companies"] == len(BUNDLES)


def test_vault_roundtrip_and_wrong_password():
    blob = vault.seal({"a": "₹1,250 cr"}, "a long test passphrase", iterations=1000)
    assert vault.open_vault(blob, "a long test passphrase") == {"a": "₹1,250 cr"}
    with pytest.raises(Exception):
        vault.open_vault(blob, "wrong passphrase!!")


def test_vault_rejects_short_passphrase():
    with pytest.raises(ValueError):
        vault.seal({}, "short")


def test_vault_never_contains_plaintext():
    blob = vault.seal({"company": "Aster Demo Logistics"}, "a long test passphrase", iterations=1000)
    assert b"Aster" not in blob


def test_add_months_clamps_month_end():
    assert lk.add_months(date(2026, 8, 31), 6) == date(2027, 2, 28)
    assert lk.add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)


def test_rule_selection_by_issue_open_date():
    assert lk.select_rule("MAINBOARD", "ANCHOR", date(2023, 3, 31))["rule_id"] == "MB_ANCHOR_PRE2023"
    assert lk.select_rule("MAINBOARD", "ANCHOR", date(2023, 4, 1))["rule_id"] == "MB_ANCHOR_2023"


def test_lockins_run_from_allotment_and_are_unverified():
    t = lk.compute(BUNDLES["aster-demo-logistics"])
    anchors = [x for x in t if x["holder_category"] == "ANCHOR"]
    assert [a["expiry_date"] for a in anchors] == ["2026-08-29", "2026-10-28"]  # allotment 2026-07-31 is day 1: 30d / 90d end 08-29 / 10-28
    assert sum(a["shares"]["value"] for a in anchors) == pytest.approx(10_416_666, abs=1)
    assert all(x["rule_verified"] is False for x in t)


def test_urgency_bands():
    today = date(2026, 10, 5)
    assert lk.urgency(date(2026, 10, 4), today) == "expired"
    assert lk.urgency(date(2026, 10, 9), today) == "lt7"
    assert lk.urgency(date(2026, 10, 29), today) == "7to30"
    assert lk.urgency(date(2026, 12, 1), today) == "30to90"
    assert lk.urgency(date(2027, 6, 1), today) == "gt90"


def test_validation_catches_bad_issue_maths_and_pnl():
    b = copy.deepcopy(BUNDLES["aster-demo-logistics"])
    b.offerings[0]["facts"]["total_issue"]["value"] = 1600.0
    pat = next(f for f in b.facts["financials"] if f["metric"] == "pat" and f["period"] == "FY2026")
    pat["value"] += 25
    r = validate_bundle(b)
    assert any("OFS" in w for w in r.warnings)
    assert any("pat" in w for w in r.warnings)


def test_validation_blocks_unsourced_reported_fact():
    b = copy.deepcopy(BUNDLES["aster-demo-logistics"])
    b.offerings[0]["facts"]["fresh_issue"]["source"] = None
    assert not validate_bundle(b).ok


def test_validation_blocks_unknown_event_type():
    b = copy.deepcopy(BUNDLES["aster-demo-logistics"])
    b.events[0]["event_type"] = "MADE_UP_EVENT"
    assert not validate_bundle(b).ok


def test_chronology_break_is_flagged_not_fixed():
    b = copy.deepcopy(BUNDLES["aster-demo-logistics"])
    for e in b.events:
        if e["event_type"] == "LISTING":
            e["date"] = "2026-07-01"
    r = validate_bundle(b)
    assert any("chronology" in w for w in r.warnings)
    assert any(e["date"] == "2026-07-01" for e in b.events)


def test_vault_v3_access_code():
    import pytest as _pt
    blob = vault.seal_v3({"k": "₹1"}, "secret code", b"\x01" * 16, iterations=1000, repo="o/r")
    assert blob[:5] == b"IPOV3" and b"secret" not in blob and b"\xe2\x82\xb9" not in blob
    assert vault.open_v3(blob, "secret code") == {"k": "₹1"}
    with _pt.raises(Exception):
        vault.open_v3(blob, "wrong code")
    with _pt.raises(ValueError):
        vault.seal_v3({}, "short", b"\x01" * 16)


def test_anchor_lockin_dates_match_market_convention():
    # MV Electrosystems: allotment 4 Aug 2026 → 30-day ends 2 Sep, 90-day ends 1 Nov (as quoted by NSE / aggregators)
    b = copy.deepcopy(BUNDLES["aster-demo-logistics"])
    for e in b.events:
        if e["event_type"] == "BASIS_OF_ALLOTMENT":
            e["date"] = "2026-08-04"
        if e["event_type"] == "ISSUE_OPEN":
            e["date"] = "2026-07-30"
    anchors = [x for x in lk.compute(b) if x["holder_category"] == "ANCHOR"]
    assert [a["expiry_date"] for a in anchors] == ["2026-09-02", "2026-11-01"]


def test_anchor_lockin_dated_even_without_extracted_share_count():
    b = copy.deepcopy(BUNDLES["aster-demo-logistics"])
    b.offerings[0]["facts"].pop("anchor_shares", None)
    b.events.append({"event_id": "x:anchor", "company_id": b.company["company_id"], "offering_id": None, "event_type": "ANCHOR_BIDDING",
                     "date": "2026-07-29", "date_kind": "derived", "detected_at": "2026-07-01T00:00:00+05:30"})
    anchors = [x for x in lk.compute(b) if x["holder_category"] == "ANCHOR"]
    assert len(anchors) == 2
    assert all(a["shares"]["status"] == "not_available" and "pct_post_issue" not in a for a in anchors)
    from pipeline.common.store import schema_errors
    assert not schema_errors(anchors, "records.schema.json", "lockins_file")


def test_listed_index_excludes_tracked_companies(tmp_path):
    import json
    from pipeline.build.compile import listed_index
    (tmp_path / "market").mkdir()
    (tmp_path / "market" / "listed.json").write_text(json.dumps({"RELIANCE": ["Reliance Industries", "INE002A01018", "MAINBOARD", "1995-11-29"], "SRIT": ["SRIT India", "INE0X", "MAINBOARD", "2026-10-06"]}))
    (tmp_path / "market" / "universe.json").write_text(json.dumps({"date": "2026-10-05", "rows": {"RELIANCE": [1400.5, 1900000.0, "Reliance"]}}))
    comps = [{"company": {"identifiers": {"nse_symbol": "SRIT", "isin": None}}}]
    rows = listed_index(comps, tmp_path)
    assert rows == [["RELIANCE", "Reliance Industries", "INE002A01018", "MAINBOARD", 1400.5, 1900000.0, "1995-11-29"]]
