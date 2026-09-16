"""
tally_receipt_note_sync.py

Phase 2 (inward-only) of the Tally-to-dashboard project: pulls Receipt
Note vouchers from Tally using the existing, unmodified, READ-ONLY
integration (tally_receipt_note_client.py / tally_receipt_note_parser.py
/ tally_connection.py), trims them to a recent date window client-side,
transforms them to the Tally_Recent_Receipts sheet schema, and POSTs the
whole (small, bounded) result in ONE request to the Apps Script backend's
new TALLY_RECEIPT_SYNC endpoint (backend/Code.gs / Code.js ->
tallyReceiptSync()), which replaces that tab's contents with this result.

READ-ONLY against Tally. This module never imports tally_write_client
and never sends anything back to Tally — it only ever calls
trnc.connect()/trnc.get_receipt_notes(), which issues a
TALLYREQUEST=EXPORT request under the hood. There is no function
anywhere in this file (or in tally_receipt_note_client.py /
tally_receipt_note_parser.py) capable of sending an Import/Alter request.

Does NOT touch Stock Item sync, GRN, Slack, Master Item List, or any
existing Inventory Dashboard field — tallyReceiptSync() on the Apps
Script side only ever writes to the new Tally_Recent_Receipts tab.

Explicitly does NOT use Stock Journal or Sales vouchers, and does not
attempt to calculate outward movement — see tally_receipt_note_client.py's
docstring for why (Sales carries zero inventory data at this company;
Stock Journal is a large, complex, bidirectional voucher type judged
unsafe for this phase).

Mirrors tally_stock_sync.py's shape closely (same APPS_SCRIPT_URL
default/env-var override, same manual-redirect-following POST helper,
same *SyncError-style exception, same "raise a clear error rather than
silently swallowing a failure" convention) — deliberately NOT importing
tally_stock_sync.py itself, matching this repo's existing precedent that
each sync module is self-contained, not a shared library.

Usage:
    cd integration
    python tally_receipt_note_sync.py

Requires INVENTORY_TALLY_RECEIPT_SYNC_SECRET to be set in the environment
— this module refuses to sync without it, matching every other sync
module in this repo's "fail loudly, never skip the check" convention.
This is a DIFFERENT, independently rotatable secret from PO_SYNC's and
Stock Item sync's — matching the Apps Script side's
TALLY_RECEIPT_SYNC_SECRET script property.
"""

import logging
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import requests

import tally_receipt_note_client as trnc
from tally_connection import TallyConnectionError
from tally_receipt_note_parser import ReceiptNoteLineItem

logger = logging.getLogger(__name__)

APPS_SCRIPT_URL = os.environ.get(
    "INVENTORY_APPS_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbzmGx2oO0dMGU_v6mQPc0LSxTNAdeViQSHWQjCJUc-F_VD9TsRiWJmaabqf2d10MOsO/exec",
)

SYNC_SECRET_ENV_VAR = "INVENTORY_TALLY_RECEIPT_SYNC_SECRET"

# "Recent" window applied CLIENT-SIDE after parsing — see
# tally_receipt_note_client.py's docstring for why: SVFROMDATE/SVTODATE
# was empirically confirmed NOT to restrict a Voucher COLLECTION's
# results, so date-bounding is enforced here instead, on each voucher's
# own real DATE field, before anything is synced or displayed.
RECENT_WINDOW_DAYS = 30

_MAX_JSON_RETRY_ATTEMPTS = 3
_JSON_RETRY_BACKOFF_SECONDS = 2


class TallyReceiptSyncError(Exception):
    """Raised for a network failure, a non-JSON response, or an
    application-level {status:'error', ...} response from Apps Script."""


def _post_json_preserving_method(url: str, payload: dict, timeout: int):
    """POSTs JSON to url and lets requests follow the Apps Script /exec
    redirect with its default behavior — same proven approach
    tally_stock_sync.py already uses (see that module's own comment for
    the full root-cause history of why this specific approach is
    correct, confirmed against the Apps Script Executions log)."""
    response = None
    for attempt in range(_MAX_JSON_RETRY_ATTEMPTS):
        response = requests.post(url, json=payload, timeout=timeout)
        try:
            response.json()
            return response
        except ValueError:
            if attempt < _MAX_JSON_RETRY_ATTEMPTS - 1:
                time.sleep(_JSON_RETRY_BACKOFF_SECONDS)
    return response


def _get_secret() -> str:
    secret = os.environ.get(SYNC_SECRET_ENV_VAR)
    if not secret:
        raise TallyReceiptSyncError(
            SYNC_SECRET_ENV_VAR + " is not set — refusing to sync without a secret."
        )
    return secret


def filter_recent(line_items: List[ReceiptNoteLineItem], window_days: int = RECENT_WINDOW_DAYS,
                   today: Optional[datetime] = None) -> List[ReceiptNoteLineItem]:
    """Keeps only line items whose voucher DATE falls within the last
    `window_days` days (inclusive of today). `today` is injectable for
    tests; defaults to the real current date. A line item with an
    unparseable/missing date_raw (exactly 8 digits, YYYYMMDD) is dropped
    rather than guessed into or out of the window."""
    reference = today or datetime.now()
    cutoff = reference - timedelta(days=window_days)
    kept = []
    for item in line_items:
        raw = (item.date_raw or "").strip()
        if len(raw) != 8 or not raw.isdigit():
            continue
        try:
            voucher_date = datetime.strptime(raw, "%Y%m%d")
        except ValueError:
            continue
        if cutoff.date() <= voucher_date.date() <= reference.date():
            kept.append(item)
    return kept


def transform_line_item(item: ReceiptNoteLineItem) -> Dict[str, Optional[object]]:
    """Maps ONE parsed ReceiptNoteLineItem onto the Tally_Recent_Receipts
    sheet schema (backend/Code.gs's TALLY_RECEIPTS_HEADERS, same field
    order):

        Date            <- item.date (dd-mm-yyyy) falling back to date_raw
        Voucher Number  <- item.voucher_number
        Party Ledger    <- item.party_ledger
        Item Name       <- item.item_name
        Quantity        <- item.quantity
        Unit            <- item.unit
        Rate            <- item.rate
        Amount          <- item.amount
        GUID            <- item.guid

    'Last Synced' is deliberately NOT set here — stamped server-side by
    the Apps Script endpoint at sync time, exactly like tallyStockSync()
    already does for Tally_Latest_Stock."""
    return {
        "date": item.date or item.date_raw,
        "voucherNumber": item.voucher_number,
        "partyLedger": item.party_ledger,
        "itemName": item.item_name,
        "quantity": item.quantity,
        "unit": item.unit,
        "rate": item.rate,
        "amount": item.amount,
        "guid": item.guid,
    }


def build_receipt_snapshot(line_items: List[ReceiptNoteLineItem]) -> List[Dict[str, Optional[object]]]:
    """Transforms a whole (already date-trimmed) list of
    ReceiptNoteLineItems. An empty input list produces an empty output
    list — a valid snapshot (no recent receipts), not an error."""
    return [transform_line_item(item) for item in line_items]


def sync_receipt_snapshot(snapshot_items: List[dict], timeout: int = 60, deps: Optional[dict] = None) -> dict:
    """POSTs one recent-receipts snapshot to the TALLY_RECEIPT_SYNC
    endpoint. Raises TallyReceiptSyncError on any failure. `deps` allows
    tests to substitute the network call and/or secret lookup, same
    dependency-injection convention as tally_stock_sync.py."""
    d = deps or {}
    post_fn = d.get("post_json", _post_json_preserving_method)
    get_secret_fn = d.get("get_secret", _get_secret)

    payload = {
        "type": "TALLY_RECEIPT_SYNC",
        "secret": get_secret_fn(),
        "items": snapshot_items,
    }

    try:
        response = post_fn(APPS_SCRIPT_URL, payload, timeout)
    except requests.exceptions.RequestException as exc:
        raise TallyReceiptSyncError("Network error syncing Tally receipt snapshot: " + str(exc)) from exc

    try:
        result = response.json()
    except ValueError as exc:
        raise TallyReceiptSyncError(
            "Non-JSON response syncing Tally receipt snapshot: " + response.text[:200]
        ) from exc

    if result.get("status") != "success":
        raise TallyReceiptSyncError(
            "Apps Script rejected the Tally receipt sync: " + str(result.get("message"))
        )

    return result


def fetch_and_sync_recent_receipts(timeout: int = 60, deps: Optional[dict] = None) -> dict:
    """Orchestrates the full pipeline: connect to Tally, retrieve and
    parse Receipt Note vouchers (existing, unmodified, read-only
    integration), trim to the recent window, transform, and sync in one
    request. Returns the Apps Script response dict on success; raises
    TallyConnectionError or TallyReceiptSyncError otherwise.

    `deps` lets tests substitute every network-touching step, same
    convention as tally_stock_sync.py's fetch_and_sync_latest_stock()."""
    d = deps or {}
    connect_fn = d.get("connect", trnc.connect)
    get_receipt_notes_fn = d.get("get_receipt_notes", trnc.get_receipt_notes)
    parse_receipt_notes_fn = d.get("parse_receipt_notes", trnc.parse_receipt_notes)
    sync_fn = d.get("sync_receipt_snapshot", sync_receipt_snapshot)

    connect_fn()
    xml_text = get_receipt_notes_fn()
    line_items = parse_receipt_notes_fn(xml_text)
    recent = filter_recent(line_items)
    snapshot = build_receipt_snapshot(recent)
    return sync_fn(snapshot, timeout=timeout)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    print("Step 1/3: connecting to Tally...")
    try:
        trnc.connect()
    except TallyConnectionError as exc:
        print("FAILED to connect to Tally: " + str(exc))
        return 1
    print("  Connected.")

    print("Step 2/3: retrieving and parsing Receipt Note vouchers...")
    try:
        xml_text = trnc.get_receipt_notes()
        line_items = trnc.parse_receipt_notes(xml_text)
    except TallyConnectionError as exc:
        print("FAILED to retrieve Receipt Notes: " + str(exc))
        return 1
    recent = filter_recent(line_items)
    print("  Retrieved " + str(len(line_items)) + " line item(s) total; "
          + str(len(recent)) + " within the last " + str(RECENT_WINDOW_DAYS) + " days.")

    snapshot = build_receipt_snapshot(recent)

    print("Step 3/3: syncing recent-receipts snapshot to Apps Script...")
    try:
        result = sync_receipt_snapshot(snapshot)
    except TallyReceiptSyncError as exc:
        print("FAILED to sync snapshot: " + str(exc))
        return 1

    print()
    print("=== Sync summary ===")
    print("Items written: " + str(result.get("itemsWritten")))
    print("Synced at:     " + str(result.get("syncedAt")))
    print()
    print("Tally_Recent_Receipts synced successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
