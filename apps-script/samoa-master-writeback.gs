/**
 * samoa-master-writeback.gs — Bound Apps Script for the Samoa Scholar
 * Database Master file (Prof. Ron Vave, Department of Pacific Islands Studies). This is a completely separate, isolated sister
 * system with its own spreadsheet ID, SHARED_SECRET, and deployment. The
 * SPREADSHEET_ID_HINT guard below refuses to run against any spreadsheet ID
 * enumerated in _FORBIDDEN_SPREADSHEET_IDS.
 *
 * Deployed as a Web App (Execute as: Ron Vave — Owner; Access: Anyone with link)
 * and called only by admin-samoa-master.html. Every write is authenticated with a
 * shared secret held in ScriptProperties, enforced field-by-field against an
 * allowlist, wrapped in LockService, and appended to the Change Log.
 *
 * ── Setup (one-time; see docs/SAMOA-APPS-SCRIPT-DEPLOY.md for a step-by-step) ──
 *   1. In the Master spreadsheet: Extensions → Apps Script.
 *   2. Paste this file into the project as `samoa-master-writeback.gs`.
 *   3. In Project Settings → Script Properties, add:
 *        SHARED_SECRET      = 3165379b362f4447bc228abdd75d6668f7b4a3475d57a6298a3593ac3d431645  (pre-generated for Samoa; keep this value distinct from every other secret in the org)
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


// ────────────────────────────────────────────────────────────────────────────
// ✅ SAMOA ALLOWLIST — auto-regenerated 2026-08-30 from live Master Sheet
// Source of truth: samoa_build/generate_allowlist.py against spreadsheet
//   1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ
// If headers change in the Master Sheet, re-run the generator and paste the
// new MAPPING block below.
// ────────────────────────────────────────────────────────────────────────────

// ------------------------- CONFIG -----------------------------------------
var SPREADSHEET_ID_HINT = '1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ'; // Samoa Scholar Database Master File
var ACTOR_LABEL         = 'Ron Vave (Samoa admin)';
var SOURCE_TAG          = 'admin-master-webapp v1';
// Replay window: HMAC-signed requests are rejected if `ts` is more than this
// far from server time. The samoa-admin-writeback-client.js contract
// documents a 10-minute nonce/timestamp window; keep the two in sync.
var REPLAY_WINDOW_MS    = 10 * 60 * 1000;
// Nonce cache lifetime: nonces are rejected as replays if seen again within
// this window. Must be ≥ REPLAY_WINDOW_MS so a signed request can't be replayed
// before the timestamp check rejects it.
var NONCE_CACHE_TTL_S   = 15 * 60;
var LOCK_WAIT_MS        = 30 * 1000;
var TIMEZONE            = 'Pacific/Honolulu';

// Fields that ALWAYS require the user to explicitly confirm any change,
// even when the loaded and current Master values match. These are
// high-consequence status fields (drive memorial band, dashboard flags,
// etc.) so any change gets a plain-language warning per Ron 2026-08-23.
// Keyed by `<worksheet>.<field>`.
var ALWAYS_CONFIRM = {
  // High-consequence status fields: any change gets a plain-language warning.
  // Keyed by `<worksheet>.<field>`. These reference EXACT Samoa Master Sheet
  // row-4 headers.
  'Scholars.Living Status': true,
  'Scholars.Review Status': true,
  'Scholars.Roster Tier': true,
  'Scholars.Inclusion Status': true
};

// Full editable-field allowlist. Every writable field must appear here.
// Sheets not listed are read-only. Fields on listed sheets not listed are
// read-only. Enum values are validated against the `enum` array.
// MAPPING reflects the ACTUAL Master Google Sheet headers (verified
// 2026-08-22 against the live sheet). Field keys are the literal header
// strings including spacing and slashes. Column names come from row 4 of
// each sheet.
// AUTOGENERATED from Samoa Master Sheet row-4 headers on 2026-08-30.
// Generator: samoa_build/generate_allowlist.py
// Source spreadsheet: 1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ
// Tabs emitted: Authorship, Awards & Honours, Cultural Affiliation Evidence Audit, District Issues & Sources, District Research Relationships, Geography Evidence Audit, Graduate Degrees, Institutions, Interesting, M>PhD Mobility, Matai & Customary Evidence Audit, NUS Thesis Audit, Non-Completed Degrees, Part-Indigenous, Positions, Publications, Research Geography, Researcher Authorship, Samoan Researchers, Scholars, Scholarship Cohort Audit, Scholarships & Funding, Source Register, USP Graduation Audit, USP Thesis Audit
// Each field key is an EXACT row-4 header string in the Samoa Master Sheet.
// Do not edit by hand; rerun the generator against the live sheet if headers change.
var MAPPING = {
  version: '2.0-samoa',
  worksheets: {
    'Scholars': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: false,
      fields: {
        'Display Name': { type: 'string', maxLen: 240 },
        'Family Name': { type: 'string', maxLen: 240 },
        'Given Names': { type: 'string', maxLen: 240 },
        'Title / Salutation': { type: 'string', maxLen: 240 },
        'Gender': { type: 'enum', enum: ['Fafine', 'Tāne', 'Non-binary', 'Unspecified', 'Unclassified', ''] },
        'Birth Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Living Status': { type: 'string', maxLen: 2000 },
        'Death Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Photo URL': { type: 'url', maxLen: 500 },
        'Samoan Status': { type: 'string', maxLen: 2000 },
        'Inclusion Status': { type: 'string', maxLen: 2000 },
        'Identity Source ID': { type: 'string', maxLen: 40 },
        'Review Status': { type: 'string', maxLen: 120 },
        'Roster Tier': { type: 'string', maxLen: 60 },
        'Statistical Region (Paternal)': { type: 'string', maxLen: 2000 },
        'Political/Census District (Paternal)': { type: 'string', maxLen: 2000 },
        'Traditional Itūmālō (Paternal)': { type: 'string', maxLen: 2000 },
        'Specific Island (Paternal)': { type: 'string', maxLen: 2000 },
        'Village (Paternal)': { type: 'string', maxLen: 2000 },
        'Electoral Constituency (Paternal)': { type: 'string', maxLen: 2000 },
        'Electoral Version (Paternal)': { type: 'string', maxLen: 2000 },
        'Paternal Geography Source ID': { type: 'string', maxLen: 40 },
        'Statistical Region (Maternal)': { type: 'string', maxLen: 2000 },
        'Political/Census District (Maternal)': { type: 'string', maxLen: 2000 },
        'Traditional Itūmālō (Maternal)': { type: 'string', maxLen: 2000 },
        'Specific Island (Maternal)': { type: 'string', maxLen: 2000 },
        'Village (Maternal)': { type: 'string', maxLen: 2000 },
        'Electoral Constituency (Maternal)': { type: 'string', maxLen: 2000 },
        'Electoral Version (Maternal)': { type: 'string', maxLen: 2000 },
        'Maternal Geography Source ID': { type: 'string', maxLen: 40 },
        'Family / ʻĀiga (Paternal)': { type: 'string', maxLen: 240 },
        'Family / ʻĀiga (Maternal)': { type: 'string', maxLen: 240 },
        'Matai Title': { type: 'string', maxLen: 240 },
        'Matai Title Village': { type: 'string', maxLen: 240 },
        'Customary Affiliation': { type: 'string', maxLen: 2000 },
        'Self-identified Home / Community': { type: 'string', maxLen: 2000 },
        'Cultural Evidence Notes': { type: 'string', maxLen: 4000 },
        'Primary Discipline': { type: 'string', maxLen: 2000 },
        'Broad Discipline': { type: 'string', maxLen: 2000 },
        'Current Role': { type: 'string', maxLen: 2000 },
        'Current Institution ID': { type: 'string', maxLen: 40 },
        'Current Department': { type: 'string', maxLen: 2000 },
        'Current Country': { type: 'string', maxLen: 2000 },
        'Highest Completed Degree': { type: 'string', maxLen: 2000 },
        'Current Postgraduate Status': { type: 'string', maxLen: 2000 },
        'ORCID': { type: 'string', maxLen: 2000 },
        'Google Scholar URL': { type: 'url', maxLen: 500 },
        'Scopus Author ID': { type: 'string', maxLen: 40 },
        'Official Profile URL': { type: 'url', maxLen: 500 },
        'ResearchGate URL': { type: 'url', maxLen: 500 },
        'Personal Website': { type: 'string', maxLen: 2000 },
        'Total Completed Degrees': { type: 'string', maxLen: 2000 },
        'Total Publications': { type: 'string', maxLen: 2000 },
        'Total First-Author Publications': { type: 'string', maxLen: 2000 },
        'Total Awards': { type: 'string', maxLen: 2000 },
        'Leadership Category': { type: 'string', maxLen: 2000 },
        'Leadership Level': { type: 'string', maxLen: 2000 },
        'Aliases (semicolon-separated)': { type: 'string', maxLen: 2000 },
        'Source Basis': { type: 'string', maxLen: 240 },
        'Notes (internal — never public)': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Part-Indigenous': {
      keyColumn: 'Part-Indigenous ID',
      headerRow: 4,
      allowMultiRow: false,
      fields: {
        'Display Name': { type: 'string', maxLen: 240 },
        'Family Name': { type: 'string', maxLen: 240 },
        'Given Names': { type: 'string', maxLen: 240 },
        'Title / Salutation': { type: 'string', maxLen: 240 },
        'Gender': { type: 'enum', enum: ['Fafine', 'Tāne', 'Non-binary', 'Unspecified', 'Unclassified', ''] },
        'Birth Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Living Status': { type: 'string', maxLen: 2000 },
        'Death Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Photo URL': { type: 'url', maxLen: 500 },
        'Samoan Status': { type: 'string', maxLen: 2000 },
        'Inclusion Status': { type: 'string', maxLen: 2000 },
        'Identity Source ID': { type: 'string', maxLen: 40 },
        'Review Status': { type: 'string', maxLen: 120 },
        'Roster Tier': { type: 'string', maxLen: 60 },
        'Statistical Region (Paternal)': { type: 'string', maxLen: 2000 },
        'Political/Census District (Paternal)': { type: 'string', maxLen: 2000 },
        'Traditional Itūmālō (Paternal)': { type: 'string', maxLen: 2000 },
        'Specific Island (Paternal)': { type: 'string', maxLen: 2000 },
        'Village (Paternal)': { type: 'string', maxLen: 2000 },
        'Electoral Constituency (Paternal)': { type: 'string', maxLen: 2000 },
        'Electoral Version (Paternal)': { type: 'string', maxLen: 2000 },
        'Paternal Geography Source ID': { type: 'string', maxLen: 40 },
        'Statistical Region (Maternal)': { type: 'string', maxLen: 2000 },
        'Political/Census District (Maternal)': { type: 'string', maxLen: 2000 },
        'Traditional Itūmālō (Maternal)': { type: 'string', maxLen: 2000 },
        'Specific Island (Maternal)': { type: 'string', maxLen: 2000 },
        'Village (Maternal)': { type: 'string', maxLen: 2000 },
        'Electoral Constituency (Maternal)': { type: 'string', maxLen: 2000 },
        'Electoral Version (Maternal)': { type: 'string', maxLen: 2000 },
        'Maternal Geography Source ID': { type: 'string', maxLen: 40 },
        'Family / ʻĀiga (Paternal)': { type: 'string', maxLen: 240 },
        'Family / ʻĀiga (Maternal)': { type: 'string', maxLen: 240 },
        'Matai Title': { type: 'string', maxLen: 240 },
        'Matai Title Village': { type: 'string', maxLen: 240 },
        'Customary Affiliation': { type: 'string', maxLen: 2000 },
        'Self-identified Home / Community': { type: 'string', maxLen: 2000 },
        'Cultural Evidence Notes': { type: 'string', maxLen: 4000 },
        'Primary Discipline': { type: 'string', maxLen: 2000 },
        'Broad Discipline': { type: 'string', maxLen: 2000 },
        'Current Role': { type: 'string', maxLen: 2000 },
        'Current Institution ID': { type: 'string', maxLen: 40 },
        'Current Department': { type: 'string', maxLen: 2000 },
        'Current Country': { type: 'string', maxLen: 2000 },
        'Highest Completed Degree': { type: 'string', maxLen: 2000 },
        'Current Postgraduate Status': { type: 'string', maxLen: 2000 },
        'ORCID': { type: 'string', maxLen: 2000 },
        'Google Scholar URL': { type: 'url', maxLen: 500 },
        'Scopus Author ID': { type: 'string', maxLen: 40 },
        'Official Profile URL': { type: 'url', maxLen: 500 },
        'ResearchGate URL': { type: 'url', maxLen: 500 },
        'Personal Website': { type: 'string', maxLen: 2000 },
        'Total Completed Degrees': { type: 'string', maxLen: 2000 },
        'Total Publications': { type: 'string', maxLen: 2000 },
        'Total First-Author Publications': { type: 'string', maxLen: 2000 },
        'Total Awards': { type: 'string', maxLen: 2000 },
        'Leadership Category': { type: 'string', maxLen: 2000 },
        'Leadership Level': { type: 'string', maxLen: 2000 },
        'Aliases (semicolon-separated)': { type: 'string', maxLen: 2000 },
        'Source Basis': { type: 'string', maxLen: 240 },
        'Notes (internal — never public)': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Graduate Degrees': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Degree ID': { type: 'string', maxLen: 40 },
        'Stage': { type: 'string', maxLen: 2000 },
        'Degree Name': { type: 'string', maxLen: 240 },
        'Field': { type: 'string', maxLen: 2000 },
        'Broad Discipline': { type: 'string', maxLen: 2000 },
        'Thesis Title': { type: 'string', maxLen: 4000 },
        'Institution ID': { type: 'string', maxLen: 40 },
        'Current Institution Name': { type: 'string', maxLen: 240 },
        'Original Institution Name': { type: 'string', maxLen: 240 },
        'Country': { type: 'string', maxLen: 80 },
        'Start Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'End Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Completion Status': { type: 'string', maxLen: 120 },
        'Repository URL': { type: 'url', maxLen: 500 },
        'DOI / Handle': { type: 'url', maxLen: 500 },
        'Thesis Publication ID': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Non-Completed Degrees': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Non-Completed Degree ID': { type: 'string', maxLen: 40 },
        'Stage': { type: 'string', maxLen: 2000 },
        'Degree Name': { type: 'string', maxLen: 240 },
        'Field': { type: 'string', maxLen: 2000 },
        'Broad Discipline': { type: 'string', maxLen: 2000 },
        'Institution ID': { type: 'string', maxLen: 40 },
        'Country': { type: 'string', maxLen: 80 },
        'Start Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Expected End Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Status': { type: 'string', maxLen: 2000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Scholarships & Funding': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Funding ID': { type: 'string', maxLen: 40 },
        'Program / Body': { type: 'string', maxLen: 2000 },
        'Type': { type: 'string', maxLen: 2000 },
        'Category': { type: 'string', maxLen: 2000 },
        'Linked Degree ID': { type: 'string', maxLen: 40 },
        'Linked Project': { type: 'string', maxLen: 2000 },
        'Place': { type: 'string', maxLen: 2000 },
        'Start Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'End Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Public Value': { type: 'string', maxLen: 2000 },
        'Obligations / Bond': { type: 'string', maxLen: 2000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Interesting': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Fact ID': { type: 'string', maxLen: 40 },
        'Milestone Type': { type: 'string', maxLen: 2000 },
        'Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Description': { type: 'string', maxLen: 2000 },
        'Verification Status': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Awards & Honours': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Award ID': { type: 'string', maxLen: 40 },
        'Award Name': { type: 'string', maxLen: 240 },
        'Awarding Body': { type: 'string', maxLen: 2000 },
        'Category': { type: 'string', maxLen: 2000 },
        'Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Country': { type: 'string', maxLen: 80 },
        'Public Value / Prize': { type: 'string', maxLen: 2000 },
        'Citation URL': { type: 'url', maxLen: 500 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Positions': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Position ID': { type: 'string', maxLen: 40 },
        'Title': { type: 'string', maxLen: 240 },
        'Institution ID': { type: 'string', maxLen: 40 },
        'Department': { type: 'string', maxLen: 2000 },
        'Country': { type: 'string', maxLen: 80 },
        'Leadership Category': { type: 'string', maxLen: 2000 },
        'Leadership Level': { type: 'string', maxLen: 2000 },
        'Start Date': { type: 'string', maxLen: 60 },
        'End Date': { type: 'string', maxLen: 60 },
        'Current Flag': { type: 'string', maxLen: 2000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'M>PhD Mobility': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Mobility ID': { type: 'string', maxLen: 40 },
        'Master\'s Institution ID': { type: 'string', maxLen: 40 },
        'Master\'s Country': { type: 'string', maxLen: 2000 },
        'Master\'s Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'PhD Institution ID': { type: 'string', maxLen: 40 },
        'PhD Country': { type: 'string', maxLen: 2000 },
        'PhD Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Gap Years': { type: 'string', maxLen: 2000 },
        'Same Institution Flag': { type: 'string', maxLen: 2000 },
        'Same Country Flag': { type: 'string', maxLen: 2000 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Derived At': { type: 'string', maxLen: 2000 },
      }
    },
    'Publications': {
      keyColumn: 'Publication ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'BibTeX Key': { type: 'string', maxLen: 40 },
        'Type': { type: 'string', maxLen: 2000 },
        'Title': { type: 'string', maxLen: 240 },
        'Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Authors (as-published string)': { type: 'string', maxLen: 2000 },
        'Journal / Publisher': { type: 'string', maxLen: 2000 },
        'Volume': { type: 'string', maxLen: 2000 },
        'Issue': { type: 'string', maxLen: 2000 },
        'Pages': { type: 'string', maxLen: 2000 },
        'DOI': { type: 'url', maxLen: 500 },
        'URL': { type: 'url', maxLen: 500 },
        'Abstract': { type: 'string', maxLen: 4000 },
        'Zotero Key': { type: 'string', maxLen: 2000 },
        'Full Text URL': { type: 'url', maxLen: 500 },
        'Language': { type: 'string', maxLen: 2000 },
        'Verification Status': { type: 'string', maxLen: 4000 },
        'V2 Inclusion Flag': { type: 'string', maxLen: 2000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Authorship': {
      keyColumn: 'Authorship ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Publication ID': { type: 'string', maxLen: 40 },
        'Scholar ID': { type: 'string', maxLen: 40 },
        'Published Name (as printed)': { type: 'string', maxLen: 240 },
        'Author Position': { type: 'string', maxLen: 2000 },
        'First Author Flag': { type: 'string', maxLen: 2000 },
        'Corresponding Author Flag': { type: 'string', maxLen: 2000 },
        'Affiliation (as printed)': { type: 'string', maxLen: 2000 },
        'Match Method': { type: 'string', maxLen: 2000 },
        'Verification Status': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Research Geography': {
      keyColumn: 'Publication ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Geography ID': { type: 'string', maxLen: 40 },
        'Country': { type: 'string', maxLen: 80 },
        'Statistical Region': { type: 'string', maxLen: 120 },
        'Political/Census District': { type: 'string', maxLen: 120 },
        'Traditional Itūmālō (if explicit in paper)': { type: 'string', maxLen: 2000 },
        'Specific Island': { type: 'string', maxLen: 120 },
        'Village / Site': { type: 'string', maxLen: 2000 },
        'Latitude': { type: 'string', maxLen: 2000 },
        'Longitude': { type: 'string', maxLen: 2000 },
        'Scale (Country / Region / District / Village / Site)': { type: 'string', maxLen: 2000 },
        'Evidence (quote / page / figure)': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Verification Status': { type: 'string', maxLen: 4000 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Institutions': {
      keyColumn: 'Institution ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Canonical Name': { type: 'string', maxLen: 240 },
        'Short Name': { type: 'string', maxLen: 240 },
        'Type (University / Research Institute / Government / NGO / Industry / Other)': { type: 'string', maxLen: 2000 },
        'Country': { type: 'string', maxLen: 80 },
        'City': { type: 'string', maxLen: 120 },
        'Latitude': { type: 'string', maxLen: 2000 },
        'Longitude': { type: 'string', maxLen: 2000 },
        'Parent Institution ID': { type: 'string', maxLen: 40 },
        'Founded Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Aliases (semicolon-separated, includes historical names)': { type: 'string', maxLen: 2000 },
        'Website': { type: 'string', maxLen: 2000 },
        'Wikipedia URL': { type: 'url', maxLen: 500 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Source Register': {
      keyColumn: 'Source ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Source Type': { type: 'string', maxLen: 2000 },
        'Title': { type: 'string', maxLen: 240 },
        'Author(s)': { type: 'string', maxLen: 2000 },
        'Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Publisher / Body': { type: 'string', maxLen: 2000 },
        'URL': { type: 'url', maxLen: 500 },
        'DOI': { type: 'url', maxLen: 500 },
        'Handle': { type: 'string', maxLen: 2000 },
        'Access Date': { type: 'string', maxLen: 60 },
        'Archive URL': { type: 'url', maxLen: 500 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Trust Tier (Primary / Secondary / Tertiary)': { type: 'string', maxLen: 2000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Matai & Customary Evidence Audit': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Audit ID': { type: 'string', maxLen: 40 },
        'Matai Title': { type: 'string', maxLen: 240 },
        'Title Village': { type: 'string', maxLen: 240 },
        'Family / ʻĀiga': { type: 'string', maxLen: 240 },
        'Customary Affiliation Statement': { type: 'string', maxLen: 2000 },
        'Evidence URL / Citation': { type: 'url', maxLen: 500 },
        'Reviewer': { type: 'string', maxLen: 2000 },
        'Review Status': { type: 'string', maxLen: 120 },
        'Review Date': { type: 'string', maxLen: 60 },
        'Notes': { type: 'string', maxLen: 4000 },
      }
    },
    'District Issues & Sources': {
      keyColumn: 'District ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Issue ID': { type: 'string', maxLen: 40 },
        'Issue Type': { type: 'string', maxLen: 2000 },
        'Description': { type: 'string', maxLen: 2000 },
        'Affected Villages': { type: 'string', maxLen: 2000 },
        'Source URL': { type: 'url', maxLen: 500 },
        'Reported By': { type: 'string', maxLen: 2000 },
        'Status': { type: 'string', maxLen: 2000 },
        'Resolution': { type: 'string', maxLen: 2000 },
        'Notes': { type: 'string', maxLen: 4000 },
      }
    },
    'District Research Relationships': {
      keyColumn: 'District ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Relationship ID': { type: 'string', maxLen: 40 },
        'Community Contact': { type: 'string', maxLen: 2000 },
        'Research Focus': { type: 'string', maxLen: 2000 },
        'Start Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'End Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Publications Attributable': { type: 'string', maxLen: 2000 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
      }
    },
    'Geography Evidence Audit': {
      keyColumn: 'Audit ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Scholar ID or Publication ID': { type: 'string', maxLen: 40 },
        'Geography Dimension': { type: 'string', maxLen: 2000 },
        'Claimed Value': { type: 'string', maxLen: 2000 },
        'Evidence Statement': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Reviewer': { type: 'string', maxLen: 2000 },
        'Review Status': { type: 'string', maxLen: 120 },
        'Review Date': { type: 'string', maxLen: 60 },
        'Notes': { type: 'string', maxLen: 4000 },
      }
    },
    'Cultural Affiliation Evidence Audit': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Audit ID': { type: 'string', maxLen: 40 },
        'Affiliation Type': { type: 'string', maxLen: 2000 },
        'Claimed Value': { type: 'string', maxLen: 2000 },
        'Evidence Statement': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Reviewer': { type: 'string', maxLen: 2000 },
        'Review Status': { type: 'string', maxLen: 120 },
        'Review Date': { type: 'string', maxLen: 60 },
        'Notes': { type: 'string', maxLen: 4000 },
      }
    },
    'Scholarship Cohort Audit': {
      keyColumn: 'Audit ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Program': { type: 'string', maxLen: 2000 },
        'Awarding Body': { type: 'string', maxLen: 2000 },
        'Cohort Year': { type: 'int', min: 1800, max: 2100, nullable: true },
        'Awardees Recorded': { type: 'string', maxLen: 2000 },
        'Awardees Expected': { type: 'string', maxLen: 2000 },
        'Coverage %': { type: 'string', maxLen: 2000 },
        'Gap Notes': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
      }
    },
    'USP Thesis Audit': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Audit ID': { type: 'string', maxLen: 40 },
        'Degree ID': { type: 'string', maxLen: 40 },
        'USP Repository URL': { type: 'url', maxLen: 500 },
        'Located': { type: 'string', maxLen: 2000 },
        'Notes': { type: 'string', maxLen: 4000 },
      }
    },
    'USP Graduation Audit': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Audit ID': { type: 'string', maxLen: 40 },
        'Degree ID': { type: 'string', maxLen: 40 },
        'USP Graduation Programme URL': { type: 'url', maxLen: 500 },
        'Confirmed': { type: 'string', maxLen: 2000 },
        'Notes': { type: 'string', maxLen: 4000 },
      }
    },
    'NUS Thesis Audit': {
      keyColumn: 'Scholar ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Audit ID': { type: 'string', maxLen: 40 },
        'Degree ID': { type: 'string', maxLen: 40 },
        'NUS Repository URL': { type: 'url', maxLen: 500 },
        'Located': { type: 'string', maxLen: 2000 },
        'Notes': { type: 'string', maxLen: 4000 },
      }
    },
    'Samoan Researchers': {
      keyColumn: 'Researcher ID',
      headerRow: 4,
      allowMultiRow: false,
      fields: {
        'Display Name': { type: 'string', maxLen: 240 },
        'Family Name': { type: 'string', maxLen: 240 },
        'Given Names': { type: 'string', maxLen: 240 },
        'Gender': { type: 'enum', enum: ['Fafine', 'Tāne', 'Non-binary', 'Unspecified', 'Unclassified', ''] },
        'Samoan Status': { type: 'string', maxLen: 2000 },
        'Identity Source ID': { type: 'string', maxLen: 40 },
        'Current Role': { type: 'string', maxLen: 2000 },
        'Current Institution ID': { type: 'string', maxLen: 40 },
        'Current Country': { type: 'string', maxLen: 2000 },
        'ORCID': { type: 'string', maxLen: 2000 },
        'Google Scholar URL': { type: 'url', maxLen: 500 },
        'Statistical Region (Paternal)': { type: 'string', maxLen: 2000 },
        'Political/Census District (Paternal)': { type: 'string', maxLen: 2000 },
        'Traditional Itūmālō (Paternal)': { type: 'string', maxLen: 2000 },
        'Specific Island (Paternal)': { type: 'string', maxLen: 2000 },
        'Village (Paternal)': { type: 'string', maxLen: 2000 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
    'Researcher Authorship': {
      keyColumn: 'Researcher Authorship ID',
      headerRow: 4,
      allowMultiRow: true,
      fields: {
        'Publication ID': { type: 'string', maxLen: 40 },
        'Researcher ID': { type: 'string', maxLen: 40 },
        'Published Name (as printed)': { type: 'string', maxLen: 240 },
        'Author Position': { type: 'string', maxLen: 2000 },
        'First Author Flag': { type: 'string', maxLen: 2000 },
        'Affiliation (as printed)': { type: 'string', maxLen: 2000 },
        'Match Method': { type: 'string', maxLen: 2000 },
        'Verification Status': { type: 'string', maxLen: 4000 },
        'Source ID': { type: 'string', maxLen: 40 },
        'Notes': { type: 'string', maxLen: 4000 },
        'Created At': { type: 'string', maxLen: 2000 },
        'Created By': { type: 'string', maxLen: 2000 },
        'Updated At': { type: 'string', maxLen: 2000 },
        'Updated By': { type: 'string', maxLen: 2000 },
      }
    },
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
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return jsonOut_({ status: 'bad_request', reason: 'invalid-json' }, 400);
  }
  try {
    var action = body.action || 'write';

    // ── Session-1 HMAC contract (samoa-admin-writeback-client.js) ─────────
    // These actions carry `sig`, `nonce`, `ts` and are verified with
    // HMAC-SHA-256 over a canonical string. If the request looks HMAC-signed
    // (has both `sig` and `nonce`) we route it through the HMAC verifier.
    // Otherwise, fall through to the legacy `secret`+`clientTs` contract
    // for backwards compatibility with the sister-database admin surfaces.
    var isHmac = !!(body && body.sig && body.nonce);
    if (isHmac || action === 'update' || action === 'describe') {
      var authRes = checkAuthHmac_(body);
      if (!authRes.ok) return jsonOut_({ status: 'unauthorized', error: authRes.reason }, 401);
      if (action === 'describe') {
        return jsonOut_({
          status: 'ok',
          mapping: MAPPING,
          writeEnabled: writeEnabled_(),
          actor: ACTOR_LABEL,
          tz: TIMEZONE,
          spreadsheetId: SPREADSHEET_ID_HINT,
          serverTs: Date.now()
        });
      }
      if (action === 'ping') {
        return jsonOut_({ status: 'ok', pong: true, writeEnabled: writeEnabled_(), actor: ACTOR_LABEL, tz: TIMEZONE, serverTs: Date.now() });
      }
      if (action === 'update') {
        if (!writeEnabled_()) return jsonOut_({ status: 'disabled', reason: 'WRITE_ENABLED=false' }, 423);
        return handleUpdateRow_(body);
      }
      return jsonOut_({ status: 'bad_request', reason: 'unknown-action' }, 400);
    }

    // ── Legacy contract (sister-database compatibility) ───────────────────
    if (!checkAuth_(body)) return jsonOut_({ status: 'unauthorized' }, 401);
    if (!writeEnabled_()) return jsonOut_({ status: 'disabled', reason: 'WRITE_ENABLED=false' }, 423);
    if (action === 'write') return handleWrite_(body);
    if (action === 'ping')  return jsonOut_({ status: 'ok', pong: true, writeEnabled: true });
    return jsonOut_({ status: 'bad_request', reason: 'unknown-action' }, 400);
  } catch (err) {
    return jsonOut_({ status: 'error', error: String(err && err.message || err) }, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HMAC-signed request handler (Session-1 contract)
// ─────────────────────────────────────────────────────────────────────────
//
// Request body shape (from samoa-admin-writeback-client.js):
//   {
//     action:    "update",
//     worksheet: "Scholars",
//     key:       "SAM-S0001",
//     fields:    { "Given Names": "Joeli", ... },
//     actor:     "admin" | ...
//     nonce:     "<random hex>",
//     ts:        <epoch ms>,
//     sig:       "<hex HMAC-SHA-256 over canonical string>"
//   }
//
// Canonical string signed:
//   action + "\n" + worksheet + "\n" + key + "\n" +
//   canonicalJSON(fields) + "\n" + nonce + "\n" + ts
//
// For `ping` / `describe`, `worksheet` and `key` are empty strings and
// `fields` canonicalises to `"{}"`.
//
// Response shape (single-row update):
//   Success:  { status: "ok",       writtenAt, results: [ { field, oldValue, newValue } ], serverTs }
//   Partial:  { status: "partial",  results: [ ... ],  serverTs }
//   Rejected: { status: "rejected", error, serverTs }
//   Unauth:   { status: "unauthorized", error, serverTs }
//   Noop:     { status: "ok", noop: true, results: [ { field, currentValue } ], serverTs }

function handleUpdateRow_(body) {
  var ws = String(body.worksheet || '');
  var key = String(body.key || '');
  var fields = body.fields || {};
  var actor = String(body.actor || '') || ACTOR_LABEL;

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
      var r = applyOneChange_(ss, change, body.dryRun === true);
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
    dryRun: body.dryRun === true,
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

// ─────────────────────────────────────────────────────────────────────────
// HMAC verification (Session-1 contract)
// ─────────────────────────────────────────────────────────────────────────

function checkAuthHmac_(body) {
  if (!body || !body.sig || !body.nonce || !body.ts) {
    return { ok: false, reason: 'missing-signature-fields' };
  }
  var props = PropertiesService.getScriptProperties();
  var secretHex = props.getProperty('SHARED_SECRET') || '';
  if (!secretHex) return { ok: false, reason: 'server-missing-secret' };

  // 1. Replay window: reject stale/future timestamps.
  var ts = parseInt(body.ts, 10);
  if (!ts) return { ok: false, reason: 'bad-ts' };
  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) return { ok: false, reason: 'ts-outside-window' };

  // 2. Nonce replay guard: reject any nonce we've already seen within TTL.
  //    CacheService is per-script and persists across executions of this
  //    web app, which is exactly what we want.
  var cache = CacheService.getScriptCache();
  var nonceKey = 'nonce:' + String(body.nonce);
  if (cache.get(nonceKey)) return { ok: false, reason: 'nonce-replay' };

  // 3. Compute expected HMAC-SHA-256 over the canonical string.
  var canonical =
    String(body.action || '') + '\n' +
    String(body.worksheet || '') + '\n' +
    String(body.key || '') + '\n' +
    canonicalJSONFields_(body.fields || {}) + '\n' +
    String(body.nonce) + '\n' +
    String(ts);
  var keyBytes = hexToBytes_(secretHex);
  var sigBytes = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(canonical).getBytes(),
    keyBytes
  );
  var expected = bytesToHex_(sigBytes);
  var received = String(body.sig || '').toLowerCase();

  if (expected.length !== received.length) return { ok: false, reason: 'sig-mismatch' };
  // Constant-time compare.
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= (expected.charCodeAt(i) ^ received.charCodeAt(i));
  }
  if (diff !== 0) return { ok: false, reason: 'sig-mismatch' };

  // 4. Reserve the nonce so a replay within TTL is rejected.
  cache.put(nonceKey, '1', NONCE_CACHE_TTL_S);
  return { ok: true };
}

// Canonical JSON serialisation — recursive, keys sorted lexicographically,
// no whitespace. Must match the client's canonicalJSON() in
// js/samoa-admin-writeback-client.js so both sides feed byte-identical
// input to HMAC-SHA-256. Arrays and primitives use JSON.stringify(); only
// plain objects have their keys sorted before serialising.
function canonicalJSON_(obj) {
  if (obj === null || typeof obj !== 'object' || Object.prototype.toString.call(obj) === '[object Array]') {
    return JSON.stringify(obj);
  }
  var keys = Object.keys(obj).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    parts.push(JSON.stringify(keys[i]) + ':' + canonicalJSON_(obj[keys[i]]));
  }
  return '{' + parts.join(',') + '}';
}

// Back-compat alias used elsewhere in this file.
function canonicalJSONFields_(fields) {
  return canonicalJSON_(fields || {});
}

function hexToBytes_(hex) {
  var out = [];
  for (var i = 0; i < hex.length; i += 2) {
    var byte = parseInt(hex.substr(i, 2), 16);
    // Apps Script signed byte range is −128..127.
    if (byte >= 128) byte -= 256;
    out.push(byte);
  }
  return out;
}

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    var s = b.toString(16);
    if (s.length === 1) s = '0' + s;
    out += s;
  }
  return out;
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
