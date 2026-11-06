// grn-search-date-format.test.js
//
// Tests the DD-MM-YYYY / IST (Asia/Kolkata, UTC+05:30) display formatting
// in frontend/grn-search.html:
//   - formatIstDate / formatIstDateTime / formatIstDateAuto / formatIstTime
//   - midnight / month / year / leap-day rollover from UTC to IST
//   - blank, null, invalid and non-date inputs
//   - results table, CSV ("Export to Excel") output, GRN/Adjustment/Master
//     Item detail views and the print layout
//   - sorting still uses the raw timestamps, and the raw search results
//     (the API data) are never mutated by formatting
//
// The page's REAL <script> block is executed inside a Node vm sandbox with
// a minimal stub DOM — no hand-copied duplicate of the source — so a
// regression in the live file is what fails here.
//
// The process timezone is deliberately set to America/Los_Angeles to prove
// the output does not depend on the viewing device's own timezone.
//
// Run:
//   cd frontend
//   node tests/grn-search-date-format.test.js

process.env.TZ = 'America/Los_Angeles';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'grn-search.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
assert.ok(scriptMatch, 'Could not find the main <script> block in grn-search.html');
const scriptSource = scriptMatch[1];

// ---------------------------------------------------------------------
// Minimal stub DOM — just enough for the page script to load and for
// renderResults()/exportResultsToExcel()/detail views to run.
// ---------------------------------------------------------------------
function makeElement(id) {
  const el = {
    id: id, value: '', innerHTML: '', textContent: '', className: '',
    style: {}, children: [], attributes: {},
    addEventListener: function() {},
    setAttribute: function(k, v) { el.attributes[k] = v; },
    getAttribute: function(k) { return el.attributes[k]; },
    appendChild: function(c) { el.children.push(c); return c; },
    removeChild: function(c) { el.children = el.children.filter(function(x) { return x !== c; }); },
    contains: function(c) { return el.children.indexOf(c) > -1; },
    click: function() {},
    closest: function() { return null; },
  };
  return el;
}

function makeSandbox() {
  const elements = {};
  const blobs = [];
  const document = {
    title: 'GRN Search',
    body: makeElement('body'),
    getElementById: function(id) {
      if (!elements[id]) elements[id] = makeElement(id);
      return elements[id];
    },
    createElement: function(tag) { return makeElement(tag); },
  };
  function Blob(parts) { this.text = parts.join(''); blobs.push(this.text); }
  const context = {
    document: document,
    window: { addEventListener: function() {}, removeEventListener: function() {}, print: function() {} },
    navigator: { clipboard: { writeText: function() { return Promise.resolve(); } } },
    Blob: Blob,
    URL: { createObjectURL: function() { return 'blob:test'; }, revokeObjectURL: function() {} },
    setTimeout: setTimeout,
    console: console,
    Promise: Promise,
    Intl: Intl,
  };
  vm.createContext(context);
  vm.runInContext(scriptSource, context);
  elements['f-sort'].value = 'grnDate-desc';
  return {
    ctx: context, elements: elements, blobs: blobs,
    run: function(code) { return vm.runInContext(code, context); },
  };
}

const sb = makeSandbox();
const fmtDate = sb.ctx.formatIstDate;
const fmtDateTime = sb.ctx.formatIstDateTime;
const fmtAuto = sb.ctx.formatIstDateAuto;
const fmtTime = sb.ctx.formatIstTime;

let passed = 0;
let failed = 0;
const pending = [];
function test(name, fn) {
  function ok() { passed++; console.log('  ok   ' + name); }
  function fail(e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(ok, fail));
    else ok();
  } catch (e) { fail(e); }
}

console.log('grn-search date formatting (process TZ = ' + process.env.TZ + ')');

// ---------------------------------------------------------------------
// Core formatting
// ---------------------------------------------------------------------
test('reported example: 2026-09-22T18:30:00.000Z -> 23-09-2026 (midnight IST)', function() {
  assert.strictEqual(fmtDate('2026-09-22T18:30:00.000Z'), '23-09-2026');
});

test('DD-MM-YYYY zero-pads day and month', function() {
  assert.strictEqual(fmtDate('2026-01-04T18:30:00.000Z'), '05-01-2026');
});

test('Date object input is formatted in IST', function() {
  assert.strictEqual(fmtDate(new Date('2026-09-22T18:30:00.000Z')), '23-09-2026');
});

test('ISO with explicit +05:30 offset', function() {
  assert.strictEqual(fmtDateTime('2026-09-23T00:00:00+05:30'), '23-09-2026, 12:00 AM');
});

test('IST date-time conversion: 06:45Z -> 12:15 PM IST', function() {
  assert.strictEqual(fmtDateTime('2026-09-23T06:45:00.000Z'), '23-09-2026, 12:15 PM');
});

test('IST time-only conversion', function() {
  assert.strictEqual(fmtTime('2026-09-23T06:45:00.000Z'), '12:15 PM');
  assert.strictEqual(fmtTime('2026-09-23T13:29:00.000Z'), '06:59 PM');
});

// ---------------------------------------------------------------------
// Midnight / date rollover
// ---------------------------------------------------------------------
test('one millisecond before IST midnight stays on the previous day', function() {
  assert.strictEqual(fmtDate('2026-09-22T18:29:59.999Z'), '22-09-2026');
  assert.strictEqual(fmtDateTime('2026-09-22T18:29:59.999Z'), '22-09-2026, 11:59 PM');
});

test('exactly IST midnight rolls to the next day at 12:00 AM', function() {
  assert.strictEqual(fmtDateTime('2026-09-22T18:30:00.000Z'), '23-09-2026, 12:00 AM');
});

test('UTC evening rolls the IST date forward (21:00Z -> next day 02:30 AM)', function() {
  assert.strictEqual(fmtDateTime('2026-09-22T21:00:00.000Z'), '23-09-2026, 02:30 AM');
});

test('month rollover (28 Feb non-leap -> 01-03)', function() {
  assert.strictEqual(fmtDate('2026-02-28T18:30:00.000Z'), '01-03-2026');
});

test('leap day (2028-02-28T18:30Z -> 29-02-2028)', function() {
  assert.strictEqual(fmtDate('2028-02-28T18:30:00.000Z'), '29-02-2028');
});

test('year rollover (31 Dec 18:30Z -> 01-01-next year)', function() {
  assert.strictEqual(fmtDate('2026-12-31T18:30:00.000Z'), '01-01-2027');
});

test('UTC midnight is 05:30 AM IST on the same day', function() {
  assert.strictEqual(fmtDateTime('2026-09-23T00:00:00.000Z'), '23-09-2026, 05:30 AM');
});

test('noon IST is 12:00 PM', function() {
  assert.strictEqual(fmtTime('2026-09-23T06:30:00.000Z'), '12:00 PM');
});

// ---------------------------------------------------------------------
// Zone-less calendar strings are NOT timezone-shifted
// ---------------------------------------------------------------------
test('"dd/mm/yyyy" string -> DD-MM-YYYY (no shift, day/month not swapped)', function() {
  assert.strictEqual(fmtDate('06/08/2026'), '06-08-2026');
  assert.strictEqual(fmtDate('6/8/2026'), '06-08-2026');
});

test('"dd-mm-yyyy" string is normalised, "yyyy-mm-dd" is reordered', function() {
  assert.strictEqual(fmtDate('23-09-2026'), '23-09-2026');
  assert.strictEqual(fmtDate('2026-09-23'), '23-09-2026');
});

test('calendar string is shown as 12:00 AM on that day in date-time format', function() {
  assert.strictEqual(fmtDateTime('23/09/2026'), '23-09-2026, 12:00 AM');
});

// ---------------------------------------------------------------------
// Blank / invalid
// ---------------------------------------------------------------------
test('blank, whitespace, null, undefined -> empty string', function() {
  [undefined, null, '', '   '].forEach(function(v) {
    assert.strictEqual(fmtDate(v), '');
    assert.strictEqual(fmtDateTime(v), '');
    assert.strictEqual(fmtAuto(v), '');
    assert.strictEqual(fmtTime(v), '');
  });
});

test('invalid Date object -> empty string (no "NaN" / "Invalid Date")', function() {
  assert.strictEqual(fmtDate(new Date('nope')), '');
});

test('impossible calendar dates are shown unchanged, not silently rolled', function() {
  assert.strictEqual(fmtDate('31/02/2026'), '31/02/2026');
  assert.strictEqual(fmtDate('2026-13-01'), '2026-13-01');
});

test('impossible ISO timestamp is shown unchanged', function() {
  assert.strictEqual(fmtDate('2026-13-45T10:00:00.000Z'), '2026-13-45T10:00:00.000Z');
});

test('free text is shown unchanged (data never hidden)', function() {
  assert.strictEqual(fmtDate('N/A'), 'N/A');
  assert.strictEqual(fmtDate('Pending'), 'Pending');
});

test('formatted output never contains NaN/undefined/Invalid', function() {
  ['x', '2026-99-99T99:99:99Z', {}, 12345, true].forEach(function(v) {
    const out = String(fmtDate(v)) + String(fmtDateTime(v)) + String(fmtTime(v));
    assert.ok(!/NaN|undefined|Invalid/.test(out), 'bad output for ' + JSON.stringify(v) + ': ' + out);
  });
});

test('plain text time (from index.html) is normalised to hh:mm AM/PM without shifting', function() {
  assert.strictEqual(fmtTime('03:30 pm'), '03:30 PM');
  assert.strictEqual(fmtTime('15:30'), '03:30 PM');
  assert.strictEqual(fmtTime('not a time'), 'not a time');
});

// ---------------------------------------------------------------------
// Auto (Verified Date): midnight -> date only; real time -> date+time
// ---------------------------------------------------------------------
test('auto: date-only cell (IST midnight) shows date only', function() {
  assert.strictEqual(fmtAuto('2026-09-22T18:30:00.000Z'), '23-09-2026');
});

test('auto: real verification timestamp shows date + IST time', function() {
  assert.strictEqual(fmtAuto('2026-09-23T09:05:00.000Z'), '23-09-2026, 02:35 PM');
});

// ---------------------------------------------------------------------
// Page integration: table, sort, export, detail, print
// ---------------------------------------------------------------------
const RAW_RESULTS = [
  { source: 'grn', tabName: 'Consumables', grnNo: 'GR/DD/1001', grnDate: '2026-09-22T18:30:00.000Z',
    poNo: 'PO-1', vendor: 'Acme', materialDescription: 'Gloves', quantity: 5, unit: 'Box',
    verificationStatus: 'Verified', verifiedBy: 'QA', totalAmount: 100, currency: 'INR' },
  { source: 'grn', tabName: 'Consumables', grnNo: 'GR/DD/1002', grnDate: '05/09/2026',
    poNo: 'PO-2', vendor: 'Beta', materialDescription: 'Tips', quantity: 1, unit: 'Pack',
    verificationStatus: 'Pending Verification', totalAmount: 50, currency: 'INR' },
  { source: 'adjustment', adjId: 'ADJ-0001', grnNo: 'GR/DD/1001', itemName: 'Gloves', adjType: 'Issue',
    quantity: 2, status: 'Logged', date: '1899-12-30T00:00:00.000Z', time: '1899-12-30T10:00:00.000Z',
    timestamp: '2026-09-30T19:15:00.000Z', expiryDate: '' },
  { source: 'master', arn: 'ARN-9', itemName: 'Pipette', stockOnHand: 3, vendor: 'Gamma', dept: 'Lab' },
  { source: 'grn', tabName: 'Consumables', grnNo: 'GR/DD/1003', grnDate: '',
    poNo: 'PO-3', vendor: 'Delta', materialDescription: 'Tape', quantity: 1, unit: 'Roll',
    verificationStatus: 'Pending Verification', totalAmount: 10, currency: 'INR' },
];
const RAW_SNAPSHOT = JSON.stringify(RAW_RESULTS);

function loadResults(sortKey) {
  sb.ctx.__raw = JSON.parse(RAW_SNAPSHOT);
  sb.run('lastResults = __raw;');
  sb.elements['f-sort'].value = sortKey;
  sb.elements['resultsBody'] = undefined;
  sb.ctx.renderResults();
  return sb.elements['resultsBody'].children.map(function(tr) { return tr.innerHTML; });
}

test('results table: GRN Date column shows DD-MM-YYYY, never ISO/UTC', function() {
  const rows = loadResults('grnDate-desc');
  const all = rows.join('\n');
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(all), 'ISO timestamp leaked into the table:\n' + all);
  assert.ok(!/1899/.test(all), '1899 epoch leaked into the table');
  assert.ok(all.indexOf('<td>23-09-2026, 12:00 AM</td>') > -1, 'GRN date not formatted');
  assert.ok(all.indexOf('<td>05-09-2026, 12:00 AM</td>') > -1, 'dd/mm/yyyy GRN date not formatted');
  // Adjustment row: date from Timestamp (19:15Z 30 Sep = 00:45 IST 1 Oct).
  assert.ok(all.indexOf('<td>01-10-2026, 12:45 AM</td>') > -1, 'adjustment date not taken from IST timestamp');
});

test('sorting uses real timestamps (desc and asc), not formatted strings', function() {
  sb.elements['resultsBody'] = undefined;
  loadResults('grnDate-desc');
  const desc = sb.run('currentSortedResults.map(function(r){ return r.grnNo || r.arn; })');
  // 01-10 adj (GR/DD/1001 grnNo), 23-09 GRN 1001, 05-09 GRN 1002, then undated rows.
  assert.deepStrictEqual(desc.slice(0, 3), ['GR/DD/1001', 'GR/DD/1001', 'GR/DD/1002']);
  assert.strictEqual(sb.run('currentSortedResults[0].source'), 'adjustment');
  loadResults('grnDate-asc');
  const asc = sb.run('currentSortedResults.filter(function(r){ return r.source !== "master" && (r.grnDate || r.timestamp); }).map(function(r){ return r.source + ":" + r.grnNo; })');
  assert.deepStrictEqual(asc, ['grn:GR/DD/1002', 'grn:GR/DD/1001', 'adjustment:GR/DD/1001']);
});

test('sort: "dd/mm/yyyy" is IST midnight (orders exactly with ISO instants)', function() {
  assert.strictEqual(sb.ctx.grnDateSortValue('23/09/2026'), Date.parse('2026-09-22T18:30:00.000Z'));
});

test('raw search results (API data) are not mutated by formatting', function() {
  loadResults('grnDate-desc');
  const after = JSON.parse(sb.run('JSON.stringify(lastResults)'));
  assert.deepStrictEqual(after, JSON.parse(RAW_SNAPSHOT));
});

test('Excel export: GRN Date as DD-MM-YYYY text cells, no ISO, blanks stay blank', function() {
  loadResults('grnDate-desc');
  sb.blobs.length = 0;
  sb.ctx.exportResultsToExcel();
  assert.strictEqual(sb.blobs.length, 1, 'export did not produce a file');
  const lines = sb.blobs[0].replace(/^﻿/, '').split('\r\n');
  assert.ok(lines[0].indexOf('GRN Date') > -1);
  const csv = lines.join('\n');
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(csv), 'ISO timestamp leaked into export:\n' + csv);
  assert.ok(csv.indexOf('"=""23-09-2026, 12:00 AM"""') > -1, 'GRN date not exported as Excel text DD-MM-YYYY:\n' + csv);
  assert.ok(csv.indexOf('"=""05-09-2026, 12:00 AM"""') > -1, '05-09 must stay DD-MM in Excel (not May 9)');
  assert.ok(csv.indexOf('"=""01-10-2026, 12:45 AM"""') > -1, 'adjustment date not exported in IST');
  const blankRow = lines.find(function(l) { return l.indexOf('GR/DD/1003') > -1; });
  assert.ok(/^GRN Record,GR\/DD\/1003,,PO-3,/.test(blankRow), 'blank GRN date should export as empty: ' + blankRow);
  const masterRow = lines.find(function(l) { return l.indexOf('Master Item') === 0; });
  assert.ok(/^Master Item,—,—,/.test(masterRow), 'master row date placeholder changed: ' + masterRow);
});

test('excelDateCell only wraps values this page formatted', function() {
  assert.strictEqual(sb.ctx.excelDateCell('23-09-2026'), '="23-09-2026"');
  assert.strictEqual(sb.ctx.excelDateCell('23-09-2026, 02:35 PM'), '="23-09-2026, 02:35 PM"');
  assert.strictEqual(sb.ctx.excelDateCell(''), '');
  assert.strictEqual(sb.ctx.excelDateCell('—'), '—');
  assert.strictEqual(sb.ctx.excelDateCell('=HYPERLINK("x")'), '=HYPERLINK("x")');
});

const GRN_ITEMS = [{
  grnNo: 'GR/DD/1001', receivedDate: '2026-09-22T18:30:00.000Z', partyName: 'Acme', poNo: 'PO-1',
  invoiceNo: 'INV-7', invoiceDate: '2026-09-20T18:30:00.000Z', verificationStatus: 'Verified',
  verifiedBy: 'QA', verifiedDate: '2026-09-23T09:05:00.000Z', currency: 'INR',
  materialDescription: 'Gloves', quantity: 5, unit: 'Box', totalAmount: 100,
}];

test('GRN detail view: GRN/Invoice/Verified dates in DD-MM-YYYY + IST', function() {
  sb.run('grnDetailCache["Consumables||GR/DD/1001"] = ' + JSON.stringify(GRN_ITEMS) + ';');
  return sb.ctx.loadDetail('Consumables', 'GR/DD/1001').then(function() {
    const h = sb.elements['detailHeader'].innerHTML;
    assert.ok(h.indexOf('GRN Date</span><span class="value">23-09-2026, 12:00 AM<') > -1, h);
    assert.ok(h.indexOf('Invoice Date</span><span class="value">21-09-2026<') > -1, h);
    assert.ok(h.indexOf('Verified Date</span><span class="value">23-09-2026, 02:35 PM<') > -1, h);
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(h), 'ISO leaked into detail view');
  });
});

test('print layout: dates in DD-MM-YYYY + IST', function() {
  const out = sb.ctx.buildPrintHtml(GRN_ITEMS, 'Consumables');
  assert.ok(out.indexOf('>23-09-2026, 12:00 AM<') > -1);
  assert.ok(out.indexOf('>21-09-2026<') > -1);
  assert.ok(out.indexOf('>23-09-2026, 02:35 PM<') > -1);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(out), 'ISO leaked into print layout');
});

test('adjustment detail: Date/Time from IST Timestamp; Expiry Date formatted', function() {
  const adj = Object.assign({}, RAW_RESULTS[2], { expiryDate: '2027-03-30T18:30:00.000Z' });
  sb.ctx.viewAdjustmentDetail(adj);
  const h = sb.elements['detailHeader'].innerHTML;
  assert.ok(h.indexOf('>Date</span><span class="value">01-10-2026<') > -1, h);
  assert.ok(h.indexOf('>Time</span><span class="value">12:45 AM<') > -1, h);
  assert.ok(h.indexOf('Expiry Date</span><span class="value">31-03-2027<') > -1, h);
  assert.ok(!/1899|\d{4}-\d{2}-\d{2}T/.test(h), 'raw/epoch value leaked: ' + h);
});

test('adjustment detail without Timestamp falls back to Date/Time columns', function() {
  sb.ctx.viewAdjustmentDetail({ source: 'adjustment', adjId: 'ADJ-2', date: '06/08/2026', time: '03:30 pm', timestamp: '' });
  const h = sb.elements['detailHeader'].innerHTML;
  assert.ok(h.indexOf('>Date</span><span class="value">06-08-2026<') > -1, h);
  assert.ok(h.indexOf('>Time</span><span class="value">03:30 PM<') > -1, h);
  assert.ok(h.indexOf('Expiry Date</span><span class="value">—<') > -1, 'blank expiry should show —');
});

test('master item detail: ISO date values formatted, other values untouched', function() {
  sb.ctx.viewMasterItemDetail({ source: 'master', fields: [
    { label: 'ARN', value: 'ARN-9' },
    { label: 'Last Updated', value: '2026-09-22T18:30:00.000Z' },
    { label: 'Notes', value: 'Received 2026-09-22' },
    { label: 'Qty', value: 3 },
  ] });
  const h = sb.elements['detailHeader'].innerHTML;
  assert.ok(h.indexOf('Last Updated</span><span class="value">23-09-2026<') > -1, h);
  assert.ok(h.indexOf('Received 2026-09-22') > -1, 'free text must not be rewritten');
  assert.ok(h.indexOf('ARN-9') > -1);
});

Promise.all(pending).then(function() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
