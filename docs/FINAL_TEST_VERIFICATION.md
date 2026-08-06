# Final Test Verification

Final verification pass over the GRN + PO Link + Approval Full Test Plan
(`docs/GRN_Full_Test_Plan.docx`), re-evaluated against the current state of
`backend/Code.gs` / `backend/Code.js` after both fix passes (Root Cause A:
`ROOT_CAUSE_A_FIX_REPORT.md` + `ROOT_CAUSE_A_SYNC_REPORT.md`; Root Cause B:
`ROOT_CAUSE_B_FIX_REPORT.md` + `ROOT_CAUSE_B_SYNC_REPORT.md`), cross-checked
against `PROJECT_OVERVIEW.md`, `ARCHITECTURE.md`, `FUNCTION_MAP.md`, and
`ROOT_CAUSE_ANALYSIS.md`. No code was modified to produce this document.
Current working-tree state was confirmed directly before writing this
report:

```
$ git status --short
 M Code.gs
 M Code.js
$ diff Code.gs Code.js | grep -E "^[0-9]"
933,943c933,934
945,952c936,937
954,960d938
963c941
965,969c943,947
2134a2113,2339
```

The only remaining differences between the two files are at line ranges
933–969 (`grnVerifyLookup`) and 2113+ (executive-dashboard functions) — the
two previously-documented, out-of-scope differences. No hunk falls inside
`grnCreate` (~line 792–905) or `grnVerifyApprove` (~line 986–1055) — both
fixes are confirmed present and byte-identical in both files, with nothing
else in either file altered.

`Part H` (Wrap-Up) is process/cleanup guidance, not a testable
implementation behavior, and is excluded from the 18-case count below, as
it was in `TEST_RESULTS.md`.

---

## 1. Test Summary

| Metric | Value |
|---|---|
| Total test cases | 18 (A1–G3) |
| Passed | 18 |
| Failed | 0 |
| Overall pass percentage | **100%** |

Before the fixes: 13 PASS, 2 FAIL (C2, D2), 3 PARTIAL (C3, E1, B4). All 5
non-passing cases are resolved below.

## Per-test-case results

| ID | Verdict | Confidence | Frontend file(s) | Backend function(s) |
|---|---|---|---|---|
| A1 | PASS | High | `grn-entry.html` | `getActivePOs`, `getPrefixesForTab`, `suggestNextGrnFields`, `grnCreate` |
| A2 | PASS | Medium | `grn-entry.html`, `grn-verify.html` | `notifyGrnForVerification`, `getSlackUserId`, `grnVerifyLookup`, `grnVerifyApprove` |
| B1 | PASS | High | `grn-entry.html` | `grnCreate` |
| B2 | PASS | Medium | `grn-entry.html` | `grnCreate` (`isFirstItemForThisGrn`), `notifyGrnForVerification` |
| B3 | PASS | High | `grn-verify.html` | `grnVerifyApprove` |
| B4 | **PASS** *(was PARTIAL)* | High | `grn-verify.html` | `grnVerifyApprove` |
| C1 | PASS | High | `grn-entry.html` | `getActivePOs`, `grnCreate` |
| C2 | **PASS** *(was FAIL)* | High | `grn-entry.html` | `grnCreate`, `getActivePOs`, `getReceivedQtyByPOAndItem` |
| C3 | **PASS** *(was PARTIAL)* | High | `grn-entry.html` | `grnCreate`, `getActivePOs` |
| D1 | PASS | High | `grn-entry.html` | `grnCreate` |
| D2 | **PASS** *(was FAIL)* | High | `grn-entry.html` | `grnCreate`, `getActivePOs`, `getReceivedQtyByPOAndItem` |
| E1 | **PASS** *(was PARTIAL)* | High | `grn-entry.html` | `grnCreate`, `getActivePOs`, `reportPOShortfall` |
| E2 | PASS | High | `grn-entry.html` | `reportPOShortfall`, `getActivePOs`, `getPOOverrideKeys` |
| F1 | PASS | High | `grn-entry.html` | `grnCreate` |
| F2 | PASS | High | `grn-entry.html` | `grnCreate` |
| G1 | PASS | Medium | `grn-entry.html` | `getActivePOs`, `parsePOFile`, `parsePOSheetValues` |
| G2 | PASS | High | `grn-entry.html` | `grnCreate` |
| G3 | PASS | High | `grn-entry.html` | *(none — client-side block, no backend call)* |

Confidence is **Medium**, not High, wherever a test's PASS criterion
depends in part on something outside this repository's own code path —
live Slack message delivery (A2, B2) or the actual cell contents of 8
externally-supplied dummy PO files not present in this repository (G1's
"every other PO still loads" sub-claim). The code paths under this
system's own control for those tests are fully traced and correct; the
external dependency is what keeps confidence at Medium rather than High,
not any doubt about the code itself.

### C2 — Reopen the same PO, confirm it remembers — PASS (was FAIL)

**Evidence:** `grnCreate()` now contains
`CacheService.getScriptCache().remove('activePOs');` immediately after
`sheet.appendRow(newRow)` (confirmed present in both files, byte-identical,
per `ROOT_CAUSE_A_SYNC_REPORT.md`). Re-traced: after C1's 40-unit
submission, the next `getActivePOs()` call is a guaranteed cache miss,
forcing a fresh `getReceivedQtyByPOAndItem()` scan that includes C1's row
→ `receivedQty=40`, `remainingQty=60`, displayed as "40 already received,
60 remaining," quantity field defaults to 60. Matches the test's expected
outcome exactly, deterministically (no longer dependent on wall-clock
timing between test steps).

### C3 — Second (final) partial delivery — PASS (was PARTIAL)

**Evidence:** the write half was always correct. The read-verification
half ("item should be gone") is now reliable for the same reason as C2:
C3's own `grnCreate()` call also invalidates the cache, so the reopen
forces a fresh read showing `receivedQty=100` (40+60), `remainingQty=0`;
`getActivePOs()`'s `isOpen` check (`itemsWithBalance.some(item =>
item.remainingQty > 0)`) is false for this single-item PO, so the whole PO
drops out of the picker.

### D2 — Reopen the mixed PO, only the partial item remains — PASS (was FAIL)

**Evidence:** D1's two `grnCreate()` calls each now invalidate the cache.
Reopen is a guaranteed cache miss: 20-unit item shows `remainingQty=0`
(filtered out client-side), 200-unit item shows `receivedQty=150,
remainingQty=50`. Matches exactly.

### E1 — Partial delivery, then report a permanent shortfall — PASS (was PARTIAL)

**Evidence:** the 60-unit submission now invalidates the cache before the
reopen, so `item.receivedQty` reads correctly as 60 (not stale-zero) —
this also fixes the previously-documented more severe consequence: the
"Report shortfall" button's render condition (`item.receivedQty > 0`) now
reliably evaluates true, so the button is no longer at risk of being
silently absent. The override-write step itself
(`reportPOShortfall()`) was already correct before this fix, via its own
pre-existing `cache.remove('activePOs')` call, and is unchanged.

### B4 — Approve the remaining item later — PASS (was PARTIAL)

**Evidence:** `grnVerifyApprove()`'s already-verified check
(`if (currentStatus === 'Verified') { alreadyVerifiedCount++; continue; }`)
now runs *before* the selection-membership check, in both files
(confirmed byte-identical per `ROOT_CAUSE_B_SYNC_REPORT.md`). Re-traced:
rows 1–2 (already `Verified` from B3) are now attributed to
`alreadyVerifiedCount` regardless of not being in the current selection;
row 3 (the only selected, still-pending row) is written to `Verified`.
Result: `itemsApproved=1, itemsSkipped=0` → message is `"Item approved."`
with no false "left as Pending Verification" clause. B3 was re-traced
against the same updated code and produces the identical result it always
did (`itemsApproved=2, itemsSkipped=1`), since no row in that scenario is
ever already-`Verified`.

---

## 2. Regression Review

### Root Cause A — no regressions

The change is confined to `grnCreate()`: a single 4-line insertion (one
`CacheService.getScriptCache().remove('activePOs')` call plus its comment)
placed after `sheet.appendRow(newRow)` and before the
`isFirstItemForThisGrn` Slack block, in both `Code.gs` and `Code.js`,
confirmed via `git diff --stat` at the time of each edit (`4 ++++` per
file, both times) and by the current combined-diff check above showing no
hunk inside `grnCreate`'s line range beyond what both fixes already
introduced.

Checked directly against every other test case's own code path, not
assumed:

- **A1, B1, F1, F2** — assert on `grnCreate()`'s write mechanics (row
  content, duplicate check, multi-item handling), all of which precede the
  new line in execution order and were not altered.
- **A2, B2** — depend on `isFirstItemForThisGrn` (computed before the new
  line, reads the GRN Registry sheet, unrelated to the `activePOs` cache
  key) and on `grnVerifyLookup`/`grnVerifyApprove`, neither modified by
  this change.
- **B3, B4** — exercise `grnVerifyApprove()` exclusively, a different
  function untouched by the Root Cause A change.
- **C1, D1** — first-touch writes against their respective POs; their PASS
  criteria don't involve reopening the picker after a write, so the
  caching behavior (fixed or not) doesn't factor into their result.
- **E2** — was already correct via `reportPOShortfall()`'s own
  pre-existing invalidation call, a different function, unchanged.
- **G1** — exercises `getActivePOs()`/`parsePOFile()`/`parsePOSheetValues()`'s
  malformed-file handling, none of which were modified; the new line only
  adds a call inside a *different* function.
- **G2** — the duplicate-GRN rejection is an early `return` in `grnCreate`
  that occurs *before* `sheet.appendRow`, i.e. before the new line is ever
  reached on that path.
- **G3** — a client-side-only early return in `grn-entry.html`; no
  `grncreate` call is ever made, so the new line never executes.

### Root Cause B — no regressions

The change is confined to `grnVerifyApprove()`: a pure reordering of two
pre-existing blocks (no line rewritten, no variable renamed or added), in
both `Code.gs` and `Code.js`, confirmed byte-identical to each other after
the change and confined to that one function's line range in the combined
diff check above.

`grnVerifyApprove()` has exactly one caller in the entire codebase
(`doGet`'s `action==='grnverify'` branch) and exactly one frontend
consumer (`grn-verify.html`'s Approve button) — established in
`ROOT_CAUSE_ANALYSIS.md` §7 and re-confirmed unchanged in
`ROOT_CAUSE_B_FIX_REPORT.md`. By that fact alone, no test case other than
B3 and B4 exercises this function at all, so no other test case's result
can be affected by a change confined to it. B3 was explicitly re-traced
above and produces an identical result to its pre-fix behavior.

---

## 3. Remaining Known Issues (not covered by the current test plan)

The GRN Full Test Plan covers `grn-entry.html` and `grn-verify.html` only.
It does not exercise `index.html`, `request.html`, `arn-assign.html`, or
`exec-dashboard/overhead.html`, and does not exercise every code path even
within the GRN feature itself. The issues below were established with
direct code evidence in the course of this review (architecture review,
end-to-end workflow trace, and the code-deployment analysis) and are
listed here as facts about the current implementation, not as suggested
enhancements.

### Critical

- **Duplicate backend logic remains unsynchronized for every function
  other than `grnCreate` and `grnVerifyApprove`.** `Code.gs` and `Code.js`
  still share 67 other top-level names, including `doGet`, `doPost`,
  `arnAssign`, `arnApprove`, `arnReject`, `verifyGrnExists`,
  `findDuplicates`, and (known-divergent) `grnVerifyLookup`. Per
  `CODE_DEPLOYMENT_ANALYSIS.md`, which file's definition executes for any
  of these is not determinable from this repository. This review resolved
  the ambiguity for the two functions the GRN test plan's failures traced
  to; it did not — and was not asked to — resolve it for the rest of the
  backend.
- **No real authentication or authorization anywhere except the executive
  dashboard.** The Apps Script Web App is `access: ANYONE_ANONYMOUS`
  (`appsscript.json`). `arnApprove`/`arnReject`'s requester-or-same-department
  check compares client-supplied `data.person`/`data.personDept` strings
  against sheet values with no cryptographic or session backing
  (`ARCHITECTURE.md`); `grnVerifyApprove`'s approval link carries no
  token. Anyone who can reach the Web App URL can act as anyone.

### High

- **`index.html` and `request.html`'s write submissions never inspect the
  fetch response.** Both call `await fetch(APPS_SCRIPT_URL, {method:
  'POST', body: params})` and proceed directly to the success screen
  without checking `.ok` or reading the body — a server-side validation
  error or write failure is indistinguishable from success to the user on
  these two pages. `arn-assign.html`'s own code comment documents having
  fixed an equivalent CORS-related issue with `mode: 'no-cors'`; that fix
  was never applied to `index.html`/`request.html`. Not exercised by the
  GRN test plan (different pages).
- **`arnApprove`/`arnReject`'s authorization check is skipped entirely
  when `data.person` is empty** (`if (data.person && !isRequester &&
  !isSameDept)` — a falsy `data.person` bypasses the check rather than
  failing it), reachable by loading the pending-approval list, changing
  the department dropdown (which clears the name field) without
  reloading, and clicking Approve/Reject on an already-rendered card. Not
  exercised by the GRN test plan (ARN workflow, not GRN).
- **Unescaped GRN item descriptions are rendered into `grn-verify.html`'s
  DOM.** `row(label, value)` interpolates values directly into an
  `innerHTML`-assigned template string with no escaping; the `data-desc`
  checkbox attribute escapes only `"`, not `<`/`>`/`&`. Since GRN Entry has
  no authentication, any submitted material description reaches this page
  unsanitized. None of the 18 scripted test cases submit a description
  containing HTML-significant characters.
- **Hardcoded secrets committed to source control:** both Slack webhook
  URLs, all three Google Sheet IDs, the Drive folder ID, and the OAuth
  Client ID are literal constants in `Code.gs`/`Code.js`, pushed to a
  GitHub repository.

### Medium

- **Gap #3 (`IMPLEMENTATION_GAPS.md`), explicitly out of scope for both
  root causes:** `grn-verify.html` renders only Material/Quantity/Invoice
  Amount per item; Basic Amount, GST, and Other Charges are present in
  `grnVerifyLookup()`'s response but never displayed, bearing on A2's
  "confirm details match" intent for any GRN carrying cost data (not
  exercised by the current A2 script, which doesn't fill those fields).
- **Unlocked concurrent-write paths remain:** `suggestNextGrnFields`
  (Sl No./GRN No. suggestion — two simultaneous GRN Entry sessions on the
  same tab can be handed the same suggested Sl No.), `getNextAdjSerial`
  (unlocked for the default `doPost` Inventory Adjustment path), and
  `arnReject` (unlocked, lost-update risk on concurrent rejections of the
  same item). Not exercised by the GRN test plan, which is written for a
  single sequential tester.
- **`grnCreate()` does not validate submitted quantity against the
  computed remaining balance at write time** — over-receipt beyond a PO's
  ordered quantity is possible with no server-side guard. No scripted test
  attempts to submit beyond the remaining balance.
- **`verifyGoogleIdToken()` calls Google's `tokeninfo` endpoint on every
  dashboard request**, which Google's own documentation describes as
  intended for debugging rather than sustained production verification —
  low practical risk given only 4 allowlisted users, but outside the GRN
  test plan's scope entirely (dashboard feature).
- **`getOverheadSummary()`/`getCashoutflowSummary()` locate sheet
  structure by exact literal-string header matching** (`'Category'`,
  `'Total'`, `'TOTAL OVERHEAD'`), which can silently produce incorrect
  figures — not a thrown error — if the source sheet's headers drift.
  Outside the GRN test plan's scope entirely.

### Low

- **`AdSense` advanced service is enabled in `appsscript.json`** but
  called nowhere in either backend file — an unused scope on the
  project's OAuth consent surface.
- **The employee directory exists in three different forms**:
  `arn-assign.html`'s hardcoded list (keyed by 2-letter department code),
  `request.html`'s separate hardcoded list (keyed by full department
  name), and the live-fetched `action=employees` source used by
  `index.html`/`grn-entry.html`/`grn-verify.html` — three independently
  maintained sources of the same underlying fact, with no mechanism
  keeping them consistent.
- **`checkSetup()`, `testNotifications()`, `authorizeExternalRequests()`,
  and `authorizeDriveAccess()` are manual-only diagnostics**, not wired to
  any automated check or trigger.
- **`sendWeeklyPrnDigest()` has no trigger-creation code anywhere in this
  repository** — `checkSetup()` only checks whether one happens to already
  exist and warns if not; nothing guarantees it is actually scheduled.

---

## 4. Production Readiness

## NOT READY FOR PRODUCTION

This verdict applies to the system as a whole, not to the specific GRN
Entry/Verify functionality this test plan and fix sequence targeted.

**What supports readiness, narrowly:** every test case in the GRN Full
Test Plan — the only functional specification available for this
review — now passes (18/18, §1), with the two defects the plan surfaced
(C2/C3/D2/E1's shared cache-invalidation root cause, and B4's message
miscount root cause) fixed, verified against the actual updated code, and
confirmed synchronized across both backend files so the fix does not
depend on an unresolved deployment ambiguity for either affected function.
Both fixes were traced to introduce no regression in any of the other 16
test cases.

**What overrides that, system-wide:** two Critical and four High-severity
issues (§3) remain, established with direct code evidence, none of which
were in scope for this test plan or the two root-cause fixes:

- The Web App has `access: ANYONE_ANONYMOUS` with no real authentication
  anywhere outside the executive dashboard, and the one authorization
  check that exists (`arnApprove`/`arnReject`) is both spoofable by
  construction and outright bypassable when `data.person` is empty.
- The two highest-traffic pages in the system (`index.html`,
  `request.html`) cannot detect a failed write, by direct inspection of
  their own submit handlers.
- Unescaped user-supplied content is rendered into `grn-verify.html`'s DOM
  on an unauthenticated write path.
- Deployment ambiguity between `Code.gs` and `Code.js` — confirmed
  unresolvable from this repository per `CODE_DEPLOYMENT_ANALYSIS.md` —
  remains open for every backend function this review did not touch,
  which is the large majority of the backend.
- Secrets (Slack webhooks, Sheet/folder IDs, OAuth client ID) are
  committed to a GitHub repository in plain text.

None of these were within the authorized scope of Root Cause A or Root
Cause B, and none are addressed by the fixes verified in this report. The
GRN workflow specifically tested here is verified correct; the system it
runs inside is not verified safe to operate in production as currently
configured.
