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
    assert [a["expiry_date"] for a in anchors] == ["2026-08-30", "2026-10-29"]  # allotment 2026-07-31 + 30d / 90d
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


def test_vault_v2_users():
    import pytest as _pt
    users = vault.parse_users("# comment\narham:pass word 1:x\nboss : secondpass\n")
    assert users == [("arham", "pass word 1:x"), ("boss", "secondpass")]
    blob = vault.seal_v2({"k": "₹1"}, users, b"\x01" * 16, iterations=1000)
    assert blob[:5] == b"IPOV2" and b"arham" not in blob and b"pass word" not in blob
    assert vault.open_v2(blob, "ARHAM", "pass word 1:x") == {"k": "₹1"}
    with _pt.raises(Exception):
        vault.open_v2(blob, "boss", "wrong pass!")
    with _pt.raises(ValueError):
        vault.parse_users("x:short")
