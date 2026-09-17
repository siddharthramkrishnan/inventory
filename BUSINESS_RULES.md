# Business Rules

Every rule below is enforced in code (frontend and/or backend), not inferred
from documentation — file/function references are given so each can be
verified directly.

## 1. Inventory Adjustment (`index.html` → `appendRow`)

- Every adjustment needs: an item, a type, an effect (Add/Deduct), a
  positive quantity, a GRN No., a reason, and the logging manager's name.
  (`index.html` `submitAdjustment`)
- **Inward-specific:** must record who the restocked item is for
  (`issuedTo`) and its expiry date (or an explicit "no expiry" flag) —
  enforced **both** client-side and server-side
  (`appendRow` throws otherwise). This is the only rule in the whole system
  enforced identically on both sides.
- **Issue-specific:** must record who it's issued to and the
  project/purpose — client-side only.
- Adjustment type determines the default effect automatically:
  `Inward`/`Transfer In`/`Recount` → Add; `Damage`/`Return`/`Transfer
  Out`/`Write-Off`/`Issue` → Deduct. The user can still pick a type without
  overriding effect, but the UI doesn't let Add+Damage combinations, etc.,
  happen by accident.
- Restock "Issued To" is **suggested** from the GRN registry's own record
  (if that GRN already has an `Issued To` value) but is always editable —
  by design, never silently trusted (`lookupGrnForRestock`).

## 2. Material Requests (`request.html` → `appendMaterialRequest`)

- Requester must pick a department, then a name from that department's
  list, an item, a positive quantity, and a purpose. Priority defaults to
  Normal; Urgent is a manual toggle, styled distinctly (red) both in the
  sheet (font color) and the UI.
- Requests start `Status = Pending` and are **never programmatically
  updated again** — fulfillment (issuing the item, linking an Adj ID) is a
  manual process performed directly in the sheet. There is no "my requests"
  view for the requester to check status.

## 3. ARN Assignment (`arn-assign.html` New Item tab → `arnAssign`)

- **A new item cannot be catalogued without a GRN already on file**, unless
  it's a personal purchase. The system will not let someone assign an ARN
  "in advance" of the goods actually being logged as received — reflecting
  a hard sequencing rule: GRN Entry must happen before ARN Assignment for
  the same delivery.
- **Personal purchase path:** if there's no GRN yet because someone paid out
  of pocket, the system auto-generates a provisional reference
  (`PRN-YYYYMM-NNN`) in place of a GRN, and requires vendor name, a
  positive amount paid, and who to reimburse. This immediately notifies
  Accounts + Procurement (email + Slack) that (a) a reimbursement is owed
  and (b) a retroactive PO/GRN is still needed. The provisional item is
  explicitly not equivalent to a normal item until Finance closes the loop —
  its Master Item List "source" note says so explicitly
  (`'... pending reimbursement + real GRN from Finance'`).
- **Duplicate protection:** before a new ARN can be minted, the system
  checks the Master Item List and other pending requests for a
  name-(and-optionally-brand)-match. If matches exist, the submitter must
  explicitly acknowledge "this is genuinely a different item" before
  proceeding — both at the moment of typing (client-side, live) and again
  at actual submission time (server-side, in case someone else submitted
  the same item in between).
- **Sub-category classification is suggested, never forced.** A client-side
  rules engine (brand rules → keyword rules → department default) proposes
  a `DEPT-SUBCAT` pairing with a confidence label (High/Medium/Low), but the
  submitter can always override it via the dropdown before submitting — the
  suggestion never programmatically locks the field.
- **"Dept That Ordered It" and the suggested classification are
  independent concepts, by design** — the code explicitly documents that
  the suggestion engine must never overwrite the "who ordered it"
  department field, even when the two disagree (e.g. R&D ordered something
  that's actually a General-category consumable).
- Procurement Request No. is only meaningful as **tab + number together**
  (the number alone repeats across different tabs of the source sheet) — the
  form requires both or neither.

## 4. ARN Approval / Rejection (`arn-assign.html` Verify & Approve tab)

- **Only the original requester, or someone in the same department as the
  requester, may approve or reject a pending item.** Enforced server-side
  in both `arnApprove` and `arnReject` by comparing the caller-supplied
  name/department against the row's stored values. (No cryptographic
  identity backs this — see `KNOWN_ISSUES.md` §3 for the practical
  implication.)
- Approving a pending item is a **one-way, idempotent** action: it mints a
  permanent ARN code (`ACH-{dept}-{subcat}-####`, next-available per
  dept+subcat prefix), creates the Master Item List row, and logs an
  opening-stock "Inward / +Add" adjustment for the requested quantity —
  atomically enough that a double-click or retry returns the same ARN
  rather than minting a second one.
- Rejecting moves the item to `Needs Correction` with a corrected
  department/sub-category and a reason, rather than deleting it — implying
  the original submitter is expected to review and resubmit/fix it (no
  code path automates that resubmission; presumably manual).

## 5. GRN Entry (`grn-entry.html` → `grnCreate`)

- **One GRN No. may legitimately cover multiple line items** (a single
  invoice/challan with several items) — the system explicitly supports this
  rather than treating GRN No. as a 1:1 key, and only rejects a submission
  if the **exact same** GRN No. + **exact same** item description already
  exists on that tab (guards against accidental double-submit of one line,
  without blocking a genuine multi-item delivery).
- **A PO's outstanding quantity is tracked per line item, per delivery** —
  each item on an open PO shows its own remaining balance (ordered minus
  everything received so far, across every historical GRN for that
  PO+item), and the GRN Entry form defaults the "quantity received" field
  to that remaining balance, not the full original order.
- **A PO line item can be manually declared "closed early"** (vendor
  short-shipped, the rest is never coming) — this is explicitly framed as a
  human business decision, not something the system infers from the
  numbers, and is only offered once at least some quantity has already been
  received against that item.
- **Only the first item of a multi-item GRN triggers a Slack notification**
  to the requester — deliberately, so a 3-line delivery doesn't ping them
  three times for what is, to them, one delivery to verify.
- A GRN category tab is discovered dynamically (any tab with a "GRN No."
  column), and its GRN-number prefix suggestions are derived from that
  tab's own history, not a global hardcoded list — a prefix belongs to
  whichever tab has actually used it.
- **Tax can be specified per item, or once for the whole GRN, never both.**
  "Tax Application" defaults to `Per Item` (existing behavior — each item's
  GST/CGST/SGST/IGST is entered on its own card, and is optional: a valid
  item can have GST alone, CGST+SGST, IGST alone, or no tax at all). If
  "Overall tax for this GRN" is selected instead, every item's own tax
  fields must be blank/zero (`grnCreate` rejects the submission otherwise,
  to prevent double taxation) and one combined GST-alone/CGST+SGST/
  IGST-alone tax is entered once, resolved against the sum of every item's
  own taxable amount (basic amount minus discount) in that submission —
  see `DATA_MODEL.md` → "GRN-level Overall Tax."

## 6. GRN Verification (`grn-verify.html` → `grnVerifyApprove`)

- The requester reviews the delivery against what they ordered and can
  **approve individual line items selectively** — unchecked items stay
  `Pending Verification` rather than being force-approved alongside the
  ones the requester is confident about. This lets a multi-item delivery be
  partially confirmed while a questionable item is held back for a manual
  conversation.
- Approval is **idempotent per item**: already-`Verified` rows are left
  untouched and counted separately, so re-running an approval (e.g. after a
  network hiccup) never double-stamps or errors on already-done items.
- The verification link (`grn-verify.html?tab=...&grn=...`) carries **no
  identity** of the requester — anyone with the link can type any name and
  approve. The system trusts the Slack DM's targeting (sent specifically to
  the requester) as the access control, not the link itself.

## 7. PO / Drive integration

- A PO is considered "open" (shown in the GRN Entry picker) as long as **any
  one item** on it still has a remaining balance — a PO isn't closed just
  because most of its items have arrived.
- Open-PO data is cached for 5 minutes to avoid re-parsing every `.xlsx` in
  the Drive folder on every page load, but a shortfall report invalidates
  the cache immediately so the change is visible without waiting out the
  window.

## 8. Personal Purchase Reimbursement Lifecycle

1. Someone buys something out-of-pocket → logs it via `arn-assign.html`'s
   personal-purchase path → gets a provisional `PRN-YYYYMM-NNN` reference →
   Accounts + Procurement notified (email + Slack).
2. The item still needs a peer approval like any other ARN request (same
   requester-or-same-dept rule).
3. `sendWeeklyPrnDigest` — intended to run on a **time-based trigger** (not
   wired up automatically anywhere in this repo; `checkSetup()` warns if the
   trigger isn't installed) — emails + Slacks a running list of everything
   still `Awaiting Reimbursement`, oldest first, with a total owed.
4. Someone (Accounts) is expected to manually mark the "Reimbursement
   Status" column `Done` in the sheet, and manually replace the PRN with
   the real GRN number once Procurement issues a retroactive PO — **no code
   path automates either of these closing steps.**

## 9. Executive Dashboard Access

- Access is restricted to exactly 4 hardcoded email addresses
  (`OVERHEAD_ALLOWED_EMAILS`), verified against a signed Google ID token on
  every request (not just at sign-in) — each dashboard data call
  independently re-verifies the token and re-checks the allowlist rather
  than trusting a client-side session flag.
- The "Uncategorized" cash-outflow bucket is explicitly documented in the
  UI copy as a bookkeeping gap ("payments that couldn't be traced back to a
  specific procurement category via bill reference — this is an honest gap
  in current bookkeeping practice, not a data error"), not hidden or
  averaged away.
- Financial averages (run-rate, projected FY total) explicitly **exclude
  the current, still-in-progress month** from the denominator, to avoid an
  artificially low run-rate from a partial month.
