/**
 * admin-samoa-master.js  —  Samoa Scholar Database Admin Controller.
 *
 * Samoa-native controller written from scratch, driven declaratively by
 * the MAPPING block published by apps-script/samoa-master-writeback.gs.
 * Since MAPPING is the exact row-4 header list from the live Samoa Master
 * Sheet, the admin form can never drift from the sheet: adding a column
 * to the sheet + regenerating MAPPING is enough for the field to appear
 * here.
 *
 * Design commitments (Samoa build, no aliases):
 *   • Six geography dimensions (Statistical Region, Political/Census
 *     District, Village, Specific Island, Traditional Itūmālō, Electoral
 *     Constituency) are edited as SIX independent fields, never chained
 *     and never auto-derived from one another.
 *   • Every payload key is the EXACT row-4 header from the Samoa sheet
 *     — no relabeling on the wire.
 *   • Every localStorage key is `samoalab.*`.
 *   • Every image path lives at `img/scholars/samoa/`.
 *   • ALWAYS_CONFIRM fields (declared on the server side as well) always
 *     receive a plain-language confirmation before submit, even when the
 *     new value equals the old one.
 *
 * Pipeline:
 *   1. Admin unlocks with the admin password (SHA-256 checked client-side
 *      against ADMIN_PASSWORD_HASH_HEX baked into admin-samoa-master.html).
 *   2. Boot fetches the current MAPPING from the writeback (`describe`)
 *      and renders the tab-switcher + a form for the selected worksheet.
 *   3. User picks a row-key value (existing row) — the corresponding
 *      Master snapshot is loaded from the encrypted samoa-master-*.json.enc
 *      file via window.samoaDbGate, and the form fields are populated.
 *   4. On submit, ONLY the changed fields are sent via
 *      window.samoaWriteback.updateRow(...). ALWAYS_CONFIRM fields prompt.
 *   5. The writeback response is displayed; on success, the admin may
 *      trigger a public-refresh dispatch (see triggerPublicRefresh()) if
 *      any changed field is in the "public-facing" set.
 *
 * This controller depends on:
 *   • window.samoaDbGate           (js/samoa-db-gate.js)
 *   • window.samoaWriteback        (js/samoa-admin-writeback-client.js)
 *   • window.samoaInsightsMigration (js/samoa-admin-insights-migration.js)
 *
 * It does NOT depend on any sister-jurisdiction module.
 */
(function (global) {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  var SESSION_KEY = 'samoalab.admin.session.v1';
  var SESSION_TTL_MS = 8 * 60 * 60 * 1000;   // 8 hours
  var GH_TOKEN_KEY = 'samoalab.gh_token';    // GitHub PAT (Ron-supplied)

  // Public-facing fields — any change to one of these triggers a refresh
  // of the encrypted Master snapshot files that the public dashboard
  // reads. Keys are `<worksheet>.<field>` (exact row-4 headers).
  //
  // NB: only Samoa-native fields appear here. Nothing on this list ever
  // references a sister-jurisdiction geography concept.
  var PUBLIC_FACING_FIELDS = {
    // Scholars — displayed on the public scholar card
    'Scholars.Display Name': true,
    'Scholars.Family Name': true,
    'Scholars.Given Names': true,
    'Scholars.Title / Salutation': true,
    'Scholars.Gender': true,
    'Scholars.Birth Year': true,
    'Scholars.Death Year': true,
    'Scholars.Living Status': true,
    'Scholars.Photo URL': true,
    'Scholars.Samoan Status': true,
    'Scholars.Inclusion Status': true,
    'Scholars.Statistical Region (Paternal)': true,
    'Scholars.Political/Census District (Paternal)': true,
    'Scholars.Village (Paternal)': true,
    'Scholars.Specific Island (Paternal)': true,
    'Scholars.Traditional Itūmālō (Paternal)': true,
    'Scholars.Electoral Constituency (Paternal)': true,
    'Scholars.Primary Discipline / Field': true,
    'Scholars.Current Title / Role': true,
    'Scholars.Current Institution': true,
    'Scholars.Institution Country': true,
    'Scholars.Current Department / Unit': true,
    'Scholars.Current PG Status': true,
    // Publications — count derivations feed the discipline breakdown
    'Publications.Publication Type': true,
    'Publications.Year': true
  };

  // Fields where any edit — even a no-op — pops a confirmation. Mirrors
  // apps-script/samoa-master-writeback.gs's ALWAYS_CONFIRM.
  var ALWAYS_CONFIRM = {
    'Scholars.Living Status': true,
    'Scholars.Review Status': true,
    'Scholars.Roster Tier': true,
    'Scholars.Inclusion Status': true
  };

  // ── State ────────────────────────────────────────────────────────────────
  var state = {
    mapping: null,          // { version, worksheets: { name: { keyColumn, fields } } }
    activeWorksheet: null,  // string
    activeKey: null,        // current row key value
    original: {},           // field → server value (pre-edit snapshot)
    edited: {},             // field → new value (only if user changed it)
    scholars: [],           // list of {Scholar ID, Display Name} for pickers
    unlocked: false
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') e.textContent = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else e.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      });
    }
    return e;
  }
  function status(msg, isError) {
    var box = $('samoa-admin-status');
    if (!box) return;
    box.textContent = msg;
    box.className = 'samoa-admin-status' + (isError ? ' samoa-admin-status--error' : '');
  }

  // ── SHA-256 ─────────────────────────────────────────────────────────────
  function sha256Hex(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      .then(function (buf) {
        var bytes = new Uint8Array(buf), out = '';
        for (var i = 0; i < bytes.length; i++) {
          var h = bytes[i].toString(16);
          out += (h.length === 1 ? '0' : '') + h;
        }
        return out;
      });
  }

  // ── Admin login gate ────────────────────────────────────────────────────
  function checkAdminSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.exp !== 'number' || Date.now() > obj.exp) {
        localStorage.removeItem(SESSION_KEY);
        return false;
      }
      return true;
    } catch (e) { return false; }
  }
  function markAdminSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ exp: Date.now() + SESSION_TTL_MS }));
    } catch (e) {}
  }
  function clearAdminSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function attemptLogin(password) {
    var expected = global.SAMOA_ADMIN_PASSWORD_HASH_HEX;
    if (!expected) {
      return Promise.reject(new Error(
        'admin-samoa-master: SAMOA_ADMIN_PASSWORD_HASH_HEX is not baked into the page'
      ));
    }
    return sha256Hex(password).then(function (hex) {
      // Constant-time compare
      if (hex.length !== expected.length) return false;
      var diff = 0;
      for (var i = 0; i < hex.length; i++) {
        diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
      }
      return diff === 0;
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  function boot() {
    // Wire login form
    var loginBtn = $('samoa-admin-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var pw = ($('samoa-admin-password') || {}).value || '';
        var dataPw = ($('samoa-admin-data-passcode') || {}).value || '';
        attemptLogin(pw).then(function (ok) {
          if (!ok) { status('Incorrect admin password.', true); return; }
          markAdminSession();
          return global.samoaDbGate.unlock(dataPw).then(function (dataOk) {
            if (!dataOk) { status('Admin OK — but the data passcode is incorrect.', true); return; }
            state.unlocked = true;
            showAdminSurface();
            loadMapping();
          });
        }).catch(function (e) { status(e.message, true); });
      });
    }

    // Resume if we already have an unexpired admin session
    if (checkAdminSession()) {
      var resumed = global.samoaDbGate.tryResume();
      if (resumed) {
        state.unlocked = true;
        showAdminSurface();
        loadMapping();
      }
    }

    // Logout
    var logoutBtn = $('samoa-admin-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        clearAdminSession();
        global.samoaDbGate.clearSession();
        location.reload();
      });
    }
  }

  function showAdminSurface() {
    var login = $('samoa-admin-login');
    var surface = $('samoa-admin-surface');
    if (login) login.style.display = 'none';
    if (surface) surface.style.display = 'block';
  }

  // ── Load MAPPING from writeback ─────────────────────────────────────────
  function loadMapping() {
    status('Fetching the current MAPPING from the writeback…');
    global.samoaWriteback.describe('admin').then(function (body) {
      if (!body || body.status !== 'ok' || !body.mapping || !body.mapping.worksheets) {
        throw new Error('Bad describe response');
      }
      state.mapping = body.mapping;
      renderWorksheetTabs();
      status('Ready. Server writeEnabled = ' + (body.writeEnabled ? 'yes' : 'no') +
             ' · actor = ' + (body.actor || 'admin'));
    }).catch(function (e) {
      status('MAPPING fetch failed: ' + e.message +
             ' — check SAMOA_WRITEBACK_URL / SAMOA_WRITEBACK_SECRET_HEX in the page.', true);
    });
  }

  // ── Worksheet tabs ──────────────────────────────────────────────────────
  function renderWorksheetTabs() {
    var host = $('samoa-admin-tabs');
    if (!host) return;
    host.innerHTML = '';
    var names = Object.keys(state.mapping.worksheets).sort();
    names.forEach(function (name) {
      var btn = el('button', {
        class: 'samoa-admin-tab',
        type: 'button',
        text: name,
        onclick: function () { selectWorksheet(name); }
      });
      host.appendChild(btn);
    });
    if (names.length) selectWorksheet(names[0]);
  }

  function selectWorksheet(name) {
    state.activeWorksheet = name;
    state.activeKey = null;
    state.original = {};
    state.edited = {};

    // Highlight tab
    Array.prototype.forEach.call(document.querySelectorAll('.samoa-admin-tab'), function (b) {
      b.classList.toggle('samoa-admin-tab--active', b.textContent === name);
    });

    renderKeyPicker();
    renderForm();
  }

  // ── Key picker ──────────────────────────────────────────────────────────
  function renderKeyPicker() {
    var host = $('samoa-admin-keypicker');
    if (!host) return;
    var spec = state.mapping.worksheets[state.activeWorksheet];
    host.innerHTML = '';

    var label = el('label', { text: spec.keyColumn + ': ', for: 'samoa-admin-key-input' });
    var input = el('input', {
      id: 'samoa-admin-key-input',
      type: 'text',
      placeholder: spec.keyColumn,
      autocomplete: 'off'
    });
    var loadBtn = el('button', {
      type: 'button',
      class: 'samoa-admin-load-btn',
      text: 'Load row',
      onclick: function () { loadRow(input.value.trim()); }
    });
    host.appendChild(label);
    host.appendChild(input);
    host.appendChild(loadBtn);
  }

  // ── Form rendering ──────────────────────────────────────────────────────
  function renderForm() {
    var host = $('samoa-admin-form');
    if (!host) return;
    host.innerHTML = '';

    var spec = state.mapping.worksheets[state.activeWorksheet];
    if (!spec) return;

    // Group fields into logical fieldsets. This is the ONE place where
    // Samoa geography discipline is enforced: paternal and maternal each
    // get six independent fields in a stable, labelled order.
    var groups = groupFields(state.activeWorksheet, spec);
    groups.forEach(function (g) {
      var fs = el('fieldset', { class: 'samoa-admin-fieldset' });
      fs.appendChild(el('legend', { text: g.label }));
      g.fields.forEach(function (fname) {
        var fspec = spec.fields[fname];
        if (!fspec) return;   // key column ends up here too — skip
        fs.appendChild(renderFieldRow(fname, fspec));
      });
      host.appendChild(fs);
    });

    // Submit + reset row
    var actions = el('div', { class: 'samoa-admin-actions' });
    actions.appendChild(el('button', {
      type: 'button', class: 'samoa-admin-submit', text: 'Submit changes',
      onclick: submitChanges
    }));
    actions.appendChild(el('button', {
      type: 'button', class: 'samoa-admin-reset', text: 'Discard edits',
      onclick: function () {
        state.edited = {};
        renderForm();  // re-render will paint values from state.original
      }
    }));
    host.appendChild(actions);
  }

  function groupFields(worksheet, spec) {
    // Six independent geography dimensions are always grouped together
    // (paternal, then maternal), never interleaved with unrelated fields
    // and never chained. Every other field falls into a "Details" bucket
    // preserving MAPPING order.
    var all = Object.keys(spec.fields);

    var paternalGeo = [
      'Statistical Region (Paternal)',
      'Political/Census District (Paternal)',
      'Village (Paternal)',
      'Specific Island (Paternal)',
      'Traditional Itūmālō (Paternal)',
      'Electoral Constituency (Paternal)'
    ].filter(function (n) { return all.indexOf(n) !== -1; });

    var maternalGeo = [
      'Statistical Region (Maternal)',
      'Political/Census District (Maternal)',
      'Village (Maternal)',
      'Specific Island (Maternal)',
      'Traditional Itūmālō (Maternal)',
      'Electoral Constituency (Maternal)'
    ].filter(function (n) { return all.indexOf(n) !== -1; });

    var claimed = {};
    paternalGeo.concat(maternalGeo).forEach(function (n) { claimed[n] = true; });

    var otherFields = all.filter(function (n) { return !claimed[n]; });

    var groups = [];
    if (paternalGeo.length) groups.push({
      label: 'Geography — Paternal (six independent dimensions)',
      fields: paternalGeo
    });
    if (maternalGeo.length) groups.push({
      label: 'Geography — Maternal (six independent dimensions)',
      fields: maternalGeo
    });
    if (otherFields.length) groups.push({
      label: 'Details',
      fields: otherFields
    });

    return groups;
  }

  function currentValue(fname) {
    if (Object.prototype.hasOwnProperty.call(state.edited, fname)) return state.edited[fname];
    if (Object.prototype.hasOwnProperty.call(state.original, fname)) return state.original[fname];
    return '';
  }

  function renderFieldRow(fname, fspec) {
    var row = el('div', { class: 'samoa-admin-row' });
    var lab = el('label', { text: fname });
    var qualifiedKey = state.activeWorksheet + '.' + fname;
    if (ALWAYS_CONFIRM[qualifiedKey]) {
      lab.appendChild(el('span', {
        class: 'samoa-admin-row__badge',
        text: 'confirm',
        title: 'Any change to this field pops a confirmation before submit.'
      }));
    }
    if (PUBLIC_FACING_FIELDS[qualifiedKey]) {
      lab.appendChild(el('span', {
        class: 'samoa-admin-row__badge samoa-admin-row__badge--public',
        text: 'public',
        title: 'This field appears on the public scholar card. A change will trigger a public-refresh dispatch.'
      }));
    }
    row.appendChild(lab);

    var val = currentValue(fname);
    var input;
    if (fspec.type === 'enum' && Array.isArray(fspec.enum)) {
      input = el('select', { class: 'samoa-admin-field' });
      fspec.enum.forEach(function (opt) {
        var o = el('option', { value: opt, text: opt === '' ? '(blank)' : opt });
        if (opt === val) o.setAttribute('selected', 'selected');
        input.appendChild(o);
      });
    } else if (fspec.type === 'bool') {
      input = el('select', { class: 'samoa-admin-field' });
      ['', 'TRUE', 'FALSE'].forEach(function (opt) {
        var o = el('option', { value: opt, text: opt === '' ? '(blank)' : opt });
        if (opt === val) o.setAttribute('selected', 'selected');
        input.appendChild(o);
      });
    } else if (fspec.type === 'string' && (fspec.maxLen || 0) > 300) {
      input = el('textarea', { class: 'samoa-admin-field samoa-admin-field--long', rows: '4' });
      input.value = val || '';
    } else {
      input = el('input', {
        class: 'samoa-admin-field',
        type: (fspec.type === 'int' || fspec.type === 'year') ? 'number' :
              (fspec.type === 'url') ? 'url' :
              (fspec.type === 'date') ? 'text' : 'text',
        value: (val === null || val === undefined) ? '' : String(val),
        maxlength: fspec.maxLen || ''
      });
    }
    input.addEventListener('change', function () {
      var nv = input.value;
      if (nv === state.original[fname]) {
        delete state.edited[fname];
      } else {
        state.edited[fname] = nv;
      }
      updateChangeIndicator();
    });
    row.appendChild(input);

    var hint = el('div', { class: 'samoa-admin-row__hint', text: hintFor(fspec) });
    row.appendChild(hint);
    return row;
  }

  function hintFor(fspec) {
    var parts = [fspec.type];
    if (fspec.maxLen)  parts.push('maxLen ' + fspec.maxLen);
    if (fspec.min !== undefined) parts.push('min ' + fspec.min);
    if (fspec.max !== undefined) parts.push('max ' + fspec.max);
    if (fspec.pattern) parts.push('pattern');
    return parts.join(' · ');
  }

  function updateChangeIndicator() {
    var n = Object.keys(state.edited).length;
    var host = $('samoa-admin-change-count');
    if (host) host.textContent = n === 0 ? 'no pending changes' : (n + ' pending change' + (n === 1 ? '' : 's'));
  }

  // ── Load an existing row ────────────────────────────────────────────────
  function loadRow(keyValue) {
    if (!keyValue) { status('Enter a row key first.', true); return; }
    var ws = state.activeWorksheet;
    status('Loading ' + ws + ' row ' + keyValue + '…');

    // Load the appropriate Master snapshot. The mapping between worksheet
    // and snapshot file is Samoa-specific and lives here (not in a shared
    // adapter) so that adding a new snapshot file does not require editing
    // a cross-jurisdiction module.
    var snapshotPath = snapshotPathFor(ws);
    if (!snapshotPath) {
      status('No snapshot mapping for worksheet "' + ws + '" — cannot load pre-existing values.', true);
      state.activeKey = keyValue;
      state.original = {};
      state.edited = {};
      renderForm();
      return;
    }
    global.samoaDbGate.decryptFileJSON(snapshotPath).then(function (blob) {
      var rows = extractRows(blob, ws);
      var spec = state.mapping.worksheets[ws];
      var kc = spec.keyColumn;
      var match = rows.filter(function (r) { return String(r[kc]) === String(keyValue); })[0];
      state.activeKey = keyValue;
      state.original = match || {};
      state.edited = {};
      renderForm();
      status(match ? ('Loaded ' + ws + '.' + keyValue) :
                     ('No existing ' + ws + ' row for ' + keyValue + '. Form is blank; submit will create the row.'));
    }).catch(function (e) {
      status('Snapshot load failed: ' + e.message +
             ' — you can still submit; the writeback will validate and reject if the key does not exist.', true);
      state.activeKey = keyValue;
      state.original = {};
      state.edited = {};
      renderForm();
    });
  }

  // Worksheet name → snapshot file (relative path, as known to samoaDbGate).
  // Only worksheets whose contents actually ship to the public dashboard
  // have a snapshot; internal-only audit tabs are edited blind (server-side
  // validation still applies).
  function snapshotPathFor(ws) {
    var m = {
      'Scholars':                          'data/samoa-master-scholars.json',
      'Publications':                      'data/samoa-master-publications.json',
      'Authorship':                        'data/samoa-master-authorship.json',
      'Researcher Authorship':             'data/samoa-master-researcher-authorship.json',
      'Graduate Degrees':                  'data/samoa-master-grad-degrees.json',
      'M>PhD Mobility':                    'data/samoa-master-mobility.json',
      'Research Geography':                'data/samoa-master-geography.json'
    };
    return m[ws] || null;
  }

  // Master snapshot shape is {worksheets: {<name>: {rows: [...]}}} for the
  // canonical refresh workflow; older shapes fall back to {<name>: [...]}.
  function extractRows(blob, ws) {
    if (blob && blob.worksheets && blob.worksheets[ws] && Array.isArray(blob.worksheets[ws].rows)) {
      return blob.worksheets[ws].rows;
    }
    if (blob && Array.isArray(blob[ws])) return blob[ws];
    if (blob && Array.isArray(blob.rows)) return blob.rows;
    return [];
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  function submitChanges() {
    if (!state.activeWorksheet || !state.activeKey) {
      status('Pick a worksheet and load a row first.', true);
      return;
    }
    var edited = state.edited;
    var editedKeys = Object.keys(edited);
    if (!editedKeys.length) { status('Nothing to submit.', true); return; }

    // ALWAYS_CONFIRM prompt
    var qualified = editedKeys.map(function (f) { return state.activeWorksheet + '.' + f; });
    var mustConfirm = qualified.filter(function (q) { return ALWAYS_CONFIRM[q]; });
    if (mustConfirm.length) {
      var ok = confirm(
        'You are about to change these high-consequence fields on ' +
        state.activeWorksheet + ':\n\n' +
        mustConfirm.map(function (q) { return '  • ' + q.split('.').slice(1).join('.'); }).join('\n') +
        '\n\nThis will overwrite the current Master Sheet values. Proceed?'
      );
      if (!ok) return;
    }

    status('Submitting ' + editedKeys.length + ' change(s)…');
    global.samoaWriteback.updateRow(state.activeWorksheet, state.activeKey, edited, 'admin')
      .then(function (body) {
        // Merge the submitted edits into the local "original" snapshot so
        // the form now reflects the server state.
        editedKeys.forEach(function (k) { state.original[k] = edited[k]; });
        var publicHit = qualified.some(function (q) { return PUBLIC_FACING_FIELDS[q]; });
        state.edited = {};
        renderForm();
        var suffix = publicHit
          ? ' — this change is public-facing; run "Refresh public data" to publish.'
          : ' — non-public change; no public refresh needed.';
        status('Saved. Server response: ' + (body.message || 'ok') + suffix);
      })
      .catch(function (e) {
        status('Save failed: ' + e.message, true);
      });
  }

  // ── Trigger the Samoa public refresh workflow ───────────────────────────
  // Requires a GitHub PAT stored in localStorage.samoalab.gh_token with
  // `workflow` scope. Kicks the refresh-samoa-master-file.yml dispatch
  // so the public dashboard sees the change on the next fetch.
  function triggerPublicRefresh() {
    var token = '';
    try { token = localStorage.getItem(GH_TOKEN_KEY) || ''; } catch (e) {}
    if (!token) {
      status('No samoalab.gh_token set — cannot dispatch refresh. Set the token in Settings first.', true);
      return;
    }
    var url = 'https://api.github.com/repos/ronvave/vave-lab/actions/workflows/refresh-samoa-master-file.yml/dispatches';
    return fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main', inputs: { source: 'samoa-admin' } })
    }).then(function (resp) {
      if (resp.status === 204) {
        status('Refresh dispatched. The public dashboard will pick up changes on its next fetch (typically within 2 minutes of the workflow finishing).');
      } else {
        return resp.text().then(function (t) { throw new Error('HTTP ' + resp.status + ' — ' + t); });
      }
    }).catch(function (e) {
      status('Refresh dispatch failed: ' + e.message, true);
    });
  }

  // ── Export a tiny surface for tests + the "Refresh public data" button ──
  global.samoaAdmin = {
    boot: boot,
    triggerPublicRefresh: triggerPublicRefresh,
    _state: state,        // read-only inspection in devtools
    _sha256Hex: sha256Hex
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
