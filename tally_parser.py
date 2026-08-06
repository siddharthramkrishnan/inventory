"""
tally_parser.py

Parses the raw XML Tally returns for Purchase Order vouchers into clean
Python objects, and converts those objects into JSON-ready structures.

No network calls here — this module only ever receives XML text that was
already retrieved by tally_connection.py.

Every parsing rule below is based on a real XML response captured directly
from the live Tally instance (see README_PHASE1.md for the exact request
used and a full sample response), not assumed. In particular:

- RATE and quantity fields are NOT plain "number unit" strings. Observed
  real examples:
    "1200.00/Nos"                  -> plain rate
    "0.14Euro = ? 0.14/UG"         -> foreign-currency rate; the segment
                                       AFTER the last "=" is the effective
                                       rate in the base currency
    " 5000 UG =  5 MG"             -> compound quantity (alternate unit
                                       conversion); the segment BEFORE the
                                       first "=" is what was actually
                                       entered on the voucher
    ""                              -> some entries have no rate at all
- AMOUNT on inventory entries comes back negative (Tally's debit/credit
  sign convention for a purchase-side entry) — this module stores the
  absolute value.
- Some string fields carry a stray leading control character (observed:
  "&#4; Any" in a nested field) — all extracted strings are cleaned of
  leading/trailing control characters and whitespace defensively.
- Each voucher carries a stable <GUID> — used as the natural idempotency
  key for any future sync logic (not used by this module, which only
  parses; carried through so later phases don't need to re-derive it).
"""

import re
import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, asdict
from typing import List, Optional


@dataclass
class POItem:
    sl_no: int
    description: str
    quantity: Optional[float]
    unit: Optional[str]
    rate: Optional[float]
    rate_unit: Optional[str]
    amount: Optional[float]


@dataclass
class PurchaseOrder:
    po_no: str
    po_date_raw: str            # as Tally returns it, e.g. "20260401"
    po_date: Optional[str]      # formatted dd-mm-yyyy, or None if unparseable
    vendor: str
    guid: str
    narration: str
    items: List[POItem] = field(default_factory=list)


_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

# Tally's raw XML export was observed to contain numeric character
# references to illegal XML control characters — specifically "&#4;"
# (201 occurrences in one real response, inside BATCHNAME fields this
# parser doesn't even read) — which xml.etree.ElementTree correctly
# rejects per the XML 1.0 spec, since control chars other than tab/CR/LF
# are not valid XML characters even when escaped as a numeric reference.
# One such reference anywhere in the document makes the WHOLE document
# unparseable, not just the field it's in, so the raw text must be
# sanitized before ET.fromstring() is called at all. This pattern was
# confirmed against a real response, not assumed — see README_PHASE1.md.
_CHARREF_RE = re.compile(r"&#(x?[0-9A-Fa-f]+);")


# XML 1.0's legal character ranges — anything outside this is stripped,
# not just the one specific value ("&#4;") that happened to be observed,
# since any other control-character reference would fail parsing the same
# way for the same reason.
def _is_legal_xml_codepoint(codepoint: int) -> bool:
    return (
        codepoint in (0x09, 0x0A, 0x0D)
        or 0x20 <= codepoint <= 0xD7FF
        or 0xE000 <= codepoint <= 0xFFFD
        or 0x10000 <= codepoint <= 0x10FFFF
    )


def _charref_sub(match) -> str:
    token = match.group(1)
    try:
        codepoint = int(token[1:], 16) if token.lower().startswith("x") else int(token, 10)
    except ValueError:
        return match.group(0)  # not a form we understand — leave it as-is
    return match.group(0) if _is_legal_xml_codepoint(codepoint) else ""


def _sanitize_xml_text(xml_text: str) -> str:
    """Strips numeric character references to illegal XML control
    characters (confirmed observed: "&#4;") so ET.fromstring() doesn't
    reject an otherwise well-formed document over a field this parser
    doesn't even read. Legal references (e.g. "&#8377;" for a currency
    symbol) are left untouched."""
    return _CHARREF_RE.sub(_charref_sub, xml_text)


def _clean_text(raw: Optional[str]) -> str:
    """Strips stray control characters (observed in real Tally responses,
    e.g. a leading 0x04) and surrounding whitespace. Never raises."""
    if raw is None:
        return ""
    return _CONTROL_CHARS_RE.sub("", raw).strip()


def _parse_quantity(raw: Optional[str]):
    """Parses a Tally quantity string into (value, unit).

    Handles the compound "entered-unit = alternate-unit" form by taking
    only the segment before the first "=" — that segment is what was
    actually entered on the voucher; the part after "=" is a converted
    display in an alternate unit of measure and is not needed here.
    Returns (None, None) if nothing recognizable is found (e.g. blank).
    """
    text = _clean_text(raw)
    if not text:
        return None, None
    primary_segment = text.split("=")[0]
    match = re.search(r"([\d.]+)\s*(\S+)?", primary_segment)
    if not match:
        return None, None
    value_str, unit = match.group(1), match.group(2)
    try:
        value = float(value_str)
    except ValueError:
        return None, unit
    return value, unit


def _parse_rate(raw: Optional[str]):
    """Parses a Tally rate string into (value, unit).

    Handles foreign-currency rates shown as "<foreign> = <base>/<unit>" by
    taking the segment after the LAST "=" — that is the effective rate in
    the company's base currency. A plain "number/unit" rate (no "=") is
    parsed the same way, since taking "the text after the last '=' " is a
    no-op when there is no "=" at all. Returns (None, None) for a blank
    rate, which does occur on some real entries.
    """
    text = _clean_text(raw)
    if not text:
        return None, None
    effective_segment = text.split("=")[-1]
    match = re.search(r"([\d.]+)\s*/\s*(\S+)\s*$", effective_segment)
    if not match:
        return None, None
    value_str, unit = match.group(1), match.group(2)
    try:
        value = float(value_str)
    except ValueError:
        return None, unit
    return value, unit


def _parse_amount(raw: Optional[str]) -> Optional[float]:
    text = _clean_text(raw)
    if not text:
        return None
    try:
        return abs(float(text))
    except ValueError:
        return None


def _format_date(yyyymmdd: str) -> Optional[str]:
    """"20260401" -> "01-04-2026". Returns None if not exactly 8 digits."""
    digits = _clean_text(yyyymmdd)
    if len(digits) != 8 or not digits.isdigit():
        return None
    year, month, day = digits[0:4], digits[4:6], digits[6:8]
    return day + "-" + month + "-" + year


def _text_of(element: Optional[ET.Element]) -> Optional[str]:
    return element.text if element is not None else None


def parse_purchase_orders_xml(xml_text: str) -> List[PurchaseOrder]:
    """Parses a Tally EXPORT/COLLECTION response for Purchase Order
    vouchers (as produced by tally_client's PO request) into a list of
    PurchaseOrder objects.

    Skips any voucher explicitly marked cancelled or optional (fields
    fetched defensively for this reason, even though none were observed
    set to "Yes" in the real data this parser was built against).
    Skips any voucher missing a voucher number or with zero parsed items,
    rather than raising, so one malformed voucher does not stop the rest
    from being returned — consistent with how the rest of this system
    already treats a single bad record as skippable, not fatal.
    """
    root = ET.fromstring(_sanitize_xml_text(xml_text))
    purchase_orders: List[PurchaseOrder] = []

    for voucher_el in root.iter("VOUCHER"):
        if _clean_text(_text_of(voucher_el.find("ISCANCELLED"))).lower() == "yes":
            continue
        if _clean_text(_text_of(voucher_el.find("ISOPTIONAL"))).lower() == "yes":
            continue

        po_no = _clean_text(_text_of(voucher_el.find("VOUCHERNUMBER")))
        if not po_no:
            continue

        po_date_raw = _clean_text(_text_of(voucher_el.find("DATE")))
        vendor = _clean_text(_text_of(voucher_el.find("PARTYLEDGERNAME")))
        guid = _clean_text(_text_of(voucher_el.find("GUID")))
        narration = _clean_text(_text_of(voucher_el.find("NARRATION")))

        items: List[POItem] = []
        for idx, entry_el in enumerate(voucher_el.findall("ALLINVENTORYENTRIES.LIST"), start=1):
            description = _clean_text(_text_of(entry_el.find("STOCKITEMNAME")))
            if not description:
                continue
            qty_value, qty_unit = _parse_quantity(_text_of(entry_el.find("BILLEDQTY")))
            if qty_value is None:
                # Fall back to ACTUALQTY if BILLEDQTY wasn't usable — both
                # were observed equal on every sampled voucher, but only
                # BILLEDQTY is guaranteed to be the ordered quantity.
                qty_value, qty_unit = _parse_quantity(_text_of(entry_el.find("ACTUALQTY")))
            rate_value, rate_unit = _parse_rate(_text_of(entry_el.find("RATE")))
            amount = _parse_amount(_text_of(entry_el.find("AMOUNT")))

            items.append(POItem(
                sl_no=idx,
                description=description,
                quantity=qty_value,
                unit=qty_unit,
                rate=rate_value,
                rate_unit=rate_unit,
                amount=amount,
            ))

        if not items:
            continue

        purchase_orders.append(PurchaseOrder(
            po_no=po_no,
            po_date_raw=po_date_raw,
            po_date=_format_date(po_date_raw),
            vendor=vendor,
            guid=guid,
            narration=narration,
            items=items,
        ))

    return purchase_orders


def purchase_orders_to_json_ready(purchase_orders: List[PurchaseOrder]) -> list:
    """Converts a list of PurchaseOrder dataclasses into plain
    dict/list/str/number structures ready for json.dumps — no dataclass
    instances, no XML Elements, nothing json.dumps can't handle natively.
    """
    return [asdict(po) for po in purchase_orders]


def to_json_string(purchase_orders: List[PurchaseOrder], pretty: bool = True) -> str:
    ready = purchase_orders_to_json_ready(purchase_orders)
    if pretty:
        return json.dumps(ready, indent=2, ensure_ascii=False)
    return json.dumps(ready, ensure_ascii=False)
