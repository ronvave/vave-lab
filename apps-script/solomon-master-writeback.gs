/**
 * solomon-master-writeback.gs — Bound Apps Script for the Solomon Islands Scholar
 * Database Master file. This is a completely separate, isolated sister
 * system to the iTaukei/Solomon Islands master-writeback.gs — own spreadsheet ID, own
 * SHARED_SECRET, own deployment. It must never read from or write to the
 * iTaukei spreadsheet.
 *
 * Deployed as a Web App (Execute as: Ron Vave — Owner; Access: Anyone with link)
 * and called only by admin-solomon-islands-master.html. Every write is authenticated with a
 * shared secret held in ScriptProperties, enforced field-by-field against an
 * allowlist, wrapped in LockService, and appended to the Change Log.
 *
 * ── Setup (one-time; see docs/APPS-SCRIPT-DEPLOY.md for a step-by-step) ──
 *   1. In the Master spreadsheet: Extensions → Apps Script.
 *   2. Paste this file into the project as `solomon-master-writeback.gs`.
 *   3. In Project Settings → Script Properties, add:
 *        SHARED_SECRET      = <SET THIS -- run generateSecret() below to mint a fresh 32-byte hex secret; never reuse the iTaukei or Tongan SHARED_SECRET>
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
 * ── Concurrency + conflict handling (Phase 3.4, revised) ──
 *   Every write takes a script-scoped LockService lock (30s timeout). Inside
 *   the lock, the server compares three values per field:
 *     loaded value   — what Admin V2 had when the modal opened (`oldValue`)
 *     current value  — a fresh read of the Master cell right before write
 *     intended value — what the user submitted (`newValue`)
 *   Classification (per field, independently):
 *     already_satisfied  — currentMaster == intended: silent skip, no write,
 *                           no Change Log row. Fixes the stale-loaded but
 *                           already-current case (e.g. Joeli's
 *                           "Alive / current record" → "Alive").
 *     needs_confirmation — user is changing a field to a value that
 *                           contradicts the current Master value. Server
 *                           refuses to write unless the client re-submits
 *                           the change with `overrideAuthorized: true` and
 *                           `expectedCurrent` equal to the currently
 *                           returned Master value.
 *                           Also fires for the ALWAYS_CONFIRM list
 *                           (Alive / Deceased) whenever the user changes
 *                           the value.
 *     ok                 — clean write: currentMaster == loaded, currentMaster
 *                           != intended, and either not in ALWAYS_CONFIRM or
 *                           override authorized. Writes the cell and logs.
 *     rejected           — validation failure or invalid target.
 *   `dryRun: true` runs classification only — nothing is written and no
 *   Change Log rows are appended, so the client can render a full preview
 *   before user confirmation.
 *   Batch-level `status` mirrors the field mix:
 *     ok                 — every field was ok or already_satisfied
 *     needs_confirmation — at least one needs_confirmation, no fatal reject
 *     partial            — mix of ok and rejected
 *     rejected           — every field rejected
 *
 * ── Change Log ──
 *   Every successful write appends ONE row using the real five-column schema
 *   (Ron's directive 2026-08-23):
 *     A Version       — "admin-YYYYMMDD-HHMMSS"   (per-write timestamp version)
 *     B Date          — ISO date                  (Pacific/Honolulu)
 *     C Change        — short label               (e.g. "edit: Scholars.Given Names")
 *     D Scope/Impact  — one-line summary          (actor · SID · worksheet.field: old → new)
 *     E Source        — "admin-master-webapp v1"
 *   Do not write into columns F onward. Actor / worksheet / field / verbatim
 *   old / verbatim new all live inside column D so the sheet's actual header
 *   row (Version | Date | Change | Scope/Impact | Source) stays consistent.
 */

// ------------------------- CONFIG -----------------------------------------
// Spreadsheet ID is read from the SOLOMON_SPREADSHEET_ID Script Property
// (SET THIS -- see docs/SOLOMON-ISLANDS-APPS-SCRIPT-DEPLOY.md step 3), not
// hardcoded, so the same script file can be redeployed against a
// copy/staging sheet without a source edit. The literal ID below is only a
// documented fallback default (the real Solomon Islands Scholars Master
// File) for local testing before the Script Property is set -- it is NOT a
// secret; NEVER the iTaukei ID (1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg)
// or the Tongan ID (1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI).
var SPREADSHEET_ID_FALLBACK = '1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY';
function getSpreadsheetId_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('SOLOMON_SPREADSHEET_ID');
  return fromProps || SPREADSHEET_ID_FALLBACK;
}
var SPREADSHEET_ID_HINT = getSpreadsheetId_();
var ACTOR_LABEL         = 'Ron Vave (admin)';
var SOURCE_TAG          = 'admin-master-webapp v1';
var REPLAY_WINDOW_MS    = 5 * 60 * 1000;
var LOCK_WAIT_MS        = 30 * 1000;
var TIMEZONE            = 'Pacific/Honolulu';

// Fields that ALWAYS require the user to explicitly confirm any change,
// even when the loaded and current Master values match. These are
// high-consequence status fields (drive memorial band, dashboard flags,
// etc.) so any change gets a plain-language warning per Ron 2026-08-23.
// Keyed by `<worksheet>.<field>`.
var ALWAYS_CONFIRM = {
  'Scholars.Alive/Deceased': true
};

// Full editable-field allowlist. Every writable field must appear here.
// Sheets not listed are read-only. Fields on listed sheets not listed are
// read-only. Enum values are validated against the `enum` array.
// MAPPING reflects the ACTUAL Master Google Sheet headers (verified
// 2026-08-22 against the live sheet). Field keys are the literal header
// strings including spacing and slashes. Column names come from row 4 of
// each sheet.
var MAPPING = {
  version: '2.0',
  worksheets: {
    'Scholars': {
      keyColumn: 'Scholar ID',
      headerRow: 1,
      fields: {
        'Title/Salutation':        { type: 'enum',   enum: ['Dr','Prof','Rev','Rev Dr','Mr','Mrs','Ms',''] },
        'Family Name':             { type: 'string', maxLen: 120 },
        'Given Names':             { type: 'string', maxLen: 120 },
        // Gender vocabulary is "Man" / "Woman" / "Self-described (see free
        // text)" / "Not yet verified" per the Master Sheet's Lookups tab
        // (placeholder canonical values, PENDING community consultation --
        // see SOLOMON-ADMIN-BUILD-NOTES.md).
        'Gender':                  { type: 'enum',   enum: ['Man','Woman','Self-described (see free text)','Not yet verified',''] },
        'Birth Year':              { type: 'string', maxLen: 4, pattern: '^(\\d{4})?$' },
        'Alive/Deceased':          { type: 'enum',   enum: ['Alive','Deceased','Unknown',''] },
        'Death Year':              { type: 'string', maxLen: 4, pattern: '^(\\d{4})?$' },
        'Photo URL':               { type: 'url',    maxLen: 500 },
        // Administrative geography -- genuine 3-tier model (Village/
        // Community -> Ward -> Province/City Area), Paternal + Maternal.
        // Honiara City is a valid Province/City Area value, a sibling of
        // the 9 provinces (never folded into Guadalcanal).
        'Paternal Province/City Area': { type: 'string', maxLen: 60 },
        'Paternal Ward':               { type: 'string', maxLen: 80 },
        'Paternal Specific Island':    { type: 'string', maxLen: 80 },
        'Paternal Village/Community':  { type: 'string', maxLen: 120 },
        'Maternal Province/City Area': { type: 'string', maxLen: 60 },
        'Maternal Ward':               { type: 'string', maxLen: 80 },
        'Maternal Specific Island':    { type: 'string', maxLen: 80 },
        'Maternal Village/Community':  { type: 'string', maxLen: 120 },
        // Customary/cultural fields are stored SEPARATELY from
        // administrative geography and from Specific Island -- never
        // derived from either, from surname, or from title.
        'Paternal Clan/Tribe/Lineage':      { type: 'string', maxLen: 200 },
        'Maternal Clan/Tribe/Lineage':      { type: 'string', maxLen: 200 },
        'Customary Place':                  { type: 'string', maxLen: 200 },
        'Self-identified Home/Community':   { type: 'string', maxLen: 200 },
        'Primary Discipline':      { type: 'string', maxLen: 120 },
        'Broad Discipline':        { type: 'string', maxLen: 120 },
        'Current Role':            { type: 'string', maxLen: 240 },
        'Current Institution ID':  { type: 'string', maxLen: 60 },
        'Department':              { type: 'string', maxLen: 200 },
        'Institution Country':     { type: 'string', maxLen: 80 },
        'Highest Completed Degree':{ type: 'string', maxLen: 120 },
        'Current PG Status':       { type: 'string', maxLen: 120 },
        'ORCID':                   { type: 'string', maxLen: 60 },
        'Google Scholar':          { type: 'url',    maxLen: 500 },
        'Scopus Author ID':        { type: 'string', maxLen: 60 },
        'Researcher Profile URL':  { type: 'url',    maxLen: 500 },
        'Personal/Official Profile URL': { type: 'url', maxLen: 500 },
        'Current Leadership Category': { type: 'string', maxLen: 120 },
        'Current Leadership Level':    { type: 'string', maxLen: 120 },
        'Aliases':                 { type: 'string', maxLen: 500 },
        'Record Notes':            { type: 'string', maxLen: 4000 }
        // Non-editable Master computed/audit columns intentionally
        // OMITTED: Display Name, Solomon Islander Status, Inclusion
        // Status, Identity Evidence Source ID, Review Status, Roster
        // Tier, Paternal/Maternal Evidence Source ID, Customary Evidence
        // Notes, Degree Episodes, Funding Episodes, Awards Count, Linked
        // Publications, First-author Publications, Source Basis, Created
        // At/By, Updated At/By. These are computed/audit fields -- do not
        // expose as editable.
      }
    },
    'Positions': {
      // Positions is edited per-row; row is identified by an explicit
      // rowNumber field carried by the client (1-based sheet row).
      keyColumn: 'Scholar ID',
      headerRow: 1,
      allowMultiRow: true,
      fields: {
        'Title':                { type: 'string', maxLen: 240 },
        'Institution ID':       { type: 'string', maxLen: 60 },
        'Department':           { type: 'string', maxLen: 200 },
        'Country':              { type: 'string', maxLen: 80 },
        'Leadership Category':  { type: 'string', maxLen: 120 },
        'Leadership Level':     { type: 'string', maxLen: 60 },
        'Start Year':           { type: 'int',    min: 1900, max: 2100, nullable: true },
        'End Year':             { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Current Flag':         { type: 'enum',   enum: ['Yes','No',''] },
        'Notes':                { type: 'string', maxLen: 2000 }
      }
    },
    'Graduate Degrees': {
      keyColumn: 'Scholar ID',
      headerRow: 1,
      allowMultiRow: true,
      fields: {
        'Stage':                       { type: 'string', maxLen: 60 },
        'Degree Name':                 { type: 'string', maxLen: 200 },
        'Field/Discipline':            { type: 'string', maxLen: 200 },
        'Broad Discipline':            { type: 'string', maxLen: 120 },
        'Thesis Title':                { type: 'string', maxLen: 500 },
        'Institution ID':              { type: 'string', maxLen: 60 },
        'Institution Name (Original)': { type: 'string', maxLen: 200 },
        'Institution Name (Current)':  { type: 'string', maxLen: 200 },
        'Country':                     { type: 'string', maxLen: 80 },
        'Start Year':                  { type: 'int',    min: 1900, max: 2100, nullable: true },
        'End Year':                    { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Graduation Year':             { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Completion Status':           { type: 'enum',   enum: ['Completed','In Progress','Withdrawn','Incomplete',''] },
        'Repository URL':              { type: 'url',    maxLen: 500 },
        'DOI/Handle':                  { type: 'string', maxLen: 200 },
        'Notes':                       { type: 'string', maxLen: 2000 }
      }
    },
    'Awards & Honours': {
      keyColumn: 'Scholar ID',
      headerRow: 1,
      allowMultiRow: true,
      fields: {
        'Award Name':      { type: 'string', maxLen: 240 },
        'Awarding Body':   { type: 'string', maxLen: 240 },
        'Category':        { type: 'string', maxLen: 120 },
        'Year':            { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Country':         { type: 'string', maxLen: 80 },
        'Notes':           { type: 'string', maxLen: 2000 }
      }
    },
    'Scholarships & Funding': {
      keyColumn: 'Scholar ID',
      headerRow: 1,
      allowMultiRow: true,
      fields: {
        'Program/Funder':             { type: 'string', maxLen: 240 },
        'Award Type':                 { type: 'string', maxLen: 120 },
        'Destination Country':        { type: 'string', maxLen: 80 },
        'Destination Institution ID': { type: 'string', maxLen: 60 },
        'Start Year':                 { type: 'int',    min: 1900, max: 2100, nullable: true },
        'End Year':                   { type: 'int',    min: 1900, max: 2100, nullable: true },
        'Cohort Name':                { type: 'string', maxLen: 120 },
        'Notes':                      { type: 'string', maxLen: 2000 }
      }
    },
    'Publications': {
      keyColumn: 'Publication ID',
      headerRow: 1,
      allowMultiRow: true,
      fields: {
        'Type':               { type: 'string', maxLen: 60 },
        'Title':               { type: 'string', maxLen: 500 },
        'Year':                { type: 'int',    min: 1800, max: 2100, nullable: true },
        'Journal/Publisher':   { type: 'string', maxLen: 240 },
        'DOI':                 { type: 'string', maxLen: 120 },
        'URL':                 { type: 'url',    maxLen: 500 },
        'Verification Status': { type: 'string', maxLen: 60 },
        'Notes':               { type: 'string', maxLen: 2000 }
      }
    },
    'Research Geography': {
      keyColumn: 'Geography ID',
      headerRow: 1,
      allowMultiRow: true,
      fields: {
        'Country':                   { type: 'string', maxLen: 80 },
        'Province/City Area':        { type: 'string', maxLen: 60 },
        'Ward':                      { type: 'string', maxLen: 80 },
        // Specific Island is INDEPENDENT of Province/City Area/Ward --
        // never auto-filled or overwritten from them.
        'Specific Island':           { type: 'string', maxLen: 80 },
        'Village/Community/Site':    { type: 'string', maxLen: 120 },
        'Latitude':                  { type: 'float',  min: -90,  max: 90,  nullable: true },
        'Longitude':                 { type: 'float',  min: -180, max: 180, nullable: true },
        'Geography Scale':           { type: 'string', maxLen: 60 },
        'Evidence Excerpt/Context':  { type: 'string', maxLen: 2000 },
        'Verification Status':       { type: 'string', maxLen: 60 }
      }
    }
  }
};

// ------------------------- ENTRY POINTS -----------------------------------

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || 'ping';
    if (!checkAuth_(params)) return jsonOut_({ status: 'unauthorized' }, 401);
    if (action === 'describe') {
      return jsonOut_({ status: 'ok', mapping: MAPPING, writeEnabled: writeEnabled_(), actor: ACTOR_LABEL });
    }
    if (action === 'ping') {
      return jsonOut_({ status: 'ok', pong: true, writeEnabled: writeEnabled_(), actor: ACTOR_LABEL, tz: TIMEZONE, spreadsheetId: SPREADSHEET_ID_HINT });
    }
    if (action === 'readScholar') {
      return handleReadScholar_(params);
    }
    if (action === 'readRows') {
      return handleReadRows_(params);
    }
    if (action === 'readChangeLog') {
      return handleReadChangeLog_(params);
    }
    return jsonOut_({ status: 'bad_request', reason: 'unknown-action' }, 400);
  } catch (err) {
    return jsonOut_({ status: 'error', error: String(err && err.message || err) }, 500);
  }
}

// ------------------------- READ HANDLERS ----------------------------------

function handleReadScholar_(params) {
  var sid = String(params.scholarId || '').trim();
  if (!sid) return jsonOut_({ status: 'bad_request', reason: 'missing-scholarId' }, 400);
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var wsCfg = MAPPING.worksheets['Scholars'];
  var sheet = ss.getSheetByName('Scholars');
  if (!sheet) return jsonOut_({ status: 'error', error: 'Scholars sheet not found' }, 500);
  var info = locateRow_(sheet, wsCfg, { scholarId: sid });
  if (!info.ok) return jsonOut_({ status: 'not_found', reason: info.reason });
  var lastCol = sheet.getLastColumn();
  var rowValues = sheet.getRange(info.row, 1, 1, lastCol).getValues()[0] || [];
  var headerVals = sheet.getRange(wsCfg.headerRow || 1, 1, 1, lastCol).getValues()[0] || [];
  var row = {};
  for (var i = 0; i < headerVals.length; i++) {
    var h = String(headerVals[i] || '').trim();
    if (h) row[h] = normalizeForRead_(rowValues[i]);
  }
  return jsonOut_({ status: 'ok', worksheet: 'Scholars', scholarId: sid, rowNumber: info.row, fields: row, serverTs: Date.now() });
}

function handleReadRows_(params) {
  var ws = String(params.worksheet || '').trim();
  var sid = String(params.scholarId || '').trim();
  if (!ws || !MAPPING.worksheets[ws]) return jsonOut_({ status: 'bad_request', reason: 'worksheet-not-allowed' }, 400);
  if (!sid) return jsonOut_({ status: 'bad_request', reason: 'missing-scholarId' }, 400);
  var wsCfg = MAPPING.worksheets[ws];
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sheet = ss.getSheetByName(ws);
  if (!sheet) return jsonOut_({ status: 'error', error: ws + ' sheet not found' }, 500);
  var headerRow = wsCfg.headerRow || 1;
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  var headerVals = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];
  var keyIdx = -1;
  for (var j = 0; j < headerVals.length; j++) {
    if (String(headerVals[j] || '').trim() === wsCfg.keyColumn) { keyIdx = j; break; }
  }
  if (keyIdx < 0) return jsonOut_({ status: 'error', error: 'key-column-missing' }, 500);
  var rows = [];
  if (lastRow > headerRow) {
    var all = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
    for (var r = 0; r < all.length; r++) {
      if (String(all[r][keyIdx] || '').trim() !== sid) continue;
      var obj = {};
      for (var k = 0; k < headerVals.length; k++) {
        var h = String(headerVals[k] || '').trim();
        if (h) obj[h] = normalizeForRead_(all[r][k]);
      }
      rows.push({ rowNumber: headerRow + 1 + r, fields: obj });
    }
  }
  return jsonOut_({ status: 'ok', worksheet: ws, scholarId: sid, rows: rows, serverTs: Date.now() });
}

function handleReadChangeLog_(params) {
  var limit = Math.min(parseInt(params.limit, 10) || 50, 500);
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sheet = ss.getSheetByName('Change Log');
  if (!sheet) return jsonOut_({ status: 'ok', rows: [] });
  var lastRow = sheet.getLastRow();
  var headerRow = 4;
  if (lastRow <= headerRow) return jsonOut_({ status: 'ok', rows: [] });
  var take = Math.min(limit, lastRow - headerRow);
  var startRow = lastRow - take + 1;
  // Read A–J so legacy rows with polluted F–J are still surfaced verbatim.
  // New rows written by the strict 5-column writer only fill A–E, and F–J
  // will be blank; we then parse actor / worksheet / field / old → new from
  // the folded Scope/Impact string.
  var vals = sheet.getRange(startRow, 1, take, 10).getValues();
  var rows = [];
  for (var i = vals.length - 1; i >= 0; i--) {
    var v = vals[i];
    var scope = normalizeForRead_(v[3]);
    // Prefer legacy per-column fields when present (pre-2026-08-23 rows);
    // fall back to parsing the folded Scope/Impact for new rows.
    var legacyActor = normalizeForRead_(v[5]);
    var parsed = parseFoldedScope_(scope);
    rows.push({
      rowNumber: startRow + i,
      version:  normalizeForRead_(v[0]),
      date:     normalizeForRead_(v[1]),
      change:   normalizeForRead_(v[2]),
      scope:    scope,
      source:   normalizeForRead_(v[4]),
      actor:    legacyActor || parsed.actor || '',
      worksheet: normalizeForRead_(v[6]) || parsed.worksheet || '',
      field:    normalizeForRead_(v[7]) || parsed.field || '',
      oldValue: normalizeForRead_(v[8]) || parsed.oldValue || '',
      newValue: normalizeForRead_(v[9]) || parsed.newValue || ''
    });
  }
  return jsonOut_({ status: 'ok', rows: rows, serverTs: Date.now() });
}

// Best-effort parser for the folded Scope/Impact column written by the new
// strict five-column Change Log writer. Format is:
//   "<actor> · <SID> · <worksheet>.<field>: <old> → <new>"
// If the scope doesn't match this pattern (e.g. structural rows like
// "Structural insert of Year of Birth") returns empty strings so the reader
// can still render the row without pretending to know internal fields.
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
 *     dryRun:  true | false,          // default false; true = classify only
 *     changes: [
 *       { worksheet: "Scholars", scholarId: "SOL-S0001", field: "Given Names",
 *         oldValue: "Joeli", newValue: "Joeli ",
 *         overrideAuthorized: false,  // optional; user confirmed override
 *         expectedCurrent: "Alive"    // required with overrideAuthorized
 *       },
 *       { worksheet: "Positions", scholarId: "SOL-S0001", rowNumber: 27,
 *         field: "Standardized Academic Rank", oldValue: "Prof", newValue: "Professor" }
 *     ]
 *   }
 *
 * Response shape:
 *   {
 *     status: "ok" | "partial" | "needs_confirmation" | "rejected",
 *     dryRun: true | false,
 *     results: [
 *       { index: 0, status: "ok",                 change: {...}, writtenAt: "..." },
 *       { index: 1, status: "already_satisfied",  change: {...}, currentValue: "..." },
 *       { index: 2, status: "needs_confirmation", change: {...}, currentValue: "...",
 *                   loadedValue: "...", intendedValue: "...", reason: "override-required" },
 *       { index: 3, status: "rejected",           change: {...}, reason: "..." }
 *     ],
 *     writeEnabled: true,
 *     serverTs: 1724369101234
 *   }
 */
function handleWrite_(body) {
  var changes = Array.isArray(body.changes) ? body.changes : [];
  if (!changes.length) return jsonOut_({ status: 'bad_request', reason: 'no-changes' }, 400);
  var dryRun = body.dryRun === true;

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var lock = LockService.getScriptLock();
  var haveLock = lock.tryLock(LOCK_WAIT_MS);
  if (!haveLock) return jsonOut_({ status: 'busy', reason: 'lock-timeout' }, 503);

  var results = [];
  var counts = { ok: 0, already_satisfied: 0, needs_confirmation: 0, rejected: 0 };
  try {
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i] || {};
      var r = applyOneChange_(ss, c, dryRun);
      r.index = i;
      r.change = c;
      results.push(r);
      if (counts[r.status] != null) counts[r.status]++;
    }
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  var overall;
  if (counts.rejected === results.length)               overall = 'rejected';
  else if (counts.needs_confirmation > 0)               overall = 'needs_confirmation';
  else if (counts.rejected > 0 && counts.ok > 0)        overall = 'partial';
  else if (counts.rejected > 0)                         overall = 'rejected';
  else                                                  overall = 'ok';
  return jsonOut_({
    status: overall,
    dryRun: dryRun,
    results: results,
    counts: counts,
    writeEnabled: true,
    serverTs: Date.now()
  });
}

/**
 * Classify + (if not dry-run) apply one field change.
 *
 * Decision table (three-way comparison per field, per approval doc 2026-08-23):
 *
 *   currentMaster == intended                       → already_satisfied (skip; no log)
 *   Scholars.Alive / Deceased AND intended != currentMaster:
 *       overrideAuthorized && expectedCurrent==currentMaster → ok (write)
 *       otherwise                                   → needs_confirmation
 *   currentMaster == loaded AND intended != currentMaster   → ok (write)
 *   currentMaster != loaded AND intended != currentMaster (stale-load contradiction):
 *       overrideAuthorized && expectedCurrent==currentMaster → ok (write)
 *       otherwise                                   → needs_confirmation
 *
 * The old blanket `conflict` status is retired: every case that used to be
 * `conflict` is now either `already_satisfied` (silent skip) or
 * `needs_confirmation` (client must re-submit with overrideAuthorized).
 */
function applyOneChange_(ss, c, dryRun) {
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
  appendChangeLog_(ss, ws, sid, field, currentStr, newValue);
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

function appendChangeLog_(ss, worksheet, sid, field, oldValue, newValue) {
  var sheet = ss.getSheetByName('Change Log');
  if (!sheet) return; // If someone removed the tab, silently skip logging (do not fail the write).
  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var version = 'admin-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  var change  = 'edit: ' + worksheet + '.' + field;
  // Scope/Impact folds actor, scholar id, worksheet, field, and the exact
  // old → new values into one string. Old/new are truncated to keep the
  // cell readable; the raw values are visible in the diff preview at
  // write-time and can be reconstructed from Master history if needed.
  var scope = ACTOR_LABEL + ' · ' + sid + ' · ' + worksheet + '.' + field +
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
