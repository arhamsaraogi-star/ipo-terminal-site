import shutil

import pytest

from pipeline.common.store import DATA, read_json
from pipeline.portfolio import Rejected, apply


@pytest.fixture
def data(tmp_path):
    shutil.copytree(DATA, tmp_path / "data")
    return tmp_path / "data"


def test_add_then_remove_holding(data):
    body = "company_id: borealis-demo-foods\nquantity: 1,060\navg_cost: ₹282\nacquired_on: 2026-10-14\nroute: ALLOTMENT  # comment\n"
    apply("portfolio: add borealis-demo-foods", body, data)
    h = {x["company_id"]: x for x in read_json(data / "portfolio/holdings.json")["holdings"]}
    assert h["borealis-demo-foods"]["quantity"] == 1060 and h["borealis-demo-foods"]["avg_cost"] == 282.0
    apply("portfolio: remove borealis-demo-foods", "", data)
    assert "borealis-demo-foods" not in {x["company_id"] for x in read_json(data / "portfolio/holdings.json")["holdings"]}


def test_watch_is_idempotent(data):
    apply("portfolio: watch aster-demo-logistics", "", data)
    apply("portfolio: watch aster-demo-logistics", "", data)
    assert read_json(data / "portfolio/holdings.json")["watchlist"].count("aster-demo-logistics") == 1


@pytest.mark.parametrize("title,body", [
    ("portfolio: add no-such-company", ""),
    ("portfolio: buy aster-demo-logistics", ""),
    ("portfolio: add aster-demo-logistics", "quantity: lots"),
    ("portfolio: add aster-demo-logistics", "quantity: 10\navg_cost: 5\nacquired_on: 05/10/2026"),
])
def test_rejects_bad_input(data, title, body):
    before = (data / "portfolio/holdings.json").read_text()
    with pytest.raises(Rejected):
        apply(title, body, data)
    assert (data / "portfolio/holdings.json").read_text() == before
