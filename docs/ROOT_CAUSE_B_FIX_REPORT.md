# Root Cause B — Fix Report

Scope: **Root Cause B only** (`ROOT_CAUSE_ANALYSIS.md` — `grnVerifyApprove()`
classifying already-verified rows as "skipped"), targeting B4. Root Cause A
was not revisited.

## Files modified

- `backend/Code.gs` — **only file changed in this pass.**

`backend/Code.js` contains an identical (pre-fix) copy of
`grnVerifyApprove()`, per `CODE_DEPLOYMENT_ANALYSIS.md`'s established
duplication pattern. It was **not** touched in this pass — the instructions
for this task named only the function identified in
`ROOT_CAUSE_ANALYSIS.md` (`backend/Code.gs`'s `grnVerifyApprove`) and said
not to make unrelated changes. Synchronizing `Code.js` was a separate,
explicitly-authorized step for Root Cause A last time; no such
authorization was given for Root Cause B in this task, so it was not done.

## Functions modified

- `grnVerifyApprove(tabName, grnNo, person, selectedDescriptions)` — one
  block reordered. No other function was changed.

## Every code change

```diff
     matchedCount++;
     const rowNum = i + 2;
 
+    const currentStatus = sheet.getRange(rowNum, statusCol).getValue();
+    if (currentStatus === 'Verified') {
+      alreadyVerifiedCount++;
+      continue;
+    }
+
     if (selectedSet && descCol) {
       const rowDesc = String(sheet.getRange(rowNum, descCol).getValue() || '').trim().toLowerCase();
       if (!selectedSet.has(rowDesc)) {
         skippedCount++;
         continue; // this specific item wasn't checked — leave it Pending
       }
     }
 
-    const currentStatus = sheet.getRange(rowNum, statusCol).getValue();
-    if (currentStatus === 'Verified') {
-      alreadyVerifiedCount++;
-      continue;
-    }
     sheet.getRange(rowNum, statusCol).setValue('Verified');
```

This is a pure reordering of two pre-existing blocks. Every line that
appears in the diff also appeared, unchanged, in the original function —
none were rewritten, no variable was renamed or added, no new condition
was introduced, and the `setValue`/`verifiedByCol`/`verifiedDateCol` write
block immediately after was not touched at all. `git diff --stat` for this
change: `Code.gs` shows a net-zero line-count change to this function's
line span (6 lines moved up, 6 identical lines removed from their old
position) — confirmed by reading the function back in full after the edit.

## Reasoning

The defect was in which counter — `skippedCount` or `alreadyVerifiedCount`
— an already-`Verified`, currently-unselected row was attributed to.
Because the selection-membership check ran first, such a row was always
counted as "skipped" (implicitly meaning "still pending"), even though it
was already done. `grn-verify.html`'s confirmation message is built
directly from these two counters, so the miscount surfaced as a false "N
item(s) left as Pending Verification" message on any second approval round
of a partially-verified GRN — exactly B4's scenario.

Moving the already-verified check ahead of the selection check means an
already-`Verified` row is now classified correctly *before* the selection
filter is ever consulted, regardless of whether that row happens to be in
the current `selectedDescriptions` set (it structurally cannot be — the
frontend never renders a checkbox for an already-verified row, so it can
never be selected). This directly targets the message-calculation inputs
(`itemsApproved`, `itemsSkipped`, `alreadyVerified`) without touching
anything else in the function: validation, locking, which rows get written
to `Verified`, or what gets written to `Verified By`/`Verified Date`.

## Regression analysis

- **B3 (unaffected, re-traced against the live code, not assumed):** with
  no pre-existing `Verified` rows, `currentStatus` is `'Pending
  Verification'` for every matched row, so the new first check never
  fires — every row falls through to the selection filter exactly as
  before. Traced result: `itemsApproved: 2, itemsSkipped: 1`, identical to
  the pre-fix behavior and to `TEST_RESULTS.md`'s original PASS.
- **The "approve all" default path** (`selectedDescriptions` omitted,
  `selectedSet === null`): the selection-filter block's guard
  (`if (selectedSet && descCol)`) is false either way, so this path is
  untouched by the reorder. Not reachable through the current
  `grn-verify.html` UI regardless, since it always sends a `selected`
  array (confirmed in its source — every `jsonp('grnverify', {..., selected:
  JSON.stringify(selectedDescriptions)})` call includes the field).
- **What gets written to the Sheet is unchanged.** For both B3 and B4, the
  exact same set of rows reaches `sheet.getRange(rowNum,
  statusCol).setValue('Verified')` before and after this change — only the
  in-memory counters differ, and only for already-verified rows.
- **Cost:** one additional `getRange(statusCol).getValue()` Sheets API
  call for a row that would previously have been rejected by the
  (in-memory, no-API-call) selection filter before ever reading its
  status. This applies to unselected-but-still-`Pending` rows too (not
  just already-`Verified` ones), since the status read now always happens
  first — a small, already-disclosed performance cost in
  `ROOT_CAUSE_ANALYSIS.md` §6, not a correctness issue.
- **One disclosed, incidental behavior change, not newly discovered
  here:** calling this function with an empty selection against a GRN
  where every row is already `Verified` — unreachable via the current UI,
  since the Approve button is disabled once everything is verified — now
  returns `{status:'success', alreadyVerified:true}` instead of the
  previous `{status:'error', message:'No items were selected to
  approve.'}`. This is the same reordering's direct, already-anticipated
  side effect, not a separate fix.
- **Blast radius:** `grnVerifyApprove()` has exactly one caller in the
  codebase (`doGet`'s `action==='grnverify'` branch) and exactly one
  frontend consumer (`grn-verify.html`'s Approve button). No other
  function reads its return value or the Sheet cells it writes except
  `grnVerifyLookup()`, used only to redisplay the same page — confirmed in
  `ROOT_CAUSE_ANALYSIS.md` §7 and unchanged by this edit.

## Confirmation that no other test case is affected

`grnCreate()`, `getActivePOs()`, `reportPOShortfall()`,
`parsePOFile()`/`parsePOSheetValues()`, and every other function behind
A1, A2, B1, B2, D1, D2, E1, E2, F1, F2, G1, G2, G3, C1, C2, C3 were not
touched in this change — the diff is confined to the single reordered
block inside `grnVerifyApprove()`. None of those test cases exercise
`grnVerifyApprove()` at all except B3 (re-traced above, unaffected).

## Updated verdicts

| Test | Verdict before this fix | Verdict after this fix |
|---|---|---|
| B3 | PASS | **PASS** (unchanged, re-verified) |
| B4 | PARTIAL | **PASS** |

(Verdicts assume `backend/Code.gs`'s `grnVerifyApprove()` is the
definition actually active in the deployed Apps Script project — per
`CODE_DEPLOYMENT_ANALYSIS.md`, `backend/Code.js` still holds the pre-fix
version of this function and was not synchronized in this pass.)

## Not done, per instructions

No unrelated improvements were made. No other bug identified anywhere in
this review (e.g. Gap #3 from `IMPLEMENTATION_GAPS.md`, or the
`Code.js` synchronization question above) was addressed in this pass.
