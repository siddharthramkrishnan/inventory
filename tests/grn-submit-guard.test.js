// grn-submit-guard.test.js
//
// Focused test for the "Submit GRN" duplicate-submission guard in the
// submit handler of frontend/grn-entry.html.
//
// Required behavior under test:
//   1. Before submission: button reads "Submit GRN", enabled.
//   2. First click: button disables immediately, text becomes
//      "Submitting GRN...".
//   3. Any further click/submit while a request is in flight is ignored
//      (duplicate-submission guard).
//   4. A client-side validation failure (before the network request) or
//      a failed network/server request re-enables the button and
//      restores "Submit GRN", so the user can correct and retry.
//   5. A SUCCESSFUL submission leaves the button disabled permanently
//      for that completed form -- it must NOT be restored to
//      "Submit GRN", and its text must change to the final confirmation
//      state "✓ GRN Submitted" (not left reading "Submitting GRN...").
//
// There is no frontend test framework in this repo (no package.json,
// no jsdom/jest) and grn-entry.html's <script> is a single large block
// with many real DOM/network dependencies (dozens of
// document.getElementById() calls, JSONP calls to the live Apps Script
// backend on load) that make loading the WHOLE script in isolation
// impractical for a "focused" test. Instead, this test extracts the
// EXACT relevant snippets from the live file by their known surrounding
// text (never a hand-copied duplicate) so a future regression to the
// real source is what actually gets caught here.
//
// Run:
//   cd E:\inventory-management\frontend
//   node tests/grn-submit-guard.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const GRN_ENTRY_PATH = path.join(__dirname, '..', 'grn-entry.html');
const html = fs.readFileSync(GRN_ENTRY_PATH, 'utf8');

// ---------------------------------------------------------------------
// Extraction helpers -- all locate text by exact, known markers already
// present in grn-entry.html; each throws a clear, specific error (rather
// than silently testing nothing) if the real source no longer matches.
// ---------------------------------------------------------------------

function indexOfOrThrow(haystack, marker, fromIndex, label) {
  const idx = haystack.indexOf(marker, fromIndex || 0);
  assert.ok(idx !== -1, 'Could not find ' + label + ' ("' + marker + '") in grn-entry.html — has it been removed or reworded?');
  return idx;
}

// The re-entrancy guard at the very top of the submit handler:
//   if (submitBtn.disabled) return;
//   submitBtn.disabled = true;
//   ... (comments) ...
//   submitBtn.textContent = 'Submitting GRN...';
const GUARD_START = 'if (submitBtn.disabled) return;';
const GUARD_END = "submitBtn.textContent = 'Submitting GRN...';";

function extractGuardSnippet() {
  const startIdx = indexOfOrThrow(html, GUARD_START, 0, 'the duplicate-submission guard');
  const endIdx = indexOfOrThrow(html, GUARD_END, startIdx, 'the "Submitting GRN..." text assignment after the guard');
  const endOfLine = html.indexOf('\n', endIdx);
  return html.slice(startIdx, endOfLine === -1 ? endIdx + GUARD_END.length : endOfLine);
}

// The success branch (`if (result && result.status === 'success') { ... }`)
// and the failure branch (`} else { ... }`) of the post-submit handling,
// as two separate source substrings. `searchFrom` anchors the search to
// AFTER the submit handler's own guard snippet -- the bare comparison
// text "if (result && result.status === 'success') {" also appears
// earlier in the file (inside refreshSuggestions(), for the unrelated
// grnsuggest lookup), so searching from the very start of the file would
// silently match the wrong occurrence.
function extractResultBranches(searchFrom) {
  const successMarker = "if (result && result.status === 'success') {";
  const elseMarker = '} else {';
  const successStartIdx = indexOfOrThrow(html, successMarker, searchFrom, 'the submit handler\'s post-submit success branch');
  const elseIdx = indexOfOrThrow(html, elseMarker, successStartIdx, 'the submit handler\'s post-submit failure ("} else {") branch');
  const handlerEndIdx = indexOfOrThrow(html, '\n});', elseIdx, 'the end of the submit handler');

  const successBody = html.slice(successStartIdx + successMarker.length, elseIdx);
  const failureBody = html.slice(elseIdx + elseMarker.length, handlerEndIdx);
  return { successBody, failureBody };
}

// Wraps the extracted guard snippet as a callable function taking a fake
// submitBtn -- this re-runs the REAL source text (comments included,
// harmless), not a reimplementation.
function buildAttemptSubmit(snippet) {
  // eslint-disable-next-line no-new-func
  return new Function('submitBtn', 'proceedCounter', snippet + '\n proceedCounter.count++;');
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err });
  }
}

const guardStartIdx = indexOfOrThrow(html, GUARD_START, 0, 'the duplicate-submission guard');
const guardSnippet = extractGuardSnippet();
const attemptSubmit = buildAttemptSubmit(guardSnippet);
const { successBody, failureBody } = extractResultBranches(guardStartIdx);

test('1. Before submission: button starts enabled with "Submit GRN" (sanity baseline)', () => {
  const submitBtn = { disabled: false, textContent: 'Submit GRN' };
  assert.strictEqual(submitBtn.disabled, false);
  assert.strictEqual(submitBtn.textContent, 'Submit GRN');
});

test('2. First click: disables the button immediately and sets "Submitting GRN..." text', () => {
  const submitBtn = { disabled: false, textContent: 'Submit GRN' };
  const proceedCounter = { count: 0 };
  attemptSubmit(submitBtn, proceedCounter);
  assert.strictEqual(proceedCounter.count, 1, 'first attempt should proceed past the guard exactly once');
  assert.strictEqual(submitBtn.disabled, true, 'button must be disabled immediately on the first attempt');
  assert.strictEqual(submitBtn.textContent, 'Submitting GRN...', 'button text must change immediately on the first attempt');
});

test('3. Duplicate submission blocked: repeated clicks / double-click / duplicate Enter-submit while in flight are ignored', () => {
  const submitBtn = { disabled: false, textContent: 'Submit GRN' };
  const proceedCounter = { count: 0 };
  attemptSubmit(submitBtn, proceedCounter); // 1st click
  attemptSubmit(submitBtn, proceedCounter); // 2nd click, button already disabled
  attemptSubmit(submitBtn, proceedCounter); // 3rd click, still disabled
  assert.strictEqual(proceedCounter.count, 1, 'only the first attempt should ever proceed past the guard while the button stays disabled');
  assert.strictEqual(submitBtn.disabled, true);
  assert.strictEqual(submitBtn.textContent, 'Submitting GRN...');
});

test('4. Client-side validation failure re-enables the button and restores "Submit GRN" (retry allowed)', () => {
  const submitBtn = { disabled: false, textContent: 'Submit GRN' };
  const proceedCounter = { count: 0 };
  attemptSubmit(submitBtn, proceedCounter); // 1st submission attempt
  // Simulates one of the existing pre-request validation-failure paths in
  // grn-entry.html (invalid financial fields / invalid Overall Tax /
  // invalid expiry / no items), which already reset these two properties
  // back before returning.
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit GRN';
  assert.strictEqual(submitBtn.disabled, false, 'button must be re-enabled after a validation failure');
  assert.strictEqual(submitBtn.textContent, 'Submit GRN', 'button text must be restored after a validation failure');
  attemptSubmit(submitBtn, proceedCounter); // retry after fixing the problem
  assert.strictEqual(proceedCounter.count, 2, 'a retry after the button is re-enabled must be allowed to proceed');
});

test('5. Failed network/server submission (the "} else {" branch) re-enables the button and restores "Submit GRN"', () => {
  assert.ok(
    failureBody.indexOf('submitBtn.disabled = false;') !== -1,
    'the failure branch must re-enable the button (submitBtn.disabled = false)'
  );
  assert.ok(
    failureBody.indexOf("submitBtn.textContent = 'Submit GRN';") !== -1,
    'the failure branch must restore the button text to "Submit GRN"'
  );
});

test('6. Successful submission leaves the button disabled permanently (never restored to "Submit GRN")', () => {
  assert.ok(
    successBody.indexOf('submitBtn.disabled = false') === -1,
    'the success branch must NOT re-enable the button — it must stay disabled for this completed form'
  );
  assert.ok(
    successBody.indexOf("submitBtn.textContent = 'Submit GRN'") === -1,
    'the success branch must NOT restore "Submit GRN" — the button must keep showing a submitted/completed state'
  );
  // The existing success behavior (message + form reset for the fields)
  // must still be present and untouched by this change.
  assert.ok(successBody.indexOf("showMsg(msg, 'success')") !== -1, 'the existing success message call must still be present');
  assert.ok(successBody.indexOf("document.getElementById('grnForm').reset();") !== -1, 'the existing form-field reset must still be present');
});

test('7. Successful submission changes the button text to "✓ GRN Submitted" (not left reading "Submitting...")', () => {
  assert.ok(
    successBody.indexOf("submitBtn.textContent = '✓ GRN Submitted';") !== -1,
    'the success branch must set the button text to the final confirmation state "✓ GRN Submitted"'
  );
});

test('8. End-to-end simulation: first click submits, then the success branch\'s own final state is applied and stays', () => {
  const submitBtn = { disabled: false, textContent: 'Submit GRN' };
  const proceedCounter = { count: 0 };
  attemptSubmit(submitBtn, proceedCounter); // user clicks Submit GRN
  assert.strictEqual(submitBtn.disabled, true, 'button must be disabled while the request is in progress');
  assert.strictEqual(submitBtn.textContent, 'Submitting GRN...', 'button must display the in-progress text while the request is in progress');
  // Simulate exactly what the success branch does to the button: nothing
  // to submitBtn.disabled (stays true, never touched), and the new final
  // confirmation text.
  submitBtn.textContent = '✓ GRN Submitted';
  assert.strictEqual(submitBtn.disabled, true, 'button must remain disabled after a successful submission');
  assert.strictEqual(submitBtn.textContent, '✓ GRN Submitted', 'button must display the final confirmation text after a successful submission');
  // No further click can start a new submission from this same page.
  attemptSubmit(submitBtn, proceedCounter);
  assert.strictEqual(proceedCounter.count, 1, 'no further submission may proceed from this page after a successful submission');
});

console.log('=== grn-submit-guard.test.js ===');
results.forEach((r) => {
  console.log((r.pass ? '  PASS - ' : '  FAIL - ') + r.name);
  if (!r.pass) console.log('         ' + (r.error && r.error.message ? r.error.message : r.error));
});
const passCount = results.filter((r) => r.pass).length;
console.log(passCount + '/' + results.length + ' passed');
process.exit(results.every((r) => r.pass) ? 0 : 1);
