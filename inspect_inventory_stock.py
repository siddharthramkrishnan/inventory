"""
inspect_inventory_stock.py

Read-only local inspection tool for retrieving Stock Item (Inventory
Master) data from Tally. Completely separate from
inspect_purchase_order.py / inspect_all_purchase_orders.py — reuses
tally_inventory_client.py (its own dedicated request/parser), not
tally_client.py.

Connects to Tally, retrieves and parses every Stock Item master record,
and saves both the complete raw XML and the parsed JSON to docs/,
printing progress as it goes.

No try/except, same convention as the Purchase Order inspection
scripts — a failure propagates with its real exception type, message,
and traceback rather than being caught and summarized.

Usage:
    cd integration
    python inspect_inventory_stock.py
"""

import os

import tally_inventory_client as tic

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs")
RAW_XML_PATH = os.path.join(OUT_DIR, "raw_inventory_stock.xml")
PARSED_JSON_PATH = os.path.join(OUT_DIR, "inventory_stock.json")

print("Connecting...")
tic.connect()
print("Connected.")

print("Fetching Stock Items...")
xml_text = tic.get_stock_items()
items = tic.parse_stock_items(xml_text)
print("Stock Items found: " + str(len(items)))

print("Saving XML...")
with open(RAW_XML_PATH, "w", encoding="utf-8") as f:
    f.write(xml_text)

print("Saving JSON...")
with open(PARSED_JSON_PATH, "w", encoding="utf-8") as f:
    f.write(tic.to_json(items, pretty=True))

print("Done.")
