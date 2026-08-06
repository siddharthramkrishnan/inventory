# Tally Integration Plan

Status: **planning only — no code has been written for this milestone.**
This document defines the objective and scope. Technical design is in
`PO_IMPORT_ARCHITECTURE.md`, the data contract is in `FIELD_MAPPING.md`,
and the rollout plan is in `IMPLEMENTATION_PHASES.md`.

## Objective

Eliminate the manual Purchase Order download/import step between
TallyPrime and the GRN Entry "Open PO" picker, while changing nothing else
about how the system looks or behaves.

## Current flow (as implemented today — verified against `backend/Code.gs`)

1. Purchase Team creates a PO in TallyPrime.
2. A human opens Tally, manually exports the PO to a `.xlsx` file.
3. That `.xlsx` file is manually placed into a specific Google Drive
   folder (`PO_FOLDER_ID`, constant in `Code.gs`).
4. `grn-entry.html` loads and calls `loadActivePOs()`, which requests
   `?action=activePOs` from the Apps Script Web App.
5. `getActivePOs()` (`backend/Code.gs`) lists every `.xlsx` file in that
   Drive folder, and for each one:
   - Copies it to a temporary Google Sheet (`Drive.Files.copy` — `.xlsx`
     can't be read by `SpreadsheetApp` directly),
   - Reads the temp sheet's cells and locates label cells ("Voucher No.",
     "Dated", "Supplier (Bill from)", "Sl") to extract the PO number,
     date, vendor, and line items (`parsePOFile` → `parsePOSheetValues` →
     `findLabelCell`),
   - Deletes the temporary copy.
6. Each PO's items are decorated with received/remaining quantity
   (`getReceivedQtyByPOAndItem()`, which scans every tab of the GRN
   Registry spreadsheet) and checked against manual shortfall overrides
   (`getPOOverrideKeys()`), then cached for 5 minutes
   (`CacheService`, key `'activePOs'`).
7. `grn-entry.html` populates the "Open PO" dropdown from this result and
   lets warehouse users log a GRN against it.
8. The GRN itself is written to the GRN Registry Google Spreadsheet
   (`GRN_REGISTRY_SHEET_ID`), exactly as `grnCreate()` does today —
   **this part is not changing.**

Full function-level detail is in `PO_IMPORT_ARCHITECTURE.md`'s "Current PO
flow" section.

## Target flow

1. Purchase Team creates a PO in TallyPrime. *(unchanged)*
2. A Python service — using the already-working Tally XML/HTTP
   connection — detects new or changed Purchase Order vouchers in Tally,
   on a schedule, with no human action required.
3. The Python service converts each detected PO into the exact data shape
   `getActivePOs()` already expects (see `FIELD_MAPPING.md`) and sends it
   to the Apps Script backend.
4. The Apps Script backend records it in a place `getActivePOs()` reads
   from — replacing the Drive-folder `.xlsx` source, not adding a second
   one alongside it.
5. `grn-entry.html`'s "Open PO" dropdown continues to populate exactly as
   it does today, from `getActivePOs()`'s unchanged output shape.
6. Warehouse users complete the GRN exactly as they do today — no change
   to `grn-entry.html`, `grn-verify.html`, `grnCreate()`,
   `grnVerifyLookup()`, `grnVerifyApprove()`, `reportPOShortfall()`, or any
   Sheet those functions read or write.

## Scope

**In scope:**
- Replacing `getActivePOs()`'s data *source* (Drive `.xlsx` files →
  Tally-synced data), while its return shape to `grn-entry.html` stays
  identical.
- A new, narrowly-scoped write path into the Apps Script backend for the
  Python service to deliver synced PO data.
- Sync strategy, error handling, retry, logging, and security for that new
  write path.
- A phased rollout that lets the new source be validated against the
  current one before the manual process is retired.

**Explicitly out of scope for this milestone:**
- Any change to `grn-entry.html`'s or `grn-verify.html`'s UI or behavior.
- Any change to the GRN workflow itself (`grnCreate`, `grnVerifyLookup`,
  `grnVerifyApprove`, `reportPOShortfall`, the GRN Registry spreadsheet's
  structure).
- Any change to the ARN Assignment, Inventory Adjustment, Material
  Request, or executive dashboard features.
- Resolving the pre-existing `Code.gs`/`Code.js` deployment ambiguity
  documented in `CODE_DEPLOYMENT_ANALYSIS.md` for functions unrelated to
  this integration — noted as a relevant risk in `PO_IMPORT_ARCHITECTURE.md`
  because new code added for this integration must go into *both* files to
  avoid reproducing that same ambiguity for itself, but resolving the
  pre-existing ambiguity for the rest of the backend is not part of this
  milestone.
- Writing or scheduling the Python service's Tally-polling code itself —
  that connection already exists and works; this plan defines what it
  needs to *send* and *when*, not how it talks to Tally.

## Constraints (as given)

- The frontend UI must not change.
- The GRN workflow must not change.
- Only the source of Purchase Orders changes.
- No implementation code is to be written until the architecture in these
  four documents is approved.

## Why this is achievable without touching the frontend

`grn-entry.html` never talks to Drive, and never parses a PO file itself.
It calls one backend action, `action=activePOs`, and renders whatever
`{status, pos: [{poNo, poDate, vendor, items: [...]}]}` shape comes back
(`loadActivePOs()`, confirmed directly in `grn-entry.html`'s source). That
shape is produced entirely inside `getActivePOs()`. As long as
`getActivePOs()` keeps producing the same shape — regardless of where the
underlying PO data now comes from — nothing downstream of it needs to
change. This is the single design principle the rest of this plan is built
around.

## Success criteria

- New/changed POs created in TallyPrime appear in `grn-entry.html`'s "Open
  PO" dropdown without any manual export/import step.
- `grn-entry.html` and `grn-verify.html` require zero code changes.
- Every test case in `docs/GRN_Full_Test_Plan.docx` still passes after the
  cutover (re-run as the regression suite for this change — see
  `IMPLEMENTATION_PHASES.md`).
- The manual Drive-folder `.xlsx` upload step is no longer required for
  day-to-day operation.
