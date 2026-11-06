// grn-search-two-source-display.test.js
//
// Regression tests for the frontend half of the two-source GRN Search
// feature (backend covered separately in
// backend/tests/grn-search-adjustment-log.test.js): a result can now be a
// GRN record OR an Inventory Adjustment Log entry (tagged r.source ===
// 'adjustment'), and the page must render, sort, export and offer a
// detail view for both — without ever dressing an Adjustment row up as a
// complete GRN record, and without disturbing existing GRN-only
// rendering/print/CSV/filename behavior.
//
// There is no frontend test framework in this repo (no package.json, no
// jsdom/jest) and grn-search.html's <script> is a single large block with
// real DOM/network dependencies. This test extracts the EXACT relevant
// snippets from the live file by their known surrounding text (never a
// hand-copied duplicate), same convention as the other frontend tests in
// this directory.
//
// Run:
//   cd frontend
//   node tests/grn-search-two-source-display.test.js

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

// ---------------------------------------------------------------------
// statusBadge() .. renderResults() — a genuinely contiguous region of the
// real file (verified by the two anchors below), pulled as one block so
// renderResults() has every helper/module-level variable it actually
// closes over (getRowDisplay, escapeAttr, currencySymbol,
// SORT_COMPARATORS, grnDateSortValue, lastResults, currentSortedResults).
// ---------------------------------------------------------------------
function extractDisplayBlock() {
  const startMarker = 'function statusBadge(status) {';
  const endMarker = "document.getElementById('f-sort').addEventListener('change', renderResults);";
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'statusBadge() (start of the display block)');
  const endIdx = indexOfOrThrow(html, endMarker, startIdx, "the f-sort change listener (end anchor of the display block, right after renderResults() closes)");
  return html.slice(startIdx, endIdx);
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

// ---------------------------------------------------------------------
// viewAdjustmentDetail() + the row() it calls — extracted whole, run
// against a minimal fake document covering every element id it touches.
// ---------------------------------------------------------------------
function loadViewAdjustmentDetail() {
  const rowSrc = extractFunctionSource('function row(label, value) {', 'row()');
  const viewSrc = extractFunctionSource('function viewAdjustmentDetail(r) {', 'viewAdjustmentDetail()');
  const src = extractIstFormattingBlock() + rowSrc + '\n' + viewSrc + '\nreturn viewAdjustmentDetail;';
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
      if (!els[id]) throw new Error('unexpected document.getElementById(' + id + ') in viewAdjustmentDetail()');
      return els[id];
    },
    _els: els,
  };
}

// ---------------------------------------------------------------------
// The CSV headers/dataRows-building block inside exportResultsToExcel().
// ---------------------------------------------------------------------
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
// Test scaffolding
// ---------------------------------------------------------------------
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
    source: 'adjustment', adjId: 'ADJ-1', date: '01/09/2026', time: '10:15', arn: 'ACH-RD-AB-001',
    itemName: 'Resin', dept: 'R&D', unit: 'Kg', warehouse: 'WH1', adjType: 'Restock', quantity: 12,
    effect: 'Increase', grnNo: 'GR/DD/1075', reason: 'Stock correction', issuedTo: 'Bob',
    project: 'Proj X', managerName: 'Carol', status: 'Approved', approvedBy: 'Dave',
    timestamp: '2026-09-01T10:15:00Z', expiryDate: '01/01/2027',
  }, overrides || {});
}

// ---------------------------------------------------------------------
// getRowDisplay()
// ---------------------------------------------------------------------
test('getRowDisplay(): a GRN row maps straight through with the GRN source badge', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(grnRow());
  assert.strictEqual(d.sourceLabel, 'GRN Record');
  assert.ok(d.sourceHtml.indexOf('source-badge grn') !== -1);
  assert.strictEqual(d.grnNo, 'GR/DD/1075');
  assert.strictEqual(d.poNo, 'PO-100');
  assert.strictEqual(d.vendor, 'Acme Vendor');
  assert.strictEqual(d.category, 'Chemicals');
  assert.ok(d.statusHtml.indexOf('status-badge') !== -1, 'GRN status must still use the existing verified/pending badge');
});

test('getRowDisplay(): an Adjustment row never fabricates PO No./Vendor/Verified By/Total Amount/Category — each is em-dash', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(adjRow());
  assert.strictEqual(d.sourceLabel, 'Inventory Adjustment');
  assert.ok(d.sourceHtml.indexOf('source-badge adjustment') !== -1);
  assert.strictEqual(d.poNo, '—');
  assert.strictEqual(d.vendor, '—');
  assert.strictEqual(d.verifiedBy, '—');
  assert.strictEqual(d.amountHtml, '—');
  assert.strictEqual(d.category, '—');
});

test('getRowDisplay(): an Adjustment row surfaces its own real fields — GRN No., date, item/type, quantity, status', function() {
  const mod = loadDisplayModule();
  const d = mod.getRowDisplay(adjRow());
  assert.strictEqual(d.grnNo, 'GR/DD/1075');
  assert.strictEqual(d.grnDate, '01-09-2026, 03:45 PM'); // display-formatted IST from the Timestamp (raw r.date stays '01/09/2026')
  assert.strictEqual(d.materialDescription, '[Restock] Resin');
  assert.strictEqual(d.quantity, 12);
  assert.strictEqual(d.statusHtml, 'Approved', 'Adjustment status is shown as plain text, not the GRN verified/pending badge');
  assert.strictEqual(d.statusText, 'Approved');
});

// ---------------------------------------------------------------------
// renderResults()
// ---------------------------------------------------------------------
test('renderResults(): a GRN row keeps its existing data-tab/data-grn attributes and gets a View+Print action pair', function() {
  const mod = loadDisplayModule();
  mod.setLastResults([grnRow()]);
  mod.renderResults();
  const tr = lastFakeDoc._els.resultsBody.children[0];
  assert.strictEqual(tr.getAttribute('data-source'), 'grn');
  assert.strictEqual(tr.getAttribute('data-tab'), 'Chemicals');
  assert.strictEqual(tr.getAttribute('data-grn'), 'GR/DD/1075');
  assert.ok(tr.innerHTML.indexOf('action-view-btn') !== -1);
  assert.ok(tr.innerHTML.indexOf('action-print-btn') !== -1, 'GRN rows must keep the existing Print action');
  assert.ok(tr.innerHTML.indexOf('source-badge grn') !== -1);
});

test('renderResults(): an Adjustment row gets data-source="adjustment" + data-index instead of data-tab/data-grn, and only a View action (no Print)', function() {
  const mod = loadDisplayModule();
  mod.setLastResults([adjRow()]);
  mod.renderResults();
  const tr = lastFakeDoc._els.resultsBody.children[0];
  assert.strictEqual(tr.getAttribute('data-source'), 'adjustment');
  assert.strictEqual(tr.getAttribute('data-index'), '0');
  assert.strictEqual(tr.getAttribute('data-tab'), null, 'Adjustment rows must not carry a GRN tab attribute');
  assert.ok(tr.innerHTML.indexOf('action-view-btn') !== -1);
  assert.ok(tr.innerHTML.indexOf('action-print-btn') === -1, 'Adjustment rows must never offer a GRN-shaped Print action');
  assert.ok(tr.innerHTML.indexOf('source-badge adjustment') !== -1);
});

test('renderResults(): GRN and Adjustment rows for the SAME GRN No. both render as separate rows — no de-duplication', function() {
  const mod = loadDisplayModule();
  mod.setLastResults([grnRow(), adjRow(), adjRow({ adjId: 'ADJ-2' })]);
  mod.renderResults();
  assert.strictEqual(lastFakeDoc._els.resultsBody.children.length, 3);
});

test('renderResults(): empty results use colspan="12" (Source column added to the empty-state row)', function() {
  const mod = loadDisplayModule();
  mod.setLastResults([]);
  mod.renderResults();
  assert.ok(lastFakeDoc._els.resultsBody.innerHTML.indexOf('colspan="12"') !== -1);
});

// ---------------------------------------------------------------------
// viewAdjustmentDetail()
// ---------------------------------------------------------------------
test('viewAdjustmentDetail(): shows the detail card with an "Inventory Adjustment Details" title, hides Print/Copy PO/items section', function() {
  const factory = loadViewAdjustmentDetail();
  const doc = makeDetailFakeDocument();
  const showMsgCalls = [];
  const viewAdjustmentDetail = factory(doc, function(text, type) { showMsgCalls.push({ text: text, type: type }); });
  viewAdjustmentDetail(adjRow());

  assert.strictEqual(doc._els.detailTitle.textContent, 'Inventory Adjustment Details');
  assert.strictEqual(doc._els.printDetailBtn.style.display, 'none');
  assert.strictEqual(doc._els.copyPoBtn.style.display, 'none');
  assert.strictEqual(doc._els.detailItemsSection.style.display, 'none', 'no GRN-shaped line-item table applies to an Adjustment row');
  assert.strictEqual(doc._els.detailCard.style.display, 'block');
  assert.strictEqual(doc._els.resultsCard.style.display, 'none');
});

test('viewAdjustmentDetail(): populates detailHeader with the Adjustment Log\'s own fields, and Copy GRN Number still works', function() {
  const factory = loadViewAdjustmentDetail();
  const doc = makeDetailFakeDocument();
  const viewAdjustmentDetail = factory(doc, function() {});
  viewAdjustmentDetail(adjRow());

  const headerHtml = doc._els.detailHeader.innerHTML;
  ['ADJ-1', 'ACH-RD-AB-001', 'Resin', 'Restock', 'Stock correction', 'Bob', 'Carol', 'Approved', 'Dave'].forEach(function(expected) {
    assert.ok(headerHtml.indexOf(expected) !== -1, 'expected detailHeader to contain "' + expected + '"');
  });
  assert.strictEqual(doc._els.copyGrnBtn.getAttribute('data-copy'), 'GR/DD/1075');
});

test('viewAdjustmentDetail(): never renders GRN-only labels like "PO No." value or a verification status badge class', function() {
  const factory = loadViewAdjustmentDetail();
  const doc = makeDetailFakeDocument();
  const viewAdjustmentDetail = factory(doc, function() {});
  viewAdjustmentDetail(adjRow());
  assert.ok(doc._els.detailHeader.innerHTML.indexOf('status-badge') === -1, 'Adjustment detail view must not reuse the GRN verified/pending badge');
});

// ---------------------------------------------------------------------
// exportResultsToExcel()'s CSV building
// ---------------------------------------------------------------------
test('CSV export: header row gains a leading "Source" column, existing GRN columns unchanged', function() {
  const build = extractCsvBuildLogic();
  const mod = loadDisplayModule();
  const out = build([grnRow()], mod.getRowDisplay, function(v) { return v == null ? '' : String(v); });
  assert.deepStrictEqual(out.headers, ['Source', 'GRN Number', 'GRN Date', 'PO Number', 'Vendor', 'Material Description', 'Quantity', 'Unit', 'Verification Status', 'Verified By', 'Total Amount', 'Currency', 'Category']);
});

test('CSV export: a GRN row exports "GRN Record" as its Source and every existing field unchanged', function() {
  const build = extractCsvBuildLogic();
  const mod = loadDisplayModule();
  const out = build([grnRow()], mod.getRowDisplay, function(v) { return v == null ? '' : String(v); });
  // GRN Date: raw '06/08/2026' exports as "DD-MM-YYYY, 12:00 AM", wrapped ="..." so
  // Excel keeps it as text instead of re-guessing day/month by locale.
  assert.deepStrictEqual(out.dataRows[0], ['GRN Record', 'GR/DD/1075', '="06-08-2026, 12:00 AM"', 'PO-100', 'Acme Vendor', 'Widget', 5, 'Nos', 'Verified', 'Alice', 250, 'INR', 'Chemicals']);
});

test('CSV export: an Adjustment row exports "Inventory Adjustment" as its Source, with em-dashes for the fields it has none of', function() {
  const build = extractCsvBuildLogic();
  const mod = loadDisplayModule();
  const out = build([adjRow()], mod.getRowDisplay, function(v) { return v == null ? '' : String(v); });
  const row = out.dataRows[0];
  assert.strictEqual(row[0], 'Inventory Adjustment');
  assert.strictEqual(row[1], 'GR/DD/1075');
  assert.strictEqual(row[3], '—', 'PO Number column');
  assert.strictEqual(row[4], '—', 'Vendor column');
  assert.strictEqual(row[5], '[Restock] Resin');
  assert.strictEqual(row[9], '—', 'Verified By column');
  assert.strictEqual(row[12], '—', 'Category column');
});

test('CSV export: mixed GRN + Adjustment results export as separate rows, never merged', function() {
  const build = extractCsvBuildLogic();
  const mod = loadDisplayModule();
  const out = build([grnRow(), adjRow()], mod.getRowDisplay, function(v) { return v == null ? '' : String(v); });
  assert.strictEqual(out.dataRows.length, 2);
  assert.strictEqual(out.dataRows[0][0], 'GRN Record');
  assert.strictEqual(out.dataRows[1][0], 'Inventory Adjustment');
});

// ---------------------------------------------------------------------
results.forEach(function(r) {
  if (r.pass) {
    console.log('  PASS - ' + r.name);
  } else {
    console.log('  FAIL - ' + r.name);
    console.log('         ' + (r.error && r.error.message ? r.error.message : r.error));
  }
});
const passCount = results.filter(function(r) { return r.pass; }).length;
console.log('grn-search-two-source-display.test.js: ' + passCount + '/' + results.length + ' passed');

if (passCount !== results.length) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nPASSED');
  process.exit(0);
}
