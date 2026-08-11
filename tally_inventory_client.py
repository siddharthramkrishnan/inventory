"""
tally_inventory_client.py

Public interface for retrieving Stock Item (Inventory Master) data from
TallyPrime. Completely separate from tally_client.py (Purchase Orders):
a different XML request, a different TDL COLLECTION (TYPE=StockItem
instead of TYPE=Voucher), and a different parser
(tally_inventory_parser.py). Nothing in tally_client.py or
tally_parser.py is imported, modified, or duplicated here, except the
shared, generic transport layer (tally_connection.py — not PO-specific)
and a handful of generic string/number parsing helpers reused from
tally_parser.py (see tally_inventory_parser.py's own docstring for
which ones and why).

This module does not talk to Apps Script, does not talk to Google
Sheets, and does not write anything back to Tally. It only reads.

The exact FETCH field list below was arrived at empirically: an initial
broader candidate list (including HSNCODE without the "GST" prefix) was
tested live against this Tally instance; HSNCODE returned zero results
across all 2,605 real Stock Items and was removed rather than left in
as if it were confirmed to exist. Every field kept below was verified
present in the real response — see docs/inventory_stock_analysis.md.

Usage:
    import tally_inventory_client as tic

    tic.connect()                                  # raises TallyConnectionError on failure
    xml_text = tic.get_stock_items()                # raw XML from Tally
    items = tic.parse_stock_items(xml_text)          # list[StockItem]
    print(tic.to_json(items))                        # pretty JSON string
"""

from typing import List

import tally_connection
import tally_inventory_parser
from tally_connection import TallyConnectionError  # re-exported for callers
from tally_inventory_parser import StockItem

_STOCK_ITEM_REQUEST = """
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>Stock Item Master Collection</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Stock Item Master Collection" ISMODIFY="No">
      <TYPE>StockItem</TYPE>
      <FETCH>NAME, PARENT, CATEGORY, BASEUNITS, ADDITIONALUNITS, OPENINGBALANCE, OPENINGVALUE, OPENINGRATE, CLOSINGBALANCE, CLOSINGVALUE, CLOSINGRATE, GSTAPPLICABLE, GSTHSNCODE, DESCRIPTION, GUID, MASTERID, ALTERID, COSTINGMETHOD</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
"""


def connect() -> bool:
    """Verifies Tally is reachable, reusing the same connection check the
    Purchase Order integration already relies on (tally_connection.py is
    generic transport, not PO-specific). Raises TallyConnectionError on
    failure; returns True on success."""
    return tally_connection.check_connection()


def get_stock_items() -> str:
    """Retrieves every Stock Item master record from Tally's currently
    active company and returns the raw XML response text, unparsed. No
    filter beyond TYPE=StockItem — masters have no cancelled/optional/
    date-scoped concept the way vouchers do, so there is nothing
    equivalent to filter by."""
    return tally_connection.send_request(_STOCK_ITEM_REQUEST, timeout=30)


def parse_stock_items(xml_text: str) -> List[StockItem]:
    """Parses raw Tally XML (as returned by get_stock_items()) into a
    list of StockItem objects."""
    return tally_inventory_parser.parse_stock_items_xml(xml_text)


def to_json(items: List[StockItem], pretty: bool = True) -> str:
    """Converts a list of StockItem objects into a JSON string."""
    return tally_inventory_parser.to_json_string(items, pretty=pretty)


def fetch_stock_items_as_json(pretty: bool = True) -> str:
    """Convenience wrapper chaining get_stock_items() ->
    parse_stock_items() -> to_json() in one call."""
    xml_text = get_stock_items()
    items = parse_stock_items(xml_text)
    return to_json(items, pretty=pretty)
