// grn-hsn-sac-field.test.js
//
// Focused test for the new "HSN/SAC No." item-level field added to
// frontend/grn-entry.html, beside "Catalogue / Lot / Batch No." in all
// three item-entry paths (ad-hoc item, PO-item loop, manual item block).
//
// There is no frontend test framework in this repo (no package.json, no
// jsdom/jest) — this test checks the REAL source text of grn-entry.html
// directly (never a hand-copied duplicate), so a future regression to
// the actual markup/payload wiring is what gets caught here.
//
// Run:
//   cd E:\inventory-management\frontend
//   node tests/grn-hsn-sac-field.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const GRN_ENTRY_PATH = path.join(__dirname, '..', 'grn-entry.html');
const html = fs.readFileSync(GRN_ENTRY_PATH, 'utf8');

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err });
  }
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------
// 1. Field appears in all three item-entry paths.
// ---------------------------------------------------------------------

test('1a. Ad-hoc item path renders an "HSN/SAC No." label and input', () => {
  assert.ok(html.indexOf('<label>HSN/SAC No.</label>') !== -1, 'label markup not found');
  assert.ok(html.indexOf('<input type="text" id="f-adhoc-hsn-sac-no">') !== -1, 'ad-hoc HSN/SAC input not found');
});

test('1b. Ad-hoc item path keeps "Catalogue / Lot / Batch No." unchanged, paired in the same row', () => {
  const adhocSection = html.slice(html.indexOf('id="f-adhoc-toggle"'), html.indexOf('id="f-adhoc-hsn-sac-no"') + 50);
  assert.ok(adhocSection.indexOf('id="f-adhoc-catalogue-lot-no"') !== -1, 'existing Catalogue/Lot/Batch No. field must remain');
  assert.ok(adhocSection.indexOf('class="row2"') !== -1, 'the two fields should be laid out side by side using the existing .row2 pattern');
});

test('2a. PO-item loop declares hsnSacNoId and renders an input using it', () => {
  assert.ok(html.indexOf("const hsnSacNoId = 'po-item-hsn-sac-' + i;") !== -1, 'hsnSacNoId variable not declared in the PO-item loop');
  assert.ok(html.indexOf("'<input type=\"text\" id=\"' + hsnSacNoId + '\"") !== -1, 'PO-item HSN/SAC input not rendered using hsnSacNoId');
});

test('2b. PO-item loop keeps catalogueLotNoId wired and passes both ids into activePOItemsByCheckboxId', () => {
  assert.ok(
    html.indexOf('catalogueLotNoId: catalogueLotNoId, hsnSacNoId: hsnSacNoId, expiryDateId: expiryDateId') !== -1,
    'activePOItemsByCheckboxId entry must carry both catalogueLotNoId and hsnSacNoId (existing catalogueLotNoId wiring must remain intact)'
  );
});

test('3a. Manual item block renders an "HSN/SAC No." label and a per-item input', () => {
  assert.ok(html.indexOf('<label>HSN/SAC No.</label>') !== -1);
  assert.ok(html.indexOf("'<input type=\"text\" id=\"manual-hsn-sac-' + idx + '\">'") !== -1, 'manual item HSN/SAC input not rendered using idx');
});

test('3b. Manual item block keeps manual-catalogue-<idx> wired, paired in the same row', () => {
  const catalogueIdx = html.indexOf("manual-catalogue-' + idx");
  assert.ok(catalogueIdx !== -1, 'existing manual-catalogue-<idx> input must remain');
  const nearby = html.slice(catalogueIdx, catalogueIdx + 400);
  assert.ok(nearby.indexOf("manual-hsn-sac-' + idx") !== -1, 'manual-hsn-sac-<idx> input must be present shortly after Catalogue/Lot/Batch No. in the same block');
  const rowStart = html.lastIndexOf('class="row2"', catalogueIdx);
  assert.ok(rowStart !== -1 && catalogueIdx - rowStart < 200, 'the two fields should be laid out side by side using the existing .row2 pattern');
});

// ---------------------------------------------------------------------
// 2. HSN/SAC value is included in the submitted payload, in all three
//    item-payload-building blocks of the submit handler.
// ---------------------------------------------------------------------

test('4a. PO-item payload includes hsnSacNo read from entry.hsnSacNoId', () => {
  assert.ok(
    html.indexOf('hsnSacNo: document.getElementById(entry.hsnSacNoId).value.trim(),') !== -1,
    'PO-item payload does not read hsnSacNo from entry.hsnSacNoId'
  );
});

test('4b. Manual item payload includes hsnSacNo read from manual-hsn-sac-<idx>', () => {
  assert.ok(
    html.indexOf("hsnSacNo: document.getElementById('manual-hsn-sac-' + idx).value.trim(),") !== -1,
    'manual item payload does not read hsnSacNo'
  );
});

test('4c. Ad-hoc item payload includes hsnSacNo read from f-adhoc-hsn-sac-no', () => {
  assert.ok(
    html.indexOf("hsnSacNo: document.getElementById('f-adhoc-hsn-sac-no').value.trim(),") !== -1,
    'ad-hoc item payload does not read hsnSacNo'
  );
});

test('5. Each of the three payload sites reads hsnSacNo immediately alongside catalogueLotNo (no field dropped)', () => {
  // Exactly 3 catalogueLotNo reads and exactly 3 hsnSacNo reads should
  // exist in the submit handler's payload-building code -- one pair per
  // item-entry path. (The HTML label "Catalogue / Lot / Batch No." itself
  // appears more often across the 3 render sites + comments; this checks
  // the *payload read* sites specifically, which use a distinct pattern.)
  const catalogueReads = countOccurrences(html, "catalogueLotNo: document.getElementById(");
  const hsnReads = countOccurrences(html, "hsnSacNo: document.getElementById(");
  assert.strictEqual(catalogueReads, 3, 'expected exactly 3 catalogueLotNo payload reads (one per item-entry path)');
  assert.strictEqual(hsnReads, 3, 'expected exactly 3 hsnSacNo payload reads (one per item-entry path)');
});

// ---------------------------------------------------------------------
// 3. HSN/SAC No. stays optional -- no required marker, no numeric-only
//    validation introduced anywhere.
// ---------------------------------------------------------------------

test('6. HSN/SAC No. has no "required" marker (matches the existing optional convention of Catalogue/Lot/Batch No.)', () => {
  // None of the 3 HSN/SAC <label> occurrences should be immediately
  // followed by the req/asterisk markup used for genuinely required
  // fields elsewhere in this form (e.g. Description of Material).
  let idx = html.indexOf('HSN/SAC No.');
  let checked = 0;
  while (idx !== -1) {
    const surrounding = html.slice(idx, idx + 60);
    assert.ok(surrounding.indexOf('class="req"') === -1, 'an HSN/SAC No. label unexpectedly carries a required-field marker: ' + surrounding);
    checked++;
    idx = html.indexOf('HSN/SAC No.', idx + 1);
  }
  assert.ok(checked >= 3, 'expected to find the "HSN/SAC No." label text at least 3 times (once per item-entry path)');
});

test('7. No numeric-only validation/pattern was introduced for any HSN/SAC input', () => {
  ['f-adhoc-hsn-sac-no', 'hsnSacNoId', 'manual-hsn-sac-'].forEach((marker) => {
    let idx = html.indexOf(marker);
    while (idx !== -1) {
      const line = html.slice(Math.max(0, idx - 200), idx + 200);
      assert.ok(line.indexOf('pattern=') === -1, 'unexpected pattern= validation found near ' + marker);
      assert.ok(!/type="number"/.test(html.slice(idx - 40, idx + 5)), 'HSN/SAC input near ' + marker + ' must stay type="text", not type="number"');
      idx = html.indexOf(marker, idx + 1);
    }
  });
});

console.log('=== grn-hsn-sac-field.test.js ===');
results.forEach((r) => {
  console.log((r.pass ? '  PASS - ' : '  FAIL - ') + r.name);
  if (!r.pass) console.log('         ' + (r.error && r.error.message ? r.error.message : r.error));
});
const passCount = results.filter((r) => r.pass).length;
console.log(passCount + '/' + results.length + ' passed');
process.exit(results.every((r) => r.pass) ? 0 : 1);
