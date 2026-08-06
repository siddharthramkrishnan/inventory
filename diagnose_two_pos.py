"""
diagnose_two_pos.py — TEMPORARY DIAGNOSTIC SCRIPT, PO_SYNC investigation only.

Not part of the pipeline architecture. Syncs exactly two named Purchase
Orders (one known-success, one known-failure) instead of all open POs, so
the HTTP diagnostics already added to po_sync.py's sync_purchase_order()
can be captured for a direct side-by-side comparison without re-running
the full 29-PO batch.

Reuses tally_client.py, po_translator.py, and po_sync.py exactly as they
are — this script only retrieves, filters, and calls sync_purchase_order()
per PO. No business logic, retry behavior, or parsing logic is touched or
duplicated here; all HTTP diagnostic output comes from po_sync.py itself.

Requires INVENTORY_TALLY_SYNC_SECRET to be set in the environment (same
requirement as run_sync.py) — sync_purchase_order() refuses to make any
request without it.

Usage:
    python diagnose_two_pos.py
"""

import sys

import tally_client as tc
from tally_connection import TallyConnectionError
import po_translator as pt
import po_sync as ps

TARGET_PO_NOS = {"ACHIRA/26-27/52", "ACHIRA/26-27/46"}


def main() -> int:
    print("Connecting to Tally...")
    try:
        tc.connect()
    except TallyConnectionError as exc:
        print("FAILED to connect to Tally: " + str(exc))
        return 1

    print("Retrieving open Purchase Orders...")
    try:
        xml_text = tc.get_purchase_orders()
        orders = tc.parse_purchase_orders(xml_text)
    except TallyConnectionError as exc:
        print("FAILED to retrieve Purchase Orders: " + str(exc))
        return 1
    print("Retrieved " + str(len(orders)) + " Purchase Order(s) total.")

    filtered = [po for po in orders if po.po_no in TARGET_PO_NOS]
    found_nos = {po.po_no for po in filtered}
    missing = TARGET_PO_NOS - found_nos
    if missing:
        print("WARNING — not found among retrieved POs: " + str(sorted(missing)))
    print("Filtered to " + str(len(filtered)) + " target PO(s): " + str(sorted(found_nos)))

    translated = pt.translate_purchase_orders(filtered)
    print("Translated " + str(len(translated)) + " of " + str(len(filtered)) + " target PO(s).")

    print()
    print("=== Syncing target POs one at a time ===")
    for po in translated:
        po_no = po["poNo"]
        print()
        print("### " + po_no + " ###")
        try:
            result = ps.sync_purchase_order(po)
            print("sync_purchase_order() returned normally (response.json() succeeded, status == 'success').")
            print("Parsed JSON: " + str(result))
        except ps.PoSyncError as exc:
            print("sync_purchase_order() raised PoSyncError:")
            print(str(exc))
            print("(See the HTTP diagnostic block printed above for this PO for the raw")
            print(" HTTP status / headers / response body that led to this error. If the")
            print(" error message above is a 'Non-JSON response...' message, response.json()")
            print(" FAILED; otherwise response.json() succeeded but returned a non-'success' status.)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
