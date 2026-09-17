# Achira Labs Inventory Management System — Official Documentation

**Status of this document:** Written from a full, direct read of the current source code (`backend/Code.gs`, `backend/Code.js`, every file in `frontend/`, every file in `integration/`) as it exists on disk today. It does not rely on memory, on prior conversation, or on the project's own pre-existing `docs/*.md` analysis files — those are cross-referenced only where explicitly noted, and only for context that isn't independently derivable from the code itself. Anything that could not be verified directly from source is marked **(assumption)** or listed in the *Assumptions & Verification Notes* at the end.

---

## 1. Project Overview

### Purpose

Achira Labs Inventory Management is an internal system for tracking laboratory materials and consumables through their full lifecycle: procurement (Purchase Orders in Tally), physical receipt (Goods Receipt Notes), classification/cataloguing (ARN assignment), day-to-day stock movement (inventory adjustments), and internal demand (material requests) — with Slack-based notifications driving the human approval steps, and a restricted executive dashboard for overhead/cash-outflow financial visibility.

The vocabulary throughout the codebase (synonym expansion for search terms like `BSA`, `EDTA`, `PBS`, `SDS`, `DMSO`, `mAb`, `HRP`, `FITC`, `GFP`, `PPE`, `nitrocellulose`) indicates this serves a biotech/life-sciences R&D lab environment, where "items" are lab reagents, consumables, and equipment.

### Business problem it solves

- Lab stock movements (issues, restocks, damage, write-offs, transfers, recounts) were previously untracked or tracked ad hoc — the **Inventory Adjustment** module gives every movement a timestamped, attributed log entry.
- New items purchased or received had no consistent classification or approval trail — the **ARN Assignment** module gives every item a formal Asset Reference Number (ARN) only after a department-scoped approver signs off, with duplicate-item detection to prevent redundant catalogue entries.
- Goods received against Purchase Orders had no structured verification step — the **GRN** modules (Entry, Verification, Search) let a requester confirm a delivery actually matches what they ordered before it's considered final, with Slack notifications closing the loop with the original requester and with Accounts.
- Purchase Order data lived only in Tally (the company's ERP) with no live connection to the inventory system — the **Tally Integration** (`integration/`) pulls Purchase Orders out of Tally's XML/HTTP API and (once fully deployed — see §15) syncs them into the same Google Sheet the GRN Entry page reads from, so "what's still outstanding on this PO" is computed automatically instead of manually cross-checked.
- Leadership had no self-service view into overhead spend or cash outflow by category — the **Executive Dashboard** (`exec-dashboard/overhead.html`) gives a small, explicitly allow-listed set of people a Google-Sign-In-gated view of that data.

### Overall architecture

This is a **serverless, spreadsheet-backed** system with no traditional application database:

```
 Tally ERP (on-prem, LAN)                 Slack Workspace
        │  XML/HTTP                              ▲
        │                                        │ Incoming Webhooks
        ▼                                        │
 Python integration layer  ──HTTP POST──►  Google Apps Script Web App   ◄──JSONP/HTTP──  Static frontend
 (integration/*.py)              (PO_SYNC)  (backend/Code.gs + Code.js)      (GET/POST)   (frontend/*.html,
                                                    │  ▲                                   hosted externally,
                                          SpreadsheetApp/DriveApp                          e.g. GitHub Pages)
                                                    ▼  │
                                    Google Sheets (3 separate spreadsheets:
                                    Inventory Adjustment DB, GRN Registry, Overhead Analytics)
```

- **Backend**: a single Google Apps Script project (script ID `1gPlsV-gi_PYoSpreBX0-OMhxYZtVYOKgxJa6HheyYtrWb5jfzMsPAyWH`) deployed as a Web App, exposing one `doGet`/`doPost` HTTP surface with an `action`/`type`-based routing scheme. Uniquely, the project's source is split across **two files that are both loaded into one shared global scope** — `Code.gs` and `Code.js` — a documented architectural quirk (see §12 and §15).
- **Data store**: Google Sheets, not a database. Three separate spreadsheets are used as three separate logical databases (see §8).
- **Frontend**: nine plain, static HTML+CSS+vanilla-JS pages, no framework, no build step, no shared JS bundle — each page independently embeds the same hardcoded Apps Script Web App URL and talks to it directly, mostly via a JSONP pattern (dynamic `<script src>` injection) rather than `fetch()`, because the Apps Script Web App does not send CORS headers.
- **Notifications**: Slack Incoming Webhooks (three, each bound to a fixed destination — a channel or a specific person's DM) plus, in two cases, parallel email via `MailApp`.
- **External integration**: a standalone Python package (`integration/`) that talks to Tally's local XML/HTTP API and pushes translated Purchase Order data into the Apps Script backend over HTTP.

### Technologies used

| Layer | Technology |
|---|---|
| Backend runtime | Google Apps Script, V8 runtime, `Asia/Kolkata` timezone |
| Backend data access | `SpreadsheetApp` (primary), `DriveApp` + Advanced Drive Service (legacy PO import only), `CacheService`, `PropertiesService`, `LockService`, `UrlFetchApp`, `MailApp`, `ContentService` |
| Data store | Google Sheets (3 spreadsheets) |
| Frontend | Static HTML5 + CSS3 + vanilla JavaScript (ES6+), no framework, no bundler |
| Charts (exec dashboard only) | Chart.js 4.4.1 (via CDN) |
| Auth (exec dashboard only) | Google Identity Services (Google Sign-In), server-side ID-token verification against Google's `tokeninfo` endpoint |
| Notifications | Slack Incoming Webhooks; Gmail via `MailApp` |
| Tally integration | Python 3 + `requests`; Tally ERP's built-in XML-over-HTTP server |
| Source control / deploy tooling | `clasp` (`.clasp.json` present, `scriptExtensions: [".js",".gs"]`) — though header comments in the backend files themselves describe a manual "paste into the Apps Script editor" deployment process, so the real-world deploy method is not purely clasp-based (see §15) |

---

## 2. Complete Module List

### 2.1 Home Dashboard (`frontend/home.html`)

- **Purpose**: Landing/navigation hub. No business logic of its own.
- **Workflow**: Two cards — "Inventory" (links to Inventory Adjustment, Material Request, ARN Management) and "GRN" (links to Create GRN, Verify GRNs, Search & History). A small script highlights whichever nav card matches `document.referrer` when arriving from one of those pages.
- **Backend functions involved**: none — makes no backend calls.
- **Sheets used**: none.
- **APIs used**: none.
- **Integrations**: none.

### 2.2 Inventory Adjustment (`frontend/index.html`)

- **Purpose**: Lets a store manager log any stock movement — Inward, Issue, Damage, Return, Recount, Transfer In, Transfer Out, Write-Off — against an existing catalogue item.
- **Workflow**: 3-step wizard: (1) search/select an item from the master catalogue (typeahead, min 2 characters, capped 40 results), (2) type-conditional Adjustment Details (Issue requires Issued To + Project; Inward/restock requires Issued To + Expiry Date or an explicit "no expiry" flag; quantity; Add/Deduct auto-set by type but overridable; optional GRN No. with blur-triggered lookup), (3) Confirm & Submit (manager name, warehouse) → success screen → a session-only "Recent Adjustments" list persisted in `localStorage` (max 10 stored, 5 shown).
- **Backend functions involved**: `getMasterItemListForSearch()` (action `itemlist`), `getEmployeeList()` (action `employees`), `verifyGrnExists()` (action `grnlookup`, used to suggest a restock recipient), `appendRow()` (plain POST, no `action` — the default `doPost` fallback path when no `type` matches).
- **Sheets used**: `1. Master Item List`, `Employees` or `Slack-user IDs` (whichever `getEmployeeList()` resolves), `2. Adjustment Log` (write target), GRN registry tabs (for the `grnlookup` suggestion).
- **APIs used**: `itemlist`, `employees`, `grnlookup`, plain POST.
- **Integrations**: none beyond the Apps Script backend.

### 2.3 Material Request (`frontend/request.html`)

- **Purpose**: Lets any employee search the catalogue and submit a request for stores to fulfill.
- **Workflow**: 3-step wizard: (1) Find Item — a scored smart search with lab-abbreviation synonym expansion and 6 quick-suggestion chips, (2) Request Details (quantity, purpose, priority Normal/Urgent, optional free-text "Required By"), (3) Your Details (department → cascading name select) → Submit → success screen showing a generated `MR-####` request ID.
- **Backend functions involved**: `getMasterItemListForSearch()` (action `itemlist`), `appendMaterialRequest()` (plain POST with `type: 'MATERIAL_REQUEST'`).
- **Sheets used**: `1. Master Item List`, `6. Material Requests` (write target).
- **APIs used**: `itemlist`, plain POST.
- **Integrations**: none. (Department/employee names for this page's dropdown are a **separately hardcoded** `EMPLOYEES` object in the page's own JS, not fetched from `getEmployeeList()` — see §10 for the data-quality implication of this duplication.)

### 2.4 ARN Assignment (`frontend/arn-assign.html`)

- **Purpose**: Two-tab tool. "New Item" submits a newly received/purchased material for formal classification and approval (with live duplicate detection and rule-based category suggestion), including a "personal purchase / reimbursement" sub-flow for items bought without a GRN. "Verify & Approve" is the approver's review queue.
- **Workflow**:
  - *New Item*: material/brand/department fields drive a debounced (300ms) suggestion engine and a debounced (600ms, min 4 chars) duplicate check that requires an explicit acknowledgement checkbox if matches are found. A GRN No. is required unless "personal purchase" is checked, in which case a provisional reference number is auto-generated and vendor/amount/bill-number/paid-by fields are revealed instead.
  - *Verify & Approve*: department + approver name → "Load Pending Items" → per-item Approve or Send Back (with corrected sub-category + reason) cards.
- **Backend functions involved**: `findDuplicates()` (action `dupcheck`), `arnAssign()` (action `assign`), `getPendingItemsForPerson()` (action `list`), `arnApprove()` (action `approve`), `arnReject()` (action `reject`).
- **Sheets used**: `1. Master Item List`, `7. ARN Pending` (both read and write), GRN registry (for GRN No. existence check inside `arnAssign`), `2. Adjustment Log` (opening-stock entry written on approval via `logOpeningStockAdjustment`).
- **APIs used**: `dupcheck`, `assign`, `list`, `approve`, `reject`.
- **Integrations**: Slack + email, via `notifyPersonalPurchase()`, fired only for personal-purchase submissions (see §7).

### 2.5 GRN Entry / Create (`frontend/grn-entry.html`)

- **Purpose**: Logs a Goods Receipt Note — either against an open Purchase Order (auto-filling vendor and an outstanding-items checklist) or fully manually — supporting multiple line items under one GRN No., per-item GST/discount math, and reporting a PO line item as short-shipped.
- **Workflow**: Link to PO (optional — selecting one generates a per-item checklist pre-filled to each item's *remaining* balance, with an in-line "report shortfall" flow) → Category selection → Receipt Details → GRN Identifiers (Sl No./GRN No. auto-suggested per tab+prefix, overridable) → Material entry (manual add/remove item blocks when no PO is linked, plus one optional ad-hoc "not on PO" item even when a PO is linked) → Handling details → Submit (one `grncreate` call per line item, aggregated into a single success/failure summary).
- **Backend functions involved**: `getGrnCategoryTabs()` (action `grntabs`), `getEmployeeList()` (action `employees`), `getPrefixesForTab()` (action `grnprefixes`), `suggestNextGrnFields()` (action `grnsuggest`), `getActivePOs()` (action `activePOs`), `reportPOShortfall()` (action `poShortfall`), `grnCreate()` (action `grncreate`, called once per item).
- **Sheets used**: GRN registry category tabs (write target), `Open POs (Tally)`, `PO Manual Overrides`, `Employees`/`Slack-user IDs`.
- **APIs used**: `grntabs`, `employees`, `grnprefixes`, `grnsuggest`, `activePOs`, `poShortfall`, `grncreate`.
- **Integrations**: Slack, via `notifyGrnForVerification()` — fired once per GRN No. (only on the first line item), notifying the original requester (see §7).

### 2.6 GRN Verification (`frontend/grn-verify.html`)

- **Purpose**: Lets the original requester confirm a delivery matches what they ordered. Reached via a deep link with `?tab=&grn=` query parameters, normally clicked from the Slack notification for that specific delivery rather than browsed to directly.
- **Workflow**: Loads GRN details (status badge, GRN/PO/Vendor/Invoice/Received Date/Requested By, per-line-item checklist — already-verified items show a static badge instead of a checkbox) → requester enters/selects their name → Approve (partial approval supported — only checked items are approved; unchecked ones stay Pending).
- **Backend functions involved**: `grnVerifyLookup()` (action `grnverifylookup`), `getEmployeeList()` (action `employees`), `grnVerifyApprove()` (action `grnverify`).
- **Sheets used**: the specific GRN category tab the `tab` parameter names.
- **APIs used**: `grnverifylookup`, `employees`, `grnverify`.
- **Integrations**: Slack, via `notifyAccountsApproval()` — fired from `grnVerifyApprove()` only on a genuinely new approval, notifying Accounts directly (see §7).

### 2.7 GRN Search & History (`frontend/grn-search.html`)

- **Purpose**: Search, filter, browse, print, and export GRN history across every category.
- **Workflow**: Search (free-text query + collapsible filters: status, category, date range) → sortable results table (7 sort options) with a computed summary strip (count / quantity / amount totals) and CSV export → Detail view (Print / Copy GRN No. / Copy PO No., header fields, full GST-breakdown item table) → Back to results.
- **Backend functions involved**: `getGrnCategoryTabs()` (action `grntabs`), `searchGrns()` (action `grnsearch`), `getGrnDetails()` (action `grnview`, a thin wrapper around `grnVerifyLookup()`).
- **Sheets used**: every GRN category tab.
- **APIs used**: `grntabs`, `grnsearch`, `grnview`.
- **Integrations**: none. (See §5 for full search behavior.)

### 2.8 Executive Financial Dashboard (`frontend/exec-dashboard/overhead.html`)

- **Purpose**: Restricted-access leadership view of overhead spend and cash-outflow-by-category.
- **Workflow**: Google Sign-In gate → on success, two tabs: **Overhead** (KPI cards — Total YTD, average monthly run-rate excluding the current month, projected FY total, largest category — plus a category table and Chart.js stacked-bar/donut charts) and **Cash Outflow by Category** (lazy-loaded on first click — KPIs including an explicitly-explained "Uncategorized share" metric, a category table, a donut chart, and a top-vendors table).
- **Backend functions involved**: `verifyGoogleIdToken()` + `getOverheadSummary()` (action `overhead`); `verifyGoogleIdToken()` + `getCashoutflowSummary()` + `getTopCashoutflowVendors()` (action `cashoutflow`).
- **Sheets used**: `Category Summary`, `Raw Data`, `CashOutflow Category Summary`, `CashOutflow Vendor Detail` — all in the separate Overhead spreadsheet.
- **APIs used**: `overhead`, `cashoutflow`.
- **Integrations**: Google Identity Services for sign-in; the obtained ID token is sent as the `token` parameter on every call and verified server-side.
- **Note**: the functions this page depends on (`verifyGoogleIdToken`, `getOverheadSummary`, `getCashoutflowSummary`, `getTopCashoutflowVendors`, and the `OVERHEAD_*` constants) exist **only in `Code.js`**, not `Code.gs` — see §12.

### 2.9 Executive Dashboard Auth Test (`frontend/exec-dashboard/overhead-auth-test.html`)

- **Purpose**: An isolated diagnostic page built to verify the Google Sign-In + email-extraction flow, **before** the real dashboard was wired up. Its own in-code comments explicitly flag it as a throwaway test harness, not production security.
- **Workflow**: Sign-in button → result panel (success/denied/error, shows the signed-in email) → sign-out.
- **Backend functions involved**: **none** — no `APPS_SCRIPT_URL` is even defined in this file; the entire check (including allow-list comparison) happens client-side by manually base64url-decoding the JWT payload with **no signature verification**.
- **Sheets used**: none. **APIs used**: none. **Integrations**: Google Sign-In only.
- **This is explicitly not a security boundary** — the real access control for `overhead.html` is enforced server-side (§2.8), and the code's own comments say so.

---

## 3. Tally Integration

Location: `integration/*.py`. Pure Python, no Apps Script code here — this layer's only contact with the backend is one HTTP POST per Purchase Order.

### How Purchase Orders are fetched

`tally_connection.py` posts raw XML to a hardcoded local Tally server:

```python
TALLY_URL = "http://192.168.29.22:9999"
DEFAULT_TIMEOUT = 5  # seconds, no retry
```

`requests.post(TALLY_URL, data=xml_payload.encode("utf-8"), timeout=timeout)`. Connection/timeout failures are wrapped in a custom `TallyConnectionError` with a human-readable message. No company name is specified in the request — Tally answers for whichever company is currently open in the desktop application, i.e. a single-company assumption.

### XML request

Built and owned by `tally_client.py` (`_PURCHASE_ORDER_REQUEST`):

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

A separate, simpler `Company List` collection request is used only for connectivity checks (`check_connection()`).

### Parsing

`tally_parser.py` first **sanitizes** the raw XML — it strips numeric character references to illegal XML control codepoints (observed in real data inside an unread `BATCHNAME` field) before calling `xml.etree.ElementTree.fromstring()`, since a single illegal reference anywhere makes the whole document unparseable.

For each `<VOUCHER>`: `VOUCHERNUMBER` → `po_no` (voucher skipped if empty), `DATE` (`yyyymmdd`) → reformatted to `dd-mm-yyyy`, `PARTYLEDGERNAME` → `vendor`, `GUID`, `NARRATION` retained as-is. A voucher is **skipped entirely** (not the whole batch) if `ISCANCELLED` or `ISOPTIONAL` is `"yes"`, if it has no voucher number, or if it ends up with zero usable line items.

Per line item (`ALLINVENTORYENTRIES.LIST`): `sl_no` is a positional 1-based index (Tally has no serial field), `STOCKITEMNAME` → `description` (item skipped if empty), `BILLEDQTY` parsed for quantity/unit (falling back to `ACTUALQTY`), `RATE` parsed for rate/rate-unit, `AMOUNT` (absolute value — Tally returns it negative on the purchase side).

Notable parsing rules, quoted from the module's own logic:
- Compound quantity strings like `"5000 UG = 5 MG"` — the segment **before** the `=` (what was actually entered) is used.
- Compound/foreign-currency rate strings like `"0.14Euro = ₹0.14/UG"` — the segment **after** the last `=` (the effective base-currency rate) is used, via regex `([\d.]+)\s*/\s*(\S+)\s*$`.

### Translation

`po_translator.py` maps the parsed `PurchaseOrder`/`POItem` dataclasses into the exact JSON shape the Apps Script backend's legacy `.xlsx`-based `parsePOSheetValues()` already produces, so `getActivePOs()`'s downstream decoration logic runs unchanged regardless of source:

| Source field | Target key |
|---|---|
| `po_no` | `poNo` |
| `po_date` | `poDate` |
| `vendor` | `vendor` |
| `guid` | `guid` (metadata) |
| `narration` | `narration` (metadata) |
| `po_date_raw` | `poDateRaw` (metadata) |
| `item.sl_no` | `items[].slNo` |
| `item.description` | `items[].description` |
| `item.quantity` | `items[].quantity` |
| `item.unit` | `items[].unit` |
| `item.rate` | `items[].rate` |
| `item.amount` | `items[].amount` |
| `item.rate_unit` | `items[].rateUnit` (metadata only) |

### Sync

`po_sync.py` posts each translated PO **individually** (no batching) to the Apps Script Web App:

```python
requests.post(APPS_SCRIPT_URL, json=payload, timeout=15)
# payload = translated PO dict + {"type": "PO_SYNC", "secret": <TALLY_SYNC_SECRET>}
```

`APPS_SCRIPT_URL` defaults to the same production Web App URL every frontend page uses, overridable via `INVENTORY_APPS_SCRIPT_URL`. The secret comes from `INVENTORY_TALLY_SYNC_SECRET` (no default — refuses to run without it) and must match a `TALLY_SYNC_SECRET` Script Property set on the Apps Script side. Since Apps Script always returns HTTP 200, success/failure is determined by the parsed JSON body's `status` field. `sync_purchase_orders()` catches per-PO failures so one bad PO doesn't stop the rest, returning `{"synced": [...], "failed": [...]}`.

**⚠️ Partially implemented / not yet confirmed live**: `po_sync.py`'s own module docstring explicitly warns it "has NOT been run against the real Apps Script Web App URL" and that the live deployed `doPost` may not yet contain the `PO_SYNC` branch — meaning a real sync attempt could currently be misfiled into the production Adjustment Log by `doPost`'s fallback path. The Python side (Tally connection → parsing → translation) has been run and verified against live Tally data; the final hop into the Google Sheet has not been confirmed end-to-end.

The production entry point is `run_sync.py` (has a real `if __name__ == "__main__"` block, no arguments): `connect()` → `get_purchase_orders()` + `parse_purchase_orders()` → `translate_purchase_orders()` → `sync_purchase_orders()`, printing a per-PO synced/failed summary and exiting 0 only if everything synced.

`diagnose_two_pos.py` is an explicitly-labeled temporary diagnostic script (hardcoded to two specific PO numbers) for investigating a specific sync issue — not part of the production pipeline. `test_purchase_orders.py` and `test_tally.py` are manual, print-based smoke-test scripts, not an automated test suite (no `pytest`/`unittest`/assertions exist anywhere in `integration/`).

### Open PO calculation

Handled entirely on the Apps Script side, by `getActivePOs()` (see §12 for the full function). Reads `Open POs (Tally)` (via `getParsedPOsFromTallySheet()`), sums already-received quantity per PO+item across every GRN category tab (`getReceivedQtyByPOAndItem()`), and reads manual overrides (`getPOOverrideKeys()`).

### Partial receipt handling

`remainingQty = max(orderedQty - receivedQty, 0)` per item — a PO can be partially received across multiple GRNs over time, and each subsequent GRN Entry checklist shows only what's still outstanding.

### Manual overrides

A `PO Manual Overrides` sheet (see §8) is an append-only audit trail: `reportPOShortfall()` writes a row (never edits GRN data or PO data) whenever a vendor confirms an item's remaining balance is never coming. `getPOOverrideKeys()` returns a set of `poNo||normalizedDescription` keys; any item whose key is in this set has `remainingQty` forced to `0` regardless of the ordered/received math, and `overridden: true` stamped on it.

### Remaining quantity calculation

`orderedQty = Number(item.quantity) || 0`; `receivedQty` = sum of `Quantity` across every GRN row matching the same `(PO No. + normalized item description)` key; `remainingQty = isOverridden ? 0 : max(orderedQty - receivedQty, 0)`.

### Closed PO determination

A PO is included in `getActivePOs()`'s returned list (i.e. considered "open") only if **at least one** of its items has `remainingQty > 0`. A PO where every item is either fully received or manually overridden to zero is dropped from the result entirely — there's no separate "Closed POs" sheet or status flag; "closed" is a computed, not stored, state.

---

## 4. GRN Workflow — Full Lifecycle

```
PO in Tally
   │  (Tally XML/HTTP API — see §3)
   ▼
Sync to Google Sheets                    ⚠️ code-complete both sides, live end-to-end path NOT confirmed exercised (see §3, §15)
   │  integration/run_sync.py → po_sync.sync_purchase_orders()
   │  → Apps Script doPost(type='PO_SYNC') → syncPurchaseOrder()
   │  → writes "Open POs (Tally)" sheet, invalidates 'activePOs' cache
   ▼
Active PO generation
   │  getActivePOs() → getParsedPOsFromTallySheet() + getReceivedQtyByPOAndItem()
   │  + getPOOverrideKeys() → decorated {orderedQty, receivedQty, remainingQty, overridden}
   │  cached 5 minutes (PO_CACHE_SECONDS) via CacheService
   ▼
GRN Creation                             (frontend/grn-entry.html — can also run fully manually, without a PO)
   │  grnCreate() — validates financial fields (validateGrnFinancialFields), writes one row per
   │  line item to the category tab, sets Verification Status = "Pending Verification"
   ▼
Verification                             (frontend/grn-verify.html, reached via a Slack deep link)
   │  grnVerifyLookup() → requester reviews → grnVerifyApprove()
   │  (supports partial approval via selectedDescriptions; idempotent — already-Verified rows
   │  are skipped, never re-stamped)
   ▼
Slack Notifications
   │  notifyGrnForVerification() fires from grnCreate() (once per GRN No., first item only) —
   │  tells the requester a delivery was logged and needs verification
   ▼
Accounts Notification
   │  notifyAccountsApproval() fires from grnVerifyApprove() (only on a genuinely new approval) —
   │  DMs Accounts (Raghavendra Katti) with the full GRN + invoice + verification detail
   ▼
Completed GRN
      Verification Status = "Verified", Verified By / Verified Date stamped.
      Discoverable afterward via GRN Search & History (searchGrns() / getGrnDetails()).
```

**Every backend function involved, in call order**: `syncPurchaseOrder()` → `getOrCreateTallyPoSheet()` → `getParsedPOsFromTallySheet()` → `getReceivedQtyByPOAndItem()` → `getGrnCategoryTabs()` → `getPOOverrideKeys()` → `getOrCreatePOOverridesSheet()` → `getActivePOs()` → `grnCreate()` → `validateGrnFinancialFields()` → `parseFinancialInput()` → `resolveFinancialAmount()` → `ensureGrnVerificationColumns()` → `ensureGrnFinancialColumns()` → `getGrnHeaderColumnMap()` → `notifyGrnForVerification()` → `getSlackUserId()` → `formatReceivedByLine()` → `grnVerifyLookup()` → `grnVerifyApprove()` → `notifyAccountsApproval()` → `searchGrns()` / `getGrnDetails()`.

**Note**: a GRN does not strictly require a PO — `grn-entry.html` supports fully manual entry (category + hand-typed items) with no PO linkage at all; the diagram above shows the PO-driven path since that's what §3/§4 of the request describe, but manual GRNs skip straight to "GRN Creation."

---

## 5. GRN Search

Implemented by `searchGrns()` (backend) and `frontend/grn-search.html`.

### Search capabilities

- **Universal query mode** (the page's single search box): one `query` string is matched, case-insensitively, as a substring against **GRN No., PO No., and Material Description simultaneously (OR-combined)** — if the term appears in *any* of those three fields on a row, it matches.
- **Legacy three-field mode**: the backend function still independently accepts `grnNo`, `poNo`, `materialDescription` as separate parameters (AND-combined with each other) — this is the pre-existing mode the current single-box UI no longer sends, but the backend contract for it hasn't been removed.
- **Search by GRN Number**: substring match against the `Verification Status`-tab's GRN No. column, case-insensitive.
- **Search by PO Number**: substring match against the PO No. column.
- **Search by Material Description**: substring match against the Description of Material column.

### Filters

All AND-combined with whichever query mode is active: **Category** (skips reading a tab entirely if it doesn't match — an optimization, not just a post-filter), **Verification Status** (`pending`/`verified`), **Date From** / **Date To** (parsed against the GRN's received date, using a dd/mm/yyyy-aware parser — `parseGrnRecordDate()` server-side, mirrored client-side by `grnDateSortValue()` in `grn-search.html`, both explicitly written to avoid `new Date("06/08/2026")` being misread as June 8th instead of 6th August).

At least one of query or a filter must be non-empty — an all-blank search is rejected with a "please enter something" message before any sheet is read.

### Detail view

Clicking a result (or its View button) calls `grnview` → `getGrnDetails()` (a thin wrapper around `grnVerifyLookup()`), returning every line item sharing that GRN No. on that tab: header fields (Vendor, PO No., Invoice No./Date, Verification Status/By/Date, Remarks, Other Charges) plus a full per-item GST breakdown table (Material, Qty, Unit, Basic Amount, Discount, CGST, SGST, IGST, GST, Total). The frontend caches this per `tab||grn` key so re-opening or re-printing the same GRN within a session never re-reads the sheet.

### Data retrieval process

`searchGrns()` iterates `getGrnCategoryTabs()` (every sheet whose header row contains `grn no.`), skips any tab excluded by the Category filter without reading it, resolves each tab's columns via the fuzzy header map (`getGrnHeaderColumnMap()`), reads the full data range once per tab, and filters row-by-row in memory (query match → status filter → date filter), building a flat result array across all tabs. Results are sorted client-side only (7 comparator options — GRN Date, GRN Number, Vendor, Verification Status, each asc/desc) — sorting never re-queries the server. Export produces a client-side, UTF-8-BOM CSV of exactly the currently-sorted/filtered set (no server round-trip).

---

## 6. Financial Calculations

Implemented identically in both backend files (`parseFinancialInput`, `resolveFinancialAmount`, `validateGrnFinancialFields`) and mirrored independently on the client (`grn-entry.html`) — the server never trusts client-side math, it re-parses and re-resolves everything itself before writing.

### Basic Amount

A plain numeric field (not percentage-capable). Must be present, numeric, and `≥ 0`. This is the base every other financial field resolves against.

### Discount

Accepts either a **fixed currency amount** or a **percentage** (trailing `%`, e.g. `"10%"`). Resolves against **Basic Amount**. Rejected if the resolved discount amount exceeds the Basic Amount.

### CGST / SGST / IGST

Each independently accepts a fixed amount or a percentage. All three resolve against **Taxable Amount** (`Basic Amount − Discount`), not against Basic Amount directly. **Mutual exclusivity is enforced**: if either CGST or SGST is non-zero *and* IGST is also non-zero, the whole submission is rejected with `"Use either CGST + SGST or IGST, not both."` — modeling the real Indian GST rule that intra-state purchases use CGST+SGST and inter-state purchases use IGST, never both simultaneously.

### Percentage vs. Fixed amount support

`parseFinancialInput(raw, label)` is the shared parser for Discount/CGST/SGST/IGST: a trailing `%` marks the value as a percentage; anything else is treated as a fixed currency amount. Blank/missing input defaults to a fixed `0` (backward-compatible with older callers that never send these fields). Rejects non-numeric input, a malformed double-percent (e.g. `"10%%"`), and negative numbers in either form.

### Total Amount calculation

`Total Amount = round2(max(TaxableAmount + CGSTAmount + SGSTAmount + IGSTAmount, 0))`, where `TaxableAmount = BasicAmount − DiscountAmount`. **Always server-recomputed and stored** — a client-sent Total Amount value is never trusted or written.

### Validation rules

- Basic Amount: required, numeric, `≥ 0`.
- Discount amount (once resolved): cannot exceed Basic Amount.
- CGST/SGST vs IGST: mutually exclusive as above.
- Any parse failure (non-numeric, negative, malformed percent) fails the *entire* GRN line-item write — validation runs and is checked **before** the spreadsheet is even opened, so there's no partial/inconsistent write on a validation failure.

### Server-side validation

`validateGrnFinancialFields(data)` is the single orchestrator function, called at the top of `grnCreate()`. It is a hard gate: any `{valid:false, message}` result stops the write entirely and the message is returned to the caller.

### Legacy GST compatibility

Older GRN tabs have a single plain "GST" column predating the CGST/SGST/IGST breakdown. `grnCreate()` always **derives** this legacy field from the same validated amounts — `gst = round2(cgstAmount + sgstAmount + igstAmount)` — never from a client-sent value, so it can never drift out of sync with or be poisoned by caller input. Header-collision safety is deliberate: `getGrnHeaderColumnMap()` always resolves the **lowest-index** matching column per field, and the Discount/CGST/SGST/IGST/Total Amount columns are only ever *appended after* whatever columns a tab already has (`ensureGrnFinancialColumns()`), so an old tab's original "GST" header keeps resolving to the `gst` field, never accidentally to `cgst`/`sgst`/`igst` (and none of those three keyword strings is a substring of either of the others, so they can't collide with each other either).

---

## 7. Slack Integration

All four notification functions call `UrlFetchApp.fetch(<webhook>, {method:'post', contentType:'application/json', payload: JSON.stringify({text: ...}), muteHttpExceptions:true})` and are each individually wrapped in their own try/catch that only logs on failure (`console.error`) — a Slack outage never blocks or fails the underlying business operation (GRN save, verification, ARN submission).

### GRN Verification notification — `notifyGrnForVerification(details)`

- **Webhook**: `GRN_ARN_APPROVAL_WEBHOOK_URL`.
- **Trigger point**: called from `grnCreate()`, but only for the *first* line item of a given GRN No. (so a multi-item GRN sends exactly one notification, not one per item).
- **Message contents**: GRN No., PO No., Vendor, Material, Quantity, Requested By, Received By (using `formatReceivedByLine()` — shows `"<Receiver> (Received on behalf of <Requester>)"` when they differ, case-insensitively), an `<@SlackUserId>` mention of the requester (resolved via `getSlackUserId()` against the `Slack-user IDs` tab, falling back to plain name text if no ID is found), and a deep link to `grn-verify.html?tab=...&grn=...`.
- **Workflow role**: this is what the requester clicks to reach the Verification page.

### Accounts approval notification — `notifyAccountsApproval(tabName, grnNo)`

- **Webhook**: `ACCOUNTS_APPROVAL_DM_WEBHOOK_URL` — configured in Slack (not in code) to deliver directly into a specific individual's (Raghavendra Katti's) personal DM conversation, so no `<@mention>`/user-ID lookup is needed to reach him; the webhook itself is the routing.
- **Trigger point**: called from `grnVerifyApprove()`, only on a genuinely new (non-idempotent) approval — a repeated/duplicate Approve click never re-fires it.
- **Message contents**: GRN No., PO No., Vendor, Material(s) (joined across every line item under the GRN), Invoice No., Invoice Amount, Requested By, Received By (same `formatReceivedByLine()` phrasing), Verified By, Verification Date, and a deep link back to the GRN verification page.
- **Workflow role**: closes the loop with Accounts once a delivery is confirmed correct, independent of and never blocking the verification response itself.

### Personal purchase notifications — `notifyPersonalPurchase(details)`

- **Webhook**: `SLACK_WEBHOOK_URL` (the main channel), **plus** a parallel email via `MailApp.sendEmail` to `NOTIFY_ACCOUNTS` + `NOTIFY_PROCUREMENT` (both currently `accounts@achiralabs.com`).
- **Trigger point**: called from `arnAssign()`, only when the submission is flagged `isPersonalPurchase`.
- **Message contents**: Provisional Reference (PRN), material, quantity/unit, vendor, amount, paid-by, bill/invoice number, requested-by, procurement reference.
- **Workflow role**: alerts Accounts/Procurement that an employee is expecting reimbursement for a purchase made outside the normal PO/GRN path.

### Weekly reminders — `sendWeeklyPrnDigest()`

- **Webhook**: `SLACK_WEBHOOK_URL`, plus a parallel `MailApp` email.
- **Trigger point**: **not called from any `doGet`/`doPost`/other function** — it is designed to run on a time-driven Apps Script trigger, which must be installed manually. `appsscript.json` has no `triggers` section declared, and the codebase's own `checkSetup()` diagnostic explicitly checks `ScriptApp.getProjectTriggers()` for a `sendWeeklyPrnDigest` handler and logs a warning if none is found — i.e. the code is self-aware this dependency may not be satisfied. **Whether a trigger is currently installed cannot be determined from source alone.**
- **Message contents**: every `7. ARN Pending` row with `Reimbursement Status === 'Awaiting Reimbursement'`, sorted oldest-first by age in days, with a running total.
- **Workflow role**: a recurring nudge so personal-purchase reimbursements don't get forgotten.

---

## 8. Google Sheets Structure

Three separate Google Spreadsheets act as three separate logical databases:

### Spreadsheet 1 — Inventory Adjustment DB (`SHEET_ID`)

| Sheet | Purpose |
|---|---|
| `2. Adjustment Log` | Every stock movement (Inward/Issue/Damage/Return/Recount/Transfer/Write-Off), 21 columns (`COLUMNS` constant): Adj ID, Date, Time, ARN, Item Name, Dept, Unit, Warehouse, Adj Type, Quantity, Effect, GRN No., Reason, Issued To, Project, Manager Name, Status, Approved By, Tally Sync, Timestamp, Expiry Date. Also the write target for opening-stock entries created on ARN approval. |
| `6. Material Requests` | Pending/fulfilled internal material requests submitted from `request.html`. |
| `7. ARN Pending` | 27-column (`ARN_PENDING_HEADERS`) queue of items awaiting ARN approval, including the personal-purchase/reimbursement fields (Amount Paid, Bill/Invoice No., Paid By, Reimbursement Status, Procurement Request No.). |
| `1. Master Item List` | The catalogue of every item that has ever been given a final ARN — source for item search on Inventory Adjustment and Material Request pages, and for duplicate-detection on ARN Assignment. |
| `Employees` | Fallback employee-name source for `getEmployeeList()` if the `Slack-user IDs` tab (in the GRN registry spreadsheet) isn't used/available. |

### Spreadsheet 2 — GRN Registry (`GRN_REGISTRY_SHEET_ID`)

| Sheet | Purpose |
|---|---|
| **GRN category tabs** (dynamically discovered) | Any sheet whose header row contains the marker text `grn no.` is treated as a genuine GRN category tab by `getGrnCategoryTabs()` — the actual tab names weren't enumerated for this document (would require direct Sheet access) but functionally represent purchasing categories, populated as the Category filter/dropdown across the GRN pages. |
| `Open POs (Tally)` (`TALLY_PO_SHEET`) | 14-column (`TALLY_PO_HEADERS`) landing table for Tally-synced Purchase Orders: PO No., PO Date, Vendor, Sl No., Description of Material, Quantity, Unit, Rate, Amount, GUID, Narration, PO Date Raw, Rate Unit, Last Synced At. Written by `syncPurchaseOrder()`, read by `getParsedPOsFromTallySheet()`. |
| `PO Manual Overrides` (`PO_OVERRIDES_SHEET`) | Append-only audit trail of PO line items manually declared "never coming" — 5 columns (`PO_OVERRIDES_HEADERS`): PO No., Item Description, Reason, Closed By, Closed Date. Written only by `reportPOShortfall()`; never edited/deleted elsewhere. |
| `Slack-user IDs` | Maps employee display names to Slack member IDs (`U…`/`W…` pattern), used by `getSlackUserId()` for `<@mention>`s in Slack notifications, and doubles as an employee-name source for `getEmployeeList()`. |

### Spreadsheet 3 — Overhead Analytics (`OVERHEAD_SHEET_ID`) — Code.js only

| Sheet | Purpose |
|---|---|
| `Category Summary` | Feeds the Overhead dashboard's category breakdown. |
| `Raw Data` | Underlying overhead transaction detail. |
| `CashOutflow Category Summary` | Feeds the Cash Outflow tab's category breakdown. |
| `CashOutflow Vendor Detail` | Feeds the Cash Outflow tab's top-vendors table (`getTopCashoutflowVendors()`). |

This spreadsheet's ID and the functions that read it (`getOverheadSummary`, `getCashoutflowSummary`, `getTopCashoutflowVendors`) exist **only in `Code.js`** — see §12.

---

## 9. APIs

Single Apps Script Web App, one shared `doGet(e)`/`doPost(e)` surface. Every `doGet` branch is `if (e.parameter.action === '...')`, tested in the exact order below; nearly every branch supports JSONP (wraps the JSON response as `callback(json);` if `e.parameter.callback` is present, otherwise returns plain JSON via `ContentService`).

### `doGet` — GET actions

| # | `action` | Backend function | Input (`e.parameter.*`) | Output | Frontend page(s) |
|---|---|---|---|---|---|
| 1 | `list` | `getPendingItemsForPerson()` | `person`, `dept` | `{ items:[...] }` | arn-assign.html |
| 2 | `activePOs` | `getActivePOs()` | — | `{ status, pos:[...] }` (5-min cached) | grn-entry.html |
| 3 | `poShortfall` | `reportPOShortfall()` | `poNo`, `itemDescription`, `reason`, `closedBy` | `{ status }` | grn-entry.html |
| 4 | `cashoutflow` | `verifyGoogleIdToken()` → `getCashoutflowSummary()` | `token` | summary + `status`, `viewer` | exec-dashboard/overhead.html |
| 5 | `assign` | `arnAssign()` | `data` (JSON) | result object | arn-assign.html |
| 6 | `dupcheck` | `findDuplicates()` | `material`, `brand` | `{ status, matches:[...] }` | arn-assign.html |
| 7 | `approve` | `arnApprove()` | `id`, `person`, `personDept` | result object | arn-assign.html |
| 8 | `reject` | `arnReject()` | `id`,`person`,`personDept`,`correctedDept`,`correctedSubcat`,`reason` | result object | arn-assign.html |
| 9 | `grnlookup` | `verifyGrnExists()` | `grn` | `{ found, vendor?, poNo?, description?, issuedTo? }` | index.html |
| 10 | `itemlist` | `getMasterItemListForSearch()` | — | `{ status, items:[...] }` | index.html, request.html |
| 11 | `employees` | `getEmployeeList()` | — | `{ status, employees:[...] }` | index.html, grn-entry.html, grn-verify.html |
| 12 | `grntabs` | `getGrnCategoryTabs()` | — | `{ status, tabs:[...] }` | grn-entry.html, grn-search.html |
| 13 | `grnprefixes` | `getPrefixesForTab()` | `tabName` | `{ status, prefixes:[...] }` | grn-entry.html |
| 14 | `grnsuggest` | `suggestNextGrnFields()` | `tabName`, `prefix` | `{ status, suggestion:{slNo,grnNo} }` | grn-entry.html |
| 15 | `grncreate` | `grnCreate()` | `data` (JSON) | result object | grn-entry.html |
| 16 | `grnverifylookup` | `grnVerifyLookup()` | `tab`, `grn` | `{ status, tabName, items }` | grn-verify.html |
| 17 | `grnverify` | `grnVerifyApprove()` | `tab`,`grn`,`person`,`selected` (JSON array) | result object | grn-verify.html |
| 18 | `grnsearch` | `searchGrns()` | `query`,`grnNo`,`poNo`,`materialDescription`,`category`,`status`,`dateFrom`,`dateTo` | `{ status, results:[...] }` | grn-search.html |
| 19 | `grnview` | `getGrnDetails()` | `tab`, `grn` | `{ status, tabName, items }` | grn-search.html |
| 20 | `overhead` | `verifyGoogleIdToken()` → `getOverheadSummary()` | `token` | summary + `status`, `viewer` | exec-dashboard/overhead.html |
| 21 (fallback) | *(none matched)* | — | — | `{ status:'ok', message:'... API is running' }` — **not JSONP-wrapped**, unlike every branch above | — |

### `doPost` — POST actions (`data.type` discriminator, or plain-body fallback)

| `data.type` | Backend function | Consumer |
|---|---|---|
| `MATERIAL_REQUEST` | `appendMaterialRequest()` | request.html |
| `ARN_ASSIGN` | `arnAssign()` | (JSONP-GET `assign` is what arn-assign.html actually uses; this POST variant exists in the backend contract) |
| `ARN_APPROVE` | `arnApprove()` | — |
| `ARN_REJECT` | `arnReject()` | — |
| `GRN_CREATE` | `grnCreate()` | — |
| `PO_SYNC` | `syncPurchaseOrder()` | `integration/po_sync.py` (external) |
| *(no type / unrecognized)* | `appendRow()` | index.html (plain fetch POST, `data=<JSON>`) |

`syncPurchaseOrder()` is the one endpoint secured by a shared secret (`data.secret` checked against the `TALLY_SYNC_SECRET` Script Property) rather than a user identity — see §10/§15.

---

## 10. Important Business Rules

- **Partial receipt handling**: a PO can be received across multiple GRNs; `remainingQty = max(orderedQty − receivedQty, 0)` is always computed fresh from the GRN registry, never stored as a running counter.
- **Open vs. Closed PO logic**: a PO is "open" (returned by `getActivePOs()`) only if at least one item still has `remainingQty > 0`; there is no stored "closed" flag — it's purely derived.
- **Manual override behaviour**: `reportPOShortfall()` is additive-only (never edits GRN or PO data), and an override always forces `remainingQty = 0` for that item regardless of the ordered/received math — a business decision always wins over quantity arithmetic.
- **Verification rules**: `grnVerifyApprove()` supports partial approval (`selectedDescriptions`) — unselected items on a GRN stay "Pending Verification" indefinitely. It is idempotent: already-`Verified` rows are never re-stamped, and the Accounts notification fires only on a genuinely new approval (never on a repeat click).
- **Financial validation**: enforced entirely server-side in `validateGrnFinancialFields()` before any spreadsheet write — Basic Amount required/numeric/≥0, Discount can't exceed Basic Amount, CGST/SGST and IGST are mutually exclusive, negative values rejected in every field, Total Amount always server-recomputed (client value never trusted).
- **Search behaviour**: universal-query mode ORs across GRN No./PO No./Material Description; all filters (Category/Status/Date range) AND with the query; an entirely empty search (no query, no filters) is rejected before any sheet read.
- **Duplicate prevention**: `findDuplicates()` runs a normalized (lowercased, punctuation-stripped) name(+brand) match against both the Master Item List and pending ARN submissions before a new item can be submitted, requiring explicit acknowledgement if matches are found. GRN line-item duplication is only blocked at the (GRN No. + exact material description) level — this deliberately *allows* multiple different items under the same GRN No.
- **Idempotency**: `arnApprove()` and `grnVerifyApprove()` both short-circuit cleanly on an already-approved/already-verified row rather than re-processing or erroring.
- **Error handling**: `doGet`/`doPost` are each wrapped in one outer try/catch that converts any thrown error into a structured `{status:'error', message}` JSONP/JSON response rather than a raw HTTP failure. Slack/email notification failures are caught independently per notification and only logged — they never roll back or fail the underlying operation. Financial validation fails closed (rejects before writing) rather than writing partial/invalid data.

---

## 11. External Integrations

- **Tally**: on-premises ERP, reachable only over the local network at a hardcoded IP:port (`http://192.168.29.22:9999`). Data flows one-way, Tally → this system, via the Python `integration/` layer's raw XML/HTTP requests. No integration flows back into Tally.
- **Slack**: three Incoming Webhooks, each permanently bound (at creation time, in Slack's own UI) to one fixed destination — a channel or an individual's DM. Data flows one-way, system → Slack, fire-and-forget (failures are logged, never surfaced to the end user or allowed to block the underlying operation).
- **Google Sheets**: the actual datastore — three separate spreadsheets, accessed exclusively via `SpreadsheetApp` from within the Apps Script backend. No other component touches Sheets directly.
- **Apps Script Web App**: the sole backend/API surface, deployed as `access: ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING` (per `appsscript.json`) — reachable by anyone with the URL; authorization (where it exists at all) is implemented ad hoc inside the script logic itself (see §12), not via Apps Script's own access controls.
- **Frontend**: static files with no server-side rendering, hosted externally (inferred from deep links embedded in Slack notification messages pointing at `https://siddharthramkrishnan.github.io/inventory/...` — **(assumption)**, likely GitHub Pages, not independently confirmed by inspecting a hosting config in this repository). Every page talks directly to the Apps Script Web App URL; there is no intermediate frontend server.

**Data flow, end to end**: Tally → Python (`integration/`) → Apps Script `doPost` (`PO_SYNC`) → `Open POs (Tally)` sheet → `getActivePOs()` (cached) → GRN Entry frontend → `grnCreate()` → GRN category tab → Slack (requester notified) → GRN Verification frontend → `grnVerifyApprove()` → Slack (Accounts notified) → GRN Search frontend (read-only history).

---

## 12. Project Structure

```
inventory-management/
├── backend/                       Google Apps Script project source (pushed to scriptId 1gPlsV-gi_...)
│   ├── Code.gs                    2,752 lines. Newer/diverged file — has an optimized grnVerifyLookup()
│   │                              but is MISSING the overhead/cashoutflow dashboard functions entirely.
│   ├── Code.js                    2,957 lines. Original/older file, self-labeled "Code.gs" in its own
│   │                              header comment. Contains the ONLY definitions of OVERHEAD_SHEET_ID,
│   │                              OVERHEAD_GOOGLE_CLIENT_ID, OVERHEAD_ALLOWED_EMAILS,
│   │                              verifyGoogleIdToken(), getOverheadSummary(), getCashoutflowSummary(),
│   │                              getTopCashoutflowVendors(), authorizeExternalRequests().
│   ├── appsscript.json            Manifest: V8 runtime, Asia/Kolkata, Drive + AdSense advanced services,
│   │                              webapp access ANYONE_ANONYMOUS / executeAs USER_DEPLOYING, no triggers.
│   └── .clasp.json                clasp config: scriptId, scriptExtensions [".js",".gs"], empty filePushOrder.
│
├── frontend/                      Static HTML+CSS+JS pages, no build step
│   ├── home.html                  Navigation hub.
│   ├── index.html                 Inventory Adjustment.
│   ├── request.html                Material Request.
│   ├── arn-assign.html            ARN Assignment (submit + approve).
│   ├── grn-entry.html             GRN Creation.
│   ├── grn-verify.html            GRN Verification.
│   ├── grn-search.html            GRN Search & History.
│   └── exec-dashboard/
│       ├── overhead.html          Executive financial dashboard (Google-Sign-In gated).
│       └── overhead-auth-test.html  Throwaway auth diagnostic, explicitly not production security.
│
├── integration/                   Standalone Python package: Tally → Apps Script sync
│   ├── tally_connection.py        Raw HTTP transport to Tally's local XML server.
│   ├── tally_parser.py            XML request templates + response parsing into dataclasses.
│   ├── tally_client.py            Public interface composing connection + parser.
│   ├── po_translator.py           Maps parsed POs into the Apps Script payload shape.
│   ├── po_sync.py                 HTTP POST to Apps Script (PO_SYNC), secret-authenticated.
│   ├── run_sync.py                Real CLI entry point — full connect→parse→translate→sync flow.
│   ├── diagnose_two_pos.py        One-off diagnostic script, not part of the pipeline.
│   ├── test_purchase_orders.py    Manual/print-based smoke test (not an automated test suite).
│   ├── test_tally.py              Original bare connectivity proof-of-concept script.
│   ├── README_PHASE1.md           Phase 1 (Tally connectivity/parsing) documentation.
│   └── README_PHASE2.md           Phase 2 (sync-to-Sheets) documentation, incl. live-deployment caveats.
│
├── docs/                          Prior engineering audits/analyses of this codebase — not verified
│   │                              fresh for this document; described here by title/apparent purpose only.
│   ├── CODE_DEPLOYMENT_ANALYSIS.md   Analysis of the Code.gs/Code.js dual-file architecture and its risks.
│   ├── DEPLOYMENT_RUNBOOK.md         Step-by-step deployment procedure for the Tally→PO integration.
│   ├── DEPLOYMENT_CHECKLIST.md       A prior phase's deployment-readiness review.
│   ├── ROOT_CAUSE_*.md (×6)          Root-cause investigations into specific historical bugs.
│   ├── FINAL_TEST_VERIFICATION.md    Test verification notes from a prior phase.
│   ├── IMPLEMENTATION_GAPS.md        Tracked gaps between design and implementation.
│   └── TEST_RESULTS.md               Test run results from a prior phase.
│
└── (top-level *.md files)         Prior architecture/reference documentation — ARCHITECTURE.md,
                                    BACKEND_FLOW.md, FRONTEND_FLOW.md, FUNCTION_MAP.md, FILE_MAP.md,
                                    DATA_MODEL.md, FIELD_MAPPING.md, BUSINESS_RULES.md,
                                    PROJECT_OVERVIEW.md, IMPLEMENTATION_PHASES.md,
                                    PO_IMPORT_ARCHITECTURE.md, TALLY_INTEGRATION_PLAN.md.
                                    This document (SYSTEM_DOCUMENTATION.md) is a fresh, code-first
                                    synthesis and does not assume these are current — treat them as
                                    historical/supplementary context, not a source of truth.
```

---

## 13. Current Features

- Inventory stock-movement logging (Inward/Issue/Damage/Return/Recount/Transfer/Write-Off) with per-type conditional validation.
- Employee-submitted material requests with lab-abbreviation-aware smart search and priority flagging.
- ARN (Asset Reference Number) assignment workflow with department-scoped approval, live duplicate detection, and rule-based category suggestion.
- A "personal purchase / reimbursement" sub-flow within ARN assignment, including provisional reference numbers and a weekly outstanding-reimbursement Slack/email digest **(digest requires a manually-installed time trigger not confirmed present — see §7)**.
- GRN creation against an open PO (auto-filled outstanding-balance checklist) or fully manually, supporting multiple line items per GRN and one ad-hoc "not on PO" item.
- Per-item GST/discount financial computation with server-side validation, mutual CGST/SGST-vs-IGST exclusivity, and legacy plain-"GST"-column backward compatibility.
- PO line-item shortfall reporting (manual override) as an append-only audit trail.
- GRN verification by the original requester, with partial (per-item) approval and idempotent re-approval handling.
- Free-text + filtered GRN search across every category, with sortable results, CSV export, print layouts, and a cached detail view.
- Four distinct Slack notification flows (GRN-logged-for-verification, Accounts-approval DM, personal-purchase alert, weekly reimbursement digest), three using dedicated Incoming Webhooks plus two with parallel email.
- Tally ERP Purchase Order extraction (XML/HTTP), parsing, and translation into the Apps Script backend's expected shape — **fully built and tested against live Tally data, but the final sync-into-Sheets hop is not confirmed exercised against production** (see §3, §15).
- Computed Open/Closed PO status and remaining-quantity balances that account for partial receipts and manual overrides.
- A restricted executive dashboard (Overhead spend + Cash Outflow by category) gated by Google Sign-In with server-side email allow-listing.
- A legacy Drive-folder/`.xlsx`-based PO import path, deliberately left in place, unused, as a rollback option.

---

## 14. Future Enhancements

Practical improvements that fit the existing architecture without redesigning it:

- **Confirm and complete the PO_SYNC deployment**: verify the live Apps Script deployment actually contains the `PO_SYNC` branch, set the `TALLY_SYNC_SECRET` Script Property, and run a single-PO smoke test (`run_sync.py` against one PO) before a full sync — closing the one gap standing between the Tally integration being "code complete" and "actually live."
- **Reconcile `Code.gs`/`Code.js` into one file**, or at minimum move the overhead/cashoutflow functions and constants into `Code.gs` so it's no longer silently dependent on `Code.js` for symbols its own `doGet` calls. This also removes the undefined "which `grnVerifyLookup()` body actually runs" ambiguity.
- **Install (or verify) the `sendWeeklyPrnDigest` time trigger** — the code already self-diagnoses this via `checkSetup()`; acting on that diagnostic closes a real, currently-unconfirmed gap.
- **Establish a documented deployment/versioning process** — record which deployment version is live, when it was last updated, and what it contains, given multiple points in this codebase's own history where source changes were made but not confirmed pushed to the live Web App.
- **Add a minimal automated test suite** (`pytest`) for the `integration/` layer — today it's manual/print-based only, with no assertions anywhere.
- **Consolidate the two independently-maintained employee lists** (`request.html`'s `EMPLOYEES` object vs. `arn-assign.html`'s separate `EMPLOYEES` object) into a single source — the code itself already flags this with a TODO comment.
- **Add retry/backoff to `po_sync.py`** — explicitly deferred in its own docstring as "a Phase 4 concern."
- **Remove or clearly deprecate-comment the unused `postToBackend()` function in `arn-assign.html`** and the legacy Drive/`.xlsx` PO import path in the backend, once the Tally-sourced path is proven in production (already the documented plan referenced in `IMPLEMENTATION_PHASES.md`).

---

## 15. Deployment Notes

### What must be deployed together

- **Backend**: `Code.gs` **and** `Code.js` must both be present in the Apps Script project (script ID `1gPlsV-gi_PYoSpreBX0-OMhxYZtVYOKgxJa6HheyYtrWb5jfzMsPAyWH`) — `Code.gs` alone would throw a `ReferenceError` the moment the `overhead` or `cashoutflow` actions (or `checkSetup()`) run, since it calls symbols only `Code.js` defines.
- **Critically**: pushing updated source (via `clasp push` or manually pasting into the Apps Script editor) is **not sufficient** on its own — Apps Script Web Apps serve a specific, separately-versioned **Deployment**, which can lag behind the project's actual script content. A **new deployment version must be explicitly created and activated** for the live `/exec` URL to reflect any source change. This is a real, previously-encountered failure mode for this project (confirmed directly in a prior session of this same engagement: the GRN Search feature appeared completely broken in the browser — silent, no error — because the deployed Web App was serving an older `doGet()` that predated the `grnsearch` action).

### Frontend

Nine static HTML files with no build step — deploy by copying the raw files to wherever they're hosted (inferred to be GitHub Pages at `siddharthramkrishnan.github.io/inventory/`, based on deep links embedded in the backend's Slack notification messages — **not independently confirmed**). Every page independently hardcodes the same Apps Script Web App URL as a JS constant — there is no shared config file, so a change to the deployment URL requires updating it in all nine files individually.

### Slack configuration

Three Incoming Webhook URLs are stored as plain source-code constants (not Script Properties): `SLACK_WEBHOOK_URL`, `GRN_ARN_APPROVAL_WEBHOOK_URL`, `ACCOUNTS_APPROVAL_DM_WEBHOOK_URL`. Each is permanently bound, at creation time in Slack's own UI, to one fixed destination (a channel, or — for the Accounts webhook — a specific person's DM). Rotating or re-pointing any of them requires creating a new Incoming Webhook in Slack and updating the corresponding constant in both `Code.gs` and `Code.js`, then redeploying.

### Google Sheet configuration

Three separate spreadsheets, referenced by hardcoded ID: `SHEET_ID` (Inventory Adjustment DB), `GRN_REGISTRY_SHEET_ID` (GRN registry, Tally POs, overrides, Slack-user IDs), `OVERHEAD_SHEET_ID` (financial dashboards — `Code.js` only). Whoever deploys the Apps Script project must have edit access to all three. The `Slack-user IDs` tab must be kept populated for name-to-Slack-ID resolution used by `getSlackUserId()` (the Accounts DM webhook itself doesn't need this, since it's pre-bound to its recipient).

### Tally configuration

Tally must be running with its XML/HTTP server enabled on the hardcoded LAN address `192.168.29.22:9999`; the `integration/` scripts must run from a machine that can reach that address (i.e. on-premises, not an arbitrary cloud host). `INVENTORY_TALLY_SYNC_SECRET` must be set in the environment running `run_sync.py`, matching a `TALLY_SYNC_SECRET` Script Property that must be manually created on the Apps Script side (it is not part of any file in this repository). `INVENTORY_APPS_SCRIPT_URL` is optional, only needed to point at a non-default deployment (e.g. for testing).

---

## Assumptions & Verification Notes

- **Live deployment content could not be directly inspected** while writing this document (no outbound network access in this session). Everything backend-related above describes the **current source files** (`Code.gs`/`Code.js`) as committed on disk — whether the live `/exec` URL actually reflects this source is a separately-tracked, previously-confirmed risk for this project (see §15).
- **Which of `Code.gs`'s or `Code.js`'s two different `grnVerifyLookup()` implementations actually executes at runtime is undeterminable from source alone** — both files declare a function of that name in the same shared global scope, and Apps Script's file-load-order behavior for this case is not exposed anywhere in this repository (`.clasp.json`'s `filePushOrder` is empty).
- **GRN category tab names** (the literal sheet names inside the GRN registry spreadsheet) were not enumerated directly — that would require live Sheet access. They're documented here functionally, as "any sheet whose header row contains `grn no.`", per `getGrnCategoryTabs()`'s own logic.
- **Frontend hosting location** (GitHub Pages at `siddharthramkrishnan.github.io/inventory/`) is inferred from hardcoded deep links inside Slack notification message text in the backend code, not confirmed via a hosting config file in this repository.
- **Whether a time-driven trigger for `sendWeeklyPrnDigest` is currently installed** cannot be determined from source — trigger installations are stored in Apps Script project metadata, not in any file here. The codebase's own `checkSetup()` diagnostic exists specifically because this can't be known statically.
- **The Tally PO_SYNC path's live status**: per `po_sync.py`'s own docstring and `integration/README_PHASE2.md`, the Python-side pipeline (Tally connection → parsing → translation) has been run and verified against real Tally data (29 live POs, per that README), but the final HTTP hop into the live Apps Script Web App has explicitly **not** been confirmed exercised in production as of the state captured in these files.
