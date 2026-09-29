/*
 * people-picker.js — shared type-to-search person selector.
 *
 * The people list's single source of truth is the Google Sheet tab
 * "Slack-user IDs", served by the existing backend `employees` action
 * (getEmployeeList() in Code.gs). Nothing here hardcodes a name.
 *
 * What it does
 *   - ONE `employees` request per page, shared by every picker on that page.
 *   - Caches the list in localStorage (TTL below) so later page loads open
 *     instantly; a stale-but-usable cache is refreshed quietly in the
 *     background. Opening a picker or typing NEVER makes a network request —
 *     filtering is purely local.
 *   - attach(input, opts) turns a plain text <input> into a combobox:
 *       focus/click  -> full scrollable list
 *       typing       -> instant case-insensitive filter (prefix, word-start,
 *                       then anywhere in the name)
 *       click / Enter-> select; Arrow Up/Down move; Escape closes
 *   - opts.strict === true : the value must be one of the sheet's names
 *     (anything else is cleared on blur) — for fields that used to be a
 *     <select>. Default (false) keeps free typing, like the old <datalist>.
 *
 * The value written to the input is always the exact name string from the
 * sheet, so the backend's name -> Slack ID / email matching
 * (getSlackUserId() / getEmployeeEmail()) behaves exactly as before.
 */
(function (root) {
  'use strict';

  var CACHE_KEY = 'achira_people_v1';
  var CACHE_TTL_MS = 6 * 60 * 60 * 1000;      // usable for 6 hours
  var CACHE_REFRESH_MS = 10 * 60 * 1000;      // silently refresh if older than 10 min
  var FETCH_TIMEOUT_MS = 20000;

  var appsScriptUrl = '';
  var people = null;            // string[] once known (memory cache)
  var inflight = null;          // shared Promise for the single network request
  var listeners = [];           // pickers to re-render when the list changes
  var lastError = false;

  // ---- pure helpers (exported for tests) ---------------------------------

  // trim, drop blanks, de-duplicate case-insensitively (first spelling wins),
  // sort alphabetically (case-insensitive).
  function normalizeList(names) {
    var seen = {};
    var out = [];
    (names || []).forEach(function (n) {
      var s = String(n == null ? '' : n).trim();
      if (!s) return;
      var k = s.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(s);
    });
    out.sort(function (a, b) {
      var x = a.toLowerCase(), y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return out;
  }

  // Ranked, case-insensitive local filter.
  //   0 = name starts with the query
  //   1 = a word inside the name starts with the query
  //   2 = the query appears anywhere in the name
  function filterNames(names, query) {
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return names.slice();
    var ranked = [];
    names.forEach(function (name, idx) {
      var n = name.toLowerCase();
      var pos = n.indexOf(q);
      if (pos === -1) return;
      var rank = pos === 0 ? 0 : (/[\s.\-_'(]/.test(n.charAt(pos - 1)) ? 1 : 2);
      ranked.push({ name: name, rank: rank, idx: idx });
    });
    ranked.sort(function (a, b) { return a.rank - b.rank || a.idx - b.idx; });
    return ranked.map(function (r) { return r.name; });
  }

  // exact (case-insensitive, trimmed) lookup -> canonical spelling or null
  function findExact(names, value) {
    var v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) return null;
    for (var i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === v) return names[i];
    }
    return null;
  }

  // ---- storage cache (never throws) --------------------------------------

  function readCache() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.names) || typeof obj.t !== 'number') return null;
      if (Date.now() - obj.t > CACHE_TTL_MS) return null;
      return obj;
    } catch (e) { return null; }
  }
  function writeCache(names) {
    try {
      if (root.localStorage) root.localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), names: names }));
    } catch (e) { /* storage blocked/full — memory cache still works */ }
  }

  // ---- network: one shared JSONP request ---------------------------------

  function fetchPeople() {
    if (inflight) return inflight;
    inflight = new Promise(function (resolve, reject) {
      if (!appsScriptUrl) { reject(new Error('PeoplePicker.configure(url) was not called')); return; }
      var cb = 'peoplePickerCb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      var script = root.document.createElement('script');
      var timer = setTimeout(function () {
        // Stop waiting, but don't discard a response that still arrives later (a slow
        // Apps Script cold start): keep a callback that adopts the late list instead of
        // throwing "callback is not defined" and losing it.
        root[cb] = function (late) {
          try { delete root[cb]; } catch (e) { root[cb] = undefined; }
          if (late && late.status === 'success' && Array.isArray(late.employees)) {
            people = normalizeList(late.employees);
            writeCache(people);
            lastError = false;
            notify();
          }
        };
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('timeout'));
      }, FETCH_TIMEOUT_MS);
      function cleanup() {
        clearTimeout(timer);
        try { delete root[cb]; } catch (e) { root[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      root[cb] = function (result) {
        cleanup();
        if (result && result.status === 'success' && Array.isArray(result.employees)) resolve(result.employees);
        else reject(new Error('bad response'));
      };
      script.onerror = function () { cleanup(); reject(new Error('script load failed')); };
      script.src = appsScriptUrl + (appsScriptUrl.indexOf('?') === -1 ? '?' : '&') + 'action=employees&callback=' + cb;
      root.document.body.appendChild(script);
    }).then(function (names) {
      var list = normalizeList(names);
      inflight = null;
      lastError = false;
      people = list;
      writeCache(list);
      notify();
      return list;
    }, function (err) {
      inflight = null;
      lastError = true;
      notify();
      throw err;
    });
    return inflight;
  }

  function notify() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } }); }

  // Kick off loading (idempotent). Uses a fresh-enough cache instantly.
  function ensureLoaded() {
    if (people) return;
    var cached = readCache();
    if (cached) {
      people = normalizeList(cached.names);
      notify();
      if (Date.now() - cached.t > CACHE_REFRESH_MS) fetchPeople().catch(function () { /* keep cached list */ });
      return;
    }
    fetchPeople().catch(function () { /* surfaced via lastError in each picker */ });
  }

  function configure(url) {
    appsScriptUrl = url || '';
    ensureLoaded();           // start loading immediately, before anyone focuses a field
  }

  // ---- UI ----------------------------------------------------------------

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected || !root.document) return;
    styleInjected = true;
    var s = root.document.createElement('style');
    s.textContent =
      '.pp-list{position:fixed;z-index:99999;background:#fff;border:1.5px solid #c9d3cf;border-radius:8px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.14);max-height:260px;overflow-y:auto;display:none;font-family:inherit;font-size:15px}' +
      '.pp-item{padding:9px 12px;cursor:pointer;color:#16211f}' +
      '.pp-item.pp-active,.pp-item:hover{background:#e6f1ed}' +
      '.pp-item b{font-weight:700}' +
      '.pp-note{padding:10px 12px;color:#6b7a75;font-size:14px;cursor:default}' +
      'input.pp-invalid{border-color:#c0392b !important}';
    root.document.head.appendChild(s);
  }

  var uid = 0;

  function attach(input, opts) {
    opts = opts || {};
    var strict = !!opts.strict;
    injectStyle();

    // The old <datalist> would double-render next to this list.
    if (input.removeAttribute) input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var doc = root.document;
    var listId = 'pp-list-' + (++uid);
    var list = doc.createElement('div');
    list.className = 'pp-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    doc.body.appendChild(list);
    input.setAttribute('aria-controls', listId);

    var open = false;
    var selecting = false;   // true while choose() dispatches its own input/change events
    var shown = [];      // names currently rendered
    var active = -1;

    function position() {
      var r = input.getBoundingClientRect();
      list.style.left = r.left + 'px';
      list.style.top = (r.bottom + 2) + 'px';
      list.style.width = r.width + 'px';
    }

    function note(text) {
      var d = doc.createElement('div');
      d.className = 'pp-note';
      d.textContent = text;
      list.appendChild(d);
    }

    function render() {
      while (list.firstChild) list.removeChild(list.firstChild);
      shown = [];
      active = -1;
      if (!people) {
        note((lastError && !inflight) ? (strict ? "Couldn't load names — try reloading" : "Couldn't load names — you can still type one") : 'Loading names…');   // a retry in flight shows Loading, not the old error
        return;
      }
      shown = filterNames(people, input.value);
      if (!shown.length) { note('No matching names'); return; }
      var q = String(input.value || '').trim();
      shown.forEach(function (name, i) {
        var item = doc.createElement('div');
        item.className = 'pp-item';
        item.id = listId + '-' + i;
        item.setAttribute('role', 'option');
        var pos = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
        if (pos > -1) {
          item.appendChild(doc.createTextNode(name.slice(0, pos)));
          var b = doc.createElement('b');
          b.textContent = name.slice(pos, pos + q.length);
          item.appendChild(b);
          item.appendChild(doc.createTextNode(name.slice(pos + q.length)));
        } else {
          item.textContent = name;
        }
        // mousedown (not click) so the input keeps focus and blur can't fire first
        item.addEventListener('mousedown', function (e) { if (e.preventDefault) e.preventDefault(); choose(i); });
        list.appendChild(item);
      });
    }

    function setActive(i) {
      var items = list.children;
      if (active > -1 && items[active] && items[active].classList) items[active].classList.remove('pp-active');
      active = i;
      if (i > -1 && items[i]) {
        items[i].classList.add('pp-active');
        input.setAttribute('aria-activedescendant', items[i].id);
        if (items[i].scrollIntoView) items[i].scrollIntoView({ block: 'nearest' });
      } else if (input.removeAttribute) {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function openList() {
      ensureLoaded();            // also retries after an earlier failed load
      open = true;
      position();
      render();
      list.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');
    }
    function closeList() {
      open = false;
      list.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    function fire(type) {
      var ev;
      try { ev = new root.Event(type, { bubbles: true }); } catch (e) { ev = doc.createEvent('Event'); ev.initEvent(type, true, false); }
      input.dispatchEvent(ev);
    }

    function choose(i) {
      if (i < 0 || i >= shown.length) return;
      input.value = shown[i];
      var picked = shown[i];
      input.classList.remove('pp-invalid');
      closeList();
      selecting = true;
      try { fire('input'); fire('change'); } finally { selecting = false; }
      if (typeof opts.onSelect === 'function') opts.onSelect(picked);
    }

    input.addEventListener('focus', openList);
    input.addEventListener('click', function () { if (!open) openList(); });
    input.addEventListener('input', function () {
      if (selecting) return;
      input.classList.remove('pp-invalid');
      if (!open) openList(); else render();
    });

    input.addEventListener('keydown', function (e) {
      var key = e.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        if (!open) openList();
        if (!shown.length) return;
        if (e.preventDefault) e.preventDefault();
        var next = key === 'ArrowDown' ? active + 1 : active - 1;
        if (next >= shown.length) next = 0;
        if (next < 0) next = shown.length - 1;
        setActive(next);
      } else if (key === 'Enter') {
        if (open && active > -1) { if (e.preventDefault) e.preventDefault(); choose(active); }
      } else if (key === 'Escape') {
        if (open) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); closeList(); }
      } else if (key === 'Tab') {
        closeList();
      }
    });

    function validate() {
      var v = String(input.value || '').trim();
      if (!v) { input.value = ''; return; }
      if (!people) return;                       // list not available: leave the text alone
      var exact = findExact(people, v);
      if (exact) { input.value = exact; return; }   // normalise to the sheet's exact spelling
      if (strict) {
        input.value = '';
        input.classList.add('pp-invalid');
        setTimeout(function () { input.classList.remove('pp-invalid'); }, 1800);
      }
    }

    input.addEventListener('blur', function () {
      closeList();
      validate();
      // A strict field must never keep unverified text: if the list was still
      // loading when the user left the field, validate as soon as it arrives.
      if (strict && !people && String(input.value || '').trim()) {
        api.getPeople().then(function () { if (doc.activeElement !== input) validate(); }, function () {});
      }
    });

    root.addEventListener('resize', function () { if (open) position(); });
    root.addEventListener('scroll', function () { if (open) position(); }, true);
    listeners.push(function () { if (open) render(); });

    ensureLoaded();
    return { close: closeList, open: openList, validate: validate };
  }

  var api = {
    configure: configure,
    attach: attach,
    getPeople: function () { ensureLoaded(); return people ? Promise.resolve(people) : fetchPeople(); },
    normalizeList: normalizeList,
    filterNames: filterNames,
    findExact: findExact,
    _reset: function () { people = null; inflight = null; listeners = []; lastError = false; appsScriptUrl = ''; },
    CACHE_KEY: CACHE_KEY,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PeoplePicker = api;
})(typeof window !== 'undefined' ? window : globalThis);
