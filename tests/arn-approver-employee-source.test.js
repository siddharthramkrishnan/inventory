// arn-approver-employee-source.test.js
//
// Focused test for where the ARN Approver's names come from.
// Requirement: the Approver field (and the other people fields on
// arn-assign.html) must be populated from the backend's existing
// 'employees' JSONP action / getEmployeeList() (which prefers the
// "Slack-user IDs" tab's own names) — never a hardcoded EMPLOYEES list — so
// every name the backend is later asked to resolve by EXACT match
// (getSlackUserId() / getEmployeeEmail()) is a name that source produced.
//
// The loading now lives in the shared people-picker.js (a type-to-search
// picker used by every page). This test runs the REAL people-picker.js in
// Node against a minimal fake document, simulating the JSONP response, and
// checks arn-assign.html's wiring of the Approver field to it.
//
// Run:
//   cd frontend
//   node tests/arn-approver-employee-source.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'arn-assign.html'), 'utf8');
const PICKER_PATH = path.join(__dirname, '..', 'people-picker.js');

// Minimal fake DOM: only what fetchPeople() touches (createElement('script'),
// body.appendChild, parentNode.removeChild). Appended scripts are recorded
// so the test can inspect the JSONP URL and fire the callback itself.
function installFakeDocument() {
  const appended = [];
  const body = {
    appendChild(el) { el.parentNode = body; appended.push(el); },
    removeChild(el) { el.parentNode = null; },
  };
  globalThis.document = {
    body,
    head: { appendChild() {} },
    createElement() { return { parentNode: null }; },
  };
  return appended;
}

function freshPicker() {
  delete require.cache[require.resolve(PICKER_PATH)];
  const picker = require(PICKER_PATH);
  picker._reset();
  return picker;
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error }); }
}

function callbackName(src) {
  const m = /[?&]callback=([^&]+)/.exec(src);
  assert.ok(m, 'JSONP URL has no callback parameter: ' + src);
  return m[1];
}

(async function run() {
  await test('arn-assign.html loads the shared people-picker.js from the site root', () => {
    assert.ok(html.includes('<script src="people-picker.js"></script>'));
    assert.ok(fs.existsSync(PICKER_PATH), 'people-picker.js must exist next to arn-assign.html, or the live page 404s it');
  });

  await test('the Approver field is attached to PeoplePicker in strict mode (value must be an exact sheet name)', () => {
    assert.ok(/<input type="text" id="f-approver"/.test(html), 'f-approver should be a text input driven by the picker');
    assert.ok(/\[[^\]]*"f-approver"[^\]]*\]\.forEach\(id =>\s*PeoplePicker\.attach\(document\.getElementById\(id\), \{ strict: true \}\)\)/.test(html));
    assert.ok(html.includes('PeoplePicker.configure(CONFIG.WEBAPP_URL);'));
  });

  await test('arn-assign.html no longer carries a hardcoded EMPLOYEES list', () => {
    assert.ok(!/const EMPLOYEES\s*=/.test(html));
  });

  await test('people-picker.js requests the existing "employees" backend action', async () => {
    const appended = installFakeDocument();
    const picker = freshPicker();
    picker.configure('https://script.google.com/macros/s/FAKE/exec');
    assert.strictEqual(appended.length, 1, 'expected exactly one JSONP request');
    assert.ok(/[?&]action=employees(&|$)/.test(appended[0].src), 'expected action=employees, got ' + appended[0].src);
    // settle the request so nothing is left pending
    globalThis[callbackName(appended[0].src)]({ status: 'success', employees: ['A'] });
    await picker.getPeople();
  });

  await test('the list is EXACTLY the names the backend returned (trimmed, de-duplicated, sorted) — nothing hardcoded added', async () => {
    const appended = installFakeDocument();
    const picker = freshPicker();
    picker.configure('https://script.google.com/macros/s/FAKE/exec');
    const sheetNames = ['Neha M Manashetty', '  Raghavendra Annacharya Katti ', 'SIDDH R', 'neha m manashetty', ''];
    globalThis[callbackName(appended[0].src)]({ status: 'success', employees: sheetNames });
    const people = await picker.getPeople();
    assert.deepStrictEqual(people, ['Neha M Manashetty', 'Raghavendra Annacharya Katti', 'SIDDH R']);
  });

  await test('a typed value resolves to the sheet\'s exact spelling (what the backend will receive)', () => {
    const picker = freshPicker();
    const names = ['Neha M Manashetty', 'Raghavendra Annacharya Katti'];
    assert.strictEqual(picker.findExact(names, '  neha m MANASHETTY '), 'Neha M Manashetty');
    assert.strictEqual(picker.findExact(names, 'Neha'), null, 'a partial name must not count as a valid approver');
    assert.deepStrictEqual(picker.filterNames(names, 'kat'), ['Raghavendra Annacharya Katti']);
  });

  await test('a failed "employees" response rejects rather than leaving an invented list', async () => {
    const appended = installFakeDocument();
    const picker = freshPicker();
    picker.configure('https://script.google.com/macros/s/FAKE/exec');
    globalThis[callbackName(appended[0].src)]({ status: 'error' });
    await assert.rejects(picker.getPeople());
  });

  await test('the Approver field is still required in the submit validation', () => {
    assert.ok(html.includes('!requester || !subcatVal || !approver'));
  });

  let failed = 0;
  results.forEach((r) => {
    if (r.pass) console.log('  PASS - ' + r.name);
    else { failed++; console.log('  FAIL - ' + r.name + '\n         ' + (r.error && r.error.message ? r.error.message : r.error)); }
  });
  console.log('arn-approver-employee-source.test.js: ' + (results.length - failed) + '/' + results.length + ' passed');
  console.log(failed ? '\nFAILED' : '\nPASSED');
  process.exit(failed ? 1 : 0);
})();
