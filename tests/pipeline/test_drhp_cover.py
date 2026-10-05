"""Cover-page extraction against the real text layers of two DRHPs filed with SEBI on 5 Oct 2026."""
import json
from pathlib import Path

import pytest

from pipeline.extraction.drhp_cover import extract

COVERS = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "drhp_covers.json").read_text())


@pytest.fixture(scope="module")
def deon():
    return extract(COVERS["deon"])


@pytest.fixture(scope="module")
def arete():
    return extract(COVERS["arete"])


def test_identity(deon, arete):
    assert deon["cin"] == "U42201GJ2024PLC150542" and deon["dated"] == "September 25, 2026"
    assert arete["website"] == "www.arete22.com"
    assert arete["promoters"] == ["Pawan Kumar Gupta", "Abhishek Gupta", "Konica Gupta", "Naveen Gupta"]


def test_offer_table_shares_and_amounts(deon, arete):
    assert (deon["fresh_shares"], deon["ofs_shares"], deon["total_shares"]) == (7_200_000, 2_000_000, 9_200_000)
    assert "fresh_cr" not in deon  # amount is [●] in the DRHP — must not be invented
    assert arete["fresh_cr"] == 440.0 and arete["total_cr"] == 440.0 and "ofs_cr" not in arete


def test_deal_team(deon, arete):
    b = deon["brlms"][0]
    assert b["name"] == "Valmiki Leela Capital Private Limited" and b["email"] == "deon.ipo@valmikileela.com"
    assert arete["brlms"][0]["email"] == "mb@unistonecapital.com"
    assert arete["registrar"]["name"] == "Bigshare Services Private Limited"


def test_flags(deon):
    assert deon["regulation"] == "6(1)" and deon["anchor_contemplated"] and deon["pre_ipo_placement"]
    assert set(deon["exchanges"]) == {"NSE", "BSE"} and not deon["garbled"]
