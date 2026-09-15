"""
tally_stock_sync.py

Phase 1 of the Tally-stock-to-dashboard project: pulls the current Stock
Item snapshot from Tally using the existing, unmodified, READ-ONLY
integration (tally_inventory_client.py / tally_inventory_parser.py /
tally_connection.py), transforms it to the Tally_Latest_Stock sheet
schema, and POSTs the whole snapshot in ONE request to the Apps Script
backend's new TALLY_STOCK_SYNC endpoint (backend/Code.gs / Code.js ->
tallyStockSync()), which replaces the tab's contents with this snapshot.

READ-ONLY against Tally. This module never imports tally_write_client
and never sends anything back to Tally — it only ever calls
tic.connect()/tic.get_stock_items(), both of which issue a
TALLYREQUEST=EXPORT request under the hood (see tally_inventory_client.py).

Does NOT touch the GRN, Slack, or the existing Inventory Dashboard —
tallyStockSync() on the Apps Script side only ever writes to the
Tally_Latest_Stock tab (see that function's own docstring/comments).

Mirrors po_sync.py's shape closely (same APPS_SCRIPT_URL default/env-var
override, same manual-redirect-following POST helper, same
PoSyncError-style exception, same "raise a clear error rather than
silently swallowing a failure" convention) — deliberately NOT importing
po_sync.py itself, since that module is scoped to PO_SYNC specifically
and isn't designed as a shared library (same separation-of-concerns
precedent tally_inventory_client.py already establishes against
tally_client.py).

Usage:
    cd integration
    python tally_stock_sync.py

Requires INVENTORY_TALLY_STOCK_SYNC_SECRET to be set in the environment
— this module refuses to sync without it (see _get_secret() below), the
same "fail loudly, never skip the check" convention po_sync.py already
uses for INVENTORY_TALLY_SYNC_SECRET. This is a DIFFERENT, independently
rotatable secret from PO_SYNC's — matching the Apps Script side's
TALLY_STOCK_SYNC_SECRET script property, a deliberately separate
property from PO_SYNC's TALLY_SYNC_SECRET.
"""

import logging
import os
import sys
from typing import Dict, List, Optional

import requests

import tally_inventory_client as tic
from tally_connection import TallyConnectionError
from tally_inventory_parser import StockItem

logger = logging.getLogger(__name__)

# Same Web App URL every other integration module and every frontend page
# already uses — overridable via environment variable for testing against
# a non-production deployment, same as po_sync.py.
APPS_SCRIPT_URL = os.environ.get(
    "INVENTORY_APPS_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbzmGx2oO0dMGU_v6mQPc0LSxTNAdeViQSHWQjCJUc-F_VD9TsRiWJmaabqf2d10MOsO/exec",
)

# No hardcoded default, same reasoning as po_sync.py's SYNC_SECRET_ENV_VAR
# — a credential, not a fixed network address, must not live in source.
# Must match the Apps Script project's TALLY_STOCK_SYNC_SECRET script
# property exactly.
SYNC_SECRET_ENV_VAR = "INVENTORY_TALLY_STOCK_SYNC_SECRET"

_MAX_REDIRECTS = 5


class TallyStockSyncError(Exception):
    """Raised for a network failure, a non-JSON response, or an
    application-level {status:'error', ...} response from Apps Script."""


def _post_json_preserving_method(url: str, payload: dict, timeout: int):
    """POSTs JSON to url, manually following any 301/302/303 redirect as a
    POST with the same body.

    Duplicated from po_sync.py rather than imported, on purpose (see this
    module's docstring) — but IDENTICAL in behavior and for the identical
    reason: requests' default redirect handling demotes a POST-with-body
    to a bodyless GET on 301/302/303 responses, and Apps Script Web App
    /exec URLs front-door through exactly such a redirect (see
    docs/ROOT_CAUSE_FAILED_POS.md), which would otherwise silently drop
    this snapshot before it ever reaches doPost().
    """
    current_url = url
    for _ in range(_MAX_REDIRECTS):
        response = requests.post(
            current_url, json=payload, timeout=timeout, allow_redirects=False
        )
        if response.status_code in (301, 302, 303) and "Location" in response.headers:
            current_url = response.headers["Location"]
            continue
        return response
    raise TallyStockSyncError("Too many redirects POSTing to " + url)


def _get_secret() -> str:
    secret = os.environ.get(SYNC_SECRET_ENV_VAR)
    if not secret:
        raise TallyStockSyncError(
            SYNC_SECRET_ENV_VAR + " is not set — refusing to sync without a secret."
        )
    return secret


def transform_stock_item(item: StockItem) -> Dict[str, Optional[object]]:
    """Maps ONE parsed StockItem onto the Tally_Latest_Stock sheet schema
    (backend/Code.gs's TALLY_STOCK_HEADERS, in the same field order):

        Item Name          <- item.name
        Tally MASTERID     <- item.master_id
        Tally GUID         <- item.guid
        Category           <- item.category
        Base Unit          <- item.base_unit
        Current Stock Qty  <- item.closing_balance   (the CURRENT on-hand
                              quantity — confirmed in
                              docs/inventory_stock_latest_analysis.md,
                              NOT opening_balance, which is a fiscal-year
                              opening position)
        Current Stock Value<- item.closing_value
        Current Rate       <- item.closing_rate
        GST Applicable     <- item.gst_applicable

    'Last Synced' is deliberately NOT set here — it's a sync-time
    timestamp the Apps Script endpoint stamps itself (server-side "now"),
    not a Tally-sourced field, exactly like grnCreate() stamps its own
    server timestamps rather than trusting a client-supplied one.

    Every field defaults to None when absent on the source StockItem
    (already Optional on the dataclass — e.g. category/gst_applicable/
    closing_balance can genuinely be None per tally_inventory_parser.py)
    -- never raises for a sparse/partial record. json.dumps() (used by
    the requests library when POSTing) serializes a Python None as JSON
    null, and the Apps Script side's own `item.field || ''` /
    `item.field != null ? ... : ''` guards already treat that exactly
    like a missing field.
    """
    return {
        "name": item.name,
        "masterId": item.master_id,
        "guid": item.guid,
        "category": item.category,
        "baseUnit": item.base_unit,
        "currentStockQty": item.closing_balance,
        "currentStockValue": item.closing_value,
        "currentRate": item.closing_rate,
        "gstApplicable": item.gst_applicable,
    }


def build_stock_snapshot(items: List[StockItem]) -> List[Dict[str, Optional[object]]]:
    """Transforms a whole list of parsed StockItems. An empty input list
    produces an empty output list — this is a VALID snapshot (Tally
    genuinely has zero stock items), not an error; the caller/Apps
    Script side treats it as "replace with nothing," per spec."""
    return [transform_stock_item(item) for item in items]


def sync_stock_snapshot(snapshot_items: List[dict], timeout: int = 60, deps: Optional[dict] = None) -> dict:
    """POSTs one full stock snapshot (already-transformed dicts, as
    produced by build_stock_snapshot()) to the TALLY_STOCK_SYNC endpoint
    and returns the parsed JSON response on success. Raises
    TallyStockSyncError on any failure — network-level, non-JSON
    response, or an application-level error.

    `deps` allows tests to substitute the network call and/or the secret
    lookup without any real HTTP request or environment variable —
    same dependency-injection convention push_master_item.py already
    uses (deps={"post_json": ..., "get_secret": ...}), rather than
    reaching for a mocking library this codebase doesn't otherwise use.
    """
    d = deps or {}
    post_fn = d.get("post_json", _post_json_preserving_method)
    get_secret_fn = d.get("get_secret", _get_secret)

    payload = {
        "type": "TALLY_STOCK_SYNC",
        "secret": get_secret_fn(),
        "items": snapshot_items,
    }

    try:
        response = post_fn(APPS_SCRIPT_URL, payload, timeout)
    except requests.exceptions.RequestException as exc:
        raise TallyStockSyncError("Network error syncing Tally stock snapshot: " + str(exc)) from exc

    try:
        result = response.json()
    except ValueError as exc:
        raise TallyStockSyncError(
            "Non-JSON response syncing Tally stock snapshot: " + response.text[:200]
        ) from exc

    # Apps Script's ContentService responses are always HTTP 200 regardless
    # of the JSON body's "status" field (confirmed against jsonResponse()
    # in backend/Code.gs, same as po_sync.py already documents) — the
    # body's own "status" field is the only trustworthy signal here.
    if result.get("status") != "success":
        raise TallyStockSyncError(
            "Apps Script rejected the Tally stock sync: " + str(result.get("message"))
        )

    return result


def fetch_and_sync_latest_stock(timeout: int = 60, deps: Optional[dict] = None) -> dict:
    """Orchestrates the full Phase 1 pipeline: connect to Tally, retrieve
    and parse the Stock Item Master Collection (existing, unmodified,
    read-only integration), transform it to the sheet schema, and sync
    it in one request. Returns the Apps Script response dict on success;
    raises TallyConnectionError (Tally unreachable) or
    TallyStockSyncError (sync failed) otherwise -- never swallows either.

    `deps` lets tests substitute every network-touching step (connect,
    get_stock_items, parse_stock_items, sync_stock_snapshot) with an
    in-memory fake, so the whole pipeline can be exercised with zero
    real Tally or HTTP calls -- same convention as sync_stock_snapshot()
    above and push_master_item.py's own deps= injection point.
    """
    d = deps or {}
    connect_fn = d.get("connect", tic.connect)
    get_stock_items_fn = d.get("get_stock_items", tic.get_stock_items)
    parse_stock_items_fn = d.get("parse_stock_items", tic.parse_stock_items)
    sync_fn = d.get("sync_stock_snapshot", sync_stock_snapshot)

    connect_fn()
    xml_text = get_stock_items_fn()
    items = parse_stock_items_fn(xml_text)
    snapshot = build_stock_snapshot(items)
    return sync_fn(snapshot, timeout=timeout)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    print("Step 1/3: connecting to Tally...")
    try:
        tic.connect()
    except TallyConnectionError as exc:
        print("FAILED to connect to Tally: " + str(exc))
        return 1
    print("  Connected.")

    print("Step 2/3: retrieving and parsing Stock Items...")
    try:
        xml_text = tic.get_stock_items()
        items = tic.parse_stock_items(xml_text)
    except TallyConnectionError as exc:
        print("FAILED to retrieve Stock Items: " + str(exc))
        return 1
    print("  Retrieved " + str(len(items)) + " Stock Item(s).")

    snapshot = build_stock_snapshot(items)

    print("Step 3/3: syncing snapshot to Apps Script...")
    try:
        result = sync_stock_snapshot(snapshot)
    except TallyStockSyncError as exc:
        print("FAILED to sync snapshot: " + str(exc))
        return 1

    print()
    print("=== Sync summary ===")
    print("Items written: " + str(result.get("itemsWritten")))
    print("Synced at:     " + str(result.get("syncedAt")))
    print()
    print("Tally_Latest_Stock synced successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
