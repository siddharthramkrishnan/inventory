# Root Cause Analysis — GRN Test Plan Failures/Partials

Nothing in this document has been implemented. This groups the 5
non-passing test cases from `TEST_RESULTS.md` (C2, D2, C3, E1, B4) by their
**2 underlying root causes**, since 4 of the 5 share one cause.

| Root cause | Test cases covered |
|---|---|
| Group A — PO-picker cache never invalidated after a GRN write | C2 (FAIL), D2 (FAIL), C3 (PARTIAL), E1 (PARTIAL) |
| Group B — verify-approval counts already-verified rows as "skipped" | B4 (PARTIAL) |

(`Gap #3` from `IMPLEMENTATION_GAPS.md` — missing Basic Amount/GST display
on the verify page — is excluded here because it did not cause any test
case to be marked FAIL or PARTIAL; it was noted as a caveat on a PASS.)

---

## Group A — `grnCreate()` never invalidates the `activePOs` cache

**Covers:** C2 (FAIL), D2 (FAIL), C3 (PARTIAL), E1 (PARTIAL)

### 1. Exact root cause

`getActivePOs()` caches its entire result — every open PO and every item's
ordered/received/remaining quantities — under one global `CacheService`
key, `'activePOs'`, for `PO_CACHE_SECONDS` (300 seconds / 5 minutes). The
cache is populated on a miss and served as-is on every hit within that
window, regardless of what has changed on the underlying Sheets in the
meantime. Exactly one function in the codebase clears this cache early:
`reportPOShortfall()`. `grnCreate()` — the function every ordinary GRN
submission goes through — was never given the same treatment, so a normal
delivery write is invisible to the PO picker for up to 5 minutes.

### 2. Exact file

`backend/Code.gs`

### 3. Exact function

`grnCreate(data)` (missing the call). The cache itself is read/written in
`getActivePOs()`. The one existing correct example is in
`reportPOShortfall(poNo, itemDescription, reason, closedBy)`.

### 4. Why the implementation fails

```js
function getActivePOs() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('activePOs');
  if (cached) return JSON.parse(cached);
  // ... full Drive parse + getReceivedQtyByPOAndItem() + getPOOverrideKeys() ...
  const result = { status: 'success', pos: pos };
  cache.put('activePOs', JSON.stringify(result), PO_CACHE_SECONDS);
  return result;
}
```

`grnCreate()`'s body — validation, `ensureGrnVerificationColumns`,
duplicate check, `sheet.appendRow(newRow)`, conditional Slack notify,
`return {status:'success', ...}` — contains no `CacheService` reference at
all. The moment a GRN is logged, the sheet is updated correctly, but the
**cached read-model of "what's still open on this PO" is not**. Any
frontend action that re-reads `activePOs` (reopening the PO picker,
reloading `grn-entry.html`, opening it in a second tab) within the next up
to 5 minutes gets the pre-write snapshot. Reloading the page does not
route around this, because the stale entry lives in Apps Script's
server-side `CacheService`, not in anything client-side — a new page load
is a new client request, but it lands on the same server-side cache entry.

The severity compounds in the shortfall-button case (E1): the button's
very presence is gated on `item.receivedQty > 0`, a value sourced from this
same stale snapshot — so the bug isn't limited to showing a wrong number,
it can hide a required UI control entirely.

### 5. Minimal code change required

Add one line, mirroring `reportPOShortfall()`'s existing pattern, at the
end of `grnCreate()`'s success path (after `sheet.appendRow(newRow)`,
before the `return`):

```js
CacheService.getScriptCache().remove('activePOs');
```

No other change is needed — `getActivePOs()` and `reportPOShortfall()`
already handle the invalidate-then-rebuild-on-next-read cycle correctly;
`grnCreate()` just needs to participate in it.

### 6. Regression risk

- **No correctness regression anywhere else.** No code in this repo reads
  the `'activePOs'` cache key expecting or depending on stale data — the
  only two touchpoints are `getActivePOs()` (reader) and
  `reportPOShortfall()` (the one existing invalidator). Adding a second
  invalidator does not change what any other function returns or does.
- **Increased read volume (performance/quota), not a behavior change.**
  Every cache miss re-triggers the expensive path in `getActivePOs()`: a
  Drive file listing, then per PO file a `Drive.Files.copy` + Sheet open +
  cell parse + `Drive.Files.remove`, plus a full multi-tab scan of the GRN
  Registry (`getReceivedQtyByPOAndItem()`) and a read of "PO Manual
  Overrides" (`getPOOverrideKeys()`). Invalidating on every `grnCreate()`
  call means every GRN submission forces the *next* PO-picker load (by
  anyone, in any tab) to pay this full cost instead of getting a cheap
  cache hit — a deliberate, expected trade-off for correctness, but a real
  one under heavy usage.
- **Redundant invalidation on multi-item submissions, but harmless.**
  `grnCreate()` is called once *per line item*, not once per whole GRN
  Entry submission (the frontend's submit loop calls it N times
  sequentially for an N-item delivery — see B1/F1/F2). Adding the
  invalidation inside `grnCreate()` means an N-item submission clears the
  cache N times in a row. `CacheService.remove()` on an absent/already-removed
  key is a documented no-op, not an error, so this is wasted work, not a
  bug — but it does mean an N-item GRN forces up to N redundant "cache is
  now empty" states in the window before the *next* read repopulates it,
  slightly amplifying the read-volume cost above the strict minimum a
  once-per-submission invalidation would cost. A stricter fix would
  invalidate once after the whole batch, not once per item — but doing
  that would require plumbing shared state across the frontend's
  per-item JSONP calls (each is a fully independent HTTP request/Apps
  Script execution with no memory of siblings), which is a larger, less
  "minimal" change than what's being described here.

### 7. Every other feature affected by the same change

- **`grn-entry.html`'s PO picker, system-wide, not just the scripted test
  scenarios.** Every path that reopens the picker after *any* GRN write —
  A1 (single item), B1 (multi-item), F1 (ad-hoc item alongside a PO), any
  real (non-test) GRN Entry submission against any PO — currently has the
  same latent staleness window; fixing Group A makes the picker
  consistently accurate after every write, not just the ones the failing
  tests happen to probe.
- **`reportPOShortfall()`'s own invalidation becomes one of two call
  sites** instead of the only one — no conflict, since both simply call
  `.remove()` on the same key; order and count don't matter
  (idempotent).
- **Shared Apps Script/Google API quotas.** `Drive.Files.copy`/`.remove`
  (advanced Drive service) and Sheets reads consume quota that is shared
  across the *entire* Apps Script project — including features with no
  direct relationship to GRN Entry at all: the ARN Assignment duplicate
  check, the ARN approval flow, the executive dashboard's Sheet reads, the
  weekly PRN digest. Increasing how often `getActivePOs()`'s expensive
  path runs increases contention for that shared quota/execution-time
  budget under heavy concurrent use, which could marginally slow down or
  (in an extreme, unlikely case) contribute to quota exhaustion affecting
  those unrelated features on a busy day. This is a secondary,
  probabilistic effect, not a direct functional change to those features.
- No frontend page other than `grn-entry.html` calls `action=activePOs`,
  so no other page's own rendered output changes.

---

## Group B — `grnVerifyApprove()` classifies already-verified rows as "skipped" instead of "already verified" when they aren't in the current selection

**Covers:** B4 (PARTIAL)

### 1. Exact root cause

Inside `grnVerifyApprove()`'s per-row loop, the **selection-membership
check runs before the already-verified check**. For a row that is both (a)
already `Verified` from an earlier approval round and (b) not present in
the *current* call's `selectedDescriptions` (which is exactly what happens
to every already-verified row on a second approval round, since
`grn-verify.html` renders already-verified items as read-only badges, not
checkboxes, so they can never be re-selected) — the function reaches the
selection check first, buckets the row into `skippedCount`, and `continue`s
before ever reaching the code that would have correctly classified it as
`alreadyVerifiedCount`.

### 2. Exact file

`backend/Code.gs`

### 3. Exact function

`grnVerifyApprove(tabName, grnNo, person, selectedDescriptions)`

### 4. Why the implementation fails

```js
for (let i = 0; i < grnValues.length; i++) {
  if (String(grnValues[i][0]).trim() !== String(grnNo).trim()) continue;
  matchedCount++;
  const rowNum = i + 2;

  if (selectedSet && descCol) {
    const rowDesc = String(sheet.getRange(rowNum, descCol).getValue() || '').trim().toLowerCase();
    if (!selectedSet.has(rowDesc)) {
      skippedCount++;
      continue; // this specific item wasn't checked — leave it Pending
    }
  }

  const currentStatus = sheet.getRange(rowNum, statusCol).getValue();
  if (currentStatus === 'Verified') {
    alreadyVerifiedCount++;
    continue;
  }
  sheet.getRange(rowNum, statusCol).setValue('Verified');
  // ...
}
```

The comment on the `skippedCount++` line — *"this specific item wasn't
checked — leave it Pending"* — is only true for a row that is genuinely
still `Pending Verification`. It is not true for a row that is already
`Verified` and simply had no checkbox to check in the first place. Because
the code never inspects `currentStatus` before deciding "not selected ⇒
skipped," it conflates two semantically different situations under one
counter.

`grn-verify.html`'s click handler then builds its message straight from
that counter:

```js
if (result.itemsSkipped) successMsg += ' ' + result.itemsSkipped + ' item(s) left as Pending Verification (not checked).';
```

For B4 (2 of 3 already Verified, approving the 3rd): `itemsApproved: 1,
itemsSkipped: 2` → **"Item approved. 2 item(s) left as Pending
Verification (not checked)."** — stated as fact, but false; both of those
items are `Verified`, not pending. The Sheet itself is not corrupted by
this (the already-verified rows are simply never written to, and were
already correct), so this is a pure reporting/messaging defect, not a data
defect.

### 5. Minimal code change required

Reorder the two checks so the already-verified check runs **first**, for
every matching row, before the selection filter is applied:

```js
for (let i = 0; i < grnValues.length; i++) {
  if (String(grnValues[i][0]).trim() !== String(grnNo).trim()) continue;
  matchedCount++;
  const rowNum = i + 2;

  const currentStatus = sheet.getRange(rowNum, statusCol).getValue();
  if (currentStatus === 'Verified') {
    alreadyVerifiedCount++;
    continue;
  }

  if (selectedSet && descCol) {
    const rowDesc = String(sheet.getRange(rowNum, descCol).getValue() || '').trim().toLowerCase();
    if (!selectedSet.has(rowDesc)) {
      skippedCount++;
      continue;
    }
  }

  sheet.getRange(rowNum, statusCol).setValue('Verified');
  // ...
}
```

This is a straight swap of the two existing blocks — no new variables, no
new branches, no change to what gets written to the Sheet, only a change
to which counter an already-verified/unselected row is attributed to.

*Alternative, slightly less minimal but avoiding the extra read described
in §6:* keep the selection filter first, but inside its "not selected"
branch, read `currentStatus` before deciding whether to attribute the row
to `alreadyVerifiedCount` or `skippedCount`, instead of assuming
"not selected" always means "skipped." This preserves the original
call-count for the common (first-round, everything still Pending) case at
the cost of a few duplicated lines. Either approach fixes the defect; the
straight reorder above is the more minimal one described in `TEST_RESULTS.md`.

### 6. Regression risk

- **Traced against B3 (first-round partial approval) — no behavior
  change.** With no pre-existing `Verified` rows, every matching row's
  `currentStatus` is `Pending Verification`, so the reordered
  already-verified check always falls through to the selection filter
  exactly as before; `skippedCount`/`itemsApproved` come out identical to
  the current (correct) B3 result. This was checked explicitly, not
  assumed.
- **Traced against the "approve all" default path** (`selectedDescriptions`
  omitted, `selectedSet === null`) — the selection-filter block is skipped
  entirely regardless of ordering (`if (selectedSet && descCol)` is false
  either way), so this path is untouched by the reorder.
- **No change to what is written.** The reorder only changes which
  in-memory counter an already-verified row increments; the `setValue`
  calls that actually mutate the Sheet are unchanged and unreached by
  already-verified rows both before and after the fix.
- **Minor, honestly-stated cost:** the straight-reorder version above adds
  one `getRange(statusCol).getValue()` call for rows that, pre-fix, would
  have been rejected by the (already-in-memory, no-API-call) selection
  filter before ever touching the Sheet again. In the common case (a
  first-round approval with several unselected-but-still-pending items),
  this means slightly more Sheets API calls per `grnVerifyApprove()`
  invocation than today — consistent with this function's existing,
  separately-documented pattern of many small, unbatched per-row API
  calls (`TEST_RESULTS.md`, A2 notes). The alternative fix in §5 avoids
  this specific cost if it matters; the straight reorder does not.
- **A behavior change beyond the failing test, and it's an improvement:**
  if `grnVerifyApprove()` is ever called with an empty selection
  (`selectedDescriptions: []`) against a GRN where every row is already
  `Verified` — not reachable through the current UI (the Approve button is
  disabled/relabeled once `allVerified` is true) but reachable via a
  direct API call — the current code returns `{status:'error', message:'No
  items were selected to approve.'}` (because every row gets bucketed into
  `skippedCount`, making `consideredCount` 0). Post-fix, the same call
  correctly returns `{status:'success', alreadyVerified:true}`, since
  every row is now correctly attributed to `alreadyVerifiedCount` before
  the selection filter is ever consulted. This is a side-effect of the
  same reordering, not a separate change, and it makes the function's
  behavior more consistent, not less.

### 7. Every other feature affected by the same change

**None.** `grnVerifyApprove()` has exactly one caller in the entire
codebase — `doGet`'s `action==='grnverify'` branch — and that branch has
exactly one frontend consumer, `grn-verify.html`'s Approve button. No other
page, function, or workflow reads this function's return value or is
downstream of the Sheet cells it writes (no other function reads
"Verification Status"/"Verified By"/"Verified Date" from a GRN Registry tab
except `grnVerifyLookup()`, which is only used to redisplay the same page).
The blast radius of this fix is fully contained to the GRN Verify
approval flow.
