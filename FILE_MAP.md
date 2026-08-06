# File Map

Every file in the repository, what it does, its dependencies, and whether
it's actually live.

## backend/

### `Code.gs` — 2,130 lines — **ACTIVE (partially broken as a standalone file)**

The primary backend source, most recently edited. Contains `doGet`, `doPost`,
and all business logic for: Inventory Adjustment, Material Requests, ARN
Assignment/Approval/Rejection, GRN Entry/Verify/Approve, PO parsing from
Drive, personal-purchase (PRN) flow, weekly digest, and setup diagnostics.

**Git history** (backend has its own nested `.git`, remote
`github.com/siddharthramkrishnan/achira-inventory-backend`):
1. `350c05f` "Initial import of live Code.gs" — actually added a file named
   **`Code.js`** (2,334 lines), not `Code.gs`.
2. `510ad84` "Fix grnVerifyLookup performance — targeted reads instead of
   full-tab scan" — added a **new, separate file `Code.gs`** (2,356 lines)
   containing everything `Code.js` had, plus the performance fix. It did
   **not** touch or remove `Code.js`.
3. `12e39d1` "Removed Financial related functions" (author `neha-achira`,
   same session's user) — deleted 227 lines from the end of `Code.gs`:
   `authorizeExternalRequests`, `OVERHEAD_SHEET_ID`,
   `OVERHEAD_GOOGLE_CLIENT_ID`, `OVERHEAD_ALLOWED_EMAILS`,
   `verifyGoogleIdToken`, `getOverheadSummary`, `getCashoutflowSummary`,
   `getTopCashoutflowVendors`. **These are not "financial" cruft — they are
   the entire backend for the executive dashboard's authentication and data
   summary, and `doGet`'s `'overhead'` and `'cashoutflow'` action handlers
   (still present in `Code.gs`, lines ~184–206 and ~373–392) call them
   directly.** `Code.gs` as it stands will throw `ReferenceError` the moment
   either action is hit, unless `Code.js` is also loaded in the same Apps
   Script project. See `KNOWN_ISSUES.md` §1.

**What `Code.gs` has that `Code.js` doesn't:** the fast, targeted-read
version of `grnVerifyLookup` (reads only the matching rows instead of the
entire tab — see the `FIX:` comment at line 929).

### `Code.js` — 2,333 lines — **PRESENT, deploys alongside Code.gs, source of the overhead-dashboard backend**

Same codebase as `Code.gs` minus the perf fix, **plus** the overhead
dashboard functions `Code.gs` is missing (`verifyGoogleIdToken`,
`getOverheadSummary`, `getCashoutflowSummary`, `getTopCashoutflowVendors`,
`authorizeExternalRequests`, and the `OVERHEAD_*` constants).

Because `.clasp.json` lists both `.gs` and `.js` as `scriptExtensions`, both
files push to the **same** Apps Script project and share **one global
scope**. Every top-level function/const defined in both files (which is
nearly all of them — `doGet`, `doPost`, `arnAssign`, `grnCreate`,
`grnVerifyLookup`, etc.) exists **twice** in the deployed project; Apps
Script silently uses whichever file's definition loads last. This file is
neither "the old version" nor "a backup" in any safe sense — it is
**concurrently deployed** with `Code.gs`.

### `appsscript.json` — Apps Script manifest — **ACTIVE**

- `timeZone: Asia/Kolkata`
- `enabledAdvancedServices`: `AdSense v2` (**unused** — no `AdSense.*` call
  anywhere in either `Code.gs`/`Code.js`; dead manifest entry, needlessly
  widens the OAuth consent screen) and `Drive v2` (**used**, for PO file
  parsing).
- `webapp.executeAs: USER_DEPLOYING` — all code runs as whoever deployed it,
  regardless of caller.
- `webapp.access: ANYONE_ANONYMOUS` — no authentication required to call the
  Web App at all (the dashboard's auth is an application-level check inside
  `doGet`, not a platform-level restriction).

### `.clasp.json` — clasp config — **ACTIVE**

Points at `scriptId: 1gPlsV-gi_...`. `scriptExtensions: [".js", ".gs"]` is
the root cause of the `Code.gs`/`Code.js` dual-deployment problem above —
clasp will happily push both files as separate script files in one project.

## frontend/

### `index.html` — 959 lines — **ACTIVE** — Inventory Adjustment app

Store manager's main tool: search the Master Item List, record an
adjustment (Inward/Issue/Damage/Return/Recount/Transfer In/Transfer
Out/Write-Off), submit. Entirely self-contained HTML+CSS+JS, no external
libraries. Talks to the backend via JSONP (`itemlist`, `employees`,
`grnlookup` reads) and a plain `fetch()` POST (write) that — unlike
`arn-assign.html`'s equivalent — does **not** set `mode: 'no-cors'`
(`KNOWN_ISSUES.md` §2). Client-generates its own sequential `ADJ-####`
display ID via `localStorage`, but the real, authoritative ID is generated
server-side in `appendRow`/`getNextAdjSerial` if the client doesn't supply
one.

### `request.html` — 796 lines — **ACTIVE** — Material Request form

Any employee searches for an item and requests a quantity for a
purpose/priority. Has its own **hardcoded** `EMPLOYEES` object (keyed by
department **full names**: `"R&D"`, `"Manufacturing"`, `"Corporate /
Admin"`, `"Quality & Regulatory"`) — a different shape and a different
department taxonomy than `arn-assign.html`'s hardcoded list (keyed by
2-letter codes `RD`/`MF`/`EN`/`GN`) and different again from the
live-fetched `Employees`/`Slack-user IDs` sheet used by `index.html`,
`grn-entry.html`, and `grn-verify.html`. Three sources of truth for "who
works here" (`KNOWN_ISSUES.md` §7). Has its own synonym-expanding smart
search (`SYNONYMS` map: `bsa`→`bovine serum albumin`, etc.) not present in
`index.html`'s simpler substring search — duplicated, diverged search logic
between the two item-picker pages.

### `arn-assign.html` — 1,386 lines — **ACTIVE** — ARN Assignment + Approval

Two tabs in one page: **New Item** (propose a new item + category, with a
client-side keyword/brand classifier `suggestArn()` and a live duplicate
check against the Master Item List / pending queue) and **Verify & Approve**
(department peer approves/rejects a pending item, minting the final ARN
code). Also owns the **personal purchase (PRN)** reimbursement path
(`isPersonalPurchase` checkbox → generates a provisional `PRN-YYYYMM-NNN`
reference, emails/Slacks Accounts + Procurement). Contains its own
duplicated 22-subcategory taxonomy (`SUBCATS`) and brand/keyword
classification rules that logically belong in a shared/config location, not
inline in one HTML file. Explicitly documents (in its own code comment) that
it learned to use `mode: "no-cors"` for POST after a CORS bug bit
`index.html` — a fix never back-ported to `index.html`/`request.html`.

### `grn-entry.html` — 855 lines — **ACTIVE** — GRN Entry (goods receipt)

Logs deliveries against the GRN Registry sheet. Can link to an open PO
(parsed live from Drive `.xlsx` files, `activePOs` action; shows per-item
remaining balance across multiple partial deliveries) or be filled in
manually, and supports multiple line items under one GRN No. Also exposes
the "report PO shortfall" manual-override flow (vendor short-shipped, item
will never fully arrive). All writes go through per-item JSONP calls to
`grncreate`.

### `grn-verify.html` — 335 lines — **ACTIVE** — GRN Verify

Reached via a Slack DM link (`?tab=...&grn=...`, no auth token) sent by
`notifyGrnForVerification`. Requester reviews the delivery, checks off which
line items actually match, and approves (typed name only, unauthenticated).
After approving, explicitly re-fetches ground truth from the sheet rather
than trusting the write response, to paper over a previously-observed
"looked like it failed but actually succeeded" network issue (see the `FIX:`
comment at line ~284) — a resilience pattern worth reusing elsewhere, not
just here.

### `exec-dashboard/overhead.html` — 523 lines — **ACTIVE** — Financial Dashboard

Google Sign-In gated view of overhead spend (by category/month, KPIs, top
ledgers) and cash outflow (by category, top vendors), rendered with Chart.js.
Entirely dependent on `getOverheadSummary`/`getCashoutflowSummary`, which
currently only exist in `Code.js` (see `Code.gs` entry above) — **this page
is at risk of being completely broken** depending on which backend file's
definitions currently win in the deployed Apps Script project.

### `exec-dashboard/overhead-auth-test.html` — 183 lines — **PRESENT but not part of the live product flow**

A standalone sign-in test harness: renders the same Google Sign-In button,
decodes the JWT **client-side**, and checks the email against a
client-side-duplicated copy of `ALLOWED_EMAILS`. Its own comment says this
check is "just to confirm the sign-in + email-extraction flow works
end-to-end" and that "the real dashboard will re-check this list
server-side... never trust a client-side check alone." Never calls the Apps
Script backend at all. Not linked from anywhere; likely a developer scratch
page kept in the repo for re-testing the OAuth client ID configuration.
Should probably not be deployed alongside the real dashboard (it leaks the
allowlist and client ID to anyone who finds the URL, though both are already
visible in `overhead.html`'s own source too).

### `Achira_Inventory_QR.png` — static asset — **ACTIVE (presumed)**

A QR code image, most likely printed and posted physically near the stores
to let staff jump straight to `index.html` on their phones. Not referenced
by any HTML file in this repo (no `<img>` tag uses it) — it exists purely as
a distributable asset, not something the web pages render.

## Dependency summary

| File | Depends on (backend actions) | Depends on (external) |
|---|---|---|
| `index.html` | `itemlist`, `employees`, `grnlookup`, POST default (`appendRow`) | — |
| `request.html` | `itemlist`, POST `MATERIAL_REQUEST` | — |
| `arn-assign.html` | `dupcheck`, `assign`/POST `ARN_ASSIGN`, `list`, `approve`, `reject` | — |
| `grn-entry.html` | `grntabs`, `grnprefixes`, `grnsuggest`, `activePOs`, `poShortfall`, `employees`, `grncreate` | — |
| `grn-verify.html` | `grnverifylookup`, `grnverify`, `employees` | — |
| `overhead.html` | `overhead`, `cashoutflow` | Google Identity Services, Chart.js CDN |
| `overhead-auth-test.html` | *(none)* | Google Identity Services |
| `Code.gs`/`Code.js` (combined) | — | Google Sheets ×3, Google Drive, Slack ×2 webhooks, Gmail, `oauth2.googleapis.com` |
