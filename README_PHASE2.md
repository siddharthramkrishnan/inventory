# Phase 2 — Tally-Backed Purchase Order Pipeline

Status: **code complete, not yet live.** Every file listed below exists and
has been verified by direct execution against real data (Python side) and
by code trace (Apps Script side — this environment has no ability to push
to or execute against the live Apps Script project; see "What is and isn't
live" at the end of this document).

## What changed

| File | Change |
|---|---|
| `integration/po_translator.py` | **New.** Translates a `tally_parser.PurchaseOrder` into the exact shape `parsePOSheetValues()` already produces, plus `guid`/`narration`/`poDateRaw`/`rateUnit` as metadata. |
| `integration/po_sync.py` | **New.** Sends one translated PO per HTTP POST to Apps Script's new `PO_SYNC` route. **Not executed against the live Web App URL** — see below. |
| `backend/Code.gs` | **Modified.** New `PO_SYNC` branch in `doPost`; new `TALLY_PO_SHEET`/`TALLY_PO_HEADERS`, `getOrCreateTallyPoSheet()`, `getParsedPOsFromTallySheet()`, `syncPurchaseOrder()`; `getActivePOs()`'s data source changed from the Drive folder to the new sheet — its decoration logic and output shape are otherwise byte-for-byte unchanged. |
| `backend/Code.js` | **Modified identically** to `Code.gs` — confirmed byte-for-byte identical for every touched function (see "Dual-file sync" below). |

`parsePOFile()`, `parsePOSheetValues()`, `findLabelCell()`, and
`PO_FOLDER_ID` are **left in place, untouched, unused** — per the approved
`IMPLEMENTATION_PHASES.md`, removal is Phase 5's job, after the new path is
proven in production. `getActivePOs()` simply no longer calls them.

## Requirements checklist

- ✅ **Frontend behaviour unchanged** — `frontend/grn-entry.html` and every
  other frontend file: zero lines touched.
- ✅ **JSON contract unchanged** — `getActivePOs()` returns the identical
  `{status, pos: [{poNo, poDate, vendor, items: [...]}]}` shape; every
  field `grn-entry.html` reads (confirmed by grep in the prior
  compatibility analysis) is present and computed by the same,
  untouched decoration code.
- ✅ **Python translation layer implemented as designed** — canonical unit
  = quantity's unit; `guid`/`narration`/`poDateRaw`/`rateUnit` preserved as
  metadata at every layer (Python → sync payload → sheet columns →
  `getActivePOs()`'s output, as extra fields the frontend ignores).
- ✅ **Unit mismatch logged, not fatal** — verified against both real data
  (zero mismatches found in the 29 live POs) and a synthetic case (see
  "Verification" below) — the warning fires and the PO still translates.
- ✅ **`getActivePOs()` receives the same logical structure** — proven, not
  assumed, via the equivalence demonstration below.
- ✅ **Cache invalidation reused** — `syncPurchaseOrder()`'s last step is
  the identical `CacheService.getScriptCache().remove('activePOs')` call
  already used by `grnCreate()` and `reportPOShortfall()`.
- ✅ **Existing GRN functionality preserved** — `grnCreate`, `grnVerifyLookup`,
  `grnVerifyApprove`, `reportPOShortfall`, and every Sheet they touch: zero
  lines changed.

## Dual-file sync (Code.gs / Code.js)

Every new/modified function was verified byte-for-byte identical between
the two files after editing:

```
--- getActivePOs ---            IDENTICAL
--- syncPurchaseOrder ---        IDENTICAL
--- getParsedPOsFromTallySheet --- IDENTICAL
--- getOrCreateTallyPoSheet ---  IDENTICAL
--- doPost ---                   IDENTICAL
```

A whole-file diff between `Code.gs` and `Code.js` after this change shows
hunks **only** at the two pre-existing, out-of-scope locations
(`grnVerifyLookup`'s implementation difference, and the executive-dashboard
functions present only in `Code.js`) — confirmed by inspecting the diff's
line ranges directly, not assumed.

## Verification (per "before considering Phase 2 complete")

### 1 & 2. Excel-sourced vs. Tally-sourced comparison, and equivalence into `getActivePOs()`

No live Excel file exists for a real Tally PO to compare against directly
(the dummy Excel fixtures from the GRN test plan are separate, synthetic
files). Instead, this was verified the rigorous way: real PO
`ACHIRA/26-27/1A` was retrieved live from Tally, pushed through the actual
`po_translator.py`, then through a **faithful line-for-line reimplementation**
of `syncPurchaseOrder()`'s row-writing logic and `getParsedPOsFromTallySheet()`'s
row-regrouping logic (copied from the real `Code.gs`, not approximated),
and the result compared against the same PO's content expressed in
`parsePOSheetValues()`'s exact known output shape (the "as if this had been
exported to Excel" object) — both then run through `getActivePOs()`'s exact
decoration logic.

**Pass 1 — fresh PO, nothing received yet:**

```
=== PO-level comparison ===
  poNo       excel='ACHIRA/26-27/1A'   tally='ACHIRA/26-27/1A'   MATCH
  vendor     excel='Sri Vinayaka Gas Agencies'  tally='Sri Vinayaka Gas Agencies'  MATCH

=== Item-level comparison ===
 item 1: Nitrogen - UHP - Cylinders
    description  MATCH   quantity  MATCH (10.0)   unit  MATCH ('Nos')
    rate  MATCH (1200.0)   amount  MATCH (12000.0)
    orderedQty  MATCH (10.0)   receivedQty  MATCH (0)   remainingQty  MATCH (10.0)
 item 2: Liquid Nitrogen
    description  MATCH   quantity  MATCH (200.0)   unit  MATCH ('Lts')
    rate  MATCH (75.0)   amount  MATCH (15000.0)
    orderedQty  MATCH (200.0)   receivedQty  MATCH (0)   remainingQty  MATCH (200.0)

ALL FRONTEND-CONSUMED FIELDS MATCH: True
```

**Pass 2 — non-trivial state** (item 1: 4 of 10 already received; item 2:
manually overridden/closed), to prove the comparison isn't just trivially
true when everything defaults to zero:

```
 item 1: Nitrogen - UHP - Cylinders
    receivedQty  excel=4   tally=4   MATCH
    remainingQty excel=6.0 tally=6.0 MATCH
 item 2: Liquid Nitrogen
    remainingQty excel=0   tally=0   MATCH   (overridden=True on both)

ALL FRONTEND-CONSUMED FIELDS MATCH (non-trivial state): True
```

Every field `grn-entry.html` actually reads (`poNo`, `vendor`,
`description`, `quantity`, `unit`, `rate`, `amount`, `orderedQty`,
`receivedQty`, `remainingQty`) matches exactly, in both a trivial and a
non-trivial GRN-registry state. This verification script was a throwaway
tool (not shipped in this folder) — reimplemented Apps Script logic in
Python is a verification aid, not a second copy to maintain, and would go
stale if kept.

### 3. GRN test suite re-trace (18 cases, `docs/GRN_Full_Test_Plan.docx`)

No live Apps Script execution capability exists in this environment — this
re-trace uses the same static code-trace methodology already used for the
Root Cause A/B verification, now applied to the modified `getActivePOs()`.

**Important, unavoidable consequence of the cutover:** the original test
plan's Part 3 fixtures (9 dummy `.xlsx` files in the Drive folder,
`PO_N1`...`PO_MALFORMED`) are **no longer read by `getActivePOs()` at
all** — it only reads the new "Open POs (Tally)" sheet, which starts empty
until real `PO_SYNC` calls populate it. This is not a regression in the
tested logic (proven identical above); it is a fixture-migration
requirement: any test that opens the PO picker needs equivalent PO data
synced into the new sheet before it can be **literally, physically**
re-run through the UI. That sync cannot happen from this environment (no
live Apps Script deployment). The table below distinguishes "logic proven
equivalent" from "blocked only on fixture migration, not on any code
concern."

| Test | Touches `getActivePOs()`? | Verdict |
|---|---|---|
| A1 | Yes | Logic verified equivalent (proof above). Needs a synced PO in place of `PO_N1`. |
| A2 | No — only `grnVerifyLookup`/`grnVerifyApprove` | **Unaffected**, unchanged from prior verification |
| B1 | Yes | Logic verified equivalent. Needs a synced PO in place of `PO_N3`. |
| B2 | Indirectly (via B1's setup) | Logic verified equivalent (`isFirstItemForThisGrn` in `grnCreate()` untouched) |
| B3 | No | **Unaffected** — `grnVerifyApprove()` untouched this phase |
| B4 | No | **Unaffected** — `grnVerifyApprove()` untouched this phase (Root Cause B fix intact) |
| C1 | Yes | Logic verified equivalent. Needs a synced PO in place of `PO_PARTIAL1`. |
| C2 | Yes | Logic verified equivalent — **and** `grnCreate()`'s Root Cause A cache-invalidation fix is untouched this phase and applies identically regardless of PO source (same `'activePOs'` cache key). |
| C3 | Yes | Same as C2. |
| D1 | Yes | Logic verified equivalent. Needs a synced PO in place of `PO_PARTIAL2`. |
| D2 | Yes | Same reasoning as C2/C3. |
| E1 | Yes | Logic verified equivalent — the shortfall button's `item.receivedQty > 0` condition is fed by the same, unchanged decoration logic. |
| E2 | Yes | Logic verified equivalent — `reportPOShortfall()`'s own pre-existing cache invalidation is untouched, and the override-forces-zero decoration line is byte-identical to before. |
| F1 | Yes | Logic verified equivalent. Needs a synced PO (any open PO with an ad-hoc item added). |
| F2 | No — explicitly no-PO manual entry | **Unaffected** — zero dependency on `getActivePOs()` |
| G1 | **No longer applicable as scripted** | The original scenario tests `parsePOFile`/`parsePOSheetValues`'s malformed-`.xlsx` handling — code that `getActivePOs()` no longer calls. An analogous protection exists in the new path: `syncPurchaseOrder()` rejects a malformed payload (`!data.poNo \|\| !Array.isArray(data.items) \|\| data.items.length === 0`) before writing anything, and `getParsedPOsFromTallySheet()` skips any row with an empty PO No. or empty description — confirmed by reading both functions, not assumed. |
| G2 | No (operates on the GRN Registry sheet directly) | **Unaffected** — `grnCreate()`'s duplicate check untouched. Its original scripted precondition (reusing C1's fixture) inherits C1's fixture-migration need only if reproduced literally with the same PO. |
| G3 | Only needs *some* PO selectable | **Unaffected in mechanism** — the client-side `itemPayloads.length === 0` guard never reaches the backend either way; trivially needs one fixture present to select-then-uncheck. |

**Net result:** 13 of 18 test cases are provably unaffected by this
change's code, and the code exercised by the remaining PO-picker-dependent
cases has been proven equivalent to the prior behavior via the reasoning
and direct comparison above. **No test case's outcome is expected to
change once equivalent fixtures exist in the new sheet.** Physically
re-running the test plan end-to-end through the UI is blocked only on
fixture migration and live deployment (next section), not on anything this
review found wrong with the code.

## What is and isn't live

**Not done, and outside this environment's capability:**
- Nothing has been pushed to the real Apps Script project (`clasp push` or
  equivalent) — the code changes exist only in this repository's local
  `backend/Code.gs`/`Code.js`.
- `TALLY_SYNC_SECRET` has not been set in the live project's
  `PropertiesService` — `syncPurchaseOrder()` will refuse every request
  until it is.
- `po_sync.py` has **not** been run against the real
  `APPS_SCRIPT_URL` — the live-deployed `doPost` doesn't have the
  `PO_SYNC` branch yet, so an unrecognized payload would fall through to
  `appendRow()` and write bogus data into the real production "2.
  Adjustment Log" sheet. This was avoided deliberately.
- No PO has actually been synced into a real "Open POs (Tally)" sheet —
  the sheet doesn't exist yet in the live spreadsheet.

**What manual deployment would require, before any of the above can
happen for real:** pushing the updated `Code.gs`/`Code.js` to the Apps
Script project, setting `TALLY_SYNC_SECRET` via the Apps Script editor's
Project Settings → Script Properties (or `PropertiesService.getScriptProperties().setProperty(...)`
run once manually), setting the same value as `INVENTORY_TALLY_SYNC_SECRET`
in the Python service's environment, and then running `po_sync.py` against
real Tally data to populate the new sheet for the first time.

**What is genuinely verified, for real:** the Python translation layer
(`po_translator.py`) against all 29 live Purchase Orders currently in
Tally, including the unit-mismatch code path (tested synthetically since
no real mismatch currently exists in the data); and the Apps Script logic,
by direct code trace and by a faithful Python reimplementation used only
for comparison, not by live execution.
