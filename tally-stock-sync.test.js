// tally-stock-sync.test.js
//
// Focused test suite for the Phase 1 "TALLY_STOCK_SYNC" endpoint added to
// backend/Code.gs and backend/Code.js: getOrCreateTallyStockSheet() and
// tallyStockSync(). Same vm-sandbox + in-memory mock Sheet/Spreadsheet
// approach as grn-tax.test.js/grn-hsn-sac.test.js — no real Google Sheets
// access, no network calls, nothing written except to the mock.
//
// Run:
//   cd E:\inventory-management\backend
//   node tests/tally-stock-sync.test.js
//
// Runs the entire suite against BOTH Code.gs and Code.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const TARGET_FILES = ['Code.gs', 'Code.js'];

// Mirrors backend/Code.gs's/Code.js's TALLY_STOCK_HEADERS constant
// exactly. Deliberately a plain literal here rather than read off
// ctx.TALLY_STOCK_HEADERS -- a `const` declared at the top level of a
// script run via vm.runInContext() lives in a separate lexical
// environment, not as a property of the sandbox global object (unlike
// top-level `function` declarations, which DO end up there via normal
// hoisting -- that's why ctx.grnCreate()/ctx.getOrCreateTallyStockSheet()
// etc. already work throughout this file and grn-tax.test.js). Comparing
// against a same-realm literal also sidesteps a second, unrelated
// cross-realm quirk: an array/Date value CREATED inside the vm sandbox
// belongs to that sandbox's own separate realm, so outer-realm
// assert.deepStrictEqual()/instanceof checks against it can report
// "same structure but not reference-equal" (arrays) or fail entirely
// (instanceof Date) even when the value is genuinely correct -- see the
// Object.prototype.toString.call() workaround used for Last Synced below.
const EXPECTED_TALLY_STOCK_HEADERS = [
  'Item Name', 'Tally MASTERID', 'Tally GUID', 'Category', 'Base Unit',
  'Current Stock Qty', 'Current Stock Value', 'Current Rate', 'GST Applicable',
  'Last Synced',
];

// ---------------------------------------------------------------------
// In-memory mock Sheet — same shape as grn-tax.test.js's, plus
// deleteRows(), which tallyStockSync() needs for its "replace, never
// append" behavior.
// ---------------------------------------------------------------------
function createMockSheet(name, headerRow) {
  const data = headerRow ? [headerRow.slice()] : [];

  function ensureRowExists(rowIdx) {
    while (data.length <= rowIdx) data.push([]);
  }
  function ensureColExists(rowArr, colIdx) {
    while (rowArr.length <= colIdx) rowArr.push('');
  }

  return {
    getName: function() { return name; },
    getLastColumn: function() {
      return data.reduce(function(max, row) { return Math.max(max, row.length); }, 0);
    },
    getLastRow: function() { return data.length; },
    getMaxRows: function() { return Math.max(data.length, 50); },
    getRange: function(row, col, numRows, numCols) {
      numRows = numRows || 1;
      numCols = numCols || 1;
      return {
        getValues: function() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const rowIdx = row - 1 + r;
            ensureRowExists(rowIdx);
            const rowArr = data[rowIdx];
            const outRow = [];
            for (let c = 0; c < numCols; c++) {
              const colIdx = col - 1 + c;
              ensureColExists(rowArr, colIdx);
              outRow.push(rowArr[colIdx] === undefined ? '' : rowArr[colIdx]);
            }
            out.push(outRow);
          }
          return out;
        },
        setValues: function(values) {
          for (let r = 0; r < values.length; r++) {
            const rowIdx = row - 1 + r;
            ensureRowExists(rowIdx);
            for (let c = 0; c < values[r].length; c++) {
              const colIdx = col - 1 + c;
              ensureColExists(data[rowIdx], colIdx);
              data[rowIdx][colIdx] = values[r][c];
            }
          }
        },
        setValue: function(v) {
          ensureRowExists(row - 1);
          ensureColExists(data[row - 1], col - 1);
          data[row - 1][col - 1] = v;
        },
        setBackground: function() {},
        setFontColor: function() {},
        setFontWeight: function() {},
        setFontSize: function() {},
        setNumberFormat: function() {},
      };
    },
    // 1-based start row, matching Apps Script's real deleteRows(row, howMany).
    deleteRows: function(startRow, howMany) {
      data.splice(startRow - 1, howMany);
    },
    setFrozenRows: function() {},
    _data: data,
  };
}

function createMockSpreadsheet(initialSheets) {
  const sheets = initialSheets.slice();
  return {
    getSheetByName: function(name) {
      return sheets.find(function(s) { return s.getName() === name; }) || null;
    },
    getSheets: function() { return sheets; },
    insertSheet: function(name) {
      const newSheet = createMockSheet(name, null); // brand-new sheet: no header row yet, matching real insertSheet()
      sheets.push(newSheet);
      return newSheet;
    },
  };
}

function loadBackend(filePath, mockSpreadsheet) {
  const code = fs.readFileSync(filePath, 'utf8');
  const scriptProperties = { 'TALLY_STOCK_SYNC_SECRET': 'correct-secret' };
  const sandbox = {
    console: console,
    SpreadsheetApp: {
      openById: function() { return mockSpreadsheet; },
      getActiveSpreadsheet: function() { return mockSpreadsheet; },
    },
    LockService: { getScriptLock: function() { return { tryLock: function() { return true; }, releaseLock: function() {} }; } },
    CacheService: { getScriptCache: function() { return { remove: function() {}, get: function() { return null; }, put: function() {} }; } },
    UrlFetchApp: { fetch: function() { return { getResponseCode: function() { return 200; }, getContentText: function() { return '{}'; } }; } },
    PropertiesService: {
      getScriptProperties: function() {
        return {
          getProperty: function(key) { return Object.prototype.hasOwnProperty.call(scriptProperties, key) ? scriptProperties[key] : null; },
          setProperty: function(key, value) { scriptProperties[key] = value; },
        };
      },
    },
    Utilities: {},
    Session: {},
    MailApp: { sendEmail: function() {} },
    ContentService: {},
    HtmlService: {},
    Logger: console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: filePath });
  sandbox.__scriptProperties = scriptProperties; // exposed so a test can delete/change the secret mid-run
  return sandbox;
}

function makeItem(overrides) {
  return Object.assign({
    name: 'Widget A',
    masterId: '1001',
    guid: 'guid-001',
    category: 'Consumables',
    baseUnit: 'Nos',
    currentStockQty: 25,
    currentStockValue: -1250,
    currentRate: 50,
    gstApplicable: 'Applicable',
  }, overrides);
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

function runSuiteAgainstFile(fileLabel, filePath) {
  console.log('\n=== ' + fileLabel + ' ===');
  results.length = 0;

  test('1. getOrCreateTallyStockSheet() creates the tab with the exact required headers when missing', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const sheet = ctx.getOrCreateTallyStockSheet();
    assert.strictEqual(sheet.getName(), 'Tally_Latest_Stock');
    assert.deepStrictEqual(sheet._data[0], EXPECTED_TALLY_STOCK_HEADERS);
  });

  test('2. getOrCreateTallyStockSheet() is idempotent -- calling it again does not duplicate or re-create the tab', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const first = ctx.getOrCreateTallyStockSheet();
    first.getRange(2, 1, 1, 1).setValues([['sentinel']]); // prove the SAME sheet object/data is returned
    const second = ctx.getOrCreateTallyStockSheet();
    assert.strictEqual(second.getLastRow(), 2, 'expected the sentinel data row to still be present, i.e. no fresh sheet was created');
    assert.strictEqual(ss.getSheets().filter(function(s) { return s.getName() === 'Tally_Latest_Stock'; }).length, 1, 'expected exactly one Tally_Latest_Stock tab, not a duplicate');
  });

  test('3. getOrCreateTallyStockSheet() self-heals an existing tab with the wrong/incomplete header row', function() {
    const badSheet = createMockSheet('Tally_Latest_Stock', ['Item Name', 'Wrong Header']);
    const ss = createMockSpreadsheet([badSheet]);
    const ctx = loadBackend(filePath, ss);
    const sheet = ctx.getOrCreateTallyStockSheet();
    assert.deepStrictEqual(sheet._data[0], EXPECTED_TALLY_STOCK_HEADERS);
  });

  test('4. tallyStockSync() rejects a request with a missing/wrong secret, and does not touch the sheet', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const result = ctx.tallyStockSync({ secret: 'wrong', items: [makeItem()] });
    assert.strictEqual(result.status, 'error');
    assert.ok(/secret/i.test(result.message));
    assert.strictEqual(ss.getSheets().length, 0, 'the tab must not even be created on an auth failure');
  });

  test('5. tallyStockSync() rejects a request when the server has no secret configured at all', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    ctx.__scriptProperties['TALLY_STOCK_SYNC_SECRET'] = null;
    const result = ctx.tallyStockSync({ secret: 'anything', items: [] });
    assert.strictEqual(result.status, 'error');
    assert.ok(/not configured/i.test(result.message));
  });

  test('6. tallyStockSync() rejects malformed input where items is not an array', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const result = ctx.tallyStockSync({ secret: 'correct-secret', items: 'not-an-array' });
    assert.strictEqual(result.status, 'error');
    assert.ok(/items array/i.test(result.message));
  });

  test('7. tallyStockSync() rejects malformed input where items is entirely missing', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const result = ctx.tallyStockSync({ secret: 'correct-secret' });
    assert.strictEqual(result.status, 'error');
  });

  test('8. tallyStockSync() creates the tab (if missing) and writes a fresh snapshot with correct headers and row count', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const result = ctx.tallyStockSync({
      secret: 'correct-secret',
      items: [makeItem({ name: 'Item A' }), makeItem({ name: 'Item B' })],
    });
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.itemsWritten, 2);
    const sheet = ss.getSheetByName('Tally_Latest_Stock');
    assert.deepStrictEqual(sheet._data[0], EXPECTED_TALLY_STOCK_HEADERS);
    assert.strictEqual(sheet.getLastRow(), 3, 'header row + 2 data rows');
    assert.strictEqual(sheet._data[1][0], 'Item A');
    assert.strictEqual(sheet._data[2][0], 'Item B');
  });

  test('9. tallyStockSync() sets Last Synced to a real timestamp for every written row', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const before = new Date();
    const result = ctx.tallyStockSync({ secret: 'correct-secret', items: [makeItem(), makeItem()] });
    const after = new Date();
    assert.strictEqual(result.status, 'success');
    const sheet = ss.getSheetByName('Tally_Latest_Stock');
    const lastSyncedColIndex = EXPECTED_TALLY_STOCK_HEADERS.indexOf('Last Synced');
    [1, 2].forEach(function(rowIdx) {
      const stamped = sheet._data[rowIdx][lastSyncedColIndex];
      // Object.prototype.toString.call() (not `instanceof Date`) --
      // `stamped` is a Date created INSIDE the vm sandbox, which belongs
      // to that sandbox's own separate realm; `instanceof` against this
      // outer scope's Date constructor would incorrectly report false
      // even though it's a genuine Date. The built-in toString tag check
      // works correctly across realms; calling .getTime() on the value
      // itself also works fine, since that's the object's own method.
      assert.strictEqual(Object.prototype.toString.call(stamped), '[object Date]', 'Last Synced must be a real Date, row ' + rowIdx);
      assert.ok(stamped.getTime() >= before.getTime() - 1000 && stamped.getTime() <= after.getTime() + 1000, 'Last Synced must be the actual sync time, row ' + rowIdx);
    });
    assert.ok(result.syncedAt, 'the response must also report syncedAt');
  });

  test('10. tallyStockSync() REPLACES the existing snapshot rather than appending to it', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    ctx.tallyStockSync({ secret: 'correct-secret', items: [makeItem({ name: 'Old Item 1' }), makeItem({ name: 'Old Item 2' })] });
    const result2 = ctx.tallyStockSync({ secret: 'correct-secret', items: [makeItem({ name: 'New Item' })] });
    assert.strictEqual(result2.status, 'success');
    const sheet = ss.getSheetByName('Tally_Latest_Stock');
    assert.strictEqual(sheet.getLastRow(), 2, 'header row + exactly 1 new data row -- the 2 old rows must be gone, not still present alongside it');
    assert.strictEqual(sheet._data[1][0], 'New Item');
    assert.strictEqual(sheet._data.some(function(row) { return row[0] === 'Old Item 1' || row[0] === 'Old Item 2'; }), false, 'no trace of the previous snapshot may remain');
  });

  test('11. tallyStockSync() preserves the header row exactly when replacing data', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    ctx.tallyStockSync({ secret: 'correct-secret', items: [makeItem()] });
    ctx.tallyStockSync({ secret: 'correct-secret', items: [makeItem(), makeItem()] });
    const sheet = ss.getSheetByName('Tally_Latest_Stock');
    assert.deepStrictEqual(sheet._data[0], EXPECTED_TALLY_STOCK_HEADERS, 'header row must be identical after multiple syncs');
  });

  test('12. tallyStockSync() handles an EMPTY Tally response as a valid snapshot (clears data, keeps header, no error)', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    ctx.tallyStockSync({ secret: 'correct-secret', items: [makeItem(), makeItem()] });
    const result2 = ctx.tallyStockSync({ secret: 'correct-secret', items: [] });
    assert.strictEqual(result2.status, 'success');
    assert.strictEqual(result2.itemsWritten, 0);
    const sheet = ss.getSheetByName('Tally_Latest_Stock');
    assert.strictEqual(sheet.getLastRow(), 1, 'only the header row should remain');
  });

  test('13. tallyStockSync() defaults missing/None optional item fields to blank rather than throwing', function() {
    const ss = createMockSpreadsheet([]);
    const ctx = loadBackend(filePath, ss);
    const result = ctx.tallyStockSync({
      secret: 'correct-secret',
      items: [{ name: 'Sparse Item' }], // every other field intentionally absent
    });
    assert.strictEqual(result.status, 'success');
    const sheet = ss.getSheetByName('Tally_Latest_Stock');
    assert.strictEqual(sheet._data[1][0], 'Sparse Item');
    assert.strictEqual(sheet._data[1][1], ''); // Tally MASTERID
    assert.strictEqual(sheet._data[1][5], ''); // Current Stock Qty
  });

  test('14. tallyStockSync() never touches any tab other than Tally_Latest_Stock', function() {
    const masterItemSheet = createMockSheet('1. Master Item List', ['ARN', 'Item Name']);
    masterItemSheet.getRange(3, 1, 1, 2).setValues([['ACH-001', 'Untouched Item']]);
    const adjustmentLogSheet = createMockSheet('2. Adjustment Log', ['Adj ID']);
    const ss = createMockSpreadsheet([masterItemSheet, adjustmentLogSheet]);
    const ctx = loadBackend(filePath, ss);
    ctx.tallyStockSync({ secret: 'correct-secret', items: [makeItem()] });
    assert.deepStrictEqual(masterItemSheet._data[2], ['ACH-001', 'Untouched Item'], 'Master Item List data must be completely unaffected');
    assert.strictEqual(adjustmentLogSheet.getLastRow(), 1, 'Adjustment Log must be completely unaffected');
    assert.strictEqual(ss.getSheets().length, 3, 'exactly one new tab (Tally_Latest_Stock) should have been added, nothing else');
  });

  test('15. tallyStockSync() does not import or reference any Tally write mechanism', function() {
    const code = fs.readFileSync(filePath, 'utf8');
    const fnStart = code.indexOf('function tallyStockSync');
    const fnEnd = code.indexOf('\nfunction ', fnStart + 1);
    const fnBody = code.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.ok(fnBody.indexOf('UrlFetchApp') === -1, 'tallyStockSync() must never call out to Tally or any external HTTP endpoint -- it only writes to the Sheet');
  });
}

let anyFailures = false;
TARGET_FILES.forEach(function(fileName) {
  const filePath = path.join(__dirname, '..', fileName);
  if (!fs.existsSync(filePath)) {
    console.log('SKIP ' + fileName + ' (not found at ' + filePath + ')');
    return;
  }
  runSuiteAgainstFile(fileName, filePath);
  results.forEach(function(r) {
    if (r.pass) {
      console.log('  PASS - ' + r.name);
    } else {
      anyFailures = true;
      console.log('  FAIL - ' + r.name);
      console.log('         ' + (r.error && r.error.message ? r.error.message : r.error));
    }
  });
  const passCount = results.filter(function(r) { return r.pass; }).length;
  console.log(fileName + ': ' + passCount + '/' + results.length + ' passed');
});

if (anyFailures) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nPASSED');
  process.exit(0);
}
