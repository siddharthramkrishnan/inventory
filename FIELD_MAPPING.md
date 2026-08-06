# Field Mapping — Tally → Inventory Management System

Status: **proposal — the Tally-side column below must be confirmed against
the existing, already-working Python↔Tally XML connection before
implementation.** This repository contains no Tally integration code and
no sample Tally XML response, so the exact field/tag names Tally returns
in this specific environment are not something this review has direct
evidence of. The **target-side** columns (Python payload → Sheet →
`getActivePOs()` → frontend) are exact, evidence-based, and drawn directly
from `backend/Code.gs` and `frontend/grn-entry.html`.

## How to read this document

Four columns per field:
1. **Tally (typical / to be confirmed)** — the field as it's commonly
   exposed in TallyPrime's XML export for a Purchase Order voucher.
   Marked "confirm" where this document cannot verify it against this
   specific Tally installation.
2. **Python sync payload** — the JSON field name the Python service should
   send to the new Apps Script endpoint.
3. **"Open POs (Tally)" sheet column** — the new sheet tab's column,
   proposed to mirror this codebase's existing flat-row convention (one
   row per PO line item, PO-level fields repeated per row — the same
   pattern every GRN Registry category tab already uses).
4. **`getActivePOs()` output field** — the exact field name
   `grn-entry.html` already reads today (unchanged).

## PO header fields (one value per PO, repeated on every item row)

| Tally (typical / confirm) | Python payload | Sheet column | `getActivePOs()` field | Notes |
|---|---|---|---|---|
| Voucher Number (`VOUCHERNUMBER`) | `poNo` | `PO No.` | `poNo` | Primary human-readable PO identifier. Matched case-insensitively/trimmed elsewhere in this codebase (`verifyGrnExists`, `grnCreate`'s duplicate check) — sync logic should follow the same normalization. |
| Voucher Date (`DATE`) | `poDate` | `PO Date` | `poDate` | `parsePOSheetValues()` currently stores this as whatever string was in the cell, unparsed — the sync payload should send a plain display-ready string (e.g. `dd-mm-yyyy`, matching how the rest of this codebase formats dates for display) rather than an ISO timestamp, to avoid a format mismatch with what warehouse users are used to seeing. |
| Party Ledger Name (`PARTYLEDGERNAME`) | `vendor` | `Vendor` | `vendor` | Displayed in the PO dropdown as `po.poNo + ' — ' + po.vendor` (`grn-entry.html`, confirmed) and auto-fills `f-party-name` on selection. |
| Internal voucher identifier (`GUID`, or `ALTERID` for change-tracking — **confirm which the existing Python connection already captures**) | `tallyRef` (proposed, not currently part of the frontend contract) | `Tally Voucher GUID` (new, internal-use column) | *(not exposed to the frontend)* | Needed as the **idempotency key** for upserts — see below. Not part of `getActivePOs()`'s existing output contract; used only by the sync/upsert logic inside Apps Script. |

## Line-item fields (one row per item, per PO)

| Tally (typical / confirm) | Python payload (`items[]` entry) | Sheet column | `getActivePOs()` field | Notes |
|---|---|---|---|---|
| Serial/row number within the voucher's inventory list | `slNo` | `Sl No.` | `item.slNo` | `parsePOSheetValues()` currently derives this from row position in the Excel table; Tally can supply it directly. |
| Stock Item Name (`STOCKITEMNAME`) | `description` | `Description of Material` | `item.description` | **Critical field** — used as half of the composite matching key (`PO No. + normalized description`) throughout the existing GRN logic (`getReceivedQtyByPOAndItem`, `getPOOverrideKeys`, the GRN Entry checklist's per-item balance). Must be sent as plain text, trimmed; normalization (`normaliseForMatch` — lowercase, non-alphanumeric collapsed to spaces) is applied on the Apps Script side already and does not need to be duplicated by Python. |
| Billed/Actual Quantity (`BILLEDQTY` or `ACTUALQTY` — **confirm which this PO context uses**) | `quantity` | `Quantity` | `item.quantity` → source for computed `item.orderedQty` | `getActivePOs()` computes `orderedQty = Number(item.quantity) || 0` itself — Python should send a plain numeric-parseable value, not a formatted string with units baked in. |
| Rate (`RATE`) | `rate` | `Rate` | `item.rate` | Display-only in the current UI (`" @ ₹" + item.rate + "/" + item.unit`) — not used in any calculation server-side. |
| Unit (`UNIT` / the unit portion of `RATE`, e.g. "Nos", "Kg") | `unit` | `Unit` | `item.unit` | Free text, displayed as-is. |
| Amount (`AMOUNT`) | `amount` | `Amount` | `item.amount` | Pre-filled into the GRN Entry form's per-item "Basic Amt" field as a starting value (`grn-entry.html`, confirmed) — editable by the warehouse user before submit, so exact precision here is not safety-critical. |

## Fields `getActivePOs()` computes itself — Python must NOT send these

These are derived server-side from GRN Registry data that Python has no
reason to access, and doing so would duplicate logic that must stay in one
place:

| `getActivePOs()` field | Derived from |
|---|---|
| `item.orderedQty` | `Number(item.quantity)` — computed from the `quantity` field above, not sent separately |
| `item.receivedQty` | `getReceivedQtyByPOAndItem()` — scans the GRN Registry spreadsheet's actual logged deliveries |
| `item.remainingQty` | `max(orderedQty - receivedQty, 0)`, or `0` if overridden |
| `item.overridden` | `getPOOverrideKeys()` — reads the "PO Manual Overrides" tab, populated by `reportPOShortfall()` from warehouse-side actions, not from Tally |

Sending these from Python would create two possible sources of truth for
the same value; the existing GRN-side computation must remain authoritative
since it already correctly accounts for partial deliveries across
multiple GRNs, which Tally has no visibility into.

## Idempotency key

The composite key `(PO No. + normalized item description)` is already how
this codebase matches GRN deliveries back to PO line items
(`getReceivedQtyByPOAndItem`, `getPOOverrideKeys` — confirmed in
`backend/Code.gs`). The sync/upsert logic for the new "Open POs (Tally)"
sheet should use `PO No.` (and, if the existing Python↔Tally connection
already retrieves a stable internal voucher identifier, that identifier in
preference to PO No. alone) to decide whether an incoming sync is a new PO
or an update to an already-synced one. **Which identifier is actually
available depends on the existing Python integration's current
capabilities and must be confirmed, not assumed, before implementation.**

## Fields explicitly not carried through

Any Tally voucher field not listed above (e.g. narration, ledger-level
accounting entries beyond the party name, tax breakdowns, godown/location
if tracked in Tally) is out of scope for this sync — the target system's
GRN Entry form already captures its own GST/Basic Amount/Other Charges
values from the warehouse user directly (`grn-entry.html`, confirmed), and
does not currently read tax data from the PO source at all. Per
`PO_IMPORT_ARCHITECTURE.md` §8, only the fields actually needed to
populate the existing picker should be synced.

## Validation before implementation

Because this document's Tally-side column is necessarily written from
general TallyPrime XML export conventions rather than direct evidence from
this repository, the first implementation step (see
`IMPLEMENTATION_PHASES.md`, Phase 0) must be reconciling every row above
against a real XML response from the existing Python↔Tally connection —
not assuming this table is correct as written.
