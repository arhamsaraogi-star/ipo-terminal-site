"""BSE workaround parsers (ipowatch issue table, valuation mentions)."""
from pipeline.ingestion import ipowatch as W
from pipeline.ingestion.private_intel import valuations


class FakeClient:
    def __init__(self, pages): self.pages = pages
    def request(self, method, url):
        class R: pass
        r = R(); r.text = self.pages[url]; return r


LIST = """<table><tr><th>IPO</th><th>Date</th><th>IPO Size</th><th>IPO Price Band</th><th>Platform</th></tr>
<tr><td><a href="https://ipowatch.in/abc-ipo/">ABC Foods</a></td><td>1-3 Oct</td><td>₹20 Cr.</td><td>₹50</td><td>BSE SME</td></tr>
<tr><td><a href="https://ipowatch.in/xyz-ipo/">XYZ</a></td><td>1-3 Oct</td><td>₹20 Cr.</td><td>₹50</td><td>NSE SME</td></tr></table>"""
PAGE = """<table><tr><td>IPO Open Date</td><td>September 30, 2026</td></tr><tr><td>IPO Close Date</td><td>October 6, 2026</td></tr>
<tr><td>IPO Price Band</td><td>₹119 to ₹127 Per Share</td></tr><tr><td>Issue Size</td><td>Approx ₹82 Crores</td></tr>
<tr><td>IPO Listing</td><td>BSE SME</td></tr></table><table><tr><td>IPO Listing Date:</td><td>October 9, 2026</td></tr></table>
<a href="https://x.com/ABC_DRHP.pdf">DRHP</a>"""


def test_list_keeps_bse_only_and_reads_issue_page():
    c = FakeClient({W.LISTS[0]: LIST, W.LISTS[1]: "", "https://ipowatch.in/abc-ipo/": PAGE})
    rows = W.list_rows(c)
    assert [r["name"] for r in rows] == ["ABC Foods"]
    d = W.issue_page(c, rows[0]["url"])
    assert (d["open"], d["close"], d["listing"]) == ("2026-09-30", "2026-10-06", "2026-10-09")
    assert (d["band_low"], d["band_high"], d["issue_cr"]) == (119, 127, 82) and d["drhp"].endswith("DRHP.pdf")


def test_valuation_mentions():
    assert valuations("raises $450 million at a valuation of $7 billion")[0]["value_mn"] == 7000
    assert valuations("valued at ₹30,000 crore")[0]["value_cr"] == 30000
    assert valuations("contract valued at $8.9 million") == []          # too small to be a company valuation


def test_bsesme_drhp_table():
    from pathlib import Path
    from pipeline.ingestion import bsesme
    rows = bsesme.parse((Path(__file__).resolve().parents[1] / "fixtures" / "bsesme_drhp.html").read_text())
    assert [r["name"] for r in rows] == ["LGC Engineering Limited", "S.R.G. NARROW FAB LIMITED", "ROBOKIDZ EDUVENTURES LIMITED"]
    assert rows[0]["drhp"] == {"url": "https://www.bsesme.com/download/332642/SME_IPO%20InPrinciple/DRHP_LGC_BSE_30092026_Final_20261001002056.pdf", "date": "2026-10-01"}
    r = rows[2]
    assert r["rhp"]["date"] == "2026-09-15" and r["prospectus"]["date"] == "2026-09-24" and r["drhp"]["date"] == "2026-07-24"
