# Project Overview — Achira Labs Inventory Management System

## What this is

A small internal-tools suite built for **Achira Labs** to manage lab/manufacturing
inventory: stock adjustments, material requests, new-item cataloguing (ARN
assignment), goods-receipt logging (GRN), PO-linked receiving, and an
executive financial (overhead/cash-outflow) dashboard.

It is **not a single application**. It is seven independent, statically-hosted
HTML pages (no build step, no framework, no bundler — plain HTML/CSS/vanilla
JS in single files) that all talk to **one shared Google Apps Script backend**
sitting in front of three separate Google Sheets and one Google Drive folder.

## Repository layout

```
inventory-management/
├── backend/                          Google Apps Script project (clasp-managed, has its own git history)
│   ├── Code.gs                       Backend source — CURRENT / has the GRN perf fix, MISSING overhead-dashboard code
│   ├── Code.js                       Backend source — OLDER GRN logic, HAS the overhead-dashboard code Code.gs lacks
│   ├── appsscript.json                Apps Script manifest (scopes, web app config)
│   └── .clasp.json                    clasp deployment config (pushes BOTH .gs and .js files to the same script project)
└── frontend/                          Static pages, deployed via GitHub Pages (siddharthramkrishnan.github.io/inventory/…)
    ├── index.html                     Inventory Adjustment app (store manager's main tool)
    ├── request.html                   Material Request form (any employee)
    ├── arn-assign.html                ARN Assignment + Approval (new item cataloguing workflow)
    ├── grn-entry.html                 GRN Entry (goods receipt logging, PO-linked)
    ├── grn-verify.html                GRN Verify (requester confirms a delivery against their PO)
    ├── Achira_Inventory_QR.png        Printed QR code asset (likely linking to one of the above pages)
    └── exec-dashboard/
        ├── overhead.html              Executive financial dashboard (Google-authenticated, allowlisted)
        └── overhead-auth-test.html    Standalone sign-in test harness for the dashboard's auth flow
```

**Critical fact about this repo:** the backend is split across **two divergent
files that are both configured to deploy to the same Apps Script project**
(`Code.gs` and `Code.js` — see `.clasp.json`'s `scriptExtensions: [".js", ".gs"]`).
They are not duplicates of each other; each is missing functionality the other
has. This is the single most important thing to understand before touching
this codebase — see `KNOWN_ISSUES.md` §1 for the full explanation and
`FILE_MAP.md` for the exact diff.

## Who uses it

There is no login system for the day-to-day tools (`index.html`, `request.html`,
`arn-assign.html`, `grn-entry.html`, `grn-verify.html`) — access control is
"if you have the URL, you can use it," and the app trusts whatever name a
user types into a "Your Name" field. Only the **executive dashboard**
(`exec-dashboard/overhead.html`) has real authentication (Google Sign-In,
server-verified, email allowlisted to 4 people).

Inferred user roles, from the UI and business logic:
- **Store Manager** — logs stock adjustments (`index.html`), approves ARN
  assignments for their department (`arn-assign.html` → Approve tab).
- **Any Employee** — requests material (`request.html`), submits a new item
  for ARN cataloguing (`arn-assign.html` → New Item tab).
- **Procurement / Stores staff** — log goods receipts against POs
  (`grn-entry.html`).
- **Requester (whoever ordered the item)** — verifies a GRN matches what they
  ordered (`grn-verify.html`, reached via a Slack DM link, no login).
- **Accounts / Procurement** — receive email + Slack notifications for
  personal (out-of-pocket) purchases needing reimbursement + retroactive PO.
- **Executives (4 allowlisted emails)** — view the overhead/cash-outflow
  dashboard.

## Tech stack

- **Frontend:** plain HTML/CSS/JavaScript, no framework, no build tooling.
  Chart.js (CDN) for the dashboard. Google Identity Services (CDN) for
  dashboard sign-in.
- **Backend:** Google Apps Script (V8 runtime), deployed as a Web App
  (`doGet`/`doPost`), `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`.
- **Data store:** Google Sheets (three separate spreadsheets, see below) —
  there is no database; every "table" is a Sheet tab, read/written via
  `SpreadsheetApp`.
- **File store:** Google Drive (one folder of vendor PO `.xlsx` files, parsed
  on the fly).
- **Notifications:** Slack Incoming Webhooks (two separate webhooks) + Gmail
  (`MailApp.sendEmail`).
- **Auth (dashboard only):** Google Identity Services on the client,
  server-side verification via Google's `tokeninfo` endpoint.
- **Hosting:** frontend appears to be served from GitHub Pages
  (`https://siddharthramkrishnan.github.io/inventory/...`, referenced
  directly in backend Slack-message-building code); backend is a
  `script.google.com/macros/s/...../exec` Web App URL hardcoded into every
  frontend page.

## Three Google Sheets, one Drive folder

| Constant | Sheet ID (truncated) | Contains |
|---|---|---|
| `SHEET_ID` | `1eWdZPo4...` | Adjustment Log, Material Requests, Master Item List, ARN Pending, Employees (this is also the Apps Script container-bound spreadsheet — see `KNOWN_ISSUES.md`) |
| `GRN_REGISTRY_SHEET_ID` | `1y2R4eYe...` | One tab per material category (each with a "GRN No." column), plus "Slack-user IDs" and "PO Manual Overrides" |
| `OVERHEAD_SHEET_ID` | `1DNrFVaA...` | "Category Summary", "Raw Data", "CashOutflow Category Summary", "CashOutflow Vendor Detail" — feeds the exec dashboard only |
| `PO_FOLDER_ID` (Drive) | `1jg23hI1...` | Vendor Purchase Order `.xlsx` files, parsed live for the GRN Entry PO picker |

Full column-level breakdown is in `DATA_MODEL.md`.

## Read this next

- `ARCHITECTURE.md` — how the pieces fit together, request/response flow, auth.
- `FILE_MAP.md` — every file, what it does, and whether it's actually live.
- `FUNCTION_MAP.md` — every backend function, in detail.
- `KNOWN_ISSUES.md` — start here if you're about to make changes; several
  issues (especially §1, the Code.gs/Code.js split) will bite you immediately
  if unaddressed.
