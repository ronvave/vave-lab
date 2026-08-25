/*
 * Master-file → Zotero-shape adapter
 * ===================================
 *
 * Produces a { snap, geo, unis, provFlat, profiles, sync, grad, insightsDoc,
 * workplaceCoordsDoc, uniCountryDoc, progressRoster } bundle in the exact shape
 * the production `js/itaukei-database.js` expects, but reading its ground truth
 * from the iTaukei_Master_file JSON snapshots (produced by
 * scripts/master_file_transformer.py).
 *
 * Downstream benefit: every existing render function, panel, filter, map,
 * chord, browser, and export in the production code path continues to work
 * unchanged. The adapter is the *only* file that needs to know that data now
 * comes from a Google Sheet instead of Zotero.
 *
 * Key semantic rules applied here (per Master-file spec):
 *   - Scholar identity → Scholar ID.
 *   - Publication identity → Publication ID / BibTeX Key.
 *   - iTaukei-associated status → Authorship bridge link to a Scholar ID.
 *   - Lead author → Author Position = 1 OR Is First Author? = Yes.
 *   - Institution counts → C_Uni name only (O_Uni is historical metadata).
 *   - Fiji publication geography → Master-file 14 province one-hots +
 *     "Fiji - no province specified" + "Unsure".
 *   - Confederacies: Burebasaga / Kubuna / Tovata (see PROVINCE_TO_CONFED).
 *
 * The Master-file JSON files loaded here all pass through the encrypted gate
 * (js/db-gate.js). Absence of the .enc files → the caller sees a graceful
 * "not-yet-seeded" state.
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------
  // Constants (mirror scripts/master_file_config.py)
  // -------------------------------------------------------------------

  var CONFEDERACIES = {
    Burebasaga: ['Kadavu', 'Nadroga/Navosa', 'Namosi', 'Rewa', 'Serua'],
    Kubuna:     ['Ba', 'Lomaiviti', 'Naitasiri', 'Ra', 'Tailevu'],
    Tovata:     ['Bua', 'Cakaudrove', 'Lau', 'Macuata']
  };
  var PROVINCE_TO_CONFED = {};
  Object.keys(CONFEDERACIES).forEach(function (c) {
    CONFEDERACIES[c].forEach(function (p) { PROVINCE_TO_CONFED[p] = c; });
  });
  var PROVINCES = Object.keys(PROVINCE_TO_CONFED);           // 14 provinces
  var PROVINCE_UNSPEC = 'Fiji - no province specified';
  var PROVINCE_UNSURE = 'Unsure';

  // Master publication-type → Zotero itemType mapping. Theses share the
  // canonical Zotero base type 'thesis' and are further split by an item-level
  // `thesisLevel` field ('phd' | 'masters' | 'other') so the production
  // `visualType()` and every downstream `items.filter(i => i.itemType ===
  // 'thesis')` reader keeps working unchanged.
  var TYPE_MAP = {
    "Journal Article":       'journalArticle',
    "Master's Thesis":       'thesis',
    "PhD Thesis":            'thesis',
    "Other Thesis":          'thesis',
    "Book Chapter":          'bookSection',
    "Book":                  'book',
    "Report":                'report',
    "Conference Paper":      'conferencePaper',
    "Unpublished report":    'preprint',
    "Unpublished":           'preprint',
    "Book Review":           'journalArticle',
    "Others":                'document',
    "Other":                 'document'
  };
  // Master publication-type → thesisLevel ('phd' | 'masters' | 'other').
  var THESIS_LEVEL_MAP = {
    "PhD Thesis":         'phd',
    "Master's Thesis":    'masters',
    "Other Thesis":       'other'
  };
  // Reverse for tag/itemType introspection.
  function zoteroTypeFor(pubType) { return TYPE_MAP[pubType] || 'document'; }
  function thesisLevelFor(pubType) { return THESIS_LEVEL_MAP[pubType] || null; }

  // Parse a Master-sheet year cell into an integer 4-digit year, or return
  // null when the cell is blank, non-numeric, or outside the 1800..2100 sane
  // range. The Master stores Year of Birth / Year of Death as free-text with
  // a ^(\d{4})?$ pattern; this helper isolates that assumption in one place.
  function parseYearOrNull_(cell) {
    if (cell == null) return null;
    var s = String(cell).trim();
    if (s === '') return null;
    if (!/^\d{4}$/.test(s)) return null;
    var n = parseInt(s, 10);
    if (!Number.isFinite(n) || n < 1800 || n > 2100) return null;
    return n;
  }

  // Strip Master 'unknown-value' sentinel strings to '' so downstream
  // renderers can treat them as absent. The Master convention is to
  // populate village / island / district / province cells with the
  // literal string 'Unclassified' when the fact isn't known. Other
  // occasional variants ('Unknown', 'N/A', 'NA', '-') are also collapsed
  // for defensive parity. Comparison is case-insensitive and whitespace-
  // tolerant. Real place names never trigger these sentinels because
  // no iTaukei village / island / district is literally called any of
  // these. (Ron's 2026-08-23 note about Tabudravu's card showing
  // 'Unclassified vlg, Unclassified Is'.)
  var _SENTINELS = { '': 1, 'unclassified': 1, 'unknown': 1, 'n/a': 1, 'na': 1, '-': 1 };
  function cleanSentinel_(cell) {
    if (cell == null) return '';
    var s = String(cell).trim();
    if (!s) return '';
    return _SENTINELS[s.toLowerCase()] ? '' : s;
  }

  // Normalize a Master 'ORCID / Researcher ID' cell to the canonical URL
  // 'https://orcid.org/XXXX-XXXX-XXXX-XXXX'. Accepts either the bare 16-digit
  // ORCID identifier (4 groups of 4 digits/X separated by hyphens) or a full
  // https://orcid.org/ URL. Returns '' when the cell is blank, malformed, or
  // fails the ORCID checksum-shape pattern. Used at the V2 adapter boundary
  // so the composed public profile always exposes `orcidUrl` in canonical
  // form, regardless of how the admin entered it into Admin V2. See the
  // 2026-08-23 V2 ORCID normalization prompt.
  function normalizeOrcidUrl_(cell) {
    if (cell == null) return '';
    var s = String(cell).trim();
    if (!s) return '';
    // Strip a full URL prefix if present (case-insensitive; accept http/https,
    // sandbox / staging / regional ORCID mirrors would still keep their host,
    // which is why we anchor on orcid.org only).
    var m = s.match(/orcid\.org\/([0-9Xx-]{19})$/i);
    var id = m ? m[1] : s;
    id = id.toUpperCase();
    // Strict ORCID identifier shape: 4 groups of 4 chars, last char may be X.
    if (!/^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/.test(id)) return '';
    return 'https://orcid.org/' + id;
  }

  // Deterministic 8-char Zotero-style keys ([A-Z0-9]) from arbitrary strings.
  // Used for synthesized `collections[]` entries so item.collections[] can
  // reference them and every existing panel keeps working.
  function hashKey(s) {
    var h = 5381;
    var str = String(s == null ? '' : s);
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h |= 0;
    }
    // Absolute base-36, zero-pad to 8 upper chars.
    var out = Math.abs(h).toString(36).toUpperCase();
    while (out.length < 8) out = '0' + out;
    return out.slice(0, 8);
  }

  // Canonical name key (mirrors production code: strip diacritics + non-alnum + lowercase)
  var HYPH_RE = /[\u2010\u2011\u2013\u2212]/g;
  function keyifyName(s) {
    return (s || '').replace(HYPH_RE, '-').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Convert "Given Names Family Name" → "Family, Given" (Zotero creator form).
  function toZoteroCreator(scholarName, familyName, givenNames) {
    if (familyName && givenNames) return familyName + ', ' + givenNames;
    if (scholarName && scholarName.indexOf(',') !== -1) return scholarName;
    if (scholarName) {
      // "Ron Vave" → "Vave, Ron"
      var parts = String(scholarName).trim().split(/\s+/);
      if (parts.length >= 2) {
        var last = parts[parts.length - 1];
        var first = parts.slice(0, -1).join(' ');
        return last + ', ' + first;
      }
      return scholarName;
    }
    return '';
  }

  // -------------------------------------------------------------------
  // Fetch helper — passes through the passcode gate.
  // -------------------------------------------------------------------
  function fetchJson(url) {
    if (window.dbGate && typeof window.dbGate.fetchJson === 'function') {
      return window.dbGate.fetchJson(url);
    }
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }

  // -------------------------------------------------------------------
  // Load raw Master JSON (encrypted through the gate).
  // -------------------------------------------------------------------
  function loadRawMaster() {
    // Empty-shell fallback for admin V2 files that may not exist yet on the
    // first deploy. Both files are Scholar-ID keyed maps; a missing file
    // simply means "no admin enrichment yet" and the dashboard degrades
    // gracefully.
    var EMPTY_ADMIN_DOC = { version: 1, scholars: {} };

    return Promise.all([
      fetchJson('data/itaukei-master-scholars.json'),
      fetchJson('data/itaukei-master-publications.json'),
      fetchJson('data/itaukei-master-authorship.json'),
      fetchJson('data/itaukei-master-grad-degrees.json'),
      fetchJson('data/itaukei-master-mobility.json').catch(function () { return []; }),
      fetchJson('data/itaukei-master-geography.json').catch(function () { return []; }),
      fetchJson('data/itaukei-master-aggregates.json'),
      fetchJson('data/last-master-sync.json').catch(function () { return null; }),
      // V1 graduate-studies snapshot — used only as a (country, university)
      // coordinate lookup for Panel B2 world map. Master mobility only has 4
      // coordinate rows; the V1 file has 79 curated worldPoints with lat/lng.
      // If the file is unavailable we still render the panel with no markers
      // rather than fail the whole build.
      fetchJson('data/itaukei-graduate-studies.json').catch(function () { return null; }),
      // Admin V2 enrichment (Scholar-ID keyed): photo path, institution URL,
      // department URL, sector, year of birth, year of death. Optional.
      fetchJson('data/scholar-enrichment.json').catch(function () { return EMPTY_ADMIN_DOC; }),
      // Admin V2 research insights (Scholar-ID keyed): keywords, summaryHtml,
      // sources. Optional.
      fetchJson('data/scholar-insights-master.json').catch(function () { return EMPTY_ADMIN_DOC; })
    ]).then(function (arr) {
      return {
        scholars:     arr[0],
        publications: arr[1],
        authorship:   arr[2],
        gradDegrees:  arr[3],
        mobility:     arr[4],
        geography:    arr[5],
        aggregates:   arr[6],
        lastSync:     arr[7],
        v1GradStudies: arr[8],
        adminEnrichment: arr[9] && arr[9].scholars ? arr[9] : EMPTY_ADMIN_DOC,
        adminInsights:   arr[10] && arr[10].scholars ? arr[10] : EMPTY_ADMIN_DOC
      };
    });
  }

  // -------------------------------------------------------------------
  // Build the Zotero-shape snapshot.
  // -------------------------------------------------------------------
  function buildZoteroSnapshot(master) {
    // Synthesised Zotero-style collection keys.
    var COL_ROOT_ITAUKEI     = 'ITKAROOT';    // "iTaukei authors (>N papers)"
    var COL_BY_WITH          = 'ITKABYWI';    // "By or with iTaukei authors"
    var COL_ROOT_C1_PROV     = 'C1ROOTKY';    // publication-location root
    var COL_NONPROV_FIJI     = 'AREH32KK';    // "_Non-Provincial/Fiji"
    var COL_ROOT_PATERNAL    = 'PATRTROT';    // paternal-province root
    var COL_ROOT_DISCIPLINE  = 'DISCROT0';    // "Discipline" root
    var COL_ROOT_THESIS_UNI  = '9XHGQJE6';    // iTaukei Thesis by Country/Uni
    var COL_ROOT_B3_WHERE    = 'V3HLPDPL';    // "Where study was done" root (Panel B4)
    var COL_B3_FIJI          = 'B3FIJI00';    // Fiji country under B3 root (stable key)

    // Country normalization for Panel B4. Small explicit alias map (per
    // spec: no fuzzy matching). Values must line up with the map's
    // feature names. Extend cautiously.
    var B4_COUNTRY_ALIASES = {
      'FSM': 'Federated States of Micronesia',
      'Federated States of Micronesia': 'Federated States of Micronesia',
      'USA': 'United States',
      'U.S.': 'United States',
      'U.S.A.': 'United States',
      'United States of America': 'United States',
      // Preserve Hawaii and Tahiti as distinct pies (V1 behaviour).
    };
    function b4NormCountry(raw) {
      if (!raw) return '';
      var s = String(raw).trim();
      if (!s) return '';
      return B4_COUNTRY_ALIASES[s] || s;
    }

    // Master Scholar ID → Zotero collection key (author collection).
    // Every scholar becomes a fake iTaukei author sub-collection so the
    // existing "iTaukei author" walkers pick them up.
    var scholarKeyById = {};
    var scholarNameById = {};
    var scholarCollections = [];
    master.scholars.forEach(function (s) {
      var name = toZoteroCreator(s['Scholar Name'], s['Family Name'], s['Given Names']);
      var k = hashKey('scholar:' + s['Scholar ID']);
      scholarKeyById[s['Scholar ID']] = k;
      scholarNameById[s['Scholar ID']] = name;
      scholarCollections.push({ key: k, name: name, parent: COL_ROOT_ITAUKEI });
    });

    // Province collections — publication location + paternal province.
    var provLocKeyByName = {};
    var provPaternalKeyByName = {};
    var provinceCollections = [];
    PROVINCES.forEach(function (p) {
      var locK = hashKey('provloc:' + p);
      var patK = hashKey('provpat:' + p);
      provLocKeyByName[p] = locK;
      provPaternalKeyByName[p] = patK;
      provinceCollections.push({ key: locK, name: p, parent: COL_ROOT_C1_PROV });
      provinceCollections.push({ key: patK, name: p, parent: COL_ROOT_PATERNAL });
    });
    // Add the two special province labels for publication location.
    var provLocUnspecKey = hashKey('provloc:' + PROVINCE_UNSPEC);
    var provLocUnsureKey = hashKey('provloc:' + PROVINCE_UNSURE);
    provLocKeyByName[PROVINCE_UNSPEC] = provLocUnspecKey;
    provLocKeyByName[PROVINCE_UNSURE] = provLocUnsureKey;
    provinceCollections.push({ key: provLocUnspecKey, name: PROVINCE_UNSPEC, parent: COL_ROOT_C1_PROV });
    provinceCollections.push({ key: provLocUnsureKey, name: PROVINCE_UNSURE, parent: COL_ROOT_C1_PROV });

    // Discipline collections — one per unique Primary Discipline / Field.
    var disciplineKeyByName = {};
    var disciplineCollections = [];
    var disciplineSet = new Set();
    master.scholars.forEach(function (s) {
      var d = (s['Primary Discipline / Field'] || '').trim();
      if (d) disciplineSet.add(d);
    });
    disciplineSet.forEach(function (d) {
      var k = hashKey('discipline:' + d);
      disciplineKeyByName[d] = k;
      disciplineCollections.push({ key: k, name: d, parent: COL_ROOT_DISCIPLINE });
    });

    // Panel B4 country collections — one child of V3HLPDPL for every distinct
    // Country value in Master `Research Geography`, plus Fiji (which is coded
    // via province one-hots on Publications rather than as a country row in
    // Research Geography). Fiji keeps its stable key `B3FIJI00`. Every other
    // country receives a deterministic hashKey. Countries with no valid
    // publication in this build will still be emitted so B4 can show a
    // zero-value marker distinct from countries that were never coded.
    //
    // Nested sub-locations — the consumer's B3_SUBLOCATIONS map (in
    // itaukei-database-master.js) drives which named children of a country
    // render at their own coords while rolling up into the parent country's
    // totals (e.g. FSM/Chuuk, United States/Hawaii). Master `Research
    // Geography` uses the human-readable Country label (e.g. `Hawaii (U.S.)`)
    // for these sub-locations. We remap those values so their emitted
    // collection sits under the correct parent country instead of at the
    // V3HLPDPL root.
    var B4_SUBLOC_PARENT = {
      // Master canonical value for the Hawaii study is `Hawaii (U.S.)`;
      // `Hawaii` is included as a defensive alias in case the Sheet value
      // is ever entered without the (U.S.) suffix.
      'Hawaii (U.S.)': 'United States',
      'Hawaii':        'United States',
      // FSM state-level sub-locations. Parent is the Master canonical value
      // `Federated States of Micronesia`; the consumer's B3_SUBLOCATIONS
      // block mirrors this under both `FSM` and the canonical name.
      'Chuuk':         'Federated States of Micronesia',
      'Pohnpei':       'Federated States of Micronesia',
      'Kosrae':        'Federated States of Micronesia',
      'Yap':           'Federated States of Micronesia'
    };
    var b4CountryKeyByName = { 'Fiji': COL_B3_FIJI };
    // First pass — allocate a key for every unique Country value (including
    // sub-location labels) and also make sure any implied parent country has
    // a key allocated even if it never appears as its own Country row.
    (master.geography || []).forEach(function (g) {
      var c = b4NormCountry(g['Country']);
      if (!c) return;
      if (!b4CountryKeyByName[c]) b4CountryKeyByName[c] = hashKey('b4country:' + c);
      var parent = B4_SUBLOC_PARENT[c];
      if (parent && !b4CountryKeyByName[parent]) {
        b4CountryKeyByName[parent] = hashKey('b4country:' + parent);
      }
    });
    // Emit collection rows in stable alphabetical order for display; children
    // hang off their parent country's key when B4_SUBLOC_PARENT applies.
    var b4CountryCollections = [];
    Object.keys(b4CountryKeyByName).sort().forEach(function (name) {
      var parent = B4_SUBLOC_PARENT[name]
        ? b4CountryKeyByName[B4_SUBLOC_PARENT[name]]
        : COL_ROOT_B3_WHERE;
      b4CountryCollections.push({
        key: b4CountryKeyByName[name],
        name: name,
        parent: parent
      });
    });

    // Root collections. The B3-Where-study-was-done root uses the stable key
    // production expects (V3HLPDPL); every direct child is a country emitted
    // dynamically from Master `Research Geography` (see b4CountryCollections
    // above). Fiji keeps the stable child key `B3FIJI00`.
    var rootCollections = [
      { key: COL_ROOT_ITAUKEI, name: 'iTaukei authors (>N papers)', parent: null },
      { key: COL_BY_WITH,      name: 'By or with iTaukei authors', parent: null },
      { key: COL_ROOT_C1_PROV, name: 'C1-Publication location',    parent: null },
      { key: COL_NONPROV_FIJI, name: '_Non-Provincial/Fiji',       parent: COL_ROOT_C1_PROV },
      { key: COL_ROOT_PATERNAL,name: 'Paternal Province',           parent: null },
      { key: COL_ROOT_DISCIPLINE, name: 'Discipline',               parent: null },
      { key: COL_ROOT_THESIS_UNI, name: 'B2-iTaukei Thesis by Country/Universities', parent: null },
      { key: COL_ROOT_B3_WHERE, name: 'B3-Where study was done (with iTaukei lead & co-author)', parent: null }
    ].concat(b4CountryCollections);

    // Build a Scholar ID → discipline collection key lookup for items.
    var disciplineKeyByScholarId = {};
    master.scholars.forEach(function (s) {
      var d = (s['Primary Discipline / Field'] || '').trim();
      if (d) disciplineKeyByScholarId[s['Scholar ID']] = disciplineKeyByName[d];
    });

    // Authorship index: publication ID → array of authorship rows.
    var authByPub = {};
    master.authorship.forEach(function (a) {
      var pid = a['Publication ID / BibTeX Key'];
      if (!pid) return;
      (authByPub[pid] = authByPub[pid] || []).push(a);
    });

    // Geography index: publication ID → array of geography rows.
    var geoByPub = {};
    (master.geography || []).forEach(function (g) {
      var pid = g['Publication ID / BibTeX Key'];
      if (!pid) return;
      (geoByPub[pid] = geoByPub[pid] || []).push(g);
    });

    // Grad-degree index: scholar ID → array of grad episodes.
    var gradByScholar = {};
    master.gradDegrees.forEach(function (g) {
      var sid = g['Scholar ID'];
      if (!sid) return;
      (gradByScholar[sid] = gradByScholar[sid] || []).push(g);
    });

    // ---- Build Zotero items[] from publications ----
    var items = master.publications.map(function (p) {
      var pid = p['Publication ID / BibTeX Key'];
      var itemKey = hashKey('pub:' + pid);
      var itemType = zoteroTypeFor(p['Publication Type']);

      // Bibliographic authorship (from BibTeX/Zotero) drives the citation.
      // The Authorship worksheet is authoritative for iTaukei scholar links
      // but records only iTaukei authors, so it CANNOT tell us who the true
      // first author is when that author is non-iTaukei. Publications sheet
      // column V ('Bibliographic Lead Author', 'Last, First') + column W
      // ('Bibliographic Author Count') carry that ground truth.
      var bibLead = (p['Bibliographic Lead Author'] || p['_bib_lead'] || '').trim();
      var bibAuthorCountRaw = p['Bibliographic Author Count'];
      if (bibAuthorCountRaw === undefined) bibAuthorCountRaw = p['_bib_author_count'];
      var bibAuthorCount = null;
      if (bibAuthorCountRaw !== '' && bibAuthorCountRaw !== null && bibAuthorCountRaw !== undefined) {
        var _n = Number(bibAuthorCountRaw);
        if (Number.isFinite(_n) && _n > 0) bibAuthorCount = _n;
      }

      // Authorship rows (ordered by Author Position) still drive the iTaukei
      // Scholar-ID linkage — lead/co-author hover chips and Panel B2/D counts.
      var authRows = (authByPub[pid] || []).slice().sort(function (a, b) {
        var ap = Number(a['Author Position'] || 0);
        var bp = Number(b['Author Position'] || 0);
        return ap - bp;
      });

      // creators[]: prefer bib lead when known (so downstream code that reads
      // creators[0] — including V1's citation helper — sees the true first
      // author). iTaukei co-authors follow; unresolved bib lead falls back to
      // the Authorship-derived ordering so we still show something.
      var itaukeiScholarNames = authRows.map(function (a) {
        return scholarNameById[a['Scholar ID']] || (a['Author Name as Recorded'] || '');
      }).filter(Boolean);
      var creators;
      if (bibLead) {
        creators = [bibLead].concat(itaukeiScholarNames.filter(function (n) {
          // Avoid duplicating the bib lead when the lead itself is an iTaukei
          // scholar (compare surnames case-insensitively).
          var leadSurn = bibLead.split(',', 1)[0].trim().toLowerCase();
          var nSurn = n.includes(',') ? n.split(',', 1)[0].trim().toLowerCase()
                                       : (n.trim().split(/\s+/).pop() || '').toLowerCase();
          return leadSurn !== nSurn;
        }));
      } else {
        creators = itaukeiScholarNames;
      }

      // Master-file authorship role: 'lead' iff the true bib lead surname
      // matches an iTaukei scholar's Family Name (case-insensitive). When
      // bib lead is unresolved, fall back to the Authorship 'Is First Author?'
      // / Author Position=1 heuristic so display never regresses.
      var masterAuthorship;
      var itaukeiLeadScholarId = '';
      var itaukeiCoauthorScholarIds = [];
      if (authRows.length === 0) {
        masterAuthorship = 'none';
      } else if (bibLead) {
        // Normalize surnames for matching: lowercase, replace unicode hyphens
        // and dashes with ASCII '-', collapse whitespace, strip surrounding
        // punctuation. Handles 'Meo\u2010Sewabu' vs 'Meo-Sewabu' and diacritic
        // edge cases without pulling in a full unicode library.
        function normSurn(s) {
          return String(s || '')
            .trim()
            .toLowerCase()
            .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
            // Collapse ' Jnr'/'Jr'/'Junior'/'Snr'/'Sr'/'Senior' suffixes on a surname to a
            // canonical 'jr'/'sr' token so 'Matanaicake Jnr' matches 'Matanaicake Junior'.
            .replace(/\b(?:jnr|jr|junior)\b\.?/g, 'jr')
            .replace(/\b(?:snr|sr|senior)\b\.?/g, 'sr')
            // Normalize interior whitespace and hyphens so 'Vesikula Bai',
            // 'Vesikula\u2010Bai', and 'vesikula-bai' all collapse to the same key.
            .replace(/[\s\-]+/g, ' ')
            .trim();
        }
        var bibLeadSurname = normSurn(bibLead.split(',', 1)[0]);
        // A bib surname matches a scholar when it equals the scholar's
        // Family Name, matches any hyphen segment of a compound family name
        // (e.g. 'Kitolelei' matches 'Bukarau-Kitolelei'), OR matches the
        // surname on the Authorship row's 'Author Name as Recorded' field
        // (which often preserves the pre-marriage/pre-hyphen name used in
        // the publication).
        function surnameMatches(scholar, authRow) {
          // Prefer exact-string match after normalization (handles hyphen /
          // whitespace / non-ASCII dash variants and Jr/Jnr/Junior aliases).
          var fam = normSurn((scholar && scholar['Family Name']) || '');
          if (fam && fam === bibLeadSurname) return true;
          // The Authorship row's own 'Author Name as Recorded' captures the
          // publication-time surname, which sometimes differs from the current
          // Family Name (e.g. pre-marriage / pre-hyphenation). Use its full
          // surname, not individual tokens, to avoid false positives on shared
          // components of compound surnames like 'Nabobo-Baba' vs 'Baba'.
          var recorded = (authRow && authRow['Author Name as Recorded']) || '';
          if (recorded) {
            var recSurnRaw = recorded.includes(',')
              ? recorded.split(',', 1)[0]
              : (recorded.trim().split(/\s+/).slice(-2).join(' '));
            var recSurn = normSurn(recSurnRaw);
            if (recSurn && recSurn === bibLeadSurname) return true;
          }
          return false;
        }
        var leadHit = null;
        authRows.forEach(function (a) {
          var sid = a['Scholar ID'];
          if (!sid) return;
          var scholar = master.scholars.find(function (s) { return s['Scholar ID'] === sid; });
          if (!leadHit && surnameMatches(scholar, a)) {
            leadHit = a;
          }
        });
        if (leadHit) {
          masterAuthorship = 'lead';
          itaukeiLeadScholarId = leadHit['Scholar ID'];
          authRows.forEach(function (a) {
            var sid = a['Scholar ID'];
            if (sid && sid !== itaukeiLeadScholarId && itaukeiCoauthorScholarIds.indexOf(sid) === -1) {
              itaukeiCoauthorScholarIds.push(sid);
            }
          });
        } else {
          masterAuthorship = 'coauth';
          authRows.forEach(function (a) {
            var sid = a['Scholar ID'];
            if (sid && itaukeiCoauthorScholarIds.indexOf(sid) === -1) {
              itaukeiCoauthorScholarIds.push(sid);
            }
          });
        }
      } else {
        // Bib lead unresolved — fall back to Authorship heuristic.
        var hasITaukeiFirst = authRows.some(function (a) {
          return a['Is First Author?'] === true ||
                 a['Is First Author?'] === 'true' ||
                 a._is_lead === true ||
                 Number(a['Author Position'] || 0) === 1;
        });
        masterAuthorship = hasITaukeiFirst ? 'lead' : 'coauth';
        authRows.forEach(function (a) {
          var sid = a['Scholar ID'];
          if (!sid) return;
          var isLead = (a['Is First Author?'] === true ||
                        a['Is First Author?'] === 'true' ||
                        a._is_lead === true ||
                        Number(a['Author Position'] || 0) === 1);
          if (masterAuthorship === 'lead' && isLead && !itaukeiLeadScholarId) {
            itaukeiLeadScholarId = sid;
          } else if (itaukeiCoauthorScholarIds.indexOf(sid) === -1) {
            itaukeiCoauthorScholarIds.push(sid);
          }
        });
      }

      // Collections: iTaukei author sub-collections for every linked scholar,
      // "By or with iTaukei authors" if any iTaukei scholar is linked, discipline
      // of the FIRST lead-author scholar, and province location keys derived
      // from the publication's Fiji one-hot columns.
      var collections = [];
      var linkedScholarIds = new Set();
      authRows.forEach(function (a) {
        var sid = a['Scholar ID'];
        if (!sid) return;
        linkedScholarIds.add(sid);
        var sk = scholarKeyById[sid];
        if (sk) collections.push(sk);
      });
      if (linkedScholarIds.size > 0) collections.push(COL_BY_WITH);

      // Discipline: assign the discipline of the lead-author scholar, or
      // the first linked scholar as fallback. Lead here means the iTaukei-linked
      // author flagged with `_is_lead` in the Master authorship table.
      var lead = authRows.find(function (a) { return a._is_lead || Number(a['Author Position'] || 0) === 1 && (a['Is First Author?'] === true || a['Is First Author?'] === 'true'); });
      var leadDiscKey = null;
      if (lead && lead['Scholar ID']) {
        leadDiscKey = disciplineKeyByScholarId[lead['Scholar ID']];
      } else if (authRows.length && authRows[0]['Scholar ID']) {
        leadDiscKey = disciplineKeyByScholarId[authRows[0]['Scholar ID']];
      }
      if (leadDiscKey) collections.push(leadDiscKey);

      // Fiji research geography — read from the 14 province one-hots + the
      // two special columns embedded in each publication record.
      var provincesInPub = [];
      PROVINCES.forEach(function (prov) {
        if (Number(p[prov] || 0) > 0) {
          provincesInPub.push(prov);
          collections.push(provLocKeyByName[prov]);
        }
      });
      // Panel B4 "Where study was done" — tag this publication into every
      // country collection its Master `Research Geography` rows reference,
      // plus Fiji when `Tagged Fiji? = Yes` (Fiji is coded via province
      // one-hots on Publications rather than as a country row in Research
      // Geography, so it needs a separate signal). Distinct countries only,
      // to avoid inflating publication counts in a country whose Master
      // geography has multiple rows for the same pub (e.g. multi-village).
      var geoRowsForPub = geoByPub[pid] || [];
      var b4CountriesForPub = new Set();
      geoRowsForPub.forEach(function (g) {
        var c = b4NormCountry(g['Country']);
        if (c && b4CountryKeyByName[c]) b4CountriesForPub.add(c);
      });
      if (String(p['Tagged Fiji?'] || '').toLowerCase() === 'yes') {
        b4CountriesForPub.add('Fiji');
      }
      b4CountriesForPub.forEach(function (c) {
        collections.push(b4CountryKeyByName[c]);
      });

      // Special province labels ("Fiji - no province specified", "Unsure").
      if (Number(p[PROVINCE_UNSPEC] || p['_fiji_unspecified'] || 0) > 0) {
        provincesInPub.push(PROVINCE_UNSPEC);
        collections.push(provLocKeyByName[PROVINCE_UNSPEC]);
        collections.push(COL_NONPROV_FIJI);
      }
      if (Number(p[PROVINCE_UNSURE] || p['_fiji_unsure'] || 0) > 0) {
        provincesInPub.push(PROVINCE_UNSURE);
        collections.push(provLocKeyByName[PROVINCE_UNSURE]);
      }

      // Paternal province: for every linked iTaukei scholar, add their
      // paternal province collection (falling back to maternal) so Panel B
      // "paternal province" filter works.
      authRows.forEach(function (a) {
        var sid = a['Scholar ID'];
        if (!sid) return;
        var scholar = master.scholars.find(function (s) { return s['Scholar ID'] === sid; });
        if (!scholar) return;
        var prov = (scholar['Province Paternal'] || '').trim() || (scholar['Province Maternal'] || '').trim();
        if (prov && provPaternalKeyByName[prov]) collections.push(provPaternalKeyByName[prov]);
      });

      // For theses, also add a country/university collection (COL_ROOT_THESIS_UNI
      // descendant) so the "iTaukei Thesis by Country/Universities" walker picks
      // them up. We keep the descendant tree flat here — one collection per
      // (country|university) pair — because the production walker traverses via
      // parent chain.
      if (itemType === 'thesisMasters' || itemType === 'thesisPhd') {
        // Find the linked scholar's grad episode(s) and pick the one matching
        // thesis level if possible.
        var thesisScholarId = lead ? lead['Scholar ID'] : (authRows[0] && authRows[0]['Scholar ID']);
        var episodes = thesisScholarId ? (gradByScholar[thesisScholarId] || []) : [];
        // Pick a matching-level episode.
        var episode = episodes.find(function (g) {
          var deg = (g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '');
          if (itemType === 'thesisPhd')     return /phd|doctor/i.test(deg);
          if (itemType === 'thesisMasters') return /master/i.test(deg);
          return false;
        }) || episodes[0];
        if (episode) {
          var country = (episode['Country'] || '').trim();
          var uni = (episode['C_Uni name'] || '').trim();
          if (country) {
            var ck = hashKey('thesis-country:' + country);
            collections.push(ck);
            rootCollections.push({ key: ck, name: country, parent: COL_ROOT_THESIS_UNI, _synthesized: true });
          }
          if (uni) {
            var uk = hashKey('thesis-uni:' + uni);
            var pk = country ? hashKey('thesis-country:' + country) : COL_ROOT_THESIS_UNI;
            collections.push(uk);
            rootCollections.push({ key: uk, name: uni, parent: pk, _synthesized: true });
          }
        }
      }

      // Publication metadata for browser (Panel G) and card views.
      var year = Number(p['Year']) || null;
      var publicationTitle = p['Journal / Book Title'] || '';
      var university = '';
      var thesisType = '';
      var thesisLevel = thesisLevelFor(p['Publication Type']);
      if (itemType === 'thesis') {
        if (thesisLevel === 'phd')     thesisType = 'PhD Thesis';
        else if (thesisLevel === 'masters') thesisType = "Master's Thesis";
        else                                thesisType = p['Publication Type'] || 'Thesis';
        // Use publisher/institution/school as the university where present.
        university = p['Publisher / Institution / School'] || p['Journal / Book Title'] || '';
      }

      return {
        key:                itemKey,
        itemType:           itemType,
        title:              p['Title'] || '',
        date:               year ? String(year) : '',
        year:               year,
        creators:           creators,
        tags:               (p['Keywords'] || '').split(/\s*[;|,]\s*/).filter(Boolean),
        collections:        collections,
        publicationTitle:   publicationTitle,
        university:         university,
        thesisType:         thesisType,
        thesisLevel:        thesisLevel,
        DOI:                p['DOI'] || '',
        url:                p['URL'] || '',
        publisher:          p['Publisher / Institution / School'] || '',
        abstractNote:       '',                  // Private per allowlist
        // Master-file specific extras (harmless to the production code):
        _masterPublicationType: p['Publication Type'],
        _masterProvinces:   provincesInPub,
        _masterFiji:        Number(p['Tagged Fiji?'] || 0) > 0,
        _masterITaukei:     p._is_itaukei_associated === true,
        _masterAuthorship:  masterAuthorship,
        _masterPublicationId: pid,
        // Bibliographic authorship (from BibTeX/Zotero, not the Authorship
        // worksheet). B4 citation uses these to render Last (Year) /
        // Last & Last (Year) / Last et al. (Year) using the true first author.
        _bibLead:           bibLead || '',
        _bibAuthorCount:    bibAuthorCount,
        // Scholar-ID linkage for the B4 hover chip: which iTaukei scholar is
        // the lead (when the bib lead matches an iTaukei scholar) and which
        // iTaukei scholars are co-authors. Authorship worksheet is the
        // authoritative Scholar-ID source.
        _itaukeiLeadScholarId:      itaukeiLeadScholarId,
        _itaukeiCoauthorScholarIds: itaukeiCoauthorScholarIds
      };
    });

    // Dedupe synthesized country/uni collections (they can be pushed many times).
    var seenColKeys = new Set();
    var allCollections = rootCollections.concat(scholarCollections)
      .concat(provinceCollections).concat(disciplineCollections)
      .filter(function (c) {
        if (seenColKeys.has(c.key)) return false;
        seenColKeys.add(c.key);
        return true;
      });

    return {
      generatedAt: (master.lastSync && master.lastSync.finishedAt) || new Date().toISOString(),
      items:       items,
      collections: allCollections,
      // Preserve any extra Master metadata for panel-level overrides.
      _master:     master,
      _scholarKeyById: scholarKeyById,
      _provLocKeyByName: provLocKeyByName,
      _provPaternalKeyByName: provPaternalKeyByName,
      _rootKeys: {
        itaukeiAuthors: COL_ROOT_ITAUKEI,
        byWithItaukei:  COL_BY_WITH,
        c1Provinces:    COL_ROOT_C1_PROV,
        nonProvincial:  COL_NONPROV_FIJI,
        paternal:       COL_ROOT_PATERNAL,
        discipline:     COL_ROOT_DISCIPLINE,
        thesisUni:      COL_ROOT_THESIS_UNI
      }
    };
  }

  // -------------------------------------------------------------------
  // Build a fiji-provinces.json flat descriptor from the province → confed map.
  // -------------------------------------------------------------------
  function buildProvFlat(snap) {
    return {
      zoteroCollectionKey_c1Root: snap._rootKeys.c1Provinces,
      zoteroCollectionKey_nonProvincialFiji: snap._rootKeys.nonProvincial,
      provinces: PROVINCES.map(function (p) {
        return {
          name: p,
          confederacy: PROVINCE_TO_CONFED[p],
          zoteroCollectionKey_publicationLocation: snap._provLocKeyByName[p],
          zoteroCollectionKey_paternalProvince: snap._provPaternalKeyByName[p]
        };
      })
    };
  }

  // -------------------------------------------------------------------
  // Build a fiji-provinces.geojson stub — production code uses it for the
  // Panel B choropleth + name-to-collection-key map. We ship an empty feature
  // list with metadata rows so the loop in loadAll() can still index the keys.
  // The actual map rendering will need the real geojson; keep a passthrough
  // to the existing static file if it's available.
  // -------------------------------------------------------------------
  function buildGeoJson(snap) {
    return fetchJson('data/fiji-provinces.geojson').then(function (geo) {
      // Overlay the synthesized keys onto each feature so the existing name→key
      // extractor picks up Master-file keys.
      if (geo && geo.features) {
        geo.features.forEach(function (f) {
          var name = f.properties && f.properties.name;
          if (name && snap._provLocKeyByName[name]) {
            f.properties.zoteroCollectionKey_publicationLocation = snap._provLocKeyByName[name];
          }
          if (name && snap._provPaternalKeyByName[name]) {
            f.properties.zoteroCollectionKey_paternalProvince = snap._provPaternalKeyByName[name];
          }
        });
      }
      return geo;
    }).catch(function () {
      // No geojson available — return an empty FeatureCollection.
      return { type: 'FeatureCollection', features: [] };
    });
  }

  // -------------------------------------------------------------------
  // Build scholar-profiles.json shape from Master scholars.
  // -------------------------------------------------------------------
  function buildProfiles(master, snap) {
    var scholars = master.scholars.map(function (s) {
      var name = toZoteroCreator(s['Scholar Name'], s['Family Name'], s['Given Names']);
      var parts = name.split(',');
      var last = (parts[0] || '').trim();
      var first = (parts[1] || '').trim();
      var paternal = cleanSentinel_(s['Province Paternal']);
      var maternal = cleanSentinel_(s['Province Maternal']);

      // Grad degrees for this scholar.
      var grads = master.gradDegrees.filter(function (g) { return g['Scholar ID'] === s['Scholar ID']; });
      var mastersRow = grads.find(function (g) { return /master/i.test((g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '')); });
      var phdRow     = grads.find(function (g) { return /phd|doctor/i.test((g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '')); });

      // Admin V2 enrichment: Scholar-ID keyed supplementary fields. All
      // optional; missing entry = no enrichment for that scholar.
      var adminExtras = (master.adminEnrichment && master.adminEnrichment.scholars
                          && master.adminEnrichment.scholars[s['Scholar ID']]) || {};

      // Alive / Deceased is a controlled enum in the Master (2026-08-22
      // normalization): {Alive, Deceased, Unknown, ''}. Prefer the exact
      // enum match; fall back to any pre-existing sidecar admin extras
      // that already flag a death year.
      var aliveEnum   = String(s['Alive / Deceased'] || '').trim();
      var masterYoB   = parseYearOrNull_(s['Year of Birth']);
      var masterYoD   = parseYearOrNull_(s['Year of Death']);
      var isDeceased  = (aliveEnum === 'Deceased') ||
                        Number.isFinite(masterYoD) ||
                        Number.isFinite(adminExtras.yearOfDeath);

      return {
        scholarId: s['Scholar ID'],
        zoteroCollectionKey: snap._scholarKeyById[s['Scholar ID']],
        name: name,
        first: first,
        last: last,
        paternalProvince: paternal,
        maternalProvince: maternal,
        paternalDistrict: cleanSentinel_(s['District Paternal']),
        maternalDistrict: cleanSentinel_(s['District Maternal']),
        paternalIsland:   cleanSentinel_(s['Island Paternal']),
        maternalIsland:   cleanSentinel_(s['Island Maternal']),
        effectivePaternalProvince: paternal || maternal || '',
        // Paternal confederacy: Master column if present, else derived from paternal province.
        // (Kept in existing `confederacy` field for backwards-compat with dashboards.)
        confederacy: (s['Paternal Confederacy'] || s._effective_confederacy || PROVINCE_TO_CONFED[paternal] || PROVINCE_TO_CONFED[maternal] || ''),
        paternalConfederacy: (s['Paternal Confederacy'] || PROVINCE_TO_CONFED[paternal] || ''),
        // Maternal confederacy: derived from maternal province via Lookups tab
        // (Doc 1 req #5, #14). Currently read-only — becomes editable once
        // Master write-back auth is approved and Master column is added.
        maternalConfederacy: (PROVINCE_TO_CONFED[maternal] || ''),
        gender: s['Gender'] || '',
        title: s['Current Title / Role'] || '',
        institution: s['Current Institution'] || '',
        institutionCountry: s['Institution Country'] || '',
        department: s['Current Department / Unit'] || '',
        alive: s['Alive / Deceased'] || '',
        // Title / Salutation authoritative in Master (Aug 22 approval).
        // Sidecar adminExtras.salutation is a legacy fallback for any
        // scholars whose Title was populated in the sidecar before it
        // moved into the Master schema.
        salutation:       (s['Title / Salutation'] || adminExtras.salutation || ''),
        // Degrees — mastersUniversity/phdUniversity use C_Uni ONLY per rule.
        mastersUniversity: mastersRow ? mastersRow['C_Uni name'] : '',
        mastersCountry:    mastersRow ? mastersRow['Country'] : '',
        mastersOriginalName: mastersRow ? mastersRow['O_Uni name'] : '',
        phdUniversity:     phdRow ? phdRow['C_Uni name'] : '',
        phdCountry:        phdRow ? phdRow['Country'] : '',
        phdOriginalName:   phdRow ? phdRow['O_Uni name'] : '',
        // Village + island: paternal wins, maternal is a fallback. Both are
        // passed through cleanSentinel_() so Master placeholder strings
        // like 'Unclassified' don't leak into the Panel F meta line.
        // Renderer format:
        //   village + island: 'Malawai vlg, Gau Is · Lomaiviti Province'
        //   village only:     'Malawai vlg · Lomaiviti Province'
        //   island only:      'Gau Is · Lomaiviti Province'
        //   neither:          'Village not yet added · Lomaiviti Province'
        village: cleanSentinel_(s['Village Paternal']) || cleanSentinel_(s['Village Maternal']) || '',
        island:  cleanSentinel_(s['Island Paternal'])  || cleanSentinel_(s['Island Maternal'])  || '',
        subject: s['Primary Discipline / Field'] || '',
        // Canonical V2 property is `orcidUrl` (the renderer expects a URL).
        // The Master field 'ORCID / Researcher ID' may hold a bare 16-digit
        // identifier or a full URL — normalizeOrcidUrl_() collapses both to
        // 'https://orcid.org/<ID>' or '' if malformed. `orcid` is retained
        // as an alias for any legacy V2 caller that still reads it.
        orcidUrl:         normalizeOrcidUrl_(s['ORCID / Researcher ID']),
        orcid:            normalizeOrcidUrl_(s['ORCID / Researcher ID']),
        googleScholarUrl: s['Google Scholar URL'] || '',
        profileUrl:       s['Current Profile URL'] || '',
        // ——— Admin V2 enrichment overlay ———
        photo:            adminExtras.photo || '',
        // V2 per-scholar 'Last update' timestamp. Sourced from
        // scholar-enrichment.json.enc scholars[<sid>].updatedAt, which is
        // written by Admin V2 on every save. Renderer formats it as
        // 'Last update: DD Mon YYYY'. Absent when the scholar has never
        // been touched by Admin V2 — the renderer omits the line rather
        // than fabricating a date. (Master schema unchanged.)
        lastUpdate:       adminExtras.updatedAt || '',
        institutionUrl:   adminExtras.institutionUrl || '',
        departmentUrl:    adminExtras.departmentUrl || '',
        sector:           adminExtras.sector || '',
        // yearOfBirth / yearOfDeath are now sourced from the Master
        // Scholars sheet's structured columns (2026-08-23 approval).
        // Sidecar admin-extras values remain as legacy fallbacks so any
        // pre-existing enrichment doesn't disappear if a Master cell is
        // blank.
        yearOfBirth:      Number.isFinite(masterYoB) ? masterYoB
                          : (Number.isFinite(adminExtras.yearOfBirth) ? adminExtras.yearOfBirth : null),
        yearOfDeath:      Number.isFinite(masterYoD) ? masterYoD
                          : (Number.isFinite(adminExtras.yearOfDeath) ? adminExtras.yearOfDeath : null),
        deceased:         isDeceased
      };
    });
    return {
      scholars: scholars,
      nameAliases: {},          // Master file resolves via Scholar ID; no aliases needed.
      hiddenScholars: [],
      notItaukeiAuthors: []
    };
  }

  // -------------------------------------------------------------------
  // Build itaukei-graduate-studies.json shape.
  //   scholars: { "<name>": { paternal, maternal, mastersRow, phdRow, ... } }
  //   worldPoints: [ { country, city, university, scholars:[...] }, ... ]
  // -------------------------------------------------------------------
  function buildGraduateStudies(master, snap, profilesDoc) {
    var scholarsMap = {};
    profilesDoc.scholars.forEach(function (p) {
      scholarsMap[p.name] = {
        scholarId: p.scholarId,
        paternalProvince: p.paternalProvince,
        maternalProvince: p.maternalProvince,
        effectivePaternalProvince: p.effectivePaternalProvince,
        confederacy: p.confederacy,
        gender: p.gender,
        village: p.village,
        subject: p.subject,
        mastersUniversity: p.mastersUniversity,
        mastersCountry: p.mastersCountry,
        phdUniversity: p.phdUniversity,
        phdCountry: p.phdCountry,
        // Per-degree records for Panel B2 popup scholar-name hover.
        // V1 wirePopupScholarHovers reads rec.title / rec.year / rec.level
        // (with rec.all[] preferred so hovering a scholar at the university
        // popup they graduated from surfaces THAT university's thesis, not
        // an unrelated one). Empty until the gradDegrees pass below fills
        // them in. See lookupScholarThesisForPoint in itaukei-database-master.js.
        phd: null,
        masters: null,
        all: []
      };
    });

    // Attach per-thesis records so Panel B2's scholar-name hover has
    // { title, year, level, university, country } for every hovered name.
    // Also index scholarsMap under the Graduate-Degrees `Scholar Name`
    // spelling so name-shape mismatches between the two sheets can't drop
    // the hover silently.
    master.gradDegrees.forEach(function (g) {
      var sid = g['Scholar ID'];
      if (!sid) return;
      // Find the profile entry for this scholar (canonical "Last, First" key).
      var rec = null;
      profilesDoc.scholars.some(function (p) {
        if (p.scholarId === sid) { rec = scholarsMap[p.name]; return true; }
        return false;
      });
      if (!rec) return;
      var stage = String(g['Degree Stage'] || '').toLowerCase();
      var level = stage.indexOf('phd') !== -1 || stage.indexOf('doctor') !== -1 ? 'phd'
                : stage.indexOf('master') !== -1 ? 'masters'
                : 'other';
      var entry = {
        title:      (g['Thesis / Research Title'] || '').trim(),
        year:       (g['Finish / Completion Year'] || g['Year / Status'] || '').toString().trim(),
        level:      level,
        university: (g['C_Uni name'] || '').trim(),
        country:    (g['Country'] || '').trim()
      };
      rec.all.push(entry);
      if (level === 'phd'     && !rec.phd)     rec.phd     = entry;
      if (level === 'masters' && !rec.masters) rec.masters = entry;
      // Also index under the Master gradDegrees Scholar Name spelling if it
      // differs from the profiles.name key (defensive — normally identical
      // because both derive from Scholars sheet Family/Given cols).
      var gname = (g['Scholar Name'] || '').trim();
      if (gname && !scholarsMap[gname]) scholarsMap[gname] = rec;
    });

    // World points: group grad degrees by (Country, City, C_Uni name).
    var wpByKey = new Map();
    master.gradDegrees.forEach(function (g) {
      var country = (g['Country'] || '').trim();
      var uni = (g['C_Uni name'] || '').trim();
      var city = (g['City'] || '').trim();
      if (!country || !uni) return;
      var key = country + '|' + city + '|' + uni;
      var pt = wpByKey.get(key);
      if (!pt) {
        pt = {
          country: country,
          city: city,
          university: uni,
          region: g['Region'] || '',
          scholarsCount: 0,
          scholars: []
        };
        wpByKey.set(key, pt);
      }
      pt.scholars.push({
        name: g['Scholar Name'] || '',
        scholarId: g['Scholar ID'],
        degree: (g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || ''),
        year: g['Finish / Completion Year'] || g['Year / Status'] || '',
        completed: /^Completed/i.test(g['Completion Status'] || '')
      });
      pt.scholarsCount = pt.scholars.length;
      // Also emit the shape the production world-map / B2-KPI code reads:
      // three parallel arrays of scholar names bucketed by degree level.
      // Ron's Panel B2 KPI computation (renderPanelB2) sums the array
      // lengths per country and derives Universities/Countries totals
      // from the point set, so these arrays must exist on every point.
      if (!pt.mastersScholars) pt.mastersScholars = [];
      if (!pt.phdScholars)     pt.phdScholars = [];
      if (!pt.unknownScholars) pt.unknownScholars = [];
      var stage = (g['Degree Stage'] || '').toLowerCase();
      var scholarName = g['Scholar Name'] || '';
      if (scholarName) {
        if (stage.indexOf('master') !== -1)               pt.mastersScholars.push(scholarName);
        else if (stage.indexOf('phd') !== -1 || stage.indexOf('doctor') !== -1) pt.phdScholars.push(scholarName);
        else                                              pt.unknownScholars.push(scholarName);
      }
    });
    var worldPoints = Array.from(wpByKey.values());

    // Attach lat/lng from the V1 graduate-studies coordinate lookup, keyed
    // primarily by university name (unique across the dataset) with a
    // country+city fallback for universities present under multiple keys.
    // This is why Panel B2 markers went missing in the Master port: Master
    // mobility rows only carry 4 coordinate pairs, so a plain m_lat/m_lon
    // join dropped ~99% of points and the map filtered them all out. The V1
    // snapshot bundles 79 curated coordinates covering every university
    // present in the Master grad-degrees table today.
    var v1 = master.v1GradStudies;
    if (v1 && Array.isArray(v1.worldPoints)) {
      var coordByUni = new Map();
      var coordByCountryUni = new Map();
      v1.worldPoints.forEach(function (v) {
        if (typeof v.lat === 'number' && typeof v.lng === 'number') {
          if (v.university && !coordByUni.has(v.university)) {
            coordByUni.set(v.university, { lat: v.lat, lng: v.lng, iso: v.iso, region: v.region });
          }
          if (v.country && v.university) {
            coordByCountryUni.set(v.country + '|' + v.university, { lat: v.lat, lng: v.lng, iso: v.iso, region: v.region });
          }
        }
      });
      worldPoints.forEach(function (pt) {
        var hit = coordByCountryUni.get(pt.country + '|' + pt.university) || coordByUni.get(pt.university);
        if (hit) {
          pt.lat = hit.lat;
          pt.lng = hit.lng;
          if (!pt.iso    && hit.iso)    pt.iso    = hit.iso;
          if (!pt.region && hit.region) pt.region = hit.region;
        }
      });
    }

    return { scholars: scholarsMap, worldPoints: worldPoints, universities: [] };
  }

  // -------------------------------------------------------------------
  // Build world-universities.json shape.
  // Production code reads `state.universities.universities` as an array of
  // { name, country } entries (see itaukei-database-master.js line 911), so we
  // wrap the raw array into that envelope. Each entry also exposes the extra
  // fields the map/panel-B2 renderers use.
  // -------------------------------------------------------------------
  function buildWorldUniversities(master, snap) {
    var byUni = new Map();
    master.gradDegrees.forEach(function (g) {
      var uni = (g['C_Uni name'] || '').trim();
      if (!uni) return;
      if (byUni.has(uni)) return;
      byUni.set(uni, {
        name: uni,
        university: uni,
        country: (g['Country'] || '').trim(),
        region: (g['Region'] || '').trim(),
        city: (g['City'] || '').trim(),
        zoteroCollectionKey: hashKey('thesis-uni:' + uni),
        // Coords are read from mobility rows when available.
        lat: null,
        lng: null
      });
    });
    (master.mobility || []).forEach(function (m) {
      // Grad-episode side (m_*).
      if (m.m_uni && byUni.has(m.m_uni.trim())) {
        var entry = byUni.get(m.m_uni.trim());
        if (m.m_lat && !entry.lat) entry.lat = m.m_lat;
        if (m.m_lon && !entry.lng) entry.lng = m.m_lon;
      }
    });
    return { universities: Array.from(byUni.values()) };
  }

  // -------------------------------------------------------------------
  // Public entry: return the full { snap, geo, unis, provFlat, profiles,
  // sync, grad, insightsDoc, workplaceCoordsDoc, uniCountryDoc,
  // progressRoster } bundle the production loadAll expects.
  // -------------------------------------------------------------------
  function loadFromMaster() {
    return loadRawMaster().then(function (master) {
      var snap = buildZoteroSnapshot(master);
      return buildGeoJson(snap).then(function (geo) {
        var profiles = buildProfiles(master, snap);
        var grad = buildGraduateStudies(master, snap, profiles);
        var unis = buildWorldUniversities(master, snap);
        // Compose insightsDoc.insights (name-keyed) from the Scholar-ID-keyed
        // admin insights map so the existing dashboard lookup (`state.scholarInsights[name]`)
        // works with zero changes. Also expose the Scholar-ID map on the
        // bundle for future consumers that prefer to join by Scholar ID.
        var insightsByName = {};
        var insightsById = (master.adminInsights && master.adminInsights.scholars) || {};
        master.scholars.forEach(function (s) {
          var rec = insightsById[s['Scholar ID']];
          if (!rec) return;
          var name = toZoteroCreator(s['Scholar Name'], s['Family Name'], s['Given Names']);
          insightsByName[name] = rec;
        });

        return {
          master: master,
          snap: snap,
          geo: geo,
          unis: unis,
          provFlat: buildProvFlat(snap),
          profiles: profiles,
          sync: master.lastSync,
          grad: grad,
          insightsDoc: { insights: insightsByName, byScholarId: insightsById },
          workplaceCoordsDoc: { coords: {} },
          uniCountryDoc: { countryByUniversity: {} },
          progressRoster: master.scholars.map(function (s) {
            var name = toZoteroCreator(s['Scholar Name'], s['Family Name'], s['Given Names']);
            var parts = name.split(',');
            return {
              canonical: name,
              first: (parts[1] || '').trim(),
              last:  (parts[0] || '').trim()
            };
          })
        };
      });
    });
  }

  // ----------------------------------------------------------------------
  // CANONICAL PUBLICATION COUNTS (single source of truth)
  //
  // Reads master.authorship (authoritative) directly. Publication↔scholar
  // links, first-authorship, and per-type breakdowns are all derived from
  //   - `Scholar ID`         : identifies the scholar
  //   - `Publication ID / BibTeX Key` : identifies the paper (deduped)
  //   - `Is First Author?` OR `Author Position === 1` : first-author signal
  //
  // This function is called by both the public dashboard (Panel F card
  // renderer) and the admin dashboard. There is exactly one place where
  // scholar publication counts are computed — this one.
  //
  // Returns { total, firstAuthored, types, gap }
  //   total          — distinct publication count for this scholar
  //   firstAuthored  — distinct publications where this scholar is first author
  //   types          — { journalArticle, thesisPhd, thesisMasters, thesisUnknown,
  //                      bookSection, book, report, conferencePaper, preprint }
  //   gap            — boolean; true if this scholar has zero rows in the
  //                    Authorship table (data-quality flag, not an error).
  //
  // Conference papers are counted in `types.conferencePaper` for the admin's
  // full audit view, but the public dashboard filters `state.snapshot.items`
  // to exclude conferencePaper globally, so Panel F chips won't render them.
  // (see js/itaukei-database-master.js around line 305)
  // ----------------------------------------------------------------------
  function _visualPubType(pubRow) {
    // Mirrors js/itaukei-database-master.js `visualType()` for the
    // Master-native `Publication Type` column, without needing the fully
    // wired item object.
    var t = (pubRow && pubRow['Publication Type']) || '';
    if (t === 'Journal Article')      return 'journalArticle';
    if (t === 'Book')                 return 'book';
    if (t === 'Book Section' || t === 'Book Chapter') return 'bookSection';
    if (t === 'Thesis (PhD)' || t === 'PhD Thesis')   return 'thesisPhd';
    if (t === 'Thesis (Masters)' || t === 'Masters Thesis') return 'thesisMasters';
    if (t === 'Thesis') return 'thesisUnknown';
    if (t === 'Report')               return 'report';
    if (t === 'Preprint')             return 'preprint';
    if (t === 'Conference Paper')     return 'conferencePaper';
    return 'document';
  }

  function _emptyTypesTally() {
    return {
      journalArticle: 0, thesisPhd: 0, thesisMasters: 0, thesisUnknown: 0,
      bookSection: 0, book: 0, report: 0, conferencePaper: 0, preprint: 0, document: 0
    };
  }

  // Build a per-scholar count index once. Called by computePublicationTotals
  // and cached on the master object so the admin + dashboard don't recount
  // for every card in every render pass.
  function _buildScholarCountIndex(master) {
    if (master && master._scholarCountIndex) return master._scholarCountIndex;
    var pubsById = {};
    (master.publications || []).forEach(function (p) {
      var pid = p['Publication ID / BibTeX Key'];
      if (pid) pubsById[pid] = p;
    });
    // scholarId -> { total: Set<pid>, firstAuthored: Set<pid>, types: {...} }
    var idx = {};
    (master.authorship || []).forEach(function (row) {
      var sid = row['Scholar ID'];
      var pid = row['Publication ID / BibTeX Key'];
      if (!sid || !pid) return;
      var bucket = idx[sid];
      if (!bucket) {
        bucket = idx[sid] = {
          totalSet: new Set(),
          firstSet: new Set(),
          typesTotalByPid: {}, // pid -> visualType (dedupes types)
        };
      }
      bucket.totalSet.add(pid);
      var isFirst = row['Is First Author?'] === true ||
                    String(row['Is First Author?']).toLowerCase() === 'true' ||
                    row._is_lead === true ||
                    Number(row['Author Position'] || 0) === 1;
      if (isFirst) bucket.firstSet.add(pid);
      // Record the visualType once per pid — dedupes if a scholar has multiple
      // authorship rows on the same paper.
      if (bucket.typesTotalByPid[pid] === undefined) {
        bucket.typesTotalByPid[pid] = _visualPubType(pubsById[pid] || {});
      }
    });
    if (master) master._scholarCountIndex = idx;
    return idx;
  }

  // Compute per-scholar publication totals from Master Authorship (linked by
  // Scholar ID) and Publications (for the Publication Type).
  //
  // options.excludePreprints (default false): when true, preprints are removed
  //   from `total`, `firstAuthored`, and `types.preprint` (which becomes 0).
  //   Used by the V2 dashboard, which globally excludes preprints from every
  //   displayed metric (2026-08-24 Ron directive). The Master file itself is
  //   untouched — the Publications and Authorship worksheets keep every
  //   preprint row intact; this is a display/calculation subtraction only.
  //   The admin panel and any tooling that wants raw counts leaves this
  //   option unset (default false) and still sees preprints.
  function computePublicationTotals(master, scholarId, options) {
    var opts = options || {};
    var excludePreprints = opts.excludePreprints === true;
    if (!master || !scholarId) {
      return { total: 0, firstAuthored: 0, types: _emptyTypesTally(), gap: true };
    }
    var idx = _buildScholarCountIndex(master);
    var bucket = idx[scholarId];
    if (!bucket) {
      return { total: 0, firstAuthored: 0, types: _emptyTypesTally(), gap: true };
    }
    var types = _emptyTypesTally();
    var preprintPids = new Set();
    Object.keys(bucket.typesTotalByPid).forEach(function (pid) {
      var vt = bucket.typesTotalByPid[pid];
      if (vt === 'preprint') preprintPids.add(pid);
      if (types[vt] !== undefined) types[vt] += 1;
    });
    var total = bucket.totalSet.size;
    var firstAuthored = bucket.firstSet.size;
    if (excludePreprints) {
      // Subtract preprint pids from both the total and the first-author
      // count. bucket.totalSet is dedupe-by-pid so this subtraction is safe.
      preprintPids.forEach(function (pid) {
        if (bucket.totalSet.has(pid)) total -= 1;
        if (bucket.firstSet.has(pid)) firstAuthored -= 1;
      });
      types.preprint = 0;
    }
    return {
      total: total,
      firstAuthored: firstAuthored,
      types: types,
      gap: false
    };
  }

  // Return a list of scholars whose Authorship table is empty or suspiciously
  // sparse. Used by the admin's "Master Authorship linkage gaps" report so Ron
  // can prioritise fixing them in the Master sheet.
  function findAuthorshipLinkageGaps(master, options) {
    options = options || {};
    var threshold = typeof options.sparseBelow === 'number' ? options.sparseBelow : 2;
    var idx = _buildScholarCountIndex(master);
    var gaps = [];
    (master.scholars || []).forEach(function (s) {
      var sid = s['Scholar ID'];
      if (!sid) return;
      var b = idx[sid];
      var total = b ? b.totalSet.size : 0;
      var reason = null;
      if (total === 0) reason = 'no-authorship-rows';
      else if (total < threshold) reason = 'sparse-authorship';
      if (reason) {
        gaps.push({
          scholarId: sid,
          scholarName: s['Scholar Name'] || (s['Family Name'] + ', ' + s['Given Names']),
          total: total,
          reason: reason
        });
      }
    });
    return gaps;
  }

  // Expose to production loadAll (which we patch to call this).
  window.MasterFileAdapter = {
    load: loadFromMaster,
    constants: {
      CONFEDERACIES: CONFEDERACIES,
      PROVINCE_TO_CONFED: PROVINCE_TO_CONFED,
      PROVINCES: PROVINCES,
      PROVINCE_UNSPEC: PROVINCE_UNSPEC,
      PROVINCE_UNSURE: PROVINCE_UNSURE,
      TYPE_MAP: TYPE_MAP
    },
    keyifyName: keyifyName,
    hashKey: hashKey,
    computePublicationTotals: computePublicationTotals,
    findAuthorshipLinkageGaps: findAuthorshipLinkageGaps
  };
})();
