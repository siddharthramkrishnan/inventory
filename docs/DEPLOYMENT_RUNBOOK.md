# Deployment Runbook — Tally → Open PO Integration

Status: **nothing described below has been executed.** This document was
produced by inspecting the current repository state directly (not
assumed) — confirmed via `git status`/`git diff` in `backend/` that
`Code.gs`/`Code.js` are still uncommitted, local-only changes against the
last commit (`12e39d1`), and that no CLI entry point exists yet in
`integration/po_sync.py` (checked directly — no `__main__`/`argparse`
block in any file in `integration/`). Scope is strictly validating the
**Tally → Open PO** path already built in Phase 2. No new features, no
frontend changes, no architecture changes, no GRN→Tally work.

---

## 1. Apps Script changes

### Files that need to be copied to the live Apps Script project

Both, in full — the project's script content is the two files as they now
exist locally:

- `backend/Code.gs`
- `backend/Code.js`

Target project: `scriptId 1gPlsV-gi_PYoSpreBX0-OMhxYZtVYOKgxJa6HheyYtrWb5jfzMsPAyWH`
(from `backend/.clasp.json`). `backend/appsscript.json` and
`backend/.clasp.json` are **unchanged** — confirmed via `git status` (only
`Code.gs`/`Code.js` show as modified) — no manifest redeploy is needed for
this change specifically.

### New functions (did not exist before Phase 2)

| Function | Purpose |
|---|---|
| `getOrCreateTallyPoSheet()` | Opens (or creates, with header row) the "Open POs (Tally)" tab |
| `getParsedPOsFromTallySheet()` | Reads that tab, groups rows into `{poNo, poDate, vendor, guid, narration, poDateRaw, items[]}` objects |
| `syncPurchaseOrder(data)` | Validates a secret + payload shape, upserts rows into the tab, invalidates the `activePOs` cache |

### Modified functions (existed before, changed now)

| Function | Change |
|---|---|
| `doPost(e)` | One new `else if (data.type === 'PO_SYNC')` branch added, positioned before the final catch-all `else` (confirmed by direct inspection — not shadowed) |
| `getActivePOs()` | Data source changed from `DriveApp.getFolderById(PO_FOLDER_ID)` + `parsePOFile()` to `getParsedPOsFromTallySheet()`. Decoration logic (received/remaining-quantity math, override handling, the 5-minute cache) is byte-identical to before — confirmed by diffing against the pre-Phase-2 version in commit `12e39d1`. Output now also includes `guid`/`narration`/`poDateRaw` per PO (extra fields; existing consumers ignore unknown fields) |

### Functions present but now unused (left in place deliberately — see Rollback, §6)

`parsePOFile()`, `parsePOSheetValues()`, `findLabelCell()` — confirmed
byte-identical to the last commit, untouched.

### New constants

```js
const TALLY_PO_SHEET = 'Open POs (Tally)';
const TALLY_PO_HEADERS = [
  'PO No.', 'PO Date', 'Vendor', 'Sl No.', 'Description of Material',
  'Quantity', 'Unit', 'Rate', 'Amount', 'GUID', 'Narration',
  'PO Date Raw', 'Rate Unit', 'Last Synced At',
];
```

### New sheet name

`Open POs (Tally)` — a new tab inside the **existing** spreadsheet
`GRN_REGISTRY_SHEET_ID` (not a new spreadsheet). It does not need to be
created by hand: `getOrCreateTallyPoSheet()` creates it with the header
row above, styled to match every other sheet this codebase creates
(`#1A3C6E` header background, white bold text, frozen row 1), the first
time either `syncPurchaseOrder()` or `getParsedPOsFromTallySheet()` runs.

### New Apps Script services used

`PropertiesService` (for the sync secret) — **built-in**, requires no
`enabledAdvancedServices` entry in `appsscript.json`. Confirmed the
manifest is untouched and needs no change for this.

---

## 2. Spreadsheet preparation

- **Spreadsheet ID to verify:** `1y2R4eYeep0ZSY91QMxnLov1ZZU4geOgGBNsbWoVx9cY`
  (the `GRN_REGISTRY_SHEET_ID` constant, unchanged, already in production
  use by `grnCreate`/`grnVerifyLookup`/`reportPOShortfall` today). This is
  a value I can confirm from source; confirming it is the *correct, live*
  spreadsheet requires opening it in Sheets and checking it's the one with
  the existing GRN category tabs and "PO Manual Overrides" — I cannot do
  that confirmation myself.
- **"Open POs (Tally)" tab:** expected to **not exist yet** before the
  first sync or picker load after deployment. Do not create it by hand —
  let `getOrCreateTallyPoSheet()` create it, so the header row is
  guaranteed to exactly match `TALLY_PO_HEADERS` (a hand-created tab risks
  a header typo that `getParsedPOsFromTallySheet()`'s exact-index column
  reads would silently misalign against).
- **Required headers**, once created, exactly in this order (row 1):
  `PO No. | PO Date | Vendor | Sl No. | Description of Material |
  Quantity | Unit | Rate | Amount | GUID | Narration | PO Date Raw |
  Rate Unit | Last Synced At`
- **Permissions:** no new grant should be needed. The Apps Script project
  already runs as `executeAs: USER_DEPLOYING` (per `appsscript.json`,
  unchanged) and already has write access to this exact spreadsheet via
  `grnCreate()`/`reportPOShortfall()`. Verify by confirming whoever last
  deployed the Web App still has edit access to
  `1y2R4eYeep0ZSY91QMxnLov1ZZU4geOgGBNsbWoVx9cY` — the same access already
  required for GRN Entry to work today.

---

## 3. Python setup

### Required files (`integration/`)

Sync needs exactly these five — confirmed by tracing imports:

```
tally_connection.py   (transport)
tally_parser.py        (XML -> objects)
tally_client.py         (retrieval interface)
po_translator.py        (translation layer)
po_sync.py              (sends to Apps Script)
```

`test_purchase_orders.py` and both `README_PHASE*.md` are not required at
runtime — documentation/testing aids only.

### Required packages

Exactly one third-party package, confirmed by grepping every `import`
across `integration/*.py`: **`requests`**. No `requirements.txt` exists in
this repository (checked — none found anywhere). Install directly:

```
pip install requests
```

(Confirmed working in this environment: `requests` 2.34.2 on Python
3.14.5. Any reasonably current Python 3 + `requests` should work — nothing
in these five files uses a version-specific feature.)

### Configuration

| Variable | Required? | Current value / default |
|---|---|---|
| `INVENTORY_TALLY_SYNC_SECRET` | **Yes — no default.** `po_sync.py` refuses to run without it. | Must match exactly whatever is set as `TALLY_SYNC_SECRET` in the Apps Script project's Script Properties (§4 below) |
| `INVENTORY_APPS_SCRIPT_URL` | No | Defaults to the real, already-in-production Web App URL hardcoded in `po_sync.py` (the same URL every frontend page already uses) |
| Tally connection (`TALLY_URL`) | N/A — not an env var | Fixed in `tally_connection.py` source, `http://192.168.29.22:9999`, by deliberate design (reused exactly from `test_tally.py` per Phase 1's instruction not to redesign the connection) — not overridable without editing that file |

### How to run the sync manually

Covered precisely in §4 — no shortcut command exists yet in the shipped
code, so the honest answer belongs there, not summarized here.

---

## 4. Manual synchronization

**Finding, checked directly against the code, not assumed:** there is no
`if __name__ == "__main__":` block, no `argparse`, and no `sys.argv`
handling anywhere in `integration/po_sync.py` or any other shipped file.
A command like `python integration/po_sync.py --sync-once` **would not
do anything** against the current implementation — running that file
directly only defines its functions and constants; nothing calls them.
Building a CLI wrapper would be a new feature, which is explicitly out of
scope for this validation pass. Below is the exact, real invocation using
only what already exists and is already shipped.

**Full sync (every currently open PO in Tally):**

```bash
cd integration
INVENTORY_TALLY_SYNC_SECRET="<the real secret, once §4a below is done>" python -c "
import tally_client as tc, po_translator as pt, po_sync as ps
orders = tc.parse_purchase_orders(tc.get_purchase_orders())
translated = pt.translate_purchase_orders(orders)
result = ps.sync_purchase_orders(translated)
print(result)
"
```

**Single-PO smoke test (recommended first run — see §5)**, using the same
functions, filtered to one PO before syncing:

```bash
cd integration
INVENTORY_TALLY_SYNC_SECRET="<the real secret>" python -c "
import tally_client as tc, po_translator as pt, po_sync as ps
orders = tc.parse_purchase_orders(tc.get_purchase_orders())
one = [o for o in orders if o.po_no == 'ACHIRA/26-27/1A']  # substitute any real, current PO No.
translated = pt.translate_purchase_orders(one)
result = ps.sync_purchase_orders(translated)
print(result)
"
```

Expected output shape: `{'synced': ['ACHIRA/26-27/1A'], 'failed': []}` on
success. On a rejected secret or malformed payload, the PO number appears
in `'failed'` instead, and the specific reason is logged via
`logging` (add `import logging; logging.basicConfig(level=logging.INFO)`
before the call to see it on screen, matching how `test_purchase_orders.py`
is normally run).

---

## 5. Validation checklist

Each item maps to a specific, checkable fact — not a vague "looks fine":

- **✓ Connection to Tally succeeds** — the sync command above completing
  past `tc.get_purchase_orders()` without a `TallyConnectionError`
  confirms this (same connection already proven live in Phase 1).
- **✓ Purchase Orders are retrieved** — `len(orders) > 0` after
  `tc.parse_purchase_orders(...)`; print `len(orders)` and compare
  against what's currently expected open in Tally.
- **✓ Rows appear in "Open POs (Tally)"** — open the sheet directly;
  confirm a new tab exists with the header row from §1/§2 and one row per
  synced item.
- **✓ Metadata columns are populated** — specifically check columns J
  (GUID), K (Narration), L (PO Date Raw), M (Rate Unit) are **not
  blank** for the synced row(s) — this is the concrete, checkable form of
  "metadata preserved even though the frontend ignores it."
- **✓ No duplicate rows are created** — run the **exact same** sync
  command a second time immediately after the first; confirm the row
  count for that PO No. in the sheet is unchanged (proves
  `syncPurchaseOrder()`'s delete-then-append upsert is working, not just
  appending blindly).
- **✓ Cache is invalidated** — this can't be observed directly (there's
  no "show me the cache" UI), but is implied correctly if the very next
  step (getActivePOs() / the dropdown) reflects the new PO **immediately**
  rather than only after up to 5 minutes (`PO_CACHE_SECONDS`). If the PO
  only appears after a delay, the invalidation call did not run — a real
  regression, not a timing fluke to shrug off.
- **✓ `getActivePOs()` returns the new data** — call `?action=activePOs`
  directly (e.g. paste the Web App URL + `?action=activePOs` into a
  browser, or via `curl`) and confirm the synced PO No. appears in the
  `pos` array with the expected `vendor`/`items`.
- **✓ The existing Open PO dropdown displays the imported Purchase
  Orders** — the actual end-to-end proof: open `grn-entry.html` for real,
  confirm the synced PO appears in the "Open PO" `<select>` with the
  correct vendor label, and that selecting it correctly populates the
  item checklist. This is the one check that confirms the frontend
  contract truly held, not just that the backend returned plausible JSON.

If any item fails, stop and go to §6 before touching anything else.

---

## 6. Rollback procedure

Two scenarios, handled differently:

### A. Deployment was pushed, but something in §5 failed, and no real GRN
### data depends on the new sheet yet

This is the expected case during initial validation. Revert just
`getActivePOs()` to its pre-Phase-2 form — the **entire** rollback diff,
confirmed minimal by direct comparison against the last commit:

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
-  }
+  });
```

(plus removing the three added `guid`/`narration`/`poDateRaw` lines from
the object pushed into `pos`). Everything this reverted code calls
(`parsePOFile`, `parsePOSheetValues`, `findLabelCell`, `PO_FOLDER_ID`) is
confirmed still present and byte-identical to the last commit — it will
work immediately, unmodified, the moment `getActivePOs()` points back at
it. The new `PO_SYNC` route, `syncPurchaseOrder()`, and the "Open POs
(Tally)" tab can all be left in place — they simply go unused again, with
no side effects, exactly as the Drive-reading functions do today in the
forward direction. Push/redeploy that one function's reversion, and the
system is back to manual Excel import exactly as it worked before Phase 2.

### B. Nothing has been pushed yet, or the push itself needs to be aborted

Simplest possible rollback: don't push, or if `clasp push` already ran but
no new Deployment version was created/activated (§9 of
`DEPLOYMENT_CHECKLIST.md`), the live Web App is still serving the old
code regardless of what's sitting in the project's HEAD content — nothing
user-facing has changed yet. Confirm by hitting
`?action=activePOs` and checking whether the response reflects Drive-based
or Sheet-based data.

### Before either scenario: commit first

As flagged in `DEPLOYMENT_CHECKLIST.md` item 8 — nothing in this
engagement has been committed to git yet, so there is currently no clean
commit boundary to `git revert`/`git checkout <commit> -- Code.gs` to for
"just this change." **Recommended before proceeding past this runbook:**
commit the current Phase 2 state as its own commit, so rollback becomes a
one-command `git checkout <that-commit>~1 -- Code.gs Code.js` instead of
manually re-applying the diff above by hand. Not done as part of this
document — flagged for your decision before we start.

---

## Ready to proceed

Nothing above has been executed. Per your instruction, I'll wait for your
go-ahead before starting, and stop for confirmation after each major step
(commit decision → push/copy code → create+activate deployment version →
set the secret → single-PO smoke test → full validation checklist).
