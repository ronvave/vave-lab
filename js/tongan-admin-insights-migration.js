/**
 * tongan-admin-insights-migration.js
 *
 * Sister clone of js/admin-insights-migration.js for the Tongan Scholar
 * Database. Client-side one-off migration for the V1 name-keyed
 * research-insights file (data/tongan-scholar-insights.json.enc) to a
 * Scholar-ID-keyed file (data/tongan-scholar-insights-master.json.enc)
 * consumed by the Tongan V2 dashboard. Fully separate data files from the
 * iTaukei system \u2014 never reads or writes an iTaukei-prefixed path.
 *
 * Same relabeling as the rest of the Tongan admin build: District / Island
 * Division / Village-Town(Kolo) / Specific Island geography terms, Fefine /
 * Tangata gender labels, and TON-S#### Scholar IDs \u2014 none of which
 * affect this file's logic since it operates only on Scholar Name / Family
 * Name / Given Names / Scholar ID, which are unchanged field names.
 *
 * Per the approval doc (Aug 22, 2026), key rules:
 *   - The V1 passcode is Ron's browser-side database passcode. He has already
 *     entered it via db-gate.js to unlock this admin session. The migration
 *     therefore uses window.dbGate.fetchJson to decrypt the V1 file in this
 *     same session. NO passcode input UI, NO passcode in code, NO passcode
 *     in any log or migration report.
 *   - Preserve every field of every V1 entry verbatim (keywords, summary
 *     HTML including <a>/<em>/<strong>, summaryFormat, signature, sources,
 *     summarySource, publicationCount, regeneratedAt, lastGeneratedUtc).
 *   - Classify each entry into MATCHED / AMBIGUOUS / UNMATCHED / INVALID and
 *     NEVER discard an unresolved record.
 *   - Do NOT regenerate existing good insights merely because they are
 *     being migrated \u2014 curated summaries survive the round trip unchanged.
 *   - The migration report never contains passcodes, secrets, or PATs.
 *
 * Ambiguity note: V1 was keyed by "Family, Given" strings assembled from
 * Zotero sub-collections. The Master file authoritatively assigns a Scholar
 * ID to each researcher; several Master rows may share a Family+Given (e.g.
 * "Vave, Ron" and a hypothetical "Vave, Ron K."). We resolve by, in order:
 *   1) exact Scholar Name match (case-insensitive)
 *   2) exact Family Name + Given Names match
 *   3) Family Name + first token of Given Names
 * If step 1 or 2 returns exactly one Master row, MATCHED. If step 3 returns
 * two or more, AMBIGUOUS (report all candidates). If nothing matches,
 * UNMATCHED.
 */
(function () {
  'use strict';

  var V1_URL   = 'data/tongan-scholar-insights.json';
  var V2_URL   = 'data/tongan-scholar-insights-master.json';
  var V2_ENC   = 'data/tongan-scholar-insights-master.json.enc';

  // Injected at boot from admin-master.js so we don't depend on internal state.
  var deps = {
    getMaster: function () { return null; },       // () => { scholars: [...] }
    getGhPushHelper: function () { return null; }, // () => async (path, bytes, msg) => void
    logChange: function () {}                      // (evt) => void
  };

  function normName(s) {
    return (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Build lookup tables from the Master scholars list.
  //   byScholarName[normName]        \u2192 [scholarRow, ...]
  //   byFamilyGiven[normName]        \u2192 [scholarRow, ...]  ("family, given")
  //   byFamilyGivenTok1[normName]    \u2192 [scholarRow, ...]  ("family, first-token-of-given")
  function buildScholarIndex(master) {
    var byScholarName = Object.create(null);
    var byFamilyGiven = Object.create(null);
    var byFamilyGivenTok1 = Object.create(null);
    var scholars = (master && master.scholars) || [];
    for (var i = 0; i < scholars.length; i++) {
      var s = scholars[i];
      var scholarName = s['Scholar Name'] || '';
      var family      = s['Family Name'] || '';
      var given       = s['Given Names']  || '';
      if (scholarName) {
        var k1 = normName(scholarName);
        (byScholarName[k1] = byScholarName[k1] || []).push(s);
      }
      if (family && given) {
        var k2 = normName(family + ', ' + given);
        (byFamilyGiven[k2] = byFamilyGiven[k2] || []).push(s);
        var firstTok = given.split(/\s+/)[0] || '';
        if (firstTok && firstTok !== given) {
          var k3 = normName(family + ', ' + firstTok);
          (byFamilyGivenTok1[k3] = byFamilyGivenTok1[k3] || []).push(s);
        }
      }
    }
    return { byScholarName: byScholarName, byFamilyGiven: byFamilyGiven, byFamilyGivenTok1: byFamilyGivenTok1 };
  }

  // Resolve a V1 key string ("Family, Given") to Master rows.
  //   Returns { status, matches, reason }
  //     status  = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'
  //     matches = [scholarRow, ...]
  //     reason  = short string explaining which lookup fired
  function resolveName(v1Key, idx) {
    var n = normName(v1Key);
    if (!n) return { status: 'UNMATCHED', matches: [], reason: 'empty-key' };

    // 1) Exact Scholar Name
    if (idx.byScholarName[n] && idx.byScholarName[n].length === 1) {
      return { status: 'MATCHED', matches: idx.byScholarName[n], reason: 'exact-scholar-name' };
    }
    if (idx.byScholarName[n] && idx.byScholarName[n].length > 1) {
      return { status: 'AMBIGUOUS', matches: idx.byScholarName[n], reason: 'multiple-scholar-name-hits' };
    }

    // 2) Exact Family, Given
    if (idx.byFamilyGiven[n] && idx.byFamilyGiven[n].length === 1) {
      return { status: 'MATCHED', matches: idx.byFamilyGiven[n], reason: 'exact-family-given' };
    }
    if (idx.byFamilyGiven[n] && idx.byFamilyGiven[n].length > 1) {
      return { status: 'AMBIGUOUS', matches: idx.byFamilyGiven[n], reason: 'multiple-family-given-hits' };
    }

    // 3) Family, first-token-of-Given (matches "Tabudravu, Jioji" to "Tabudravu, Jioji N.")
    if (idx.byFamilyGivenTok1[n] && idx.byFamilyGivenTok1[n].length === 1) {
      return { status: 'MATCHED', matches: idx.byFamilyGivenTok1[n], reason: 'family-given-first-token' };
    }
    if (idx.byFamilyGivenTok1[n] && idx.byFamilyGivenTok1[n].length > 1) {
      return { status: 'AMBIGUOUS', matches: idx.byFamilyGivenTok1[n], reason: 'multiple-first-token-hits' };
    }
    return { status: 'UNMATCHED', matches: [], reason: 'no-master-row-with-this-name' };
  }

  // Validate a V1 entry structurally. We require at minimum EITHER keywords
  // (array with \u22651 entries) OR a non-empty summary. Everything else is
  // preserved verbatim.
  function isValidEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    var hasKw = Array.isArray(entry.keywords) && entry.keywords.length >= 1;
    var hasSummary = typeof entry.summary === 'string' && entry.summary.trim().length > 0;
    return hasKw || hasSummary;
  }

  // Run the migration end-to-end. Returns a full result object. Does NOT
  // write anything; the caller decides whether to publish the resulting
  // .enc file.
  async function runMigration() {
    if (!window.dbGate || typeof window.dbGate.fetchJson !== 'function') {
      throw new Error('Database is locked \u2014 unlock the admin first.');
    }
    var master = deps.getMaster();
    if (!master || !Array.isArray(master.scholars) || !master.scholars.length) {
      throw new Error('Master file not loaded yet \u2014 wait for the dashboard to finish loading, then retry.');
    }

    // 1) Read the V1 insight file (name-keyed). This decrypt happens with the
    //    same passcode already unlocked in this admin session; no separate
    //    passcode entry, no passcode in code.
    var v1Doc = await window.dbGate.fetchJson(V1_URL);
    var v1Insights = (v1Doc && v1Doc.insights) || {};

    // 2) Optionally load any EXISTING V2 file so we don't clobber rows already
    //    migrated (or curated) previously. dbGate.fetchJson returns {} on 404.
    var existingV2 = { insights: {} };
    try {
      var e = await window.dbGate.fetchJson(V2_URL);
      if (e && typeof e === 'object' && e.insights && typeof e.insights === 'object') {
        existingV2 = e;
      }
    } catch (_) { /* file may not exist yet; empty is fine */ }

    // 3) Build resolution index against the Master.
    var idx = buildScholarIndex(master);

    // 4) Walk every V1 entry.
    var matched = [];       // [{sid, v1Key, entry, reason}]
    var ambiguous = [];     // [{v1Key, entry, candidates, reason}]
    var unmatched = [];     // [{v1Key, entry, reason}]
    var invalid = [];       // [{v1Key, entry, reason}]
    var keys = Object.keys(v1Insights);
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
      var v1Key = keys[i];
      var entry = v1Insights[v1Key];
      if (!isValidEntry(entry)) {
        invalid.push({ v1Key: v1Key, entry: entry, reason: 'missing-keywords-and-summary' });
        continue;
      }
      var r = resolveName(v1Key, idx);
      if (r.status === 'MATCHED') {
        matched.push({ sid: r.matches[0]['Scholar ID'], v1Key: v1Key, entry: entry, reason: r.reason });
      } else if (r.status === 'AMBIGUOUS') {
        ambiguous.push({
          v1Key: v1Key,
          entry: entry,
          candidates: r.matches.map(function (m) {
            return { sid: m['Scholar ID'], name: m['Scholar Name'], family: m['Family Name'], given: m['Given Names'] };
          }),
          reason: r.reason
        });
      } else {
        unmatched.push({ v1Key: v1Key, entry: entry, reason: r.reason });
      }
    }

    // 5) Build the new V2 document. Start from the existing V2 insights so we
    //    never regress curated work; overlay every MATCHED entry, preserving
    //    every field verbatim and stamping a migration provenance marker.
    var v2Insights = Object.assign({}, existingV2.insights || {});
    var duplicates = []; // [{sid, existingV1Key, incomingV1Key}]
    var sidsWritten = Object.create(null);
    for (var j = 0; j < matched.length; j++) {
      var m = matched[j];
      if (sidsWritten[m.sid]) {
        duplicates.push({ sid: m.sid, existingV1Key: sidsWritten[m.sid], incomingV1Key: m.v1Key });
        // Keep the LATER regeneratedAt timestamp when a collision happens.
        var prev = v2Insights[m.sid];
        var prevTs = (prev && prev.regeneratedAt) || '';
        var incTs  = (m.entry && m.entry.regeneratedAt) || '';
        if (incTs < prevTs) continue; // keep prev
      }
      // Preserve every V1 field verbatim; add sid + migration provenance.
      var out = {};
      Object.keys(m.entry).forEach(function (k) { out[k] = m.entry[k]; });
      out.scholarId          = m.sid;
      out.legacyKey          = m.v1Key;
      out.migrationReason    = m.reason;
      out.migratedAt         = new Date().toISOString();
      v2Insights[m.sid] = out;
      sidsWritten[m.sid] = m.v1Key;
    }

    var v2Doc = {
      schemaVersion: 2,
      generatedBy: 'admin-insights-migration.js',
      generatedAt: new Date().toISOString(),
      insights: v2Insights
    };

    return {
      counts: {
        v1Total: keys.length,
        matched: matched.length,
        ambiguous: ambiguous.length,
        unmatched: unmatched.length,
        invalid: invalid.length,
        duplicateCollisions: duplicates.length,
        v2ExistingBefore: Object.keys(existingV2.insights || {}).length,
        v2TotalAfter: Object.keys(v2Insights).length
      },
      matched: matched,
      ambiguous: ambiguous,
      unmatched: unmatched,
      invalid: invalid,
      duplicates: duplicates,
      v2Doc: v2Doc
    };
  }

  // Encrypt + push the V2 insights file to the repo. Uses the existing GH PAT
  // helper already wired into admin-master.js. Note: this bypasses Master
  // write-back because the insights file is admin-owned enrichment stored in
  // GitHub, not a Master worksheet.
  async function publishV2(v2Doc) {
    if (!window.dbGate || typeof window.dbGate.encryptForUpload !== 'function') {
      throw new Error('Database is locked \u2014 unlock the admin first.');
    }
    var push = deps.getGhPushHelper();
    if (typeof push !== 'function') {
      throw new Error('GitHub push helper not available. Paste a GitHub PAT on the Data source tab, then retry.');
    }
    var plaintext = JSON.stringify(v2Doc, null, 2);
    var bytes = await window.dbGate.encryptForUpload(plaintext);
    await push(V2_ENC, bytes, 'admin: migrate V1 research insights \u2192 Scholar-ID-keyed (matched=' + Object.keys(v2Doc.insights).length + ')');
    deps.logChange({
      actor: 'Ron Vave (admin)',
      action: 'migrate-insights',
      target: V2_ENC,
      note: 'Migrated ' + Object.keys(v2Doc.insights).length + ' insights from V1 name-keyed to Scholar-ID-keyed.'
    });
  }

  // Serialise the report as a JSON blob suitable for download. Explicitly
  // excludes any passcode or secret material (there is none in the pipeline
  // to begin with, but we assert the invariant here).
  function serializeReport(result) {
    var report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      note: 'Migration report for V1 research insights \u2192 Scholar-ID-keyed. Contains no passcodes or secrets.',
      counts: result.counts,
      matched: result.matched.map(function (m) {
        return { sid: m.sid, v1Key: m.v1Key, reason: m.reason };
      }),
      ambiguous: result.ambiguous.map(function (a) {
        return { v1Key: a.v1Key, reason: a.reason, candidates: a.candidates };
      }),
      unmatched: result.unmatched.map(function (u) {
        return { v1Key: u.v1Key, reason: u.reason };
      }),
      invalid: result.invalid.map(function (i) {
        return { v1Key: i.v1Key, reason: i.reason };
      }),
      duplicates: result.duplicates
    };
    return JSON.stringify(report, null, 2);
  }

  // Expose the module.
  window.adminInsightsMigration = {
    install: function (injected) { Object.assign(deps, injected || {}); },
    runMigration: runMigration,
    publishV2: publishV2,
    serializeReport: serializeReport
  };
})();
