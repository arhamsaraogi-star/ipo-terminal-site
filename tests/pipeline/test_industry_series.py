"""Industry series rebuilt from chart labels, tables and statements."""
from pipeline.extraction.industry_series import number_of, period_of, scan_page, scan_text


def test_tokens():
    assert period_of("CY30P") == ("CY30P", True) and period_of("FY26") == ("FY26", False) and period_of("2025E") == ("2025E", True)
    assert period_of("26") is None and period_of("1,944") is None
    assert number_of("1,944-1,992")[0] == 1968 and number_of("(3.5)")[0] == -3.5 and number_of("12.5%")[1]


def W(x, y, t):
    return (x, y - 8, x + 6 * len(t), y, t)


def test_chart_labels_matched_to_axis_by_x():
    words = [W(54, 78, "Global"), W(90, 78, "steel"), W(120, 78, "demand"), W(160, 78, "(MnTPA)"),
             W(60, 117, "2,000"),                                   # y-axis tick: left of every column → ignored
             W(110, 120, "1,772"), W(167, 117, "1,841"), W(224, 120, "1,777"), W(281, 120, "1,779"),
             W(113, 222, "CY20"), W(170, 222, "CY21"), W(227, 222, "CY22"), W(284, 222, "CY23P")]
    [s] = scan_page(words, 7)
    assert s.kind == "chart" and s.unit == "MnTPA" and s.title.startswith("Global steel demand")
    assert s.periods == ["CY20", "CY21", "CY22", "CY23P"] and s.rows[0]["values"] == [1772, 1841, 1777, 1779] and s.projected[-1]


def test_table_rows():
    words = [W(54, 400, "Steel"), W(90, 400, "exports"), W(140, 400, "(MnTPA)"),
             W(125, 420, "Category"), W(250, 420, "2020"), W(305, 420, "2021"), W(359, 420, "2022"),
             W(57, 440, "Flat"), W(80, 440, "Products"), W(250, 440, "195.5"), W(305, 440, "239.3"), W(359, 440, "211.1"),
             W(57, 452, "Total"), W(250, 452, "382.3"), W(305, 452, "461.0"), W(359, 452, "399.1"),
             W(54, 470, "Source:"), W(90, 470, "Crisil")]
    [s] = scan_page(words, 3)
    assert s.kind == "table" and [r["name"] for r in s.rows] == ["Flat Products", "Total"] and s.rows[1]["values"] == [382.3, 461.0, 399.1]


def test_statement():
    [s] = scan_text("India's organised brokerage market grew from ~₹77 Bn in 2021 to ~₹215 Bn in 2025, and is projected to reach ₹500 Bn by 2030E.", 9)
    assert s.periods == ["2021", "2025", "2030E"] and s.rows[0]["values"] == [77, 215, 500] and s.projected == [False, False, True]
