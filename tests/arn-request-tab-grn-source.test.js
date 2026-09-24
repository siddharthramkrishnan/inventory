// arn-request-tab-grn-source.test.js
//
// Focused test for the ARN "Procurement Request No. → Tab" dropdown in
// frontend/arn-assign.html. Requirement: it must show the same GRN
// Category/Tab options as GRN Entry's own Tab dropdown (loadTabs() in
// grn-entry.html), sourced from the existing 'grntabs' backend action
// (getGrnCategoryTabs() in Code.gs) — not a separate hardcoded list like
// the old "Common / R&D / Platform / MFG / Admin" options.
//
// Same "no test framework installed" / marker-extraction convention as
// tests/arn-approver-employee-source.test.js — loads the real
// loadRequestTabs() source from the live file and runs it against a
// minimal fake document/window, simulating the JSONP response.
//
// Run:
//   cd frontend
//   node tests/arn-request-tab-grn-source.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ARN_ASSIGN_PATH = path.join(__dirname, '..', 'arn-assign.html');
const html = fs.readFileSync(ARN_ASSIGN_PATH, 'utf8');

function indexOfOrThrow(haystack, marker, fromIndex, label) {
  const idx = haystack.indexOf(marker, fromIndex || 0);
  assert.ok(idx !== -1, 'Could not find ' + label + ' ("' + marker + '") in arn-assign.html — has it been removed or reworded?');
  return idx;
}

function extractLoadRequestTabs() {
  const startMarker = 'function loadRequestTabs() {';
  const invocationMarker = 'loadRequestTabs();';
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'loadRequestTabs()');
  const invocationIdx = indexOfOrThrow(html, invocationMarker, startIdx, 'the end of loadRequestTabs() (its own immediate invocation)');
  const source = html.slice(startIdx, invocationIdx).replace(/\s+$/, '');
  // eslint-disable-next-line no-new-func
  const build = new Function('document', 'window', 'CONFIG', source + '\nreturn loadRequestTabs;');
  return { source: source, build: build };
}

function makeFakeSelect() {
  return { innerHTML: '' };
}

function makeFakeDocument(selectEl) {
  const createdScripts = [];
  return {
    _createdScripts: createdScripts,
    getElementById: function(id) {
      if (id === 'f-req-tab') return selectEl;
      return null;
    },
    createElement: function(tag) {
      const el = { tag: tag, remove: function() {} };
      createdScripts.push(el);
      return el;
    },
    body: { appendChild: function() {} },
  };
}

function makeFakeWindow() {
  return {};
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

const { source: loadRequestTabsSource, build: buildLoadRequestTabs } = extractLoadRequestTabs();

function loadRequestTabs(doc, win, config) {
  buildLoadRequestTabs(doc, win, config)();
}

test('loadRequestTabs() contains no hardcoded "Common"/"R&D"/"Platform"/"MFG"/"Admin" option list', function() {
  ['Common', 'R&D', 'Platform', 'MFG', 'Admin'].forEach(function(stale) {
    assert.ok(loadRequestTabsSource.indexOf('"' + stale + '"') === -1 && loadRequestTabsSource.indexOf(">" + stale + "<") === -1,
      'expected loadRequestTabs() to contain no trace of the old hardcoded "' + stale + '" option, got:\n' + loadRequestTabsSource);
  });
});

test('the old hardcoded Tab <option> elements no longer exist anywhere in arn-assign.html', function() {
  assert.ok(html.indexOf('<option value="Common">Common</option>') === -1, 'expected the old hardcoded "Common" option to be removed');
  assert.ok(html.indexOf('<option value="R&D">R &amp; D</option>') === -1, 'expected the old hardcoded "R&D" option to be removed');
  assert.ok(html.indexOf('<option value="Platform">Platform</option>') === -1, 'expected the old hardcoded "Platform" option to be removed');
  assert.ok(html.indexOf('<option value="MFG">MFG</option>') === -1, 'expected the old hardcoded "MFG" option to be removed');
  assert.ok(html.indexOf('<option value="Admin">Admin</option>') === -1, 'expected the old hardcoded "Admin" option to be removed');
});

test('loadRequestTabs() requests the SAME existing "grntabs" backend action GRN Entry\'s loadTabs() uses', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  const win = makeFakeWindow();
  loadRequestTabs(doc, win, { WEBAPP_URL: 'https://example.com/exec' });

  assert.strictEqual(doc._createdScripts.length, 1, 'expected exactly one <script> tag created');
  assert.ok(doc._createdScripts[0].src.indexOf('action=grntabs') > -1, 'expected the request URL to use action=grntabs, got: ' + doc._createdScripts[0].src);
});

test('shows a "Loading…" placeholder immediately, before the response arrives', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  loadRequestTabs(doc, makeFakeWindow(), { WEBAPP_URL: 'https://example.com/exec' });
  assert.ok(sel.innerHTML.indexOf('Loading') > -1, 'expected a loading placeholder, got: ' + sel.innerHTML);
});

test('on a successful "grntabs" response, populates the dropdown with EXACTLY the returned GRN category/tab names', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  const win = makeFakeWindow();
  loadRequestTabs(doc, win, { WEBAPP_URL: 'https://example.com/exec' });

  const cbKey = Object.keys(win)[0];
  assert.ok(cbKey, 'expected loadRequestTabs() to have registered a JSONP callback on window');

  // Same shape getGrnCategoryTabs()/GRN Entry's Tab dropdown returns —
  // real example GRN category/tab names, not the old Procurement-sheet
  // tab names.
  const grnTabs = [
    'D&D_GR_All', 'Common_GR_ALL', 'MFG_GR_Raw Material', 'MFG_GR_Capital Goods',
    'MFG_GR_Services', 'MFG_GR_Biomaterial', 'MFG_GR_Engineering material',
    'MFG_GR_Miscellaneous Material', 'Sheet13', 'MFG_GR_Packing Material',
  ];
  win[cbKey]({ status: 'success', tabs: grnTabs });

  grnTabs.forEach(function(tab) {
    assert.ok(sel.innerHTML.indexOf('value="' + tab + '"') > -1, 'expected GRN tab "' + tab + '" to appear as an option, got:\n' + sel.innerHTML);
  });
  assert.ok(sel.innerHTML.indexOf('>Common<') === -1, 'did not expect the old Procurement-sheet "Common" option to remain, got:\n' + sel.innerHTML);
  assert.ok(sel.innerHTML.indexOf('>MFG<') === -1, 'did not expect the old Procurement-sheet "MFG" option to remain, got:\n' + sel.innerHTML);
});

test('a failed/empty response falls back to an error option rather than throwing or silently leaving a stale list', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  const win = makeFakeWindow();
  loadRequestTabs(doc, win, { WEBAPP_URL: 'https://example.com/exec' });
  const cbKey = Object.keys(win)[0];
  win[cbKey](null);

  assert.ok(sel.innerHTML.indexOf("Couldn't load") > -1, 'expected a load-error option on a failed response, got:\n' + sel.innerHTML);
});

// ---------------------------------------------------------------------
// Sanity checks on the surrounding, UNCHANGED code — Approver, ARN reuse,
// Slack DM, and the Procurement Request No. number field must all be
// untouched by this fix.
// ---------------------------------------------------------------------
test('the Procurement Request No. number field (f-req-no) and its tab+number validation are unchanged', function() {
  assert.ok(html.indexOf('id="f-req-no"') > -1, 'expected f-req-no to still exist');
  assert.ok(html.indexOf('(reqTab && !reqNo) || (!reqTab && reqNo)') > -1, 'expected the existing tab+number pairing validation to be unchanged');
  assert.ok(html.indexOf('reqTab && reqNo ? `${reqTab}-${reqNo}` : ""') > -1, 'expected the existing procurementRef construction to be unchanged');
});

test('the Approver dropdown / loadApprovers() is unaffected by this change', function() {
  assert.ok(html.indexOf('function loadApprovers()') > -1, 'expected loadApprovers() to still exist, unchanged');
  assert.ok(html.indexOf('action: "employees"') > -1, 'expected the Approver dropdown to still use the employees action, unchanged');
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
console.log('arn-request-tab-grn-source.test.js: ' + passCount + '/' + results.length + ' passed');

if (passCount !== results.length) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nPASSED');
  process.exit(0);
}
