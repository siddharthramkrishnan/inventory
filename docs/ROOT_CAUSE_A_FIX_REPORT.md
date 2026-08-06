# Root Cause A — Fix Report

Scope: **Root Cause A only** (`ROOT_CAUSE_ANALYSIS.md` — "PO-picker cache
never invalidated after a GRN write"), targeting C2, C3, D2, E1. Root Cause
B (`grnVerifyApprove()` miscounting, B4) was **not** touched, per
instruction, and remains open pending separate approval.

## Files modified

- `backend/Code.gs` — **only file changed.**

No other file in the repository was modified. `backend/Code.js` was
deliberately left untouched — see "Known limitation" below.

## Functions modified

- `grnCreate(data)` — one statement added. No other function was changed.

## The change

```diff
   sheet.appendRow(newRow);
 
+  // Invalidate the cached PO list so this change is reflected immediately,
+  // not after the usual 5-minute cache window.
+  CacheService.getScriptCache().remove('activePOs');
+
   if (isFirstItemForThisGrn) {
```

Confirmed via `git diff --stat` in `backend/`: `Code.gs | 4 ++++`, `1 file
changed, 4 insertions(+)` — nothing else in the file was touched; no line
was removed, renamed, or reordered elsewhere.

The comment and the call are copied verbatim from the one place in this
codebase that already does this correctly, `reportPOShortfall()`
(`backend/Code.gs`), so the fix introduces no new pattern — it just applies
an existing, established one to the one write path that was missing it.

## Reasoning

`ROOT_CAUSE_ANALYSIS.md` §5 (Group A) identified this exact one-line
addition, in this exact position, as the complete minimal fix: the
`activePOs` `CacheService` entry is a single global snapshot of every open
PO's ordered/received/remaining quantities, refreshed only on a cache miss
or an explicit `.remove()`. `grnCreate()` — the function every GRN Entry
submission goes through — updates the underlying Sheet correctly but was
never invalidating this cache, so the PO picker could keep serving a
pre-write snapshot for up to 5 minutes after a delivery was logged,
regardless of how many times the page was reloaded (the stale entry lives
server-side, not in the browser). The fix makes `grnCreate()` participate
in the same invalidate-then-rebuild-on-next-read cycle
`reportPOShortfall()` already uses.

The insertion point matters and was chosen deliberately: it sits **after**
`sheet.appendRow(newRow)` (so it only runs once the write has actually
succeeded) and **before** the `isFirstItemForThisGrn` Slack-notification
block (so it has no bearing on, and is unaffected by, that unrelated
branch). Every one of `grnCreate()`'s early-return validation/duplicate-check
paths returns before reaching `sheet.appendRow` at all, so none of them
reach the new line either — a rejected or invalid submission never
triggers a cache clear, which is correct, since nothing changed for it to
invalidate.

## Why this resolves C2, C3, D2, E1

All four fail for the identical reason: each test's assertion depends on
reopening the PO picker (`grn-entry.html` → `loadActivePOs()` →
`getActivePOs()`) immediately after a `grnCreate()` write, and the picker
was reading a cache that predated that write.

- **C2 — Reopen the same PO, confirm it remembers.** After C1's 40-unit
  submission, `grnCreate()` now clears `'activePOs'`. C2's reopen is
  therefore guaranteed a cache miss, forcing `getActivePOs()` to rebuild
  from the current Sheet state via `getReceivedQtyByPOAndItem()`, which now
  includes C1's row. Result: `receivedQty = 40`, `remainingQty = 60`,
  displayed as *"Ordered 100 Pcs — 40 already received, 60 remaining"*,
  quantity field defaults to 60 — matches the expected outcome exactly.
- **C3 — Second (final) partial delivery.** The write half was already
  correct (unaffected by caching). The read-verification half — "reopen
  the picker, item should be gone" — is now reliable: C3's own submission
  also invalidates the cache, so the reopen sees `receivedQty = 100`
  (40+60), `remainingQty = 0`. `getActivePOs()`'s `isOpen` check
  (`itemsWithBalance.some(item => item.remainingQty > 0)`) is false for
  this single-item PO, so the whole PO drops out of the picker entirely —
  matches "gone from the checklist entirely."
- **D2 — Reopen the mixed PO, only the partial item should remain.** D1's
  two `grnCreate()` calls (20-unit item, 150-unit item) each now
  invalidate the cache. The reopen is a guaranteed cache miss:
  `receivedQty` for the 20-unit item is now 20 of 20 (`remainingQty = 0`,
  filtered out client-side by `item.remainingQty === undefined ||
  item.remainingQty > 0`); the 200-unit item is 150 of 200
  (`remainingQty = 50`, shown as "150 of 200 already received, 50
  remaining"). Matches exactly.
- **E1 — Partial delivery, then report a permanent shortfall.** The
  60-unit submission now invalidates the cache, so reopening the picker
  correctly shows `receivedQty = 60`, `remainingQty = 40`. This also fixes
  the more severe consequence noted in the root-cause doc: the "Report
  shortfall" button's render condition, `item.receivedQty > 0`, now reads
  the correct (non-zero) value, so the button reliably appears instead of
  being silently absent. The override-write step itself
  (`reportPOShortfall()`) was already correct before this fix and is
  untouched by it.

## Confirmation that passing/unaffected test cases remain unaffected

Checked directly against the 4-line diff, not assumed — for each, either
the code path in question never reaches the new line, or the new line has
no relationship to what the test asserts:

| Test | Why it's unaffected |
|---|---|
| A1 | Asserts on the write itself (success message, row content, `Pending Verification` status) — none of that logic was touched; the new line runs after all of it and doesn't alter the return object. |
| A2 | Depends on `isFirstItemForThisGrn` (computed earlier in the function, before the new line — untouched) and on `grnVerifyLookup`/`grnVerifyApprove`, neither of which was modified. |
| B1 | Asserts on per-item Basic Amount/GST and shared-GRN-No. row writes — all in code preceding the new line; unchanged. |
| B2 | Depends on `isFirstItemForThisGrn`'s scan (reads the Sheet, unrelated to the `activePOs` cache) and the frontend's sequential submission order (frontend untouched). The new line touches a PO-data cache key, not the GRN Registry sheet the notification-dedup logic scans. |
| B3 | Exercises `grnVerifyApprove()` exclusively — a different function, not modified. |
| F1 | Same write-path reasoning as B1; no reopen/read-verification step in this test. |
| F2 | No PO involved at all (manual entry) — clearing a PO-related cache key is irrelevant to this path's own assertions. |
| G1 | Exercises `getActivePOs()`/`parsePOFile()`/`parsePOSheetValues()`'s malformed-file handling — none of these were modified; the new line only adds a `.remove()` call inside a *different* function, `grnCreate()`. |
| G2 | The duplicate-GRN rejection is an early `return` that happens **before** `sheet.appendRow`, i.e. before the new line is ever reached — confirmed unreachable on this path. |
| G3 | Client-side-only early return in `grn-entry.html` (`itemPayloads.length === 0`) — no `grncreate` call is ever made, so `grnCreate()` (and the new line inside it) never executes. |

No frontend file was modified, so no UI behavior changes except as a
downstream effect of the backend now returning fresher data — which is the
intended fix, not a side effect on unrelated tests.

## Regression risk

Restating and confirming what `ROOT_CAUSE_ANALYSIS.md` §6 anticipated, now
that the change is actually in place:

- **No correctness regression.** Nothing in the codebase reads the
  `'activePOs'` cache key expecting stale data; `getActivePOs()` and
  `reportPOShortfall()` are the only other touchpoints, and both already
  handle a cache miss correctly (that's the normal cold-start path
  already).
- **Increased read volume, by design.** Every `grnCreate()` call now
  forces the *next* `activePOs` read to pay the full rebuild cost (Drive
  file listing, per-file `Drive.Files.copy`/open/parse/`.remove`, a full
  multi-tab GRN Registry scan, a "PO Manual Overrides" read) instead of
  getting a cache hit. This is the deliberate, accepted trade-off for
  correctness described in the root-cause doc, not a new discovery.
- **Redundant invalidation on multi-item submissions (B1/F1/F2), harmless.**
  An N-item GRN calls `grnCreate()` N times, each clearing an
  already-cleared key. `CacheService.remove()` on an absent key is a
  documented no-op.
- **Cross-feature quota sharing.** `Drive`/Sheets calls triggered by more
  frequent cache rebuilds draw on the same Apps Script project quota used
  by unrelated features (ARN Assignment's duplicate check, the executive
  dashboard, the weekly digest). This is a secondary, probabilistic effect
  under heavy concurrent use, not a functional regression — unchanged from
  what the root-cause doc already flagged.
- **Known limitation, not a regression introduced by this change, but
  relevant to whether the fix takes effect at all:** `backend/Code.js`
  contains a byte-identical (pre-fix) copy of `grnCreate()`. `.clasp.json`
  pushes both `Code.gs` and `Code.js` into the same Apps Script project,
  where duplicate top-level function definitions silently collide — the
  one that loads last wins, with no error or warning. This fix was applied
  only to `Code.gs`, per scope. Whether C2/C3/D2/E1 actually resolve in the
  *live deployed* Apps Script project therefore depends on which file's
  `grnCreate()` is currently active there — a pre-existing condition, not
  something this change created, and outside today's authorized scope.

## Updated verdicts

| Test | Verdict before this fix | Verdict after this fix |
|---|---|---|
| C2 | FAIL | **PASS** |
| C3 | PARTIAL | **PASS** |
| D2 | FAIL | **PASS** |
| E1 | PARTIAL | **PASS** |

(Verdicts above assume `backend/Code.gs`'s `grnCreate()` is the definition
actually active in the deployed Apps Script project — see "Known
limitation" above. All other test cases — A1, A2, B1, B2, B3, B4, D1, F1,
F2, G1, G2, G3 — retain their prior verdicts from `TEST_RESULTS.md`,
unchanged by this fix; B4 remains PARTIAL, unaddressed, pending Root Cause
B.)

## Not done, awaiting approval

Root Cause B (`grnVerifyApprove()` counting defect, B4) was left entirely
untouched, as instructed. No refactoring, renaming, or changes beyond the
single line above were made anywhere in the codebase.
