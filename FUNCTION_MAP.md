# Function Map — Backend (Apps Script)

All functions below live in `backend/Code.gs` unless marked **[Code.js
only]** — those five exist only in `Code.js` and are missing from `Code.gs`
(see `KNOWN_ISSUES.md` §1). Where a function is called by an `action=`/`type=`
value, the calling frontend page(s) are named.

## Entry points

### `doPost(e)`
- **Purpose:** single POST entry point; routes on `data.type`.
- **Params:** `e.parameter.data` (JSON string) or `e.postData.contents`.
- **Routes:** `MATERIAL_REQUEST` → `appendMaterialRequest`; `ARN_ASSIGN` →
  `arnAssign`; `ARN_APPROVE` → `arnApprove`; `ARN_REJECT` → `arnReject`;
  `GRN_CREATE` → `grnCreate`; anything else → `appendRow` (the default
  Inventory Adjustment write).
- **Called by:** `index.html` (default), `request.html`
  (`MATERIAL_REQUEST`), `arn-assign.html` (`ARN_ASSIGN`, via `no-cors`
  fetch — note `ARN_APPROVE`/`ARN_REJECT`/`GRN_CREATE` POST routes exist here
  but the frontend actually calls their equivalents via GET/JSONP instead:
  `approve`/`reject`/`grncreate`).
- **Error handling:** try/catch around the whole body; returns
  `{status:'error', message}` with HTTP 500 on any thrown error.
- **Validation:** none at this layer — delegated to the routed function.

### `doGet(e)`
- **Purpose:** single GET entry point; routes on `e.parameter.action`, a
  ~20-branch `if/else` chain. Every branch optionally wraps its JSON response
  in `callback(...)` if `e.parameter.callback` is present (JSONP).
- **Action → function table:**

| `action` | Calls | Used by |
|---|---|---|
| `list` | `getPendingItemsForPerson` | `arn-assign.html` |
| `activePOs` | `getActivePOs` | `grn-entry.html` |
| `poShortfall` | `reportPOShortfall` | `grn-entry.html` |
| `cashoutflow` | `verifyGoogleIdToken` + `getCashoutflowSummary` **[latter is Code.js-only]** | `overhead.html` |
| `assign` | `arnAssign` | `arn-assign.html` |
| `dupcheck` | `findDuplicates` | `arn-assign.html` |
| `approve` | `arnApprove` | `arn-assign.html` |
| `reject` | `arnReject` | `arn-assign.html` |
| `grnlookup` | `verifyGrnExists` | `index.html` |
| `itemlist` | `getMasterItemListForSearch` | `index.html`, `request.html` |
| `employees` | `getEmployeeList` | `index.html`, `grn-entry.html`, `grn-verify.html` |
| `grntabs` | `getGrnCategoryTabs` | `grn-entry.html` |
| `grnprefixes` | `getPrefixesForTab` | `grn-entry.html` |
| `grnsuggest` | `suggestNextGrnFields` | `grn-entry.html` |
| `grncreate` | `grnCreate` | `grn-entry.html` |
| `grnverifylookup` | `grnVerifyLookup` | `grn-verify.html` |
| `grnverify` | `grnVerifyApprove` | `grn-verify.html` |
| `overhead` | `verifyGoogleIdToken` + `getOverheadSummary` **[both Code.js-only]** | `overhead.html` |
| *(none)* | returns `{status:'ok', message:'...API is running'}` | health check |

- **Error handling:** try/catch around the whole body; JSONP-wraps errors
  too if a callback was given, else HTTP 500.

## Inventory Adjustment

### `appendRow(d)`
- **Purpose:** writes one row to "2. Adjustment Log". The core write behind
  `index.html`'s submit and the default `doPost` branch.
- **Validation:** throws if `adjType === 'Inward'` and `issuedTo` or
  `expiryDate` is missing (business rule: restocks must record who it's for
  and its expiry).
- **Behavior:** auto-generates `Adj ID` (`ADJ-####`, via `getNextAdjSerial`)
  if the caller didn't supply one — added specifically so non-UI callers
  (e.g. another internal system) don't need to know this app's ID scheme.
- **Sheets:** `SHEET_ID` → "2. Adjustment Log" (creates it via
  `getOrCreateSheet` if missing).
- **Side effects:** styles the new row (`styleNewRow`).

### `getOrCreateSheet(ss)` / `styleNewRow(sheet, rowNum, effect)`
- Create-if-missing + cosmetic formatting helpers for the Adjustment Log tab.
  `styleNewRow` colors cells by effect (`+Add` green, `-Deduct` red), Issue
  rows purple, ARN column monospace/blue.

### `logOpeningStockAdjustment(details)`
- **Purpose:** writes an `Inward`/`+Add` "opening stock" row to the
  Adjustment Log when a new item's ARN is approved (bridges ARN Assignment →
  Inventory Adjustment).
- **Called by:** `arnApprove`, internally.

### `getNextAdjSerial(sheet)`
- Scans column A for the highest existing `ADJ-####`, returns `max+1`
  zero-padded to 4 digits. **No lock** — see `KNOWN_ISSUES.md` §6.

### `getMasterItemListForSearch()`
- **Purpose:** returns a lightweight array (`{a,n,u,w,d}` = ARN, name, unit,
  warehouse, dept) of the entire Master Item List for client-side search.
- **Sheets:** container-bound spreadsheet, "1. Master Item List" (via
  `getActiveSpreadsheet()` — see `KNOWN_ISSUES.md` §5). Skips rows 1–2
  (title + header row), starts at row 3.
- **Called by:** `action=itemlist` — `index.html`, `request.html`.
- **Performance note:** full-sheet read on every call, no caching.

## Material Requests

### `appendMaterialRequest(d)`
- **Purpose:** appends a row to "6. Material Requests" with status
  `Pending`.
- **Called by:** `doPost` (`type=MATERIAL_REQUEST`) ← `request.html`.
- **Sheets:** `SHEET_ID` → "6. Material Requests" (`getOrCreateRequestSheet`).
- **No validation** at this layer (frontend validates required fields
  client-side only).

### `getOrCreateRequestSheet(ss)`
- Create-if-missing + header styling for "6. Material Requests" (19 columns —
  see `DATA_MODEL.md`).

### `getPendingItemsForPerson(person, dept)`
- **Purpose:** returns pending "7. ARN Pending" rows where `row.requestedBy
  === person` OR `row.requesterDept === dept`.
- **Called by:** `action=list` ← `arn-assign.html` Approve tab.
- **Note:** this reads the **ARN Pending** sheet, not Material Requests —
  despite the generic name, it's specifically for the ARN approval queue,
  not for viewing material requests. There is no backend endpoint that lists
  Material Requests back to any frontend page — that sheet is write-only
  from the app's perspective (presumably reviewed directly in Sheets by
  stores staff).

## ARN Assignment / Approval / Rejection

### `arnAssign(data)`
- **Purpose:** the core "propose a new item" write. Validates GRN existence
  (or handles the personal-purchase path), checks for duplicates, appends to
  "7. ARN Pending" with status `Pending`.
- **Params:** `material, brand, qty, unit, dept, subcat, requestedBy,
  grn, notes, location, isPersonalPurchase, personalVendor, personalAmount,
  personalBill, personalPaidBy, procurementRef, duplicateAcknowledged,
  orderingDept`.
- **Validation:**
  - Duplicate check (`findDuplicates`) — blocks submission unless
    `duplicateAcknowledged` is true, returning `needsDuplicateAck: true` +
    the matches.
  - Personal purchase: requires `personalVendor`, positive
    `personalAmount`, `personalPaidBy`.
  - Non-personal: requires `grn`, and the GRN must already exist in the GRN
    registry (`verifyGrnExists`) — **items cannot be assigned an ARN until
    procurement has logged the GRN first.**
- **Concurrency:** personal-purchase branch acquires `LockService`
  (`tryLock(30000)`) around `getNextPRN()` to avoid two simultaneous personal
  purchases getting the same PRN number.
- **Sheets:** "7. ARN Pending" (27 columns, see `DATA_MODEL.md`).
- **Slack/Email:** if personal purchase, calls `notifyPersonalPurchase`.
- **Called by:** `action=assign` ← `arn-assign.html` (also reachable via
  `doPost type=ARN_ASSIGN`, unused by the current frontend).

### `getNextPRN()`
- Generates `PRN-YYYYMM-NNN` (monthly-reset serial) by scanning "7. ARN
  Pending" column F (GRN No.) for the current month's prefix. Called only
  from inside `arnAssign`'s lock.

### `verifyGrnExists(grn)`
- **Purpose:** scans **every tab** of the GRN Registry spreadsheet for a
  matching "GRN No." (case-insensitive, trimmed), returns
  `{found, vendor, poNo, description, issuedTo}` from the first match.
- **Performance note:** full `getDataRange()` on every tab, every call — no
  caching, no early exit optimization beyond stopping at first match.
  Handles a known header typo (`"issued  to"` with two spaces vs `"issued
  to"`).

### `findDuplicates(material, brand)`
- **Purpose:** possible-duplicate detector, checked live as the user types
  in `arn-assign.html` (debounced 600ms) and again server-side inside
  `arnAssign` before allowing submission.
- **Logic:** normalizes name (`normaliseForMatch` — lowercase,
  non-alphanumeric → space) and compares against (1) the Master Item List
  (up to 5 matches) and (2) other currently-`Pending` ARN requests (up to 8
  matches). Brand match, if both sides have a brand, narrows results and is
  reported back as `brandConfirmed`.
- **Performance note:** full-sheet reads on both sheets, on every keystroke
  (debounced) — same pattern as `verifyGrnExists`.

### `arnApprove(data)`
- **Purpose:** approves a pending ARN Pending row: mints the final ARN code,
  appends a row to the Master Item List, logs an opening-stock Inward
  adjustment, marks the pending row `Approved`.
- **Authorization check:** `data.person` must equal the row's
  `requestedBy`, OR `data.personDept` must equal the row's `Requester Dept`
  — otherwise rejected with "Only X or someone else in their department can
  approve this item." **This is a string comparison against client-supplied
  data, not real authentication** (`KNOWN_ISSUES.md` §3).
- **Idempotency:** if already `Approved`, returns the existing ARN instead
  of re-processing.
- **Concurrency:** wrapped in `LockService.getScriptLock().tryLock(30000)`
  for the whole approve — correctly serializes ARN minting.
- **Sheets:** "7. ARN Pending" (read/write), "1. Master Item List" (append),
  "2. Adjustment Log" (via `logOpeningStockAdjustment`).
- **Called by:** `action=approve` ← `arn-assign.html`.

### `arnReject(data)`
- **Purpose:** "send back" a pending item with a corrected
  dept/subcat/reason; sets status `Needs Correction`.
- **Authorization check:** same requester-or-same-dept logic as
  `arnApprove`, same caveat.
- **No lock** — lower risk than approve since it doesn't mint anything, but
  still a theoretical lost-update race if two people reject simultaneously
  (last write wins, no error).
- **Called by:** `action=reject` ← `arn-assign.html`.

### `getNextAvailableArn(master, dept, subcat)`
- Generates `ACH-{dept}-{subcat}-####` by scanning the Master Item List's
  ARN column for the highest existing number with that prefix. Called only
  from inside `arnApprove`'s lock, so it's effectively race-safe in
  practice.

### `getOrCreateArnPendingSheet()`
- Create-if-missing + **self-healing header row**: compares the sheet's
  existing header row against `ARN_PENDING_HEADERS` (27 columns) and
  rewrites it if they differ at all. This runs on *every* call that touches
  the ARN Pending sheet, not just creation — a lightweight schema-migration
  mechanism.

## GRN (Goods Receipt Note)

### `getGrnCategoryTabs()`
- Returns the names of every tab in the GRN Registry spreadsheet whose
  header row contains "grn no." — this is how the category/tab list is
  discovered dynamically rather than hardcoded.
- **Called by:** `action=grntabs` ← `grn-entry.html`.

### `getPrefixesForTab(tabName)`
- **Purpose:** derives the GRN-number prefixes actually used on a given tab
  (regex `^(.*\/)(\d+)$` against every existing GRN No.), ranked by
  frequency — replaced a previous hardcoded, tab-agnostic prefix list (see
  `FIX:` comment).
- **Called by:** `action=grnprefixes` ← `grn-entry.html`.

### `suggestNextGrnFields(tabName, prefix)`
- **Purpose:** suggests the next Sl No. (max existing + 1) and, if a prefix
  is given, the next GRN No. under that prefix (max existing + 1, skipping
  any that already exist).
- **No lock** — two people filling the form concurrently can both be handed
  the same suggested numbers (`KNOWN_ISSUES.md` §6). `grnCreate`'s own
  duplicate check only catches an exact GRN No. + description collision, not
  a Sl No. collision.
- **Called by:** `action=grnsuggest` ← `grn-entry.html`.

### `getGrnHeaderColumnMap(sheet)` / `normalizeGrnHeader(h)` / `GRN_FIELD_HEADER_KEYWORDS`
- **Purpose:** fuzzy header-matching layer — maps 23 canonical field names
  (`slNo`, `grnNo`, `materialDescription`, `invoiceAmount`, etc.) to whatever
  column actually has a matching header on a given tab, tolerant of
  spacing/case/typos (`GRN_FIELD_HEADER_KEYWORDS` includes accommodations
  for known typos like `invoicveamount`, `zohoentryby` duplicated, `ramarks`
  for "remarks"). This is what lets one generic `grnCreate`/`grnVerifyLookup`
  work across many differently-worded category tabs.
- **Risk:** if a tab's header doesn't match any keyword, that field is
  silently dropped (`grnCreate`'s `skippedFields`) — surfaced to the user
  only as a one-line note, not a hard error.

### `findGrnColumn(sheet, headerText)`
- Exact (post-trim/lowercase) header lookup — used for "GRN No.",
  "Verification Status", "Verified By", "Verified Date" specifically
  (headers that must match precisely, not fuzzily).

### `ensureGrnVerificationColumns(sheet)`
- Appends "Verification Status" / "Verified By" / "Verified Date" columns to
  a tab if not already present — self-healing schema, run before every
  `grnCreate`/`grnVerifyApprove`.

### `grnCreate(data)`
- **Purpose:** the GRN Entry write. One call = one line item; multi-item
  deliveries are multiple calls from the frontend, sharing one GRN No.
- **Validation:** `tabName`, `grnNo`, `materialDescription` required.
  Rejects only if the **exact** GRN No. + **exact** item description
  already exists on that tab (allows legitimate multi-item GRNs under the
  same number, only blocks accidental double-submit of the same line).
- **Sheets:** GRN Registry, the named tab.
- **Slack:** `notifyGrnForVerification`, but **only on the first item** for
  a given GRN No. (`isFirstItemForThisGrn`) — avoids spamming the requester
  once per line item on a multi-item delivery.
- **Called by:** `action=grncreate` ← `grn-entry.html` (also reachable via
  `doPost type=GRN_CREATE`, unused by current frontend).

### `notifyGrnForVerification(details)`
- **Purpose:** builds and sends the Slack message prompting the requester to
  verify a GRN, with a direct link to `grn-verify.html?tab=...&grn=...`
  (hardcoded to `https://siddharthramkrishnan.github.io/inventory/...` —
  see `KNOWN_ISSUES.md` §9 re: environment coupling). Resolves the
  requester's Slack member ID via `getSlackUserId` for an `@mention`; falls
  back to plain name text if not found.
- **Failure handling:** wrapped in try/catch — a Slack failure never blocks
  the GRN write itself (already committed by the time this runs).

### `getSlackUserId(name)`
- Looks up a Slack member ID from the "Slack-user IDs" tab in the GRN
  Registry spreadsheet, matching against any column whose header contains
  "name" (preferring "display name"), validating the found value looks like
  a real Slack ID (`/^[UW][A-Z0-9]{6,}$/i`) before using it.

### `getEmployeeList()` / `getSlackUserIdsTabNames()` / `getOrCreateEmployeesSheet()`
- **Purpose:** the canonical employee list, preferring names from the
  "Slack-user IDs" tab (GRN Registry spreadsheet) and falling back to a
  local "Employees" sheet (container-bound spreadsheet) if that tab is
  missing/unreadable.
- **Called by:** `action=employees` ← `index.html`, `grn-entry.html`,
  `grn-verify.html`. (Not used by `arn-assign.html`/`request.html`, which
  each hardcode their own separate employee lists — `KNOWN_ISSUES.md` §7.)

### `grnVerifyLookup(tabName, grnNo)`
- **Purpose:** returns every row sharing a GRN No. on a tab (multi-item
  deliveries shown together), keyed by canonical field names via
  `getGrnHeaderColumnMap` so the Verify page always finds values regardless
  of a tab's exact header spelling.
- **Performance:** rewritten (see `FIX:` comment, line 929) to read only the
  GRN No. column first to find matching row numbers, then read only those
  specific rows — replaced an earlier full-tab read that was slow/erroring
  on 2000+-row tabs. **This fix exists only in `Code.gs`** — `Code.js` still
  has the old full-tab-scan version (`KNOWN_ISSUES.md` §1).
- **Called by:** `action=grnverifylookup` ← `grn-verify.html`.

### `grnVerifyApprove(tabName, grnNo, person, selectedDescriptions)`
- **Purpose:** marks selected line items under a GRN No. as `Verified`,
  stamping `Verified By`/`Verified Date`. If `selectedDescriptions` is
  given, only matching rows are approved (others stay `Pending
  Verification`); if omitted, approves everything under that GRN No.
  (backward-compatible default).
- **Idempotent:** already-`Verified` rows are left untouched, counted
  separately (`alreadyVerifiedCount`).
- **Called by:** `action=grnverify` ← `grn-verify.html`.
- **No authentication** — `person` is a free-text field; anyone with the
  Slack-shared link can approve as anyone.

## Purchase Orders (Drive-backed)

### `findLabelCell(values, labelText)` / `parsePOSheetValues(values)` / `parsePOFile(file)`
- **Purpose:** parses a vendor PO `.xlsx` file's raw cell grid into
  `{poNo, poDate, vendor, items: [{slNo, description, quantity, rate, unit,
  amount}]}` by locating label cells ("Voucher No.", "Dated", "Supplier
  (Bill from)", "Sl") rather than fixed coordinates — tolerant of PO
  template layout differences.
- **`parsePOFile`:** since Sheets formulas can't read `.xlsx` directly,
  makes a **temporary Google Sheets copy** via `Drive.Files.copy` (advanced
  Drive service), reads it, then deletes the temp copy in a `finally` block
  (best-effort cleanup — a failure to delete is swallowed).

### `getReceivedQtyByPOAndItem()`
- **Purpose:** sums received quantity per `(PO No. + normalized item
  description)` across **every tab** of the GRN Registry, so partial
  deliveries can be tracked per line item rather than per PO as a whole
  (see `FIX:` comment — previously tracked per-PO only, which broke partial
  receipt of a single item across multiple deliveries).

### `getOrCreatePOOverridesSheet()` / `getPOOverrideKeys()` / `reportPOShortfall(...)`
- **Purpose:** "PO Manual Overrides" tab in the GRN Registry spreadsheet —
  a human declares a specific PO line item as never-coming-in-full (vendor
  short-shipped). `reportPOShortfall` validates `poNo`, `itemDescription`,
  `closedBy` are present, appends a row, and invalidates the `activePOs`
  cache so the change is visible immediately.
- **Called by:** `action=poShortfall` ← `grn-entry.html` (shortfall button,
  shown only once something has already been partially received).

### `getActivePOs()`
- **Purpose:** lists every open PO from `PO_FOLDER_ID` (Drive), decorated
  per item with `orderedQty`/`receivedQty`/`remainingQty`/`overridden`; a
  PO is "open" if any item still has `remainingQty > 0`.
- **Caching:** `CacheService.getScriptCache()`, 5 minutes
  (`PO_CACHE_SECONDS`).
- **Called by:** `action=activePOs` ← `grn-entry.html`.

### `authorizeDriveAccess()`
- One-off manual diagnostic (logs folder name + `.xlsx` file count) to force
  the Drive OAuth consent prompt during setup. Not called by any frontend or
  trigger.

## Notifications

### `notifyPersonalPurchase(details)`
- **Purpose:** emails Accounts+Procurement (`MailApp`) and posts to
  `SLACK_WEBHOOK_URL` when a personal (out-of-pocket) purchase is logged via
  `arnAssign`, asking Accounts to reimburse and Procurement to raise a
  retroactive PO.
- **Failure handling:** email and Slack are each independently try/caught —
  one failing doesn't block the other, and neither blocks the underlying
  ARN Pending write (already committed).

### `sendWeeklyPrnDigest()`
- **Purpose:** a **time-driven trigger function** (not called by any
  frontend/HTTP path) that emails + Slacks a summary of all
  `Awaiting Reimbursement` personal purchases, sorted oldest-first, with a
  running total. `checkSetup()` explicitly checks whether a trigger for this
  function is installed and warns if not — implying it must be wired up
  manually via Apps Script's trigger UI, and there is nothing in this repo
  that guarantees it's actually scheduled.

## Diagnostics (manual-only, not wired to any trigger or frontend call)

### `checkSetup()`
- Prints a checklist to the log: Master Item List reachable + expected
  headers (checks **row 2**, implying a two-row header — title row + column
  header row), ARN Pending headers match exactly, GRN registry reachable
  and how many tabs have a "GRN No." column, Accounts email configured,
  Slack webhook configured, weekly-digest trigger installed, and
  (`Code.gs` version only) whether the overhead sheet's "CashOutflow Vendor
  Detail" tab exists — this last check will itself throw if
  `OVERHEAD_SHEET_ID` isn't defined in the deployed scope (`KNOWN_ISSUES.md`
  §1).

### `testNotifications()`
- Sends a fake personal-purchase notification through
  `notifyPersonalPurchase` for manual verification that email + Slack are
  wired up correctly.

## Overhead / Cash Outflow Dashboard **[Code.js only — missing from Code.gs]**

### `authorizeExternalRequests()` **[Code.js only]**
- One-off diagnostic to force the `script.external_request` OAuth scope
  consent prompt (calls `UrlFetchApp.fetch('https://www.google.com')`).

### `verifyGoogleIdToken(idToken)` **[Code.js only]**
- **Purpose:** server-side verification of a Google Sign-In ID token via
  `https://oauth2.googleapis.com/tokeninfo` — checks HTTP 200, `aud` matches
  `OVERHEAD_GOOGLE_CLIENT_ID`, `email_verified`, and extracts `email`.
- **Returns:** `{email, reason}` — `email` is `null` with a human-readable
  `reason` on any failure.
- **Note:** Google's own docs describe the `tokeninfo` endpoint as
  rate-limited and intended for debugging, not high-volume production
  verification; local JWT signature verification (JWKS) would be the
  documented production approach. Low volume here (4 allowlisted users)
  makes this a minor concern in practice.
- **Called by:** `doGet` `action=overhead` and `action=cashoutflow`.

### `getOverheadSummary()` **[Code.js only]**
- **Purpose:** reads "Category Summary" and "Raw Data" tabs from
  `OVERHEAD_SHEET_ID`, computes month-over-month category totals, % of
  total, average run-rate **excluding the current (in-progress) month**,
  projected FY total (run-rate × 12), largest category, and top 5 ledger
  lines YTD.
- **Fragility:** locates the header row by searching for the literal string
  `'Category'` in column A, and the grand-total row by literal string
  `'TOTAL OVERHEAD'` — breaks silently (returns a generic "layout may have
  changed" error) if the sheet is restructured or relabeled.

### `getCashoutflowSummary()` / `getTopCashoutflowVendors()` **[Code.js only]**
- Same pattern as `getOverheadSummary()`, applied to "CashOutflow Category
  Summary" / "CashOutflow Vendor Detail" tabs. Distinguishes an
  "Uncategorized" bucket (payments not traceable to a category via bill
  reference) and reports its % separately, with UI copy explicitly framing
  it as a bookkeeping gap rather than a data error.
