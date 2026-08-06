# Root Cause A — Code.js Sync Report

Follows `ROOT_CAUSE_A_FIX_REPORT.md` (fix applied to `backend/Code.gs`) and
`CODE_DEPLOYMENT_ANALYSIS.md` (established that which file's `grnCreate()`
executes in the deployed Apps Script project cannot be determined from the
repository, and that `Code.js` is not obsolete). This change eliminates
that ambiguity by making the two implementations agree.

## Files modified

- `backend/Code.js` — the only file touched in this change.

(`backend/Code.gs` was already modified in the prior Root Cause A fix and
was not touched again here.)

## Exact change

`git diff Code.js`:

```diff
@@ -876,6 +876,10 @@ function grnCreate(data) {
 
   sheet.appendRow(newRow);
 
+  // Invalidate the cached PO list so this change is reflected immediately,
+  // not after the usual 5-minute cache window.
+  CacheService.getScriptCache().remove('activePOs');
+
   if (isFirstItemForThisGrn) {
     notifyGrnForVerification({
       tabName: data.tabName,
```

Identical 4-line insertion (comment + call + surrounding blank line), at
the identical location within `grnCreate()` (immediately after
`sheet.appendRow(newRow)`, immediately before the `isFirstItemForThisGrn`
Slack-notification block), as the change already made to `Code.gs`. No
existing line in `Code.js` was removed, edited, reordered, or renamed.

`git diff --stat` across both files:
```
 Code.gs | 4 ++++
 Code.js | 4 ++++
 2 files changed, 8 insertions(+)
```
Confirms both files now carry exactly the same 4-line insertion and
nothing else changed in either.

## Why synchronization was necessary

`CODE_DEPLOYMENT_ANALYSIS.md` established three facts directly from the
repository:

1. `Code.gs` and `Code.js` both define a top-level `grnCreate(data)`
   function, and both are configured (via `.clasp.json`'s
   `scriptExtensions: [".js", ".gs"]`, no `.claspignore`) to deploy to the
   same Apps Script project.
2. Which of the two definitions actually executes for a live GRN Entry
   submission cannot be determined from anything in this repository — file
   load order inside the deployed Apps Script project is not captured in
   git history, `.clasp.json`, or any other tracked file.
3. `Code.js` is not obsolete: `Code.gs`'s own `doGet` function calls
   `verifyGoogleIdToken`, `getOverheadSummary`, and `getCashoutflowSummary`,
   and references `OVERHEAD_ALLOWED_EMAILS`/`OVERHEAD_SHEET_ID` — none of
   which are defined in `Code.gs`. These exist only in `Code.js`, so it
   must remain part of the deployed project regardless of which file wins
   any given name collision.

Given (1) and (2) together, patching only `Code.gs` left the Root Cause A
fix's real-world effect unknowable: if the live project happens to load
`Code.js`'s (previously unpatched) `grnCreate` last, C2/C3/D2/E1 would
still fail in production despite the fix being present in the repository.
Since (3) rules out simply deleting or ignoring `Code.js`, the only way to
remove this ambiguity without depending on an unprovable fact (load order)
is to make both definitions identical with respect to the fix — so that
whichever one the deployed project actually runs, the behavior is the
same.

## Confirmation: `grnCreate()` is now functionally identical in both files with respect to Root Cause A

Verified directly, not assumed:

```
$ awk '/^function grnCreate\(data\) \{/,/^\}/' Code.gs > grncreate_gs.txt
$ awk '/^function grnCreate\(data\) \{/,/^\}/' Code.js > grncreate_js.txt
$ diff grncreate_gs.txt grncreate_js.txt
(no output)
```

The two functions' full bodies — every line, from the opening
`function grnCreate(data) {` to the closing `}` — are now **byte-for-byte
identical**. A whole-file `diff Code.gs Code.js` afterward shows zero
hunks anywhere near `grnCreate` (line range ~792–901 in both files); the
only remaining differences between the two files are the pre-existing,
unrelated `grnVerifyLookup` implementation difference and the
overhead-dashboard functions present only in `Code.js` — both explicitly
out of scope for Root Cause A and untouched by this change.

## Confirmation that no other logic changed

- `git diff --stat`: exactly `4 ++++` for `Code.js`, matching the `4 ++++`
  already present for `Code.gs` — 8 total insertions across both files,
  0 deletions, 0 files renamed.
- No function, variable, or constant was renamed in either file.
- No code was refactored — the insertion is a single new statement (plus
  its comment and a blank line) placed between two pre-existing lines that
  are themselves unchanged (`sheet.appendRow(newRow);` above it,
  `if (isFirstItemForThisGrn) {` below it).
- Every other function in `Code.js` (`doGet`, `doPost`, `arnAssign`,
  `arnApprove`, `grnVerifyLookup`, `grnVerifyApprove`, the
  overhead-dashboard functions, etc.) is untouched — confirmed by the
  `diff Code.gs Code.js` output showing hunks only at the pre-existing
  `grnVerifyLookup`/overhead-tail locations, nowhere else.
- Root Cause B (`grnVerifyApprove()` in either file) was not touched, per
  instruction.
