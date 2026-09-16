/*
 * Solomon Islands Master-file -> Zotero-shape adapter
 * ==========================================
 *
 * Sister clone of js/tongan-database-adapter.js (Tongan), itself a sister
 * of js/master-file-adapter.js (iTaukei), pointed at the Solomon Islands
 * Master-file JSON snapshots (produced by scripts/solomon_master_file_transformer.py
 * against spreadsheet ID 1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY).
 * Fully separate from the iTaukei/Tongan sister systems -- never reads an
 * iTaukei- or tongan-prefixed data file.
 *
 * Produces a { snap, geo, unis, provFlat, profiles, sync, grad, insightsDoc,
 * workplaceCoordsDoc, uniCountryDoc, progressRoster } bundle in the exact shape
 * the production `js/solomon-database-master.js` expects (itself a clone of
 * `js/tongan-database-master.js` / `js/itaukei-database-master.js`), but
 * reading its ground truth from the Solomon Islands Master-file JSON
 * snapshots.
 *
 * Downstream benefit: every existing render function, panel, filter, map,
 * chord, browser, and export in the production code path continues to work
 * unchanged. The adapter is the *only* file that needs to know that data now
 * comes from a Google Sheet instead of Zotero.
 *
 * ================================================================
 * GEOGRAPHY MODEL -- THE KEY STRUCTURAL DIFFERENCE FROM TONGA/FIJI
 * ================================================================
 * Tonga/iTaukei use a flat two-level model (District -> Island
 * Division / Confederacy). Solomon Islands uses a THREE-level
 * administrative model plus two INDEPENDENT attributes:
 *
 *   Village/Community/Study Site -> Ward -> Province/City Area -> Solomon Islands
 *
 *   - Honiara City is its OWN first-level reporting area with its own 12
 *     wards -- a sibling of the 9 provinces, NOT folded into Guadalcanal.
 *     A combined national total = Honiara + the 9 provinces.
 *   - Specific Island is a SEPARATE, independent attribute from
 *     administrative geography. A ward/province can span multiple islands;
 *     a scholar's origin island may not itself be an administrative unit.
 *     It is NEVER derived from ward/province, and never overwritten by a
 *     ward/province edit.
 *   - Customary/cultural fields (Clan/Tribe/Lineage, Customary Place,
 *     Self-identified Home/Community) are separate from administrative
 *     geography and must never be inferred from it.
 *
 * Internal variable names below intentionally mirror the shape the cloned
 * dashboard JS (js/solomon-database-master.js, js/solomon-panel-overrides.js)
 * expects from the Tongan/iTaukei lineage (PROVINCE_GROUPS, PROVINCE_TO_CONFED,
 * PROVINCES, etc.) so downstream chart/filter/tooltip code runs unmodified --
 * but the *content* of every one of these constants is the real Solomon
 * Islands 9-province + Honiara-City / 182-ward structure (Province-Ward
 * Lookup worksheet in the Master Sheet, Statoids-sourced, pending
 * verification against SIG Gazette No.7 Sup.5, 23 Jan 2024). New,
 * self-documenting aliases (PROVINCE_WARDS, WARD_TO_PROVINCE, WARDS,
 * HONIARA_WARDS, ALL_REPORTING_AREAS) are exposed alongside the legacy
 * names for any Solomon-aware code that wants clearer names.
 *
 * Key semantic rules applied here (per Master-file spec, Solomon Islands):
 *   - Scholar identity -> Scholar ID (SOL-S####).
 *   - Publication identity -> Publication ID / BibTeX Key.
 *   - Solomon-Islander-associated status -> Authorship bridge link to a
 *     Scholar ID (or Researcher Authorship link to a SOL-R#### Researcher ID).
 *   - Lead author -> Author Position = 1 OR Is First Author? = Yes.
 *   - Specific Island is never derived from Ward/Province; Customary
 *     fields (Clan/Tribe/Lineage, Customary Place, Self-identified
 *     Home/Community) are never derived from administrative geography.
 *
 * The Master-file JSON files loaded here all pass through the encrypted
 * gate (js/solomon-db-gate.js). Absence of the .enc files -> the caller
 * sees a graceful "no data yet" / "awaiting verified records" state -- the
 * Master Sheet currently has ZERO scholar/publication/degree data rows
 * (headers + controlled vocabularies only), so this is the expected state
 * until Ron populates real records.
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------
  // Constants -- Solomon Islands' 9 Provinces + Honiara City (10 first-level
  // reporting areas) -> 182 Wards (Province-Ward Lookup worksheet, Statoids
  // Sep 2025, pending verification against SIG Gazette No.7 Sup.5 23 Jan
  // 2024's figure of 172 wards -- see SOLOMON-DASHBOARD-BUILD-NOTES.md).
  // Mirrors scripts/solomon_master_file_config.py PROVINCE_WARDS.
  //
  // PROVINCE_GROUPS/PROVINCE_TO_CONFED/PROVINCES are kept as legacy alias
  // names for structural parity with the Tongan/iTaukei adapters that the
  // cloned dashboard JS still references in some call sites; every one of
  // them now holds real Solomon Province -> Ward content, not a Tongan
  // Island Division or Fijian confederacy.
  // -------------------------------------------------------------------

  var PROVINCE_WARDS = {
    'Central': ['Banika', 'East Gela', 'Lovukol', 'North East Gela', 'North Savo', 'North West Gela', 'Pavuvu', 'Sandfly/Buenavista', 'South East Gela', 'South Savo', 'South West Gela', 'Tulagi'],
    'Choiseul': ['Babatana', 'Bangera', 'Batava', 'Katupika', 'Kerepangara', 'Kirugela', 'Polo', 'Senga', 'Susuka', 'Tavula', 'Tepazaka', 'Vasipuki', 'Viviru', 'Wagina'],
    'Guadalcanal': ['Aola', 'Avuavu', 'Birao', 'Duidui', 'East Ghaobata', 'East Tasimboko', 'Kolokarako', 'Longgu', 'Malango', 'Moli', 'Paripao', 'Saghalu', 'Savulei', 'Talise', 'Tandai', 'Tangarare', 'Tetekanji', 'Valasi', 'Vatukulau', 'Vulolo', 'Wanderer Bay', 'West Ghaobata'],
    'Isabel': ['Baolo', 'Buala', 'Hovikoilo', 'Japuana', 'Kaloka', 'Kia', 'Kmaga', 'Kokota', 'Kolomola', 'Kolotubi', 'Koviloko', 'Samasodu', 'Sigana', 'Susubona', 'Tatamba', 'Tirotongana'],
    'Makira-Ulawa': ['Arosi East', 'Arosi North', 'Arosi South', 'Arosi West', 'Bauro Central', 'Bauro East', 'Bauro West', 'Haununu', 'North Ulawa', 'Rawo', 'Santa Ana', 'Santa Catalina', 'South Ulawa', 'Star Harbour North', 'Star Harbour South', 'Ugi and Pio', 'Wainoni East', 'Wainoni West', 'Weather Coast', 'West Ulawa'],
    'Malaita': ['Aba/Asimeuru', 'Aiaisi', 'Aimela', 'Areare', 'Asimae', 'Auki', 'Buma', 'East Baegu', 'Fauabu', 'Faumamanu/Kwai', 'Fo\'ondo/Gwaiau', 'Fouenda', 'Gulalofou', 'Keaimela/Radefasu', 'Kwarekwareo', 'Langalanga', 'Luaniua', 'Malu\'u', 'Mandalua/Folotana', 'Mareho', 'Matakwalao', 'Nafinua', 'Pelau', 'Raroisu\'u', 'Siesie', 'Sikaiana', 'Sububenu/Burianiasi', 'Sulufou/Kwarande', 'Tai', 'Takwa', 'Waneagu Silana Sina', 'Waneagu/Taelanasina', 'West Baegu/Fataleka'],
    'Rennell-Bellona': ['East Gaongau', 'East Tenggano', 'Kanava', 'Lughu', 'Matangi', 'Mugi Henua', 'Sa\'aiho', 'Te Tau Gangoto', 'West Gaongau', 'West Tenggano'],
    'Temotu': ['Duff Islands', 'Fenualoa', 'Graciosa Bay', 'Lipe/Temua', 'Luva Station', 'Manuopo', 'Nanggu/Lord Howe', 'Nea/Noole', 'Nenumpo', 'Neo', 'Nevenema', 'Nipua/Nopoli', 'North East Santa Cruz', 'Polynesian Outer Islands', 'Tikopia', 'Utupua', 'Vanikoro'],
    'Western': ['Central Ranongga', 'Gizo', 'Inner Shortlands', 'Irringgilla', 'Kolombaghea', 'Kusaghe', 'Mbilua', 'Mbuini Tusu', 'Munda', 'Ndovele', 'Nggatokae', 'Nono', 'Noro', 'North Kolombangara', 'North Ranongga', 'North Rendova', 'North Vangunu', 'Nusa Roviana', 'Outer Shortlands', 'Roviana Lagoon', 'Simbo', 'South Kolombangara', 'South Ranongga', 'South Rendova', 'Vonavona', 'Vonunu'],
    'Honiara City': ['Cruz', 'Kola\'a', 'Kukum', 'Mataniko', 'Mbumburu', 'Naha', 'Nggossi', 'Panatina', 'Rove/Lengakiki', 'Vavaea', 'Vuhokesa', 'Vura']
  };
  var PROVINCE_GROUPS = PROVINCE_WARDS;                 // legacy alias (Province -> [Wards])
  var PROVINCE_TO_CONFED = {};
  Object.keys(PROVINCE_WARDS).forEach(function (prov) {
    PROVINCE_WARDS[prov].forEach(function (ward) { PROVINCE_TO_CONFED[ward] = prov; });
  });
  var WARD_TO_PROVINCE = PROVINCE_TO_CONFED;             // self-documenting alias
  var PROVINCES = Object.keys(PROVINCE_WARDS);           // 9 provinces + Honiara City (10)
  var WARDS = Object.keys(WARD_TO_PROVINCE);             // all 182 wards, flat
  var HONIARA_WARDS = PROVINCE_WARDS['Honiara City'];    // 12 wards, sibling of the 9 provinces
  // Combined national total = the 9 provinces + Honiara City (never fold
  // Honiara into Guadalcanal).
  var ALL_REPORTING_AREAS = PROVINCES;
  var PROVINCE_UNSPEC = 'Solomon Islands - no province specified';
  var PROVINCE_UNSURE = 'Unsure';

  // Human-readable aliases exposed alongside the legacy names above so any
  // Solomon-aware code (solomon-database-master.js / solomon-panel-overrides.js)
  // can read self-documenting names instead of the Tongan/Fijian-shaped
  // originals inherited from the clone lineage.
  var ISLAND_DIVISIONS = PROVINCE_GROUPS;   // legacy alias -- actually Province -> Wards
  var DISTRICT_TO_DIVISION = PROVINCE_TO_CONFED; // legacy alias -- actually Ward -> Province
  var DISTRICTS = WARDS;                    // legacy alias -- actually the 182 wards
  var DISTRICT_UNSPEC = PROVINCE_UNSPEC;
  var DISTRICT_UNSURE = PROVINCE_UNSURE;

  // Specific Island is INDEPENDENT of administrative geography (Province/
  // Ward). Never derive it from Ward/Province, and never let a Ward/
  // Province edit silently overwrite it. Customary/cultural fields
  // (Clan/Tribe/Lineage, Customary Place, Self-identified Home/Community)
  // are likewise independent and must never be inferred from Ward/Province
  // or from Specific Island.
  var GEOGRAPHY_INDEPENDENT_FIELDS = [
    'Specific Island',
    'Paternal Clan/Tribe/Lineage',
    'Maternal Clan/Tribe/Lineage',
    'Customary Place',
    'Self-identified Home/Community'
  ];

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
  // Publication Type is free text in the Master workbook. Normalize known
  // historical variants here so valid outputs do not silently fall through
  // to the generic (and visually muted) `document` type.
  function normalizedPublicationType_(pubType) {
    var raw = String(pubType || '').trim();
    var key = raw.toLowerCase().replace(/\s+/g, ' ');
    if (/^(phd|doctoral|doctorate) thesis$/.test(key)) return 'PhD Thesis';
    if (/^master(?:'s|s)? thesis$/.test(key)) return "Master's Thesis";
    if (key === 'other thesis' || key === 'thesis') return 'Other Thesis';
    if (key === 'journal article / protocol') return 'Journal Article';
    if (/^(book chapter|encyclopedia entry|encyclopedia entry \/ book chapter)$/.test(key)) return 'Book Chapter';
    if (/^(book|edited book|book \/ monograph|monograph|book \/ translation|poetry collection|booklet)$/.test(key)) return 'Book';
    if (/^(report|research report|professional \/ technical report|monograph \/ report|research brief)$/.test(key)) return 'Report';
    return raw;
  }
  function zoteroTypeFor(pubType) { return TYPE_MAP[normalizedPublicationType_(pubType)] || 'document'; }
  function thesisLevelFor(pubType) { return THESIS_LEVEL_MAP[normalizedPublicationType_(pubType)] || null; }

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
      fetchJson('data/solomon-master-scholars.json'),
      fetchJson('data/solomon-master-publications.json'),
      fetchJson('data/solomon-master-authorship.json'),
      // Non-iTaukei researcher authorship links (ITK-R IDs). Panel C2
      // iTaukei view accepts either Scholar-level (`authorship`) or
      // Researcher-level (`researcherAuthorship`) links as evidence that
      // a publication is iTaukei-associated. Optional — empty on error.
      fetchJson('data/solomon-master-researcher-authorship.json')
        .catch(function () { return []; }),
      fetchJson('data/solomon-master-grad-degrees.json'),
      fetchJson('data/solomon-master-mobility.json').catch(function () { return []; }),
      fetchJson('data/solomon-master-geography.json').catch(function () { return []; }),
      fetchJson('data/solomon-master-geography-coordinates.json').catch(function () { return []; }),
      fetchJson('data/solomon-master-aggregates.json'),
      fetchJson('data/solomon-last-master-sync.json').catch(function () { return null; }),
      // V1 graduate-studies snapshot — used only as a (country, university)
      // coordinate lookup for Panel B2 world map. Master mobility only has 4
      // coordinate rows; the V1 file has 79 curated worldPoints with lat/lng.
      // If the file is unavailable we still render the panel with no markers
      // rather than fail the whole build.
      fetchJson('data/solomon-graduate-studies.json').catch(function () { return null; }),
      // Master-derived Panel B2 world-points payload (country → university
      // → scholar drill-down). Authoritative source per the 2026-08-25
      // "V2 Panel B2 Country-University Drilldown Repair" spec. Built by
      // scripts/master_b2_worldpoints.py. When present, this REPLACES the
      // adapter's JS-side aggregation and ensures completion filtering,
      // discipline-string rejection, and canonical C_Uni grouping match
      // the Python contract. Optional — the JS adapter still contains a
      // legacy path so an older deploy without this file still renders.
      fetchJson('data/solomon-master-worldpoints.json').catch(function () { return null; }),
      // Admin V2 enrichment (Scholar-ID keyed): photo path, institution URL,
      // department URL, sector, year of birth, year of death. Optional.
      fetchJson('data/solomon-scholar-enrichment.json').catch(function () { return EMPTY_ADMIN_DOC; }),
      // Admin V2 research insights (Scholar-ID keyed): keywords, summaryHtml,
      // sources. Optional.
      fetchJson('data/solomon-scholar-insights-master.json').catch(function () { return EMPTY_ADMIN_DOC; })
    ]).then(function (arr) {
      return {
        scholars:            arr[0],
        publications:        arr[1],
        authorship:          arr[2],
        researcherAuthorship: arr[3],
        gradDegrees:         arr[4],
        mobility:            arr[5],
        geography:           arr[6],
        geographyCoordinates: arr[7],
        aggregates:          arr[8],
        lastSync:            arr[9],
        v1GradStudies:       arr[10],
        masterWorldPoints:   arr[11],
        adminEnrichment:     arr[12] && arr[12].scholars ? arr[12] : EMPTY_ADMIN_DOC,
        adminInsights:       arr[13] && arr[13].scholars ? arr[13] : EMPTY_ADMIN_DOC
      };
    });
  }

  // -------------------------------------------------------------------
  // Build the Zotero-shape snapshot.
  // -------------------------------------------------------------------
  function buildZoteroSnapshot(master) {
    // Synthesised Zotero-style collection keys.
    var COL_ROOT_ITAUKEI     = 'TONAROOT';    // "Solomon Islands authors (>N papers)"
    var COL_BY_WITH          = 'TONABYWI';    // "By or with Solomon Islands authors"
    var COL_ROOT_C1_PROV     = 'C1ROOTKY';    // publication-location root
    var COL_NONPROV_FIJI     = 'AREH32KK';    // "_Non-District/Solomon Islands"
    var COL_ROOT_PATERNAL    = 'PATRTROT';    // paternal-district root
    var COL_ROOT_DISCIPLINE  = 'DISCROT0';    // "Discipline" root
    var COL_ROOT_THESIS_UNI  = '9XHGQJE6';    // Solomon Islands Thesis by Country/Uni
    var COL_ROOT_B3_WHERE    = 'V3HLPDPL';    // "Where study was done" root (Panel B4)
    var COL_B3_SOLOMONISLANDS         = 'B3SOLOMONISLANDS0';    // Solomon Islands country under B4 root (stable key)

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
    // Every scholar becomes a fake Solomon Islands author sub-collection so the
    // existing "Solomon Islands author" walkers pick them up.
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
    // Country value in Master `Research Geography`. Solomon Islands keeps a stable key;
    // every other
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
    var b4CountryKeyByName = { 'Solomon Islands': COL_B3_SOLOMONISLANDS };
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
    // above). Solomon Islands keeps the stable child key `B3SOLOMONISLANDS0`.
    var rootCollections = [
      { key: COL_ROOT_ITAUKEI, name: 'Solomon Islands authors (>N papers)', parent: null },
      { key: COL_BY_WITH,      name: 'By or with Solomon Islands authors', parent: null },
      { key: COL_ROOT_C1_PROV, name: 'C1-Publication location',    parent: null },
      { key: COL_NONPROV_FIJI, name: '_Non-District/Solomon Islands',       parent: COL_ROOT_C1_PROV },
      { key: COL_ROOT_PATERNAL,name: 'Paternal District',           parent: null },
      { key: COL_ROOT_DISCIPLINE, name: 'Discipline',               parent: null },
      { key: COL_ROOT_THESIS_UNI, name: 'B2-Solomon Islands Thesis by Country/Universities', parent: null },
      { key: COL_ROOT_B3_WHERE, name: 'B3-Where study was done (with Solomon Islands lead & co-author)', parent: null }
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

    // Researcher Authorship is the parallel authoritative bridge for Solomon Islands
    // researchers who do not yet have a Scholar ID.  Keep it separate from
    // the scholar bridge, but carry both through to Panel B4 so an
    // others-led publication can still feature its linked Solomon Islands people.
    var researcherAuthByPub = {};
    (master.researcherAuthorship || []).forEach(function (a) {
      var pid = a['Publication ID / BibTeX Key'];
      if (!pid) return;
      (researcherAuthByPub[pid] = researcherAuthByPub[pid] || []).push(a);
    });

    // Geography index: publication ID → verified/manual evidence rows.
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

      // Authorship rows (ordered by Author Position) still drive the iTaukei/Solomon Islands
      // Scholar-ID linkage — lead/co-author hover chips and Panel B2/D counts.
      var authRows = (authByPub[pid] || []).slice().sort(function (a, b) {
        var ap = Number(a['Author Position'] || 0);
        var bp = Number(b['Author Position'] || 0);
        return ap - bp;
      });
      var researcherAuthRows = (researcherAuthByPub[pid] || []).slice().sort(function (a, b) {
        return Number(a['Author Position'] || 0) - Number(b['Author Position'] || 0);
      });

      // creators[]: prefer bib lead when known (so downstream code that reads
      // creators[0] — including V1's citation helper — sees the true first
      // author). iTaukei co-authors follow; unresolved bib lead falls back to
      // the Authorship-derived ordering so we still show something.
      var itaukeiScholarNames = authRows.map(function (a) {
        return scholarNameById[a['Scholar ID']] || (a['Author Name as Recorded'] || '');
      }).filter(Boolean);
      var solomonResearcherNames = researcherAuthRows.map(function (a) {
        return a['Researcher Name'] || a['Author Name as Recorded'] || a['Researcher ID'] || '';
      }).filter(Boolean);
      var creators;
      if (bibLead) {
        creators = [bibLead].concat(itaukeiScholarNames.concat(solomonResearcherNames).filter(function (n) {
          // Avoid duplicating the bib lead when the lead itself is an iTaukei
          // scholar (compare surnames case-insensitively).
          var leadSurn = bibLead.split(',', 1)[0].trim().toLowerCase();
          var nSurn = n.includes(',') ? n.split(',', 1)[0].trim().toLowerCase()
                                       : (n.trim().split(/\s+/).pop() || '').toLowerCase();
          return leadSurn !== nSurn;
        }));
      } else {
        creators = itaukeiScholarNames.concat(solomonResearcherNames);
      }

      // Master-file authorship role: 'lead' iff the true bib lead surname
      // matches an iTaukei scholar's Family Name (case-insensitive). When
      // bib lead is unresolved, fall back to the Authorship 'Is First Author?'
      // / Author Position=1 heuristic so display never regresses.
      var masterAuthorship;
      var itaukeiLeadScholarId = '';
      var itaukeiCoauthorScholarIds = [];
      if (authRows.length === 0) {
        var researcherLead = researcherAuthRows.some(function (a) {
          return a['Is First Author?'] === true || a['Is First Author?'] === 'true' ||
                 a._is_lead === true || Number(a['Author Position'] || 0) === 1;
        });
        masterAuthorship = researcherAuthRows.length ? (researcherLead ? 'lead' : 'coauth') : 'none';
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

      // A first-author Researcher Authorship row is just as authoritative as
      // a first-author Scholar Authorship row. This matters for Solomon Islands
      // researchers who have not yet been promoted into the Scholars table.
      if (researcherAuthRows.some(function (a) {
        return a['Is First Author?'] === true || a['Is First Author?'] === 'true' ||
               a._is_lead === true || Number(a['Author Position'] || 0) === 1;
      })) {
        masterAuthorship = 'lead';
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

      // A Researcher Authorship link is equally authoritative evidence that
      // the work is by/with a Solomon Islands person, even when no Scholar row exists.
      if (researcherAuthRows.length > 0 && collections.indexOf(COL_BY_WITH) === -1) {
        collections.push(COL_BY_WITH);
      }

      // Discipline: assign the discipline of the lead-author scholar, or
      // the first linked scholar as fallback. Lead here means the iTaukei/Solomon Islands-linked
      // author flagged with `_is_lead` in the Master authorship table.
      var lead = authRows.find(function (a) { return a._is_lead || Number(a['Author Position'] || 0) === 1 && (a['Is First Author?'] === true || a['Is First Author?'] === 'true'); });
      var leadDiscKey = null;
      if (lead && lead['Scholar ID']) {
        leadDiscKey = disciplineKeyByScholarId[lead['Scholar ID']];
      } else if (authRows.length && authRows[0]['Scholar ID']) {
        leadDiscKey = disciplineKeyByScholarId[authRows[0]['Scholar ID']];
      }
      if (leadDiscKey) collections.push(leadDiscKey);

      // Solomon Islands research geography — DERIVED FROM `Research Geography`, not
      // from the legacy per-Publication district Yes/blank columns.  The
      // authoritative path for the within-Solomon Islands panels is
      // Publication → Research Geography → verified Solomon Islands location →
      // (publication type filter applied downstream) → COUNT DISTINCT
      // Publication ID. See `docs/panel-c2-geography.md` (added in this
      // repair) for the full rationale.
      //
      // We accept any Research Geography row where:
      //   • Country = "Fiji", AND
      //   • Verification starts with "Verified" (case-insensitive) OR is
      //     the sentinel value "Strong" (mirrors the Master Dashboard's
      //     `REGEXMATCH(...,"^Verified")` predicate plus the small legacy
      //     `Strong` bucket).
      //
      // A publication with verified evidence in multiple Fiji provinces
      // counts once in EACH province (multi-province is not collapsed).
      // A publication is placed into `Fiji - no province specified` iff
      // Research Geography explicitly records that value for it — the
      // legacy Publications!AL Yes flag is no longer consulted.
      var geoRowsForPub = geoByPub[pid] || [];
      var provincesInPub = [];
      var islandDivisionsInPub = [];
      var specificIslandsInPub = [];
      var researchSitesInPub = [];
      var verifiedGeographyRows = [];
      var seenProvForPub = new Set();
      var seenDivisionForPub = new Set();
      var seenIslandForPub = new Set();
      var seenSiteForPub = new Set();
      geoRowsForPub.forEach(function (g) {
        var verif = String(g['Verification'] || '').trim();
        var verifOk = /^verified/i.test(verif) || verif.toLowerCase() === 'strong';
        if (!verifOk) return;
        var rowCountry = b4NormCountry(g['Country']);
        verifiedGeographyRows.push({
          country: rowCountry,
          islandDivision: String(g['Province/City Area (auto from District)'] || '').trim(),
          district: String(g['District'] || '').trim(),
          specificIsland: String(g['Specific Island'] || '').trim(),
          site: String(g['Village / Town / Site'] || '').trim(),
          geographyType: String(g['Geography Type'] || '').trim(),
          verification: verif
        });
        if (rowCountry !== 'Solomon Islands') return;
        var division = String(g['Province/City Area (auto from District)'] || '').trim();
        var prov = String(g['District'] || '').trim();
        var island = String(g['Specific Island'] || '').trim();
        var site = String(g['Village / Town / Site'] || '').trim();
        if (!division && prov && PROVINCE_TO_CONFED[prov]) division = PROVINCE_TO_CONFED[prov];
        if (division && !seenDivisionForPub.has(division)) {
          seenDivisionForPub.add(division);
          islandDivisionsInPub.push(division);
        }
        if (island && !seenIslandForPub.has(island)) {
          seenIslandForPub.add(island); specificIslandsInPub.push(island);
        }
        if (site && !seenSiteForPub.has(site)) {
          seenSiteForPub.add(site); researchSitesInPub.push(site);
        }
        if (!prov) return;
        if (seenProvForPub.has(prov)) return;
        seenProvForPub.add(prov);
        if (PROVINCE_TO_CONFED[prov]) {
          // Named province
          provincesInPub.push(prov);
          collections.push(provLocKeyByName[prov]);
        } else if (prov === PROVINCE_UNSPEC) {
          provincesInPub.push(PROVINCE_UNSPEC);
          collections.push(provLocKeyByName[PROVINCE_UNSPEC]);
          collections.push(COL_NONPROV_FIJI);
        } else if (prov === PROVINCE_UNSURE || prov === 'Unclassified') {
          provincesInPub.push(PROVINCE_UNSURE);
          collections.push(provLocKeyByName[PROVINCE_UNSURE]);
        }
        // Any other value (e.g. an ad-hoc note) is ignored; the province
        // must match a known bucket to affect Panel C2.
      });

      // Panel B4 — tag a publication into each DISTINCT verified research
      // country recorded in the Master evidence bridge.  Multiple island,
      // district, village, or site rows in one country therefore count once
      // for that country.  Do not infer study country from author affiliation,
      // title text, or the legacy Tagged Solomon Islands? field.
      var b4CountriesForPub = new Set();
      geoRowsForPub.forEach(function (g) {
        var verif = String(g['Verification'] || '').trim();
        if (!(/^verified/i.test(verif) || verif.toLowerCase() === 'strong')) return;
        var c = b4NormCountry(g['Country']);
        if (c && b4CountryKeyByName[c]) b4CountriesForPub.add(c);
      });
      b4CountriesForPub.forEach(function (c) {
        collections.push(b4CountryKeyByName[c]);
      });

      // Paternal province: for every linked iTaukei scholar, add their
      // paternal province collection (falling back to maternal) so Panel B
      // "paternal province" filter works.
      authRows.forEach(function (a) {
        var sid = a['Scholar ID'];
        if (!sid) return;
        var scholar = master.scholars.find(function (s) { return s['Scholar ID'] === sid; });
        if (!scholar) return;
        var prov = cleanSentinel_(scholar['Paternal Ward'] || scholar['Paternal Province/City Area']) ||
                   cleanSentinel_(scholar['Maternal Ward'] || scholar['Maternal Province/City Area']);
        if (prov && provPaternalKeyByName[prov]) collections.push(provPaternalKeyByName[prov]);
      });

      // For theses, also add a country/university collection (COL_ROOT_THESIS_UNI
      // descendant) so the "iTaukei Thesis by Country/Universities" walker picks
      // them up. We keep the descendant tree flat here — one collection per
      // (country|university) pair — because the production walker traverses via
      // parent chain.
      if (itemType === 'thesis') {
        // Find the linked scholar's grad episode(s) and pick the one matching
        // thesis level if possible.
        var thesisScholarId = lead ? lead['Scholar ID'] : (authRows[0] && authRows[0]['Scholar ID']);
        var episodes = thesisScholarId ? (gradByScholar[thesisScholarId] || []) : [];
        // Pick a matching-level episode.
        var episode = episodes.find(function (g) {
          var deg = (g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '');
          var level = thesisLevelFor(p['Publication Type']);
          if (level === 'phd')     return /phd|doctor/i.test(deg);
          if (level === 'masters') return /master/i.test(deg);
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
        _masterIslandDivisions: islandDivisionsInPub,
        _masterSpecificIslands: specificIslandsInPub,
        _masterResearchSites: researchSitesInPub,
        // Verified evidence rows are retained so B4 can switch from one
        // deduplicated country marker at world scale to the publication's
        // individual Solomon Islands study sites at close zoom.
        _masterGeographyRows: verifiedGeographyRows,
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
        _itaukeiCoauthorScholarIds: itaukeiCoauthorScholarIds,
        _linkedSolomonIslandsScholarNames: Array.from(linkedScholarIds).map(function (sid) {
          return scholarNameById[sid] || sid;
        }),
        // Canonical identity payload for B4.  Do not make the popup infer
        // Indigenous participation from an incomplete bibliographic creator
        // list: these two bridge sheets are the source of truth.
        _linkedSolomonIslandsPeople: authRows.map(function (a) {
          var sid = a['Scholar ID'] || '';
          return {
            id: sid,
            kind: 'scholar',
            name: scholarNameById[sid] || a['Scholar Name'] || a['Author Name as Recorded'] || sid,
            authorPosition: Number(a['Author Position'] || 0) || null,
            isFirstAuthor: a['Is First Author?'] === true || a['Is First Author?'] === 'true' ||
                           a._is_lead === true || Number(a['Author Position'] || 0) === 1
          };
        }).concat(researcherAuthRows.map(function (a) {
          return {
            id: a['Researcher ID'] || '',
            kind: 'researcher',
            name: a['Researcher Name'] || a['Author Name as Recorded'] || a['Researcher ID'] || '',
            authorPosition: Number(a['Author Position'] || 0) || null,
            isFirstAuthor: a['Is First Author?'] === true || a['Is First Author?'] === 'true' ||
                           a._is_lead === true || Number(a['Author Position'] || 0) === 1
          };
        })).filter(function (person) { return !!person.name; })
      };
    });

    // Some completed theses are catalogued only on Graduate Degrees, not in
    // Publications/Authorship. Add a synthetic item when a completed, titled
    // degree has no matching thesis publication for that scholar.
    function normalizedTitle_(value) {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }
    master.gradDegrees.forEach(function (g) {
      var sid = g['Scholar ID'];
      var scholarKey = scholarKeyById[sid];
      var title = String(g['Thesis / Research Title'] || '').trim();
      var status = String(g['Completion Status'] || g['Current Status'] || '').trim();
      if (!scholarKey || !title || !/^completed\b/i.test(status)) return;
      var degreeText = String((g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '')).trim();
      var level = /phd|doctor/i.test(degreeText) ? 'phd' : (/master/i.test(degreeText) ? 'masters' : null);
      if (!level) return;
      var titleKey = normalizedTitle_(title);
      var duplicate = items.some(function (item) {
        return item.itemType === 'thesis' && item.collections.indexOf(scholarKey) !== -1 &&
          normalizedTitle_(item.title) === titleKey;
      });
      if (duplicate) return;
      var yearRaw = g['Finish / Completion Year'] || g['Year / Status'] || '';
      var yearMatch = String(yearRaw).match(/\b(18|19|20|21)\d{2}\b/);
      var year = yearMatch ? Number(yearMatch[0]) : null;
      var collections = [scholarKey, COL_BY_WITH];
      var scholar = master.scholars.find(function (s) { return s['Scholar ID'] === sid; });
      var district = scholar && (cleanSentinel_(scholar['Paternal Ward']) || cleanSentinel_(scholar['Maternal Ward']));
      if (district && provPaternalKeyByName[district]) collections.push(provPaternalKeyByName[district]);
      items.push({
        key: hashKey('grad-thesis:' + (g['Degree ID'] || sid + ':' + level + ':' + titleKey)),
        itemType: 'thesis', title: title, date: year ? String(year) : '', year: year,
        creators: [scholarNameById[sid]], tags: [], collections: collections,
        publicationTitle: '', university: g['C_Uni name'] || g['O_Uni name'] || '',
        thesisType: level === 'phd' ? 'PhD Thesis' : "Master's Thesis", thesisLevel: level,
        DOI: '', url: g['Evidence URL'] || '', publisher: '', abstractNote: '',
        _masterPublicationType: level === 'phd' ? 'PhD Thesis' : "Master's Thesis",
        _masterPublicationId: '', _masterAuthorship: 'lead', _syntheticGradDegree: true,
        _itaukeiLeadScholarId: sid, _itaukeiCoauthorScholarIds: []
      });
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
        solomonAuthors: COL_ROOT_ITAUKEI,
        itaukeiAuthors: COL_ROOT_ITAUKEI,  // legacy alias kept for downstream compatibility
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
  // Build a solomon-islands-provinces.json flat descriptor from the district → island-division map.
  // -------------------------------------------------------------------
  function buildProvFlat(snap) {
    return {
      zoteroCollectionKey_c1Root: snap._rootKeys.c1Provinces,
      zoteroCollectionKey_nonProvincialFiji: snap._rootKeys.nonProvincial,
      provinces: PROVINCES.map(function (p) {
        return {
          name: p,
          provinceGroup: PROVINCE_TO_CONFED[p],
          zoteroCollectionKey_publicationLocation: snap._provLocKeyByName[p],
          zoteroCollectionKey_paternalProvince: snap._provPaternalKeyByName[p]
        };
      })
    };
  }

  // -------------------------------------------------------------------
  // Build a solomon-islands-provinces.geojson stub — production code uses it for the
  // Panel B choropleth + name-to-collection-key map. We ship an empty feature
  // list with metadata rows so the loop in loadAll() can still index the keys.
  // The actual map rendering will need the real geojson; keep a passthrough
  // to the existing static file if it's available.
  // -------------------------------------------------------------------
  function buildGeoJson(snap) {
    return fetchJson('data/solomon-islands-provinces.geojson').then(function (geo) {
      // Overlay the synthesized keys onto each feature so the existing name→key
      // extractor picks up Master-file keys.
      if (geo && geo.features) {
        geo.features.forEach(function (f) {
          f.properties = f.properties || {};
          var name = f.properties.name || f.properties.district || '';
          var division = f.properties.provinceGroup || f.properties.islandDivision ||
                         PROVINCE_TO_CONFED[name] || '';
          f.properties.name = name;
          f.properties.provinceGroup = division;
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
      // Solomon Islands schema is a genuine THREE-tier administrative model,
      // unlike the flat 2-tier Tongan/iTaukei sheets this adapter was
      // cloned from: Village/Community -> Ward -> Province/City Area ->
      // Solomon Islands. "paternal"/"maternal" below hold the WARD (closest
      // to the old tikina-equivalent cell for backwards render-path
      // compatibility); "paternalDivision"/"maternalDivision" hold the
      // PROVINCE/CITY AREA. Specific Island is read from its own dedicated
      // column and is NEVER derived from Ward/Province -- a ward or
      // province can span multiple physical islands, and a scholar's
      // origin island may not itself be an administrative unit.
      var paternal = cleanSentinel_(s['Paternal Ward'] || s['Paternal Province/City Area']);
      var maternal = cleanSentinel_(s['Maternal Ward'] || s['Maternal Province/City Area']);
      var paternalDivision = cleanSentinel_(s['Paternal Province/City Area']);
      var maternalDivision = cleanSentinel_(s['Maternal Province/City Area']);
      var paternalIsland = cleanSentinel_(s['Paternal Specific Island']);
      var maternalIsland = cleanSentinel_(s['Maternal Specific Island']);
      var paternalVillage = cleanSentinel_(s['Paternal Village/Community']);
      var maternalVillage = cleanSentinel_(s['Maternal Village/Community']);

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
        // NOTE: `paternalProvince`/`maternalProvince`/`paternalDistrict`/
        // `maternalDistrict` are internal property names kept identical to
        // the Tongan/iTaukei adapter lineage so the cloned dashboard JS's
        // render/filter logic runs unmodified. For Solomon Islands:
        // paternalProvince/maternalProvince actually hold the WARD value
        // (displayed as "Ward" in the UI); paternalDistrict/maternalDistrict
        // are always '' (no equivalent 4th tier -- Solomon Islands' real
        // hierarchy is Village/Community -> Ward -> Province/City Area, a
        // genuine 3-tier model, not a dropped tier). paternalIsland/
        // maternalIsland hold Solomon Islands' "Specific Island" -- an
        // INDEPENDENT attribute, never derived from Ward/Province, since a
        // ward or province (e.g. Western Province) can span multiple
        // physical islands. paternalVillage/maternalVillage hold Solomon
        // Islands' "Village/Community".
        paternalProvince: paternal,
        maternalProvince: maternal,
        paternalDistrict:  '',
        maternalDistrict:  '',
        paternalIsland:    paternalIsland,
        maternalIsland:    maternalIsland,
        paternalVillage:   paternalVillage,
        maternalVillage:   maternalVillage,
        // Explicit Solomon Islands-named aliases (same values, self-documenting keys)
        // for any Solomon-aware rendering code that prefers not to read the
        // Fiji/Tonga-shaped property names directly.
        paternalSpecificIsland: paternalIsland,
        maternalSpecificIsland: maternalIsland,
        paternalVillageTown:    paternalVillage,
        maternalVillageTown:    maternalVillage,
        paternalWard:            paternal,
        maternalWard:            maternal,
        paternalProvinceCityArea: paternalDivision,
        maternalProvinceCityArea: maternalDivision,
        // Customary/cultural fields are INDEPENDENT of administrative
        // geography (Ward/Province/Specific Island) and must never be
        // inferred from it, from surname, or from title. Sourced from the
        // Master Scholars sheet's dedicated customary columns:
        //   Paternal Clan/Tribe/Lineage, Maternal Clan/Tribe/Lineage,
        //   Customary Place, Self-identified Home/Community.
        clanTribeLineagePaternal:  cleanSentinel_(s['Paternal Clan/Tribe/Lineage']),
        clanTribeLineageMaternal:  cleanSentinel_(s['Maternal Clan/Tribe/Lineage']),
        customaryPlace:            cleanSentinel_(s['Customary Place']),
        selfIdentifiedHomeCommunity: cleanSentinel_(s['Self-identified Home/Community']),
        // Legacy alias names kept for any cloned render path that still
        // reads the Tongan-shaped keys; values point at the same Solomon
        // customary data (never geography-derived).
        estateAffiliationPaternal: cleanSentinel_(s['Paternal Clan/Tribe/Lineage']),
        estateAffiliationMaternal: cleanSentinel_(s['Maternal Clan/Tribe/Lineage']),
        haaLineagePaternal:        cleanSentinel_(s['Paternal Clan/Tribe/Lineage']),
        haaLineageMaternal:        cleanSentinel_(s['Maternal Clan/Tribe/Lineage']),
        selfIdentifiedHomePaternal: cleanSentinel_(s['Self-identified Home/Community']),
        selfIdentifiedHomeMaternal: cleanSentinel_(s['Self-identified Home/Community']),
        // effectivePaternalProvince: LEGACY name; the value is strictly the
        // paternal province (no maternal fallback). Retained for backwards
        // compatibility with older callers that read the name literally.
        // Panel F's public identity geography must use paternalProvince
        // directly and never rely on any "effective" or fallback field.
        // (2026-08-25 Panel F Paternal Geography Isolation fix.)
        effectivePaternalProvince: paternal,
        // Paternal provinceGroup: Master column if present, else derived from paternal province.
        // (Kept in existing `provinceGroup` field for backwards-compat with dashboards.)
        // "provinceGroup"/"paternalProvinceGroup"/"maternalProvinceGroup" are kept
        // as internal property names for logic compatibility with the
        // cloned dashboard JS, but for Solomon Islands they hold the real
        // PROVINCE/CITY-AREA value (one of the 9 provinces or Honiara City),
        // never a Fijian confederacy or Tongan Island Division name.
        // Auto-derived from Ward via the Province-Ward Lookup-equivalent
        // table (read-only), matching the iTaukei/Tongan systems' actual
        // current (formula-derived) behavior.
        provinceGroup: (paternalDivision || PROVINCE_TO_CONFED[paternal] || PROVINCE_TO_CONFED[maternal] || ''),
        paternalProvinceGroup: (paternalDivision || PROVINCE_TO_CONFED[paternal] || ''),
        maternalProvinceGroup: (maternalDivision || PROVINCE_TO_CONFED[maternal] || ''),
        islandDivision: (paternalDivision || PROVINCE_TO_CONFED[paternal] || PROVINCE_TO_CONFED[maternal] || ''),
        paternalIslandDivision: (paternalDivision || PROVINCE_TO_CONFED[paternal] || ''),
        maternalIslandDivision: (maternalDivision || PROVINCE_TO_CONFED[maternal] || ''),
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
        // NOTE: the flat `village` / `island` fields are DELIBERATELY set
        // to the PATERNAL cells only — NO maternal fallback. Historically
        // the adapter used `Village Paternal || Village Maternal` and
        // `Island Paternal || Island Maternal` for these keys, which caused
        // Panel F's identity geography to leak maternal-side data when the
        // paternal cell was blank or a sentinel ("Unclassified"). That was
        // the root cause of ITK-S0212 rendering "Naseyani vlg (Beqa Is), Ra
        // Province." — Beqa is the MATERNAL island; Naseyani + Ra are
        // paternal. See docs/PANELF-PATERNAL-GEOGRAPHY-2026-08-25.md.
        //
        // Any consumer that wants an explicit lineage should read
        // `paternalVillage` / `maternalVillage` / `paternalIsland` /
        // `maternalIsland` directly. Panel F reads the paternal-only
        // fields. (2026-08-25 Panel F Paternal Geography Isolation fix.)
        village: paternalVillage,
        island:  paternalIsland,
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
      notItaukeiAuthors: []  // legacy key name kept for downstream compatibility; holds not-Solomon Islands exclusions
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
        provinceGroup: p.provinceGroup,
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

    // ------------------------------------------------------------------
    // AUTHORITATIVE OVERRIDE
    //
    // If scripts/master_b2_worldpoints.py has published a Master-derived
    // world-points payload, use it verbatim for Panel B2 aggregation.
    // That payload enforces:
    //   • only Completed Master's + PhD/Doctorate episodes count
    //     (including 'Completed / year unresolved' and every
    //     'Completed — …' variant);
    //   • discipline-shaped C_Uni values (e.g.
    //     'Agriculture / Horticulture / Breadfruit Propagation') and
    //     placeholders ('not found', 'TBD') are excluded;
    //   • grouping is by canonical C_Uni across cities so PTC→PCU and
    //     Alafua rows never split;
    //   • country strings are validated so 'University of the South
    //     Pacific' cannot leak into the country dimension.
    // The legacy JS aggregation above is retained only as a fallback for
    // older deploys that lack the Master B2 payload.
    // ------------------------------------------------------------------
    var mwp = master.masterWorldPoints;
    if (mwp && Array.isArray(mwp.worldPoints) && mwp.worldPoints.length > 0) {
      worldPoints = mwp.worldPoints.map(function (p) {
        // The Python payload uses the same key names as the JS shape,
        // but we defensively normalize numeric coord fields and ensure
        // the scholar-arrays exist so downstream code that reads
        // `pt.mastersScholars.length` never sees `undefined`.
        var lat = (typeof p.lat === 'number') ? p.lat : null;
        var lng = (typeof p.lng === 'number') ? p.lng : null;
        return {
          country:          p.country || '',
          iso:              p.iso || '',
          region:           p.region || '',
          university:       p.university || '',
          city:             p.city || '',
          lat:              lat,
          lng:              lng,
          phdScholars:      Array.isArray(p.phdScholars)     ? p.phdScholars.slice()     : [],
          mastersScholars:  Array.isArray(p.mastersScholars) ? p.mastersScholars.slice() : [],
          unknownScholars:  Array.isArray(p.unknownScholars) ? p.unknownScholars.slice() : [],
          // Panel B2 uses `.scholars` too for popup lists; synthesize
          // from the per-degree records so hovering the university
          // popup still lists every graduate. Each entry mirrors the
          // legacy shape wirePopupScholarHovers reads.
          scholars: (Array.isArray(p.degrees) ? p.degrees : []).map(function (d) {
            return {
              name:       d.scholarName || '',
              scholarId:  d.scholarId  || '',
              degree:     ((d.stage === 'Masters' ? "Master's " : d.stage === 'PhD' ? 'PhD/Doctorate ' : '') + (d.qualification || '')).trim(),
              year:       d.year || '',
              completed:  true   // Python side already enforces this.
            };
          }),
          scholarsCount: Array.isArray(p.degrees) ? p.degrees.length : 0,
          degrees:       Array.isArray(p.degrees) ? p.degrees.slice() : []
        };
      });
    }

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
        // Do not overwrite coords the authoritative Master B2 payload
        // already resolved. The Master payload encodes country-specific
        // campus overrides (e.g. USP Alafua for Samoa) which the V1
        // graduate-studies lookup lacks — V1 has only a single USP row
        // keyed to Fiji, so its fallback `coordByUni` match would drag
        // Samoa/Vanuatu/Solomon Islands/Solomon Islands USP rows back to Suva.
        var hasCoord = typeof pt.lat === 'number' && typeof pt.lng === 'number';
        var hit = coordByCountryUni.get(pt.country + '|' + pt.university) || coordByUni.get(pt.university);
        if (hit) {
          if (!hasCoord) {
            pt.lat = hit.lat;
            pt.lng = hit.lng;
          }
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
    //
    // Normalisation: the Master sheet uses "Master's Thesis" (with a
    // curly or straight apostrophe) and "Other Thesis", not "Masters
    // Thesis" or "Thesis (Masters)". Earlier versions of this function
    // only recognised the apostrophe-less spelling and every Master's
    // thesis fell through to `return 'document'`. Combined with
    // `excludeDocuments: true` in the scholar-card counter, that
    // silently subtracted Master's theses from every affected
    // scholar's Publications total AND kept the Panel F thesisMasters
    // chip at 0. We now strip curly apostrophes and lowercase before
    // matching, and accept every spelling variant that appears in the
    // Master Publications sheet.
    var raw = (pubRow && pubRow['Publication Type']) || '';
    // Replace curly apostrophes with straight ones, collapse whitespace,
    // and lowercase so "Master\u2019s Thesis" and "Master's Thesis" and
    // "master's thesis" all normalise to the same key.
    var t = String(raw).replace(/[\u2018\u2019\u02BC]/g, "'").trim().toLowerCase();
    if (t === 'journal article')                                    return 'journalArticle';
    if (t === 'book')                                               return 'book';
    if (t === 'book section' || t === 'book chapter')               return 'bookSection';
    if (t === 'thesis (phd)' || t === 'phd thesis')                 return 'thesisPhd';
    if (t === 'thesis (masters)' || t === 'masters thesis' ||
        t === "master's thesis")                                    return 'thesisMasters';
    if (t === 'other thesis' || t === 'thesis')                     return 'thesisUnknown';
    if (t === 'report')                                             return 'report';
    if (t === 'preprint' ||
        t === 'unpublished' || t === 'unpublished report')          return 'preprint';
    if (t === 'conference paper')                                   return 'conferencePaper';
    if (t === 'book review')                                        return 'journalArticle';
    return 'document';
  }

  function _emptyTypesTally() {
    return {
      journalArticle: 0, thesisPhd: 0, thesisMasters: 0, thesisUnknown: 0,
      bookSection: 0, book: 0, report: 0, conferencePaper: 0, preprint: 0, document: 0
    };
  }

  // Stable, punctuation-insensitive title key used to reconcile a completed
  // Graduate Degrees thesis with the same thesis already catalogued in
  // Publications. Graduate Degrees is a required fallback source for scholar
  // cards: every completed Master's/PhD row must remain visible even while its
  // title or Publications/Authorship linkage is still being reconciled.
  function _normalizedThesisTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

    // Protect completed theses/degree works that exist in Graduate Degrees but not yet in
    // Publications/Authorship. The dashboard snapshot already synthesizes
    // these items; the canonical scholar-card counter must do the same or its
    // later override silently removes Master's Thesis from the card badges,
    // total-publication count, and first-authored count.
    //
    // A titled thesis already linked through Authorship is detected by
    // normalized title + level and is not added twice. A completed degree row
    // with a blank thesis title is still retained using its stable Degree ID;
    // otherwise scholars such as Tēvita O. Kaʻili lose their Master's counts
    // solely because title metadata remains incomplete. A synthesized degree
    // work is treated as first-authored because theses are individual works.
    (master.gradDegrees || []).forEach(function (g) {
      var sid = g['Scholar ID'];
      var title = String(g['Thesis / Research Title'] || '').trim();
      var status = String(g['Completion Status'] || g['Current Status'] || '').trim();
      if (!sid || !/^completed\b/i.test(status)) return;

      var degreeText = String((g['Degree Stage'] || '') + ' ' +
                              (g['Degree / Qualification'] || '')).trim();
      var vt = /phd|doctor/i.test(degreeText) ? 'thesisPhd' :
               (/master/i.test(degreeText) ? 'thesisMasters' : null);
      if (!vt) return;

      var bucket = idx[sid];
      if (!bucket) {
        bucket = idx[sid] = {
          totalSet: new Set(),
          firstSet: new Set(),
          typesTotalByPid: {}
        };
      }

      var titleKey = _normalizedThesisTitle(title);
      var duplicate = false;
      if (titleKey) {
        bucket.totalSet.forEach(function (pid) {
          if (duplicate) return;
          var pub = pubsById[pid] || {};
          if (_visualPubType(pub) !== vt) return;
          var pubTitle = pub['Title'] || pub['Publication Title'] || pub['Thesis / Research Title'] || '';
          if (_normalizedThesisTitle(pubTitle) === titleKey) duplicate = true;
        });
      }
      if (duplicate) return;

      var degreeIdentity = g['Degree ID'] || (sid + ':' + vt + ':' +
        (titleKey || String(g['Degree / Qualification'] || g['Degree Stage'] || 'untitled')));
      var syntheticPid = 'grad-thesis:' + String(degreeIdentity);
      bucket.totalSet.add(syntheticPid);
      bucket.firstSet.add(syntheticPid);
      bucket.typesTotalByPid[syntheticPid] = vt;
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
  //
  // options.excludeDocuments (default false): when true, items classified as
  //   'document' (Master 'Publication Type' = 'Others' / 'Other' or any
  //   unrecognised value that fell through TYPE_MAP) are removed from
  //   `total`, `firstAuthored`, and `types.document` (which becomes 0).
  //   Used by the V2 dashboard (2026-08-24 Ron directive): documents lack
  //   enough metadata to be credibly counted as a publication. When a
  //   Master row is later reclassified to a known Publication Type, it
  //   automatically re-enters the count. Master data is untouched.
  function computePublicationTotals(master, scholarId, options) {
    var opts = options || {};
    var excludePreprints = opts.excludePreprints === true;
    var excludeDocuments = opts.excludeDocuments === true;
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
    var documentPids = new Set();
    Object.keys(bucket.typesTotalByPid).forEach(function (pid) {
      var vt = bucket.typesTotalByPid[pid];
      if (vt === 'preprint') preprintPids.add(pid);
      if (vt === 'document') documentPids.add(pid);
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
    if (excludeDocuments) {
      // Same pattern as preprints: subtract document pids from both totals.
      // Ensures a scholar whose only Master row is 'Others'/'Other' shows a
      // Publications total of 0 in V2 rather than an inflated count.
      documentPids.forEach(function (pid) {
        if (bucket.totalSet.has(pid)) total -= 1;
        if (bucket.firstSet.has(pid)) firstAuthored -= 1;
      });
      types.document = 0;
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
  // NOTE: kept as `window.MasterFileAdapter` — same global name as the
  // iTaukei adapter — because js/solomon-database-master.js (a byte-level
  // clone of js/itaukei-database-master.js) calls `window.MasterFileAdapter
  // .load()` verbatim. This page never loads both adapters at once, so
  // there is no collision; the two dashboards are always served from
  // separate HTML documents. A `window.SolomonIslandsMasterFileAdapter` alias is
  // also exposed for any Solomon Islands-aware code that wants an unambiguous name.
  var SOLOMONISLANDS_ADAPTER_API = {
    load: loadFromMaster,
    constants: {
      PROVINCE_GROUPS: PROVINCE_GROUPS,
      PROVINCE_TO_CONFED: PROVINCE_TO_CONFED,
      PROVINCES: PROVINCES,
      PROVINCE_UNSPEC: PROVINCE_UNSPEC,
      PROVINCE_UNSURE: PROVINCE_UNSURE,
      TYPE_MAP: TYPE_MAP,
      // Solomon Islands-named aliases of the same constants (self-documenting).
      ISLAND_DIVISIONS: ISLAND_DIVISIONS,
      DISTRICT_TO_DIVISION: DISTRICT_TO_DIVISION,
      DISTRICTS: DISTRICTS,
      DISTRICT_UNSPEC: DISTRICT_UNSPEC,
      DISTRICT_UNSURE: DISTRICT_UNSURE
    },
    keyifyName: keyifyName,
    hashKey: hashKey,
    computePublicationTotals: computePublicationTotals,
    findAuthorshipLinkageGaps: findAuthorshipLinkageGaps
  };
  window.MasterFileAdapter = SOLOMONISLANDS_ADAPTER_API;
  window.SolomonIslandsMasterFileAdapter = SOLOMONISLANDS_ADAPTER_API;
})();
