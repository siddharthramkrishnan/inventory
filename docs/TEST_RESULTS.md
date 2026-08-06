# Test Results — GRN + PO Link + Approval Full Test Plan

Source spec: `docs/GRN_Full_Test_Plan.docx`. Every test case (A1–G3) below was
verified by static code trace only — no code was executed or modified, no
live Google Sheet/Drive/Slack state was inspected. Where a verdict depends on
something this repo cannot show (actual dummy-PO file contents, live Sheet
state, actual Slack delivery), that dependency is stated explicitly rather
than assumed.

`Part H` (Wrap-Up) is process/cleanup guidance, not a testable implementation
behavior, and is out of scope for this comparison.

## Summary

| Test | Title | Verdict |
|---|---|---|
| A1 | Log a single-item delivery against a PO | **PASS** |
| A2 | Confirm the Slack notification and approve it | **PASS** |
| B1 | One delivery, multiple PO items, one GRN No. | **PASS** |
| B2 | Only Slack once, not three times | **PASS** |
| B3 | Approve some items, leave others pending | **PASS** |
| B4 | Approve the remaining item later | **PARTIAL** |
| C1 | First partial delivery | **PASS** |
| C2 | Reopen the same PO — confirm it remembers | **FAIL** |
| C3 | Second (final) partial delivery | **PARTIAL** |
| D1 | Receive one item in full, leave the other partial | **PASS** |
| D2 | Reopen the PO — only the partial item should remain | **FAIL** |
| E1 | Receive part of an order, then declare the rest never coming | **PARTIAL** |
| E2 | Confirm the item is gone for good | **PASS** |
| F1 | Log an extra item alongside a real PO delivery | **PASS** |
| F2 | Multiple items in one delivery, no PO at all | **PASS** |
| G1 | A broken PO file doesn't break the whole list | **PASS** |
| G2 | Duplicate GRN No. + same item is rejected | **PASS** |
| G3 | Submitting with nothing selected | **PASS** |

Two root causes account for every FAIL/PARTIAL: **Gap #1** (the PO-picker's
server-side cache is never invalidated after a GRN write) and **Gap #2** (the
verify-approval response message miscounts already-verified items as
"pending" on a second approval round). Full detail in `IMPLEMENTATION_GAPS.md`.

---

## Part A — Core Flow

### A1. Log a single-item delivery against a PO — **PASS**

- **Frontend:** `frontend/grn-entry.html`. PO dropdown populated by
  `loadActivePOs()` → JSONP `action=activePOs`. Selecting a PO
  (`#f-po-select` `change` handler) sets `#f-po-no`/`#f-party-name` from
  `po.poNo`/`po.vendor`, and renders one checkbox per outstanding item with
  its own pre-filled quantity input (`defaultQty`) and a read-only rate
  annotation. Tab selection (`#f-tab` `change`) triggers
  `loadPrefixesForTab()` + `refreshSuggestions(true)` → JSONP
  `grnprefixes`/`grnsuggest`.
- **Backend:** `getActivePOs()` → `parsePOFile()`/`parsePOSheetValues()`
  (PO data); `getPrefixesForTab()`, `suggestNextGrnFields()` (Sl No./GRN No.
  suggestions); submit → `grnCreate(data)`.
- **Trace:** submit builds one payload per checked item
  (`checkedItems.length > 0` branch), sends `action=grncreate` JSONP,
  `grnCreate` validates required fields, runs `ensureGrnVerificationColumns`
  (adds Verification Status/Verified By/Verified Date if missing), runs the
  duplicate check (no match on a fresh GRN No.), appends the row with
  `Verification Status = 'Pending Verification'`.
- **Verdict reasoning:** every step described in the test is implemented
  and wired correctly. One presentation nuance, not a defect: "item...
  auto-fill" is a checklist row with an editable quantity input, not a
  single autofilled text field — functionally equivalent to what's
  described, just a different UI shape than a literal reading might expect.

### A2. Confirm the Slack notification and approve it — **PASS**

- **Frontend:** `frontend/grn-verify.html`, reached via the link
  `notifyGrnForVerification()` builds:
  `https://siddharthramkrishnan.github.io/inventory/grn-verify.html?tab=...&grn=...`.
- **Backend:** `notifyGrnForVerification()` (fires from `grnCreate` when
  `isFirstItemForThisGrn`) → `getSlackUserId()` (resolves an `@mention`) →
  `UrlFetchApp.fetch(GRN_ARN_APPROVAL_WEBHOOK_URL, ...)`. Verify page:
  `grnVerifyLookup(tab, grn)` (load) → `grnVerifyApprove(tab, grn, person,
  selectedDescriptions)` (approve).
- **Trace:** `grnVerifyLookup` returns Material/Quantity/Invoice
  Amount/GRN No./PO No./Vendor/Invoice No./Received Date/Requested By.
  Checkbox is hardcoded `checked` in the render template. Approve requires a
  non-empty name, sends the checked item's description, `grnVerifyApprove`
  sets Verification Status → `Verified`, Verified By → `person`, Verified
  Date → `new Date()` on the matching row.
  Sheet writes match the expected outcome exactly.
- **Verdict reasoning:** the entry → notify → verify → approve loop is
  correctly and completely wired. Two caveats, neither a failure of the
  implementation: (1) actual Slack delivery cannot be confirmed by static
  review — it depends on the live webhook and channel, which this review has
  no access to; the code's *attempt* to send is unconditionally correct.
  (2) the notification send is wrapped in try/catch
  (`notifyGrnForVerification`) and a failure there is silently swallowed —
  the GRN write still reports success either way, so a broken webhook would
  never surface as an app-visible error. This matches the test plan's own
  warning ("apps can show a success message even when something didn't save
  correctly") — it just applies to the Slack leg here, not the Sheet write.
  Also note: the Verify page shows only 3 of the fields a GRN can carry
  (Material/Quantity/Invoice Amount) even though the backend returns Basic
  Amount, GST, and Other Charges too (`grnVerifyLookup` includes every
  `colMap` field in its response; `grn-verify.html`'s `row(...)` calls
  simply don't render them) — not relevant to A1/A2 as scripted (those
  fields aren't filled in for a basic single-item entry), but worth knowing
  for any richer GRN. See `IMPLEMENTATION_GAPS.md` Gap #3.

---

## Part B — Multi-Item Deliveries

### B1. One delivery, multiple PO items, one GRN No. — **PASS**

- **Frontend:** `grn-entry.html`, `#f-po-select` `change` handler renders
  one checkbox + own quantity/Basic Amount/GST input set per outstanding
  item (`outstandingItems.forEach`).
- **Backend:** `grnCreate(data)`, called once per checked item.
- **Trace:** submit builds `itemPayloads` via
  `checkedItems.map(...)` — each payload carries the *same* `baseData`
  (shared GRN No./tab/etc.) but its *own* `materialDescription`,
  `quantity`, `basicAmount`, and `gst` (computed by `formatGst()`, e.g.
  `18%` of a Basic Amount of 2300 → `"414 (18% GST)"`, matching the spec's
  own example format). Three sequential JSONP `grncreate` calls append
  three rows sharing one GRN No. `grnCreate`'s duplicate check only blocks
  an *exact* GRN No.+description repeat, so three distinct descriptions
  under one GRN No. all succeed.
- **Verdict reasoning:** exactly matches spec — per-item cost fields are
  genuinely independent, not copied across items.

### B2. Only Slack once, not three times — **PASS**

- **Backend:** `grnCreate()`'s `isFirstItemForThisGrn` check — a fresh scan
  of the tab's GRN No. column, run *before* the current item's row is
  appended.
- **Trace:** the frontend's submit loop is
  `for (const payload of itemPayloads) { await jsonp('grncreate', ...) }` —
  strictly sequential, not parallel. For item 1, no row with this GRN No.
  exists yet → `isFirstItemForThisGrn = true` → Slack fires. By the time
  item 2's call runs, item 1's row is already committed → `false` → no
  Slack. Same for item 3.
- **Verdict reasoning:** correct as implemented. Flagged for awareness, not
  as a defect: this correctness depends entirely on the frontend submitting
  sequentially. If that loop were ever parallelized, all items would see an
  empty-of-this-GRN sheet state simultaneously and each would fire its own
  notification — a latent fragility, not a current bug.

### B3. Approve some items, leave others pending — **PASS**

- **Frontend:** `grn-verify.html`, unchecking one of three checkboxes before
  clicking Approve.
- **Backend:** `grnVerifyApprove(tab, grn, person, selectedDescriptions)`.
- **Trace:** `selectedDescriptions` (2 of 3 items) is compared per-row via
  `selectedSet`; the unchecked item's row is `continue`d past (left
  untouched, stays `Pending Verification`); the two checked rows are marked
  `Verified`. Response: `itemsApproved: 2, itemsSkipped: 1`. Frontend
  message: `"2 item(s) approved. 1 item(s) left as Pending Verification
  (not checked)."` — matches the spec's expected message and Sheet state
  exactly.

### B4. Approve the remaining item later — **PARTIAL**

- **Frontend:** `grn-verify.html`, reopening the same link after B3.
- **Backend:** `grnVerifyApprove()`, second call.
- **Trace — the part that works:** `grnVerifyLookup` returns the current
  per-row `verificationStatus`; already-`Verified` rows render as a badge
  (`<span class="status-badge verified">`), not a checkbox
  (`checkboxHtml` ternary in `grn-verify.html`); only the still-`Pending`
  item renders a checkbox, checked by default. This part matches the spec
  exactly.
- **Trace — the part that doesn't:** clicking Approve now sends
  `selectedDescriptions = [thirdItemDesc]` only (badges were never
  checkboxes, so `querySelectorAll('.verify-item-checkbox:checked')`
  can't include them). Inside `grnVerifyApprove`'s loop, **the
  selection-membership check runs before the already-verified check**:
  ```js
  if (selectedSet && descCol) {
    const rowDesc = ...;
    if (!selectedSet.has(rowDesc)) {
      skippedCount++;
      continue; // this specific item wasn't checked — leave it Pending
    }
  }
  const currentStatus = sheet.getRange(rowNum, statusCol).getValue();
  if (currentStatus === 'Verified') { alreadyVerifiedCount++; continue; }
  ```
  (`backend/Code.gs`, inside `grnVerifyApprove`) — the two already-`Verified`
  rows never reach the `currentStatus === 'Verified'` branch at all in this
  second call, because they fail the *selection* check first and are
  counted as `skippedCount`, not `alreadyVerifiedCount`. The response is
  `itemsApproved: 1, itemsSkipped: 2`. The frontend then displays: `"Item
  approved. 2 item(s) left as Pending Verification (not checked)."` — **this
  is factually wrong**: those 2 items are not pending, they were already
  verified in B3.
- **Data integrity is not affected** — the two rows are simply never
  written to in this call (they were already correct from B3), so the
  underlying Sheet ends up fully correct (all 3 `Verified`). Only the
  *message* is wrong.
- **Verdict reasoning: PARTIAL.** The functional outcome the test checks
  for (checkbox/badge UI state, "Approve it" completing) is correct. The
  confirmation message this same click produces is incorrect in exactly
  the two-round-approval scenario this test is designed to exercise — see
  `IMPLEMENTATION_GAPS.md` Gap #2.

---

## Part C — Partial Deliveries

### C1. First partial delivery — **PASS**

- **Frontend/Backend:** `grn-entry.html` → `getActivePOs()` →
  `getReceivedQtyByPOAndItem()` (returns `0` received for a never-touched
  PO+item) → checklist quantity input defaults to `remainingQty = 100`.
  Submit → `grnCreate` writes one row, `quantity = 40`.
- **Verdict reasoning:** this is the *first* fetch of `activePOs` for this
  PO in the test sequence, so no caching concern applies yet — matches spec.

### C2. Reopen the same PO — confirm it remembers — **FAIL**

- **Frontend file:** `frontend/grn-entry.html` — `loadActivePOs()`,
  triggered unconditionally on every page load.
- **Backend function:** `getActivePOs()`, `backend/Code.gs`.
- **Exact reason:** `getActivePOs()` caches its *entire* result (every PO,
  every item) for 5 minutes under one global key:
  ```js
  function getActivePOs() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('activePOs');
    if (cached) return JSON.parse(cached);
    // ... Drive parse + getReceivedQtyByPOAndItem() + getPOOverrideKeys() ...
    const result = { status: 'success', pos: pos };
    cache.put('activePOs', JSON.stringify(result), PO_CACHE_SECONDS); // 300s
    return result;
  }
  ```
  `grnCreate()` — the function C1's submit actually calls — **never touches
  `CacheService` at all.** The only function anywhere in this codebase that
  invalidates this cache is `reportPOShortfall()`
  (`CacheService.getScriptCache().remove('activePOs')`). A normal GRN
  submission is not that function. So: if C2 is performed within 5 minutes
  of C1 (the literal, natural pace of following this test script), the
  reopened PO picker serves the **stale, pre-C1 snapshot** — still showing
  100 remaining, still defaulting the quantity field to 100, not 60.
  Reloading the page (navigating back to `grn-entry.html`, as C2 literally
  instructs) does **not** help — `CacheService` is a server-side,
  script-scoped cache; a fresh page load still hits the same stale
  server-side cache entry for its full 5-minute lifetime, regardless of how
  many new client sessions request it.
- **Code evidence:** `grnCreate` (full function body, `backend/Code.gs`) —
  no `CacheService` reference. `reportPOShortfall` (same file) — the only
  function with a `cache.remove('activePOs')` call.
- **Missing implementation:** `grnCreate()` needs the same
  `CacheService.getScriptCache().remove('activePOs')` call
  `reportPOShortfall()` already has, so a GRN write is reflected in the PO
  picker immediately rather than after an unpredictable wait.
- **Verdict reasoning:** the test's own stated rationale — *"if it defaulted
  back to 100, someone could accidentally double-count stock"* — is exactly
  the failure mode this gap produces under normal test-execution timing.

### C3. Second (final) partial delivery — **PARTIAL**

- **Frontend/Backend:** same as C1/C2.
- **Trace:** the *write* half of this test ("submit the remaining 60 units
  ... a second row appears") is unaffected by caching — `grnCreate` writes
  directly, no cache involvement in the write path. **PASS** for that half.
- **The *read-verification* half** ("reopen the PO picker ... item should
  now be GONE") is subject to the identical Gap #1 as C2: whatever
  `activePOs` snapshot is currently cached (populated at C1 or C2's fetch,
  reflecting at most 40 received) will not reflect C3's newly-submitted 60
  units until the 5-minute window lapses. The item would very plausibly
  still show as open with 60 remaining, not gone.
- **Verdict reasoning: PARTIAL** — write correct, disappearance-from-picker
  check unreliable for the same reason as C2.

---

## Part D — Mixed Partial + Full Multi-Item PO

### D1. Receive one item in full, leave the other partial — **PASS**

- **Frontend/Backend:** `grn-entry.html` → `grnCreate()`, once per checked
  item.
- **Trace:** this is the first test to touch PO `ACHIRA/26-27/81`, so
  whatever `activePOs` snapshot is currently cached correctly reflects its
  untouched state (200/20 ordered, 0 received) — Gap #1 doesn't apply to a
  PO's *first* appearance. The user directly overrides the 200-unit item's
  quantity input to 150 before submit; what gets written is exactly what
  was typed, independent of whether the *displayed* remaining-balance
  number was fresh or stale. Two rows are appended under one GRN No., 20
  and 150 units respectively — matches spec.

### D2. Reopen the PO — only the partial item should remain — **FAIL**

- **Frontend file:** `frontend/grn-entry.html` — `loadActivePOs()`.
- **Backend function:** `getActivePOs()`, `backend/Code.gs`.
- **Exact reason:** identical root cause to C2 — this is a "reopen and
  re-check the picker" step immediately following a `grnCreate()` write,
  and `grnCreate()` does not invalidate the `activePOs` cache. The cached
  snapshot from before D1's submission would still show both items open
  (20/20 and 200/20), not "only the large item... 150 of 200... The
  20-unit item is gone."
- **Code evidence:** same as C2.
- **Missing implementation:** same as C2 — a cache-invalidation call inside
  `grnCreate()`.
- **Verdict reasoning:** same mechanism as C2, different test — grouped
  under Gap #1 rather than treated as a separate defect.

---

## Part E — Vendor Short-Ships Permanently

### E1. Receive part, then declare the rest never coming — **PARTIAL**

- **Frontend:** `grn-entry.html` — the "Report shortfall" button, and its
  `prompt()`-based reason/name capture.
- **Backend:** `grnCreate()` (the 60-unit submission),
  `reportPOShortfall(poNo, itemDescription, reason, closedBy)`.
- **Trace — submission (PASS):** the 60-unit delivery write itself is a
  plain `grnCreate()` call, unaffected by caching.
- **Trace — the "reopen and confirm 60/40 + shortfall button" step
  (subject to Gap #1):** this is again a reopen-immediately-after-a-write
  step. Beyond just showing a stale number, this has a **more severe
  consequence than C2/D2**: the "Report shortfall" button's very existence
  is conditional —
  ```js
  (item.receivedQty > 0
    ? '<button type="button" class="shortfall-btn" ...>Report shortfall ...</button>'
    : '')
  ```
  (`grn-entry.html`). If the cached snapshot still reflects 0 received
  (pre-dating the 60-unit submission), `item.receivedQty` reads as `0` and
  **the button does not render at all** — the test cannot even be completed
  as written until the cache happens to expire.
- **Trace — the override write itself (PASS):**
  `reportPOShortfall()` validates `poNo`/`itemDescription`/`closedBy`,
  appends `[poNo, itemDescription, reason||'', closedBy, new Date()]` to
  "PO Manual Overrides" (auto-created via `getOrCreatePOOverridesSheet()`
  with headers `['PO No.', 'Item Description', 'Reason', 'Closed By',
  'Closed Date']`) — matches the spec's expected row exactly.
- **Verdict reasoning: PARTIAL** — the override-recording mechanism itself
  is correctly implemented (would be a clean PASS in isolation), but the
  precondition the test walks through to reach it (confirming "60 of 100...
  40 remaining" and clicking a button that may not be rendered) is subject
  to Gap #1, same as C2/D2.

### E2. Confirm the item is gone for good — **PASS**

- **Backend:** `reportPOShortfall()` explicitly calls
  `CacheService.getScriptCache().remove('activePOs')` before returning.
- **Trace:** the next `getActivePOs()` call is therefore guaranteed a cache
  miss, forcing a fresh recompute. `getPOOverrideKeys()` reads the fresh
  "PO Manual Overrides" row and forces `isOverridden = true` →
  `remainingQty = 0` **regardless of the actual received/ordered math** —
  so this specific check is not exposed to Gap #1 at all; the shortfall
  action's own invalidation covers it.
- **Verdict reasoning:** correctly implemented — this is the one read-after-write
  check in Parts C–E that the code actually protects.

---

## Part F — Item Not on the PO

### F1. Log an extra item alongside a real PO delivery — **PASS**

- **Frontend:** `grn-entry.html`, `#f-adhoc-toggle` reveals
  description/quantity/basic-amount/GST fields; submit appends one extra
  payload on top of whatever PO items were checked:
  ```js
  materialDescription: '[Not on PO] ' + adhocDesc,
  ```
- **Backend:** `grnCreate()`, called once for the checked PO item and once
  more for the ad-hoc item, both sharing `baseData.grnNo`.
- **Verdict reasoning:** matches spec exactly, including the literal
  `"[Not on PO] ..."` prefix format. No read-after-write step in this test,
  so Gap #1 does not apply.

### F2. Multiple items in one delivery, no PO at all — **PASS**

- **Frontend:** `grn-entry.html`, manual item blocks
  (`addManualItemBlock()`), PO dropdown left on `""`.
- **Backend:** `grnCreate()`, once per non-empty manual block.
- **Trace:** with no PO selected and no checked PO checkboxes, the
  `else if (!poIsSelected)` branch reads every `.manual-item-block`,
  skipping any with a blank description. Both filled blocks (qty 10 /
  basic 500 / GST 18% → `formatGst` computes `500 * 0.18 = 90` →
  `"90 (18% GST)"`; qty 5 / basic 300 / GST 12% → `300 * 0.12 = 36` →
  `"36 (12% GST)"`) submit as two rows under one GRN No. — matches the
  spec's own example figures exactly.

---

## Part G — Failure Handling

### G1. A broken PO file doesn't break the whole list — **PASS** *(with one unverifiable sub-claim)*

- **Backend:** `getActivePOs()`, `parsePOFile()`, `parsePOSheetValues()`.
- **Trace:** `parsePOFile()` wraps its *entire* body (Drive copy, Sheet
  open, cell read, and the call into `parsePOSheetValues()`) in a single
  try/catch, returning `null` on any exception. `parsePOSheetValues()`
  itself returns `null` (not a throw) for any of: missing "Voucher No."
  label, missing "Sl" label, empty parsed PO number, or zero valid item
  rows. `getActivePOs()`'s loop does `if (!parsed) continue;` — the bad
  file is skipped, the loop proceeds to the next file unaffected. This
  protection is unconditional — it doesn't matter *which* way
  `PO_MALFORMED` is broken, as long as the failure surfaces as either a
  thrown exception or a `null`/empty-items return, which covers every
  malformation category described in the spec ("deliberately broken...
  missing required information").
- **Unverifiable sub-claim:** *"Every OTHER PO should still load
  normally"* depends on the actual cell layout of the 8 other dummy `.xlsx`
  files (label text, header row wording) matching what
  `parsePOSheetValues()` expects. Those files live in a live Google Drive
  folder this review has no access to and are not present in this
  repository — this specific sub-claim cannot be confirmed by static code
  review and is not asserted either way here.
- **Verdict reasoning:** the tested *mechanism* (graceful skip of a bad
  file without aborting the list) is PASS, code-guaranteed, independent of
  the specific file.

### G2. Duplicate GRN No. + same item is rejected — **PASS**

- **Backend:** `grnCreate()`, `backend/Code.gs`.
- **Trace:**
  ```js
  if (rowGrn === targetGrn && rowDesc === targetDesc) {
    return { status: 'error', message: 'GRN No. "' + data.grnNo + '" already has an entry for "' + data.materialDescription + '" on this tab.' };
  }
  ```
  Case-insensitive, trimmed comparison on both GRN No. and material
  description. Re-selecting the same PO/item produces an identical
  description string (sourced fresh from the same parsed PO file each
  time), so the match is reliable. Message text matches the spec's
  expectation almost verbatim.

### G3. Submitting with nothing selected — **PASS**

- **Frontend:** `grn-entry.html`, submit handler.
- **Trace:** with a PO selected but every checkbox unchecked,
  `checkedItems.length === 0`; the manual-item branch is skipped because
  `poIsSelected` is true (`else if (!poIsSelected)`); the ad-hoc branch
  contributes nothing if left empty. `itemPayloads` ends up `[]`, and:
  ```js
  if (itemPayloads.length === 0) {
    showMsg('Please check at least one item from the PO, or fill in the extra-item section below, before submitting.', 'error');
    return;
  }
  ```
  fires **before** any `jsonp('grncreate', ...)` call is made — confirmed
  no network call occurs in this path.
