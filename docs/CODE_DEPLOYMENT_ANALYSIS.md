# Code.gs vs Code.js — Deployment Analysis

No files were modified to produce this document. Every claim below is
either (a) directly sourced from a file in this repository or a `git`
command run against it — quoted or shown as command output — or (b)
explicitly labeled as external platform knowledge that this repository
cannot itself prove, with the distinction never blurred. Where the
repository genuinely cannot answer a question, that is stated plainly
instead of inferred.

**One distinction matters for everything below and is easy to conflate:**
"is Code.js *active*" can mean two different things —

- **(A) Required-for-referenced-symbols-to-exist** — does the deployed
  project need `Code.js`'s content present so that code Code.gs itself
  references doesn't throw `ReferenceError`? **This is provable from the
  repository** (see Q7/Q8).
- **(B) Wins-a-name-collision** — when both files define the same
  top-level function (e.g. `grnCreate`), which body actually executes?
  **This is not provable from the repository** (see Q3/Q5). It depends on
  internal Apps Script project state (file order) that is not captured in
  any file this repo contains, and not on anything `git log` records.

---

## 1. Why both files exist

Evidence: `git log --oneline` in `backend/` (a separate git repository from
the top-level project, remote
`github.com/siddharthramkrishnan/achira-inventory-backend.git`):

```
12e39d1 Removed Financial related functions
510ad84 Fix grnVerifyLookup performance — targeted reads instead of full-tab scan
350c05f Initial import of live Code.gs
```

**Commit `350c05f`** — `git show --stat 350c05f`:
```
Initial import of live Code.gs
 .clasp.json     |   16 +
 Code.js         | 2334 +++++++++...
 appsscript.json |   23 +
 3 files changed, 2373 insertions(+)
```
The commit message says *"live Code.gs"*, but the file it actually added
is named `Code.js`. This is not a naming inconsistency in the message
alone — the file's own content agrees with the message, not with its own
filename: line 3 of `Code.js` reads:
```
// Achira Labs — Inventory Adjustment App
// Google Apps Script Backend (Code.gs)
```
`Code.js` literally self-describes as "Code.gs" in its own header comment.
Together, the commit message and the file's own internal header are
repository evidence that this file's content originated as a pull of
whatever script file was, at that time, actually named/considered
`Code.gs` in the live Apps Script project — it simply landed on disk under
a `.js` extension in this initial import.

**Commit `510ad84`** — `git show --stat 510ad84`:
```
Fix grnVerifyLookup performance — targeted reads instead of full-tab scan
 Code.gs | 2356 +++++++++...
 1 file changed, 2356 insertions(+)
```
This is a pure addition (2,356 insertions, 0 deletions) of a **new,
previously-untracked file** literally named `Code.gs` — not an edit to the
existing `Code.js`. Whoever made the `grnVerifyLookup` performance fix
created a second file rather than modifying the first. This is the exact
moment the two-file situation was created.

**Commit `12e39d1`** — `git show --stat 12e39d1`:
```
Removed Financial related functions
 Code.gs | 227 ----------------------------------------------------------------
 1 file changed, 227 deletions(-)
```
Pure deletion (227 removals, 0 insertions), touching only `Code.gs`. This
removed `authorizeExternalRequests`, `OVERHEAD_SHEET_ID`,
`OVERHEAD_GOOGLE_CLIENT_ID`, `OVERHEAD_ALLOWED_EMAILS`,
`verifyGoogleIdToken`, `getOverheadSummary`, `getCashoutflowSummary`, and
`getTopCashoutflowVendors` from `Code.gs` only — it never touched
`Code.js`, which still has all eight.

**Conclusion (repo-evidenced):** `Code.js` is the original imported
snapshot of the live script (self-labeled "Code.gs" internally, landed on
disk as `.js`). `Code.gs` was created afterward as a *second* file
containing a performance fix, rather than as an edit to the first. A third
commit then removed content from `Code.gs` only. No commit in this
repository ever reconciles the two into one file, and no commit deletes
either file.

## 2. Whether both are included in the Apps Script deployment

Evidence: `backend/.clasp.json`:
```json
{
  "scriptId": "1gPlsV-gi_PYoSpreBX0-OMhxYZtVYOKgxJa6HheyYtrWb5jfzMsPAyWH",
  "rootDir": "",
  "scriptExtensions": [".js", ".gs"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"],
  "filePushOrder": [],
  "skipSubdirectories": false
}
```
`scriptExtensions` explicitly lists **both** `.js` and `.gs` as file types
clasp will push to the Apps Script project at `scriptId
1gPlsV-gi_...`. `rootDir: ""` means the push root is the directory
containing `.clasp.json` itself (`backend/`), where both files live. There
is no `.claspignore` file anywhere in `backend/` (checked directly —
`find . -maxdepth 1 -iname "*claspignore*"` returns nothing) that could
exclude either file from a push. `filePushOrder` is an empty array — clasp
has no configured preference for which file is pushed/loaded first or
last.

**What this proves:** both files are *configured* to be pushed to the same
Apps Script project if/when a `clasp push` is run — nothing in this
repository excludes either one.

**What this does not prove:** this repository contains no record of
whether or when a `clasp push` was actually executed, and no CI/automation
file (none exists anywhere in this repo) that would run one automatically.
`git log` records commits to *this git repository*; it does not record
`clasp push` events, which happen locally on a developer's machine, outside
git entirely. Separately, Apps Script Web Apps serve a specific pinned
**Deployment** (a versioned snapshot), which can lag behind the project's
current script content — this repository contains no deployment ID, no
version number, and no record of when the deployment behind the frontend
pages' hardcoded `APPS_SCRIPT_URL` was last updated. So: **"both files are
configured to be pushed together" is proven; "both files' current content
is what the live Web App is actually running right now" is not** — that
requires inspecting the live Apps Script project directly, which is
outside this repository.

Also directly relevant here: the header comment present verbatim in both
files (`Code.gs` lines 1–13, `Code.js` lines 1–13) describes a **manual**
deployment process — *"Extensions → Apps Script → paste this code"* — not
a clasp-based one. This is evidence that this project's deployment history
may not be a pure clasp-push workflow at all; a human directly pasting code
into the Apps Script web editor is a documented-in-repo possibility that
would also not appear anywhere in `git log`.

## 3. Which version of `grnCreate()` is actually executed

**This cannot be determined from the repository.** Reasoning:

- Apps Script projects with multiple script files execute all of them in
  one shared global scope; when two files each declare a same-named
  top-level `function`, only one definition survives at runtime, and which
  one depends on the files' internal load order **inside the live Apps
  Script project** — a property of that project's own metadata, not of
  anything on disk in this repository, and not something `clasp pull`
  captures into `.clasp.json` or any other file here. (This sentence
  describes external Apps Script platform behavior — general, documented
  behavior of the platform, not a fact this repository can independently
  verify. It is stated here only to explain *why* Q3 is unanswerable from
  repo evidence, not as repo evidence itself.)
- `filePushOrder` in `.clasp.json` is empty (Q2), so even clasp's *intended*
  push order carries no signal.
- Git commit timestamps (`350c05f` → `510ad84` → `12e39d1`) describe the
  order changes were **committed to this git repository** — they say
  nothing about the order the corresponding content was ever **pushed to
  or arranged within** the live Apps Script project, an action this repo
  has no record of at all.

**What the repository does prove, directly:** as of this session,
`Code.gs`'s `grnCreate` and `Code.js`'s `grnCreate` are no longer
identical. `diff Code.gs Code.js`, current state:
```diff
879,882d878
<   // Invalidate the cached PO list so this change is reflected immediately,
<   // not after the usual 5-minute cache window.
<   CacheService.getScriptCache().remove('activePOs');
< 
```
(plus the pre-existing `grnVerifyLookup` and overhead-function differences
covered in Q1/Q4/Q7, unchanged by this session's edit). `git status` in
`backend/` confirms this is a real, currently uncommitted, working-tree
change: `modified: Code.gs`. Before this session's edit, `grnCreate` was
byte-identical in both files (confirmed: the pre-edit `diff` — run and
recorded in the prior root-cause analysis — showed no hunk anywhere near
`grnCreate`'s line range).

**Bottom line:** which `grnCreate` body a live GRN Entry submission
actually runs is unknown from this repository. What is known is that the
two bodies now genuinely differ (as of this uncommitted change), so the
question is no longer moot the way it was before this session — see Q6.

## 4. Whether duplicate function names exist

**Yes — proven directly.** `Code.gs` has 69 top-level `function`/`const`
declarations; `Code.js` has 77. Comparing the two sorted name lists
(`comm -12` on the extracted declaration names):

```
diff <(grep -oE "^function [a-zA-Z0-9_]+|^const [a-zA-Z0-9_]+" Code.gs | sort) \
     <(grep -oE "^function [a-zA-Z0-9_]+|^const [a-zA-Z0-9_]+" Code.js | sort)

13a14,16
> const OVERHEAD_ALLOWED_EMAILS
> const OVERHEAD_GOOGLE_CLIENT_ID
> const OVERHEAD_SHEET_ID
26a30
> function authorizeExternalRequests
34a39
> function getCashoutflowSummary
46a52
> function getOverheadSummary
52a59
> function getTopCashoutflowVendors
68a76
> function verifyGoogleIdToken
```

This diff has **no `<` lines** (nothing unique to `Code.gs`) — every name
`Code.gs` declares also exists in `Code.js`. The only differences are the
8 names that exist **only** in `Code.js`. Confirmed directly:
`grep -n "^function grnCreate" Code.gs Code.js` returns exactly one match
per file, both named `grnCreate`:
```
Code.gs:792:function grnCreate(data) {
Code.js:792:function grnCreate(data) {
```
Same name, same line number even, in both files — including `doGet`,
`doPost`, `arnAssign`, `arnApprove`, `grnVerifyLookup`,
`grnVerifyApprove`, and every other function this whole review has
discussed. **69 top-level names are duplicated between the two files.**

## 5. Whether Apps Script silently overrides one implementation with the other

Two things need to be kept separate here:

- **General Apps Script platform behavior** (not something this
  repository's contents can prove or disprove): a Google Apps Script
  project's multiple files are not isolated modules — they share one
  global execution scope. A `function` declaration is not block-scoped
  per-file; if two files in the same project declare a same-named
  top-level function, the project ends up with one final binding for that
  name, and no build error or warning is raised for the collision. This is
  documented, generally-known Apps Script behavior. It is stated here as
  background context only, explicitly **not** as evidence drawn from this
  repository.
- **Whether it actually happens for this project, and which file wins** —
  **this repository contains no evidence either way.** As established in
  Q3, nothing here records the live project's internal file ordering.

**Answer:** the *mechanism* by which this could happen is well-established
platform behavior, cited here for context. **Whether it does happen, and
in which direction, for `1gPlsV-gi_...` specifically, is not something
this repository can answer.** Confirming it with certainty requires
inspecting the live Apps Script project directly (e.g. the project's
Execution log after a real `grnCreate` call, showing which code path ran)
— outside the scope of a repository-only review, and outside what this
task authorized (no live-system inspection was performed, and none was
requested).

## 6. Whether this fix must also be applied to Code.js

Given what is and isn't provable:

- **Provable:** both files are configured to deploy together (Q2), 69
  function names collide between them (Q4), and `grnCreate` specifically
  now differs between the two (Q3) — `Code.gs` has the cache-invalidation
  fix, `Code.js` does not.
- **Not provable:** which file's `grnCreate` actually executes (Q3, Q5).

Because the second point is genuinely unresolvable from this repository,
the evidence-grounded conclusion is: **the fix should also be applied to
`Code.js`, not because `Code.js` has been proven to be the "active" one,
but because it has been proven that it cannot be ruled out** — and leaving
only `Code.gs` patched means the C2/C3/D2/E1 fix from
`ROOT_CAUSE_A_FIX_REPORT.md` has an unquantifiable chance of having no
effect at all on the live system, depending on a fact (file load order)
this review has no way to check. Applying the identical one-line change to
`Code.js`'s `grnCreate` removes the ambiguity outright, regardless of which
file turns out to load last — this was not done in this pass, since it was
out of the scope explicitly given ("Do not modify any files") and requires
separate authorization.

## 7. If Code.js is obsolete, provide evidence

**It is not obsolete — the repository evidence points the opposite
direction.** `Code.gs`'s own `doGet` function references three constants
and calls three functions that are not defined anywhere in `Code.gs`:

```
188:      const verification = verifyGoogleIdToken(e.parameter.token);
192:      } else if (OVERHEAD_ALLOWED_EMAILS.indexOf(verification.email) === -1) {
195:        result = getCashoutflowSummary();
374:      const verification = verifyGoogleIdToken(e.parameter.token);
378:      } else if (OVERHEAD_ALLOWED_EMAILS.indexOf(verification.email) === -1) {
381:        result = getOverheadSummary();
1994:  const coSS = SpreadsheetApp.openById(OVERHEAD_SHEET_ID);
```

Searching `Code.gs` for definitions of these same symbols returns nothing:
```
grep -n "^function verifyGoogleIdToken\|^function getOverheadSummary\|^function getCashoutflowSummary\|^function getTopCashoutflowVendors\|^const OVERHEAD_" Code.gs
(no output)
```

All eight are defined **only** in `Code.js` (Q1, Q4). If `Code.js` were
excluded from the deployed project, every call to `doGet`'s `'overhead'`
action (line ~373) and `'cashoutflow'` action (line ~187) — the two actions
`exec-dashboard/overhead.html` depends on entirely — would throw
`ReferenceError: verifyGoogleIdToken is not defined` (or the equivalent for
the other missing symbols) the instant either was invoked. `checkSetup()`'s
`CashOutflow Vendor Detail` check (`Code.gs`, referencing
`OVERHEAD_SHEET_ID`) would fail the same way. This is a file that current,
present-day code in `Code.gs` depends on to avoid throwing — the opposite
of what "obsolete" would look like.

## 8. If Code.js is active, explain exactly why

In the sense defined at the top of this document as **(A)
required-for-referenced-symbols-to-exist**: `Code.js` must be present and
loaded in the deployed project, because it is currently the **only**
source anywhere in this repository for 8 specific top-level symbols
(`OVERHEAD_SHEET_ID`, `OVERHEAD_GOOGLE_CLIENT_ID`,
`OVERHEAD_ALLOWED_EMAILS`, `authorizeExternalRequests`,
`verifyGoogleIdToken`, `getOverheadSummary`, `getCashoutflowSummary`,
`getTopCashoutflowVendors`) that `Code.gs`'s own `doGet` function
references without defining (Q7). This is a provable, mechanical fact from
the repository: grep shows the references in `Code.gs` and shows the
definitions exist exclusively in `Code.js`.

In the sense defined as **(B) wins-a-name-collision** (e.g., for the 69
duplicated names including `grnCreate`, `doGet`, `doPost` themselves) —
this document takes no position, because the repository contains no
evidence to support one. Sense (A) and sense (B) are independent claims:
`Code.js` can be true under (A) (something in the deployed project must
supply those 8 symbols) without that implying anything about (B) (which
file's `doGet`, `doPost`, or `grnCreate` body actually runs when both
exist). Collapsing these two into a single "Code.js is active" statement
would overstate what the evidence shows.

---

## Summary table

| # | Question | Answer | Basis |
|---|---|---|---|
| 1 | Why both files exist | `Code.js` = original imported script (self-labeled "Code.gs" in its own header); `Code.gs` = a later, separately-created file adding a perf fix, never merged back | `git log`, `git show --stat` ×3, file header text |
| 2 | Both included in deployment? | Both are *configured* to push together (`scriptExtensions` covers `.js`+`.gs`, no `.claspignore`); whether that reflects the live deployment's current content is unknown | `.clasp.json` |
| 3 | Which `grnCreate()` executes? | **Undeterminable from this repository.** The two bodies now provably differ (this session's fix); which one runs depends on live-project file order, not captured anywhere in this repo | `diff`, `git status` |
| 4 | Duplicate function names exist? | **Yes — 69**, confirmed by direct name-list comparison | `diff`/`comm` of declaration names |
| 5 | Does Apps Script silently override one with another? | The *mechanism* is established Apps Script platform behavior (not repo-provable); *whether/which* it happens here is undeterminable from this repository | N/A — explicitly flagged as non-repo knowledge |
| 6 | Must the fix also go into Code.js? | Should — not because Code.js is proven active, but because it cannot be ruled out, and `grnCreate` now differs between the files | Derived from Q3–Q5 |
| 7 | Is Code.js obsolete? | **No** — `Code.gs` itself references 8 symbols that exist only in `Code.js`; evidence points against obsolescence | `grep` cross-reference |
| 8 | If active, why? | Required (sense A) as the sole source of 8 symbols `Code.gs` depends on; whether it also wins name collisions (sense B) is unproven | `grep` cross-reference; Q3/Q5 |

No files were modified in the course of this analysis.
