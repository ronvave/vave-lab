/** Tonga submission backend, phase 1, 2026-09-20.
 * Based on the owner's uploaded deployed source. Keep existing Script Properties.
 * Adds review queues; does not change dashboard, photos, insights or B3.
 * Public submission routes require a valid Tonga scholar share token.
 * Admin reads/decisions accept verified Google roles; owner secret retained for recovery.
 * Bibliography/CV/thesis attachments require review; they are NOT auto-imported.
 */
// ------------------------- CONFIG -----------------------------------------
var SPREADSHEET_ID_HINT = '1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI'; // Tongan Scholars Master File — NEVER the iTaukei ID (1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg)
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
  'Scholars.Alive / Deceased': true
};

// Full editable-field allowlist. Every writable field must appear here.
// Sheets not listed are read-only. Fields on listed sheets not listed are
// read-only. Enum values are validated against the `enum` array.
// MAPPING reflects the ACTUAL Master Google Sheet headers (verified
// 2026-08-22 against the live sheet). Field keys are the literal header
// strings including spacing and slashes. Column names come from row 4 of
// each sheet.
var TONGAN_CLANS_ = ["Tuʻipelehake", "Kalaniuvalu", "Kau Falefā", "Kau Sinaʻe", "Ongo Haʻangana", "Haʻa Falefisi", "Haʻa Moheofo", "Haʻa Maʻafu", "Haʻa Lātūhifo", "Haʻa Ngata Motuʻa", "Haʻa Ngata Tupu", "Haʻa Havea Lahi", "Haʻa Havea Siʻi", "Haʻa Vaea", "Haʻa Fokololo ʻo e Hau", "Falehaʻakili", "Haʻa Matāpule", "Kau Nimatapu", "Haʻa Tufunga", "Kanolotoʻā ʻo e Hau"];
var MAPPING = {
  version: '1.4',
  worksheets: {
    'Scholars': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      fields: {
        // Title / Salutation is an authoritative scholar-level attribute
        // (Aug 22 approval). Blank means no title.
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
        'Clan Paternal': { type: 'enum', enum: (typeof TONGAN_CLANS_ !== 'undefined' ? TONGAN_CLANS_ : []).concat(['']) },
        'Clan Maternal': { type: 'enum', enum: (typeof TONGAN_CLANS_ !== 'undefined' ? TONGAN_CLANS_ : []).concat(['']) },
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
        // Non-editable Master computed columns intentionally OMITTED:
        //   Scholar Name, Paternal Island Division is derived by Lookups so read-only in UI,
        //   Highest Completed Degree, Degree Episodes, International Degree Episodes,
        //   Tonga Degree Episodes, Funding Episodes, Awards Count, Gold Medals / Prizes Count,
        //   Linked Publication Count, First-Author Publication Count,
        //   Current Leadership Category, Current Leadership Level,
        //   Review Status, Roster Tier, Source Basis, BibTeX Author Match (roster),
        //   BibTeX Author Occurrences (roster).
        // These are computed/audit fields \u2014 do not expose as editable.
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

// ------------------------- ENTRY POINTS -----------------------------------

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || 'ping';
    if (action === 'submissionCapabilities') return jsonOut_({status:'ok', country:'Tonga', version:TONGA_SUBMISSIONS_VERSION, publicSubmissionsEnabled:tongaPublicEnabled_()});
    if (params.idToken || !tongaAuthorize_(params, action)) return jsonOut_({ status: 'unauthorized' }, 401);
    return tongaReadAction_(params);
  } catch (err) {
    return jsonOut_({ status: 'error', error: String(err && err.message || err) }, 500);
  }
}

function tongaReadAction_(params) {
  var action=params.action||'ping';
    if (action === 'reviewCapabilities') return jsonOut_({status:'ok',country:'Tonga',version:TONGA_SUBMISSIONS_VERSION,combinedReview:true,selectionReview:true,queueCounts:true,banSubmitter:TONGA_REQUEST_ROLE==='owner',currentGeography:true,role:TONGA_REQUEST_ROLE,actor:ACTOR_LABEL,photoPublishing:TONGA_REQUEST_ROLE==='owner'});
    if (action === 'reviewQueueCounts') return tongaQueueCounts_();
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
  var headerVals = sheet.getRange(wsCfg.headerRow || 4, 1, 1, lastCol).getValues()[0] || [];
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
  TONGA_READ_TABLES=null;
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return jsonOut_({ status: 'bad_request', reason: 'invalid-json' }, 400);
  }
  try {
    var requested = body.action || 'write';
    if (requested === 'submitScholarProfileUpdate' || requested === 'submitPublicationGeography') {
      if (!tongaPublicEnabled_()) return jsonOut_({status:'disabled',reason:'TONGA_PUBLIC_SUBMISSIONS_ENABLED is not true'});
      return requested === 'submitScholarProfileUpdate' ? handlePublicScholarProfileSubmission_(body) : handlePublicPublicationGeographySubmission_(body);
    }
    if (!tongaAuthorize_(body, requested)) return jsonOut_({ status: 'unauthorized', reason:TONGA_AUTH_ERROR||'Sign in with an authorized Google account.' }, 401);
    if (TONGA_READ_ACTIONS.indexOf(requested)>=0) return tongaReadAction_(body);
    if (!writeEnabled_()) return jsonOut_({ status: 'disabled', reason: 'WRITE_ENABLED=false' }, 423);
    var action = body.action || 'write';
    if (action === 'reviewScholarSelection') return tongaReviewSelection_(body);
    if (action === 'beginScholarReview') return tongaBeginReview_(body);
    if (action === 'recordScholarAttachmentReview') return tongaRecordAttachment_(body);
    if (action === 'finishScholarReview') return tongaFinishReview_(body);
    if (action === 'banScholarSubmitter') return tongaBanSubmitter_(body);
    if (action === 'approveScholarProfileSubmission') return tongaApproveScholar_(body);
    if (action === 'resolveScholarProfileSubmission') return tongaResolveScholar_(body);
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
 *       { worksheet: "Scholars", scholarId: "TON-S0001", field: "Given Names",
 *         oldValue: "Joeli", newValue: "Joeli ",
 *         overrideAuthorized: false,  // optional; user confirmed override
 *         expectedCurrent: "Alive"    // required with overrideAuthorized
 *       },
 *       { worksheet: "Positions", scholarId: "TON-S0001", rowNumber: 27,
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

  if (sheet.getRange(rowInfo.row, col).getFormula()) return {status:'rejected',reason:'computed-field-read-only'};
  if (typeof newValue === 'string' && /^\s*=/.test(newValue)) return {status:'rejected',reason:'formula-text-not-allowed'};
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
var SCHOLAR_SUBMISSION_SHEET = 'Scholar Profile Submissions';
var SCHOLAR_SUBMISSION_HEADERS = ['Submission ID','Submitted At','Status','Scholar ID','Scholar Name','Submitter Name','Submitter Email','Relationship','Profile URL','Submitted Fields JSON','Structured Submission JSON','Attachments JSON','Review Notes','Reviewed By','Reviewed At','Resolution'];
var SCHOLAR_BLOCKLIST_SHEET = 'Scholar Submission Blocklist';
var SCHOLAR_BLOCKLIST_HEADERS = ['Email','Submitter Name','Banned At','Banned By','Source Submission ID','Reason','Status'];

function normalizedSubmitterEmail_(email) { return String(email || '').trim().toLowerCase(); }

function ensureScholarBlocklistSheet_(ss) {
  var sh=ss.getSheetByName(SCHOLAR_BLOCKLIST_SHEET);if(!sh)sh=ss.insertSheet(SCHOLAR_BLOCKLIST_SHEET);
  if(sh.getMaxRows()<5)sh.insertRowsAfter(sh.getMaxRows(),5-sh.getMaxRows());
  if(sh.getMaxColumns()<SCHOLAR_BLOCKLIST_HEADERS.length)sh.insertColumnsAfter(sh.getMaxColumns(),SCHOLAR_BLOCKLIST_HEADERS.length-sh.getMaxColumns());
  var current=sh.getRange(4,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).getDisplayValues()[0];
  if(current.some(function(x){return !!x;}) && current.join('|')!==SCHOLAR_BLOCKLIST_HEADERS.join('|'))throw new Error('Blocklist headers differ');
  if(current.join('|')!==SCHOLAR_BLOCKLIST_HEADERS.join('|')){sh.getRange(4,1,1,SCHOLAR_BLOCKLIST_HEADERS.length).setValues([SCHOLAR_BLOCKLIST_HEADERS]);sh.setFrozenRows(4);}
  return sh;
}

function isScholarSubmitterBlocked_(ss,email){
  var target=normalizedSubmitterEmail_(email),sh=ensureScholarBlocklistSheet_(ss),last=sh.getLastRow();if(!target||last<5)return false;
  var vals=sh.getRange(5,1,last-4,7).getDisplayValues();for(var i=0;i<vals.length;i++){if(normalizedSubmitterEmail_(vals[i][0])===target&&String(vals[i][6]||'Active')!=='Lifted')return true;}return false;
}

function ensureScholarSubmissionSheet_(ss) {
  var sh = ss.getSheetByName(SCHOLAR_SUBMISSION_SHEET);
  if (!sh) sh = ss.insertSheet(SCHOLAR_SUBMISSION_SHEET);
  if (sh.getMaxRows() < 5) sh.insertRowsAfter(sh.getMaxRows(), 5 - sh.getMaxRows());
  if (sh.getMaxColumns() < SCHOLAR_SUBMISSION_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), SCHOLAR_SUBMISSION_HEADERS.length - sh.getMaxColumns());
  var current = sh.getRange(4, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues()[0];
  if (current.some(function(x){return !!x;}) && current.join('|') !== SCHOLAR_SUBMISSION_HEADERS.join('|')) throw new Error('Scholar submission headers differ; preserve and review them before migration');
  if (current.join('|') !== SCHOLAR_SUBMISSION_HEADERS.join('|')) {
    sh.getRange(4, 1, 1, SCHOLAR_SUBMISSION_HEADERS.length).setValues([SCHOLAR_SUBMISSION_HEADERS]);
    sh.setFrozenRows(4);
  }
  return sh;
}

function scholarSubmissionFolder_(ss) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('SCHOLAR_SUBMISSION_FOLDER_ID');
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (_) {} }
  var folder = DriveApp.createFolder('Tonga Scholar Profile Submission Uploads');
  props.setProperty('SCHOLAR_SUBMISSION_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * One-time setup for scholar-update attachments.
 * Run this function manually from the Apps Script editor as the owner, then
 * approve the requested Google Drive permission. It creates (or reuses) the
 * private upload folder beside the Tongan Master File and remembers its ID.
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
    folder.createFile(markerName, 'This file confirms that the Tongan V2 scholar-update web app is authorised to save submitted attachments.');
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
    var bytes = Utilities.base64Decode(String(f.data));
    total += bytes.length;
    if (bytes.length > 12 * 1024 * 1024 || total > 30 * 1024 * 1024) throw new Error('attachment-size-limit');
    var original = String(f.name || 'attachment').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 180);
    // The browser already standardises known uploads as
    // TNG-Sxxxx-Scholar Name-Headshot.jpg. Do not add a submission ID or a
    // second Scholar ID in front of that readable filename.
    var name = new RegExp('^'+sid.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')+'-', 'i').test(original) ? original : sid+'-'+original;
    var blob = Utilities.newBlob(bytes, String(f.type || 'application/octet-stream'), name);
    var file = folder.createFile(blob);
    saved.push({ field: String(f.field || 'attachment').slice(0, 80), name: name, url: file.getUrl(), size: bytes.length, type:file.getMimeType(), fileId: file.getId() });
  });
  return saved;
}

function handlePublicScholarProfileSubmission_(body) {
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
  var attachments;
  try { attachments = saveScholarSubmissionFiles_(ss, sid, submissionId, body.files || []); }
  catch (err2) { return jsonOut_({ status:'bad_request', reason:String(err2.message || err2) }, 400); }
  var row = [submissionId, Utilities.formatDate(now,TIMEZONE,'yyyy-MM-dd HH:mm:ss'), 'Pending', sid,
    String(body.scholarName || '').slice(0,240), name.slice(0,160), email.slice(0,240), rel.slice(0,100),
    String(body.profileUrl || '').slice(0,700), fieldsJson, structuredJson, JSON.stringify(attachments), '', '', '', ''];
  var lock = LockService.getScriptLock(); lock.waitLock(LOCK_WAIT_MS);
  try { var sh = ensureScholarSubmissionSheet_(ss); sh.getRange(sh.getLastRow()+1,1,1,SCHOLAR_SUBMISSION_HEADERS.length).setValues([row.map(tongaLiteral_)]); }
  finally { lock.releaseLock(); }
  return jsonOut_({ status:'ok', submissionId:submissionId, queued:1, attachments:attachments.length });
}

function handleReadScholarProfileSubmissions_(params) {
  TONGA_READ_TABLES={};
  var ss = geoSs_(), sh = ensureScholarSubmissionSheet_(ss), last = sh.getLastRow();
  if (last < 5) return jsonOut_({ status:'ok', rows:[] });
  var vals = sh.getRange(5,1,last-4,SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues(), want = String(params.status || '').trim(), rows = [];
  vals.forEach(function(r){
    if(!r[0] || (want && r[2] !== want) || (params.submissionId && r[0]!==params.submissionId)) return;
    var o={}; SCHOLAR_SUBMISSION_HEADERS.forEach(function(h,i){o[h]=r[i]||'';});
    o.reviewPlan=tongaReviewPlan_(o);
    o.proposedChanges = buildScholarSubmissionChanges_(ss, o);
    rows.push(o);
  });
  rows.reverse(); return jsonOut_({ status:'ok', rows:rows });
}

function findScholarSubmission_(ss,id){
  var sh=ensureScholarSubmissionSheet_(ss),last=sh.getLastRow();if(last<5)return null;
  var vals=sh.getRange(5,1,last-4,SCHOLAR_SUBMISSION_HEADERS.length).getDisplayValues();
  for(var i=0;i<vals.length;i++){if(vals[i][0]===id){var o={_row:i+5,_sheet:sh};SCHOLAR_SUBMISSION_HEADERS.forEach(function(h,j){o[h]=vals[i][j]||'';});return o;}}return null;
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
    {key:'salutation',label:'Title / salutation',ws:'Scholars',field:'Title / Salutation',clean:function(v){return String(v||'').replace(/\.$/,'');}},
    {key:'gender',label:'Gender',ws:'Scholars',field:'Gender'},
    {key:'paternal_island_division',label:'Paternal island division',ws:'Scholars',field:'Paternal Island Division'},
    {key:'paternal_district',label:'Paternal district',ws:'Scholars',field:'District Paternal'},
    {key:'paternal_village',label:'Paternal village',ws:'Scholars',field:'Village/Town Paternal (Kolo)'},
    {key:'paternal_clan',label:'Paternal clan',ws:'Scholars',field:'Clan Paternal'},
    {key:'maternal_clan',label:'Maternal clan',ws:'Scholars',field:'Clan Maternal'},
    {key:'paternal_island',label:'Paternal island',ws:'Scholars',field:'Specific Island Paternal'},
    {key:'maternal_island_division',label:'Maternal island division',ws:'Scholars',field:'Maternal Island Division'},
    {key:'maternal_district',label:'Maternal district',ws:'Scholars',field:'District Maternal'},
    {key:'maternal_village',label:'Maternal village',ws:'Scholars',field:'Village/Town Maternal (Kolo)'},
    {key:'maternal_island',label:'Maternal island',ws:'Scholars',field:'Specific Island Maternal'},
    {"key": "paternal_estate", "label": "Estate / Chiefly Affiliation Paternal (Tofi'a)", "ws": "Scholars", "field": "Estate / Chiefly Affiliation Paternal (Tofi'a)"},
    {"key": "paternal_lineage", "label": "Ha'a / Lineage Paternal", "ws": "Scholars", "field": "Ha'a / Lineage Paternal"},
    {"key": "paternal_kainga", "label": "Kāinga Paternal", "ws": "Scholars", "field": "Kāinga Paternal"},
    {"key": "paternal_community", "label": "Self-identified Home / Community Affiliation Paternal", "ws": "Scholars", "field": "Self-identified Home / Community Affiliation Paternal"},
    {"key": "maternal_estate", "label": "Estate / Chiefly Affiliation Maternal (Tofi'a)", "ws": "Scholars", "field": "Estate / Chiefly Affiliation Maternal (Tofi'a)"},
    {"key": "maternal_lineage", "label": "Ha'a / Lineage Maternal", "ws": "Scholars", "field": "Ha'a / Lineage Maternal"},
    {"key": "maternal_kainga", "label": "Kāinga Maternal", "ws": "Scholars", "field": "Kāinga Maternal"},
    {"key": "maternal_community", "label": "Self-identified Home / Community Affiliation Maternal", "ws": "Scholars", "field": "Self-identified Home / Community Affiliation Maternal"},
    {key:'title',label:'Professional title',ws:'Scholars',field:'Current Title / Role'},
    {key:'institution',label:'Current institution',ws:'Scholars',field:'Current Institution'},
    {key:'department',label:'Department / unit',ws:'Scholars',field:'Current Department / Unit'},
    {key:'profile_url',label:'Current profile URL',ws:'Scholars',field:'Current Profile URL'},
    {key:'google_scholar_url',label:'Google Scholar URL',ws:'Scholars',field:'Google Scholar URL'},
    {key:'orcid_url',label:'ORCID / Researcher ID',ws:'Scholars',field:'ORCID / Researcher ID'},
    {key:'masters_university',label:'Master\'s university',ws:'Graduate Degrees',field:'C_Uni name',stage:'master'},
    {key:'masters_country',label:'Master\'s country',ws:'Graduate Degrees',field:'Country',stage:'master'},
    {key:'masters_year',label:'Master\'s completion year',ws:'Graduate Degrees',field:'Finish / Completion Year',stage:'master'},
    {key:'masters_thesis_url',label:'Master\'s thesis / degree URL',ws:'Graduate Degrees',field:'Thesis / Repository URL',stage:'master'},
    {key:'phd_university',label:'PhD university',ws:'Graduate Degrees',field:'C_Uni name',stage:'phd'},
    {key:'phd_country',label:'PhD country',ws:'Graduate Degrees',field:'Country',stage:'phd'},
    {key:'phd_year',label:'PhD completion year',ws:'Graduate Degrees',field:'Finish / Completion Year',stage:'phd'},
    {key:'phd_thesis_url',label:'PhD thesis / degree URL',ws:'Graduate Degrees',field:'Thesis / Repository URL',stage:'phd'}
  ];
}

function buildScholarSubmissionChanges_(ss, submission) {
  var fields=parseJsonObject_(submission['Submitted Fields JSON']), structured=parseJsonObject_(submission['Structured Submission JSON']), changedOnly=structured.changedFieldsOnly===true, sid=String(submission['Scholar ID']||''), out=[];
  var st=tongaTable_(ss,'Scholars'), scholarSheet=st.sheet, scholarCfg=MAPPING.worksheets.Scholars;
  var si=st.headers.indexOf(scholarCfg.keyColumn), sr=st.rows.findIndex(function(r){return String(r[si])===sid;});
  var scholarInfo={ok:sr>=0,row:sr+5,headers:{}}, scholarValues=sr>=0?st.rows[sr]:[], scholarFormulas=[];
  st.headers.forEach(function(h,i){scholarInfo.headers[h]=i+1;});
  if(sr>=0)scholarFormulas=scholarSheet.getRange(sr+5,1,1,st.headers.length).getFormulas()[0];
  var gradSheet=ss.getSheetByName('Graduate Degrees'),gradRows={},degreeCounts={master:0,phd:0};
  if(gradSheet){var gt=tongaTable_(ss,'Graduate Degrees'),headers=gt.headers,sidCol=headers.indexOf('Scholar ID'),stageCol=headers.indexOf('Degree Stage');
    gt.rows.forEach(function(r,i){if(String(r[sidCol])!==sid)return;var stage=String(r[stageCol]||'').toLowerCase();
      ['master','phd'].forEach(function(k){if((k==='master'?/master/:/(phd|doctor)/).test(stage)){degreeCounts[k]++;if(!gradRows[k])gradRows[k]={row:i+5,headers:headers,values:r};}});
    });
  }
  scholarSubmissionFieldSpecs_().forEach(function(spec){
    if(!Object.prototype.hasOwnProperty.call(fields,spec.key))return;
    var proposed=spec.clean?spec.clean(fields[spec.key]):String(fields[spec.key]==null?'':fields[spec.key]).trim();
    // Older submissions sent every form control and therefore cannot
    // distinguish an untouched empty control from a deliberate clear. The
    // safe review behaviour is to suppress legacy blank clears.
    if(!changedOnly && proposed==='')return;
    var current='',rowNumber=null,writable=true,reason='';
    if(spec.ws==='Scholars'){
      if(!scholarInfo.ok){writable=false;reason=scholarInfo.reason||'scholar-not-found';}
      else {var col=scholarInfo.headers[spec.field];if(!col){writable=false;reason='Master field not found';}else current=normalizeForRead_(scholarValues[col-1]);}
    } else {
      var degree=gradRows[spec.stage];
      if(degreeCounts[spec.stage]>1){writable=false;reason='Multiple degree rows: use the scholar editor to choose the correct degree';}
      else if(!degree){writable=false;reason='No existing '+spec.stage+' degree row in Master';}
      else {var dcol=degree.headers.indexOf(spec.field)+1;if(!dcol){writable=false;reason='Master field not found';}else{rowNumber=degree.row;current=normalizeForRead_(degree.values[dcol-1]);}}
    }
    // Public forms display Master sentinel values such as "Unclassified" as
    // an empty control. Treat those as equivalent, particularly for legacy
    // submissions made before the browser began sending changed fields only.
    if(writable && spec.ws==='Scholars' && scholarFormulas[scholarInfo.headers[spec.field]-1]){writable=false;reason='Computed field; update its source field in Master';}
    var fieldCfg=MAPPING.worksheets[spec.ws].fields[spec.field];
    if(writable && (!fieldCfg || !validateValue_(proposed,fieldCfg).ok || /^\s*=/.test(proposed))){writable=false;reason='Value requires correction before approval';}
    var currentCompare=/^(unclassified|unknown|n\/a|na|-)$/i.test(String(current||'').trim())?'':current;
    if(normalizeForCompare_(currentCompare)===normalizeForCompare_(proposed))return;
    out.push({key:spec.key,label:spec.label,worksheet:spec.ws,field:spec.field,rowNumber:rowNumber,currentValue:current,newValue:proposed,writable:writable,reason:reason});
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


var TONGA_SUBMISSIONS_VERSION = 'tonga-submissions-4';
var GEO_SUBMISSION_SHEET = 'Publication Geography Submissions';
var GEO_SUBMISSION_HEADERS = ['Submission ID','Submitted At','Status','Scholar ID','Scholar Name','Submitter Name','Submitter Email','Relationship','Profile URL','Publication Key','Publication Title','Year','Proposed Tonga Locations JSON','Proposed Pacific Countries','Proposed Other Countries','Review Notes','Reviewed By','Reviewed At','Resolution'];
var TONGA_DIVISIONS = ['Tongatapu',"Ha'apai","Vava'u","'Eua",'Niuas'];
function geoSs_(){return SpreadsheetApp.openById(SPREADSHEET_ID_HINT);}
function tongaPublicEnabled_(){return PropertiesService.getScriptProperties().getProperty('TONGA_PUBLIC_SUBMISSIONS_ENABLED')==='true';}
function tongaLiteral_(v){return typeof v==='string' && /^[=+@-]/.test(v) ? "'"+v : v;}
var TONGA_READ_TABLES=null; // Request-local only; enabled for read routes, never writes.
function tongaTable_(ss,name){
  if(TONGA_READ_TABLES&&TONGA_READ_TABLES[name])return TONGA_READ_TABLES[name];
  var sh=ss.getSheetByName(name);if(!sh)throw new Error(name+' worksheet missing');
  var n=sh.getLastColumn();if(!n)throw new Error(name+' headers missing');
  var h=sh.getRange(4,1,1,n).getDisplayValues()[0];
  var rows=sh.getLastRow()>4?sh.getRange(5,1,sh.getLastRow()-4,n).getDisplayValues():[];
  var table={sheet:sh,headers:h,rows:rows};if(TONGA_READ_TABLES)TONGA_READ_TABLES[name]=table;return table;
}
function tongaEnsureGeoQueue_(ss){
  var sh=ss.getSheetByName(GEO_SUBMISSION_SHEET)||ss.insertSheet(GEO_SUBMISSION_SHEET);
  if(sh.getMaxColumns()<GEO_SUBMISSION_HEADERS.length)sh.insertColumnsAfter(sh.getMaxColumns(),GEO_SUBMISSION_HEADERS.length-sh.getMaxColumns());
  if(sh.getMaxRows()<5)sh.insertRowsAfter(sh.getMaxRows(),5-sh.getMaxRows());
  var h=sh.getRange(4,1,1,GEO_SUBMISSION_HEADERS.length).getDisplayValues()[0];
  if(h.some(function(x){return !!x;})&&h.join('|')!==GEO_SUBMISSION_HEADERS.join('|'))throw new Error('Existing geography queue headers differ; no data overwritten');
  if(h.join('|')!==GEO_SUBMISSION_HEADERS.join('|'))sh.getRange(4,1,1,GEO_SUBMISSION_HEADERS.length).setValues([GEO_SUBMISSION_HEADERS]);
  sh.setFrozenRows(4);return sh;
}
function validScholarShareToken_(ss,sid,token){
  if(!/^TNG-S\d{4,}$/i.test(sid)||!/^[a-f0-9]{40}$/i.test(token))return false;
  var t=tongaTable_(ss,'Scholars'),i=t.headers.indexOf('Scholar ID'),k=t.headers.indexOf('Scholar Share Token');
  if(i<0||k<0)return false;
  var matches=t.rows.filter(function(r){return r[i].toUpperCase()===sid.toUpperCase();});
  return matches.length===1&&matches[0][k].toLowerCase()===token.toLowerCase();
}
function tongaQueueObject_(sh,headers,id){
  var last=sh.getLastRow();if(last<5)return null;
  var rows=sh.getRange(5,1,last-4,headers.length).getDisplayValues();
  for(var i=0;i<rows.length;i++)if(rows[i][0]===id){var o={_row:i+5,_sheet:sh};headers.forEach(function(h,j){o[h]=rows[i][j];});return o;}
  return null;
}
function tongaNow_(){return Utilities.formatDate(new Date(),TIMEZONE,'yyyy-MM-dd HH:mm:ss');}
function tongaDivision_(s){
  var v=String(s||'').trim().replace(/[‘’ʻʼ]/g,"'");
  for(var i=0;i<TONGA_DIVISIONS.length;i++)if(TONGA_DIVISIONS[i].toLowerCase()===v.toLowerCase())return TONGA_DIVISIONS[i];
  if(v==='Ongo Niua')return 'Niuas';if(!v)return '';throw new Error('Invalid Tonga island division: '+v);
}
function tongaList_(v){
  if(v==null)return [];if(!Array.isArray(v)||v.length>50)throw new Error('Provide at most 50 countries or areas');
  var out=[];v.forEach(function(x){var c=typeof x==='string'&&TongaCountries.resolve(x);if(!c)throw new Error('Invalid country or area: '+String(x).slice(0,100)+'. Choose a country from the list.');if(out.indexOf(c.name)<0)out.push(c.name);});return out;
}
function tongaLocations_(v){
  if(v==null)return [];if(!Array.isArray(v)||v.length>30)throw new Error('Invalid Tonga location list');
  return v.map(function(x){
    if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('Invalid Tonga location');
    var o={national:x.national===true,division:tongaDivision_(x.division),district:String(x.district||'').trim(),island:String(x.island||'').trim(),village:String(x.village||'').trim()};
    ['district','island','village'].forEach(function(k){if(o[k].length>160||/[=\r\n]/.test(o[k]))throw new Error('Invalid location text');});
    if(o.national&&(o.division||o.district||o.island||o.village))throw new Error('National study must not also specify a locality in the same entry');
    if(!o.national&&!o.division)throw new Error('Choose an island division for a local Tonga study');return o;
  });
}
function tongaLinkedPublication_(ss,sid,key){
  var t=tongaTable_(ss,'Authorship'),si=t.headers.indexOf('Scholar ID'),pi=t.headers.indexOf('Publication ID / BibTeX Key');
  if(pi<0)pi=t.headers.indexOf('Publication ID');if(pi<0)pi=t.headers.indexOf('BibTeX Key');
  if(si<0||pi<0)throw new Error('Authorship headers require verification');
  return t.rows.some(function(r){return r[si]===sid&&r[pi]===key;});
}
function handlePublicPublicationGeographySubmission_(body){
  var ss=geoSs_(),sid=String(body.scholarId||'').toUpperCase();
  if(!validScholarShareToken_(ss,sid,String(body.shareToken||'')))return jsonOut_({status:'unauthorized'});
  var name=String(body.submitterName||'').trim(),email=String(body.submitterEmail||'').trim(),rel=String(body.submitterRelationship||'').trim();
  if(!name||!rel||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('Valid name, email and relationship required');
  if(isScholarSubmitterBlocked_(ss,email))return jsonOut_({status:'forbidden'});
  if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>100)throw new Error('Provide 1–100 publication changes');
  var rows=body.changes.map(function(c){
    var key=String(c.item_key||'').trim();if(!key||key.length>300||!tongaLinkedPublication_(ss,sid,key))throw new Error('Publication is not linked to this scholar');
    var loc=tongaLocations_(c.tonga_locations),pac=tongaList_(c.pacific_countries),other=tongaList_(c.other_countries).filter(function(x){return x!=='Tonga'&&pac.indexOf(x)<0;});
    if(!loc.length&&!pac.length&&!other.length)throw new Error('Choose at least one research location');
    return ['PGS-'+Utilities.getUuid(),tongaNow_(),'Pending',sid,String(body.scholarName||'').slice(0,240),name.slice(0,160),email.slice(0,240),rel.slice(0,100),String(body.profileUrl||'').slice(0,700),key,String(c.title||'').slice(0,700),String(c.year||'').slice(0,20),JSON.stringify(loc),pac.join('; '),other.join('; '),'','','',''].map(tongaLiteral_);
  });
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{var sh=tongaEnsureGeoQueue_(ss);sh.getRange(sh.getLastRow()+1,1,rows.length,GEO_SUBMISSION_HEADERS.length).setValues(rows);}finally{lock.releaseLock();}
  return jsonOut_({status:'ok',queued:rows.length});
}
function handleReadPublicationGeographySubmissions_(params){
  TONGA_READ_TABLES={};
  var ss=geoSs_(),sh=tongaEnsureGeoQueue_(ss),last=sh.getLastRow(),out=[];
  if(last>4)sh.getRange(5,1,last-4,GEO_SUBMISSION_HEADERS.length).getDisplayValues().forEach(function(r){if(!r[0]||(params.status&&r[2]!==params.status)||(params.submissionId&&r[0]!==params.submissionId))return;var o={};GEO_SUBMISSION_HEADERS.forEach(function(h,i){o[h]=r[i];});try{o.currentTongaLocations=tongaCurrentGeo_(ss,o['Publication Key']);}catch(e){o.currentGeographyError=String(e.message||e);}
  try {tongaList_(String(o['Proposed Pacific Countries']||'').split(';').filter(Boolean));tongaList_(String(o['Proposed Other Countries']||'').split(';').filter(Boolean));}catch(e){o.countryValidationError=String(e.message||e);}
  out.push(o);});
  return jsonOut_({status:'ok',rows:out.reverse()});
}
function tongaAddGeo_(ss,o){
  if(!tongaLinkedPublication_(ss,o['Scholar ID'],o['Publication Key']))throw new Error('Publication linkage changed; review again');
  var t=tongaTable_(ss,'Research Geography');
  var required=['Geography Record ID','Publication ID / BibTeX Key','Scholar ID (optional)','Geography Type','Country','District','Village / Town / Site','Specific Island','Island Division (auto from District)','Coding Basis / Evidence','Source URL / Note','Verification','Last Checked'];
  required.forEach(function(h){if(t.headers.indexOf(h)<0)throw new Error('Research Geography header missing: '+h);});
  var loc=tongaLocations_(JSON.parse(o['Proposed Tonga Locations JSON']||'[]')),candidates=[];
  tongaValidateLocationLinks_(ss,loc);
  loc.forEach(function(l){candidates.push({country:'Tonga',division:l.division,district:l.district,island:l.island,village:l.village,type:l.national?'National / general study':'Study location'});});
  [o['Proposed Pacific Countries'],o['Proposed Other Countries']].forEach(function(s){tongaList_(String(s||'').split(';').filter(function(x){return x.trim();})).forEach(function(c){candidates.push({country:c,division:'',district:'',island:'',village:'',type:'Country / study location'});});});
  var keys=['Publication ID / BibTeX Key','Country','District','Village / Town / Site','Specific Island','Island Division (auto from District)'];
  function signature(r){return keys.map(function(h){return String(r[t.headers.indexOf(h)]||'').trim().toLowerCase();}).join('|');}
  var seen={};t.rows.forEach(function(r){seen[signature(r)]=true;});
  var added=0;
  candidates.forEach(function(c){
    var r=t.headers.map(function(){return '';});function set(h,v){r[t.headers.indexOf(h)]=v;}
    set('Geography Record ID','GEO-'+Utilities.getUuid());set('Publication ID / BibTeX Key',o['Publication Key']);set('Scholar ID (optional)',o['Scholar ID']);set('Geography Type',c.type);set('Country',c.country);set('District',c.district);set('Village / Town / Site',c.village);set('Specific Island',c.island);set('Island Division (auto from District)',c.division);
    set('Coding Basis / Evidence','Admin-reviewed scholar submission '+o['Submission ID']);set('Source URL / Note',o['Profile URL']);set('Verification','Verified — Admin approved scholar submission');set('Last Checked',Utilities.formatDate(new Date(),TIMEZONE,'yyyy-MM-dd'));
    var sig=signature(r);if(seen[sig])return;
    var row=t.sheet.getLastRow()+1;
    // Never overwrite an existing derived formula, including a prefilled target row.
    var formulas=t.sheet.getRange(row,1,1,t.headers.length).getFormulas()[0];
    if(formulas.some(function(f){return !!f;}))throw new Error('Target geography row contains formulas; review append location');
    t.sheet.getRange(row,1,1,r.length).setValues([r.map(tongaLiteral_)]);seen[sig]=true;added++;
  });return added;
}
function handleResolvePublicationGeographySubmission_(body){
  if(['approve','reject'].indexOf(body.decision)<0)throw new Error('Invalid decision');
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{
    var ss=geoSs_(),o=tongaQueueObject_(tongaEnsureGeoQueue_(ss),GEO_SUBMISSION_HEADERS,String(body.submissionId||''));
    if(!o)return jsonOut_({status:'not_found'});if(o.Status!=='Pending')return jsonOut_({status:o.Status===(body.decision==='approve'?'Approved':'Rejected')?'ok':'already_resolved',decision:o.Status,alreadyRecorded:true});
    var n=body.decision==='approve'?tongaAddGeo_(ss,o):0,status=body.decision==='approve'?'Approved':'Rejected';
    var resolution=status==='Approved'?n+' new geography rows added; existing geography preserved.':'Rejected; no Master changes.';
    o._sheet.getRange(o._row,16,1,4).setValues([[tongaLiteral_(String(body.reviewNotes||'').slice(0,1500)),ACTOR_LABEL,tongaNow_(),resolution]]);
    appendChangeLog_(ss,GEO_SUBMISSION_SHEET,o['Scholar ID'],o['Submission ID'],'Pending',status);
    o._sheet.getRange(o._row,3).setValue(status);return jsonOut_({status:'ok',decision:body.decision,added:n});
  }finally{lock.releaseLock();}
}
function tongaApproveScholar_(body){
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{
    var ss=geoSs_(),o=findScholarSubmission_(ss,String(body.submissionId||''));
    if(!o)return jsonOut_({status:'not_found'});if(o.Status!=='Pending')return jsonOut_({status:'already_resolved'});
    var plan=tongaReviewPlan_(o);if(plan)return tongaApplyPlan_(ss,o,plan);
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
    o._sheet.getRange(o._row,13,1,4).setValues([[tongaLiteral_(String(body.reviewNotes||'').slice(0,1500)),ACTOR_LABEL,tongaNow_(),'Applied '+changes.length+' selected field(s). '+(remains?'Remaining fields/attachments require review.':'All proposed fields applied.')]]);
    if(!remains)o._sheet.getRange(o._row,3).setValue('Reviewed');
    return jsonOut_({status:'ok',results:results,remainingReview:remains});
  }finally{lock.releaseLock();}
}
function tongaResolveScholar_(body){
  if(['reject','reviewed'].indexOf(body.decision)<0)throw new Error('Invalid decision');
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{
    var ss=geoSs_(),o=findScholarSubmission_(ss,String(body.submissionId||''));if(!o)return jsonOut_({status:'not_found'});
    if(o.Status!=='Pending')return jsonOut_({status:o.Status===(body.decision==='reject'?'Rejected':'Reviewed')?'ok':'already_resolved',alreadyRecorded:true});
    if(body.decision==='reviewed'&&tongaReviewPlan_(o))throw new Error('Finish the per-item review before closing this submission');
    if(body.decision==='reject')tongaRejectRemaining_(o);
    if(body.decision==='reviewed'&&!String(body.reviewNotes||'').trim())throw new Error('Describe disposition of remaining fields and attachments');
    var status=body.decision==='reject'?'Rejected':'Reviewed';
    var message='Closed review. This action makes no Master, photo or publication changes; earlier approved changes, if any, remain recorded.';
    o._sheet.getRange(o._row,13,1,4).setValues([[tongaLiteral_(String(body.reviewNotes||'').slice(0,1500)),ACTOR_LABEL,tongaNow_(),message]]);
    appendChangeLog_(ss,SCHOLAR_SUBMISSION_SHEET,o['Scholar ID'],o['Submission ID'],'Pending',status);o._sheet.getRange(o._row,3).setValue(status);
    return jsonOut_({status:'ok',decision:body.decision});
  }finally{lock.releaseLock();}
}
/** Run once in the editor. Creates review sheets only; does not enable public submissions. */
function setupTongaSubmissionQueues(){
  var ss=geoSs_();
  if(ss.getId()!=='1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI')throw new Error('Wrong spreadsheet');
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{ensureScholarSubmissionSheet_(ss);ensureScholarBlocklistSheet_(ss);tongaEnsureGeoQueue_(ss);}finally{lock.releaseLock();}
  Logger.log('Tonga submission queues ready. Public submissions remain '+(tongaPublicEnabled_()?'enabled':'disabled')+'.');
}

// Review v2 stores its private journal inside existing Structured Submission JSON.
// No queue columns are migrated. The public export does not read this worksheet.
function tongaPlanSignature_(plan){return Utilities.base64Encode(Utilities.computeHmacSha256Signature(JSON.stringify(plan),PropertiesService.getScriptProperties().getProperty('SHARED_SECRET')));}
function tongaReviewPlan_(o){var s=parseJsonObject_(o['Structured Submission JSON']);if(!s.adminReviewV2)return null;if(s.adminReviewV2Signature!==tongaPlanSignature_(s.adminReviewV2))throw new Error('Invalid review journal signature; owner inspection required');return s.adminReviewV2;}
function tongaSavePlan_(o,p){
  var structured=parseJsonObject_(o['Structured Submission JSON']);structured.adminReviewV2=p;structured.adminReviewV2Signature=tongaPlanSignature_(p);
  var serialized=JSON.stringify(structured);if(serialized.length>49000)throw new Error('Review journal exceeds cell capacity; review manually');
  o._sheet.getRange(o._row,11).setValue(serialized);o['Structured Submission JSON']=serialized;
}
function tongaWithSubmission_(body,fn){
  var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
  try{var ss=geoSs_(),o=findScholarSubmission_(ss,String(body.submissionId||''));if(!o)throw new Error('Submission not found');
    if(o.Status!=='Pending')throw new Error('Submission already '+o.Status);return fn(ss,o);
  }finally{lock.releaseLock();}
}
function tongaBeginReview_(body){return tongaWithSubmission_(body,function(ss,o){return jsonOut_({status:'ok',plan:tongaBeginPlan_(body,ss,o)});});}
function tongaBeginPlan_(body,ss,o){
  var old=tongaReviewPlan_(o);
  var proposed=buildScholarSubmissionChanges_(ss,o),selected=body.selectedChanges||[],fileIds=body.selectedFiles||[];
  if(!Array.isArray(selected)||!Array.isArray(fileIds))throw new Error('Invalid review selection');
  var keys={};selected.forEach(function(x){if(keys[x.key])throw new Error('Duplicate selection');keys[x.key]=x;
    var previous=old&&old.items.find(function(i){return i.kind==='text'&&i.key===x.key;});
    if(previous&&previous.state!=='deferred')return;
    var p=proposed.filter(function(c){return c.key===x.key;})[0];
    if(!p||!p.writable)throw new Error('Selected field requires a fresh review');
    if(normalizeForCompare_(x.expectedCurrent)!==normalizeForCompare_(p.currentValue))throw new Error('Master changed since review; refresh before approving');
  });
  var files=parseJsonObject_(o['Attachments JSON']);if(!Array.isArray(files))files=[];
  fileIds.forEach(function(id){if(!files.some(function(f){return f.fileId===id;}))throw new Error('Attachment not in submission');});
  var plan={version:3,reviewer:ACTOR_LABEL,startedAt:tongaNow_(),note:String(body.reviewNotes||'').slice(0,1500),items:[]};
  proposed.forEach(function(c){plan.items.push({kind:'text',key:c.key,label:c.label,selected:!!keys[c.key],state:keys[c.key]?'pending':'deferred',change:c});});
  files.forEach(function(f){plan.items.push({kind:'file',key:f.fileId,field:f.field,name:f.name,selected:fileIds.indexOf(f.fileId)>=0,state:fileIds.indexOf(f.fileId)>=0?'pending':'deferred'});});
  if(old){
    // Preserve durable successes and unfinished selected work. Only newly selected
    // deferred items get a fresh expected-current check and become pending.
    old.items.forEach(function(item){var fresh=plan.items.find(function(x){return x.kind===item.kind&&x.key===item.key;});
      if(item.state!=='deferred'||!fresh||!fresh.selected){var i=plan.items.findIndex(function(x){return x.kind===item.kind&&x.key===item.key;});if(i>=0)plan.items[i]=item;else plan.items.push(item);}
    });
  }
  if(!old&&!plan.items.some(function(x){return x.state==='pending';}))throw new Error('Select at least one pending item');
  tongaSavePlan_(o,plan);return plan;
}
function tongaApplyPlan_(ss,o,plan){
  var pending=plan.items.filter(function(x){return x.kind==='text'&&x.state==='pending';}),results=[];
  // Check all pending fields before applying any; re-resolve degree rows each time.
  var current=buildScholarSubmissionChanges_(ss,o);
  pending.forEach(function(item){
    var c=item.change,p=current.filter(function(x){return x.key===item.key;})[0];
    if(p&&(!p.writable||normalizeForCompare_(p.currentValue)!==normalizeForCompare_(c.currentValue)))throw new Error('Master conflict for '+item.label+'; pending review retained');
    // If a previous write succeeded but acknowledgement failed, applyOneChange_
    // recognizes the desired value. For degree rows still require a unique row.
    var target=p||c;
    if(c.worksheet==='Graduate Degrees'&&!p){
      var t=tongaTable_(ss,'Graduate Degrees'),si=t.headers.indexOf('Scholar ID'),di=t.headers.indexOf('Degree Stage');
      var stage=scholarSubmissionFieldSpecs_().filter(function(x){return x.key===item.key;})[0].stage;
      var rows=t.rows.map(function(r,i){return {r:r,n:i+5};}).filter(function(x){return x.r[si]===o['Scholar ID']&&(stage==='master'?/master/i:/(phd|doctor)/i).test(x.r[di]);});
      if(rows.length!==1)throw new Error('Ambiguous degree row; pending review retained');target.rowNumber=rows[0].n;
    }
    item._write={worksheet:c.worksheet,scholarId:o['Scholar ID'],rowNumber:target.rowNumber,field:c.field,oldValue:c.currentValue,newValue:c.newValue};
    var test=applyOneChange_(ss,item._write,true);if(['ok','already_satisfied'].indexOf(test.status)<0)throw new Error('Field validation failed: '+item.label+' ('+test.status+')');
  });
  pending.forEach(function(item){
    var result=applyOneChange_(ss,item._write,false);delete item._write;
    results.push({key:item.key,status:result.status});
    if(['ok','already_satisfied'].indexOf(result.status)>=0){item.state='applied';item.reviewedBy=ACTOR_LABEL;item.reviewedAt=tongaNow_();tongaSavePlan_(o,plan);}
  });
  return jsonOut_({status:results.some(function(r){return ['ok','already_satisfied'].indexOf(r.status)<0;})?'partial':'ok',results:results,plan:plan,remainingReview:true});
}
function tongaRecordAttachment_(body){return tongaWithSubmission_(body,function(ss,o){
  var plan=tongaReviewPlan_(o);if(!plan)throw new Error('Begin review first');
  var item=plan.items.filter(function(x){return x.kind==='file'&&x.key===body.fileId;})[0];
  if(!item||!item.selected)throw new Error('Attachment not selected');
  if(item.state!=='pending')return jsonOut_({status:'ok',plan:plan,alreadyRecorded:true});
  var disposition=String(body.disposition||''),evidence=String(body.evidence||'').trim();
  if(item.field==='headshot'){
    if(TONGA_REQUEST_ROLE!=='owner')throw new Error('Photo publication must be completed by the Owner; this item stays Pending.');
    if(disposition!=='published'||!/^img\/scholars\/TNG-S\d+\.jpg$/.test(evidence)||evidence!=='img/scholars/'+o['Scholar ID']+'.jpg')throw new Error('Successful Tonga photo service result required');
  }else{
    if(['reviewed_privately','imported'].indexOf(disposition)<0||evidence.length<10)throw new Error('Describe actual private review or completed import; downloading is not importing');
    if(/bibliograph|bibtex|ris|enw/i.test(item.field+' '+item.name)&&disposition!=='imported')throw new Error('Bibliography requires a completed import with evidence');
  }
  item.state=disposition;item.evidence=evidence.slice(0,1500);item.reviewedBy=ACTOR_LABEL;item.reviewedAt=tongaNow_();tongaSavePlan_(o,plan);
  return jsonOut_({status:'ok',plan:plan});
});}
function tongaFinishReview_(body){return tongaWithSubmission_(body,function(ss,o){return jsonOut_(tongaFinishPlan_(body,ss,o));});}
function tongaFinishPlan_(body,ss,o){
  var plan=tongaReviewPlan_(o);if(!plan)throw new Error('Begin review first');
  var remains=plan.items.filter(function(x){return x.state==='pending'||x.state==='deferred';});
  if(remains.length)return {status:'ok',remainingReview:true,pending:remains.length,plan:plan};
  var summary=plan.items.map(function(x){return x.kind+':'+x.key+'='+x.state;}).join('; ');
  o._sheet.getRange(o._row,13,1,4).setValues([[tongaLiteral_(String(body.reviewNotes||plan.note).slice(0,1500)),ACTOR_LABEL,tongaNow_(),summary]]);
  appendChangeLog_(ss,SCHOLAR_SUBMISSION_SHEET,o['Scholar ID'],o['Submission ID'],'Pending','Reviewed');
  o._sheet.getRange(o._row,3).setValue('Reviewed');o.Status='Reviewed';return {status:'ok',remainingReview:false,plan:plan};
}
function tongaRejectRemaining_(o){
  var plan=tongaReviewPlan_(o);
  if(!plan){var fields=parseJsonObject_(o['Submitted Fields JSON']),files=parseJsonObject_(o['Attachments JSON']);plan={version:2,reviewer:ACTOR_LABEL,items:Object.keys(fields).map(function(k){return {kind:'text',key:k,state:'rejected'};})};
    if(Array.isArray(files))files.forEach(function(f){plan.items.push({kind:'file',key:f.fileId,state:'rejected'});});}
  plan.items.forEach(function(x){if(x.state==='pending'||x.state==='deferred'){x.state='rejected';x.reviewedBy=ACTOR_LABEL;x.reviewedAt=tongaNow_();};});tongaSavePlan_(o,plan);
}
function tongaBanSubmitter_(body){return tongaWithSubmission_(body,function(ss,o){
  var reason=String(body.reason||'').trim();if(reason.length<5||body.confirmed!==true)throw new Error('A reason and explicit confirmation are required');
  var email=normalizedSubmitterEmail_(o['Submitter Email']);if(!email)throw new Error('No submitter email');
  if(!isScholarSubmitterBlocked_(ss,email)){var sh=ensureScholarBlocklistSheet_(ss);sh.getRange(sh.getLastRow()+1,1,1,7).setValues([[email,o['Submitter Name'],tongaNow_(),ACTOR_LABEL,o['Submission ID'],reason.slice(0,1500),'Active'].map(tongaLiteral_)]);}
  appendChangeLog_(ss,SCHOLAR_BLOCKLIST_SHEET,o['Scholar ID'],o['Submission ID'],'','Submitter blocked: '+reason.slice(0,500));
  return jsonOut_({status:'ok',blocked:true});
});}
function tongaCurrentGeo_(ss,key){
  var t=tongaTable_(ss,'Research Geography'),pi=t.headers.indexOf('Publication ID / BibTeX Key'),ci=t.headers.indexOf('Country');
  if(pi<0||ci<0)throw new Error('Research Geography headers require verification');
  function val(r,h){var i=t.headers.indexOf(h);return i<0?'':r[i];}
  return t.rows.filter(function(r){return r[pi]===key&&String(r[ci]).trim().toLowerCase()==='tonga';}).map(function(r){return {national:/national|general/i.test(val(r,'Geography Type')),division:val(r,'Island Division (auto from District)'),district:val(r,'District'),island:val(r,'Specific Island'),village:val(r,'Village / Town / Site')};});
}

function tongaValidateLocationLinks_(ss,locations){
  var t=tongaTable_(ss,'Research Geography'),ci=t.headers.indexOf('Country'),ii=t.headers.indexOf('Specific Island'),di=t.headers.indexOf('Island Division (auto from District)');
  function norm(v){return String(v||'').trim().replace(/[‘’ʻʼ]/g,"'").replace(/\s*\([^)]*\)\s*$/,'').toLowerCase();}
  locations.forEach(function(l){if(!l.island)return;
    var divisions={};t.rows.forEach(function(r){if(norm(r[ci])==='tonga'&&norm(r[ii])===norm(l.island)&&r[di])divisions[tongaDivision_(r[di])]=true;});
    if(Object.keys(divisions).length!==1||!divisions[l.division])throw new Error('Island/division relationship requires verification in Tonga Master geography: '+l.island);
  });
}
/** Owner backup before deploying review v2. Does not change any live queue. */
function backupTongaReviewDataV2(){
  var ss=geoSs_();if(ss.getId()!==SPREADSHEET_ID_HINT)throw new Error('Wrong Tonga Master');
  var copy=DriveApp.getFileById(ss.getId()).makeCopy('Tonga Master before review v2 '+tongaNow_());
  Logger.log('Private backup created: '+copy.getUrl());return copy.getUrl();
}

// Google reviewer access. The private roster is never sent to the browser.
// The existing secret remains an Owner-only recovery path. Never share it.
var TONGA_REQUEST_ROLE = 'owner';
var TONGA_AUTH_ERROR='';
var TONGA_READ_ACTIONS = ['reviewQueueCounts','reviewCapabilities','ping','describe','readScholarProfileSubmissions','readScholarSubmissionAttachment','readPublicationGeographySubmissions','readScholar','readRows','readChangeLog'];
var TONGA_REVIEW_ACTIONS = ['reviewScholarSelection','reviewQueueCounts','reviewCapabilities','readScholarProfileSubmissions','readScholarSubmissionAttachment','readPublicationGeographySubmissions','beginScholarReview','recordScholarAttachmentReview','finishScholarReview','approveScholarProfileSubmission','resolveScholarProfileSubmission','resolvePublicationGeographySubmission'];
function tongaAuthorize_(payload, action) {
  TONGA_REQUEST_ROLE=''; ACTOR_LABEL='';TONGA_AUTH_ERROR='';
  // Never accept a caller's claimed email, role or actor. Never fall back to the
  // owner secret after a failed Google credential.
  if (payload.idToken) {
    try {
      var identity=tongaVerifyGoogle_(String(payload.idToken));
      var role=tongaRoleForIdentity_(identity);
      if(!role){TONGA_AUTH_ERROR='This Google account is not on the current review roster, or its account binding differs. Ask the Owner to check the private access settings.';return false;}
      if(role!=='owner'&&TONGA_REVIEW_ACTIONS.indexOf(action)<0){TONGA_AUTH_ERROR='This action is available only to the Owner.';return false;}
      TONGA_REQUEST_ROLE=role;
      ACTOR_LABEL=identity.email+' ('+role+'; Google '+identity.sub+')';
      return true;
    } catch (err) { TONGA_AUTH_ERROR=err.tongaAuthSafe||'Google identity could not be verified. Sign in again; if this persists, ask the Owner to run inspectTongaReviewAccess in Apps Script.';return false; }
  }
  if (!checkAuth_(payload)) return false;
  TONGA_REQUEST_ROLE='owner'; ACTOR_LABEL='Owner (legacy secret)';
  return true;
}
function tongaVerifyGoogle_(token) {
  if(typeof TongaJWT==='undefined')throw tongaAuthError_('The deployed backend is missing its Google token verifier. The Owner must deploy the complete backend bundle.');
  if(token.length>16000)throw new Error('Invalid credential');
  var parts=token.split('.');if(parts.length!==3)throw new Error('Invalid credential');
  var header=JSON.parse(TongaJWT.decode(parts[0]));
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>160)throw new Error('Invalid algorithm');
  var props=PropertiesService.getScriptProperties(),aud=props.getProperty('TONGA_GOOGLE_CLIENT_ID');
  if(!aud)throw tongaAuthError_('The backend TONGA_GOOGLE_CLIENT_ID setting is missing.');
  aud=String(aud).trim();
  if(!String(props.getProperty('TONGA_OWNER_EMAIL')||'').trim())throw tongaAuthError_('The backend TONGA_OWNER_EMAIL setting is missing.');
  var keys=tongaGoogleKeys_(),key=keys.filter(function(k){return k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig';})[0];
  if(!key){CacheService.getScriptCache().remove('tonga-google-jwks-v1');key=tongaGoogleKeys_().filter(function(k){return k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig';})[0];}
  if(!key)throw new Error('Unknown Google signing key. Try again later.');
  if(!TongaJWT.JWS.verify(token,TongaJWT.KEYUTIL.getKey(key),['RS256']))throw new Error('Invalid signature');
  var claims=JSON.parse(TongaJWT.decode(parts[1])),now=Math.floor(Date.now()/1000);
  if(claims.aud!==aud||(claims.azp&&claims.azp!==aud)||['accounts.google.com','https://accounts.google.com'].indexOf(claims.iss)<0)throw new Error('Invalid issuer or audience');
  if(typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+60||claims.exp-claims.iat>7200||(claims.nbf&&claims.nbf>now))throw new Error('Expired or invalid credential');
  if(typeof claims.sub!=='string'||!/^\d{1,255}$/.test(claims.sub)||claims.email_verified!==true||typeof claims.email!=='string')throw new Error('Unverified identity');
  claims.email=claims.email.toLowerCase();
  if(!/@gmail\.com$/.test(claims.email)&&!(typeof claims.hd==='string'&&claims.hd&&claims.email.split('@')[1]===claims.hd.toLowerCase()))throw new Error('Google-hosted identity required');
  return claims;
}
function tongaGoogleKeys_() {
  var cache=CacheService.getScriptCache(),key='tonga-google-jwks-v1',cached=cache.get(key);
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
function tongaRoleForIdentity_(identity) {
  var props=PropertiesService.getScriptProperties();
  var owner=String(props.getProperty('TONGA_OWNER_EMAIL')||'').trim().toLowerCase();
  if(!owner)return ''; // Fail closed until the Owner configures access.
  var admins=String(props.getProperty('TONGA_REVIEWER_EMAILS')||'').toLowerCase().split(/[\s,;]+/);
  var role=identity.email===owner?'owner':admins.indexOf(identity.email)>=0?'admin':'';
  if(!role)return '';
  // Bind each authorized email to Google's immutable account ID on first login.
  // Subsequent logins require BOTH the current roster entry and that identity.
  var key='TONGA_GOOGLE_SUB_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,identity.email)).replace(/=+$/,'');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var bound=props.getProperty(key);
    if(bound&&bound!==identity.sub)return '';
    if(!bound)props.setProperty(key,identity.sub);
  } finally {lock.releaseLock();}
  return role;
}


function tongaAuthError_(message){var e=new Error(message);e.tongaAuthSafe=message;return e;}
/** Owner runs this locally in Apps Script. No secrets or roster values logged. */
function authorizeTongaReviewAccess(){
 ScriptApp.requireScopes(ScriptApp.AuthMode.FULL,['https://www.googleapis.com/auth/script.external_request']);
 return inspectTongaReviewAccess();
}
function inspectTongaReviewAccess(){
 var p=PropertiesService.getScriptProperties();
 var result={version:TONGA_SUBMISSIONS_VERSION,verifierLoaded:typeof TongaJWT!=='undefined',clientIdConfigured:!!p.getProperty('TONGA_GOOGLE_CLIENT_ID'),ownerConfigured:!!p.getProperty('TONGA_OWNER_EMAIL'),reviewerCount:String(p.getProperty('TONGA_REVIEWER_EMAILS')||'').split(/[\s,;]+/).filter(Boolean).length,writeEnabled:writeEnabled_()};
 try { result.googleSigningKeyCount=tongaGoogleKeys_().length; } catch(e) { result.googleSigningKeysError=String(e&&e.message||e); }
 Logger.log(JSON.stringify(result));return result;
}
function tongaQueueCounts_(){
 var ss=geoSs_(),out={status:'ok'};
 [['scholar',ensureScholarSubmissionSheet_(ss)],['geography',tongaEnsureGeoQueue_(ss)]].forEach(function(pair){var sh=pair[1],last=sh.getLastRow();out[pair[0]]=last<5?0:sh.getRange(5,3,last-4,1).getDisplayValues().filter(function(r){return r[0]==='Pending';}).length;});
 return jsonOut_(out);
}
function tongaReviewSelection_(body){
 TONGA_READ_TABLES=null;
 var lock=LockService.getScriptLock();lock.waitLock(LOCK_WAIT_MS);
 try{
  var ss=geoSs_(),o=findScholarSubmission_(ss,String(body.submissionId||''));if(!o)throw new Error('Submission not found');
  if(o.Status!=='Pending')return jsonOut_({status:o.Status==='Reviewed'?'ok':'already_resolved',alreadyRecorded:true,row:tongaReviewRow_(ss,o),remainingReview:false});
  var plan=tongaBeginPlan_(body,ss,o);
  var applied=tongaApplyPlan_(ss,o,plan),result=typeof applied.getContent==='function'?JSON.parse(applied.getContent()):applied;
  if(result.status!=='ok')return applied;
  var finished=tongaFinishPlan_(body,ss,o);finished.row=tongaReviewRow_(ss,o);finished.results=result.results;
  return jsonOut_(finished);
 }finally{lock.releaseLock();}
}
function tongaReviewRow_(ss,o){var row={};SCHOLAR_SUBMISSION_HEADERS.forEach(function(h){row[h]=o[h]||'';});row.reviewPlan=tongaReviewPlan_(o);row.proposedChanges=buildScholarSubmissionChanges_(ss,o);return row;}

/* UN M49 country or area vocabulary, retrieved 2026-09-26.
 * Source: https://unstats.un.org/unsd/methodology/m49/
 * Generated from data/tonga-country-list.json. No political status implied.
 * Identical vocabulary executes in the browser and the Apps Script bundle. */
var TongaCountries=(function(){
'use strict';
var rows=[{"name":"Afghanistan","m49":"004","iso3":"AFG"},{"name":"Åland Islands","m49":"248","iso3":"ALA"},{"name":"Albania","m49":"008","iso3":"ALB"},{"name":"Algeria","m49":"012","iso3":"DZA"},{"name":"American Samoa","m49":"016","iso3":"ASM"},{"name":"Andorra","m49":"020","iso3":"AND"},{"name":"Angola","m49":"024","iso3":"AGO"},{"name":"Anguilla","m49":"660","iso3":"AIA"},{"name":"Antarctica","m49":"010","iso3":"ATA"},{"name":"Antigua and Barbuda","m49":"028","iso3":"ATG"},{"name":"Argentina","m49":"032","iso3":"ARG"},{"name":"Armenia","m49":"051","iso3":"ARM"},{"name":"Aruba","m49":"533","iso3":"ABW"},{"name":"Australia","m49":"036","iso3":"AUS"},{"name":"Austria","m49":"040","iso3":"AUT"},{"name":"Azerbaijan","m49":"031","iso3":"AZE"},{"name":"Bahamas","m49":"044","iso3":"BHS"},{"name":"Bahrain","m49":"048","iso3":"BHR"},{"name":"Bangladesh","m49":"050","iso3":"BGD"},{"name":"Barbados","m49":"052","iso3":"BRB"},{"name":"Belarus","m49":"112","iso3":"BLR"},{"name":"Belgium","m49":"056","iso3":"BEL"},{"name":"Belize","m49":"084","iso3":"BLZ"},{"name":"Benin","m49":"204","iso3":"BEN"},{"name":"Bermuda","m49":"060","iso3":"BMU"},{"name":"Bhutan","m49":"064","iso3":"BTN"},{"name":"Bolivia (Plurinational State of)","m49":"068","iso3":"BOL"},{"name":"Bonaire, Sint Eustatius and Saba","m49":"535","iso3":"BES"},{"name":"Bosnia and Herzegovina","m49":"070","iso3":"BIH"},{"name":"Botswana","m49":"072","iso3":"BWA"},{"name":"Bouvet Island","m49":"074","iso3":"BVT"},{"name":"Brazil","m49":"076","iso3":"BRA"},{"name":"British Indian Ocean Territory","m49":"086","iso3":"IOT"},{"name":"British Virgin Islands","m49":"092","iso3":"VGB"},{"name":"Brunei Darussalam","m49":"096","iso3":"BRN"},{"name":"Bulgaria","m49":"100","iso3":"BGR"},{"name":"Burkina Faso","m49":"854","iso3":"BFA"},{"name":"Burundi","m49":"108","iso3":"BDI"},{"name":"Cabo Verde","m49":"132","iso3":"CPV"},{"name":"Cambodia","m49":"116","iso3":"KHM"},{"name":"Cameroon","m49":"120","iso3":"CMR"},{"name":"Canada","m49":"124","iso3":"CAN"},{"name":"Cayman Islands","m49":"136","iso3":"CYM"},{"name":"Central African Republic","m49":"140","iso3":"CAF"},{"name":"Chad","m49":"148","iso3":"TCD"},{"name":"Chile","m49":"152","iso3":"CHL"},{"name":"China","m49":"156","iso3":"CHN"},{"name":"China, Hong Kong Special Administrative Region","m49":"344","iso3":"HKG"},{"name":"China, Macao Special Administrative Region","m49":"446","iso3":"MAC"},{"name":"Christmas Island","m49":"162","iso3":"CXR"},{"name":"Cocos (Keeling) Islands","m49":"166","iso3":"CCK"},{"name":"Colombia","m49":"170","iso3":"COL"},{"name":"Comoros","m49":"174","iso3":"COM"},{"name":"Congo","m49":"178","iso3":"COG"},{"name":"Cook Islands","m49":"184","iso3":"COK"},{"name":"Costa Rica","m49":"188","iso3":"CRI"},{"name":"Côte d’Ivoire","m49":"384","iso3":"CIV"},{"name":"Croatia","m49":"191","iso3":"HRV"},{"name":"Cuba","m49":"192","iso3":"CUB"},{"name":"Curaçao","m49":"531","iso3":"CUW"},{"name":"Cyprus","m49":"196","iso3":"CYP"},{"name":"Czechia","m49":"203","iso3":"CZE"},{"name":"Democratic People's Republic of Korea","m49":"408","iso3":"PRK"},{"name":"Democratic Republic of the Congo","m49":"180","iso3":"COD"},{"name":"Denmark","m49":"208","iso3":"DNK"},{"name":"Djibouti","m49":"262","iso3":"DJI"},{"name":"Dominica","m49":"212","iso3":"DMA"},{"name":"Dominican Republic","m49":"214","iso3":"DOM"},{"name":"Ecuador","m49":"218","iso3":"ECU"},{"name":"Egypt","m49":"818","iso3":"EGY"},{"name":"El Salvador","m49":"222","iso3":"SLV"},{"name":"Equatorial Guinea","m49":"226","iso3":"GNQ"},{"name":"Eritrea","m49":"232","iso3":"ERI"},{"name":"Estonia","m49":"233","iso3":"EST"},{"name":"Eswatini","m49":"748","iso3":"SWZ"},{"name":"Ethiopia","m49":"231","iso3":"ETH"},{"name":"Falkland Islands (Malvinas)","m49":"238","iso3":"FLK"},{"name":"Faroe Islands","m49":"234","iso3":"FRO"},{"name":"Fiji","m49":"242","iso3":"FJI"},{"name":"Finland","m49":"246","iso3":"FIN"},{"name":"France","m49":"250","iso3":"FRA"},{"name":"French Guiana","m49":"254","iso3":"GUF"},{"name":"French Polynesia","m49":"258","iso3":"PYF"},{"name":"French Southern Territories","m49":"260","iso3":"ATF"},{"name":"Gabon","m49":"266","iso3":"GAB"},{"name":"Gambia","m49":"270","iso3":"GMB"},{"name":"Georgia","m49":"268","iso3":"GEO"},{"name":"Germany","m49":"276","iso3":"DEU"},{"name":"Ghana","m49":"288","iso3":"GHA"},{"name":"Gibraltar","m49":"292","iso3":"GIB"},{"name":"Greece","m49":"300","iso3":"GRC"},{"name":"Greenland","m49":"304","iso3":"GRL"},{"name":"Grenada","m49":"308","iso3":"GRD"},{"name":"Guadeloupe","m49":"312","iso3":"GLP"},{"name":"Guam","m49":"316","iso3":"GUM"},{"name":"Guatemala","m49":"320","iso3":"GTM"},{"name":"Guernsey","m49":"831","iso3":"GGY"},{"name":"Guinea","m49":"324","iso3":"GIN"},{"name":"Guinea-Bissau","m49":"624","iso3":"GNB"},{"name":"Guyana","m49":"328","iso3":"GUY"},{"name":"Haiti","m49":"332","iso3":"HTI"},{"name":"Heard Island and McDonald Islands","m49":"334","iso3":"HMD"},{"name":"Holy See","m49":"336","iso3":"VAT"},{"name":"Honduras","m49":"340","iso3":"HND"},{"name":"Hungary","m49":"348","iso3":"HUN"},{"name":"Iceland","m49":"352","iso3":"ISL"},{"name":"India","m49":"356","iso3":"IND"},{"name":"Indonesia","m49":"360","iso3":"IDN"},{"name":"Iran (Islamic Republic of)","m49":"364","iso3":"IRN"},{"name":"Iraq","m49":"368","iso3":"IRQ"},{"name":"Ireland","m49":"372","iso3":"IRL"},{"name":"Isle of Man","m49":"833","iso3":"IMN"},{"name":"Israel","m49":"376","iso3":"ISR"},{"name":"Italy","m49":"380","iso3":"ITA"},{"name":"Jamaica","m49":"388","iso3":"JAM"},{"name":"Japan","m49":"392","iso3":"JPN"},{"name":"Jersey","m49":"832","iso3":"JEY"},{"name":"Jordan","m49":"400","iso3":"JOR"},{"name":"Kazakhstan","m49":"398","iso3":"KAZ"},{"name":"Kenya","m49":"404","iso3":"KEN"},{"name":"Kiribati","m49":"296","iso3":"KIR"},{"name":"Kuwait","m49":"414","iso3":"KWT"},{"name":"Kyrgyzstan","m49":"417","iso3":"KGZ"},{"name":"Lao People's Democratic Republic","m49":"418","iso3":"LAO"},{"name":"Latvia","m49":"428","iso3":"LVA"},{"name":"Lebanon","m49":"422","iso3":"LBN"},{"name":"Lesotho","m49":"426","iso3":"LSO"},{"name":"Liberia","m49":"430","iso3":"LBR"},{"name":"Libya","m49":"434","iso3":"LBY"},{"name":"Liechtenstein","m49":"438","iso3":"LIE"},{"name":"Lithuania","m49":"440","iso3":"LTU"},{"name":"Luxembourg","m49":"442","iso3":"LUX"},{"name":"Madagascar","m49":"450","iso3":"MDG"},{"name":"Malawi","m49":"454","iso3":"MWI"},{"name":"Malaysia","m49":"458","iso3":"MYS"},{"name":"Maldives","m49":"462","iso3":"MDV"},{"name":"Mali","m49":"466","iso3":"MLI"},{"name":"Malta","m49":"470","iso3":"MLT"},{"name":"Marshall Islands","m49":"584","iso3":"MHL"},{"name":"Martinique","m49":"474","iso3":"MTQ"},{"name":"Mauritania","m49":"478","iso3":"MRT"},{"name":"Mauritius","m49":"480","iso3":"MUS"},{"name":"Mayotte","m49":"175","iso3":"MYT"},{"name":"Mexico","m49":"484","iso3":"MEX"},{"name":"Micronesia (Federated States of)","m49":"583","iso3":"FSM"},{"name":"Monaco","m49":"492","iso3":"MCO"},{"name":"Mongolia","m49":"496","iso3":"MNG"},{"name":"Montenegro","m49":"499","iso3":"MNE"},{"name":"Montserrat","m49":"500","iso3":"MSR"},{"name":"Morocco","m49":"504","iso3":"MAR"},{"name":"Mozambique","m49":"508","iso3":"MOZ"},{"name":"Myanmar","m49":"104","iso3":"MMR"},{"name":"Namibia","m49":"516","iso3":"NAM"},{"name":"Naoero","m49":"520","iso3":"NRU"},{"name":"Nepal","m49":"524","iso3":"NPL"},{"name":"Netherlands (Kingdom of the)","m49":"528","iso3":"NLD"},{"name":"New Caledonia","m49":"540","iso3":"NCL"},{"name":"New Zealand","m49":"554","iso3":"NZL"},{"name":"Nicaragua","m49":"558","iso3":"NIC"},{"name":"Niger","m49":"562","iso3":"NER"},{"name":"Nigeria","m49":"566","iso3":"NGA"},{"name":"Niue","m49":"570","iso3":"NIU"},{"name":"Norfolk Island","m49":"574","iso3":"NFK"},{"name":"North Macedonia","m49":"807","iso3":"MKD"},{"name":"Northern Mariana Islands","m49":"580","iso3":"MNP"},{"name":"Norway","m49":"578","iso3":"NOR"},{"name":"Oman","m49":"512","iso3":"OMN"},{"name":"Pakistan","m49":"586","iso3":"PAK"},{"name":"Palau","m49":"585","iso3":"PLW"},{"name":"Panama","m49":"591","iso3":"PAN"},{"name":"Papua New Guinea","m49":"598","iso3":"PNG"},{"name":"Paraguay","m49":"600","iso3":"PRY"},{"name":"Peru","m49":"604","iso3":"PER"},{"name":"Philippines","m49":"608","iso3":"PHL"},{"name":"Pitcairn","m49":"612","iso3":"PCN"},{"name":"Poland","m49":"616","iso3":"POL"},{"name":"Portugal","m49":"620","iso3":"PRT"},{"name":"Puerto Rico","m49":"630","iso3":"PRI"},{"name":"Qatar","m49":"634","iso3":"QAT"},{"name":"Republic of Korea","m49":"410","iso3":"KOR"},{"name":"Republic of Moldova","m49":"498","iso3":"MDA"},{"name":"Réunion","m49":"638","iso3":"REU"},{"name":"Romania","m49":"642","iso3":"ROU"},{"name":"Russian Federation","m49":"643","iso3":"RUS"},{"name":"Rwanda","m49":"646","iso3":"RWA"},{"name":"Saint Barthélemy","m49":"652","iso3":"BLM"},{"name":"Saint Helena","m49":"654","iso3":"SHN"},{"name":"Saint Kitts and Nevis","m49":"659","iso3":"KNA"},{"name":"Saint Lucia","m49":"662","iso3":"LCA"},{"name":"Saint Martin (French Part)","m49":"663","iso3":"MAF"},{"name":"Saint Pierre and Miquelon","m49":"666","iso3":"SPM"},{"name":"Saint Vincent and the Grenadines","m49":"670","iso3":"VCT"},{"name":"Samoa","m49":"882","iso3":"WSM"},{"name":"San Marino","m49":"674","iso3":"SMR"},{"name":"Sao Tome and Principe","m49":"678","iso3":"STP"},{"name":"Saudi Arabia","m49":"682","iso3":"SAU"},{"name":"Senegal","m49":"686","iso3":"SEN"},{"name":"Serbia","m49":"688","iso3":"SRB"},{"name":"Seychelles","m49":"690","iso3":"SYC"},{"name":"Sierra Leone","m49":"694","iso3":"SLE"},{"name":"Singapore","m49":"702","iso3":"SGP"},{"name":"Sint Maarten (Dutch part)","m49":"534","iso3":"SXM"},{"name":"Slovakia","m49":"703","iso3":"SVK"},{"name":"Slovenia","m49":"705","iso3":"SVN"},{"name":"Solomon Islands","m49":"090","iso3":"SLB"},{"name":"Somalia","m49":"706","iso3":"SOM"},{"name":"South Africa","m49":"710","iso3":"ZAF"},{"name":"South Georgia and the South Sandwich Islands","m49":"239","iso3":"SGS"},{"name":"South Sudan","m49":"728","iso3":"SSD"},{"name":"Spain","m49":"724","iso3":"ESP"},{"name":"Sri Lanka","m49":"144","iso3":"LKA"},{"name":"State of Palestine","m49":"275","iso3":"PSE"},{"name":"Sudan","m49":"729","iso3":"SDN"},{"name":"Suriname","m49":"740","iso3":"SUR"},{"name":"Svalbard and Jan Mayen Islands","m49":"744","iso3":"SJM"},{"name":"Sweden","m49":"752","iso3":"SWE"},{"name":"Switzerland","m49":"756","iso3":"CHE"},{"name":"Syrian Arab Republic","m49":"760","iso3":"SYR"},{"name":"Tajikistan","m49":"762","iso3":"TJK"},{"name":"Thailand","m49":"764","iso3":"THA"},{"name":"Timor-Leste","m49":"626","iso3":"TLS"},{"name":"Togo","m49":"768","iso3":"TGO"},{"name":"Tokelau","m49":"772","iso3":"TKL"},{"name":"Tonga","m49":"776","iso3":"TON"},{"name":"Trinidad and Tobago","m49":"780","iso3":"TTO"},{"name":"Tunisia","m49":"788","iso3":"TUN"},{"name":"Türkiye","m49":"792","iso3":"TUR"},{"name":"Turkmenistan","m49":"795","iso3":"TKM"},{"name":"Turks and Caicos Islands","m49":"796","iso3":"TCA"},{"name":"Tuvalu","m49":"798","iso3":"TUV"},{"name":"Uganda","m49":"800","iso3":"UGA"},{"name":"Ukraine","m49":"804","iso3":"UKR"},{"name":"United Arab Emirates","m49":"784","iso3":"ARE"},{"name":"United Kingdom of Great Britain and Northern Ireland","m49":"826","iso3":"GBR"},{"name":"United Republic of Tanzania","m49":"834","iso3":"TZA"},{"name":"United States Minor Outlying Islands","m49":"581","iso3":"UMI"},{"name":"United States of America","m49":"840","iso3":"USA"},{"name":"United States Virgin Islands","m49":"850","iso3":"VIR"},{"name":"Uruguay","m49":"858","iso3":"URY"},{"name":"Uzbekistan","m49":"860","iso3":"UZB"},{"name":"Vanuatu","m49":"548","iso3":"VUT"},{"name":"Venezuela (Bolivarian Republic of)","m49":"862","iso3":"VEN"},{"name":"Viet Nam","m49":"704","iso3":"VNM"},{"name":"Wallis and Futuna Islands","m49":"876","iso3":"WLF"},{"name":"Western Sahara","m49":"732","iso3":"ESH"},{"name":"Yemen","m49":"887","iso3":"YEM"},{"name":"Zambia","m49":"894","iso3":"ZMB"},{"name":"Zimbabwe","m49":"716","iso3":"ZWE"}],aliases={"Nauru": "Naoero", "Wallis and Futuna": "Wallis and Futuna Islands", "USA": "United States of America", "United States": "United States of America", "UK": "United Kingdom of Great Britain and Northern Ireland", "United Kingdom": "United Kingdom of Great Britain and Northern Ireland", "South Korea": "Republic of Korea", "North Korea": "Democratic People's Republic of Korea", "Russia": "Russian Federation", "Vietnam": "Viet Nam", "Turkey": "Türkiye", "Laos": "Lao People's Democratic Republic", "Iran": "Iran (Islamic Republic of)", "Bolivia": "Bolivia (Plurinational State of)", "Venezuela": "Venezuela (Bolivarian Republic of)", "Tanzania": "United Republic of Tanzania", "Netherlands": "Netherlands (Kingdom of the)", "Hong Kong": "China, Hong Kong Special Administrative Region", "Macao": "China, Macao Special Administrative Region", "Palestine": "State of Palestine", "Czech Republic": "Czechia", "Swaziland": "Eswatini", "Cape Verde": "Cabo Verde", "Federated States of Micronesia": "Micronesia (Federated States of)", "Pitcairn Islands": "Pitcairn", "FSM": "Micronesia (Federated States of)"};
function norm(v){return String(v||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[‘’]/g,"'").replace(/\s+/g,' ').toLowerCase();}
var byName={};rows.forEach(function(r){byName[norm(r.name)]=r;});
Object.keys(aliases).forEach(function(a){byName[norm(a)]=byName[norm(aliases[a])];});
return {rows:rows,resolve:function(v){return byName[norm(v)]||null;},suggest:function(v){var q=norm(v);return rows.filter(function(r){return norm(r.name).indexOf(q)>=0||Object.keys(aliases).some(function(a){return aliases[a]===r.name&&norm(a).indexOf(q)>=0;});});}};
})();
if(typeof module!=='undefined')module.exports=TongaCountries;
