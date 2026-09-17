# Inventory Stock — Latest Pull Analysis

Read-only pull performed 2026-08-27 against the restored Tally connection
(`http://192.168.29.22:9999`, company **Achira Labs Private Limited**), using
the existing, unmodified integration (`tally_inventory_client.py` /
`tally_inventory_parser.py` / `tally_connection.py`). Compared against the
prior historical snapshot, `docs/inventory_stock.json` (2,605 items), which
was **not modified**.

Source files:
- Raw XML: `docs/raw_inventory_stock_latest.xml`
- Parsed JSON: `docs/inventory_stock_latest.json`
- Previous snapshot (unchanged): `docs/inventory_stock.json`

## Record-count validation

| Check | Count |
|---|---|
| `<STOCKITEM>` elements in raw XML with a `NAME` attribute (real master records) | 2,621 |
| `<STOCKITEM>` elements in raw XML without a `NAME` attribute | 1 |
| Stock Items returned by `parse_stock_items()` | 2,621 |

**Result: MATCH — no records silently dropped.**

The one nameless `<STOCKITEM>` element is not a stock item record at all — it's
Tally's own `<CMPINFO><STOCKITEM>0</STOCKITEM></CMPINFO>` metadata counter,
which happens to reuse the same tag name in the response header block. The
parser's documented behavior (skip any `STOCKITEM` element with no `NAME`
attribute) correctly excludes it. This is the same non-record counter block
already observed in the plain Company List response.

## Item counts

| | Count |
|---|---|
| Previous Stock Items (`docs/inventory_stock.json`) | 2,605 |
| Current Stock Items (this pull) | 2,621 |
| Common item names (present in both) | 2,603 |
| Newly added item names | 18 |
| Items no longer returned (by name) | 2 |

### Newly added items (18, by name)

```
570400 - Disperse Red 1 acrylate
Athense DX Dengue Ab IgG/Igm
Athense DX Typhoid Ab IgG/IgM
Estradiol II - Vidas
FSH - Vidas
GenePath Dx RespiRFC Pentaplex quantitative RUO reagents
HbA1c101 - Anti-HbA1c McAb
HbA1c102 - Anti-HbA1c McAb
LCDF010060X300X - NC Membrane Laminate Type
LH - Vidas
LNDFXXX060X300X - NC Membrane Laminate Type
M2359-3-[[2-(Methacryloyloxy)ethyl] dimethylammonio] propionate
M33089 Microplates for Flouresence Based Assays - 96 Well  *(rename, see below)*
Meril Covid Antigen Rapid Test
PTR5XXX012XXXXX - Conjugate Release Matrix Pad
Progesterone - Vidas
Sheet 22mm x 300mm - Grade 243
UFC5030 - Amicon Ultra Centrifugal Filter, 30 kDa  *(rename, see below)*
```

### Items no longer returned (2, by name)

```
M33089 Microplates 96 Weell 10 Per Pack
SKU - UFC503024 - Amicon 0.5ml 30KDa
```

**Important accuracy note — these 2 are renames, not deletions.** Matching by
Tally's own `MASTERID`/`GUID` (not just by name) shows both "removed" names
map to the exact same underlying master record as one of the "added" names
above:

| Old name | New name | MASTERID | GUID (unchanged) |
|---|---|---|---|
| `M33089 Microplates 96 Weell 10 Per Pack` | `M33089 Microplates for Flouresence Based Assays - 96 Well` | 10081 | `...00002761` |
| `SKU - UFC503024 - Amicon 0.5ml 30KDa` | `UFC5030 - Amicon Ultra Centrifugal Filter, 30 kDa` | 8456 | `...00002108` |

So at the **underlying-record** level: **16 genuinely new stock items, 2
renamed items, 0 true deletions.** At the **name-matching** level (as
literally requested): 18 added / 2 removed, per the table above.

## Field-level changes among the 2,603 common items

| Field | Items changed |
|---|---|
| Quantity (`closing_balance`) | 0 |
| Rate (`closing_rate`) | 0 |
| Group / Category / Unit (`parent` / `category` / `base_unit`) | 0 |

None of the 2,603 items present in both snapshots changed quantity, rate,
group, category, or unit. Spot-checked directly against the raw values (not
just the diff logic) to confirm this isn't a comparison bug — e.g. item
`0030014430 - epTIPS...`: `closing_balance` 4320.0 → 4320.0, `closing_rate`
19.83 → 19.83, unchanged in both snapshots.

This means the "new inventory data manually entered into Tally" (per your
stated purpose for this pull) shows up entirely as **new stock item masters**
(the 16 genuinely new items above), not as updated quantities on existing
items.

## Zero-stock and negative-stock items (current pull)

| | Count |
|---|---|
| Zero-stock items (`closing_balance == 0`) | 2,137 |
| Negative-stock items (`closing_balance < 0`) | 0 |

## Duplicate item names

| | Count |
|---|---|
| Duplicate names in previous snapshot | 0 |
| Duplicate names in current snapshot | 0 |

No duplicate `NAME` values in either snapshot.

## Fields actually returned by Tally

Every `<STOCKITEM NAME="..." RESERVEDNAME="...">` record's immediate child
elements, confirmed by walking the real raw XML tree (not assumed):

```
GUID, PARENT, CATEGORY, GSTAPPLICABLE, COSTINGMETHOD, BASEUNITS,
ADDITIONALUNITS, ALTERID, MASTERID, CLOSINGBALANCE, OPENINGBALANCE,
OPENINGVALUE, CLOSINGVALUE, OPENINGRATE, CLOSINGRATE, GSTHSNCODE,
DESCRIPTION, LANGUAGENAME.LIST
```

Plus two XML **attributes** on the `<STOCKITEM>` tag itself: `NAME`,
`RESERVEDNAME`.

Notes:
- `DESCRIPTION` is present only on 501 of the 2,621 records (Tally omits the
  element entirely when there's no description, rather than emitting it
  empty) — already parsed correctly as `null` when absent.
- All 17 fields explicitly requested in `tally_inventory_client.py`'s
  `FETCH` clause are present in the real response and are all parsed.

## Fields present in Tally but not currently parsed

- **`LANGUAGENAME.LIST`** — present on all 2,621 records, not requested in
  `FETCH` (Tally includes it automatically, the same way it auto-includes
  `BATCHALLOCATIONS.LIST`/`ACCOUNTINGALLOCATIONS.LIST` on Purchase Order
  vouchers). Contents inspected directly: it's a nested
  `<NAME.LIST><NAME>...same item name...</NAME></NAME.LIST>` plus
  `<LANGUAGEID>1033</LANGUAGEID>` (the Windows locale ID for English–India).
  It carries no information beyond what `NAME` already captures, so its
  absence from the parser does not lose any data.

No other requested-but-unparsed fields were found — every field in the
`FETCH` list has a corresponding parsed dataclass field.
