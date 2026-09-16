"""
tally_receipt_note_parser.py

Parses the raw XML Tally returns for "Receipt Note" vouchers (inward
goods-received entries — see tally_receipt_note_client.py's docstring for
why this specific voucher type was chosen) into clean Python objects.

Deliberately mirrors tally_parser.py's parse_purchase_orders_xml() shape
and defensive conventions closely (same skip-cancelled/skip-optional/
skip-no-items rules) — reuses its generic, non-PO-specific helpers
(_sanitize_xml_text, _clean_text, _parse_quantity, _parse_rate,
_parse_amount, _format_date) by import rather than reimplementing them,
since Receipt Note quantity/rate/amount fields use the exact same
compound string formats already handled there.

No network calls here — this module only ever receives XML text already
retrieved by tally_connection.py.

Every field below is based on real Receipt Note vouchers captured live
from the Tally instance during this investigation (2026-09-16, 43 real
vouchers) — not assumed:
  - Voucher-level fields (DATE, VOUCHERNUMBER, PARTYLEDGERNAME, GUID,
    NARRATION, ISCANCELLED, ISOPTIONAL) are structurally identical to
    Purchase Order vouchers.
  - Most sampled Receipt Note vouchers (26 of 43) carried exactly ONE
    ALLINVENTORYENTRIES.LIST entry, but multi-item vouchers are real too
    (up to 6 entries observed) — this parser loops over every entry
    present on each voucher, never assumes exactly one.
  - Entry-level ISDEEMEDPOSITIVE was "Yes" on every real sampled entry —
    Tally's own convention for an inward-movement line — read and stored
    for transparency, though every row returned by this parser is
    inherently inward by construction (Receipt Note only).
  - AMOUNT is a plain signed number, same convention as Purchase Order's
    AMOUNT (negative on the purchase/inward side) — _parse_amount()
    already normalizes this to an absolute value, reused as-is.

This module NEVER sends anything to Tally — no Import/Alter request is
built or referenced anywhere in this file.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from typing import List, Optional

from tally_parser import (
    _sanitize_xml_text,
    _clean_text,
    _parse_quantity,
    _parse_rate,
    _parse_amount,
    _format_date,
)


@dataclass
class ReceiptNoteLineItem:
    voucher_number: str
    date_raw: str
    date: Optional[str]
    party_ledger: str
    guid: str
    narration: str
    is_deemed_positive: bool
    item_name: str
    quantity: Optional[float]
    unit: Optional[str]
    rate: Optional[float]
    rate_unit: Optional[str]
    amount: Optional[float]


def _text_of(element: Optional[ET.Element]) -> Optional[str]:
    return element.text if element is not None else None


def parse_receipt_notes_xml(xml_text: str) -> List[ReceiptNoteLineItem]:
    """Parses a Tally EXPORT/COLLECTION response (TYPE=Voucher, filtered
    to Receipt Note) into a flat list of ReceiptNoteLineItem records, one
    per stock item line.

    Skips (never raises for):
      - Tally's own <CMPINFO><VOUCHER>N</VOUCHER></CMPINFO> metadata
        counter, which reuses the VOUCHER tag name with no VOUCHERNUMBER
        child — the same false-positive pattern already documented for
        Purchase Orders and Stock Items in this repo. Filtered out by the
        same "no voucher number -> not a real voucher" check
        parse_purchase_orders_xml() already uses.
      - Any voucher explicitly marked cancelled or optional.
      - Any inventory entry with no STOCKITEMNAME (nothing to report).
      - A voucher with zero usable entries after the above (produces no
        rows, not an error).
    """
    root = ET.fromstring(_sanitize_xml_text(xml_text))
    line_items: List[ReceiptNoteLineItem] = []

    for voucher_el in root.iter("VOUCHER"):
        voucher_number = _clean_text(_text_of(voucher_el.find("VOUCHERNUMBER")))
        if not voucher_number:
            continue  # not a real voucher (e.g. the CMPINFO counter)

        if _clean_text(_text_of(voucher_el.find("ISCANCELLED"))).lower() == "yes":
            continue
        if _clean_text(_text_of(voucher_el.find("ISOPTIONAL"))).lower() == "yes":
            continue

        date_raw = _clean_text(_text_of(voucher_el.find("DATE")))
        party_ledger = _clean_text(_text_of(voucher_el.find("PARTYLEDGERNAME")))
        guid = _clean_text(_text_of(voucher_el.find("GUID")))
        narration = _clean_text(_text_of(voucher_el.find("NARRATION")))

        for entry_el in voucher_el.findall("ALLINVENTORYENTRIES.LIST"):
            item_name = _clean_text(_text_of(entry_el.find("STOCKITEMNAME")))
            if not item_name:
                continue

            qty_value, qty_unit = _parse_quantity(_text_of(entry_el.find("ACTUALQTY")))
            if qty_value is None:
                # Fall back to BILLEDQTY if ACTUALQTY wasn't usable — both
                # were equal on every sampled voucher during this
                # investigation, but ACTUALQTY (the physically received
                # quantity) is the more correct primary field for an
                # inward-movement record specifically.
                qty_value, qty_unit = _parse_quantity(_text_of(entry_el.find("BILLEDQTY")))

            rate_value, rate_unit = _parse_rate(_text_of(entry_el.find("RATE")))
            amount = _parse_amount(_text_of(entry_el.find("AMOUNT")))
            is_deemed_positive = _clean_text(_text_of(entry_el.find("ISDEEMEDPOSITIVE"))).lower() == "yes"

            line_items.append(ReceiptNoteLineItem(
                voucher_number=voucher_number,
                date_raw=date_raw,
                date=_format_date(date_raw),
                party_ledger=party_ledger,
                guid=guid,
                narration=narration,
                is_deemed_positive=is_deemed_positive,
                item_name=item_name,
                quantity=qty_value,
                unit=qty_unit,
                rate=rate_value,
                rate_unit=rate_unit,
                amount=amount,
            ))

    return line_items


def receipt_note_line_items_to_json_ready(line_items: List[ReceiptNoteLineItem]) -> list:
    return [asdict(li) for li in line_items]
