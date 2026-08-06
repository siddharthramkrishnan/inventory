"""
run_sync.py

The missing executable entry point for the integration package. Every
piece this script needs already exists and is used exactly as-is —
nothing in tally_client.py, po_translator.py, or po_sync.py was changed
to build this; this file only orchestrates the four steps those modules
already implement individually:

    tally_client.connect()
    tally_client.get_purchase_orders() -> tally_client.parse_purchase_orders()
    po_translator.translate_purchase_orders()
    po_sync.sync_purchase_orders()

No new architecture. This is the caller that was missing — before this
file existed, po_sync.sync_purchase_order()/sync_purchase_orders() had no
caller anywhere in the repository.

Usage:
    python run_sync.py

Requires INVENTORY_TALLY_SYNC_SECRET to be set in the environment (see
po_sync.py's module docstring and PO_IMPORT_ARCHITECTURE.md §8). If it
isn't set, every PO is reported as failed — po_sync.py refuses to make any
request without it, it does not silently skip the check.

Exit code: 0 if every retrieved PO synced successfully (or there were no
open Purchase Orders to sync), 1 otherwise — either because at least one
PO failed to sync, or because Tally itself could not be reached at all.
"""

import logging
import sys

import tally_client as tc
from tally_connection import TallyConnectionError
import po_translator as pt
import po_sync as ps

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def main() -> int:
    print("Step 1/4: connecting to Tally...")
    try:
        tc.connect()
    except TallyConnectionError as exc:
        print("FAILED to connect to Tally: " + str(exc))
        return 1
    print("  Connected.")

    print("Step 2/4: retrieving open Purchase Orders...")
    try:
        xml_text = tc.get_purchase_orders()
        orders = tc.parse_purchase_orders(xml_text)
    except TallyConnectionError as exc:
        print("FAILED to retrieve Purchase Orders: " + str(exc))
        return 1
    print("  Retrieved " + str(len(orders)) + " Purchase Order(s).")

    if not orders:
        print("Nothing to sync — no open Purchase Orders were found.")
        return 0

    print("Step 3/4: translating...")
    translated = pt.translate_purchase_orders(orders)
    print("  Translated " + str(len(translated)) + " of " + str(len(orders)) + " Purchase Order(s).")
    if len(translated) < len(orders):
        print("  NOTE: " + str(len(orders) - len(translated)) + " PO(s) failed to translate and were skipped — see the log above.")

    print("Step 4/4: syncing to Apps Script...")
    result = ps.sync_purchase_orders(translated)
    synced = result.get("synced", [])
    failed = result.get("failed", [])

    print()
    print("=== Sync summary ===")
    print("Synced (" + str(len(synced)) + "):")
    for po_no in synced:
        print("  OK     " + po_no)
    print("Failed (" + str(len(failed)) + "):")
    for po_no in failed:
        print("  FAILED " + po_no)
    print()

    if failed:
        print(str(len(failed)) + " of " + str(len(translated)) + " Purchase Order(s) failed to sync.")
        return 1

    print("All " + str(len(synced)) + " Purchase Order(s) synced successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
