// grn-search-filename.test.js
//
// Focused test for the GRN-No.-based download filename added to
// frontend/grn-search.html: sanitizeFilename(), the single-vs-multi-result
// branch in exportResultsToExcel(), and the document.title swap around
// window.print() in printGrnDetails().
//
// There is no frontend test framework in this repo (no package.json, no
// jsdom/jest) and grn-search.html's <script> is a single large block with
// many real DOM/network dependencies. Instead, this test extracts the
// EXACT relevant snippets from the live file by their known surrounding
// text (never a hand-copied duplicate) so a future regression to the real
// source is what actually gets caught here.
//
// Run:
//   cd frontend
//   node tests/grn-search-filename.test.js

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

// ---------------------------------------------------------------------
// sanitizeFilename() — extracted whole, as a real callable function.
// ---------------------------------------------------------------------
function extractSanitizeFilename() {
  const startMarker = 'function sanitizeFilename(name) {';
  const endMarker = "\n}\n\n// Exports exactly currentSortedResults";
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'sanitizeFilename()');
  const endIdx = indexOfOrThrow(html, endMarker, startIdx, 'the end of sanitizeFilename()');
  const source = html.slice(startIdx, endIdx + 2); // include the closing "\n}"
  // eslint-disable-next-line no-new-func
  return new Function(source + '\nreturn sanitizeFilename;')();
}

// ---------------------------------------------------------------------
// The filename-selection block inside exportResultsToExcel(): from the
// "let filename = ..." line through "a.download = filename;" — run in
// isolation against a fake currentSortedResults + a.download target.
// ---------------------------------------------------------------------
function extractExportFilenameLogic() {
  const startMarker = "let filename = 'grn-search-results-' + Date.now() + '.csv';";
  const endMarker = 'a.download = filename;';
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'the export filename-selection logic');
  const endIdx = indexOfOrThrow(html, endMarker, startIdx, 'the end of the export filename-selection logic');
  const snippet = html.slice(startIdx, endIdx + endMarker.length);
  // eslint-disable-next-line no-new-func
  return new Function('currentSortedResults', 'sanitizeFilename', 'a', 'Date', snippet + '\nreturn filename;');
}

// ---------------------------------------------------------------------
// The document.title swap block inside printGrnDetails(): from
// "const originalTitle = document.title;" through "window.print();".
// ---------------------------------------------------------------------
function extractPrintTitleLogic() {
  const startMarker = 'const originalTitle = document.title;';
  const endMarker = 'window.print();';
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'the print document.title swap');
  const endIdx = indexOfOrThrow(html, endMarker, startIdx, 'the end of the print document.title swap (window.print())');
  const snippet = html.slice(startIdx, endIdx + endMarker.length);
  // eslint-disable-next-line no-new-func
  return new Function('document', 'window', 'sanitizeFilename', 'grnNo', snippet);
}

function makeFakeWindow() {
  const listeners = {};
  return {
    addEventListener: function(evt, fn) { listeners[evt] = listeners[evt] || []; listeners[evt].push(fn); },
    removeEventListener: function(evt, fn) {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter(function(f) { return f !== fn; });
    },
    print: function() {},
    _fireAfterPrint: function() {
      (listeners.afterprint || []).slice().forEach(function(fn) { fn(); });
    },
  };
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name: name, pass: true });
  } catch (err) {
    results.push({ name: name, pass: false, error: err });
  }
}

const sanitizeFilename = extractSanitizeFilename();
const computeExportFilename = extractExportFilenameLogic();
const runPrintTitleLogic = extractPrintTitleLogic();

test('GR/DD/1075 sanitizes to GR_DD_1075', function() {
  assert.strictEqual(sanitizeFilename('GR/DD/1075'), 'GR_DD_1075');
});

test('all other filename-invalid characters (\\ : * ? " < > |) are replaced', function() {
  assert.strictEqual(sanitizeFilename('A\\B:C*D?E"F<G>H|I'), 'A_B_C_D_E_F_G_H_I');
});

test('blank/whitespace-only GRN No. sanitizes to empty string', function() {
  assert.strictEqual(sanitizeFilename(''), '');
  assert.strictEqual(sanitizeFilename('   '), '');
  assert.strictEqual(sanitizeFilename(null), '');
  assert.strictEqual(sanitizeFilename(undefined), '');
});

test('single-result export uses the sanitized GRN No. as the filename', function() {
  const a = {};
  const filename = computeExportFilename([{ grnNo: 'GR/DD/1075' }], sanitizeFilename, a, Date);
  assert.strictEqual(filename, 'GR_DD_1075.csv');
});

test('multi-result export keeps the generic timestamped filename', function() {
  const a = {};
  const fixedDate = { now: function() { return 1234567890; } };
  const filename = computeExportFilename(
    [{ grnNo: 'GR/DD/1075' }, { grnNo: 'GR/DD/1076' }],
    sanitizeFilename,
    a,
    fixedDate
  );
  assert.strictEqual(filename, 'grn-search-results-1234567890.csv');
});

test('single-result export with a blank GRN No. falls back to the generic filename', function() {
  const a = {};
  const fixedDate = { now: function() { return 42; } };
  const filename = computeExportFilename([{ grnNo: '' }], sanitizeFilename, a, fixedDate);
  assert.strictEqual(filename, 'grn-search-results-42.csv');
});

test('Print/Save-as-PDF: document.title is swapped to the sanitized GRN No. before window.print()', function() {
  const document_ = { title: 'Achira Inventory - Search & History' };
  const window_ = makeFakeWindow();
  runPrintTitleLogic(document_, window_, sanitizeFilename, 'GR/DD/1075');
  assert.strictEqual(document_.title, 'GR_DD_1075');
});

test('Print/Save-as-PDF: document.title is restored to the original after the "afterprint" event fires', function() {
  const document_ = { title: 'Achira Inventory - Search & History' };
  const window_ = makeFakeWindow();
  runPrintTitleLogic(document_, window_, sanitizeFilename, 'GR/DD/1075');
  assert.strictEqual(document_.title, 'GR_DD_1075');
  window_._fireAfterPrint();
  assert.strictEqual(document_.title, 'Achira Inventory - Search & History');
});

test('Print/Save-as-PDF: a blank GRN No. leaves document.title untouched (no swap, nothing to restore)', function() {
  const document_ = { title: 'Achira Inventory - Search & History' };
  const window_ = makeFakeWindow();
  runPrintTitleLogic(document_, window_, sanitizeFilename, '');
  assert.strictEqual(document_.title, 'Achira Inventory - Search & History');
  window_._fireAfterPrint();
  assert.strictEqual(document_.title, 'Achira Inventory - Search & History');
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
console.log('grn-search-filename.test.js: ' + passCount + '/' + results.length + ' passed');

if (passCount !== results.length) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nPASSED');
  process.exit(0);
}
