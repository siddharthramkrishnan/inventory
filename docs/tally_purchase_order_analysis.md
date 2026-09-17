# Tally Purchase Order — Discovery Analysis (GRN → Tally, Phase 0)

**Scope**: read-only exploration only. No write/export logic implemented or modified. No Google Sheets, Apps Script, GRN/ARN/Dashboard/Inventory Adjustment/Slack code touched.

## Connection status — genuine live success this time

The previous version of this document (built before the server URL changed) could not reach Tally at all. This time, `integration/inspect_purchase_order.py` was actually executed against the new server and succeeded:

```
Connecting...
Connected.
Fetching Purchase Orders...
Purchase Orders found: 29
Saving XML...
Saving JSON...
Done.
```

Everything below is real, freshly captured, complete data — not a partial excerpt, not reused from an old document. I independently verified: the raw XML contains exactly `29` `<VOUCHER ` elements, matching the `29` objects the parser returned — every voucher in this batch passed the parser's cancel/optional/empty-item filters with no silent drops.

## Part 1 — Configuration cleanup (what changed)

`TALLY_URL` was hardcoded in **two** places, and they had already drifted out of sync before this task started: `tally_connection.py` still had the old `192.168.29.22:9999`, while `test_tally.py` already had `192.168.29.23:9999`. This is now consolidated:

| File | Change |
|---|---|
| `integration/config.py` | **New** — `TALLY_URL = "http://192.168.29.23:9999"`, the single source of truth |
| `integration/tally_connection.py` | Now `from config import TALLY_URL` instead of a hardcoded literal — no other logic changed |
| `integration/test_tally.py` | Same — now imports from `config.py` instead of its own hardcoded copy |
| `integration/dump_purchase_order_sample.py` | A stale comment referencing the old IP was corrected (comment only, no logic change) |

`tally_client.py` and `tally_parser.py` were not touched — neither references the URL directly.

## Response envelope structure (real, observed)

```
<ENVELOPE>
 <HEADER>...</HEADER>
 <BODY>
  <DESC>
   <CMPINFO>...</CMPINFO>   <!-- master-entity export counts, all 0 for this voucher-only request -->
  </DESC>
  <DATA>
   <COLLECTION>
    <VOUCHER ...>...</VOUCHER>   <!-- x29, siblings directly under COLLECTION -->
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>
```

No `<TALLYMESSAGE>` wrapper around each voucher — they sit directly as repeated children of `<COLLECTION>`.

## Full voucher structure — real, complete, unabbreviated (PO `ACHIRA/26-27/1A`)

```xml
<VOUCHER REMOTEID="78389433-1b86-42de-bf30-a357884c54ea-00006437" VCHKEY="78389433-1b86-42de-bf30-a357884c54ea-0000b420:00000068" VCHTYPE="Purchase Order" OBJVIEW="Invoice Voucher View">
 <DATE TYPE="Date">20260401</DATE>
 <GUID>78389433-1b86-42de-bf30-a357884c54ea-00006437</GUID>
 <NARRATION TYPE="String">Quantity of goods ordered (Open Order)</NARRATION>
 <REQUESTORRULE/>
 <VOUCHERTYPENAME>Purchase Order</VOUCHERTYPENAME>
 <PARTYLEDGERNAME TYPE="String">Sri Vinayaka Gas Agencies</PARTYLEDGERNAME>
 <VOUCHERNUMBER>ACHIRA/26-27/1A</VOUCHERNUMBER>
 <REFERENCE TYPE="String">ACHIRA/26-27/1A</REFERENCE>
 <SERIALMASTER TYPE="String"></SERIALMASTER>
 <ARESERIALMASTER TYPE="String"></ARESERIALMASTER>
 <NUMBERINGSTYLE>Automatic (Manual Override)</NUMBERINGSTYLE>
 <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
 <ISDELETED>No</ISDELETED>
 <ASORIGINAL>No</ASORIGINAL>
 <ISDEEMEDPOSITIVE TYPE="Logical">No</ISDEEMEDPOSITIVE>
 <ISOPTIONAL TYPE="Logical">No</ISOPTIONAL>
 <EFFECTIVEDATE TYPE="Date">20260401</EFFECTIVEDATE>
 <ISCANCELLED TYPE="Logical">No</ISCANCELLED>
 <ISINVOICE>No</ISINVOICE>
 <ASPAYSLIP>No</ASPAYSLIP>
 <ISDELETEDVCHRETAINED>No</ISDELETEDVCHRETAINED>
 <ISNEGISPOSSET TYPE="Logical">Yes</ISNEGISPOSSET>
 <MASTERID TYPE="Number"> 25655</MASTERID>
 <VOUCHERKEY TYPE="Number">198049531953256</VOUCHERKEY>
 <VOUCHERRETAINKEY TYPE="Number">85</VOUCHERRETAINKEY>
 <REUSEHOLEID TYPE="Number">0</REUSEHOLEID>
 <VOUCHERNUMBERSERIES TYPE="String">Default</VOUCHERNUMBERSERIES>
 <ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME TYPE="String">Nitrogen - UHP - Cylinders</STOCKITEMNAME>
  <ADDLAMOUNT TYPE="Amount"></ADDLAMOUNT>
  <ISDEEMEDPOSITIVE TYPE="Logical">Yes</ISDEEMEDPOSITIVE>
  <ISLASTDEEMEDPOSITIVE TYPE="Logical">Yes</ISLASTDEEMEDPOSITIVE>
  <RATE TYPE="Rate">1200.00/Nos</RATE>
  <DISCOUNT TYPE="Number">0</DISCOUNT>
  <AMOUNT TYPE="Amount">-12000.00</AMOUNT>
  <ACTUALQTY TYPE="Quantity"> 10.00 Nos</ACTUALQTY>
  <BILLEDQTY TYPE="Quantity"> 10.00 Nos</BILLEDQTY>
  <BATCHALLOCATIONS.LIST>
   <BATCHNAME TYPE="String">&#4; Any</BATCHNAME>
   <INDENTNO TYPE="String">&#4; Not Applicable</INDENTNO>
   <ORDERNO TYPE="String">ACHIRA/26-27/1A</ORDERNO>
   <TRACKINGNUMBER TYPE="String">&#4; Not Applicable</TRACKINGNUMBER>
   <ADDLAMOUNT TYPE="Amount"></ADDLAMOUNT>
   <BATCHDISCOUNT TYPE="Number">0</BATCHDISCOUNT>
   <AMOUNT TYPE="Amount">-12000.00</AMOUNT>
   <ACTUALQTY TYPE="Quantity"> 10.00 Nos</ACTUALQTY>
   <BILLEDQTY TYPE="Quantity"> 10.00 Nos</BILLEDQTY>
   <BATCHRATE TYPE="Rate">1200.00/Nos</BATCHRATE>
  </BATCHALLOCATIONS.LIST>
  <ACCOUNTINGALLOCATIONS.LIST>
   <LEDGERNAME TYPE="String">Purchase GST 18%</LEDGERNAME>
   <ISDEEMEDPOSITIVE TYPE="Logical">Yes</ISDEEMEDPOSITIVE>
   <ISLASTDEEMEDPOSITIVE TYPE="Logical">Yes</ISLASTDEEMEDPOSITIVE>
   <AMOUNT TYPE="Amount">-12000.00</AMOUNT>
   <BILLALLOCATIONS.LIST>       </BILLALLOCATIONS.LIST>
   <TAXOBJECTALLOCATIONS.LIST>       </TAXOBJECTALLOCATIONS.LIST>
   <COSTTRACKALLOCATIONS.LIST>       </COSTTRACKALLOCATIONS.LIST>
  </ACCOUNTINGALLOCATIONS.LIST>
 </ALLINVENTORYENTRIES.LIST>
 <!-- second ALLINVENTORYENTRIES.LIST for "Liquid Nitrogen", same shape, omitted here for readability — full version is in docs/raw_purchase_order.xml, untrimmed -->
 <LEDGERENTRIES.LIST>
  <LEDGERNAME TYPE="String">Sri Vinayaka Gas Agencies</LEDGERNAME>
  <ISDEEMEDPOSITIVE TYPE="Logical">No</ISDEEMEDPOSITIVE>
  <ISLASTDEEMEDPOSITIVE TYPE="Logical">No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT TYPE="Amount">27000.00</AMOUNT>
  <BILLALLOCATIONS.LIST>
   <YEAREND/><NAME/><BILLCREDITPERIOD/><TDSDEDUCTEESECTIONNUMBER/><TDSLEDGERNC/><SERVICETAXLEDGER/>
   <BILLTYPE TYPE="String">On Account</BILLTYPE>
   <SUMNAME/>
   <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
   <TDSDEDUCTEESPECIALRATE>0</TDSDEDUCTEESPECIALRATE>
   <AMOUNT>27000.00</AMOUNT>
   <INTERESTCOLLECTION.LIST>       </INTERESTCOLLECTION.LIST>
   <STBILLCATEGORIES.LIST>       </STBILLCATEGORIES.LIST>
  </BILLALLOCATIONS.LIST>
  <COSTTRACKALLOCATIONS.LIST>      </COSTTRACKALLOCATIONS.LIST>
 </LEDGERENTRIES.LIST>
</VOUCHER>
```

(Note: the sentence above about the second inventory entry is the only trimming in this document, done purely for readability of this write-up — the actual saved `docs/raw_purchase_order.xml` file is complete and untrimmed, containing all 29 vouchers in full, exactly as Tally returned them.)

## Complete field inspection

| Field | XML Tag | Parsed Field | Data Type | Sample Value | Parser Reads? | Parser Ignores? | Useful for GRN export? |
|---|---|---|---|---|---|---|---|
| Voucher attributes | `<VOUCHER REMOTEID=.. VCHKEY=.. VCHTYPE=.. OBJVIEW=..>` | — | XML attributes | see above | No | Yes (all 4) | `VCHKEY`/`REMOTEID` possibly (identifiers) |
| Voucher Type | `VCHTYPE` (attr) / `VOUCHERTYPENAME` (element) | — | string | `"Purchase Order"` | No | Yes | Low — already guaranteed by the request's own filter |
| Voucher Number | `VOUCHERNUMBER` | `po_no` | string | `"ACHIRA/26-27/1A"` | **Yes** | No | **Yes** |
| Reference | `REFERENCE` | — | string | `"ACHIRA/26-27/1A"` — identical to `VOUCHERNUMBER` in this sample | No | Yes | Low — appears redundant with Voucher Number |
| Date | `DATE` | `po_date_raw`, `po_date` | string (raw), string (formatted) | `"20260401"` → `"01-04-2026"` | **Yes** | No | **Yes** |
| Effective Date | `EFFECTIVEDATE` | — | string | `"20260401"` — same as `DATE` in this sample | No | Yes | Low, unless it can ever differ from `DATE` |
| Party Ledger / Supplier Ledger | `PARTYLEDGERNAME` | `vendor` | string | `"Sri Vinayaka Gas Agencies"` | **Yes** | No | **Yes** |
| Party Name | `PARTYNAME` | — | string | Not present as a separate element in this capture's `FETCH` list (was seen in an older, differently-configured capture; not present now since it wasn't requested) | No | Yes | Low — `PARTYLEDGERNAME` already covers this |
| GUID | `GUID` | `guid` | string | `"78389433-1b86-42de-bf30-a357884c54ea-00006437"` | **Yes** | No | **Yes** — idempotency key |
| RemoteID | `REMOTEID` (attribute) | — | string | Identical value to `GUID` in every voucher checked | No | Yes | Redundant with GUID — low priority to add separately |
| MasterID | `MASTERID` | — | number | ` 25655` (leading space in raw text) | No | Yes | **Possibly** — Tally's own internal master reference; could matter if the GRN export needs to reference the exact voucher record rather than just its GUID |
| VoucherKey | `VOUCHERKEY` | — | number | `198049531953256` | No | Yes | Unclear — another internal identifier, purpose not confirmed |
| Narration | `NARRATION` | `narration` | string | `"Quantity of goods ordered (Open Order)"` | **Yes** | No | Maybe (context/audit) |
| Inventory Entries | `ALLINVENTORYENTRIES.LIST` (repeated) | `items[]` | list | 2 entries in this PO | **Partially** | Partially | **Yes** |
| Stock Item | `STOCKITEMNAME` | `items[].description` | string | `"Nitrogen - UHP - Cylinders"` | **Yes** | No | **Yes** |
| Quantity | `BILLEDQTY` (fallback `ACTUALQTY`) | `items[].quantity` | float | `10.0` | **Yes** | No | **Yes** |
| Unit | parsed alongside quantity | `items[].unit` | string | `"Nos"` | **Yes** | No | **Yes** |
| Rate | `RATE` | `items[].rate`, `items[].rate_unit` | float, string | `1200.0`, `"Nos"` | **Yes** | No | Possibly (valuation) |
| Discount | `DISCOUNT` (per item), `BATCHDISCOUNT` (per batch) | — | number | `0` in this sample | No | Yes | Possibly, if any PO ever has a non-zero discount |
| Amount | `AMOUNT` (negative in raw) | `items[].amount` | float (absolute value) | `12000.0` | **Yes** | No | **Yes** |
| Batch Allocations | `BATCHALLOCATIONS.LIST` | — | list | `BATCHNAME="␄ Any"`, `INDENTNO="␄ Not Applicable"`, `ORDERNO` (= PO No.), `TRACKINGNUMBER="␄ Not Applicable"`, `BATCHDISCOUNT`, `AMOUNT`, `ACTUALQTY`, `BILLEDQTY`, `BATCHRATE` | No | Yes — entirely | Low for these items — `BATCHNAME` is literally "Any" (not batch-tracked); would matter for genuinely batch-tracked stock items |
| Godown | — | — | — | **Confirmed NOT present anywhere in this response, at any level** (checked all 29 vouchers) | N/A | N/A | Cannot assess — this company's Tally data doesn't appear to carry Godown on these vouchers at all |
| Accounting Allocations | `ACCOUNTINGALLOCATIONS.LIST` (nested per item) | — | list | `LEDGERNAME`, `ISDEEMEDPOSITIVE`, `AMOUNT`, plus 3 nested empty sub-lists | No | Yes — entirely | **Yes** — this is where GST lives |
| GST information | `LEDGERNAME` inside `ACCOUNTINGALLOCATIONS.LIST` | — | string (ledger name, not a numeric rate field) | Real distinct values observed across the 29 POs: `"Purchase GST 18%"`, `"Purchase GST 5%"`, `"Purchase IGST 18%"`, `"Purchase IGST 5%"`, `"Purchase Non GST"` | No | Yes | **Yes — likely required.** GST rate/type is encoded as a ledger *name string* (e.g. parse the `%` and CGST/IGST split out of the name), not a separate numeric field |
| Cost Centre | `COSTTRACKALLOCATIONS.LIST` (appears both per-item and per voucher-level ledger entry) | — | list | **Empty in every voucher checked** — the structure exists but carries no data | No | Yes | Cannot assess — feature present in the schema but unused in this company's actual data |
| Ledger Entries | `LEDGERENTRIES.LIST` (voucher-level, not per item) | — | list | `LEDGERNAME` (the vendor), `AMOUNT` (positive, the PO total), `BILLALLOCATIONS.LIST` (bill type, TDS fields, etc.), `COSTTRACKALLOCATIONS.LIST` (empty) | No | Yes — entirely | **Yes** — this is the voucher's total payable amount and bill-type classification |
| Bill Allocations (nested in Ledger Entries) | `BILLALLOCATIONS.LIST` | — | list | `BILLTYPE="On Account"`, `TDSDEDUCTEEISSPECIALRATE="No"`, `TDSDEDUCTEESPECIALRATE=0`, `AMOUNT=27000.00`, several empty fields (`YEAREND`, `NAME`, `BILLCREDITPERIOD`, TDS/service-tax ledger refs) | No | Yes | Possibly — `BILLTYPE` might matter for how a GRN references the original bill |
| UDF fields | — | — | — | **Confirmed absent** — zero matches for any user-defined-field pattern across the entire 29-voucher response | N/A | N/A | Not applicable — none exist in this data |
| Optional/sparse fields | `RATE`/`AMOUNT` can be empty or `null` on some entries (confirmed again in this batch, e.g. PO `ACHIRA/26-27/40`) | `items[].rate`/`items[].amount` become `None` | — | — | Handled gracefully | N/A |

## Parser gap analysis

| XML Field | Current Parser Reads? | Stored? | Ignored? | Useful for GRN Export? | Recommendation |
|---|---|---|---|---|---|
| `VOUCHERNUMBER` | Yes | Yes (`po_no`) | No | Yes | Keep as-is |
| `DATE` | Yes | Yes | No | Yes | Keep as-is |
| `PARTYLEDGERNAME` | Yes | Yes (`vendor`) | No | Yes | Keep as-is |
| `GUID` | Yes | Yes | No | Yes | Keep as-is |
| `NARRATION` | Yes | Yes | No | Maybe | Keep as-is |
| `STOCKITEMNAME` | Yes | Yes | No | Yes | Keep as-is |
| `BILLEDQTY`/`ACTUALQTY` | Yes | Yes | No | Yes | Keep as-is |
| `RATE` | Yes | Yes | No | Possibly | Keep as-is |
| `AMOUNT` | Yes | Yes | No | Yes | Keep as-is |
| `MASTERID` | No | No | Yes | Possibly | **Missing — real gap.** Confirmed present on every voucher; worth adding once it's clear whether GRN export needs to reference it |
| `ACCOUNTINGALLOCATIONS.LIST` / GST ledger name | No | No | Yes | **Yes — likely required** | **Missing — the most important real gap found.** GST is real, present, and currently completely unread. Needs a new dataclass field (e.g. `gst_ledger` per item) and a small parsing rule to split the rate/type out of the ledger name string (e.g. `"Purchase IGST 18%"` → type=IGST, rate=18) |
| `LEDGERENTRIES.LIST` (voucher total + bill type) | No | No | Yes | **Yes** | **Missing — real gap.** The voucher-level total payable amount and `BILLTYPE` are both unread |
| `BATCHALLOCATIONS.LIST` | No | No | Yes | Low for current data (all `"Any"`/not batch-tracked) | Not needed unless genuinely batch-tracked items appear in a future PO — confirm before adding |
| `DISCOUNT`/`BATCHDISCOUNT` | No | No | Yes | Possibly | Low priority — always `0` in this sample; add only if a real non-zero discount is observed |
| `VOUCHERTYPENAME`/`VCHTYPE` | No | No | Yes | Low | Not needed — the request's own filter already guarantees every result is a Purchase Order |
| `PARTYNAME` | No | No | Yes | Low | Not needed — redundant with `PARTYLEDGERNAME` |
| `REMOTEID` | No | No | Yes | Low | Not needed — confirmed identical to `GUID` |
| `REFERENCE` | No | No | Yes | Low | Not needed — identical to `VOUCHERNUMBER` in every voucher checked |
| Godown | N/A — not present in the data | N/A | N/A | Cannot assess | Nothing to add — not present, don't fabricate a field for it |
| Cost Centre | N/A — present as an empty structure only | N/A | N/A | Cannot assess | Nothing to add currently — revisit if a future voucher ever populates it |
| UDF fields | N/A — confirmed absent | N/A | N/A | Not applicable | Nothing to add |

**Incorrect parsing**: none found. Every currently-parsed field was cross-checked against this real 29-voucher batch and behaves correctly, including the compound rate/quantity parsing and the `None`-on-blank-amount handling.

**Missing fields (the real, concrete gaps)**: GST ledger allocation (`ACCOUNTINGALLOCATIONS.LIST`) and the voucher-level `LEDGERENTRIES.LIST` (total amount + bill type) are the two fields with real data present and genuinely unread — everything else either has low apparent value (redundant identifiers) or isn't present in this company's data at all (Godown, populated Cost Centres, UDFs).

## Recommended additional fields for the future GRN → Tally export

In priority order, now grounded in real confirmed data rather than speculation:

1. **GST allocation** (`ACCOUNTINGALLOCATIONS.LIST` → `LEDGERNAME`, `AMOUNT`) — confirmed present on every line item, encodes both the tax type (GST/IGST) and rate (5%/18%) as well as a "Non GST" category. Almost certainly required if a GRN voucher needs to carry tax information forward.
2. **Voucher-level ledger total and bill type** (`LEDGERENTRIES.LIST` → `LEDGERNAME`, `AMOUNT`, `BILLALLOCATIONS.LIST.BILLTYPE`) — confirmed present, gives the total payable amount and how it's billed ("On Account" in every sample seen).
3. **MasterID** — confirmed present on every voucher, a real internal Tally reference distinct from GUID; worth keeping in reserve in case the export path needs to reference the exact source record.
4. **Batch/Godown/Cost Centre** — explicitly **not** recommended for now. Real data shows batch allocations exist structurally but aren't meaningfully used (`"Any"`/"Not Applicable"` placeholders), Godown doesn't appear at all, and Cost Centre structures are present but empty. Adding parsing for these now would mean building against data that doesn't exist yet in this company's Tally usage — better to revisit only if a future PO is observed to actually populate them.

None of this has been implemented, per instructions — this is the discovery output for designing that work correctly.
