# Tally Purchase Order — Structure Reference

**Scope of this task**: read-only inspection of the Purchase Order data Tally returns, using the existing `integration/` code exactly as it stands. No GRN→Tally export logic, no Google Sheets, Apps Script, GRN/ARN/Dashboard/Inventory Adjustment/Slack code, and no Tally write path were touched or created. This document itself is the only file added.

## How this document was produced — read this first

I did not fabricate any of the data below. Here is exactly what happened:

1. I read the existing code (`tally_connection.py`, `tally_parser.py`, `tally_client.py`, `test_purchase_orders.py`) to confirm what already exists — no new XML request was written; the one Purchase Order request already defined in `tally_client.py` (`_PURCHASE_ORDER_REQUEST`) is reused verbatim throughout this document.
2. I actually attempted to execute the existing retrieval pipeline, live, from this environment:
   ```
   cd integration
   python test_purchase_orders.py
   ```
   Result:
   ```
   Step 1/3: connecting to Tally...
   FAILED to connect to Tally: Could not connect to Tally at http://192.168.29.22:9999 — check the IP/port or that Tally's server is enabled.
   EXIT CODE: 1
   ```
   `192.168.29.22:9999` is a private LAN address — this sandboxed environment has no network path to it. This is not a code defect; it's an environment limitation. I'm stating this plainly rather than silently substituting invented data.
3. Because I could not get a fresh live response, I checked whether a genuine (not fabricated) captured response already existed anywhere in the repository. `integration/README_PHASE1.md` contains one — explicitly documented there as *"a real, captured output from running `test_purchase_orders.py` against the live instance,"* from a prior session that did have live access. Everything under "Raw XML" and "Parsed JSON" below is taken from that document, unmodified.
4. That captured excerpt is **partial**, by its own admission — it elides the contents of `BATCHALLOCATIONS.LIST`, `ACCOUNTINGALLOCATIONS.LIST`, and `LEDGERENTRIES.LIST` with `...`. I have **not** filled those gaps in. Where you asked for fields that fall inside those gaps (GST information, explicit Godown, explicit Cost Centre), I say so explicitly below rather than guessing at plausible-looking Tally XML.

**Bottom line**: what's below is real data, correctly attributed to its actual source, with real gaps left visibly open rather than papered over.

---

## 1. Existing code reused

| Responsibility | File | Function |
|---|---|---|
| Connects to Tally | `integration/tally_connection.py` | `send_request()`, `check_connection()` — reused exactly from `test_tally.py`'s original connection |
| Requests Purchase Orders | `integration/tally_client.py` | `get_purchase_orders()`, using the module-level `_PURCHASE_ORDER_REQUEST` constant |
| Parses Purchase Orders | `integration/tally_parser.py` | `parse_purchase_orders_xml()` |
| Orchestrates all three | `integration/tally_client.py` | `connect()`, `parse_purchase_orders()`, `to_json()`, `fetch_purchase_orders_as_json()` |
| Existing runnable test | `integration/test_purchase_orders.py` | `main()` — this is the script I ran |

No new XML request was created. No code was modified.

## 2. The exact Purchase Order request (verbatim, from `tally_client.py`)

```xml
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>Purchase Order Collection</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Purchase Order Collection" ISMODIFY="No">
      <TYPE>Voucher</TYPE>
      <FILTER>PurchaseOrderTypeFilter</FILTER>
      <FETCH>DATE, VOUCHERNUMBER, VOUCHERTYPENAME, PARTYLEDGERNAME, GUID, NARRATION, ISCANCELLED, ISOPTIONAL, ALLINVENTORYENTRIES.LIST</FETCH>
     </COLLECTION>
     <SYSTEM TYPE="Formulae" NAME="PurchaseOrderTypeFilter">$VoucherTypeName = "Purchase Order"</SYSTEM>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
```

This is read-only (`EXPORT`/`COLLECTION`) — it cannot modify anything in Tally. **Important, and directly relevant to fields you asked about**: the `FETCH` list above does not request GST fields, an explicit Godown field, or an explicit Cost Centre field. Whatever appears for those in the raw response (if anything) would have to come bundled inside `ALLINVENTORYENTRIES.LIST`'s default nested sub-lists — which is exactly the part the captured excerpt elides. This is a real, current gap in what this project's Tally integration retrieves, not something I'm inferring.

## 3. Raw XML — real, previously captured (one voucher, partial)

Source: `integration/README_PHASE1.md`, captured during a prior live-verified session (29 real vouchers were retrieved at that time; this is one of them). Reproduced verbatim, including its own elisions:

```xml
<VOUCHER REMOTEID="78389433-...-00006437" VCHTYPE="Purchase Order" OBJVIEW="Invoice Voucher View">
 <DATE TYPE="Date">20260401</DATE>
 <GUID>78389433-1b86-42de-bf30-a357884c54ea-00006437</GUID>
 <NARRATION TYPE="String">Quantity of goods ordered (Open Order)</NARRATION>
 <VOUCHERTYPENAME>Purchase Order</VOUCHERTYPENAME>
 <PARTYNAME TYPE="String">Sri Vinayaka Gas Agencies</PARTYNAME>
 <PARTYLEDGERNAME TYPE="String">Sri Vinayaka Gas Agencies</PARTYLEDGERNAME>
 <VOUCHERNUMBER>ACHIRA/26-27/1A</VOUCHERNUMBER>
 <ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME TYPE="String">Nitrogen - UHP - Cylinders</STOCKITEMNAME>
  <RATE TYPE="Rate">1200.00/Nos</RATE>
  <AMOUNT TYPE="Amount">-12000.00</AMOUNT>
  <ACTUALQTY TYPE="Quantity"> 10.00 Nos</ACTUALQTY>
  <BILLEDQTY TYPE="Quantity"> 10.00 Nos</BILLEDQTY>
  <BATCHALLOCATIONS.LIST> ... </BATCHALLOCATIONS.LIST>
  <ACCOUNTINGALLOCATIONS.LIST> ... </ACCOUNTINGALLOCATIONS.LIST>
 </ALLINVENTORYENTRIES.LIST>
 <!-- a second ALLINVENTORYENTRIES.LIST sibling for the PO's 2nd line item -->
 <LEDGERENTRIES.LIST> ... </LEDGERENTRIES.LIST>
</VOUCHER>
```

**The `...` above are not my omissions — they are exactly how this was already documented** in the prior session's README. I want to be explicit rather than let that ambiguity stand: I do not know the real contents of `BATCHALLOCATIONS.LIST`, `ACCOUNTINGALLOCATIONS.LIST`, or `LEDGERENTRIES.LIST` for this project's live data. Getting them requires running this same script again with live Tally access — the code already fetches these lists structurally (see point 7 below), nothing needs to change to see their contents, only live network access is missing here.

Other real, sourced characteristics of the raw response (from the same document, itself checked against real data, not assumed):
- `RATE`/quantity fields are compound strings, not plain numbers — observed real forms: `"1200.00/Nos"`, `"0.14Euro = ? 0.14/UG"` (foreign-currency), `""` (blank), `" 5000 UG =  5 MG"` (compound quantity), `" 300 Pcs"` (plain).
- `AMOUNT` on inventory entries is negative (Tally's sign convention for the purchase side).
- The raw response contains an XML-illegal numeric character reference (`&#4;`, 201 occurrences in one real response, always inside a `BATCHNAME` field) that must be stripped before parsing — this is why `_sanitize_xml_text()` exists.
- No explicit line-item serial number field exists in the raw data — `sl_no` is assigned positionally during parsing.

## 4. Parsed Python objects / JSON — real, previously captured

Dataclasses (verbatim, from `tally_parser.py`):

```python
@dataclass
class POItem:
    sl_no: int
    description: str
    quantity: Optional[float]
    unit: Optional[str]
    rate: Optional[float]
    rate_unit: Optional[str]
    amount: Optional[float]

@dataclass
class PurchaseOrder:
    po_no: str
    po_date_raw: str
    po_date: Optional[str]
    vendor: str
    guid: str
    narration: str
    items: List[POItem] = field(default_factory=list)
```

Real captured JSON output for the same PO (`ACHIRA/26-27/1A`, source: `README_PHASE1.md`, this is what `test_purchase_orders.py` actually printed against live Tally):

```json
{
  "po_no": "ACHIRA/26-27/1A",
  "po_date_raw": "20260401",
  "po_date": "01-04-2026",
  "vendor": "Sri Vinayaka Gas Agencies",
  "guid": "78389433-1b86-42de-bf30-a357884c54ea-00006437",
  "narration": "Quantity of goods ordered (Open Order)",
  "items": [
    {
      "sl_no": 1,
      "description": "Nitrogen - UHP - Cylinders",
      "quantity": 10.0,
      "unit": "Nos",
      "rate": 1200.0,
      "rate_unit": "Nos",
      "amount": 12000.0
    },
    {
      "sl_no": 2,
      "description": "Liquid Nitrogen",
      "quantity": 200.0,
      "unit": "Lts",
      "rate": 75.0,
      "rate_unit": "Lts",
      "amount": 15000.0
    }
  ]
}
```

## 5. Field-by-field explanation

| Requested field | Raw XML source | Parsed to | Status |
|---|---|---|---|
| PO Number | `VOUCHERNUMBER` | `po_no` | ✅ Parsed |
| Voucher Number | `VOUCHERNUMBER` | `po_no` | Same underlying field as PO Number — Tally does not distinguish these for a Purchase Order voucher |
| Voucher Type | `VOUCHERTYPENAME` | — | ⚠️ Present in the raw response (it's in the `FETCH` list), **but not read by the parser** — `PurchaseOrder` has no `voucher_type` field |
| Date | `DATE` | `po_date_raw` (as-is, e.g. `"20260401"`) and `po_date` (reformatted `dd-mm-yyyy`) | ✅ Parsed |
| Party Name | `PARTYNAME` | — | ⚠️ Present in the real captured response even though it is **not** in the explicit `FETCH` list (Tally appears to return it automatically alongside `PARTYLEDGERNAME`) — **not read by the parser** |
| Supplier Ledger | `PARTYLEDGERNAME` | `vendor` | ✅ Parsed |
| Stock Item | `STOCKITEMNAME` (inside each `ALLINVENTORYENTRIES.LIST`) | `items[].description` | ✅ Parsed |
| Quantity | `BILLEDQTY`, falling back to `ACTUALQTY` | `items[].quantity` | ✅ Parsed |
| Unit | parsed alongside quantity | `items[].unit` | ✅ Parsed |
| Rate | `RATE` | `items[].rate` + `items[].rate_unit` | ✅ Parsed |
| Amount | `AMOUNT` (negative in raw; stored as absolute value) | `items[].amount` | ✅ Parsed |
| GST information | Not in the current `FETCH` list; not visible in the captured excerpt (falls inside the elided `ACCOUNTINGALLOCATIONS.LIST`/`LEDGERENTRIES.LIST`) | — | ❓ **Unknown — not currently captured by this project at all.** Would require extending the `FETCH` list and re-running live. |
| Batch information | `BATCHALLOCATIONS.LIST` | — | ⚠️ Confirmed structurally present in the raw response (README_PHASE1.md point 7: fetching `ALLINVENTORYENTRIES.LIST` returns this nested list by Tally's default behavior) — **contents not captured** (elided), **not parsed** |
| Godown | Conventionally lives inside `BATCHALLOCATIONS.LIST` in Tally's schema | — | ❓ **Not confirmed for this instance** — elided in the captured data, not parsed |
| Cost Centre | Not in the current `FETCH` list | — | ❓ **Unknown — not currently captured** |
| Narration | `NARRATION` | `narration` | ✅ Parsed |
| Inventory Entries | `ALLINVENTORYENTRIES.LIST` (repeated element, one per line item) | `items[]` | ✅ Parsed (partially — only description/qty/rate/amount are extracted; the nested batch/accounting sub-lists inside each entry are not) |
| Ledger Entries | `LEDGERENTRIES.LIST` | — | ⚠️ Confirmed structurally present in the raw response — **contents elided, not parsed at all** |
| GUID / Master ID | `GUID` (child element) and `REMOTEID` (a `VOUCHER` tag XML *attribute*, confirmed identical value to `GUID` in the captured sample: both `78389433-1b86-42de-bf30-a357884c54ea-00006437`) | `guid` | ✅ `GUID` is parsed. `REMOTEID` is not — appears to be the same identifier expressed as an XML attribute instead of a child element |
| Hidden/internal fields | `VCHTYPE` and `OBJVIEW` — both `VOUCHER` tag attributes (`VCHTYPE="Purchase Order"`, `OBJVIEW="Invoice Voucher View"`) | — | ⚠️ Present, not read by the parser |

## 6. Which fields are mandatory (for the parser to keep a voucher at all)

From reading `parse_purchase_orders_xml()` directly — a voucher is **skipped entirely** (not included in the output, not an error) if any of these fail:

- `ISCANCELLED` must not be `"Yes"`.
- `ISOPTIONAL` must not be `"Yes"`.
- `VOUCHERNUMBER` must be non-empty.
- At least one `ALLINVENTORYENTRIES.LIST` entry must have a non-empty `STOCKITEMNAME` (a voucher with zero usable line items is dropped).

Everything else — date, vendor, GUID, narration, quantity, rate, amount — is best-effort. If any of those individually fail to parse, that one field comes back `None`/empty in the object; the rest of the voucher is still returned.

## 7. Fields likely required for creating a GRN voucher in Tally later

This section is my own reasoned assessment based on what a Tally receipt-note voucher generally needs, cross-referenced against what's currently captured — **it is not a confirmed spec**, since GRN→Tally export is explicitly out of scope for this task and hasn't been designed:

- **PO Number / `VOUCHERNUMBER`** — needed to link a GRN back to the originating PO (currently captured).
- **GUID** — the natural idempotency key to avoid creating a duplicate GRN for the same PO (currently captured).
- **Supplier Ledger (`PARTYLEDGERNAME`)** — any Tally voucher needs a party ledger reference (currently captured).
- **Stock Item, Quantity, Unit, Rate, Amount** per line — core inventory entry data (currently captured).
- **Godown** — Tally inventory vouchers typically require a Godown/location allocation. **Not currently captured by this project.**
- **Batch information** — if the relevant stock items are batch-tracked in Tally, a GRN would need batch allocation data. **Not currently captured.**
- **GST/tax details** — if the GRN voucher needs to carry tax information. **Not currently captured.**

The three "not currently captured" items above are the concrete, actionable gap: before Phase 2 (GRN→Tally) work can rely on them, the `FETCH` list in `tally_client.py` would need to be extended and re-verified against a live response — this document deliberately does not attempt that extension, since it's outside what was asked for here.

## 8. Fields currently ignored by the parser (consolidated)

Present in the raw XML response (confirmed structurally), but not stored anywhere in the `PurchaseOrder`/`POItem` objects today:

- `VOUCHERTYPENAME`
- `PARTYNAME`
- `REMOTEID`, `VCHTYPE`, `OBJVIEW` (all `VOUCHER` tag attributes)
- `BATCHALLOCATIONS.LIST` (full contents)
- `ACCOUNTINGALLOCATIONS.LIST` (full contents)
- `LEDGERENTRIES.LIST` (full contents)

None of this is a defect in the current code — `tally_parser.py`'s own docstring and `README_PHASE1.md` are explicit that it was deliberately scoped to extract only what Phase 1 needed. It's listed here because this task specifically asked what's currently ignored.
