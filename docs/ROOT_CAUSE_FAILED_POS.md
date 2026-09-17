# Root Cause Analysis — Failed PO_SYNC Requests

**Scope of this document:** Apps Script request routing only (`doPost()` /
`doGet()` in `backend/Code.gs` and `backend/Code.js`). No code has been
modified to produce this analysis.

**Superseded investigation:** an earlier pass compared the raw
Tally XML → parsed object → translated object → HTTP payload for one
successful PO (ACHIRA/26-27/52) and one failed PO (ACHIRA/26-27/61). That
comparison is preserved below in [Appendix A](#appendix-a-python-side-trace-ruled-out)
because it rules out an entire category of causes with hard evidence
(both POs parse, translate, and serialize identically cleanly — no
`None`/`null` fields, no malformed strings, no oversized payloads). The
divergence is not in `tally_parser.py` or `po_translator.py`. The current,
active investigation is entirely on the Apps Script side, per instruction.

Both `backend/Code.gs` and `backend/Code.js` were checked line-for-line for
`doPost`/`doGet` (lines 44–89 and 163–424) and are byte-identical, so
everything below applies to both deployed files equally.

---

## 1. Complete `doPost()` implementation

```js
function doPost(e) {
  try {
    let data;
    if (e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data);
    } else {
      data = JSON.parse(e.postData.contents);
    }
    if (data.type === 'MATERIAL_REQUEST') {
      appendMaterialRequest(data);
      return jsonResponse({ status: 'success', reqId: data.reqId });
    } else if (data.type === 'ARN_ASSIGN') {
      return jsonResponse(arnAssign(data));
    } else if (data.type === 'ARN_APPROVE') {
      return jsonResponse(arnApprove(data));
    } else if (data.type === 'ARN_REJECT') {
      return jsonResponse(arnReject(data));
    } else if (data.type === 'GRN_CREATE') {
      return jsonResponse(grnCreate(data));
    } else if (data.type === 'PO_SYNC') {
      Logger.log('PO_SYNC: request received. poNo=' + data.poNo);
      Logger.log('PO_SYNC: JSON parsed successfully. items.length=' + (data.items ? data.items.length : 'undefined'));
      try {
        const result = syncPurchaseOrder(data);
        Logger.log('PO_SYNC: response about to be returned (doPost level). status=' + result.status);
        return jsonResponse(result);
      } catch (poSyncErr) {
        Logger.log('PO_SYNC: exception caught in doPost — ' + poSyncErr.toString());
        return jsonResponse({
          status: 'error',
          message: poSyncErr.toString(),
          stack: poSyncErr.stack,
        }, 500);
      }
    } else {
      appendRow(data);
      return jsonResponse({ status: 'success', adjId: data.adjId });
    }
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}
```

`jsonResponse()` (used on every return path above):

```js
function jsonResponse(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 2. Every execution path for `data.type === "PO_SYNC"`, inside `doPost()`

Given a request that actually reaches `doPost(e)` with a body whose parsed
`data.type` equals `"PO_SYNC"`, there are exactly three possible outcomes,
all of them `jsonResponse(...)` — i.e. all three are valid JSON with
`Content-Type: application/json`:

| # | Path | Trigger | Response |
|---|------|---------|----------|
| 1 | Success | `syncPurchaseOrder(data)` returns normally | `jsonResponse(result)` — `result.status` is `'success'` or `'error'` depending on what `syncPurchaseOrder` decided internally (bad secret, malformed payload, etc.) |
| 2 | Inner catch | `syncPurchaseOrder(data)` throws | `jsonResponse({status:'error', message, stack}, 500)` |
| 3 | Outer catch | `JSON.parse(...)` on line 48/50 throws (body isn't valid JSON, or `e.postData` is `undefined`) | `jsonResponse({status:'error', message: err.message}, 500)` |

**Every one of these three paths returns valid JSON.** There is no branch
*inside* `doPost()` for a request whose type resolves to `PO_SYNC` that can
produce HTML, plain text, or the `appendRow`/default-handler behavior. The
`else` branch (`appendRow(data)`, line 82–84) is only reachable if
`data.type` does not match any of the five named branches — impossible if
`data.type === 'PO_SYNC'` was true, since that check is itself one of the
`else if` conditions. **`doPost()` cannot silently fall through to the
generic `appendRow` path once `data.type` is correctly `'PO_SYNC'`.**

This means: for `doPost()` to fail to route a request as `PO_SYNC`, `data`
must never actually have `data.type === 'PO_SYNC'` inside `doPost()` at
all — which is only possible if either (a) `doPost()` was never invoked for
that request, or (b) `JSON.parse` produced something whose `.type` isn't
`'PO_SYNC'` (e.g. parsing empty/wrong content). Both are explored in §4.

## 3. `doGet()` — where "Achira Inventory Adjustment API is running" comes from

That exact string exists in **exactly one place** in the entire codebase:

```js
// backend/Code.gs and backend/Code.js, line 412 (inside doGet(), after
// every `if (e.parameter.action === ...)` check has been tried and failed)
return jsonResponse({ status: 'ok', message: 'Achira Inventory Adjustment API is running' });
```

`doGet(e)` checks `e.parameter.action` against 15 known string values
(`'list'`, `'activePOs'`, `'poShortfall'`, `'cashoutflow'`, `'assign'`,
`'dupcheck'`, `'approve'`, `'reject'`, `'grnlookup'`, `'itemlist'`,
`'employees'`, `'grntabs'`, `'grnprefixes'`, `'grnsuggest'`,
`'grncreate'`, `'grnverifylookup'`, `'grnverify'`, `'overhead'`) in
sequence. `'PO_SYNC'` is never one of them — **`doGet()` has no PO_SYNC
handling whatsoever.** If `e.parameter.action` is `undefined` (no `action`
query-string parameter present at all), every one of those checks is
false, and execution falls straight through to line 412.

**Conclusion (fact, not inference):** the "Achira Inventory Adjustment API
is running" response can only ever be produced by `doGet()` being invoked
for a request that carries no `action` query parameter. It is structurally
impossible for `doPost()` to emit this string under any circumstance —
`doPost()` never references it.

## 4. How a POST request ends up inside `doGet()`

This is the central question, since the Python client (`po_sync.py`) only
ever calls `requests.post(APPS_SCRIPT_URL, json=payload, timeout=timeout)`
— it never issues a GET.

Google Apps Script Web App `/exec` URLs do not serve content directly from
`script.google.com`; the first response from that host is an HTTP redirect
(302) to a one-time `script.googleusercontent.com` execution URL, which is
where `doGet`/`doPost` actually run. This is standard, documented Apps
Script Web App behavior, not specific to this deployment.

Python's `requests` library, per its own redirect-handling implementation
(`Session.resolve_redirects`), converts the request method to **GET** and
**drops the request body** when following a 301 or 302 response to a
non-GET/HEAD request — unless the response is 307/308, which are the only
codes that preserve method and body. `requests.post(..., json=payload)`
does not pass `allow_redirects=False`, so this conversion happens
automatically and silently; `po_sync.py` never sees the intermediate 302,
only the final response.

Chained together, this is a complete, code-consistent explanation for
symptom #2 with no gap:

1. `requests.post(APPS_SCRIPT_URL, json=payload)` sends the PO_SYNC POST
   body to `.../exec`.
2. Apps Script's front door responds `302 Found` → `script.googleusercontent.com/.../exec`.
3. `requests` follows the redirect, and because the original method was
   POST and the status was 302, it re-issues the follow-up request as
   **GET**, with **no body** (the JSON payload, including `type: "PO_SYNC"`
   and `secret`, is discarded — it was never in the URL, only in the POST
   body).
4. The GET request has no `action` query parameter (the client only ever
   set the query-less exec URL; all data was meant to travel as a JSON
   POST body).
5. This GET reaches `doGet(e)`, not `doPost(e)v`. Every `e.parameter.action
   === '...'` check in §3 is false. Execution reaches line 412.
6. Apps Script returns `{"status":"ok","message":"Achira Inventory
   Adjustment API is running"}` with HTTP 200 — which `response.json()`
   in `po_sync.py` parses successfully (it IS valid JSON), but
   `result.get("status") != "success"` (it's `"ok"`), so
   `sync_purchase_order()` raises `PoSyncError`, and `run_sync.py` reports
   the PO as failed.

This also explains why the failure is silent/hard to see from the Python
side: the response is well-formed JSON with HTTP 200, so it never trips
the `except requests.exceptions.RequestException` or the "non-JSON
response" branch — it looks like a normal-shaped API response, just the
wrong one.

**What this does not yet explain on its own:** why only 18 of 29 requests
are affected rather than all 29. If every `/exec` POST from this client
always received a 302 on the very first hop, the redirect-to-GET
degradation would be deterministic and should affect every request
identically — but 11 requests round-tripped correctly as POST/JSON. Two
routing-relevant, code-visible facts are consistent with a **not
uniformly reproducible** redirect:

- `po_sync.py`'s `sync_purchase_order()` issues a fresh, unauthenticated
  `requests.post()` call per PO — it does not use a `requests.Session()`,
  so no cookies/redirect-affinity are carried between the 29 calls. Each
  of the 29 requests independently negotiates its own redirect from
  scratch; nothing in the client forces identical treatment across calls.
- Apps Script Web Apps have execution-environment ("cold" vs "warm")
  variability that is undocumented in exact detail but is a widely
  reported source of inconsistent `/exec` front-door behavior (redirect
  vs. direct response, response latency) between otherwise-identical
  consecutive requests to the same deployment.

Confirming that this variability (rather than something else) accounts
for exactly which 18 of 29 requests are affected requires the actual
captured server-side execution record for a failed PO_SYNC call —
i.e. the `Logger.log` output already added in the PO_SYNC branch. If a
failed run's Apps Script **Executions** panel shows no execution at all
for that PO (no `PO_SYNC: request received...` log line), that directly
confirms `doPost()` was never invoked for that request — consistent with
this theory. If an execution *is* present but still failed, the cause is
something else inside `doPost`/`syncPurchaseOrder`, not routing.

## 5. Symptom-by-symptom mapping

| Symptom (as reported) | Where in the code this is/isn't possible |
|---|---|
| Some requests succeed | `doPost()` → `PO_SYNC` branch → `jsonResponse(result)`, `result.status === 'success'`. Fully explained, no anomaly. |
| Some requests return "Achira Inventory Adjustment API is running" | **Fully explained, §3–4.** Can only originate from `doGet()` line 412, reached when `e.parameter.action` is unset — consistent with a POST silently downgraded to a bodyless GET during an Apps Script redirect hop, per `requests`'s documented 302 handling. |
| Some requests return HTML instead of JSON | **Not explained by anything inside `doPost()`/`doGet()`** — every code path in both functions returns via `jsonResponse()`, which always sets `MimeType.JSON`; there is no branch that can construct or return HTML. An HTML response can only originate *outside* user code — i.e. from Apps Script's own platform layer (e.g. a script-execution error, an execution-time-limit termination, a quota error, or an interstitial/auth page from Google's front door) — before or instead of `doPost`/`doGet` ever running. This cannot be confirmed or ruled out further from source code alone; it requires inspecting the actual raw HTML response body captured for one such failed call (title/content of the HTML page identifies which of these it is). |
| Some requests timeout | **Not explained by anything inside `doPost()`/`doGet()`** routing logic itself — routing is a handful of string comparisons, not a plausible source of a 15-second stall. A timeout is consistent with either (a) the redirect chain in §4 stalling before ever reaching Apps Script's execution layer, or (b) genuine work taking too long once inside `syncPurchaseOrder()` (e.g. the per-row `deleteRow()` upsert loop against a growing sheet) — this document does not have evidence to attribute it to one or the other; that determination is also outside `doPost`/`doGet` routing, which was the requested scope. |

## 6. Direct answer to "why can 'Achira Inventory Adjustment API is running' ever be returned to the Python client?"

Because that string is `doGet()`'s catch-all fallback (line 412), reached
whenever a request arrives with none of `doGet()`'s 18 recognized
`e.parameter.action` values — which is exactly what an empty/absent
`action` parameter produces. `doPost()` cannot emit this string under any
circumstance (grep-confirmed: the string appears nowhere in `doPost()` or
any function it calls). Therefore, every time the Python client sees this
message, the request that Apps Script actually executed was a **GET**,
not the **POST** `po_sync.py` sent. The most direct, code-consistent
mechanism for a POST becoming a GET between client and server is the
Apps Script `/exec` → `googleusercontent.com` 302 redirect combined with
`requests`'s default behavior of demoting POST-with-body requests to
GET-without-body on 301/302 responses (§4). This is not a bug in
`doPost()`'s routing logic — `doPost()`'s routing is internally complete
and correct for any request that actually reaches it as `data.type ===
'PO_SYNC'`. The defect, as far as this document's scope (Apps Script
request routing) can establish, is that **the request never reaches
`doPost()` as a POST in the first place** for the affected calls.

---

## Appendix A: Python-side trace (ruled out)

For completeness, this reproduces the earlier finding that ruled out the
Python parsing/translation layer as the cause, using the real,
unmodified `tally_parser.py` / `po_translator.py` against the actual raw
XML for one successful PO and one failed PO:

- **ACHIRA/26-27/52** (succeeded): 3 items, parses to a `PurchaseOrder`
  with no `None` quantity/rate/amount on any item, translates cleanly,
  produces a 759-character JSON payload.
- **ACHIRA/26-27/61** (failed): 10 items, parses to a `PurchaseOrder`
  with no `None` quantity/rate/amount on any item either, translates
  cleanly, produces a 1733-character JSON payload.

Both payloads are well-formed, ordinary JSON with plain numeric/string
fields — no `NaN`/`Infinity`, no nulls, no unescaped control characters,
no unusually large size. There is no content-level difference between
these two POs that would explain a divergence in Apps Script's handling
of one versus the other. This is also consistent with §4's routing
theory: since the *content* of both POs is unremarkable, a
content-independent, per-request routing/redirect variability is a better
fit for the observed pattern than any property of the PO data itself.

Separately, `run_sync.py`'s structure (`translate_purchase_orders()`
silently drops POs that fail to translate — they would never appear in
the "Failed" list, only in a separate "N PO(s) failed to translate" note)
means that all 18 PO numbers reported as "failed" necessarily reached
`po_sync.sync_purchase_order()` and were POSTed — they did not fail in
Python. This is a structural fact about `run_sync.py`'s code, not an
inference about any specific PO's content.

---

## Summary

1. `doPost()`'s routing for `PO_SYNC` is internally sound: every path
   returns valid JSON; there is no fall-through to `appendRow`, `doGet`,
   or an HTML response possible from within `doPost()` itself once
   `data.type === 'PO_SYNC'` is true.
2. The "API is running" message is proven, by exhaustive grep and code
   trace, to originate only from `doGet()`'s fallback — meaning affected
   requests are being executed as GET, not POST.
3. The most code-consistent explanation is the Apps Script `/exec` 302
   redirect combined with `requests`'s default POST→GET redirect
   demotion, which silently drops the JSON body (and with it, `type:
   "PO_SYNC"`) before the request ever reaches Apps Script's routing
   logic.
4. The HTML-response and timeout symptoms are not explainable from
   `doPost`/`doGet` source code alone — they most likely originate
   outside user code (Apps Script platform-level errors/interstitials for
   HTML; either the same redirect chain or in-script latency for
   timeouts) and need the captured raw response body / Logger.log output
   from one failed live call to confirm definitively.
5. **Fix implemented (2026-08-19):** `integration/po_sync.py` now resolves
   the `/exec` redirect chain itself (`_post_json_preserving_method()`,
   `allow_redirects=False` + manual re-POST to the `Location` header on
   301/302/303) instead of delegating to `requests`'s default redirect
   handling, so the JSON body — including `type: "PO_SYNC"` — survives every
   hop and always reaches `doPost()` as a real POST. This does not address
   the still-unexplained HTML-response or timeout symptoms from §5, which
   remain open per that section.
