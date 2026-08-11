"""
tally_inventory_parser.py

Parses the raw XML Tally returns for Stock Item (Inventory Master)
records into clean Python objects, and converts those objects into
JSON-ready structures.

Completely separate from tally_parser.py (Purchase Order parsing) — no
function or dataclass in that file is imported, modified, or duplicated
here, except the small set of GENERIC, non-PO-specific string/number
helpers (_sanitize_xml_text, _clean_text, _parse_quantity, _parse_rate),
reused by import since they already correctly handle the exact same
compound "value unit" / "value/unit" string formats Stock Item balances
and rates use, and duplicating that logic would just be a second copy of
the same bug surface.

No network calls here — this module only ever receives XML text already
retrieved by tally_connection.py (the same transport layer the Purchase
Order integration uses — that module is generic, not PO-specific, so
reusing it is not "reusing the Purchase Order request").

Every field below is based on a real XML response captured directly
from the live Tally instance during development of this module (2,605
real Stock Item records, one company) — not assumed. Specifically:

- NAME is an XML ATTRIBUTE on <STOCKITEM NAME="..." RESERVEDNAME="...">,
  not a child element — unlike Purchase Order vouchers, where
  VOUCHERNUMBER is a child element. This is a genuine structural
  difference between voucher and master XML, confirmed by direct
  inspection, not assumed to be the same shape.
- OPENINGBALANCE/CLOSINGBALANCE are compound "<value> <unit>" strings
  (e.g. " 4320.00 Nos"), and OPENINGRATE/CLOSINGRATE are compound
  "<value>/<unit>" strings (e.g. "19.83/Nos") — the same shapes
  tally_parser.py's _parse_quantity()/_parse_rate() already handle for
  Purchase Orders, reused here rather than reimplemented.
- Several fields carry the same stray leading control character
  observed in Purchase Order data (e.g. "&#4; Not Applicable",
  "&#4; Applicable") when a value is effectively a Tally default
  placeholder rather than a real user-entered value — the same
  sanitization (_sanitize_xml_text) and text-cleaning (_clean_text)
  already used for Purchase Orders is reused here for the same reason.
- A requested field, HSNCODE (no "GST" prefix), was tested and
  confirmed to NOT exist anywhere in this Tally instance's Stock Item
  response — only GSTHSNCODE is real. HSNCODE is deliberately not
  included in FETCH or parsed here, to avoid presenting a field that
  doesn't exist as if it were part of the schema.
- No Godown, Batch, Manufacturer, Brand, Reserved Quantity, Available
  Quantity, Creation Date, or Last Modified Date field exists anywhere
  in the real captured response — see docs/inventory_stock_analysis.md
  for the full field-by-field confirmation. None of these are
  hallucinated into this parser.
"""

import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from typing import List, Optional

from tally_parser import _sanitize_xml_text, _clean_text, _parse_quantity, _parse_rate


@dataclass
class StockItem:
    name: str
    reserved_name: Optional[str]
    guid: Optional[str]
    parent: Optional[str]
    category: Optional[str]
    gst_applicable: Optional[str]
    gst_hsn_code: Optional[str]
    costing_method: Optional[str]
    base_unit: Optional[str]
    additional_unit: Optional[str]
    master_id: Optional[str]
    alter_id: Optional[str]
    description: Optional[str]
    opening_balance: Optional[float]
    opening_balance_unit: Optional[str]
    opening_value: Optional[float]
    opening_rate: Optional[float]
    opening_rate_unit: Optional[str]
    closing_balance: Optional[float]
    closing_balance_unit: Optional[str]
    closing_value: Optional[float]
    closing_rate: Optional[float]
    closing_rate_unit: Optional[str]


def _text_of(element: Optional[ET.Element]) -> Optional[str]:
    return element.text if element is not None else None


def _parse_plain_amount(raw: Optional[str]) -> Optional[float]:
    """OPENINGVALUE/CLOSINGVALUE are plain signed numbers (unlike Purchase
    Order AMOUNT, which tally_parser.py's _parse_amount() always makes
    absolute) — confirmed real values include negatives (e.g.
    "-35250.00"), and the sign is kept as-is here rather than discarded,
    since nothing in the real data suggests it's a purchase-side sign
    convention the way voucher AMOUNT is."""
    text = _clean_text(raw)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_stock_items_xml(xml_text: str) -> List[StockItem]:
    """Parses a Tally EXPORT/COLLECTION response (TYPE=StockItem) into a
    list of StockItem objects. Skips any record with no NAME attribute
    (never observed in real data, but defensive, consistent with how
    tally_parser.py treats a missing identifying field for Purchase
    Orders) — otherwise does not skip records by any status, since Stock
    Item masters have no cancelled/optional concept the way vouchers do.
    """
    root = ET.fromstring(_sanitize_xml_text(xml_text))
    items: List[StockItem] = []

    for el in root.iter("STOCKITEM"):
        name = _clean_text(el.get("NAME"))
        if not name:
            continue
        reserved_name = _clean_text(el.get("RESERVEDNAME")) or None

        opening_bal_value, opening_bal_unit = _parse_quantity(_text_of(el.find("OPENINGBALANCE")))
        closing_bal_value, closing_bal_unit = _parse_quantity(_text_of(el.find("CLOSINGBALANCE")))
        opening_rate_value, opening_rate_unit = _parse_rate(_text_of(el.find("OPENINGRATE")))
        closing_rate_value, closing_rate_unit = _parse_rate(_text_of(el.find("CLOSINGRATE")))

        items.append(StockItem(
            name=name,
            reserved_name=reserved_name,
            guid=_clean_text(_text_of(el.find("GUID"))) or None,
            parent=_clean_text(_text_of(el.find("PARENT"))) or None,
            category=_clean_text(_text_of(el.find("CATEGORY"))) or None,
            gst_applicable=_clean_text(_text_of(el.find("GSTAPPLICABLE"))) or None,
            gst_hsn_code=_clean_text(_text_of(el.find("GSTHSNCODE"))) or None,
            costing_method=_clean_text(_text_of(el.find("COSTINGMETHOD"))) or None,
            base_unit=_clean_text(_text_of(el.find("BASEUNITS"))) or None,
            additional_unit=_clean_text(_text_of(el.find("ADDITIONALUNITS"))) or None,
            master_id=_clean_text(_text_of(el.find("MASTERID"))) or None,
            alter_id=_clean_text(_text_of(el.find("ALTERID"))) or None,
            description=_clean_text(_text_of(el.find("DESCRIPTION"))) or None,
            opening_balance=opening_bal_value,
            opening_balance_unit=opening_bal_unit,
            opening_value=_parse_plain_amount(_text_of(el.find("OPENINGVALUE"))),
            opening_rate=opening_rate_value,
            opening_rate_unit=opening_rate_unit,
            closing_balance=closing_bal_value,
            closing_balance_unit=closing_bal_unit,
            closing_value=_parse_plain_amount(_text_of(el.find("CLOSINGVALUE"))),
            closing_rate=closing_rate_value,
            closing_rate_unit=closing_rate_unit,
        ))

    return items


def stock_items_to_json_ready(items: List[StockItem]) -> list:
    return [asdict(i) for i in items]


def to_json_string(items: List[StockItem], pretty: bool = True) -> str:
    ready = stock_items_to_json_ready(items)
    if pretty:
        return json.dumps(ready, indent=2, ensure_ascii=False)
    return json.dumps(ready, ensure_ascii=False)
