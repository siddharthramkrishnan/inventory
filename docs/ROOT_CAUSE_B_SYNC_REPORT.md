# Root Cause B — Code.js Sync Report

Follows `ROOT_CAUSE_B_FIX_REPORT.md` (fix applied to `backend/Code.gs`) and
the same deployment-ambiguity rationale established in
`CODE_DEPLOYMENT_ANALYSIS.md`: since which file's function definitions
actually execute in the deployed Apps Script project cannot be determined
from the repository, the two files are kept in sync for any function whose
correctness this review has addressed.

## 1. Whether Code.js contains the same grnVerifyApprove() implementation

**Confirmed yes, and confirmed it still had the pre-fix (buggy) version.**
Extracted `grnVerifyApprove()` from `backend/Code.js` in full and compared
it directly against the known pre-fix text quoted in
`ROOT_CAUSE_ANALYSIS.md` §4 and against `Code.gs`'s original (pre-fix)
version — identical: same validation lines, same variable names, and
critically the same defect ordering — the selection-membership check
(`if (selectedSet && descCol) { ... skippedCount++ ... }`) still preceded
the already-verified check (`const currentStatus = ...; if (currentStatus
=== 'Verified') { alreadyVerifiedCount++ ... }`). `Code.js` had not
received the Root Cause B fix.

## Files modified

- `backend/Code.js` — the only file changed in this pass.

(`backend/Code.gs` was already fixed in the prior Root Cause B pass and was
not touched again here.)

## 2–3. The change applied

Identical block reordering to the one already applied to `Code.gs`, and
nothing else:

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

No variable was renamed, no new variable was introduced, no other line in
`grnVerifyApprove()` — or anywhere else in `Code.js` — was touched. No
refactoring was performed; this is the same six-line block relocated to
the same new position used in `Code.gs`.

## 4. Confirmation: both grnVerifyApprove() implementations are functionally identical

Verified directly, not assumed:

```
$ awk '/^function grnVerifyApprove\(/,/^\}/' Code.gs > gva_gs.txt
$ awk '/^function grnVerifyApprove\(/,/^\}/' Code.js > gva_js.txt
$ diff gva_gs.txt gva_js.txt
(no output)
```

The two function bodies — every line, from `function
grnVerifyApprove(tabName, grnNo, person, selectedDescriptions) {` to the
closing `}` — are now **byte-for-byte identical**. Since this function's
behavior depends only on its own body (no shared mutable module state,
per `ROOT_CAUSE_ANALYSIS.md` §7: one caller, one consumer), identical
source means identical behavior for B3 and B4 regardless of which file's
definition the deployed Apps Script project actually runs.

`grnCreate()` was also re-checked in the same pass, as a sanity check that
this edit didn't disturb the earlier Root Cause A sync: still identical
between both files (`diff` on the extracted function bodies: no output).

## 5. Verification: only the previously-documented intentional differences remain

Full `diff Code.gs Code.js` after this change shows exactly two remaining
regions of difference, both already identified and explained in earlier
review documents, neither touched by this or any prior fix in this
sequence:

1. **`grnVerifyLookup()`'s implementation** — `Code.gs` has the targeted
   two-read approach (read the GRN No. column first, then only the
   matching rows); `Code.js` retains the original full-`getDataRange()`
   scan. This is the pre-existing performance difference documented in
   `FILE_MAP.md`/`FUNCTION_MAP.md` from the initial architecture review —
   untouched, out of scope for both Root Cause A and Root Cause B.
2. **The executive-dashboard functions** — `authorizeExternalRequests`,
   `OVERHEAD_SHEET_ID`, `OVERHEAD_GOOGLE_CLIENT_ID`,
   `OVERHEAD_ALLOWED_EMAILS`, `verifyGoogleIdToken`, `getOverheadSummary`,
   `getCashoutflowSummary`, `getTopCashoutflowVendors` — present only in
   `Code.js`, as established in `CODE_DEPLOYMENT_ANALYSIS.md` (`Code.gs`'s
   own `doGet` references these symbols without defining them). Untouched,
   out of scope for both Root Cause A and Root Cause B.

No third region of difference exists. `grnCreate()` and `grnVerifyApprove()`
— the two functions this review's fixes have touched — are now identical
in both files.

## Regression risk

None beyond what was already assessed and accepted in
`ROOT_CAUSE_B_FIX_REPORT.md` for the identical change already made to
`Code.gs`: one additional Sheets API read per row, and the single,
already-disclosed, UI-unreachable edge-case behavior change (an
empty-selection call against an all-`Verified` GRN now returns
`alreadyVerified: true` instead of an error). Applying the same change to
`Code.js` does not introduce any new risk — it removes the risk that the
Root Cause B fix might have no effect in production, per the same
load-order ambiguity documented in `CODE_DEPLOYMENT_ANALYSIS.md`.

## Not done

No other function in `Code.js` was modified. No refactoring was performed.
Root Cause B's scope was not expanded to any other function or file.
