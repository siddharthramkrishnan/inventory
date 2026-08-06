# PO Import Architecture

Status: **design proposal — not yet approved, no implementation code
written.**

## 1. Current PO flow — exact code evidence

Every claim in this section is drawn directly from `backend/Code.gs`
(confirmed identical in `backend/Code.js` for these particular functions —
see §7) and `frontend/grn-entry.html`.

### 1.1 Where POs come from today

- **Storage:** a single Google Drive folder, `PO_FOLDER_ID =
  '1jg23hI1qSep_sslbUUr_wlimR0b07YeZ'`, containing one `.xlsx` file per
  PO, manually placed there.
- **Discovery:** `getActivePOs()` calls
  `DriveApp.getFolderById(PO_FOLDER_ID).getFilesByType(MimeType.MICROSOFT_EXCEL)`
  — every `.xlsx` file in that folder is a candidate PO, every time this
  function runs (on a cache miss).

### 1.2 How a PO file becomes structured data

```
getActivePOs()
  └─ parsePOFile(file)              — per file
       ├─ Drive.Files.copy(...)     — .xlsx → temp Google Sheet (Sheets API can't read .xlsx directly)
       ├─ SpreadsheetApp.openById(tempFile.id).getSheets()[0].getDataRange().getValues()
       ├─ parsePOSheetValues(values)
       │    ├─ findLabelCell(values, 'Voucher No.')         → PO No.
       │    ├─ findLabelCell(values, 'Dated')                → PO Date
       │    ├─ findLabelCell(values, 'Supplier (Bill from)') → Vendor
       │    ├─ findLabelCell(values, 'Sl')                   → line-item table header row
       │    └─ walks rows below the 'Sl' header until a non-numeric/zero
       │       Sl value, extracting description/quantity/rate/unit/amount
       │       by matching column headers ('description', 'quantity',
       │       'rate', 'per', 'amount')
       └─ Drive.Files.remove(tempFile.id)   — best-effort cleanup, in `finally`
```

`parsePOFile`/`parsePOSheetValues` return `null` (not a throw) for any
file that doesn't have a recognizable "Voucher No." + "Sl" table structure
— this is how a malformed file is silently skipped rather than breaking
the whole picker (established and verified in `TEST_RESULTS.md`, test G1).

### 1.3 How received/remaining quantity and overrides are applied

`getActivePOs()` decorates each parsed PO's items with:
- `orderedQty` — from the parsed file's `quantity` field.
- `receivedQty` — from `getReceivedQtyByPOAndItem()`, which scans **every
  tab** of `GRN_REGISTRY_SHEET_ID` for rows matching `(PO No. + normalized
  item description)` and sums their logged quantity.
- `remainingQty` — `max(orderedQty - receivedQty, 0)`, forced to `0`
  regardless of the arithmetic if `getPOOverrideKeys()` shows this
  `(PO No. + item)` pair has been manually closed via
  `reportPOShortfall()`.
- A PO is included in the result only if at least one item has
  `remainingQty > 0` (`isOpen`).

### 1.4 Caching

The full result — every open PO, fully decorated — is cached under one key,
`'activePOs'`, via `CacheService.getScriptCache()`, for `PO_CACHE_SECONDS`
(300 seconds). `grnCreate()` and `reportPOShortfall()` both invalidate this
key immediately after a write that could change it (established in
`ROOT_CAUSE_A_FIX_REPORT.md`).

### 1.5 How the frontend consumes it

`grn-entry.html`, `loadActivePOs()`:
```js
const result = await jsonp('activePOs', {});
if (result && result.status === 'success' && Array.isArray(result.pos) && result.pos.length) {
  activePOsData = result.pos;
  result.pos.forEach(function(po, idx) { /* populate <select> */ });
}
```
and, on selecting a PO, `po.items` is filtered/rendered directly — reading
`item.description`, `item.quantity`, `item.rate`, `item.unit`,
`item.amount`, `item.orderedQty`, `item.receivedQty`, `item.remainingQty`.
**This is the entire contract the frontend depends on.** It does not know
or care whether the data behind it came from a Drive file or anywhere
else.

### 1.6 Which Sheets/Drive locations are involved today

| Location | Role |
|---|---|
| Drive folder `PO_FOLDER_ID` | Source of PO `.xlsx` files (**being replaced**) |
| `GRN_REGISTRY_SHEET_ID` → per-category tabs | Read by `getReceivedQtyByPOAndItem()` (**unchanged**) |
| `GRN_REGISTRY_SHEET_ID` → "PO Manual Overrides" | Read/written by `getPOOverrideKeys()`/`reportPOShortfall()` (**unchanged**) |

---

## 2. Why Apps Script cannot talk to Tally directly

TallyPrime's XML/HTTP interface listens on the machine running Tally
(commonly `localhost` or a LAN address), not on a publicly reachable
internet endpoint. `UrlFetchApp` (Apps Script's only outbound HTTP
mechanism) can only reach addresses reachable from Google's servers — it
cannot reach a LAN-local or `localhost` Tally instance. This is why a
Python intermediary is necessary at all, and why the existing "working
Python connection to TallyPrime" is the correct integration point to build
on rather than something to route around.

## 3. Proposed component design

```mermaid
flowchart LR
  Tally[(TallyPrime<br/>XML/HTTP interface)]
  Py[Python sync service<br/>existing Tally connection]
  GAS[Apps Script Web App<br/>doPost — new action]
  Sheet[(New Sheet tab:<br/>"Open POs (Tally)"<br/>in GRN_REGISTRY_SHEET_ID)]
  Cache[(CacheService<br/>'activePOs' key)]
  GRNE[grn-entry.html<br/>UNCHANGED]

  Tally -- "XML export request<br/>(existing connection)" --> Py
  Py -- "HTTPS POST, one PO per request,<br/>JSON body + shared secret" --> GAS
  GAS -- "validate secret + shape,<br/>upsert row(s)" --> Sheet
  GAS -- "invalidate on write" --> Cache
  GRNE -- "action=activePOs (unchanged)" --> GAS
  GAS -- "getActivePOs() now reads Sheet<br/>instead of Drive; same return shape" --> GRNE
```

### 3.1 Two options considered for the Python → Google leg

| | **Option A (recommended): Python → Apps Script `doPost`** | Option B: Python → Google Sheets API directly |
|---|---|---|
| New credentials needed | One shared secret, stored in Apps Script `PropertiesService` | A Google Cloud service account, granted edit access to the spreadsheet, credentials managed on the Python host |
| Consistency with existing system | Matches how every other write in this system already happens (one Web App URL, `doPost`, `type`-routed) | A second, parallel write path into the same spreadsheet, outside the existing Web App |
| Retry/error signaling | Synchronous HTTP response with `{status, message}}`, same convention as every other endpoint in this codebase | Sheets API call succeeds/fails on its own; no natural place to run validation/business logic before the write |
| Where validation lives | Apps Script (one place, same place as everything else) | Python (a second place validation logic would need to live) |
| New infrastructure | None — reuses the existing Web App deployment | New GCP service account + share grant on the spreadsheet |

**Recommendation: Option A.** It reuses infrastructure that already
exists, keeps validation and business logic in the one place this codebase
already puts it, and gives Python a synchronous success/failure signal it
can act on immediately — directly useful for the retry strategy in §6.

### 3.2 New Apps Script surface

One new branch in the existing `doPost(e)` routing chain
(`backend/Code.gs`, confirmed current source):

```js
function doPost(e) {
  try {
    let data;
    if (e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data);
    } else {
      data = JSON.parse(e.postData.contents);
    }
    if (data.type === 'MATERIAL_REQUEST') { ... }
    else if (data.type === 'ARN_ASSIGN') { ... }
    else if (data.type === 'ARN_APPROVE') { ... }
    else if (data.type === 'ARN_REJECT') { ... }
    else if (data.type === 'GRN_CREATE') { ... }
    // NEW: else if (data.type === 'PO_SYNC') { return jsonResponse(syncPurchaseOrder(data)); }
    else { appendRow(data); ... }   // ← the new branch MUST come before this catch-all,
  }                                  //   or an unrecognized-but-intended PO_SYNC payload
}                                    //   would be silently written as a bogus Adjustment Log row.
```

`doPost` already supports parsing a raw JSON body via
`e.postData.contents` (the `else` branch of its existing parse logic) —
this is the path Python should use (`requests.post(url, json=payload)`),
not the form-encoded `e.parameter.data` path the browser-based frontend
pages use for CORS reasons that don't apply to a server-to-server Python
client. **No new parsing logic is needed in `doPost` for this — the
capability already exists and is already exercised by every other POST
type.**

A new function, `syncPurchaseOrder(data)` (naming illustrative, not
prescriptive — final naming is an implementation detail), would:
1. Validate a shared-secret field in `data` against a value stored in
   `PropertiesService.getScriptProperties()` (see §8 — not hardcoded like
   this codebase's other constants).
2. Validate the payload shape (PO No., date, vendor, and a non-empty items
   array with description/quantity/rate/unit/amount per item — see
   `FIELD_MAPPING.md`).
3. Upsert the PO's rows into the new "Open POs (Tally)" sheet tab —
   look up existing rows by PO No. (and, if available from Tally, a stable
   internal voucher identifier — see `FIELD_MAPPING.md` §"Idempotency
   key") and replace them, rather than blindly appending, so re-syncing an
   unchanged PO is a no-op and re-syncing a changed PO doesn't leave stale
   duplicate rows behind.
4. Invalidate the `'activePOs'` cache — the same pattern already used by
   `grnCreate()` and `reportPOShortfall()` (`ROOT_CAUSE_A_FIX_REPORT.md`)
   — so a newly-synced PO appears in the picker immediately, not after
   waiting out `PO_CACHE_SECONDS`. **This is not a new idea invented for
   this document — it is the exact fix already applied to this codebase
   for the identical class of bug, applied proactively here so the new
   integration doesn't reintroduce it.**
5. Return `{status:'success', poNo, itemsWritten}` or
   `{status:'error', message}}`, following the exact convention every
   other backend function in this codebase already uses.

### 3.3 Changes to `getActivePOs()` itself

Its **output contract does not change**. Its internals change from
"iterate Drive files, parse each" to "read the 'Open POs (Tally)' sheet
tab, group rows by PO No.":

```
Before: DriveApp.getFolderById(PO_FOLDER_ID) → per-file parse → pos[]
After:  sheet.getDataRange().getValues() → group rows by PO No. → pos[]
```

The decoration step (`getReceivedQtyByPOAndItem()`, `getPOOverrideKeys()`,
`remainingQty`/`isOpen` computation, the 5-minute cache) is **unchanged** —
it already operates on the parsed-PO shape, independent of where that
shape came from.

This also removes the single most expensive operation in the current
backend (per PO, per cache miss: one `Drive.Files.copy`, one
`SpreadsheetApp.openById`, one `Drive.Files.remove` — flagged as a
performance/quota concern in the original architecture review). This is a
direct consequence of replacing the PO source, not a separate optimization
being bundled in.

## 4. Data synchronization strategy

- **Direction:** one-way, Tally → Inventory Management System. This system
  never writes back to Tally.
- **Trigger:** the Python service polls Tally on a schedule (interval is
  an operational parameter, not fixed by this architecture — it should be
  chosen based on how quickly a newly-created PO needs to become visible
  to warehouse staff; the existing 5-minute `PO_CACHE_SECONDS` is a
  reasonable reference point, not a hard requirement, since a sync-time
  cache invalidation makes a new PO visible immediately regardless of the
  cache TTL).
- **Change detection:** Tally's XML/ODBC interface supports incremental
  change tracking (each voucher carries an internal alteration marker that
  increases whenever it's created or edited) — the Python service should
  request only vouchers changed since its last successful sync, rather
  than re-exporting every PO on every poll. **This should be confirmed
  against the specific capabilities of the existing Python↔Tally
  connection before being relied upon** — this document does not have
  visibility into that connection's current implementation.
- **Granularity:** one HTTP POST per PO (not one call per line item, and
  not one call for an entire batch of POs). This bounds each request's
  size, keeps partial-failure handling simple (one PO failing to sync
  doesn't block or roll back any other), and mirrors this codebase's
  existing convention of one call per unit-of-work (e.g. `grnCreate()`
  is already called once per line item from `grn-entry.html`).
- **Idempotency:** every sync of the same PO (changed or not) is an
  upsert, not an append — safe to retry, safe to re-run on every poll even
  if nothing changed.
- **What is not synced:** PO cancellation/deletion in Tally has no
  defined handling in this design. If a PO is cancelled in Tally before
  any GRN is logged against it, nothing in the flow described here removes
  it from the "Open POs (Tally)" sheet or signals that it should no longer
  appear. **This is an open design question, not a decision made by this
  document** — it needs an answer (e.g., does the Python service also
  sync a cancelled/closed status? is a stale PO removed after some
  inactivity period?) before implementation, and is called out again in
  `IMPLEMENTATION_PHASES.md`.

## 5. Communication protocol (Python → Apps Script)

- **Transport:** HTTPS POST to the existing Apps Script Web App URL
  (already known — the same URL hardcoded into every frontend page today).
  Apps Script Web App URLs are HTTPS-only by construction; no additional
  TLS configuration is needed.
- **Body:** JSON, `Content-Type: application/json`, read via `doPost`'s
  existing `e.postData.contents` path — no new parsing capability needed.
- **Shape:** `{ type: 'PO_SYNC', secret: '...', poNo, poDate, vendor,
  items: [...] }` — see `FIELD_MAPPING.md` for the exact `items` shape,
  which mirrors `parsePOSheetValues()`'s existing output exactly.
- **Response:** JSON, `{status:'success', ...}` or `{status:'error',
  message}}`, matching this codebase's universal response convention.
- **Important platform fact informing the retry design:** Apps Script Web
  App responses built via `ContentService.createTextOutput(...)`, as
  every response in this codebase already is (`jsonResponse()`, confirmed
  in `Code.gs`), are served as **HTTP 200 regardless of the `status` field
  in the body** — `jsonResponse(obj, code)` accepts a `code` parameter but
  never uses it. **Python must treat the JSON body's `status` field, not
  the HTTP status code, as the source of truth for success or failure.**
  This is an existing characteristic of the whole backend, not something
  introduced by this integration, and it applies identically to every
  other endpoint Python might ever call on this Web App.
- Apps Script Web Apps do not reliably expose custom HTTP request headers
  to script code — the shared secret must travel in the JSON body, not a
  header.

## 6. Error handling and retry strategy

**Python side:**
- Tally unreachable (connection refused/timeout): log and retry on the
  next scheduled poll; do not treat a single failed poll as data loss,
  since the next successful poll will pick up the same PO (Tally is the
  system of record, not the Python service's own memory).
- Apps Script unreachable or returns a network-level error: log and retry
  with bounded exponential backoff within the current run before giving up
  until the next scheduled poll. Safe to retry because syncing is an
  idempotent upsert (§4).
- Apps Script returns `{status:'error', ...}`: log the specific message
  (e.g. "secret rejected", "malformed payload") — this is not a transient
  condition, so blind retrying without addressing the cause is not
  appropriate; it should be logged distinctly from a network failure.
- Repeated failures (a threshold to be defined operationally): the
  existing system already has Slack webhook infrastructure
  (`SLACK_WEBHOOK_URL`, used today for personal-purchase and weekly-digest
  notifications) — the same channel is a natural place to surface a
  "Tally PO sync has failed N times in a row" alert, without introducing
  new alerting infrastructure. Whether Python posts this directly or asks
  Apps Script to is an implementation detail for the approved phase.

**Apps Script side:**
- The new sync handler follows the same try/catch → `{status:'error',
  message}` convention every other function in `doGet`/`doPost` already
  uses — no new error-handling pattern is introduced.
- Secret validation failures and payload-shape validation failures return
  distinct, specific error messages (without echoing the secret itself
  back in any response or log) so Python's logs make the actual cause
  diagnosable.

## 7. Logging

- **Apps Script:** `console.error`/`console.log` inside the new sync
  handler, consistent with existing patterns elsewhere in this codebase
  (e.g. `notifyGrnForVerification`'s Slack-failure logging) — a summary of
  what was synced/rejected per call, visible in the Apps Script execution
  log.
- **Python:** standard logging within the existing service (this document
  does not prescribe a specific Python logging framework, since the
  service already exists with its own conventions) — at minimum, one log
  line per PO sync attempt with outcome (success/skipped-unchanged/error),
  and the poll cycle's overall summary (POs seen, synced, failed).
- **Never logged, on either side:** the shared secret value itself.

## 8. Security considerations

- **The new endpoint must not inherit the rest of this Web App's
  `ANYONE_ANONYMOUS` exposure without a check of its own.** The existing
  system's other write paths (documented at length in
  `FINAL_TEST_VERIFICATION.md` as a Critical/High finding) have no real
  authentication; this new machine-to-machine endpoint should not add a
  fourth such path. A shared secret, required and validated on every
  `PO_SYNC` call before any Sheet write happens, is the minimum bar.
- **The secret should be stored in `PropertiesService.getScriptProperties()`,
  not as a hardcoded source constant** — a deliberate departure from this
  codebase's existing pattern of hardcoding Slack webhook URLs, Sheet IDs,
  and the OAuth client ID directly in source (already flagged as a
  High-severity issue in `FINAL_TEST_VERIFICATION.md`). Using
  `PropertiesService` for this one new credential means it can be rotated
  without a code deployment and is not visible in `git diff`/GitHub.
- **Scope of what's synced should be minimal:** only the PO fields needed
  to populate the existing "Open PO" picker (see `FIELD_MAPPING.md`) —
  no reason for the Python service to have or transmit any other Tally
  data (ledgers, other voucher types, company financials) through this
  path.
- **This new code must be added to both `Code.gs` and `Code.js`
  identically**, or the deployment ambiguity documented in
  `CODE_DEPLOYMENT_ANALYSIS.md` applies to it from day one — i.e. it would
  be unknowable whether the secret check or the upsert logic actually
  executes in the live project. This is a hard requirement for this
  integration's own correctness, not an optional cleanup.
- **The Python service's own credentials** (however it authenticates to
  Tally, plus the new shared secret for Apps Script) should be stored in
  the Python service's environment/config, not committed to source control
  — consistent with, not a repeat of, the hardcoded-secret pattern already
  flagged elsewhere in this codebase.
