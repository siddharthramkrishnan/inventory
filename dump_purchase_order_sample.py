"""
dump_purchase_order_sample.py

Read-only discovery helper for the GRN -> Tally integration's exploration
phase. Does not create a new connection, does not add parsing logic, and
does not write anything back to Tally — it only calls the existing
tally_client.py / tally_parser.py functions and saves their output to
disk, so the raw XML and parsed JSON can be inspected without needing to
re-run test_purchase_orders.py and copy console output by hand.

This exists because the environment that first authored
docs/tally_purchase_order_analysis.md could not reach the live Tally
instance at all (confirmed: a TCP-level timeout, not a "connection
refused" — consistent with that being a sandboxed environment with no
real route to that LAN, not Tally being offline). Run this on a
machine that actually has network access to Tally (server address now
in config.py) to produce a genuine, complete, unmodified sample.

Usage:
    cd integration
    python dump_purchase_order_sample.py

Writes:
    ../docs/raw_purchase_order.xml       — the COMPLETE, unmodified raw
                                            XML response, exactly as
                                            received from Tally
    ../docs/parsed_purchase_order.json   — the same data run through the
                                            existing, unmodified parser

Does NOT touch Google Sheets, Apps Script, GRN/ARN/Dashboard/Inventory
Adjustment code, Slack, or any Tally write path. Read-only against Tally
(the existing EXPORT/COLLECTION request, unchanged).
"""

import os
import sys

import tally_client as tc
from tally_connection import TallyConnectionError

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs")
RAW_XML_PATH = os.path.join(OUT_DIR, "raw_purchase_order.xml")
PARSED_JSON_PATH = os.path.join(OUT_DIR, "parsed_purchase_order.json")


def main() -> int:
    print("Step 1/4: connecting to Tally...")
    try:
        tc.connect()
    except TallyConnectionError as exc:
        print("FAILED to connect to Tally: " + str(exc))
        return 1
    print("  Connected.")

    print("Step 2/4: retrieving Purchase Orders (raw XML)...")
    try:
        xml_text = tc.get_purchase_orders()
    except TallyConnectionError as exc:
        print("FAILED to retrieve Purchase Orders: " + str(exc))
        return 1
    print("  Received " + str(len(xml_text)) + " characters of raw XML.")

    print("Step 3/4: saving the complete, unmodified raw XML...")
    with open(RAW_XML_PATH, "w", encoding="utf-8") as f:
        f.write(xml_text)
    print("  Saved to " + os.path.abspath(RAW_XML_PATH))

    print("Step 4/4: parsing (existing, unmodified parser) and saving JSON...")
    try:
        orders = tc.parse_purchase_orders(xml_text)
    except Exception as exc:  # noqa: BLE001 - top-level script, report and exit
        print("FAILED to parse Purchase Order XML: " + str(exc))
        return 1
    with open(PARSED_JSON_PATH, "w", encoding="utf-8") as f:
        f.write(tc.to_json(orders, pretty=True))
    print("  Parsed " + str(len(orders)) + " Purchase Order(s).")
    print("  Saved to " + os.path.abspath(PARSED_JSON_PATH))

    print()
    print("Done. Both files reflect exactly what Tally returned and exactly")
    print("what the existing, unmodified parser produced from it — nothing")
    print("trimmed, nothing hand-edited.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
