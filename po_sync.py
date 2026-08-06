"""
po_sync.py

Phase 2: sends translated Purchase Orders (from po_translator.py) to the
Apps Script backend's new PO_SYNC endpoint, one HTTP POST per PO — the
granularity decision from PO_IMPORT_ARCHITECTURE.md §4 (bounded request
size, simple partial-failure handling, one PO failing doesn't block the
rest).

Does not talk to Tally at all — takes already-translated dicts as input.
Does not retry (retry/backoff is a Phase 4 concern, not this module's).

IMPORTANT — this module has NOT been run against the real Apps Script Web
App URL as part of Phase 2 delivery. The PO_SYNC route only exists in this
repository's backend/Code.gs and backend/Code.js — it has not been (and
cannot be, from this environment) pushed to the live Apps Script project.
Sending a real request to the live URL before that push happens would hit
the CURRENT deployed doPost's fallback branch, which treats any
unrecognized payload as an Inventory Adjustment and appends it to the real
production "2. Adjustment Log" sheet — a live write this module must not
risk. Do not run sync_purchase_order()/sync_purchase_orders() against the
real APPS_SCRIPT_URL until the PO_SYNC code has actually been deployed
there and TALLY_SYNC_SECRET has been set on that live project.
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)

# Same Web App URL every frontend page already uses (backend/Code.gs,
# backend/Code.js — confirmed identical across both). Overridable via
# environment variable so this can point at a non-production deployment
# for testing before Phase 2's endpoint is live in production.
APPS_SCRIPT_URL = os.environ.get(
    "INVENTORY_APPS_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbzmGx2oO0dMGU_v6mQPc0LSxTNAdeViQSHWQjCJUc-F_VD9TsRiWJmaabqf2d10MOsO/exec",
)

# No hardcoded default — unlike TALLY_URL in tally_connection.py, this is
# a credential, not a fixed network address, and must not live in source
# (PO_IMPORT_ARCHITECTURE.md §8). Must match whatever is stored in the
# Apps Script project's PropertiesService under TALLY_SYNC_SECRET.
SYNC_SECRET_ENV_VAR = "INVENTORY_TALLY_SYNC_SECRET"


class PoSyncError(Exception):
    """Raised for a network failure, a non-JSON response, or an
    application-level {status:'error', ...} response from Apps Script."""


def _get_secret() -> str:
    secret = os.environ.get(SYNC_SECRET_ENV_VAR)
    if not secret:
        raise PoSyncError(
            SYNC_SECRET_ENV_VAR + " is not set — refusing to sync without a secret "
            "(see PO_IMPORT_ARCHITECTURE.md §8)."
        )
    return secret


def sync_purchase_order(translated_po: dict, timeout: int = 15) -> dict:
    """POSTs one translated PO to the PO_SYNC endpoint and returns the
    parsed JSON response on success. Raises PoSyncError on any failure —
    network-level, non-JSON response, or an application-level error."""
    payload = dict(translated_po)
    payload["type"] = "PO_SYNC"
    payload["secret"] = _get_secret()

    try:
        # A plain JSON body (Content-Type: application/json) — read by
        # doPost's existing e.postData.contents path, the same path every
        # other JSON-body POST to this Web App already uses. No new
        # parsing capability needed on the Apps Script side.
        response = requests.post(APPS_SCRIPT_URL, json=payload, timeout=timeout)

        # ---- TEMPORARY DIAGNOSTICS (PO_SYNC investigation only) — print
        # only, no behavior change. requests.post() call, timeout, Session
        # usage, and allow_redirects are all unmodified above this line.
        # Remove once the transport-layer investigation is resolved. ----
        print("-----------------------------------------")
        print("PO Number: " + str(translated_po.get("poNo")))
        print("1. Original URL: " + str(APPS_SCRIPT_URL))
        print("2. Final response.url: " + str(response.url))
        print("3. response.status_code: " + str(response.status_code))
        print("4. response.history (redirect chain):")
        if response.history:
            for i, hop in enumerate(response.history):
                print(
                    "     hop " + str(i) + ": status=" + str(hop.status_code)
                    + " url=" + str(hop.url)
                    + " Location header=" + str(hop.headers.get("Location"))
                    + " request method=" + str(hop.request.method if hop.request else "?")
                )
        else:
            print("     (empty — no redirects were followed)")
        print("5. response.headers: " + str(dict(response.headers)))
        print("6. response.headers['Content-Type']: " + str(response.headers.get("Content-Type")))
        print("7. response.elapsed: " + str(response.elapsed))
        try:
            diag_json = response.json()
            print("8. response.json() succeeds: True")
            print("   Parsed JSON: " + str(diag_json))
        except ValueError as diag_exc:
            print("8. response.json() succeeds: False (" + str(diag_exc) + ")")
        print("9. First 500 characters of response.text:")
        print(response.text[:500])
        print(
            "10. Request method used on final request (response.request.method): "
            + str(response.request.method if response.request else "?")
        )
        print("-----------------------------------------")
        # ---- END TEMPORARY DIAGNOSTICS ----
    except requests.exceptions.RequestException as exc:
        # ---- TEMPORARY DIAGNOSTICS (PO_SYNC investigation only) ----
        print("-----------------------------------------")
        print("PO Number: " + str(translated_po.get("poNo")))
        print("HTTP Status: NO RESPONSE (RequestException before a response was received)")
        print("Final URL: n/a")
        print("Redirect History: n/a")
        print("Content-Type: n/a")
        print("Response Headers: n/a")
        print("Exception: " + str(exc))
        print("-----------------------------------------")
        # ---- END TEMPORARY DIAGNOSTICS ----
        raise PoSyncError(
            "Network error syncing PO " + str(translated_po.get("poNo")) + ": " + str(exc)
        ) from exc

    try:
        result = response.json()
    except ValueError as exc:
        raise PoSyncError(
            "Non-JSON response syncing PO " + str(translated_po.get("poNo"))
            + ": " + response.text[:200]
        ) from exc

    # Apps Script's ContentService responses are always HTTP 200 regardless
    # of the JSON body's "status" field (PO_IMPORT_ARCHITECTURE.md §5,
    # confirmed directly against jsonResponse() in backend/Code.gs) — the
    # body's own "status" field is the only trustworthy signal here, not
    # response.status_code.
    if result.get("status") != "success":
        raise PoSyncError(
            "Apps Script rejected PO " + str(translated_po.get("poNo"))
            + ": " + str(result.get("message"))
        )

    return result


def sync_purchase_orders(translated_pos: list) -> dict:
    """Syncs a list of translated POs, one request per PO. One PO failing
    does not stop the rest. Returns {"synced": [poNo, ...], "failed": [poNo, ...]}."""
    synced, failed = [], []
    for po in translated_pos:
        try:
            sync_purchase_order(po)
            synced.append(po["poNo"])
        except PoSyncError as exc:
            logger.error(str(exc))
            failed.append(po["poNo"])
    return {"synced": synced, "failed": failed}
