"""
tally_receipt_note_client.py

Public interface for retrieving "Receipt Note" vouchers from TallyPrime —
the ONLY voucher type confirmed, by live bounded investigation, to be a
clean, safe, simple source of inward stock movement at Achira Labs.

Completely separate from tally_client.py (Purchase Order) and
tally_inventory_client.py (Stock Item master) — a different TDL
COLLECTION (TYPE=Voucher, filtered to $VoucherTypeName = "Receipt Note"),
a different parser (tally_receipt_note_parser.py). Reuses only the
generic transport layer (tally_connection.py) and, inside the parser,
the same generic string/number helpers tally_parser.py already exposes.

Why Receipt Note, and not Purchase/Sales/Stock Journal (per the live
2026-09-16 investigation, evidence in docs/tally_receipt_note_investigation.md):
  - Sales: 0 of 10 vouchers (whole fiscal year to date) carry ANY
    inventory entries — pure accounting/service use at this company, no
    stock impact. Not usable for outward movement.
  - Stock Journal: real inward+outward stock movement exists here, but as
    a complex bidirectional "Consumption Voucher" (separate
    INVENTORYENTRIESIN.LIST / INVENTORYENTRIESOUT.LIST, sometimes both in
    the same voucher) with one real voucher carrying 632 line items and
    the whole 34-voucher sample totaling 7.8MB — deliberately NOT used
    here; too large/complex to be safe for this phase.
  - Purchase: only 42 of 124 vouchers carry inventory entries at all
    (the rest are accounting-only invoice postings); using it alongside
    Receipt Note risks double-counting the same physical receipt (many
    Purchase narrations explicitly reference "against PO ..." for goods
    already recorded via a Receipt Note). Deliberately NOT used here.
  - Receipt Note: 43 of 43 vouchers (100%) carry exactly the fields
    needed (88 stock-item line entries total; most vouchers have one item,
    some have several), ISDEEMEDPOSITIVE = "Yes" (Tally's own
    inward-movement convention) on every real entry. The single clean,
    safe, evidence-confirmed inward source.

This module does not talk to Apps Script, does not talk to Google
Sheets, and NEVER sends an Import/Alter request to Tally — every
function here issues TALLYREQUEST=EXPORT only. Read-only, always.

Date-bounding note: a live bounded test on 2026-09-16 confirmed that
<SVFROMDATE>/<SVTODATE> alone do NOT restrict a <TYPE>Voucher</TYPE>
COLLECTION with no matching date FILTER — a request scoped to a 30-day
window returned vouchers spanning the whole fiscal year to date (April
through September) regardless. Rather than trust an unverified custom
TDL date-FILTER formula against the live production instance, this
module fetches all Receipt Note vouchers for the type (already proven
small — 43 records for 5.5 months) and leaves date-window trimming to
the caller (see tally_receipt_note_sync.py's RECENT_WINDOW_DAYS), which
filters client-side on each voucher's own real DATE field. The
$VoucherTypeName filter itself IS proven reliable (four different type
filters in this same investigation each returned distinctly different,
type-appropriate counts).

Usage:
    import tally_receipt_note_client as trnc

    trnc.connect()                              # raises TallyConnectionError on failure
    xml_text = trnc.get_receipt_notes()          # raw XML from Tally
    lines = trnc.parse_receipt_notes(xml_text)   # list[ReceiptNoteLineItem]
"""

from typing import List

import tally_connection
import tally_receipt_note_parser
from tally_connection import TallyConnectionError  # re-exported for callers
from tally_receipt_note_parser import ReceiptNoteLineItem

# Same FETCH field list already proven to work for Purchase Order
# vouchers (tally_client.py) and confirmed present on real Receipt Note
# vouchers during this investigation — no field here is guessed.
_RECEIPT_NOTE_REQUEST = """
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>Receipt Note Collection</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Receipt Note Collection" ISMODIFY="No">
      <TYPE>Voucher</TYPE>
      <FILTER>ReceiptNoteTypeFilter</FILTER>
      <FETCH>DATE, VOUCHERNUMBER, VOUCHERTYPENAME, PARTYLEDGERNAME, GUID, NARRATION, ISCANCELLED, ISOPTIONAL, ALLINVENTORYENTRIES.LIST</FETCH>
     </COLLECTION>
     <SYSTEM TYPE="Formulae" NAME="ReceiptNoteTypeFilter">$VoucherTypeName = "Receipt Note"</SYSTEM>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
"""


def connect() -> bool:
    """Verifies Tally is reachable, reusing the same connectivity check
    every other integration module in this repo relies on."""
    return tally_connection.check_connection()


def get_receipt_notes() -> str:
    """Retrieves every Receipt Note voucher currently in Tally's active
    company and returns the raw XML response text, unparsed. Scoped
    ENTIRELY by the $VoucherTypeName filter (proven reliable) — never by
    an unverified date FILTER. Confirmed small (43 vouchers / ~270KB) as
    of the 2026-09-16 investigation; safe as a single bounded request."""
    return tally_connection.send_request(_RECEIPT_NOTE_REQUEST, timeout=30)


def parse_receipt_notes(xml_text: str) -> List[ReceiptNoteLineItem]:
    """Parses raw Tally XML (as returned by get_receipt_notes()) into a
    flat list of ReceiptNoteLineItem records, one per stock item line
    across every non-cancelled, non-optional Receipt Note voucher."""
    return tally_receipt_note_parser.parse_receipt_notes_xml(xml_text)
