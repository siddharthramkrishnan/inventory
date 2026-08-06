# Implementation Phases — Tally PO Import

Status: **plan only — no phase below has been started.** This is the
detailed implementation roadmap for `TALLY_INTEGRATION_PLAN.md`'s
objective, built on the design in `PO_IMPORT_ARCHITECTURE.md` and the
contract in `FIELD_MAPPING.md`. Each phase has an entry condition, exit
criteria, and a rollback path, and the existing `docs/GRN_Full_Test_Plan.docx`
is used as the regression suite at every phase that touches
`getActivePOs()` or anything downstream of it.

Nothing here is to be started before the architecture in the three
preceding documents is approved.

---

## Phase 0 — Confirm assumptions against the real Tally connection

**Entry condition:** architecture approved.

**Work:**
- Run the existing, already-working Python↔Tally XML connection against a
  real Purchase Order voucher and record the actual XML response
  structure.
- Reconcile every row of `FIELD_MAPPING.md`'s Tally-side column against
  that real response — confirm field names, confirm whether a stable
  internal voucher identifier is available (needed for the idempotency
  key), confirm what date format Tally returns, confirm whether Billed Qty
  or Actual Qty is the correct quantity field for a PO context, confirm
  whether incremental change-tracking (e.g. an alteration ID) is available
  for efficient polling.
- Update `FIELD_MAPPING.md` with whatever is found — this phase's output
  is a corrected mapping document, not code.

**Exit criteria:** `FIELD_MAPPING.md` reflects verified fields, not
"typical/to be confirmed" placeholders. Any open design question this
raises (e.g. no incremental change-tracking available; no stable voucher
ID available) is resolved or explicitly deferred with a documented
fallback.

**Rollback:** N/A — no system changes made in this phase.

---

## Phase 1 — Build the Apps Script sync endpoint (additive only)

**Entry condition:** Phase 0 complete.

**Work:**
- Add the new "Open POs (Tally)" tab to `GRN_REGISTRY_SHEET_ID`, with the
  columns from `FIELD_MAPPING.md`.
- Add the new `PO_SYNC` branch to `doPost(e)` and the new
  `syncPurchaseOrder(data)` function (or equivalent naming), implementing:
  shared-secret validation (`PropertiesService`), payload-shape
  validation, upsert-by-PO-No. (or by the confirmed stable identifier)
  into the new tab, `CacheService` invalidation of `'activePOs'` on
  success.
- Store the shared secret in `PropertiesService.getScriptProperties()` on
  the Apps Script project — not in source.
- Apply this change to **both** `backend/Code.gs` and `backend/Code.js`,
  identically, per `PO_IMPORT_ARCHITECTURE.md` §8 — this is a hard
  requirement, not an optional cleanup, given the unresolved deployment
  ambiguity documented in `CODE_DEPLOYMENT_ANALYSIS.md`.
- `getActivePOs()` is **not** touched in this phase — it continues reading
  from the Drive folder exactly as today. This phase only adds a new,
  inert write path; nothing about the live "Open PO" picker changes yet.

**Exit criteria:**
- A manually-constructed test `PO_SYNC` request (e.g. via `curl` or
  Postman, not yet from Python) with a correct secret and a valid payload
  results in a correctly-populated row in "Open POs (Tally)".
- The same request with a wrong/missing secret is rejected with a clear
  error and writes nothing.
- The same request sent twice (same PO, unchanged) results in one row,
  not two.
- All 18 test cases in `docs/GRN_Full_Test_Plan.docx` still pass —
  expected trivially, since `getActivePOs()` hasn't changed yet, but
  confirming this now establishes a clean baseline before Phase 3's riskier
  change.

**Rollback:** delete the new branch/function and the new sheet tab; no
existing behavior was touched, so rollback is a pure removal.

---

## Phase 2 — Python service: sync a real PO end to end (manual trigger)

**Entry condition:** Phase 1 complete.

**Work:**
- Extend the existing Python↔Tally connection to convert one real PO
  export into the `FIELD_MAPPING.md` payload shape and POST it to the
  Phase 1 endpoint.
- Run this manually (not yet on a schedule) against a small, known set of
  real or test POs.
- Verify the resulting "Open POs (Tally)" rows match the source PO exactly
  — every field in `FIELD_MAPPING.md`, not just PO No. and vendor.
- Implement the logging described in `PO_IMPORT_ARCHITECTURE.md` §7 on the
  Python side.

**Exit criteria:**
- At least one real multi-item PO and one real single-item PO have been
  synced manually and verified field-for-field against
  `FIELD_MAPPING.md`.
- Re-syncing the same PO with no changes in Tally is confirmed to leave
  the sheet unchanged (idempotency check, not just assumed from the
  design).
- Re-syncing a PO after editing a quantity in Tally is confirmed to update
  the existing row, not create a duplicate.

**Rollback:** stop running the Python sync manually; Phase 1's endpoint
and sheet remain harmless and unused; no impact on the live "Open PO"
picker, which still reads from Drive.

---

## Phase 3 — Cut `getActivePOs()` over to the new source, with side-by-side validation

**Entry condition:** Phase 2 complete, and a meaningful number of real POs
have been synced into "Open POs (Tally)" via Phase 2, covering the same
POs currently sitting in the Drive folder.

**Work:**
- Modify `getActivePOs()` to read PO+item rows from the "Open POs (Tally)"
  sheet tab, group them into the same `{poNo, poDate, vendor, items}`
  shape `parsePOSheetValues()` used to produce, and continue into the
  existing, unmodified decoration step
  (`getReceivedQtyByPOAndItem`/`getPOOverrideKeys`/`isOpen` filtering/
  caching) exactly as before.
- Before removing the Drive-reading code path, run both side by side —
  e.g. a temporary diagnostic function (not exposed to the frontend) that
  calls both the old Drive-based logic and the new Sheet-based logic and
  diffs their output for the same underlying POs — to confirm the new
  path produces an identical `pos[]` shape and values to the old one for
  every PO currently in flight. This directly targets the risk that
  matters most here: `getActivePOs()` feeds the picker every warehouse
  user relies on, so its output must be provably equivalent before the
  old path is retired, not merely assumed equivalent because the design
  looks right on paper.
- Apply to both `Code.gs` and `Code.js`, identically (same requirement as
  Phase 1).

**Exit criteria:**
- Side-by-side comparison shows no discrepancy between old and new output
  for every currently-open PO.
- Full re-run of `docs/GRN_Full_Test_Plan.docx`'s 18 test cases against
  the new `getActivePOs()` — **this is the direct regression check for
  the change most likely to affect the GRN workflow**, since nearly every
  test in Part A–G either directly exercises `getActivePOs()` (PO
  selection, remaining-balance display) or depends on data it feeds
  (multi-item entry, partial delivery tracking, shortfall reporting). Any
  test that regresses here blocks moving to Phase 4.
- `grn-entry.html` requires **zero** code changes to pass this re-run —
  confirming the core design principle from `TALLY_INTEGRATION_PLAN.md`
  held in practice, not just in design.

**Rollback:** revert `getActivePOs()` to the Drive-reading implementation
(kept intact, not deleted, until Phase 5) in both files; the "Open POs
(Tally)" sheet and sync endpoint remain populated and harmless in the
meantime.

---

## Phase 4 — Enable scheduled, automatic polling

**Entry condition:** Phase 3 complete and stable — a burn-in period
running on manually-triggered syncs (Phase 2/3's process) with no
discrepancies found is expected before automating it, though the exact
duration is an operational decision, not fixed by this plan.

**Work:**
- Put the Python service's Tally polling on a schedule (cron / Task
  Scheduler / systemd timer / equivalent — whatever fits how the existing
  Python service is already run).
- Implement the retry/backoff and failure-alerting behavior from
  `PO_IMPORT_ARCHITECTURE.md` §6, including the Slack failure alert via
  the existing `SLACK_WEBHOOK_URL` infrastructure.
- Resolve the "PO cancelled/deleted in Tally" open question flagged in
  `PO_IMPORT_ARCHITECTURE.md` §4, if not already resolved in Phase 0 —
  this phase is the point at which an unresolved answer here starts
  mattering operationally (a manually-triggered sync can be eyeballed; an
  automatic one needs a defined behavior).

**Exit criteria:**
- POs created in TallyPrime appear in `grn-entry.html`'s picker without
  any manual action, within the configured poll interval.
- A simulated Tally-unreachable and a simulated Apps-Script-unreachable
  condition are each confirmed to be logged and retried without data loss,
  per the retry strategy.
- The manual Drive-folder `.xlsx` upload process is still available in
  parallel (not yet removed) as a safety net.

**Rollback:** disable the scheduled job; fall back to Phase 2/3's
manual-trigger process, or to the original manual Drive-upload process,
either of which remains fully functional since nothing about
`getActivePOs()`'s Sheet-reading logic depends on the scheduler.

---

## Phase 5 — Retire the manual process

**Entry condition:** Phase 4 has run automatically, in production, for a
period the operating team is confident in (duration is an operational
decision).

**Work:**
- Stop placing `.xlsx` files into the `PO_FOLDER_ID` Drive folder for new
  POs.
- Remove the now-unused Drive-reading code
  (`parsePOFile`/`parsePOSheetValues`/`findLabelCell`/`PO_FOLDER_ID`) from
  both `Code.gs` and `Code.js`, once confidence is established — not
  before, since keeping it available costs nothing and is the fastest
  possible rollback path through Phase 4.
- Update any team-facing documentation/runbooks describing the old manual
  export/import process.

**Exit criteria:**
- Full re-run of `docs/GRN_Full_Test_Plan.docx` one final time, confirming
  18/18 still pass with the Drive-reading code removed entirely.
- No `.xlsx` files remain required in the Drive folder for normal
  operation.

**Rollback:** this is the only phase that removes code rather than adding
it; rolling back means restoring the removed functions from version
control and resuming manual `.xlsx` uploads — available as long as this
phase's changes are a discrete, revertable commit, which they should be
kept as.

---

## Summary roadmap

| Phase | Adds | Removes | Frontend changed? | GRN workflow changed? | Regression check |
|---|---|---|---|---|---|
| 0 | Verified field mapping | — | No | No | N/A |
| 1 | Sync endpoint + new sheet tab (inert) | — | No | No | Full 18-case re-run (baseline) |
| 2 | Manual Python sync, verified field-for-field | — | No | No | Manual field verification |
| 3 | `getActivePOs()` reads new source | — | **No** (by design) | No | Full 18-case re-run (critical gate) |
| 4 | Scheduled automatic polling + alerting | — | No | No | Operational monitoring |
| 5 | — | Drive-reading code, manual upload process | No | No | Full 18-case re-run (final) |

Every phase preserves the frontend and the GRN workflow unchanged, per the
constraints in `TALLY_INTEGRATION_PLAN.md`. The riskiest single step is
Phase 3 (the point where `getActivePOs()`'s actual behavior changes), which
is why it carries the side-by-side validation requirement and the mandatory
full regression run before Phase 4 is allowed to begin.
