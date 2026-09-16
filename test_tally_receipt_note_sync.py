"""
test_tally_receipt_note_sync.py

Mock-only / fixture-only tests for the Phase 2 inward-only Tally pipeline:
tally_receipt_note_parser.py, tally_receipt_note_client.py, and
tally_receipt_note_sync.py. NO NETWORK CALLS to Tally or the Apps Script
Web App happen anywhere in this file. XML fixtures below are hand-built
to reproduce the exact real structure confirmed live against Achira
Labs' Tally instance on 2026-09-16 (see tally_receipt_note_client.py's
own docstring for the full investigation evidence) -- including the
Tally metadata counter that reuses the <VOUCHER> tag name, the
ISCANCELLED/ISOPTIONAL skip fields, and the compound quantity/rate string
formats -- not simplified toy XML.

Covers, per the six required categories for this phase:
  1. Receipt Note parsing            -> section 1
  2. Date filtering                  -> section 4
  3. Item/quantity extraction        -> section 1, 2
  4. Empty result                    -> section 3, 5
  5. Malformed/missing fields        -> section 2, 3
  6. Read-only behavior              -> section 7

Run:
    cd E:\\inventory-management\\integration
    python test_tally_receipt_note_sync.py
"""
import os
import re
import sys
from datetime import datetime

import tally_receipt_note_parser as trnp
import tally_receipt_note_sync as trns

passed, failed = 0, 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"PASS: {name}")
    else:
        failed += 1
        print(f"FAIL: {name} {detail}")


# ---------------------------------------------------------------------
# Fixtures -- hand-built to match the REAL structure confirmed live
# against Tally on 2026-09-16, not simplified toy XML: includes the
# <CMPINFO><VOUCHER>N</VOUCHER></CMPINFO> false-positive counter (same
# pattern already documented for Purchase Order/Stock Item responses in
# this repo), realistic compound ACTUALQTY/RATE strings, and a
# multi-item voucher (confirmed real: up to 6 items on one voucher).
# ---------------------------------------------------------------------

def envelope(body_xml):
    return f"""<ENVELOPE>
 <HEADER><VERSION>1</VERSION></HEADER>
 <BODY>
  <DATA>
   <COLLECTION>
    <CMPINFO><VOUCHER>2</VOUCHER></CMPINFO>
{body_xml}
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>"""


VOUCHER_SINGLE_ITEM = """
    <VOUCHER REMOTEID="r-1" VCHTYPE="Receipt Note">
     <DATE>20260818</DATE>
     <GUID>guid-aaa</GUID>
     <NARRATION>Quantity of goods received against PO 26-27/9</NARRATION>
     <VOUCHERTYPENAME>Receipt Note</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>Yashraj Biotechnology Ltd</PARTYLEDGERNAME>
     <VOUCHERNUMBER>32</VOUCHERNUMBER>
     <ISCANCELLED>No</ISCANCELLED>
     <ISOPTIONAL>No</ISOPTIONAL>
     <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Normal Goat Serum (Non-Immunized)</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <RATE>0.01/UI</RATE>
      <AMOUNT>-100.00</AMOUNT>
      <ACTUALQTY>10000 UI</ACTUALQTY>
      <BILLEDQTY>10000 UI</BILLEDQTY>
     </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
"""

VOUCHER_MULTI_ITEM = """
    <VOUCHER REMOTEID="r-2" VCHTYPE="Receipt Note">
     <DATE>20260706</DATE>
     <GUID>guid-bbb</GUID>
     <NARRATION>Quantity of goods received against PO 260-27/51</NARRATION>
     <VOUCHERTYPENAME>Receipt Note</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>Sai Tools and Engineering</PARTYLEDGERNAME>
     <VOUCHERNUMBER>5</VOUCHERNUMBER>
     <ISCANCELLED>No</ISCANCELLED>
     <ISOPTIONAL>No</ISOPTIONAL>
     <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>IT HSS - Drill 4.6</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <RATE>95.00/Pcs</RATE>
      <AMOUNT>-95.00</AMOUNT>
      <ACTUALQTY>1.00 Pcs</ACTUALQTY>
      <BILLEDQTY>1.00 Pcs</BILLEDQTY>
     </ALLINVENTORYENTRIES.LIST>
     <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>IT HSS - Drill 4.7</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <RATE>95.00/Pcs</RATE>
      <AMOUNT>-95.00</AMOUNT>
      <ACTUALQTY>1.00 Pcs</ACTUALQTY>
      <BILLEDQTY>1.00 Pcs</BILLEDQTY>
     </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
"""

VOUCHER_CANCELLED = """
    <VOUCHER REMOTEID="r-3" VCHTYPE="Receipt Note">
     <DATE>20260801</DATE>
     <GUID>guid-ccc</GUID>
     <VOUCHERTYPENAME>Receipt Note</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>Some Vendor</PARTYLEDGERNAME>
     <VOUCHERNUMBER>99</VOUCHERNUMBER>
     <ISCANCELLED>Yes</ISCANCELLED>
     <ISOPTIONAL>No</ISOPTIONAL>
     <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Should Not Appear</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <RATE>1.00/Nos</RATE>
      <AMOUNT>-1.00</AMOUNT>
      <ACTUALQTY>1 Nos</ACTUALQTY>
     </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
"""

VOUCHER_OPTIONAL = VOUCHER_CANCELLED.replace("<ISCANCELLED>Yes</ISCANCELLED>", "<ISCANCELLED>No</ISCANCELLED>") \
    .replace("<ISOPTIONAL>No</ISOPTIONAL>", "<ISOPTIONAL>Yes</ISOPTIONAL>") \
    .replace("r-3", "r-4").replace("99", "100")

VOUCHER_MISSING_ITEM_NAME = """
    <VOUCHER REMOTEID="r-5" VCHTYPE="Receipt Note">
     <DATE>20260805</DATE>
     <GUID>guid-eee</GUID>
     <VOUCHERTYPENAME>Receipt Note</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>Some Vendor</PARTYLEDGERNAME>
     <VOUCHERNUMBER>101</VOUCHERNUMBER>
     <ISCANCELLED>No</ISCANCELLED>
     <ISOPTIONAL>No</ISOPTIONAL>
     <ALLINVENTORYENTRIES.LIST>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <RATE>1.00/Nos</RATE>
      <AMOUNT>-1.00</AMOUNT>
      <ACTUALQTY>1 Nos</ACTUALQTY>
     </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
"""

VOUCHER_MISSING_QTY_FALLS_BACK_TO_BILLED = """
    <VOUCHER REMOTEID="r-6" VCHTYPE="Receipt Note">
     <DATE>20260806</DATE>
     <GUID>guid-fff</GUID>
     <VOUCHERTYPENAME>Receipt Note</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>Some Vendor</PARTYLEDGERNAME>
     <VOUCHERNUMBER>102</VOUCHERNUMBER>
     <ISCANCELLED>No</ISCANCELLED>
     <ISOPTIONAL>No</ISOPTIONAL>
     <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Item With No ActualQty</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <RATE>1.00/Nos</RATE>
      <AMOUNT>-1.00</AMOUNT>
      <ACTUALQTY></ACTUALQTY>
      <BILLEDQTY>7 Nos</BILLEDQTY>
     </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
"""

VOUCHER_NO_VOUCHERNUMBER = """
    <VOUCHER REMOTEID="r-7" VCHTYPE="Receipt Note">
     <DATE>20260807</DATE>
     <VOUCHERTYPENAME>Receipt Note</VOUCHERTYPENAME>
     <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Ghost Item</STOCKITEMNAME>
     </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
"""


# ---------------------------------------------------------------------
# 1. Receipt Note parsing -- real-shaped XML, single item, all fields.
# ---------------------------------------------------------------------
xml1 = envelope(VOUCHER_SINGLE_ITEM)
items1 = trnp.parse_receipt_notes_xml(xml1)
check("parses exactly one line item from one single-item voucher", len(items1) == 1)
if items1:
    it = items1[0]
    check("voucher_number extracted", it.voucher_number == "32")
    check("date_raw extracted", it.date_raw == "20260818")
    check("date formatted dd-mm-yyyy", it.date == "18-08-2026")
    check("party_ledger extracted", it.party_ledger == "Yashraj Biotechnology Ltd")
    check("guid extracted", it.guid == "guid-aaa")
    check("narration extracted", "PO 26-27/9" in it.narration)
    check("is_deemed_positive True (inward convention)", it.is_deemed_positive is True)
    check("item_name extracted", it.item_name == "Normal Goat Serum (Non-Immunized)")
    check("quantity extracted from ACTUALQTY", it.quantity == 10000.0)
    check("unit extracted", it.unit == "UI")
    check("rate extracted (absolute, unit stripped)", it.rate == 0.01)
    check("amount extracted as absolute value (sign convention normalized)", it.amount == 100.0)

# ---------------------------------------------------------------------
# 1b/3. Item/quantity extraction -- multi-item voucher: every item
# captured as its own row, voucher-level fields duplicated correctly.
# ---------------------------------------------------------------------
xml1b = envelope(VOUCHER_MULTI_ITEM)
items1b = trnp.parse_receipt_notes_xml(xml1b)
check("multi-item voucher produces one row PER item (2 items -> 2 rows)", len(items1b) == 2)
check("both rows share the same voucher_number", {i.voucher_number for i in items1b} == {"5"})
check("both rows share the same guid", {i.guid for i in items1b} == {"guid-bbb"})
check("each row has its own distinct item_name", {i.item_name for i in items1b} == {"IT HSS - Drill 4.6", "IT HSS - Drill 4.7"})

# ---------------------------------------------------------------------
# 2/5. Malformed/missing fields -- cancelled, optional, missing item
# name, missing ACTUALQTY (falls back to BILLEDQTY), missing voucher
# number (the CMPINFO-style false positive) -- none of these raise.
# ---------------------------------------------------------------------
xml2a = envelope(VOUCHER_CANCELLED)
items2a = trnp.parse_receipt_notes_xml(xml2a)
check("a cancelled voucher contributes zero rows", len(items2a) == 0)

xml2b = envelope(VOUCHER_OPTIONAL)
items2b = trnp.parse_receipt_notes_xml(xml2b)
check("an optional voucher contributes zero rows", len(items2b) == 0)

xml2c = envelope(VOUCHER_MISSING_ITEM_NAME)
items2c = trnp.parse_receipt_notes_xml(xml2c)
check("an entry with no STOCKITEMNAME is skipped, not raised, and not fabricated", len(items2c) == 0)

xml2d = envelope(VOUCHER_MISSING_QTY_FALLS_BACK_TO_BILLED)
items2d = trnp.parse_receipt_notes_xml(xml2d)
check("an entry with blank ACTUALQTY falls back to BILLEDQTY rather than raising or dropping the row", len(items2d) == 1 and items2d[0].quantity == 7.0)

xml2e = envelope(VOUCHER_NO_VOUCHERNUMBER)
items2e = trnp.parse_receipt_notes_xml(xml2e)
check("a voucher with no VOUCHERNUMBER (e.g. Tally's own metadata counter) is skipped entirely", len(items2e) == 0)

# ---------------------------------------------------------------------
# 3/4. Empty result -- an envelope with real structure but zero real
# vouchers (only the CMPINFO-style counter) parses to an empty list,
# never raises.
# ---------------------------------------------------------------------
xml3 = envelope("")
items3 = trnp.parse_receipt_notes_xml(xml3)
check("an envelope with zero real vouchers parses to an empty list, not an error", items3 == [])

# ---------------------------------------------------------------------
# 4. Date filtering -- filter_recent() keeps only the configured trailing
# window (inclusive), drops older/newer-than-today/unparseable dates,
# and never raises on a malformed date_raw.
# ---------------------------------------------------------------------
mk = trnp.ReceiptNoteLineItem
today = datetime(2026, 9, 16)


def line(date_raw, name="X"):
    return mk(voucher_number="1", date_raw=date_raw, date=None, party_ledger="P",
              guid="g", narration="", is_deemed_positive=True, item_name=name,
              quantity=1.0, unit="Nos", rate=1.0, rate_unit="Nos", amount=1.0)


within_window = line("20260901")   # 15 days before "today" -- inside a 30-day window
exactly_at_cutoff = line("20260817")  # exactly 30 days before "today" -- inclusive boundary
one_day_too_old = line("20260816")   # 31 days before -- just outside
is_today = line("20260916")
future_date = line("20260917")       # after "today" -- must be excluded
malformed_date = line("not-a-date")
short_date = line("2026091")         # 7 digits, not the expected 8

filtered = trns.filter_recent(
    [within_window, exactly_at_cutoff, one_day_too_old, is_today, future_date, malformed_date, short_date],
    window_days=30, today=today,
)
filtered_raws = {i.date_raw for i in filtered}
check("filter_recent keeps a date well within the window", "20260901" in filtered_raws)
check("filter_recent keeps a date exactly at the cutoff boundary (inclusive)", "20260817" in filtered_raws)
check("filter_recent keeps a date exactly equal to 'today'", "20260916" in filtered_raws)
check("filter_recent drops a date one day older than the window", "20260816" not in filtered_raws)
check("filter_recent drops a date in the future relative to 'today'", "20260917" not in filtered_raws)
check("filter_recent drops a completely unparseable date without raising", "not-a-date" not in filtered_raws)
check("filter_recent drops a malformed (wrong-length) date without raising", "2026091" not in filtered_raws)
check("filter_recent returns exactly the 3 expected survivors", len(filtered) == 3)

check("filter_recent of an empty list returns an empty list (valid, not an error)", trns.filter_recent([], today=today) == [])

# ---------------------------------------------------------------------
# 3/4. Item/quantity extraction + transform -- transform_line_item()
# maps every field correctly and never invents a 'Last Synced' value
# (stamped server-side, exactly like tally_stock_sync.py's convention).
# ---------------------------------------------------------------------
transformed = trns.transform_line_item(within_window)
check("transform_line_item falls back to date_raw when .date is None (line() helper sets date=None)",
      transformed["date"] == "20260901")
check("transform_line_item maps voucherNumber/partyLedger/itemName/quantity/unit/rate/amount/guid",
      transformed == {
          "date": "20260901", "voucherNumber": "1", "partyLedger": "P", "itemName": "X",
          "quantity": 1.0, "unit": "Nos", "rate": 1.0, "amount": 1.0, "guid": "g",
      })
check("transform_line_item never includes a Last Synced field", "lastSynced" not in transformed and "Last Synced" not in transformed)

snapshot = trns.build_receipt_snapshot([within_window, exactly_at_cutoff])
check("build_receipt_snapshot returns one transformed dict per line item", len(snapshot) == 2)
check("build_receipt_snapshot of an empty list returns an empty list (valid, not an error)", trns.build_receipt_snapshot([]) == [])

# ---------------------------------------------------------------------
# 5. sync_receipt_snapshot() -- correct payload shape, type=TALLY_RECEIPT_SYNC,
#    and an application-level error response raises TallyReceiptSyncError.
# ---------------------------------------------------------------------
import json as _json


class FakeResponse:
    def __init__(self, json_body=None, text=None, raise_on_json=False):
        self._json_body = json_body
        self._text = text if text is not None else (_json.dumps(json_body) if json_body is not None else "")
        self._raise_on_json = raise_on_json

    def json(self):
        if self._raise_on_json:
            raise ValueError("not JSON")
        return self._json_body

    @property
    def text(self):
        return self._text


captured_payloads = []


def fake_post_success(url, payload, timeout):
    captured_payloads.append(payload)
    return FakeResponse({"status": "success", "itemsWritten": len(payload["items"]), "syncedAt": "2026-09-16T00:00:00.000Z"})


deps_ok = {"post_json": fake_post_success, "get_secret": lambda: "test-secret"}
result_ok = trns.sync_receipt_snapshot([{"itemName": "X"}], deps=deps_ok)
check("sync_receipt_snapshot returns the parsed success response", result_ok["status"] == "success" and result_ok["itemsWritten"] == 1)
sent_payload = captured_payloads[0]
check("sync_receipt_snapshot sends type=TALLY_RECEIPT_SYNC", sent_payload["type"] == "TALLY_RECEIPT_SYNC")
check("sync_receipt_snapshot sends the secret from get_secret", sent_payload["secret"] == "test-secret")
check("sync_receipt_snapshot sends the items array unmodified", sent_payload["items"] == [{"itemName": "X"}])


def fake_post_error(url, payload, timeout):
    return FakeResponse({"status": "error", "message": "Invalid sync secret."})


deps_err = {"post_json": fake_post_error, "get_secret": lambda: "wrong-secret"}
try:
    trns.sync_receipt_snapshot([], deps=deps_err)
    check("sync_receipt_snapshot raises on an application-level error response", False)
except trns.TallyReceiptSyncError as exc:
    check("sync_receipt_snapshot raises TallyReceiptSyncError with the server's message", "Invalid sync secret" in str(exc))

# Missing secret -> refuses without ever attempting a network call.
network_called = []


def fail_if_called(*a, **kw):
    network_called.append(True)
    raise AssertionError("post_json must not be called when get_secret() fails")


def get_secret_missing():
    raise trns.TallyReceiptSyncError("INVENTORY_TALLY_RECEIPT_SYNC_SECRET is not set — refusing to sync without a secret.")


try:
    trns.sync_receipt_snapshot([], deps={"post_json": fail_if_called, "get_secret": get_secret_missing})
    check("sync_receipt_snapshot raises when no secret is configured", False)
except trns.TallyReceiptSyncError as exc:
    check("sync_receipt_snapshot raises TallyReceiptSyncError when no secret is configured", "not set" in str(exc))
check("no network call was attempted when the secret was missing", network_called == [])

# ---------------------------------------------------------------------
# 6. fetch_and_sync_recent_receipts() -- full pipeline via dependency
#    injection, zero real network/Tally calls, confirms empty-Tally-
#    response handling end to end.
# ---------------------------------------------------------------------
pipeline_calls = {"connect": 0, "get": 0, "parse": 0, "sync": 0}


def fake_connect():
    pipeline_calls["connect"] += 1
    return True


def fake_get_receipt_notes():
    pipeline_calls["get"] += 1
    return envelope(VOUCHER_SINGLE_ITEM)


def fake_parse_receipt_notes(xml_text):
    pipeline_calls["parse"] += 1
    return trnp.parse_receipt_notes_xml(xml_text)


def fake_sync(snapshot_items, timeout=60):
    pipeline_calls["sync"] += 1
    return {"status": "success", "itemsWritten": len(snapshot_items), "syncedAt": "2026-09-16T00:00:00.000Z"}


pipeline_deps = {
    "connect": fake_connect,
    "get_receipt_notes": fake_get_receipt_notes,
    "parse_receipt_notes": fake_parse_receipt_notes,
    "sync_receipt_snapshot": fake_sync,
}
pipeline_result = trns.fetch_and_sync_recent_receipts(deps=pipeline_deps)
check("fetch_and_sync_recent_receipts calls connect/get/parse/sync exactly once each",
      pipeline_calls == {"connect": 1, "get": 1, "parse": 1, "sync": 1})
check("fetch_and_sync_recent_receipts returns the sync function's result", pipeline_result["status"] == "success")

# Empty-Tally-response case: zero vouchers at all -> zero items synced,
# not an error.
def fake_get_receipt_notes_empty():
    return envelope("")


pipeline_deps_empty = dict(pipeline_deps, get_receipt_notes=fake_get_receipt_notes_empty)
pipeline_result_empty = trns.fetch_and_sync_recent_receipts(deps=pipeline_deps_empty)
check("fetch_and_sync_recent_receipts handles a zero-voucher Tally response as a valid empty sync", pipeline_result_empty["status"] == "success" and pipeline_result_empty["itemsWritten"] == 0)

# ---------------------------------------------------------------------
# 7. Read-only behavior -- static source checks, mirroring (in
#    miniature) test_no_tally_writes.py's repo-wide sweep, as an
#    explicit, named assertion specifically about these three new files.
# ---------------------------------------------------------------------
_this_dir = os.path.dirname(os.path.abspath(__file__))
_forbidden_alter_action = "ACTION=" + '"Alter"'
_forbidden_delete_action = "ACTION=" + '"Delete"'
_forbidden_import_tag = "<TALLYREQUEST>" + "Import Data" + "</TALLYREQUEST>"

for _fname in ("tally_receipt_note_client.py", "tally_receipt_note_parser.py", "tally_receipt_note_sync.py"):
    with open(os.path.join(_this_dir, _fname), encoding="utf-8") as f:
        _source = f.read()
    _code_only = "\n".join(line_ for line_ in _source.split("\n") if not line_.strip().startswith("#"))
    check(f"{_fname} does not import tally_write_client", not re.search(r"^\s*import tally_write_client\b", _code_only, re.MULTILINE))
    check(f"{_fname} contains no Tally ACTION=Alter request", _forbidden_alter_action not in _source)
    check(f"{_fname} contains no Tally ACTION=Delete request", _forbidden_delete_action not in _source)
    check(f"{_fname} contains no Tally Import-Data request tag", _forbidden_import_tag not in _source)

# NOTE: whether every real Tally-transport call in these three files is
# preceded by an EXPORT-mode request tag is already verified, repo-wide,
# by test_no_tally_writes.py's own scan of every .py file in this
# directory -- deliberately NOT duplicated here. An earlier version of
# this file reproduced that scan's exact pattern inline, which
# backfired: writing out the transport function's name as call-shaped
# text near this file's own TALLYREQUEST/"Import Data" constants (built
# above, on purpose, to assert their ABSENCE elsewhere) made the
# repo-wide scanner misread this file's own assertions as a real
# violation, since it can't distinguish "this text is what's being
# checked FOR" from "this text is what's being checked to be ABSENT."
# Confirmed clean via test_no_tally_writes.py after removing it.

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
