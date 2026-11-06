// grn-search-master-item-display.test.js
//
// Regression tests for the frontend half of the THIRD-source GRN Search
// feature (backend covered separately in
// backend/tests/grn-search-master-item.test.js): a result can now also
// be a Master Item List catalogue row (tagged r.source === 'master'),
// and the page must render, sort, export and offer a detail view for it
// — without ever dressing a Master Item row up as a GRN record, and
// without disturbing existing GRN-only or Adjustment-Log-only
// rendering/print/CSV/filename behavior.
//
// Same "no test framework installed" convention as the rest of this
// directory: extracts the EXACT relevant snippets from the live
// grn-search.html by their known surrounding text (never a hand-copied
// duplicate).
//
// Run:
//   cd frontend
//   node tests/grn-search-master-item-display.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const GRN_SEARCH_PATH = path.join(__dirname, '..', 'grn-search.html');
const html = fs.readFileSync(GRN_SEARCH_PATH, 'utf8');

function indexOfOrThrow(haystack, marker, fromIndex, label) {
  const idx = haystack.indexOf(marker, fromIndex || 0);
  assert.ok(idx !== -1, 'Could not find ' + label + ' ("' + marker + '") in grn-search.html — has it been removed or reworded?');
  return idx;
}

function sliceBalancedBraces(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  throw new Error('unbalanced braces');
}

// The IST date/time display helpers (formatIstDate, adjustmentDateDisplay,
// formatMasterFieldValue, excelDateCell, ...) — one marked, contiguous
// block of the real file, prepended to any extracted snippet that calls them.
function extractIstFormattingBlock() {
  const startMarker = '// ---- IST date/time display formatting (begin) ----';
  const endMarker = '// ---- IST date/time display formatting (end) ----';
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'the IST formatting block');
  const endIdx = indexOfOrThrow(html, endMarker, startIdx, 'the end of the IST formatting block');
  return html.slice(startIdx, endIdx) + '\n';
}

function extractFunctionSource(startMarker, label) {
  const startIdx = indexOfOrThrow(html, startMarker, 0, label);
  const braceIdx = html.indexOf('{', startIdx);
  return html.slice(startIdx, html.indexOf('{', startIdx)) + sliceBalancedBraces(html, braceIdx);
}

function extractDisplayBlock() {
  const startMarker = 'function statusBadge(status) {';
  const endMarker = "document.getElementById('f-sort').addEventListener('change', renderResults);";
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'statusBadge() (start of the display block)');
  const endIdx = indexOfOrThrow(html, endMarker, startIdx, "the f-sort change listener (end anchor of the display block, right after renderResults() closes)");
  return html.slice(startIdx, endIdx);
}

function makeElement(overrides) {
  return Object.assign({
    value: '',
    textContent: '',
    innerHTML: '',
    style: {},
    _attrs: {},
    setAttribute: function(k, v) { this._attrs[k] = String(v); },
    getAttribute: function(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
  }, overrides || {});
}

let lastFakeDoc = null;
function makeFakeDocument(fSortValue) {
  const resultsBody = makeElement({ children: [] });
  resultsBody.appendChild = function(el) { this.children.push(el); };
  const els = {
    'f-sort': makeElement({ value: fSortValue || 'grnDate-desc' }),
    'resultsCount': makeElement(),
    'resultsSummary': makeElement(),
    'resultsBody': resultsBody,
  };
  const doc = {
    getElementById: function(id) {
      if (!els[id]) throw new Error('unexpected document.getElementById(' + id + ') in renderResults()');
      return els[id];
    },
    createElement: function(tag) { return makeElement({ tagName: tag }); },
    _els: els,
  };
  lastFakeDoc = doc;
  return doc;
}

function loadDisplayModule(fSortValue) {
  const region = extractDisplayBlock();
  const rowSrc = extractFunctionSource('function row(label, value) {', 'row()');
  const src = rowSrc + '\n' + region +
    '\nreturn { renderResults: renderResults, getRowDisplay: getRowDisplay, statusBadge: statusBadge, ' +
    'currencySymbol: currencySymbol, escapeAttr: escapeAttr, ' +
    'setLastResults: function(v) { lastResults = v; }, ' +
    'getCurrentSortedResults: function() { return currentSortedResults; } };';
  // eslint-disable-next-line no-new-func
  const factory = new Function('document', src);
  return factory(makeFakeDocument(fSortValue));
}

function loadViewMasterItemDetail() {
  const rowSrc = extractFunctionSource('function row(label, value) {', 'row()');
  const escapeAttrSrc = extractFunctionSource('function escapeAttr(s) {', 'escapeAttr()');
  const isCopyableSrc = extractFunctionSource('function isCopyableMasterItemLabel(label) {', 'isCopyableMasterItemLabel()');
  const fieldRowSrc = extractFunctionSource('function masterItemFieldRow(label, value) {', 'masterItemFieldRow()');
  const viewSrc = extractFunctionSource('function viewMasterItemDetail(r) {', 'viewMasterItemDetail()');
  const src = extractIstFormattingBlock() + rowSrc + '\n' + escapeAttrSrc + '\n' + isCopyableSrc + '\n' + fieldRowSrc + '\n' + viewSrc + '\nreturn viewMasterItemDetail;';
  // eslint-disable-next-line no-new-func
  const factory = new Function('document', 'showMsg', src);
  return factory;
}

function makeDetailFakeDocument() {
  const els = {
    'msg': makeElement(),
    'resultsCard': makeElement(),
    'detailCard': makeElement(),
    'detailTitle': makeElement(),
    'printDetailBtn': makeElement(),
    'copyGrnBtn': makeElement(),
    'copyPoBtn': makeElement(),
    'detailItemsSection': makeElement(),
    'detailHeader': makeElement(),
  };
  return {
    getElementById: function(id) {
      if (!els[id]) throw new Error('unexpected document.getElementById(' + id + ') in viewMasterItemDetail()');
      return els[id];
    },
    _els: els,
  };
}

function extractCsvBuildLogic() {
  const startMarker = "const headers = ['Source', 'GRN Number'";
  const endMarker = "}).join('\\r\\n');";
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'the CSV headers/dataRows block');
  const endIdx = indexOfOrThrow(html, endMarker, startIdx, 'the end of the CSV headers/dataRows block');
  const snippet = html.slice(startIdx, endIdx + endMarker.length);
  // eslint-disable-next-line no-new-func
  return new Function('currentSortedResults', 'getRowDisplay', 'csvEscape', extractIstFormattingBlock() + snippet + '\nreturn { headers: headers, dataRows: dataRows, csv: csv };');
}

// ---------------------------------------------------------------------
// The resultsBody click listener — dispatches View clicks to loadDetail()/
// viewAdjustmentDetail()/viewMasterItemDetail() depending on data-source.
// ---------------------------------------------------------------------
function extractResultsBodyClickHandler() {
  const startMarker = "document.getElementById('resultsBody').addEventListener('click', function(e) {";
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'the resultsBody click listener');
  const braceIdx = startIdx + startMarker.length - 1; // the marker itself ends in the opening '{'
  const body = sliceBalancedBraces(html, braceIdx);
  const src = 'return function(e) ' + body + ';';
  // eslint-disable-next-line no-new-func
  return new Function('currentSortedResults', 'loadDetail', 'printGrnDetails', 'viewAdjustmentDetail', 'viewMasterItemDetail', src);
}

// A minimal stand-in for the clicked element / event target: `closest(sel)`
// returns whatever this specific test wired up for that selector, exactly
// mirroring how the real handler only ever calls e.target.closest(...).
function makeClickEvent(closestBySelector) {
  return {
    stopPropagation: function() {},
    target: { closest: function(sel) { return closestBySelector[sel] || null; } },
  };
}

function makeButtonElement(attrs) {
  return { getAttribute: function(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; } };
}

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name: name, pass: true }); }
  catch (err) { results.push({ name: name, pass: false, error: err }); }
}

function grnRow(overrides) {
  return Object.assign({
    tabName: 'Chemicals', grnNo: 'GR/DD/1075', grnDate: '06/08/2026', poNo: 'PO-100',
    vendor: 'Acme Vendor', materialDescription: 'Widget', quantity: 5, unit: 'Nos',
    verificationStatus: 'Verified', verifiedBy: 'Alice', totalAmount: 250, currency: 'INR',
  }, overrides || {});
}

function adjRow(overrides) {
  return Object.assign({
    source: 'adjustment', adjId: 'ADJ-1', date: '01/09/2026', itemName: 'Resin', adjType: 'Restock',
    quantity: 12, grnNo: 'GR/DD/1075', status: 'Approved',
  }, overrides || {});
}

// The backend's real, generic {label, value} list — mirrors what
// buildMasterItemFieldList() actually returns, using the sheet's own
// header text as each label (never an internal field name).
function defaultMasterItemFields() {
  return [
    { label: 'ARN', value: 'ACH-RD-CH-0125' },
    { label: 'Zoho Item ID', value: 'ZID-500' },
    { label: 'Item Name', value: 'H0345 - Trans - 2 - Hexenal' },
    { label: 'Dept', value: 'R&D' },
    { label: 'Sub-Category', value: 'Chemicals' },
    { label: 'Zoho Category', value: 'Reagent' },
    { label: 'SKU', value: 'SKU-999' },
    { label: 'Brand', value: 'TCI' },
    { label: 'Unit', value: 'Gm' },
    { label: 'Purchase Price', value: 1500 },
    { label: 'Stock On Hand', value: 40 },
    { label: 'Reorder Level', value: 10 },
    { label: 'Warehouse / Location', value: 'Cold Storage' },
    { label: 'Preferred Vendor', value: 'Juniper Life Sciences' },
    { label: 'Status', value: 'Active' },
    { label: 'Product Type', value: 'Consumable' },
  ];
}

function masterRow(overrides) {
  return Object.assign({
    source: 'master', arn: 'ACH-RD-CH-0125', zohoItemId: 'ZID-500', itemName: 'H0345 - Trans - 2 - Hexenal',
    dept: 'R&D', subcategory: 'Chemicals', zohoCategory: 'Reagent', sku: 'SKU-999', brand: 'TCI',
    unit: 'Gm', purchasePrice: 1500, stockOnHand: 40, reorderLevel: 10, warehouse: 'Cold Storage',
    vendor: 'Juniper Life Sciences', status: 'Active', productType: 'Consumable',
    fields: defaultMasterItemFields(),
  }, overrides || {});
}

// ---------------------------------------------------------------------
// getRowDisplay()
// ---------------------------------------------------------------------
test('getRowDisplay(): a Master Item row uses the Master Item source badge and label', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(masterRow());
  assert.strictEqual(d.sourceLabel, 'Master Item');
  assert.ok(d.sourceHtml.indexOf('source-badge master') !== -1);
});

test('getRowDisplay(): a Master Item row never fabricates GRN No./GRN Date/PO No./Verified By — each is em-dash', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(masterRow());
  assert.strictEqual(d.grnNo, '—');
  assert.strictEqual(d.grnDate, '—');
  assert.strictEqual(d.poNo, '—');
  assert.strictEqual(d.verifiedBy, '—');
});

test('getRowDisplay(): a Master Item row surfaces its own genuine fields in the shared slots — Preferred Vendor, Stock On Hand, Status, Purchase Price, Dept', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(masterRow());
  assert.strictEqual(d.vendor, 'Juniper Life Sciences', 'Vendor slot must show Preferred Vendor');
  assert.strictEqual(d.quantity, 40, 'Quantity slot must show Stock On Hand');
  assert.strictEqual(d.statusHtml, 'Active', 'Status must be plain text, not the GRN verified/pending badge');
  assert.strictEqual(d.amountHtml, '1500', 'Amount slot must show Purchase Price, with no fabricated currency symbol');
  assert.strictEqual(d.category, 'R&D', 'Category slot must show Dept');
});

test('getRowDisplay(): Master Item identity (ARN/Item Name/Brand) appears in the Material Description slot, without claiming to be a GRN material', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(masterRow());
  assert.ok(d.materialDescription.indexOf('ACH-RD-CH-0125') !== -1);
  assert.ok(d.materialDescription.indexOf('H0345 - Trans - 2 - Hexenal') !== -1);
  assert.ok(d.materialDescription.indexOf('TCI') !== -1);
});

test('getRowDisplay(): a Master Item row with a blank ARN still renders correctly (no crash, ARN segment simply omitted)', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(masterRow({ arn: '' }));
  assert.ok(d.materialDescription.indexOf('H0345 - Trans - 2 - Hexenal') !== -1);
  assert.ok(d.materialDescription.indexOf('undefined') === -1);
});

// ---------------------------------------------------------------------
// renderResults()
// ---------------------------------------------------------------------
test('renderResults(): a Master Item row gets data-source="master" + data-index (like Adjustment), and only a View action (no Print)', function() {
  const mod = loadDisplayModule();
  mod.setLastResults([masterRow()]);
  mod.renderResults();
  const tr = lastFakeDoc._els.resultsBody.children[0];
  assert.strictEqual(tr.getAttribute('data-source'), 'master');
  assert.strictEqual(tr.getAttribute('data-index'), '0');
  assert.strictEqual(tr.getAttribute('data-tab'), null);
  assert.ok(tr.innerHTML.indexOf('action-view-btn') !== -1);
  assert.ok(tr.innerHTML.indexOf('action-print-btn') === -1, 'Master Item rows must never offer a GRN-shaped Print action');
  assert.ok(tr.innerHTML.indexOf('source-badge master') !== -1);
});

test('renderResults(): GRN + Adjustment + Master Item results for a related query all render as separate rows — no de-duplication across three sources', function() {
  const mod = loadDisplayModule();
  mod.setLastResults([grnRow(), adjRow(), masterRow()]);
  mod.renderResults();
  assert.strictEqual(lastFakeDoc._els.resultsBody.children.length, 3);
  const sources = lastFakeDoc._els.resultsBody.children.map(function(tr) { return tr.getAttribute('data-source'); });
  assert.deepStrictEqual(sources.sort(), ['adjustment', 'grn', 'master']);
});

// ---------------------------------------------------------------------
// viewMasterItemDetail()
// ---------------------------------------------------------------------
test('viewMasterItemDetail(): shows the detail card with a "Master Item Details" title, hides Print AND both copy buttons (no GRN No./PO No. concept at all)', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  viewMasterItemDetail(masterRow());

  assert.strictEqual(doc._els.detailTitle.textContent, 'Master Item Details');
  assert.strictEqual(doc._els.printDetailBtn.style.display, 'none');
  assert.strictEqual(doc._els.copyGrnBtn.style.display, 'none');
  assert.strictEqual(doc._els.copyPoBtn.style.display, 'none');
  assert.strictEqual(doc._els.detailItemsSection.style.display, 'none');
  assert.strictEqual(doc._els.detailCard.style.display, 'block');
  assert.strictEqual(doc._els.resultsCard.style.display, 'none');
});

test('viewMasterItemDetail(): renders EVERY {label, value} pair from r.fields, using the field\'s own label as-is (the real sheet header text, not a hardcoded name)', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  const r = masterRow();
  viewMasterItemDetail(r);

  const headerHtml = doc._els.detailHeader.innerHTML;
  r.fields.forEach(function(f) {
    assert.ok(headerHtml.indexOf(f.label) !== -1, 'expected detailHeader to contain the label "' + f.label + '"');
    assert.ok(headerHtml.indexOf(String(f.value)) !== -1, 'expected detailHeader to contain the value "' + f.value + '"');
  });
});

test('viewMasterItemDetail(): uses the ACTUAL spreadsheet header text as the label, not an internal field name -- proven with an unusual/non-standard header', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  viewMasterItemDetail(masterRow({ fields: [{ label: 'Vendor Part Number (Legacy)', value: 'VP-77-XYZ' }] }));
  const headerHtml = doc._els.detailHeader.innerHTML;
  assert.ok(headerHtml.indexOf('Vendor Part Number (Legacy)') !== -1, 'must render whatever real header text the backend sent, even one this frontend has never hardcoded');
  assert.ok(headerHtml.indexOf('VP-77-XYZ') !== -1);
});

test('viewMasterItemDetail(): a field beyond column P (e.g. a real "Date Added" column) is displayed exactly like any other field, with no frontend change required', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  viewMasterItemDetail(masterRow({ fields: defaultMasterItemFields().concat([{ label: 'Date Added', value: '2026-01-15' }]) }));
  const headerHtml = doc._els.detailHeader.innerHTML;
  assert.ok(headerHtml.indexOf('Date Added') !== -1);
  assert.ok(headerHtml.indexOf('2026-01-15') !== -1);
});

test('viewMasterItemDetail(): a Master Item result with NO fields at all (defensive/blank case) renders without throwing, showing just the source badge', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  assert.doesNotThrow(function() { viewMasterItemDetail(masterRow({ fields: [] })); });
  assert.ok(doc._els.detailHeader.innerHTML.indexOf('source-badge master') !== -1);
});

test('viewMasterItemDetail(): never fabricates a GRN-only field (GRN Date/Invoice/PO No./GRN Vendor/Verified By) that isn\'t genuinely present in r.fields', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  viewMasterItemDetail(masterRow());
  const headerHtml = doc._els.detailHeader.innerHTML;
  assert.ok(headerHtml.indexOf('status-badge') === -1, 'must not reuse the GRN verified/pending badge');
  ['GRN Date', 'Invoice', 'PO No.', 'GRN Vendor', 'Verified By'].forEach(function(label) {
    assert.ok(headerHtml.indexOf(label) === -1, 'must not fabricate the GRN-only label "' + label + '" when it is not a real column');
  });
});

test('viewMasterItemDetail(): a genuinely-present "GRN No." column (a hypothetical future Master Item List field) IS shown -- fields are never blocklisted by name, only shown when actually present', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  viewMasterItemDetail(masterRow({ fields: [{ label: 'GRN No.', value: 'GR/DD/9999' }] }));
  const headerHtml = doc._els.detailHeader.innerHTML;
  assert.ok(headerHtml.indexOf('GRN No.') !== -1);
  assert.ok(headerHtml.indexOf('GR/DD/9999') !== -1);
});

test('viewMasterItemDetail(): ARN/SKU/Zoho Item ID fields each get a Copy button; other fields do not', function() {
  const factory = loadViewMasterItemDetail();
  const doc = makeDetailFakeDocument();
  const viewMasterItemDetail = factory(doc, function() {});
  viewMasterItemDetail(masterRow());
  const headerHtml = doc._els.detailHeader.innerHTML;
  const copyBtnCount = (headerHtml.match(/copy-btn/g) || []).length;
  assert.strictEqual(copyBtnCount, 3, 'expected exactly 3 copy buttons — one each for ARN, SKU, Zoho Item ID');
  assert.ok(headerHtml.indexOf('data-copy="ACH-RD-CH-0125"') !== -1);
  assert.ok(headerHtml.indexOf('data-copy="SKU-999"') !== -1);
  assert.ok(headerHtml.indexOf('data-copy="ZID-500"') !== -1);
});

test('viewMasterItemDetail(): performs NO network/Sheets request at all -- reuses r.fields already returned by the search, exactly like viewAdjustmentDetail()', function() {
  const viewSrc = extractFunctionSource('function viewMasterItemDetail(r) {', 'viewMasterItemDetail()');
  assert.ok(viewSrc.indexOf('jsonp(') === -1, 'viewMasterItemDetail() must never call jsonp() -- the row is already fully available from the search result');
  assert.ok(viewSrc.indexOf('fetch(') === -1);
});

// ---------------------------------------------------------------------
// exportResultsToExcel()'s CSV building
// ---------------------------------------------------------------------
test('CSV export: a Master Item row exports "Master Item" as its Source, Stock On Hand as Quantity, Preferred Vendor as Vendor, Dept as Category, em-dashes elsewhere', function() {
  const build = extractCsvBuildLogic();
  const mod = loadDisplayModule();
  const out = build([masterRow()], mod.getRowDisplay, function(v) { return v == null ? '' : String(v); });
  const row = out.dataRows[0];
  assert.strictEqual(row[0], 'Master Item');
  assert.strictEqual(row[1], '—', 'GRN Number column');
  assert.strictEqual(row[2], '—', 'GRN Date column');
  assert.strictEqual(row[3], '—', 'PO Number column');
  assert.strictEqual(row[4], 'Juniper Life Sciences', 'Vendor column (Preferred Vendor)');
  assert.strictEqual(row[6], 40, 'Quantity column (Stock On Hand)');
  assert.strictEqual(row[8], 'Active', 'Verification Status column (plain Status)');
  assert.strictEqual(row[9], '—', 'Verified By column');
  assert.strictEqual(row[10], 1500, 'Total Amount column (Purchase Price)');
  assert.strictEqual(row[12], 'R&D', 'Category column (Dept)');
});

test('CSV export: GRN + Adjustment + Master Item results export as three separate rows, never merged', function() {
  const build = extractCsvBuildLogic();
  const mod = loadDisplayModule();
  const out = build([grnRow(), adjRow(), masterRow()], mod.getRowDisplay, function(v) { return v == null ? '' : String(v); });
  assert.strictEqual(out.dataRows.length, 3);
  assert.deepStrictEqual(out.dataRows.map(function(r) { return r[0]; }), ['GRN Record', 'Inventory Adjustment', 'Master Item']);
});

test('CSV export: existing GRN-only export behavior is unaffected by the Master Item addition (Quantity column still reads the GRN\'s own quantity field via d.quantity)', function() {
  const build = extractCsvBuildLogic();
  const mod = loadDisplayModule();
  const out = build([grnRow({ quantity: 7 })], mod.getRowDisplay, function(v) { return v == null ? '' : String(v); });
  assert.strictEqual(out.dataRows[0][6], 7);
});

// ---------------------------------------------------------------------
// resultsBody click routing
// ---------------------------------------------------------------------
test('Clicking "View" on a Master Item row opens the Master Item detail view (routes to viewMasterItemDetail, not loadDetail/viewAdjustmentDetail)', function() {
  const factory = extractResultsBodyClickHandler();
  const sorted = [masterRow()];
  const calls = { loadDetail: 0, printGrnDetails: 0, viewAdjustmentDetail: 0, viewMasterItemDetail: 0 };
  const handler = factory(
    sorted,
    function() { calls.loadDetail++; },
    function() { calls.printGrnDetails++; },
    function() { calls.viewAdjustmentDetail++; },
    function(r) { calls.viewMasterItemDetail++; assert.strictEqual(r, sorted[0]); }
  );
  const viewBtn = makeButtonElement({ 'data-source': 'master', 'data-index': '0' });
  handler(makeClickEvent({ '.action-print-btn': null, '.action-view-btn': viewBtn }));
  assert.strictEqual(calls.viewMasterItemDetail, 1);
  assert.strictEqual(calls.loadDetail, 0);
  assert.strictEqual(calls.viewAdjustmentDetail, 0);
  assert.strictEqual(calls.printGrnDetails, 0);
});

test('Clicking anywhere on a Master Item result ROW (not just the View button) also opens the Master Item detail view', function() {
  const factory = extractResultsBodyClickHandler();
  const sorted = [masterRow()];
  let masterCalls = 0;
  const handler = factory(
    sorted,
    function() { throw new Error('loadDetail should not be called'); },
    function() { throw new Error('printGrnDetails should not be called'); },
    function() { throw new Error('viewAdjustmentDetail should not be called'); },
    function() { masterCalls++; }
  );
  const tr = makeButtonElement({ 'data-source': 'master', 'data-index': '0' });
  handler(makeClickEvent({ '.action-print-btn': null, '.action-view-btn': null, 'tr.result-row': tr }));
  assert.strictEqual(masterCalls, 1);
});

test('GRN and Adjustment row click routing is unaffected by the Master Item addition', function() {
  const factory = extractResultsBodyClickHandler();
  const sorted = [adjRow()];
  const calls = { loadDetail: 0, viewAdjustmentDetail: 0, viewMasterItemDetail: 0 };
  const handlerAdj = factory(
    sorted,
    function() { calls.loadDetail++; },
    function() {},
    function() { calls.viewAdjustmentDetail++; },
    function() { calls.viewMasterItemDetail++; }
  );
  const viewBtnAdj = makeButtonElement({ 'data-source': 'adjustment', 'data-index': '0' });
  handlerAdj(makeClickEvent({ '.action-print-btn': null, '.action-view-btn': viewBtnAdj }));
  assert.strictEqual(calls.viewAdjustmentDetail, 1);
  assert.strictEqual(calls.viewMasterItemDetail, 0);

  const grnCalls = { loadDetail: 0 };
  const handlerGrn = factory(
    [],
    function(tab, grn) { grnCalls.loadDetail++; assert.strictEqual(tab, 'Chemicals'); assert.strictEqual(grn, 'GR/DD/1075'); },
    function() {},
    function() { throw new Error('viewAdjustmentDetail should not be called for a GRN row'); },
    function() { throw new Error('viewMasterItemDetail should not be called for a GRN row'); }
  );
  const viewBtnGrn = makeButtonElement({ 'data-tab': 'Chemicals', 'data-grn': 'GR/DD/1075' });
  handlerGrn(makeClickEvent({ '.action-print-btn': null, '.action-view-btn': viewBtnGrn }));
  assert.strictEqual(grnCalls.loadDetail, 1);
});

results.forEach(function(r) {
  if (r.pass) {
    console.log('  PASS - ' + r.name);
  } else {
    console.log('  FAIL - ' + r.name);
    console.log('         ' + (r.error && r.error.message ? r.error.message : r.error));
  }
});
const passCount = results.filter(function(r) { return r.pass; }).length;
console.log('grn-search-master-item-display.test.js: ' + passCount + '/' + results.length + ' passed');

if (passCount !== results.length) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nPASSED');
  process.exit(0);
}
