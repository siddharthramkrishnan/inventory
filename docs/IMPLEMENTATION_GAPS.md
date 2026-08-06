# Implementation Gaps — GRN + PO Link + Approval

Derived from tracing `docs/GRN_Full_Test_Plan.docx` (test cases A1–G3)
against the current code in `backend/Code.gs` and
`frontend/grn-entry.html` / `frontend/grn-verify.html`. Two distinct root
causes account for every FAIL/PARTIAL verdict in `TEST_RESULTS.md`. A third,
minor gap is noted for completeness though it did not change any verdict.
Nothing in this document has been fixed — this is a findings record only.

---

## Gap #1 — `grnCreate()` never invalidates the `activePOs` cache

**Severity: High.** Affects C2 (FAIL), D2 (FAIL), C3 (PARTIAL), E1
(PARTIAL) — 4 of the 5 non-passing test cases.

### Root cause

`getActivePOs()` (`backend/Code.gs`) caches its **entire** result — every
open PO, every item's ordered/received/remaining quantities — under one
global `CacheService` key, for 5 minutes:

```js
function getActivePOs() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('activePOs');
  if (cached) return JSON.parse(cached);

  const folder = DriveApp.getFolderById(PO_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.MICROSOFT_EXCEL);
  const receivedByPOAndItem = getReceivedQtyByPOAndItem();
  const overrideKeys = getPOOverrideKeys();
  // ... builds `pos` from every PO file + received-quantity map + overrides ...

  const result = { status: 'success', pos: pos };
  cache.put('activePOs', JSON.stringify(result), PO_CACHE_SECONDS); // 300 seconds
  return result;
}

const PO_CACHE_SECONDS = 300; // 5 minutes
```

`grnCreate()` — the function every GRN Entry submission actually calls —
contains **no reference to `CacheService` anywhere in its body**. The
*only* function in the entire codebase that invalidates this cache is
`reportPOShortfall()`:

```js
function reportPOShortfall(poNo, itemDescription, reason, closedBy) {
  // ... validation, then: ...
  sheet.appendRow([poNo, itemDescription, reason || '', closedBy, new Date()]);
  CacheService.getScriptCache().remove('activePOs');
  return { status: 'success' };
}
```

### Why this matters

The cache key is **global**, not scoped per PO. It is the *server-side*
Apps Script `CacheService`, not anything client-side — reloading
`grn-entry.html` in the browser (as several test steps literally instruct:
"Go back to grn-entry.html") makes a brand-new client request, but that
request still hits the same server-side cache entry, for the entirety of
its 5-minute lifetime, regardless of how many page loads or browser
sessions ask for it.

The practical consequence: submitting a GRN via `grnCreate()` and then
immediately reopening the PO picker to verify the effect — exactly the
pattern tests C2, C3, D2, and E1 walk through — will very plausibly show
**stale data** (old remaining balances, items that should have disappeared
still present, "Report shortfall" buttons that depend on `receivedQty > 0`
failing to render at all) for up to 5 minutes after the write, purely
depending on how much wall-clock time happened to elapse between steps
during testing.

This is precisely the failure mode the test plan's own author anticipated
and explicitly called out as the most important behavior to verify (test
C2: *"if it defaulted back to 100, someone could accidentally double-count
stock"*) — the code as written does not reliably prevent it.

### Why E2 is unaffected

`reportPOShortfall()`'s own explicit `cache.remove('activePOs')` means the
one workflow that *does* call it (the shortfall-override path) is
protected — the very next `getActivePOs()` call after a shortfall report is
guaranteed fresh. The override mechanism also has a second, independent
safety net: `getPOOverrideKeys()` forces `remainingQty = 0` for an
overridden item outright, regardless of the quantity arithmetic, so even a
partially-stale received-quantity figure wouldn't stop the item from
correctly disappearing once overridden.

### Missing implementation

`grnCreate()` needs the same line `reportPOShortfall()` already has:

```js
CacheService.getScriptCache().remove('activePOs');
```

...called after a successful append, so that a GRN write is reflected in
the next PO-picker load immediately rather than after an unpredictable wait
of up to 5 minutes. (Not implementing this — just naming exactly what's
missing, per instructions.)

### Affected test cases (from `TEST_RESULTS.md`)

| Test | What breaks |
|---|---|
| C2 | PO picker shows 100 remaining instead of 60 after C1's 40-unit delivery |
| C3 | The item does not disappear from the picker after being fully received |
| D2 | The 20-unit item does not disappear; the 150-unit item's balance is wrong |
| E1 | "60 of 100 received" may show as "0 of 100"; the shortfall button may not render at all, since its visibility itself is gated on `item.receivedQty > 0` |

---

## Gap #2 — `grnVerifyApprove()` miscounts already-verified items as "skipped/pending" on a second approval round

**Severity: Medium.** Affects B4 (PARTIAL). Does not corrupt Sheet data —
the resulting Sheet state is correct — but produces an incorrect
user-facing message in exactly the scenario the test plan is designed to
exercise (partial approval, then finishing the rest later).

### Root cause

Inside `grnVerifyApprove()`'s per-row loop (`backend/Code.gs`), the
selection-membership check runs **before** the already-verified check:

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
  // ... otherwise mark Verified ...
}
```

When re-opening a GRN that already has some items `Verified` from an
earlier approval round, those items are rendered as read-only badges in
`grn-verify.html`, not checkboxes — so they are **never included** in
`selectedDescriptions` on the second approval click (only the
still-pending item's checkbox exists to be checked). On the backend, that
means the already-`Verified` rows fail the `selectedSet.has(rowDesc)` test
and are counted into `skippedCount` — **the same counter used for
genuinely-still-pending items** — before the code ever reaches the
`currentStatus === 'Verified'` branch that would have correctly attributed
them to `alreadyVerifiedCount` instead.

### Consequence

`grn-verify.html`'s click handler builds its message directly from these
counts:

```js
if (result.itemsApproved > 1) successMsg = result.itemsApproved + ' item(s) approved.';
else if (result.itemsApproved === 1) successMsg = 'Item approved.';
else successMsg = 'GRN ' + grnParam + ' approved.';
if (result.itemsSkipped) successMsg += ' ' + result.itemsSkipped + ' item(s) left as Pending Verification (not checked).';
```

For the B4 scenario (2 of 3 items already verified, approving the 3rd):
`itemsApproved = 1`, `itemsSkipped = 2` → the displayed message reads
**"Item approved. 2 item(s) left as Pending Verification (not checked)."**
— even though both of those items are, in fact, already `Verified`, not
pending. The page's own subsequent `loadDetails()` re-fetch (which would
correctly compute `allVerified = true` and show a correct "already
verified" message) runs *before* this incorrect message is shown, and its
result is overwritten by the click handler's own `showMsg(...)` call
immediately afterward — so the incorrect message is what the user actually
sees, not the correct one `loadDetails()` briefly produced.

### Why data integrity is preserved

The already-`Verified` rows are only ever `continue`d past in this code
path — never written to. Since they were already correctly marked
`Verified` by the prior approval round, the Sheet's actual state after this
second call is fully correct (all 3 rows `Verified`). This is a
**display/messaging defect, not a data-correctness defect.**

### Missing implementation

`skippedCount` needs to distinguish "not selected, and still genuinely
pending" from "not selected, because it's already verified and therefore
wasn't offered as a checkbox at all" — e.g. by checking `currentStatus`
before the selection filter, or by tracking a separate counter for
rows that are excluded from selection specifically because they're already
`Verified`. (Not implementing this — naming what's missing, per
instructions.)

### Affected test cases

| Test | What's wrong |
|---|---|
| B4 | Success message claims 2 items are "left as Pending Verification" when both are actually already Verified |

---

## Gap #3 — `grn-verify.html` displays only a subset of a GRN's fields, though the backend returns all of them

**Severity: Low.** Did not change any verdict in `TEST_RESULTS.md` (no
scripted test case asserts on Basic Amount/GST/Other Charges being
visible on the verify page), but is directly relevant to the test plan's
own stated goal for A2 ("confirm the details shown match what you
submitted") for any GRN richer than a simple single-item entry with no
Basic Amount/GST filled in.

### Root cause

`grnVerifyLookup()` (`backend/Code.gs`) builds its per-item response from
**every** field in `colMap`, which covers all 23 canonical GRN fields
including `basicAmount`, `gst`, and `otherCharges`:

```js
const row = {};
Object.keys(colMap).forEach(function(field) {
  row[field] = rowValues[colMap[field] - 1];
});
```

`grn-verify.html`'s rendering code, however, only ever calls `row(...)`
(the display helper) for three of them:

```js
row('Material', g.materialDescription) +
row('Quantity', g.quantity) +
row('Invoice Amount', g.invoiceAmount);
```

Basic Amount, GST, and Other Charges are present in the JSONP response
payload the browser receives, but are never rendered anywhere on the page.

### Consequence

A requester verifying a GRN that has a computed GST value (e.g. from test
B1's `"414 (18% GST)"`) or a non-zero Basic Amount has no way to see either
figure on the verification page itself — they can only compare
Material/Quantity/Invoice Amount against what they expected, not the full
cost breakdown that was actually entered.

### Missing implementation

Additional `row('Basic Amount', g.basicAmount)`, `row('GST', g.gst)`, and
(at the shared/header level, since Other Charges applies once per GRN
No. rather than per item) an equivalent display for `otherCharges` in
`grn-verify.html`'s `loadDetails()` rendering. (Not implementing this —
naming what's missing, per instructions.)

### Affected test cases

None directly fail because of this — noted for completeness and because it
bears on the spirit of A2's verification step for any GRN carrying cost
data, which the current script for A2 doesn't happen to exercise.
