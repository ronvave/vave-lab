/**
 * samoa-admin-insights-migration.js  —  Canonicalise the shape of the
 * admin-owned scholar-insights blob for the Samoa Scholar Database.
 *
 * The admin surface has always stored scholar-owned enrichment fields
 * (photo path, external URLs, sector, birth/death years, long-form
 * research insights) in a Scholar-ID keyed JSON. Over time the shape
 * of that JSON has drifted slightly — some keys were nested, some were
 * flat, some used camelCase and some kebab-case. This module rewrites
 * a possibly-legacy blob into the canonical shape the current admin
 * expects, WITHOUT losing any user data.
 *
 * Canonical shape:
 *   {
 *     "version": 2,
 *     "generated_at": "<ISO>",
 *     "scholars": {
 *       "<Scholar ID>": {
 *         "photo_path":            <string, "" if unset>,
 *         "institution_url":       <string, "" if unset>,
 *         "department_url":        <string, "" if unset>,
 *         "public_profile_url":    <string, "" if unset>,
 *         "sector":                <string, "" if unset>,
 *         "year_of_birth":         <int|null>,
 *         "year_of_death":         <int|null>,
 *         "research_insights_md":  <string, "" if unset>,
 *         "notes_internal":        <string, "" if unset>,
 *         "last_edited_by":        <string, "" if unset>,
 *         "last_edited_at":        <ISO|"">
 *       },
 *       ...
 *     }
 *   }
 *
 * Every field is a value type (string / int / null). No cross-jurisdiction
 * fields are ever added or preserved. If a legacy blob contains a key
 * that references any sister-jurisdiction concept (paddocked below in
 * REJECTED_KEYS), the migration logs a warning and drops it.
 */
(function (global) {
  'use strict';

  // Any legacy key matching one of these is silently dropped — these are
  // hangovers from earlier admin blobs that MUST NOT survive into a Samoa
  // record. If a key name shifts and starts colliding with a real Samoa
  // field, remove it from here and handle it in the field-copy switch.
  var REJECTED_KEYS = [
    'confederacy', 'province', 'ward', 'tikina',
    'turaga', 'marama',
    'kolo', 'ha_a', 'tofi_a', 'kainga'
  ];

  // Alias table: old key → canonical key. Everything not in this table
  // and not already canonical is dropped with a warning.
  var ALIASES = {
    'photoPath':          'photo_path',
    'photo':              'photo_path',
    'institutionUrl':     'institution_url',
    'institution':        'institution_url',
    'departmentUrl':      'department_url',
    'department':         'department_url',
    'publicProfileUrl':   'public_profile_url',
    'profileUrl':         'public_profile_url',
    'sectorTag':          'sector',
    'sectorCategory':     'sector',
    'yearOfBirth':        'year_of_birth',
    'birthYear':          'year_of_birth',
    'yearOfDeath':        'year_of_death',
    'deathYear':          'year_of_death',
    'researchInsightsMd': 'research_insights_md',
    'researchInsights':   'research_insights_md',
    'insightsMd':         'research_insights_md',
    'insights':           'research_insights_md',
    'notesInternal':      'notes_internal',
    'notes':              'notes_internal',
    'lastEditedBy':       'last_edited_by',
    'lastEditedAt':       'last_edited_at'
  };

  var CANONICAL_KEYS = [
    'photo_path', 'institution_url', 'department_url', 'public_profile_url',
    'sector', 'year_of_birth', 'year_of_death',
    'research_insights_md', 'notes_internal',
    'last_edited_by', 'last_edited_at'
  ];

  var INT_KEYS = { 'year_of_birth': true, 'year_of_death': true };

  function emptyRecord() {
    var rec = {};
    for (var i = 0; i < CANONICAL_KEYS.length; i++) {
      var k = CANONICAL_KEYS[i];
      rec[k] = INT_KEYS[k] ? null : '';
    }
    return rec;
  }

  function coerceValue(canonicalKey, value) {
    if (INT_KEYS[canonicalKey]) {
      if (value === null || value === undefined || value === '') return null;
      var n = parseInt(value, 10);
      return isFinite(n) ? n : null;
    }
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function migrateOneScholar(scholarId, raw, warnings) {
    var rec = emptyRecord();
    if (!raw || typeof raw !== 'object') return rec;

    Object.keys(raw).forEach(function (k) {
      // Reject sister-jurisdiction hangovers outright.
      var lc = k.toLowerCase();
      for (var i = 0; i < REJECTED_KEYS.length; i++) {
        if (lc.indexOf(REJECTED_KEYS[i]) !== -1) {
          warnings.push('Scholar ' + scholarId + ': dropping legacy key "' + k + '"');
          return;
        }
      }
      var canon = ALIASES[k] || k;
      if (CANONICAL_KEYS.indexOf(canon) === -1) {
        warnings.push('Scholar ' + scholarId + ': dropping unknown key "' + k + '"');
        return;
      }
      rec[canon] = coerceValue(canon, raw[k]);
    });

    return rec;
  }

  function migrate(blob) {
    var warnings = [];
    var out = {
      version: 2,
      generated_at: new Date().toISOString(),
      scholars: {}
    };

    if (!blob || typeof blob !== 'object') return { migrated: out, warnings: warnings };

    // Two legacy shapes exist:
    //  (a) { scholars: { <id>: { ... } } }
    //  (b) { <id>: { ... } }   (flat map — original 2025 shape)
    var source = (blob.scholars && typeof blob.scholars === 'object') ? blob.scholars : blob;

    Object.keys(source).forEach(function (id) {
      // Skip metadata keys accidentally left at the top level.
      if (id === 'version' || id === 'generated_at' || id === 'scholars') return;
      var rec = migrateOneScholar(id, source[id], warnings);
      out.scholars[id] = rec;
    });

    return { migrated: out, warnings: warnings };
  }

  global.samoaInsightsMigration = { migrate: migrate };
})(typeof window !== 'undefined' ? window : this);
