/**
 * tongan-master-writeback.gs — Tongan Scholar Database admin server.
 *
 * Session 2026-08-31 systematic-repair port from Samoa:
 *   • Same Google-auth-native architecture as samoa-master-writeback.gs.
 *   • The browser-HMAC contract is retired. This project holds no
 *     SHARED_SECRET, admin-password hash, snapshot passcode, or any
 *     other client-held credential. doPost returns HTTP 410 Gone.
 *   • Every entry point (doGet + every api* function reachable via
 *     google.script.run) first calls _assertAuthorized_(), which throws
 *     if Session.getActiveUser().getEmail() is not APPROVED_ADMIN_EMAIL
 *     (a Script Property, compared case-insensitively).
 *   • Change writes take a script-scoped LockService lock, validate each
 *     field against MAPPING, and append one Change Log row per change
 *     using the authenticated Google email as actor.
 *
 * Deploy contract: Execute as USER_ACCESSING; access LIMITED to Ron.
 * Script properties required: APPROVED_ADMIN_EMAIL, WRITE_ENABLED.
 * WRITE_ENABLED must be set to the literal string 'true' before any
 * apiUpdateRow call will actually mutate the sheet.
 *
 * MAPPING covers the three worksheets that were writable under the
 * legacy Tongan HMAC admin: Scholars (34 editable fields), Positions
 * (13 editable fields), Graduate Degrees (22 editable fields). All
 * other tabs in the Tongan Master Sheet stay read-only until explicitly
 * added here.
 */

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

var SPREADSHEET_ID_HINT = '1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI';  // Tongan Master
var SOURCE_TAG          = 'admin-tongan-master-webapp v2 (google-auth)';
var LOCK_WAIT_MS        = 30 * 1000;
var TIMEZONE            = 'Pacific/Honolulu';

// High-consequence fields that ALWAYS get a confirmation prompt on write,
// even when the intended value matches the current value. Keyed by
// "<worksheet>.<field>" using the EXACT Tongan Master Sheet row-4 headers.
var ALWAYS_CONFIRM = {
  'Scholars.Alive / Deceased': true
};

var MAPPING = {
  version: '2.0-tongan',
  worksheets: {
    'Scholars': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      fields: {
        // Title / Salutation is an authoritative scholar-level attribute.
        // Blank means no title.
        'Title / Salutation':      { type: 'enum',   enum: ['Dr','Prof','Rev','Rev Dr','Mr','Mrs','Ms',''] },
        'Family Name':             { type: 'string', maxLen: 120 },
        'Given Names':             { type: 'string', maxLen: 120 },
        'Gender':                  { type: 'enum',   enum: ['Tangata','Fefine','Unknown',''] },
        // Year of Birth: four-digit year, blank when unknown. Do not infer.
        // Sheet stores as text; server accepts 4-digit strings.
        'Year of Birth':           { type: 'string', maxLen: 4, pattern: '^(\\d{4})?$' },
        // Alive / Deceased is a controlled three-value vocabulary in the sheet
        // (normalized 2026-08-22): Alive, Deceased, Unknown. A sheet-level data
        // validation enforces the same enum.
        'Alive / Deceased':        { type: 'enum',   enum: ['Alive','Deceased','Unknown',''] },
        // Year of Death: four-digit year, blank for Alive or Unknown.
        // Sheet stores as text; server accepts 4-digit strings.
        'Year of Death':           { type: 'string', maxLen: 4, pattern: '^(\\d{4})?$' },
        'Paternal Island Division':{ type: 'string', maxLen: 60 },
        'District Paternal':       { type: 'string', maxLen: 80 },
        'Specific Island Paternal':{ type: 'string', maxLen: 80 },
        'Village/Town Paternal (Kolo)': { type: 'string', maxLen: 120 },
        'Maternal Island Division':{ type: 'string', maxLen: 60 },
        'District Maternal':       { type: 'string', maxLen: 80 },
        'Specific Island Maternal':{ type: 'string', maxLen: 80 },
        'Village/Town Maternal (Kolo)': { type: 'string', maxLen: 120 },
        // Cultural/lineage fields are stored SEPARATELY from administrative
        // geography (never derived from village/surname/title resemblance).
        "Estate / Chiefly Affiliation Paternal (Tofi'a)": { type: 'string', maxLen: 200 },
        "Estate / Chiefly Affiliation Maternal (Tofi'a)": { type: 'string', maxLen: 200 },
        "Ha'a / Lineage Paternal": { type: 'string', maxLen: 200 },
        "Ha'a / Lineage Maternal": { type: 'string', maxLen: 200 },
        'Kāinga Paternal':         { type: 'string', maxLen: 200 },
        'Kāinga Maternal':         { type: 'string', maxLen: 200 },
        'Self-identified Home / Community Affiliation Paternal': { type: 'string', maxLen: 200 },
        'Self-identified Home / Community Affiliation Maternal': { type: 'string', maxLen: 200 },
        'Lineage / Provenance Notes': { type: 'string', maxLen: 2000 },
        'Primary Discipline / Field': { type: 'string', maxLen: 120 },
        'Current Title / Role':    { type: 'string', maxLen: 240 },
        'Current Institution':     { type: 'string', maxLen: 200 },
        'Institution Country':     { type: 'string', maxLen: 80 },
        'Current Department / Unit':{ type: 'string', maxLen: 200 },
        'Current PG Status':       { type: 'string', maxLen: 120 },
        'Current Profile URL':     { type: 'url',    maxLen: 500 },
        'ORCID / Researcher ID':   { type: 'string', maxLen: 200 },
        'Google Scholar URL':      { type: 'url',    maxLen: 500 },
        'Name Variants / Aliases': { type: 'string', maxLen: 500 },
        'Record Notes':            { type: 'string', maxLen: 4000 }
      }
    },
    'Positions': {
      // Positions is edited per-row; row is identified by an explicit
      // rowNumber field carried by the client (1-based sheet row).
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Institution':                                  { type: 'string', maxLen: 200 },
        'Country':                                      { type: 'string', maxLen: 80 },
        'Department / Unit':                            { type: 'string', maxLen: 200 },
        'Academic / Professional Title (verbatim)':     { type: 'string', maxLen: 240 },
        'Standardized Academic Rank':                   { type: 'string', maxLen: 120 },
        'Leadership Title (verbatim)':                  { type: 'string', maxLen: 240 },
        'Standardized Leadership Category':             { type: 'string', maxLen: 120 },
        'Leadership Level':                             { type: 'string', maxLen: 60 },
        'Role Status':                                  { type: 'string', maxLen: 60 },
        'Start Year':                                   { type: 'int',    min: 1900, max: 2100, nullable: true },
        'End Year':                                     { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Source URL':                                   { type: 'url',    maxLen: 500 },
        'Evidence / Notes':                             { type: 'string', maxLen: 2000 },
        'Last Verified':                                { type: 'string', maxLen: 60 }
      }
    },
    'Graduate Degrees': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        // Sheet-observed values: 'Master\u0027s' and 'PhD/Doctorate'. Keep
        // string to avoid rejecting existing rows.
        'Degree Stage':                { type: 'string', maxLen: 60 },
        'Degree / Qualification':      { type: 'string', maxLen: 200 },
        'Field / Discipline':          { type: 'string', maxLen: 200 },
        'C_Uni name':                  { type: 'string', maxLen: 200 },
        'O_Uni name':                  { type: 'string', maxLen: 200 },
        'Country':                     { type: 'string', maxLen: 80 },
        'International from Tonga?':   { type: 'enum',   enum: ['Yes','No','Unknown',''] },
        'City':                        { type: 'string', maxLen: 120 },
        'Region':                      { type: 'string', maxLen: 120 },
        'Year / Status':               { type: 'string', maxLen: 60 },
        'Completion Status':           { type: 'string', maxLen: 120 },
        'Thesis / Research Title':     { type: 'string', maxLen: 500 },
        'Thesis / Repository URL':     { type: 'url',    maxLen: 500 },
        'Evidence URL 1':              { type: 'url',    maxLen: 500 },
        'Evidence URL 2':              { type: 'url',    maxLen: 500 },
        'Verification':                { type: 'string', maxLen: 2000 },
        'Notes':                       { type: 'string', maxLen: 2000 },
        'Start Year':                  { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Finish / Completion Year':    { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Duration (years)':            { type: 'string', maxLen: 40 },
        'Study Date Evidence / Notes': { type: 'string', maxLen: 2000 }
      }
    }
  }
};

function parseFoldedScope_(scope) {
  var out = { actor: '', worksheet: '', field: '', oldValue: '', newValue: '' };
  if (!scope) return out;
  var s = String(scope);
  // Split on the arrow first — anything after is newValue.
  var arrowIdx = s.indexOf(' → ');
  if (arrowIdx < 0) return out;
  var newValue = s.substring(arrowIdx + 3);
  var before = s.substring(0, arrowIdx);
  // Then split by "· " from the left three times: actor · sid · wsfield: old
  var parts = before.split(' · ');
  if (parts.length < 3) return out;
  var actor = parts[0];
  var wsFieldOld = parts.slice(2).join(' · '); // rejoin in case field contained ·
  var colonIdx = wsFieldOld.indexOf(': ');
  if (colonIdx < 0) return out;
  var wsField = wsFieldOld.substring(0, colonIdx);
  var oldValue = wsFieldOld.substring(colonIdx + 2);
  var dotIdx = wsField.indexOf('.');
  var worksheet = dotIdx < 0 ? wsField : wsField.substring(0, dotIdx);
  var field     = dotIdx < 0 ? ''       : wsField.substring(dotIdx + 1);
  out.actor     = actor;
  out.worksheet = worksheet;
  out.field     = field;
  out.oldValue  = oldValue;
  out.newValue  = newValue;
  return out;
}

function normalizeForRead_(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd');
  return v;
}

// ─────────────────────────────────────────────────────────────────────────
// WRITE PIPELINE
// ─────────────────────────────────────────────────────────────────────────
//
// handleUpdateRow_ is called only from apiUpdateRow (google.script.run).
// It validates each requested field against MAPPING, takes a
// script-scoped LockService lock, applies changes via applyOneChange_,
// and appends one Change Log row per accepted write. WRITE_ENABLED must
// be 'true' or the whole pipeline degrades to dry-run.
function handleUpdateRow_(body) {
  var ws = String(body.worksheet || '');
  // Support both the current call shape (`body.key`) and the older HMAC
  // shape (`body.scholarId`); the API surface passes `key`.
  var key = String(body.key || body.scholarId || '');
  var fields = body.fields || {};
  var actor = String(body.actor || '') || 'tongan-admin';
  // WRITE_ENABLED gate: when false, force dry-run so nothing is written.
  var effectiveDryRun = body.dryRun === true || !writeEnabled_();

  if (!ws || !MAPPING.worksheets[ws]) return jsonOut_({ status: 'rejected', error: 'worksheet-not-allowed', serverTs: Date.now() });
  if (!key) return jsonOut_({ status: 'rejected', error: 'missing-key', serverTs: Date.now() });
  if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) {
    return jsonOut_({ status: 'rejected', error: 'no-fields', serverTs: Date.now() });
  }

  var wsCfg = MAPPING.worksheets[ws];
  // Reject unknown fields up-front so a partial write never happens.
  var unknown = Object.keys(fields).filter(function(f){ return !wsCfg.fields[f]; });
  if (unknown.length) {
    return jsonOut_({ status: 'rejected', error: 'field-not-allowed', fields: unknown, serverTs: Date.now() });
  }

  // Multi-row worksheets need a rowNumber to disambiguate. The HMAC client
  // is designed for the Scholars single-row surface. If this ever gets used
  // for a multi-row sheet, the client must supply `rowNumber` in `body`.
  if (wsCfg.allowMultiRow && !parseInt(body.rowNumber, 10)) {
    return jsonOut_({ status: 'rejected', error: 'multi-row-needs-rowNumber', serverTs: Date.now() });
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var lock = LockService.getScriptLock();
  var haveLock = lock.tryLock(LOCK_WAIT_MS);
  if (!haveLock) return jsonOut_({ status: 'busy', error: 'lock-timeout', serverTs: Date.now() });

  var results = [];
  var counts = { ok: 0, already_satisfied: 0, needs_confirmation: 0, rejected: 0 };
  try {
    // Translate the HMAC-shape single-row update into the internal
    // applyOneChange_ shape used by the legacy handler. This keeps the
    // MAPPING allowlist, validation, and Change Log paths untouched.
    Object.keys(fields).forEach(function(f){
      var change = {
        worksheet: ws,
        scholarId: key,
        field: f,
        oldValue: null,        // HMAC client does not send loadedValue;
                               // we treat this as a blind overwrite AFTER
                               // an override-authorised handshake by the
                               // ALWAYS_CONFIRM policy. See below.
        newValue: fields[f],
        rowNumber: parseInt(body.rowNumber, 10) || null,
        overrideAuthorized: body.overrideAuthorized === true,
        expectedCurrent: body.expectedCurrent && body.expectedCurrent[f]
      };
      var r = applyOneChange_(ss, change, effectiveDryRun, actor);
      r.field = f;
      r.newValue = fields[f];
      results.push(r);
      if (counts[r.status] != null) counts[r.status]++;
    });
  } finally {
    lock.releaseLock();
  }

  var overall;
  if (counts.ok === results.length)                                       overall = 'ok';
  else if (counts.already_satisfied === results.length)                   overall = 'ok';
  else if (counts.rejected === results.length)                            overall = 'rejected';
  else if (counts.needs_confirmation > 0 && counts.rejected === 0)        overall = 'needs_confirmation';
  else                                                                    overall = 'partial';

  return jsonOut_({
    status: overall,
    dryRun: effectiveDryRun,
    forcedDryRun: !writeEnabled_() && body.dryRun !== true,
    results: results,
    counts: counts,
    writeEnabled: writeEnabled_(),
    actor: actor,
    serverTs: Date.now(),
    // For a pure no-op, surface it explicitly so the admin UI can render
    // a subdued "nothing to save" state without confusing it with an
    // error.
    noop: (counts.already_satisfied === results.length)
  });
}

function applyOneChange_(ss, c, dryRun, actor) {
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

  var rowInfo = locateRow_(sheet, wsCfg, c);
  if (!rowInfo.ok) return { status: 'rejected', reason: rowInfo.reason };
  var col = rowInfo.headers[field];
  if (!col) return { status: 'rejected', reason: 'field-header-not-found' };

  var currentRaw    = sheet.getRange(rowInfo.row, col).getValue();
  var currentStr    = normalizeForCompare_(currentRaw);
  var loadedStr     = normalizeForCompare_(c.oldValue);
  var intendedStr   = normalizeForCompare_(newValue);

  var alwaysKey     = ws + '.' + field;
  var alwaysConfirm = ALWAYS_CONFIRM[alwaysKey] === true;

  // 1. Already satisfied — currentMaster == intended.
  // This is the fix for Joeli's regression: loaded="Alive / current record",
  // currentMaster="Alive", intended="Alive" → silent skip.
  if (currentStr === intendedStr) {
    return {
      status: 'already_satisfied',
      currentValue: currentStr,
      loadedValue:  loadedStr,
      intendedValue: intendedStr
    };
  }

  // 2. Genuine contradiction with current Master OR any change to an
  //    ALWAYS_CONFIRM field → needs_confirmation unless the client has
  //    explicitly authorized the override.
  var authorized = c.overrideAuthorized === true &&
                   normalizeForCompare_(c.expectedCurrent) === currentStr;
  var mustConfirm = alwaysConfirm || (currentStr !== loadedStr);
  if (mustConfirm && !authorized) {
    return {
      status: 'needs_confirmation',
      reason: alwaysConfirm ? 'always-confirm-field' : 'master-changed',
      currentValue: currentStr,
      loadedValue:  loadedStr,
      intendedValue: intendedStr
    };
  }

  // Dry-run: classify only, don't write.
  if (dryRun) {
    return {
      status: 'ok',
      willWrite: true,
      currentValue: currentStr,
      loadedValue:  loadedStr,
      intendedValue: intendedStr
    };
  }

  // 3. Clean write. Value written is the validated coerced form; Change Log
  //    records the true current old value (which may differ from what the
  //    client had loaded, e.g. after a confirmed override).
  sheet.getRange(rowInfo.row, col).setValue(newValue);
  appendChangeLog_(ss, ws, sid, field, currentStr, newValue, actor);
  return {
    status: 'ok',
    willWrite: true,
    writtenAt: new Date().toISOString(),
    currentValue: currentStr,
    intendedValue: intendedStr
  };
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
  if (cfg.pattern != null && s !== '' && !(new RegExp(cfg.pattern)).test(s)) return { ok: false, reason: 'pattern-mismatch' };
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

function appendChangeLog_(ss, worksheet, sid, field, oldValue, newValue, actor) {
  var sheet = ss.getSheetByName('Change Log');
  if (!sheet) return; // If someone removed the tab, silently skip logging (do not fail the write).
  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var version = 'admin-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  var change  = 'edit: ' + worksheet + '.' + field;
  // Scope/Impact folds actor, scholar id, worksheet, field, and the exact
  // old → new values into one string. Old/new are truncated to keep the
  // cell readable; the raw values are visible in the diff preview at
  // write-time and can be reconstructed from Master history if needed.
  var actorLabel = String(actor || 'tongan-admin');
  var scope = actorLabel + ' · ' + sid + ' · ' + worksheet + '.' + field +
              ': ' + truncate_(oldValue, 120) + ' → ' + truncate_(newValue, 120);
  // Strict five-column write. Do not write into columns F onward.
  sheet.appendRow([version, today, change, scope, SOURCE_TAG]);
}

function truncate_(s, n) {
  s = String(s == null ? '' : s);
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// ------------------------- AUTH -------------------------------------------

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

/**
 * inspectConfig — read-only diagnostic. Run from the Apps Script editor
 * to confirm the two required Script Properties are set. Prints nothing
 * secret; safe to keep in production.
 */
function inspectConfig() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('APPROVED_ADMIN_EMAIL = ' + (props.getProperty('APPROVED_ADMIN_EMAIL') || '(unset)'));
  Logger.log('WRITE_ENABLED        = ' + (props.getProperty('WRITE_ENABLED') || '(unset)'));
  Logger.log('Spreadsheet ID       = ' + SPREADSHEET_ID_HINT);
  Logger.log('Timezone             = ' + TIMEZONE);
}

// ─────────────────────────────────────────────────────────────────────────
// HTML TEMPLATE INCLUDE HELPER
// ─────────────────────────────────────────────────────────────────────────

/**
 * include(name)
 *
 * Called from tongan-admin-app.html scriptlets as `<?!= include('...') ?>`.
 * Returns the raw content of another HTML file in this Apps Script project
 * so it can be stitched into the outer template. The included files
 * contain ONLY <script>...</script> blocks — no further scriptlets — so
 * scriptlet evaluation only ever happens once, in tongan-admin-app.html.
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────

function _activeEmail_() {
  var session = Session.getActiveUser();
  return session ? (session.getEmail() || '').toLowerCase() : '';
}

function _approvedEmail_() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('APPROVED_ADMIN_EMAIL') || '').toLowerCase();
}

/**
 * _assertAuthorized_() — throws if the active user is not the approved
 * admin. Every api* function called via google.script.run starts with
 * this. Errors thrown here propagate to the browser's
 * withFailureHandler.
 */
function _assertAuthorized_() {
  var actual = _activeEmail_();
  var approved = _approvedEmail_();
  if (!approved) {
    throw new Error('tongan-writeback: APPROVED_ADMIN_EMAIL is not configured.');
  }
  if (!actual) {
    throw new Error('tongan-writeback: no active Google session.');
  }
  if (actual !== approved) {
    throw new Error('tongan-writeback: not-authorized (' + actual + ' is not the approved admin).');
  }
  return actual;
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP entry points
// ─────────────────────────────────────────────────────────────────────────

function doGet(e) {
  var actual = _activeEmail_();
  var approved = _approvedEmail_();
  if (!actual || !approved || actual !== approved) {
    return _renderNotAuthorized_(actual, approved);
  }
  var tmpl = HtmlService.createTemplateFromFile('tongan-admin-app');
  tmpl.activeEmail       = actual;
  tmpl.writeEnabled      = writeEnabled_();
  tmpl.writeEnabledLabel = writeEnabled_() ? 'WRITE ENABLED' : 'READ-ONLY (WRITE_ENABLED=false)';
  tmpl.spreadsheetId     = SPREADSHEET_ID_HINT;
  return tmpl.evaluate()
    .setTitle('Tongan Scholar Database — Admin')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * doPost — retired. The browser-HMAC contract is gone. All writes go
 * through google.script.run.apiUpdateRow, which is authorized via
 * Session.getActiveUser().
 */
function doPost(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'gone',
      error: 'The HMAC-signed doPost endpoint has been retired. Use the Apps Script admin web app.',
      retiredAt: '2026-08-30'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function _renderNotAuthorized_(actual, approved) {
  var body =
    '<!doctype html><html><head><meta charset="utf-8"/>' +
    '<title>Not authorised — Tongan Admin</title>' +
    '<style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:640px;margin:auto;color:#111;}' +
    'code{background:#f4f4f4;padding:2px 6px;border-radius:4px;}</style>' +
    '</head><body>' +
    '<h1>Not authorised</h1>' +
    '<p>This admin is restricted to a single Google account. You are signed in as ' +
    '<code>' + _escapeHtml_(actual || '(not signed in)') + '</code>.</p>' +
    (approved ? '' :
      '<p><strong>Server-side note:</strong> the script property <code>APPROVED_ADMIN_EMAIL</code> ' +
      'is not set. Open the Apps Script project → Project Settings → Script properties.</p>') +
    '<p>Sign out of Google and sign back in with the approved admin account, then reload this page.</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(body).setTitle('Not authorised');
}

function _escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────
// google.script.run API — every function here starts with _assertAuthorized_
// ─────────────────────────────────────────────────────────────────────────

/**
 * apiDescribe — returns MAPPING plus session/environment metadata so the
 * browser can render tabs, form fields, and validation hints without
 * shipping the allowlist to the client from GitHub Pages.
 */
function apiDescribe(actor) {
  _assertAuthorized_();
  return {
    status: 'ok',
    activeEmail: _activeEmail_(),
    writeEnabled: writeEnabled_(),
    spreadsheetId: SPREADSHEET_ID_HINT,
    sourceTag: SOURCE_TAG,
    timezone: TIMEZONE,
    mapping: MAPPING,
    alwaysConfirm: ALWAYS_CONFIRM,
    serverTs: Date.now()
  };
}

/** apiPing — quick liveness probe. */
function apiPing(actor) {
  _assertAuthorized_();
  return {
    status: 'ok',
    activeEmail: _activeEmail_(),
    writeEnabled: writeEnabled_(),
    serverTs: Date.now()
  };
}

/**
 * apiListKeys(worksheet) — returns the unique key-column values for a
 * worksheet, so the browser can build an autocomplete/dropdown for the
 * row picker. Skips blanks. Capped at 5000 values.
 */
function apiListKeys(worksheet) {
  _assertAuthorized_();
  var ws = String(worksheet || '').trim();
  var wsCfg = MAPPING.worksheets[ws];
  if (!wsCfg) throw new Error('apiListKeys: worksheet not in allowlist: ' + ws);
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sheet = ss.getSheetByName(ws);
  if (!sheet) throw new Error('apiListKeys: sheet not found: ' + ws);
  var headerRow = wsCfg.headerRow || 1;
  var lastCol   = sheet.getLastColumn();
  var lastRow   = sheet.getLastRow();
  if (lastRow <= headerRow) return { status: 'ok', worksheet: ws, keys: [] };
  var headers   = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];
  var keyIdx    = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === wsCfg.keyColumn) { keyIdx = i; break; }
  }
  if (keyIdx < 0) throw new Error('apiListKeys: keyColumn "' + wsCfg.keyColumn + '" not found on ' + ws);
  var body = sheet.getRange(headerRow + 1, keyIdx + 1, lastRow - headerRow, 1).getValues();
  var seen = {};
  var keys = [];
  var cap  = 5000;
  for (var r = 0; r < body.length && keys.length < cap; r++) {
    var v = String(body[r][0] == null ? '' : body[r][0]).trim();
    if (!v) continue;
    if (seen[v]) continue;
    seen[v] = 1;
    keys.push(v);
  }
  keys.sort();
  return { status: 'ok', worksheet: ws, keyColumn: wsCfg.keyColumn, keys: keys, serverTs: Date.now() };
}

/**
 * apiReadRow(worksheet, keyValue) — returns the live row fields for a
 * given key. The browser uses this to populate the edit form.
 */
function apiReadRow(worksheet, keyValue) {
  _assertAuthorized_();
  var ws = String(worksheet || '').trim();
  var key = String(keyValue || '').trim();
  var wsCfg = MAPPING.worksheets[ws];
  if (!wsCfg) throw new Error('apiReadRow: worksheet not in allowlist: ' + ws);
  if (!key)   throw new Error('apiReadRow: keyValue is required.');
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sheet = ss.getSheetByName(ws);
  if (!sheet) throw new Error('apiReadRow: sheet not found: ' + ws);
  var headerRow = wsCfg.headerRow || 1;
  var lastCol   = sheet.getLastColumn();
  var lastRow   = sheet.getLastRow();
  var headers   = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];
  var keyIdx    = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === wsCfg.keyColumn) { keyIdx = i; break; }
  }
  if (keyIdx < 0) throw new Error('apiReadRow: keyColumn "' + wsCfg.keyColumn + '" not found on ' + ws);
  if (lastRow <= headerRow) return { status: 'ok', worksheet: ws, keyValue: key, found: false, rowNumber: 0, fields: {} };
  var all = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
  for (var r = 0; r < all.length; r++) {
    if (String(all[r][keyIdx] || '').trim() !== key) continue;
    var fields = {};
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || '').trim();
      if (!h) continue;
      fields[h] = normalizeForRead_(all[r][c]);
    }
    return { status: 'ok', worksheet: ws, keyValue: key, found: true, rowNumber: headerRow + 1 + r, fields: fields, serverTs: Date.now() };
  }
  return { status: 'ok', worksheet: ws, keyValue: key, found: false, rowNumber: 0, fields: {} };
}

/**
 * apiUpdateRow(worksheet, keyValue, fields, actor) — validated write.
 * Delegates to the existing handleUpdateRow_ pipeline (which takes a
 * script-scoped LockService lock, validates each field, appends the
 * Change Log). If WRITE_ENABLED is not 'true', the pipeline runs in
 * dry-run mode and returns { status: 'ok', dryRun: true, ... }.
 */
function apiUpdateRow(worksheet, keyValue, fields, actor) {
  _assertAuthorized_();
  var body = {
    worksheet: String(worksheet || '').trim(),
    key: String(keyValue || '').trim(),
    fields: fields || {},
    actor: _activeEmail_()  // always the authenticated email — ignore browser value
  };
  var out = handleUpdateRow_(body);
  // handleUpdateRow_ returns ContentService TextOutput (JSON). Parse it so
  // the browser gets a real object via google.script.run.
  var text = out.getContent();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: 'error', error: 'server-response-not-json', body: text };
  }
}

/**
 * apiReadChangeLog(limit) — return the last `limit` Change Log rows
 * (columns A–E) so the admin UI can show what has recently been written.
 * Reads only the true schema range (A–E); does not touch legacy F–J.
 */
function apiReadChangeLog(limit) {
  _assertAuthorized_();
  var take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 500);
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sheet = ss.getSheetByName('Change Log');
  if (!sheet) return { status: 'ok', rows: [], note: 'Change Log sheet not found' };
  var lastRow  = sheet.getLastRow();
  var headerRow = 4;
  if (lastRow <= headerRow) return { status: 'ok', rows: [] };
  var actualTake = Math.min(take, lastRow - headerRow);
  var startRow  = lastRow - actualTake + 1;
  var vals = sheet.getRange(startRow, 1, actualTake, 5).getValues();
  var rows = [];
  for (var i = vals.length - 1; i >= 0; i--) {  // newest first
    rows.push({
      rowNumber: startRow + i,
      version:   String(vals[i][0] == null ? '' : vals[i][0]),
      date:      String(vals[i][1] == null ? '' : vals[i][1]),
      change:    String(vals[i][2] == null ? '' : vals[i][2]),
      scope:     String(vals[i][3] == null ? '' : vals[i][3]),
      source:    String(vals[i][4] == null ? '' : vals[i][4])
    });
  }
  return { status: 'ok', rows: rows, serverTs: Date.now() };
}

/**
 * apiListScholars() — returns one row per scholar for the picker card:
 *   { scholarId, name, islandDivision, discipline, currentInstitution, pubs, firstAuth }
 *
 * All values come from the live Scholars sheet (no cross-tab joins):
 *   - Scholar ID, Scholar Name, Paternal Island Division / Maternal Island Division,
 *     Primary Discipline / Field, Current Institution
 *   - Linked Publication Count and First-Author Publication Count are read straight
 *     from the precomputed columns the Master Sheet already maintains.
 *
 * Cached for 300s in CacheService so repeated picker loads do not rescan the sheet.
 */
function apiListScholars() {
  _assertAuthorized_();
  var CACHE_KEY = 'tongan-picker-v1';
  var cache = CacheService.getUserCache();
  var cached = cache.get(CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through and recompute */ }
  }
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sheet = ss.getSheetByName('Scholars');
  if (!sheet) throw new Error('apiListScholars: Scholars sheet not found');
  var headerRow = 4;
  var lastCol   = sheet.getLastColumn();
  var lastRow   = sheet.getLastRow();
  if (lastRow <= headerRow) {
    var empty = { status: 'ok', scholars: [], serverTs: Date.now() };
    return empty;
  }
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];
  function _idx(name) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === name) return i;
    }
    return -1;
  }
  var iId   = _idx('Scholar ID');
  var iName = _idx('Scholar Name');
  var iPat  = _idx('Paternal Island Division');
  var iMat  = _idx('Maternal Island Division');
  var iDisc = _idx('Primary Discipline / Field');
  var iInst = _idx('Current Institution');
  var iPubs = _idx('Linked Publication Count');
  var iFst  = _idx('First-Author Publication Count');
  if (iId < 0 || iName < 0) {
    throw new Error('apiListScholars: required columns "Scholar ID" and "Scholar Name" not found on Scholars sheet');
  }
  var body = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
  var out = [];
  for (var r = 0; r < body.length; r++) {
    var sid = String(body[r][iId] == null ? '' : body[r][iId]).trim();
    if (!sid) continue;
    var pat = iPat >= 0 ? String(body[r][iPat] == null ? '' : body[r][iPat]).trim() : '';
    var mat = iMat >= 0 ? String(body[r][iMat] == null ? '' : body[r][iMat]).trim() : '';
    // Prefer paternal (Tongan convention); fall back to maternal so blank paternal is not misleading.
    var island = pat || mat;
    function _num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
    out.push({
      scholarId:          sid,
      name:               iName >= 0 ? String(body[r][iName] || '').trim() : '',
      islandDivision:     island,
      discipline:         iDisc >= 0 ? String(body[r][iDisc] || '').trim() : '',
      currentInstitution: iInst >= 0 ? String(body[r][iInst] || '').trim() : '',
      pubs:               iPubs >= 0 ? _num(body[r][iPubs]) : 0,
      firstAuth:          iFst  >= 0 ? _num(body[r][iFst])  : 0
    });
  }
  // Sort by pubs desc, then name asc, so first paint matches the default picker sort.
  out.sort(function (a, b) {
    if (b.pubs !== a.pubs) return b.pubs - a.pubs;
    return a.name.localeCompare(b.name);
  });
  var payload = { status: 'ok', scholars: out, serverTs: Date.now() };
  try {
    cache.put(CACHE_KEY, JSON.stringify(payload), 300);
  } catch (e) { /* payload too large for cache; still return it */ }
  return payload;
}
