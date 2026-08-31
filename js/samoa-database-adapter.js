/*
 * Samoa Scholarly Database — Master-file adapter
 * ==============================================
 *
 * Reads the encrypted Samoa Master-file JSON snapshots
 * (produced by scripts/samoa_master_file_transformer.py against
 * Master Sheet ID 1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ)
 * and normalises them into a bundle the Samoa dashboard consumes.
 *
 * SIX-DIMENSION GEOGRAPHY — SAMOA-NATIVE, NEVER ALIASED
 * -----------------------------------------------------
 * The Samoa Master Sheet stores six INDEPENDENT geography dimensions.
 * None is derived from another, and none is a rename of an iTaukei / Tongan
 * / Solomon concept. Each has its own lookup worksheet on the Master Sheet
 * and its own set of constants in this file:
 *
 *   1. Statistical Region
 *        Samoa Bureau of Statistics 2021-Census — 4 regions.
 *        Lookup: 'Regions Lookup'
 *        Constants: STATISTICAL_REGIONS, STATISTICAL_REGION_UNSPEC,
 *                   STATISTICAL_REGION_UNSURE
 *
 *   2. Political / Census District
 *        SBS statistical-spine district (2021-Census: 51 districts).
 *        Lookup: 'Region-District Lookup'
 *        Constants: POLITICAL_DISTRICTS, POLITICAL_DISTRICT_TO_REGION,
 *                   POLITICAL_DISTRICT_UNSPEC, POLITICAL_DISTRICT_UNSURE
 *
 *   3. Village
 *        SBS Village Directory — 341 villages.
 *        Lookup: 'Village Geography Lookup'
 *        Constants: VILLAGES, VILLAGE_TO_DISTRICT, VILLAGE_TO_ISLAND,
 *                   VILLAGE_UNSPEC, VILLAGE_UNSURE
 *
 *   4. Specific Island
 *        The named island a village sits on. INDEPENDENT of District —
 *        never inferred from district name. Left blank when the SBS
 *        Village Directory does not give it.
 *        Constants: SPECIFIC_ISLANDS, SPECIFIC_ISLAND_UNSPEC,
 *                   SPECIFIC_ISLAND_UNSURE
 *
 *   5. Traditional Itūmālō
 *        The 11 constitutional districts named in the Second Schedule of
 *        the Constitution. Culturally/politically important; MUST NOT be
 *        substituted for the SBS census district.
 *        Lookup: 'Traditional Itūmālō Lookup'
 *        Constants: TRADITIONAL_ITUMALO, TRADITIONAL_ITUMALO_UNSPEC,
 *                   TRADITIONAL_ITUMALO_UNSURE
 *
 *   6. Electoral Constituency
 *        Time-versioned faipule constituencies. The 2019-Act version
 *        introduced 51 territorial + 2 individual-voter seats used for
 *        the 2021 and 2026 general elections. Historical versions remain
 *        queryable via the electionVersion tag.
 *        Lookup: 'Electoral Constituency Lookup'
 *        Constants: ELECTORAL_CONSTITUENCIES (by version), ELECTORAL_VERSIONS,
 *                   ELECTORAL_CONSTITUENCY_UNSPEC, ELECTORAL_CONSTITUENCY_UNSURE
 *
 * PATERNAL / MATERNAL — each scholar carries all six dimensions on both
 * sides. Paternal is the public default (per owner directive 2026-08-30),
 * but both sides are always available.
 *
 * IMPORTANT: this file does NOT define PROVINCE_*, WARD_*, CONFED_*,
 * TIKINA_*, YASAYASA_*, or any alias for a sister-jurisdiction concept.
 * Doing so would silently paper over the semantic difference; the whole
 * point of the six-dimension model is that these ideas are DIFFERENT and
 * not interchangeable.
 *
 * OUTPUT BUNDLE (returned by load()):
 *   {
 *     scholars       — Map<Scholar ID, Scholar>
 *     publications   — Map<Publication ID, Publication>
 *     authorship     — Array<Authorship link>
 *     researcherAuthorship — Array<Researcher authorship link>
 *     gradDegrees    — Array<Graduate Degree row>
 *     mobility       — Array<Mobility row>
 *     geography      — Array<Research-Geography row>
 *     geographyCoords — Array<Research-Geography coordinate row>
 *     worldPoints    — Array<Country/University coord row for map>
 *     aggregates     — Map<Scholar ID, aggregate metrics>
 *     partIndigenous — Map<Scholar ID, part-indigenous scholar>
 *     bodyComposition — Object with roster/tier composition summary
 *     autoResolved   — Map<Scholar ID, auto-resolved evidence tag>
 *     insights       — Map<Scholar ID, admin insights doc>
 *     workplaceCoords — Map<workplace, {lat, lng}>
 *     uniCountryOverrides — Map<institution, country override>
 *     worldUniversities — Array<University coord row>
 *     districtsGeoJSON — GeoJSON FeatureCollection for the district map
 *     lastSync       — { generatedAt, spreadsheetId, sourceCommit }
 *     geoStats       — { regions: n, districts: n, villages: n,
 *                        traditionalItumalo: n, electoralConstituencies: n }
 *   }
 * ================================================================
 */

(function () {
  'use strict';

  var GATE = 'samoaDbGate';

  // -------------------------------------------------------------------
  // Well-known unresolved-value tokens.
  //
  // The Samoa Master Sheet uses two distinct not-set states:
  //   - '' / null / undefined  → nothing entered yet ("unspecified")
  //   - 'Unsure'               → editor looked and could not determine
  //
  // The dashboard preserves both — the owner directive is that the UI
  // never invites the user to guess and never silently coerces one to
  // the other.
  // -------------------------------------------------------------------
  var STATISTICAL_REGION_UNSPEC   = '(unspecified)';
  var STATISTICAL_REGION_UNSURE   = 'Unsure';
  var POLITICAL_DISTRICT_UNSPEC   = '(unspecified)';
  var POLITICAL_DISTRICT_UNSURE   = 'Unsure';
  var VILLAGE_UNSPEC              = '(unspecified)';
  var VILLAGE_UNSURE              = 'Unsure';
  var SPECIFIC_ISLAND_UNSPEC      = '(unspecified)';
  var SPECIFIC_ISLAND_UNSURE      = 'Unsure';
  var TRADITIONAL_ITUMALO_UNSPEC  = '(unspecified)';
  var TRADITIONAL_ITUMALO_UNSURE  = 'Unsure';
  var ELECTORAL_CONSTITUENCY_UNSPEC = '(unspecified)';
  var ELECTORAL_CONSTITUENCY_UNSURE = 'Unsure';

  // -------------------------------------------------------------------
  // Six-dimension geography constants.
  //
  // Populated at load() time from the Master snapshot
  // (data/samoa-master-geography.json.enc), which itself is derived from
  // the four dedicated lookup worksheets on the Master Sheet. See the
  // header comment for the mapping.
  //
  // NONE of these constants are hard-coded here — they are hydrated from
  // the encrypted snapshot so the dashboard automatically picks up
  // corrections made in the Master Sheet without requiring a code change.
  // -------------------------------------------------------------------
  var _geoState = {
    // dimension 1
    STATISTICAL_REGIONS: [],           // ordered list of region names
    REGION_ID_BY_NAME:   Object.create(null),
    // dimension 2
    POLITICAL_DISTRICTS: [],           // ordered list of district names (current census)
    POLITICAL_DISTRICT_TO_REGION: Object.create(null),
    DISTRICT_ID_BY_NAME: Object.create(null),
    // dimension 3
    VILLAGES:            [],           // ordered list of village names
    VILLAGE_TO_DISTRICT: Object.create(null),
    VILLAGE_TO_ISLAND:   Object.create(null),
    VILLAGE_ID_BY_NAME:  Object.create(null),
    // dimension 4
    SPECIFIC_ISLANDS:    [],           // e.g. Upolu, Savaiʻi, Manono, Apolima, Fanuatapu, Namuʻa, Nuʻulua, Nuʻusafeʻe
    // dimension 5
    TRADITIONAL_ITUMALO: [],           // 11 constitutional districts
    ITUMALO_ID_BY_NAME:  Object.create(null),
    ITUMALO_ALTERNATE:   Object.create(null),  // e.g. 'Aana' → "A'ana", "Ā'ana"
    // dimension 6
    ELECTORAL_CONSTITUENCIES_BY_VERSION: Object.create(null),  // { '2019-Act': [names], ... }
    ELECTORAL_VERSIONS:  [],
    CURRENT_ELECTORAL_VERSION: '2019-Act'
  };

  // -------------------------------------------------------------------
  // Helpers.
  // -------------------------------------------------------------------

  // Canonical key for a display name — lowercase, ASCII-folded, no punctuation.
  // Used for cross-referencing scholar names, village names, etc.
  var HYPH_RE = /[\u2010\u2011\u2013\u2212]/g;
  function keyifyName(s) {
    if (s == null) return '';
    return String(s)
      .replace(HYPH_RE, '-')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // strip diacritics: Savaiʻi → Savaii
      .replace(/[\u02BB\u02BC\u2018\u2019']/g, '')  // strip ʻ/ʼ/'
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  // Deterministic 8-char base-36 hash of a string. Used for stable
  // synthetic IDs when the Master Sheet has a name but no explicit ID.
  function hashKey(s) {
    var str = String(s == null ? '' : s);
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    var out = Math.abs(h).toString(36).toUpperCase();
    while (out.length < 8) out = '0' + out;
    return out.slice(0, 8);
  }

  // Fetch a JSON snapshot through the passcode gate. Never falls back
  // to plaintext fetch — every data file MUST come through the gate so
  // an un-unlocked dashboard cannot leak data.
  function fetchJson(plainPath) {
    var gate = window[GATE];
    if (!gate) {
      return Promise.reject(new Error(
        'samoa-database-adapter: window.samoaDbGate is not loaded'));
    }
    if (!gate.isUnlocked()) {
      return Promise.reject(new Error(
        'samoa-database-adapter: passcode gate is locked — call samoaDbGate.unlock(passcode) first'));
    }
    return gate.decryptFileJSON(plainPath);
  }

  // Fetch a snapshot but tolerate a missing file (return the fallback).
  // Applied to snapshots that are optional on a fresh deploy.
  function fetchJsonOr(plainPath, fallback) {
    return fetchJson(plainPath).catch(function (err) {
      // Only swallow "file not present" errors — auth / crypto errors
      // must propagate so the dashboard shows a real failure.
      var msg = String(err && err.message || err);
      if (/not[ -]?found|404|no such/i.test(msg)) return fallback;
      throw err;
    });
  }

  // Sheet header row-4 name → JS bundle key. Every scholar attribute
  // is stored under its exact Master-Sheet header, so the dashboard
  // can round-trip an edit without a rename table.
  function normaliseScholarRow(row) {
    if (!row || typeof row !== 'object') return null;
    var id = row['Scholar ID'];
    if (!id) return null;
    return {
      id: id,
      displayName: row['Display Name'] || '',
      familyName: row['Family Name'] || '',
      givenNames: row['Given Names'] || '',
      title: row['Title / Salutation'] || '',
      gender: row['Gender'] || '',
      birthYear: row['Birth Year'] || '',
      livingStatus: row['Living Status'] || '',
      deathYear: row['Death Year'] || '',
      photoUrl: row['Photo URL'] || '',
      samoanStatus: row['Samoan Status'] || '',
      inclusionStatus: row['Inclusion Status'] || '',
      identitySourceId: row['Identity Source ID'] || '',
      reviewStatus: row['Review Status'] || '',
      rosterTier: row['Roster Tier'] || '',

      // Six-dimension geography — paternal (public default).
      paternal: {
        statisticalRegion:     row['Statistical Region (Paternal)']         || '',
        politicalDistrict:     row['Political/Census District (Paternal)']  || '',
        traditionalItumalo:    row['Traditional Itūmālō (Paternal)']         || '',
        specificIsland:        row['Specific Island (Paternal)']            || '',
        village:               row['Village (Paternal)']                     || '',
        electoralConstituency: row['Electoral Constituency (Paternal)']     || '',
        electoralVersion:      row['Electoral Version (Paternal)']          || '',
        familyAiga:            row['Family / ʻĀiga (Paternal)']              || '',
        geographySourceId:     row['Paternal Geography Source ID']          || ''
      },
      // Six-dimension geography — maternal.
      maternal: {
        statisticalRegion:     row['Statistical Region (Maternal)']         || '',
        politicalDistrict:     row['Political/Census District (Maternal)']  || '',
        traditionalItumalo:    row['Traditional Itūmālō (Maternal)']         || '',
        specificIsland:        row['Specific Island (Maternal)']            || '',
        village:               row['Village (Maternal)']                     || '',
        electoralConstituency: row['Electoral Constituency (Maternal)']     || '',
        electoralVersion:      row['Electoral Version (Maternal)']          || '',
        familyAiga:            row['Family / ʻĀiga (Maternal)']              || '',
        geographySourceId:     row['Maternal Geography Source ID']          || ''
      },
      // Cultural fields — separate from administrative geography.
      // Never derived from paternal.village or paternal.district.
      cultural: {
        mataiTitle:           row['Matai Title']                    || '',
        mataiTitleVillage:    row['Matai Title Village']            || '',
        customaryAffiliation: row['Customary Affiliation']          || '',
        selfIdentifiedHome:   row['Self-identified Home / Community'] || '',
        evidenceNotes:        row['Cultural Evidence Notes']        || ''
      },

      // Discipline & role.
      primaryDiscipline:      row['Primary Discipline'] || '',
      broadDiscipline:        row['Broad Discipline'] || '',
      currentRole:            row['Current Role'] || '',
      currentInstitutionId:   row['Current Institution ID'] || '',
      currentDepartment:      row['Current Department'] || '',
      currentCountry:         row['Current Country'] || '',
      highestDegree:          row['Highest Completed Degree'] || '',
      currentPostgraduateStatus: row['Current Postgraduate Status'] || '',

      // Identifiers.
      orcid: row['ORCID'] || '',
      googleScholarUrl: row['Google Scholar URL'] || '',
      scopusAuthorId: row['Scopus Author ID'] || '',
      officialProfileUrl: row['Official Profile URL'] || '',
      researchGateUrl: row['ResearchGate URL'] || '',
      personalWebsite: row['Personal Website'] || '',

      // Metrics (server-computed; adapter re-derives from authorship).
      totalCompletedDegrees:  row['Total Completed Degrees'] || 0,
      totalPublications:      row['Total Publications'] || 0,
      totalFirstAuthor:       row['Total First-Author Publications'] || 0,
      totalAwards:            row['Total Awards'] || 0,
      leadershipCategory:     row['Leadership Category'] || '',
      leadershipLevel:        row['Leadership Level'] || '',

      // Misc.
      aliases:      row['Aliases (semicolon-separated)'] || '',
      sourceBasis:  row['Source Basis'] || '',
      notesInternal: row['Notes (internal — never public)'] || '',
      createdAt:    row['Created At'] || '',
      createdBy:    row['Created By'] || '',
      updatedAt:    row['Updated At'] || '',
      updatedBy:    row['Updated By'] || '',

      // Convenience keys.
      _key: keyifyName(row['Display Name'] || (row['Family Name'] + ' ' + row['Given Names']))
    };
  }

  // -------------------------------------------------------------------
  // Hydrate six-dimension geography constants from
  // data/samoa-master-geography.json.enc.
  //
  // The transformer writes this file with the following shape:
  //   {
  //     regions:      [ { regionId, regionName, censusVersion, sourceUrl } ],
  //     districts:    [ { districtId, districtName, regionId, regionName, censusVersion } ],
  //     villages:     [ { villageId, villageName, alternateName, districtId, districtName, regionId, regionName, specificIsland } ],
  //     itumalo:      [ { itumaloId, itumaloName, alternateName, constituents } ],
  //     constituencies: [ { constituencyId, constituencyName, electionVersion, type, memberSeats, includedVillages } ]
  //   }
  // -------------------------------------------------------------------
  function hydrateGeography(geoDoc) {
    var s = _geoState;
    // Reset state (safe on re-load).
    s.STATISTICAL_REGIONS = [];
    s.REGION_ID_BY_NAME = Object.create(null);
    s.POLITICAL_DISTRICTS = [];
    s.POLITICAL_DISTRICT_TO_REGION = Object.create(null);
    s.DISTRICT_ID_BY_NAME = Object.create(null);
    s.VILLAGES = [];
    s.VILLAGE_TO_DISTRICT = Object.create(null);
    s.VILLAGE_TO_ISLAND = Object.create(null);
    s.VILLAGE_ID_BY_NAME = Object.create(null);
    s.SPECIFIC_ISLANDS = [];
    s.TRADITIONAL_ITUMALO = [];
    s.ITUMALO_ID_BY_NAME = Object.create(null);
    s.ITUMALO_ALTERNATE = Object.create(null);
    s.ELECTORAL_CONSTITUENCIES_BY_VERSION = Object.create(null);
    s.ELECTORAL_VERSIONS = [];

    if (!geoDoc || typeof geoDoc !== 'object') return;

    (geoDoc.regions || []).forEach(function (r) {
      if (!r.regionName) return;
      if (s.STATISTICAL_REGIONS.indexOf(r.regionName) === -1) {
        s.STATISTICAL_REGIONS.push(r.regionName);
      }
      s.REGION_ID_BY_NAME[r.regionName] = r.regionId;
    });

    (geoDoc.districts || []).forEach(function (d) {
      if (!d.districtName) return;
      if (s.POLITICAL_DISTRICTS.indexOf(d.districtName) === -1) {
        s.POLITICAL_DISTRICTS.push(d.districtName);
      }
      s.POLITICAL_DISTRICT_TO_REGION[d.districtName] = d.regionName;
      s.DISTRICT_ID_BY_NAME[d.districtName] = d.districtId;
    });

    (geoDoc.villages || []).forEach(function (v) {
      if (!v.villageName) return;
      if (s.VILLAGES.indexOf(v.villageName) === -1) {
        s.VILLAGES.push(v.villageName);
      }
      s.VILLAGE_TO_DISTRICT[v.villageName] = v.districtName;
      // Specific Island is INDEPENDENT — only populate when explicitly given.
      if (v.specificIsland) {
        s.VILLAGE_TO_ISLAND[v.villageName] = v.specificIsland;
        if (s.SPECIFIC_ISLANDS.indexOf(v.specificIsland) === -1) {
          s.SPECIFIC_ISLANDS.push(v.specificIsland);
        }
      }
      s.VILLAGE_ID_BY_NAME[v.villageName] = v.villageId;
    });

    (geoDoc.itumalo || []).forEach(function (it) {
      if (!it.itumaloName) return;
      if (s.TRADITIONAL_ITUMALO.indexOf(it.itumaloName) === -1) {
        s.TRADITIONAL_ITUMALO.push(it.itumaloName);
      }
      s.ITUMALO_ID_BY_NAME[it.itumaloName] = it.itumaloId;
      if (it.alternateName) s.ITUMALO_ALTERNATE[it.itumaloName] = it.alternateName;
    });

    (geoDoc.constituencies || []).forEach(function (c) {
      if (!c.constituencyName) return;
      // The full version string may be verbose (e.g. "2019-Act (Electoral
      // Constituencies Act 2019 ...)"). Bucket by the leading token.
      var versionTag = String(c.electionVersion || '').split(/\s+/)[0] || 'unknown';
      if (s.ELECTORAL_VERSIONS.indexOf(versionTag) === -1) {
        s.ELECTORAL_VERSIONS.push(versionTag);
      }
      var bucket = s.ELECTORAL_CONSTITUENCIES_BY_VERSION[versionTag];
      if (!bucket) {
        bucket = s.ELECTORAL_CONSTITUENCIES_BY_VERSION[versionTag] = [];
      }
      if (bucket.indexOf(c.constituencyName) === -1) {
        bucket.push({
          id: c.constituencyId,
          name: c.constituencyName,
          type: c.type || 'Territorial',
          memberSeats: c.memberSeats || 1,
          includedVillages: (c.includedVillages || '').split(/\s*;\s*/).filter(Boolean)
        });
      }
    });

    // Prefer 2019-Act as the current version if it exists.
    if (s.ELECTORAL_CONSTITUENCIES_BY_VERSION['2019-Act']) {
      s.CURRENT_ELECTORAL_VERSION = '2019-Act';
    } else if (s.ELECTORAL_VERSIONS.length) {
      s.CURRENT_ELECTORAL_VERSION = s.ELECTORAL_VERSIONS[s.ELECTORAL_VERSIONS.length - 1];
    }
  }

  // -------------------------------------------------------------------
  // Compute per-scholar aggregates from the authorship + degree tables.
  // Kept small — the Master snapshot already carries authoritative
  // totals; this recomputes them as a client-side sanity check.
  // -------------------------------------------------------------------
  function computeAggregates(scholarsMap, authorship, gradDegrees) {
    var out = Object.create(null);
    // Initialise every scholar.
    Object.keys(scholarsMap).forEach(function (sid) {
      out[sid] = {
        scholarId: sid,
        totalPublications: 0,
        totalFirstAuthor: 0,
        totalCompletedDegrees: 0
      };
    });
    (authorship || []).forEach(function (link) {
      var sid = link && link['Scholar ID'];
      if (!sid || !out[sid]) return;
      out[sid].totalPublications += 1;
      var pos = String(link['Author Position'] || '').toLowerCase();
      if (pos === 'first' || pos === '1' || link['Is First Author'] === true) {
        out[sid].totalFirstAuthor += 1;
      }
    });
    (gradDegrees || []).forEach(function (row) {
      var sid = row && row['Scholar ID'];
      if (!sid || !out[sid]) return;
      var status = String(row['Degree Status'] || '').toLowerCase();
      if (status === 'completed' || status === 'conferred') {
        out[sid].totalCompletedDegrees += 1;
      }
    });
    return out;
  }

  // -------------------------------------------------------------------
  // Public entry point: load the full bundle.
  // -------------------------------------------------------------------
  function load() {
    var EMPTY_ADMIN_DOC = { version: 1, scholars: {} };

    return Promise.all([
      fetchJson('data/samoa-master-scholars.json'),
      fetchJson('data/samoa-master-publications.json'),
      fetchJson('data/samoa-master-authorship.json'),
      fetchJsonOr('data/samoa-master-researcher-authorship.json', []),
      fetchJsonOr('data/samoa-master-grad-degrees.json', []),
      fetchJsonOr('data/samoa-master-mobility.json', []),
      fetchJsonOr('data/samoa-master-geography.json', {}),
      fetchJsonOr('data/samoa-master-geography-coordinates.json', []),
      fetchJsonOr('data/samoa-master-worldpoints.json', []),
      fetchJsonOr('data/samoa-master-aggregates.json', null),
      fetchJsonOr('data/samoa-master-part-indigenous.json', []),
      fetchJsonOr('data/samoa-body-composition-master.json', null),
      fetchJsonOr('data/samoa-auto-resolved.json', {}),
      fetchJsonOr('data/samoa-scholar-insights.json', EMPTY_ADMIN_DOC),
      fetchJsonOr('data/samoa-workplace-coords.json', {}),
      fetchJsonOr('data/samoa-uni-country-overrides.json', {}),
      fetchJsonOr('data/samoa-world-universities.json', []),
      fetchJsonOr('data/samoa-districts.geojson', { type: 'FeatureCollection', features: [] }),
      fetchJsonOr('data/samoa-last-master-sync.json', null)
    ]).then(function (arr) {
      var rawScholars = arr[0];
      var scholarsMap = Object.create(null);

      // Scholars snapshot may be either an array (row-based dump) or a
      // Scholar-ID keyed map. Normalise both.
      var iter = Array.isArray(rawScholars) ? rawScholars : Object.keys(rawScholars).map(function (k) { return rawScholars[k]; });
      iter.forEach(function (row) {
        var s = normaliseScholarRow(row);
        if (s) scholarsMap[s.id] = s;
      });

      hydrateGeography(arr[6]);

      var authorship = Array.isArray(arr[2]) ? arr[2] : [];
      var gradDegrees = Array.isArray(arr[4]) ? arr[4] : [];

      // If the server-side aggregates snapshot is present prefer it;
      // otherwise recompute from authorship + degrees.
      var aggregates = arr[9] || computeAggregates(scholarsMap, authorship, gradDegrees);

      var partIndigenous = Object.create(null);
      (Array.isArray(arr[10]) ? arr[10] : []).forEach(function (row) {
        var id = row['Scholar ID'];
        if (id) partIndigenous[id] = row;
      });

      var autoResolved = arr[12] && typeof arr[12] === 'object' ? arr[12] : {};
      var insightsDoc = arr[13] && arr[13].scholars ? arr[13] : EMPTY_ADMIN_DOC;

      return {
        // core
        scholars: scholarsMap,
        publications: arr[1] || {},
        authorship: authorship,
        researcherAuthorship: Array.isArray(arr[3]) ? arr[3] : [],
        gradDegrees: gradDegrees,
        mobility: Array.isArray(arr[5]) ? arr[5] : [],
        // geography
        geography: arr[6] || {},
        geographyCoords: Array.isArray(arr[7]) ? arr[7] : [],
        worldPoints: Array.isArray(arr[8]) ? arr[8] : [],
        districtsGeoJSON: arr[17],
        // metrics / audit
        aggregates: aggregates,
        partIndigenous: partIndigenous,
        bodyComposition: arr[11] || null,
        autoResolved: autoResolved,
        insights: insightsDoc.scholars || {},
        // ancillary
        workplaceCoords: arr[14] || {},
        uniCountryOverrides: arr[15] || {},
        worldUniversities: Array.isArray(arr[16]) ? arr[16] : [],
        lastSync: arr[18],
        // six-dimension constants (bound copies)
        geo: {
          statisticalRegions: _geoState.STATISTICAL_REGIONS.slice(),
          regionIdByName: Object.assign({}, _geoState.REGION_ID_BY_NAME),
          politicalDistricts: _geoState.POLITICAL_DISTRICTS.slice(),
          politicalDistrictToRegion: Object.assign({}, _geoState.POLITICAL_DISTRICT_TO_REGION),
          districtIdByName: Object.assign({}, _geoState.DISTRICT_ID_BY_NAME),
          villages: _geoState.VILLAGES.slice(),
          villageToDistrict: Object.assign({}, _geoState.VILLAGE_TO_DISTRICT),
          villageToIsland: Object.assign({}, _geoState.VILLAGE_TO_ISLAND),
          villageIdByName: Object.assign({}, _geoState.VILLAGE_ID_BY_NAME),
          specificIslands: _geoState.SPECIFIC_ISLANDS.slice(),
          traditionalItumalo: _geoState.TRADITIONAL_ITUMALO.slice(),
          itumaloIdByName: Object.assign({}, _geoState.ITUMALO_ID_BY_NAME),
          itumaloAlternate: Object.assign({}, _geoState.ITUMALO_ALTERNATE),
          electoralVersions: _geoState.ELECTORAL_VERSIONS.slice(),
          currentElectoralVersion: _geoState.CURRENT_ELECTORAL_VERSION,
          electoralConstituenciesByVersion: JSON.parse(JSON.stringify(_geoState.ELECTORAL_CONSTITUENCIES_BY_VERSION)),
          // Unresolved-value tokens.
          STATISTICAL_REGION_UNSPEC: STATISTICAL_REGION_UNSPEC,
          STATISTICAL_REGION_UNSURE: STATISTICAL_REGION_UNSURE,
          POLITICAL_DISTRICT_UNSPEC: POLITICAL_DISTRICT_UNSPEC,
          POLITICAL_DISTRICT_UNSURE: POLITICAL_DISTRICT_UNSURE,
          VILLAGE_UNSPEC: VILLAGE_UNSPEC,
          VILLAGE_UNSURE: VILLAGE_UNSURE,
          SPECIFIC_ISLAND_UNSPEC: SPECIFIC_ISLAND_UNSPEC,
          SPECIFIC_ISLAND_UNSURE: SPECIFIC_ISLAND_UNSURE,
          TRADITIONAL_ITUMALO_UNSPEC: TRADITIONAL_ITUMALO_UNSPEC,
          TRADITIONAL_ITUMALO_UNSURE: TRADITIONAL_ITUMALO_UNSURE,
          ELECTORAL_CONSTITUENCY_UNSPEC: ELECTORAL_CONSTITUENCY_UNSPEC,
          ELECTORAL_CONSTITUENCY_UNSURE: ELECTORAL_CONSTITUENCY_UNSURE
        },
        geoStats: {
          regions: _geoState.STATISTICAL_REGIONS.length,
          districts: _geoState.POLITICAL_DISTRICTS.length,
          villages: _geoState.VILLAGES.length,
          specificIslands: _geoState.SPECIFIC_ISLANDS.length,
          traditionalItumalo: _geoState.TRADITIONAL_ITUMALO.length,
          electoralVersions: _geoState.ELECTORAL_VERSIONS.length
        }
      };
    });
  }

  // -------------------------------------------------------------------
  // Compact helpers exposed for panel code.
  // -------------------------------------------------------------------

  // Given a scholar and a preferred side ('paternal'|'maternal'|'both'),
  // return that side's six-dimension record. Never falls back silently
  // to the other side — if the requested side is empty, returns the
  // empty record so downstream code can render the "(unspecified)" tag.
  function geoFor(scholar, side) {
    if (!scholar) return null;
    if (side === 'maternal') return scholar.maternal;
    if (side === 'both') {
      return { paternal: scholar.paternal, maternal: scholar.maternal };
    }
    return scholar.paternal;  // owner default
  }

  // Is the value present enough to count as "resolved" for filter tallies?
  // Anything that is empty or matches one of the unresolved tokens is
  // treated as unresolved.
  function isResolved(v) {
    if (v == null) return false;
    var s = String(v).trim();
    if (!s) return false;
    if (s === STATISTICAL_REGION_UNSPEC || s === STATISTICAL_REGION_UNSURE) return false;
    if (s === POLITICAL_DISTRICT_UNSPEC || s === POLITICAL_DISTRICT_UNSURE) return false;
    if (s === VILLAGE_UNSPEC || s === VILLAGE_UNSURE) return false;
    if (s === SPECIFIC_ISLAND_UNSPEC || s === SPECIFIC_ISLAND_UNSURE) return false;
    if (s === TRADITIONAL_ITUMALO_UNSPEC || s === TRADITIONAL_ITUMALO_UNSURE) return false;
    if (s === ELECTORAL_CONSTITUENCY_UNSPEC || s === ELECTORAL_CONSTITUENCY_UNSURE) return false;
    return true;
  }

  // -------------------------------------------------------------------
  // Export as a Samoa-specific global — NEVER as window.MasterFileAdapter.
  //
  // The sister builds (iTaukei / Tongan / Solomon) hijack that global
  // to keep their cloned dashboard code working; we deliberately break
  // that pattern because the Samoa dashboard has to be aware of the
  // six-dimension shape (which no sister adapter exposes).
  // -------------------------------------------------------------------
  var SAMOA_ADAPTER_API = {
    load: load,
    keyifyName: keyifyName,
    hashKey: hashKey,
    normaliseScholarRow: normaliseScholarRow,
    geoFor: geoFor,
    isResolved: isResolved,
    // Six-dimension constants (exposed lazily so callers see the state
    // after load() has hydrated them). Callers typically read `bundle.geo`
    // from the load() result instead.
    get constants() {
      return {
        STATISTICAL_REGIONS: _geoState.STATISTICAL_REGIONS.slice(),
        POLITICAL_DISTRICTS: _geoState.POLITICAL_DISTRICTS.slice(),
        VILLAGES: _geoState.VILLAGES.slice(),
        SPECIFIC_ISLANDS: _geoState.SPECIFIC_ISLANDS.slice(),
        TRADITIONAL_ITUMALO: _geoState.TRADITIONAL_ITUMALO.slice(),
        ELECTORAL_VERSIONS: _geoState.ELECTORAL_VERSIONS.slice(),
        CURRENT_ELECTORAL_VERSION: _geoState.CURRENT_ELECTORAL_VERSION,
        UNRESOLVED_TOKENS: {
          statisticalRegion:     { unspec: STATISTICAL_REGION_UNSPEC, unsure: STATISTICAL_REGION_UNSURE },
          politicalDistrict:     { unspec: POLITICAL_DISTRICT_UNSPEC, unsure: POLITICAL_DISTRICT_UNSURE },
          village:               { unspec: VILLAGE_UNSPEC, unsure: VILLAGE_UNSURE },
          specificIsland:        { unspec: SPECIFIC_ISLAND_UNSPEC, unsure: SPECIFIC_ISLAND_UNSURE },
          traditionalItumalo:    { unspec: TRADITIONAL_ITUMALO_UNSPEC, unsure: TRADITIONAL_ITUMALO_UNSURE },
          electoralConstituency: { unspec: ELECTORAL_CONSTITUENCY_UNSPEC, unsure: ELECTORAL_CONSTITUENCY_UNSURE }
        }
      };
    }
  };

  window.SamoaScholarDatabaseAdapter = SAMOA_ADAPTER_API;
})();
