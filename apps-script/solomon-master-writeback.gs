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
var SPREADSHEET_ID_FALLBACK = '1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY';
function getSpreadsheetId_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('SOLOMON_SPREADSHEET_ID');
  if(fromProps&&fromProps!==SPREADSHEET_ID_FALLBACK)throw new Error('Wrong Solomon Islands spreadsheet configuration');
  return SPREADSHEET_ID_FALLBACK;
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
    if (action === 'submissionCapabilities') return jsonOut_({status:'ok', country:'Solomon Islands', version:SOLOMON_SUBMISSIONS_VERSION, spreadsheetId:SPREADSHEET_ID_HINT, publicSubmissionsEnabled:solomonPublicEnabled_(),googleClientId:PropertiesService.getScriptProperties().getProperty('SOLOMON_GOOGLE_CLIENT_ID')||''});
    if (params.idToken || !solomonAuthorize_(params, action)) return jsonOut_({ status: 'unauthorized' }, 401);
    return solomonReadAction_(params);
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
  var headerRow = 1;
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
    var requested = body.action || 'write';
    if(body.country&&body.country!=='Solomon Islands')throw new Error('Wrong country request');
    if (requested === 'submitScholarProfileUpdate' || requested === 'submitPublicationGeography') {
      if (!solomonPublicEnabled_()) return jsonOut_({status:'disabled',reason:'SOLOMON_PUBLIC_SUBMISSIONS_ENABLED is not true'});
      return requested === 'submitScholarProfileUpdate' ? handlePublicScholarProfileSubmission_(body) : handlePublicPublicationGeographySubmission_(body);
    }
    if (!solomonAuthorize_(body, requested)) return jsonOut_({ status: 'unauthorized', reason:'Sign in with an authorized Google account.' }, 401);
    if (SOLOMON_READ_ACTIONS.indexOf(requested)>=0) return solomonReadAction_(body);
    if (!writeEnabled_()) return jsonOut_({ status: 'disabled', reason: 'WRITE_ENABLED=false' }, 423);
    var action = body.action || 'write';
    if (action === 'beginScholarReview') return solomonBeginReview_(body);
    if (action === 'recordScholarAttachmentReview') return solomonRecordAttachment_(body);
    if (action === 'finishScholarReview') return solomonFinishReview_(body);
    if (action === 'banScholarSubmitter') return solomonBanSubmitter_(body);
    if (action === 'approveScholarProfileSubmission') return solomonApproveScholar_(body);
    if (action === 'resolveScholarProfileSubmission') return solomonResolveScholar_(body);
    if (action === 'resolvePublicationGeographySubmission') return handleResolvePublicationGeographySubmission_(body);
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

  var cell=sheet.getRange(rowInfo.row,col);
  if(cell.getFormula&&cell.getFormula())return {status:'rejected',reason:'computed-field'};
  var currentRaw    = cell.getValue();
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

function solomonReadAction_(params) {
  var action=params.action||'ping';
    if (action === 'reviewCapabilities') return jsonOut_({status:'ok',country:'Solomon Islands',version:SOLOMON_SUBMISSIONS_VERSION,combinedReview:true,banSubmitter:SOLOMON_REQUEST_ROLE==='owner',currentGeography:true,role:SOLOMON_REQUEST_ROLE,actor:ACTOR_LABEL,photoPublishing:SOLOMON_REQUEST_ROLE==='owner'});
    if (action === 'describe') {
      return jsonOut_({ status: 'ok', mapping: MAPPING, writeEnabled: writeEnabled_(), actor: ACTOR_LABEL });
    }
    if (action === 'ping') {
      return jsonOut_({ status: 'ok', pong: true, writeEnabled: writeEnabled_(), actor: ACTOR_LABEL, tz: TIMEZONE, spreadsheetId: SPREADSHEET_ID_HINT });
    }
    if (action === 'readScholarProfileSubmissions') return handleReadScholarProfileSubmissions_(params);
    if (action === 'readScholarSubmissionAttachment') return handleReadScholarSubmissionAttachment_(params);
    if (action === 'readPublicationGeographySubmissions') return handleReadPublicationGeographySubmissions_(params);
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
}
var SCHOLAR_SUBMISSION_SHEET = 'Scholar Profile Submissions';
var SCHOLAR_SUBMISSION_HEADERS = ['Submission ID','Submitted At','Status','Scholar ID','Scholar Name','Submitter Name','Submitter Email','Relationship','Profile URL','Submitted Fields JSON','Structured Submission JSON','Attachments JSON','Review Notes','Reviewed By','Reviewed At','Resolution','Request ID'];
var SCHOLAR_BLOCKLIST_SHEET = 'Scholar Submission Blocklist';
var SCHOLAR_BLOCKLIST_HEADERS = ['Email','Submitter Name','Banned At','Banned By','Source Submission ID','Reason','Status'];

function normalizedSubmitterEmail_(email) { return String(email || '').trim().toLowerCase(); }

function ensureScholarBlocklistSheet_(ss) {
  var sh=ss.getSheetByName(SCHOLAR_BLOCKLIST_SHEET);if(!sh)sh=ss.insertSheet(SCHOLAR_BLOCKLIST_SHEET);
  if(sh.getMaxRows()<5)sh.insertRowsAfter(sh.getMaxRows(),5-sh.getMaxRows());
  if(sh.getMaxColumns()<SCHOLAR_BLOCKLIST_HEADERS.length)sh.insertColumnsAfter(sh.getMaxColumns(),SCHOLAR_BLOCKLIST_HEADERS.length-sh.getMaxColumns());
  var current=sh.getRange(1,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).getDisplayValues()[0];
  if(current.some(function(x){return !!x;}) && current.join('|')!==SCHOLAR_BLOCKLIST_HEADERS.join('|'))throw new Error('Blocklist headers differ');
  if(current.join('|')!==SCHOLAR_BLOCKLIST_HEADERS.join('|')){sh.getRange(1,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).setValues([SCHOLAR_BLOCKLIST_HEADERS]);sh.setFrozenRows(1);}
  return sh;
}

function isScholarSubmitterBlocked_(ss,email){
  var target=normalizedSubmitterEmail_(email),sh=ensureScholarBlocklistSheet_(ss),last=sh.getLastRow();if(!target||last<2)return false;
  var vals=sh.getRange(2,1,last-1,7).getDisplayValues();for(var i=0;i<vals.length;i++){if(normalizedSubmitterEmail_(vals[i][0])===target&&String(vals[i][6]||'Active')!=='Lifted')return true;}return false;
}

function ensureScholarSubmissionSheet_(ss) {
  var sh = ss.getSheetByName(SCHOLAR_SUBMISSION_SHEET);
  if (!sh) sh = ss.insertSheet(SCHOLAR_SUBMISSION_SHEET);
  if (sh.getMaxRows() < 5) sh.insertRowsAfter(sh.getMaxRows(), 5 - sh.getMaxRows());
  if (sh.getMaxColumns() < SCHOLAR_SUBMISSION_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), SCHOLAR_SUBMISSION_HEADERS.length - sh.getMaxColumns());
  var current = sh.getRange(1, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues()[0];
  if (current.some(function(x){return !!x;}) && current.join('|') !== SCHOLAR_SUBMISSION_HEADERS.join('|')) throw new Error('Scholar submission headers differ; preserve and review them before migration');
  if (current.join('|') !== SCHOLAR_SUBMISSION_HEADERS.join('|')) {
    sh.getRange(1, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).setValues([SCHOLAR_SUBMISSION_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function scholarSubmissionFolder_(ss) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('SOLOMON_SCHOLAR_SUBMISSION_FOLDER_ID');
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (_) {} }
  var folder = DriveApp.createFolder('Solomon Scholar Profile Submission Uploads');
  props.setProperty('SOLOMON_SCHOLAR_SUBMISSION_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * One-time setup for scholar-update attachments.
 * Run this function manually from the Apps Script editor as the owner, then
 * approve the requested Google Drive permission. It creates (or reuses) the
 * private upload folder beside the Solomon Islands Master File and remembers its ID.
 */
function authorizeScholarSubmissionStorage() {
  var ss = geoSs_();
  var folder = scholarSubmissionFolder_(ss);
  // Opening the folder alone may reuse a previously granted read-only Drive
  // scope. Create one harmless marker file so Google explicitly grants and
  // verifies the write scope that real CV/photo/thesis uploads require.
  var markerName = 'Scholar submission uploads enabled.txt';
  var existing = folder.getFilesByName(markerName);
  if (!existing.hasNext()) {
    folder.createFile(markerName, 'This file confirms that the Solomon Islands V2 scholar-update web app is authorised to save submitted attachments.');
  }
  Logger.log('Scholar submission upload folder ready with write access: ' + folder.getUrl());
  return folder.getUrl();
}

function safeSubmissionObject_(v, maxChars) {
  var out = v && typeof v === 'object' ? v : {};
  var text = JSON.stringify(out);
  if (text.length > maxChars) throw new Error('submission-data-too-large');
  return text;
}

function saveScholarSubmissionFiles_(ss, sid, submissionId, files) {
  if (!Array.isArray(files)) return [];
  if (files.length > 6) throw new Error('too-many-files');
  // Do not request Drive access for the common text-only submission path.
  // DriveApp requires an additional OAuth scope, and an empty attachment
  // array must not prevent an otherwise valid update reaching Admin V2.
  var actualFiles = files.filter(function(f){ return !!(f && f.data); });
  if (!actualFiles.length) return [];
  var folder = scholarSubmissionFolder_(ss), saved = [], total = 0;
  actualFiles.forEach(function (f) {
    solomonValidateFile_(f);
    var bytes = Utilities.base64Decode(String(f.data));
    if(f.field==='headshot'&&(bytes.length<3||(bytes[0]&255)!==255||(bytes[1]&255)!==216||(bytes[2]&255)!==255))throw new Error('Invalid JPEG file');
    if(/thesis|^cv$/.test(f.field)&&bytes.slice(0,5).map(function(b){return String.fromCharCode(b&255);}).join('')!=='%PDF-')throw new Error('Invalid PDF file');
    total += bytes.length;
    if (bytes.length > 12 * 1024 * 1024 || total > 30 * 1024 * 1024) throw new Error('attachment-size-limit');
    var original = String(f.name || 'attachment').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 180);
    // The browser already standardises known uploads as
    // SOL-Sxxxx-Scholar Name-Headshot.jpg. Do not add a submission ID or a
    // second Scholar ID in front of that readable filename.
    var name = new RegExp('^'+sid.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')+'-', 'i').test(original) ? original : sid+'-'+original;
    var blob = Utilities.newBlob(bytes, String(f.type || 'application/octet-stream'), name);
    var file = folder.createFile(blob);
    saved.push({ field: String(f.field || 'attachment').slice(0, 80), name: name, url: file.getUrl(), size: bytes.length, type:file.getMimeType(), fileId: file.getId() });
  });
  return saved;
}

function handlePublicScholarProfileSubmission_Once_(body) {
  var ss = geoSs_(), sid = String(body.scholarId || '').toUpperCase(), token = String(body.shareToken || '').trim();
  if (!validScholarShareToken_(ss, sid, token)) return jsonOut_({ status:'unauthorized', reason:'invalid-scholar-share-token' }, 401);
  var name = String(body.submitterName || '').trim(), email = String(body.submitterEmail || '').trim(), rel = String(body.submitterRelationship || '').trim();
  if (!name || !rel || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonOut_({ status:'bad_request', reason:'valid-name-email-and-relationship-required' }, 400);
  if (isScholarSubmitterBlocked_(ss,email)) return jsonOut_({status:'forbidden',reason:'submissions-from-this-email-are-blocked'},403);
  var now = new Date(), submissionId = 'SPS-' + Utilities.formatDate(now, TIMEZONE, 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0,8);
  var fieldsJson, structuredJson;
  try {
    fieldsJson = safeSubmissionObject_(body.fields, 45000);
    var publicStructured=JSON.parse(safeSubmissionObject_(body.structuredSubmission, 45000));
    delete publicStructured.adminReviewV2;delete publicStructured.adminReviewV2Signature;
    structuredJson=JSON.stringify(publicStructured);
  } catch (err) { return jsonOut_({ status:'bad_request', reason:String(err.message || err) }, 400); }
  if (!body.fields || Array.isArray(body.fields)) return jsonOut_({status:'bad_request',reason:'fields-object-required'});
  if (!Object.keys(body.fields).length && !(body.files || []).length) return jsonOut_({status:'bad_request',reason:'no-changes'});
  solomonValidateSubmission_(ss,body);
  var attachments;
  try { attachments = saveScholarSubmissionFiles_(ss, sid, submissionId, body.files || []); }
  catch (err2) { return jsonOut_({ status:'bad_request', reason:String(err2.message || err2) }, 400); }
  var row = [submissionId, Utilities.formatDate(now,TIMEZONE,'yyyy-MM-dd HH:mm:ss'), 'Pending', sid,
    String(body.scholarName || '').slice(0,240), name.slice(0,160), email.slice(0,240), rel.slice(0,100),
    String(body.profileUrl || '').slice(0,700), fieldsJson, structuredJson, JSON.stringify(attachments), '', '', '', '',body._requestKey];

  { var sh = ensureScholarSubmissionSheet_(ss); sh.getRange(sh.getLastRow()+1,1,1,SCHOLAR_SUBMISSION_HEADERS.length).setValues([row.map(solomonLiteral_)]); }

  return jsonOut_({ status:'ok', submissionId:submissionId, queued:1, attachments:attachments.length });
}

function handleReadScholarProfileSubmissions_(params) {
  var ss = geoSs_(), sh = ensureScholarSubmissionSheet_(ss), last = sh.getLastRow();
  if (last < 2) return jsonOut_({ status:'ok', rows:[] });
  var vals = sh.getRange(2,1,last-1,SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues(), want = String(params.status || '').trim(), rows = [];
  vals.forEach(function(r){
    if(!r[0] || (want && r[2] !== want)) return;
    var o={}; SCHOLAR_SUBMISSION_HEADERS.forEach(function(h,i){o[h]=r[i]||'';});
    o.reviewPlan=solomonReviewPlan_(o);
    o.proposedChanges = buildScholarSubmissionChanges_(ss, o);
    rows.push(o);
  });
  rows.reverse(); return jsonOut_({ status:'ok', rows:rows });
}

function findScholarSubmission_(ss,id){
  var sh=ensureScholarSubmissionSheet_(ss),last=sh.getLastRow();if(last<2)return null;
  var vals=sh.getRange(2,1,last-1,SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues();
  for(var i=0;i<vals.length;i++){if(vals[i][0]===id){var o={_row:i+2,_sheet:sh};SCHOLAR_SUBMISSION_HEADERS.forEach(function(h,j){o[h]=vals[i][j]||'';});return o;}}return null;
}

function handleReadScholarSubmissionAttachment_(params){
  var ss=geoSs_(),sub=findScholarSubmission_(ss,String(params.submissionId||'').trim());if(!sub)return jsonOut_({status:'not_found'},404);
  var fileId=String(params.fileId||'').trim(),files=parseJsonObject_(sub['Attachments JSON']);if(!Array.isArray(files))files=[];
  var allowed=null;for(var i=0;i<files.length;i++){if(String(files[i].fileId||'')===fileId){allowed=files[i];break;}}
  if(!allowed)return jsonOut_({status:'unauthorized',reason:'attachment-not-in-submission'},401);
  var file=DriveApp.getFileById(fileId),blob=file.getBlob();
  return jsonOut_({status:'ok',fileId:fileId,name:file.getName(),type:file.getMimeType(),size:blob.getBytes().length,data:Utilities.base64Encode(blob.getBytes())});
}

function parseJsonObject_(text) {
  try { var v=JSON.parse(String(text||'')); return v && typeof v==='object' ? v : {}; }
  catch (_) { return {}; }
}

function scholarSubmissionFieldSpecs_() {
  return [
    {key:'salutation',label:'Title / salutation',ws:'Scholars',field:'Title/Salutation',clean:function(v){return String(v||'').replace(/\.$/,'');}},
    {key:'gender',label:'Gender',ws:'Scholars',field:'Gender',clean:solomonGender_},
    {key:'paternal_province',label:'Paternal province',ws:'Scholars',field:'Paternal Province/City Area'},
    {key:'paternal_village',label:'Paternal village',ws:'Scholars',field:'Paternal Village/Community'},
    {key:'paternal_island',label:'Paternal island',ws:'Scholars',field:'Paternal Specific Island'},
    {key:'maternal_province',label:'Maternal province',ws:'Scholars',field:'Maternal Province/City Area'},
    {key:'maternal_village',label:'Maternal village',ws:'Scholars',field:'Maternal Village/Community'},
    {key:'maternal_island',label:'Maternal island',ws:'Scholars',field:'Maternal Specific Island'},
    {key:'title',label:'Professional title',ws:'Scholars',field:'Current Role'},
    {key:'institution',label:'Current institution',ws:'Scholars',field:'Current Institution ID'},
    {key:'department',label:'Department / unit',ws:'Scholars',field:'Department'},
    {key:'profile_url',label:'Current profile URL',ws:'Scholars',field:'Personal/Official Profile URL'},
    {key:'google_scholar_url',label:'Google Scholar URL',ws:'Scholars',field:'Google Scholar'},
    {key:'orcid_url',label:'ORCID / Researcher ID',ws:'Scholars',field:'ORCID'},
    {key:'masters_university',label:'Master\'s university',ws:'Graduate Degrees',field:'Institution ID',stage:'master'},
    {key:'masters_country',label:'Master\'s country',ws:'Graduate Degrees',field:'Country',stage:'master'},
    {key:'masters_year',label:'Master\'s completion year',ws:'Graduate Degrees',field:'Graduation Year',stage:'master'},
    {key:'masters_thesis_url',label:'Master\'s thesis / degree URL',ws:'Graduate Degrees',field:'Repository URL',stage:'master'},
    {key:'phd_university',label:'PhD university',ws:'Graduate Degrees',field:'Institution ID',stage:'phd'},
    {key:'phd_country',label:'PhD country',ws:'Graduate Degrees',field:'Country',stage:'phd'},
    {key:'phd_year',label:'PhD completion year',ws:'Graduate Degrees',field:'Graduation Year',stage:'phd'},
    {key:'phd_thesis_url',label:'PhD thesis / degree URL',ws:'Graduate Degrees',field:'Repository URL',stage:'phd'}
  ];
}

function buildScholarSubmissionChanges_(ss, submission) {
  var fields=parseJsonObject_(submission['Submitted Fields JSON']), structured=parseJsonObject_(submission['Structured Submission JSON']), changedOnly=structured.changedFieldsOnly===true, sid=String(submission['Scholar ID']||''), out=[];
  var scholarSheet=ss.getSheetByName('Scholars'), scholarCfg=MAPPING.worksheets.Scholars, scholarInfo=locateRow_(scholarSheet,scholarCfg,{scholarId:sid});
  var gradSheet=ss.getSheetByName('Graduate Degrees'), gradRows={}, degreeCounts={master:0,phd:0};
  if(gradSheet){
    var lastCol=gradSheet.getLastColumn(), headers=gradSheet.getRange(1,1,1,lastCol).getDisplayValues()[0], sidCol=headers.indexOf('Scholar ID')+1, stageCol=headers.indexOf('Stage')+1, last=gradSheet.getLastRow();
    if(sidCol&&stageCol&&last>=2){var vals=gradSheet.getRange(2,1,last-1,lastCol).getDisplayValues();vals.forEach(function(r,i){if(String(r[sidCol-1])!==sid)return;var stage=String(r[stageCol-1]||'').toLowerCase();if(/master/.test(stage))degreeCounts.master++;if(/(phd|doctor)/.test(stage))degreeCounts.phd++;if(!gradRows.master&&/master/.test(stage))gradRows.master={row:i+2,headers:headers};if(!gradRows.phd&&/(phd|doctor)/.test(stage))gradRows.phd={row:i+2,headers:headers};});}
  }
  scholarSubmissionFieldSpecs_().forEach(function(spec){
    if(!Object.prototype.hasOwnProperty.call(fields,spec.key))return;
    var proposed=spec.clean?spec.clean(fields[spec.key]):String(fields[spec.key]==null?'':fields[spec.key]).trim();
    // Older submissions sent every form control and therefore cannot
    // distinguish an untouched empty control from a deliberate clear. The
    // safe review behaviour is to suppress legacy blank clears.
    if(!changedOnly && proposed==='')return;
    var current='',rowNumber=null,writable=true,reason='';
    if(spec.key==='institution'||/_university$/.test(spec.key)){try{proposed=solomonInstitutionId_(ss,proposed);}catch(e){writable=false;reason=e.message;}}
    if(spec.ws==='Scholars'){
      if(!scholarInfo.ok){writable=false;reason=scholarInfo.reason||'scholar-not-found';}
      else {var col=scholarInfo.headers[spec.field];if(!col){writable=false;reason='Master field not found';}else current=normalizeForRead_(scholarSheet.getRange(scholarInfo.row,col).getValue());}
    } else {
      var degree=gradRows[spec.stage];
      if(degreeCounts[spec.stage]>1){writable=false;reason='Multiple degree rows: use the scholar editor to choose the correct degree';}
      else if(!degree){writable=false;reason='No existing '+spec.stage+' degree row in Master';}
      else {var dcol=degree.headers.indexOf(spec.field)+1;if(!dcol){writable=false;reason='Master field not found';}else{rowNumber=degree.row;current=normalizeForRead_(gradSheet.getRange(degree.row,dcol).getValue());}}
    }
    // Public forms display Master sentinel values such as "Unclassified" as
    // an empty control. Treat those as equivalent, particularly for legacy
    // submissions made before the browser began sending changed fields only.
    if(writable && spec.ws==='Scholars' && scholarSheet.getRange(scholarInfo.row,scholarInfo.headers[spec.field]).getFormula()){writable=false;reason='Computed field; update its source field in Master';}
    var fieldCfg=MAPPING.worksheets[spec.ws].fields[spec.field];
    if(writable && (!fieldCfg || !validateValue_(proposed,fieldCfg).ok || /^\s*=/.test(proposed))){writable=false;reason='Value requires correction before approval';}
    var currentCompare=/^(unclassified|unknown|n\/a|na|-)$/i.test(String(current||'').trim())?'':current;
    if(normalizeForCompare_(currentCompare)===normalizeForCompare_(proposed))return;
    out.push({key:spec.key,label:spec.label,worksheet:spec.ws,field:spec.field,rowNumber:rowNumber,degreeId:rowNumber?gradSheet.getRange(rowNumber,gradRows[spec.stage].headers.indexOf('Degree ID')+1).getDisplayValue():'',currentValue:current,newValue:proposed,writable:writable,reason:reason});
  });
  // These are deliberately retained as visible manual-review changes because
  // they live in the GitHub enrichment sidecar, not in a Master Sheet column.
  // Sidecar URLs cannot be compared with the Master sheet. New submissions
  // contain them only when edited, but legacy submissions contained every
  // prefilled field. Hide them for legacy rows rather than claiming a change.
  if(changedOnly){
    [{key:'institution_url',label:'Institution URL'},{key:'department_url',label:'Department URL'}].forEach(function(spec){
      if(Object.prototype.hasOwnProperty.call(fields,spec.key))out.push({key:spec.key,label:spec.label,currentValue:'Stored outside Master',newValue:String(fields[spec.key]||'').trim(),writable:false,reason:'Sidecar field — apply through the normal scholar editor'});
    });
  }
  return out;
}


var SOLOMON_SUBMISSIONS_VERSION = 'solomon-submissions-1';
var GEO_SUBMISSION_SHEET = 'Publication Geography Submissions';
var GEO_SUBMISSION_HEADERS = ['Submission ID','Submitted At','Status','Scholar ID','Scholar Name','Submitter Name','Submitter Email','Relationship','Profile URL','Publication Key','Publication Title','Year','Proposed Solomon Islands Locations JSON','Proposed Pacific Countries','Proposed Other Countries','Review Notes','Reviewed By','Reviewed At','Resolution','Request ID'];
var SOLOMON_PROVINCES = ['Central','Choiseul','Guadalcanal','Isabel','Makira-Ulawa','Malaita','Rennell-Bellona','Temotu','Western'];
function geoSs_(){return SpreadsheetApp.openById(SPREADSHEET_ID_HINT);}
function solomonPublicEnabled_(){return PropertiesService.getScriptProperties().getProperty('SOLOMON_PUBLIC_SUBMISSIONS_ENABLED')==='true';}
function solomonLiteral_(v){return typeof v==='string' && /^[=+@-]/.test(v) ? "'"+v : v;}
function solomonTable_(ss,name){
  var sh=ss.getSheetByName(name);if(!sh)throw new Error(name+' worksheet missing');
  var n=sh.getLastColumn();if(!n)throw new Error(name+' headers missing');
  var h=sh.getRange(1,1,1,n).getDisplayValues()[0];
  var rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,n).getDisplayValues():[];
  return {sheet:sh,headers:h,rows:rows};
}
function solomonEnsureGeoQueue_(ss){
  var sh=ss.getSheetByName(GEO_SUBMISSION_SHEET)||ss.insertSheet(GEO_SUBMISSION_SHEET);
  if(sh.getMaxColumns()<GEO_SUBMISSION_HEADERS.length)sh.insertColumnsAfter(sh.getMaxColumns(),GEO_SUBMISSION_HEADERS.length-sh.getMaxColumns());
  if(sh.getMaxRows()<5)sh.insertRowsAfter(sh.getMaxRows(),5-sh.getMaxRows());
  var h=sh.getRange(1,1,1,GEO_SUBMISSION_HEADERS.length).getDisplayValues()[0];
  if(h.some(function(x){return !!x;})&&h.join('|')!==GEO_SUBMISSION_HEADERS.join('|'))throw new Error('Existing geography queue headers differ; no data overwritten');
  if(h.join('|')!==GEO_SUBMISSION_HEADERS.join('|'))sh.getRange(1,1,1,GEO_SUBMISSION_HEADERS.length).setValues([GEO_SUBMISSION_HEADERS]);
  sh.setFrozenRows(1);return sh;
}
function validScholarShareToken_(ss,sid,token){
  if(!/^SOL-S\d{4,}$/i.test(sid)||!/^[a-f0-9]{40}$/i.test(token))return false;
  var t=solomonTable_(ss,'Scholars'),i=t.headers.indexOf('Scholar ID'),k=t.headers.indexOf('Scholar Share Token');
  if(i<0||k<0)return false;
  var matches=t.rows.filter(function(r){return r[i].toUpperCase()===sid.toUpperCase();});
  return matches.length===1&&matches[0][k].toLowerCase()===token.toLowerCase();
}
function solomonQueueObject_(sh,headers,id){
  var last=sh.getLastRow();if(last<2)return null;
  var rows=sh.getRange(2,1,last-1,headers.length).getDisplayValues();
  for(var i=0;i<rows.length;i++)if(rows[i][0]===id){var o={_row:i+2,_sheet:sh};headers.forEach(function(h,j){o[h]=rows[i][j];});return o;}
  return null;
}
function solomonNow_(){return Utilities.formatDate(new Date(),TIMEZONE,'yyyy-MM-dd HH:mm:ss');}
function solomonProvince_(v){
 v=String(v||'').trim();if(!v)return '';
 var found=SOLOMON_PROVINCES.filter(function(p){return p.toLowerCase()===v.toLowerCase();})[0];
 if(!found)throw new Error('Invalid Solomon Islands province: '+v);return found;
}
function solomonList_(v){
  if(v==null)return [];if(!Array.isArray(v)||v.length>50)throw new Error('Invalid country list');
  var out=[];v.forEach(function(x){if(typeof x!=='string')throw new Error('Country must be text');x=x.trim();if(/^nauru$/i.test(x))x='Naoero';if(!x||x.length>100||/[;\n\r=]/.test(x))throw new Error('Invalid country name');if(out.indexOf(x)<0)out.push(x);});return out;
}
function solomonLocations_(v){
  if(v==null)return [];if(!Array.isArray(v)||v.length>30)throw new Error('Invalid Solomon location list');
  return v.map(function(x){
    if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('Invalid Solomon location');
    var o={national:x.national===true,province:solomonProvince_(x.province),island:String(x.island||'').trim(),village:String(x.village||'').trim()};
    ['island','village'].forEach(function(k){if(o[k].length>160||/[=\r\n]/.test(o[k]))throw new Error('Invalid location text');});
    if(o.national&&(o.province||o.island||o.village))throw new Error('National study must not also specify a locality in the same entry');
    if(!o.national&&!o.province)throw new Error('Choose a province for a local Solomon Islands study');return o;
  });
}
function solomonLinkedPublication_(ss,sid,key){
  var t=solomonTable_(ss,'Authorship'),si=t.headers.indexOf('Scholar ID'),pi=t.headers.indexOf('Publication ID');
  if(si<0||pi<0)throw new Error('Authorship headers require verification');
  return t.rows.some(function(r){return r[si]===sid&&r[pi]===key;});
}
function handlePublicPublicationGeographySubmission_Once_(body){
  var ss=geoSs_(),sid=String(body.scholarId||'').toUpperCase();
  if(!validScholarShareToken_(ss,sid,String(body.shareToken||'')))return jsonOut_({status:'unauthorized'});
  var name=String(body.submitterName||'').trim(),email=String(body.submitterEmail||'').trim(),rel=String(body.submitterRelationship||'').trim();
  if(!name||!rel||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('Valid name, email and relationship required');
  if(isScholarSubmitterBlocked_(ss,email))return jsonOut_({status:'forbidden'});
  if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>100)throw new Error('Provide 1–100 publication changes');
  var rows=body.changes.map(function(c){
    var key=String(c.item_key||'').trim();if(!key||key.length>300||!solomonLinkedPublication_(ss,sid,key))throw new Error('Publication is not linked to this scholar');
    var loc=solomonLocations_(c.solomon_locations),pac=solomonList_(c.pacific_countries),other=solomonList_(c.other_countries);
    if(!loc.length&&!pac.length&&!other.length)throw new Error('Choose at least one research location');
    return ['PGS-'+Utilities.getUuid(),solomonNow_(),'Pending',sid,String(body.scholarName||'').slice(0,240),name.slice(0,160),email.slice(0,240),rel.slice(0,100),String(body.profileUrl||'').slice(0,700),key,String(c.title||'').slice(0,700),String(c.year||'').slice(0,20),JSON.stringify(loc),pac.join('; '),other.join('; '),'','','','',body._requestKey].map(solomonLiteral_);
  });

  {var sh=solomonEnsureGeoQueue_(ss);sh.getRange(sh.getLastRow()+1,1,rows.length,GEO_SUBMISSION_HEADERS.length).setValues(rows);}
  return jsonOut_({status:'ok',queued:rows.length});
}
function handleReadPublicationGeographySubmissions_(params){
  var ss=geoSs_(),sh=solomonEnsureGeoQueue_(ss),last=sh.getLastRow(),out=[];
  if(last>1)sh.getRange(2,1,last-1,GEO_SUBMISSION_HEADERS.length).getDisplayValues().forEach(function(r){if(!r[0]||(params.status&&r[2]!==params.status))return;var o={};GEO_SUBMISSION_HEADERS.forEach(function(h,i){o[h]=r[i];});try{o.currentSolomonLocations=solomonCurrentGeo_(ss,o['Publication Key']);}catch(e){o.currentGeographyError=String(e.message||e);}
  out.push(o);});
  return jsonOut_({status:'ok',rows:out.reverse()});
}
function solomonAddGeo_(ss,o){
 if(!solomonLinkedPublication_(ss,o['Scholar ID'],o['Publication Key']))throw new Error('Publication linkage changed; review again');
 var t=solomonTable_(ss,'Research Geography'),required=['Geography ID','Publication ID','Country','Province/City Area','Specific Island','Village/Community/Site','Geography Scale','Evidence Excerpt/Context','Verification Status'];
 required.forEach(function(h){if(t.headers.indexOf(h)<0)throw new Error('Research Geography header missing: '+h);});
 var loc=solomonLocations_(JSON.parse(o['Proposed Solomon Islands Locations JSON']||'[]')),candidates=[];
 solomonValidateLocationLinks_(ss,loc);
 loc.forEach(function(l){candidates.push({country:'Solomon Islands',province:l.province,island:l.island,village:l.village,type:l.national?'National / general study':l.village?'Village / site':l.island?'Island':'Province'});});
 [o['Proposed Pacific Countries'],o['Proposed Other Countries']].forEach(function(v){solomonList_(String(v||'').split(';').map(function(c){return c.trim();}).filter(Boolean)).forEach(function(c){candidates.push({country:c,province:'',island:'',village:'',type:'Country / study location'});});});
 var keys=['Publication ID','Country','Province/City Area','Specific Island','Village/Community/Site'];
 function signature(r){return keys.map(function(h){var v=String(r[t.headers.indexOf(h)]||'').trim().toLowerCase();return v==='nauru'?'naoero':v;}).join('|');}
 var seen={},ids=[];t.rows.forEach(function(r){seen[signature(r)]=r[t.headers.indexOf('Geography ID')];});
 candidates.forEach(function(c){
  var r=t.headers.map(function(){return '';});function set(h,v){r[t.headers.indexOf(h)]=v;}
  set('Geography ID','SOL-GEO-'+Utilities.getUuid());set('Publication ID',o['Publication Key']);set('Country',c.country);set('Province/City Area',c.province);set('Specific Island',c.island);set('Village/Community/Site',c.village);set('Geography Scale',c.type);
  set('Evidence Excerpt/Context','Reviewed submission '+o['Submission ID']+'; '+ACTOR_LABEL+'; '+solomonNow_()+'; '+String(o['Profile URL']||''));set('Verification Status','Verified');
  var sig=signature(r);if(seen[sig]){ids.push(seen[sig]);return;}
  var row=t.sheet.getLastRow()+1;
  if(t.sheet.getRange(row,1,1,r.length).getFormulas()[0].some(function(f){return !!f;}))throw new Error('Target geography row contains formulas');
  t.sheet.getRange(row,1,1,r.length).setValues([r.map(solomonLiteral_)]);seen[sig]=r[0];ids.push(r[0]);
 });return ids;
}
function handleResolvePublicationGeographySubmission_(body){
  if(['approve','reject'].indexOf(body.decision)<0)throw new Error('Invalid decision');
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{
    var ss=geoSs_(),o=solomonQueueObject_(solomonEnsureGeoQueue_(ss),GEO_SUBMISSION_HEADERS,String(body.submissionId||''));
    if(!o)return jsonOut_({status:'not_found'});if(o.Status!=='Pending')return jsonOut_({status:'already_resolved',decision:o.Status});
    var n=body.decision==='approve'?solomonAddGeo_(ss,o):0,status=body.decision==='approve'?'Approved':'Rejected';
    var resolution=status==='Approved'?'Geography records: '+n.join(', ')+'; existing geography preserved.':'Rejected; no Master changes.';
    o._sheet.getRange(o._row,16,1,4).setValues([[solomonLiteral_(String(body.reviewNotes||'').slice(0,1500)),ACTOR_LABEL,solomonNow_(),resolution]]);
    appendChangeLog_(ss,GEO_SUBMISSION_SHEET,o['Scholar ID'],o['Submission ID'],'Pending',status);
    o._sheet.getRange(o._row,3).setValue(status);return jsonOut_({status:'ok',decision:body.decision,added:n});
  }finally{lock.releaseLock();}
}
function solomonApproveScholar_(body){
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{
    var ss=geoSs_(),o=findScholarSubmission_(ss,String(body.submissionId||''));
    if(!o)return jsonOut_({status:'not_found'});if(o.Status!=='Pending')return jsonOut_({status:'already_resolved'});
    var plan=solomonReviewPlan_(o);if(plan)return solomonApplyPlan_(ss,o,plan);
    var proposed=buildScholarSubmissionChanges_(ss,o),chosen=body.selectedChanges;
    if(!Array.isArray(chosen)||!chosen.length)throw new Error('Select at least one field');
    var changes=[],seen={};chosen.forEach(function(x){
      if(seen[x.key])throw new Error('Duplicate selected field');seen[x.key]=true;
      var p=proposed.filter(function(v){return v.key===x.key;})[0];
      if(!p||!p.writable)throw new Error('Field is not currently writable; refresh review');
      if(normalizeForCompare_(x.expectedCurrent)!==normalizeForCompare_(p.currentValue))throw new Error('Master changed since review; refresh before approving');
      changes.push({worksheet:p.worksheet,scholarId:o['Scholar ID'],rowNumber:p.rowNumber,field:p.field,oldValue:p.currentValue,newValue:p.newValue});
    });
    // Validate every selected field before the first write. Retain Pending if any operation fails.
    var checks=changes.map(function(c){return applyOneChange_(ss,c,true);});
    if(checks.some(function(r){return ['ok','already_satisfied'].indexOf(r.status)<0;}))return jsonOut_({status:'rejected',results:checks});
    var results=changes.map(function(c){return applyOneChange_(ss,c,false);});
    if(results.some(function(r){return ['ok','already_satisfied'].indexOf(r.status)<0;}))return jsonOut_({status:'partial',results:results});
    var pending=buildScholarSubmissionChanges_(ss,o),files=parseJsonObject_(o['Attachments JSON']);
    var remains=pending.length>0||(Array.isArray(files)&&files.length>0);
    o._sheet.getRange(o._row,13,1,4).setValues([[solomonLiteral_(String(body.reviewNotes||'').slice(0,1500)),ACTOR_LABEL,solomonNow_(),'Applied '+changes.length+' selected field(s). '+(remains?'Remaining fields/attachments require review.':'All proposed fields applied.')]]);
    if(!remains)o._sheet.getRange(o._row,3).setValue('Reviewed');
    return jsonOut_({status:'ok',results:results,remainingReview:remains});
  }finally{lock.releaseLock();}
}
function solomonResolveScholar_(body){
  if(['reject','reviewed'].indexOf(body.decision)<0)throw new Error('Invalid decision');
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{
    var ss=geoSs_(),o=findScholarSubmission_(ss,String(body.submissionId||''));if(!o)return jsonOut_({status:'not_found'});
    if(o.Status!=='Pending')return jsonOut_({status:'already_resolved'});
    if(body.decision==='reviewed'&&solomonReviewPlan_(o))throw new Error('Finish the per-item review before closing this submission');
    if(body.decision==='reject')solomonRejectRemaining_(o);
    if(body.decision==='reviewed'&&!String(body.reviewNotes||'').trim())throw new Error('Describe disposition of remaining fields and attachments');
    var status=body.decision==='reject'?'Rejected':'Reviewed';
    var message='Closed review. This action makes no Master, photo or publication changes; earlier approved changes, if any, remain recorded.';
    o._sheet.getRange(o._row,13,1,4).setValues([[solomonLiteral_(String(body.reviewNotes||'').slice(0,1500)),ACTOR_LABEL,solomonNow_(),message]]);
    appendChangeLog_(ss,SCHOLAR_SUBMISSION_SHEET,o['Scholar ID'],o['Submission ID'],'Pending',status);o._sheet.getRange(o._row,3).setValue(status);
    return jsonOut_({status:'ok',decision:body.decision});
  }finally{lock.releaseLock();}
}
/** Run once in the editor. Creates review sheets only; does not enable public submissions. */
function setupSolomonSubmissionQueues(){
  var ss=geoSs_();
  if(ss.getId()!=='1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY')throw new Error('Wrong spreadsheet');
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{ensureScholarSubmissionSheet_(ss);ensureScholarBlocklistSheet_(ss);solomonEnsureGeoQueue_(ss);}finally{lock.releaseLock();}
  Logger.log('Solomon submission queues ready. Public submissions remain '+(solomonPublicEnabled_()?'enabled':'disabled')+'.');
}

// Review v2 stores its private journal inside existing Structured Submission JSON.
// No queue columns are migrated. The public export does not read this worksheet.
function solomonPlanSignature_(plan){return Utilities.base64Encode(Utilities.computeHmacSha256Signature(JSON.stringify(plan),PropertiesService.getScriptProperties().getProperty('SHARED_SECRET')));}
function solomonReviewPlan_(o){var s=parseJsonObject_(o['Structured Submission JSON']);if(!s.adminReviewV2)return null;if(s.adminReviewV2Signature!==solomonPlanSignature_(s.adminReviewV2))throw new Error('Invalid review journal signature; owner inspection required');return s.adminReviewV2;}
function solomonSavePlan_(o,p){
  var structured=parseJsonObject_(o['Structured Submission JSON']);structured.adminReviewV2=p;structured.adminReviewV2Signature=solomonPlanSignature_(p);
  var serialized=JSON.stringify(structured);if(serialized.length>49000)throw new Error('Review journal exceeds cell capacity; review manually');
  o._sheet.getRange(o._row,11).setValue(serialized);o['Structured Submission JSON']=serialized;
}
function solomonWithSubmission_(body,fn){
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{var ss=geoSs_(),o=findScholarSubmission_(ss,String(body.submissionId||''));if(!o)throw new Error('Submission not found');
    if(o.Status!=='Pending')throw new Error('Submission already '+o.Status);return fn(ss,o);
  }finally{lock.releaseLock();}
}
function solomonBeginReview_(body){return solomonWithSubmission_(body,function(ss,o){
  var old=solomonReviewPlan_(o);if(old)return jsonOut_({status:'ok',plan:old,resumed:true});
  var proposed=buildScholarSubmissionChanges_(ss,o),selected=body.selectedChanges||[],fileIds=body.selectedFiles||[];
  if(!Array.isArray(selected)||!Array.isArray(fileIds))throw new Error('Invalid review selection');
  var keys={};selected.forEach(function(x){if(keys[x.key])throw new Error('Duplicate selection');keys[x.key]=x;
    var p=proposed.filter(function(c){return c.key===x.key;})[0];
    if(!p||!p.writable)throw new Error('Selected field requires a fresh review');
    if(normalizeForCompare_(x.expectedCurrent)!==normalizeForCompare_(p.currentValue))throw new Error('Master changed since review; refresh before approving');
  });
  var files=parseJsonObject_(o['Attachments JSON']);if(!Array.isArray(files))files=[];
  fileIds.forEach(function(id){if(!files.some(function(f){return f.fileId===id;}))throw new Error('Attachment not in submission');});
  var plan={version:2,reviewer:ACTOR_LABEL,startedAt:solomonNow_(),note:String(body.reviewNotes||'').slice(0,1500),items:[]};
  proposed.forEach(function(c){plan.items.push({kind:'text',key:c.key,label:c.label,selected:!!keys[c.key],state:keys[c.key]?'pending':'rejected',change:c});});
  files.forEach(function(f){plan.items.push({kind:'file',key:f.fileId,field:f.field,name:f.name,selected:fileIds.indexOf(f.fileId)>=0,state:fileIds.indexOf(f.fileId)>=0?'pending':'rejected'});});
  solomonSavePlan_(o,plan);return jsonOut_({status:'ok',plan:plan});
});}
function solomonApplyPlan_(ss,o,plan){
  var pending=plan.items.filter(function(x){return x.kind==='text'&&x.state==='pending';}),results=[];
  // Check all pending fields before applying any; re-resolve degree rows each time.
  var current=buildScholarSubmissionChanges_(ss,o);
  pending.forEach(function(item){
    var c=item.change,p=current.filter(function(x){return x.key===item.key;})[0];
    if(p&&(!p.writable||normalizeForCompare_(p.currentValue)!==normalizeForCompare_(c.currentValue)))throw new Error('Master conflict for '+item.label+'; pending review retained');
    // If a previous write succeeded but acknowledgement failed, applyOneChange_
    // recognizes the desired value. For degree rows still require a unique row.
    var target=p||c;
    if(p&&c.degreeId&&p.degreeId!==c.degreeId)throw new Error('Degree identity changed; review again');
    if(c.worksheet==='Graduate Degrees'&&!p){
      var t=solomonTable_(ss,'Graduate Degrees'),si=t.headers.indexOf('Scholar ID'),di=t.headers.indexOf('Stage');
      var stage=scholarSubmissionFieldSpecs_().filter(function(x){return x.key===item.key;})[0].stage;
      var rows=t.rows.map(function(r,i){return {r:r,n:i+2};}).filter(function(x){return x.r[si]===o['Scholar ID']&&(stage==='master'?/master/i:/(phd|doctor)/i).test(x.r[di]);});
      if(rows.length!==1||c.degreeId&&rows[0].r[t.headers.indexOf('Degree ID')]!==c.degreeId)throw new Error('Ambiguous degree row; pending review retained');target.rowNumber=rows[0].n;
    }
    item._write={worksheet:c.worksheet,scholarId:o['Scholar ID'],rowNumber:target.rowNumber,field:c.field,oldValue:c.currentValue,newValue:c.newValue};
    var test=applyOneChange_(ss,item._write,true);if(['ok','already_satisfied'].indexOf(test.status)<0)throw new Error('Field validation failed: '+item.label+' ('+test.status+')');
  });
  pending.forEach(function(item){
    var result=applyOneChange_(ss,item._write,false);delete item._write;
    results.push({key:item.key,status:result.status});
    if(['ok','already_satisfied'].indexOf(result.status)>=0){item.state='applied';item.reviewedBy=ACTOR_LABEL;item.reviewedAt=solomonNow_();solomonSavePlan_(o,plan);}
  });
  return jsonOut_({status:results.some(function(r){return ['ok','already_satisfied'].indexOf(r.status)<0;})?'partial':'ok',results:results,plan:plan,remainingReview:true});
}
function solomonRecordAttachment_(body){return solomonWithSubmission_(body,function(ss,o){
  var plan=solomonReviewPlan_(o);if(!plan)throw new Error('Begin review first');
  var item=plan.items.filter(function(x){return x.kind==='file'&&x.key===body.fileId;})[0];
  if(!item||!item.selected)throw new Error('Attachment not selected');
  if(item.state!=='pending')return jsonOut_({status:'ok',plan:plan,alreadyRecorded:true});
  var disposition=String(body.disposition||''),evidence=String(body.evidence||'').trim();
  if(item.field==='headshot'){
    if(SOLOMON_REQUEST_ROLE!=='owner')throw new Error('Photo publication must be completed by the Owner; this item stays Pending.');
    if(disposition!=='published'||!/^img\/scholars\/SOL-S\d+\.jpg$/.test(evidence)||evidence!=='img/scholars/'+o['Scholar ID']+'.jpg')throw new Error('Successful Solomon Islands photo service result required');
  }else{
    if(['reviewed_privately','imported'].indexOf(disposition)<0||evidence.length<10)throw new Error('Describe actual private review or completed import; downloading is not importing');
    if(/bibliograph|bibtex|ris|enw/i.test(item.field+' '+item.name)&&disposition!=='imported')throw new Error('Bibliography requires a completed import with evidence');
  }
  item.state=disposition;item.evidence=evidence.slice(0,1500);item.reviewedBy=ACTOR_LABEL;item.reviewedAt=solomonNow_();solomonSavePlan_(o,plan);
  return jsonOut_({status:'ok',plan:plan});
});}
function solomonFinishReview_(body){return solomonWithSubmission_(body,function(ss,o){
  var plan=solomonReviewPlan_(o);if(!plan)throw new Error('Begin review first');
  var remains=plan.items.filter(function(x){return x.state==='pending';});
  if(remains.length)return jsonOut_({status:'ok',remainingReview:true,pending:remains.length,plan:plan});
  var summary=plan.items.map(function(x){return x.kind+':'+x.key+'='+x.state;}).join('; ');
  o._sheet.getRange(o._row,13,1,4).setValues([[solomonLiteral_(String(body.reviewNotes||plan.note).slice(0,1500)),ACTOR_LABEL,solomonNow_(),summary]]);
  appendChangeLog_(ss,SCHOLAR_SUBMISSION_SHEET,o['Scholar ID'],o['Submission ID'],'Pending','Reviewed');
  o._sheet.getRange(o._row,3).setValue('Reviewed');return jsonOut_({status:'ok',remainingReview:false,plan:plan});
});}
function solomonRejectRemaining_(o){
  var plan=solomonReviewPlan_(o);
  if(!plan){var fields=parseJsonObject_(o['Submitted Fields JSON']),files=parseJsonObject_(o['Attachments JSON']);plan={version:2,reviewer:ACTOR_LABEL,items:Object.keys(fields).map(function(k){return {kind:'text',key:k,state:'rejected'};})};
    if(Array.isArray(files))files.forEach(function(f){plan.items.push({kind:'file',key:f.fileId,state:'rejected'});});}
  plan.items.forEach(function(x){if(x.state==='pending')x.state='rejected';});solomonSavePlan_(o,plan);
}
function solomonBanSubmitter_(body){return solomonWithSubmission_(body,function(ss,o){
  var reason=String(body.reason||'').trim();if(reason.length<5||body.confirmed!==true)throw new Error('A reason and explicit confirmation are required');
  var email=normalizedSubmitterEmail_(o['Submitter Email']);if(!email)throw new Error('No submitter email');
  if(!isScholarSubmitterBlocked_(ss,email)){var sh=ensureScholarBlocklistSheet_(ss);sh.getRange(sh.getLastRow()+1,1,1,7).setValues([[email,o['Submitter Name'],solomonNow_(),ACTOR_LABEL,o['Submission ID'],reason.slice(0,1500),'Active'].map(solomonLiteral_)]);}
  appendChangeLog_(ss,SCHOLAR_BLOCKLIST_SHEET,o['Scholar ID'],o['Submission ID'],'','Submitter blocked: '+reason.slice(0,500));
  return jsonOut_({status:'ok',blocked:true});
});}
function solomonCurrentGeo_(ss,key){
 var t=solomonTable_(ss,'Research Geography'),pi=t.headers.indexOf('Publication ID'),ci=t.headers.indexOf('Country');
 if(pi<0||ci<0)throw new Error('Research Geography headers unavailable');
 function val(r,h){var i=t.headers.indexOf(h);return i<0?'':r[i];}
 return t.rows.filter(function(r){return r[pi]===key&&r[ci]==='Solomon Islands';}).map(function(r){return{national:/national|general/i.test(val(r,'Geography Scale')),province:val(r,'Province/City Area'),island:val(r,'Specific Island'),village:val(r,'Village/Community/Site')};});
}

function solomonValidateLocationLinks_(ss,locations){
 var t=solomonTable_(ss,'Research Geography');
 function value(r,h){return String(r[t.headers.indexOf(h)]||'').trim().toLowerCase();}
 locations.forEach(function(l){
  if(l.national||(!l.island&&!l.village))return;
  var matches=t.rows.filter(function(r){return value(r,'Country')==='solomon islands'&&value(r,'Province/City Area')===l.province.toLowerCase()&&(!l.island||value(r,'Specific Island')===l.island.toLowerCase())&&(!l.village||value(r,'Village/Community/Site')===l.village.toLowerCase());});
  if(!matches.length)throw new Error('Location relationship requires verification in Solomon Islands Master geography');
 });
}
/** Owner backup before deploying review v2. Does not change any live queue. */
function backupSolomonReviewDataV2(){
  var ss=geoSs_();if(ss.getId()!==SPREADSHEET_ID_HINT)throw new Error('Wrong Solomon Master');
  var copy=DriveApp.getFileById(ss.getId()).makeCopy('Solomon Master before review v2 '+solomonNow_());
  Logger.log('Private backup created: '+copy.getUrl());return copy.getUrl();
}

// Google reviewer access. The private roster is never sent to the browser.
// The existing secret remains an Owner-only recovery path. Never share it.
var SOLOMON_REQUEST_ROLE = 'owner';
var SOLOMON_READ_ACTIONS = ['reviewCapabilities','ping','describe','readScholarProfileSubmissions','readScholarSubmissionAttachment','readPublicationGeographySubmissions','readScholar','readRows','readChangeLog'];
var SOLOMON_REVIEW_ACTIONS = ['reviewCapabilities','readScholarProfileSubmissions','readScholarSubmissionAttachment','readPublicationGeographySubmissions','beginScholarReview','recordScholarAttachmentReview','finishScholarReview','approveScholarProfileSubmission','resolveScholarProfileSubmission','resolvePublicationGeographySubmission'];
function solomonAuthorize_(payload, action) {
  SOLOMON_REQUEST_ROLE=''; ACTOR_LABEL='';
  // Never accept a caller's claimed email, role or actor. Never fall back to the
  // owner secret after a failed Google credential.
  if (payload.idToken) {
    try {
      var identity=solomonVerifyGoogle_(String(payload.idToken));
      var role=solomonRoleForIdentity_(identity);
      if (!role || (role!=='owner' && SOLOMON_REVIEW_ACTIONS.indexOf(action)<0)) return false;
      SOLOMON_REQUEST_ROLE=role;
      ACTOR_LABEL=identity.email+' ('+role+'; Google '+identity.sub+')';
      return true;
    } catch (_) { return false; }
  }
  if (!checkAuth_(payload)) return false;
  SOLOMON_REQUEST_ROLE='owner'; ACTOR_LABEL='Owner (legacy secret)';
  return true;
}
function solomonVerifyGoogle_(token) {
  if(token.length>16000)throw new Error('Invalid credential');
  var parts=token.split('.');if(parts.length!==3)throw new Error('Invalid credential');
  var header=JSON.parse(SolomonJWT.decode(parts[0]));
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>160)throw new Error('Invalid algorithm');
  var props=PropertiesService.getScriptProperties(),aud=props.getProperty('SOLOMON_GOOGLE_CLIENT_ID');
  if(!aud)throw new Error('Google sign-in is not configured');
  var keys=solomonGoogleKeys_(),key=keys.filter(function(k){return k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig';})[0];
  if(!key)throw new Error('Unknown Google signing key. Try again later.');
  if(!SolomonJWT.JWS.verify(token,SolomonJWT.KEYUTIL.getKey(key),['RS256']))throw new Error('Invalid signature');
  var claims=JSON.parse(SolomonJWT.decode(parts[1])),now=Math.floor(Date.now()/1000);
  if(claims.aud!==aud||(claims.azp&&claims.azp!==aud)||['accounts.google.com','https://accounts.google.com'].indexOf(claims.iss)<0)throw new Error('Invalid issuer or audience');
  if(typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+60||claims.exp-claims.iat>7200||(claims.nbf&&claims.nbf>now))throw new Error('Expired or invalid credential');
  if(typeof claims.sub!=='string'||!/^\d{1,255}$/.test(claims.sub)||claims.email_verified!==true||typeof claims.email!=='string')throw new Error('Unverified identity');
  claims.email=claims.email.toLowerCase();
  if(!/@gmail\.com$/.test(claims.email)&&!(typeof claims.hd==='string'&&claims.hd&&claims.email.split('@')[1]===claims.hd.toLowerCase()))throw new Error('Google-hosted identity required');
  return claims;
}
function solomonGoogleKeys_() {
  var cache=CacheService.getScriptCache(),key='solomon-google-jwks-v1',cached=cache.get(key);
  if(cached)return JSON.parse(cached);
  var response=UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs',{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('Google signing keys unavailable');
  var keys=JSON.parse(response.getContentText()).keys;
  if(!Array.isArray(keys)||!keys.length)throw new Error('Invalid signing keys');
  var headers=response.getAllHeaders(),control='';
  Object.keys(headers).forEach(function(k){if(k.toLowerCase()==='cache-control')control=String(headers[k]);});
  var maxAge=/max-age=(\d+)/.exec(control),ttl=Math.min(21600,maxAge?Number(maxAge[1]):300);
  if(ttl>0)cache.put(key,JSON.stringify(keys),ttl);
  return keys;
}
function solomonRoleForIdentity_(identity) {
  var props=PropertiesService.getScriptProperties();
  var owner=String(props.getProperty('SOLOMON_OWNER_EMAIL')||'').trim().toLowerCase();
  if(!owner)return ''; // Fail closed until the Owner configures access.
  var admins=String(props.getProperty('SOLOMON_REVIEWER_EMAILS')||'').toLowerCase().split(/[\s,;]+/);
  var role=identity.email===owner?'owner':admins.indexOf(identity.email)>=0?'admin':'';
  if(!role)return '';
  // Bind each authorized email to Google's immutable account ID on first login.
  // Subsequent logins require BOTH the current roster entry and that identity.
  var key='SOLOMON_GOOGLE_SUB_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,identity.email)).replace(/=+$/,'');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var bound=props.getProperty(key);
    if(bound&&bound!==identity.sub)return '';
    if(!bound)props.setProperty(key,identity.sub);
  } finally {lock.releaseLock();}
  return role;
}

function solomonGender_(v){
 return ({Male:'Man',Female:'Woman',Unknown:'Not yet verified'})[v]||String(v||'');
}
function solomonInstitutionId_(ss,value){
 if(!value)return '';
 var t=solomonTable_(ss,'Institutions'),ii=t.headers.indexOf('Institution ID'),ni=t.headers.indexOf('Canonical Name'),ai=t.headers.indexOf('Aliases/Historical Names'),v=value.trim().toLowerCase();
 var rows=t.rows.filter(function(r){return [r[ii],r[ni]].concat(String(r[ai]||'').split(';')).some(function(n){return String(n||'').trim().toLowerCase()===v;});});
 if(rows.length!==1)throw new Error('Institution must match one existing canonical institution; add or resolve it in Master first');
 return rows[0][ii];
}
function solomonValidateFile_(f){
 var types={headshot:/\.jpe?g$/i,cv:/\.pdf$/i,masters_thesis:/\.pdf$/i,phd_thesis:/\.pdf$/i,publications:/\.(bib|ris|enw)$/i};
 if(!f||!types[f.field]||!types[f.field].test(String(f.name||'')))throw new Error('Unsupported attachment type');
 if(f.field==='headshot'&&f.type!=='image/jpeg')throw new Error('Headshot must be JPEG');
 if(/thesis|^cv$/.test(f.field)&&f.type!=='application/pdf')throw new Error('CV/thesis must be PDF');
 if(typeof f.data!=='string'||f.data.length>17*1024*1024||! /^[A-Za-z0-9+/]*={0,2}$/.test(f.data))throw new Error('Invalid attachment data');
}
function solomonValidateSubmission_(ss,body){
 var specs=scholarSubmissionFieldSpecs_(),fields=body.fields||{};
 if(['Self','Family','Friend','Student','Colleague','Other'].indexOf(body.submitterRelationship)<0)throw new Error('Invalid relationship');
 Object.keys(fields).forEach(function(key){
  var spec=specs.filter(function(s){return s.key===key;})[0],v=fields[key];
  if(typeof v!=='string'||/^\s*=/.test(v))throw new Error('Invalid field value');
  if(!spec){if(['institution_url','department_url'].indexOf(key)<0||!validateValue_(v,{type:'url',maxLen:500}).ok)throw new Error('Unsupported field: '+key);return;}
  if(spec.clean)v=spec.clean(v);
  if(!validateValue_(v,(key==='institution'||/_university$/.test(key))?{type:'string',maxLen:240}:MAPPING.worksheets[spec.ws].fields[spec.field]).ok)throw new Error('Invalid field: '+key);
  if(/_province$/.test(key)&&v&&v!=='Honiara City')solomonProvince_(v);
 });
 if(!Array.isArray(body.files||[]))throw new Error('Invalid attachments');
 var seen={};(body.files||[]).forEach(function(f){solomonValidateFile_(f);if(seen[f.field])throw new Error('Duplicate attachment field');seen[f.field]=true;});
}

function handlePublicScholarProfileSubmission_(body){return solomonPublicOnce_(body,true);}
function handlePublicPublicationGeographySubmission_(body){return solomonPublicOnce_(body,false);}
function solomonPublicOnce_(body,scholar){
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(String(body.requestId||'')))throw new Error('Valid request ID required');
 var ss=geoSs_(),sid=String(body.scholarId||'').toUpperCase();
 if(!validScholarShareToken_(ss,sid,String(body.shareToken||'')))return jsonOut_({status:'unauthorized'});
 var serialized=JSON.stringify(body),digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,serialized));
 body._requestKey=sid+':'+body.requestId+':'+digest;
 var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
 try{
  var sh=scholar?ensureScholarSubmissionSheet_(ss):solomonEnsureGeoQueue_(ss),headers=scholar?SCHOLAR_SUBMISSION_HEADERS:GEO_SUBMISSION_HEADERS,last=sh.getLastRow();
  var rows=last>1?sh.getRange(2,1,last-1,headers.length).getDisplayValues():[],matches=rows.filter(function(r){return r[headers.length-1]===body._requestKey;});
  if(matches.length)return jsonOut_({status:'ok',submissionId:matches[0][0],queued:matches.length,alreadyReceived:true});
  return scholar?handlePublicScholarProfileSubmission_Once_(body):handlePublicPublicationGeographySubmission_Once_(body);
 }finally{lock.releaseLock();}
}

function initializeSolomonShareTokens(){
 var ss=geoSs_(),lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
 try{
  var t=solomonTable_(ss,'Scholars'),si=t.headers.indexOf('Scholar ID'),ti=t.headers.indexOf('Scholar Share Token');
  if(si<0)throw new Error('Scholar ID header missing');
  var ids={},tokens={};t.rows.forEach(function(r){
   var id=String(r[si]||'').trim(),token=ti<0?'':String(r[ti]||'').trim();
   if(!id)return;if(!/^SOL-S\d{4,}$/.test(id)||ids[id])throw new Error('Invalid or duplicate Scholar ID');ids[id]=true;
   if(token){if(!/^[a-f0-9]{40}$/.test(token)||tokens[token])throw new Error('Invalid or duplicate existing token');tokens[token]=true;}
  });
  if(ti<0){ti=t.headers.length;if(t.sheet.getMaxColumns()<ti+1)t.sheet.insertColumnsAfter(t.sheet.getMaxColumns(),ti+1-t.sheet.getMaxColumns());t.sheet.getRange(1,ti+1).setValue('Scholar Share Token');}
  var added=0;t.rows.forEach(function(r,i){
   if(!r[si]||r[ti])return;var token;
   do{token=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'').slice(0,40);}while(tokens[token]);
   t.sheet.getRange(i+2,ti+1).setValue(token);tokens[token]=true;added++;
  });
  Logger.log('Initialized '+added+' missing Solomon scholar links; existing tokens unchanged. Run Refresh from Sheet to publish.');
 }finally{lock.releaseLock();}
}
