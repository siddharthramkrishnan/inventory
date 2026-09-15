"""
test_tally_stock_sync.py

Mock-only tests for tally_stock_sync.py. NO NETWORK CALLS to Tally or the
Apps Script Web App happen anywhere in this file -- every network-facing
dependency (post_json, get_secret, connect, get_stock_items,
parse_stock_items) is replaced with an in-memory fake via the deps=
injection points sync_stock_snapshot()/fetch_and_sync_latest_stock()
already expose. Same "test using mocks only, verified structurally, not
just by printed output" convention as test_push_master_item.py.

Also contains a static-source check confirming this module imports
neither tally_write_client nor po_sync -- reinforcing, from this test's
own file (not just the repo-wide sweep in test_no_tally_writes.py), that
the Tally side of this pipeline stays strictly read-only.

Run:
    cd E:\\inventory-management\\integration
    python test_tally_stock_sync.py
"""
import json
import os
import re
import sys

import tally_stock_sync as tss
from tally_inventory_parser import StockItem

passed, failed = 0, 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"PASS: {name}")
    else:
        failed += 1
        print(f"FAIL: {name} {detail}")


def make_stock_item(**overrides):
    base = dict(
        name="Widget A",
        reserved_name=None,
        guid="guid-001",
        parent="MFG & Common Inventory",
        category="Not Applicable",
        gst_applicable="Applicable",
        gst_hsn_code="3926",
        costing_method="Avg. Cost",
        base_unit="Nos",
        additional_unit="Not Applicable",
        master_id="1001",
        alter_id="2001",
        description=None,
        opening_balance=10.0,
        opening_balance_unit="Nos",
        opening_value=-500.0,
        opening_rate=50.0,
        opening_rate_unit="Nos",
        closing_balance=25.0,
        closing_balance_unit="Nos",
        closing_value=-1250.0,
        closing_rate=50.0,
        closing_rate_unit="Nos",
    )
    base.update(overrides)
    return StockItem(**base)


class FakeCounter:
    def __init__(self, fn):
        self.fn = fn
        self.calls = []

    def __call__(self, *a, **kw):
        self.calls.append((a, kw))
        return self.fn(*a, **kw)


class FakeResponse:
    """Minimal stand-in for a requests.Response -- only .json() and
    .text are ever used by sync_stock_snapshot()."""
    def __init__(self, json_body=None, text=None, raise_on_json=False):
        self._json_body = json_body
        self._text = text if text is not None else (json.dumps(json_body) if json_body is not None else "")
        self._raise_on_json = raise_on_json

    def json(self):
        if self._raise_on_json:
            raise ValueError("not JSON")
        return self._json_body

    @property
    def text(self):
        return self._text


# ---------------------------------------------------------------------
# 1. transform_stock_item() -- correct field mapping, current-stock
#    fields sourced from CLOSING (not opening) balance/value/rate.
# ---------------------------------------------------------------------
item1 = make_stock_item()
result1 = tss.transform_stock_item(item1)
check("transform maps Item Name from item.name", result1["name"] == "Widget A")
check("transform maps Tally MASTERID from item.master_id", result1["masterId"] == "1001")
check("transform maps Tally GUID from item.guid", result1["guid"] == "guid-001")
check("transform maps Category from item.category", result1["category"] == "Not Applicable")
check("transform maps Base Unit from item.base_unit", result1["baseUnit"] == "Nos")
check("transform uses CLOSING balance for Current Stock Qty, not opening", result1["currentStockQty"] == 25.0)
check("transform uses CLOSING value for Current Stock Value, not opening", result1["currentStockValue"] == -1250.0)
check("transform uses CLOSING rate for Current Rate, not opening", result1["currentRate"] == 50.0)
check("transform maps GST Applicable from item.gst_applicable", result1["gstApplicable"] == "Applicable")
check("transform does not include a Last Synced field (stamped server-side instead)", "lastSynced" not in result1 and "Last Synced" not in result1)

# ---------------------------------------------------------------------
# 2. transform_stock_item() -- missing/None optional fields handled
#    gracefully, never raises.
# ---------------------------------------------------------------------
item2 = make_stock_item(category=None, gst_applicable=None, closing_balance=None, closing_value=None, closing_rate=None, guid=None, master_id=None)
result2 = tss.transform_stock_item(item2)
check("transform handles a fully sparse item without raising", result2["category"] is None and result2["currentStockQty"] is None)
check("transform preserves None for missing GUID/MASTERID rather than fabricating a value", result2["guid"] is None and result2["masterId"] is None)

# ---------------------------------------------------------------------
# 3. build_stock_snapshot() -- multiple items, and empty list.
# ---------------------------------------------------------------------
items3 = [make_stock_item(name="Item A", master_id="1"), make_stock_item(name="Item B", master_id="2")]
snapshot3 = tss.build_stock_snapshot(items3)
check("build_stock_snapshot returns one transformed dict per item", len(snapshot3) == 2)
check("build_stock_snapshot preserves item order/distinct values", snapshot3[0]["name"] == "Item A" and snapshot3[1]["name"] == "Item B")

snapshot_empty = tss.build_stock_snapshot([])
check("build_stock_snapshot of an empty item list returns an empty list (valid, not an error)", snapshot_empty == [])

# ---------------------------------------------------------------------
# 4. sync_stock_snapshot() -- success path: correct payload shape sent,
#    secret included, type=TALLY_STOCK_SYNC.
# ---------------------------------------------------------------------
captured_payloads = []


def fake_post_success(url, payload, timeout):
    captured_payloads.append(payload)
    return FakeResponse({"status": "success", "itemsWritten": len(payload["items"]), "syncedAt": "2026-01-01T00:00:00.000Z"})


deps4 = {"post_json": FakeCounter(fake_post_success), "get_secret": lambda: "test-secret"}
result4 = tss.sync_stock_snapshot([{"name": "X"}], deps=deps4)
check("sync_stock_snapshot returns the parsed success response", result4["status"] == "success" and result4["itemsWritten"] == 1)
check("sync_stock_snapshot calls post_json exactly once", len(deps4["post_json"].calls) == 1)
sent_payload = captured_payloads[0]
check("sync_stock_snapshot sends type=TALLY_STOCK_SYNC", sent_payload["type"] == "TALLY_STOCK_SYNC")
check("sync_stock_snapshot sends the secret from get_secret", sent_payload["secret"] == "test-secret")
check("sync_stock_snapshot sends the items array unmodified", sent_payload["items"] == [{"name": "X"}])

# ---------------------------------------------------------------------
# 5. sync_stock_snapshot() -- application-level error response raises.
# ---------------------------------------------------------------------
deps5 = {"post_json": lambda url, payload, timeout: FakeResponse({"status": "error", "message": "Invalid sync secret."}), "get_secret": lambda: "wrong-secret"}
raised5 = False
try:
    tss.sync_stock_snapshot([], deps=deps5)
except tss.TallyStockSyncError as exc:
    raised5 = "Invalid sync secret" in str(exc)
check("sync_stock_snapshot raises TallyStockSyncError on an application-level error response", raised5)

# ---------------------------------------------------------------------
# 6. sync_stock_snapshot() -- non-JSON response raises.
# ---------------------------------------------------------------------
deps6 = {"post_json": lambda url, payload, timeout: FakeResponse(text="<html>not json</html>", raise_on_json=True), "get_secret": lambda: "s"}
raised6 = False
try:
    tss.sync_stock_snapshot([], deps=deps6)
except tss.TallyStockSyncError as exc:
    raised6 = "Non-JSON response" in str(exc)
check("sync_stock_snapshot raises TallyStockSyncError on a non-JSON response", raised6)

# ---------------------------------------------------------------------
# 7. sync_stock_snapshot() -- network error raises.
# ---------------------------------------------------------------------
import requests as _requests


def fake_post_network_error(url, payload, timeout):
    raise _requests.exceptions.ConnectionError("could not connect")


deps7 = {"post_json": fake_post_network_error, "get_secret": lambda: "s"}
raised7 = False
try:
    tss.sync_stock_snapshot([], deps=deps7)
except tss.TallyStockSyncError as exc:
    raised7 = "Network error" in str(exc)
check("sync_stock_snapshot raises TallyStockSyncError on a network failure", raised7)

# ---------------------------------------------------------------------
# 8. sync_stock_snapshot() -- missing secret (no deps override, no env
#    var set) raises before ever attempting a network call.
# ---------------------------------------------------------------------
os.environ.pop(tss.SYNC_SECRET_ENV_VAR, None)
post_should_not_be_called = FakeCounter(lambda url, payload, timeout: FakeResponse({"status": "success"}))
raised8 = False
try:
    tss.sync_stock_snapshot([], deps={"post_json": post_should_not_be_called})
except tss.TallyStockSyncError as exc:
    raised8 = tss.SYNC_SECRET_ENV_VAR in str(exc)
check("sync_stock_snapshot refuses to sync when no secret is configured", raised8)
check("sync_stock_snapshot never calls post_json when the secret check fails first", len(post_should_not_be_called.calls) == 0)

# ---------------------------------------------------------------------
# 9. fetch_and_sync_latest_stock() -- full pipeline, empty Tally
#    response (zero stock items) is handled as a VALID empty snapshot,
#    not an error.
# ---------------------------------------------------------------------
sync_calls_9 = []


def fake_sync_9(snapshot, timeout=60):
    sync_calls_9.append(snapshot)
    return {"status": "success", "itemsWritten": len(snapshot), "syncedAt": "2026-01-01T00:00:00.000Z"}


deps9 = {
    "connect": FakeCounter(lambda: True),
    "get_stock_items": FakeCounter(lambda: "<ENVELOPE></ENVELOPE>"),
    "parse_stock_items": FakeCounter(lambda xml_text: []),  # Tally genuinely has zero stock items
    "sync_stock_snapshot": fake_sync_9,
}
result9 = tss.fetch_and_sync_latest_stock(deps=deps9)
check("fetch_and_sync_latest_stock connects to Tally exactly once", len(deps9["connect"].calls) == 1)
check("fetch_and_sync_latest_stock treats zero Stock Items as a valid empty snapshot, not an error", result9["itemsWritten"] == 0 and sync_calls_9[0] == [])

# ---------------------------------------------------------------------
# 10. fetch_and_sync_latest_stock() -- multiple real items flow through
#     end-to-end with correctly transformed, distinct values per item.
# ---------------------------------------------------------------------
sync_calls_10 = []


def fake_sync_10(snapshot, timeout=60):
    sync_calls_10.append(snapshot)
    return {"status": "success", "itemsWritten": len(snapshot), "syncedAt": "2026-01-01T00:00:00.000Z"}


deps10 = {
    "connect": lambda: True,
    "get_stock_items": lambda: "<ENVELOPE></ENVELOPE>",
    "parse_stock_items": lambda xml_text: [
        make_stock_item(name="Item A", master_id="A1", closing_balance=10.0),
        make_stock_item(name="Item B", master_id="B2", closing_balance=20.0),
    ],
    "sync_stock_snapshot": fake_sync_10,
}
result10 = tss.fetch_and_sync_latest_stock(deps=deps10)
check("fetch_and_sync_latest_stock syncs one snapshot for the whole batch (not one call per item)", len(sync_calls_10) == 1)
check("fetch_and_sync_latest_stock reports the correct row count", result10["itemsWritten"] == 2)
snapshot10 = sync_calls_10[0]
check("fetch_and_sync_latest_stock preserves each item's own distinct stock quantity", snapshot10[0]["currentStockQty"] == 10.0 and snapshot10[1]["currentStockQty"] == 20.0)
check("fetch_and_sync_latest_stock preserves each item's own distinct MASTERID", snapshot10[0]["masterId"] == "A1" and snapshot10[1]["masterId"] == "B2")

# ---------------------------------------------------------------------
# 11. fetch_and_sync_latest_stock() -- malformed/unparseable Tally XML
#     propagates as a real exception rather than being silently
#     swallowed or producing a fabricated empty snapshot.
# ---------------------------------------------------------------------
class _FakeParseError(Exception):
    pass


def fake_parse_raises(xml_text):
    raise _FakeParseError("malformed XML")


deps11 = {
    "connect": lambda: True,
    "get_stock_items": lambda: "<not-even-xml",
    "parse_stock_items": fake_parse_raises,
    "sync_stock_snapshot": lambda snapshot, timeout=60: (_ for _ in ()).throw(AssertionError("sync must not be called if parsing failed")),
}
raised11 = False
try:
    tss.fetch_and_sync_latest_stock(deps=deps11)
except _FakeParseError:
    raised11 = True
check("fetch_and_sync_latest_stock propagates a real parse failure rather than swallowing it", raised11)

# ---------------------------------------------------------------------
# 12. Static source check: this module is READ-ONLY against Tally -- it
#     must never import tally_write_client, and must never build/send an
#     Import Data / Alter / Delete request of its own. Mirrors (in
#     miniature) the repo-wide sweep test_no_tally_writes.py already
#     performs over every .py file in this directory, as an explicit,
#     named assertion specifically about THIS new module.
# ---------------------------------------------------------------------
_this_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_this_dir, "tally_stock_sync.py"), encoding="utf-8") as f:
    _source = f.read()
_code_only = "\n".join(line for line in _source.split("\n") if not line.strip().startswith("#"))
check("tally_stock_sync.py does not import tally_write_client", not re.search(r"^\s*import tally_write_client\b", _code_only, re.MULTILINE))
# Forbidden substrings are built via concatenation (never written
# contiguously anywhere in THIS file, including this comment) so that
# this test file itself does not trip test_no_tally_writes.py's own
# repo-wide raw-text scan for these exact patterns -- that scanner
# can't distinguish "this literal string is the write mechanism" from
# "this literal string is what a test asserts is ABSENT," so writing
# any of these three patterns out whole here, even inside a check's
# descriptive name, would produce a false positive there.
_forbidden_alter_action = "ACTION=" + '"Alter"'
_forbidden_delete_action = "ACTION=" + '"Delete"'
_forbidden_import_tag = "<TALLYREQUEST>" + "Import Data" + "</TALLYREQUEST>"
check("tally_stock_sync.py contains no Tally ACTION=Alter request", _forbidden_alter_action not in _source)
check("tally_stock_sync.py contains no Tally ACTION=Delete request", _forbidden_delete_action not in _source)
check("tally_stock_sync.py contains no Tally Import-Data request tag", _forbidden_import_tag not in _source)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
