# Phase 1 — Tally Purchase Order Retrieval

Status: **Phase 1 complete.** This module retrieves and parses Purchase
Orders from TallyPrime and returns clean JSON. It does **not** talk to
Apps Script, does **not** write to Google Sheets, and does **not** modify
anything in `frontend/` or `backend/`. Phases 2–5 from
`IMPLEMENTATION_PHASES.md` have not been started.

Everything in this document reflects the actual, live TallyPrime instance
this module was built and tested against (`Achira Labs Private Limited`,
via the existing connection in `test_tally.py`) — not assumptions. Where
the real response differed from what a generic Tally integration guide
would suggest, that's called out explicitly, because it's exactly the kind
of thing guessing would have gotten wrong.

## Architecture

```
TallyPrime (192.168.29.22:9999)
        │  HTTP POST, raw XML body           (test_tally.py's proven transport)
        ▼
tally_connection.py   — transport only: send_request(), check_connection()
        │  raw XML text
        ▼
tally_parser.py        — sanitizes + parses XML → PurchaseOrder/POItem dataclasses
        │                → converts dataclasses → JSON-ready structures
        ▼
tally_client.py         — public interface: connect(), get_purchase_orders(),
        │                  parse_purchase_orders(), to_json()
        ▼
test_purchase_orders.py — standalone script: runs the pipeline, prints JSON
```

Three-layer separation, each with one job:
- **`tally_connection.py`** knows nothing about Purchase Orders or XML
  structure — only how to reach Tally and hand back raw text (or raise a
  clear error). This is the layer that reuses `test_tally.py` directly.
- **`tally_parser.py`** knows nothing about HTTP — only how to turn Tally's
  raw XML into clean Python objects and then JSON.
- **`tally_client.py`** wires the two together behind the four functions
  requested for Phase 1.

## Existing connection reused

`test_tally.py` (now alongside this file in `integration/` — originally at
the top-level project folder before the repository-organization pass that
gave this integration its own repo) was read, explained, and run first —
see the conversation this was built from for that explanation. Its content
is unchanged by the move.
Reused **exactly**, in `tally_connection.py`:

| From `test_tally.py` | Reused as |
|---|---|
| `TALLY_URL = "http://192.168.29.22:9999"` | `tally_connection.TALLY_URL` |
| `timeout=5` | `tally_connection.DEFAULT_TIMEOUT` |
| `requests.post(url, data=xml.encode("utf-8"), timeout=...)` | `tally_connection.send_request()`'s call, unchanged |
| `except requests.exceptions.ConnectionError` / `except requests.exceptions.Timeout` | Same two exceptions caught, now wrapped in one `TallyConnectionError` so callers have a single type to catch |
| The exact "Company List" XML request | Reused verbatim as `check_connection()`'s connectivity probe — the one request already proven to work is the right thing to reuse for "is Tally reachable," rather than inventing a new one |

Nothing about the transport call itself was redesigned.

## XML request used (real, tested against the live instance)

```xml
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>Purchase Order Collection</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Purchase Order Collection" ISMODIFY="No">
      <TYPE>Voucher</TYPE>
      <FILTER>PurchaseOrderTypeFilter</FILTER>
      <FETCH>DATE, VOUCHERNUMBER, VOUCHERTYPENAME, PARTYLEDGERNAME, GUID, NARRATION, ISCANCELLED, ISOPTIONAL, ALLINVENTORYENTRIES.LIST</FETCH>
     </COLLECTION>
     <SYSTEM TYPE="Formulae" NAME="PurchaseOrderTypeFilter">$VoucherTypeName = "Purchase Order"</SYSTEM>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
```

This is a read-only `EXPORT`/`COLLECTION` request — it cannot modify
anything in Tally. It was arrived at iteratively against the live server:
a first attempt with no `FETCH` list returned only administrative fields
(no party, no line items); the `FETCH` list above was added specifically
to get what the parser needs, and no more.

## XML response format (real excerpt, one voucher)

```xml
<VOUCHER REMOTEID="78389433-...-00006437" VCHTYPE="Purchase Order" OBJVIEW="Invoice Voucher View">
 <DATE TYPE="Date">20260401</DATE>
 <GUID>78389433-1b86-42de-bf30-a357884c54ea-00006437</GUID>
 <NARRATION TYPE="String">Quantity of goods ordered (Open Order)</NARRATION>
 <VOUCHERTYPENAME>Purchase Order</VOUCHERTYPENAME>
 <PARTYNAME TYPE="String">Sri Vinayaka Gas Agencies</PARTYNAME>
 <PARTYLEDGERNAME TYPE="String">Sri Vinayaka Gas Agencies</PARTYLEDGERNAME>
 <VOUCHERNUMBER>ACHIRA/26-27/1A</VOUCHERNUMBER>
 <ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME TYPE="String">Nitrogen - UHP - Cylinders</STOCKITEMNAME>
  <RATE TYPE="Rate">1200.00/Nos</RATE>
  <AMOUNT TYPE="Amount">-12000.00</AMOUNT>
  <ACTUALQTY TYPE="Quantity"> 10.00 Nos</ACTUALQTY>
  <BILLEDQTY TYPE="Quantity"> 10.00 Nos</BILLEDQTY>
  <BATCHALLOCATIONS.LIST> ... </BATCHALLOCATIONS.LIST>
  <ACCOUNTINGALLOCATIONS.LIST> ... </ACCOUNTINGALLOCATIONS.LIST>
 </ALLINVENTORYENTRIES.LIST>
 <!-- a second ALLINVENTORYENTRIES.LIST sibling for the PO's 2nd line item -->
 <LEDGERENTRIES.LIST> ... </LEDGERENTRIES.LIST>
</VOUCHER>
```

Real characteristics discovered from the live response — none of these
were assumed, all shaped the parser directly:

1. **`RATE` and quantity fields are compound strings, not plain numbers.**
   Observed real values across 29 live vouchers included:
   - `"1200.00/Nos"` — plain rate
   - `"$0.02 = ? 0.02/Nos"` and `"0.14Euro = ? 0.14/UG"` — foreign-currency
     rates, shown as `<foreign> = <base>/<unit>`
   - `""` — some entries have no rate at all
   - `" 5000 UG =  5 MG"`, `" 1 Pack =  96 Wells"` — compound quantities,
     shown as `<entered qty+unit> = <alternate unit conversion>`
   - `" 300 Pcs"` — plain quantity
2. **`AMOUNT` on inventory entries is negative** (Tally's sign convention
   for the purchase side of the entry) — the absolute value is what's
   meaningful here.
3. **Each voucher has a stable `GUID`** — not derived, a real field Tally
   provides — the natural idempotency key for any future sync logic
   (carried through in the parsed output, unused by Phase 1 itself).
4. **The raw response contains an XML-illegal numeric character reference**
   (`&#4;`, 201 occurrences in one real response, always inside
   `BATCHNAME` — a field this parser doesn't read) that
   `xml.etree.ElementTree` correctly refuses to parse. One such reference
   anywhere in the document blocks parsing of the *entire* document, so
   the raw text is sanitized (illegal character references stripped,
   legal ones like a currency symbol left alone) before parsing is
   attempted at all.
5. **`ISCANCELLED`/`ISOPTIONAL` exist and are fetched** — none were `Yes`
   in the live data at the time of testing, but the parser skips such
   vouchers defensively rather than assuming the current data will always
   be clean.
6. **No explicit line-item serial number field** — `ALLINVENTORYENTRIES.LIST`
   entries are positional siblings; `sl_no` is assigned as a 1-based index
   during parsing.
7. Fetching `ALLINVENTORYENTRIES.LIST` as a bare field also returns its
   nested `BATCHALLOCATIONS.LIST`/`ACCOUNTINGALLOCATIONS.LIST` sub-lists by
   Tally's default behavior — present in the raw response, deliberately
   not read by the parser (simpler than restricting the TDL fetch further,
   and harmless to leave unread).

## Parser design

- `xml.etree.ElementTree` (standard library, no new dependency).
- `_sanitize_xml_text()` runs first, always, before any parsing is
  attempted — see point 4 above.
- Two dataclasses: `POItem` and `PurchaseOrder` — plain data, no methods,
  trivially convertible to JSON via `dataclasses.asdict`.
- `_parse_quantity`/`_parse_rate`/`_parse_amount` each handle the real
  format variety documented above, and each return `None` (never raise)
  for a value that can't be recovered — a PO with one un-parseable field
  still produces a usable object with that one field `null`, rather than
  losing the whole voucher.
- A voucher is skipped (not the whole batch aborted) if it's
  cancelled/optional, has no voucher number, or ends up with zero usable
  line items — consistent with how the rest of this codebase already
  treats one bad record as skippable rather than fatal (e.g. `getActivePOs()`
  skipping an unparseable PO file).

## JSON structure produced

```json
[
  {
    "po_no": "ACHIRA/26-27/1A",
    "po_date_raw": "20260401",
    "po_date": "01-04-2026",
    "vendor": "Sri Vinayaka Gas Agencies",
    "guid": "78389433-1b86-42de-bf30-a357884c54ea-00006437",
    "narration": "Quantity of goods ordered (Open Order)",
    "items": [
      {
        "sl_no": 1,
        "description": "Nitrogen - UHP - Cylinders",
        "quantity": 10.0,
        "unit": "Nos",
        "rate": 1200.0,
        "rate_unit": "Nos",
        "amount": 12000.0
      },
      {
        "sl_no": 2,
        "description": "Liquid Nitrogen",
        "quantity": 200.0,
        "unit": "Lts",
        "rate": 75.0,
        "rate_unit": "Lts",
        "amount": 15000.0
      }
    ]
  }
]
```

This is a **real, captured output** from running `test_purchase_orders.py`
against the live instance (one PO of the 29 returned at the time of
testing) — not a hand-written example. Field names here (`po_no`,
`po_date`, `vendor`, `items[].description/quantity/rate/unit/amount`) are
deliberately close to, but not forced to exactly match, `FIELD_MAPPING.md`'s
proposed Sheet/`getActivePOs()` column names — Phase 1's job is to produce
clean, complete data; mapping it into the exact sync payload shape is
Phase 2/3's job, not this one's.

## Folder structure

```
integration/
├── tally_connection.py       — transport (reuses test_tally.py's connection)
├── tally_parser.py           — XML → Python objects → JSON
├── tally_client.py           — public interface (connect/get/parse/to_json)
├── test_purchase_orders.py   — standalone runnable test
├── test_tally.py             — the original connection proof this whole module reuses
└── README_PHASE1.md          — this file
```

`test_tally.py` now lives here, in `integration/`, moved from the original
top-level project folder as part of giving this integration its own
repository — content untouched by the move.

## Assumptions

- **Single active company.** Neither `test_tally.py` nor this module
  specifies a company name in the request; Tally answers for whichever
  company is currently open in the desktop application on that machine.
  Confirmed in testing: this returned `Achira Labs Private Limited` data
  correctly, with no company-selection logic needed for Phase 1. Multi-company
  handling, if ever needed, is out of scope here.
- **`BILLEDQTY` is the ordered quantity to use**, falling back to
  `ACTUALQTY` if unusable. Both were equal on every voucher sampled in
  testing; this hasn't been observed to diverge.
- **The part of a compound rate/quantity string before/after `=` is
  correctly identified as "entered" vs. "converted"** based on the pattern
  observed across the real sample (29 vouchers, several with compound
  values) — not verified against Tally's own documentation of this display
  convention, only against what this specific response actually contains.

## Limitations

- No date-range or incremental filtering — every non-cancelled,
  non-optional Purchase Order voucher currently in Tally is fetched every
  call. Fine for Phase 1's manual retrieval; `IMPLEMENTATION_PHASES.md`
  Phase 0/4 flags incremental change-tracking as something to confirm and
  add before automatic polling.
- Some real vouchers have items with `"amount": null` even when `rate` is
  present (e.g. `ACHIRA/26-27/40`'s first item), and PO `ACHIRA/26-27/49`'s
  items all show an implausibly small amount (`0.01`) for their quantities.
  Both were confirmed to be present in Tally's own raw response, not a
  parsing defect — this module surfaces the data as Tally has it and does
  not attempt to correct, infer, or flag data-quality issues in the
  source system.
- No retry logic — a single request, single attempt. Retry/backoff is
  explicitly a Phase 4 concern (`PO_IMPORT_ARCHITECTURE.md` §6), not part
  of this retrieval module.
- Not tied into anything else in this repository. `integration/` imports
  nothing from `backend/` or `frontend/`, and nothing in `backend/` or
  `frontend/` imports from `integration/`.

## How to execute the test

```
cd integration
python test_purchase_orders.py
```

Requires: Python 3 with `requests` installed, network access to
`192.168.29.22:9999`, and TallyPrime running with its XML server enabled
(the same precondition `test_tally.py` already has). Prints connection
status, a character count for the raw XML received, and formatted JSON for
every Purchase Order retrieved. A connection failure at any step prints a
clear one-line message and exits with status 1, without a raw traceback.
