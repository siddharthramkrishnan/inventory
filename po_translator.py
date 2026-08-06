"""
po_translator.py

Phase 2: translates a parsed Tally PurchaseOrder (tally_parser.PurchaseOrder)
into the exact object shape backend/Code.gs's parsePOSheetValues() already
produces — {poNo, poDate, vendor, items: [{slNo, description, quantity,
rate, unit, amount}]} — so that Apps Script's existing decoration logic in
getActivePOs() (orderedQty/receivedQty/remainingQty/overridden) can run
completely unchanged, regardless of whether a PO came from an Excel file or
from Tally.

Per the approved compatibility analysis and Phase 2 instructions:
  - guid, narration, and the raw (pre-formatted) po_date are preserved as
    extra fields even though grn-entry.html never reads them — carried
    through for future use (e.g. Phase 3's idempotent-upsert key) and for
    auditability in the "Open POs (Tally)" sheet.
  - the quantity's unit (POItem.unit) is used as the single canonical
    "unit" field, matching the current system's existing behavior (it has
    only ever had one unit field per item). The rate's unit (POItem.rate_unit)
    is preserved separately as metadata, never used as the canonical unit.
  - if the two units differ, that is logged as a warning and the import
    proceeds anyway — a display-accuracy concern for a human to review
    later, not a reason to drop or fail the PO.

No network calls here — this module only transforms already-parsed Python
objects (from tally_parser.py) into a dict ready to be sent onward (by
po_sync.py) or inspected directly.
"""

import logging
from typing import List

from tally_parser import PurchaseOrder

logger = logging.getLogger(__name__)


def translate_purchase_order(po: PurchaseOrder) -> dict:
    """Translates one PurchaseOrder into the parsePOSheetValues()-compatible
    shape, with guid/narration/poDateRaw/rateUnit preserved as metadata."""
    items = []
    for item in po.items:
        canonical_unit = item.unit  # quantity's unit is canonical, per design decision

        if item.unit and item.rate_unit and item.unit != item.rate_unit:
            logger.warning(
                "Unit mismatch on PO %s, item %r: quantity unit=%r but rate unit=%r "
                "— using the quantity unit (%r) as canonical; rate unit preserved "
                "as metadata only. Not failing the import.",
                po.po_no, item.description, item.unit, item.rate_unit, canonical_unit,
            )

        items.append({
            "slNo": item.sl_no,
            "description": item.description,
            "quantity": item.quantity,
            "unit": canonical_unit,
            "rate": item.rate,
            "amount": item.amount,
            # Metadata — not part of the current-system contract, preserved
            # for auditability / future use even though grn-entry.html
            # never reads it.
            "rateUnit": item.rate_unit,
        })

    return {
        "poNo": po.po_no,
        "poDate": po.po_date,
        "vendor": po.vendor,
        "items": items,
        # PO-level metadata — same rationale as item-level rateUnit above.
        "guid": po.guid,
        "narration": po.narration,
        "poDateRaw": po.po_date_raw,
    }


def translate_purchase_orders(purchase_orders: List[PurchaseOrder]) -> list:
    """Translates a list of PurchaseOrder objects. One bad PO does not stop
    the rest — consistent with how the rest of this system already treats
    a single bad record as skippable rather than fatal (e.g. getActivePOs()
    skipping an unparseable PO file, tally_parser skipping an unparseable
    voucher)."""
    translated = []
    for po in purchase_orders:
        try:
            translated.append(translate_purchase_order(po))
        except Exception:
            logger.exception("Failed to translate PO %s — skipping it, continuing with the rest.", po.po_no)
    return translated
