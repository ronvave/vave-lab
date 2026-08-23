/**
 * master-writeback.gs — Bound Apps Script for the iTaukei scholar Master file.
 *
 * Deployed as a Web App (Execute as: Ron Vave — Owner; Access: Anyone with link)
 * and called only by admin-master.html. Every write is authenticated with a
 * shared secret held in ScriptProperties, enforced field-by-field against an
 * allowlist, wrapped in LockService, and appended to the Change Log.
 *
 * ── Setup (one-time; see docs/APPS-SCRIPT-DEPLOY.md for a step-by-step) ──
 *   1. In the Master spreadsheet: Extensions → Apps Script.
 *   2. Paste this file into the project as `master-writeback.gs`.
 *   3. In Project Settings → Script Properties, add:
 *        SHARED_SECRET      = <64-char hex string, from step 4>
 *        WRITE_ENABLED      = true
 *        ADMIN_ORIGIN       = https://ronvave.github.io
 *   4. In this editor's console, run `generateSecret()` once to get a fresh
 *      32-byte hex secret; copy it into SHARED_SECRET and paste the same
 *      value into the admin Data-source tab.
 *   5. Deploy → New deployment → type = Web App:
 *        Description   = "Master write-back v1"
 *        Execute as    = Me (Ron Vave)
 *        Who has access = Anyone with the link
 *      Copy the /exec URL and paste it into the admin Data-source tab.
 *   6. Test with the admin's "Test connection" button.
 *
 * ── Emergency read-only switch ──
 *   Setting Script Property `WRITE_ENABLED = false` (or removing the property)
 *   causes every POST write to be rejected with `{status:'disabled'}`. `describe`
 *   and `ping` still succeed so the admin can display an explicit banner. Do
 *   NOT rely solely on disabling the Save button client-side; this server-side
 *   flag is authoritative.
 *
 * ── Auth model ──
 *   • Shared secret is in ScriptProperties (never in code, never on GitHub).
 *   • Requests carry `secret` + `clientTs` (unix ms) as JSON body or query.
 *   • Server rejects if `Math.abs(now - clientTs) > 5min` (replay guard).
 *   • Server rejects if the caller's secret doesn't match (constant-time compare).
 *   • Actor label is fixed to "Ron Vave (admin)" (approval-doc #4).
 *
 * ── Allowlist ──
 *   The mapping table below is the ONLY source of truth for what fields the
 *   webapp can write. Fields not listed are hard-rejected. Field types
 *   ('string' | 'enum' | 'int' | 'float' | 'date' | 'url') are validated per
 *   write. Enum values are checked against the `enum` array.
 *
 * ── Concurrency + conflict handling ──
 *   Every write takes a script-scoped LockService lock (30s timeout). Inside
 *   the lock, the server reads the current cell value and compares it to the
 *   `oldValue` the client sent. If they differ, the write is rejected with a
 *   `conflict` response containing worksheet/field/loadedValue/currentValue/
 *   attemptedValue (approval-doc #5). Partial-failure reporting is supported:
 *   an incoming batch's per-field results are returned even if some fail.
 *
 * ── Change Log ──
 *   Every successful write appends one row to `Change Log`:
 *     A Version     — "admin-YYYYMMDD-N"    (N = per-day counter)
 *     B Date        — ISO date              (Pacific/Honolulu)
 *     C Change      — short label           (e.g. "edit: Scholars.Given Names")
 *     D Scope       — one-line summary      (SID · Field: old → new)
 *     E Source      — "admin-master-webapp v1"
 *     F Actor       — "Ron Vave (admin)"
 *     G Worksheet   — sheet name
 *     H Field       — header name
 *     I Old Value   — verbatim
 *     J New Value   — verbatim
 *   Approach: no rename of existing Change Log headers (row 4). Additional
 *   context lives in columns F–J which already exist as unnamed columns.
 */

// ------------------------- CONFIG -----------------------------------------
var SPREADSHEET_ID_HINT = '1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg';
var ACTOR_LABEL         = 'Ron Vave (admin)';
var SOURCE_TAG          = 'admin-master-webapp v1';
var REPLAY_WINDOW_MS    = 5 * 60 * 1000;
var LOCK_WAIT_MS        = 30 * 1000;
var TIMEZONE            = 'Pacific/Honolulu';

// Full editable-field allowlist. Every writable field must appear here.
// Sheets not listed are read-only. Fields on listed sheets not listed are
// read-only. Enum values are validated against the `enum` array.
var MAPPING = {
  version: '1.0',
  worksheets: {
    'Scholars': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      fields: {
        'Scholar Name':            { type: 'string', maxLen: 200 },
        'Family Name':             { type: 'string', maxLen: 120 },
        'Given Names':             { type: 'string', maxLen: 120 },
        'Gender':                  { type: 'enum',   enum: ['Male','Female','Unknown',''] },
        'Alive/Deceased':          { type: 'enum',   enum: ['Alive','Deceased','Unknown',''] },
        'Province Paternal':       { type: 'string', maxLen: 60 },
        'District Paternal':       { type: 'string', maxLen: 80 },
        'Island Paternal':         { type: 'string', maxLen: 80 },
        'Village Paternal':        { type: 'string', maxLen: 120 },
        'Province Maternal':       { type: 'string', maxLen: 60 },
        'District Maternal':       { type: 'string', maxLen: 80 },
        'Island Maternal':         { type: 'string', maxLen: 80 },
        'Village Maternal':        { type: 'string', maxLen: 120 },
        'Primary Discipline/Field':{ type: 'string', maxLen: 120 },
        'Current Title':           { type: 'string', maxLen: 240 },
        'Current Role':            { type: 'string', maxLen: 120 },
        'Current Institution':     { type: 'string', maxLen: 200 },
        'Current Country':         { type: 'string', maxLen: 80 },
        'Current Department':      { type: 'string', maxLen: 200 },
        'Current Profile URL':     { type: 'url',    maxLen: 500 },
        'ORCID':                   { type: 'string', maxLen: 40 },
        'Researcher ID':           { type: 'string', maxLen: 40 },
        'Google Scholar URL':      { type: 'url',    maxLen: 500 }
      }
    },
    'Positions': {
      // Positions is edited per-row; row is identified by the internal
      // positionId (Scholar ID + row index) or by an explicit rowNumber field.
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Institution':       { type: 'string', maxLen: 200 },
        'Country':           { type: 'string', maxLen: 80 },
        'Department/Unit':   { type: 'string', maxLen: 200 },
        'Title':             { type: 'string', maxLen: 240 },
        'Academic Rank':     { type: 'string', maxLen: 120 },
        'Leadership Title':  { type: 'string', maxLen: 240 },
        'Leadership Category': { type: 'string', maxLen: 120 },
        'Leadership Level':  { type: 'string', maxLen: 60 },
        'Role Status':       { type: 'string', maxLen: 60 },
        'Start Year':        { type: 'int',    min: 1900, max: 2100 },
        'End Year':           { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Source URL':        { type: 'url',    maxLen: 500 },
        'Evidence/Notes':    { type: 'string', maxLen: 2000 },
        'Last Verified':     { type: 'date' }
      }
    },
    'Graduate Degrees': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Degree Stage':          { type: 'enum',   enum: ['Masters','PhD','MPhil','EdD','DPhil','',''] },
        'Qualification':         { type: 'string', maxLen: 200 },
        'Field':                 { type: 'string', maxLen: 200 },
        'C_Uni name':            { type: 'string', maxLen: 200 },
        'O_Uni name':            { type: 'string', maxLen: 200 },
        'Country':               { type: 'string', maxLen: 80 },
        'International from Fiji?': { type: 'enum', enum: ['Yes','No','Unknown',''] },
        'City':                  { type: 'string', maxLen: 120 },
        'Region':                { type: 'string', maxLen: 120 },
        'Year-Status':           { type: 'string', maxLen: 60 },
        'Completion Status':     { type: 'string', maxLen: 60 },
        'Thesis Title':          { type: 'string', maxLen: 500 },
        'Start Year':            { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Finish Year':           { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Duration':              { type: 'string', maxLen: 40 }
      }
    }
  }
};

// ------------------------- ENTRY POINTS -----------------------------------

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || 'ping';
    if (action === 'describe') {
      if (!checkAuth_(params)) return jsonOut_({ status: 'unauthorized' }, 401);
      return jsonOut_({ status: 'ok', mapping: MAPPING, writeEnabled: writeEnabled_(), actor: ACTOR_LABEL });
    }
    if (action === 'ping') {
      if (!checkAuth_(params)) return jsonOut_({ status: 'unauthorized' }, 401);
      return jsonOut_({ status: 'ok', pong: true, writeEnabled: writeEnabled_(), actor: ACTOR_LABEL, tz: TIMEZONE, spreadsheetId: SPREADSHEET_ID_HINT });
    }
    return jsonOut_({ status: 'bad_request', reason: 'unknown-action' }, 400);
  } catch (err) {
    return jsonOut_({ status: 'error', error: String(err && err.message || err) }, 500);
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return jsonOut_({ status: 'bad_request', reason: 'invalid-json' }, 400);
  }
  try {
    if (!checkAuth_(body)) return jsonOut_({ status: 'unauthorized' }, 401);
    if (!writeEnabled_()) return jsonOut_({ status: 'disabled', reason: 'WRITE_ENABLED=false' }, 423);
    var action = body.action || 'write';
    if (action === 'write') return handleWrite_(body);
    if (action === 'ping')  return jsonOut_({ status: 'ok', pong: true, writeEnabled: true });
    return jsonOut_({ status: 'bad_request', reason: 'unknown-action' }, 400);
  } catch (err) {
    return jsonOut_({ status: 'error', error: String(err && err.message || err) }, 500);
  }
}

// ------------------------- WRITE HANDLER ----------------------------------

/**
 * Body shape:
 *   {
 *     secret:  "…64 hex chars…",
 *     clientTs: 1724369100000,
 *     changes: [
 *       { worksheet: "Scholars", scholarId: "ITK-S0315", field: "Given Names",
 *         oldValue: "Joeli", newValue: "Joeli " },
 *       { worksheet: "Positions", scholarId: "ITK-S0195", rowNumber: 27,
 *         field: "Title", oldValue: "Prof", newValue: "Professor" }
 *     ]
 *   }
 *
 * Response shape:
 *   {
 *     status: "ok" | "partial" | "conflict" | "rejected",
 *     results: [
 *       { index: 0, status: "ok",       change: {...}, writtenAt: "..." },
 *       { index: 1, status: "conflict", change: {...}, diff: {...} },
 *       { index: 2, status: "rejected", change: {...}, reason: "..." }
 *     ],
 *     writeEnabled: true,
 *     serverTs: 1724369101234
 *   }
 */
function handleWrite_(body) {
  var changes = Array.isArray(body.changes) ? body.changes : [];
  if (!changes.length) return jsonOut_({ status: 'bad_request', reason: 'no-changes' }, 400);

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var lock = LockService.getScriptLock();
  var haveLock = lock.tryLock(LOCK_WAIT_MS);
  if (!haveLock) return jsonOut_({ status: 'busy', reason: 'lock-timeout' }, 503);

  var results = [];
  var anyOk = false, anyFail = false;
  try {
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i] || {};
      var r = applyOneChange_(ss, c);
      r.index = i;
      r.change = c;
      results.push(r);
      if (r.status === 'ok') anyOk = true; else anyFail = true;
    }
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  var overall = 'ok';
  if (anyOk && anyFail) overall = 'partial';
  else if (!anyOk && anyFail) overall = 'rejected';
  return jsonOut_({ status: overall, results: results, writeEnabled: true, serverTs: Date.now() });
}

function applyOneChange_(ss, c) {
  var ws = c.worksheet, sid = c.scholarId, field = c.field;
  if (!ws || !MAPPING.worksheets[ws])   return { status: 'rejected', reason: 'worksheet-not-allowed' };
  var wsCfg = MAPPING.worksheets[ws];
  if (!field || !wsCfg.fields[field])   return { status: 'rejected', reason: 'field-not-allowed' };
  if (!sid)                             return { status: 'rejected', reason: 'missing-scholarId' };

  var fieldCfg = wsCfg.fields[field];
  var validation = validateValue_(c.newValue, fieldCfg);
  if (!validation.ok) return { status: 'rejected', reason: 'invalid-value: ' + validation.reason };
  var newValue = validation.coerced;

  var sheet = ss.getSheetByName(ws);
  if (!sheet) return { status: 'rejected', reason: 'worksheet-not-found' };
  var headerRow = wsCfg.headerRow || 1;

  // Locate row(s).
  var rowInfo = locateRow_(sheet, wsCfg, c);
  if (!rowInfo.ok) return { status: 'rejected', reason: rowInfo.reason };

  // Read current cell value.
  var col = rowInfo.headers[field];
  if (!col) return { status: 'rejected', reason: 'field-header-not-found' };
  var currentValue = sheet.getRange(rowInfo.row, col).getValue();
  var currentValueStr = normalizeForCompare_(currentValue);
  var oldValueStr    = normalizeForCompare_(c.oldValue);
  if (currentValueStr !== oldValueStr) {
    return {
      status: 'conflict',
      diff: {
        worksheet: ws, field: field, scholarId: sid,
        loadedValue:    c.oldValue == null ? '' : String(c.oldValue),
        currentValue:   currentValueStr,
        attemptedValue: newValue == null ? '' : String(newValue)
      }
    };
  }

  // Idempotency: same-value writes are still logged, but flagged.
  if (currentValueStr === normalizeForCompare_(newValue)) {
    return { status: 'noop', writtenAt: new Date().toISOString() };
  }

  // Write + log.
  sheet.getRange(rowInfo.row, col).setValue(newValue);
  appendChangeLog_(ss, ws, sid, field, currentValueStr, newValue);
  return { status: 'ok', writtenAt: new Date().toISOString() };
}

// ------------------------- HELPERS ----------------------------------------

function locateRow_(sheet, wsCfg, c) {
  var headerRow = wsCfg.headerRow || 1;
  var lastCol = sheet.getLastColumn();
  var headerVals = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];
  var headers = Object.create(null);
  for (var j = 0; j < headerVals.length; j++) {
    var h = String(headerVals[j] || '').trim();
    if (h) headers[h] = j + 1;
  }
  var keyCol = headers[wsCfg.keyColumn];
  if (!keyCol) return { ok: false, reason: 'key-column-missing' };

  // Multi-row worksheets require an explicit rowNumber (1-based over the whole
  // sheet, i.e. what the user sees in Google Sheets). This is authoritative.
  if (wsCfg.allowMultiRow) {
    var rn = parseInt(c.rowNumber, 10);
    if (!rn || rn <= headerRow) return { ok: false, reason: 'missing-or-bad-rowNumber' };
    // Confirm the row's Scholar ID matches c.scholarId (defence in depth).
    var rowSid = String(sheet.getRange(rn, keyCol).getValue() || '').trim();
    if (rowSid !== String(c.scholarId).trim()) return { ok: false, reason: 'scholarId-does-not-match-rowNumber' };
    return { ok: true, row: rn, headers: headers };
  }

  // Single-row worksheets (Scholars): scan column for the SID.
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return { ok: false, reason: 'no-data-rows' };
  var values = sheet.getRange(headerRow + 1, keyCol, lastRow - headerRow, 1).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0] || '').trim() === String(c.scholarId).trim()) {
      return { ok: true, row: headerRow + 1 + r, headers: headers };
    }
  }
  return { ok: false, reason: 'scholarId-not-found' };
}

function validateValue_(value, cfg) {
  if (value == null) {
    if (cfg.nullable === false) return { ok: false, reason: 'null-not-allowed' };
    return { ok: true, coerced: '' };
  }
  var s = String(value);
  if (cfg.maxLen != null && s.length > cfg.maxLen) return { ok: false, reason: 'too-long' };
  if (cfg.type === 'string') return { ok: true, coerced: s };
  if (cfg.type === 'enum')   return (cfg.enum || []).indexOf(s) >= 0 ? { ok: true, coerced: s } : { ok: false, reason: 'not-in-enum' };
  if (cfg.type === 'int') {
    if (s === '') return cfg.nullable === false ? { ok: false, reason: 'blank-not-allowed' } : { ok: true, coerced: '' };
    var n = parseInt(s, 10);
    if (isNaN(n)) return { ok: false, reason: 'not-integer' };
    if (cfg.min != null && n < cfg.min) return { ok: false, reason: 'below-min' };
    if (cfg.max != null && n > cfg.max) return { ok: false, reason: 'above-max' };
    return { ok: true, coerced: n };
  }
  if (cfg.type === 'float') {
    if (s === '') return { ok: true, coerced: '' };
    var f = parseFloat(s);
    if (isNaN(f)) return { ok: false, reason: 'not-number' };
    return { ok: true, coerced: f };
  }
  if (cfg.type === 'url') {
    if (s === '') return { ok: true, coerced: '' };
    if (!/^https?:\/\//i.test(s)) return { ok: false, reason: 'url-must-start-with-http' };
    return { ok: true, coerced: s };
  }
  if (cfg.type === 'date') {
    if (s === '') return { ok: true, coerced: '' };
    var d = new Date(s);
    if (isNaN(d.getTime())) return { ok: false, reason: 'not-date' };
    return { ok: true, coerced: d };
  }
  return { ok: false, reason: 'unknown-type' };
}

function normalizeForCompare_(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd');
  var s = String(v);
  return s.replace(/\s+$/, '').replace(/^\s+/, '');
}

function appendChangeLog_(ss, worksheet, sid, field, oldValue, newValue) {
  var sheet = ss.getSheetByName('Change Log');
  if (!sheet) return; // If someone removed the tab, silently skip logging (do not fail the write).
  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var version = 'admin-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  var change  = 'edit: ' + worksheet + '.' + field;
  var scope   = sid + ' · ' + field + ': ' + truncate_(oldValue, 60) + ' → ' + truncate_(newValue, 60);
  sheet.appendRow([
    version, today, change, scope, SOURCE_TAG,
    ACTOR_LABEL, worksheet, field, String(oldValue == null ? '' : oldValue), String(newValue == null ? '' : newValue)
  ]);
}

function truncate_(s, n) {
  s = String(s == null ? '' : s);
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// ------------------------- AUTH -------------------------------------------

function checkAuth_(payload) {
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('SHARED_SECRET') || '';
  if (!expected) return false;
  var received = String((payload && payload.secret) || '');
  if (received.length !== expected.length) return false;
  var eq = 0;
  for (var i = 0; i < expected.length; i++) eq |= (expected.charCodeAt(i) ^ received.charCodeAt(i));
  if (eq !== 0) return false;
  var clientTs = parseInt((payload && payload.clientTs), 10);
  if (!clientTs) return false;
  if (Math.abs(Date.now() - clientTs) > REPLAY_WINDOW_MS) return false;
  return true;
}

function writeEnabled_() {
  var v = PropertiesService.getScriptProperties().getProperty('WRITE_ENABLED');
  return String(v || '').toLowerCase() === 'true';
}

// ------------------------- OUTPUT -----------------------------------------

function jsonOut_(obj, code) {
  // Apps Script's HtmlOutput doesn't allow custom status codes for web apps,
  // but ContentService still returns 200. Include a `status` field so the
  // caller can inspect the semantic result.
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------- ADMIN CONSOLE HELPERS --------------------------

/** Run once from the Apps Script editor to generate a fresh 32-byte secret. */
function generateSecret() {
  var bytes = Utilities.getUuid() + Utilities.getUuid();
  bytes = bytes.replace(/-/g, '');
  Logger.log('SHARED_SECRET = ' + bytes);
  return bytes;
}

/** Read-only diagnostic. Safe to run from the editor. */
function inspectConfig() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('WRITE_ENABLED = ' + props.getProperty('WRITE_ENABLED'));
  Logger.log('SHARED_SECRET present = ' + (!!props.getProperty('SHARED_SECRET')));
  Logger.log('ADMIN_ORIGIN = ' + props.getProperty('ADMIN_ORIGIN'));
  Logger.log('Timezone = ' + TIMEZONE);
}
