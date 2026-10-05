"""Deterministic extraction from the cover pages (pp.1–3) of a DRHP / RHP / Prospectus.

ICDR prescribes the cover layout, so the same blocks appear in every offer document:
company + CIN, promoters, offer table (fresh / OFS / total), eligibility regulation, BRLM(s) with deal-team
contact, registrar, anchor bidding note, pre-IPO placement note. Every field records the page it came from.
Nothing is guessed: a field that does not parse is simply absent.
"""
from __future__ import annotations

import io
import re
import zipfile

UNIT_CR = {"lakh": 0.01, "lakhs": 0.01, "lacs": 0.01, "million": 0.1, "crore": 1.0, "crores": 1.0, "billion": 100.0}
GARBLE = re.compile(r"\b(Isue|Ofer|Bok Built|Runing|Comp any)\b")


def pdf_bytes(blob: bytes) -> bytes | None:
    """Accept a PDF or a zip (NSE Emerge publishes DRHPs as zip) and return the main PDF."""
    if blob[:4] == b"%PDF":
        return blob
    if blob[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(blob))
        pdfs = [i for i in z.infolist() if i.filename.lower().endswith(".pdf")]
        if not pdfs:
            return None
        pref = [i for i in pdfs if re.search(r"drhp|draft|prospectus|rhp", i.filename, re.I)] or pdfs
        return z.read(max(pref, key=lambda i: i.file_size).filename)
    return None


def cover_pages(pdf: bytes, n: int = 3) -> tuple[list[str], int]:
    import pymupdf
    pymupdf.TOOLS.mupdf_display_errors(False)
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    return [doc[i].get_text() for i in range(min(n, doc.page_count))], doc.page_count


def _flat(s: str) -> str:
    return " ".join(s.split())


def _page_of(pages: list[str], needle: str) -> int | None:
    for i, p in enumerate(pages, 1):
        if needle and needle[:40] in _flat(p):
            return i
    return None


def _amount_cr(num: str, unit: str) -> float | None:
    try:
        return round(float(num.replace(",", "")) * UNIT_CR[unit.lower()], 2)
    except (ValueError, KeyError):
        return None


CELL = re.compile(
    r"(Not Applicable|Nil\b|"
    r"(?:Up to|upto)\s*(?P<sh>[\d,]+|\[●\]|\[•\])\s*(?:Equity Shares|equity shares)"
    r"(?:(?!Up to|Not Applicable).){0,160}?(?:aggregating|amounting)\s*(?:up\s*to|upto)?\s*(?:₹|Rs\.?|INR)\s*(?P<amt>[\d,]+(?:\.\d+)?|\[●\]|\[•\])\s*(?P<unit>lakhs?|lacs|million|crores?|billion)?"
    r"|(?:Up to|upto)\s*(?P<sh2>[\d,]+|\[●\])\s*(?:Equity Shares|equity shares))", re.I)


def parse_offer(flat: str) -> dict:
    m = re.search(r"DETAILS OF THE (?:OFFER|ISSUE)(?: TO THE PUBLIC)?(.*?)(?:DETAILS OF THE (?:SELLING|OFFER FOR SALE|PROMOTER SELLING)|RISKS? IN RELATION|NAME OF THE SELLING)", flat, re.S | re.I)
    if not m:
        return {}
    block = m.group(1)
    head = block[:600].lower()
    has_fresh = "fresh issue" in head or "fresh" in head
    tmatch = re.search(r"(Fresh Issue and (?:an )?Offer for Sale|Fresh Issue|Offer for Sale)", block[block.lower().find("eligibility"):] if "eligibility" in block.lower() else block, re.I)
    otype = tmatch.group(1).title() if tmatch else None
    cells = []
    for c in CELL.finditer(block):
        if c.group(0).lower().startswith(("not applicable", "nil")):
            cells.append(None)
        else:
            sh = c.group("sh") or c.group("sh2")
            amt, unit = c.group("amt"), c.group("unit")
            cells.append({"shares": int(sh.replace(",", "")) if sh and sh[0].isdigit() else None,
                          "amount_cr": _amount_cr(amt, unit) if amt and amt[0].isdigit() and unit else None})
        if len(cells) == 3:
            break
    out: dict = {"offer_type": otype}
    if otype and otype.lower() == "fresh issue" and len(cells) >= 2 and cells[1] is None:
        cells = [cells[0], None, cells[2] if len(cells) > 2 else cells[0]]
    names = ["fresh", "ofs", "total"]
    if otype and otype.lower() == "offer for sale" and len(cells) == 2:
        cells = [None, cells[0], cells[1]]
    if not has_fresh and len(cells) == 2:
        cells = [None] + cells
    for k, c in zip(names, cells):
        if c:
            if c["shares"] is not None:
                out[f"{k}_shares"] = c["shares"]
            if c["amount_cr"] is not None:
                out[f"{k}_cr"] = c["amount_cr"]
    return out


ENTITY_END = re.compile(r"(Private Limited|Pvt\.? Ltd\.?|Limited|LLP|Ltd\.?)\s*$", re.I)
HEADER_WORDS = {"NAME", "LOGO", "CONTACT", "PERSON", "PERSONS", "TELEPHONE", "E-MAIL", "EMAIL", "AND", "OF", "TO", "THE", "BOOK",
                "RUNNING", "LEAD", "MANAGER", "MANAGERS", "REGISTRAR", "OFFER", "ISSUE", "/", "&", "TEL", "E-MAIL:", "ID"}


def _is_header(l: str) -> bool:
    return "@" not in l and not re.search(r"\d", l) and all(w.strip(",:") in HEADER_WORDS for w in l.upper().split())


def parse_parties(text: str, start_pat: str, end_pat: str) -> list[dict]:
    m = re.search(start_pat + r"(.*?)" + end_pat, text, re.S)
    if not m:
        return []
    lines = [l.strip() for l in m.group(1).splitlines() if l.strip()]
    lines = [l for l in lines if not _is_header(l)]
    parties: list[dict] = []
    buf: list[str] = []
    for l in lines:
        if re.match(r"^(Tel|Telephone|Phone|Mob)", l, re.I):
            if parties:
                parties[-1]["phone"] = parties[-1].get("phone") or re.sub(r"^(Tel|Telephone|Phone|Mob)[^:]*:\s*", "", l, flags=re.I)
            continue
        if re.match(r"^E-?mail", l, re.I) or "@" in l:
            em = re.search(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", l)
            if em and parties and not parties[-1].get("email"):
                parties[-1]["email"] = em.group(0)
            continue
        if re.match(r"^(Website|Investor grievance|SEBI Reg|Registration)", l, re.I):
            continue
        buf.append(l)
        joined = " ".join(buf)
        if ENTITY_END.search(joined) and len(joined) < 120:
            parties.append({"name": _flat(joined)})
            buf = []
        elif parties and not ENTITY_END.search(l) and len(l) < 80 and not re.search(r"\d", l) and not parties[-1].get("email"):
            cp = parties[-1].get("contact_person")
            parties[-1]["contact_person"] = f"{cp} {l}" if cp else l
            buf = []
        elif len(buf) > 4:
            buf = buf[-2:]
    return [p for p in parties if len(p["name"]) > 5][:12]


def extract(pages: list[str]) -> dict:
    text = "\n".join(pages)
    flat = _flat(text)
    out: dict = {"garbled": bool(GARBLE.search(flat[:5000]))}
    if m := re.search(r"Dated:?\s*([A-Z][a-z]+ \d{1,2},? \d{4})", flat):
        out["dated"] = m.group(1)
    if m := re.search(r"\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b", flat):
        out["cin"] = m.group(1)
    if m := re.search(r"\b(www\.[a-z0-9.-]+\.[a-z]{2,})", flat, re.I):
        out["website"] = m.group(1).lower()
    if m := re.search(r"OUR PROMOTERS?\s*(?:IS|ARE|:)?\s*:?\s*(.*?)\s*(?:DETAILS OF THE|OFFER DETAILS|THE OFFER)", flat, re.S):
        names = re.split(r",\s*|\s+AND\s+", m.group(1).strip(" .:"))
        out["promoters"] = [n.strip(" .").title() for n in names if 2 < len(n.strip()) < 80][:12]
    out.update(parse_offer(flat))
    if m := re.search(r"Regulation\s*6\s*\(\s*([12])\s*\)", flat):
        out["regulation"] = f"6({m.group(1)})"
    elif m := re.search(r"Regulation\s*229\s*\(\s*([123])\s*\)", flat):
        out["regulation"] = f"229({m.group(1)})"
    out["pre_ipo_placement"] = bool(re.search(r"Pre-IPO Placement", flat, re.I))
    out["anchor_contemplated"] = bool(re.search(r"Anchor Investor", flat, re.I))
    ex = []
    if re.search(r"Emerge|SME Platform of (?:the )?National Stock Exchange|NSE EMERGE", flat, re.I):
        ex.append("NSE_EMERGE")
    if re.search(r"BSE SME|SME Platform of BSE", flat, re.I):
        ex.append("BSE_SME")
    if not ex:
        if re.search(r"National Stock Exchange of India Limited|\bNSE\b", flat):
            ex.append("NSE")
        if re.search(r"\bBSE Limited\b|\bBSE\b", flat):
            ex.append("BSE")
    out["exchanges"] = ex
    brlm = parse_parties(text, r"(?:BOOK RUNNING LEAD MANAGERS?|LEAD MANAGERS? TO THE (?:OFFER|ISSUE)|GLOBAL CO-ORDINATORS AND BOOK RUNNING LEAD MANAGERS?)\s*\n",
                         r"\n\s*REGISTRAR TO THE")
    if brlm:
        out["brlms"] = brlm
    reg = parse_parties(text, r"REGISTRAR TO THE (?:OFFER|ISSUE)\s*\n", r"\n\s*(?:BID/|ISSUE PROGRAMME|OFFER PROGRAMME|BID / |ISSUE OPENS|ANCHOR)")
    if reg:
        out["registrar"] = reg[0]
    # pages for provenance
    out["_pages"] = {
        "offer": _page_of(pages, "DETAILS OF THE") or 1,
        "brlm": next((i for i, p in enumerate(pages, 1) if re.search(r"BOOK RUNNING LEAD MANAGER|LEAD MANAGER TO THE", p)), None),
    }
    return out
