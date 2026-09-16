/**
 * tongan-staging-writeback.gs — INTEGRATED REBUILD, STAGING ONLY.
 *
 * This is a NEW, separate Apps Script server. It targets the BACKUP copy
 * of the Tongan Master Sheet (STAGING_SPREADSHEET_ID below), never the
 * live Master Sheet. It must be pasted into a NEW Apps Script project,
 * not into the project behind the live admin exec URL. See
 * docs/TONGAN-STAGING-DEPLOY.md for the exact one-time setup steps.
 *
 * Implements, in the dependency order requested:
 *   1. Role + server-side authorization framework (Owner / Authenticator /
 *      Researcher), backed by the `Admin Users` worksheet — never trusts
 *      anything the browser sends.
 *   2. Public "Update info" submission endpoint (doPost, anonymous,
 *      sanitized, rate-limited) — writes only to quarantine/review
 *      tables, never to canonical Scholars/Positions/Graduate Degrees.
 *   3. Secure upload quarantine (Drive folder separate from production
 *      photos).
 *   4. For Review queue + side-by-side per-field approve/reject/return.
 *   5. Partial approval + concurrency/conflict handling.
 *   6. Authoritative append-only audit logging (Change Audit Log).
 *   7. Google Doc history sync (best-effort, retry-flagged on failure).
 *   8. Second-Authenticator requests (optional for corrections).
 *   9. Dual-Authenticator Indigenous Tongan identity decisions (required,
 *      two distinct accounts, Researchers excluded as final approvers).
 *  10. Owner rollback controls (new reversal entries, never edits history).
 *  11. Owner-only, on-demand publishing with a preview step. In STAGING
 *      this writes a snapshot to Drive, NOT to the live GitHub repo —
 *      wiring the real GitHub publish target is a cutover-time change,
 *      done only after explicit approval, per the "protect all live
 *      systems" instruction.
 *
 * Never sends the full Scholars sheet, evidence, or Admin Users to the
 * browser. Every list/detail endpoint is scoped and paginated.
 */

// ─────────────────────────────────────────────────────────────────────────
// CONFIG — STAGING TARGETS ONLY
// ─────────────────────────────────────────────────────────────────────────

// Backup copy created 2026-09-01, NOT the live Master Sheet.
var STAGING_SPREADSHEET_ID = '1XTbiKazab-2WWJmkqjJ6AIWvymBL5-6Jj8EsHXYcXWs';
var SOURCE_TAG   = 'tongan-staging-integrated-rebuild v1';
var LOCK_WAIT_MS = 30 * 1000;
var TIMEZONE     = 'Pacific/Honolulu';
var APP_VERSION  = 'staging-2026-09-01.1';

// Drive folders created 2026-09-01, inside "2_Tongan Scholarly Database".
var PHOTO_FOLDER_ID      = '1hQf6FarFwlygilcdteUMCM_qMe-bpbI4'; // Tongan Scholar Photos (approved only)
var QUARANTINE_FOLDER_ID = '1K52nF1dz7RpSJQRDJvF6-nEJ-OXvRv0D'; // Tongan Submission Uploads (Quarantine)

// Human-readable change-history mirror. Never authoritative — Change Audit
// Log is authoritative. See _syncDocHistory_.
var HISTORY_DOC_ID = '1p5icHjnRNgzQ5sg4pHH4rZXiqVl3fQMNaDvD2ZqzPd0';

// Role hierarchy. Higher rank includes every permission of lower ranks
// for read/apply purposes; specific endpoints still gate exact actions
// (e.g. Authenticator can apply, but only Owner manages Admin Users).
var ROLE_RANK = { 'Researcher': 1, 'Authenticator': 2, 'Owner': 3 };

// ─── IDENTITY BROKER (see docs/TONGAN-IDENTITY-BROKER.md) ─────────────────
// This staging deployment runs "Execute as: Me" so the script (never the
// visitor) is the only thing that ever touches the Sheet/Drive — required
// to keep the Master Sheet private and role-based filtering intact. But
// under "Execute as: Me", Session.getActiveUser() can ONLY resolve a
// visitor's identity when they share a Google Workspace domain with the
// script owner (confirmed by direct test: it returns blank for a personal
// Gmail account). Real Authenticators may not have @hawaii.edu accounts,
// so a second, separate deployment of this SAME script —
// BROKER_DEPLOYMENT_URL — is configured "Execute as: User accessing the
// web app", which correctly resolves ANY Google account's identity (that
// mode trades away Sheet access, which is exactly why the broker's doGet
// path below never touches SpreadsheetApp/DriveApp — it only ever returns
// an HMAC-signed {email, token} pair). The main admin app redirects THIS
// SAME TAB to that broker URL (a top-level navigation, not a popup — a
// popup can't survive accounts.google.com's own OAuth consent screen; see
// _renderIdentityBrokerPage_ below for why), which redirects back with the
// signed token in a URL fragment, and it's passed with every apiCall(...)
// — _verifyIdentityToken_ independently re-checks the signature
// server-side before trusting the embedded email. Never trust a
// client-supplied email without this signature check.
var BROKER_DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbwsqx-iAQp0RUoExT9cyredtg7PynPLyrdb_t114vrAKaCYCHvavB_a9i-SHBTkSl8jbw/exec';
// The main deployment's own exec URL. The broker redirects back here
// (hardcoded, never taken from a request parameter) so there is no
// open-redirect surface — the broker can only ever send a visitor to
// this one fixed destination.
var MAIN_DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbxuqTgtBXdKsn4PFPAYKa82xhvT7KkthCNGuiOjwmmTzfNdYc72T6y8uy5ZHnkDUd42zQ/exec';
// IDENTITY_BROKER_PARAM — how doGet() decides "is this the broker
// request", REPLACING an earlier design that compared
// ScriptApp.getService().getUrl() (or a deployment-ID substring of it)
// against BROKER_DEPLOYMENT_URL. That entire approach turned out to be
// unreliable: confirmed live, ScriptApp.getService().getUrl() does not
// dependably reflect which of this script's multiple web-app deployments
// actually served the current request — visiting the broker's own exec
// URL directly still rendered the main app-shell/gate branch instead of
// _renderIdentityBrokerPage_, producing an infinite "Verify with Google"
// loop with no way out. This is a known Apps Script limitation with
// multiple active deployments of one script project, not something
// fixable by parsing getUrl() more cleverly.
// Fix: stop asking Apps Script which deployment we're on. Decide instead
// from a query parameter that ONLY our own broker link ever sets (see
// tmpl.brokerUrl below, and the redirect destination is always our own
// hardcoded MAIN_DEPLOYMENT_URL, never a request-supplied value — so
// there's no open-redirect surface here either). Worst case if someone
// manually appends this param to the MAIN deployment's URL: they just
// get a tiny page that signs THEIR OWN session identity under "Execute
// as: Me" (blank for cross-domain accounts, their own hawaii.edu email
// otherwise) — never anyone else's identity, and it still never touches
// Sheet/Drive. That's a no-op, not a privilege escalation.
var IDENTITY_BROKER_PARAM = 'identitybroker';
var IDENTITY_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Fields visible on the public dashboard card — the ONLY fields the public
// submission form may prefill from or propose changes to. Keep in sync
// with Panel F on the live dashboard. Everything else on Scholars/
// Positions/Graduate Degrees is never exposed to the public form.
var PUBLIC_VISIBLE_FIELDS = {
  'Scholars': [
    'Title / Salutation', 'Family Name', 'Given Names', 'Gender',
    'Primary Discipline / Field', 'Current Title / Role',
    'Current Institution', 'Institution Country',
    'ORCID / Researcher ID', 'Google Scholar URL', 'Current Profile URL'
  ]
};

// Fields whose change should bump "Last updated" on the Scholars row when
// applied from a submission (i.e. genuinely public-facing fields).
var PUBLIC_FACING_FIELDS = PUBLIC_VISIBLE_FIELDS['Scholars'];

// Statuses that require TWO DISTINCT Owner/Authenticator approvals before
// the canonical Indigenous-status field changes.
var DUAL_AUTH_OUTCOMES = ['Verified Indigenous Tongan', 'Rejected/Not eligible'];

var IDENTITY_STATUSES = [
  'Candidate', 'Research in progress', 'Pending authentication',
  'Needs further evidence', 'Verified Indigenous Tongan',
  'Rejected/Not eligible', 'Reopened', 'Superseded'
];

// Same MAPPING contract as the live admin (Scholars/Positions/Graduate
// Degrees editable fields), reused unchanged so validation stays
// consistent between the live and staging systems.
var MAPPING = {
  version: '2.0-tongan-staging',
  worksheets: {
    'Scholars': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      fields: {
        'Title / Salutation':      { type: 'enum',   enum: ['Dr','Prof','Rev','Rev Dr','Mr','Mrs','Ms',''] },
        'Family Name':             { type: 'string', maxLen: 120 },
        'Given Names':             { type: 'string', maxLen: 120 },
        'Gender':                  { type: 'enum',   enum: ['Tangata','Fefine','Unknown',''] },
        'Year of Birth':           { type: 'string', maxLen: 4, pattern: '^(\\d{4})?$' },
        'Alive / Deceased':        { type: 'enum',   enum: ['Alive','Deceased','Unknown',''] },
        'Year of Death':           { type: 'string', maxLen: 4, pattern: '^(\\d{4})?$' },
        'Paternal Island Division':{ type: 'string', maxLen: 60 },
        'District Paternal':       { type: 'string', maxLen: 80 },
        'Specific Island Paternal':{ type: 'string', maxLen: 80 },
        'Village/Town Paternal (Kolo)': { type: 'string', maxLen: 120 },
        'Maternal Island Division':{ type: 'string', maxLen: 60 },
        'District Maternal':       { type: 'string', maxLen: 80 },
        'Specific Island Maternal':{ type: 'string', maxLen: 80 },
        'Village/Town Maternal (Kolo)': { type: 'string', maxLen: 120 },
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
      keyColumn: 'Scholar ID', headerRow: 4, allowMultiRow: true,
      fields: {
        'Institution':                              { type: 'string', maxLen: 200 },
        'Country':                                  { type: 'string', maxLen: 80 },
        'Department / Unit':                        { type: 'string', maxLen: 200 },
        'Academic / Professional Title (verbatim)': { type: 'string', maxLen: 240 },
        'Standardized Academic Rank':                { type: 'string', maxLen: 120 },
        'Leadership Title (verbatim)':                { type: 'string', maxLen: 240 },
        'Standardized Leadership Category':          { type: 'string', maxLen: 120 },
        'Leadership Level':                          { type: 'string', maxLen: 60 },
        'Role Status':                               { type: 'string', maxLen: 60 },
        'Start Year':                                { type: 'int', min: 1900, max: 2100, nullable: true },
        'End Year':                                  { type: 'int', min: 1900, max: 2100, nullable: true },
        'Source URL':                                { type: 'url', maxLen: 500 },
        'Evidence / Notes':                          { type: 'string', maxLen: 2000 },
        'Last Verified':                             { type: 'string', maxLen: 60 }
      }
    },
    'Graduate Degrees': {
      keyColumn: 'Scholar ID', headerRow: 4, allowMultiRow: true,
      fields: {
        'Degree Stage':                { type: 'string', maxLen: 60 },
        'Degree / Qualification':      { type: 'string', maxLen: 200 },
        'Field / Discipline':          { type: 'string', maxLen: 200 },
        'C_Uni name':                  { type: 'string', maxLen: 200 },
        'O_Uni name':                  { type: 'string', maxLen: 200 },
        'Country':                     { type: 'string', maxLen: 80 },
        "International from Tonga?":   { type: 'enum', enum: ['Yes','No','Unknown',''] },
        'City':                        { type: 'string', maxLen: 120 },
        'Region':                      { type: 'string', maxLen: 120 },
        'Year / Status':               { type: 'string', maxLen: 60 },
        'Completion Status':           { type: 'string', maxLen: 120 },
        'Thesis / Research Title':     { type: 'string', maxLen: 500 },
        'Thesis / Repository URL':     { type: 'url', maxLen: 500 },
        'Evidence URL 1':              { type: 'url', maxLen: 500 },
        'Evidence URL 2':              { type: 'url', maxLen: 500 },
        'Verification':                { type: 'string', maxLen: 2000 },
        'Notes':                       { type: 'string', maxLen: 2000 },
        'Start Year':                  { type: 'int', min: 1900, max: 2100, nullable: true },
        'Finish / Completion Year':    { type: 'int', min: 1900, max: 2100, nullable: true },
        'Duration (years)':            { type: 'string', maxLen: 40 },
        'Study Date Evidence / Notes': { type: 'string', maxLen: 2000 }
      }
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────
// ROLE + AUTHORIZATION FRAMEWORK (component 1)
// ─────────────────────────────────────────────────────────────────────────

// Per-execution override set by apiCall() after independently verifying an
// HMAC-signed identity token. Never set from any client-supplied value
// without going through _verifyIdentityToken_ first.
var __ACTIVE_EMAIL_OVERRIDE__ = null;

function _rawSessionEmail_() {
  var session = Session.getActiveUser();
  return session ? (session.getEmail() || '').toLowerCase() : '';
}

function _activeEmail_() {
  return __ACTIVE_EMAIL_OVERRIDE__ || _rawSessionEmail_();
}

/** _identitySecret_() — lazily creates and persists a random per-project
 * HMAC secret in Script Properties (never in code, never sent to a
 * client). Used only to sign/verify identity tokens issued by the
 * broker deployment. */
function _identitySecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('IDENTITY_HMAC_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('IDENTITY_HMAC_SECRET', s);
  }
  return s;
}

/** _signIdentity_(email) — called ONLY from the broker deployment's doGet
 * path, where Session.getActiveUser() reliably reflects the real visitor
 * (any Google account) because that deployment runs "Execute as: User
 * accessing the web app" and never touches Sheet/Drive data. */
function _signIdentity_(email) {
  var payload = String(email).toLowerCase() + '|' + Date.now();
  var payloadB64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes());
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _identitySecret_()));
  return payloadB64 + '.' + sig;
}

/** _verifyIdentityToken_(token) — independently re-checks the HMAC
 * signature and freshness of a token before trusting the embedded email.
 * This is the ONLY path by which a client-influenced value can ever
 * become the active identity for role checks — never trust the email
 * string alone. Throws (never silently falls back) on any failure. */
function _verifyIdentityToken_(token) {
  if (!token || token.indexOf('.') === -1) {
    throw new Error('not-authorized: missing identity token — please verify your Google identity and try again.');
  }
  var parts = token.split('.');
  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (e) {
    throw new Error('not-authorized: malformed identity token.');
  }
  var expectedSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, _identitySecret_()));
  if (expectedSig !== parts[1]) throw new Error('not-authorized: invalid identity token signature.');
  var bits = payload.split('|');
  var email = (bits[0] || '').toLowerCase();
  var ts = Number(bits[1]);
  if (!email || !ts) throw new Error('not-authorized: malformed identity token.');
  if ((Date.now() - ts) > IDENTITY_TOKEN_MAX_AGE_MS) {
    throw new Error('not-authorized: identity token expired — please verify your Google identity again.');
  }
  return email;
}

/**
 * apiCall(fnName, identityToken, args) — the SINGLE entry point the
 * client uses for every server call (see tongan-staging-admin-bridge.html).
 * Verifies the signed identity token BEFORE dispatching, sets it as the
 * active-email override for the duration of this execution only, then
 * calls the requested api* function by explicit whitelist (never a raw
 * this[fnName] lookup). Every api* function is unchanged — they still
 * just call _requireRole_()/_callerRecord_(), which now resolve through
 * the verified override instead of (or in addition to) Session.getActiveUser().
 */
function apiCall(fnName, identityToken, args) {
  var fn = API_FUNCTIONS_[fnName];
  if (!fn) throw new Error('not-authorized: unknown function "' + fnName + '".');
  __ACTIVE_EMAIL_OVERRIDE__ = _verifyIdentityToken_(identityToken);
  try {
    return fn.apply(null, args || []);
  } finally {
    __ACTIVE_EMAIL_OVERRIDE__ = null;
  }
}

/**
 * _adminUsersMap_() — reads the Admin Users worksheet fresh every call
 * (short-lived per-request cache only) and returns
 * { email: { adminUserId, name, role, active } }. Never cached across
 * requests for longer than a few seconds — role changes must take effect
 * immediately, including deactivation.
 */
function _adminUsersMap_() {
  var ss = SpreadsheetApp.openById(STAGING_SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Admin Users');
  if (!sheet) throw new Error('_adminUsersMap_: Admin Users worksheet not found.');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var vals = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var map = {};
  for (var i = 0; i < vals.length; i++) {
    var email = String(vals[i][2] || '').trim().toLowerCase();
    if (!email) continue;
    map[email] = {
      adminUserId: String(vals[i][0] || ''),
      name:        String(vals[i][1] || ''),
      role:        String(vals[i][3] || ''),
      active:      String(vals[i][4] || '').trim().toLowerCase() === 'yes',
      rowNumber:   2 + i
    };
  }
  return map;
}

/** _callerRecord_() — looks up the signed-in Google user in Admin Users. */
function _callerRecord_() {
  var email = _activeEmail_();
  if (!email) return null;
  var rec = _adminUsersMap_()[email];
  if (!rec || !rec.active) return null;
  return { email: email, name: rec.name, role: rec.role, adminUserId: rec.adminUserId, rowNumber: rec.rowNumber };
}

/**
 * _requireRole_(minRole) — throws unless the signed-in user is active in
 * Admin Users with role rank >= minRole. NEVER trusts a role value sent
 * by the browser — the only input is Session.getActiveUser().
 */
function _requireRole_(minRole) {
  var rec = _callerRecord_();
  if (!rec) throw new Error('not-authorized: ' + (_activeEmail_() || '(no session)') + ' is not an active Admin User.');
  var haveRank = ROLE_RANK[rec.role] || 0;
  var needRank = ROLE_RANK[minRole] || 99;
  if (haveRank < needRank) {
    throw new Error('not-authorized: role "' + rec.role + '" does not meet the required "' + minRole + '" level.');
  }
  return rec;
}

function _requireAnyRole_() { return _requireRole_('Researcher'); }
function _requireOwner_()    { return _requireRole_('Owner'); }
function _requireAuthenticatorOrOwner_() { return _requireRole_('Authenticator'); }

// ─────────────────────────────────────────────────────────────────────────
// OUTPUT / HELPERS
// ─────────────────────────────────────────────────────────────────────────

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function _escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _nowUtc_() { return new Date().toISOString(); }
function _nowHst_()  { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss zzz'); }
function truncate_(s, n) {
  s = String(s == null ? '' : s);
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
function normalizeForCompare_(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd');
  return String(v).replace(/\s+$/, '').replace(/^\s+/, '');
}

/**
 * _sanitizeInput_(s, maxLen) — anti-spam / injection hardening for every
 * value that reaches a Sheet from the ANONYMOUS public submission path:
 *   - strips HTML tags (defense in depth; Sheets does not render HTML,
 *     but any downstream export must not carry raw tags),
 *   - neutralizes leading =+-@ so Sheets never treats a cell as a formula,
 *   - hard length cap.
 * Never trust client-side validation alone (Section 2 requirement).
 */
function _sanitizeInput_(s, maxLen) {
  var out = String(s == null ? '' : s);
  out = out.replace(/<[^>]*>/g, '');
  if (/^[=+\-@]/.test(out)) out = "'" + out;
  if (maxLen && out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/**
 * _rateLimitCheck_(bucketKey, maxPerHour) — simple per-key counter using
 * CacheService (6-hour max TTL; we roll a fresh hour bucket each call).
 * Not a substitute for a real WAF, but stops naive repeated-submit abuse
 * without needing an external service.
 */
function _rateLimitCheck_(bucketKey, maxPerHour) {
  var cache = CacheService.getScriptCache();
  var hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  var key = 'rl-' + bucketKey + '-' + hourBucket;
  var current = parseInt(cache.get(key) || '0', 10);
  if (current >= maxPerHour) return false;
  cache.put(key, String(current + 1), 3600);
  return true;
}

function _genId_(prefix) {
  var stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  var rand = Math.floor(Math.random() * 9000 + 1000);
  return prefix + '-' + stamp + '-' + rand;
}

// ─────────────────────────────────────────────────────────────────────────
// SHEET I/O HELPERS (shared by canonical worksheets + new audit tables)
// ─────────────────────────────────────────────────────────────────────────

function _headerMap_(sheet, headerRow) {
  var lastCol = sheet.getLastColumn();
  var vals = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] || [];
  var headers = {};
  for (var i = 0; i < vals.length; i++) {
    var h = String(vals[i] || '').trim();
    if (h) headers[h] = i + 1;
  }
  return headers;
}

/** _appendRowByHeader_(sheet, headerRow, obj) — writes one row using a
 * header-name → value object, so column order in the schema doc and the
 * literal Sheet column order never have to be kept in lockstep by hand. */
function _appendRowByHeader_(sheet, headerRow, obj) {
  var headers = _headerMap_(sheet, headerRow);
  var lastCol = sheet.getLastColumn();
  var row = new Array(lastCol).fill('');
  Object.keys(obj).forEach(function (k) {
    var col = headers[k];
    if (col) row[col - 1] = obj[k];
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function _readRowsAsObjects_(sheet, headerRow) {
  var headers = _headerMap_(sheet, headerRow);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= headerRow) return [];
  var vals = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
  var invHeaders = {};
  Object.keys(headers).forEach(function (h) { invHeaders[headers[h] - 1] = h; });
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var obj = { _rowNumber: headerRow + 1 + r };
    for (var c = 0; c < vals[r].length; c++) {
      var h = invHeaders[c];
      if (h) obj[h] = vals[r][c];
    }
    out.push(obj);
  }
  return out;
}

function _findRowObject_(sheet, headerRow, keyField, keyValue) {
  var rows = _readRowsAsObjects_(sheet, headerRow);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyField] || '').trim() === String(keyValue).trim()) return rows[i];
  }
  return null;
}

function _ss_() { return SpreadsheetApp.openById(STAGING_SPREADSHEET_ID); }

// ─────────────────────────────────────────────────────────────────────────
// CANONICAL FIELD VALIDATION + WRITE (reused by both direct-admin-edit and
// submission-apply paths so the same allowlist/rules govern every write)
// ─────────────────────────────────────────────────────────────────────────

function validateValue_(value, cfg) {
  if (value == null) return cfg.nullable === false ? { ok: false, reason: 'null-not-allowed' } : { ok: true, coerced: '' };
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
  if (cfg.type === 'url') {
    if (s === '') return { ok: true, coerced: '' };
    if (!/^https?:\/\//i.test(s)) return { ok: false, reason: 'url-must-start-with-http' };
    return { ok: true, coerced: s };
  }
  return { ok: false, reason: 'unknown-type' };
}

function _locateCanonicalRow_(sheet, wsCfg, scholarId, rowNumber) {
  var headerRow = wsCfg.headerRow || 1;
  var headers = _headerMap_(sheet, headerRow);
  var keyCol = headers[wsCfg.keyColumn];
  if (!keyCol) return { ok: false, reason: 'key-column-missing' };
  if (wsCfg.allowMultiRow) {
    var rn = parseInt(rowNumber, 10);
    if (!rn || rn <= headerRow) return { ok: false, reason: 'missing-or-bad-rowNumber' };
    var rowSid = String(sheet.getRange(rn, keyCol).getValue() || '').trim();
    if (rowSid !== String(scholarId).trim()) return { ok: false, reason: 'scholarId-does-not-match-rowNumber' };
    return { ok: true, row: rn, headers: headers };
  }
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return { ok: false, reason: 'no-data-rows' };
  var values = sheet.getRange(headerRow + 1, keyCol, lastRow - headerRow, 1).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0] || '').trim() === String(scholarId).trim()) return { ok: true, row: headerRow + 1 + r, headers: headers };
  }
  return { ok: false, reason: 'scholarId-not-found' };
}

/** _readCanonicalLiveValue_ — for concurrency checks: current live value of
 * one field on one scholar's row, independent of any submission/edit flow. */
function _readCanonicalLiveValue_(ws, scholarId, field, rowNumber) {
  var wsCfg = MAPPING.worksheets[ws];
  if (!wsCfg) return { ok: false, reason: 'worksheet-not-allowed' };
  var sheet = _ss_().getSheetByName(ws);
  if (!sheet) return { ok: false, reason: 'worksheet-not-found' };
  var loc = _locateCanonicalRow_(sheet, wsCfg, scholarId, rowNumber);
  if (!loc.ok) return loc;
  var col = loc.headers[field];
  if (!col) return { ok: false, reason: 'field-header-not-found' };
  var raw = sheet.getRange(loc.row, col).getValue();
  return { ok: true, row: loc.row, value: normalizeForCompare_(raw) };
}

/** _writeCanonicalValue_ — the ONLY function that mutates Scholars/
 * Positions/Graduate Degrees. Always call inside a lock. */
function _writeCanonicalValue_(ws, scholarId, field, newValue, rowNumber) {
  var wsCfg = MAPPING.worksheets[ws];
  var fieldCfg = wsCfg.fields[field];
  var validation = validateValue_(newValue, fieldCfg);
  if (!validation.ok) return { ok: false, reason: 'invalid-value: ' + validation.reason };
  var sheet = _ss_().getSheetByName(ws);
  var loc = _locateCanonicalRow_(sheet, wsCfg, scholarId, rowNumber);
  if (!loc.ok) return { ok: false, reason: loc.reason };
  var col = loc.headers[field];
  if (!col) return { ok: false, reason: 'field-header-not-found' };
  var before = normalizeForCompare_(sheet.getRange(loc.row, col).getValue());
  sheet.getRange(loc.row, col).setValue(validation.coerced);
  if (field === 'Last updated' || PUBLIC_FACING_FIELDS.indexOf(field) >= 0) {
    var lastUpdCol = loc.headers['Last updated'];
    if (lastUpdCol) sheet.getRange(loc.row, lastUpdCol).setValue(Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'));
  }
  return { ok: true, before: before, after: normalizeForCompare_(validation.coerced) };
}

// ─────────────────────────────────────────────────────────────────────────
// AUDIT LOGGING (component 6) + GOOGLE DOC SYNC (component 7)
// ─────────────────────────────────────────────────────────────────────────

/**
 * _appendAuditLog_ — the ONLY writer of Change Audit Log rows. Append-only;
 * no api* function ever updates or deletes a row here. Best-effort syncs
 * the human-readable Doc mirror and records the sync outcome in the same
 * row so a failed sync can be retried later without losing the database
 * change or the structured record.
 */
function _appendAuditLog_(opts) {
  var ss = _ss_();
  var sheet = ss.getSheetByName('Change Audit Log');
  var auditId = _genId_('AUD');
  var utc = _nowUtc_();
  var hst = _nowHst_();
  var row = {
    'Audit ID': auditId,
    'Scholar ID': opts.scholarId || '',
    'Submission ID (if applicable)': opts.submissionId || '',
    'Field Name': opts.field || '',
    'Old Value': opts.oldValue == null ? '' : String(opts.oldValue),
    'New Value': opts.newValue == null ? '' : String(opts.newValue),
    'Change Type': opts.changeType || 'edit',
    'Changed By Name': opts.actorName || '',
    'Changed By Email': opts.actorEmail || '',
    'Changed By Role': opts.actorRole || '',
    'Rationale/Note': opts.rationale || '',
    'UTC Timestamp': utc,
    'HST Timestamp': hst,
    'App/Deployment Version': APP_VERSION,
    'Reversal Of Audit ID': opts.reversalOf || '',
    'Doc Sync Status': 'pending'
  };
  var rowNum = _appendRowByHeader_(sheet, 1, row);
  var syncOk = _syncDocHistory_({
    scholarId: opts.scholarId, field: opts.field, oldValue: opts.oldValue, newValue: opts.newValue,
    actorEmail: opts.actorEmail, utc: utc, submissionId: opts.submissionId,
    changeType: opts.changeType, rationale: opts.rationale
  });
  sheet.getRange(rowNum, _headerMap_(sheet, 1)['Doc Sync Status']).setValue(syncOk ? 'synced' : 'failed-retry');
  return auditId;
}

/**
 * _syncDocHistory_ — appends a formatted paragraph to the Change History
 * Google Doc. Returns true/false; NEVER throws, because a Doc outage must
 * not block a database write or lose the structured audit row.
 */
function _syncDocHistory_(entry) {
  try {
    var doc = DocumentApp.openById(HISTORY_DOC_ID);
    var body = doc.getBody();
    var line = '[' + entry.utc + '] Scholar ' + entry.scholarId + ' — ' + entry.field +
      ': "' + truncate_(entry.oldValue, 200) + '" → "' + truncate_(entry.newValue, 200) + '" ' +
      '(by ' + entry.actorEmail + (entry.submissionId ? ', Submission ' + entry.submissionId : '') +
      (entry.rationale ? ', rationale: ' + truncate_(entry.rationale, 300) : '') + ')';
    body.appendParagraph(line);
    doc.saveAndClose();
    return true;
  } catch (e) {
    return false;
  }
}

/** apiRetryDocSync — Owner-only. Re-attempts every 'failed-retry' row. */
function apiRetryDocSync() {
  _requireOwner_();
  var ss = _ss_();
  var sheet = ss.getSheetByName('Change Audit Log');
  var headers = _headerMap_(sheet, 1);
  var rows = _readRowsAsObjects_(sheet, 1);
  var retried = 0, fixed = 0;
  rows.forEach(function (r) {
    if (r['Doc Sync Status'] !== 'failed-retry') return;
    retried++;
    var ok = _syncDocHistory_({
      scholarId: r['Scholar ID'], field: r['Field Name'], oldValue: r['Old Value'], newValue: r['New Value'],
      actorEmail: r['Changed By Email'], utc: r['UTC Timestamp'], submissionId: r['Submission ID (if applicable)'],
      rationale: r['Rationale/Note']
    });
    if (ok) { fixed++; sheet.getRange(r._rowNumber, headers['Doc Sync Status']).setValue('synced'); }
  });
  return { status: 'ok', retried: retried, fixed: fixed, serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────

/** doGet — serves either the identity broker (see IDENTITY_BROKER_PARAM
 * above for why this is now decided by a query parameter rather than by
 * inspecting which deployment URL was hit — the broker branch never
 * touches Sheet/Drive) or the admin app shell. The app shell is ALWAYS
 * rendered otherwise, even when Session.getActiveUser() can't yet
 * resolve the visitor — the client-side redirect+apiCall flow (see
 * tongan-staging-admin-controller.html; a top-level redirect to the
 * broker and back, not a popup — popups can't survive Google's own
 * OAuth consent screen's Cross-Origin-Opener-Policy) is what actually
 * determines and enforces the real role, independently of this initial
 * render. No scholar data is ever included in this render either way;
 * the app shell is empty markup until the client calls apiDescribe with
 * a verified identity token. */
function doGet(e) {
  var execUrl = ScriptApp.getService().getUrl(); // display/debug only now — never used for branching, see IDENTITY_BROKER_PARAM note
  if (e && e.parameter && e.parameter[IDENTITY_BROKER_PARAM] === '1') return _renderIdentityBrokerPage_();

  // Redeem a one-time identity code left by the broker (see
  // _renderIdentityBrokerPage_ below for why this replaced the URL-
  // fragment approach). CONFIRMED live via DevTools: the fragment landed
  // correctly in the TOP-LEVEL address bar after the broker's redirect,
  // but tongan-staging-admin-controller.html's own script never saw it —
  // Apps Script runs our page's JS inside its own sandboxed, cross-origin
  // (script.googleusercontent.com) iframe, and a cross-origin frame can
  // never read window.top.location (browsers block that read outright;
  // only a same-origin frame could see the fragment, and this one isn't).
  // A query parameter has no such problem: unlike a fragment, it's part
  // of the actual HTTP request, so THIS server-side doGet() call sees it
  // directly — no client-side cross-frame read required at all.
  var identityFromCode = null;
  if (e && e.parameter && e.parameter.identitycode) {
    var identityCache = CacheService.getScriptCache();
    var identityCacheKey = 'identitycode:' + e.parameter.identitycode;
    var identityRaw = identityCache.get(identityCacheKey);
    if (identityRaw) {
      identityCache.remove(identityCacheKey); // one-time use — a revisited/bookmarked URL must not redeem it again
      try { identityFromCode = JSON.parse(identityRaw); } catch (identityParseErr) { identityFromCode = null; }
    }
  }

  // Defensive: if this exec URL is ever visited directly without the
  // broker query param (stale bookmark/browser history, etc.), this runs
  // under whichever deployment served it — which, for the broker
  // deployment's "Execute as: User accessing the web app" mode, means
  // _adminUsersMap_() below tries to open the private Master Sheet AS
  // THE VISITOR, who has no direct access, and throws an uncaught
  // permission exception (confirmed live: "You do not have permission to
  // access the requested document"). That's a safe failure (no data
  // exposed either way) but an ugly native Apps Script error page.
  // Swallow it here and fall back to the normal unauthenticated-shell
  // render — the identity gate will still correctly require the visitor
  // to go through Verify with Google before anything loads.
  var rec;
  try { rec = _callerRecord_(); } catch (permErr) { rec = null; } // fast path only — works when Session.getActiveUser() already resolves (e.g. the Owner's own account)
  var tmpl = HtmlService.createTemplateFromFile('tongan-staging-admin-app');
  tmpl.activeEmail = rec ? rec.email : '';
  tmpl.activeName  = rec ? rec.name  : '';
  tmpl.activeRole  = rec ? rec.role  : '';
  tmpl.spreadsheetId = STAGING_SPREADSHEET_ID;
  tmpl.appVersion = APP_VERSION;
  tmpl.execUrl = execUrl;
  tmpl.brokerUrl = BROKER_DEPLOYMENT_URL + '?' + IDENTITY_BROKER_PARAM + '=1';
  tmpl.serverIdentityJson = identityFromCode ? JSON.stringify(identityFromCode) : 'null';
  return tmpl.evaluate()
    .setTitle('Tongan Scholar Database — Admin (STAGING)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** _renderIdentityBrokerPage_() — reached ONLY via the second deployment
 * ("Execute as: User accessing the web app"), so Session.getActiveUser()
 * here reflects the real visitor for ANY Google account. Touches no
 * Sheet/Drive data at all.
 *
 * IMPORTANT DESIGN NOTE (post popup-hang bug): this used to open as a
 * popup and postMessage back to window.opener. That broke in practice —
 * once the visitor passes through Google's own accounts.google.com
 * OAuth/consent pages, Google applies Cross-Origin-Opener-Policy, which
 * severs window.opener from the popup. The popup then can neither
 * postMessage back nor close itself, and the user is stuck on "Verifying
 * your Google identity... this window will close automatically."
 * forever. There is no COOP workaround for a popup here.
 *
 * Fix: no popup at all. This is now a single TOP-LEVEL redirect round
 * trip. The main app sends the visitor's own tab here; this page signs
 * the identity, stores it server-side under a short-lived one-time code
 * (CacheService, keyed by a random UUID, 2-minute TTL), and redirects the
 * SAME tab back to MAIN_DEPLOYMENT_URL with only that code in a query
 * parameter (?identitycode=...).
 *
 * SUPERSEDES an earlier version of this function that put the signed
 * payload directly in a URL fragment ("#identity=...") instead. CONFIRMED
 * live via DevTools: the fragment did land correctly in the top-level
 * address bar, but the main app's own script could never read it, because
 * Apps Script runs each page's JS inside its own sandboxed, cross-origin
 * (script.googleusercontent.com) iframe — and a cross-origin frame can
 * never read window.top.location; browsers block that outright regardless
 * of any redirect timing/gesture fix. A query parameter has no such
 * problem: it travels to the server as part of the real HTTP request, so
 * doGet() on the main deployment can read it directly and embed the
 * result into the page it renders — no client-side cross-frame read of
 * any kind is required. The code is single-use (removed from the cache
 * the moment doGet() redeems it), so a bookmarked or revisited URL
 * containing a stale ?identitycode=... cannot be replayed. */
function _renderIdentityBrokerPage_() {
  var email = _rawSessionEmail_();
  var payload = email
    ? { status: 'ok', email: email, token: _signIdentity_(email) }
    : { status: 'error', error: 'no-session' };
  var identityCode = Utilities.getUuid();
  CacheService.getScriptCache().put('identitycode:' + identityCode, JSON.stringify(payload), 120); // 2-minute TTL — this round trip should take a few seconds
  var dest = MAIN_DEPLOYMENT_URL + '?identitycode=' + encodeURIComponent(identityCode);
  // CONFIRMED live via browser DevTools console: Apps Script serves this
  // page inside a sandboxed frame (sandbox="...allow-top-navigation-by-
  // user-activation...") whose content lives on a
  // script.googleusercontent.com content domain, distinct from the
  // script.google.com top-level wrapper the address bar shows. That
  // sandbox flag permits navigating window.top ONLY while handling a
  // genuine user gesture (a real click) — never from a script that fires
  // automatically on page load. An automatic redirect here throws exactly:
  //   SecurityError: Failed to execute 'replace' on 'Location': The
  //   current window does not have permission to navigate the target
  //   frame...
  // silently, with the page just sitting on "Verifying\u2026" forever and
  // no visible error — which is exactly what was observed live. This is
  // also exactly why the outbound "Verify with Google" button already
  // works: it navigates window.top from inside a real click handler,
  // which the sandbox permits. Fix: do the same thing on the way back —
  // require one click here too, instead of trying to auto-redirect.
  var html = '<!doctype html><html><head><meta charset="utf-8"/><title>Verified</title></head><body>' +
    '<div style="font-family:system-ui,sans-serif;max-width:420px;margin:64px auto;text-align:center;">' +
    '<p style="color:#333;">Your Google identity has been verified.</p>' +
    '<button id="continueBtn" style="background:#0a6b5c;color:#fff;border:none;padding:12px 28px;border-radius:6px;font-size:1rem;cursor:pointer;">Continue to Tongan Admin</button>' +
    '<p id="autoNote" style="color:#888;font-size:0.85rem;margin-top:14px;">Taking you back automatically\u2026</p>' +
    '</div>' +
    '<script>\n' +
    '(function(){\n' +
    '  var dest = ' + JSON.stringify(dest) + ';\n' +
    '  function go(){ try { (window.top || window).location.href = dest; } catch (e) {} }\n' +
    '  document.getElementById("continueBtn").addEventListener("click", go);\n' +
    '  try { (window.top || window).location.replace(dest); } catch (e) {\n' +
    '    var note = document.getElementById("autoNote");\n' +
    '    if (note) note.textContent = "Click Continue above to finish.";\n' +
    '  }\n' +
    '})();\n' +
    '</script>' +
    '<noscript><a href=' + JSON.stringify(dest) + '>Continue</a></noscript>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Verified');
}

/**
 * doPost — PUBLIC, ANONYMOUS entry point for the "Update info" correction
 * form only. This is a deliberate, narrow re-purposing of doPost (the old
 * HMAC contract that used to return HTTP 410 here is retired and does not
 * come back) — it accepts exactly one action, `submitPublicUpdate`, and
 * every other action or malformed body is rejected. No scholar data is
 * ever returned by this endpoint; it only ever writes to the quarantine/
 * review tables and returns a Submission ID.
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.action !== 'submitPublicUpdate') {
      return jsonOut_({ status: 'rejected', error: 'unsupported-action' });
    }
    return jsonOut_(_handlePublicSubmission_(body));
  } catch (err) {
    return jsonOut_({ status: 'error', error: 'bad-request: ' + err.message });
  }
}

function _renderNotAuthorized_(actual, execUrl) {
  var signOutHref = _googleSignOutUrl_(execUrl);
  var b = '<!doctype html><html><head><meta charset="utf-8"/><title>Not authorised — Tongan Admin (Staging)</title>' +
    '<style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:640px;margin:auto;color:#111;}' +
    'code{background:#f4f4f4;padding:2px 6px;border-radius:4px;} a.switch{color:#0a5;text-decoration:underline;}</style></head><body>' +
    '<h1>Not authorised</h1>' +
    '<p>This staging admin is restricted to approved Google accounts listed in Admin Users. You are signed in as ' +
    '<code>' + _escapeHtml_(actual || '(not signed in)') + '</code>.</p>' +
    '<p>If you believe you should have access, ask the Owner to add your exact Google account email in Admin Users.</p>' +
    (signOutHref ? '<p><a class="switch" href="' + _escapeHtml_(signOutHref) + '">Sign out and try a different Google account</a></p>' : '') +
    '</body></html>';
  return HtmlService.createHtmlOutput(b).setTitle('Not authorised');
}

/** _googleSignOutUrl_(execUrl) — fully signs the browser out of Google,
 * then redirects back into a sign-in flow for this deployment's exec URL.
 * Needed because Apps Script web apps have no app-level session of their
 * own to log out of; the only way to test/act as a different Google
 * account is to actually sign out of the Google account currently active
 * in that browser. Signing out here affects ALL Google services in that
 * browser tab's session, not just this app — the UI must warn about that
 * before sending the user here (see the confirm() in the client JS). */
function _googleSignOutUrl_(execUrl) {
  if (!execUrl) return '';
  var serviceLogin = 'https://accounts.google.com/ServiceLogin?continue=' + encodeURIComponent(execUrl);
  return 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(serviceLogin);
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 2+3 — PUBLIC SUBMISSION + SECURE QUARANTINE
// ─────────────────────────────────────────────────────────────────────────

function _handlePublicSubmission_(body) {
  var scholarId = _sanitizeInput_(body.scholarId, 40);
  if (!scholarId) return { status: 'rejected', error: 'missing-scholarId' };

  // Honeypot: legit browsers never fill this hidden field.
  if (body.hp) return { status: 'rejected', error: 'spam-detected' };

  if (!_rateLimitCheck_('sub-' + scholarId, 5)) {
    return { status: 'rejected', error: 'rate-limited', retryAfter: '1 hour' };
  }

  var submitterName  = _sanitizeInput_(body.submitterName, 120);
  var submitterEmail = _sanitizeInput_(body.submitterEmail, 200);
  var relationship   = _sanitizeInput_(body.relationship, 200);
  if (!submitterName || !submitterEmail || !relationship) {
    return { status: 'rejected', error: 'missing-required-submitter-fields' };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(submitterEmail)) {
    return { status: 'rejected', error: 'invalid-email' };
  }

  var ss = _ss_();
  var scholarSheet = ss.getSheetByName('Scholars');
  var scholarRow = _findRowObject_(scholarSheet, 4, 'Scholar ID', scholarId);
  if (!scholarRow) return { status: 'rejected', error: 'scholar-not-found' };
  var scholarName = String(scholarRow['Scholar Name'] || (scholarRow['Given Names'] + ' ' + scholarRow['Family Name'])).trim();

  // Immutable snapshot of currently-PUBLIC values only.
  var snapshot = {};
  PUBLIC_VISIBLE_FIELDS['Scholars'].forEach(function (f) { snapshot[f] = scholarRow[f] == null ? '' : String(scholarRow[f]); });

  var proposedFields = body.fields || {};
  var changedFieldNames = Object.keys(proposedFields).filter(function (f) {
    return PUBLIC_VISIBLE_FIELDS['Scholars'].indexOf(f) >= 0;
  });
  if (!changedFieldNames.length && (!body.files || !body.files.length)) {
    return { status: 'rejected', error: 'no-proposed-changes' };
  }

  var submissionId = _genId_('SUB');
  var utc = _nowUtc_(), hst = _nowHst_();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { status: 'busy', error: 'lock-timeout' };
  var fieldChangeCount = 0;
  try {
    var subsSheet = ss.getSheetByName('Public Update Submissions');
    _appendRowByHeader_(subsSheet, 1, {
      'Submission ID': submissionId,
      'Scholar ID': scholarId,
      'Scholar Name (at submission)': scholarName,
      'Submitter Name (claimed)': submitterName,
      'Submitter Email (claimed)': submitterEmail,
      'Relationship to Scholar': relationship,
      'Submitted Date/Time (UTC)': utc,
      'Submitted Date/Time (HST)': hst,
      'Snapshot JSON (public values at submission)': JSON.stringify(snapshot),
      'Fields Changed Count': changedFieldNames.length,
      'Overall Status': 'Pending',
      'Assigned Authenticator Email': '',
      'Second Review Requested?': 'No',
      'Notes': _sanitizeInput_(body.note, 1000)
    });

    var changesSheet = ss.getSheetByName('Submission Field Changes');
    changedFieldNames.forEach(function (f) {
      var proposed = _sanitizeInput_(proposedFields[f], 2000);
      var snapVal = snapshot[f] || '';
      var differs = normalizeForCompare_(proposed) !== normalizeForCompare_(snapVal);
      fieldChangeCount++;
      _appendRowByHeader_(changesSheet, 1, {
        'Change Row ID': _genId_('CHG'),
        'Submission ID': submissionId,
        'Scholar ID': scholarId,
        'Field Name': f,
        'Original Snapshot Value': snapVal,
        'Proposed Value': proposed,
        'Differs From Snapshot?': differs ? 'Yes' : 'No',
        'Field Decision': 'Pending'
      });
    });

    if (body.files && body.files.length) {
      var filesSheet = ss.getSheetByName('Uploaded Submission Files');
      var qFolder = DriveApp.getFolderById(QUARANTINE_FOLDER_ID);
      body.files.slice(0, 3).forEach(function (f) { // cap 3 files/submission
        if (!f.base64 || !f.filename) return;
        var mime = String(f.mimeType || '').toLowerCase();
        var allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (allowed.indexOf(mime) < 0) return; // silently skip disallowed types
        var bytes = Utilities.base64Decode(f.base64);
        if (bytes.length > 8 * 1024 * 1024) return; // 8MB cap
        var blob = Utilities.newBlob(bytes, mime, _sanitizeInput_(f.filename, 150));
        var driveFile = qFolder.createFile(blob);
        _appendRowByHeader_(filesSheet, 1, {
          'File ID': _genId_('FIL'),
          'Submission ID': submissionId,
          'Scholar ID': scholarId,
          'File Type': f.fileType === 'photo' ? 'Photo' : 'Bibliography',
          'Original Filename': f.filename,
          'Quarantine Drive File ID': driveFile.getId(),
          'Quarantine Folder': 'Tongan Submission Uploads (Quarantine)',
          'File Size (bytes)': bytes.length,
          'MIME Type': mime,
          'Uploaded Date (UTC)': utc,
          'Approved?': 'No'
        });
      });
    }
  } finally {
    lock.releaseLock();
  }

  return { status: 'ok', submissionId: submissionId, fieldsRecorded: fieldChangeCount, serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 4+5 — FOR REVIEW QUEUE + SIDE-BY-SIDE + PARTIAL APPROVAL
// ─────────────────────────────────────────────────────────────────────────

/** apiListSubmissionQueue(filters) — default oldest-first; filters never
 * change that default ordering, only narrow the set. */
function apiListSubmissionQueue(filters) {
  _requireAuthenticatorOrOwner_();
  filters = filters || {};
  var ss = _ss_();
  var rows = _readRowsAsObjects_(ss.getSheetByName('Public Update Submissions'), 1);
  var secondReviewRows = _readRowsAsObjects_(ss.getSheetByName('Second Review Requests'), 1);
  var secondReviewBySub = {};
  secondReviewRows.forEach(function (r) { secondReviewBySub[r['Case ID or Submission ID']] = r; });

  var out = rows.filter(function (r) {
    if (filters.status && r['Overall Status'] !== filters.status) return false;
    if (filters.scholarId && r['Scholar ID'] !== filters.scholarId) return false;
    if (filters.submitterEmail && r['Submitter Email (claimed)'] !== filters.submitterEmail) return false;
    if (filters.assignedAuthenticator && r['Assigned Authenticator Email'] !== filters.assignedAuthenticator) return false;
    return true;
  }).map(function (r) {
    return {
      submissionId: r['Submission ID'],
      scholarId: r['Scholar ID'],
      scholarName: r['Scholar Name (at submission)'],
      submittedUtc: r['Submitted Date/Time (UTC)'],
      submitterName: r['Submitter Name (claimed)'],
      submitterEmail: r['Submitter Email (claimed)'],
      relationship: r['Relationship to Scholar'],
      fieldsChangedCount: r['Fields Changed Count'],
      assignedAuthenticator: r['Assigned Authenticator Email'],
      status: r['Overall Status'],
      secondReviewRequested: !!secondReviewBySub[r['Submission ID']]
    };
  });
  // Default oldest-first by submission UTC timestamp.
  out.sort(function (a, b) { return String(a.submittedUtc).localeCompare(String(b.submittedUtc)); });
  return { status: 'ok', submissions: out, serverTs: Date.now() };
}

/** apiGetSubmissionDetail — side-by-side: snapshot vs proposed vs LIVE
 * (current) value, with a conflict flag when live has moved since
 * submission. */
function apiGetSubmissionDetail(submissionId) {
  _requireAuthenticatorOrOwner_();
  var ss = _ss_();
  var sub = _findRowObject_(ss.getSheetByName('Public Update Submissions'), 1, 'Submission ID', submissionId);
  if (!sub) throw new Error('apiGetSubmissionDetail: submission not found.');
  var changes = _readRowsAsObjects_(ss.getSheetByName('Submission Field Changes'), 1)
    .filter(function (r) { return r['Submission ID'] === submissionId; });

  var fields = changes.map(function (c) {
    var live = _readCanonicalLiveValue_('Scholars', sub['Scholar ID'], c['Field Name'], null);
    var liveValue = live.ok ? live.value : c['Original Snapshot Value'];
    var alreadyApplied = c['Applied To Live?'] === 'Yes';
    // Staleness/concurrency warning is only meaningful BEFORE this field has
    // been applied. After a successful apply, the live value is EXPECTED to
    // differ from the original submission-time snapshot (that's the point of
    // applying it) -- comparing against the snapshot post-apply would flag
    // every successfully-applied field as a false conflict forever. Once
    // applied, only flag a conflict if the live value has since drifted away
    // from what we actually wrote (i.e. something changed it again after us).
    var conflict = !live.ok ? false :
      (alreadyApplied
        ? normalizeForCompare_(liveValue) !== normalizeForCompare_(c['Proposed Value'])
        : normalizeForCompare_(liveValue) !== normalizeForCompare_(c['Original Snapshot Value']));
    return {
      changeRowId: c['Change Row ID'],
      field: c['Field Name'],
      snapshotValue: c['Original Snapshot Value'],
      proposedValue: c['Proposed Value'],
      liveValue: liveValue,
      differsFromSnapshot: c['Differs From Snapshot?'] === 'Yes',
      appliedToLive: alreadyApplied,
      conflict: conflict,
      decision: c['Field Decision'] || 'Pending',
      reviewNote: c['Field Review Note'] || ''
    };
  });

  var files = _readRowsAsObjects_(ss.getSheetByName('Uploaded Submission Files'), 1)
    .filter(function (r) { return r['Submission ID'] === submissionId; })
    .map(function (f) { return { fileId: f['File ID'], fileType: f['File Type'], filename: f['Original Filename'], approved: f['Approved?'] === 'Yes' }; });

  return {
    status: 'ok',
    submission: {
      submissionId: sub['Submission ID'], scholarId: sub['Scholar ID'], scholarName: sub['Scholar Name (at submission)'],
      submitterName: sub['Submitter Name (claimed)'], submitterEmail: sub['Submitter Email (claimed)'],
      relationship: sub['Relationship to Scholar'], submittedUtc: sub['Submitted Date/Time (UTC)'],
      overallStatus: sub['Overall Status'], notes: sub['Notes']
    },
    fields: fields, files: files, serverTs: Date.now()
  };
}

/** apiSaveFieldDecisions — records per-field Approve/Reject/Return + notes
 * WITHOUT writing to canonical tables yet (that only happens in
 * apiApplySubmissionDecisions, after explicit confirmation). */
function apiSaveFieldDecisions(submissionId, decisions) {
  var caller = _requireAuthenticatorOrOwner_();
  var ss = _ss_();
  var sheet = ss.getSheetByName('Submission Field Changes');
  var headers = _headerMap_(sheet, 1);
  var rows = _readRowsAsObjects_(sheet, 1).filter(function (r) { return r['Submission ID'] === submissionId; });
  (decisions || []).forEach(function (d) {
    var row = rows.filter(function (r) { return r['Change Row ID'] === d.changeRowId; })[0];
    if (!row) return;
    if (['Approve', 'Reject', 'Return for clarification', 'Pending'].indexOf(d.decision) < 0) return;
    sheet.getRange(row._rowNumber, headers['Field Decision']).setValue(d.decision);
    sheet.getRange(row._rowNumber, headers['Field Review Note']).setValue(_sanitizeInput_(d.note || '', 500));
    sheet.getRange(row._rowNumber, headers['Reviewed By']).setValue(caller.email);
    sheet.getRange(row._rowNumber, headers['Reviewed Date/Time (UTC)']).setValue(_nowUtc_());
  });
  return { status: 'ok', serverTs: Date.now() };
}

/**
 * apiApplySubmissionDecisions — the "Apply approved changes" button.
 * Re-checks authorization + concurrency per field, writes ONLY approved,
 * non-conflicting fields, and sets the resulting overall submission
 * status. Never triggers publishing.
 */
function apiApplySubmissionDecisions(submissionId, confirm) {
  var caller = _requireAuthenticatorOrOwner_();
  if (confirm !== true) return { status: 'rejected', error: 'confirmation-required' };

  var ss = _ss_();
  var subSheet = ss.getSheetByName('Public Update Submissions');
  var sub = _findRowObject_(subSheet, 1, 'Submission ID', submissionId);
  if (!sub) throw new Error('apiApplySubmissionDecisions: submission not found.');

  var changesSheet = ss.getSheetByName('Submission Field Changes');
  var changeHeaders = _headerMap_(changesSheet, 1);
  var changes = _readRowsAsObjects_(changesSheet, 1).filter(function (r) { return r['Submission ID'] === submissionId; });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { status: 'busy', error: 'lock-timeout' };

  var counts = { approved: 0, rejected: 0, returned: 0, appliedOk: 0, conflictBlocked: 0 };
  var anyPublicFieldChanged = false;
  try {
    changes.forEach(function (c) {
      if (c['Field Decision'] === 'Reject') { counts.rejected++; return; }
      if (c['Field Decision'] === 'Return for clarification') { counts.returned++; return; }
      if (c['Field Decision'] !== 'Approve') return; // unresolved/pending — never applied
      counts.approved++;

      var live = _readCanonicalLiveValue_('Scholars', sub['Scholar ID'], c['Field Name'], null);
      var conflict = live.ok && normalizeForCompare_(live.value) !== normalizeForCompare_(c['Original Snapshot Value']);
      if (conflict) {
        counts.conflictBlocked++;
        changesSheet.getRange(c._rowNumber, changeHeaders['Conflict Detected?']).setValue('Yes');
        return; // never silently overwrite a newer database value
      }
      var write = _writeCanonicalValue_('Scholars', sub['Scholar ID'], c['Field Name'], c['Proposed Value'], null);
      if (!write.ok) { counts.conflictBlocked++; return; }
      counts.appliedOk++;
      if (PUBLIC_FACING_FIELDS.indexOf(c['Field Name']) >= 0) anyPublicFieldChanged = true;
      changesSheet.getRange(c._rowNumber, changeHeaders['Applied To Live?']).setValue('Yes');
      changesSheet.getRange(c._rowNumber, changeHeaders['Applied Date/Time (UTC)']).setValue(_nowUtc_());
      _appendAuditLog_({
        scholarId: sub['Scholar ID'], submissionId: submissionId, field: c['Field Name'],
        oldValue: write.before, newValue: write.after, changeType: 'submission-apply',
        actorEmail: caller.email, actorName: caller.name, actorRole: caller.role,
        rationale: 'Applied from public submission ' + submissionId
      });
    });

    var overall;
    var totalFields = changes.length;
    if (counts.appliedOk === totalFields && totalFields > 0) overall = 'Fully approved';
    else if (counts.appliedOk > 0) overall = 'Partially approved';
    // A field can only be conflict-blocked if it was Approved, so this can
    // coexist with Rejected/Returned fields on other rows in the same
    // submission -- surface it ahead of those, since an un-applied conflict
    // needs the reviewer's attention and must never be reported under the
    // same label as a real partial-approval (which implies some field WAS
    // written to live data; here appliedOk is 0).
    else if (counts.conflictBlocked > 0) overall = 'Conflict — needs re-review';
    else if (counts.rejected === totalFields && totalFields > 0) overall = 'Rejected';
    else if (counts.returned > 0 && counts.appliedOk === 0) overall = 'Returned for clarification';
    else overall = 'Partially approved';

    var subHeaders = _headerMap_(subSheet, 1);
    subSheet.getRange(sub._rowNumber, subHeaders['Overall Status']).setValue(overall);
    subSheet.getRange(sub._rowNumber, subHeaders['Applied Date/Time (UTC)']).setValue(_nowUtc_());
    subSheet.getRange(sub._rowNumber, subHeaders['Applied By']).setValue(caller.email);

    var reviewSheet = ss.getSheetByName('Submission Reviews');
    _appendRowByHeader_(reviewSheet, 1, {
      'Review ID': _genId_('REV'), 'Submission ID': submissionId,
      'Reviewer Name': caller.name, 'Reviewer Email': caller.email, 'Reviewer Role': caller.role,
      'Review Action': 'Apply approved changes',
      'Fields Approved Count': counts.appliedOk, 'Fields Rejected Count': counts.rejected, 'Fields Returned Count': counts.returned,
      'Concurrency Check Result': counts.conflictBlocked > 0 ? (counts.conflictBlocked + ' field(s) conflicted and were skipped') : 'no conflicts',
      'Review Date/Time (UTC)': _nowUtc_(), 'Review Date/Time (HST)': _nowHst_(),
      'App/Deployment Version': APP_VERSION, 'Resulting Submission Status': overall
    });
  } finally {
    lock.releaseLock();
  }

  return { status: 'ok', counts: counts, publicFieldChanged: anyPublicFieldChanged, serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 8 — SECOND-AUTHENTICATOR REQUESTS (optional, ordinary reviews)
// ─────────────────────────────────────────────────────────────────────────

function apiRequestSecondReview(caseOrSubmissionId, targetEmailOrOpen) {
  var caller = _requireAuthenticatorOrOwner_();
  var ss = _ss_();
  var sheet = ss.getSheetByName('Second Review Requests');
  var open = !targetEmailOrOpen || targetEmailOrOpen === 'OPEN';
  var requestId = _genId_('SRR');
  _appendRowByHeader_(sheet, 1, {
    'Request ID': requestId, 'Case ID or Submission ID': caseOrSubmissionId,
    'Requested By (Authenticator 1)': caller.email, 'Requested Date (UTC)': _nowUtc_(),
    'Assigned To (Authenticator 2 or Open)': open ? 'OPEN' : targetEmailOrOpen,
    'Is Open To Any Eligible Authenticator?': open ? 'Yes' : 'No', 'Status': 'Open'
  });
  // Flag on the parent submission if it is one.
  var subSheet = ss.getSheetByName('Public Update Submissions');
  var sub = _findRowObject_(subSheet, 1, 'Submission ID', caseOrSubmissionId);
  if (sub) subSheet.getRange(sub._rowNumber, _headerMap_(subSheet, 1)['Second Review Requested?']).setValue('Yes');
  return { status: 'ok', requestId: requestId, serverTs: Date.now() };
}

function apiSubmitSecondReview(requestId, decision, rationale) {
  var caller = _requireAuthenticatorOrOwner_();
  var ss = _ss_();
  var sheet = ss.getSheetByName('Second Review Requests');
  var req = _findRowObject_(sheet, 1, 'Request ID', requestId);
  if (!req) throw new Error('apiSubmitSecondReview: request not found.');
  if (String(req['Requested By (Authenticator 1)']).toLowerCase() === caller.email) {
    throw new Error('not-authorized: the second Authenticator must be a different account from the first reviewer.');
  }
  var assigned = String(req['Assigned To (Authenticator 2 or Open)'] || '');
  if (assigned !== 'OPEN' && assigned.toLowerCase() !== caller.email) {
    throw new Error('not-authorized: this second-review request is assigned to a specific Authenticator.');
  }
  var headers = _headerMap_(sheet, 1);
  sheet.getRange(req._rowNumber, headers['Second Authenticator Decision']).setValue(decision);
  sheet.getRange(req._rowNumber, headers['Second Authenticator Rationale']).setValue(_sanitizeInput_(rationale || '', 1000));
  sheet.getRange(req._rowNumber, headers['Second Review Date (UTC)']).setValue(_nowUtc_());
  sheet.getRange(req._rowNumber, headers['Status']).setValue('Completed');
  return { status: 'ok', serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 9 — INDIGENOUS TONGAN IDENTITY WORKFLOW (dual-authenticator)
// ─────────────────────────────────────────────────────────────────────────

var WEAK_PROXY_KEYWORDS = ['surname', 'name resemblance', 'sounds tongan', 'looks tongan', 'appearance', 'village association only', 'institution only', 'topic only'];

function apiOpenIdentityCase(scholarId) {
  var caller = _requireAnyRole_(); // Researchers may open a case for evidence-gathering
  var ss = _ss_();
  var sheet = ss.getSheetByName('Identity Authentication');
  var existing = _readRowsAsObjects_(sheet, 1).filter(function (r) { return r['Scholar ID'] === scholarId && r['Current Status'] !== 'Superseded'; });
  if (existing.length) return { status: 'ok', caseId: existing[0]['Case ID'], alreadyOpen: true };
  var scholarSheet = ss.getSheetByName('Scholars');
  var scholarRow = _findRowObject_(scholarSheet, 4, 'Scholar ID', scholarId);
  if (!scholarRow) throw new Error('apiOpenIdentityCase: scholar not found.');
  var caseId = _genId_('IDC');
  _appendRowByHeader_(sheet, 1, {
    'Case ID': caseId, 'Scholar ID': scholarId, 'Scholar Name': scholarRow['Scholar Name'] || '',
    'Current Status': 'Candidate', 'Status Since (UTC)': _nowUtc_(),
    'Dual Authentication Required?': 'Yes', 'Opened Date (UTC)': _nowUtc_(), 'Opened By': caller.email
  });
  _appendStatusHistory_(caseId, scholarId, '', 'Candidate', caller);
  return { status: 'ok', caseId: caseId, alreadyOpen: false };
}

function _appendStatusHistory_(caseId, scholarId, prevStatus, newStatus, caller, rationale) {
  var sheet = _ss_().getSheetByName('Identity Status History');
  _appendRowByHeader_(sheet, 1, {
    'History ID': _genId_('HIS'), 'Case ID': caseId, 'Scholar ID': scholarId,
    'Previous Status': prevStatus, 'New Status': newStatus,
    'Changed By Name': caller.name, 'Changed By Email': caller.email, 'Changed By Role': caller.role,
    'Rationale': rationale || '', 'UTC Timestamp': _nowUtc_(), 'HST Timestamp': _nowHst_(),
    'App/Deployment Version': APP_VERSION
  });
}

/** apiAddIdentityEvidence — any active role may add evidence; explicit
 * weak-proxy check flags (does not silently accept) suspicious evidence
 * types so a reviewer decides, rather than the system inferring identity. */
function apiAddIdentityEvidence(caseId, scholarId, evidence) {
  var caller = _requireAnyRole_();
  var desc = _sanitizeInput_(evidence.description, 2000);
  var lowerDesc = desc.toLowerCase();
  var flagged = WEAK_PROXY_KEYWORDS.some(function (k) { return lowerDesc.indexOf(k) >= 0; });
  var sheet = _ss_().getSheetByName('Identity Evidence');
  var evidenceId = _genId_('EVD');
  _appendRowByHeader_(sheet, 1, {
    'Evidence ID': evidenceId, 'Case ID': caseId, 'Scholar ID': scholarId,
    'Evidence Type': _sanitizeInput_(evidence.type, 100), 'Evidence Description': desc,
    'Source URL': _sanitizeInput_(evidence.sourceUrl, 500), 'Source Context': _sanitizeInput_(evidence.context, 1000),
    'Submitted By Name': caller.name, 'Submitted By Email/Role': caller.email + ' (' + caller.role + ')',
    'Date Added (UTC)': _nowUtc_(),
    'Weak-Proxy Flag Check': flagged ? 'FLAGGED — review before relying on this evidence' : 'no flag'
  });
  return { status: 'ok', evidenceId: evidenceId, weakProxyFlagged: flagged, serverTs: Date.now() };
}

/** apiChangeIdentityCaseStatus — for every status EXCEPT the two dual-auth
 * outcomes, a single Authenticator/Owner may set status directly. */
function apiChangeIdentityCaseStatus(caseId, newStatus, rationale) {
  var caller = _requireAuthenticatorOrOwner_();
  if (DUAL_AUTH_OUTCOMES.indexOf(newStatus) >= 0) {
    throw new Error('use apiSubmitIdentityDecision for "' + newStatus + '" — it requires two distinct approvers.');
  }
  if (IDENTITY_STATUSES.indexOf(newStatus) < 0) throw new Error('unknown identity status: ' + newStatus);
  var sheet = _ss_().getSheetByName('Identity Authentication');
  var headers = _headerMap_(sheet, 1);
  var caseRow = _findRowObject_(sheet, 1, 'Case ID', caseId);
  if (!caseRow) throw new Error('apiChangeIdentityCaseStatus: case not found.');
  var prev = caseRow['Current Status'];
  sheet.getRange(caseRow._rowNumber, headers['Current Status']).setValue(newStatus);
  sheet.getRange(caseRow._rowNumber, headers['Status Since (UTC)']).setValue(_nowUtc_());
  sheet.getRange(caseRow._rowNumber, headers['Last Updated (UTC)']).setValue(_nowUtc_());
  _appendStatusHistory_(caseId, caseRow['Scholar ID'], prev, newStatus, caller, rationale);
  return { status: 'ok', serverTs: Date.now() };
}

/**
 * apiSubmitIdentityDecision — REQUIRED dual authentication for
 * Verified/Rejected outcomes. First call records Authenticator 1's
 * decision as a draft; a second call from a DIFFERENT Owner/Authenticator
 * account with a MATCHING outcome finalizes it and writes the canonical
 * identity status. A different outcome from the second reviewer is a
 * conflict, escalated to the Owner rather than silently resolved.
 */
function apiSubmitIdentityDecision(caseId, outcome, rationale) {
  var caller = _requireAuthenticatorOrOwner_(); // Researchers can never be final approvers
  if (DUAL_AUTH_OUTCOMES.indexOf(outcome) < 0) throw new Error('apiSubmitIdentityDecision: outcome must be one of ' + DUAL_AUTH_OUTCOMES.join(', '));

  var ss = _ss_();
  var decSheet = ss.getSheetByName('Identity Decisions');
  var decHeaders = _headerMap_(decSheet, 1);
  var caseSheet = ss.getSheetByName('Identity Authentication');
  var caseRow = _findRowObject_(caseSheet, 1, 'Case ID', caseId);
  if (!caseRow) throw new Error('apiSubmitIdentityDecision: case not found.');

  var openDraft = _readRowsAsObjects_(decSheet, 1)
    .filter(function (r) { return r['Case ID'] === caseId && !r['Final Decision Date (UTC)']; })
    .pop();

  if (!openDraft) {
    var decisionId = _genId_('DEC');
    _appendRowByHeader_(decSheet, 1, {
      'Decision ID': decisionId, 'Case ID': caseId, 'Scholar ID': caseRow['Scholar ID'],
      'Decision Outcome': outcome,
      'Authenticator 1 Name/Email': caller.name + ' <' + caller.email + '>', 'Authenticator 1 Decision': outcome,
      'Authenticator 1 Rationale': _sanitizeInput_(rationale, 2000), 'Authenticator 1 Date (UTC)': _nowUtc_(),
      'Prior Status': caseRow['Current Status']
    });
    _requireRole_('Authenticator'); // Owner also qualifies via rank
    var caseHeaders = _headerMap_(caseSheet, 1);
    caseSheet.getRange(caseRow._rowNumber, caseHeaders['Assigned Authenticator 1']).setValue(caller.email);
    caseSheet.getRange(caseRow._rowNumber, caseHeaders['Current Status']).setValue('Pending authentication');
    caseSheet.getRange(caseRow._rowNumber, caseHeaders['Last Updated (UTC)']).setValue(_nowUtc_());
    return { status: 'ok', stage: 'first-approval-recorded', decisionId: decisionId, awaitingSecondApprover: true };
  }

  var firstEmail = (openDraft['Authenticator 1 Name/Email'].match(/<([^>]+)>/) || [])[1] || '';
  if (firstEmail.toLowerCase() === caller.email) {
    throw new Error('not-authorized: the second Authenticator/Owner must be a different account from the first.');
  }

  if (openDraft['Authenticator 1 Decision'] !== outcome) {
    // Conflict — escalate to Owner. Do NOT finalize.
    decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Name/Email']).setValue(caller.name + ' <' + caller.email + '>');
    decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Decision']).setValue(outcome);
    decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Rationale']).setValue(_sanitizeInput_(rationale, 2000));
    decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Date (UTC)']).setValue(_nowUtc_());
    decSheet.getRange(openDraft._rowNumber, decHeaders['Conflict Escalated To Owner?']).setValue('Yes');
    return { status: 'conflict', stage: 'escalated-to-owner', decisionId: openDraft['Decision ID'] };
  }

  // Matching second approval — finalize.
  decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Name/Email']).setValue(caller.name + ' <' + caller.email + '>');
  decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Decision']).setValue(outcome);
  decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Rationale']).setValue(_sanitizeInput_(rationale, 2000));
  decSheet.getRange(openDraft._rowNumber, decHeaders['Authenticator 2 Date (UTC)']).setValue(_nowUtc_());
  decSheet.getRange(openDraft._rowNumber, decHeaders['Final Decision Date (UTC)']).setValue(_nowUtc_());

  var caseHeaders2 = _headerMap_(caseSheet, 1);
  caseSheet.getRange(caseRow._rowNumber, caseHeaders2['Assigned Authenticator 2']).setValue(caller.email);
  caseSheet.getRange(caseRow._rowNumber, caseHeaders2['Current Status']).setValue(outcome);
  caseSheet.getRange(caseRow._rowNumber, caseHeaders2['Last Updated (UTC)']).setValue(_nowUtc_());
  _appendStatusHistory_(caseId, caseRow['Scholar ID'], openDraft['Prior Status'], outcome, caller, rationale);

  return { status: 'ok', stage: 'finalized', outcome: outcome, decisionId: openDraft['Decision ID'] };
}

/** apiResolveIdentityConflict — Owner-only escalation resolution. */
function apiResolveIdentityConflict(decisionId, ownerOutcome, resolutionNote) {
  var caller = _requireOwner_();
  var ss = _ss_();
  var decSheet = ss.getSheetByName('Identity Decisions');
  var dec = _findRowObject_(decSheet, 1, 'Decision ID', decisionId);
  if (!dec) throw new Error('apiResolveIdentityConflict: decision not found.');
  var headers = _headerMap_(decSheet, 1);
  decSheet.getRange(dec._rowNumber, headers['Owner Resolution Note']).setValue(_sanitizeInput_(resolutionNote, 2000));
  decSheet.getRange(dec._rowNumber, headers['Final Decision Date (UTC)']).setValue(_nowUtc_());

  var caseSheet = ss.getSheetByName('Identity Authentication');
  var caseRow = _findRowObject_(caseSheet, 1, 'Case ID', dec['Case ID']);
  var caseHeaders = _headerMap_(caseSheet, 1);
  caseSheet.getRange(caseRow._rowNumber, caseHeaders['Current Status']).setValue(ownerOutcome);
  caseSheet.getRange(caseRow._rowNumber, caseHeaders['Last Updated (UTC)']).setValue(_nowUtc_());
  _appendStatusHistory_(dec['Case ID'], dec['Scholar ID'], caseRow['Current Status'], ownerOutcome, caller, 'Owner conflict resolution: ' + resolutionNote);
  return { status: 'ok', serverTs: Date.now() };
}

function apiListIdentityQueue(filters) {
  _requireAuthenticatorOrOwner_();
  filters = filters || {};
  var rows = _readRowsAsObjects_(_ss_().getSheetByName('Identity Authentication'), 1);
  var out = rows.filter(function (r) {
    if (filters.status && r['Current Status'] !== filters.status) return false;
    return true;
  }).map(function (r) {
    return { caseId: r['Case ID'], scholarId: r['Scholar ID'], scholarName: r['Scholar Name'], status: r['Current Status'], statusSince: r['Status Since (UTC)'] };
  });
  return { status: 'ok', cases: out, serverTs: Date.now() };
}

function apiGetIdentityCase(caseId) {
  _requireAuthenticatorOrOwner_();
  var ss = _ss_();
  var caseRow = _findRowObject_(ss.getSheetByName('Identity Authentication'), 1, 'Case ID', caseId);
  if (!caseRow) throw new Error('apiGetIdentityCase: case not found.');
  var evidence = _readRowsAsObjects_(ss.getSheetByName('Identity Evidence'), 1).filter(function (r) { return r['Case ID'] === caseId; });
  var history = _readRowsAsObjects_(ss.getSheetByName('Identity Status History'), 1).filter(function (r) { return r['Case ID'] === caseId; });
  var decisions = _readRowsAsObjects_(ss.getSheetByName('Identity Decisions'), 1).filter(function (r) { return r['Case ID'] === caseId; });
  return { status: 'ok', case: caseRow, evidence: evidence, history: history, decisions: decisions, serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 10 — OWNER ROLLBACK
// ─────────────────────────────────────────────────────────────────────────

/** apiRollbackChange — Owner-only. Writes the field back to its pre-change
 * value and appends a NEW audit row referencing the original (never edits
 * or deletes the original). */
function apiRollbackChange(auditId) {
  var caller = _requireOwner_();
  var sheet = _ss_().getSheetByName('Change Audit Log');
  var row = _findRowObject_(sheet, 1, 'Audit ID', auditId);
  if (!row) throw new Error('apiRollbackChange: audit entry not found.');
  if (!row['Scholar ID'] || !row['Field Name']) throw new Error('apiRollbackChange: this entry has no reversible field write.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { status: 'busy', error: 'lock-timeout' };
  try {
    var write = _writeCanonicalValue_('Scholars', row['Scholar ID'], row['Field Name'], row['Old Value'], null);
    if (!write.ok) return { status: 'rejected', error: write.reason };
    var newAuditId = _appendAuditLog_({
      scholarId: row['Scholar ID'], field: row['Field Name'], oldValue: write.before, newValue: write.after,
      changeType: 'rollback', actorEmail: caller.email, actorName: caller.name, actorRole: caller.role,
      rationale: 'Owner rollback of ' + auditId, reversalOf: auditId
    });
    return { status: 'ok', newAuditId: newAuditId, serverTs: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 11 — OWNER-ONLY, ON-DEMAND PUBLISHING (Option B)
// ─────────────────────────────────────────────────────────────────────────

/** apiPreviewPendingPublish — everything applied since the last publish
 * that touched a public-facing field. STAGING preview only. */
function apiPreviewPendingPublish() {
  _requireOwner_();
  var lastPublishTs = PropertiesService.getScriptProperties().getProperty('STAGING_LAST_PUBLISH_TS') || '1970-01-01T00:00:00.000Z';
  var rows = _readRowsAsObjects_(_ss_().getSheetByName('Change Audit Log'), 1)
    .filter(function (r) { return PUBLIC_FACING_FIELDS.indexOf(r['Field Name']) >= 0 && String(r['UTC Timestamp']) > lastPublishTs; });
  return { status: 'ok', pendingChanges: rows.map(function (r) { return { scholarId: r['Scholar ID'], field: r['Field Name'], newValue: r['New Value'], utc: r['UTC Timestamp'] }; }), lastPublishTs: lastPublishTs, serverTs: Date.now() };
}

/**
 * apiPublishApprovedChanges — Owner-only, on-demand. In STAGING this
 * writes a timestamped JSON snapshot to Drive (next to the backup Sheet)
 * rather than to the live GitHub Pages repo. Wiring the real GitHub write
 * is a cutover-time change made only after explicit approval — this
 * function is deliberately inert with respect to any live production
 * file. No GitHub PAT or other secret is referenced here.
 */
function apiPublishApprovedChanges(confirm) {
  var caller = _requireOwner_();
  if (confirm !== true) return { status: 'rejected', error: 'confirmation-required' };
  var preview = apiPreviewPendingPublish();
  var snapshot = { publishedAt: _nowUtc_(), publishedBy: caller.email, changes: preview.pendingChanges, note: 'STAGING publish — written to Drive only, not to the live GitHub Pages repo.' };
  var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID).getParents().next(); // "2_Tongan Scholarly Database" folder
  var blob = Utilities.newBlob(JSON.stringify(snapshot, null, 2), 'application/json', 'staging-publish-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss') + '.json');
  var file = folder.createFile(blob);
  PropertiesService.getScriptProperties().setProperty('STAGING_LAST_PUBLISH_TS', snapshot.publishedAt);
  return { status: 'ok', driveFileId: file.getId(), changeCount: preview.pendingChanges.length, serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN USERS MANAGEMENT (Owner-only)
// ─────────────────────────────────────────────────────────────────────────

function apiListAdminUsers() {
  _requireOwner_();
  var rows = _readRowsAsObjects_(_ss_().getSheetByName('Admin Users'), 1);
  // 'Date Added' / 'Date Deactivated' are written as plain 'yyyy-MM-dd'
  // strings, but Sheets auto-detects that pattern and silently stores the
  // cell as a real Date, so getValues() hands back live Date objects here.
  // A Date instance nested in the returned row objects can corrupt the
  // google.script.run response (server logs the call as Completed, but
  // the browser-side success handler never receives usable data), so
  // convert every Date back to a plain display string before it crosses
  // that boundary.
  rows = rows.map(function (r) {
    var out = {};
    Object.keys(r).forEach(function (k) {
      var v = r[k];
      out[k] = (v instanceof Date) ? Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd') : v;
    });
    return out;
  });
  return { status: 'ok', users: rows, serverTs: Date.now() };
}

function apiAddAdminUser(name, email, role) {
  var caller = _requireOwner_();
  if (ROLE_RANK[role] == null) throw new Error('apiAddAdminUser: invalid role ' + role);
  email = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('apiAddAdminUser: invalid email.');
  var sheet = _ss_().getSheetByName('Admin Users');
  if (_adminUsersMap_()[email]) throw new Error('apiAddAdminUser: this email is already an Admin User.');
  _appendRowByHeader_(sheet, 1, {
    'Admin User ID': _genId_('ADMU'), 'Name': _sanitizeInput_(name, 120), 'Google Account Email': email,
    'Role': role, 'Active?': 'Yes', 'Date Added': Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'), 'Added By': caller.email
  });
  return { status: 'ok', serverTs: Date.now() };
}

function apiDeactivateAdminUser(adminUserId) {
  var caller = _requireOwner_();
  var sheet = _ss_().getSheetByName('Admin Users');
  var row = _findRowObject_(sheet, 1, 'Admin User ID', adminUserId);
  if (!row) throw new Error('apiDeactivateAdminUser: not found.');
  if (row['Role'] === 'Owner' && caller.adminUserId === adminUserId) throw new Error('apiDeactivateAdminUser: cannot deactivate your own Owner account.');
  var headers = _headerMap_(sheet, 1);
  sheet.getRange(row._rowNumber, headers['Active?']).setValue('No');
  sheet.getRange(row._rowNumber, headers['Date Deactivated']).setValue(Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'));
  sheet.getRange(row._rowNumber, headers['Deactivated By']).setValue(caller.email);
  return { status: 'ok', serverTs: Date.now() };
}

function apiActivateAdminUser(adminUserId) {
  var caller = _requireOwner_();
  var sheet = _ss_().getSheetByName('Admin Users');
  var row = _findRowObject_(sheet, 1, 'Admin User ID', adminUserId);
  if (!row) throw new Error('apiActivateAdminUser: not found.');
  var headers = _headerMap_(sheet, 1);
  sheet.getRange(row._rowNumber, headers['Active?']).setValue('Yes');
  // Clear the deactivation trail so a re-activated row doesn't keep showing
  // a stale "deactivated by/on" date; the activity is still fully visible in
  // this script's own Apps Script execution log if ever needed.
  sheet.getRange(row._rowNumber, headers['Date Deactivated']).setValue('');
  sheet.getRange(row._rowNumber, headers['Deactivated By']).setValue('');
  return { status: 'ok', serverTs: Date.now() };
}

function apiChangeAdminUserRole(adminUserId, newRole) {
  _requireOwner_();
  if (ROLE_RANK[newRole] == null) throw new Error('apiChangeAdminUserRole: invalid role.');
  var sheet = _ss_().getSheetByName('Admin Users');
  var row = _findRowObject_(sheet, 1, 'Admin User ID', adminUserId);
  if (!row) throw new Error('apiChangeAdminUserRole: not found.');
  sheet.getRange(row._rowNumber, _headerMap_(sheet, 1)['Role']).setValue(newRole);
  return { status: 'ok', serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// CANONICAL SCHOLAR EDIT SURFACE (ported from live admin, role-gated)
// ─────────────────────────────────────────────────────────────────────────

function apiDescribe() {
  var caller = _requireAnyRole_();
  return { status: 'ok', activeEmail: caller.email, activeName: caller.name, activeRole: caller.role, spreadsheetId: STAGING_SPREADSHEET_ID, sourceTag: SOURCE_TAG, timezone: TIMEZONE, mapping: MAPPING, serverTs: Date.now() };
}

function apiPing() {
  var caller = _requireAnyRole_();
  return { status: 'ok', activeEmail: caller.email, activeRole: caller.role, serverTs: Date.now() };
}

function apiListScholars() {
  _requireAnyRole_();
  var sheet = _ss_().getSheetByName('Scholars');
  var headerRow = 4;
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return { status: 'ok', scholars: [] };
  var headers = _headerMap_(sheet, headerRow);
  function idx(n) { return headers[n] ? headers[n] - 1 : -1; }
  var iId = idx('Scholar ID'), iName = idx('Scholar Name'), iPat = idx('Paternal Island Division'),
      iMat = idx('Maternal Island Division'), iDisc = idx('Primary Discipline / Field'), iInst = idx('Current Institution'),
      iPubs = idx('Linked Publication Count'), iFst = idx('First-Author Publication Count');
  var body = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, sheet.getLastColumn()).getValues();
  var out = [];
  for (var r = 0; r < body.length; r++) {
    var sid = String(body[r][iId] || '').trim();
    if (!sid) continue;
    function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
    out.push({
      scholarId: sid, name: iName >= 0 ? String(body[r][iName] || '').trim() : '',
      islandDivision: (iPat >= 0 && body[r][iPat]) ? body[r][iPat] : (iMat >= 0 ? body[r][iMat] : ''),
      discipline: iDisc >= 0 ? String(body[r][iDisc] || '').trim() : '', currentInstitution: iInst >= 0 ? String(body[r][iInst] || '').trim() : '',
      pubs: iPubs >= 0 ? num(body[r][iPubs]) : 0, firstAuth: iFst >= 0 ? num(body[r][iFst]) : 0
    });
  }
  out.sort(function (a, b) { return b.pubs - a.pubs || a.name.localeCompare(b.name); });
  return { status: 'ok', scholars: out, serverTs: Date.now() };
}

function apiReadRow(worksheet, keyValue) {
  _requireAnyRole_();
  var wsCfg = MAPPING.worksheets[worksheet];
  if (!wsCfg) throw new Error('apiReadRow: worksheet not allowed.');
  var sheet = _ss_().getSheetByName(worksheet);
  var headerRow = wsCfg.headerRow || 1;
  var headers = _headerMap_(sheet, headerRow);
  var keyIdx = headers[wsCfg.keyColumn];
  if (!keyIdx) throw new Error('apiReadRow: key column missing.');
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return { status: 'ok', found: false, fields: {} };
  var all = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, sheet.getLastColumn()).getValues();
  for (var r = 0; r < all.length; r++) {
    if (String(all[r][keyIdx - 1] || '').trim() !== String(keyValue).trim()) continue;
    var fields = {};
    Object.keys(headers).forEach(function (h) { fields[h] = all[r][headers[h] - 1]; });
    return { status: 'ok', found: true, rowNumber: headerRow + 1 + r, fields: fields };
  }
  return { status: 'ok', found: false, fields: {} };
}

/** apiUpdateRow — direct admin edit path (not via public submission).
 * Requires Authenticator or Owner; Researchers are view-only per the
 * role matrix (Section 5/13). */
function apiUpdateRow(worksheet, keyValue, fields, rowNumber) {
  var caller = _requireAuthenticatorOrOwner_();
  var wsCfg = MAPPING.worksheets[worksheet];
  if (!wsCfg) return { status: 'rejected', error: 'worksheet-not-allowed' };
  var unknown = Object.keys(fields || {}).filter(function (f) { return !wsCfg.fields[f]; });
  if (unknown.length) return { status: 'rejected', error: 'field-not-allowed', fields: unknown };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { status: 'busy', error: 'lock-timeout' };
  var results = [];
  try {
    Object.keys(fields).forEach(function (f) {
      var write = _writeCanonicalValue_(worksheet, keyValue, f, fields[f], rowNumber);
      if (write.ok) {
        _appendAuditLog_({ scholarId: keyValue, field: f, oldValue: write.before, newValue: write.after, changeType: 'direct-edit', actorEmail: caller.email, actorName: caller.name, actorRole: caller.role, rationale: 'Direct admin edit' });
      }
      results.push({ field: f, status: write.ok ? 'ok' : 'rejected', reason: write.reason });
    });
  } finally {
    lock.releaseLock();
  }
  return { status: 'ok', results: results, serverTs: Date.now() };
}

function apiReadChangeAuditLog(limit) {
  _requireAnyRole_();
  var take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 500);
  var rows = _readRowsAsObjects_(_ss_().getSheetByName('Change Audit Log'), 1);
  return { status: 'ok', rows: rows.slice(-take).reverse(), serverTs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────
// API FUNCTION WHITELIST (used only by apiCall’s explicit dispatch — never
// a raw this[fnName]/global lookup, so a malformed fnName can only ever
// resolve to "not found", never to an arbitrary function in scope).
// ─────────────────────────────────────────────────────────────────────────
var API_FUNCTIONS_ = {
  apiDescribe: apiDescribe,
  apiPing: apiPing,
  apiListScholars: apiListScholars,
  apiReadRow: apiReadRow,
  apiUpdateRow: apiUpdateRow,
  apiReadChangeAuditLog: apiReadChangeAuditLog,
  apiRetryDocSync: apiRetryDocSync,
  apiListSubmissionQueue: apiListSubmissionQueue,
  apiGetSubmissionDetail: apiGetSubmissionDetail,
  apiSaveFieldDecisions: apiSaveFieldDecisions,
  apiApplySubmissionDecisions: apiApplySubmissionDecisions,
  apiRequestSecondReview: apiRequestSecondReview,
  apiSubmitSecondReview: apiSubmitSecondReview,
  apiOpenIdentityCase: apiOpenIdentityCase,
  apiAddIdentityEvidence: apiAddIdentityEvidence,
  apiChangeIdentityCaseStatus: apiChangeIdentityCaseStatus,
  apiSubmitIdentityDecision: apiSubmitIdentityDecision,
  apiResolveIdentityConflict: apiResolveIdentityConflict,
  apiListIdentityQueue: apiListIdentityQueue,
  apiGetIdentityCase: apiGetIdentityCase,
  apiRollbackChange: apiRollbackChange,
  apiPreviewPendingPublish: apiPreviewPendingPublish,
  apiPublishApprovedChanges: apiPublishApprovedChanges,
  apiListAdminUsers: apiListAdminUsers,
  apiAddAdminUser: apiAddAdminUser,
  apiDeactivateAdminUser: apiDeactivateAdminUser,
  apiActivateAdminUser: apiActivateAdminUser,
  apiChangeAdminUserRole: apiChangeAdminUserRole
};

// ─────────────────────────────────────────────────────────────────────────
// HTML TEMPLATE INCLUDE
// ─────────────────────────────────────────────────────────────────────────

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
