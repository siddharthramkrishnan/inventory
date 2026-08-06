"""
tally_client.py

Public interface for Phase 1: retrieve Purchase Orders from TallyPrime and
return them as clean Python objects / JSON.

This module does not talk to Apps Script, does not talk to Google Sheets,
and does not write anything back to Tally. It only reads.

Usage:
    import tally_client as tc

    tc.connect()                              # raises TallyConnectionError on failure
    xml_text = tc.get_purchase_orders()        # raw XML from Tally
    orders = tc.parse_purchase_orders(xml_text)  # list[PurchaseOrder]
    print(tc.to_json(orders))                  # pretty JSON string

    # or, in one call:
    print(tc.to_json(tc.parse_purchase_orders(tc.get_purchase_orders())))
"""

from typing import List

import tally_connection
import tally_parser
from tally_connection import TallyConnectionError  # re-exported for callers
from tally_parser import PurchaseOrder

# The Purchase Order voucher request. Built and verified directly against
# the live Tally instance during development of this module (see
# README_PHASE1.md for the captured sample response this was validated
# against) — not written from assumption.
#
# FETCH deliberately lists only what tally_parser.py actually reads.
# ALLINVENTORYENTRIES.LIST is fetched as a bare list field, which Tally
# returns along with its own nested default sub-lists (BATCHALLOCATIONS.LIST,
# ACCOUNTINGALLOCATIONS.LIST) — those are present in the raw response but
# intentionally not read by the parser; excluding them from the request
# would require more complex TDL than this simple, proven pattern needs.
_PURCHASE_ORDER_REQUEST = """
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>Purchase Order Collection</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Purchase Order Collection" ISMODIFY="No">
      <TYPE>Voucher</TYPE>
      <FILTER>PurchaseOrderTypeFilter</FILTER>
      <FETCH>DATE, VOUCHERNUMBER, VOUCHERTYPENAME, PARTYLEDGERNAME, GUID, NARRATION, ISCANCELLED, ISOPTIONAL, ALLINVENTORYENTRIES.LIST</FETCH>
     </COLLECTION>
     <SYSTEM TYPE="Formulae" NAME="PurchaseOrderTypeFilter">$VoucherTypeName = "Purchase Order"</SYSTEM>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
"""


def connect() -> bool:
    """Verifies Tally is reachable, using the same connection this
    repository's test_tally.py already proved works. Raises
    TallyConnectionError if Tally cannot be reached; returns True on
    success.
    """
    return tally_connection.check_connection()


def get_purchase_orders() -> str:
    """Retrieves all non-cancelled, non-optional Purchase Order vouchers
    from Tally's currently active company and returns the raw XML response
    text. Does not parse it — see parse_purchase_orders().
    """
    return tally_connection.send_request(_PURCHASE_ORDER_REQUEST)


def parse_purchase_orders(xml_text: str) -> List[PurchaseOrder]:
    """Parses raw Tally XML (as returned by get_purchase_orders()) into a
    list of PurchaseOrder objects."""
    return tally_parser.parse_purchase_orders_xml(xml_text)


def to_json(purchase_orders: List[PurchaseOrder], pretty: bool = True) -> str:
    """Converts a list of PurchaseOrder objects into a JSON string."""
    return tally_parser.to_json_string(purchase_orders, pretty=pretty)


def fetch_purchase_orders_as_json(pretty: bool = True) -> str:
    """Convenience wrapper chaining get_purchase_orders() -> parse_purchase_orders()
    -> to_json() in one call, for simple callers (e.g. the test script)."""
    xml_text = get_purchase_orders()
    orders = parse_purchase_orders(xml_text)
    return to_json(orders, pretty=pretty)
