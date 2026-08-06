"""
test_purchase_orders.py

Standalone Phase 1 test script.

    1. Connects to Tally (reusing the existing, proven connection)
    2. Retrieves Purchase Order vouchers
    3. Parses them into clean Python objects
    4. Prints them as formatted JSON
    5. Handles connection failures gracefully (clear message, non-zero exit,
       no stack trace dumped on the expected failure paths)

Does NOT touch Apps Script. Does NOT touch Google Sheets. Does NOT modify
anything in the Inventory Management System. Read-only against Tally.

Run:
    python test_purchase_orders.py
"""

import sys

import tally_client as tc
from tally_connection import TallyConnectionError


def main() -> int:
    print("Step 1/3: connecting to Tally...")
    try:
        tc.connect()
    except TallyConnectionError as exc:
        print("FAILED to connect to Tally: " + str(exc))
        return 1
    print("  Connected.")

    print("Step 2/3: retrieving Purchase Orders...")
    try:
        xml_text = tc.get_purchase_orders()
    except TallyConnectionError as exc:
        print("FAILED to retrieve Purchase Orders: " + str(exc))
        return 1
    print("  Received " + str(len(xml_text)) + " characters of XML.")

    print("Step 3/3: parsing and formatting as JSON...")
    try:
        orders = tc.parse_purchase_orders(xml_text)
    except Exception as exc:  # noqa: BLE001 - top-level test script, report and exit
        print("FAILED to parse Purchase Order XML: " + str(exc))
        return 1

    if not orders:
        print("  No open Purchase Order vouchers were found.")
        return 0

    print("  Parsed " + str(len(orders)) + " Purchase Order(s).\n")
    print(tc.to_json(orders, pretty=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
