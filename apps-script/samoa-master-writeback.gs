/**
 * samoa-master-writeback.gs — Samoa Scholar Database admin server.
 *
 * Session 2026-08-31 systematic-repair rewrite:
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
 */

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

var SPREADSHEET_ID_HINT = '1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ';  // Samoa Master
var SOURCE_TAG          = 'admin-master-webapp v2 (google-auth)';
var LOCK_WAIT_MS        = 30 * 1000;
var TIMEZONE            = 'Pacific/Honolulu';

// High-consequence fields that ALWAYS get a confirmation prompt on write,
// even when the intended value matches the current value. Keyed by
// "<worksheet>.<field>" using the EXACT Samoa Master Sheet row-4 headers.
var ALWAYS_CONFIRM = {
  'Scholars.Living Status': true,
  'Scholars.Review Status': true,
  'Scholars.Roster Tier': true,
  'Scholars.Inclusion Status': true
};

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
  var actor = String(body.actor || '') || 'samoa-admin';
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
  var actorLabel = String(actor || 'samoa-admin');
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
 * Called from samoa-admin-app.html scriptlets as `<?!= include('...') ?>`.
 * Returns the raw content of another HTML file in this Apps Script project
 * so it can be stitched into the outer template. The included files
 * contain ONLY <script>...</script> blocks — no further scriptlets — so
 * scriptlet evaluation only ever happens once, in samoa-admin-app.html.
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
    throw new Error('samoa-writeback: APPROVED_ADMIN_EMAIL is not configured.');
  }
  if (!actual) {
    throw new Error('samoa-writeback: no active Google session.');
  }
  if (actual !== approved) {
    throw new Error('samoa-writeback: not-authorized (' + actual + ' is not the approved admin).');
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
  var tmpl = HtmlService.createTemplateFromFile('samoa-admin-app');
  tmpl.activeEmail       = actual;
  tmpl.writeEnabled      = writeEnabled_();
  tmpl.writeEnabledLabel = writeEnabled_() ? 'WRITE ENABLED' : 'READ-ONLY (WRITE_ENABLED=false)';
  tmpl.spreadsheetId     = SPREADSHEET_ID_HINT;
  return tmpl.evaluate()
    .setTitle('Samoa Scholar Database — Admin')
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
    '<title>Not authorised — Samoa Admin</title>' +
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
