# Deployment Readiness Review — Phase 2

No code was modified to produce this review. Every claim below was checked
directly against the current files (`backend/Code.gs`, `backend/Code.js`,
`integration/po_translator.py`, `integration/po_sync.py`) and, where noted,
against the last git commit (`12e39d1`) to establish exact diffs — not
asserted from memory.

## Summary

| # | Check | Result |
|---|---|---|
| 1 | Every backend modification required | ✅ Pass |
| 2 | No dead code exists | ⚠️ Pass with a disclosed, deliberate exception |
| 3 | No temporary debugging code remains | ✅ Pass |
| 4 | No TODO/FIXME comments remain | ✅ Pass |
| 5 | No placeholder values remain | ✅ Pass |
| 6 | Every new function has exactly one responsibility | ⚠️ Pass with one disclosed, precedented exception |
| 7 | Every new endpoint is reachable | ⚠️ Structurally yes; not yet live — see detail |
| 8 | Rollback via restoring the previous `getActivePOs()` | ✅ Possible and precisely characterized below, with one process gap flagged |
| 9 | Deployment steps complete and reproducible | ❌ Not yet — gap identified and closed in this document |

Two items are not clean "yes" answers, and one required real work to
answer honestly rather than assert. That's the point of this review — see
each section below.

---

## 1. Every backend modification is required

| Change | Why it's required |
|---|---|
| `doPost`: new `PO_SYNC` branch | The only entry point through which `syncPurchaseOrder()` can ever be invoked. Without it, the function exists but is permanently unreachable. |
| `TALLY_PO_SHEET` / `TALLY_PO_HEADERS` constants | Single source of truth for the sheet name/schema, referenced by three functions. Removing them would mean hardcoding the same string/array three times — strictly worse, not simpler. |
| `getOrCreateTallyPoSheet()` | Both the writer (`syncPurchaseOrder`) and the reader (`getParsedPOsFromTallySheet`) need to open/create the same sheet. Without this shared helper the logic would be duplicated in both. |
| `getParsedPOsFromTallySheet()` | The literal replacement data source for `getActivePOs()` — without it, `getActivePOs()` has nothing to read. |
| `syncPurchaseOrder()` | The actual write path from Python into the sheet — the entire point of Phase 2. |
| `getActivePOs()` modification | The literal integration point Phase 2 is about — this is where the frontend contract is served from. |

No modification found that isn't load-bearing for the stated Phase 2
objective.

## 2. No dead code exists

**New code:** every new function is reachable — confirmed by tracing each
call path (`doPost` → `syncPurchaseOrder`; `doGet` → `getActivePOs` →
`getParsedPOsFromTallySheet`/`getOrCreateTallyPoSheet`).

**Disclosed exception, not an oversight:** `parsePOFile()`,
`parsePOSheetValues()`, `findLabelCell()`, and the `PO_FOLDER_ID` constant
are, as of this change, **unreachable from any `doGet`/`doPost` path** —
`getActivePOs()` no longer calls them. By a strict definition this is dead
code. It is dead **on purpose**: `IMPLEMENTATION_PHASES.md` Phase 5
explicitly defers their removal until the Tally-sourced path is proven in
production, specifically so rollback (item 8 below) is possible without
reconstructing deleted code. Confirmed byte-identical to the last commit —
they were not modified, only orphaned by `getActivePOs()` no longer
calling them.

**Also disclosed:** `integration/po_sync.py`'s `sync_purchase_order()` and
`sync_purchase_orders()` have no caller anywhere in this repository yet —
Phase 2 delivers them as a ready public interface for the not-yet-written
Phase 3/4 scheduling/orchestration script, the same relationship
`tally_client.py`'s functions had to `test_purchase_orders.py` in Phase 1
before that test script existed. This is normal library delivery, not
dead code in the sense of "unreachable or discarded" — but it means
`po_sync.py` has not actually been exercised end-to-end by anything in
this repository (consistent with the fact that it was deliberately never
run against the live Web App URL — see item 7).

**One column written but never programmatically read:** `syncPurchaseOrder()`
writes a "Last Synced At" timestamp (column N) that no Apps Script function
reads back. This matches the existing convention elsewhere in this
codebase — the Adjustment Log's own `Timestamp` column and "PO Manual
Overrides"' `Closed Date` column are also write-only, human-audit fields,
not inputs to other logic. Not flagged as dead code; flagged for
transparency since a strict reading of "is everything written also read"
would otherwise miss this.

## 3. No temporary debugging code remains

Checked directly:
```
grep -inE "TODO|FIXME|XXX|console\.log|debugger|hack|placeholder" over the
Phase 2 region of Code.gs/Code.js, and over the full diff of both files: no matches.
grep -n "print(" over po_translator.py and po_sync.py: no matches.
```
The only logging present (`logger.warning`, `logger.exception`,
`logger.error` in the two Python files) is the intentional, permanent
operational logging Phase 2 was explicitly asked to add (the unit-mismatch
warning), not debug scaffolding — confirmed by re-reading both files in
full.

## 4. No TODO/FIXME comments remain

Confirmed via the same grep above — zero matches across all four modified
files.

## 5. No placeholder values remain

- `APPS_SCRIPT_URL` in `po_sync.py` is the real, existing Web App URL
  already embedded in every frontend page (not a placeholder).
- `GRN_REGISTRY_SHEET_ID` (reused, not new) and `TALLY_PO_SHEET =
  'Open POs (Tally)'` are real, deliberate values.
- `TALLY_SYNC_SECRET`/`INVENTORY_TALLY_SYNC_SECRET` have **no hardcoded
  value anywhere** — this is not a missing placeholder, it's the required
  security design (`PO_IMPORT_ARCHITECTURE.md` §8): the code fails loudly
  with a clear error if the secret is unset, rather than working with a
  fake default. Confirmed in both `syncPurchaseOrder()` (Apps Script) and
  `_get_secret()` (Python) — both refuse to proceed without a real value
  supplied at runtime.

## 6. Every new function has exactly one responsibility

Holds cleanly for: `getOrCreateTallyPoSheet` (get-or-create, nothing else),
`getParsedPOsFromTallySheet` (read+group rows into the parsed-PO shape —
one cohesive job, at the same abstraction level as the function it
replaces, `parsePOFile`), `translate_purchase_order`/`translate_purchase_orders`,
`sync_purchase_order`/`sync_purchase_orders`, `_get_secret`.

**Disclosed exception:** `syncPurchaseOrder()` bundles several technical
concerns in one function — secret validation, payload validation, upsert
(delete old rows), write new rows, cache invalidation, response
construction. By a strict single-responsibility reading this is more than
one responsibility. It is **not a new inconsistency** — it exactly matches
the established, pre-existing pattern of every other write-handling
function in this codebase (`grnCreate()`, `arnAssign()`, `arnApprove()`,
`reportPOShortfall()` all bundle validation + write + side-effects +
response into one function this same way, confirmed in the original
architecture review). Flagged for transparency; not changed, since
"do not modify any code" applies to this review and there is no
deviation from house style to correct.

## 7. Every new Apps Script endpoint is reachable

**Structurally:** yes. The `PO_SYNC` branch in `doPost` is positioned
before the final catch-all `else { appendRow(data); ... }` (verified by
re-reading the current file), so it is not shadowed. `syncPurchaseOrder()`
is called from exactly that branch — no dead end.

**Deliberately not given a `doGet`/JSONP twin**, unlike `grnCreate()`
(reachable via both `doPost type=GRN_CREATE` and `doGet action=grncreate`).
That dual path exists elsewhere in this codebase only because
browser-based callers need JSONP to work around CORS. Python's
`requests.post()` is a server-to-server client with no CORS restriction —
it POSTs a JSON body and reads the JSON response natively (confirmed
working exactly that way in `po_sync.py`). Adding a `doGet` equivalent
would be unnecessary surface area, not a missing feature. Verified as a
deliberate, correct design choice, not an omission.

**Not yet live:** structurally reachable code is not the same as
deployed-and-reachable. Nothing in `backend/Code.gs`/`Code.js` has been
pushed to the real Apps Script project from this environment (no such
capability exists here), so the `PO_SYNC` branch does not yet exist in the
live, deployed script. This is the central fact the rest of this checklist
is building toward — see item 9.

## 8. Rollback: restoring the previous `getActivePOs()` implementation

**Confirmed possible, and precisely characterized** — diffed the current
`getActivePOs()` directly against the version in the last commit
(`12e39d1`, which predates Phase 2 and was untouched by the Root Cause
A/B fixes — those touched `grnCreate()` and `grnVerifyApprove()` only):

```diff
-  const folder = DriveApp.getFolderById(PO_FOLDER_ID);
-  const files = folder.getFilesByType(MimeType.MICROSOFT_EXCEL);
+  const parsedPOs = getParsedPOsFromTallySheet();
...
-  while (files.hasNext()) {
-    const file = files.next();
-    const parsed = parsePOFile(file);
-    if (!parsed) continue;
+  parsedPOs.forEach(function(parsed) {
...
+        guid: parsed.guid,
+        narration: parsed.narration,
+        poDateRaw: parsed.poDateRaw,
...
-  }
+  });
```

That is the **entire** rollback diff for this function — the decoration
logic (received/remaining-quantity math, the override check, the
`isOpen` filter, the cache read/write) is untouched on both sides,
confirmed identical. Rollback = reverting exactly these lines. The
functions it would call again (`parsePOFile`, `parsePOSheetValues`,
`findLabelCell`, `PO_FOLDER_ID`) are confirmed byte-identical to the last
commit (item 2), so they would work immediately, unmodified, if
`getActivePOs()` were pointed back at them. The new `PO_SYNC` route and
helper functions can be left in place during a rollback — they'd simply
sit unused, exactly as the Drive functions do today in the forward
direction — no side effects either way.

**Process gap, disclosed rather than silently accepted:** nothing in this
entire engagement (Root Cause A, Root Cause B, Phase 1, Phase 2) has been
committed to git — `git status` still shows all of it as one uncommitted
working-tree diff against `12e39d1`. That means there is currently no
commit boundary to `git revert`/`git checkout <commit> -- Code.gs` to for
"just Phase 2" in isolation — a rollback right now would have to be a
manual re-application of the diff above, not a one-command git operation.
**Recommendation:** commit Root Cause A/B and Phase 1/2 as separate,
clearly-labeled commits before deployment, specifically so this rollback
path becomes mechanical rather than manual. Not done as part of this
review, since committing is a repository action beyond "review, don't
modify code."

## 9. Deployment steps are complete and reproducible

**Finding: the deployment section in `integration/README_PHASE2.md` was
directionally correct but not a complete, reproducible runbook** — it
named the necessary actions in prose without sequencing, specific
commands, or verification checkpoints, and omitted one necessary step
entirely (Apps Script Web Apps serve a specific pinned **Deployment**,
which does not automatically update just because the project's script
content changes — `clasp push` alone is not sufficient). Corrected,
complete runbook:

1. **Commit current work** (see item 8's recommendation) so rollback has a
   clean target.
2. **Push the script content:** `clasp push` from `backend/` — pushes
   both `Code.gs` and `Code.js` (per `.clasp.json`'s `scriptExtensions`).
3. **Create/update the live Deployment** — pushing code updates the
   project's HEAD content only; the Web App URL serves a specific
   Deployment version, which needs its own update (`clasp deploy` targeting
   the existing deployment ID, or via the Apps Script editor's Deploy →
   Manage Deployments → Edit → New Version). Skipping this step means the
   live URL keeps serving the pre-Phase-2 code indefinitely even after a
   successful push.
4. **Set the secret:** in the Apps Script editor, Project Settings →
   Script Properties → add `TALLY_SYNC_SECRET` with a real generated
   value (not chosen by this review — a credential to be generated at
   deployment time).
5. **Configure the Python side:** set `INVENTORY_TALLY_SYNC_SECRET` in the
   Python service's environment to the exact same value.
6. **Smoke-test the endpoint before bulk use:** send one `PO_SYNC` request
   with a deliberately wrong secret first and confirm it's rejected
   (`{status:'error', message:'Invalid sync secret.'}`); then send one
   real PO and confirm a new "Open POs (Tally)" tab is created in the
   `GRN_REGISTRY_SHEET_ID` spreadsheet with the expected header row and
   exactly one PO's rows.
7. **Confirm it reaches the picker:** open `grn-entry.html`, confirm the
   test PO appears in the "Open PO" dropdown with correct vendor/items —
   the actual end-to-end proof, not just "the sheet has rows."
8. **Only then** run `po_sync.py` against the full set of real Tally POs.

Steps 3 and 6–7 were the gaps closed by this review; step 1 was flagged
in item 8. None of this was executed as part of this review — it is the
reproducible sequence, documented so Phase 3 doesn't have to reconstruct
it from prose.
