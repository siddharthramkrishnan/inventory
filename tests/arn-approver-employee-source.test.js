// arn-approver-employee-source.test.js
//
// Focused test for the ARN Approver dropdown's employee source in
// frontend/arn-assign.html. Requirement: the dropdown must be populated
// from the backend's existing 'employees' JSONP action / getEmployeeList()
// (which itself prefers the "Slack-user IDs" tab's own names — see
// Code.gs's getEmployeeList()/getSlackUserIdsTabNames()) rather than the
// local hardcoded EMPLOYEES constant, so every name getSlackUserId() is
// later asked to resolve is a name that source itself already produced.
//
// There is no frontend test framework in this repo (no package.json, no
// jsdom/jest) and arn-assign.html's <script> is a single large block with
// many real DOM/network dependencies. Instead, this test extracts the
// EXACT loadApprovers() function from the live file by its known
// surrounding text (never a hand-copied duplicate) and runs it against a
// minimal fake document/window, simulating the JSONP response arriving —
// so a future regression to the real source is what actually gets caught.
//
// Run:
//   cd frontend
//   node tests/arn-approver-employee-source.test.js

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

// ---------------------------------------------------------------------
// Extract loadApprovers() by its known start/end markers, as a real,
// callable function taking (document, window, CONFIG) — everything it
// references beyond Node's own globals (Date, Math, URLSearchParams,
// setTimeout/clearTimeout).
// ---------------------------------------------------------------------
function extractLoadApprovers() {
  const startMarker = 'function loadApprovers() {';
  const invocationMarker = 'loadApprovers();';
  const startIdx = indexOfOrThrow(html, startMarker, 0, 'loadApprovers()');
  const invocationIdx = indexOfOrThrow(html, invocationMarker, startIdx, 'the end of loadApprovers() (its own immediate invocation)');
  // Line-ending-agnostic: everything from the function's own start up to
  // (not including) its immediate-invocation line, trimmed.
  const source = html.slice(startIdx, invocationIdx).replace(/\s+$/, '');
  // `loadApprovers()` itself (as written in the real source) takes no
  // parameters — it closes over document/window/CONFIG from its
  // surrounding scope. `build` binds a FRESH document/window/CONFIG per
  // call (so each test gets its own isolated fakes) and returns the
  // closed-over loadApprovers, ready to invoke with no arguments.
  // eslint-disable-next-line no-new-func
  const build = new Function('document', 'window', 'CONFIG', source + '\nreturn loadApprovers;');
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
      if (id === 'f-approver') return selectEl;
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

const { source: loadApproversSource, build: buildLoadApprovers } = extractLoadApprovers();

// Runs the real loadApprovers() source against a fresh, isolated
// document/window/CONFIG for one test.
function loadApprovers(doc, win, config) {
  const bound = buildLoadApprovers(doc, win, config);
  bound();
}

test('loadApprovers() does not reference the hardcoded EMPLOYEES list at all', function() {
  assert.ok(loadApproversSource.indexOf('EMPLOYEES') === -1, 'expected loadApprovers() to contain no reference to EMPLOYEES, got:\n' + loadApproversSource);
});

test('loadApprovers() requests the existing "employees" backend action (same one grn-entry.html/grn-verify.html use)', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  const win = makeFakeWindow();
  loadApprovers(doc, win, { WEBAPP_URL: 'https://example.com/exec' });

  assert.strictEqual(doc._createdScripts.length, 1, 'expected exactly one <script> tag created');
  assert.ok(doc._createdScripts[0].src.indexOf('action=employees') > -1, 'expected the request URL to use action=employees, got: ' + doc._createdScripts[0].src);
});

test('shows a "Loading…" placeholder immediately, before the response arrives', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  loadApprovers(doc, makeFakeWindow(), { WEBAPP_URL: 'https://example.com/exec' });
  assert.ok(sel.innerHTML.indexOf('Loading') > -1, 'expected a loading placeholder, got: ' + sel.innerHTML);
});

test('on a successful "employees" response, populates the dropdown with EXACTLY the returned names (the shared Slack-user-IDs-backed source), not any hardcoded list', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  const win = makeFakeWindow();
  loadApprovers(doc, win, { WEBAPP_URL: 'https://example.com/exec' });

  const cbKey = Object.keys(win)[0];
  assert.ok(cbKey, 'expected loadApprovers() to have registered a JSONP callback on window');

  // Simulate the backend's real response shape: { status: 'success', employees: [...] }
  // — these are names as getEmployeeList() would return them (Slack-user-IDs-tab-sourced),
  // deliberately including a name that does NOT appear in the old hardcoded EMPLOYEES list,
  // to prove the dropdown now reflects the shared source rather than that list.
  win[cbKey]({ status: 'success', employees: ['Siddharth Ramkrishnan', 'Zeta Test Person'] });

  assert.ok(sel.innerHTML.indexOf('Siddharth Ramkrishnan') > -1, 'expected the exact name returned by the shared employee source to appear as an option, got:\n' + sel.innerHTML);
  assert.ok(sel.innerHTML.indexOf('Zeta Test Person') > -1, 'expected every name from the shared source to appear as an option, got:\n' + sel.innerHTML);
  assert.ok(sel.innerHTML.indexOf('SIDDHARTH R<') === -1 && sel.innerHTML.indexOf('SIDDHARTH R"') === -1, 'did not expect the old hardcoded EMPLOYEES-style name to appear, got:\n' + sel.innerHTML);
});

test('option value equals the exact name string from the response (what getSlackUserId() will receive on submit)', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  const win = makeFakeWindow();
  loadApprovers(doc, win, { WEBAPP_URL: 'https://example.com/exec' });
  const cbKey = Object.keys(win)[0];
  win[cbKey]({ status: 'success', employees: ['Siddharth Ramkrishnan'] });

  assert.ok(sel.innerHTML.indexOf('value="Siddharth Ramkrishnan"') > -1, 'expected the option value to be the exact returned name, got:\n' + sel.innerHTML);
});

test('a failed/empty response falls back to an error option rather than throwing or silently leaving a stale list', function() {
  const sel = makeFakeSelect();
  const doc = makeFakeDocument(sel);
  const win = makeFakeWindow();
  loadApprovers(doc, win, { WEBAPP_URL: 'https://example.com/exec' });
  const cbKey = Object.keys(win)[0];
  win[cbKey](null);

  assert.ok(sel.innerHTML.indexOf("Couldn't load") > -1, 'expected a load-error option on a failed response, got:\n' + sel.innerHTML);
});

// ---------------------------------------------------------------------
// Sanity checks on the surrounding, UNCHANGED code — the Approver field
// must still be required, and everything else in EMPLOYEES-based
// dropdowns (Requested By / Paid By) must be untouched.
// ---------------------------------------------------------------------
test('the Approver field is still required in the submit validation', function() {
  assert.ok(
    html.indexOf('|| !approver') > -1,
    'expected the submit handler\'s required-field check to still include Approver'
  );
});

test('EMPLOYEES is still defined and still used by the UNRELATED Requested By / Paid By dropdowns', function() {
  assert.ok(html.indexOf('const EMPLOYEES = {') > -1, 'expected the EMPLOYEES constant to still exist (used by other fields)');
  assert.ok(html.indexOf('EMPLOYEES[dept].map') > -1, 'expected fillEmployeeDropdown() (Requested By) to still use EMPLOYEES, unchanged');
  assert.ok(
    /const everyone = \[\.\.\.new Set\(\[\.\.\.EMPLOYEES\.RD, \.\.\.EMPLOYEES\.MF, \.\.\.EMPLOYEES\.GN\]\)\]\.sort\(\);/.test(html),
    'expected populatePaidBy() to still use EMPLOYEES, unchanged'
  );
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
console.log('arn-approver-employee-source.test.js: ' + passCount + '/' + results.length + ' passed');

if (passCount !== results.length) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nPASSED');
  process.exit(0);
}
