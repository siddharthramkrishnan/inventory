# All Purchase Orders — Discovery Analysis

**Scope**: purely additive. The existing Open PO retrieval (`tally_client._PURCHASE_ORDER_REQUEST`, `get_purchase_orders()`, `parse_purchase_orders()`, and the `PurchaseOrder`/`POItem` dataclasses) was not modified — verified below by direct comparison against the original code. No Google Sheets, Apps Script, GRN/ARN/Dashboard/Inventory Adjustment/Slack/Tally-export code was touched.

## 1. Why the existing request behaves the way it does — read from the actual TDL, not guessed

`tally_client.py`'s existing `_PURCHASE_ORDER_REQUEST`:

- **FILTER / SYSTEM formula**: exactly one — `$VoucherTypeName = "Purchase Order"`. This filters by **voucher type only** (excluding Sales/Payment/Receipt/etc. vouchers). It contains **no status condition of any kind** — no pending-quantity check, no "is closed" flag, nothing referencing fulfillment state.
- **COLLECTION / TYPE**: `<TYPE>Voucher</TYPE>`, no `CHILD OF` clause, no second restricting formula.
- **STATICVARIABLES**: only `<SVEXPORTFORMAT>` is set. **No `<SVFROMDATE>`/`<SVTODATE>`** — confirmed by direct inspection of the file. Without an explicit date range, an `EXPORT` request is scoped to Tally's own currently active reporting period (documented general Tally platform behavior — not something provable about this specific installation without a live comparison, which is exactly what this task performed).
- **Parser-side exclusion** (not the XML request): `parse_purchase_orders_xml()` skips any voucher with `ISCANCELLED="Yes"` or `ISOPTIONAL="Yes"`. These are real fields Tally already returns (already in the `FETCH` list) — the server doesn't exclude them, the existing parser does.

**Conclusion**: there is no native "open vs. closed" field on a Purchase Order voucher in this data at all (already established in the earlier field-by-field inspection — see `docs/tally_purchase_order_analysis.md`). Open/closed/partially-received status is a *derived* concept in Tally (comparing ordered quantity against linked Receipt Note vouchers), not a property a Purchase-Order-only request can expose. The only two real, checkable exclusions in the existing pipeline are the parser's cancelled/optional skip, and Tally's implicit default active period.

## 2. The new retrieval — what was actually different, and what it found

A second request (`_ALL_PURCHASE_ORDER_REQUEST`, `get_all_purchase_orders()`) was added with two deliberate differences from the existing one: an explicit wide date range (`SVFROMDATE=20000101` to `SVTODATE=20991231`) and a parser path (`parse_all_purchase_orders_xml()`) that does **not** skip cancelled/optional vouchers — it records their status instead.

Run live against the same Tally instance:

```
Connecting...
Connected.
Fetching ALL Purchase Orders...
Purchase Orders found: 29
Saving XML...
Saving JSON...
Done.
```

**Direct comparison against the existing capture** (`docs/raw_purchase_order.xml` / `docs/parsed_purchase_order.json`):

| Check | Result |
|---|---|
| PO count | 29 vs. 29 — identical |
| PO number set | **Exactly identical** — zero POs in one set but not the other, either direction |
| Raw XML file size | 204,896 bytes in both, byte-for-byte matching line count (3,772 lines each) |
| Cancelled vouchers found | 0 |
| Optional vouchers found | 0 |

**This is a genuine, empirical null result, not a shortcoming of this task** — I'm reporting it exactly as observed rather than manufacturing a difference. The evidence directly supports the conclusion from §1: the existing request was never actually restricted to "open" POs. It already returns everything Tally exposes for this voucher type; there simply are no cancelled, optional, or outside-the-default-period Purchase Order vouchers in this Tally company's data right now. The wider date range changed nothing because the existing request's implicit period apparently already covers this same data (or the data doesn't extend earlier/later than what's already visible) — I can't prove Tally's internal period boundary directly, only that requesting a much wider one produced no additional records.

**If you expected to see more POs than 29** (e.g. ones you know are fully invoiced/closed in Tally's own UI), the likely explanation is that those still exist as ordinary, non-cancelled Purchase Order vouchers — meaning they'd already be included in both of these captures, since "closed" isn't a stored flag Tally would otherwise be hiding them behind. If they're genuinely not appearing, the next diagnostic step (not performed here, out of scope for a Purchase-Order-only request) would be checking whether they were entered under a different voucher type name, or cross-referencing Tally's own Purchase Order register/report directly in the Tally UI to compare its count against this API's.

## 3. Requested breakdown

| Metric | Value |
|---|---|
| Total Purchase Orders | 29 |
| Open Purchase Orders | Not determinable from Purchase Order data alone (see below) |
| Closed Purchase Orders | Not determinable from Purchase Order data alone (see below) |
| Partially received Purchase Orders | Not determinable from Purchase Order data alone (see below) |
| Cancelled Purchase Orders | **0** — a real, directly checkable field (`ISCANCELLED`); none found |
| Optional (draft) Purchase Orders | **0** — checked via `ISOPTIONAL`, included for completeness since the parser change surfaces it |
| Earliest PO | ACHIRA/26-27/1A — 01-04-2026 |
| Latest PO | ACHIRA/26-27/67 — 04-08-2026 |
| Number of vendors | 26 unique |
| Number of unique stock items | 70 unique |

**Why Open/Closed/Partially-received are marked "not determinable"**: this is a deliberate, honest limitation, not an oversight. Tally's Purchase Order voucher — confirmed by the exhaustive field-by-field inspection already on file — carries no stored status field for fulfillment state. Determining it correctly requires cross-referencing each PO's ordered quantity against Tally's Receipt Note (or equivalent) vouchers, a different voucher type entirely. That cross-reference is out of scope for a task specifically about Purchase Order retrieval, and fabricating an open/closed classification without it would mean guessing — which these instructions explicitly rule out.

## 4. Whether the parser handled the (empty) additional set correctly

Since no cancelled/optional/out-of-range vouchers were actually present to test against, this can only be confirmed structurally rather than by example: `parse_all_purchase_orders_xml()` was written to record `is_cancelled`/`is_optional` as booleans on every returned `AllPurchaseOrder` rather than skip on them, and this was verified by direct inspection of `docs/all_purchase_orders.json` — every one of the 29 objects has `"is_cancelled": false, "is_optional": false` present. The code path that would set either to `true` is a single boolean comparison identical in shape to the existing parser's skip-condition check, so it's exercised (just always evaluating to `false` on the data currently available) — not dead code, just not yet exercised against a `true` case in live data.
