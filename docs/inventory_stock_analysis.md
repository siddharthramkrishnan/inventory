# Tally Stock Item (Inventory Master) — Discovery Analysis

**Scope**: completely separate from the Purchase Order integration. No Purchase Order request, file, or logic was reused, read for the purpose of copying, or modified. No Google Sheets, Apps Script, GRN/ARN/Dashboard/Inventory Adjustment/Slack code was touched. Read-only against Tally — this request is `EXPORT`/`COLLECTION`, incapable of altering anything in Tally.

## Connection status

Executed live via the new `integration/inspect_inventory_stock.py`:

```
Connecting...
Connected.
Fetching Stock Items...
Stock Items found: 2605
Saving XML...
Saving JSON...
Done.
```

Before building the permanent request, I ran one bounded test request first specifically to observe real field names and structure rather than guess them (methodology note: after the previous session's Tally instance became unresponsive following an unbounded, no-filter, all-voucher-types diagnostic request, I deliberately ran this as a single, isolated request and waited for its result before doing anything else, rather than batching several requests together).

## 1. The new request — completely separate from Purchase Orders

| | Purchase Orders (unchanged) | Stock Items (new) |
|---|---|---|
| File | `tally_client.py` | `tally_inventory_client.py` |
| Parser | `tally_parser.py` | `tally_inventory_parser.py` |
| TDL `TYPE` | `Voucher` | `StockItem` |
| Filter | `$VoucherTypeName = "Purchase Order"` | None — `TYPE=StockItem` alone already scopes to the correct master type; there's no "voucher type" concept for masters |
| Inspection script | `inspect_purchase_order.py` / `inspect_all_purchase_orders.py` | `inspect_inventory_stock.py` |

The only code reused across both is the generic transport layer (`tally_connection.py` — connection/HTTP only, no Purchase-Order-specific knowledge) and, inside the new parser, four small generic string/number helpers from `tally_parser.py` (`_sanitize_xml_text`, `_clean_text`, `_parse_quantity`, `_parse_rate`) — reused because Stock Item balances and rates use the exact same compound `"<value> <unit>"` / `"<value>/<unit>"` string formats Purchase Order quantities and rates already do, and reimplementing that parsing a second time would just be a second copy of the same logic (and the same bugs, if any existed).

## 2. A structural difference worth flagging explicitly

Purchase Order vouchers carry their identifying number (`VOUCHERNUMBER`) as a **child element**. Stock Item masters carry their name as an **XML attribute** on the element itself: `<STOCKITEM NAME="..." RESERVEDNAME="...">`. This was confirmed by direct inspection before writing the parser, not assumed to match the voucher shape.

## 3. Sample Stock Item (real, complete)

```json
{
  "name": "0030014430 - epTIPS Motion pipette tips Reload, with filter, PCR clean, 50 µL, volume range 1-50 µL, 24x96 tips",
  "reserved_name": null,
  "guid": "78389433-1b86-42de-bf30-a357884c54ea-00001d42",
  "parent": "MFG & Common Inventory",
  "category": "Not Applicable",
  "gst_applicable": "Applicable",
  "gst_hsn_code": "Not Found",
  "costing_method": "Avg. Cost",
  "base_unit": "Nos",
  "additional_unit": "Not Applicable",
  "master_id": "7490",
  "alter_id": "73648",
  "description": null,
  "opening_balance": 1.0,
  "opening_balance_unit": "Nos",
  "opening_value": -35250.0,
  "opening_rate": 35250.0,
  "opening_rate_unit": "Nos",
  "closing_balance": 4320.0,
  "closing_balance_unit": "Nos",
  "closing_value": -50414.4,
  "closing_rate": 19.83,
  "closing_rate_unit": "Nos"
}
```

(Note: `OPENINGVALUE`/`CLOSINGVALUE` are stored with their real sign, unlike Purchase Order `AMOUNT`, which the existing parser always makes absolute — the sign convention wasn't assumed to carry over, and the real data shows negative values here, kept as-is.)

## 4. Field-by-field: requested vs. confirmed real

| Requested field (per your list) | Real XML tag | Confirmed present? | Notes |
|---|---|---|---|
| Stock Item Name | `NAME` (attribute) | ✅ Yes — 2,605/2,605 | Never blank |
| Parent Group | `PARENT` | ✅ Yes — 2,605/2,605 | 13 distinct groups |
| Category | `CATEGORY` | ✅ Yes, but sparse | Real values are storage-condition-style labels (e.g. "R&D -20 C", "Refrigerated 2-8 Degree", "Organic Solvents") — 2,064/2,605 (79%) show the Tally placeholder `"Not Applicable"` |
| Base Unit | `BASEUNITS` | ✅ Yes — 2,605/2,605 | 27 distinct units |
| Alternate Unit | `ADDITIONALUNITS` | ✅ Yes, but sparse | Only 10 items across the whole dataset have a real alternate unit; the rest show `"Not Applicable"` |
| Opening Balance | `OPENINGBALANCE` | ✅ Yes | Compound quantity string, parsed |
| Closing Balance | `CLOSINGBALANCE` | ✅ Yes, mostly | 106 items have a genuinely **empty** tag (no value at all) — see §6 |
| Current Quantity | — | ⚠️ Not a separate field | `CLOSINGBALANCE` **is** the current quantity as of the export — there is no additional distinct "current quantity" tag |
| Reserved Quantity | — | ❌ **Not present anywhere** | No field of this kind exists in the real response. Reserved quantity (e.g. against Sales Orders) is not a Stock Item master attribute in Tally — it would need a different, order-linked query, out of scope here |
| Available Quantity | — | ❌ **Not present** | Same reasoning — this is a derived concept (Closing − Reserved), not a stored field |
| Standard Cost | — | ❌ **Not present in this FETCH** | Tally has a `STANDARDCOST.LIST`/`STANDARDPRICE.LIST` nested history structure for items that use standard costing; this company's items use `COSTINGMETHOD="Avg. Cost"` (confirmed on the sample and consistent across the data), so standard cost/rate history likely doesn't apply here — not fetched, not fabricated |
| Standard Rate | — | ❌ Same as above | |
| GST Classification | `GSTAPPLICABLE` | ✅ Yes — 2,605/2,605 | Values observed: `"Applicable"` (with the same stray-control-character prefix pattern seen in Purchase Order data) |
| HSN/SAC Code | `GSTHSNCODE` | ⚠️ Field exists, but **zero items have a real value** | All 2,605 items show `"Not Found"`. **Important**: a plain `HSNCODE` (no "GST" prefix) field was also tested — it returned **zero results** and was removed from the request rather than kept as if it were real |
| Godown information | — | ❌ **Not present anywhere** | The only "GODOWN" match anywhere in the raw response is an unrelated response-envelope metadata counter (`<CMPINFO><GODOWN>0</GODOWN>...`), the exact same false-positive pattern already documented for Purchase Orders — not per-item data |
| Batch information | — | ❌ **Not present anywhere** | Zero matches for any batch-related tag in the entire 2,605-item response |
| Manufacturer | — | ❌ **Not present** | No such field in the real response |
| Brand | — | ❌ **Not present** | No such field in the real response |
| Description | `DESCRIPTION` | ✅ Yes, but sparse | Present on 488/2,605 items (19%); absent (tag not emitted at all, not even empty) on the rest |
| GUID | `GUID` | ✅ Yes — 2,605/2,605 | Never blank |
| Master ID | `MASTERID` | ✅ Yes — 2,605/2,605 | Never blank |
| Alter ID | `ALTERID` | ✅ Yes — 2,605/2,605 | Never blank |
| Creation Date | — | ❌ **Not present** | No such field anywhere in the response |
| Last Modified Date | — | ❌ **Not present** | `ALTERID` is a change-tracking sequence number, not a date — no actual date field for this exists |

**Nested `LIST` structures found**: exactly one — `LANGUAGENAME.LIST`, containing a `NAME.LIST/NAME` (duplicating the item's own display name) and a `LANGUAGEID` (observed value `1033`, a standard Windows locale code for English-India). Not parsed into the output (adds no information beyond the `name` field already captured), but confirmed present and documented here per "do not omit fields."

## 5. Requested report

| Metric | Value |
|---|---|
| **1. Total Stock Items** | **2,605** |
| **2. Inventory Groups** (`PARENT`) | **13** distinct — R&D Inventory (933), Primary (506), Non Refrigerated Inventory (383), Refrigerated Inventory (267), Moving Inventory (185), Inactive Stock Items (87), ACIX 100 Reader Group (69), MFG & Common Inventory (65), Covidx - Kits & Buffer Inventory (56), Non Moving Inventory (40), Cartridges (6), HIK & SW Items (5), 2-8 Refrigerated Items (3) |
| **3. Units used** (`BASEUNITS`) | **27** distinct — most common: Nos (1,265), MG (237), GMS (220), UG (228), ml (212), Pack (109), Pcs (87), Bottle (36), Pkt (26), KIT (22), plus 17 more with smaller counts |
| **4. Categories** | **11** distinct (including the `"Not Applicable"` placeholder). Real categories: RnD Non Refrigirated (180), Refrigerated 2-8 Degree (90), FAB CHIP INVENTORY (72), R&D -20 C (57), Organic Solvents (51), R&D -80 C (44), R&D 2-8 C (33), Manufacturing (5), 4 C (5), HK & SWF Stores (4) |
| **5. Stock Items with zero quantity** | **2,137** (82%) — explicit `"0.00 <unit>"` closing balance |
| **6. Stock Items with negative quantity** | **0** |
| **7. Duplicate Stock Item names** | **0** — every one of the 2,605 `NAME` values is unique |
| **8. Missing master information** | GUID / MasterID / AlterID / Parent: **0 missing** (fully populated on every item). Category unassigned or placeholder: **2,064** (79%). No Description: **2,117** (81%). No real HSN code: **2,605** (100%) — see §6 note below on the distinct "106 empty closing balance" case. |
| **9. Fields ignored by our parser** | `LANGUAGENAME.LIST` (nested list — structurally present, not parsed, adds no new information over `name`). Nothing else was ignored: every other field actually present in the real response is parsed and stored. |

## 6. A distinction worth being precise about: "zero" vs. "missing" closing balance

106 items (separate from the 2,137 "confirmed zero" items above) have a **completely empty** `<CLOSINGBALANCE TYPE="Quantity"></CLOSINGBALANCE>` tag — no numeric value and no unit at all, not even `"0.00"`. These parse to `closing_balance: null` in the JSON, deliberately distinct from an explicit zero. Sampled examples: `"0030089650 Tips 2.5mL"`, `"2019 - 20 Opening Stock"`, `"2X 5Star QPCR Master Mix"`. This most likely represents stock items that have never had any recorded quantity movement at all (as opposed to items that were stocked and are now depleted to zero) — stated as the most likely explanation, not a confirmed fact about Tally's internal semantics for this specific case.

---

## Output summary

- **Files read**: `tally_connection.py`, `tally_parser.py` (for its generic helper functions only — not modified, not duplicated wholesale).
- **Files modified**: none.
- **Files created**: `integration/tally_inventory_parser.py`, `integration/tally_inventory_client.py`, `integration/inspect_inventory_stock.py`, `docs/raw_inventory_stock.xml`, `docs/inventory_stock.json`, `docs/inventory_stock_analysis.md` (this file).
- **Total Stock Items retrieved**: 2,605.
- **Raw XML location**: `docs/raw_inventory_stock.xml` (3,321,553 bytes, 63,108 lines — complete, unmodified).
- **Parsed JSON location**: `docs/inventory_stock.json`.
