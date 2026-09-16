/*
 * Samoan Scholarly Research Database
 * Loads /data/samoan-zotero-snapshot.json, /data/samoa-districts.geojson, and
 * /data/world-universities.json, then renders an interactive map, charts, and filterable cards.
 * Every filter is reflected in the URL query string so a filtered view can be shared as a link.
 * A background live-fetch to api.zotero.org keeps the freshness badge accurate; failure never
 * breaks the map or charts.
 */
(function () {
  'use strict';

  // Satellite-legible border colours - one per Samoa Statistical Region.
  // Keyed by human region name (spaces + apostrophe) so JS uses quoted-string
  // property access throughout.
  const REGION_COLORS = {
    'Apia Urban Area':  '#0891b2',
    'North West Upolu': '#eab308',
    'Rest of Upolu':    '#dc2626',
    "Savai'i":          '#16a34a'
  };
  // Backwards-compat alias while callers are migrated to REGION_COLORS.
  const CONF_COLORS = REGION_COLORS;
  const TYPE_LABELS = {
    journalArticle:  'Journal Article',
    thesisPhd:       'PhD Thesis',
    thesisMasters:   'Masters Thesis',
    thesisUnknown:   'Thesis',
    bookSection:     'Book Chapter',
    book:            'Book',
    conferencePaper: 'Conference',
    report:          'Report',
    preprint:        'Preprint',
    document:        'Document'
  };
  const TYPE_LABELS_PLURAL = {
    journalArticle:  'Journal Articles',
    thesisPhd:       'PhD Theses',
    thesisMasters:   'Masters Theses',
    thesisUnknown:   'Theses',
    bookSection:     'Book Chapters',
    book:            'Books',
    conferencePaper: 'Conference Papers',
    report:          'Reports',
    preprint:        'Preprints',
    document:        'Documents'
  };
  const PIN_OFFSETS = {
    'Ba':            [ 0.20, -0.15],
    'Ra':            [ 0.18,  0.12],
    'Nadroga/Navosa':[-0.15, -0.15],
    'Naitasiri':     [ 0.05,  0.02],
    'Namosi':        [-0.05, -0.10],
    'Serua':         [-0.15,  0.02],
    'Rewa':          [-0.10,  0.30],
    'Tailevu':       [ 0.15,  0.35],
    'Lomaiviti':     [ 0.05,  0.55],
    'Kadavu':        [-0.35,  0.00],
    'Bua':           [ 0.10, -0.35],
    'Cakaudrove':    [ 0.10,  0.30],
    'Macuata':       [ 0.30, -0.15],
    'Lau':           [ 0.00,  0.30]
  };

  // Filter keys we serialize to the URL
  const FILTER_KEYS = ['q', 'itemType', 'discipline', 'decade', 'district', 'paternal', 'university', 'year', 'scholar', 'b2Group', 'b2Authorship'];

  const TYPE_COLOR = {
    thesisPhd:      '#228B22',   // forest green — PhD
    thesisMasters:  '#8FBC8F',   // dark sea green — lighter forest, Masters
    thesisUnknown:  '#4CAF50',   // material green — unclassified thesis
    journalArticle: '#B8860B',
    // Book Chapter uses a lighter tint of the same burgundy so Book vs Book
    // Chapter is visually distinguishable in stacks and legends (parallel to
    // the PhD dark-green vs Master's light-green relationship). Book keeps
    // the original heavier tone as the "parent" of the pair.
    bookSection:    '#C08388',
    book:           '#7a1419',
    report:         '#1e40af',
    conferencePaper:'#92400e',
    preprint:       '#6b7280',
    document:       '#9ca3af'
  };
  // Order determines stacked-chart segment order (bottom → top) and legend order.
  // PhD + Masters only — unclassified theses ('thesisUnknown') are intentionally
  // excluded from Panels B/C counts and legend per Ron's request. They still
  // appear individually in the item list at the bottom.
  // NOTE: `conferencePaper` AND `preprint` are intentionally omitted from
  // TYPE_ORDER. The visualization panels (B1, B2, C, D) iterate over
  // TYPE_ORDER, so this drops conference papers and preprints from bars,
  // histogram, and type-filter checkboxes.
  //
  // Preprint exclusion (Ron's 2026-08-24 directive): preprints must be
  // globally excluded from every V2 dashboard calculation, statistic,
  // visualization, ranking, summary, filter, publication total, first-
  // author total, scholar-card chip, map, timeline, and table. This is
  // enforced at THREE levels for defense in depth:
  //   1) TYPE_ORDER omits `preprint` (this line)         — bars/legend/filters
  //   2) CHIP_ORDER omits `preprint` (search this file)  — Panel F chips
  //   3) state.snapshot.items is filtered at load time   — every counter
  // The Master file KEEPS preprints in Publications and Authorship; this
  // is a strict display/calculation exclusion only.
  //
  // The underlying items remain in BibTeX export (which does not depend
  // on TYPE_ORDER); preprints are also dropped there because step (3)
  // removes them from state.snapshot.items entirely.
  const TYPE_ORDER = ['thesisPhd','thesisMasters','journalArticle','bookSection','book','report'];

  // Effective paternal-district for a scholar profile: prefer the explicit
  // paternal district, but fall back to the maternal district when paternal
  // is blank. Used for statistical region chips, Panel B2 grouping, and every place
  // the dashboard describes a scholar's 'home' district. This handles the
  // case where a scholar considers themselves Samoan via their mother
  // (e.g. Aporosa Apo — Naduri village, Macuata District via mother).
  // The admin form records `nonItaukeiDad` and `maternalDistrict` explicitly;
  // the public dashboard doesn't need those flags separately, just the
  // effective district.
  function effectivePaternalProvince(profile) {
    if (!profile) return '';
    return (profile.paternalDistrict || profile.maternalDistrict || '').trim();
  }

  // ------------------------------------------------------------------
  // Shared scholar-geography formatter (V2 public display).
  //
  // Renders one canonical locality string from village / island /
  // district Master values. Display-only — never mutates the Master.
  //
  //   village + island + district             → 'Malawai vlg (Gau Is), Lomaiviti District.'
  //   village + district, island suppressed   → 'Naduri vlg, Macuata District.'      (Viti Levu / Vanua Levu)
  //   village + district, no island           → 'Naduri vlg, Macuata District.'
  //   village + island, no district           → 'Malawai vlg (Gau Is)'                (no trailing district)
  //   district only                           → 'Lau District.'
  //   outer island only                       → 'Gau Is'
  //   nothing meaningful                      → ''
  //
  // Placeholders (Unclassified / Unknown / N/A / null / undefined /
  // 'null' / 'undefined') are stripped before formatting, so the public
  // string never leaks a sentinel.
  //
  // Island suffix normalization: strips a trailing ' Is' / ' Island' from
  // the stored value (case-insensitive, whole word) so re-suffixing with
  // ' Is' can never produce 'Moala Is Is' or 'Gau Island Is'.
  //
  // The trailing period appears only when the string ends in 'District';
  // 'Gau Is'-only or village-only forms stay unpunctuated so they read
  // cleanly in chips.
  // ------------------------------------------------------------------
  // Samoa uses its own island composition (Upolu, Savaiʻi, Manono, Apolima).
  // The suppress regex is retained as a defensive no-op against stale data
  // rows leaking sister-database island names into a Samoa render.
  const _MAINLAND_ISLANDS_SUPPRESS = /^(upolu|savai.i|manono|apolima)$/i;
  const _GEO_SENTINELS = /^(unclassified|unknown|n\/?a|na|null|undefined|none|-|\.|_)$/i;

  function _cleanGeoField(v) {
    var s = (v == null ? '' : String(v)).trim();
    if (!s) return '';
    if (_GEO_SENTINELS.test(s)) return '';
    return s;
  }

  function _normalizeIslandStem(v) {
    // Trim any pre-existing ' Is', ' Is.', ' Island' suffix so we can
    // append a single canonical ' Is' without stacking. Whole-word only.
    return v.replace(/\s+(is\.?|island)$/i, '').trim();
  }

  function formatScholarGeography(village, island, district) {
    var v = _cleanGeoField(village);
    var i = _cleanGeoField(island);
    var p = _cleanGeoField(district);

    // Suppress island name entirely for Samoa's two large mainlands.
    if (i && _MAINLAND_ISLANDS_SUPPRESS.test(i)) i = '';

    // Apply district-qualified village labels for the 12 name-collisions
    // where the same village name repeats across districts (helper is
    // built by samoa-panel-overrides.js after bundle.geo has hydrated).
    // When the raw village name is ambiguous AND we know the scholar's
    // home district, render as "{village} — {district}" so the card face
    // is never ambiguous. Never infer a district we do not have.
    if (v && typeof window !== 'undefined' && typeof window.__samoaVillageLabel === 'function') {
      try {
        var maybeQualified = window.__samoaVillageLabel(v, p || '');
        if (maybeQualified && maybeQualified !== v) v = maybeQualified;
      } catch (labelErr) { /* fall through to raw name */ }
    }

    var islandStem = i ? _normalizeIslandStem(i) : '';
    var vlgPart = v ? (v + ' vlg') : '';
    var islPart = islandStem ? (islandStem + ' Is') : '';
    var provPart = p ? (p + ' District') : '';

    // 1. Village + District (with or without a shown island).
    if (vlgPart && provPart) {
      var localityPart = islPart ? (vlgPart + ' (' + islPart + ')') : vlgPart;
      return localityPart + ', ' + provPart + '.';
    }
    // 2. Village + Island, no district — no trailing comma / fake district.
    if (vlgPart && islPart) {
      return vlgPart + ' (' + islPart + ')';
    }
    // 3. Village only.
    if (vlgPart) return vlgPart;
    // 4. Island + District, no village — keep both instead of dropping
    //    the island (happens when the village cell is blank OR a scrubbed
    //    sentinel like 'Unclassified').
    if (islPart && provPart) return islPart + ', ' + provPart + '.';
    // 5. District only.
    if (provPart) return provPart + '.';
    // 6. Outer island only (Viti Levu / Vanua Levu already suppressed above).
    if (islPart) return islPart;
    return '';
  }

  // Expose the formatter for tests / other modules (e.g. hover chips built
  // outside this IIFE). Attach to a namespaced global rather than the
  // window root so it's easy to grep for.
  if (typeof window !== 'undefined') {
    window.VaveLabV2 = window.VaveLabV2 || {};
    window.VaveLabV2.formatScholarGeography = formatScholarGeography;
  }

  // Find the top-level Zotero collection that groups every Samoan-authored
  // sub-collection. Historically named 'Samoan authors (>3 papers)' but Ron
  // has renamed it (e.g. '(>2 papers)'), so we match any top-level collection
  // whose name begins with 'Samoan authors' — that's still the unambiguous
  // root in this Zotero group. Returns null if no such collection exists.
  function findItaukeiRootCollection(cols) {
    if (!Array.isArray(cols)) return null;
    return cols.find(c => !c.parent && /^Samoan authors\b/i.test(String(c.name || ''))) || null;
  }

  // Convert a Zotero item to its display-type key (splits `thesis` →
  // thesisPhd / thesisMasters / thesisUnknown based on `thesisLevel`).
  function visualType(item) {
    if (!item) return null;
    if (item.itemType !== 'thesis') return item.itemType;
    const lvl = item.thesisLevel;
    if (lvl === 'phd') return 'thesisPhd';
    if (lvl === 'masters') return 'thesisMasters';
    return 'thesisUnknown';
  }

  const state = {
    snapshot: null,
    districts: null,
    universities: null,
    graduateStudies: null,               // data/samoan-graduate-studies.json
    mapScope: 'samoa',                    // 'samoa' | 'world' (Ron's 2nd tab set)
    worldView: 'study',                  // 'study' | 'publish'
    worldLayer: null,                    // Leaflet layer holding world-map markers
    mapView: 'all',                      // 'all' | 'lead' | 'coauth'
    typeSet: new Set(TYPE_ORDER),        // which types are shown in panels B, C
    // Panel D has its own independent type filter so the timeline can be
    // interrogated without disturbing Panels B/C. Also has its own authors
    // filter with four modes, driven by the pills next to the title:
    //   'lead'   — Samoan is first-listed author
    //   'coauth' — Samoan appears but is not first-listed
    //   'both'   — lead + coauth (any Samoan involvement; default)
    //   'all'    — every publication in the database
    histTypeSet: new Set(TYPE_ORDER),
    histAuthors: 'lead',                 // 'lead' | 'coauth' | 'both' | 'all' — Panel D default: Samoan lead
    // Panel D x-axis range — null means "use full data range" (default: All)
    histRange: { start: null, end: null, preset: 'all' },
    filter: {
      q: '',
      itemType: '',
      discipline: '',
      decade: '',
      district: '',
      paternal: '',
      university: '',
      year: '',
      scholar: ''
    },
    pageSize: 25,
    shown: 25,
    view: 'location',
    map: null,
    provinceLayer: null,
    provinceHaloLayer: null,
    provincePinsLayer: null,
    universityLayer: null,
    itaukeiKeys: new Set(),
    // Maps built after loadAll()
    disciplineByColKey: new Map(),   // collectionKey -> discipline name (root)
    disciplinesByItem:  new Map(),   // itemKey -> Set(discipline)
    provincesByItem:    new Map(),   // itemKey -> Set(district name)   (research-location view)
    paternalByItem:     new Map(),   // itemKey -> Set(district name)
    scholarByItem:      new Map(),   // itemKey -> Set(scholar leaderboard name)
    scholarKeyByName:   new Map(),   // scholar full name -> collectionKey
    provinceColKeyByName: { location: new Map(), paternal: new Map() }
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'className') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(n.style, attrs[k]);
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // Sanitiser for the plain-English scholar summary. Curated summaries in
  // data/scholar-insights.json may embed links to news articles or faculty
  // pages that give the reader real context on why a scholar cares about
  // their work. We whitelist only:
  //   <a href="..." target="_blank" rel="noopener">text</a>
  //   <em>...</em>, <strong>...</strong>
  // Everything else — including any inline script or event handler — is
  // encoded as plain text. Href values are restricted to http(s) URLs so
  // that javascript:/data: URIs cannot slip through.
  function sanitizeSummaryHtml(input) {
    if (input == null) return '';
    const src = String(input);
    // Fast path: if the string contains no '<' at all, just escape.
    if (src.indexOf('<') === -1) return escapeHtml(src);

    let out = '';
    let i = 0;
    const N = src.length;
    while (i < N) {
      const ch = src[i];
      if (ch !== '<') {
        // Escape naked entity-sensitive chars but preserve typography.
        if (ch === '&') out += '&amp;';
        else if (ch === '>') out += '&gt;';
        else if (ch === '"') out += '&quot;';
        else if (ch === "'") out += '&#39;';
        else out += ch;
        i++;
        continue;
      }
      // Try to match an allowed opening or closing tag starting at i.
      // Anchor: <a ...>  or  </a>
      const closeA = src.substr(i, 4).toLowerCase() === '</a>';
      if (closeA) { out += '</a>'; i += 4; continue; }
      const openA = src.substr(i, 2).toLowerCase() === '<a' &&
                    (src[i + 2] === ' ' || src[i + 2] === '\t');
      if (openA) {
        const end = src.indexOf('>', i);
        if (end === -1) { out += '&lt;'; i++; continue; }
        const attrStr = src.substring(i + 2, end);
        const href = /href\s*=\s*"([^"]*)"/i.exec(attrStr)
                  || /href\s*=\s*'([^']*)'/i.exec(attrStr);
        let hrefVal = href ? href[1].trim() : '';
        // Only allow safe URL schemes.
        if (!/^https?:\/\//i.test(hrefVal) && !/^mailto:/i.test(hrefVal)) {
          // Skip the whole opening tag (render nothing, just drop it).
          i = end + 1;
          continue;
        }
        out += '<a href="' + escapeAttr(hrefVal) + '" target="_blank" rel="noopener">';
        i = end + 1;
        continue;
      }
      // <em>, </em>, <strong>, </strong>
      const lower3 = src.substr(i, 4).toLowerCase();
      const lower4 = src.substr(i, 5).toLowerCase();
      const lower6 = src.substr(i, 8).toLowerCase();
      const lower7 = src.substr(i, 9).toLowerCase();
      if (lower3 === '<em>')      { out += '<em>';       i += 4; continue; }
      if (lower4 === '</em>')     { out += '</em>';      i += 5; continue; }
      if (lower6 === '<strong>')  { out += '<strong>';   i += 8; continue; }
      if (lower7 === '</strong>') { out += '</strong>';  i += 9; continue; }
      // Anything else — encode the '<' as text and move on.
      out += '&lt;';
      i++;
    }
    return out;
  }

  // ============ DATA LOAD ============
  async function loadAll() {
    // ================================================================
    // MASTER-FILE ADAPTER OVERRIDE
    //
    // The production dashboard reads Zotero-shaped JSON. This preview
    // reads Samoa_Master_file sanitized JSON and re-shapes it into
    // the same in-memory contract via js/samoa-database-adapter.js.
    // Every downstream render function in this file continues to work
    // unchanged; only the data source is different.
    //
    // See docs/MASTER-FILE-REBUILD.md for the pipeline description.
    // ================================================================
    if (!window.SamoaScholarDatabaseAdapter || typeof window.SamoaScholarDatabaseAdapter.load !== 'function') {
      throw new Error('SamoaScholarDatabaseAdapter not loaded. Ensure js/samoa-database-adapter.js is included before samoan-database-master.js.');
    }
    const bundle = await window.SamoaScholarDatabaseAdapter.load();
    // Preserve the raw Master JSON for panel-level overrides that need
    // Master-specific data (14-district TOTAL columns, statistical region rows,
    // Authorship-bridge Samoan classification, C_Uni-only aggregations).
    state.master = bundle.master;
    state.masterAdapter = window.SamoaScholarDatabaseAdapter;
    const snap        = bundle.snap;
    const geo         = bundle.geo;
    const unis        = bundle.unis;
    const provFlat    = bundle.provFlat;
    const profiles    = bundle.profiles;
    const sync        = bundle.sync;
    const grad        = bundle.grad;
    const insightsDoc = bundle.insightsDoc;
    const workplaceCoordsDoc = bundle.workplaceCoordsDoc;
    const uniCountryDoc = bundle.uniCountryDoc;
    const progressRoster = bundle.progressRoster;
    // Filter out conference papers, preprints, AND documents globally.
    //
    // Conference papers: July 2026 admin directive. Must not appear on
    //   scholar profile cards (Panel F), publication tallies, BibTeX
    //   exports, or any other panel. See docs/CONFERENCE-PAPERS-HIDDEN.md.
    //
    // Preprints: 2026-08-24 Ron directive. Must be completely excluded
    //   from ALL V2 dashboard calculations, statistics, visualisations,
    //   rankings, summaries, filters, publication totals, first-author
    //   totals, scholar-card chips, maps, timelines, tables, and any
    //   other displayed metric. Behave as though preprints do not exist
    //   for V2 display purposes. Preprints remain intact in the Master
    //   file (Publications + Authorship worksheets); this filter is a
    //   display/calculation exclusion only.
    //   Master 'Publication Type' values that map to itemType=preprint
    //   (via TYPE_MAP in samoa-database-adapter.js) are: 'Unpublished report'
    //   and 'Unpublished'. Any pre-existing Zotero preprint is also caught.
    //
    // Documents: 2026-08-24 Ron directive (second). Items classified as
    //   `document` (itemType='document') are Master 'Publication Type' =
    //   'Others' / 'Other', OR any unrecognised value that fell through
    //   the TYPE_MAP default. These have insufficient metadata to justify
    //   counting them as a credible publication (thesis, journal article,
    //   book, book chapter, report). They must be excluded from counts
    //   and tallies on every V2 panel. When enough information is added
    //   to the Master row to reclassify the Publication Type to a known
    //   category, the item automatically re-enters V2 with no code
    //   change. Documents remain intact in the Master file — this filter
    //   is a display/calculation exclusion only.
    //
    // Dropping these from state.snapshot.items here is the single
    // chokepoint — every downstream reader (Panels A, B1, B2, B3, C1, C2,
    // D, E, F, G, BibTeX export, item lists, counters) reads
    // state.snapshot.items and therefore inherits this filter with no
    // per-site changes.
    //
    // TYPE_ORDER (see comment ~line 82) also excludes conferencePaper,
    // preprint, and document so the visualization filter row/legend/bars
    // stay consistent even if a stray item ever slipped through the
    // item filter.
    if (snap && Array.isArray(snap.items)) {
      const beforeCount = snap.items.length;
      snap.items = snap.items.filter(it => it
        && it.itemType !== 'conferencePaper'
        && it.itemType !== 'preprint'
        && it.itemType !== 'document');
      state.hiddenConferencePapers = beforeCount - snap.items.length;

      // Client-side year backfill. The Python snapshot builder used to reject
      // any date containing a hyphen (its token-split checked isdigit(), so
      // ISO dates like '2019-03' and '2019-03-15' failed and the item was
      // stored with year = null). That silently dropped ~200 items (8% of
      // the library) from Panel D. The Python side has been fixed, but we
      // also re-derive year here so older snapshots and any future stray
      // date formats don't leak. We search for the first 4-digit run in the
      // stored date string and accept it if it looks like a plausible pub
      // year. This runs before every panel reads state.snapshot.items, so
      // Panels B/C/D/E/G all pick up the recovered items automatically.
      let recoveredYears = 0;
      snap.items.forEach(it => {
        if (it.year) return;
        const d = it.date || '';
        const m = String(d).match(/\b(\d{4})\b/);
        if (!m) return;
        const y = parseInt(m[1], 10);
        if (y >= 1900 && y <= 2035) { it.year = y; recoveredYears++; }
      });
      state.recoveredYears = recoveredYears;
    }
    state.snapshot = snap;
    state.districts = geo;
    state.universities = unis;
    state.lastSync = sync;
    state.graduateStudies = grad;
    state.scholarInsights = (insightsDoc && insightsDoc.insights) || {};
    // Also expose Scholar-ID-keyed insights so any consumer (admin V2, future
    // Panel F card renderer) can join by ID without a name round-trip.
    state.scholarInsightsById = (insightsDoc && insightsDoc.byScholarId) || {};
    state.workplaceCoords = (workplaceCoordsDoc && workplaceCoordsDoc.coords) || {};
    state.uniCountryOverrides = (uniCountryDoc && uniCountryDoc.countryByUniversity) || {};

    // Extract canonical-name keys from the progress-Sheet master roster payload.
    // The Apps Script endpoint returns an array of rows or { rows: […] }.
    {
      const rosterDoc = progressRoster || null;
      const rosterRows = Array.isArray(rosterDoc) ? rosterDoc
                       : (rosterDoc && Array.isArray(rosterDoc.rows) ? rosterDoc.rows
                       : (rosterDoc && Array.isArray(rosterDoc.result) ? rosterDoc.result : []));
      const _hyph = /[\u2010\u2011\u2013\u2212]/g;
      const _keyify = s => (s || '').replace(_hyph, '-').toLowerCase().replace(/[^a-z0-9]/g, '');
      state.progressRosterKeys = rosterRows.flatMap(r => {
        if (!r) return [];
        const canonical = r.canonical || r.canonicalName || r.name || r.scholar;
        const first = r.firstName || r.first || '';
        const last  = r.lastName  || r.last  || '';
        const built = last && first ? `${last}, ${first}` : (last || first || '');
        const flipped = first && last ? `${first} ${last}` : '';
        return [canonical, built, flipped].map(_keyify).filter(k => k);
      });
    }

    // Name-variant aliases. Curated by the admin in the merge panel and pushed
    // via data/scholar-profiles.json. Keys are Zotero-creator variants and
    // values are the canonical author name. Applied when we scan creators so
    // publications authored under, say, "Tabunakawai, K." are folded into
    // "Tabunakawai, Kesaia" for pub counts and scholar-card totals.
    state.nameAliases = new Map(Object.entries((profiles && profiles.nameAliases) || {}));

    // Explicit "not Samoan" blocklist — surnames + full names that have shown up
    // in publications alongside Samoan co-authors but who are NOT themselves
    // Samoan scholars. Persisted in data/scholar-profiles.json.notItaukeiAuthors
    // (curated by the admin dashboard). Applied as a veto in creatorIsItaukei so
    // that name-alias pollution or Zotero collection membership can't accidentally
    // upgrade someone like Morris/McCabe/Mounsey to Samoan-lead. This list is the
    // safeguard the Scholars master roster relies on: only names in the Scholars
    // tab (progress roster) or admin scholar-profiles count as Samoan.
    state.notItaukeiCanonicalKeys = new Set(
      (Array.isArray(profiles && profiles.notItaukeiAuthors) ? profiles.notItaukeiAuthors : [])
        .map(n => (n || '').replace(/[\u2010\u2011\u2013\u2212]/g, '-').toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter(k => k)
    );

    // Build the scholar-name look-up. Starts with the local JSON snapshot, then
    // overlays Google Sheet CSV if the admin has configured one (URL stored in
    // localStorage under 'vavelab_scholar_sheet_url').
    //
    // Name matching is deliberately tolerant of middle-initial variants. The
    // admin can save a profile as "Tabudravu, Jioji N." while the Zotero
    // sub-collection is named "Tabudravu, Jioji" (no middle initial) — both
    // point to the same person. We therefore index each profile under both its
    // canonical "Last, First" key and a stripped "Last, <first-token-of-First>"
    // fallback key. The fallback is only added when it doesn't collide with an
    // already-indexed profile, so distinct people with the same surname +
    // first-token (e.g. "Smith, John A." vs "Smith, John B.") aren't merged.
    state.scholarProfilesByName = new Map();
    const firstToken = s => String(s || '').trim().split(/\s+/)[0] || '';
    (profiles.scholars || []).forEach(p => {
      const name = (p.last && p.first) ? `${p.last}, ${p.first}` : (p.name || '');
      if (!name) return;
      state.scholarProfilesByName.set(name, p);
      if (p.last && p.first) {
        const stripped = `${p.last}, ${firstToken(p.first)}`;
        if (stripped !== name && !state.scholarProfilesByName.has(stripped)) {
          state.scholarProfilesByName.set(stripped, p);
        }
      }
    });
    // Explicit hide-list — names the admin dashboard has removed from the Samoan list.
    // These scholars will not appear as cards on the public dashboard even if they still
    // exist as Zotero collection subs. Persisted in data/scholar-profiles.json under
    // "hiddenScholars".
    state.hiddenScholars = new Set(Array.isArray(profiles.hiddenScholars) ? profiles.hiddenScholars : []);
    const sheetUrl = localStorage.getItem('vavelab_scholar_sheet_url');
    if (sheetUrl) {
      try {
        const csvText = await fetch(sheetUrl, { cache: 'no-cache' }).then(r => r.text());
        parseCsvToScholars(csvText).forEach(p => {
          const name = (p.last && p.first) ? `${p.last}, ${p.first}` : (p.name || '');
          if (!name) return;
          state.scholarProfilesByName.set(name, Object.assign({}, state.scholarProfilesByName.get(name) || {}, p));
          if (p.last && p.first) {
            const stripped = `${p.last}, ${firstToken(p.first)}`;
            if (stripped !== name) {
              state.scholarProfilesByName.set(stripped, Object.assign({}, state.scholarProfilesByName.get(stripped) || {}, p));
            }
          }
        });
      } catch (e) {
        console.warn('Google Sheet CSV fetch failed; using local snapshot only.', e);
      }
    }

    state.provinceMetaByName = new Map();
    provFlat.districts.forEach(p => state.provinceMetaByName.set(p.name, p));

    // Zotero C1 root and Non-provincial/Samoa sub-collection keys. Both come
    // from data/samoa-districts.json (top-level). C1 root (RNKFUZ6M) parents the
    // 14 provincial sub-collections plus '_Non-Provincial/Samoa' (AREH32KK) —
    // Samoa-wide publications not tied to a single district. The non-provincial
    // key drives the bottom bar in Panel C1.
    state.c1RootKey = provFlat.zoteroCollectionKey_c1Root || null;
    // Bundle key name is inherited from the shared master-file-adapter and
    // carries a legacy `_nonProvincialFiji` suffix regardless of which
    // sister database is being adapted. The value is the Samoa non-district
    // Zotero bucket key; the legacy suffix is data-source metadata only.
    // Read the new Samoa-native alias first if the adapter has been updated,
    // then fall back to the shared key.
    state.nonDistrictBucketKey =
      provFlat.zoteroCollectionKey_nonDistrictBucket ||
      provFlat.zoteroCollectionKey_nonProvincialSamoa ||
      provFlat.zoteroCollectionKey_nonProvincialFiji ||
      null;

    // District collection key lookups
    geo.features.forEach(f => {
      const p = f.properties;
      if (p.zoteroCollectionKey_publicationLocation) state.provinceColKeyByName.location.set(p.name, p.zoteroCollectionKey_publicationLocation);
      if (p.zoteroCollectionKey_paternalProvince)    state.provinceColKeyByName.paternal.set(p.name, p.zoteroCollectionKey_paternalProvince);
    });

    // Samoan collection keys (used to compute the "Samoan author" badge).
    // We treat an item as Samoan-authored if it sits in ANY of these trees:
    //   1. 'Samoan authors (>N papers)' → direct child author sub-collections
    //   2. 'By or with Samoan authors'
    //   3. 'Samoan Thesis by Country/Universities' → country → university tree
    //      (this catches ~1000 Samoan-graduate theses that don't have their own
    //      author sub-collection under the >N-papers root)
    // The trees are collected via a recursive descendant walk so nested
    // country/university sub-collections all resolve to Samoan.
    const itaukeiParents = snap.collections.filter(c =>
      c.name === 'By or with Samoan authors' || c.name.startsWith('Samoan authors')
    );
    const itaukeiParentKeys = new Set(itaukeiParents.map(c => c.key));
    const authorRoot = findItaukeiRootCollection(snap.collections);
    if (authorRoot) {
      snap.collections.forEach(c => { if (c.parent === authorRoot.key) itaukeiParentKeys.add(c.key); });
    }
    const byWith = snap.collections.find(c => c.name === 'By or with Samoan authors');
    if (byWith) itaukeiParentKeys.add(byWith.key);

    // Recursively add every descendant under the Samoan Thesis tree.
    // Match by stable Zotero key first so panel-prefix renames (e.g. 'B2-'
    // in front of the collection name) don't silently break the classifier.
    const thesisRoot = snap.collections.find(c => c.key === '9XHGQJE6')
                    || snap.collections.find(c => c.name === 'B2-Samoan Thesis by Country/Universities')
                    || snap.collections.find(c => c.name === 'Samoan Thesis by Country/Universities');
    if (thesisRoot) {
      itaukeiParentKeys.add(thesisRoot.key);
      // Iterate breadth-first through the collection list until no new keys are added.
      let changed = true;
      while (changed) {
        changed = false;
        snap.collections.forEach(c => {
          if (c.parent && itaukeiParentKeys.has(c.parent) && !itaukeiParentKeys.has(c.key)) {
            itaukeiParentKeys.add(c.key);
            changed = true;
          }
        });
      }
    }
    state.itaukeiKeys = itaukeiParentKeys;

    state.colByKey = new Map(snap.collections.map(c => [c.key, c]));

    // ---- Discipline mapping ----
    const disciplineRoot = snap.collections.find(c => c.name === 'Discipline');
    if (disciplineRoot) {
      // For each collection, walk up the parent chain until we hit a direct child of "Discipline"
      snap.collections.forEach(c => {
        let cur = c, root = null, guard = 0;
        while (cur && guard++ < 20) {
          if (cur.parent === disciplineRoot.key) { root = cur; break; }
          if (!cur.parent) break;
          cur = state.colByKey.get(cur.parent);
        }
        if (root) state.disciplineByColKey.set(c.key, root.name);
      });
    }

    // ---- Scholar leaderboard membership ----
    if (authorRoot) {
      snap.collections.forEach(c => {
        if (c.parent === authorRoot.key) {
          state.scholarKeyByName.set(c.name, c.key);
        }
      });
    }

    // ---- Per-item derived tag indexes ----
    // Build Samoan last-name set from the scholar leaderboard ("Last, First" → "Last").
    // Used to identify Samoan lead-authored items via first-creator surname match.
    const itaukeiLastNames = new Set();
    state.scholarKeyByName.forEach((_, fullName) => {
      const last = fullName.split(',')[0].trim().toLowerCase();
      if (last) itaukeiLastNames.add(last);
    });
    state.itaukeiLastNames = itaukeiLastNames;

    // ---- Samoan canonical-name set (master roster) ----
    // For A2 KPI classification we do NOT use surname matching — that over-fires on
    // non-Samoan people who happen to share an Samoan surname (e.g. James Fong,
    // Sakiusa Fong, Patrick Fong are all different people; see docs/NAMES-DO-NOT-MERGE.md).
    // Instead, we resolve every Zotero creator through the admin nameAliases map
    // (variant → canonical) and check membership in the union of:
    //   (a) admin scholar canonicals (data/scholar-profiles.json .scholars[].name), and
    //   (b) progress-Sheet canonicals (master roster; ~474 rows, fetched at runtime).
    // Field data (district, institution, degrees) still comes from admin only.
    const itaukeiCanonicalKeys = new Set();
    const HYPH_RE = /[\u2010\u2011\u2013\u2212]/g;
    const keyifyName = s => (s || '').replace(HYPH_RE, '-').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Seed the canonical set with admin scholar-profile names (curated Samoan list).
    state.scholarProfilesByName.forEach((_, name) => {
      const k = keyifyName(name);
      if (k) itaukeiCanonicalKeys.add(k);
    });
    // Also seed with the progress-Sheet master roster (the Scholars tab of
    // https://docs.google.com/spreadsheets/d/12N31Xcyn1VnqRYmKt8umPeS94ctCv-MFRLt3zRJP3SU
    // — ~473 rows). This is the source of truth per the July 2026 admin directive.
    (state.progressRosterKeys || []).forEach(k => itaukeiCanonicalKeys.add(k));
    // Only NOW merge nameAliases — and only for entries whose canonical (or variant)
    // is already a known Samoan scholar. The aliases map is a general variant→canonical
    // dictionary that also contains non-Samoan co-authors (Morris, McCabe, Mounsey,
    // etc.) and would otherwise pollute the Samoan set. Filtering here keeps
    // "Fong, Patrick Sakiusa" → "Fong, Patrick S." resolving while blocking
    // "Morris, C." → "Morris, Cherie" from being treated as Samoan.
    (state.nameAliases || new Map()).forEach((canonical, variant) => {
      const ck = keyifyName(canonical);
      const vk = keyifyName(variant);
      if (itaukeiCanonicalKeys.has(ck) || itaukeiCanonicalKeys.has(vk)) {
        if (ck) itaukeiCanonicalKeys.add(ck);
        if (vk) itaukeiCanonicalKeys.add(vk);
      }
    });
    // Final veto: remove any key that the admin has explicitly marked as NOT Samoan.
    // Belt-and-suspenders in case a name slipped into aliases or profiles by mistake.
    (state.notItaukeiCanonicalKeys || new Set()).forEach(k => itaukeiCanonicalKeys.delete(k));
    state.itaukeiCanonicalKeys = itaukeiCanonicalKeys;
    state._keyifyName = keyifyName;

    snap.items.forEach(it => {
      const disc = new Set();
      const provs = new Set();
      const paternal = new Set();
      const scholars = new Set();
      (it.collections || []).forEach(k => {
        const d = state.disciplineByColKey.get(k);
        if (d) disc.add(d);
        // district lookups
        state.provinceColKeyByName.location.forEach((ck, name) => { if (ck === k) provs.add(name); });
        state.provinceColKeyByName.paternal.forEach((ck, name) => { if (ck === k) paternal.add(name); });
        // scholar lookups (reverse map: key -> name)
        state.scholarKeyByName.forEach((sk, name) => { if (sk === k) scholars.add(name); });
      });
      state.disciplinesByItem.set(it.key, disc);
      state.provincesByItem.set(it.key, provs);
      state.paternalByItem.set(it.key, paternal);
      state.scholarByItem.set(it.key, scholars);
    });
  }

  // Resolve a Zotero creator ("Ron Vave", "R. Vave", "Nabobo-Baba, Unaisi", etc.)
  // against the union of admin canonicals AND progress-Sheet canonicals via nameAliases.
  // Returns true only if the creator matches a KNOWN canonical Samoan scholar (not
  // just a shared surname). See docs/NAMES-DO-NOT-MERGE.md for the rationale.
  function creatorIsItaukei(name) {
    if (!name) return false;
    const canon = state.itaukeiCanonicalKeys;
    if (!canon || !canon.size) return false;
    const keyify = state._keyifyName || (s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    // 1) Try the creator string as-is (handles "Last, First" from admin variants)
    if (canon.has(keyify(name))) return true;
    // 2) Try flipped "First Last" → "Last, First"
    const s = String(name).trim();
    if (!s.includes(',')) {
      const tokens = s.split(/\s+/);
      if (tokens.length >= 2) {
        const flipped = tokens[tokens.length - 1] + ', ' + tokens.slice(0, -1).join(' ');
        if (canon.has(keyify(flipped))) return true;
      }
    } else {
      // 3) Also try dropping middle initial(s) — "Fong, Patrick S." vs "Fong, Patrick"
      const parts = s.split(',', 2);
      const first = (parts[1] || '').trim().split(/\s+/)[0] || '';
      if (first) {
        const trimmed = parts[0].trim() + ', ' + first;
        if (canon.has(keyify(trimmed))) return true;
      }
    }
    return false;
  }

  // Classify item authorship w.r.t. Samoan scholars
  //   returns 'lead'   — first-listed creator is Samoan
  //           'coauth' — an Samoan author is present but not first
  //           'none'   — no Samoan author on the record
  function itaukeiAuthorship(item) {
    // Master-file source of truth: the adapter records the real first-author
    // status on `item._masterAuthorship` (derived from the Authorship table's
    // `Is First Author?` / `Author Position === 1` columns). The Master
    // authorship table only stores Samoan-scholar links, so creators[0]
    // cannot reliably indicate first-authorship for Master data. When present,
    // this flag wins over the creators-string heuristic below. See
    // docs/MASTER-FILE-REBUILD.md and js/samoa-database-adapter.js.
    if (item && item._masterAuthorship) return item._masterAuthorship;
    const creators = item.creators || [];
    if (creators.length && creatorIsItaukei(creators[0])) return 'lead';
    if (isItaukei(item)) return 'coauth';
    // Fall-back: creator-name match for items that are NOT in an Samoan Zotero collection
    for (let i = 1; i < creators.length; i++) {
      if (creatorIsItaukei(creators[i])) return 'coauth';
    }
    return 'none';
  }

  async function fetchJson(url) {
    // If the passcode gate is present (production build), route every data
    // fetch through it so encrypted .enc files are decoded transparently
    // with the visitor's in-memory AES key. Falls through to a plain fetch
    // when no gate is wired (local dev without encryption).
    if (window.dbGate && typeof window.dbGate.fetchJson === 'function') {
      return window.dbGate.fetchJson(url);
    }
    // Append a unique query string every time so browsers + CDNs can never
    // serve a stale cached response for admin-edited data files.
    const busted = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const r = await fetch(busted, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);
    return r.json();
  }

  // Small CSV parser tuned to what the admin dashboard exports; matches the
  // header row it writes so a paste from Google Sheets rehydrates cleanly.
  function parseCsvToScholars(text) {
    const rows = [];
    let cur = '', row = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i+1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && next === '\n') i++;
          row.push(cur); cur = '';
          if (row.length && row.some(v => v !== '')) rows.push(row);
          row = [];
        } else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
      // Nest types.* back into a types object for compatibility with local JSON
      const types = {};
      Object.keys(obj).forEach(k => {
        if (k.startsWith('types.')) { types[k.slice(6)] = parseInt(obj[k], 10) || 0; delete obj[k]; }
      });
      obj.types = types;
      obj.total = parseInt(obj.total, 10) || 0;
      obj.firstAuthored = parseInt(obj.firstAuthored, 10) || 0;
      return obj;
    });
  }

  // Broad definition: item is "Samoan-authored" if it belongs to any Samoan
  // Zotero collection, OR any of its creators' surnames match a known Samoan
  // scholar (this catches the ~21 items authored by Samoan scholars that were
  // not tagged into a collection).
  function isItaukei(item) {
    if ((item.collections || []).some(k => state.itaukeiKeys.has(k))) return true;
    return (item.creators || []).some(creatorIsItaukei);
  }

  // ============ URL SYNC ============
  function loadFilterFromUrl() {
    const params = new URLSearchParams(window.location.search);
    FILTER_KEYS.forEach(k => {
      if (params.has(k)) {
        const v = params.get(k);
        if (k === 'year') state.filter[k] = v ? parseInt(v, 10) : '';
        else state.filter[k] = v || '';
      }
    });
  }
  function writeFilterToUrl() {
    const params = new URLSearchParams();
    FILTER_KEYS.forEach(k => {
      const v = state.filter[k];
      if (v !== '' && v != null) params.set(k, String(v));
    });
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }

  // Note: clearFilter blindly resets state.filter[key] which includes the
  // Panel-B2 keys b2Group and b2Authorship.
  function clearFilter(key) {
    if (key === 'year') state.filter.year = '';
    else state.filter[key] = '';
    state.shown = state.pageSize;
    afterFilterChange();
  }
  function clearAllFilters() {
    FILTER_KEYS.forEach(k => { state.filter[k] = (k === 'year') ? '' : ''; });
    state.shown = state.pageSize;
    // Also reset the scholar-leaderboard dropdowns so “Clear all” truly clears
    // everything (they narrow both the cards and the item list).
    state.scholarConfFilter = '';
    state.scholarProvFilter = '';
    state.scholarPage = 1;
    if (typeof computeScholarFilterNames === 'function') computeScholarFilterNames();
    const confSel = $('[data-scholar-conf-filter]');
    const provSel = $('[data-scholar-prov-filter]');
    if (confSel) confSel.value = '';
    if (provSel) provSel.value = '';
    const search = $('[data-db-search]');
    if (search) search.value = '';
    $$('.db-filter[data-db-filter]').forEach(s => { s.value = ''; });
    afterFilterChange();
  }
  function afterFilterChange() {
    writeFilterToUrl();
    renderItems();
    renderFilterChips();
    renderHistogram();
    renderLeaders();          // to update active scholar highlight
    renderDonutLegendActive();
    renderPanelB();           // re-render bar chart to update active-district highlight
    updateClearAllButton();
  }
  function updateClearAllButton() {
    const btn = $('[data-db-clear]');
    if (!btn) return;
    const any = FILTER_KEYS.some(k => state.filter[k] !== '' && state.filter[k] != null)
              || !!state.scholarConfFilter
              || !!state.scholarProvFilter;
    btn.classList.toggle('is-hidden', !any);
  }

  // ============ SYNC FRESHNESS BADGE ============
  function relativeTime(iso) {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffSec = Math.max(1, Math.floor((now - then) / 1000));
    if (diffSec < 60) return `${diffSec} sec ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 48) return `${diffH} hour${diffH === 1 ? '' : 's'} ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD} day${diffD === 1 ? '' : 's'} ago`;
    const diffMo = Math.floor(diffD / 30);
    if (diffMo < 24) return `${diffMo} month${diffMo === 1 ? '' : 's'} ago`;
    const diffY = Math.floor(diffMo / 12);
    return `${diffY} year${diffY === 1 ? '' : 's'} ago`;
  }
  function setSyncBadge(status, text, note) {
    const badge = $('[data-db-sync]');
    const textNode = $('[data-db-sync-text]');
    const noteNode = $('[data-db-sync-note]');
    if (!badge || !textNode) return;
    badge.classList.remove('is-stale', 'is-error');
    if (status === 'stale') badge.classList.add('is-stale');
    if (status === 'error') badge.classList.add('is-error');
    textNode.textContent = text;
    if (noteNode) noteNode.textContent = note || '';
  }
  function showFallbackBanner(reason) {
    const banner = $('[data-db-fallback]');
    if (!banner) return;
    banner.classList.add('is-visible');
    if (reason) banner.setAttribute('data-reason', reason);
  }

  // ============ STATS ============
  //
  // The top section is now split into two clearly-distinct blocks:
  //   1) Database overview   — statistics describing the ENTIRE indexed dataset.
  //   2) Samoan scholarship — statistics filtered to Samoan-authored items and
  //                            Samoan graduate research.
  // Numbers must never be duplicated across the two blocks unless they are
  // genuinely different measurements. Each label must state its unit clearly.
  function renderStats() {
    const snap  = state.snapshot;
    // A1 + A2 sit ABOVE the world map (Panel B2), so they always reflect the
    // full database, not the world filter that only affects panels below.
    const items = snap.items;
    const sync  = state.lastSync;

    // ---- Database-wide totals ----
    const totalWorks = items.length;
    const theses     = items.filter(i => i.itemType === 'thesis');
    const totalTheses = theses.length;

    // Unique authors: dedupe by normalised surname + first initial. Creators in
    // this snapshot are stored as plain strings (either "First Last" or
    // "Last, First"). This keeps "Sopoaga, Faafetai" and "Sopoaga, F." as one
    // person while still separating different authors with the same surname.
    const authorSet = new Set();
    items.forEach(it => (it.creators || []).forEach(raw => {
      if (!raw || typeof raw !== 'string') return;
      const s = raw.trim();
      if (!s) return;
      let last = '', first = '';
      if (s.includes(',')) {
        // "Last, First Middle"
        const [ln, fn] = s.split(',', 2);
        last  = (ln || '').trim();
        first = (fn || '').trim();
      } else {
        // "First Middle Last" — last token is the surname (handles "Nunia T. Thomas").
        const tokens = s.split(/\s+/);
        if (tokens.length === 1) {
          last = tokens[0];
        } else {
          last  = tokens[tokens.length - 1];
          first = tokens[0];
        }
      }
      last  = last.toLowerCase().replace(/[.]/g, '').trim();
      first = first.toLowerCase().replace(/[.]/g, '').trim();
      if (!last && !first) return;
      const firstInit = first ? first[0] : '';
      authorSet.add(`${last}|${firstInit}`);
    }));
    const uniqueAuthors = authorSet.size;

    // Samoa districts studied — any district tagged on ≥1 publication.
    const provsStudied = new Set();
    state.provincesByItem.forEach(s => s.forEach(p => provsStudied.add(p)));

    // ---- Samoan-scholarship counts ----
    let itLed = 0, itCoauth = 0;
    items.forEach(it => {
      const r = itaukeiAuthorship(it);
      if (r === 'lead')   itLed++;
      else if (r === 'coauth') itCoauth++;
    });
    const itWorks = itLed + itCoauth;

    let itPhd = 0, itMasters = 0, itThesesOther = 0;
    theses.forEach(t => {
      if (!isItaukei(t)) return;
      const lvl = t.thesisLevel;
      if (lvl === 'phd') itPhd++;
      else if (lvl === 'masters') itMasters++;
      else itThesesOther++;
    });
    const itTheses = itPhd + itMasters + itThesesOther;

    // Samoan graduate-study universities and countries — from the graduate
    // studies data (theses that appear in a scholar's Samoan sub-collection).
    const grad = state.graduateStudies || { worldPoints: [] };
    const gradUnis = new Set(), gradCountries = new Set();
    (grad.worldPoints || []).forEach(wp => {
      if (wp.university) gradUnis.add(wp.university);
      if (wp.country)    gradCountries.add(wp.country);
    });

    // ---- Populate DOM ----
    const setText = (sel, val) => {
      const n = document.querySelector(sel);
      if (n) n.textContent = val;
    };
    const fmt = n => (typeof n === 'number') ? n.toLocaleString() : String(n);

    // Database overview
    setText('[data-kpi="db-works"]',     fmt(totalWorks));
    setText('[data-kpi="db-authors"]',   fmt(uniqueAuthors));
    setText('[data-kpi="db-theses"]',    fmt(totalTheses));
    // A1 Universities/Countries — cover the ENTIRE database of theses (Samoan
    // + non-Samoan author theses). Reads the raw thesis "university" field on
    // every Zotero item with itemType="thesis" and resolves to a country via
    // (a) samoan-graduate-studies.json worldPoints, (b) world-universities.json,
    // (c) data/uni-country-overrides.json for names not covered by (a) or (b).
    // See docs/NAMES-DO-NOT-MERGE.md “A1 Panel — DB-wide universities/countries”.
    const dbUnis = new Set();
    const dbCountries = new Set();
    {
      const lookup = new Map();
      const put = (name, country) => {
        if (!name || !country) return;
        const k = String(name).trim().toLowerCase();
        if (!k) return;
        if (!lookup.has(k)) lookup.set(k, country);
      };
      ((state.universities && state.universities.universities) || []).forEach(u => put(u.name, u.country));
      ((state.graduateStudies && state.graduateStudies.worldPoints) || []).forEach(w => put(w.university, w.country));
      Object.entries(state.uniCountryOverrides || {}).forEach(([k, v]) => lookup.set(String(k).toLowerCase(), v));
      const resolveCountry = raw => {
        const s = String(raw || '').trim().toLowerCase();
        if (!s) return null;
        if (lookup.has(s)) return lookup.get(s);
        if (s.startsWith('the ') && lookup.has(s.slice(4))) return lookup.get(s.slice(4));
        return null;
      };
      theses.forEach(t => {
        const u = (t.university || '').trim();
        if (!u) return;
        const uLower = u.toLowerCase();
        if (uLower.startsWith('institution not') || uLower === 'unspecified') return;
        dbUnis.add(u);
        const c = resolveCountry(u);
        if (c) dbCountries.add(c);
      });
    }
    setText('[data-kpi="db-unis"]',      fmt(dbUnis.size));
    setText('[data-kpi="db-countries"]', fmt(dbCountries.size));
    setText('[data-kpi="db-districts"]', fmt(provsStudied.size));

    // Samoan scholarship
    setText('[data-kpi="it-works"]',     fmt(itWorks));
    setText('[data-kpi="it-led"]',       fmt(itLed));
    setText('[data-kpi="it-coauth"]',    fmt(itCoauth));
    setText('[data-kpi="it-theses"]',    fmt(itTheses));
    setText('[data-kpi="it-unis"]',      fmt(gradUnis.size));
    setText('[data-kpi="it-countries"]', fmt(gradCountries.size));

    // Status pills
    const liveTotal = (sync && typeof sync.totalItems === 'number') ? sync.totalItems : totalWorks;
    setText('[data-db-live-total]', fmt(liveTotal));
    setText('[data-db-snap-total]', fmt(totalWorks));
    setText('[data-db-samoan-count]', fmt(itWorks));

    const checkedIso = (sync && sync.lastChecked) || snap.generatedAt;
    const changedIso = (sync && sync.lastChanged) || snap.generatedAt;
    const ago = relativeTime(checkedIso);
    const daysOldChecked = (Date.now() - new Date(checkedIso).getTime()) / 86400000;
    const status = daysOldChecked > 2 ? 'stale' : 'ok';
    setSyncBadge(status,
      `Checked ${ago}`,
      status === 'stale' ? 'Sync heartbeat is over 48h old — GitHub Action may be paused' : ''
    );
    const badge = $('[data-db-sync]');
    if (badge) {
      const tip = sync && sync.summary
        ? `Last checked ${new Date(checkedIso).toISOString()} — ${sync.summary}`
        : `Snapshot generated ${new Date(snap.generatedAt).toISOString()}`;
      badge.setAttribute('title', tip);
    }

    // "Updated — <date>" pill: reflects the last time the underlying data
    // actually moved (changedIso), not just the heartbeat.
    const updatedPill = $('[data-db-updated-pill]');
    if (updatedPill) {
      const d = new Date(changedIso);
      updatedPill.textContent = 'Updated ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Footer line (unchanged)
    const dataChangedAt = new Date(changedIso).toLocaleString();
    const footer = $('[data-db-updated]');
    if (footer) footer.textContent =
      `Sync checked ${new Date(checkedIso).toLocaleString()} · last data change ${dataChangedAt} · ${totalWorks} items indexed`;

    // ---- Narrative card ----
    renderTopNarrative({
      totalWorks, itWorks, itLed, itCoauth,
      itPhd, itMasters, itThesesOther, itTheses,
      gradUnis: gradUnis.size, gradCountries: gradCountries.size,
      provincesStudied: provsStudied.size
    });
  }

  // Dynamic paragraph + four insight blocks for the Samoan narrative card.
  function renderTopNarrative(x) {
    const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;
    const bodyEl = document.querySelector('[data-narrative-body]');
    if (bodyEl) {
      // Contract the paragraph gracefully when counts are zero.
      const fmt = n => (typeof n === 'number') ? n.toLocaleString() : String(n);
      // Narrative wording — Ron-approved "Variant A" (Jul 2026). Do not
      // rewrite the sentence openers; the rotation is deliberate so no
      // two consecutive sentences begin with "Of the 1,606". See
      // docs/NAMES-DO-NOT-MERGE.md “A2 narrative — Samoan scholarly
      // research at a glance” for the full pinned template.
      //
      // Openers, in order:
      //   1. Of the {totalWorks} publications in the database, ...
      //   2. Within this Samoan-authored body of work, ...
      //   3. A further {itCoauth} ({pct}) are ...
      //   4. These {itWorks} publications include ...
      //   5. Together, this scholarship ...
      // Percentages are shown alongside every number — do not drop them.
      const parts = [];
      // Use the KPI's itTheses total (matches A2 card 4) rather than
      // itPhd+itMasters, because a handful of Samoan theses lack a
      // Master's/PhD level tag in Zotero and would otherwise be dropped.
      const itTheses = (typeof x.itTheses === 'number')
        ? x.itTheses
        : ((x.itMasters || 0) + (x.itPhd || 0) + (x.itThesesOther || 0));
      parts.push(`Of the ${fmt(x.totalWorks)} publications in the database, ${fmt(x.itWorks)} (${pct(x.itWorks, x.totalWorks)}%) are by or with Samoan authors.`);
      if (x.itWorks > 0) {
        parts.push(`Within this Samoan-authored body of work, ${fmt(x.itLed)} (${pct(x.itLed, x.itWorks)}%) are led by an Samoan first author \u2014 a substantial signal of research leadership.`);
        parts.push(`A further ${fmt(x.itCoauth)} (${pct(x.itCoauth, x.itWorks)}%) are co-authored with scholars of other ethnicities, from within Samoa and abroad, who are leading the authorship.`);
      }
      if (itTheses > 0) {
        parts.push(`These ${fmt(x.itWorks)} publications include ${fmt(itTheses)} theses (${pct(itTheses, x.itWorks)}%) \u2014 ${fmt(x.itPhd)} PhD and ${fmt(x.itMasters)} Master\u2019s \u2014 completed at ${fmt(x.gradUnis)} universities across ${fmt(x.gradCountries)} countries.`);
      }
      parts.push('Together, this scholarship spans diverse fields and connects with communities across all 14 districts of Samoa.');
      bodyEl.textContent = parts.join(' ');
    }
    const setText = (sel, txt) => { const n = document.querySelector(sel); if (n) n.textContent = txt; };
    const fmt = n => (typeof n === 'number') ? n.toLocaleString() : String(n);
    // Use the KPI itTheses (matches A2 card 4) so the insight card doesn't
    // report a lower thesis count than the KPI cards above it.
    const itTheses = (typeof x.itTheses === 'number')
      ? x.itTheses
      : ((x.itMasters || 0) + (x.itPhd || 0) + (x.itThesesOther || 0));
    setText('[data-insight="participation"]',
      `${fmt(x.itWorks)} of ${fmt(x.totalWorks)} indexed works (${pct(x.itWorks, x.totalWorks)}%) include at least one identified Samoan author.`);
    setText('[data-insight="leadership"]',
      x.itWorks > 0
        ? `${fmt(x.itLed)} of ${fmt(x.itWorks)} Samoan-involved works (${pct(x.itLed, x.itWorks)}%) are led by an Samoan first author; the remaining ${fmt(x.itCoauth)} (${pct(x.itCoauth, x.itWorks)}%) are as co-authors.`
        : 'No Samoan-authored works have been indexed yet.');
    setText('[data-insight="grad"]',
      x.itWorks > 0
        ? `Samoan scholars completed ${fmt(itTheses)} theses (${pct(itTheses, x.itWorks)}% of Samoan-involved works) \u2014 ${fmt(x.itPhd)} PhD and ${fmt(x.itMasters)} Master\u2019s \u2014 across ${fmt(x.gradUnis)} universities in ${fmt(x.gradCountries)} countries.`
        : `Samoan scholars completed ${fmt(x.itPhd)} PhD and ${fmt(x.itMasters)} Master\u2019s theses across ${fmt(x.gradUnis)} universities in ${fmt(x.gradCountries)} countries.`);
    setText('[data-insight="geo"]',
      `Samoan scholarship extends across ${fmt(x.gradCountries)} countries and connects with all 14 districts of Samoa.`);
  }

  // ============ MAP ============
  function initMap() {
    try {
      const map = L.map('db-map', {
        center: [-17.8, 178.0],
        zoom: 7,
        minZoom: 6,
        maxZoom: 12,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        wheelPxPerZoomLevel: 100
      });
      // Google Hybrid tiles (satellite imagery + labels). Uses Google's
      // public mt0-mt3.google.com CDN with lyrs=y (hybrid). Tiles wrap
      // horizontally so the map always fills the viewport, including
      // fullscreen. Subdomains are round-robined for parallelism.
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: 'Imagery &copy; Google',
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20
      }).addTo(map);
      state.map = map;
      renderChoropleth();
      // Fullscreen toggle for the Samoa choropleth map. On expand we
      // re-fit to the district layer bounds so the map re-centers on
      // Samoa at the wider aspect ratio; on collapse we restore.
      // Reset-view button for the Samoa choropleth map. Fits back to the
      // stored default bounds and closes any open popup. Same defaults are
      // reused for inline and fullscreen — the bounds already frame Samoa
      // tightly, so both aspect ratios read well.
      const fijiWrap = document.querySelector('[data-db-map-samoa-wrap]');
      const fijiResetBtn = document.querySelector('[data-db-map-samoa-reset-btn]');
      if (fijiWrap && fijiResetBtn) {
        fijiResetBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const m = state.map; if (!m) return;
          m.closePopup();
          const bounds = state.mapDefaultBounds || [[-19.6, 176.8], [-15.9, 180.9]];
          m.fitBounds(bounds, { padding: [4, 4], animate: true });
        });
      }
      wireMapFullscreen('[data-db-map-samoa-wrap]', '[data-db-map-samoa-fs-btn]', () => state.map, {
        onOpen: () => {
          const m = state.map; if (!m) return;
          state.mapPrevView = { center: m.getCenter(), zoom: m.getZoom() };
          const layer = state.provinceLayer;
          if (layer && typeof layer.getBounds === 'function') {
            try {
              const b = layer.getBounds();
              if (b && b.isValid()) m.fitBounds(b, { padding: [40, 40], animate: false });
            } catch (_) { m.setView([-17.8, 178.0], 7); }
          } else {
            m.setView([-17.8, 178.0], 7);
          }
        },
        onClose: () => {
          const m = state.map; const prev = state.mapPrevView;
          if (m && prev) m.setView(prev.center, prev.zoom, { animate: false });
        }
      });

      // Panel A mapview toggle (Samoa sub-tabs)
      $$('[data-mapscope-panel="samoa"] button').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('[data-mapscope-panel="samoa"] button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.mapView = btn.dataset.mapview;
          renderPanelA();
        });
      });
      // Panel A2 world-view sub-tabs (Where Samoan graduates study /
      // have published). Panel A1 no longer hosts a top-level scope toggle
      // — A2 is a separate standalone panel with its own Leaflet instance.
      $$('[data-mapscope-panel="world"] button').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          $$('[data-mapscope-panel="world"] button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.worldView = btn.dataset.worldview;
          renderWorldMap();
        });
      });

      // Initialise the standalone Panel A2 world map after Samoa is ready.
      // Wrapped in try/catch because the world map is a progressive
      // enhancement — Panel A1 must still work if this fails.
      try { initWorldMap(); } catch (e) { console.error('World map init failed', e); }
      // Initialise Panel B3 — Where Samoan research has been undertaken.
      try { initB3Map(); } catch (e) { console.error('B3 map init failed', e); }

      // Bounds tuned to the crop in Ron's revision-notes screenshot: shows all
      // three statistical regions (Viti Levu + Vanua Levu + Lau) without wasting
      // vertical whitespace above Vanua Levu or below Kadavu.
      // Tighter Samoa-focused framing (Ron's image-4 reference): Vanua Levu +
      // Viti Levu + Lau grouped without wasted margins.
      map.fitBounds([[-19.6, 176.8], [-15.9, 180.9]], { padding: [4, 4] });
      state.mapDefaultBounds = [[-19.6, 176.8], [-15.9, 180.9]];
    } catch (e) {
      console.error('Map init failed', e);
      const mapEl = $('#db-map');
      const err = $('[data-db-map-error]');
      if (mapEl) mapEl.style.display = 'none';
      if (err) err.style.display = 'block';
    }
  }

  // Filter items by the current map-view authorship criterion (used only in Panel A)
  function itemsForMapView() {
    const items = state.snapshot.items;
    if (state.mapView === 'all') return items;
    if (state.mapView === 'lead')   return items.filter(it => itaukeiAuthorship(it) === 'lead');
    if (state.mapView === 'coauth') return items.filter(it => itaukeiAuthorship(it) === 'coauth');
    return items;
  }

  // District publication breakdown (Panel A choropleth + statistical region legend numbers).
  // Uses districts-researched collection membership.
  function districtBreakdown(items) {
    const geo = state.districts;
    const result = new Map();
    geo.features.forEach(f => {
      const p = f.properties;
      const key = p.zoteroCollectionKey_publicationLocation;
      const scholarSet = new Set();
      const bucket = { total: 0, journalArticle: 0, thesisPhd: 0, thesisMasters: 0, thesisUnknown: 0, bookSection: 0, book: 0, conferencePaper: 0, report: 0, preprint: 0, document: 0, scholars: 0 };
      if (key) {
        items.forEach(it => {
          if ((it.collections || []).includes(key)) {
            bucket.total += 1;
            const vt = visualType(it);
            if (bucket[vt] != null) bucket[vt] += 1;
            // Count unique Samoan leaderboard scholars tied to this district
            const scholarsForItem = state.scholarByItem.get(it.key);
            if (scholarsForItem) scholarsForItem.forEach(s => scholarSet.add(s));
          }
        });
      }
      bucket.scholars = scholarSet.size;
      result.set(p.name, bucket);
    });
    return result;
  }

  // Warm palette — contrasts against the dark blue satellite ocean. Ron's
  // feedback was that the previous teal-on-teal scale blended into the water.
  // These are the YlOrRd-style ColorBrewer stops adjusted for Samoa imagery.
  function choroFill(n) {
    if (n === 0) return '#fff5eb';
    if (n <= 3) return '#fdd0a2';
    if (n <= 6) return '#fd8d3c';
    if (n <= 9) return '#e6550d';
    return '#a63603';
  }

  // ============ WORLD MAP (Ron's 2nd tab set) ============
  // Renders circle markers for universities where Samoan scholars have
  // completed graduate studies. Size + colour indicate scholar counts.
  // Data comes from data/samoan-graduate-studies.json (see refresh-graduate-studies.py).
  // -------- Right-hand panel for the World scope: countries → universities.
  // Aggregates worldPoints by country, sorts descending by total degrees, and
  // supports a drill-down into any country to reveal its universities. Clicks
  // are wired here; the map zoom is delegated to zoomToWorldCountry().
  // Module-scope profile lookup used by the statistical region/district rollup so it
  // matches the popup's `lookupProfile` behaviour (direct hit → "First Last"
  // → "Last, First" flip → first-token strip). Kept small on purpose — the
  // statistical region view only needs a Boolean + districts, no photo/village work.
  function b2LookupScholarProfile(name) {
    const map = state && state.scholarProfilesByName;
    if (!map || !name) return null;
    const aliases = (state && state.nameAliases) || new Map();
    function resolveAlias(k) { return aliases.get(k) || k; }
    let hit = map.get(name) || map.get(resolveAlias(name));
    if (hit) return hit;
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) {
      const last  = parts[parts.length - 1];
      const first = parts.slice(0, -1).join(' ');
      const lastFirst = `${last}, ${first}`;
      hit = map.get(lastFirst) || map.get(resolveAlias(lastFirst));
      if (hit) return hit;
      const firstTok = parts[0];
      const lastFirstTok = `${last}, ${firstTok}`;
      hit = map.get(lastFirstTok) || map.get(resolveAlias(lastFirstTok));
      if (hit) return hit;
    }
    return null;
  }

  // Statistical Region · District rollup for Panel B2 tabulated summary.
  // Traverses every worldPoints thesis and joins the scholar to a paternal
  // (falling back to maternal) district via scholarProfilesByName, then
  // groups by region. Scholars with no matched profile / no district
  // are counted separately as "Unmatched" so no thesis is silently dropped.
  function buildB2ConfederacyRollup() {
    // Statistical Region order matches the approved Panel B2 mockup.
    const CONF_ORDER = ['Apia Urban Area', 'Rest of Upolu', 'North West Upolu'];
    const grad = state.graduateStudies || { worldPoints: [] };
    const points = grad.worldPoints || [];

    const provAgg = new Map();      // district name -> { masters, phd, conf }
    const confAgg = new Map();      // conf name -> { masters, phd }
    CONF_ORDER.forEach(c => confAgg.set(c, { masters: 0, phd: 0 }));
    let unmatchedM = 0, unmatchedP = 0, unmatchedU = 0;
    let totalM = 0, totalP = 0, totalU = 0;

    function addToProv(name, conf, kind) {
      if (!provAgg.has(name)) provAgg.set(name, { name, conf, masters: 0, phd: 0 });
      const row = provAgg.get(name);
      if (kind === 'masters') row.masters += 1;
      else if (kind === 'phd') row.phd += 1;
    }

    points.forEach(p => {
      const groups = [
        { kind: 'masters', names: p.mastersScholars || [] },
        { kind: 'phd',     names: p.phdScholars     || [] },
        { kind: 'unknown', names: p.unknownScholars || [] }
      ];
      groups.forEach(g => {
        g.names.forEach(nm => {
          if (g.kind === 'masters') totalM += 1;
          else if (g.kind === 'phd') totalP += 1;
          else totalU += 1;

          const profile = b2LookupScholarProfile(nm);
          const district = profile ? effectivePaternalProvince(profile) : '';
          const conf = district ? DISTRICT_TO_REGION[district] : '';
          if (!district || !conf) {
            if (g.kind === 'masters') unmatchedM += 1;
            else if (g.kind === 'phd') unmatchedP += 1;
            else unmatchedU += 1;
            return;
          }
          // Only Masters + PhD contribute to the tally (matches the mockup).
          if (g.kind === 'masters' || g.kind === 'phd') {
            const c = confAgg.get(conf);
            if (c) {
              if (g.kind === 'masters') c.masters += 1;
              else c.phd += 1;
            }
            addToProv(district, conf, g.kind);
          }
        });
      });
    });

    const confRows = CONF_ORDER.map(name => {
      const c = confAgg.get(name) || { masters: 0, phd: 0 };
      return { name, masters: c.masters, phd: c.phd, total: c.masters + c.phd };
    });

    const provRows = Array.from(provAgg.values())
      .map(r => Object.assign(r, { total: r.masters + r.phd }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    return {
      confRows,
      provRows,
      totals: {
        masters: totalM,
        phd:     totalP,
        other:   totalU,
        matched: provRows.reduce((a, r) => a + r.total, 0),
        unmatchedMasters: unmatchedM,
        unmatchedPhd:     unmatchedP,
        unmatchedOther:   unmatchedU
      }
    };
  }

  function renderWorldPanelConfederacyView(host) {
    if (!host) return;
    const { confRows, provRows, totals } = buildB2ConfederacyRollup();
    const parts = [];

    // "BY STATISTICAL REGION" label is appended with running totals for the
    // 3 statistical regions only (untagged is called out separately below).
    // Order: Total | Masters | PhD, separated by | signs, per Ron's
    // instruction. Numbers refresh automatically because the label is
    // rebuilt on every render from confRows.
    const confTotals = confRows.reduce(
      (a, r) => ({ masters: a.masters + r.masters, phd: a.phd + r.phd, total: a.total + r.total }),
      { masters: 0, phd: 0, total: 0 }
    );
    parts.push(
      '<div class="db-world-conf-list__label">' +
        'By Statistical Region ' +
        '<span class="db-world-conf-list__label-totals">' +
          `Total ${confTotals.total}` +
          ' | ' +
          `Masters ${confTotals.masters}` +
          ' | ' +
          `PhD ${confTotals.phd}` +
        '</span>' +
      '</div>'
    );

    // Single white card holds all three statistical region rows + the
    // Untagged row + the legend. Statistical Regions are sorted descending
    // by total (Masters + PhD) so the largest is always on top; ties
    // break alphabetically.
    parts.push('<div class="db-world-conf-list__conf-card">');
    const sortedConfRows = confRows.slice().sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name)
    );
    sortedConfRows.forEach(c => {
      const total = c.total || 1;
      const mPct = (c.masters / total) * 100;
      const pPct = (c.phd / total) * 100;
      parts.push(
        '<div class="db-world-conf-list__conf-row">' +
          '<span class="db-world-conf-list__conf-name">' +
            `<span class="db-world-conf-list__conf-dot" style="background:${CONF_COLORS[c.name] || '#94a3b8'};"></span>` +
            escapeHtml(c.name) +
          '</span>' +
          '<span class="db-world-conf-list__bar" role="img" ' +
            `aria-label="${escapeHtml(c.name)}: Masters ${c.masters}, PhD ${c.phd}, Total ${c.total}">` +
            `<span class="seg-m" style="width:${mPct.toFixed(1)}%;"></span>` +
            `<span class="seg-p" style="width:${pPct.toFixed(1)}%;"></span>` +
          '</span>' +
          '<span class="db-world-conf-list__counts">' +
            `<b>M</b> ${c.masters}` +
            '<span class="pipe"></span>' +
            `<b>PhD</b> ${c.phd}` +
            '<span class="pipe"></span>' +
            `<span class="db-world-total">Total ${c.total}</span>` +
          '</span>' +
        '</div>'
      );
    });

    // 4th row: Untagged theses (unmatched to a paternal/maternal
    // district, and therefore to a region). Same visual pattern
    // as the statistical region rows so Ron sees at a glance how many theses
    // still need district data on the Scholars sheet. This row is
    // ALWAYS shown — even when zero — so its absence never gets
    // mistaken for perfect coverage.
    const untaggedM = totals.unmatchedMasters || 0;
    const untaggedP = totals.unmatchedPhd || 0;
    const untaggedT = untaggedM + untaggedP;
    const untaggedDen = untaggedT || 1;
    const untaggedMPct = (untaggedM / untaggedDen) * 100;
    const untaggedPPct = (untaggedP / untaggedDen) * 100;
    parts.push(
      '<div class="db-world-conf-list__conf-row db-world-conf-list__conf-row--untagged">' +
        '<span class="db-world-conf-list__conf-name">' +
          '<span class="db-world-conf-list__conf-dot" style="background:#94a3b8;"></span>' +
          'Untagged' +
        '</span>' +
        '<span class="db-world-conf-list__bar" role="img" ' +
          `aria-label="Untagged: Masters ${untaggedM}, PhD ${untaggedP}, Total ${untaggedT}">` +
          `<span class="seg-m" style="width:${untaggedMPct.toFixed(1)}%;"></span>` +
          `<span class="seg-p" style="width:${untaggedPPct.toFixed(1)}%;"></span>` +
        '</span>' +
        '<span class="db-world-conf-list__counts">' +
          `<b>M</b> ${untaggedM}` +
          '<span class="pipe"></span>' +
          `<b>PhD</b> ${untaggedP}` +
          '<span class="pipe"></span>' +
          `<span class="db-world-total">Total ${untaggedT}</span>` +
        '</span>' +
      '</div>'
    );
    parts.push(
      '<div class="db-world-conf-list__legend">' +
        '<span><span class="sw" style="background:#8FBC8F;"></span><em>Masters</em></span>' +
        '<span><span class="sw" style="background:#228B22;"></span><em>PhD</em></span>' +
      '</div>'
    );
    parts.push('</div>');
    parts.push('<div class="db-world-conf-list__prov-label">By District · descending by total</div>');
    if (provRows.length === 0) {
      parts.push('<p class="db-conf-narrative">No districts matched yet.</p>');
    } else {
      parts.push('<div class="db-world-conf-list__prov-grid">');
      provRows.forEach(r => {
        parts.push(
          '<div class="db-world-conf-list__prov-row">' +
            `<span class="db-world-conf-list__prov-swatch" style="background:${CONF_COLORS[r.conf] || '#94a3b8'};"></span>` +
            `<span class="db-world-conf-list__prov-name">${escapeHtml(r.name)}</span>` +
            '<span class="db-world-conf-list__counts">' +
              `<b>M</b> ${r.masters}` +
              '<span class="pipe"></span>' +
              `<b>PhD</b> ${r.phd}` +
              '<span class="pipe"></span>' +
              `<span class="db-world-total">Tot ${r.total}</span>` +
            '</span>' +
          '</div>'
        );
      });
      parts.push('</div>');
    }

    // Note only calls out non-Masters/PhD higher-degree theses now
    // that the Untagged row surfaces missing-district Masters/PhD
    // theses visually. Coverage-grows reminder stays because it
    // tells Ron how to shrink the Untagged bar over time.
    const other = totals.other;
    if (other) {
      parts.push(
        '<p class="db-world-conf-list__note">' +
          '<b>Note.</b> ' +
          `${other} other higher-degree ${other === 1 ? 'thesis is' : 'theses are'} not included in the Masters/PhD tally. ` +
          'The Untagged row shrinks as village and district fields are completed on the Scholars sheet.' +
        '</p>'
      );
    }

    host.innerHTML = parts.join('');
  }

  function applyWorldListView() {
    const view = state.worldListView || 'country';
    const listView = document.querySelector('[data-world-list-view]');
    if (!listView) return;
    const tabs = listView.querySelectorAll('[data-world-list-tab]');
    tabs.forEach(btn => {
      const on = btn.dataset.worldListTab === view;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
    });
    const searchWrap = listView.querySelector('[data-world-search-wrap]');
    const countryList = listView.querySelector('[data-world-country-list]');
    const emptyEl = listView.querySelector('[data-world-empty]');
    const narrEl = listView.querySelector('[data-world-narrative]');
    const confHost = listView.querySelector('[data-world-region-list]');
    const titleEl = listView.querySelector('[data-world-list-title]');
    const explainEl = listView.querySelector('[data-world-list-explain]');
    const showCountry = view === 'country';
    if (searchWrap)  searchWrap.style.display  = showCountry ? '' : 'none';
    if (countryList) countryList.style.display = showCountry ? '' : 'none';
    if (narrEl)      narrEl.style.display      = showCountry ? '' : 'none';
    if (confHost)    confHost.style.display    = showCountry ? 'none' : '';
    if (emptyEl && !showCountry) emptyEl.style.display = 'none';
    if (titleEl) titleEl.textContent = showCountry
      ? 'Countries of Samoan graduate study'
      : 'Samoan graduates by Statistical Region · District';
    if (explainEl) explainEl.textContent = showCountry
      ? 'Click a country to zoom the map and filter the scholar and publication lists (Panels F and G) to just that country. Then click a university to narrow further.'
      : 'Masters and PhD theses grouped by the scholar’s chiefly Statistical Region (North West Upolu, Apia Urban Area, Rest of Upolu), then broken down by home District in descending order by total.';
    if (!showCountry && confHost) renderWorldPanelConfederacyView(confHost);
  }

  function bindWorldListTabs() {
    if (bindWorldListTabs._bound) return;
    const listView = document.querySelector('[data-world-list-view]');
    if (!listView) return;
    const tabs = listView.querySelectorAll('[data-world-list-tab]');
    if (!tabs.length) return;
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        state.worldListView = btn.dataset.worldListTab || 'country';
        applyWorldListView();
      });
    });
    bindWorldListTabs._bound = true;
  }

  function renderWorldPanel() {
    const listView   = document.querySelector('[data-world-list-view]');
    const detailView = document.querySelector('[data-world-detail-view]');
    const listHost   = document.querySelector('[data-world-country-list]');
    if (!listHost || !listView || !detailView) return;
    bindWorldListTabs();

    const grad = state.graduateStudies || { worldPoints: [] };
    const points = grad.worldPoints || [];

    // Aggregate per country. `unknown` covers theses whose degree level
    // couldn't be classified from thesisType (e.g. 'M.L.I.S. thesis'). We
    // count them in the country total so no thesis is silently dropped, but
    // keep the Masters / PhD pills as-is.
    const byCountry = new Map();
    points.forEach(p => {
      if (!byCountry.has(p.country)) {
        byCountry.set(p.country, { name: p.country, iso: p.iso, masters: 0, phd: 0, unknown: 0, unis: [] });
      }
      const c = byCountry.get(p.country);
      c.masters += (p.mastersScholars || []).length;
      c.phd     += (p.phdScholars || []).length;
      c.unknown += (p.unknownScholars || []).length;
      c.unis.push(p);
    });
    const countries = Array.from(byCountry.values())
      .map(c => Object.assign(c, { total: c.masters + c.phd + c.unknown }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    // Grab the university-detail view (third drill level). It exists only
    // in Panel A2's markup; older layouts didn't have it, so treat as optional.
    const uniDetailView = document.querySelector('[data-world-uni-detail-view]');

    // Level 3: a specific university selected within a country.
    if (state.worldSelectedCountry && state.worldSelectedUniversity && uniDetailView) {
      listView.style.display = 'none';
      detailView.style.display = 'none';
      uniDetailView.style.display = '';
      const uni = points.find(p => p.university === state.worldSelectedUniversity
        && p.country === state.worldSelectedCountry);
      const titleEl = document.querySelector('[data-world-uni-detail-title]');
      const subtitleEl = document.querySelector('[data-world-uni-detail-subtitle]');
      const scholarsHost = document.querySelector('[data-world-uni-scholars]');
      if (uni) {
        const m = uni.mastersScholars.length;
        const ph = uni.phdScholars.length;
        const k = (uni.unknownScholars || []).length;
        const total = m + ph + k;
        if (titleEl) titleEl.textContent = uni.university;
        if (subtitleEl) {
          subtitleEl.innerHTML =
            `${escapeHtml(uni.country)} · ` +
            `<b>Masters</b> ${m} <span class="pipe"></span> ` +
            `<b>PhD</b> ${ph}` +
            (k ? ` <span class="pipe"></span> <b>Other</b> ${k}` : '') +
            ` <span class="pipe"></span> ` +
            `<span class="db-world-total">Total ${total}</span>`;
        }
        if (scholarsHost) {
          scholarsHost.innerHTML = '';
          // Order each section earliest → most-recent graduation year, ties
          // alphabetical (mirrors the map-popup ordering so the two surfaces
          // stay consistent).
          const groups = [
            { key: 'phd',     label: 'PhD',     cls: 'is-phd',     names: sortScholarsByYearAsc(uni.phdScholars, uni, 'phd') },
            { key: 'masters', label: 'Masters', cls: 'is-masters', names: sortScholarsByYearAsc(uni.mastersScholars, uni, 'masters') },
            { key: 'other',   label: 'Other',   cls: 'is-other',   names: sortScholarsByYearAsc(uni.unknownScholars || [], uni, 'other') }
          ];
          groups.forEach(g => {
            if (!g.names.length) return;
            const wrap = document.createElement('div');
            wrap.className = `db-scholar-group ${g.cls}`;
            wrap.innerHTML =
              `<h5>${g.label} (${g.names.length})</h5>` +
              renderScholarNameList(g.names, g.key);
            scholarsHost.appendChild(wrap);
          });
          // Wire the same rich hover card the map popup uses so hovering a
          // scholar name in the uni-detail table reveals photo / paternal-
          // geography / thesis title, mirroring the map-popup experience.
          wireScholarHoverCard(scholarsHost, uni);
        }
      } else {
        if (titleEl) titleEl.textContent = state.worldSelectedUniversity;
        if (subtitleEl) subtitleEl.textContent = 'No data available for this university.';
        if (scholarsHost) scholarsHost.innerHTML = '';
      }
      return;
    }

    // Level 2: a country selected — show its universities.
    if (state.worldSelectedCountry) {
      // Drill-down view for the selected country.
      listView.style.display = 'none';
      detailView.style.display = '';
      if (uniDetailView) uniDetailView.style.display = 'none';
      const c = byCountry.get(state.worldSelectedCountry);
      const titleEl    = document.querySelector('[data-world-detail-title]');
      const subtitleEl = document.querySelector('[data-world-detail-subtitle]');
      const uniHost    = document.querySelector('[data-world-uni-list]');
      if (c) {
        if (titleEl) titleEl.textContent = c.name;
        if (subtitleEl) {
          subtitleEl.innerHTML =
            `<b>Masters</b> ${c.masters} <span class="pipe"></span> ` +
            `<b>PhD</b> ${c.phd} <span class="pipe"></span> ` +
            `<span class="db-world-total">Total ${c.total}</span> ` +
            `· ${c.unis.length} ${c.unis.length === 1 ? 'university' : 'universities'}`;
        }
        if (uniHost) {
          uniHost.innerHTML = '';
          c.unis.slice().sort((a, b) => {
            const at = a.phdScholars.length + a.mastersScholars.length + (a.unknownScholars || []).length;
            const bt = b.phdScholars.length + b.mastersScholars.length + (b.unknownScholars || []).length;
            return bt - at || a.university.localeCompare(b.university);
          }).forEach(u => {
            const row = document.createElement('div');
            row.className = 'db-world-uni-row';
            if (state.worldSelectedUniversity === u.university) row.classList.add('is-filter-active');
            const m = u.mastersScholars.length;
            const p = u.phdScholars.length;
            const k = (u.unknownScholars || []).length;
            // University name is a real button so it's keyboard-focusable
            // and screenreader-visible as an interactive element. Clicking
            // drills down to the scholar-level view AND filters the panels
            // below to just that university.
            const nameBtn = document.createElement('button');
            nameBtn.type = 'button';
            nameBtn.className = 'db-world-uni-row__name is-clickable';
            nameBtn.textContent = u.university;
            nameBtn.setAttribute('aria-label', 'Filter panels below by ' + u.university);
            nameBtn.addEventListener('click', () => selectWorldUniversity(u.university));
            const counts = document.createElement('span');
            counts.className = 'db-world-uni-row__counts';
            // Include a Total column so the university rows mirror the
            // country-list layout (Masters | PhD | Total). Total = Masters
            // + PhD (+ Other when present).
            const t = m + p + k;
            counts.innerHTML =
              `<b>Masters</b> ${m} ` +
              `<span class="pipe"></span> <b>PhD</b> ${p}` +
              (k ? ` <span class="pipe"></span> <b>Other</b> ${k}` : '') +
              ` <span class="pipe"></span> <span class="db-world-total">Total ${t}</span>`;
            row.appendChild(nameBtn);
            row.appendChild(counts);
            uniHost.appendChild(row);
          });
        }
      } else {
        if (titleEl) titleEl.textContent = state.worldSelectedCountry;
        if (subtitleEl) subtitleEl.textContent = 'No data available for this country.';
        if (uniHost) uniHost.innerHTML = '';
      }
      return;
    }

    // Default state: the country list.
    listView.style.display = '';
    detailView.style.display = 'none';
    if (uniDetailView) uniDetailView.style.display = 'none';
    listHost.innerHTML = '';

    // Search filter — keep a country if its own name matches, OR any of its
    // universities matches, OR any of its scholar names matches. Substring,
    // case-insensitive.
    const q = (state.worldSearchTerm || '').trim().toLowerCase();
    let displayCountries = countries;
    if (q) {
      displayCountries = countries.filter(c => {
        if (c.name.toLowerCase().includes(q)) return true;
        for (const u of c.unis) {
          if ((u.university || '').toLowerCase().includes(q)) return true;
          const scholarLists = [u.mastersScholars, u.phdScholars, u.unknownScholars];
          for (const list of scholarLists) {
            if (!list) continue;
            for (const n of list) if ((n || '').toLowerCase().includes(q)) return true;
          }
        }
        return false;
      });
    }
    const emptyEl = document.querySelector('[data-world-empty]');
    if (emptyEl) emptyEl.style.display = (displayCountries.length === 0) ? '' : 'none';

    displayCountries.forEach(c => {
      const row = document.createElement('div');
      row.className = 'db-world-country-row';
      if (state.worldSelectedCountry === c.name) row.classList.add('is-filter-active');
      // Country name is a real button so it stays keyboard-focusable and
      // announces as interactive; the university count sits OUTSIDE the
      // button so it isn't underlined and doesn't get read as part of the
      // filter action's label.
      const nameWrap = document.createElement('span');
      nameWrap.className = 'db-world-country-row__name-wrap';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'db-world-country-row__name';
      btn.textContent = c.name;
      btn.setAttribute('aria-label', 'Filter panels below by ' + c.name);
      btn.addEventListener('click', () => selectWorldCountry(c.name));
      nameWrap.appendChild(btn);
      // University count in parentheses next to the country name.
      // Number of unique universities the pipeline has for this country
      // (each entry in c.unis is one distinct university leaf under the
      // Zotero Thesis root). Rendered on every draw so it stays in sync
      // with the 3-hour Zotero refresh / force sync.
      const uniN = Array.isArray(c.unis) ? c.unis.length : 0;
      const uniCount = document.createElement('span');
      uniCount.className = 'db-world-country-row__uni-count';
      // Gap between the name and the paren is handled by CSS margin-left
      // (see .db-world-country-row__uni-count) so it survives inline-flex
      // whitespace collapsing.
      uniCount.textContent = `(${uniN})`;
      uniCount.setAttribute('aria-label', `${uniN} ${uniN === 1 ? 'university' : 'universities'}`);
      nameWrap.appendChild(uniCount);
      row.appendChild(nameWrap);
      const counts = document.createElement('span');
      counts.className = 'db-world-country-row__counts';
      counts.innerHTML =
        `<b>Masters</b> ${c.masters} ` +
        `<span class="pipe"></span> <b>PhD</b> ${c.phd} ` +
        `<span class="pipe"></span> <span class="db-world-total">Total ${c.total}</span>`;
      row.appendChild(counts);
      listHost.appendChild(row);
    });

    // Global totals for both the summary sentence below the panel AND the
    // Panel B2 title suffix. Kept as one computation so the two never drift.
    const totM = countries.reduce((a, r) => a + r.masters, 0);
    const totP = countries.reduce((a, r) => a + r.phd, 0);
    const totU = countries.reduce((a, r) => a + (r.unknown || 0), 0);
    const totalTheses = totM + totP + totU;
    // Distinct universities across all countries — each worldPoint corresponds
    // to one (country, university) pair, so the size of `points` is the count.
    const totalUnis = new Set(points.map(p => `${p.country}||${p.university}`)).size;
    const totalCountries = countries.length;

    // Panel B2 narrative sentence intentionally left blank — Ron removed it
    // July 2026 because it duplicated the panel tally and drifted from truth
    // when the pipeline reclassified theses. The KPI tile row above the map
    // is now the single source of truth for panel-level totals.
    const narrEl = document.querySelector('[data-world-narrative]');
    if (narrEl) { narrEl.textContent = ''; }

    // -----------------------------------------------------------------
    // Panel B2 KPI tiles — 5 solid-fill tiles matching the A1/A2 family.
    // Numbers are always the full-database totals, regardless of
    // country/university/statistical region/district selection. Ron's July 2026
    // call: keep the tiles stable so they read as a global summary of the
    // whole indexed database, not a filter-follower.
    //
    // Tab awareness: today the panel only has one live dataset
    // (state.worldView === 'study', backed by graduate-studies
    // worldPoints). The 'publish' tab is disabled in markup until the
    // admin-tagged publications dataset lands. When it does, aggregate a
    // parallel points array under state.worldView === 'publish' and feed
    // it in here in place of `points` so the same tile logic renders both
    // tabs from the active dataset.
    // -----------------------------------------------------------------
    // Unique scholars across the world-map dataset. Each worldPoint carries
    // three name arrays — mastersScholars, phdScholars, unknownScholars — so
    // a scholar with both a Masters and a PhD, or two theses at the same
    // university, is counted once. Names are trimmed to avoid whitespace-only
    // duplicates. This is the count of Samoan graduates represented on the
    // world map (matches graduate-studies totals.scholars in the pipeline).
    const scholarNames = new Set();
    for (const p of points) {
      for (const key of ['phdScholars', 'mastersScholars', 'unknownScholars']) {
        const list = p[key];
        if (!Array.isArray(list)) continue;
        for (const n of list) {
          const trimmed = (n || '').trim();
          if (trimmed) scholarNames.add(trimmed);
        }
      }
    }
    const totalScholars = scholarNames.size;

    const kpiPairs = [
      ['theses',    totalTheses],
      ['scholars',  totalScholars],
      ['masters',   totM],
      ['phd',       totP],
      ['unis',      totalUnis],
      ['countries', totalCountries],
    ];
    kpiPairs.forEach(([key, value]) => {
      const numEl = document.querySelector(`[data-b2-kpi="${key}"]`);
      if (numEl) numEl.textContent = String(value);
    });

    // Apply the active list view (country vs region). This shows/hides
    // the country list + search vs the statistical region rollup, and re-renders the
    // rollup so it reflects the latest scholarProfilesByName state.
    applyWorldListView();
  }

  // -------- Panel B2 world-map default framing --------
  // Whole-world equator-centred framing (matches Ron's reference view).
  // Zoom 1 gives one world width of 512px; centre latitude 15° puts Europe/UK
  // near the top and NZ/Australia near the bottom without wasting polar space.
  const WORLD_MAP_DEFAULT_CENTER = [15, 30];
  const WORLD_MAP_DEFAULT_ZOOM = 1;

  // Fullscreen framing bounds — Pacific-centred rectangle 260° wide so
  // the map shows exactly ONE world copy (no wrap duplication). Latitude
  // band [-58, 62] keeps NZ and Iceland in frame while cropping the empty
  // polar caps; longitude band [30, 290] spans Africa east coast through
  // the Pacific to USA east coast, keeping Samoa (178°E) near center. To
  // avoid Leaflet drawing duplicate marker copies, we stay under 360°.
  const WORLD_MAP_FS_FIT_BOUNDS = [[-58, 30], [62, 290]];

  // -------- World-filter helpers --------
  // When a country or university is clicked in Panel B2, we filter every
  // downstream data panel (B1, C1, C2, D, E, F, G) to only items authored by
  // Samoan scholars whose graduate work took place in that country/uni.
  //
  // `worldFilteredScholarSet()` returns the Set of scholar names to keep, or
  // `null` when no filter is active. `worldFilterItems(items)` narrows an
  // item array using state.scholarByItem lookups. Item retained when any of
  // the item's tagged Samoan scholars is in the active-scholar set.
  function worldFilteredScholarSet() {
    const country = state.worldSelectedCountry;
    const uni = state.worldSelectedUniversity;
    if (!country && !uni) return null;
    // Build the set from scholar profile entries so the names line up with
    // the Zotero-collection scholar names used in `state.scholarByItem`.
    // A scholar is included when either their masters or phd graduate-study
    // entry matches the selected country (and, if set, university).
    const profiles = state.scholarProfilesByName || new Map();
    const set = new Set();
    profiles.forEach((p, name) => {
      const grad = [p && p.masters, p && p.phd].filter(Boolean);
      const matched = grad.some(g => {
        if (country && g.country !== country) return false;
        if (uni && g.university !== uni) return false;
        return true;
      });
      if (matched) set.add(name);
    });
    return set;
  }
  function worldFilterItems(items) {
    const set = worldFilteredScholarSet();
    if (!set) return items;
    return items.filter(it => {
      const scholars = state.scholarByItem && state.scholarByItem.get(it.key);
      if (!scholars) return false;
      for (const s of scholars) if (set.has(s)) return true;
      return false;
    });
  }
  // Convenience wrapper: yields the currently-visible snapshot items.
  // Every render function that reads state.snapshot.items should call this
  // instead so the world filter is honoured throughout the dashboard.
  function currentItems() {
    return worldFilterItems(state.snapshot.items);
  }

  // Show/hide the per-panel 'Filtered' + 'Clear filter' indicator on Panels F
  // and G, the only panels that actually respond to the world-map filter.
  // Also updates the selection chip in the B2 title bar so users always see
  // which country/university is driving the downstream filter.
  function refreshFilteredBadges() {
    const c = state.worldSelectedCountry;
    const u = state.worldSelectedUniversity;
    const worldActive = !!(c || u);
    // Scholar-panel filter (name, keyword, sector, discipline, region,
    // district, country/uni of study or work) also narrows Panel G below.
    let scholarActive = false;
    try { scholarActive = anyScholarFilterActive && anyScholarFilterActive(); } catch (e) {}
    const active = worldActive || !!scholarActive;
    document.querySelectorAll('[data-filtered-indicator]').forEach(el => {
      el.style.display = active ? '' : 'none';
    });
    const chip = document.querySelector('[data-world-selection-chip]');
    const chipLabel = document.querySelector('[data-world-selection-chip-label]');
    if (chip && chipLabel) {
      if (worldActive) {
        chipLabel.textContent = u ? `${u} · ${c}` : c;
        chip.style.display = '';
      } else {
        chip.style.display = 'none';
      }
    }
  }

  // Re-render only the two panels affected by the world filter: the scholar
  // leaderboard (Panel F) and the publications list (Panel G). The user
  // explicitly asked to keep every other panel unfiltered.
  function rerenderAfterWorldFilterChange() {
    refreshFilteredBadges();
    // Mirror the world filter into the F-panel scholar filter so its
    // existing plumbing narrows the scholar cards to those who studied here.
    state.scholarStudyCountry = state.worldSelectedCountry || '';
    state.scholarStudyUni = state.worldSelectedUniversity || '';
    // renderLeaders() now feeds Panel G itself (see the scholarFilterNames
    // block at the end of that function), so we don't need a separate
    // renderItems() call here — that would double-render.
    try { renderLeaders && renderLeaders(); } catch (e) {}
  }

  // -------- Scholar-name renderer with alternating blue / near-black --------
  // Names in the format "Last, First" already contain a comma — concatenating
  // with a comma separator makes the boundaries between people hard to see.
  // Alternating each person's colour (even = blue, odd = dark) and using
  // semicolons as separators fixes that visual ambiguity per Ron's request.
  // Shorten a full "First Middle1 Middle2 ... Last" or
  // "First Middle1 ... Last-Hyphenated" name for display. Rules:
  //   • First name kept as-is
  //   • Last token kept as-is (hyphenated surnames are one token, e.g.
  //     "Tausere-Tiko")
  //   • Every middle token collapses to its first letter + ".", with all
  //     middle initials concatenated (no space between them) so
  //     "Virisila Qolisaya Lidise Puamau" → "Virisila Q.L. Puamau"
  //   • 2-token names are unchanged ("Ron Vave" → "Ron Vave")
  //   • Already-initialled middles get a period added if missing
  //     ("Timaima T Tuvuki" → "Timaima T. Tuvuki")
  // This is display-only — the original full name is still stored in the
  // data-scholar-name attribute so search, hover-preselect, and thesis
  // lookups all continue to work against the full name.
  // Cached, normalized surname set built from all scholar profiles. Used by
  // shortenScholarName to recognize compound / hyphenated surnames that
  // appear space-separated in the graduate-studies feed (e.g. "Tausere Tiko"
  // → profile last = "Tausere-Tiko"). Rebuilt lazily whenever the profile
  // map identity changes.
  const _shortenNameCache = { profileMap: null, lastnames: null, hits: new Map() };
  function _rebuildShortenIndex() {
    const pm = (state && state.scholarProfilesByName) || new Map();
    if (_shortenNameCache.profileMap === pm && _shortenNameCache.lastnames) return;
    const norm = x => String(x || '').toLowerCase().replace(/[\s\-]+/g, '');
    const set = new Set();
    pm.forEach(p => { if (p && p.last) set.add(norm(p.last)); });
    _shortenNameCache.profileMap = pm;
    _shortenNameCache.lastnames = set;
    _shortenNameCache.hits.clear();
  }

  // Display formatter: return a scholar name as "First Last" only.
  // Middle names / initials are dropped entirely.
  //
  // Motivation (Ron, 2026-08-25): people know each other by first name;
  // "Bukarau-Kitolelei, S. Vilikia" hides the actual first name (Salanieta)
  // and surfaces a middle-name initial instead. Compact first+last is what
  // readers of the database use in conversation.
  //
  // Input feed shapes:
  //   1. "Last, First Middle..."  — Master graduate-studies feed and Zotero
  //   2. "First Middle Last"      — some legacy scholar-profile entries
  //   3. "Last, First"            — trivial 2-token comma form
  //   4. "First Last"             — already-flipped
  //   5. "Asesela D. (Asesela Drekeivalu) Ravuvu" — parenthetical variant
  //
  // Compound / hyphenated surnames (e.g. "Bukarau-Kitolelei",
  // "Tausere-Tiko") are preserved by consulting the scholar-profile
  // last-name index built by _rebuildShortenIndex.
  function shortenScholarName(full) {
    if (typeof full !== 'string') return '';
    const s = full.trim();
    if (!s) return '';
    _rebuildShortenIndex();
    const cached = _shortenNameCache.hits.get(s);
    if (cached !== undefined) return cached;

    // Strip parenthetical name-variants like "Asesela D. (Asesela Drekeivalu)
    // Ravuvu" — the parens are metadata, not part of the display name.
    const cleaned = s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

    const normalize = x => String(x || '').toLowerCase().replace(/[\s\-.]+/g, '');

    let first = '';
    let last  = '';

    const commaIdx = cleaned.indexOf(',');
    if (commaIdx !== -1) {
      // Comma form: "Last, First Middle...". Last is everything before the
      // comma (may itself be multi-token or hyphenated); first is the first
      // token after the comma.
      const beforeComma = cleaned.slice(0, commaIdx).trim();
      const afterComma  = cleaned.slice(commaIdx + 1).trim();
      last = beforeComma;
      const rest = afterComma.split(/\s+/).filter(Boolean);
      // Skip leading tokens that are just an initial ("S.", "S") so
      // "Bukarau-Kitolelei, S. Vilikia" resolves to first="Vilikia" — but
      // real 2-letter+ first names win. In practice the Master feed always
      // gives the FULL first name after the comma, so this only guards
      // pathological rows.
      first = rest.find(t => t.replace(/\W+/g, '').length >= 2) || rest[0] || '';
    } else {
      // No comma: "First Middle Last" or "First Last".
      const toks = cleaned.split(/\s+/).filter(Boolean);
      if (toks.length === 0) {
        _shortenNameCache.hits.set(s, cleaned);
        return cleaned;
      }
      if (toks.length === 1) {
        _shortenNameCache.hits.set(s, toks[0]);
        return toks[0];
      }
      first = toks[0];
      last  = toks[toks.length - 1];
      // Compound-surname absorb: try 2-token and 3-token trailing candidates
      // against the profile last-name index so "Tausere Tiko" → "Tausere-Tiko".
      for (let take = Math.min(3, toks.length - 1); take >= 2; take--) {
        const candidate = toks.slice(toks.length - take).join(' ');
        if (_shortenNameCache.lastnames.has(normalize(candidate))) {
          let display = candidate;
          _shortenNameCache.profileMap.forEach(p => {
            if (p && p.last && normalize(p.last) === normalize(candidate)) {
              display = p.last;
            }
          });
          last = display;
          break;
        }
      }
    }

    // Prefer the canonical hyphenated form of the surname when a profile
    // entry matches (works for both comma and non-comma paths).
    if (last) {
      const normLast = normalize(last);
      if (_shortenNameCache.lastnames.has(normLast)) {
        _shortenNameCache.profileMap.forEach(p => {
          if (p && p.last && normalize(p.last) === normLast) last = p.last;
        });
      }
    }

    // Strip any lingering trailing punctuation on the first name
    // ("Vilikia." → "Vilikia").
    first = first.replace(/[.,;]+$/g, '');

    const out = (first && last) ? `${first} ${last}` : (first || last || cleaned);
    _shortenNameCache.hits.set(s, out);
    return out;
  }

  // `sectionLevel` — optional 'phd' | 'masters' | 'other'. When present,
  // each rendered span is tagged with a data-scholar-section attribute
  // so the hover card can surface the level-correct thesis record for
  // scholars who hold both a Master's and a PhD at the same university.
  function renderScholarNameList(names, sectionLevel) {
    if (!names || !names.length) return '';
    const parts = names.map((n, i) => {
      const cls = (i % 2 === 0) ? 'is-blue' : 'is-dark';
      // data-scholar-name keeps the FULL name so popup mouseover handlers can
      // look up the person's thesis + reveal the detail slot, and so search
      // still matches on middle names. Only the visible text is shortened.
      const shown = shortenScholarName(n);
      const sectionAttr = sectionLevel ? ` data-scholar-section="${escapeHtml(sectionLevel)}"` : '';
      return `<span class="db-scholar-name ${cls}" data-scholar-name="${escapeHtml(n)}"${sectionAttr}>${escapeHtml(shown)}</span>`;
    });
    return `<span class="db-scholar-list">${parts.join('<span class="db-scholar-sep">;</span>')}</span>`;
  }

  // Build the shared popup HTML for a worldPoint. Split into PhD / Masters /
  // Other sections, each with the blue/black alternating scholar list.
  //
  // Scholar name ordering inside each section: MOST RECENT graduation year
  // first, oldest last (per Ron 2026-08-26 — e.g. Alifereti Naikatini PhD
  // 2026 must appear right under "PhD (n)"). Names with no year drop to the
  // bottom; ties are broken alphabetically so the ordering is stable and
  // readable. The year comes from lookupScholarThesisForPoint() so it's
  // the same thesis year shown in the hover-detail slot. Function name
  // kept as *ByYearAsc for compatibility with existing callers even though
  // the direction is now descending.
  function sortScholarsByYearAsc(names, point, sectionLevel) {
    if (!Array.isArray(names) || names.length <= 1) return names || [];
    return names.slice().sort((a, b) => {
      const ra = lookupScholarThesisForPoint(a, point, sectionLevel);
      const rb = lookupScholarThesisForPoint(b, point, sectionLevel);
      // Names with no year sort AFTER named years; use -Infinity so they
      // still land at the BOTTOM under descending-year order.
      const ya = ra && Number(ra.year) ? Number(ra.year) : -Infinity;
      const yb = rb && Number(rb.year) ? Number(rb.year) : -Infinity;
      if (ya !== yb) return yb - ya; // most recent first
      return String(a).localeCompare(String(b));
    });
  }

  function buildWorldPopupHtml(p) {
    const total = (p.phdScholars.length + p.mastersScholars.length + (p.unknownScholars || []).length);
    const color = total >= 5 ? '#7a1419' : total >= 3 ? '#c93e50' : total >= 2 ? '#e6550d' : '#fd8d3c';
    // Pass sectionLevel so scholars who hold BOTH a Master's AND a PhD at
    // the same university sort by the correct year in each section (e.g.
    // Ponipate Rokolekutu → 2007 in Masters, 2017 in PhD).
    // Names may legitimately repeat when a scholar holds multiple
    // qualifications at the same stage + university (e.g. Nacanieli
    // Rika: MA + MBA + MCom at USP) — keep every entry; genuine
    // stub-duplicates are already removed at the transformer layer.
    const phdSorted     = sortScholarsByYearAsc(p.phdScholars, p, 'phd');
    const mastersSorted = sortScholarsByYearAsc(p.mastersScholars, p, 'masters');
    const otherSorted   = sortScholarsByYearAsc(p.unknownScholars || [], p, 'other');
    const sections = [];
    if (phdSorted.length) {
      sections.push(
        `<div class="db-popup-scholar-header is-phd">PhD (${phdSorted.length}):</div>` +
        renderScholarNameList(phdSorted, 'phd')
      );
    }
    if (mastersSorted.length) {
      sections.push(
        `<div class="db-popup-scholar-header is-masters">Masters (${mastersSorted.length}):</div>` +
        renderScholarNameList(mastersSorted, 'masters')
      );
    }
    if (otherSorted.length) {
      sections.push(
        `<div class="db-popup-scholar-header is-other">Other (${otherSorted.length}):</div>` +
        renderScholarNameList(otherSorted, 'other')
      );
    }
    // Detail slot appears between the header row and the scholar sections.
    // Populated dynamically by the mouseover handler when a name is hovered.
    // Scholar sections live inside a bounded, scrollable container so the
    // popup stays compact even for countries with hundreds of scholars
    // (Samoa, USP). The detail slot sits ABOVE the scroll container so it
    // remains visible regardless of scroll position.
    // Count row: fixed-size number + fixed-size sentence.
    // Number is a flex item, sentence wraps to 2 lines beside it. As digits
    // grow (6 → 45 → 432) the number's column widens and the sentence shifts
    // right. align-items:center in the CSS keeps the number vertically
    // centered against the wrapped sentence.
    return (
      `<div class="db-popup-title">${escapeHtml(p.university)} (${escapeHtml(p.country)})</div>` +
      `<div class="db-popup-count-row">` +
        `<span class="db-popup-count">${total}</span>` +
        `<span class="db-popup-count-text">Samoan scholar${total === 1 ? '' : 's'} completed graduate work here</span>` +
      `</div>` +
      `<div class="db-popup-scholar-detail" data-popup-detail></div>` +
      `<div class="db-popup-scroll">` + sections.join('') + `</div>`
    );
  }

  // Look up a scholar's thesis metadata by name. Returns { title, year, level }
  // for the record that matches the world-map point's university/country when
  // possible, so hovering "Ron Vave" in the University of Hawaii popup shows
  // his UH PhD, not (say) his USP Masters. Falls back to the first record if
  // no exact match is found.
  //
  // `sectionLevel` — optional 'phd' | 'masters' | 'other'. When set, the
  // lookup is scoped to the record whose level matches the section the
  // caller is rendering. Critical for scholars who hold BOTH a Master's
  // AND a PhD at the same university (e.g. Ponipate Rokolekutu at UH):
  // the Masters section must surface his 2007 Masters, not his 2017 PhD,
  // so the map popup chronological sort and hover card year both line up.
  function lookupScholarThesisForPoint(name, point, sectionLevel) {
    const grad = state.graduateStudies;
    if (!grad || !grad.scholars) return null;
    const rec = grad.scholars[name];
    if (!rec) return null;
    // One-shot level preference set by zoomAndPreselect when the user explicitly
    // picks a degree in the search dropdown. Ensures we surface the PhD record
    // (not Master's) when someone picks "PhD" at a university where the same
    // scholar earned both degrees.
    const preferredLevel = state.preselectPreferredLevel;
    const preferMatches = (t) => {
      if (!preferredLevel) return false;
      const wantsPhd = /phd/i.test(preferredLevel);
      const wantsMasters = /master/i.test(preferredLevel);
      if (wantsPhd && t.level === 'phd') return true;
      if (wantsMasters && t.level === 'masters') return true;
      return false;
    };
    const sectionMatches = (t) => {
      if (!sectionLevel) return false;
      return t.level === sectionLevel;
    };
    // Prefer records whose university matches this point AND whose level
    // matches the section we are rendering, then the user's dropdown pick,
    // then any match at this university.
    if (rec.all && point) {
      if (sectionLevel) {
        const match = rec.all.find(t => t.university === point.university && t.country === point.country && sectionMatches(t));
        if (match) return match;
      }
      if (preferredLevel) {
        const match = rec.all.find(t => t.university === point.university && t.country === point.country && preferMatches(t));
        if (match) return match;
      }
      const match = rec.all.find(t => t.university === point.university && t.country === point.country);
      if (match) return match;
    }
    if (sectionLevel === 'phd'     && rec.phd)     return rec.phd;
    if (sectionLevel === 'masters' && rec.masters) return rec.masters;
    if (preferredLevel) {
      if (/phd/i.test(preferredLevel) && rec.phd) return rec.phd;
      if (/master/i.test(preferredLevel) && rec.masters) return rec.masters;
    }
    return rec.phd || rec.masters || (rec.all && rec.all[0]) || null;
  }

  // Look up a scholar profile record by the graduate-studies-feed name.
  // Handles the several key shapes used by scholar-profiles.json:
  //   1. Direct "First Last" hit
  //   2. Alias map ("Tiko, Lavinia" → "Tausere-Tiko, Lavinia")
  //   3. Flipped comma form "Last, First (Middle)"
  //   4. Collapsed first-token form ("Kuridrani, Litiana")
  function _lookupScholarProfile(name) {
    const map = state.scholarProfilesByName;
    if (!map || !name) return null;
    const aliases = state.nameAliases || new Map();
    const resolveAlias = k => aliases.get(k) || k;
    let hit = map.get(name) || map.get(resolveAlias(name));
    if (hit) return hit;
    // Feed shape may already be "Last, First" — also try flipping back to
    // "First Last" for direct-hit profiles keyed that way.
    const commaIdx = String(name).indexOf(',');
    if (commaIdx !== -1) {
      const last = name.slice(0, commaIdx).trim();
      const rest = name.slice(commaIdx + 1).trim();
      const firstTok = rest.split(/\s+/)[0] || '';
      const asFirstLast = firstTok ? `${firstTok} ${last}` : last;
      hit = map.get(asFirstLast) || map.get(resolveAlias(asFirstLast));
      if (hit) return hit;
    }
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) {
      const last  = parts[parts.length - 1];
      const first = parts.slice(0, -1).join(' ');
      const lastFirst = `${last}, ${first}`;
      hit = map.get(lastFirst) || map.get(resolveAlias(lastFirst));
      if (hit) return hit;
      const firstTok = parts[0];
      const lastFirstTok = `${last}, ${firstTok}`;
      hit = map.get(lastFirstTok) || map.get(resolveAlias(lastFirstTok));
      if (hit) return hit;
    }
    return null;
  }

  // Build the inner HTML for the rich scholar-detail card. Shared between
  // the map popup's inline detail slot AND the floating hover card that the
  // uni-detail scholar table shows. Format (Ron 2026-08-25):
  //   First Last (PhD): 2021
  //   Naduri vlg, Macuata District.       [terracotta — paternal geography]
  //   Thesis title in italics
  // Returns '' when we have nothing useful to show.
  function renderScholarDetailHTML(nm, point, sectionLevel) {
    const rec = lookupScholarThesisForPoint(nm, point, sectionLevel);
    if (!rec) return '';
    const title = rec.title || '(untitled)';
    const year  = rec.year  || '';
    const level = (rec.level === 'phd') ? 'PhD' : (rec.level === 'masters') ? "Master's" : 'Thesis';
    const profile = _lookupScholarProfile(nm) || {};
    // Identity geography is strictly paternal. See
    // docs/PANELF-PATERNAL-GEOGRAPHY-2026-08-25.md.
    const village  = (profile.paternalVillage  || '').trim();
    const island   = (profile.paternalIsland   || '').trim();
    const district = (profile.paternalDistrict || '').trim();
    const slug     = (profile.slug || '').trim();
    let villageLine = '';
    const geoLabel = formatScholarGeography(village, island, district);
    if (geoLabel) {
      const label = escapeHtml(geoLabel);
      villageLine = slug
        ? `<div class="db-popup-scholar-detail__village"><a href="#scholar=${encodeURIComponent(slug)}">${label}</a></div>`
        : `<div class="db-popup-scholar-detail__village">${label}</div>`;
    }
    const photoHtml = profile.photo
      ? `<div class="db-popup-scholar-detail__photo" style="background-image:url('${escapeAttr(profile.photo)}')" aria-hidden="true"></div>`
      : '';
    // Name / degree / year row ("First Last (PhD): 2021").
    const nameLabel = escapeHtml(shortenScholarName(nm));
    const nameLine  = year
      ? `${nameLabel} <span class="db-popup-scholar-detail__stage">(${level})</span>: <span class="db-popup-scholar-detail__year">${escapeHtml(String(year))}</span>`
      : `${nameLabel} <span class="db-popup-scholar-detail__stage">(${level})</span>`;
    return (
      photoHtml +
      `<div class="db-popup-scholar-detail__body">` +
        `<div class="db-popup-scholar-detail__name">${nameLine}</div>` +
        villageLine +
        `<div class="db-popup-scholar-detail__thesis">${escapeHtml(title)}</div>` +
      `</div>`
    );
  }

  // Wire mouseover / mouseout on scholar-name spans inside an open Leaflet
  // popup so hovering a name reveals the thesis title + year in the detail
  // slot at the top of the popup. Point context is passed so we can pick the
  // right thesis record for scholars with multiple degrees.
  function wirePopupScholarHovers(popupEl, point) {
    if (!popupEl) return;
    const detail = popupEl.querySelector('[data-popup-detail]');
    if (!detail) return;
    const names = popupEl.querySelectorAll('.db-scholar-name[data-scholar-name]');
    names.forEach(nameEl => {
      nameEl.addEventListener('mouseenter', () => {
        const nm = nameEl.getAttribute('data-scholar-name');
        const sectionLevel = nameEl.getAttribute('data-scholar-section') || null;
        const html = renderScholarDetailHTML(nm, point, sectionLevel);
        if (!html) {
          detail.classList.remove('is-active');
          detail.innerHTML = '';
          return;
        }
        detail.innerHTML = html;
        detail.classList.add('is-active');
      });
      nameEl.addEventListener('mouseleave', () => {
        detail.classList.remove('is-active');
        detail.innerHTML = '';
      });
    });
  }

  // Floating hover card used by the uni-detail scholar table (below the
  // country/uni map). Reuses the same detail HTML the map popup renders,
  // but positions it as a fixed-position tooltip near the hovered name.
  // The card element is created lazily on first use and reused; a data-*
  // attribute keeps successive wireups from double-binding the same host.
  let _hoverCardEl = null;
  function _ensureHoverCardEl() {
    if (_hoverCardEl && document.body.contains(_hoverCardEl)) return _hoverCardEl;
    const el = document.createElement('div');
    el.className = 'db-scholar-hover-card db-popup-scholar-detail';
    el.setAttribute('data-scholar-hover-card', '');
    el.style.position = 'fixed';
    el.style.zIndex   = '9999';
    el.style.maxWidth = '360px';
    el.style.pointerEvents = 'none';
    el.style.display = 'none';
    document.body.appendChild(el);
    _hoverCardEl = el;
    return el;
  }
  function _placeHoverCard(card, evt) {
    const pad = 14;
    const vw = window.innerWidth  || document.documentElement.clientWidth  || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    // Measure card by briefly making it visible off-screen.
    card.style.left = '-9999px';
    card.style.top  = '-9999px';
    card.style.display = 'flex';
    const rect = card.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width  + pad > vw) x = Math.max(pad, evt.clientX - rect.width  - pad);
    if (y + rect.height + pad > vh) y = Math.max(pad, evt.clientY - rect.height - pad);
    card.style.left = `${Math.round(x)}px`;
    card.style.top  = `${Math.round(y)}px`;
  }
  function wireScholarHoverCard(hostEl, point) {
    if (!hostEl) return;
    // Idempotent: replace host to strip previously-bound listeners.
    if (hostEl.dataset.hoverCardWired === '1') {
      // Clone and swap so any prior listeners get dropped along with the node.
      const fresh = hostEl.cloneNode(true);
      hostEl.parentNode.replaceChild(fresh, hostEl);
      hostEl = fresh;
    }
    hostEl.dataset.hoverCardWired = '1';
    const card = _ensureHoverCardEl();
    const onEnter = (evt) => {
      const t = evt.target;
      if (!t || !t.classList || !t.classList.contains('db-scholar-name')) return;
      const nm = t.getAttribute('data-scholar-name');
      if (!nm) return;
      const sectionLevel = t.getAttribute('data-scholar-section') || null;
      const html = renderScholarDetailHTML(nm, point, sectionLevel);
      if (!html) { card.style.display = 'none'; card.classList.remove('is-active'); return; }
      card.innerHTML = html;
      // Force the photo column visible in the floating card even though the
      // world map isn't in fullscreen (the CSS rule that gates the photo is
      // scoped to .db-map-world-wrap.is-fullscreen).
      const photoEl = card.querySelector('.db-popup-scholar-detail__photo');
      if (photoEl) photoEl.style.display = 'block';
      card.classList.add('is-active');
      _placeHoverCard(card, evt);
    };
    const onMove = (evt) => {
      if (card.style.display === 'none') return;
      const t = evt.target;
      if (!t || !t.classList || !t.classList.contains('db-scholar-name')) return;
      _placeHoverCard(card, evt);
    };
    const onLeave = (evt) => {
      const t = evt.target;
      if (!t || !t.classList || !t.classList.contains('db-scholar-name')) return;
      card.style.display = 'none';
      card.classList.remove('is-active');
      card.innerHTML = '';
    };
    hostEl.addEventListener('mouseover', onEnter);
    hostEl.addEventListener('mousemove', onMove);
    hostEl.addEventListener('mouseout',  onLeave);
    // Also hide on scroll so the card can't get stranded off-target.
    window.addEventListener('scroll', () => {
      if (card.style.display !== 'none') {
        card.style.display = 'none';
        card.classList.remove('is-active');
      }
    }, { passive: true });
  }

  // With autoClose:false the popup no longer disappears on its own — we
  // manage closing here. The popup stays open as long as the mouse is over
  // EITHER the marker OR the popup. When the mouse leaves both, we close
  // after a short grace period so the user can move between them without
  // losing the popup.
  function wirePopupAutoClose(popupEl, popup, marker) {
    if (!popupEl || !popup || !marker) return;
    let closeTimer = null;
    const cancel = () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } };
    const scheduleClose = () => {
      cancel();
      closeTimer = setTimeout(() => { try { marker.closePopup(); } catch (e) {} }, 220);
    };
    popupEl.addEventListener('mouseenter', cancel);
    popupEl.addEventListener('mouseleave', scheduleClose);
    marker.on('mouseout', scheduleClose);
    marker.on('mouseover', cancel);
  }

  // If a popup extends past any edge of the map viewport (typically the top,
  // for tall Samoa popups; or the right, when the marker sits near the
  // antimeridian), pan the map by exactly the overflow amount so every edge
  // of the popup sits inside the map with a small margin. Leaflet's built-in
  // autoPan handles small overflows but is unreliable for tall popups on the
  // world view — this helper fills that gap.
  function nudgePopupIntoView(popupEl, wmap) {
    if (!popupEl || !wmap) return;
    const mapEl = wmap.getContainer();
    if (!mapEl) return;
    const m = mapEl.getBoundingClientRect();
    const p = popupEl.getBoundingClientRect();
    const margin = 12;
    let dx = 0, dy = 0;
    if (p.top < m.top + margin) dy = p.top - (m.top + margin);
    else if (p.bottom > m.bottom - margin) dy = p.bottom - (m.bottom - margin);
    if (p.left < m.left + margin) dx = p.left - (m.left + margin);
    else if (p.right > m.right - margin) dx = p.right - (m.right - margin);
    if (dx !== 0 || dy !== 0) {
      try { wmap.panBy([dx, dy], { animate: true, duration: 0.25 }); } catch (e) {}
    }
  }

  function selectWorldCountry(name) {
    state.worldSelectedCountry = name;
    state.worldSelectedUniversity = null;
    renderWorldPanel();
    zoomToWorldCountry(name);
    // Propagate the country filter to every downstream panel.
    rerenderAfterWorldFilterChange();
  }
  function clearWorldCountry() {
    state.worldSelectedCountry = null;
    state.worldSelectedUniversity = null;
    renderWorldPanel();
    // Reset the world map to the marker-bounds framing (auto-fit to all dots).
    if (state.worldMap) {
      const pts = ((state.graduateStudies && state.graduateStudies.worldPoints) || []);
      const latlngs = pts.map(p => [p.lat, p.lng]);
      if (latlngs.length > 1) {
        state.worldMap.fitBounds(L.latLngBounds(latlngs), { padding: [40, 60], maxZoom: 3, animate: true });
      } else if (latlngs.length === 1) {
        state.worldMap.setView(latlngs[0], 3, { animate: true });
      } else {
        state.worldMap.setView(WORLD_MAP_DEFAULT_CENTER, WORLD_MAP_DEFAULT_ZOOM);
      }
    }
    rerenderAfterWorldFilterChange();
  }
  function selectWorldUniversity(uniName) {
    state.worldSelectedUniversity = uniName;
    renderWorldPanel();
    zoomToWorldUniversity(uniName);
    rerenderAfterWorldFilterChange();
  }
  function clearWorldUniversity() {
    state.worldSelectedUniversity = null;
    renderWorldPanel();
    // Re-zoom back to the country the university belongs to.
    if (state.worldSelectedCountry) zoomToWorldCountry(state.worldSelectedCountry);
    rerenderAfterWorldFilterChange();
  }

  // Normalize a longitude to the world-wrap copy nearest the map's current
  // center. The world map is Pacific-centered (default view lng ~80), so
  // Leaflet renders the world twice horizontally and North American markers
  // (raw lng ~ -100) are actually visible on the right-hand wrap at lng
  // ~ +260. Framing regions/countries/universities with their raw stored
  // longitudes zooms to the empty left-hand copy; this helper picks the
  // copy the user is currently looking at. Ron 2026-08-26.
  function _normLngForWorldMap(lng) {
    const m = state.worldMap;
    if (!m) return lng;
    const center = m.getCenter().lng;
    let x = lng;
    while (x - center >  180) x -= 360;
    while (x - center < -180) x += 360;
    return x;
  }

  function zoomToWorldCountry(name) {
    const grad = state.graduateStudies || { worldPoints: [] };
    const pts = (grad.worldPoints || []).filter(p => p.country === name);
    if (!pts.length || !state.worldMap) return;
    // maxZoom bumped to 8 so country-level zoom actually shows the country,
    // not the whole region (typing "Samoa" used to leave AU + NZ in frame).
    // Longitudes normalized to the visible world-wrap so North American
    // countries don't frame the empty left-hand copy of the map.
    const latlngs = pts.map(p => [p.lat, _normLngForWorldMap(p.lng)]);
    if (latlngs.length === 1) {
      state.worldMap.setView(latlngs[0], 7, { animate: true });
    } else {
      const bounds = L.latLngBounds(latlngs);
      state.worldMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 8, animate: true });
    }
  }
  function zoomToWorldUniversity(uniName) {
    const grad = state.graduateStudies || { worldPoints: [] };
    const p = (grad.worldPoints || []).find(x => x.university === uniName);
    if (!p || !state.worldMap) return;
    state.worldMap.setView([p.lat, _normLngForWorldMap(p.lng)], 8, { animate: true });
  }

  function wireWorldPanel() {
    const back = document.querySelector('[data-world-back]');
    if (back) {
      back.addEventListener('click', (e) => { e.preventDefault(); clearWorldCountry(); });
    }
    const uniBack = document.querySelector('[data-world-uni-back]');
    if (uniBack) {
      uniBack.addEventListener('click', (e) => { e.preventDefault(); clearWorldUniversity(); });
    }
    // ------------------------------------------------------------------
    // Shared search-execute helper.
    //
    // When the user hits Enter in either search box, we want a scholar-first
    // experience: if the query resolves to a specific scholar we should zoom
    // straight to their university and pre-open the popup with their name
    // pre-selected (photo + thesis visible without hover). If the scholar has
    // 2+ degrees at different universities, we pop a small dropdown so they
    // can pick which one. Only when the query doesn't match a single scholar
    // do we fall back to the classic country/university substring behaviour.
    // ------------------------------------------------------------------
    function executeWorldSearch(rawQ, dropdownAnchor) {
      const q = (rawQ || '').trim().toLowerCase();
      if (!q) return;
      const m = state.worldMap;
      const grad = state.graduateStudies || { worldPoints: [] };
      const points = grad.worldPoints || [];
      if (!m || !points.length) return;

      // --- Step 1: scholar-first index ---------------------------------
      // Build the set of (scholar, point, level) triples whose scholar name
      // matches the query. "Matches" = case-insensitive substring on the
      // scholar name as it appears in worldPoints.
      const scholarHits = [];
      points.forEach(p => {
        const walk = (list, level) => {
          if (!list) return;
          list.forEach(n => {
            if ((n || '').toLowerCase().includes(q)) {
              scholarHits.push({ point: p, level, name: n });
            }
          });
        };
        walk(p.phdScholars, 'PhD');
        walk(p.mastersScholars, "Master's");
        walk(p.unknownScholars, 'Other');
      });

      // Group hits by canonical scholar identity. Two different spellings
      // that resolve to the same person via the alias map (e.g. "Asesela
      // Ravuvu" and "Asesela D. (Asesela Drekeivalu) Ravuvu" both map to
      // "Ravuvu, Asesela") should combine into a single row — otherwise
      // the dropdown looks like the person is two people with one degree
      // each, when in fact it's one person with two degrees.
      //
      // We keep the human-readable display name (the shortest/simplest
      // variant we've seen for this canonical key) so the row header reads
      // naturally.
      const aliases = state.nameAliases || new Map();
      // Convert a raw worldPoints name into its canonical "Last, First" key,
      // applying the admin's alias map so variant spellings resolve to the
      // same scholar. We try three candidate keys before giving up:
      //   1. The raw name as-is (with parenthetical) → "Last, First (Alt)"
      //   2. Same after collapsing whitespace
      //   3. Paren-stripped: "Last, First"
      // The first candidate whose alias exists wins; otherwise we return
      // the paren-stripped Last-First form so distinct-but-similar names
      // still bucket sensibly.
      const buildLastFirst = (n) => {
        const parts = String(n || '').trim().split(/\s+/);
        if (parts.length < 2) return String(n || '').trim();
        const last = parts.pop();
        return `${last}, ${parts.join(' ')}`;
      };
      const toCanonicalKey = (fullName) => {
        const raw = String(fullName || '').trim();
        if (!raw) return '';
        const collapsed = raw.replace(/\s+/g, ' ');
        const stripped = collapsed.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        // Build candidate keys in preference order (most specific first).
        const candidates = [
          buildLastFirst(collapsed),
          buildLastFirst(stripped)
        ];
        for (const c of candidates) {
          if (aliases.has(c)) return aliases.get(c);
        }
        // No alias hit — fall back to the stripped Last-First form so name
        // variants that differ only by parenthetical detail bucket together.
        return buildLastFirst(stripped);
      };
      const byScholar = new Map();
      scholarHits.forEach(h => {
        const key = toCanonicalKey(h.name);
        if (!byScholar.has(key)) {
          byScholar.set(key, { key, displayName: h.name, hits: [] });
        } else {
          // Prefer the shortest variant as the display name so we don't
          // show "Asesela D. (Asesela Drekeivalu) Ravuvu" when "Asesela
          // Ravuvu" also exists in the hits.
          const bucket = byScholar.get(key);
          if (h.name.length < bucket.displayName.length) bucket.displayName = h.name;
        }
        byScholar.get(key).hits.push(h);
      });

      // Scholar-first behaviour: if the query resolves to any scholar name
      // hit(s), open a compact picker instead of falling straight through to
      // the classic country/university branch. Single scholar + single hit
      // still short-circuits to a direct zoom+preselect. Everything else
      // (one scholar with multiple degrees, or several scholars matching
      // the same substring) opens the dropdown with one row per scholar and
      // their degree buttons laid out horizontally.
      if (byScholar.size === 1) {
        const only = byScholar.values().next().value;
        if (only.hits.length === 1) {
          zoomAndPreselect(m, only.hits[0].point, only.hits[0].name, only.hits[0].level);
          hideSearchDropdown(dropdownAnchor);
          return;
        }
        showSearchDropdown(dropdownAnchor, [{ name: only.displayName, hits: only.hits }], (chosen) => {
          zoomAndPreselect(m, chosen.point, chosen.hitName || chosen.name, chosen.level);
          hideSearchDropdown(dropdownAnchor);
        });
        return;
      }
      if (byScholar.size > 1) {
        // Cap at 12 scholars so a very common substring (e.g. "Ana") doesn't
        // produce an overwhelming picker. Beyond that, fall through to the
        // classic country/university substring match so results still appear
        // somewhere useful.
        const MAX_SCHOLARS_IN_DROPDOWN = 12;
        if (byScholar.size <= MAX_SCHOLARS_IN_DROPDOWN) {
          const groups = Array.from(byScholar.values()).map(g => ({ name: g.displayName, hits: g.hits }));
          showSearchDropdown(dropdownAnchor, groups, (chosen) => {
            zoomAndPreselect(m, chosen.point, chosen.hitName || chosen.name, chosen.level);
            hideSearchDropdown(dropdownAnchor);
          });
          return;
        }
      }

      // --- Step 2: scholar-name-only fallback --------------------------
      // The search bar is scoped to scholar names only (the Region › Country
      // › University dropdown is where country/university navigation lives).
      // If the scholar-first index above didn't resolve, try one more pass
      // matching scholar-name substrings across all points; this handles
      // partial matches that didn't hit the aliased canonical index.
      hideSearchDropdown(dropdownAnchor);
      const matches = points.filter(p => {
        const lists = [p.phdScholars, p.mastersScholars, p.unknownScholars];
        for (const list of lists) {
          if (!list) continue;
          for (const n of list) if ((n || '').toLowerCase().includes(q)) return true;
        }
        return false;
      });
      if (matches.length === 0) return;

      if (matches.length === 1) {
        const p = matches[0];
        m.setView([p.lat, p.lng], 7, { animate: true });
        setTimeout(() => openMarkerPopupAt(m, p), 320);
      } else {
        const bounds = L.latLngBounds(matches.map(p => [p.lat, p.lng]));
        m.fitBounds(bounds, { padding: [60, 60], maxZoom: 6, animate: true });
      }
    }

    // Find and open the popup for the circle marker at a given point, then
    // return the popup DOM node once it's rendered.
    function openMarkerPopupAt(m, p, cb) {
      let opened = false;
      m.eachLayer(layer => {
        if (opened) return;
        if (layer && layer.getLatLng && layer.getPopup) {
          const ll = layer.getLatLng();
          if (Math.abs(ll.lat - p.lat) < 1e-4 && Math.abs(ll.lng - p.lng) < 1e-4) {
            layer.openPopup();
            opened = true;
            if (cb) setTimeout(() => cb(layer.getPopup().getElement()), 120);
          }
        }
      });
    }

    // Zoom to a point, open its popup, then dispatch mouseenter on the
    // matching scholar's name link so the detail slot pre-populates without
    // requiring the user to hover. `preferredLevel` ("PhD" or "Master's") is
    // set when the user picked a specific degree in the search dropdown —
    // it biases the thesis lookup so we surface that record even when the
    // scholar has multiple degrees at the same university.
    function zoomAndPreselect(m, point, scholarName, preferredLevel) {
      state.preselectPreferredLevel = preferredLevel || null;
      m.setView([point.lat, point.lng], 6, { animate: true });
      setTimeout(() => {
        openMarkerPopupAt(m, point, (popupEl) => {
          if (!popupEl) return;
          const target = String(scholarName || '').toLowerCase();
          const links = popupEl.querySelectorAll('.db-scholar-name[data-scholar-name]');
          const trigger = (el) => {
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            // Preselection is sticky: block the popup's default mouseleave
            // clear so the detail slot stays visible until the user hovers
            // another name or closes the popup.
            el.addEventListener('mouseleave', (ev) => ev.stopImmediatePropagation(), { capture: true, once: true });
            // Clear the one-shot level preference right after we've applied
            // it so subsequent free hovering behaves normally.
            setTimeout(() => { state.preselectPreferredLevel = null; }, 50);
          };
          for (const el of links) {
            const nm = (el.getAttribute('data-scholar-name') || '').toLowerCase();
            if (nm === target) { trigger(el); return; }
          }
          for (const el of links) {
            const nm = (el.getAttribute('data-scholar-name') || '').toLowerCase();
            if (nm.includes(target)) { trigger(el); return; }
          }
          // If we never found the name, still clear the preference.
          state.preselectPreferredLevel = null;
        });
      }, 320);
    }

    // Dropdown anchored under the search box. Compact vertical list, one
    // row per canonical scholar. Each row shows the shortened name plus a
    // "(N)" degree-count badge when the scholar has multiple degrees; on
    // hover, a side panel expands to the right of the row listing those
    // degrees as clickable buttons formatted "Master's: Samoa" (colon
    // separator). Rows with only one degree pick that degree on direct
    // click — no expansion needed.
    //
    // `groups` is an array of { name, hits } where each hit is
    // { point, level, name }. onPick(hit) fires with the chosen degree,
    // enriched with { name, hitName } so the caller knows which scholar
    // display name to use for popup preselect (`hitName` is the raw
    // worldPoints name that matches the popup's data-scholar-name).
    function showSearchDropdown(anchor, groups, onPick) {
      if (!anchor || !groups || !groups.length) return;
      hideSearchDropdown(anchor);
      const dd = document.createElement('div');
      dd.className = 'db-map-fs-search-dd';
      dd.setAttribute('data-db-map-fs-search-dd', '');
      const header = document.createElement('div');
      header.className = 'db-map-fs-search-dd__header';
      if (groups.length === 1) {
        header.textContent = `${shortenScholarName(groups[0].name)} \u2014 pick a degree:`;
      } else {
        header.textContent = `${groups.length} matches \u2014 hover a name to see degrees:`;
      }
      dd.appendChild(header);

      // Sort degrees within each group so PhD comes first, then Master's,
      // then Other. Predictable reading order across rows.
      const levelRank = (lvl) => (/phd/i.test(lvl) ? 0 : /master/i.test(lvl) ? 1 : 2);
      const sortedGroups = groups.map(g => ({
        name: g.name,
        hits: g.hits.slice().sort((a, b) => levelRank(a.level) - levelRank(b.level))
      }));

      sortedGroups.forEach(g => {
        const row = document.createElement('div');
        row.className = 'db-map-fs-search-dd__row';

        const nameEl = document.createElement('button');
        nameEl.type = 'button';
        nameEl.className = 'db-map-fs-search-dd__name-btn';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'db-map-fs-search-dd__name';
        nameSpan.textContent = shortenScholarName(g.name);
        nameEl.appendChild(nameSpan);
        if (g.hits.length > 1) {
          const count = document.createElement('span');
          count.className = 'db-map-fs-search-dd__count';
          count.textContent = ` (${g.hits.length})`;
          nameEl.appendChild(count);
        }
        row.appendChild(nameEl);

        // Side panel with degree buttons. Sits absolute-positioned to the
        // right of the row and is revealed on row hover (or when the name
        // button gets focus). Always present in the DOM so keyboard users
        // can tab into it.
        const panel = document.createElement('div');
        panel.className = 'db-map-fs-search-dd__panel';
        g.hits.forEach(h => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'db-map-fs-search-dd__degree';
          // Format: "Master's: Samoa" or "PhD: Australia" — colon separator.
          btn.textContent = `${h.level}: ${h.point.country}`;
          btn.title = `${h.point.university} (${h.point.country})`;
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onPick({ ...h, name: g.name, hitName: h.name });
          });
          panel.appendChild(btn);
        });
        row.appendChild(panel);

        // Single-degree rows: clicking the name picks that degree directly.
        // Multi-degree rows: clicking the name toggles the panel visible so
        // touch / non-hover users can still see it. On hover-capable
        // pointers, the CSS handles show/hide via :hover.
        nameEl.addEventListener('click', () => {
          if (g.hits.length === 1) {
            onPick({ ...g.hits[0], name: g.name, hitName: g.hits[0].name });
          } else {
            row.classList.toggle('is-open');
          }
        });

        dd.appendChild(row);
      });

      anchor.appendChild(dd);
    }
    function hideSearchDropdown(anchor) {
      if (!anchor) return;
      const existing = anchor.querySelector('[data-db-map-fs-search-dd]');
      if (existing) existing.remove();
    }

    // Search box above the country list — filters by country name, university
    // name, or scholar name substring. Any match at any level is kept.
    const searchInput = document.querySelector('[data-world-search]');
    const searchClear = document.querySelector('[data-world-search-clear]');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.worldSearchTerm = (searchInput.value || '').trim().toLowerCase();
        if (searchClear) searchClear.style.display = state.worldSearchTerm ? '' : 'none';
        renderWorldPanel();
      });
      // Pressing Enter delegates to the shared scholar-first executor.
      // The inline search doesn't have a floating anchor for dropdowns —
      // when the user has multiple degrees we anchor to the fullscreen box
      // instead (opening fullscreen isn't automatic, so the dropdown just
      // opens under whichever box the user last used).
      searchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const fsAnchor = document.querySelector('[data-db-map-fs-search-wrap]');
        executeWorldSearch(searchInput.value, fsAnchor);
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        state.worldSearchTerm = '';
        searchClear.style.display = 'none';
        renderWorldPanel();
        // Also clear the fullscreen search mirror.
        const fsInput2 = document.querySelector('[data-db-map-fs-search]');
        const fsClear2 = document.querySelector('[data-db-map-fs-search-clear]');
        if (fsInput2) fsInput2.value = '';
        if (fsClear2) fsClear2.style.display = 'none';
      });
    }
    // Fullscreen-only search box floating over the top-left of the world map.
    // Mirrors the inline searchInput's state so typing in either input keeps
    // both in sync. Uses the same worldSearchTerm state, so hits highlight
    // and filter countries + universities exactly as they do inline.
    const fsSearchInput = document.querySelector('[data-db-map-fs-search]');
    const fsSearchClear = document.querySelector('[data-db-map-fs-search-clear]');
    if (fsSearchInput) {
      fsSearchInput.addEventListener('input', () => {
        state.worldSearchTerm = (fsSearchInput.value || '').trim().toLowerCase();
        if (fsSearchClear) fsSearchClear.style.display = state.worldSearchTerm ? '' : 'none';
        if (searchInput) searchInput.value = fsSearchInput.value;
        if (searchClear) searchClear.style.display = state.worldSearchTerm ? '' : 'none';
        renderWorldPanel();
      });
      // Enter delegates to the shared scholar-first executor. The fullscreen
      // search wrapper is the dropdown anchor for the multi-degree case.
      fsSearchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const fsAnchor = document.querySelector('[data-db-map-fs-search-wrap]');
        executeWorldSearch(fsSearchInput.value, fsAnchor);
      });
    }
    if (fsSearchClear) {
      fsSearchClear.addEventListener('click', () => {
        if (fsSearchInput) fsSearchInput.value = '';
        state.worldSearchTerm = '';
        // Clearing the search box also clears the country scope so
        // the toolbar returns to full totals (14 / 66 / 308).
        state.worldSearchScope = null;
        try { updateWorldMapStatsForScope(); } catch (_) {}
        fsSearchClear.style.display = 'none';
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.style.display = 'none';
        renderWorldPanel();
      });
    }
    // When the inline search changes, mirror the value into the fullscreen
    // search input too so switching between views feels continuous.
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (fsSearchInput) fsSearchInput.value = searchInput.value;
        if (fsSearchClear) fsSearchClear.style.display = (searchInput.value || '').trim() ? '' : 'none';
      });
    }
    // "Clear filter" buttons shown per filtered panel (F and G). Each clears
    // whichever level (country or university) is currently selected on the
    // world map, which re-renders both filtered panels back to the full set.
    document.querySelectorAll('[data-filtered-clear]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Priority: clear the most-specific active filter first.
        if (state.worldSelectedUniversity) clearWorldUniversity();
        else if (state.worldSelectedCountry) clearWorldCountry();
        else {
          // Fall back to clearing every Panel F scholar filter — which
          // then unblocks Panel G via renderLeaders().
          const clearAll = document.querySelector('[data-scholar-clear-all]');
          if (clearAll) clearAll.click();
        }
      });
    });
  }

  // Initialise the Panel A2 world map — a *separate* Leaflet instance from
  // the Samoa choropleth. Uses the same Esri World Imagery basemap.
  function initWorldMap() {
    const el = document.getElementById('db-map-world');
    if (!el || typeof L === 'undefined') return;
    // maxBounds is padded ~30° east/west of the true world edges so Leaflet's
    // autoPan (used to keep large popups in view for Samoa, NZ, USA-west, etc.)
    // has room to nudge the viewport without slamming against a hard wall.
    // The tile layer itself still uses noWrap:true + strict bounds, so the
    // map never appears duplicated.
    const wmap = L.map(el, {
      zoomSnap: 0.25,
      worldCopyJump: false,
      minZoom: 1,
      maxZoom: 10,
      maxBounds: [[-85, -210], [85, 210]],
      maxBoundsViscosity: 0.85
    });
    // Google Hybrid tiles (satellite imagery + labels). Tiles wrap so
    // the world repeats horizontally and no empty backdrop shows on
    // widescreen or fullscreen views.
    // Google tiles are kept wrap-enabled (noWrap:false, the Leaflet
    // default) so wide fullscreen viewports don't show an empty ocean
    // half. Marker wraparound (ghost dots off West Africa / Central
    // America) is handled separately by lngOffsets=[0] in both
    // renderWorldMap and renderWorkplaceMap — markers are single-copy
    // even when the tiles behind them repeat.
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      attribution: 'Imagery &copy; Google',
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 20
    }).addTo(wmap);
    wmap.setView(WORLD_MAP_DEFAULT_CENTER, WORLD_MAP_DEFAULT_ZOOM);
    state.worldMap = wmap;
    // Rescope the toolbar stats + re-run the overlap-spider layout
    // whenever the map settles at a new zoom/pan. Overlap layout runs
    // unconditionally so USP / FNU / UoF fan out at every zoom level.
    // Stats only rescope when a search-driven country zoom is active
    // (otherwise incidental hand-panning would change the totals in
    // ways Ron didn't ask for).
    wmap.on('moveend', () => {
      if (state.worldMode === 'work') return; // workplace has its own stats path
      applyOverlapSpider();
      if (state.worldSearchScope) updateWorldMapStatsForScope();
    });
    // Render markers immediately if data has already arrived; otherwise the
    // deferred call inside the data-fetch chain will pick them up.
    if (state.graduateStudies) renderWorldMap();
    // Fix late-arriving container sizes (e.g. panel below the fold).
    setTimeout(() => { if (state.worldMap) state.worldMap.invalidateSize(); }, 100);
    // Fullscreen toggle for the B2 graduates map. On open we crop out
    // the polar caps (no one studies in Antarctica or Greenland's
    // interior) and lift the boxed-world constraints so Google's tiles
    // wrap seamlessly across the antimeridian — the user can drag left
    // or right and the map keeps going instead of hitting a wall or
    // slicing Samoa. We also re-render the marker layer with duplicate
    // copies at ±360° longitude so dots appear in every world copy.
    // Draw-a-rectangle-to-zoom was removed in favor of the fullscreen search box.
    wireMapFullscreen('[data-db-map-world-wrap]', '[data-db-map-fs-btn]', () => state.worldMap, {
      onOpen: () => {
        const m = state.worldMap; if (!m) return;
        state.worldMapPrevView = { center: m.getCenter(), zoom: m.getZoom() };
        // Constrain fullscreen to the same 260° Pacific-centered window
        // used for the initial fit. Google's tile server wraps tiles
        // (noWrap:false) so panning slightly beyond an edge doesn't leave
        // a blank backdrop, but we no longer allow the user to drag into
        // a second full world copy — which is what caused the duplicated
        // Samoa / Sydney markers off the coasts of West Africa and
        // Central America. maxBoundsViscosity keeps the pan snappy.
        // Removed maxBounds in fullscreen — with a tight 260° lng window
        // and 170° lat window, Leaflet snaps zoom-out to fit both
        // dimensions and stays at zoom 1, causing the wraparound + strip
        // rendering. Instead we keep the map free-pan in fullscreen and
        // rely on marker single-copy (lngOffsets=[0]) to prevent ghosts.
        m.setMaxBounds(null);
        m.options.worldCopyJump = false;
        state.worldMapFullscreen = true;
        // Wire the fullscreen toolbar (idempotent) now that we know the
        // graduate-studies data + scholar profiles are loaded.
        try { wireWorldMapFilters(); } catch (e) { console.error('wireWorldMapFilters', e); }
        // Re-render markers so each point has copies in the adjacent
        // world panels (-360, 0, +360). Without this, dragging past
        // the antimeridian would show blank continents.
        renderWorldMap();
        // Frame the Pacific with a fixed center + zoom rather than
        // fitBounds. fitBounds picks the min zoom that fits both lat +
        // lng dimensions; on wide-latitude bounds it lands at zoom 1
        // where the world is only 512px wide, causing wrapped tiles to
        // paint ghost markers off West Africa (the wraparound bug we
        // shipped v12 to fix). Zoom 2 renders one clean world copy
        // 1024px wide and 512px tall, centered on Samoa at 160°E.
        // Ron's preferred default: centre near 80°E at zoom 3 so Europe
        // (Iceland/UK/Portugal) sits on the left, Samoa cluster sits
        // centre-right, and the Pacific expanse on the right leaves room
        // for the wrapped Hawai‘i / US-mainland markers to appear when
        // the user pans east. Fills the whole viewport at 1500×900+.
        m.setView([10, 80], 3, { animate: false });
      },
      onClose: () => {
        const m = state.worldMap; if (!m) return;
        // Restore the original bounded, non-wrapping configuration used
        // by the inline (non-fullscreen) view.
        m.options.worldCopyJump = false;
        m.setMaxBounds([[-85, -210], [85, 210]]);
        state.worldMapFullscreen = false;
        // Re-render markers as single copies at their real coordinates.
        renderWorldMap();
        const prev = state.worldMapPrevView;
        if (prev) m.setView(prev.center, prev.zoom, { animate: false });
      }
    });
    // Reset-view button for the world map. Restores the default framing for
    // whichever mode the map is currently in (inline or fullscreen) and
    // closes any open popup so the user gets a clean slate.
    const worldWrap = document.querySelector('[data-db-map-world-wrap]');
    const worldResetBtn = document.querySelector('[data-db-map-reset-btn]');
    if (worldWrap && worldResetBtn) {
      worldResetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const m = state.worldMap; if (!m) return;
        m.closePopup();
        // Clear every fullscreen filter (region, district, sector,
        // work country, work institution) so Reset truly returns the map
        // to its clean-slate default.
        state.worldConfFilter = null;
        state.worldProvFilter = null;
        state.worldSectorFilter = null;
        state.worldWorkCountry = null;
        state.worldWorkInst = null;
        // Clear the search-scope so the toolbar counter goes back to
        // the full totals (14 / 66 / 308) rather than the country
        // subset the last search zoomed to.
        state.worldSearchScope = null;
        // Also empty the fullscreen search input so the visible box
        // matches the cleared scope (otherwise "Samoa" would sit stale
        // in the box after Reset).
        const fsInput = document.querySelector('[data-db-map-fs-search]');
        if (fsInput) fsInput.value = '';
        state.worldSearchTerm = '';
        // Reset also returns the map to Study mode so users always land
        // on the same clean-slate view.
        state.worldMode = 'study';
        renderWorldMap();
        try { refreshConfDropdownUi(); refreshSectorDropdownUi(); refreshWorkDropdownUi(); } catch (_) {}
        // Region dropdown lives inside the same fullscreen toolbar init as
        // the statistical region dropdown — refresh its label/selection UI when
        // Reset nukes the scope so the pill returns to "All regions".
        try {
          const rWrap = document.querySelector('[data-db-map-fs-region]');
          if (rWrap && rWrap._refreshLabel) rWrap._refreshLabel();
          if (rWrap && rWrap._refreshSelectionUi) rWrap._refreshSelectionUi();
        } catch (_) {}
        if (worldWrap.classList.contains('is-fullscreen')) {
          m.setView([10, 80], 3, { animate: true });
        } else {
          m.setView(WORLD_MAP_DEFAULT_CENTER, WORLD_MAP_DEFAULT_ZOOM, { animate: true });
        }
      });
    }
  }

  const MAP_FS_EXPAND_SVG = '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>';
  const MAP_FS_COLLAPSE_SVG = '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>';

  // Draw-a-rectangle-to-zoom tool for the fullscreen world map. When armed,
  // the map's built-in drag is temporarily disabled and a mousedown+drag on
  // the map surface draws a dashed rubber-band. On mouseup, the map fits its
  // bounds to the drawn box and draw mode disarms. Idempotent — second call
  // is a no-op via the wrap.dataset.dbMapDrawWired flag.
  //
  // Implementation note: we use native DOM mouse events on the map container
  // (with useCapture=true so we catch them before Leaflet's own handlers).
  // We tried the Leaflet mouse-event API (map.on('mousedown', ...)) first,
  // but those fire AFTER Leaflet's internal drag-start logic, meaning any
  // pan-attempt on the raster tile still grabs focus. Native + capture is
  // more reliable when the map's dragging is programmatically disabled.
  function wireWorldMapDrawToZoom() {
    const wrap = document.querySelector('[data-db-map-world-wrap]');
    const btn  = document.querySelector('[data-db-map-draw-btn]');
    if (!wrap || !btn || wrap.dataset.dbMapDrawWired === '1') return;
    wrap.dataset.dbMapDrawWired = '1';

    let armed = false;         // Draw mode currently active
    let dragging = false;      // Actively drawing a box
    let startPt = null;        // {x, y} in wrap-local coords
    let boxEl = null;          // Rubber-band DOM node

    const getMap = () => state.worldMap;

    // Toggle draw mode on/off. Off state fully cleans up the box, cursor,
    // and re-enables map dragging so the user can pan again.
    const setArmed = (on) => {
      const m = getMap();
      armed = !!on;
      wrap.classList.toggle('is-drawing', armed);
      btn.classList.toggle('is-active', armed);
      btn.setAttribute('aria-pressed', armed ? 'true' : 'false');
      btn.setAttribute('title', armed
        ? 'Draw a rectangle on the map (Esc to cancel)'
        : 'Draw a rectangle on the map to zoom to that area');
      if (m) {
        if (armed) {
          m.dragging.disable();
          m.boxZoom.disable();
          m.doubleClickZoom.disable();
          m.scrollWheelZoom.disable();
        } else {
          m.dragging.enable();
          m.boxZoom.enable();
          m.doubleClickZoom.enable();
          m.scrollWheelZoom.enable();
        }
      }
      if (!armed) removeBox();
    };

    const removeBox = () => {
      if (boxEl && boxEl.parentNode) boxEl.parentNode.removeChild(boxEl);
      boxEl = null;
      dragging = false;
      startPt = null;
    };

    const localXY = (e) => {
      const r = wrap.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setArmed(!armed);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && armed) setArmed(false);
    });

    // Attach mouse handlers to the Leaflet map container with useCapture=true
    // so we intercept events before Leaflet's own drag logic gets them. We
    // only act while armed — otherwise pointer events flow to Leaflet as
    // usual so panning/zooming still work.
    const attachHandlers = () => {
      const m = getMap();
      if (!m || wrap.dataset.dbMapDrawHandlersAttached === '1') return;
      const mapEl = m.getContainer();

      mapEl.addEventListener('mousedown', (e) => {
        if (!armed) return;
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.db-map-fs-btn')) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startPt = localXY(e);
        removeBox();
        boxEl = document.createElement('div');
        boxEl.className = 'db-map-draw-box';
        boxEl.style.left = startPt.x + 'px';
        boxEl.style.top  = startPt.y + 'px';
        boxEl.style.width  = '0px';
        boxEl.style.height = '0px';
        wrap.appendChild(boxEl);
      }, true);

      // mousemove on the document so we still track movement if the pointer
      // briefly leaves the map (e.g. drags out over a toolbar overlay).
      document.addEventListener('mousemove', (e) => {
        if (!armed || !dragging || !startPt || !boxEl) return;
        const cur = localXY(e);
        const x = Math.min(startPt.x, cur.x);
        const y = Math.min(startPt.y, cur.y);
        const w = Math.abs(cur.x - startPt.x);
        const h = Math.abs(cur.y - startPt.y);
        boxEl.style.left = x + 'px';
        boxEl.style.top  = y + 'px';
        boxEl.style.width  = w + 'px';
        boxEl.style.height = h + 'px';
      });

      document.addEventListener('mouseup', (e) => {
        if (!armed || !dragging) return;
        const mp = getMap();
        const endPt = localXY(e);
        const w = Math.abs(endPt.x - (startPt ? startPt.x : endPt.x));
        const h = Math.abs(endPt.y - (startPt ? startPt.y : endPt.y));
        // Ignore tiny boxes (accidental clicks).
        if (w < 8 || h < 8) { removeBox(); setArmed(false); return; }
        if (mp && startPt) {
          try {
            const mapEl2 = mp.getContainer();
            const wrapRect = wrap.getBoundingClientRect();
            const mapRect  = mapEl2.getBoundingClientRect();
            const offX = mapRect.left - wrapRect.left;
            const offY = mapRect.top  - wrapRect.top;
            const p1 = L.point(startPt.x - offX, startPt.y - offY);
            const p2 = L.point(endPt.x   - offX, endPt.y   - offY);
            const ll1 = mp.containerPointToLatLng(p1);
            const ll2 = mp.containerPointToLatLng(p2);
            const bounds = L.latLngBounds(ll1, ll2);
            mp.fitBounds(bounds, { padding: [30, 30], animate: true });
          } catch (_) {}
        }
        removeBox();
        setArmed(false);
      });

      wrap.dataset.dbMapDrawHandlersAttached = '1';
    };

    // The map may not exist yet at wire time; poll briefly for it.
    if (getMap()) attachHandlers();
    else {
      let tries = 0;
      const timer = setInterval(() => {
        if (getMap() || tries > 50) { clearInterval(timer); attachHandlers(); }
        tries++;
      }, 200);
    }
  }

  // Generic wiring for a per-map fullscreen toggle. Handles icon swap,
  // aria-pressed/label sync, Esc-to-exit, body scroll lock, deferred
  // Leaflet invalidateSize() so tiles re-render at the new container
  // size, and optional onOpen/onClose hooks so each map can reframe its
  // view for the new aspect ratio (e.g. fit to markers, restore prior
  // view). Idempotent — second call is a no-op.
  function wireMapFullscreen(wrapSel, btnSel, getMap, hooks) {
    const wrap = document.querySelector(wrapSel);
    const btn  = document.querySelector(btnSel);
    if (!wrap || !btn || btn.dataset.dbMapFsWired === '1') return;
    btn.dataset.dbMapFsWired = '1';
    hooks = hooks || {};

    const setFs = (on) => {
      wrap.classList.toggle('is-fullscreen', on);
      document.body.classList.toggle('db-map-fullscreen-lock', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Expand map to full screen');
      btn.setAttribute('title', on ? 'Exit full screen (Esc)' : 'Expand map to full screen (Esc to exit)');
      const icon = btn.querySelector('svg');
      if (icon) icon.innerHTML = on ? MAP_FS_COLLAPSE_SVG : MAP_FS_EXPAND_SVG;
      const m = typeof getMap === 'function' ? getMap() : null;
      // First: invalidateSize so Leaflet knows the new pixel dimensions.
      // Then run the per-map reframe hook. Then a second invalidateSize
      // to catch animated layout settling.
      setTimeout(() => {
        if (m && typeof m.invalidateSize === 'function') m.invalidateSize({ animate: false });
        try { (on ? hooks.onOpen : hooks.onClose) && (on ? hooks.onOpen() : hooks.onClose()); } catch (_) {}
      }, 60);
      setTimeout(() => { if (m && typeof m.invalidateSize === 'function') m.invalidateSize({ animate: false }); }, 320);
    };

    btn.addEventListener('click', () => setFs(!wrap.classList.contains('is-fullscreen')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrap.classList.contains('is-fullscreen')) setFs(false);
    });
  }

  // -------- Fullscreen world-map filter helpers (Popup v11) --------
  // Filter state for the fullscreen toolbar. All null/'' means "no filter".
  // These sit alongside the search term (state.worldSearchTerm) — the
  // renderWorldMap pipeline applies every active filter in AND fashion.
  state.worldConfFilter    = state.worldConfFilter    || null; // string | null
  state.worldProvFilter    = state.worldProvFilter    || null; // string | null
  state.worldSectorFilter  = state.worldSectorFilter  || null; // string | null
  state.worldWorkCountry   = state.worldWorkCountry   || null; // string | null
  state.worldWorkInst      = state.worldWorkInst      || null; // string | null
  // Map view mode: 'study' (default) plots where scholars completed
  // graduate work; 'work' plots where they currently work. Triggered by
  // opening the fullscreen "All institutions of work" dropdown.
  state.worldMode          = state.worldMode          || 'study';

  // District → statistical region lookup (14 Samoan districts + Rotuma). Ra is in
  // Apia Urban Area; Rotuma is North West Upolu-adjacent but historically listed under North West Upolu
  // in the dashboard's statistical region tallies.
  // District→Region lookup is hydrated at runtime from
  // bundle.geo.politicalDistrictToRegion (Master Sheet Region-District
  // Lookup). Do NOT hardcode district→region pairs here - single source
  // of truth is the sheet.
  let DISTRICT_TO_REGION = {};
  function _hydrateDistrictToRegion(bundle) {
    if (bundle && bundle.geo && bundle.geo.politicalDistrictToRegion) {
      DISTRICT_TO_REGION = Object.assign({}, bundle.geo.politicalDistrictToRegion);
    }
  }

  // Alias-aware scholar-name → profile lookup. worldPoints store scholar
  // names in "First Last" order, while state.scholarProfilesByName is keyed
  // by "Last, First". This helper mirrors the alias/paren-stripping logic
  // from executeWorldSearch so a name like "Asesela D. Ravuvu (Asesela
  // Drekeivalu)" still resolves to the canonical profile.
  function _worldBuildLastFirst(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length < 2) return String(name || '').trim();
    const last = parts.pop();
    return `${last}, ${parts.join(' ')}`;
  }
  function findProfileForScholarName(fullName) {
    const profiles = state.scholarProfilesByName;
    if (!profiles) return null;
    const aliases = state.nameAliases || new Map();
    const raw = String(fullName || '').trim();
    if (!raw) return null;
    const collapsed = raw.replace(/\s+/g, ' ');
    const stripped = collapsed.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

    // Popup / worldPoints names arrive already in canonical "Last, First"
    // form, while B3 chart labels and other surfaces pass "First Last".
    // We build candidates covering both, in the order most-likely-to-hit
    // first: (1) verbatim if the input already has a comma, then (2) the
    // "First Last" → "Last, First" rebuild.
    const candidates = [];
    if (collapsed.includes(',')) candidates.push(collapsed);
    if (stripped.includes(',') && stripped !== collapsed) candidates.push(stripped);
    candidates.push(_worldBuildLastFirst(collapsed));
    if (stripped !== collapsed) candidates.push(_worldBuildLastFirst(stripped));

    // Try alias-resolved candidates first.
    for (const c of candidates) {
      if (aliases.has(c)) {
        const canonical = aliases.get(c);
        if (profiles.has(canonical)) return profiles.get(canonical);
      }
    }
    // Then try candidates directly.
    for (const c of candidates) {
      if (profiles.has(c)) return profiles.get(c);
    }
    // Finally the stripped Last-First form (first-token fallback that
    // scholarProfilesByName also indexes).
    const fallback = _worldBuildLastFirst(stripped);
    if (profiles.has(fallback)) return profiles.get(fallback);
    return null;
  }

  // Statistical Region for a scholar name (uses paternalDistrict, then maternalDistrict).
  // Profile.region may be the literal string 'Unclassified' — treat that
  // as "not set" so the district → statistical region fallback still fires.
  function scholarConfProv(name) {
    const p = findProfileForScholarName(name);
    const district = (p && (p.paternalDistrict || p.maternalDistrict) || '').trim();
    let region = (p && p.region || '').trim();
    if (!region || region.toLowerCase() === 'unclassified') {
      region = DISTRICT_TO_REGION[district] || '';
    }
    return { profile: p, district, region };
  }

  // Return true if a scholar name passes ALL the active fullscreen filters
  // (region, district, sector, work-country, work-institution).
  function scholarPassesWorldFilters(name) {
    const conf   = state.worldConfFilter;
    const prov   = state.worldProvFilter;
    const sector = state.worldSectorFilter;
    const wcty   = state.worldWorkCountry;
    const winst  = state.worldWorkInst;
    if (!conf && !prov && !sector && !wcty && !winst) return true;

    const { profile, district, region } = scholarConfProv(name);

    if (conf && region !== conf) return false;
    if (prov && district !== prov) return false;
    if (sector) {
      if (!profile || (profile.sector || '') !== sector) return false;
    }
    if (wcty) {
      if (!profile || (profile.institutionCountry || '') !== wcty) return false;
    }
    if (winst) {
      if (!profile || (profile.institution || '') !== winst) return false;
    }
    return true;
  }

  // True if any fullscreen filter (beyond search) is active. Used to decide
  // whether to hide points whose scholar arrays become empty after filtering.
  function worldHasFilter() {
    return !!(state.worldConfFilter || state.worldProvFilter || state.worldSectorFilter
              || state.worldWorkCountry || state.worldWorkInst);
  }

  // -------- Workplace-mode support --------
  // The fullscreen "All institutions of work" dropdown flips the world
  // map into a Workplace view: instead of plotting where each scholar
  // studied, we plot where each scholar currently works. One dot per
  // institution, sized by the number of profiled scholars stationed
  // there. Only scholars with a curated profile (institution +
  // institutionCountry) appear; the yellow coverage note explains the
  // gap for unprofiled scholars. Mode lives in state.worldMode ∈
  // {'study', 'work'}; default is 'study'.

  // Resolve the lat/lng for a scholar profile's institution. Tries the
  // curated workplace-coords table first (small hand-maintained list),
  // then falls back to matching against the existing study university
  // worldPoints (so we don't duplicate coords for USP, University of
  // Sydney, etc.). Returns { lat, lng } or null.
  function _lookupWorkplaceCoord(country, institution) {
    if (!institution) return null;
    const wc = state.workplaceCoords || {};
    if (wc[institution] && typeof wc[institution].lat === 'number') {
      return { lat: wc[institution].lat, lng: wc[institution].lng };
    }
    const stripped = institution.split(' (')[0].trim();
    if (wc[stripped] && typeof wc[stripped].lat === 'number') {
      return { lat: wc[stripped].lat, lng: wc[stripped].lng };
    }
    const wps = (state.graduateStudies && state.graduateStudies.worldPoints) || [];
    for (const w of wps) {
      if (w.country !== country) continue;
      if (w.university === institution || w.university === stripped) {
        return { lat: w.lat, lng: w.lng };
      }
    }
    return null;
  }

  // Aggregate profiled scholars into one point per (country, institution).
  // Only profiles that have both `institution` and `institutionCountry`
  // contribute; unprofiled scholars are silently skipped (the coverage
  // note in the toolbar explains the gap). Also applies the statistical region /
  // district / sector filters so cross-filtering still works.
  function buildWorkplacePoints() {
    const profiles = state.scholarProfilesByName;
    if (!profiles || !profiles.size) return [];
    // Dedupe scholars: profiles is keyed by both "Last, First" and its
    // no-middle-initial stripped variant, so the same person can appear
    // twice. Track by slug (or Last-First fallback) so each real person
    // counts once.
    const seen = new Set();
    const buckets = new Map(); // key -> { country, institution, lat, lng, scholars: [] }
    profiles.forEach((p) => {
      const key = p.slug || `${p.last || ''}|${p.first || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const inst = (p.institution || '').trim();
      const country = (p.institutionCountry || '').trim();
      if (!inst || !country) return;
      // Workplace-mode drill-downs: when a country/institution is picked
      // in the work dropdown, restrict the points to that selection.
      if (state.worldWorkCountry && country !== state.worldWorkCountry) return;
      if (state.worldWorkInst && inst !== state.worldWorkInst) return;
      // Apply the cross-filters (statistical region / district / sector). These
      // reuse the same predicate the Study view uses so filter behaviour
      // is consistent across modes.
      const nameFirstLast = `${p.first || ''} ${p.last || ''}`.trim();
      if (!_scholarPassesCrossFilters(nameFirstLast, p)) return;
      const coord = _lookupWorkplaceCoord(country, inst);
      if (!coord) return;
      const bkey = `${country}|${inst}`;
      let b = buckets.get(bkey);
      if (!b) {
        b = { country, institution: inst, lat: coord.lat, lng: coord.lng, scholars: [] };
        buckets.set(bkey, b);
      }
      b.scholars.push(p);
    });
    return Array.from(buckets.values());
  }

  // The cross-filter predicate for Workplace mode. Runs the region,
  // district, and sector checks against a scholar profile. Skips the
  // work-country / work-institution filters because those are handled by
  // the workplace aggregation itself.
  function _scholarPassesCrossFilters(nameFirstLast, profile) {
    const conf = state.worldConfFilter;
    const prov = state.worldProvFilter;
    const sector = state.worldSectorFilter;
    if (conf) {
      const c = (profile.region || '').trim();
      if (c !== conf) {
        // Try inferring from district if statistical region was blank.
        const pp = (profile.paternalDistrict || profile.maternalDistrict || '').trim();
        if (!pp || DISTRICT_TO_REGION[pp] !== conf) return false;
      }
    }
    if (prov) {
      const pp = (profile.paternalDistrict || '').trim();
      const mp = (profile.maternalDistrict || '').trim();
      if (pp !== prov && mp !== prov) return false;
    }
    if (sector) {
      const s = (profile.sector || '').trim();
      if (s !== sector) return false;
    }
    return true;
  }

  // Apply active filters to a single worldPoint and return a shallow copy
  // whose scholar arrays and counts reflect only scholars that pass. If
  // the point has no matching scholars, returns null.
  function filterWorldPoint(p) {
    const active = worldHasFilter();
    if (!active) return p;
    const phdScholars = (p.phdScholars || []).filter(scholarPassesWorldFilters);
    const mastersScholars = (p.mastersScholars || []).filter(scholarPassesWorldFilters);
    const unknownScholars = (p.unknownScholars || []).filter(scholarPassesWorldFilters);
    const total = phdScholars.length + mastersScholars.length + unknownScholars.length;
    if (total === 0) return null;
    return Object.assign({}, p, {
      phdScholars, mastersScholars, unknownScholars,
      phdCount: phdScholars.length,
      mastersCount: mastersScholars.length,
      unknownCount: unknownScholars.length,
      total,
      scholarsCount: total,
      thesesCount: total
    });
  }

  // -------- Workplace popup card --------
  // Matches the reference mockup uploaded 2026-07-09 (image-2 in the
  // attachments): region -tinted top bar with the institution name,
  // then a card per scholar showing photo + name + village line +
  // department + position. When multiple scholars share an institution
  // (rare so far but planned for SPC/USP), we stack cards separated by a
  // hairline divider inside a scrollable container so the popup stays
  // compact.
  const _WORK_CONF_BAR = {
    'Rest of Upolu': 'linear-gradient(90deg, #FF5A6E 0%, #c93e50 100%)',
    'Apia Urban Area':     'linear-gradient(90deg, #4ECDE6 0%, #0891b2 100%)',
    'North West Upolu':     'linear-gradient(90deg, #FFD84A 0%, #f7b500 100%)'
  };
  const _WORK_CONF_TEXT = {
    // Apia Urban Area/Rest of Upolu bars are dark enough to carry white text; North West Upolu
    // (bright yellow) needs near-black for AA contrast.
    'Rest of Upolu': '#ffffff',
    'Apia Urban Area':     '#ffffff',
    'North West Upolu':     '#28251D'
  };

  function _workplaceProvinceForProfile(p) {
    // Identity district is strictly paternal. See
    // docs/PANELF-PATERNAL-GEOGRAPHY-2026-08-25.md.
    return (p.paternalDistrict || '').trim();
  }

  function _workplaceVillageLine(p) {
    // Primary line: paternal-only identity geography.
    // See docs/PANELF-PATERNAL-GEOGRAPHY-2026-08-25.md.
    const village = (p.paternalVillage || '').trim();
    const island  = (p.paternalIsland  || '').trim();
    const pat = (p.paternalDistrict || '').trim();
    const mat = (p.maternalDistrict || '').trim();
    // V2 canonical primary line: 'Naroi vlg (Moala Is), Lau District.' or
    // 'Naduri vlg, Macuata District.' (Viti/Vanua Levu suppressed). See
    // formatScholarGeography() near the top of this file for the full spec.
    const patMerged = formatScholarGeography(village, island, pat);
    // Second-line maternal-side note when maternal district differs from
    // paternal. We keep the statistical region tag on the maternal note so a
    // mixed-heritage scholar still surfaces the maternal region.
    let matNote = '';
    if (mat && mat !== pat) {
      const mconf = DISTRICT_TO_REGION[mat] || '';
      matNote = mconf ? `maternal: ${mat} \u2013 ${mconf}` : `maternal: ${mat}`;
    }
    return { primary: patMerged, maternal: matNote };
  }

  function buildWorkplacePopupHtml(point) {
    const scholars = point.scholars || [];
    const total = scholars.length;
    const country = escapeHtml(point.country || '');
    const inst = escapeHtml(point.institution || '');
    // Header/bar colour: use the majority-statistical region tint at the
    // institution. Ties fall back to the neutral teal.
    const confTally = { 'Rest of Upolu': 0, 'Apia Urban Area': 0, 'North West Upolu': 0 };
    scholars.forEach(p => {
      const c = (p.region || '').trim() || DISTRICT_TO_REGION[(p.paternalDistrict || '').trim()] || '';
      if (confTally[c] !== undefined) confTally[c] += 1;
    });
    let topConf = '';
    let topN = 0;
    ['Rest of Upolu', 'Apia Urban Area', 'North West Upolu'].forEach(c => { if (confTally[c] > topN) { topConf = c; topN = confTally[c]; } });
    const bar = _WORK_CONF_BAR[topConf] || 'linear-gradient(90deg, #0e7490 0%, #062f35 100%)';
    const barText = _WORK_CONF_TEXT[topConf] || '#ffffff';

    const cards = scholars.map(p => {
      const salutation = (p.salutation || '').trim();
      const displayName = `${salutation ? salutation + ' ' : ''}${p.first || ''} ${p.last || ''}`.trim();
      const nameHtml = escapeHtml(displayName || p.name || '');
      const photo = (p.photo || '').trim();
      const photoHtml = photo
        ? `<img class="db-work-popup__photo" src="${escapeHtml(photo)}" alt="${nameHtml}" onerror="this.style.display='none'">`
        : `<div class="db-work-popup__photo db-work-popup__photo--placeholder">${escapeHtml(((p.first || '')[0] || '') + ((p.last || '')[0] || '')).toUpperCase()}</div>`;
      const vline = _workplaceVillageLine(p);
      // Show the standard village-line only when we actually have a village.
      // If the profile has a district but no village, mark it as “not yet
      // added” and still show the district on a small suffix line so we
      // never lose the statistical region context.
      const hasVillage = !!((p.village || '').trim());
      let villageHtml;
      if (hasVillage) {
        villageHtml = `<div class="db-work-popup__village">${escapeHtml(vline.primary)}</div>`;
      } else {
        const patTag = vline.primary ? ` <span class="db-work-popup__village-prov">${escapeHtml(vline.primary)}</span>` : '';
        villageHtml = `<div class="db-work-popup__village db-work-popup__village--muted">Village not yet added${patTag}</div>`;
      }
      const maternalHtml = vline.maternal
        ? `<div class="db-work-popup__maternal">${escapeHtml(vline.maternal)}</div>`
        : '';
      const dept = (p.department || '').trim();
      const title = (p.title || '').trim();
      const deptHtml = dept ? `<div class="db-work-popup__dept">${escapeHtml(dept)}</div>` : '';
      const titleHtml = title ? `<div class="db-work-popup__title">${escapeHtml(title)}</div>` : '';
      const slug = (p.slug || '').trim();
      const nameLink = slug
        ? `<a class="db-work-popup__name-link" href="#scholar=${encodeURIComponent(slug)}">${nameHtml}</a>`
        : nameHtml;
      return (
        `<div class="db-work-popup__card">` +
          `<div class="db-work-popup__row">` +
            photoHtml +
            `<div class="db-work-popup__meta">` +
              `<div class="db-work-popup__name">${nameLink}</div>` +
              villageHtml +
              maternalHtml +
              deptHtml +
              titleHtml +
            `</div>` +
          `</div>` +
        `</div>`
      );
    }).join('<div class="db-work-popup__divider"></div>');

    return (
      `<div class="db-work-popup">` +
        `<div class="db-work-popup__bar" style="background:${bar};color:${barText};">` +
          `<div class="db-work-popup__bar-inst">${inst}</div>` +
          `<div class="db-work-popup__bar-country">${country}</div>` +
        `</div>` +
        `<div class="db-work-popup__count">${total} · Samoan scholar${total === 1 ? '' : 's'} working here</div>` +
        `<div class="db-work-popup__scroll">${cards}</div>` +
      `</div>`
    );
  }

  // Workplace-view renderer. Behaves like renderWorldMap's study path
  // but sources points from buildWorkplacePoints() and swaps the popup.
  function renderWorkplaceMap() {
    if (!state.worldMap) return;
    if (state.worldLayer) { state.worldMap.removeLayer(state.worldLayer); state.worldLayer = null; }

    const points = buildWorkplacePoints();
    // Reuse the study-mode stats readout but express counts in workplace
    // terms. Countries = distinct workplace countries; Universities = "
    // distinct workplaces"; Scholars = profiled scholars appearing on the
    // map.
    _updateWorkplaceStats(points);

    const isFs = !!state.worldMapFullscreen;
    // Single-copy markers: the fullscreen viewport is 260° wide (see
    // Fullscreen only: shift each workplace marker to the wrap-copy
    // closest to 140°E so American markers render east of the anti-
    // meridian and stay reachable by panning right. Inline view keeps
    // canonical positions — Leaflet's tile wrap handles rendering there.
    const wrapAnchor = 140;
    const wrapLng = (lng) => {
      if (!isFs) return lng;
      const candidates = [lng - 360, lng, lng + 360];
      let best = lng, bestDist = Math.abs(lng - wrapAnchor);
      candidates.forEach(c => {
        const d = Math.abs(c - wrapAnchor);
        if (d < bestDist) { bestDist = d; best = c; }
      });
      return best;
    };
    const markers = [];
    const latlngs = [];
    points.forEach(p => {
      const total = p.scholars.length;
      const radius = Math.min(28, 6 + total * 3);
      const color = total >= 5 ? '#7a1419' : total >= 3 ? '#c93e50' : total >= 2 ? '#e6550d' : '#fd8d3c';
      const popupHtml = buildWorkplacePopupHtml(p);
      const popupOpts = {
        maxWidth: 460,
        minWidth: 320,
        className: 'db-world-popup db-world-popup--work',
        autoClose: false,
        closeOnClick: false,
        autoPan: true,
        autoPanPadding: [40, 40],
        keepInView: true
      };
      const displayLng = wrapLng(p.lng);
      const m = L.circleMarker([p.lat, displayLng], {
        radius, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.85
      });
      m.bindPopup(popupHtml, popupOpts);
      m.on('mouseover', () => m.openPopup());
      m.on('popupopen', (evt) => {
        const el = evt.popup && evt.popup.getElement && evt.popup.getElement();
        try { wirePopupAutoClose(el, evt.popup, m); } catch (_) {}
        setTimeout(() => { try { nudgePopupIntoView(el, state.worldMap); } catch (_) {} }, 40);
      });
      markers.push(m);
      latlngs.push([p.lat, displayLng]);
    });
    state.worldLayer = L.layerGroup(markers).addTo(state.worldMap);

    if (!state.worldSelectedCountry && !isFs) {
      if (latlngs.length > 1) {
        const b = L.latLngBounds(latlngs);
        state.worldMap.fitBounds(b, { padding: [40, 60], maxZoom: 3, animate: false });
      } else if (latlngs.length === 1) {
        state.worldMap.setView(latlngs[0], 3, { animate: false });
      } else {
        state.worldMap.setView(WORLD_MAP_DEFAULT_CENTER, WORLD_MAP_DEFAULT_ZOOM);
      }
    }
    // In fullscreen, snap back to the Pacific-centred framing on every
    // Work-mode render — unless a country/institution drill-down is
    // already active. invalidateSize() runs FIRST so Leaflet knows the
    // container is now fullscreen before computing the view.
    //
    // We use setView with a fixed center + zoom rather than fitBounds
    // because fitBounds picks the min zoom that fits both lat and lng in
    // the viewport — on a wide-latitude window (–58 to 62), that lands
    // at zoom 1 where the world is only 512px wide, so 1500px viewports
    // show ~3 wrapped world copies (the ghost-Africa bug). setView(zoom 2)
    // renders one world (1024px) with a clean Pacific-centred crop.
    if (isFs && !state.worldWorkCountry && !state.worldWorkInst) {
      state.worldMap.invalidateSize();
      state.worldMap.setView([10, 80], 3, { animate: false });
    }
    setTimeout(() => { if (state.worldMap) state.worldMap.invalidateSize(); }, 0);
  }

  // Zoom the map to a specific workplace country in Work mode. Averages
  // the lat/lng of all workplaces in that country and picks a reasonable
  // zoom level based on span.
  function _zoomWorkplaceCountry(country) {
    if (!state.worldMap) return;
    const wc = state.workplaceCoords || {};
    const points = [];
    const profiles = state.scholarProfilesByName || new Map();
    const seen = new Set();
    profiles.forEach(p => {
      const key = p.slug || `${p.last||''}|${p.first||''}`;
      if (seen.has(key)) return; seen.add(key);
      const c = (p.institutionCountry || '').trim();
      const inst = (p.institution || '').trim();
      if (c !== country || !inst) return;
      const coord = _lookupWorkplaceCoord(c, inst);
      if (coord) points.push([coord.lat, coord.lng]);
    });
    if (!points.length) return;
    if (points.length === 1) {
      state.worldMap.setView(points[0], 5, { animate: true });
    } else {
      state.worldMap.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 5, animate: true });
    }
  }

  function _zoomWorkplaceInstitution(country, inst) {
    if (!state.worldMap) return;
    const coord = _lookupWorkplaceCoord(country, inst);
    if (!coord) return;
    state.worldMap.setView([coord.lat, coord.lng], 8, { animate: true });
  }

  function _updateWorkplaceStats(points) {
    const countriesEl = document.querySelector('[data-db-map-fs-stats-countries]');
    const unisEl      = document.querySelector('[data-db-map-fs-stats-unis]');
    const scholarsEl  = document.querySelector('[data-db-map-fs-stats-scholars]');
    const mastersEl   = document.querySelector('[data-db-map-fs-stats-masters]');
    const phdEl       = document.querySelector('[data-db-map-fs-stats-phd]');
    if (!countriesEl || !unisEl || !scholarsEl) return;
    const countries = new Set();
    let scholarCount = 0;
    (points || []).forEach(p => {
      if (p.country) countries.add(p.country);
      scholarCount += (p.scholars || []).length;
    });
    countriesEl.textContent = String(countries.size);
    unisEl.textContent      = String((points || []).length);
    scholarsEl.textContent  = String(scholarCount);
    // Workplace view is workplace-country, not graduate-degree, so we
    // don't have per-scholar Masters/PhD breakdowns to show here. Blank
    // out the cells so a stale count from graduate view doesn't linger.
    if (mastersEl) mastersEl.textContent = '\u2014';
    if (phdEl)     phdEl.textContent     = '\u2014';
    // Coverage note is always relevant in workplace view because ~262/302
    // scholars lack a curated workplace. Force it on.
    const noteEl = document.querySelector('[data-db-map-fs-coverage]');
    if (noteEl) {
      noteEl.style.display = '';
      noteEl.textContent = `Workplace view shows profiled scholars only. ${scholarCount} scholar${scholarCount === 1 ? '' : 's'} across ${(points || []).length} institution${(points || []).length === 1 ? '' : 's'} — unprofiled scholars are hidden until their workplace is added.`;
    }
  }

  function renderWorldMap() {
    if (!state.worldMap) return;
    if (state.worldLayer) { state.worldMap.removeLayer(state.worldLayer); state.worldLayer = null; }

    // Workplace view: one dot per (country, institution) sourced from the
    // curated profile data instead of the study worldPoints. Everything
    // downstream — auto-frame, stats, popups — is handled inside the
    // workplace renderer so this branch stays isolated.
    if (state.worldMode === 'work') {
      renderWorkplaceMap();
      return;
    }

    const grad = state.graduateStudies || { worldPoints: [] };
    const rawPoints = grad.worldPoints || [];
    // Defense in depth: any worldPoint missing lat/lng crashes Leaflet's
    // circleMarker (`_project` reads .lat on null). This has bitten us
    // when the refresh script emitted null coords for a university that
    // wasn't in world-universities.json. Drop those points here so one
    // bad row can't take the whole map init down with it. The Countries
    // stat still counts them via the graduate-studies totals if needed.
    const validPoints = rawPoints.filter(p => {
      return p && typeof p.lat === 'number' && typeof p.lng === 'number'
             && isFinite(p.lat) && isFinite(p.lng);
    });
    if (validPoints.length !== rawPoints.length) {
      console.warn('renderWorldMap: dropped', rawPoints.length - validPoints.length,
                   'worldPoints with null/invalid coords',
                   rawPoints.filter(p => !p || typeof p.lat !== 'number' || typeof p.lng !== 'number')
                            .map(p => p && p.university));
    }
    // Apply fullscreen toolbar filters. Points with no matching scholars
    // drop out entirely. When no filter is active, this is a passthrough.
    const points = validPoints.map(filterWorldPoint).filter(Boolean);
    // Refresh the stat readout every time we redraw — keeps it in sync
    // with the current filtered set of points.
    updateWorldMapStats(points);

    if (state.worldView === 'publish') {
      // Placeholder — publication-country tagging is a follow-up feature.
      state.worldLayer = L.layerGroup([]).addTo(state.worldMap);
      state.worldMap.setView([15, 20], 2);
      return;
    }

    // Where Samoan graduates study.
    // Fullscreen only: shift each marker to the wrap-copy closest to the
    // reference longitude (140°E) so Hawai‘i and US-mainland markers
    // render east of the antimeridian and are reachable by dragging the
    // map right, rather than falling off the left edge of a Pacific-
    // centred fullscreen viewport. Inline view keeps canonical positions
    // — Leaflet's tile wrap already renders them correctly there.
    const isFs = !!state.worldMapFullscreen;
    const wrapAnchor = 140;
    const wrapLng = (lng) => {
      if (!isFs) return lng;
      const candidates = [lng - 360, lng, lng + 360];
      let best = lng, bestDist = Math.abs(lng - wrapAnchor);
      candidates.forEach(c => {
        const d = Math.abs(c - wrapAnchor);
        if (d < bestDist) { bestDist = d; best = c; }
      });
      return best;
    };
    const markers = [];
    const latlngs = [];
    points.forEach(p => {
      const total = (p.phdScholars.length + p.mastersScholars.length + (p.unknownScholars || []).length);
      const radius = Math.min(28, 6 + total * 3);
      const color = total >= 5 ? '#7a1419' : total >= 3 ? '#c93e50' : total >= 2 ? '#e6550d' : '#fd8d3c';
      const popupHtml = buildWorldPopupHtml(p);

      // Wider maxWidth to fit both the scholar list and the expandable
      // thesis-detail slot without wrapping ugly. autoClose:false + closeOnClick:false
      // keeps the popup pinned so the user can move the mouse from the marker
      // onto a scholar name to reveal the thesis title — without the popup
      // vanishing en route or being closed by another marker's mouseover.
      // autoPan:true lets Leaflet nudge the map so the popup fits inside the
      // viewport — critical for Samoa/NZ markers that sit near the right edge
      // of the equator-centred world view.
      const popupOpts = {
        maxWidth: 460,
        minWidth: 320,
        className: 'db-world-popup',
        autoClose: false,
        closeOnClick: false,
        autoPan: true,
        autoPanPadding: [40, 40],
        keepInView: true
      };

      const displayLng = wrapLng(p.lng);
      const m = L.circleMarker([p.lat, displayLng], {
        radius, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.85
      });
      // Tag the marker with its worldPoint + home lat/lng so viewport-
      // scoped stat updates and overlap-spider layout can walk
      // state.worldLayer.getLayers() and reach the underlying data
      // without a parallel array.
      m._worldPoint = p;
      m._worldHome = [p.lat, displayLng];
      m._worldRadius = radius;
      m.bindPopup(popupHtml, popupOpts);
      m.on('mouseover', () => m.openPopup());
      m.on('popupopen', (evt) => {
        const el = evt.popup && evt.popup.getElement && evt.popup.getElement();
        wirePopupScholarHovers(el, p);
        wirePopupAutoClose(el, evt.popup, m);
        // Give autoPan a beat, then verify the popup is fully inside the map
        // viewport. If it isn't (common for Samoa's huge popups near the map
        // edges), pan the map manually so the popup sits comfortably.
        setTimeout(() => nudgePopupIntoView(el, state.worldMap), 40);
      });
      markers.push(m);
      latlngs.push([p.lat, displayLng]);
    });

    state.worldLayer = L.layerGroup(markers).addTo(state.worldMap);

    // Run the overlap-spider layout for the current zoom so USP/FNU/UoF
    // don't overlap on first paint. moveend handles subsequent redraws.
    setTimeout(() => applyOverlapSpider(), 0);

    // Auto-frame to marker bounds (with side buffer) whenever we (re)draw
    // the base world markers, but only when there's no active drill-down
    // and not in fullscreen (fullscreen has its own onOpen framing).
    if (!state.worldSelectedCountry && !isFs) {
      if (latlngs.length > 1) {
        const b = L.latLngBounds(latlngs);
        // Generous padding so all dots have breathing room from the edges.
        state.worldMap.fitBounds(b, { padding: [40, 60], maxZoom: 3, animate: false });
      } else if (latlngs.length === 1) {
        state.worldMap.setView(latlngs[0], 3, { animate: false });
      } else {
        state.worldMap.setView(WORLD_MAP_DEFAULT_CENTER, WORLD_MAP_DEFAULT_ZOOM);
      }
    }
    setTimeout(() => { if (state.worldMap) state.worldMap.invalidateSize(); }, 0);
  }

  // -------- Fullscreen stat readout --------
  // Update the (Countries / Universities / Scholars) numbers next to the
  // toolbar. `pointsInView` is the already-filtered set of worldPoints
  // renderWorldMap just drew.
  function updateWorldMapStats(pointsInView) {
    const countriesEl = document.querySelector('[data-db-map-fs-stats-countries]');
    const unisEl      = document.querySelector('[data-db-map-fs-stats-unis]');
    const scholarsEl  = document.querySelector('[data-db-map-fs-stats-scholars]');
    const mastersEl   = document.querySelector('[data-db-map-fs-stats-masters]');
    const phdEl       = document.querySelector('[data-db-map-fs-stats-phd]');
    if (!countriesEl || !unisEl || !scholarsEl) return;
    const countries = new Set();
    const scholars = new Set();
    // Masters and PhD are counted as UNIQUE-scholars-with-that-degree,
    // deduped across universities. A scholar who did their masters at
    // USP and their PhD at Massey shows up once in Masters and once in
    // PhD, but only once in Scholars. This matches how Ron talks about
    // the totals ("302 scholars, 122 Masters, 11 PhDs at USP", etc.).
    const mastersSet = new Set();
    const phdSet = new Set();
    let unis = 0;
    (pointsInView || []).forEach(p => {
      if (p.country) countries.add(p.country);
      unis += 1;
      (p.phdScholars || []).forEach(n => { scholars.add(n); phdSet.add(n); });
      (p.mastersScholars || []).forEach(n => { scholars.add(n); mastersSet.add(n); });
      (p.unknownScholars || []).forEach(n => scholars.add(n));
    });
    countriesEl.textContent = String(countries.size);
    unisEl.textContent      = String(unis);
    scholarsEl.textContent  = String(scholars.size);
    if (mastersEl) mastersEl.textContent = String(mastersSet.size);
    if (phdEl)     phdEl.textContent     = String(phdSet.size);
    // Coverage note — shown only when a filter that depends on curated
    // profile fields (sector / work-country / work-institution) is active.
    const noteEl = document.querySelector('[data-db-map-fs-coverage]');
    if (noteEl) {
      const needsProfile = !!(state.worldSectorFilter || state.worldWorkCountry || state.worldWorkInst);
      if (needsProfile) {
        const grad = state.graduateStudies || { worldPoints: [] };
        const allScholars = new Set();
        (grad.worldPoints || []).forEach(p => {
          (p.phdScholars || []).forEach(n => allScholars.add(n));
          (p.mastersScholars || []).forEach(n => allScholars.add(n));
          (p.unknownScholars || []).forEach(n => allScholars.add(n));
        });
        // How many of the 302 scholars carry ANY of the profile fields the
        // Sector / Institutions-of-work filters need? That's the pool the
        // filter can "see". Counted here so the number stays honest as Ron
        // fills in more profiles.
        let profiled = 0;
        allScholars.forEach(n => {
          const p = findProfileForScholarName(n);
          if (p && (p.sector || p.institutionCountry || p.institution)) profiled += 1;
        });
        noteEl.textContent = `Sector and Institutions-of-work data currently exist for ${profiled} / ${allScholars.size} scholars — unprofiled scholars are hidden while this filter is active.`;
        noteEl.hidden = false;
      } else {
        noteEl.hidden = true;
      }
    }
  }

  // -------- Viewport-scoped stats + overlap-spider --------
  //
  // When Ron types "Samoa" and hits Enter, the map zooms in but the toolbar
  // still says "14 Countries / 66 Universities / 308 Scholars". These
  // helpers rescope the counter to whatever is currently visible in the
  // viewport, and fan out overlapping circles so USP, FNU, and UoF are
  // all hoverable in Suva (instead of USP hiding under FNU).
  //
  // Both hook off `moveend`, so panning or zooming out to see the whole
  // world restores the global totals and collapses the spider layout.

  // Recompute Countries / Universities / Scholars / Masters / PhD from
  // the current search scope (set by executeWorldSearch on a single-
  // country match, cleared by the Reset button). This is intentionally
  // narrower than "anything in the viewport" so hand-panning around at
  // the default zoom doesn't churn the totals; the counter only
  // rescopes when Ron actively narrowed the map via search.
  function updateWorldMapStatsForScope() {
    if (!state.worldLayer) return;
    const scope = state.worldSearchScope;
    const all = state.worldLayer.getLayers().filter(l => l && l._worldHome && l._worldPoint);
    let matching;
    if (scope && scope.university) {
      matching = all.filter(l => l._worldPoint.university === scope.university);
    } else if (scope && scope.country) {
      matching = all.filter(l => l._worldPoint.country === scope.country);
    } else if (scope && scope.region && Array.isArray(scope.regionCountries)) {
      const set = new Set(scope.regionCountries);
      matching = all.filter(l => set.has(l._worldPoint.country));
    } else {
      matching = all;
    }
    updateWorldMapStats(matching.map(l => l._worldPoint));
  }

  // Silent overlap detection + hover-triggered spider layout.
  //
  // Markers stay in their real (overlapping) positions by default. On every
  // moveend we recompute which markers overlap in screen space and assign
  // them a shared cluster reference. Hovering ANY marker in a 2+ cluster
  // fans that cluster out; leaving the whole cluster area collapses it back
  // home. Hovering an individual fanned marker keeps just that one visible
  // (the popup owner) and pulls the others back to home so the popup has
  // visual priority.
  function applyOverlapSpider() {
    const m = state.worldMap;
    if (!m || !state.worldLayer) return;
    const layers = state.worldLayer.getLayers().filter(l => l && l._worldHome);

    // Collapse any currently-fanned cluster from the previous zoom level and
    // clear its cluster tag. New clusters will be assigned below.
    layers.forEach(l => {
      const h = l._worldHome;
      if (l.getLatLng) {
        const cur = l.getLatLng();
        if (Math.abs(cur.lat - h[0]) > 1e-9 || Math.abs(cur.lng - h[1]) > 1e-9) {
          l.setLatLng(h);
        }
      }
      l._spiderCluster = null;
      l._spiderPos = null;
    });

    // Cluster markers whose disks overlap in screen space at the current
    // zoom. Threshold uses the larger of the two radii so any pair whose
    // circles touch ends up in the same cluster.
    const pxOf = (ll) => m.latLngToLayerPoint(ll);
    const clusters = [];
    layers.forEach(l => {
      const homePt = pxOf(L.latLng(l._worldHome[0], l._worldHome[1]));
      let joined = false;
      for (const c of clusters) {
        for (const other of c.markers) {
          const otherPt = pxOf(L.latLng(other._worldHome[0], other._worldHome[1]));
          const dist = Math.hypot(homePt.x - otherPt.x, homePt.y - otherPt.y);
          const r1 = l._worldRadius || 10;
          const r2 = other._worldRadius || 10;
          if (dist < Math.max(r1, r2) * 2.2) {
            c.markers.push(l);
            joined = true;
            break;
          }
        }
        if (joined) break;
      }
      if (!joined) clusters.push({ markers: [l], expanded: false });
    });

    // Tag each marker in a 2+ cluster with the cluster reference AND wire
    // hover handlers once. No positions are changed here — markers stay
    // overlapped until a mouseover triggers the fan.
    clusters.forEach(c => {
      if (c.markers.length < 2) return;
      c.markers.forEach(l => {
        l._spiderCluster = c;
        if (l._spiderHoverWired) return;
        l._spiderHoverWired = true;
        // mouseover: if the cluster is not yet expanded, fan it out. Then
        // (whether newly expanded or already open) collapse the siblings so
        // the hovered marker's popup owns the visual space.
        l.on('mouseover', () => {
          if (l._collapseTimer) { clearTimeout(l._collapseTimer); l._collapseTimer = null; }
          const cluster = l._spiderCluster;
          if (!cluster) return;
          if (!cluster.expanded) {
            // First hover on this cluster — fan the SIBLINGS out around
            // this marker so the user can see and pick any of them.
            _expandSpiderCluster(cluster, l);
          } else {
            // Cluster is already fanned; the user landed on THIS marker,
            // so pull the other siblings home and let this popup own the
            // visual space. The current marker keeps its spider position.
            _spiderCollapseOthers(l);
          }
        });
        // mouseout: schedule a collapse of the entire cluster back home.
        // A quick re-enter (onto a sibling or back onto this marker)
        // cancels via the mouseover handler above.
        l.on('mouseout', () => _scheduleClusterCollapse(l));
      });
    });
  }

  function _expandSpiderCluster(cluster, seedMarker) {
    // Fan the SIBLINGS of `seedMarker` out on a circle around the seed's
    // home position. The seed stays put so the mouse cursor stays over
    // the marker that triggered the expansion (otherwise the fan happens
    // and mouseout fires immediately, collapsing everything).
    const m = state.worldMap;
    if (!m || !cluster || cluster.expanded) return;
    const siblings = seedMarker
      ? cluster.markers.filter(l => l !== seedMarker)
      : cluster.markers;
    if (!siblings.length) return;
    const anchor = seedMarker || cluster.markers[0];
    const anchorPt = m.latLngToLayerPoint(L.latLng(anchor._worldHome[0], anchor._worldHome[1]));
    const maxR = Math.max(...cluster.markers.map(l => l._worldRadius || 10));
    const spiderR = Math.max(maxR * 2.4, 32);
    const n = siblings.length;
    siblings.forEach((l, i) => {
      // Distribute siblings starting at 12 o'clock, clockwise.
      const angle = (-Math.PI / 2) + (i * 2 * Math.PI / n);
      const ll = m.layerPointToLatLng(L.point(
        anchorPt.x + spiderR * Math.cos(angle),
        anchorPt.y + spiderR * Math.sin(angle)
      ));
      l.setLatLng(ll);
      l._spiderPos = ll;
    });
    // The seed keeps _spiderPos = its home so a later re-spread lands it
    // back where the cursor already is.
    if (seedMarker) seedMarker._spiderPos = L.latLng(seedMarker._worldHome[0], seedMarker._worldHome[1]);
    cluster.expanded = true;
    cluster.anchor = anchor;
  }

  function _collapseSpiderCluster(cluster) {
    if (!cluster) return;
    cluster.markers.forEach(l => {
      if (l._worldHome) l.setLatLng(l._worldHome);
      l._spiderPos = null;
    });
    cluster.expanded = false;
  }

  function _spiderCollapseOthers(hovered) {
    // While a cluster is fanned, hovering one marker pulls the SIBLINGS
    // back to their home positions (so the popup for the hovered marker
    // is unambiguous). The hovered marker stays at its spider position.
    const c = hovered._spiderCluster;
    if (!c || !c.expanded) return;
    c.markers.forEach(other => {
      if (other === hovered) return;
      if (other._worldHome) other.setLatLng(other._worldHome);
    });
  }

  function _scheduleClusterCollapse(fromMarker) {
    // Give the mouse ~180ms to land on a sibling (or come back). If it
    // does, the sibling's mouseover clears this timer. If it doesn't,
    // collapse the whole cluster back to overlapped home positions.
    const c = fromMarker._spiderCluster;
    if (!c) return;
    if (fromMarker._collapseTimer) clearTimeout(fromMarker._collapseTimer);
    // Also clear any collapse timer on siblings so we don't have two
    // competing timers racing.
    c.markers.forEach(s => { if (s._collapseTimer) { clearTimeout(s._collapseTimer); s._collapseTimer = null; } });
    fromMarker._collapseTimer = setTimeout(() => {
      // If a sibling ended up hovered in the meantime, the cluster was
      // re-focused — leave it expanded. Detect by checking whether ANY
      // sibling has been moved back to spider position within the last
      // interaction. Simpler heuristic: collapse unconditionally; a
      // pending re-hover will fire mouseover and re-expand.
      _collapseSpiderCluster(c);
    }, 180);
  }

  // -------- Fullscreen dropdown UI helpers --------
  // Rebuild the statistical region dropdown label + selection markers to reflect
  // the current filter state. Called on every filter change and on reset.
  function refreshConfDropdownUi() {
    const wrap = document.querySelector('[data-db-map-fs-conf]');
    if (!wrap) return;
    const label = wrap.querySelector('[data-db-map-fs-conf-label]');
    const conf = state.worldConfFilter;
    const prov = state.worldProvFilter;
    if (prov && conf) label.textContent = `${conf} › ${prov}`;
    else if (conf)    label.textContent = `${conf} Statistical Region`;
    else              label.textContent = 'All statistical regions';
    wrap.classList.toggle('is-filtered', !!(conf || prov));
    // Update per-row selection marks in the currently rendered lists.
    wrap.querySelectorAll('[data-conf-row]').forEach(r => {
      r.classList.toggle('is-selected', r.getAttribute('data-conf-row') === (conf || ''));
    });
    wrap.querySelectorAll('[data-prov-row]').forEach(r => {
      r.classList.toggle('is-selected', r.getAttribute('data-prov-row') === (prov || ''));
    });
  }

  function refreshSectorDropdownUi() {
    const wrap = document.querySelector('[data-db-map-fs-sector]');
    if (!wrap) return;
    const label = wrap.querySelector('[data-db-map-fs-sector-label]');
    const s = state.worldSectorFilter;
    label.textContent = s || 'All sectors';
    wrap.classList.toggle('is-filtered', !!s);
    wrap.querySelectorAll('[data-sector-row]').forEach(r => {
      r.classList.toggle('is-selected', r.getAttribute('data-sector-row') === (s || ''));
    });
  }

  function refreshWorkDropdownUi() {
    const wrap = document.querySelector('[data-db-map-fs-work]');
    if (!wrap) return;
    const label = wrap.querySelector('[data-db-map-fs-work-label]');
    const c = state.worldWorkCountry;
    const inst = state.worldWorkInst;
    if (inst && c) label.textContent = `${c} › ${inst}`;
    else if (c)    label.textContent = c;
    else           label.textContent = 'All institutions of work';
    // is-filtered marks the pill as “active” whenever the map is in
    // Workplace mode too — not only when a country/institution row was
    // picked. That way the pill visually reflects that clicking the label
    // switched the map view.
    wrap.classList.toggle('is-filtered', !!(c || inst) || state.worldMode === 'work');
    wrap.classList.toggle('is-work-mode', state.worldMode === 'work');
    wrap.querySelectorAll('[data-work-country-row]').forEach(r => {
      r.classList.toggle('is-selected', r.getAttribute('data-work-country-row') === (c || ''));
    });
    wrap.querySelectorAll('[data-work-inst-row]').forEach(r => {
      r.classList.toggle('is-selected', r.getAttribute('data-work-inst-row') === (inst || ''));
    });
  }

  // Compute scholar counts per statistical region and per district across the
  // *unfiltered* worldPoints. These populate the (N) badges next to each
  // row in the statistical region panel. Recomputed on wire so future data
  // updates flow through without rebuilding the dashboard.
  function computeConfederacyScholarCounts() {
    const perConf = { 'Rest of Upolu': new Set(), 'Apia Urban Area': new Set(), 'North West Upolu': new Set(), Unclassified: new Set() };
    const perProv = new Map(); // district -> Set of scholar names
    const grad = state.graduateStudies || { worldPoints: [] };
    (grad.worldPoints || []).forEach(p => {
      const names = [].concat(p.phdScholars || [], p.mastersScholars || [], p.unknownScholars || []);
      names.forEach(n => {
        const { district, region } = scholarConfProv(n);
        const cf = region || 'Unclassified';
        if (perConf[cf]) perConf[cf].add(n); else perConf.Unclassified.add(n);
        if (district) {
          if (!perProv.has(district)) perProv.set(district, new Set());
          perProv.get(district).add(n);
        }
      });
    });
    const confCounts = {};
    Object.keys(perConf).forEach(k => { confCounts[k] = perConf[k].size; });
    const provCounts = {};
    perProv.forEach((set, prov) => { provCounts[prov] = set.size; });
    return { confCounts, provCounts };
  }

  // Compute (country -> Set of institutions -> Set of scholars) for the
  // Institutions-of-work dropdown. Sources directly from the curated
  // scholar profiles so scholars who don't appear in the graduate-studies
  // worldPoints (e.g. Jioji Ravulo at University of Sydney) still show up.
  function computeWorkTree() {
    const countries = new Map(); // country -> Map<institution, Set<slug>>
    const profiles = state.scholarProfilesByName || new Map();
    const seen = new Set();
    profiles.forEach((profile) => {
      const key = profile.slug || `${profile.last || ''}|${profile.first || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const c = (profile.institutionCountry || '').trim();
      const inst = (profile.institution || '').trim();
      if (!c || !inst) return;
      if (!countries.has(c)) countries.set(c, new Map());
      const insts = countries.get(c);
      if (!insts.has(inst)) insts.set(inst, new Set());
      insts.get(inst).add(key);
    });
    return countries;
  }

  function computeSectorCounts() {
    const counts = new Map();
    const grad = state.graduateStudies || { worldPoints: [] };
    const seen = new Set();
    (grad.worldPoints || []).forEach(p => {
      const names = [].concat(p.phdScholars || [], p.mastersScholars || [], p.unknownScholars || []);
      names.forEach(n => {
        if (seen.has(n)) return;
        seen.add(n);
        const profile = findProfileForScholarName(n);
        const s = (profile && profile.sector || '').trim();
        if (!s) return;
        counts.set(s, (counts.get(s) || 0) + 1);
      });
    });
    return counts;
  }

  // -------- Wire the four fullscreen dropdowns to the DOM. --------
  // Idempotent — second call is a no-op via a wired flag. Called after the
  // graduate-studies data + scholar profiles finish loading, so counts are
  // populated on first paint.
  function wireWorldMapFilters() {
    const toolbar = document.querySelector('[data-db-map-fs-toolbar]');
    if (!toolbar || toolbar.dataset.dbFsWired === '1') return;
    toolbar.dataset.dbFsWired = '1';

    // Generic dropdown open/close helper. `wrap` is the outer container,
    // `btn` its trigger, `panel` the absolutely-positioned menu. Only one
    // fullscreen dropdown is open at a time — opening one closes the rest.
    const dropdowns = [];
    function wireDropdown(wrap, btn, panel) {
      if (!wrap || !btn || !panel) return null;
      const api = {
        open() {
          dropdowns.forEach(d => { if (d !== api) d.close(); });
          panel.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          document.addEventListener('mousedown', outside, true);
          document.addEventListener('keydown', esc);
        },
        close() {
          panel.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          document.removeEventListener('mousedown', outside, true);
          document.removeEventListener('keydown', esc);
        }
      };
      function outside(ev) {
        if (!wrap.contains(ev.target)) api.close();
      }
      function esc(ev) { if (ev.key === 'Escape') api.close(); }
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (panel.hidden) api.open(); else api.close();
      });
      dropdowns.push(api);
      return api;
    }

    // --- Statistical Region dropdown ---
    const confWrap  = document.querySelector('[data-db-map-fs-conf]');
    const confBtn   = document.querySelector('[data-db-map-fs-conf-btn]');
    const confPanel = document.querySelector('[data-db-map-fs-conf-panel]');
    const confList  = document.querySelector('[data-db-map-fs-conf-list]');
    const provList  = document.querySelector('[data-db-map-fs-conf-prov-list]');
    const provTitle = document.querySelector('[data-db-map-fs-conf-prov-title]');
    const confDd = wireDropdown(confWrap, confBtn, confPanel);

    function renderConfList() {
      if (!confList) return;
      const { confCounts } = computeConfederacyScholarCounts();
      const rows = [];
      // "All statistical regions" reset row at top.
      rows.push({ key: '', label: 'All statistical regions', count: null, hasChildren: false });
      ['Rest of Upolu', 'Apia Urban Area', 'North West Upolu'].forEach(cf => {
        rows.push({ key: cf, label: cf, count: confCounts[cf] || 0, hasChildren: true });
      });
      const unc = confCounts['Unclassified'] || 0;
      if (unc > 0) rows.push({ key: 'Unclassified', label: 'Unclassified', count: unc, hasChildren: false });
      confList.innerHTML = rows.map(r => `
        <button type="button" class="db-map-fs-conf__row" data-conf-row="${r.key}">
          <span>${r.label}</span>
          <span>
            ${r.count === null ? '' : `<span class="db-map-fs-conf__row-count">${r.count}</span>`}
            ${r.hasChildren ? '<span class="db-map-fs-conf__row-caret">›</span>' : ''}
          </span>
        </button>
      `).join('');
      confList.querySelectorAll('[data-conf-row]').forEach(row => {
        const key = row.getAttribute('data-conf-row');
        row.addEventListener('mouseenter', () => renderProvList(key));
        row.addEventListener('click', () => {
          state.worldConfFilter = key || null;
          state.worldProvFilter = null;
          renderProvList(key);
          renderWorldMap();
          refreshConfDropdownUi();
          if (!key) confDd && confDd.close();
        });
      });
      // Initial district column: reflect current selection.
      renderProvList(state.worldConfFilter || 'Rest of Upolu');
    }

    function renderProvList(confKey) {
      if (!provList || !provTitle) return;
      if (!confKey || confKey === 'Unclassified') {
        provTitle.textContent = confKey === 'Unclassified' ? 'Unclassified' : 'Districts';
        provList.innerHTML = confKey === 'Unclassified'
          ? '<div style="padding:10px 12px;color:#71717a;font-size:0.9rem;">No district data available.</div>'
          : '<div style="padding:10px 12px;color:#71717a;font-size:0.9rem;">Hover a statistical region to see its districts.</div>';
        return;
      }
      provTitle.textContent = `Districts in ${confKey}`;
      const districts = CONFEDERACY_PROVINCES[confKey] || [];
      const { provCounts } = computeConfederacyScholarCounts();
      const rows = districts.map(prov => ({ prov, count: provCounts[prov] || 0 }));
      provList.innerHTML = rows.map(r => `
        <button type="button" class="db-map-fs-conf__row" data-prov-row="${r.prov}">
          <span>${r.prov}</span>
          <span class="db-map-fs-conf__row-count">${r.count}</span>
        </button>
      `).join('');
      provList.querySelectorAll('[data-prov-row]').forEach(row => {
        const prov = row.getAttribute('data-prov-row');
        row.addEventListener('click', () => {
          state.worldConfFilter = confKey;
          state.worldProvFilter = prov;
          renderWorldMap();
          refreshConfDropdownUi();
          confDd && confDd.close();
        });
      });
      // Re-apply selection classes.
      refreshConfDropdownUi();
    }

    // --- Sector dropdown (single column) ---
    const secWrap  = document.querySelector('[data-db-map-fs-sector]');
    const secBtn   = document.querySelector('[data-db-map-fs-sector-btn]');
    const secPanel = document.querySelector('[data-db-map-fs-sector-panel]');
    const secList  = document.querySelector('[data-db-map-fs-sector-list]');
    const secDd = wireDropdown(secWrap, secBtn, secPanel);

    function renderSectorList() {
      if (!secList) return;
      const counts = computeSectorCounts();
      // Sort by count desc so most-common sectors sit at the top.
      const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      const rows = [{ key: '', label: 'All sectors', count: null }].concat(
        entries.map(([k, v]) => ({ key: k, label: k, count: v }))
      );
      secList.innerHTML = rows.map(r => `
        <button type="button" class="db-map-fs-conf__row" data-sector-row="${(r.key || '').replace(/"/g,'&quot;')}">
          <span>${r.label}</span>
          ${r.count === null ? '' : `<span class="db-map-fs-conf__row-count">${r.count}</span>`}
        </button>
      `).join('');
      secList.querySelectorAll('[data-sector-row]').forEach(row => {
        row.addEventListener('click', () => {
          const key = row.getAttribute('data-sector-row');
          state.worldSectorFilter = key || null;
          renderWorldMap();
          refreshSectorDropdownUi();
          secDd && secDd.close();
        });
      });
    }

    // --- Institutions-of-work dropdown (two columns: country → institution) ---
    const workWrap    = document.querySelector('[data-db-map-fs-work]');
    const workBtn     = document.querySelector('[data-db-map-fs-work-btn]');
    const workPanel   = document.querySelector('[data-db-map-fs-work-panel]');
    const workCList   = document.querySelector('[data-db-map-fs-work-country-list]');
    const workIList   = document.querySelector('[data-db-map-fs-work-inst-list]');
    const workITitle  = document.querySelector('[data-db-map-fs-work-inst-title]');
    const workDd = wireDropdown(workWrap, workBtn, workPanel);
    // Clicking the work-dropdown button flips the map into Workplace mode
    // instantly. Any other dropdown (or the Reset button) flips it back to
    // Study mode. Cross-filters (statistical region / sector) stay applied
    // across the flip so the user's selection carries over.
    if (workBtn) {
      workBtn.addEventListener('click', () => {
        if (state.worldMode !== 'work') {
          state.worldMode = 'work';
          // Drop the study-view work-filters when entering workplace mode —
          // in workplace mode each institution IS a marker, so those
          // filters would just hide the whole map.
          state.worldWorkCountry = null;
          state.worldWorkInst = null;
          try { renderWorldMap(); } catch (_) {}
          try { refreshWorkDropdownUi(); } catch (_) {}
        }
      });
    }

    function renderWorkCountryList() {
      if (!workCList) return;
      const tree = computeWorkTree();
      const entries = Array.from(tree.entries()).map(([c, insts]) => {
        // scholar count per country = union of scholar Sets across institutions
        const scholars = new Set();
        insts.forEach(set => set.forEach(n => scholars.add(n)));
        return { country: c, count: scholars.size };
      }).sort((a, b) => b.count - a.count);
      const rows = [{ country: '', count: null }].concat(entries);
      workCList.innerHTML = rows.map(r => `
        <button type="button" class="db-map-fs-conf__row" data-work-country-row="${(r.country || '').replace(/"/g,'&quot;')}">
          <span>${r.country || 'All countries of work'}</span>
          <span>
            ${r.count === null ? '' : `<span class="db-map-fs-conf__row-count">${r.count}</span>`}
            ${r.country ? '<span class="db-map-fs-conf__row-caret">›</span>' : ''}
          </span>
        </button>
      `).join('');
      workCList.querySelectorAll('[data-work-country-row]').forEach(row => {
        const c = row.getAttribute('data-work-country-row');
        row.addEventListener('mouseenter', () => renderWorkInstList(c));
        row.addEventListener('click', () => {
          state.worldWorkCountry = c || null;
          state.worldWorkInst = null;
          renderWorkInstList(c);
          // Row picks keep the map in Workplace mode; picking a country
          // zooms/filters within workplace view.
          if (c) _zoomWorkplaceCountry(c);
          else if (state.worldMap) {
            // In fullscreen, reset to Pacific-centred zoom-2 view (setView
            // inside renderWorkplaceMap does this too, but doing it here
            // first avoids a brief zoom-out flicker to DEFAULT_ZOOM=1).
            if (state.worldMapFullscreen) {
              state.worldMap.setView([10, 80], 3, { animate: false });
            } else {
              state.worldMap.setView(WORLD_MAP_DEFAULT_CENTER, WORLD_MAP_DEFAULT_ZOOM);
            }
          }
          renderWorldMap();
          refreshWorkDropdownUi();
          if (!c) workDd && workDd.close();
        });
      });
      // Populate the right column with a hint on first render.
      renderWorkInstList(state.worldWorkCountry || '');
    }

    function renderWorkInstList(country) {
      if (!workIList || !workITitle) return;
      if (!country) {
        workITitle.textContent = 'Institutions';
        workIList.innerHTML = '<div style="padding:10px 12px;color:#71717a;font-size:0.9rem;">Hover a country to see its institutions.</div>';
        return;
      }
      workITitle.textContent = `Institutions in ${country}`;
      const tree = computeWorkTree();
      const insts = tree.get(country) || new Map();
      const entries = Array.from(insts.entries()).map(([inst, set]) => ({ inst, count: set.size }))
        .sort((a, b) => b.count - a.count);
      workIList.innerHTML = entries.map(r => `
        <button type="button" class="db-map-fs-conf__row" data-work-inst-row="${r.inst.replace(/"/g,'&quot;')}">
          <span>${r.inst}</span>
          <span class="db-map-fs-conf__row-count">${r.count}</span>
        </button>
      `).join('');
      workIList.querySelectorAll('[data-work-inst-row]').forEach(row => {
        row.addEventListener('click', () => {
          state.worldWorkCountry = country;
          state.worldWorkInst = row.getAttribute('data-work-inst-row');
          _zoomWorkplaceInstitution(country, state.worldWorkInst);
          renderWorldMap();
          refreshWorkDropdownUi();
          workDd && workDd.close();
        });
      });
      refreshWorkDropdownUi();
    }

    // --- Region › Country › University drilldown ---
    // Progressive drilldown modeled on the statistical regions dropdown but three
    // columns wide. Regions come from the WORLD_REGIONS constant; countries
    // and universities are pulled from graduate-studies.worldPoints so a
    // region with 0 present countries silently drops out.
    const regionWrap    = document.querySelector('[data-db-map-fs-region]');
    const regionBtn     = document.querySelector('[data-db-map-fs-region-btn]');
    const regionPanel   = document.querySelector('[data-db-map-fs-region-panel]');
    const regionList    = document.querySelector('[data-db-map-fs-region-list]');
    const regionCList   = document.querySelector('[data-db-map-fs-region-country-list]');
    const regionCTitle  = document.querySelector('[data-db-map-fs-region-country-title]');
    const regionUList   = document.querySelector('[data-db-map-fs-region-uni-list]');
    const regionUTitle  = document.querySelector('[data-db-map-fs-region-uni-title]');
    const regionLabel   = document.querySelector('[data-db-map-fs-region-label]');
    const regionDd = (regionWrap && regionBtn && regionPanel) ? wireDropdown(regionWrap, regionBtn, regionPanel) : null;

    // Which region row the mouse is currently over. Determines what shows
    // in the middle (country) column. Country hover in turn drives the
    // right (university) column.
    let hoveredRegion = null;
    let hoveredCountry = null;

    // Compute per-region country counts and per-country uni counts from the
    // live worldPoints so the (N) badges always reflect what's on the map.
    //
    // Region assignment comes from worldPoints[].region (emitted by
    // data/refresh-graduate-studies.py). That file's COUNTRY_REGION table
    // is the single source of truth — the hardcoded WORLD_REGIONS below is
    // only a fallback for older graduate-studies files that predate the
    // region field, and to guarantee an ordering for the dropdown when
    // multiple regions are present. A country whose region is unknown
    // sinks into 'Other' rather than disappearing from the dropdown.
    function computeRegionCounts() {
      const grad = state.graduateStudies || { worldPoints: [] };
      const points = grad.worldPoints || [];
      const countriesPresent = new Set(points.map(p => p.country).filter(Boolean));
      const unisByCountry = new Map();
      // Build country -> region map from the data file first; fall back to
      // the hardcoded WORLD_REGIONS table if the data file didn't emit a
      // region for this country (older snapshots, or a brand-new country
      // the refresh script hasn't been taught about yet).
      const regionOfCountry = new Map();
      const fallbackRegionOf = new Map();
      Object.keys(WORLD_REGIONS).forEach(region => {
        WORLD_REGIONS[region].forEach(c => fallbackRegionOf.set(c, region));
      });
      points.forEach(p => {
        if (!p.country) return;
        if (p.university) {
          if (!unisByCountry.has(p.country)) unisByCountry.set(p.country, new Set());
          unisByCountry.get(p.country).add(p.university);
        }
        if (regionOfCountry.has(p.country)) return;
        const region = p.region || fallbackRegionOf.get(p.country) || 'Other';
        regionOfCountry.set(p.country, region);
      });
      // Group countries by resolved region, preserving the display order
      // from WORLD_REGIONS (Pacific, Asia, Europe, North America) and
      // trailing 'Other' at the end so unclassified additions stay visible.
      const byRegion = new Map();
      countriesPresent.forEach(c => {
        const r = regionOfCountry.get(c) || 'Other';
        if (!byRegion.has(r)) byRegion.set(r, new Set());
        byRegion.get(r).add(c);
      });
      const knownOrder = Object.keys(WORLD_REGIONS);
      const extraRegions = Array.from(byRegion.keys())
        .filter(r => !knownOrder.includes(r) && r !== 'Other')
        .sort();
      const orderedRegions = [
        ...knownOrder.filter(r => byRegion.has(r)),
        ...extraRegions,
        ...(byRegion.has('Other') ? ['Other'] : [])
      ];
      const regionRows = [];
      orderedRegions.forEach(region => {
        const set = byRegion.get(region);
        if (!set || !set.size) return;
        const countries = Array.from(set).sort();
        regionRows.push({ region, countries });
      });
      return { regionRows, unisByCountry };
    }

    function refreshRegionLabel() {
      if (!regionLabel) return;
      const scope = state.worldSearchScope || {};
      if (scope.university) {
        regionLabel.textContent = scope.university;
        regionWrap.classList.add('is-filtered');
      } else if (scope.country) {
        regionLabel.textContent = scope.country;
        regionWrap.classList.add('is-filtered');
      } else if (scope.region) {
        regionLabel.textContent = scope.region;
        regionWrap.classList.add('is-filtered');
      } else {
        regionLabel.textContent = 'All regions';
        regionWrap.classList.remove('is-filtered');
      }
    }

    function renderRegionList() {
      if (!regionList) return;
      const { regionRows } = computeRegionCounts();
      const rows = [{ key: '', label: 'All regions', count: null, hasChildren: false }]
        .concat(regionRows.map(r => ({ key: r.region, label: r.region, count: r.countries.length, hasChildren: true })));
      regionList.innerHTML = rows.map(r => `
        <button type="button" class="db-map-fs-conf__row" data-region-row="${escapeAttr(r.key)}">
          <span>${escapeHtml(r.label)}</span>
          <span>
            ${r.count === null ? '' : `<span class="db-map-fs-conf__row-count">(${r.count})</span>`}
            ${r.hasChildren ? '<span class="db-map-fs-conf__row-caret">\u203A</span>' : ''}
          </span>
        </button>
      `).join('');
      regionList.querySelectorAll('[data-region-row]').forEach(row => {
        const key = row.getAttribute('data-region-row');
        row.addEventListener('mouseenter', () => {
          hoveredRegion = key || null;
          hoveredCountry = null;
          renderRegionCountryList(key);
          renderRegionUniList(null);
          refreshRegionSelectionUi();
        });
        row.addEventListener('click', () => {
          if (!key) {
            // "All regions" resets scope entirely.
            state.worldSearchScope = null;
            refreshRegionLabel();
            refreshRegionSelectionUi();
            zoomToDefaultWorldView();
            regionDd && regionDd.close();
            return;
          }
          const rowData = regionRows.find(r => r.region === key);
          if (!rowData) return;
          state.worldSearchScope = { region: key, regionCountries: rowData.countries.slice() };
          refreshRegionLabel();
          refreshRegionSelectionUi();
          zoomToRegion(rowData.countries);
          regionDd && regionDd.close();
        });
      });
      // Default the middle column to the first available region on open.
      if (!hoveredRegion && regionRows.length) {
        hoveredRegion = regionRows[0].region;
      }
      renderRegionCountryList(hoveredRegion);
      renderRegionUniList(hoveredCountry);
    }

    function renderRegionCountryList(regionKey) {
      if (!regionCList) return;
      if (!regionKey) {
        regionCTitle.textContent = 'Country';
        regionCList.innerHTML = '<div style="padding:10px 12px;color:#52525b;font-size:0.9rem;">Hover a region to see its countries.</div>';
        return;
      }
      const { regionRows, unisByCountry } = computeRegionCounts();
      const rowData = regionRows.find(r => r.region === regionKey);
      const countries = rowData ? rowData.countries : [];
      regionCTitle.textContent = `Countries in ${regionKey}`;
      regionCList.innerHTML = countries.map(c => {
        const uniCount = (unisByCountry.get(c) || new Set()).size;
        return `
          <button type="button" class="db-map-fs-conf__row" data-region-country-row="${escapeAttr(c)}">
            <span>${escapeHtml(c)}</span>
            <span>
              <span class="db-map-fs-conf__row-count">(${uniCount})</span>
              <span class="db-map-fs-conf__row-caret">\u203A</span>
            </span>
          </button>
        `;
      }).join('');
      regionCList.querySelectorAll('[data-region-country-row]').forEach(row => {
        const country = row.getAttribute('data-region-country-row');
        row.addEventListener('mouseenter', () => {
          hoveredCountry = country;
          renderRegionUniList(country);
          refreshRegionSelectionUi();
        });
        row.addEventListener('click', () => {
          state.worldSearchScope = { country };
          refreshRegionLabel();
          refreshRegionSelectionUi();
          zoomToWorldCountry(country);
          regionDd && regionDd.close();
        });
      });
    }

    function renderRegionUniList(countryName) {
      if (!regionUList) return;
      if (!countryName) {
        regionUTitle.textContent = 'University';
        regionUList.innerHTML = '<div style="padding:10px 12px;color:#52525b;font-size:0.9rem;">Hover a country to see its universities.</div>';
        return;
      }
      const grad = state.graduateStudies || { worldPoints: [] };
      const unis = (grad.worldPoints || [])
        .filter(p => p.country === countryName)
        .map(p => ({ name: p.university, total: p.scholarsCount || 0 }))
        .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
      regionUTitle.textContent = `Universities in ${countryName}`;
      if (!unis.length) {
        regionUList.innerHTML = '<div style="padding:10px 12px;color:#52525b;font-size:0.9rem;">No university data available.</div>';
        return;
      }
      regionUList.innerHTML = unis.map(u => `
        <button type="button" class="db-map-fs-conf__row" data-region-uni-row="${escapeAttr(u.name)}">
          <span>${escapeHtml(u.name)}</span>
          <span class="db-map-fs-conf__row-count">${u.total}</span>
        </button>
      `).join('');
      regionUList.querySelectorAll('[data-region-uni-row]').forEach(row => {
        const uniName = row.getAttribute('data-region-uni-row');
        row.addEventListener('click', () => {
          state.worldSearchScope = { university: uniName };
          refreshRegionLabel();
          refreshRegionSelectionUi();
          zoomToWorldUniversity(uniName);
          regionDd && regionDd.close();
        });
      });
    }

    // Visual selected/highlighted styling across all three columns.
    function refreshRegionSelectionUi() {
      const scope = state.worldSearchScope || {};
      if (regionList) {
        regionList.querySelectorAll('[data-region-row]').forEach(el => {
          const key = el.getAttribute('data-region-row');
          el.classList.toggle('is-highlighted', key && key === hoveredRegion);
          el.classList.toggle('is-selected', key && key === scope.region);
        });
      }
      if (regionCList) {
        regionCList.querySelectorAll('[data-region-country-row]').forEach(el => {
          const c = el.getAttribute('data-region-country-row');
          el.classList.toggle('is-highlighted', c === hoveredCountry);
          el.classList.toggle('is-selected', c === scope.country);
        });
      }
      if (regionUList) {
        regionUList.querySelectorAll('[data-region-uni-row]').forEach(el => {
          const u = el.getAttribute('data-region-uni-row');
          el.classList.toggle('is-selected', u === scope.university);
        });
      }
    }

    // Zoom the fullscreen map so the passed countries all fit in view.
    // Falls back to the default world view when no points match.
    function zoomToRegion(countries) {
      const m = state.worldMap;
      if (!m) return;
      const grad = state.graduateStudies || { worldPoints: [] };
      const set = new Set(countries);
      const pts = (grad.worldPoints || []).filter(p => set.has(p.country));
      if (!pts.length) return;
      // Antimeridian fix: see _normLngForWorldMap. Framing raw longitudes
      // for Americas would zoom to the empty left-hand US copy.
      const bounds = L.latLngBounds(pts.map(p => [p.lat, _normLngForWorldMap(p.lng)]));
      m.fitBounds(bounds, { padding: [80, 80], maxZoom: 5, animate: true });
    }

    // Reset the fullscreen map to its default whole-world framing.
    function zoomToDefaultWorldView() {
      const m = state.worldMap;
      if (!m) return;
      m.setView([10, 80], 3, { animate: true });
    }

    // Expose the region-label refresher so the Reset button (which nukes
    // worldSearchScope) can pull the pill back to "All regions".
    if (regionWrap) {
      regionWrap._refreshLabel = refreshRegionLabel;
      regionWrap._refreshSelectionUi = refreshRegionSelectionUi;
    }

    // Populate all four list-based dropdowns.
    renderConfList();
    renderSectorList();
    renderWorkCountryList();
    renderRegionList();
    refreshConfDropdownUi();
    refreshSectorDropdownUi();
    refreshWorkDropdownUi();
    refreshRegionLabel();
    refreshRegionSelectionUi();
  }

  function renderChoropleth() {
    if (!state.map) return;
    if (state.provinceLayer) state.map.removeLayer(state.provinceLayer);
    const geo = state.districts;
    const filteredItems = itemsForMapView();
    const counts = districtBreakdown(filteredItems);
    state.provinceLayer = L.geoJSON(geo, {
      style: (feature) => {
        const n = (counts.get(feature.properties.name) || { total: 0 }).total;
        return {
          fillColor: choroFill(n),
          fillOpacity: 0.92,
          color: CONF_COLORS[feature.properties.region] || '#333',
          weight: 2.5, opacity: 1, lineJoin: 'round'
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const b = counts.get(p.name) || { total: 0 };
        // Bind popup so click still works, and also open the popup on hover for
        // a live preview (Ron wants hover-to-preview, click-to-filter).
        layer.bindPopup(makeProvincePopup(p, b), { maxWidth: 260, autoPan: false });
        layer.on('mouseover', () => {
          layer.setStyle({ weight: 4 });
          // Delay opening slightly to avoid flicker when panning over polygons
          layer.openPopup();
        });
        layer.on('mouseout', () => {
          layer.setStyle({ weight: 2.5 });
          // Only close the hover-preview popup; leave click-opened ones alone.
          if (!state.stickyPopup || state.stickyPopup !== p.name) layer.closePopup();
        });
        layer.on('click', () => {
          state.stickyPopup = p.name;
          setProvinceFilterFromMap(p.name);
        });
      }
    }).addTo(state.map);
  }

  function setProvinceFilterFromMap(name) {
    // Toggle behaviour used by polygon clicks
    state.filter.district = state.filter.district === name ? '' : name;
    state.filter.paternal = '';
    state.shown = state.pageSize;
    afterFilterChange();
  }

  function filterAndScrollToProvince(name) {
    // Always SETS (does not toggle) — used by the popup pill
    state.filter.district = name;
    state.filter.paternal = '';
    state.shown = state.pageSize;
    afterFilterChange();
    const target = document.querySelector('.db-items');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Delegated click handler for the "Filter items below" pill inside Leaflet popups.
  // We register this once, globally, because Leaflet destroys and rebuilds popup
  // DOM every time a popup opens, so listeners bound at popup-render time would leak.
  document.addEventListener('click', ev => {
    const link = ev.target && ev.target.closest && ev.target.closest('.db-popup-filter-link');
    if (!link) return;
    ev.preventDefault();
    ev.stopPropagation();
    const name = link.getAttribute('data-district');
    if (!name) return;
    if (state.map) state.map.closePopup();
    filterAndScrollToProvince(name);
  });

  function makeProvincePopup(p, b) {
    const viewLabel = state.mapView === 'lead'
      ? 'Samoan lead-authored'
      : (state.mapView === 'coauth' ? 'Co-authored with Samoan' : 'All publications on');
    const rows = [];
    const push = (n, lbl) => { if (n > 0) rows.push(`<tr><td style="padding:2px 8px 2px 0;font-variant-numeric:tabular-nums;font-weight:700;color:${CONF_COLORS[p.region]}">${n}</td><td style="padding:2px 0;color:#4b5563;">${lbl}</td></tr>`); };
    push(b.journalArticle,  b.journalArticle === 1 ? 'Journal Article' : 'Journal Articles');
    push(b.thesisPhd,       b.thesisPhd === 1 ? 'PhD Thesis' : 'PhD Theses');
    push(b.thesisMasters,   b.thesisMasters === 1 ? 'Masters Thesis' : 'Masters Theses');
    push(b.bookSection,     b.bookSection === 1 ? 'Book Chapter' : 'Book Chapters');
    push(b.book,            b.book === 1 ? 'Book' : 'Books');
    push(b.conferencePaper, b.conferencePaper === 1 ? 'Conference Paper' : 'Conference Papers');
    push(b.report,          b.report === 1 ? 'Report' : 'Reports');
    // Preprints intentionally not rendered here — preprints are globally
    // excluded from every V2 display (2026-08-24 Ron directive). The count
    // is also always zero because state.snapshot.items is preprint-filtered
    // at load time; this omission is belt-and-suspenders.
    const rowsHtml = rows.length ? `<table style="border-collapse:collapse;margin-top:6px;">${rows.join('')}</table>` : '<p class="db-popup-meta" style="opacity:0.6;">No items in this view</p>';
    const scholarLine = b.scholars > 0
      ? `<p class="db-popup-meta" style="margin-top:8px;padding-top:6px;border-top:1px dashed #cbd5e1;"><span style="font-weight:700;color:${CONF_COLORS[p.region]};font-variant-numeric:tabular-nums;">${b.scholars}</span> Samoan scholar${b.scholars === 1 ? '' : 's'} on this map</p>`
      : '';
    // The filter link needs data-district so a delegated click handler can
    // pick it up — Leaflet re-renders popups on every open, so inline
    // onclick / direct listeners on this node don't survive.
    return `
      <div class="db-popup-title">${p.name} District</div>
      <p class="db-popup-meta">${p.region} Statistical Region &middot; ${p.mainArea}</p>
      <p class="db-popup-meta" style="margin-top:6px;"><span class="db-popup-count" style="font-size:1.5rem;">${b.total}</span> ${viewLabel} ${p.name}</p>
      ${rowsHtml}
      ${scholarLine}
      <p style="margin:8px 0 0;"><a href="#" class="db-popup-filter-link" data-district="${p.name}" style="display:inline-block;font-size:0.82rem;color:#fff;background:#0e7490;padding:5px 10px;border-radius:999px;text-decoration:none;font-weight:600;">Filter items below ↓</a></p>
    `;
  }

  // ============ PANEL A — map + legend + statistical region tallies + sync ============
  function renderPanelA() {
    renderChoropleth();

    const items = state.snapshot.items;
    const provOfItem = state.provincesByItem;

    // Statistical Region tallies. For each statistical region we track three counts:
    //   total    — all Samoa-focused publications (district-tagged), regardless of authorship
    //   samoan  — strictly Samoan-lead-authored items (first creator is Samoan)
    //   coauth   — Samoan co-authored items (any Samoan author present, not first)
    // These feed both the two-line legend rows and the dynamic sidebar narrative.
    const byConf = {
      'Rest of Upolu': { total:0, samoan:0, coauth:0 },
      'Apia Urban Area':     { total:0, samoan:0, coauth:0 },
      'North West Upolu':     { total:0, samoan:0, coauth:0 }
    };
    const confByProv = new Map();
    state.districts.features.forEach(f => confByProv.set(f.properties.name, f.properties.region));
    items.forEach(it => {
      const provs = provOfItem.get(it.key);
      if (!provs || !provs.size) return;
      const role = itaukeiAuthorship(it);
      provs.forEach(p => {
        const c = confByProv.get(p);
        if (!c || !byConf[c]) return;
        byConf[c].total  += 1;
        if (role === 'lead')   byConf[c].samoan += 1;
        if (role === 'coauth') byConf[c].coauth  += 1;
      });
    });

    // Dynamic map legend title — reflects the currently-selected Panel A sub-tab.
    const legendTitles = {
      all:    'All Samoa-focused publications by study district',
      lead:   'Samoan-led publications by study district',
      coauth: 'Publications co-authored with Samoan scholars by study district'
    };
    const legendTitleEl = $('[data-db-map-legend-title]');
    if (legendTitleEl) legendTitleEl.textContent = legendTitles[state.mapView] || legendTitles.all;

    // Dynamic explanation sentence for the statistical region summary.
    const explainSentences = {
      all:    'All Samoa-focused publications, grouped by the statistical region of the district studied.',
      lead:   'Publications led by an Samoan first author, grouped by the statistical region of the district studied.',
      coauth: 'Publications co-authored with Samoan scholars, grouped by the statistical region of the district studied.'
    };
    const explainEl = $('[data-db-conf-explain]');
    if (explainEl) explainEl.textContent = explainSentences[state.mapView] || explainSentences.all;

    // Populate the two-line statistical region rows. The primary number always reflects
    // ALL Samoa-focused publications for that statistical region (so the reader gets a
    // stable point of reference). The secondary line adapts to the active
    // sub-tab so it complements what the map is currently showing.
    Object.keys(byConf).forEach(name => {
      const t = byConf[name].total;
      const k = byConf[name].samoan;
      const co = byConf[name].coauth;
      const totalEl = document.querySelector(`[data-conf-total="${name}"]`);
      const subEl   = document.querySelector(`[data-conf-sub="${name}"]`);
      if (totalEl) totalEl.textContent = t.toLocaleString();
      if (subEl) {
        let secondary;
        if (state.mapView === 'lead') {
          secondary = `${k} Samoan-led · ${co} co-authored`;
        } else if (state.mapView === 'coauth') {
          secondary = `${co} co-authored with Samoan · ${k} Samoan-led`;
        } else {
          secondary = `${k} Samoan-led publication${k === 1 ? '' : 's'}`;
        }
        subEl.textContent = secondary;
      }
    });

    // Dynamic narrative sentence beneath the statistical region rows. Ranks the three
    // statistical regions by total and reports the total Samoan-led count.
    const narrativeEl = $('[data-db-conf-narrative]');
    if (narrativeEl) {
      const ranked = Object.keys(byConf)
        .map(n => ({ name: n, total: byConf[n].total, led: byConf[n].samoan, coauth: byConf[n].coauth }))
        .sort((a, b) => b.total - a.total);
      const totalLed    = ranked.reduce((a, r) => a + r.led, 0);
      const totalCoauth = ranked.reduce((a, r) => a + r.coauth, 0);
      const [a, b, c] = ranked;
      let s = `Samoa-focused publications are most concentrated in ${a.name} (${a.total.toLocaleString()}), followed by ${b.name} (${b.total.toLocaleString()}) and ${c.name} (${c.total.toLocaleString()}). `;
      if (state.mapView === 'coauth') {
        s += `Of these, ${totalCoauth.toLocaleString()} include an Samoan scholar as a co-author.`;
      } else if (state.mapView === 'lead') {
        s += `Of these, ${totalLed.toLocaleString()} are led by an Samoan first author.`;
      } else {
        s += `Of these, ${totalLed.toLocaleString()} are led by an Samoan first author.`;
      }
      narrativeEl.textContent = s;
    }

    // Non-Samoa publications by Samoan authors: Samoan items with NO district tag
    let nonDistrict = 0;
    items.forEach(it => {
      if (!isItaukei(it)) return;
      const p = provOfItem.get(it.key);
      if (!p || !p.size) nonDistrict += 1;
    });
    const nfEl = $('[data-db-nonfiji]');
    if (nfEl) nfEl.textContent = nonDistrict;

    // Sync inline — prefer the heartbeat timestamp so it advances every run
    const inline = $('[data-db-sync-inline]');
    if (inline) {
      const sync = state.lastSync;
      const checked = sync && sync.lastChecked;
      const changed = sync && sync.lastChanged;
      const iso = checked || (state.snapshot && state.snapshot.generatedAt);
      if (iso) {
        const d = new Date(iso);
        const dateStr = d.toLocaleDateString(undefined,{month:'short', day:'numeric', year:'numeric'});
        let text = `${relativeTime(iso)} · ${dateStr}`;
        if (changed && changed !== checked) {
          text += ` · last data change ${relativeTime(changed)}`;
        }
        inline.textContent = text;
        if (sync && sync.summary) inline.title = sync.summary;
      }
    }

    // The map container now flex-grows to match the sidebar's height, so its
    // pixel size may have changed since the last render. Leaflet needs an
    // explicit invalidateSize() call to notice and re-lay-out tiles.
    if (state.map && typeof state.map.invalidateSize === 'function') {
      requestAnimationFrame(() => {
        try { state.map.invalidateSize({ animate: false }); } catch (_) {}
      });
    }
  }

  // ============ PANEL B — ranked bar chart ============
  function renderPanelB() {
    const host = $('[data-db-bars]');
    if (!host) return;

    // Keep the tab pills in sync with state (initial load, back/forward).
    const b1Root = document.querySelector('[data-panel="B1"]');
    if (b1Root) {
      b1Root.querySelectorAll('[data-b1-tab]').forEach(btn => {
        const on = btn.dataset.b1Tab === (state.b1View || 'type');
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
      });
    }

    // ============ Authorship view ============
    // Reuses B2's authorship rendering (single stacked bar per district,
    // segmented by Samoan first / co-author / no Samoan identified).
    // Chrome swap: hide the type-filter checkboxes + disable the Authors
    // dropdown, show the authorship legend + "Grouped by" label change.
    const typeFilter    = document.querySelector('[data-db-type-filter]');
    const authorsSelect = document.querySelector('[data-b1-authors]');
    const authorshipLegend = document.querySelector('[data-b1-authorship-legend]');
    const groupedLabel  = document.querySelector('[data-b1-grouped-label]');

    if ((state.b1View || 'type') === 'authorship') {
      if (typeFilter) typeFilter.style.display = 'none';
      if (authorshipLegend) authorshipLegend.style.display = '';
      if (authorsSelect) authorsSelect.disabled = true;
      if (groupedLabel) groupedLabel.textContent = 'Study district · Samoan authorship role';
      host.innerHTML = '';
      const rows = buildB2Rows_compareAuthorship();
      renderAuthorshipInto(host, rows);
      host.classList.remove('db-bars--grouped');
      return;
    }

    // ============ Default publication-type view ============
    if (typeFilter) typeFilter.style.display = '';
    if (authorshipLegend) authorshipLegend.style.display = 'none';
    if (authorsSelect) authorsSelect.disabled = false;
    if (groupedLabel) groupedLabel.textContent = 'Study district';

    host.innerHTML = '';
    const provs = state.districts.features.map(f => f.properties);
    const byProv = new Map();
    provs.forEach(p => {
      byProv.set(p.name, {
        conf: p.region,
        total: 0,
        types: {}
      });
    });
    // Panel B1 authors filter — defaults to Samoan-only. Toggled via the
    // Authors dropdown in the meta row (see wirePanelB1).
    const authorsMode = state.b1Authors || 'samoan';
    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.typeSet.has(vt)) return;
      if (authorsMode === 'samoan' && !isItaukei(it)) return;
      const ps = state.provincesByItem.get(it.key);
      if (!ps) return;
      ps.forEach(name => {
        const bucket = byProv.get(name);
        if (bucket) {
          bucket.total += 1;
          bucket.types[vt] = (bucket.types[vt] || 0) + 1;
        }
      });
    });
    const rows = provs.map(p => Object.assign({ name: p.name }, byProv.get(p.name)))
                       .sort((a,b) => b.total - a.total);
    const maxTotal = Math.max(1, ...rows.map(r => r.total));
    rows.forEach(r => {
      const label = document.createElement('div');
      label.className = 'db-bars__prov';
      if (state.filter.district === r.name) label.classList.add('is-active');
      label.title = `${r.conf} Statistical Region`;
      label.innerHTML = `<span>${r.name}</span><span class="db-bars__prov-dot" style="background:${CONF_COLORS[r.conf]};"></span>`;
      label.addEventListener('click', () => {
        state.filter.district = state.filter.district === r.name ? '' : r.name;
        state.filter.paternal = '';
        state.shown = state.pageSize;
        afterFilterChange();
      });
      host.appendChild(label);

      const rowWrap = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'db-bars__row';
      row.style.width = `${(r.total / maxTotal) * 100}%`;
      row.style.background = 'transparent';
      row.style.boxShadow = `inset 0 0 0 1.5px rgba(0,0,0,0.06)`;
      row.title = `${r.name} · ${r.total} items · ${r.conf}`;
      TYPE_ORDER.forEach(t => {
        const n = r.types[t] || 0;
        if (n > 0) {
          const seg = document.createElement('span');
          seg.className = 'db-bars__seg';
          seg.style.width = `${(n / r.total) * 100}%`;
          seg.style.background = TYPE_COLOR[t];
          seg.title = `${n} × ${TYPE_LABELS[t]}`;
          row.appendChild(seg);
        }
      });
      row.addEventListener('click', () => {
        state.filter.district = state.filter.district === r.name ? '' : r.name;
        state.filter.paternal = '';
        state.shown = state.pageSize;
        afterFilterChange();
      });
      rowWrap.appendChild(row);
      host.appendChild(rowWrap);

      const num = document.createElement('div');
      num.className = 'db-bars__total';
      num.textContent = r.total;
      host.appendChild(num);
    });

    // ============ Non-provincial/Samoa bottom bar ============
    // Aggregates publications that live in the Zotero '_Non-Provincial/Samoa'
    // sub-collection under C1 (RNKFUZ6M/AREH32KK). These are Samoa-wide topics
    // (e.g. national legislation, national mental health policy, nationwide
    // studies) that aren't tied to a specific district. Membership is now a
    // curator decision, not a title heuristic — the collection is the source
    // of truth.
    //
    // Rendering differs from the district bars in three key ways:
    //   1. Anchored at the bottom regardless of ranking.
    //   2. The bar is always drawn at 100% width of the longest visible district
    //      bar (not scaled to its own raw count).
    //   3. Segments are % share of the category's own total — unchecking a type
    //      re-normalises the remaining segments back to 100%.
    // No statistical region dot on the label; an "i" tooltip explains the category.
    const nonProv = { total: 0, types: {} };
    const nonProvKey = state.nonDistrictBucketKey;
    if (nonProvKey) {
      state.snapshot.items.forEach(it => {
        const vt = visualType(it);
        if (!state.typeSet.has(vt)) return;
        if (authorsMode === 'samoan' && !isItaukei(it)) return;
        const cols = it.collections || [];
        if (cols.indexOf(nonProvKey) === -1) return;
        nonProv.total += 1;
        nonProv.types[vt] = (nonProv.types[vt] || 0) + 1;
      });
    }

    if (nonProv.total > 0) {
      // Column 1 — label + info icon (no statistical region dot).
      const npLabel = document.createElement('div');
      npLabel.className = 'db-bars__prov db-bars__prov--nonprov';
      const tipText = 'Publications about Samoa broadly or national-level topics '
                    + '\u2014 such as legislation, policy, or nationwide studies '
                    + '\u2014 that are not tied to a specific district.';
      npLabel.innerHTML = `<span>Non-provincial/Samoa</span>`
        + `<span class="db-bars__info" tabindex="0" role="button" aria-label="About Non-provincial/Samoa" title="${escapeAttr(tipText)}">i</span>`;
      host.appendChild(npLabel);

      // Column 2 — bar at 100% width, percentage-normalised segments.
      const rowWrap = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'db-bars__row db-bars__row--nonprov';
      row.style.width = '100%';
      row.style.background = 'transparent';
      row.style.boxShadow = `inset 0 0 0 1.5px rgba(0,0,0,0.06)`;
      row.title = `Non-provincial/Samoa \u00b7 ${nonProv.total} items`;
      const segsPendingSizing = [];
      TYPE_ORDER.forEach(t => {
        const n = nonProv.types[t] || 0;
        if (n <= 0) return;
        const share = n / nonProv.total;      // 0..1
        const pct = Math.round(share * 1000) / 10; // one decimal
        const seg = document.createElement('span');
        seg.className = 'db-bars__seg db-bars__seg--nonprov';
        seg.style.width = `${share * 100}%`;
        seg.style.background = TYPE_COLOR[t];
        seg.dataset.pct = String(pct);
        seg.dataset.count = String(n);
        seg.title = `${TYPE_LABELS[t]}: ${n} (${pct}%)`;
        row.appendChild(seg);
        segsPendingSizing.push(seg);
      });
      rowWrap.appendChild(row);
      host.appendChild(rowWrap);

      // Column 3 — total count on the right, same style as district rows.
      const num = document.createElement('div');
      num.className = 'db-bars__total';
      num.textContent = nonProv.total;
      host.appendChild(num);

      // Segment percentage labels: show inside the segment only when the
      // rendered pixel width is greater than 40px. For narrower segments,
      // rely on the native title tooltip (already set above).
      // We measure after layout via requestAnimationFrame so getBoundingClientRect
      // reflects the actual grid-resolved dimensions.
      requestAnimationFrame(() => {
        segsPendingSizing.forEach(seg => {
          const w = seg.getBoundingClientRect().width;
          if (w > 40) {
            const pct = parseFloat(seg.dataset.pct);
            // Show as integer if it happens to be one; otherwise round to nearest int for space.
            seg.textContent = `${Math.round(pct)}%`;
          } else {
            seg.textContent = '';
          }
        });
      });
    }
  }

  // ============ PANEL E — publication-type breakdown ============
  // Renders the six-category publication-type grid. PhD Thesis and
  // Master's Thesis lead the list as first-class categories, followed by
  // Journal Article, Book Chapter, Book, and Report. Each type card shows
  // a count, a per-type share bar, and a clickable label that filters the
  // scholar list (Panel F) and publications browser (Panel G) to items
  // of that type. Reflects the current type-filter selection at the top
  // of Panel B, so an unchecked type is greyed out (0 count) rather than
  // hidden — keeping the panel structurally stable across filter changes.
  //
  // Region-ranked bars previously here have been retired; the same
  // information is now surfaced via Panel C3 (Research Output by Home
  // Political/Census District) and Panel B4 (world map).
  const PUB_TYPE_ORDER_E = [
    { key: 'thesisPhd',      label: 'PhD Thesis',      color: '#228B22' },
    { key: 'thesisMasters',  label: "Master's Thesis", color: '#8FBC8F' },
    { key: 'journalArticle', label: 'Journal Article', color: '#B8860B' },
    { key: 'bookSection',    label: 'Book Chapter',    color: '#C08388' },
    { key: 'book',           label: 'Book',            color: '#7a1419' },
    { key: 'report',         label: 'Report',          color: '#1e40af' },
  ];
  function renderPanelE() {
    const host = $('[data-db-pubtype-grid]');
    if (!host) return;
    host.innerHTML = '';
    const counts = new Map();
    PUB_TYPE_ORDER_E.forEach(t => counts.set(t.key, 0));
    state.snapshot.items.forEach(it => {
      const t = visualType(it);
      if (!counts.has(t)) return;
      counts.set(t, counts.get(t) + 1);
    });
    const totalAll = Array.from(counts.values()).reduce((a,b) => a + b, 0) || 1;
    const maxOne  = Math.max(1, ...counts.values());
    PUB_TYPE_ORDER_E.forEach(t => {
      const n = counts.get(t.key) || 0;
      const share = (n / totalAll) * 100;
      const barPct = (n / maxOne) * 100;
      const dimmed = !state.typeSet.has(t.key) ? ' is-dimmed' : '';
      const card = document.createElement('div');
      card.className = `db-pubtype-card${dimmed}`;
      card.innerHTML = `
        <div class="db-pubtype-card__head">
          <span class="db-pubtype-card__stripe" style="background:${t.color};"></span>
          <span class="db-pubtype-card__name" data-pubtype="${t.key}">${t.label}</span>
          <span class="db-pubtype-card__n">${n}</span>
        </div>
        <div class="db-pubtype-card__bar"><span class="db-pubtype-card__fill" style="width:${barPct}%;background:${t.color};"></span></div>
        <div class="db-pubtype-card__share">${share.toFixed(1)}% of catalogued output</div>
      `;
      // Clicking the type name toggles a type-only filter on BOTH the
      // leaderboard (Panel F) and the publications list (Panel G).
      //
      //   - Panel G reads state.filter.itemType and matches on both the raw
      //     Zotero itemType and the visual sub-type (`thesisPhd` etc.),
      //     so we set state.filter.itemType.
      //   - Panel F reads state.typeSet (Set of visible types) for its
      //     card-pill chip rendering and count aggregation. To scope Panel F
      //     to a single type, we snapshot the previous typeSet, replace it
      //     with a single-type Set, and restore it when the filter clears.
      //   - The visual state (highlighted card, dimmed sibling cards) still
      //     reads from state.filter.type so multiple call sites stay in sync.
      const nameEl = card.querySelector('.db-pubtype-card__name');
      if (nameEl) {
        nameEl.style.cursor = 'pointer';
        nameEl.title = 'Click to filter the leaderboard and publications list to this type';
        nameEl.addEventListener('click', () => {
          state.filter = state.filter || {};
          const already = state.filter.type === t.key;
          if (already) {
            // Toggle off — restore full type visibility on both surfaces.
            state.filter.type = '';
            state.filter.itemType = '';
            if (state._typeSetBeforePanelE) {
              state.typeSet = state._typeSetBeforePanelE;
              state._typeSetBeforePanelE = null;
            }
          } else {
            // Toggle on — snapshot the current typeSet so we can restore it,
            // then narrow to just this type. If the raw type is `thesis`, also
            // include the two visual sub-types so PhD/Master's rows stay in.
            if (!state._typeSetBeforePanelE) state._typeSetBeforePanelE = new Set(state.typeSet);
            const scoped = new Set([t.key]);
            if (t.key === 'thesis') { scoped.add('thesisPhd'); scoped.add('thesisMasters'); scoped.add('thesisUnknown'); }
            state.typeSet = scoped;
            state.filter.type = t.key;
            state.filter.itemType = t.key;
          }
          // Reflect the change in the Panel-B type-checkbox row so the
          // user can see which types are visible.
          if (typeof syncChecked === 'function') { try { syncChecked(); } catch (e) {} }
          // Mirror the change into the Panel G dropdown so the user sees
          // the itemType filter as active.
          const sel = document.querySelector('[data-db-filter="itemType"]');
          if (sel) sel.value = state.filter.itemType || '';
          state.shown = state.pageSize;
          afterFilterChange();
        });
      }
      host.appendChild(card);
    });
  }

  // ============ Type-filter checkbox wiring ============
  // Panel B1 title dropdown: switches the ranked-bar chart between Samoan
  // authors (default) and all authors. Keeps the meta pill in sync.
  function wirePanelB1() {
    const sel = document.querySelector('[data-b1-authors]');
    if (sel) {
      sel.value = state.b1Authors || 'samoan';
      sel.addEventListener('change', () => {
        state.b1Authors = sel.value === 'all' ? 'all' : 'samoan';
        renderPanelB();
      });
    }
    // Panel B1 has two mutually exclusive views:
    //   "type"       — the default publication-type stacked bar
    //   "authorship" — reuses the visualization that used to live in B2's
    //                  Authorship tab (Samoan first / co-author / no Samoan
    //                  identified per district).
    // The dropdown 'Authors: Samoan / All' is meaningful only in the type
    // view; the authorship view always considers all authors by definition,
    // so we disable the dropdown while it's active.
    const b1Root = document.querySelector('[data-panel="B1"]');
    if (b1Root) {
      b1Root.querySelectorAll('[data-b1-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = btn.dataset.b1Tab === 'authorship' ? 'authorship' : 'type';
          if (state.b1View === v) return;
          state.b1View = v;
          renderPanelB();
        });
      });
    }
  }

  function wireTypeFilter() {
    const host = $('[data-db-type-filter]');
    if (!host) return;

    // Count items per (visual) type in the current snapshot
    const typeCounts = new Map();
    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      typeCounts.set(vt, (typeCounts.get(vt) || 0) + 1);
    });

    // Hide checkboxes for types with zero items and drop them from typeSet.
    // The container uses flex-wrap, so surviving labels reflow to fill the row.
    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]'));
    const visibleBoxes = [];
    boxes.forEach(b => {
      const n = typeCounts.get(b.value) || 0;
      const label = b.closest('label');
      if (n === 0) {
        if (label) label.style.display = 'none';
        b.checked = false;
        state.typeSet.delete(b.value);
      } else {
        visibleBoxes.push(b);
      }
    });

    const syncChecked = () => {
      state.typeSet = new Set(visibleBoxes.filter(b => b.checked).map(b => b.value));
      visibleBoxes.forEach(b => b.closest('label').classList.toggle('is-checked', b.checked));
      renderPanelB();
      renderPanelE();
      // Panel D histogram has its own type filter (state.histTypeSet) wired
      // by wireHistTypeFilter — do NOT rerender it here so Panel B toggles
      // no longer cascade into the timeline.
    };
    visibleBoxes.forEach(b => b.addEventListener('change', syncChecked));
    const allBtn = host.querySelector('[data-db-type-all]');
    const noneBtn = host.querySelector('[data-db-type-none]');
    if (allBtn)  allBtn.addEventListener('click',  () => { visibleBoxes.forEach(b => b.checked = true);  syncChecked(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { visibleBoxes.forEach(b => b.checked = false); syncChecked(); });
    syncChecked();
  }

  // ============ Panel D type filter (independent of Panel B) ============
  // Same visual pattern as Panel C2's wireB2TypeFilter — checkbox row with
  // Check-all / Clear buttons. State lives in state.histTypeSet, which only
  // renderHistogram() reads, so toggling here does not affect Panels B/C.
  // Hidden item types (zero items in the snapshot) are stripped so the row
  // matches the actual data.
  function wireHistTypeFilter() {
    const host = $('[data-hist-type-filter]');
    if (!host) return;

    // Count items per (visual) type so we can hide zero-item checkboxes.
    const typeCounts = new Map();
    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      typeCounts.set(vt, (typeCounts.get(vt) || 0) + 1);
    });

    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]'));
    const visibleBoxes = [];
    boxes.forEach(b => {
      const n = typeCounts.get(b.value) || 0;
      const label = b.closest('label');
      if (n === 0) {
        if (label) label.style.display = 'none';
        b.checked = false;
        state.histTypeSet.delete(b.value);
      } else {
        visibleBoxes.push(b);
      }
    });

    const syncChecked = () => {
      state.histTypeSet = new Set(visibleBoxes.filter(b => b.checked).map(b => b.value));
      visibleBoxes.forEach(b => b.closest('label').classList.toggle('is-checked', b.checked));
      renderHistogram();
    };
    visibleBoxes.forEach(b => b.addEventListener('change', syncChecked));
    const allBtn  = host.querySelector('[data-hist-type-all]');
    const noneBtn = host.querySelector('[data-hist-type-none]');
    if (allBtn)  allBtn.addEventListener('click',  () => { visibleBoxes.forEach(b => b.checked = true);  syncChecked(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { visibleBoxes.forEach(b => b.checked = false); syncChecked(); });
    syncChecked();
  }

  // ============ Panel D authors pills (lead / coauth / both / all) ============
  // Four-state selector that lives to the right of the Panel D title. Writes
  // to state.histAuthors and re-renders only the histogram. See renderHistogram
  // for how each mode maps onto itaukeiAuthorship(item).
  function wireHistAuthorsTabs() {
    const wrap = $('[data-hist-authors-tabs]');
    if (!wrap) return;
    const tabs = Array.from(wrap.querySelectorAll('[data-hist-authors]'));
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.histAuthors;
        if (!v || state.histAuthors === v) return;
        state.histAuthors = v;
        tabs.forEach(t => {
          const active = t === btn;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
          t.setAttribute('tabindex', active ? '0' : '-1');
        });
        // X-axis range depends on the current authors filter (yearsAll changes),
        // so reset the histogram range preset to "all" and let renderHistogram
        // recompute the data-min/max from the newly filtered set.
        state.histRange = { start: null, end: null, preset: 'all' };
        renderHistogram();
      });
    });
  }

  // ============ Panel C legend (item-type colour key) ============
  // Skip types with zero items in the current snapshot so the legend stays clean.
  function renderHistLegend() {
    const host = $('[data-db-hist-legend]');
    if (!host) return;
    const counts = new Map();
    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      counts.set(vt, (counts.get(vt) || 0) + 1);
    });
    host.innerHTML = '';
    TYPE_ORDER.forEach(t => {
      if ((counts.get(t) || 0) === 0) return;
      const s = document.createElement('span');
      s.innerHTML = `<i style="background:${TYPE_COLOR[t]};"></i> ${TYPE_LABELS[t]}`;
      host.appendChild(s);
    });
  }

  // ============ DISCIPLINE DONUT ============
  let disciplineEntries = [];
  const donutPalette = ['#0e7490','#6b3e26','#7a1419','#c8a84b','#3d5a35','#1e40af','#a8431f','#4b5563','#B23A48','#1F6E8C','#7c3aed','#0f766e','#92400e'];

  function renderDonut() {
    const items = state.snapshot.items;
    const counts = {};
    items.forEach(i => {
      const set = state.disciplinesByItem.get(i.key);
      if (set) set.forEach(d => { counts[d] = (counts[d]||0) + 1; });
    });
    disciplineEntries = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    const total = disciplineEntries.reduce((a,[,n]) => a+n, 0);
    const svg = $('#db-donut');
    if (!svg) return; // Donut removed from layout — populate dropdown only
    svg.innerHTML = '';
    const cx = 120, cy = 120, R = 100, r = 60;
    let a0 = -Math.PI/2;
    disciplineEntries.forEach(([name, n], i) => {
      const frac = n / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const xi1 = cx + r * Math.cos(a1), yi1 = cy + r * Math.sin(a1);
      const xi0 = cx + r * Math.cos(a0), yi0 = cy + r * Math.sin(a0);
      const path = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${r} ${r} 0 ${large} 0 ${xi0} ${yi0} Z`;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', path);
      p.setAttribute('fill', donutPalette[i % donutPalette.length]);
      p.setAttribute('stroke', '#fff');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('data-discipline', name);
      p.style.cursor = 'pointer';
      p.addEventListener('mouseenter', () => p.setAttribute('opacity', '0.75'));
      p.addEventListener('mouseleave', () => p.setAttribute('opacity', '1'));
      p.addEventListener('click', () => {
        state.filter.discipline = state.filter.discipline === name ? '' : name;
        state.shown = state.pageSize;
        const sel = $('[data-db-filter="discipline"]');
        if (sel) sel.value = state.filter.discipline;
        afterFilterChange();
      });
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = `${name} · ${n} publication${n===1?'':'s'}`;
      p.appendChild(t);
      svg.appendChild(p);
      a0 = a1;
    });
    const tt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tt.setAttribute('x', cx); tt.setAttribute('y', cy-6);
    tt.setAttribute('text-anchor','middle'); tt.setAttribute('font-family','DM Sans');
    tt.setAttribute('font-size','32'); tt.setAttribute('font-weight','600'); tt.setAttribute('fill','#062f35');
    tt.textContent = total;
    svg.appendChild(tt);
    const tt2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tt2.setAttribute('x', cx); tt2.setAttribute('y', cy+16);
    tt2.setAttribute('text-anchor','middle'); tt2.setAttribute('font-family','DM Sans');
    tt2.setAttribute('font-size','11'); tt2.setAttribute('fill','#6b7280');
    tt2.textContent = 'classified items';
    svg.appendChild(tt2);

    const leg = $('#db-donut-legend');
    if (!leg) return;
    leg.innerHTML = '';
    disciplineEntries.forEach(([name, n], i) => {
      const row = el('div', {
        'data-discipline': name,
        style: 'display:flex;align-items:center;gap:6px;',
        onclick: () => {
          state.filter.discipline = state.filter.discipline === name ? '' : name;
          state.shown = state.pageSize;
          const sel = $('[data-db-filter="discipline"]');
          if (sel) sel.value = state.filter.discipline;
          afterFilterChange();
        }
      },
        el('span', { style: `width:12px;height:12px;border-radius:2px;display:inline-block;background:${donutPalette[i % donutPalette.length]};flex-shrink:0;` }),
        el('span', { style: 'flex:1;color:var(--color-text);' }, name),
        el('span', { style: 'color:var(--color-text-muted);font-weight:600;' }, String(n))
      );
      leg.appendChild(row);
    });
    renderDonutLegendActive();
  }
  function renderDonutLegendActive() {
    $$('#db-donut-legend > div').forEach(row => {
      row.classList.toggle('is-active', row.getAttribute('data-discipline') === state.filter.discipline);
    });
  }

  // ============ STACKED-BY-TYPE YEAR HISTOGRAM (Panel D) ============
  // Bars per year, stacked bottom-up by item type. Panel D owns its own
  // type filter (state.histTypeSet, wired via wireHistTypeFilter) and its own
  // authors filter (state.histAuthors, wired via wireHistAuthorsTabs) so
  // toggles here don't cascade into Panel B/C and vice versa.
  // The x-axis window is controlled by state.histRange (start/end year).
  function panelDParseYear(value) {
    const match = String(value == null ? '' : value).match(/^\s*(\d{4})\s*$/);
    return match ? Number(match[1]) : null;
  }

  function panelDSvg(tag, attrs, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    if (text != null) node.textContent = text;
    return node;
  }

  // Master-derived Panel D data is intentionally cached after the first build.
  // Completion year is required only for a milestone dot: completed but undated
  // degree records remain part of the dashboard's all-completion KPI totals.
  function getPanelDData() {
    if (state.panelDDataCache) return state.panelDDataCache;

    const master = state.master || {};
    const scholars = Array.isArray(master.scholars) ? master.scholars : [];
    const gradDegrees = Array.isArray(master.gradDegrees) ? master.gradDegrees : [];
    const publications = Array.isArray(master.publications) ? master.publications : [];
    const authorship = Array.isArray(master.authorship) ? master.authorship : [];
    const aggregates = master.aggregates || {};
    const genderByScholarId = new Map(scholars.map(s => [String(s['Scholar ID'] || '').trim(), String(s.Gender || '').trim()]));
    // Paternal-info lookup for Panel D milestone annotations. Fields come
    // straight from Scholars (public allowlist covers all of them). We treat
    // 'Unclassified' as blank so it doesn't leak into the rendered chart
    // annotation.
    const cleanPaternal = v => {
      const t = String(v == null ? '' : v).trim();
      return t && t.toLowerCase() !== 'unclassified' ? t : '';
    };
    const paternalInfoByScholarId = new Map(scholars.map(s => [
      String(s['Scholar ID'] || '').trim(),
      {
        village:     cleanPaternal(s['Village Paternal']),
        district:    cleanPaternal(s['District Paternal']),
        district:    cleanPaternal(s['District Paternal']),
        region: cleanPaternal(s['Paternal Statistical Region'])
      }
    ]));
    // Compose the Panel D Line-4/5 annotation from the four paternal fields.
    // Ron's mockup wraps the geography onto TWO lines:
    //   line 4: "Village vlg, District District,"     (village + district)
    //   line 5: "District District (Statistical Region)"    (district + region)
    // This keeps callouts compact horizontally so they don't overflow onto
    // the neighboring bars. Any missing field is omitted along with its
    // trailing separator. If every field is blank/Unclassified both lines
    // are '' and the milestone renders only the 3 base lines.
    //
    // Returned shape:
    //   { topLine, bottomLine, joined }
    //     - topLine    → line 4 (village + district)
    //     - bottomLine → line 5 (district + region)
    //     - joined     → single-line form used only for tooltips
    function composePaternal(info) {
      const out = { topLine: '', bottomLine: '', joined: '' };
      if (!info) return out;
      const topParts = [];
      if (info.village)  topParts.push(`${info.village} vlg`);
      if (info.district) topParts.push(`${info.district} District`);
      const botParts = [];
      if (info.district) botParts.push(`${info.district} District`);
      if (info.region) botParts.push(`(${info.region})`);
      // Trailing comma on topLine when bottomLine follows (mockup shows
      // "Matokana vlg, Ono-i-Lau District," then wraps to line 5).
      out.topLine = topParts.join(', ');
      if (out.topLine && botParts.length) out.topLine = `${out.topLine},`;
      out.bottomLine = botParts.join(' ');
      const both = [out.topLine.replace(/,\s*$/, ''), out.bottomLine].filter(Boolean);
      out.joined = both.join(', ');
      return out;
    }
    // Back-compat helper — a few call sites (tooltip strings, tests) still
    // want the flat single-line form.
    function composePaternalLine(info) { return composePaternal(info).joined; }
    // Name breakdown lookups (Family / Given) for milestone labels that need
    // "Given Family" order rather than the Scholar Name's "Family, Given" form.
    // Both fields are already in the public field allowlist (master_file_config.py)
    // so they arrive with the Master-file refresh.
    const familyNameByScholarId = new Map(scholars.map(s => [String(s['Scholar ID'] || '').trim(), String(s['Family Name'] || '').trim()]));
    const givenNamesByScholarId = new Map(scholars.map(s => [String(s['Scholar ID'] || '').trim(), String(s['Given Names'] || '').trim()]));
    const publicationById = new Map(publications.map(pub => [String(pub['Publication ID / BibTeX Key'] || '').trim(), pub]));
    const isMasters = row => /master/i.test(String(row['Degree Stage'] || ''));
    const isPhd = row => /phd|doctor/i.test(String(row['Degree Stage'] || ''));
    const isCompleted = row => String(row['Completion Status'] || '').trim().toLowerCase().startsWith('completed');
    const completedRows = gradDegrees.filter(row => isCompleted(row) && (isMasters(row) || isPhd(row)));
    const completedDatedRows = completedRows.map(row => ({ row, year: panelDParseYear(row['Finish / Completion Year']) })).filter(entry => entry.year != null);
    const milestoneDefinitions = [
      { key: 'firstMaleMasters', label: "1st Male Master's", shortLabel: "1st male Master's", stage: 'masters', gender: 'Male', color: '#2E7C8F', isFemale: false },
      { key: 'firstFemaleMasters', label: "1st Female Master's", shortLabel: "1st female Master's", stage: 'masters', gender: 'Female', color: '#B85450', isFemale: true },
      { key: 'firstMalePhD', label: '1st Male PhD', shortLabel: '1st male PhD', stage: 'phd', gender: 'Male', color: '#2E7C8F', isFemale: false },
      { key: 'firstFemalePhD', label: '1st Female PhD', shortLabel: '1st female PhD', stage: 'phd', gender: 'Female', color: '#B85450', isFemale: true }
    ];
    // Country name -> ISO-ish 2-letter code for compact milestone labels.
    // Covers every country currently in the Master-file `Country` column plus
    // a few obvious neighbours. Missing entries fall back to a best-effort
    // first-two-letters uppercase (e.g. "Vanuatu" -> "VA") which is fine for
    // rare cases and easy for Ron to override by adding a row here.
    const COUNTRY_CODE = {
      'Samoa': 'FJ',
      'New Zealand': 'NZ',
      'Australia': 'AU',
      'United Kingdom': 'UK',
      'United States': 'US',
      'United States of America': 'US',
      'USA': 'US',
      'Canada': 'CA',
      'Japan': 'JP',
      'India': 'IN',
      'China': 'CN',
      'Papua New Guinea': 'PG',
      'Solomon Islands': 'SB',
      'Vanuatu': 'VU',
      'Samoa': 'WS',
      'Tonga': 'TO',
      'France': 'FR',
      'Germany': 'DE',
      'Netherlands': 'NL',
      'Norway': 'NO',
      'Sweden': 'SE',
      'Switzerland': 'CH',
      'Malaysia': 'MY',
      'Singapore': 'SG',
      'South Korea': 'KR',
      'Taiwan': 'TW',
      'Philippines': 'PH',
      'Indonesia': 'ID',
      'Thailand': 'TH'
    };
    function countryCodeFor(name) {
      const s = String(name || '').trim();
      if (!s) return '';
      if (COUNTRY_CODE[s]) return COUNTRY_CODE[s];
      // Fallback: first two alphabetic characters, uppercase
      const letters = s.replace(/[^A-Za-z]/g, '');
      return letters.slice(0, 2).toUpperCase();
    }
    // Title mapping: PhD/doctorate -> Dr., Master's -> Mr./Ms based on gender.
    // Falls back to no title if gender is not Male/Female (Ron requires the
    // Gender field to be authoritative — we do not infer from names).
    function titleFor(stage, gender) {
      if (stage === 'phd') return 'Dr.';
      if (stage === 'masters') {
        if (gender === 'Male') return 'Mr.';
        if (gender === 'Female') return 'Ms';
      }
      return '';
    }
    // Milestone display line 1 (e.g. "1963: First male PhD"). Kept in one
    // place so we can tweak wording without editing SVG code.
    function milestoneHeadline(def) {
      const who = def.gender === 'Male' ? 'male' : 'female';
      const what = def.stage === 'phd' ? 'PhD' : "Masters";
      return `First ${who} ${what}`;
    }
    const milestones = milestoneDefinitions.map(def => {
      const candidates = completedDatedRows
        .filter(({ row }) => (def.stage === 'masters' ? isMasters(row) : isPhd(row)) && genderByScholarId.get(String(row['Scholar ID'] || '').trim()) === def.gender)
        .map(({ row, year }) => {
          const scholarId = String(row['Scholar ID'] || '').trim();
          const cUni = String(row['C_Uni name'] || '').trim();
          const oUni = String(row['O_Uni name'] || '').trim();
          // Panel D milestones display the CANONICAL (C_Uni) name because
          // that is how the awarding institution is known today (e.g.
          // 'University of Auckland' rather than the 1956 historical
          // 'University of New Zealand — Auckland University College').
          // If the historical/as-recorded O_Uni differs from C_Uni, the
          // rendered institution is suffixed with '*' and a footnote below
          // the chart records the historical → canonical mapping. When O_Uni
          // is blank we fall back to C_Uni (still canonical, no footnote).
          const displayUni = cUni || oUni;
          return {
            year,
            scholarId,
            name: String(row['Scholar Name'] || '').trim(),
            familyName: familyNameByScholarId.get(scholarId) || '',
            givenNames: givenNamesByScholarId.get(scholarId) || '',
            degree: String(row['Degree / Qualification'] || '').trim(),
            uni: displayUni,
            cUni,
            oUni,
            country: String(row.Country || '').trim()
          };
        })
        .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
      if (!candidates.length) throw new Error(`Panel D milestone data missing: ${def.key}`);
      const year = candidates[0].year;
      const tied = candidates.filter(candidate => candidate.year === year);
      const chosen = tied[0];
      // Build display strings: title + FIRST-given + family, uni (CC).
      //
      // Public chart name privacy rule (culturally required in Samoan
      // context — see prompt v2): only the first token of Given Names is
      // rendered on the public chart. Middle names, additional given names,
      // initials, and any private/traditional names are omitted. This is a
      // DISPLAY rule only — the canonical Scholar Name / Given Names stored
      // in Master is untouched. Scholar ID remains the internal key so joins,
      // dedup, and milestone matching are unaffected.
      const title = titleFor(def.stage, def.gender);
      const firstGiven = (chosen.givenNames || '').trim().split(/\s+/)[0] || '';
      const publicPerson = firstGiven && chosen.familyName
        ? `${firstGiven} ${chosen.familyName}`
        : (chosen.name || '');
      const personLine = [title, publicPerson].filter(Boolean).join(' ');
      const cc = countryCodeFor(chosen.country);
      // Suffix '*' when the historical/as-recorded institution (O_Uni)
      // differs from the canonical (C_Uni) we are displaying. Footnote is
      // rendered below the chart per Ron's spec.
      const uniRenamed = !!(chosen.oUni && chosen.cUni && chosen.oUni !== chosen.cUni);
      const uniDisplay = uniRenamed ? `${chosen.uni}*` : chosen.uni;
      const uniLine = cc ? `${uniDisplay} (${cc})` : uniDisplay;
      const headline = milestoneHeadline(def);
      // Line 4 (paternal geography) is built from the chosen scholar's
      // Scholars-sheet paternal fields. If Master has 'Unclassified' or
      // blanks for every one of them, paternalLine is empty and the
      // renderer draws only 3 lines for this milestone.
      const paternalInfo = paternalInfoByScholarId.get(chosen.scholarId) || {};
      const paternalPair = composePaternal(paternalInfo);
      const paternalLine = paternalPair.joined;
      const paternalTop = paternalPair.topLine;
      const paternalBottom = paternalPair.bottomLine;
      return {
        ...def,
        year,
        name: chosen.name,
        familyName: chosen.familyName,
        givenNames: chosen.givenNames,
        firstGiven,
        publicPerson,
        title,
        personLine,
        uniLine,
        uniRenamed,
        paternalInfo,
        paternalLine,
        paternalTop,
        paternalBottom,
        headline,
        degree: chosen.degree,
        uni: chosen.uni,
        cUni: chosen.cUni,
        oUni: chosen.oUni,
        country: chosen.country,
        countryCode: cc,
        ties: tied
      };
    });

    const authorshipByPublication = new Map();
    authorship.forEach(row => {
      const publicationId = String(row['Publication ID / BibTeX Key'] || '').trim();
      if (!publicationId) return;
      const rows = authorshipByPublication.get(publicationId) || [];
      rows.push(row);
      authorshipByPublication.set(publicationId, rows);
    });
    const authorshipRoleByPublication = new Map();
    authorshipByPublication.forEach((rows, publicationId) => {
      const hasLead = rows.some(row => row['Is First Author?'] === true || row['Is First Author?'] === 'true' || row._is_lead === true || Number(row['Author Position'] || 0) === 1);
      authorshipRoleByPublication.set(publicationId, hasLead ? 'lead' : 'coauth');
    });

    const mastersN = completedRows.filter(isMasters).length;
    const phdN = completedRows.filter(isPhd).length;
    const universities = new Set(completedRows.map(row => String(row['C_Uni name'] || row['O_Uni name'] || '').trim()).filter(Boolean));
    const countries = new Set(completedRows.map(row => String(row.Country || '').trim()).filter(Boolean));
    const kpis = {
      'd-theses': completedRows.length,
      'd-scholars': scholars.length,
      'd-masters': mastersN,
      'd-phds': phdN,
      'd-unis': universities.size,
      'd-countries': countries.size,
      'd-milestones': milestones.length
    };
    const expectedKpis = { 'd-theses': 432, 'd-scholars': 472, 'd-masters': 315, 'd-phds': 117, 'd-unis': 101, 'd-countries': 22, 'd-milestones': 4 };
    Object.entries(expectedKpis).forEach(([key, expected]) => {
      if (kpis[key] !== expected) console.warn(`Panel D KPI data drift: ${key} is ${kpis[key]}, expected ${expected}.`);
    });

    state.milestonesCache = milestones;
    state.panelDDataCache = {
      milestones,
      kpis,
      mastersN,
      phdN,
      genderByScholarId,
      publicationById,
      authorshipByPublication,
      authorshipRoleByPublication,
      linkedScholarFallback: aggregates.totals && aggregates.totals.scholars_with_authorship_link
    };
    return state.panelDDataCache;
  }

  function updatePanelDKpis(panelDData) {
    // Ron asked for a leaner KPI row on 2026-08-23: number + short label only,
    // no descriptive sub-lines. The subtitle span still gets its textContent
    // set (to ''), which also clears any stale sub-line from an earlier build.
    const subtitles = {
      'd-theses': '',
      'd-scholars': '',
      'd-masters': '',
      'd-phds': '',
      'd-unis': '',
      'd-countries': '',
      'd-milestones': ''
    };
    Object.entries(panelDData.kpis).forEach(([key, value]) => {
      const number = $(`[data-kpi="${key}"]`);
      const subtitle = $(`[data-kpi-sub="${key}"]`);
      if (number) number.textContent = value;
      if (subtitle) subtitle.textContent = subtitles[key];
    });
  }

  // ============ STACKED-BY-TYPE YEAR HISTOGRAM (Panel D) ============
  // Bars per year, stacked bottom-up by item type. Panel D owns its own
  // type filter (state.histTypeSet, wired via wireHistTypeFilter) and its own
  // authors filter (state.histAuthors, wired via wireHistAuthorsTabs) so
  // toggles here don't cascade into Panel B/C and vice versa.
  // The x-axis window is controlled by state.histRange (start/end year).
  function renderHistogram() {
    const items = state.snapshot.items;
    const authorsMode = state.histAuthors || 'both';
    const panelDData = getPanelDData();
    updatePanelDKpis(panelDData);

    const passesAuthors = (it) => {
      if (authorsMode === 'all') return true;
      const role = itaukeiAuthorship(it);
      if (authorsMode === 'lead') return role === 'lead';
      if (authorsMode === 'coauth') return role === 'coauth';
      return role !== 'none';
    };
    const roleMatches = role => authorsMode === 'all' || (authorsMode === 'lead' ? role === 'lead' : authorsMode === 'coauth' ? role === 'coauth' : role !== 'none');

    const perYear = new Map();
    const yearsAll = [];
    const filteredItems = items.filter(passesAuthors);
    filteredItems.forEach(it => {
      if (!it.year) return;
      yearsAll.push(it.year);
      const type = visualType(it);
      if (!state.histTypeSet.has(type)) return;
      const bucket = perYear.get(it.year) || {};
      bucket[type] = (bucket[type] || 0) + 1;
      perYear.set(it.year, bucket);
    });

    const linkedScholarIds = new Set();
    panelDData.authorshipByPublication.forEach((rows, publicationId) => {
      const role = panelDData.authorshipRoleByPublication.get(publicationId) || 'none';
      if (!roleMatches(role)) return;
      rows.forEach(row => {
        const scholarId = String(row['Scholar ID'] || '').trim();
        if (scholarId) linkedScholarIds.add(scholarId);
      });
    });
    const headlineTypes = new Set(['journalArticle', 'thesisMasters', 'thesisPhd', 'bookSection', 'book']);
    const note = $('[data-hist-note]');
    if (note) {
      const headlineTotal = filteredItems.filter(it => headlineTypes.has(visualType(it))).length;
      const linkedTotal = linkedScholarIds.size || panelDData.linkedScholarFallback || 0;
      note.textContent = `One bar per year of publication. Unclassified items are excluded. A total of ${filteredItems.length} publication records (${headlineTotal} across the five headline categories) are linked to ${linkedTotal} Samoan scholars. Women share is a 5-year rolling average of lead-author gender.`;
    }

    if (yearsAll.length) populateDecadeSelect(Math.min(...yearsAll), Math.max(...yearsAll));
    const svg = $('#db-source-histogram');
    if (!svg) return;
    svg.innerHTML = '';
    const typesInData = new Set(items.map(item => visualType(item)));
    // Panel D stack order: force Master's to sit BELOW PhD in the bar stack
    // (Master's is completed first, PhD comes after when a scholar continues).
    // We build the base list from TYPE_ORDER (which many other panels share)
    // and then swap thesisMasters ahead of thesisPhd for Panel D only, so we
    // don't affect Panel B/C legend or stack behavior.
    const rawVisible = TYPE_ORDER.filter(type => state.histTypeSet.has(type) && typesInData.has(type));
    const visibleTypes = (() => {
      const arr = rawVisible.slice();
      const iP = arr.indexOf('thesisPhd');
      const iM = arr.indexOf('thesisMasters');
      if (iP !== -1 && iM !== -1 && iM > iP) {
        // Move thesisMasters before thesisPhd
        arr.splice(iM, 1);
        arr.splice(iP, 0, 'thesisMasters');
      }
      return arr;
    })();
    if (!visibleTypes.length || !perYear.size || !yearsAll.length) {
      svg.appendChild(panelDSvg('text', { x: 450, y: 170, 'text-anchor': 'middle', 'font-family': 'Arial', 'font-size': '15', fill: '#6b7280' }, 'No item types selected — check at least one source type.'));
      return;
    }

    const W = 900, H = 340;
    // Padding widened on left (numeric labels + rotated axis title) and right
    // (secondary %-axis + rotated "Women authorship" title).
    const PAD_LEFT = 62, PAD_RIGHT = 74, PAD_TOP = 42, PAD_BOTTOM = 46;
    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOTTOM;
    // dataMin/dataMax define the domain the timeline can span. We widen the
    // lower bound to include milestone years so the default "All" view always
    // captures every milestone (e.g. 1963 first male PhD is earlier than the
    // earliest lead-authored publication). Preset ranges (Last 25/10/5 yrs)
    // still hide milestones outside their window, per the spec.
    const milestoneYears = Array.isArray(panelDData.milestones) ? panelDData.milestones.map(m => m.year).filter(y => Number.isFinite(y)) : [];
    const dataMin = Math.min(...yearsAll, ...(milestoneYears.length ? milestoneYears : [Infinity]));
    const dataMax = Math.max(...yearsAll);
    let yMin = state.histRange.start != null ? state.histRange.start : dataMin;
    let yMax = state.histRange.end != null ? state.histRange.end : dataMax;
    if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
    yMin = Math.max(dataMin, Math.min(dataMax, yMin));
    yMax = Math.max(dataMin, Math.min(dataMax, yMax));

    const startEl = $('[data-hist-start]');
    const endEl = $('[data-hist-end]');
    if (startEl) { startEl.min = dataMin; startEl.max = dataMax; if (document.activeElement !== startEl) startEl.value = yMin; }
    if (endEl) { endEl.min = dataMin; endEl.max = dataMax; if (document.activeElement !== endEl) endEl.value = yMax; }

    const yearCount = yMax - yMin + 1;
    const bandW = plotW / yearCount;
    const barW = Math.max(1.5, Math.min(40, bandW * 0.78));
    const bandGap = (bandW - barW) / 2;
    let maxStack = 0;
    perYear.forEach((bucket, year) => {
      if (year < yMin || year > yMax) return;
      maxStack = Math.max(maxStack, visibleTypes.reduce((sum, type) => sum + (bucket[type] || 0), 0));
    });
    // Y-axis breathing room: add ~5 units of headroom above the tallest bar
    // before rounding to a nice number, so the tallest stack never touches
    // the top of the plot.
    const niceMax = niceCeil((maxStack || 1) + 5);
    const yScale = value => plotH * (value / niceMax);
    const yZero = PAD_TOP + plotH;
    const plotRight = W - PAD_RIGHT;

    // Decade shading. Non-shaded decades are pure white; shaded decades are a
    // slightly darker warm gray so the alternation reads clearly (previous
    // values were 5%/2% which were invisible in the fullscreen view).
    let decadeIndex = 0;
    for (let decade = Math.floor(yMin / 10) * 10; decade <= yMax; decade += 10, decadeIndex++) {
      const startYear = Math.max(decade, yMin);
      const endYear = Math.min(decade + 10, yMax + 1);
      const x = PAD_LEFT + (startYear - yMin) * bandW;
      const width = (endYear - startYear) * bandW;
      svg.appendChild(panelDSvg('rect', { x, y: PAD_TOP, width, height: plotH, fill: decadeIndex % 2 === 0 ? '#ffffff' : 'rgba(120,90,60,0.06)' }));
      svg.appendChild(panelDSvg('text', { x: x + width / 2, y: PAD_TOP - 4, 'text-anchor': 'middle', 'font-family': 'Arial', 'font-size': '10', fill: '#9ca3af' }, `${decade}s`));
    }

    // Left y-axis: vertical line + ticks at 5 evenly-spaced values (0, 20, 40, 60, 80, 100 for niceMax=100).
    // We compute a tick step that divides niceMax into ~5 gridlines using the
    // same niceCeil family (5, 10, 20, 25, 50, 100).
    const yAxisStep = (() => {
      if (niceMax <= 5) return 1;
      if (niceMax <= 10) return 2;
      if (niceMax <= 20) return 5;
      if (niceMax <= 50) return 10;
      if (niceMax <= 100) return 20;
      return Math.ceil(niceMax / 5 / 10) * 10;
    })();
    // Left vertical axis line (matches the x-axis stroke)
    svg.appendChild(panelDSvg('line', { x1: PAD_LEFT, x2: PAD_LEFT, y1: PAD_TOP, y2: yZero, stroke: '#6b7280', 'stroke-width': '1' }));
    for (let value = 0; value <= niceMax + 0.001; value += yAxisStep) {
      const y = yZero - yScale(value);
      // Gridline across the plot (dashed except at zero, which is the x-axis).
      if (value > 0) {
        svg.appendChild(panelDSvg('line', { x1: PAD_LEFT, x2: plotRight, y1: y, y2: y, stroke: '#e5e7eb', 'stroke-dasharray': '2 3', 'stroke-width': '0.7' }));
      }
      // Outward tick mark on the left axis
      svg.appendChild(panelDSvg('line', { x1: PAD_LEFT - 4, x2: PAD_LEFT, y1: y, y2: y, stroke: '#6b7280', 'stroke-width': '1' }));
      // Numeric label
      svg.appendChild(panelDSvg('text', { x: PAD_LEFT - 7, y: y + 3.5, 'text-anchor': 'end', 'font-family': 'Arial', 'font-size': '10', fill: '#6b7280' }, Number.isInteger(value) ? String(value) : value.toFixed(1)));
    }
    // Left y-axis title (rotated, like the mockup)
    svg.appendChild(panelDSvg('text', {
      x: PAD_LEFT - 42, y: PAD_TOP + plotH / 2,
      transform: `rotate(-90 ${PAD_LEFT - 42} ${PAD_TOP + plotH / 2})`,
      'text-anchor': 'middle', 'font-family': 'Arial', 'font-size': '11', fill: '#6b7280'
    }, 'Number of publications'));

    for (let year = yMin; year <= yMax; year++) {
      const bucket = perYear.get(year);
      if (!bucket) continue;
      const xLeft = PAD_LEFT + (year - yMin) * bandW + bandGap;
      let stackTop = 0;
      visibleTypes.forEach(type => {
        const count = bucket[type] || 0;
        if (!count) return;
        const height = yScale(count);
        const rect = panelDSvg('rect', { x: xLeft, y: yZero - yScale(stackTop) - height, width: barW, height, fill: TYPE_COLOR[type] });
        rect.style.cursor = 'pointer';
        const total = visibleTypes.reduce((sum, current) => sum + (bucket[current] || 0), 0);
        const parts = visibleTypes.filter(current => bucket[current]).map(current => `${bucket[current]} × ${TYPE_LABELS[current] || current}`).join(', ');
        rect.appendChild(panelDSvg('title', {}, `${year} · ${total} publication${total === 1 ? '' : 's'} (${parts})`));
        rect.addEventListener('click', () => {
          state.filter.year = state.filter.year === year ? '' : year;
          state.shown = state.pageSize;
          afterFilterChange();
        });
        svg.appendChild(rect);
        stackTop += count;
      });
    }

    // Authorship-based 5-year rolling women share uses lead Scholar IDs from
    // the Master publications table and honors both the active Panel D author
    // mode AND the current source-type checkboxes — so unchecking types
    // (e.g. leaving only Master's + PhD) recomputes the line against just
    // those items, matching what the bars actually show.
    const activeTypeSet = state.histTypeSet;
    const genderCountsByYear = new Map();
    filteredItems.forEach(item => {
      const year = Number(item.year);
      if (!Number.isInteger(year)) return;
      // Only include items whose visual type is currently checked.
      if (!activeTypeSet.has(visualType(item))) return;
      const publication = panelDData.publicationById.get(String(item._masterPublicationId || '').trim());
      const gender = publication ? panelDData.genderByScholarId.get(String(publication['Auth_Lead Scholar ID'] || '').trim()) : '';
      if (gender !== 'Female' && gender !== 'Male') return;
      const bucket = genderCountsByYear.get(year) || { Female: 0, Male: 0 };
      bucket[gender] += 1;
      genderCountsByYear.set(year, bucket);
    });
    const rollingWomen = new Map();
    for (let year = dataMin; year <= dataMax; year++) {
      let female = 0, male = 0;
      for (let rollingYear = year - 4; rollingYear <= year; rollingYear++) {
        const bucket = genderCountsByYear.get(rollingYear);
        if (!bucket) continue;
        female += bucket.Female;
        male += bucket.Male;
      }
      if (female + male >= 3) rollingWomen.set(year, female / (female + male));
    }
    // Secondary (right) y-axis for the 5-year rolling women-authorship share.
    // Ticks at 0/25/50/75/100% (was 0/50/100) matching the reference mockup.
    const axisX = W - PAD_RIGHT + 4;
    svg.appendChild(panelDSvg('line', { x1: axisX, x2: axisX, y1: PAD_TOP, y2: yZero, stroke: '#9ca3af', 'stroke-width': '0.7' }));
    [0, 25, 50, 75, 100].forEach(percent => {
      const y = PAD_TOP + plotH * (1 - percent / 100);
      svg.appendChild(panelDSvg('line', { x1: axisX, x2: axisX + 4, y1: y, y2: y, stroke: '#9ca3af', 'stroke-width': '0.7' }));
      svg.appendChild(panelDSvg('text', { x: axisX + 7, y: y + 3.5, 'font-family': 'Arial', 'font-size': '10', fill: '#9ca3af' }, `${percent}%`));
    });
    svg.appendChild(panelDSvg('text', { x: W - 8, y: PAD_TOP + plotH / 2, transform: `rotate(-90 ${W - 8} ${PAD_TOP + plotH / 2})`, 'text-anchor': 'middle', 'font-family': 'Arial', 'font-size': '10', fill: '#6b7280' }, 'Women authorship (5-yr rolling)'));
    let rollingRun = [];
    const drawRollingRun = () => {
      // Rolling women-authorship line drawn dashed, matching the mockup.
      // Slight transparency (opacity 0.55) so it visually recedes behind the
      // milestone callout text when the line crosses through a label region
      // (e.g. the 1994 milestone sits directly on the rising curve). SVG
      // z-order already puts milestones on top since they're appended after,
      // but individual letter gaps let the dashed line show through —
      // reducing opacity keeps the line readable without competing for
      // attention with the label text.
      // Dotted (1 3) rather than dashed so the 5-year rolling women-authorship
      // line reads visually as a subtle trend indicator, not as a data series.
      if (rollingRun.length > 1) svg.appendChild(panelDSvg('polyline', { points: rollingRun.join(' '), fill: 'none', stroke: '#B08D2F', 'stroke-width': '1.6', 'stroke-dasharray': '1 3', 'stroke-linecap': 'round', opacity: '0.7' }));
      rollingRun = [];
    };
    for (let year = yMin; year <= yMax; year++) {
      const share = rollingWomen.get(year);
      if (share == null) { drawRollingRun(); continue; }
      const x = PAD_LEFT + (year - yMin) * bandW + bandW / 2;
      const y = PAD_TOP + plotH * (1 - share);
      rollingRun.push(`${x},${y}`);
    }
    drawRollingRun();

    // Milestone callouts — floating inline in the low-bar whitespace, styled
    // after the mockup. Each callout is a 3-line block anchored to a small
    // colored dot:
    //   Line 1: "YYYY: First male/female PhD/Masters" (year bold+colored)
    //   Line 2: "Dr./Mr./Ms Given Family"
    //   Line 3: "University Name (CC)"
    // Text and titles are pulled from panelDData (see getPanelDData) so they
    // update automatically whenever the Master file refresh promotes a new
    // scholar into a milestone slot.
    const visibleMilestones = panelDData.milestones
      .filter(milestone => milestone.year >= yMin && milestone.year <= yMax)
      .map(milestone => {
        const barTotal = (() => {
          const bucket = perYear.get(milestone.year);
          if (!bucket) return 0;
          return visibleTypes.reduce((sum, type) => sum + (bucket[type] || 0), 0);
        })();
        const barTopY = yZero - yScale(barTotal);
        return { milestone, barTopY };
      })
      .sort((a, b) => a.milestone.year - b.milestone.year);

    // Assign each milestone a y-tier so the labels sit at visibly different
    // heights (echoing the reference mockup where 1963 rides high, 1988 mid,
    // 1994 slightly lower). We use up to 4 tiers spread across the upper 60%
    // of the plot. Then, if a label would overlap the previous one
    // horizontally, lift it one extra tier so callouts stack cleanly.
    // Rough label footprint: labels are now ~3 lines (headline + name + uni),
    // and the uni line is the widest, so we bump the width estimate up.
    const LABEL_W_EST = 220;                       // px, rough label footprint (uni line is widest)
    const LABEL_LINE_H = 12;                       // px per text line (slightly roomier)
    // Label block height scales with the max number of lines actually
    // rendered across visible milestones. Panel D always draws headline +
    // name + uni (3 lines). Milestones whose scholar has any paternal field
    // populated get TWO more lines (paternalTop, paternalBottom) that wrap
    // village + district onto one line and district + statistical region onto the
    // next. To keep tier stacking consistent, we size the block for 5 lines
    // whenever at least one milestone has any paternal data; otherwise we
    // keep the tighter 3-line block.
    const anyPaternalLine = (panelDData.milestones || []).some(m => m && (m.paternalTop || m.paternalBottom));
    const LABEL_LINES = anyPaternalLine ? 5 : 3;
    const LABEL_BLOCK_H = LABEL_LINE_H * LABEL_LINES + 10;
    const MIN_Y = PAD_TOP + 6;
    // Tier 0 is highest (closest to plot top); higher index = lower on page.
    // Confine tiers to the upper ~60% of the plot so they stay in whitespace.
    const TIER_COUNT = 4;
    const tierTop = MIN_Y + LABEL_BLOCK_H;                           // tier-0 baseY
    // Extend tier range further down the plot so callouts sit deeper in
    // whitespace when the block is 5 lines tall — keeps callouts clear of
    // bar tops in the crowded 1990s onwards.
    const tierBot = PAD_TOP + plotH * (anyPaternalLine ? 0.70 : 0.55);
    const tierY = tier => tierTop + (tierBot - tierTop) * (tier / (TIER_COUNT - 1));
    // For each milestone we also decide whether the label anchors LEFT of
    // the dot (default) or RIGHT of it. When a milestone sits in the right
    // portion of the plot the left-anchored label would overflow into the
    // right y-axis / off-canvas; right-anchoring flips the block so it
    // grows leftward instead. Threshold: right half of the plot.
    // The renderer reads `entry.anchor` ("start" or "end") and reorders the
    // headline year token accordingly.
    let prevX = -Infinity, prevTier = -1;
    visibleMilestones.forEach((entry, idx) => {
      const { milestone, barTopY } = entry;
      const x = PAD_LEFT + (milestone.year - yMin) * bandW + bandW / 2;
      // Anchor decision — milestones in the right ~half of the plot use a
      // right-anchored (text-anchor="end") label so text grows leftward and
      // doesn't collide with the right y-axis or overflow the bars themselves.
      // Threshold lowered from 0.65 → 0.50 on 2026-08-23 so the 1994 female-PhD
      // milestone (dot at ~x = 0.54 of plotW when the range starts at 1956)
      // flips to end-anchor and no longer overlaps the 1994 bar.
      const rightAnchor = x > PAD_LEFT + plotW * 0.50;
      entry.anchor = rightAnchor ? 'end' : 'start';
      // Preferred tier: distribute the 1st/2nd/3rd/4th visible milestone
      // across four tiers. Pattern [0, 2, 0, 3] keeps BOTH Master's-thesis
      // milestones (1st and 3rd in year order) on tier 0 so Nayacakalou 1956
      // and Vuki 1987 sit at the same height; the two PhD milestones drop
      // to tiers 2 and 3 so their longer callouts get more clearance from
      // the busy 1990s+ bar tops. Same-tier horizontal collision is still
      // caught by the LABEL_W_EST guard below.
      const zigzag = [0, 2, 0, 3];
      let tier = zigzag[Math.min(idx, zigzag.length - 1)] % TIER_COUNT;
      let baseY = tierY(tier);
      // Push the label down toward the bar only if the bar top is already
      // below the tier (i.e. the tier sits in empty whitespace above the bar
      // — leave it there, don't slam it against a tall bar).
      if (barTopY - 12 < baseY) baseY = Math.min(baseY, Math.max(tierTop, barTopY - 12));
      // Horizontal collision guard: if we're close in x AND close in y to the
      // previous label, pick a different tier (one step further from prevTier).
      if (x - prevX < LABEL_W_EST) {
        // Choose the tier furthest from prevTier that hasn't been used yet.
        let bestTier = tier, bestDist = Math.abs(tier - prevTier);
        for (let t = 0; t < TIER_COUNT; t++) {
          const d = Math.abs(t - prevTier);
          if (d > bestDist) { bestDist = d; bestTier = t; }
        }
        tier = bestTier;
        baseY = tierY(tier);
      }
      // Extra guard: label block bottom must clear the bar top by ≥6px.
      // If not, walk the label upward until it does (bounded by MIN_Y).
      const labelTop = () => baseY - LABEL_BLOCK_H;
      let safety = 8;
      while (safety-- > 0 && baseY > barTopY - 6 && labelTop() > MIN_Y) {
        baseY -= LABEL_LINE_H;
      }
      baseY = Math.max(baseY, MIN_Y + LABEL_BLOCK_H); // never above plot area
      prevX = x; prevTier = tier;
      entry.labelBaseY = baseY;
    });

    visibleMilestones.forEach(({ milestone, labelBaseY, anchor }) => {
      const x = PAD_LEFT + (milestone.year - yMin) * bandW + bandW / 2;
      const isEnd = anchor === 'end';
      // The label block spans [labelBaseY - LABEL_BLOCK_H, labelBaseY].
      // Layout inside (up to 5 lines):
      //   line 1 (headlineY)   — left anchor: "YYYY: First male PhD"
      //                          right anchor: "First male PhD: YYYY"
      //   line 2 (nameY)       — "Dr./Mr./Ms Given Family"
      //   line 3 (uniY)        — "University name (CC)"
      //   line 4 (pat1Y)       — "Village vlg, District District,"
      //   line 5 (pat2Y)       — "District District (Statistical Region)"
      // Lines 4/5 only emit when the scholar has paternal fields populated.
      const topOffset = (LABEL_LINES - 1) * LABEL_LINE_H;
      const headlineY = labelBaseY - topOffset;
      const nameY     = headlineY + LABEL_LINE_H;
      const uniY      = nameY + LABEL_LINE_H;
      const pat1Y     = uniY + LABEL_LINE_H;
      const pat2Y     = pat1Y + LABEL_LINE_H;
      const dotCX = x;
      const dotCY = headlineY - 3;             // dot sits just left/above the headline
      // Text anchor position — to the RIGHT of the dot for left-aligned
      // labels, to the LEFT of the dot for right-aligned labels.
      const textX = isEnd ? x - 7 : x + 7;

      // Thin dashed drop line in the milestone's color, from just below the
      // dot down to the x-axis baseline. Drawn first so it sits underneath
      // any bar it may cross.
      svg.appendChild(panelDSvg('line', {
        x1: dotCX, x2: dotCX,
        y1: dotCY + 4, y2: yZero,
        stroke: milestone.color,
        'stroke-width': '0.9',
        'stroke-dasharray': '2 3',
        opacity: '0.55'
      }));

      // Small colored dot (matches mockup)
      const circle = panelDSvg('circle', { cx: dotCX, cy: dotCY, r: '3.5', fill: milestone.color });
      // Tooltip also honours the public-name privacy rule: never expose
      // the full canonical Scholar Name here, only the shortened
      // 'FirstGiven Family' form (built into milestone.personLine and
      // milestone.publicPerson upstream).
      const tiedScholars = milestone.ties && milestone.ties.length > 1
        ? ` · Tied scholars: ${milestone.ties.map(tie => {
            const fg = (tie.givenNames || '').trim().split(/\s+/)[0] || '';
            return (fg && tie.familyName) ? `${fg} ${tie.familyName}` : (tie.name || '');
          }).join('; ')}` : '';
      const paternalTooltip = milestone.paternalLine ? ` · ${milestone.paternalLine}` : '';
      const tooltipText = `Milestone · ${milestone.label} · ${milestone.year} · ${milestone.personLine || milestone.publicPerson || ''} · ${milestone.degree} · ${milestone.uniLine || milestone.uni}${paternalTooltip}${tiedScholars}`;
      circle.appendChild(panelDSvg('title', {}, tooltipText));
      svg.appendChild(circle);

      // Line 1: headline. Left-anchored form is "YYYY: rest"; right-anchored
      //   flips to "rest: YYYY" so the year lands adjacent to the dot (which
      //   is on the RIGHT edge of the text block when isEnd).
      //   Entire headline is bold. The year token keeps the milestone color;
      //   the rest of the headline is bold in body-text grey.
      const headlineText = panelDSvg('text', {
        x: textX, y: headlineY, 'text-anchor': anchor,
        'font-family': 'Arial', 'font-size': '11', 'font-weight': '700', fill: '#4b5563'
      });
      const rest = milestone.headline || milestone.shortLabel || '';
      if (isEnd) {
        headlineText.appendChild(panelDSvg('tspan', {}, `${rest}: `));
        headlineText.appendChild(panelDSvg('tspan', { fill: milestone.color }, String(milestone.year)));
      } else {
        headlineText.appendChild(panelDSvg('tspan', { fill: milestone.color }, `${milestone.year}: `));
        headlineText.appendChild(panelDSvg('tspan', {}, rest));
      }
      headlineText.appendChild(panelDSvg('title', {}, tooltipText));
      svg.appendChild(headlineText);

      // Line 2: scholar name ("Dr./Mr./Ms Given Family")
      if (milestone.personLine) {
        svg.appendChild(panelDSvg('text', {
          x: textX, y: nameY, 'text-anchor': anchor,
          'font-family': 'Arial', 'font-size': '10', fill: '#111827'
        }, milestone.personLine));
      }

      // Line 3: university name + country code, e.g. "University of London (UK)"
      if (milestone.uniLine) {
        svg.appendChild(panelDSvg('text', {
          x: textX, y: uniY, 'text-anchor': anchor,
          'font-family': 'Arial', 'font-size': '9.5', fill: '#4b5563'
        }, milestone.uniLine));
      }

      // Lines 4 + 5: paternal geography wrapped onto two lines. Rendered in
      // italic dark-olive/green (per Ron's mockup) so the ancestry provenance
      // is visually distinct from the scholarly-institution line above. If
      // Master has no populated paternal fields for this scholar, both
      // strings are '' and nothing is drawn — Panel D never fabricates
      // ancestry data.
      const PATERNAL_FILL = '#4A6A2F'; // dark olive/forest green
      if (milestone.paternalTop) {
        svg.appendChild(panelDSvg('text', {
          x: textX, y: pat1Y, 'text-anchor': anchor,
          'font-family': 'Arial', 'font-size': '9', fill: PATERNAL_FILL, 'font-style': 'italic'
        }, milestone.paternalTop));
      }
      if (milestone.paternalBottom) {
        svg.appendChild(panelDSvg('text', {
          x: textX, y: pat2Y, 'text-anchor': anchor,
          'font-family': 'Arial', 'font-size': '9', fill: PATERNAL_FILL, 'font-style': 'italic'
        }, milestone.paternalBottom));
      }
    });

    // X-axis baseline + tick marks. The baseline runs along yZero from the
    // left axis to the right axis so the plot has a clear frame on both
    // axes. Ticks extend below the baseline like the mockup.
    svg.appendChild(panelDSvg('line', { x1: PAD_LEFT, x2: plotRight, y1: yZero, y2: yZero, stroke: '#6b7280', 'stroke-width': '1' }));
    const span = yMax - yMin + 1;
    const tickStep = span <= 8 ? 1 : span <= 20 ? 2 : span <= 40 ? 5 : 10;
    const firstTick = Math.ceil(yMin / tickStep) * tickStep;
    for (let year = firstTick; year <= yMax; year += tickStep) {
      const x = PAD_LEFT + (year - yMin) * bandW + bandW / 2;
      svg.appendChild(panelDSvg('text', { x, y: H - PAD_BOTTOM + 20, 'text-anchor': 'middle', 'font-family': 'Arial', 'font-size': '12', fill: '#6b7280' }, year));
      svg.appendChild(panelDSvg('line', { x1: x, x2: x, y1: yZero, y2: yZero + 6, stroke: '#6b7280', 'stroke-width': '1' }));
    }
    $$('[data-hist-presets] button').forEach(button => button.classList.toggle('is-active', button.dataset.preset === state.histRange.preset));

    // Milestone institution-rename footnote.
    //
    // Rendered INSIDE the SVG (not in the [data-hist-note] paragraph) so it
    // scales with the chart in the docked view AND survives the fullscreen
    // expand path, which stretches only #db-source-histogram. The SVG
    // viewBox height is grown by exactly the number of footnote lines
    // needed, keeping the plot area unchanged. The general "[data-hist-note]"
    // summary paragraph (written above at ~line 5819) is left in place.
    //
    // The footnote fires when a milestone displays the canonical (C_Uni)
    // institution and that differs from the historical/as-recorded (O_Uni)
    // name, in which case the annotation shows 'Uni*' and this footer
    // records: 'University of Auckland (formerly recorded as University
    // of New Zealand — Auckland University College).' No footer text and
    // no viewBox growth when no milestone triggers the asterisk.
    const renamedMilestones = (panelDData.milestones || []).filter(m => m && m.uniRenamed && m.cUni && m.oUni && m.cUni !== m.oUni);
    const seenPairs = new Set();
    const footnotePairs = renamedMilestones.filter(m => {
      const key = `${m.cUni}||${m.oUni}`;
      if (seenPairs.has(key)) return false;
      seenPairs.add(key); return true;
    });
    if (footnotePairs.length) {
      const FN_LINE_H = 13;                  // px per footnote line inside SVG
      const FN_TOP_GAP = 10;                 // gap above first footnote line
      const growH = FN_LINE_H * footnotePairs.length + FN_TOP_GAP + 4;
      // Extend the SVG viewBox height (and DOM height attr so the docked
      // view actually reserves the pixels; fullscreen CSS uses vh anyway).
      svg.setAttribute('viewBox', `0 0 ${W} ${H + growH}`);
      svg.setAttribute('height', String(H + growH));
      footnotePairs.forEach((m, i) => {
        const y = H + FN_TOP_GAP + i * FN_LINE_H;
        svg.appendChild(panelDSvg('text', {
          x: PAD_LEFT,
          y,
          'text-anchor': 'start',
          'font-family': 'Arial',
          'font-size': '11',
          fill: '#6b7280'
        }, `* ${m.cUni} (formerly recorded as ${m.oUni}).`));
      });
    } else {
      // Reset to the base viewBox/height when no footnote is needed, so a
      // later re-render (e.g. after a Master refresh removes a rename)
      // shrinks the SVG back.
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('height', String(H));
    }
  }

  // Rough text width for SVG legend layout (DM Sans 12px ≈ 6.4 char width)
  function measureTextWidth(text, fontPx) {
    return String(text).length * fontPx * 0.55;
  }

  // Pick a nice round upper bound for a Y axis (e.g. 47 -> 50, 173 -> 200)
  function niceCeil(n) {
    if (n <= 5)   return 5;
    if (n <= 10)  return 10;
    if (n <= 20)  return 20;
    if (n <= 50)  return Math.ceil(n / 5) * 5;
    if (n <= 100) return Math.ceil(n / 10) * 10;
    return Math.ceil(n / 20) * 20;
  }

  // ============ Panel C x-axis range controls ============
  function wireHistControls() {
    const startEl = $('[data-hist-start]');
    const endEl   = $('[data-hist-end]');
    if (!startEl || !endEl) return;

    // Data range for input clamping
    const years = state.snapshot.items.map(i => i.year).filter(y => y);
    const dataMin = years.length ? Math.min(...years) : new Date().getFullYear() - 10;
    const dataMax = years.length ? Math.max(...years) : new Date().getFullYear();

    startEl.min = dataMin; startEl.max = dataMax; startEl.value = dataMin;
    endEl.min   = dataMin; endEl.max   = dataMax; endEl.value   = dataMax;

    let debounce = null;
    const applyFromInputs = () => {
      const s = parseInt(startEl.value, 10);
      const e = parseInt(endEl.value, 10);
      if (isNaN(s) || isNaN(e)) return;
      state.histRange.start = Math.max(dataMin, Math.min(dataMax, s));
      state.histRange.end   = Math.max(dataMin, Math.min(dataMax, e));
      state.histRange.preset = '';  // custom range
      renderHistogram();
    };
    [startEl, endEl].forEach(el => {
      el.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(applyFromInputs, 200);
      });
      el.addEventListener('change', applyFromInputs);
    });

    // Preset chips (All / Last 25 / 10 / 5)
    const currentYear = dataMax;
    $$('[data-hist-presets] button').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.preset;
        if (p === 'all') {
          state.histRange = { start: null, end: null, preset: 'all' };
        } else {
          const yrs = parseInt(p, 10);
          state.histRange = {
            start: Math.max(dataMin, currentYear - yrs + 1),
            end: currentYear,
            preset: p
          };
        }
        renderHistogram();
      });
    });

    // Reset link — clears every Panel D filter back to its default so users
    // can recover from any combination of author-mode / type / timeframe
    // tweaks in one click. Defaults: authors = 'lead' (Samoan lead), types =
    // all checked, timeframe = All. Also reflects the state change in the DOM
    // so the tab pills and checkboxes visually snap back into place.
    const resetBtn = $('[data-hist-reset]');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      // 1. Authors filter → 'lead'
      state.histAuthors = 'lead';
      const authorTabs = document.querySelectorAll('[data-hist-authors-tabs] [data-hist-authors]');
      authorTabs.forEach(tab => {
        const active = tab.dataset.histAuthors === 'lead';
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.setAttribute('tabindex', active ? '0' : '-1');
      });
      // 2. Types → all checked (respect TYPE_ORDER)
      state.histTypeSet = new Set(TYPE_ORDER);
      const typeBoxes = document.querySelectorAll('[data-hist-type-filter] input[type="checkbox"]');
      typeBoxes.forEach(box => { box.checked = true; });
      // 3. Timeframe → All (also clears preset button active state via renderHistogram)
      state.histRange = { start: null, end: null, preset: 'all' };
      renderHistogram();
    });

    // Fullscreen expand / close for Panel D chart. Toggles .is-fullscreen on
    // the wrapper (CSS pins it to the viewport) and locks body scroll while
    // active. Escape key also closes. The SVG is viewBox-based, so it scales
    // naturally; renderHistogram doesn't need re-running — but we re-render
    // anyway to give the layout a chance to reflow at the larger size.
    const chartWrap = document.querySelector('[data-panel-d-chart]');
    const expandBtn = document.querySelector('[data-panel-d-expand]');
    const closeBtn = document.querySelector('[data-panel-d-close]');
    // Track the legend's original DOM position so we can restore it on exit.
    // We MOVE the same node into the fullscreen container (rather than clone)
    // so its existing event listeners and checkbox state stay intact.
    const typeFilter = document.querySelector('[data-hist-type-filter]');
    let typeFilterPlaceholder = null;
    const enterFullscreen = () => {
      if (!chartWrap) return;
      if (typeFilter && !typeFilterPlaceholder) {
        typeFilterPlaceholder = document.createComment('db-panel-d-type-filter-slot');
        typeFilter.parentNode.insertBefore(typeFilterPlaceholder, typeFilter);
        // Insert the legend as the first child of the chart wrap so it sits
        // above the SVG in fullscreen.
        chartWrap.insertBefore(typeFilter, chartWrap.firstChild);
      }
      chartWrap.classList.add('is-fullscreen');
      document.body.classList.add('db-panel-d-fs-lock');
      renderHistogram();
    };
    const exitFullscreen = () => {
      if (!chartWrap) return;
      chartWrap.classList.remove('is-fullscreen');
      document.body.classList.remove('db-panel-d-fs-lock');
      if (typeFilter && typeFilterPlaceholder && typeFilterPlaceholder.parentNode) {
        typeFilterPlaceholder.parentNode.insertBefore(typeFilter, typeFilterPlaceholder);
        typeFilterPlaceholder.parentNode.removeChild(typeFilterPlaceholder);
        typeFilterPlaceholder = null;
      }
      renderHistogram();
    };
    if (expandBtn) expandBtn.addEventListener('click', enterFullscreen);
    if (closeBtn) closeBtn.addEventListener('click', exitFullscreen);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && chartWrap && chartWrap.classList.contains('is-fullscreen')) exitFullscreen();
    });
    // The author-mode default can have a narrower range than all publications;
    // redraw once after this wiring has initialized the input fields so Panel D
    // immediately shows the same resolved range in both places.
    renderHistogram();
  }
  function populateDecadeSelect(y0, y1) {
    const sel = $('[data-db-filter="decade"]');
    if (!sel || sel.dataset.built === '1') return;
    const decades = [];
    for (let y = Math.floor(y0/10)*10; y <= y1; y += 10) decades.push(y);
    decades.reverse().forEach(d => {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = `${d}s`;
      sel.appendChild(opt);
    });
    sel.dataset.built = '1';
    if (state.filter.decade) sel.value = state.filter.decade;
  }
  function populateDisciplineSelect() {
    const sel = $('[data-db-filter="discipline"]');
    if (!sel || sel.dataset.built === '1') return;
    disciplineEntries.forEach(([name]) => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.dataset.built = '1';
    if (state.filter.discipline) sel.value = state.filter.discipline;
  }

  // ============ SCHOLAR CARDS (paginated, image-4 style) ============
  const SCHOLAR_PAGE_SIZE = 20;
  state.scholarPage = 1;
  state.scholarConfFilter = '';  // '', '__untagged__', 'Rest of Upolu', 'Apia Urban Area', 'North West Upolu'
  state.scholarProvFilter = '';  // '', '__untagged__', or a district name
  state.scholarNameSearch = '';  // free-text name search (case-insensitive substring)
  state.scholarKeywordSearch = ''; // research-keyword search across insights + publications
  state.scholarSectorFilter = ''; // '' or one of SECTORS
  state.scholarDisciplineFilter = new Set();  // AND across checked disciplines
  state.scholarStudyCountry = '';  // country selected in the Study combo
  state.scholarStudyUni = '';      // optional narrower selection within that country
  state.scholarWorkCountry = '';   // country selected in the Work combo
  state.scholarWorkUni = '';       // optional narrower selection within that country
  // Samoa-native six-dimension geography filter slots (Session 4). Each is
  // '', a domain-specific value, or '__unrecorded__' meaning "blank in the
  // source". Values are never inferred: a scholar with a Village on record
  // but no Itūmālō appears when Village is filtered but does NOT appear
  // when Itūmālō is filtered to anything except '__unrecorded__'.
  state.scholarVillageFilter = '';       // '' | V-#### composite id | plain village name | '__unrecorded__'
  state.scholarIslandFilter = '';        // '' | Upolu | Manono | Apolima | Savai‘i | '__unrecorded__'
  state.scholarItumaloFilter = '';       // '' | one of 11 constitutional Itūmālō | '__unrecorded__'
  state.scholarConstituencyFilter = '';  // '' | version-namespaced constituency | '__unrecorded__'
  // Panel G citation-format toggle. Governs both the per-item Copy-cite
  // button and the Citation column in Export .csv.
  state.citationFormat = 'apa';          // 'apa' | 'chicago' | 'mla'
  // Cache: scholar name → Set<discipline>. Populated lazily on first renderLeaders.
  state.scholarDisciplines = null;

  // Placeholder silhouette shown when no photo is provided
  const PHOTO_PLACEHOLDER_SVG = `
    <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="50" cy="40" r="22" fill="#b6bcc2"/>
      <path d="M12 120 C 12 85, 88 85, 88 120 Z" fill="#b6bcc2"/>
    </svg>`;

  // District groupings per statistical region — used to rebuild the district dropdown
  // when the statistical region dropdown changes.
  // The 14 Samoan districts grouped by chiefly region.
  // Sourced from samoa-districts.geojson (each feature has a `statistical region`
  // property). Ra is part of Apia Urban Area — previously missed.
  const CONFEDERACY_PROVINCES = {
    'Rest of Upolu': ['Kadavu', 'Nadroga/Navosa', 'Namosi', 'Rewa', 'Serua'],
    'Apia Urban Area':     ['Ba', 'Lomaiviti', 'Naitasiri', 'Ra', 'Tailevu'],
    'North West Upolu':     ['Bua', 'Cakaudrove', 'Lau', 'Macuata']
  };

  // World-map Region › Country grouping. Regions are ordered so the Pacific
  // (Ron's home region and the largest cohort) sits at the top of the
  // dropdown. Every country present in graduate-studies.worldPoints must
  // appear here — the render code silently drops any region whose countries
  // aren't in the current dataset (so a region with 0 countries never shows
  // a stale entry).
  // Fallback region→country map. Only used when worldPoints[].region is
  // missing (older data files). Source of truth is COUNTRY_REGION in
  // data/refresh-graduate-studies.py. This copy is kept in sync so that
  // ordering and grouping still work if the workflow ever emits a
  // pre-region-field snapshot.
  const WORLD_REGIONS = {
    Pacific:         ['Samoa', 'Australia', 'New Zealand', 'Papua New Guinea'],
    Asia:            ['China', 'India', 'Indonesia', 'Japan', 'Philippines', 'South Korea'],
    Europe:          ['UK', 'Germany', 'Sweden', 'Portugal', 'Malta'],
    'North America': ['USA', 'Canada']
  };

  // =========================================================================
  // FILTER TAXONOMY — sectors + disciplines
  // Both lists are kept in strict alphabetical order so users always find
  // items in a predictable spot in the dropdowns. Additions must slot in
  // alphabetically here AND in the admin form to stay in sync.
  // =========================================================================
  const SECTORS = [
    'Academia',
    'Government',
    'International Organisation',
    'Non-Government / Civil Society',
    'Private Sector'
  ];

  const DISCIPLINES = [
    'Anthropology & Social Studies',
    'Archaeology & Heritage',
    'Business, Economics & Accounting',
    'Education & Pedagogy',
    'Health & Medicine',
    'Indigenous Knowledge & Culture',
    'Land, Water & Sanitation',
    'Marine & Environmental Science',
    'Physical & Applied Sciences',
    'Politics & Governance'
  ];

  // Rule-based classifier: each pattern that matches against a scholar's
  // combined text (keywords + institution + department + title) adds that
  // discipline. A scholar can belong to multiple. Rules are intentionally
  // broad so scholars with sparse keywords still get at least one bucket.
  const DISCIPLINE_RULES = [
    ['Anthropology & Social Studies',      /(anthropol|ethnograph|sociolog|social studies|social work|kinship|solidarity|solesolevaki|talanoa|talanoa methodology|indigenous research method|street[- ]frequenting|informal settlement|wellbeing|youth research|community-based research|gender|feminis|disability)/i],
    ['Archaeology & Heritage',             /(archaeolog|lapita|hillfort|prehistor|cultural heritage|heritage documentation|ceramic|bourewa|vanished island)/i],
    ['Business, Economics & Accounting',   /(account|economic|business|enterprise|labour|labor|market|value chain|trade|sugar tax|sugar-sweetened beverage tax|food trade|tourism\b|tourist|hospitality|land bank|land back|sovereign wealth|poverty alleviation)/i],
    ['Education & Pedagogy',               /(educat|pedagog|curriculum|literacy|school\b|university\b|higher education|early childhood|teacher|student|youth (empowerment|advoca|political|mental))/i],
    ['Health & Medicine',                  /(health|medicine|medical|hospital|antimicrobial|antibiotic|carbapenem|acinetobacter|typhoid|malaria|diabetes|diabetic|obesity|obes\b|kava\b|ptsd|mental|non[- ]communicable|ncd\b|clinical|epidemiolog|nutrition|glycaemic|glycemic|maternal|filaria|dental|ciguatera|substance|pharmaceutical|drug discovery|drug development|antiparasitic|antimalar|antioxidant|body image)/i],
    ['Indigenous Knowledge & Culture',     /(fa'a\s?samoa|faasamoa|samoan|indigenous knowledge|indigenous samoan|traditional (knowledge|practice|ecological|resource|medicine)|customary|storytelling|oral tradition|indigenous educ|indigenous methodolog|decolonis|decoloniz|cultural (identity|value|belief|loss|practice)|matai\b|aiga\b|nu'u\b|tofi\b|feagaiga|talanoa|funeral|funerary|kava (drink|circle|ceremonial))/i],
    ['Land, Water & Sanitation',           /(sanitation|water quality|drinking water|watershed|wash\b|faecal|latrine|septic|hygiene|water resource|water governance|blue carbon\b|mangrove|freshwater|river|catchment|coastal water|land tenure|land right|customary land|land trust|land bank|land back)/i],
    ['Marine & Environmental Science',     /(marine|coral|reef|ocean|fishery|fisher|fisherwoman|fisherwomen|lmma|locally managed marine|mangrove|coastal|blue economy|blue carbon|sea cucumber|octopus|clam\b|hawksbill|turtle|natural product|biodiscover|biodivers|ecolog|environment|ecosystem|climate|conservation|invasive|forest|habitat|species|entomol|beetle|damselfly|herpetofauna|avifauna|freshwater fish|aquaculture|larvicultur|rotifer|sponge)/i],
    ['Physical & Applied Sciences',        /(chemistry|chemical|electrochem|biosensor|nanoparticle|arsenic|polyaniline|redox|forensic|spectrometr|ion mobility|whole genome sequencing|genomic surveillance|molecular epidemiolog)/i],
    ['Politics & Governance',              /(political|politics|governance|policy|coup|colonial|postcolonial|settler|sovereignty|affirmative action|ethnicity|ethnic conflict|regionalism|internet censorship|social media (and|activism|election)|advocacy|foreign aid|aid decolonis|diplomacy|human rights|constitutional|climate mobility|marine spatial planning|ocean governance|community-based (fisheries|marine) management|water governance)/i]
  ];

  // Build a case-insensitive searchable text blob per scholar for the
  // "Search by research keyword" input. Combines:
  //   • AI-generated insight keywords + summary (plain text)
  //   • Profile fields: institution, department, title
  //   • Every publication authored by that scholar: title,
  //     publicationTitle (journal/publisher), and Zotero tags
  // Keyed by the scholar name as it appears on the row (Zotero-collection
  // "Last, First" form). Rebuilt on demand so it always reflects the
  // latest scholar-insights + Zotero snapshot.
  function buildScholarKeywordText(rows, enrichedByName) {
    const out = new Map();
    const items = (state.snapshot && state.snapshot.items) || [];
    // Reverse index: scholar name -> concatenated publication text.
    const pubTextByName = new Map();
    items.forEach(it => {
      const scholars = state.scholarByItem && state.scholarByItem.get(it.key);
      if (!scholars || !scholars.size) return;
      const bits = [];
      if (it.title) bits.push(it.title);
      if (it.publicationTitle) bits.push(it.publicationTitle);
      if (it.university) bits.push(it.university);
      if (Array.isArray(it.tags) && it.tags.length) bits.push(it.tags.join(' '));
      if (!bits.length) return;
      const text = ' ' + bits.join(' \u2022 ').toLowerCase();
      scholars.forEach(name => {
        pubTextByName.set(name, (pubTextByName.get(name) || '') + text);
      });
    });
    rows.forEach(r => {
      const bits = [];
      const ins = (state.scholarInsights || {})[r.name] || null;
      if (ins) {
        if (Array.isArray(ins.keywords)) bits.push(ins.keywords.join(' '));
        if (ins.summary) bits.push(ins.summary.replace(/<[^>]*>/g, ' '));
      }
      const prof = enrichedByName.get(r.name) || {};
      ['institution', 'department', 'title'].forEach(k => { if (prof[k]) bits.push(prof[k]); });
      const pubText = pubTextByName.get(r.name) || '';
      const combined = (bits.join(' \u2022 ') + ' ' + pubText).toLowerCase();
      out.set(r.name, combined);
    });
    return out;
  }

  function classifyScholarDisciplines(row, insight, profile) {
    const bits = [];
    if (insight && Array.isArray(insight.keywords)) bits.push(...insight.keywords);
    if (insight && insight.summary) bits.push(insight.summary.replace(/<[^>]*>/g, ' '));
    if (profile) {
      ['institution', 'department', 'title'].forEach(k => { if (profile[k]) bits.push(profile[k]); });
    }
    const text = bits.join(' \u2022 ');
    const out = new Set();
    if (!text.trim()) return out;
    for (const [name, pattern] of DISCIPLINE_RULES) {
      if (pattern.test(text)) out.add(name);
    }
    return out;
  }

  // Set of scholar names whose card is currently visible under the statistical region/
  // district dropdowns at the top of the leaderboard. Also used by the item
  // list at the bottom so "filter to Ra" narrows both the cards AND the
  // publications shown below.
  state.scholarFilterNames = null; // null = no dropdown filter active

  function computeScholarFilterNames() {
    const conf = state.scholarConfFilter;
    const prov = state.scholarProvFilter;
    if (!conf && !prov) { state.scholarFilterNames = null; return; }

    const provConf = new Map();
    if (state.districts && state.districts.features) {
      state.districts.features.forEach(f => provConf.set(f.properties.name, f.properties.region));
    }

    const names = new Set();
    (state.scholarProfilesByName || new Map()).forEach((profile, name) => {
      const p = effectivePaternalProvince(profile);
      const c = p ? (provConf.get(p) || '') : '';

      // Statistical Region check
      if (conf === '__untagged__') {
        if (c) return;
      } else if (conf) {
        if (c !== conf) return;
      }
      // District check
      if (prov === '__untagged__') {
        if (p) return;
      } else if (prov) {
        if (p !== prov) return;
      }
      names.add(name);
    });
    // Also allow scholar names that exist in Zotero collections but have no
    // profile at all — they count as "untagged" for both dropdowns.
    if ((conf === '__untagged__' || !conf) && (prov === '__untagged__' || !prov)) {
      const enriched = state.scholarProfilesByName || new Map();
      state.snapshot.collections.forEach(c => {
        const root = findItaukeiRootCollection(state.snapshot.collections);
        if (!root || c.parent !== root.key) return;
        if (!enriched.has(c.name)) names.add(c.name);
      });
    }
    state.scholarFilterNames = names;
  }

  function wireScholarFilters() {
    const confSel = $('[data-scholar-conf-filter]');
    const provSel = $('[data-scholar-prov-filter]');
    if (!confSel || !provSel) return;

    // Rebuild the district dropdown options based on the currently-selected
    // statistical region (or show all districts if 'All statistical regions' is chosen).
    function rebuildProvinceOptions() {
      const conf = state.scholarConfFilter;
      // Preserve the selected value if it's still valid
      const prevProv = state.scholarProvFilter;
      let districts;
      if (!conf || conf === '__untagged__') {
        districts = Object.values(CONFEDERACY_PROVINCES).flat().sort();
      } else {
        districts = (CONFEDERACY_PROVINCES[conf] || []).slice().sort();
      }
      // Build options: All, Untagged, then each district
      provSel.innerHTML =
        '<option value="">All districts</option>' +
        '<option value="__untagged__">Untagged (no district)</option>' +
        districts.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
      // Restore selection if still available; otherwise reset to All
      if (prevProv && (prevProv === '__untagged__' || districts.includes(prevProv))) {
        provSel.value = prevProv;
      } else {
        provSel.value = '';
        state.scholarProvFilter = '';
      }
    }
    // Initial build so the district list starts with all 14 districts
    rebuildProvinceOptions();

    confSel.addEventListener('change', () => {
      state.scholarConfFilter = confSel.value;
      state.scholarPage = 1;
      rebuildProvinceOptions();
      computeScholarFilterNames();
      renderLeaders();
      renderItems();
      renderFilterChips();
      updateClearAllButton();
    });
    provSel.addEventListener('change', () => {
      state.scholarProvFilter = provSel.value;
      state.scholarPage = 1;
      computeScholarFilterNames();
      renderLeaders();
      renderItems();
      renderFilterChips();
      updateClearAllButton();
    });
  }

  function renderLeaders() {
    const grid = $('[data-db-leaders]');
    if (!grid) return;

    // District → statistical region map (from samoa-districts.geojson) so we can
    // classify each scholar's paternal district into a region.
    const provConf = new Map();
    if (state.districts && state.districts.features) {
      state.districts.features.forEach(f => provConf.set(f.properties.name, f.properties.region));
    }

    // Build the sorted, enriched scholar list. Enrichment comes from
    // data/scholar-profiles.json (loaded once during init). If a profile row is
    // missing we still render the card using derived counts.
    const derived = deriveScholarRows();
    const enrichedByName = state.scholarProfilesByName || new Map();
    const hidden = state.hiddenScholars || new Set();
    // Count the visible (non-hidden) scholars BEFORE any filters are applied.
    // The Statistical Region Total pill uses this to show "N of M" once a filter narrows
    // the result set. Hidden scholars are excluded from both numerator and
    // denominator so the ratio stays meaningful.
    const unfilteredTotal = derived.filter(r => !hidden.has(r.name)).length;

    // CANONICAL COUNT OVERRIDE (2026-08 rebuild):
    // Publication counts + first-authorship are derived directly from the
    // Master `Authorship` table via SamoaScholarDatabaseAdapter.computePublicationTotals.
    // This replaces the legacy Zotero-collection based counter (which was
    // deriving first-authorship from `creators[0]` and drifting when non-
    // Samoan co-authors were dropped). Rows without a resolvable Scholar ID
    // keep the derived counts as a graceful fallback.
    const _canonAdapter = state.masterAdapter;
    const _canonMaster  = state.master;
    function _scholarIdFor(row) {
      if (row && row.scholarId) return row.scholarId;
      const prof = enrichedByName.get(row.name);
      return prof && prof.scholarId ? prof.scholarId : null;
    }
    let rows = derived
      .filter(r => !hidden.has(r.name))
      .map(r => {
        // Merge order matters: enrichment (village, institution, photo, etc.)
        // sits UNDERNEATH the Zotero-derived counts, THEN the Master canonical
        // counts override those. This preserves enrichment (photo, village,
        // institution) while forcing Master `Authorship` to be authoritative
        // for `total` / `firstAuthored` / `types`.
        const enrichment = enrichedByName.get(r.name) || {};
        const enriched = Object.assign({}, enrichment, r);

        const sid = _scholarIdFor(enriched);
        if (sid && _canonAdapter && typeof _canonAdapter.computePublicationTotals === 'function' && _canonMaster) {
          // Pass excludePreprints:true AND excludeDocuments:true so total,
          // firstAuthored, and both types buckets are net of preprints and
          // documents. Preprints are globally excluded from every V2
          // dashboard metric (2026-08-24 Ron directive). Documents
          // (Master 'Publication Type' = 'Others' / 'Other' or any
          // unrecognised value) lack enough metadata to be credibly counted
          // as a publication and are excluded from all V2 counts and
          // tallies (2026-08-24 Ron directive, second). Reclassifying the
          // Master row to a known type reinstates the count automatically.
          // The Master Authorship + Publications tables are untouched.
          const canon = _canonAdapter.computePublicationTotals(_canonMaster, sid, {
            excludePreprints: true,
            excludeDocuments: true
          });
          enriched.scholarId = sid;
          enriched.total = canon.total;
          enriched.firstAuthored = canon.firstAuthored;
          // Map canonical types tally onto Panel F chip buckets.
          //   - `document` is intentionally excluded from Panel F chips
          //     (matches legacy behaviour).
          //   - `conferencePaper` is force-zeroed — Panel F never shows
          //     conference papers (global filter, July 2026 directive).
          //   - `preprint` is force-zeroed — preprints are globally
          //     excluded from V2 (2026-08-24 directive). The adapter
          //     also returns 0 here when excludePreprints:true, so this
          //     is belt-and-suspenders.
          enriched.types = {
            journalArticle: canon.types.journalArticle,
            thesisPhd:      canon.types.thesisPhd,
            thesisMasters:  canon.types.thesisMasters,
            thesisUnknown:  canon.types.thesisUnknown,
            bookSection:    canon.types.bookSection,
            book:           canon.types.book,
            report:         canon.types.report,
            conferencePaper: 0,
            preprint:       0
          };
          enriched._authorshipGap = canon.gap;
        }

        enriched._prov = effectivePaternalProvince(enrichment);
        enriched._conf = enriched._prov ? (provConf.get(enriched._prov) || '') : '';
        return enriched;
      })
      // Scholar-card leaderboard sort order (see docs/NAMES-DO-NOT-MERGE.md
      // “Scholar-card ordering rule”):
      //   1. total publications descending,
      //   2. first-authored publications descending (tiebreaker),
      //   3. canonical name ascending (final deterministic fallback — never
      //      the primary tiebreaker; alphabet order must not decide ranking
      //      when two scholars have the same total).
      .sort((a, b) => {
        const totalDiff = (Number(b.total) || 0) - (Number(a.total) || 0);
        if (totalDiff) return totalDiff;
        const firstDiff = (Number(b.firstAuthored) || 0) - (Number(a.firstAuthored) || 0);
        if (firstDiff) return firstDiff;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

    // Populate the disciplines cache once. Uses keyword pills + institution
    // + department + title for each scholar. Rebuilt on every render so a
    // scholar-insights hot-reload (e.g. after Ron accepts a submission) picks
    // up the new classification without a page refresh.
    const disciplineByName = new Map();
    rows.forEach(r => {
      const ins = (state.scholarInsights || {})[r.name] || null;
      const prof = enrichedByName.get(r.name) || null;
      disciplineByName.set(r.name, classifyScholarDisciplines(r, ins, prof));
    });
    state.scholarDisciplines = disciplineByName;

    // ------- Filter cascade (AND across every filter) -------
    // Statistical Region
    const confF = state.scholarConfFilter;
    if (confF === '__untagged__') {
      rows = rows.filter(r => !r._conf);
    } else if (confF) {
      rows = rows.filter(r => r._conf === confF);
    }
    // District
    const provF = state.scholarProvFilter;
    if (provF === '__untagged__') {
      rows = rows.filter(r => !r._prov);
    } else if (provF) {
      rows = rows.filter(r => r._prov === provF);
    }
    // Name search (case-insensitive substring; matches "Last, First" AND "First Last")
    const nameQ = (state.scholarNameSearch || '').trim().toLowerCase();
    if (nameQ) {
      rows = rows.filter(r => {
        const nm = (r.name || '').toLowerCase();
        const [last, first] = (r.name || '').split(',').map(s => (s || '').trim());
        const alt = first && last ? `${first} ${last}`.toLowerCase() : '';
        return nm.includes(nameQ) || alt.includes(nameQ);
      });
    }
    // Research-keyword search — scans across the AI-generated insight
    // (keywords + plain-English summary), profile fields (institution,
    // department, title), and every publication a scholar authored
    // (title + journal/publisher + tags). Case-insensitive substring so
    // "funeral" surfaces work on funerary practices, "systematic literature
    // review" surfaces SLR authors, etc.
    const kwQ = (state.scholarKeywordSearch || '').trim().toLowerCase();
    if (kwQ) {
      const kwTextByName = buildScholarKeywordText(rows, enrichedByName);
      rows = rows.filter(r => {
        const blob = kwTextByName.get(r.name) || '';
        return blob.includes(kwQ);
      });
    }
    // Sector — matched on the profile's sector field (auto-seeded in admin)
    const secF = state.scholarSectorFilter;
    if (secF) {
      rows = rows.filter(r => {
        const p = enrichedByName.get(r.name) || {};
        return (p.sector || '') === secF;
      });
    }
    // Disciplines — AND across every checked discipline (must sit in ALL)
    if (state.scholarDisciplineFilter && state.scholarDisciplineFilter.size) {
      const wanted = state.scholarDisciplineFilter;
      rows = rows.filter(r => {
        const has = disciplineByName.get(r.name) || new Set();
        for (const w of wanted) if (!has.has(w)) return false;
        return true;
      });
    }
    // Country/University of study
    if (state.scholarStudyCountry) {
      const wantC = state.scholarStudyCountry;
      const wantU = state.scholarStudyUni;
      rows = rows.filter(r => {
        const p = enrichedByName.get(r.name) || {};
        const items = [p.masters, p.phd].filter(Boolean);
        return items.some(g => g.country === wantC && (!wantU || g.university === wantU));
      });
    }
    // Country/University of work — use scholarWorkCountry() which falls back
    // to institution-string parsing when institutionCountry is not yet set.
    // University comparison strips any " (Country)" suffix on both sides so
    // the filter matches regardless of whether the admin entered the country
    // suffix in the institution field for card display purposes.
    if (state.scholarWorkCountry) {
      const wantC = state.scholarWorkCountry;
      const wantU = state.scholarWorkUni;
      rows = rows.filter(r => {
        const p = enrichedByName.get(r.name) || {};
        return scholarWorkCountry(p) === wantC
            && (!wantU || stripCountrySuffix(p.institution || '') === wantU);
      });
    }

    // Samoa-native six-dimension geography filters. Independent of each
    // other and independent of Statistical Region / Political-Census
    // District (which live in state.scholarConfFilter / scholarProvFilter
    // above). A scholar with a Village on record but no Itūmālō, or an
    // Electoral Constituency but no Specific Island, is NOT inferred to
    // sit inside another dimension. Filter values are:
    //   - Village: composite V-#### id from SBS Village Directory,
    //     OR the sentinel '__unrecorded__' meaning "village blank".
    //   - Specific Island: 'Upolu' | 'Manono' | 'Apolima' | 'Savai‘i',
    //     OR '__unrecorded__' meaning "blank in SBS row".
    //   - Itūmālō: one of the 11 constitutional Second-Schedule names.
    //   - Constituency: version-namespaced string, e.g. '2019-Act:Aana Alofi 1'
    //     or 'Pre-2019:Aʻana Alofi 1'.
    if (state.scholarVillageFilter) {
      const want = state.scholarVillageFilter;
      rows = rows.filter(r => {
        const p = enrichedByName.get(r.name) || {};
        if (want === '__unrecorded__') return !p.villageId && !p.village;
        return p.villageId === want || p.village === want;
      });
    }
    if (state.scholarIslandFilter) {
      const want = state.scholarIslandFilter;
      rows = rows.filter(r => {
        const p = enrichedByName.get(r.name) || {};
        const isl = p.specificIsland || '';
        if (want === '__unrecorded__') return !isl || isl === 'SPECIFIC_ISLAND_UNSURE';
        return isl === want;
      });
    }
    if (state.scholarItumaloFilter) {
      const want = state.scholarItumaloFilter;
      rows = rows.filter(r => {
        const p = enrichedByName.get(r.name) || {};
        if (want === '__unrecorded__') return !p.itumalo;
        return p.itumalo === want;
      });
    }
    if (state.scholarConstituencyFilter) {
      const want = state.scholarConstituencyFilter;
      rows = rows.filter(r => {
        const p = enrichedByName.get(r.name) || {};
        if (want === '__unrecorded__') return !p.constituency;
        return p.constituency === want;
      });
    }

    // Recompute the statistical region breakdown counts for the summary bar based on
    // the CURRENTLY-visible scholar set. Called after filtering so counts
    // always reflect what the user is actually looking at.
    renderScholarSummary(rows, unfilteredTotal);

    // ------- Feed Panel G (All items) with the filtered scholar set -------
    // Any active Panel F filter (name search, keyword search, sector,
    // discipline, region, district, country/uni of study or work)
    // narrows Panel G to publications authored by the currently-visible
    // scholars — so "funeral" in the keyword box also shrinks the item
    // list below to work on funerals. Panel G's own filters (title
    // search, item-type, discipline, decade) still layer on top.
    if (anyScholarFilterActive()) {
      const namesSet = new Set();
      rows.forEach(r => namesSet.add(r.name));
      state.scholarFilterNames = namesSet;
    } else {
      state.scholarFilterNames = null;
    }
    // Panel G "Filtered" chip visibility is driven by refreshFilteredBadges().
    try { refreshFilteredBadges(); } catch (e) {}
    try { renderItems && renderItems(); } catch (e) {}

    // Pagination state (10 per page)
    const totalPages = Math.max(1, Math.ceil(rows.length / SCHOLAR_PAGE_SIZE));
    if (state.scholarPage > totalPages) state.scholarPage = totalPages;
    const start = (state.scholarPage - 1) * SCHOLAR_PAGE_SIZE;
    const pageRows = rows.slice(start, start + SCHOLAR_PAGE_SIZE);

    grid.innerHTML = '';
    pageRows.forEach(r => grid.appendChild(renderScholarCard(r)));
    renderScholarPager(rows.length, totalPages);
  }

  // ============================================================
  //  Summary bar — counts per statistical region on the CURRENT filter result
  // ============================================================
  // Any scholar filter active? Used to decide whether the Statistical Region Total
  // pill shows "Total: N" (unfiltered) or "Total: N of M" (filtered).
  function anyScholarFilterActive() {
    return !!(state.scholarNameSearch && state.scholarNameSearch.trim())
        || !!(state.scholarKeywordSearch && state.scholarKeywordSearch.trim())
        || !!state.scholarConfFilter
        || !!state.scholarProvFilter
        || !!state.scholarSectorFilter
        || (state.scholarDisciplineFilter && state.scholarDisciplineFilter.size > 0)
        || !!state.scholarStudyCountry || !!state.scholarStudyUni
        || !!state.scholarWorkCountry  || !!state.scholarWorkUni
        || !!state.scholarVillageFilter
        || !!state.scholarIslandFilter
        || !!state.scholarItumaloFilter
        || !!state.scholarConstituencyFilter;
  }

  function renderScholarSummary(rows, unfilteredTotal) {
    const bar = document.querySelector('[data-scholar-summary]');
    if (!bar) return;
    const counts = { 'Apia Urban Area': 0, 'North West Upolu': 0, 'Rest of Upolu': 0, Unclassified: 0 };
    (rows || []).forEach(r => {
      const c = r._conf;
      if (c && counts[c] != null) counts[c] += 1;
      else counts.Unclassified += 1;
    });
    const total = (rows || []).length;
    // Statistical Region Total pill:
    //   unfiltered  → "Total: N"
    //   filter live → "Total: matched of full" (e.g. "32 of 143")
    // Publications Total NEVER uses this pattern (see below).
    const totalEl = bar.querySelector('[data-count-total]');
    if (totalEl) {
      if (typeof unfilteredTotal === 'number' && anyScholarFilterActive() && unfilteredTotal !== total) {
        totalEl.textContent = `${total} of ${unfilteredTotal}`;
      } else {
        totalEl.textContent = String(total);
      }
    }
    bar.querySelector('[data-count-apia]').textContent = String(counts['Apia Urban Area']);
    bar.querySelector('[data-count-nwupolu]').textContent = String(counts['North West Upolu']);
    bar.querySelector('[data-count-rupolu]').textContent = String(counts['Rest of Upolu']);
    bar.querySelector('[data-count-unclass]').textContent = String(counts.Unclassified);

    // Reorder Apia Urban Area/North West Upolu/Rest of Upolu chips by count descending, tie-broken
    // alphabetically by statistical region name. Unclassified is anchored to the end
    // of the row regardless of its count (it isn't a region, so it never
    // enters the ranked sequence). Order recomputes on every render.
    const chipsHost = bar.querySelector('[data-scholar-summary-chips]');
    if (chipsHost) {
      const CONFED = ['Apia Urban Area', 'North West Upolu', 'Rest of Upolu'];
      const ranked = CONFED.slice().sort((a, b) => {
        const diff = counts[b] - counts[a];
        return diff !== 0 ? diff : a.localeCompare(b);
      });
      // Total pill stays as the first chip.
      ranked.forEach(name => {
        const chip = chipsHost.querySelector(`[data-conf-chip="${name}"]`);
        if (chip) chipsHost.appendChild(chip); // moves to end — keeps ranked order
      });
      const unclass = chipsHost.querySelector('[data-conf-chip="Unclassified"]');
      if (unclass) chipsHost.appendChild(unclass); // always last
    }

    // ---- Results II — sum publication types across the shown scholars ----
    // Each scholar row already carries a `types` object built by
    // deriveScholarRows(). We aggregate them and only show chips for
    // publication types that have at least one entry in the current filter.
    const barII = document.querySelector('[data-scholar-summary-ii]');
    if (!barII) return;
    // 'thesisUnknown' is intentionally excluded per Ron's directive —
    // "Thesis (unspecified)" is never surfaced on the public dashboard.
    // 'preprint' is intentionally excluded per Ron's 2026-08-24 directive —
    // preprints must not appear in the Panel F header summary strip (or any
    // other V2 display). Preprints remain intact in the Master file.
    // 'conferencePaper' stays here only as a defensive bucket — the load-time
    // filter drops them before this code ever runs.
    const pub = {
      thesisPhd: 0, thesisMasters: 0, journalArticle: 0,
      bookSection: 0, book: 0, report: 0, conferencePaper: 0
    };
    let pubTotal = 0;
    (rows || []).forEach(r => {
      const t = r.types || {};
      Object.keys(pub).forEach(k => {
        const n = Number(t[k] || 0);
        pub[k] += n;
        pubTotal += n;
      });
    });
    barII.querySelector('[data-count-pubs-total]').textContent = String(pubTotal);
    // 'preprint' key is intentionally absent — the preprint chip is never
    // updated or shown. If a stale `Preprint: N` chip exists in the initial
    // HTML markup, the fallback loop below explicitly hides it so no
    // pre-rendered stub can leak through.
    const chipMap = {
      thesisPhd: '[data-count-pub-phd]',
      thesisMasters: '[data-count-pub-masters]',
      journalArticle: '[data-count-pub-journal]',
      bookSection: '[data-count-pub-chapter]',
      book: '[data-count-pub-book]',
      report: '[data-count-pub-report]',
      conferencePaper: '[data-count-pub-conf]'
    };
    // Update counts + hide zero-count chips, then reorder the remaining
    // chips by count descending so the row reads as a natural ranking
    // (largest category first). All chips live in the inner .dsf-summary__chips
    // container so wrapped rows align to the first-chip column (right after
    // the fixed-width label).
    const chipsHostII = barII.querySelector('[data-scholar-summary-ii-chips]') || barII;
    // Belt-and-suspenders: hide any preprint chip stub baked into the initial
    // HTML markup. Preprints are globally excluded from V2 (2026-08-24).
    const preprintChipStub = chipsHostII.querySelector('[data-pub-chip="preprint"]');
    if (preprintChipStub) preprintChipStub.style.display = 'none';
    Object.keys(chipMap).forEach(k => {
      const chip = chipsHostII.querySelector(`[data-pub-chip="${k}"]`);
      const num = chipsHostII.querySelector(chipMap[k]);
      if (num) num.textContent = String(pub[k]);
      if (chip) chip.style.display = pub[k] > 0 ? 'inline-flex' : 'none';
    });
    const visibleChips = Object.keys(chipMap)
      .filter(k => pub[k] > 0)
      .sort((a, b) => pub[b] - pub[a]);
    visibleChips.forEach(k => {
      const chip = chipsHostII.querySelector(`[data-pub-chip="${k}"]`);
      if (chip) chipsHostII.appendChild(chip); // move to end — rebuilds sorted order
    });
  }

  // ============================================================
  //  Data-tree builders (populate combo panels)
  //  Countries and universities are extracted from the enrichment profiles
  //  and returned as alphabetized country → [unis] maps for the combos.
  // ============================================================
  function buildStudyTree() {
    const tree = new Map();
    (state.scholarProfilesByName || new Map()).forEach(p => {
      [p.masters, p.phd].forEach(g => {
        if (!g) return;
        const c = (g.country || '').trim();
        const u = (g.university || '').trim();
        if (!c) return;
        if (!tree.has(c)) tree.set(c, new Set());
        if (u) tree.get(c).add(u);
      });
    });
    // Convert to sorted map of sorted arrays.
    return new Map([...tree.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, us]) => [c, [...us].sort((a, b) => a.localeCompare(b))]));
  }

  // Fallback country guesser for scholars whose profile doesn't yet have
  // institutionCountry filled in (which is a new field). Mirrors the same
  // rules used in the admin so the public work filter is populated even
  // before Ron pushes the auto-seeded profile updates.
  const WORK_COUNTRY_RULES = [
    // ---- Samoa (universities, museums, regional NGOs headquartered in Suva) ----
    [/\bfiji national university\b|\bfnu\b/i, 'Samoa'],
    [/\buniversity of the south pacific\b|\busp\b/i, 'Samoa'],
    [/\bnature\s*samoa\b|\bfiji museum\b|\bblue prosperity samoa\b|\bwish samoa\b/i, 'Samoa'],
    [/\bministry.*samoa|\bfiji.*ministry|\bsuva\b|\blautoka\b|\bnadi\b|\bnadroga\b/i, 'Samoa'],
    // Pacific-regional bodies + NGOs that are based in Suva even though the parent org is global.
    [/\blocally managed marine area\b|\blmma\b|\bgiz pacific\b|\bpacific community\b|\bspc\b|\bsprep\b|\bffa\b|\bwwf pacific\b|\bwildlife conservation society.*samoa\b|\bconservation international.*(samoa|pacific)\b|\biucn oceania\b|\bcaritas.*samoa\b/i, 'Samoa'],
    // Conservation International / WWF / WCS without a region suffix — assume the Pacific office.
    [/\bconservation international\b|\bwildlife conservation society\b|\bwwf\b/i, 'Samoa'],
    // Samoan government + hospitals + health service.
    [/\bhealth service.*samoa\b|\blautoka hospital\b|\bcwm hospital\b|\bcolonial war memorial\b|\bfiji cdc\b/i, 'Samoa'],
    [/\buniversity of central lancashire\b|\bcentral lancashire\b|\buclan\b/i, 'United Kingdom'],
    [/\buniversity of southampton\b|\bimperial college\b|\boxford\b|\bcambridge\b|\b\(uk\)\b|\bunited kingdom\b/i, 'United Kingdom'],
    [/\buniversity of guam\b|\buog\b/i, 'Guam (USA territory)'],
    [/\byas seaworld\b|\babu dhabi\b|\buae\b|\bunited arab emirates\b/i, 'United Arab Emirates'],
    [/\bmassey university\b|\bauckland\b|\botago\b|\bcanterbury\b|\bwaikato\b|\bvictoria university of wellington\b|\b\(new zealand\)\b|\bnew zealand\b/i, 'New Zealand'],
    [/\bsydney\b|\btasmania\b|\bunsw\b|\bmelbourne\b|\bqueensland\b|\bjames cook\b|\bcharles darwin\b|\bgriffith\b|\bsunshine coast\b|\banu\b|\bmurdoch\b|\bwestern sydney\b|\bnewcastle\b|\bcanberra\b|\bmacquarie\b|\b\(australia\)\b|\baustralia\b/i, 'Australia'],
    [/\bmanoa\b|\bhawai[\u02bbi\']i\b|\bsan francisco state\b|\bsfsu\b|\bhawaii\b|\b\(usa\)\b|\bunited states\b/i, 'USA'],
    [/\bryukyu\b|\btokyo\b|\bkyoto\b|\b\(japan\)\b|\bjapan\b/i, 'Japan'],
    [/\bpapua new guinea\b|\bpng\b/i, 'Papua New Guinea'],
    [/\bsolomon islands\b/i, 'Solomon Islands'],
    [/\bvanuatu\b/i, 'Vanuatu'],
    [/\bsamoa\b/i, 'Samoa'],
    [/\btonga\b/i, 'Tonga'],
  ];
  function guessWorkCountry(inst) {
    const s = String(inst || '');
    if (!s.trim()) return '';
    for (const [pattern, country] of WORK_COUNTRY_RULES) {
      if (pattern.test(s)) return country;
    }
    const m = s.match(/[\(,]\s*([A-Za-z][A-Za-z\s]{2,25}?)\s*\)?\s*$/);
    return m ? m[1].trim() : '';
  }

  // Resolve the country of work for a scholar: explicit field first,
  // falling back to the guesser so the Work filter functions before the
  // admin has pushed auto-seeded values.
  function scholarWorkCountry(p) {
    if (!p) return '';
    if (p.institutionCountry && String(p.institutionCountry).trim()) return String(p.institutionCountry).trim();
    return guessWorkCountry(p.institution);
  }

  // Strip a trailing " (Country)" suffix from an institution string — that
  // suffix is included in the admin-entered field only so the scholar card
  // displays it; in the filter dropdown we want the institution name on its
  // own so a listing reads "Australian National University" rather than
  // "Australian National University (Australia)".
  function stripCountrySuffix(inst) {
    const s = String(inst || '').trim();
    if (!s) return '';
    return s.replace(/\s*[\(,]\s*[A-Za-z][A-Za-z\s]{1,30}?\s*\)?\s*$/, '').trim() || s;
  }

  function buildWorkTree() {
    const tree = new Map();
    (state.scholarProfilesByName || new Map()).forEach(p => {
      const c = scholarWorkCountry(p);
      const uRaw = (p.institution || '').trim();
      if (!c) return;
      if (!tree.has(c)) tree.set(c, new Set());
      if (uRaw) tree.get(c).add(stripCountrySuffix(uRaw));
    });
    return new Map([...tree.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, us]) => [c, [...us].sort((a, b) => a.localeCompare(b))]));
  }

  function buildConfProvTree() {
    // Same shape as country → unis: region → alphabetized districts.
    const tree = new Map();
    ['Rest of Upolu', 'Apia Urban Area', 'North West Upolu'].sort().forEach(c => {
      tree.set(c, (CONFEDERACY_PROVINCES[c] || []).slice().sort((a, b) => a.localeCompare(b)));
    });
    // 'Unclassified' is anchored at the bottom — clicking it filters for
    // Samoan scholars whose paternal district info isn't yet known.
    // It has no child districts (no sub-tree).
    tree.set('Unclassified', []);
    return tree;
  }

  // Place `panel` just below `anchor` inside their shared positioned ancestor.
  // Both are absolutely positioned and live under .db-leaderboard__head.
  function positionPanelBelow(anchor, panel) {
    // offsetTop/Left are relative to the nearest positioned ancestor. Since
    // panels live inside .db-leaderboard__head (which is position: relative),
    // this lines them up correctly beneath the opener button.
    panel.style.top  = (anchor.offsetTop + anchor.offsetHeight + 4) + 'px';
    panel.style.left = anchor.offsetLeft + 'px';
  }

  // ============================================================
  //  Two-column combo control (Statistical Region/District, Study, Work)
  //  Left column = parents; right column = children of the hovered parent.
  //  Typing in the input filters both columns. Click parent → select parent;
  //  Click child → select parent + child.
  // ============================================================
  function initTwoColumnCombo({
    root, input, panel, colParent, colChild, colChildHeader,
    tree, parentLabelSingular, buildLabel, onSelect, isActive
  }) {
    let hoveredParent = null;
    let filtered = null; // { parents: [], childrenByParent: Map }

    function open() {
      // Position the panel just below its opener button. Both live inside the
      // same relatively-positioned ancestor (.db-leaderboard__head).
      positionPanelBelow(root, panel);
      panel.classList.add('is-visible');
      root.classList.add('is-open');
      // Default to first parent if no hover yet
      if (!hoveredParent) {
        const parents = filtered ? filtered.parents : [...tree.keys()];
        if (parents.length) setHoveredParent(parents[0]);
      }
      document.addEventListener('mousedown', closeOnOutside, true);
      document.addEventListener('keydown', onEsc);
    }
    function close() {
      panel.classList.remove('is-visible');
      root.classList.remove('is-open');
      document.removeEventListener('mousedown', closeOnOutside, true);
      document.removeEventListener('keydown', onEsc);
    }
    function closeOnOutside(ev) {
      if (!root.contains(ev.target) && !panel.contains(ev.target)) close();
    }
    function onEsc(ev) { if (ev.key === 'Escape') close(); }

    function setHoveredParent(name) {
      hoveredParent = name;
      renderChildren();
      // Highlight parent visually
      colParent.querySelectorAll('.dsf-combo-item').forEach(el => {
        el.classList.toggle('is-highlighted', el.dataset.value === name);
      });
    }

    function renderParents() {
      const parents = filtered ? filtered.parents : [...tree.keys()];
      colParent.innerHTML = '';
      parents.forEach(name => {
        const el = document.createElement('div');
        el.className = 'dsf-combo-item';
        el.dataset.value = name;
        const kids = (filtered ? (filtered.childrenByParent.get(name) || tree.get(name)) : tree.get(name)) || [];
        el.innerHTML = `<span class="dsf-combo-item__label">${escapeHtml(name)}</span>
                        <span class="dsf-combo-item__count">${kids.length ? `(${kids.length})` : ''}</span>
                        <span class="dsf-combo-caret">\u25B8</span>`;
        el.addEventListener('mouseenter', () => setHoveredParent(name));
        el.addEventListener('click', () => {
          onSelect({ parent: name, child: '' });
          close();
        });
        colParent.appendChild(el);
      });
    }
    function renderChildren() {
      colChild.innerHTML = '';
      const kids = (filtered && filtered.childrenByParent.get(hoveredParent))
                || (hoveredParent ? (tree.get(hoveredParent) || []) : []);
      if (colChildHeader) {
        if (!hoveredParent) colChildHeader.textContent = '';
        else if (!kids.length) colChildHeader.textContent = '';
        else colChildHeader.textContent = `${parentLabelSingular ? parentLabelSingular : 'Items'} in ${hoveredParent}`;
      }
      kids.forEach(kid => {
        const el = document.createElement('div');
        el.className = 'dsf-combo-item';
        el.innerHTML = `<span class="dsf-combo-item__label">${escapeHtml(kid)}</span>`;
        el.addEventListener('click', () => {
          onSelect({ parent: hoveredParent, child: kid });
          close();
        });
        colChild.appendChild(el);
      });
    }

    function applyTextFilter(q) {
      const query = q.trim().toLowerCase();
      if (!query) { filtered = null; hoveredParent = null; renderParents(); renderChildren(); return; }
      // Match on parents AND children
      const parentHits = new Set();
      const childrenByParent = new Map();
      tree.forEach((kids, parent) => {
        const parentMatch = parent.toLowerCase().includes(query);
        const kidHits = kids.filter(k => k.toLowerCase().includes(query));
        if (parentMatch) { parentHits.add(parent); childrenByParent.set(parent, kids); }
        else if (kidHits.length) { parentHits.add(parent); childrenByParent.set(parent, kidHits); }
      });
      const parents = [...parentHits].sort((a, b) => a.localeCompare(b));
      filtered = { parents, childrenByParent };
      hoveredParent = parents[0] || null;
      renderParents(); renderChildren();
    }

    // Wire
    root.addEventListener('click', ev => {
      if (ev.target.closest('[data-clear-combo]')) return;
      if (panel.classList.contains('is-visible')) return; // let outside handler close
      open();
      renderParents(); renderChildren();
      if (input) input.focus();
    });
    if (input) {
      input.addEventListener('input', () => { open(); renderParents(); applyTextFilter(input.value); });
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const parents = filtered ? filtered.parents : [...tree.keys()];
          const first = parents[0];
          if (first) { onSelect({ parent: first, child: '' }); close(); }
        }
      });
    }
    // Update the pill label whenever state changes.
    function refreshLabel() {
      const active = isActive();
      root.classList.toggle('is-active', active.active);
      if (input) input.value = active.value || '';
      const labelSlot = root.querySelector('[data-label-slot]');
      if (labelSlot) labelSlot.textContent = active.value || buildLabel();
      const badge = root.querySelector('[data-clear-combo]');
      if (badge) badge.style.display = active.active ? '' : 'none';
    }
    refreshLabel();
    return { refreshLabel, close };
  }

  // ============================================================
  //  Wire the new filter row (called once at boot)
  // ============================================================
  function wireScholarFilterRow() {
    // ---- Name search ----
    const searchInput = document.querySelector('[data-scholar-name-search]');
    if (searchInput) {
      searchInput.value = state.scholarNameSearch || '';
      let t;
      searchInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.scholarNameSearch = searchInput.value;
          state.scholarPage = 1;
          renderLeaders();
        }, 120);
      });
    }

    // ---- Research-keyword search ----
    const kwInput = document.querySelector('[data-scholar-keyword-search]');
    if (kwInput) {
      kwInput.value = state.scholarKeywordSearch || '';
      let tk;
      kwInput.addEventListener('input', () => {
        clearTimeout(tk);
        tk = setTimeout(() => {
          state.scholarKeywordSearch = kwInput.value;
          state.scholarPage = 1;
          renderLeaders();
        }, 160);
      });
    }

    // ---- Statistical Region / District combo ----
    const confRoot   = document.querySelector('[data-scholar-conf-combo]');
    const confPanel  = document.querySelector('[data-scholar-conf-panel]');
    if (confRoot && confPanel) {
      const colP = confPanel.querySelector('[data-parent-col]');
      const colC = confPanel.querySelector('[data-child-col]');
      const colCH = confPanel.querySelector('[data-child-header]');
      const tree = buildConfProvTree();
      const combo = initTwoColumnCombo({
        root: confRoot, input: null, panel: confPanel,
        colParent: colP, colChild: colC, colChildHeader: colCH,
        tree, parentLabelSingular: 'Districts',
        buildLabel: () => 'All statistical regions',
        isActive: () => {
          const c = state.scholarConfFilter, p = state.scholarProvFilter;
          // Map the internal '__untagged__' sentinel back to the friendly label.
          const cDisplay = c === '__untagged__' ? 'Unclassified' : c;
          if (cDisplay && p) return { active: true, value: `${cDisplay} › ${p}` };
          if (cDisplay) return { active: true, value: cDisplay };
          if (p) return { active: true, value: p };
          return { active: false, value: '' };
        },
        onSelect: ({ parent, child }) => {
          // 'Unclassified' is the friendly label — the filter engine uses the
          // internal '__untagged__' sentinel to mean "no paternal district".
          state.scholarConfFilter = parent === 'Unclassified' ? '__untagged__' : (parent || '');
          state.scholarProvFilter = child || '';
          state.scholarPage = 1;
          renderLeaders();
          combo.refreshLabel();
        }
      });
      confRoot.querySelector('[data-clear-combo]').addEventListener('click', ev => {
        ev.stopPropagation();
        state.scholarConfFilter = ''; state.scholarProvFilter = '';
        state.scholarPage = 1;
        renderLeaders();
        combo.refreshLabel();
      });
    }

    // ---- Sector dropdown (native <select>) ----
    const secSel = document.querySelector('[data-scholar-sector]');
    if (secSel) {
      secSel.innerHTML = '<option value="">All sectors</option>' +
        SECTORS.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
      secSel.value = state.scholarSectorFilter || '';
      secSel.addEventListener('change', () => {
        state.scholarSectorFilter = secSel.value;
        state.scholarPage = 1;
        renderLeaders();
      });
    }

    // ---- Discipline (checkbox multi-select) ----
    const discRoot  = document.querySelector('[data-scholar-disc-combo]');
    const discPanel = document.querySelector('[data-scholar-disc-panel]');
    if (discRoot && discPanel) {
      // Populate options once (already alphabetical).
      const list = discPanel.querySelector('[data-disc-list]');
      list.innerHTML = DISCIPLINES.map(d => `
        <label class="dsf-check-item">
          <input type="checkbox" value="${escapeAttr(d)}" />
          <span class="dsf-check-item__label">${escapeHtml(d)}</span>
        </label>`).join('');

      function refreshDiscLabel() {
        const n = state.scholarDisciplineFilter.size;
        discRoot.classList.toggle('is-active', n > 0);
        const labelSlot = discRoot.querySelector('[data-label-slot]');
        if (labelSlot) labelSlot.textContent = n === 0 ? 'Discipline' : `Discipline`;
        const badge = discRoot.querySelector('[data-disc-badge]');
        badge.textContent = n ? String(n) : '';
        badge.style.display = n ? 'inline-flex' : 'none';
      }

      function openDisc() {
        positionPanelBelow(discRoot, discPanel);
        discPanel.classList.add('is-visible'); discRoot.classList.add('is-open');
        document.addEventListener('mousedown', outsideCloseDisc, true);
        document.addEventListener('keydown', escCloseDisc);
      }
      function closeDisc() {
        discPanel.classList.remove('is-visible'); discRoot.classList.remove('is-open');
        document.removeEventListener('mousedown', outsideCloseDisc, true);
        document.removeEventListener('keydown', escCloseDisc);
      }
      function outsideCloseDisc(ev) { if (!discRoot.contains(ev.target) && !discPanel.contains(ev.target)) closeDisc(); }
      function escCloseDisc(ev) { if (ev.key === 'Escape') closeDisc(); }

      discRoot.addEventListener('click', ev => {
        if (discPanel.classList.contains('is-visible')) return;
        openDisc();
      });
      list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = state.scholarDisciplineFilter.has(cb.value);
        cb.addEventListener('change', () => {
          if (cb.checked) state.scholarDisciplineFilter.add(cb.value);
          else state.scholarDisciplineFilter.delete(cb.value);
          state.scholarPage = 1;
          refreshDiscLabel();
          renderLeaders();
        });
      });
      discPanel.querySelector('[data-disc-clear]').addEventListener('click', () => {
        state.scholarDisciplineFilter.clear();
        list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        state.scholarPage = 1;
        refreshDiscLabel();
        renderLeaders();
      });
      refreshDiscLabel();
    }

    // ---- Country / University of study combo ----
    const studyRoot  = document.querySelector('[data-scholar-study-combo]');
    const studyPanel = document.querySelector('[data-scholar-study-panel]');
    if (studyRoot && studyPanel) {
      const input = studyRoot.querySelector('[data-scholar-study-input]');
      const colP = studyPanel.querySelector('[data-parent-col]');
      const colC = studyPanel.querySelector('[data-child-col]');
      const colCH = studyPanel.querySelector('[data-child-header]');
      const tree = buildStudyTree();
      const combo = initTwoColumnCombo({
        root: studyRoot, input, panel: studyPanel,
        colParent: colP, colChild: colC, colChildHeader: colCH,
        tree, parentLabelSingular: 'Universities',
        buildLabel: () => 'Countries / Universities of study',
        isActive: () => {
          const c = state.scholarStudyCountry, u = state.scholarStudyUni;
          if (c && u) return { active: true, value: `${c} › ${u}` };
          if (c) return { active: true, value: c };
          return { active: false, value: '' };
        },
        onSelect: ({ parent, child }) => {
          state.scholarStudyCountry = parent || '';
          state.scholarStudyUni = child || '';
          state.scholarPage = 1;
          renderLeaders();
          combo.refreshLabel();
        }
      });
      studyRoot.querySelector('[data-clear-combo]').addEventListener('click', ev => {
        ev.stopPropagation();
        state.scholarStudyCountry = ''; state.scholarStudyUni = '';
        if (input) input.value = '';
        state.scholarPage = 1;
        renderLeaders();
        combo.refreshLabel();
      });
    }

    // ---- Country / University of work combo ----
    const workRoot  = document.querySelector('[data-scholar-work-combo]');
    const workPanel = document.querySelector('[data-scholar-work-panel]');
    if (workRoot && workPanel) {
      const input = workRoot.querySelector('[data-scholar-work-input]');
      const colP = workPanel.querySelector('[data-parent-col]');
      const colC = workPanel.querySelector('[data-child-col]');
      const colCH = workPanel.querySelector('[data-child-header]');
      const tree = buildWorkTree();
      const combo = initTwoColumnCombo({
        root: workRoot, input, panel: workPanel,
        colParent: colP, colChild: colC, colChildHeader: colCH,
        tree, parentLabelSingular: 'Universities',
        buildLabel: () => 'Countries / Institutions of work',
        isActive: () => {
          const c = state.scholarWorkCountry, u = state.scholarWorkUni;
          if (c && u) return { active: true, value: `${c} › ${u}` };
          if (c) return { active: true, value: c };
          return { active: false, value: '' };
        },
        onSelect: ({ parent, child }) => {
          state.scholarWorkCountry = parent || '';
          state.scholarWorkUni = child || '';
          state.scholarPage = 1;
          renderLeaders();
          combo.refreshLabel();
        }
      });
      workRoot.querySelector('[data-clear-combo]').addEventListener('click', ev => {
        ev.stopPropagation();
        state.scholarWorkCountry = ''; state.scholarWorkUni = '';
        if (input) input.value = '';
        state.scholarPage = 1;
        renderLeaders();
        combo.refreshLabel();
      });
    }

    // ---- Clear-all button ----
    const clearAll = document.querySelector('[data-scholar-clear-all]');
    if (clearAll) {
      clearAll.addEventListener('click', () => {
        state.scholarNameSearch = '';
        state.scholarKeywordSearch = '';
        state.scholarConfFilter = ''; state.scholarProvFilter = '';
        state.scholarSectorFilter = '';
        state.scholarDisciplineFilter.clear();
        state.scholarStudyCountry = ''; state.scholarStudyUni = '';
        state.scholarWorkCountry = ''; state.scholarWorkUni = '';
        state.scholarPage = 1;
        // Force each combo's label to refresh by re-running the wireup.
        wireScholarFilterRow();
        renderLeaders();
      });
    }
  }

  // Derive scholar rows from the Zotero snapshot + the enrichment JSON.
  //
  // Two sources are combined so that a scholar shows up in the dashboard even
  // if the admin has filled a profile but hasn't yet created a matching Zotero
  // sub-collection (or if the scholar only has 1 publication and doesn't meet
  // the informal >3-papers convention).
  //
  //   Source A: Zotero sub-collections under 'Samoan authors (>3 papers)'.
  //             These are the primary Samoan-scholar collections curated in
  //             Zotero Desktop.
  //   Source B: Admin profiles whose scholar has no matching sub-collection.
  //             We fall back to matching publications by author name in the
  //             snapshot (surname + first-name-first-token). Any scholar with
  //             ≥1 matching publication becomes a card.
  //
  // Returns [{ name ("Last, First"), key, total, firstAuthored, types }].
  function deriveScholarRows() {
    const cols = state.snapshot.collections;
    const rows = [];
    const seenLastFirst = new Set(); // canonical + stripped "Last, First-token"

    const emptyTypes = () => ({
      journalArticle: 0, thesisPhd: 0, thesisMasters: 0, thesisUnknown: 0,
      bookSection: 0, book: 0, report: 0, conferencePaper: 0, preprint: 0
    });
    const firstToken = s => String(s || '').trim().split(/\s+/)[0] || '';
    const stripDots = s => String(s || '').replace(/\./g, '');
    const aliases = state.nameAliases || new Map();

    // Walk the alias chain to a fixed point. Guards against cycles (which
    // shouldn't occur post-repair, but were possible with earlier merge code
    // — defense in depth).
    function walkAlias(name) {
      if (!name) return name;
      let cur = name;
      const seen = new Set([cur]);
      for (let hop = 0; hop < 32; hop++) {
        const next = aliases.get(cur);
        if (!next || next === cur || seen.has(next)) return cur;
        seen.add(next);
        cur = next;
      }
      return cur;
    }

    // Turn a raw Zotero creator string into a canonical "Last, First" form,
    // applying the admin's alias map (transitively). Returns null on
    // non-string / empty input.
    function canonicalizeCreator(raw) {
      if (typeof raw !== 'string' || !raw.trim()) return null;
      const s = raw.trim();
      const asLastFirst = s.includes(',') ? s : (() => {
        const toks = s.split(/\s+/);
        return `${toks[toks.length - 1]}, ${toks.slice(0, -1).join(' ')}`;
      })();
      // Try both forms; walk the chain to a fixed point.
      if (aliases.has(asLastFirst)) return walkAlias(asLastFirst);
      if (aliases.has(s)) return walkAlias(s);
      return asLastFirst;
    }
    // Build a reverse index (canonical → [variant strings]) so Source A can
    // sweep aliased variant items into the sub-collection scholar's totals.
    const variantsByCanonical = new Map();
    aliases.forEach((canon, variant) => {
      if (!variantsByCanonical.has(canon)) variantsByCanonical.set(canon, []);
      variantsByCanonical.get(canon).push(variant);
    });

    // Resolve a Zotero sub-collection name (e.g. "Rakuita, Nawi") to its
    // canonical scholar name. First try a direct alias lookup; if that fails,
    // fall back to matching an alias key whose (last, first-token) equals the
    // sub-collection's (last, first-token). This catches the case where the
    // admin registered "Rakuita, Nawi Tui" → "Rakuita, Tui" but the Zotero
    // sub-collection is only "Rakuita, Nawi". Without this fallback the sub-
    // collection would emit a duplicate row under its own name.
    function resolveSubName(rawName) {
      if (aliases.has(rawName)) return walkAlias(rawName);
      if (typeof rawName !== 'string' || !rawName.includes(',')) return rawName;
      const [lastPart, firstPart] = rawName.split(',', 2).map(s => (s || '').trim());
      const subTok = firstToken(firstPart).toLowerCase();
      if (!lastPart || !subTok) return rawName;
      const lastLow = lastPart.toLowerCase();
      for (const [variant, canon] of aliases.entries()) {
        if (typeof variant !== 'string' || !variant.includes(',')) continue;
        const [vLast, vFirst] = variant.split(',', 2).map(s => (s || '').trim());
        if (vLast.toLowerCase() !== lastLow) continue;
        if (firstToken(vFirst).toLowerCase() === subTok) return walkAlias(canon);
      }
      return rawName;
    }

    // ---- Source A: Zotero sub-collections ----
    // If the admin has merged a sub-collection name into another canonical name
    // via the alias map (e.g. "Movono, Api" → "Movono, Apisalome"), we relabel
    // this sub-collection with its canonical name here BEFORE creating a row.
    // When a second sub-collection is already emitted under the same canonical,
    // we merge their counts into that existing row instead of pushing a
    // duplicate card. Items are deduped by Zotero item key so a paper that
    // sits in both sub-collections is only counted once.
    const rowsByCanonical = new Map(); // canonicalName → rows entry
    const countedByCanonical = new Map(); // canonicalName → Set<itemKey>
    const root = findItaukeiRootCollection(cols);
    if (root) {
      const subs = cols.filter(c => c.parent === root.key);
      subs.forEach(c => {
        // Resolve the sub-collection name through the alias map (with a
        // first-token fallback). If no alias resolves, canonicalName === c.name.
        const canonicalName = resolveSubName(c.name);
        const lastForFirstAuthor = canonicalName.split(',')[0].trim().toLowerCase();
        // Reuse or create the accumulator row for this canonical scholar.
        let entry = rowsByCanonical.get(canonicalName);
        if (!entry) {
          entry = { name: canonicalName, key: c.key, total: 0, firstAuthored: 0, types: emptyTypes() };
          rowsByCanonical.set(canonicalName, entry);
          countedByCanonical.set(canonicalName, new Set());
        }
        const countedItemKeys = countedByCanonical.get(canonicalName);
        state.snapshot.items.forEach(it => {
          if (!(it.collections || []).includes(c.key)) return;
          if (countedItemKeys.has(it.key)) return; // already counted via another aliased sub-collection
          countedItemKeys.add(it.key);
          entry.total += 1;
          const vt = visualType(it);
          if (entry.types[vt] != null) entry.types[vt] += 1;
          const creators = it.creators || [];
          if (creators.length) {
            const first = creators[0];
            const lastTok = (typeof first === 'string' && first.includes(','))
              ? first.split(',')[0].trim().toLowerCase()
              : String(first || '').trim().split(/\s+/).pop().toLowerCase();
            if (lastTok === lastForFirstAuthor) entry.firstAuthored += 1;
          }
        });

        // Supplement with items authored under any admin-registered variant
        // name that maps to this canonical scholar (but sit outside every
        // sub-collection). Uses the same dedupe set so nothing double-counts.
        const variants = variantsByCanonical.get(canonicalName) || [];
        if (variants.length) {
          const variantSet = new Set(variants);
          state.snapshot.items.forEach(it => {
            if (countedItemKeys.has(it.key)) return;
            const creators = it.creators || [];
            let isMatch = false, isFirstMatch = false;
            for (let i = 0; i < creators.length; i++) {
              const raw = creators[i];
              if (typeof raw !== 'string' || !raw.trim()) continue;
              const s = raw.trim();
              const asLastFirst = s.includes(',') ? s : (() => {
                const toks = s.split(/\s+/);
                return `${toks[toks.length - 1]}, ${toks.slice(0, -1).join(' ')}`;
              })();
              if (variantSet.has(asLastFirst) || variantSet.has(s)) {
                isMatch = true;
                if (i === 0) isFirstMatch = true;
                break;
              }
            }
            if (!isMatch) return;
            countedItemKeys.add(it.key);
            entry.total += 1;
            const vt = visualType(it);
            if (entry.types[vt] != null) entry.types[vt] += 1;
            if (isFirstMatch) entry.firstAuthored += 1;
          });
        }
      });
      // Emit one row per canonical scholar. Register both the canonical name
      // and its stripped-first-token variant in seenLastFirst so Source B
      // doesn't produce a duplicate card for the same profile.
      rowsByCanonical.forEach(entry => {
        rows.push(entry);
        seenLastFirst.add(entry.name.toLowerCase());
        const [lastPart, firstPart] = entry.name.split(',').map(s => (s || '').trim());
        if (lastPart && firstPart) {
          seenLastFirst.add((lastPart + ', ' + firstToken(firstPart)).toLowerCase());
        }
      });
    }

    // ---- Source B: profiles without a matching sub-collection ----
    // Dedupe profiles — the map has multiple keys per profile (see
    // scholarProfilesByName build). We identify each profile by slug or by
    // canonical (last, first) so a profile isn't processed twice.
    const profSeen = new Set();
    const enriched = state.scholarProfilesByName || new Map();
    enriched.forEach(p => {
      if (!p || !p.last || !p.first) return;
      const id = p.slug || `${p.last}|${p.first}`;
      if (profSeen.has(id)) return;
      profSeen.add(id);

      const canonicalName = `${p.last}, ${p.first}`;
      const strippedName  = `${p.last}, ${firstToken(p.first)}`;
      if (seenLastFirst.has(canonicalName.toLowerCase()) ||
          seenLastFirst.has(strippedName.toLowerCase())) return;

      // Author-name-match every item against this profile.
      const lastLow  = p.last.toLowerCase();
      const firstTok = stripDots(firstToken(p.first)).toLowerCase();
      if (!lastLow || !firstTok) return;
      const types = emptyTypes();
      let total = 0, firstAuthored = 0;
      state.snapshot.items.forEach(it => {
        const creators = it.creators || [];
        let isMatch = false, isFirst = false;
        for (let i = 0; i < creators.length; i++) {
          const raw = creators[i];
          if (typeof raw !== 'string' || !raw.trim()) continue;
          // Resolve alias BEFORE parsing so a variant like "Tabunakawai, K."
          // becomes "Tabunakawai, Kesaia" and matches Kesaia's profile.
          const s = (canonicalizeCreator(raw) || raw).trim();
          let lLow, fTokLow;
          if (s.includes(',')) {
            const [ln, fn] = s.split(',', 2);
            lLow = (ln || '').trim().toLowerCase();
            fTokLow = stripDots(firstToken(fn)).toLowerCase();
          } else {
            const toks = s.split(/\s+/);
            lLow = toks[toks.length - 1].toLowerCase();
            fTokLow = stripDots(toks[0]).toLowerCase();
          }
          if (lLow === lastLow && fTokLow === firstTok) {
            isMatch = true;
            if (i === 0) isFirst = true;
            break;
          }
        }
        if (!isMatch) return;
        total += 1;
        const vt = visualType(it);
        if (types[vt] != null) types[vt] += 1;
        if (isFirst) firstAuthored += 1;
      });
      if (total >= 1) {
        rows.push({ name: canonicalName, key: null, total, firstAuthored, types });
        seenLastFirst.add(canonicalName.toLowerCase());
        seenLastFirst.add(strippedName.toLowerCase());
      }
    });

    return rows;
  }

  // Statistical Region → gradient stops for the banner + initials background.
  // Matches Panel A/B/C statistical region colours.
  const CONF_GRADIENT = {
    'Rest of Upolu': { from: '#FF5A6E', to: '#c93e50' },
    'Apia Urban Area':     { from: '#4ECDE6', to: '#0891b2' },
    'North West Upolu':     { from: '#FFD84A', to: '#f7b500' }
  };
  const NEUTRAL_GRADIENT = { from: '#0e7490', to: '#062f35' };

  // Type styling matches the Panel B/C stacked-histogram palette.
  const TYPE_STYLES = {
    journalArticle: { color: '#B8860B', bg: '#f8efd6', border: '#e6c98a', s: 'Journal article',  p: 'Journal articles' },
    thesisPhd:      { color: '#228B22', bg: '#e5f4e5', border: '#a4d3a4', s: 'PhD thesis',       p: 'PhD theses' },
    thesisMasters:  { color: '#5f9c5f', bg: '#eef7ee', border: '#c9e2c9', s: 'Masters thesis',   p: 'Masters theses' },
    thesisUnknown:  { color: '#4CAF50', bg: '#eaf5ea', border: '#b8dab8', s: 'Thesis',           p: 'Theses' },
    // Book Chapter uses the lighter tint (#C08388) to distinguish it from Book;
    // Book keeps the darker burgundy (#7a1419). Chip bg/border tints stay in
    // the same warm-red family for both so grouped-item chips still read as
    // one visual cluster.
    bookSection:    { color: '#C08388', bg: '#f7e8ea', border: '#e1a8ae', s: 'Book chapter',     p: 'Book chapters' },
    book:           { color: '#7a1419', bg: '#f7e8ea', border: '#e1a8ae', s: 'Book',             p: 'Books' },
    report:         { color: '#1e40af', bg: '#e6ecf7', border: '#a8b8dc', s: 'Report',           p: 'Reports' },
    conferencePaper:{ color: '#92400e', bg: '#f7ecdf', border: '#d9b58a', s: 'Conference paper', p: 'Conference papers' },
    preprint:       { color: '#6b7280', bg: '#eef0f2', border: '#c7cbd1', s: 'Preprint',         p: 'Preprints' }
  };
  // Order in which chips are rendered (only shown if count > 0).
  // 'thesisUnknown' is intentionally omitted — "Thesis (unspecified)" is
  //   never surfaced on the public dashboard (per Ron's directive).
  // 'preprint' is intentionally omitted — preprints are globally excluded
  //   from every V2 display (2026-08-24 Ron directive). Preprints are also
  //   removed from state.snapshot.items at load time, so this line is
  //   belt-and-suspenders — even if a stray preprint ever slipped past
  //   the item filter, no chip would render.
  // 'conferencePaper' likewise remains in the list purely as a legacy
  //   safety net; conference papers are filtered out at load time too.
  const CHIP_ORDER = ['journalArticle', 'bookSection', 'book', 'thesisPhd', 'thesisMasters', 'report', 'conferencePaper'];

  // Country name → ISO 3166-1 alpha-2 code, used for flag icons in the card header.
  // Only countries that actually appear in the current dataset (or are
  // reasonably likely to appear given the Samoan diaspora — Pacific + common
  // graduate-study destinations) are enumerated. Names are matched exactly to
  // what `scholarWorkCountry(p)` returns (which mirrors the admin's Country of
  // Work datalist), plus a handful of common alternate spellings.
  const COUNTRY_ISO = {
    'Samoa': 'fj', 'Australia': 'au', 'New Zealand': 'nz', 'Aotearoa': 'nz',
    'United Kingdom': 'gb', 'UK': 'gb', 'Great Britain': 'gb', 'England': 'gb', 'Scotland': 'gb', 'Wales': 'gb',
    'USA': 'us', 'United States': 'us', 'United States of America': 'us', 'America': 'us',
    'Guam (USA territory)': 'gu', 'Guam': 'gu',
    'United Arab Emirates': 'ae', 'UAE': 'ae',
    'Papua New Guinea': 'pg', 'PNG': 'pg',
    'Samoa': 'ws', 'Western Samoa': 'ws',
    'American Samoa': 'as',
    'Solomon Islands': 'sb', 'Tonga': 'to', 'Vanuatu': 'vu', 'Kiribati': 'ki',
    'Cook Islands': 'ck', 'French Polynesia': 'pf', 'New Caledonia': 'nc',
    'Niue': 'nu', 'Palau': 'pw', 'Nauru': 'nr', 'Tuvalu': 'tv',
    'Federated States of Micronesia': 'fm', 'Micronesia': 'fm', 'Marshall Islands': 'mh',
    'Japan': 'jp', 'Canada': 'ca', 'Germany': 'de',
    'India': 'in', 'China': 'cn', 'Malaysia': 'my', 'Singapore': 'sg',
    'Norway': 'no', 'Sweden': 'se', 'Denmark': 'dk', 'Finland': 'fi',
    'Netherlands': 'nl', 'France': 'fr', 'Spain': 'es', 'Italy': 'it',
    'Ireland': 'ie', 'Belgium': 'be', 'Switzerland': 'ch', 'Austria': 'at',
    'Philippines': 'ph', 'Indonesia': 'id', 'Thailand': 'th', 'Vietnam': 'vn',
    'South Korea': 'kr', 'Republic of Korea': 'kr', 'Korea': 'kr',
    'Taiwan': 'tw', 'Hong Kong': 'hk',
    'Brazil': 'br', 'Mexico': 'mx', 'Argentina': 'ar', 'Chile': 'cl',
    'South Africa': 'za', 'Kenya': 'ke', 'Nigeria': 'ng'
  };

  // Resolve a scholar profile to a flag HTML snippet, or empty string if the
  // work country isn't known or isn't in the ISO map. Uses flagcdn.com — a
  // stable, dependency-free public SVG flag CDN — so each card fetches only
  // the one flag it needs (browser-cached after first load).
  function scholarFlagHtml(profile) {
    if (!profile) return '';
    const country = scholarWorkCountry(profile);
    if (!country) return '';
    const iso = COUNTRY_ISO[country];
    if (!iso) return '';
    const alt = escapeAttr(country);
    return `<img class="db-scholar-card__flag" src="https://flagcdn.com/${iso}.svg" alt="${alt} flag" title="${alt}" loading="lazy" width="49" height="34" />`;
  }

  const ORCID_SVG = '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><circle cx="128" cy="128" r="128" fill="#A6CE39"/><path fill="#fff" d="M86.3 186.2H70.9V79.1h15.4v107.1zM108.9 79.1h41.6c39.6 0 57 28.3 57 53.6 0 27.5-21.5 53.6-56.8 53.6h-41.8V79.1zm15.4 93.3h24.5c34.9 0 42.9-26.5 42.9-39.7C191.7 111.5 178 92 148 92h-23.7v80.4zM88.7 56.8a10.1 10.1 0 1 1-20.2 0 10.1 10.1 0 0 1 20.2 0z"/></svg>';
  const GS_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>';

  // ---- Memorial band (Panel F lifespan strip) --------------------------
  // Render the small dark plinth beneath the scholar photograph. Master-
  // mode dashboard: `profile.deceased`, `profile.yearOfBirth`, and
  // `profile.yearOfDeath` are wired by js/samoa-database-adapter.js from the
  // Master Scholars sheet (columns Alive / Deceased, Year of Birth, Year
  // of Death) with legacy sidecar admin-extras as fallback.
  //
  // Approved display rules (2026-08-23 Perplexity_Pre_Redeployment doc):
  //   Rule A — birth + death known    -> "1942 – 2024" (en-dash preserved
  //                                       from existing Panel F design).
  //   Rule B — only death known       -> "d. 2024"
  //   Rule C — only birth known but
  //            status = Deceased      -> "In memoriam" (restrained
  //                                       fallback; never invent a death
  //                                       year).
  //   Rule D — no years, Deceased     -> "In memoriam".
  //   Rule E — living scholar         -> render nothing (return '').
  //
  // Ron's regression case: Dr. Jemesa Tudravu (ITK-S0381), Deceased with
  // Year of Death known and Year of Birth unknown -> "d. YYYY". The
  // adapter surfaces Year of Death from the Master; when the Master cell
  // is populated this branch will produce that exact string.
  //
  // All styling lives in `.db-scholar-card__memorial` in the master-mode
  // dashboard HTML; this function must not change the strip's markup or
  // classnames.
  function renderCardMemorialBand(profile) {
    if (!profile || profile.deceased !== true) return ''; // Rule E
    const yob = Number.isFinite(profile.yearOfBirth) ? profile.yearOfBirth : null;
    const yod = Number.isFinite(profile.yearOfDeath) ? profile.yearOfDeath : null;
    let text;
    if (yob && yod)      text = `${yob} – ${yod}`;   // Rule A
    else if (yod)        text = `d. ${yod}`;         // Rule B (regression: Jemesa)
    else                 text = 'In memoriam';       // Rules C, D — never invent
    return `<div class="db-scholar-card__memorial" aria-label="Memorial: ${escapeAttr(text)}">${escapeHtml(text)}</div>`;
  }

  function provinceToConfederacy(name) {
    if (!name || !state.districts) return null;
    const f = state.districts.features.find(x => x.properties.name === name);
    return f ? f.properties.region : null;
  }

  function formatLastUpdate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderScholarCard(r) {
    const active = state.filter.scholar === r.name;
    const salutation = r.salutation || '';
    const first = r.first || (r.name.includes(',') ? r.name.split(',')[1].trim() : '');
    const last  = r.last  || (r.name.includes(',') ? r.name.split(',')[0].trim() : r.name);
    const displayName = `${salutation ? salutation + ' ' : ''}${first} ${last}`.trim();
    // Panel F scholar-card identity geography: paternal fields ONLY. No
    // maternal fallback, no `effectivePaternalProvince`, no merged village.
    // See docs/PANELF-PATERNAL-GEOGRAPHY-2026-08-25.md and the corresponding
    // regression test for ITK-S0212 (Malelili Rokomatu — must render as
    // "Naseyani vlg, Ra District." NOT "Naseyani vlg (Beqa Is), Ra District.").
    const paternalGeography = {
      village:  (r.paternalVillage  || '').trim(),
      island:   (r.paternalIsland   || '').trim(),
      district: (r.paternalDistrict || '').trim()
    };
    const village = paternalGeography.village;
    const paternal = paternalGeography.district;
    const region = provinceToConfederacy(paternal);
    const gradient = (region && CONF_GRADIENT[region]) || NEUTRAL_GRADIENT;
    const bannerLabel = region ? `${ region } Statistical Region` : 'Samoan Scholar';
    const institution = r.institution || '';
    const title = r.title || '';
    const lastUpdate = formatLastUpdate(r.lastUpdate);
    const t = r.types || {};
    const initials = ((first || last).slice(0, 1) + (last ? last.slice(0, 1) : '')).toUpperCase() || 'iT';

    // Meta line format (V2 canonical, per Ron's 2026-08-24 spec):
    //   village + outer island + district  →  'Malawai vlg (Gau Is), Lomaiviti District.'
    //   village + Viti/Vanua Levu          →  'Naduri vlg, Macuata District.'      (island suppressed)
    //   village only                       →  'Malawai vlg'
    //   island only (outer)                →  'Gau Is'
    //   district only                      →  'Lomaiviti District.'
    //   nothing                            →  '<em>Village not yet added</em>' (empty-state chip)
    //
    // The 'vlg' + 'Is' abbreviations, the mainland-island suppression, the
    // island-suffix normalization, and the sentinel/placeholder scrubbing
    // are all handled by formatScholarGeography(); this renderer only wraps
    // the string in a placeholder chip when it's empty. See the formatter
    // definition near the top of this file.
    const island = paternalGeography.island;
    const geoLine = formatScholarGeography(village, island, paternal);
    const metaHtml = geoLine
      ? escapeHtml(geoLine)
      : '<span class="db-scholar-card__meta--empty">Village not yet added</span>';

    // Institution: linked to r.institutionUrl (institution homepage) if present
    let institutionHtml;
    if (institution) {
      institutionHtml = r.institutionUrl
        ? `<a href="${escapeAttr(r.institutionUrl)}" target="_blank" rel="noopener">${escapeHtml(institution)}</a>`
        : escapeHtml(institution);
    } else {
      institutionHtml = '<span class="db-scholar-card__institution--empty">Institution not yet added</span>';
    }
    // Department: rendered under institution when the admin filled it.
    // Linked to r.departmentUrl if present.
    const departmentText = r.department || '';
    let departmentHtml = '';
    if (departmentText) {
      departmentHtml = r.departmentUrl
        ? `<a href="${escapeAttr(r.departmentUrl)}" target="_blank" rel="noopener">${escapeHtml(departmentText)}</a>`
        : escapeHtml(departmentText);
    }
    // Professional title: linked to r.profileUrl (faculty/job profile page)
    // when populated. Both branches carry an explicit `title` attribute so
    // the parent card's 'Click to filter items to <scholar>’s papers'
    // tooltip never bleeds through on hover of the professional-title cell
    // (which would otherwise be misleading — the title is a person’s job
    // role, not a publication filter). See Ron's 2026-08-23 note.
    let titleHtml = '';
    if (title) {
      const titleTooltip = r.profileUrl
        ? `Open ${(displayName || r.name).replace(/"/g, '')}’s profile`
        : `${title}`;
      titleHtml = r.profileUrl
        ? `<a href="${escapeAttr(r.profileUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(titleTooltip)}">${escapeHtml(title)}</a>`
        : `<span title="${escapeAttr(titleTooltip)}">${escapeHtml(title)}</span>`;
    }

    // Type chips (only non-zero, in CHIP_ORDER)
    const chipsHtml = CHIP_ORDER.filter(k => (t[k] || 0) > 0).map(k => {
      const s = TYPE_STYLES[k];
      const label = t[k] === 1 ? s.s : s.p;
      return `<span class="db-scholar-card__type-chip" style="background:${s.bg};border-color:${s.border};color:${s.color};">`
        + `<span class="n" style="color:${s.color};">${t[k]}</span> ${label}</span>`;
    }).join('');

    const card = document.createElement('article');
    const isNeutral = !region || !CONF_GRADIENT[region];
    card.className = 'db-scholar-card'
      + (active ? ' is-active' : '')
      + (isNeutral ? ' db-scholar-card--neutral' : '');
    card.title = `Click to filter items to ${r.name}’s papers`;
    card.style.setProperty('--conf-from', gradient.from);
    card.style.setProperty('--conf-to', gradient.to);
    card.addEventListener('click', ev => {
      // Ignore clicks on external-profile icons, the Submit-info button,
      // or any anchor inside the card body (institution/department/title
      // links to external homepages/faculty profiles). Otherwise a click
      // that was meant to open a profile URL would also toggle the
      // publication filter on this card.
      if (ev.target.closest('.db-scholar-card__gs, .db-scholar-card__orcid, .db-scholar-card__submit')) return;
      if (ev.target.closest('.db-scholar-card__info a')) return;
      state.filter.scholar = state.filter.scholar === r.name ? '' : r.name;
      state.shown = state.pageSize;
      afterFilterChange();
      $('.db-items').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Photo (as background image) or initials fallback. Wrapped in a
    // photo-column container so the 'Submit info' button can stack directly
    // beneath the photo without ever running under the statistical region banner
    // title (which sits in the same row and would otherwise be overlapped
    // on shorter names or wider titles like a long statistical-region name).
    const photoInnerHtml = r.photo
      ? `<div class="db-scholar-card__photo" style="background-image:url('${escapeAttr(r.photo)}')"></div>`
      : `<div class="db-scholar-card__photo"><div class="db-scholar-card__initials">${escapeHtml(initials)}</div></div>`;
    // Memorial plinth sits directly beneath the photo (before the Update
    // info button in the same flex column). Returns '' for living scholars
    // — no DOM added when deceased is false or unset.
    const memorialHtml = renderCardMemorialBand(r);
    // When the scholar is flagged deceased, we tag the photo-col with an
    // `is-deceased` modifier. That single class lets our CSS switch the
    // photo's white border to black so it visually matches the dark
    // memorial plinth directly beneath it — no changes to the photo
    // element itself and no effect on living scholars.
    const photoColClass = (r && r.deceased === true)
      ? 'db-scholar-card__photo-col db-scholar-card__photo-col--is-deceased'
      : 'db-scholar-card__photo-col';
    const photoHtml = `
      <div class="${photoColClass}">
        ${photoInnerHtml}
        ${memorialHtml}
        <button type="button" class="db-scholar-card__submit" data-submit-info
                title="Suggest corrections or add missing info for this scholar (name, institution, links, photo, or a BibTeX/EndNote file of their publications). Submissions go to Vave Lab for review before publishing.">
          Update info
        </button>
      </div>`;

    // Work-country flag (positioned just left of the ORCID icon in the banner).
    // Empty string when the scholar's work country is unknown or not in the ISO map.
    const flagHtml = scholarFlagHtml(r);

    card.innerHTML = `
      <div class="db-scholar-card__banner"><span class="db-scholar-card__conf-label">${escapeHtml(bannerLabel)}</span></div>
      ${flagHtml}
      ${r.orcidUrl
        ? `<a class="db-scholar-card__orcid"
              href="${escapeAttr(r.orcidUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              title="Open ${escapeAttr(displayName || r.name)}’s ORCID profile"
              aria-label="Open ${escapeAttr(displayName || r.name)}’s ORCID profile">${ORCID_SVG}</a>`
        : `<span class="db-scholar-card__orcid is-missing"
                role="img"
                aria-disabled="true"
                title="ORCID profile not yet linked"
                aria-label="ORCID profile not yet linked">${ORCID_SVG}</span>`}
      ${r.googleScholarUrl
        ? `<a class="db-scholar-card__gs"
              href="${escapeAttr(r.googleScholarUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              title="Open ${escapeAttr(displayName || r.name)}’s Google Scholar profile"
              aria-label="Open ${escapeAttr(displayName || r.name)}’s Google Scholar profile">${GS_SVG}</a>`
        : `<span class="db-scholar-card__gs is-missing"
                role="img"
                aria-disabled="true"
                title="Google Scholar profile not yet linked"
                aria-label="Google Scholar profile not yet linked">${GS_SVG}</span>`}
      <div class="db-scholar-card__body">
        ${photoHtml}
        <div class="db-scholar-card__info">
          <h3 class="db-scholar-card__name">${escapeHtml(displayName || (first + ' ' + last).trim())}</h3>
          <div class="db-scholar-card__meta">${metaHtml}</div>
          <div class="db-scholar-card__institution">${institutionHtml}</div>
          ${departmentHtml ? `<div class="db-scholar-card__department">${departmentHtml}</div>` : ''}
          ${title ? `<div class="db-scholar-card__title">${titleHtml}</div>` : ''}
          ${lastUpdate ? `<div class="db-scholar-card__updated">Last update: <em>${escapeHtml(lastUpdate)}</em></div>` : ''}
        </div>
      </div>
      ${renderScholarInsightBlock(r)}
      <div class="db-scholar-card__stats">
        <div class="db-scholar-card__stat"><span class="db-scholar-card__stat-num">${r.total}</span><span class="db-scholar-card__stat-label">Publication${r.total === 1 ? '' : 's'}</span></div>
        <div class="db-scholar-card__stat"><span class="db-scholar-card__stat-num accent">${r.firstAuthored}</span><span class="db-scholar-card__stat-label">First-authored</span></div>
      </div>
      ${(r._authorshipGap === true && Number(r.total) === 0) ? `
      <div class="db-scholar-card__linkage-flag" title="Some publications by this scholar are still being linked to their Scholar ID in the Master file. The count above reflects only currently-linked publications.">
        <span class="db-scholar-card__linkage-flag-icon" aria-hidden="true">⚠</span>
        Publication linkage being updated
      </div>` : ''}
      ${chipsHtml ? `<div class="db-scholar-card__types">${chipsHtml}</div>` : ''}
    `;
    wireScholarInsight(card);
    wireScholarSubmit(card, r);
    return card;
  }

  // ===================== Submit-info modal =====================
  // Endpoint that receives the submission. Formsubmit.co sends every field
  // (including file uploads) to the target email address. First submission
  // triggers a one-time activation email that must be confirmed by the
  // recipient before further submissions go through. To switch delivery
  // providers later (e.g. Formspree, Web3Forms), only this URL needs to
  // change — the multipart/form-data POST shape is portable.
  const SUBMIT_ENDPOINT = 'https://formsubmit.co/ronvave2011@gmail.com';

  // Fill the paternal-district dropdown with the same district list the site
  // already ships. Called lazily on first modal open so the DOM is ready.
  let provinceOptionsFilled = false;
  function fillProvinceOptions() {
    if (provinceOptionsFilled) return;
    const sel = document.getElementById('db-sf-paternal');
    if (!sel) return;
    const provList = (state.districts && state.districts.features)
      ? state.districts.features.map(f => (f.properties && (f.properties.name || f.properties.NAME)) || '').filter(Boolean)
      : [];
    // Dedupe + sort so the UI stays sane even if the geojson has quirks.
    const uniq = Array.from(new Set(provList)).sort();
    uniq.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
    provinceOptionsFilled = true;
  }

  function wireScholarSubmit(card, row) {
    const btn = card.querySelector('[data-submit-info]');
    if (!btn) return;
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      openScholarSubmitModal(row);
    });
  }

  function openScholarSubmitModal(row) {
    const modal = document.getElementById('db-submit-modal');
    if (!modal) return;
    fillProvinceOptions();

    // Pull existing enriched profile (village, institution, urls, etc) so we
    // can pre-populate the form. Fall back to empty strings when unknown.
    const profile = (state.scholarProfilesByName && state.scholarProfilesByName.get(row.name)) || {};
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : String(v); };

    setVal('db-sf-yourname', '');
    setVal('db-sf-youremail', '');
    setVal('db-sf-relationship', '');

    setVal('db-sf-salutation',   profile.salutation || '');
    setVal('db-sf-village',      profile.village || '');
    setVal('db-sf-paternal',     profile.paternalDistrict || '');
    setVal('db-sf-title',        profile.title || '');
    setVal('db-sf-institution',  profile.institution || '');
    setVal('db-sf-institution-url', profile.institutionUrl || '');
    setVal('db-sf-department',   profile.department || '');
    setVal('db-sf-department-url', profile.departmentUrl || '');
    setVal('db-sf-profile-url',  profile.profileUrl || '');
    setVal('db-sf-scholar-url',  profile.googleScholarUrl || '');
    setVal('db-sf-orcid-url',    profile.orcidUrl || '');
    setVal('db-sf-photo',        profile.photo || '');
    setVal('db-sf-masters-uni',     (profile.masters && profile.masters.university) || '');
    setVal('db-sf-masters-country', (profile.masters && profile.masters.country) || '');
    setVal('db-sf-phd-uni',         (profile.phd && profile.phd.university) || '');
    setVal('db-sf-phd-country',     (profile.phd && profile.phd.country) || '');
    setVal('db-sf-notes', '');
    const bibFile = document.getElementById('db-sf-bib-file'); if (bibFile) bibFile.value = '';
    const photoFile = document.getElementById('db-sf-photo-file'); if (photoFile) photoFile.value = '';

    // Hidden fields for provenance + email subject line
    setVal('db-sf-scholar-name', row.name);
    setVal('db-sf-scholar-slug', (profile.slug || row.name || '').toString());
    setVal('db-sf-subject', `Vave Lab — submit info for ${row.name}`);

    // Header subtitle
    const sub = document.getElementById('db-submit-modal-sub');
    if (sub) sub.textContent = `Correcting / adding info for ${row.name}. Fields below are pre-filled with the info the public dashboard is currently showing.`;

    // Reset status
    const status = document.getElementById('db-submit-status');
    if (status) { status.textContent = ''; status.className = 'db-submit-modal__status'; }
    const submitBtn = document.querySelector('[data-submit-send]');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit for review'; }

    modal.classList.add('is-visible');
    document.body.style.overflow = 'hidden';
  }

  function closeScholarSubmitModal() {
    const modal = document.getElementById('db-submit-modal');
    if (!modal) return;
    modal.classList.remove('is-visible');
    document.body.style.overflow = '';
  }

  // Wire modal-level interactions (once on load, not per card).
  function wireSubmitModalOnce() {
    const modal = document.getElementById('db-submit-modal');
    if (!modal || modal.dataset.wired) return;
    modal.dataset.wired = '1';

    // Cancel button + backdrop click + ESC
    modal.querySelector('[data-submit-cancel]').addEventListener('click', closeScholarSubmitModal);
    modal.addEventListener('click', ev => {
      if (ev.target === modal) closeScholarSubmitModal();
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && modal.classList.contains('is-visible')) closeScholarSubmitModal();
    });

    const form   = document.getElementById('db-submit-form');
    const status = document.getElementById('db-submit-status');
    const submitBtn = form.querySelector('[data-submit-send]');

    function showStatus(kind, msg) {
      if (!status) return;
      status.textContent = msg;
      status.className = 'db-submit-modal__status is-visible is-' + kind;
    }

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      // Enforce required fields explicitly — native validation may be
      // suppressed by the `novalidate` attribute on the form.
      const yourName  = form.querySelector('#db-sf-yourname').value.trim();
      const yourEmail = form.querySelector('#db-sf-youremail').value.trim();
      const rel       = form.querySelector('#db-sf-relationship').value.trim();
      if (!yourName || !yourEmail || !rel) {
        showStatus('error', 'Please fill in your name, email, and relationship before submitting.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(yourEmail)) {
        showStatus('error', 'That email address doesn\u2019t look right — double-check the format (e.g. name@example.com).');
        return;
      }

      // Snapshot every text field as a JSON blob so Ron can paste the entire
      // structured submission into the admin dashboard in one shot without
      // re-typing each field.
      const jsonBlob = {
        scholar_name:   form.querySelector('#db-sf-scholar-name').value,
        scholar_slug:   form.querySelector('#db-sf-scholar-slug').value,
        submitter: {
          name:  yourName,
          email: yourEmail,
          relationship: rel
        },
        profile: {
          salutation:       form.querySelector('#db-sf-salutation').value.trim(),
          village:          form.querySelector('#db-sf-village').value.trim(),
          paternalDistrict: form.querySelector('#db-sf-paternal').value.trim(),
          title:            form.querySelector('#db-sf-title').value.trim(),
          institution:      form.querySelector('#db-sf-institution').value.trim(),
          institutionUrl:   form.querySelector('#db-sf-institution-url').value.trim(),
          department:       form.querySelector('#db-sf-department').value.trim(),
          departmentUrl:    form.querySelector('#db-sf-department-url').value.trim(),
          profileUrl:       form.querySelector('#db-sf-profile-url').value.trim(),
          googleScholarUrl: form.querySelector('#db-sf-scholar-url').value.trim(),
          orcidUrl:         form.querySelector('#db-sf-orcid-url').value.trim(),
          photo:            form.querySelector('#db-sf-photo').value.trim()
        },
        masters: {
          university: form.querySelector('#db-sf-masters-uni').value.trim(),
          country:    form.querySelector('#db-sf-masters-country').value.trim()
        },
        phd: {
          university: form.querySelector('#db-sf-phd-uni').value.trim(),
          country:    form.querySelector('#db-sf-phd-country').value.trim()
        },
        notes: form.querySelector('#db-sf-notes').value.trim(),
        submittedAt: new Date().toISOString()
      };
      form.querySelector('#db-sf-submission-json').value = JSON.stringify(jsonBlob, null, 2);

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending\u2026';
      showStatus('success', 'Sending your submission\u2026');

      try {
        const fd = new FormData(form);
        // Formsubmit.co’s AJAX endpoint returns JSON but doesn’t accept file
        // uploads on that path. When files are attached, fall back to a same-
        // origin fetch to the regular endpoint (which redirects). We handle
        // the redirect manually by catching a network-level 'opaqueredirect'.
        const hasFile = fd.getAll('publications_file').some(v => v && v.name)
                     || fd.getAll('photo_file').some(v => v && v.name);
        const url = SUBMIT_ENDPOINT.replace('formsubmit.co/', hasFile ? 'formsubmit.co/' : 'formsubmit.co/ajax/');

        const res = await fetch(url, {
          method: 'POST',
          body: fd,
          headers: hasFile ? {} : { 'Accept': 'application/json' },
          redirect: 'follow'
        });
        // Success = HTTP 200 (json path) or a redirect landed successfully.
        if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status);
        showStatus('success',
          `Thank you! Your submission for ${jsonBlob.scholar_name} has been sent to Vave Lab for review. ` +
          `We\u2019ll update the public profile once we\u2019ve confirmed the changes with you if needed. ` +
          `You can close this window now.`);
        submitBtn.textContent = 'Submitted';
        // Auto-close after a moment so the user isn’t stuck.
        setTimeout(closeScholarSubmitModal, 4500);
      } catch (err) {
        console.error('scholar-info submission failed:', err);
        showStatus('error',
          'Sorry — the submission couldn\u2019t be sent right now. ' +
          'Please try again in a minute, or email ronvave2011@gmail.com directly with your corrections.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit for review';
      }
    });
  }

  // -------- "Explain their research (AI generated)" — button + expandable panel --------
  // A dedicated section on each scholar card. The button sits between the
  // Last-update line and the publication stats; clicking it expands to reveal
  // pre-generated research keywords (as coloured pill tags) and a plain-English
  // summary. Keywords + summary come from data/scholar-insights.json which is
  // rebuilt by scripts/build_scholar_insights.py whenever the Zotero snapshot
  // changes (guarded by a per-scholar item-set signature so unchanged scholars
  // are not regenerated).
  function insightLookupKey(rowName) {
    // Try the row name ("Last, First" from the Zotero sub-collection) first,
    // then a stripped "Last, first-token" variant so "Tabudravu, Jioji" also
    // matches an insight generated for "Tabudravu, Jioji N.".
    const map = state.scholarInsights || {};
    if (map[rowName]) return rowName;
    const [lastPart, firstPart] = (rowName || '').split(',').map(s => (s || '').trim());
    if (lastPart && firstPart) {
      const stripped = `${lastPart}, ${firstPart.split(/\s+/)[0]}`;
      if (map[stripped]) return stripped;
      // As a last resort, try any key that shares the same last name + first-token.
      const lastLow = lastPart.toLowerCase();
      const firstTokLow = firstPart.split(/\s+/)[0].toLowerCase();
      const hit = Object.keys(map).find(k => {
        const [l, f] = k.split(',').map(s => (s || '').trim());
        return l && f
          && l.toLowerCase() === lastLow
          && f.split(/\s+/)[0].toLowerCase() === firstTokLow;
      });
      if (hit) return hit;
    }
    return null;
  }

  function renderScholarInsightBlock(r) {
    const key = insightLookupKey(r.name);
    const insight = key ? state.scholarInsights[key] : null;
    const btnId   = `db-insight-btn-${(r.key || r.name || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const panelId = `db-insight-panel-${(r.key || r.name || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const hasKeywords = !!insight && (insight.keywords || []).length >= 1;
    // Accept both the V1 (`summary`) and V2 (`summaryHtml`) field names so a
    // scholar authored via Admin V2's paste flow renders the plain-English
    // paragraph. The V1 legacy file stored the paragraph in `summary`; the
    // V2 Admin normaliser now writes it into `summaryHtml`. Panel F is
    // agnostic — whichever field is populated wins.
    const summaryText = insight ? (insight.summaryHtml || insight.summary || '') : '';
    const hasSummary  = !!(summaryText && summaryText.trim());
    const hasInsight  = hasKeywords || hasSummary;

    const tagsHtml = hasKeywords ? (insight.keywords || []).map((k, i) =>
      `<span class="db-scholar-card__insight-tag" data-tag-color="${i % 8}">${escapeHtml(k)}</span>`
    ).join('') : '';

    // Curated summaries may embed <a> / <em> / <strong> — sanitize before
    // injecting. Rule-based fallback summaries stay plain text and are
    // still safely handled by sanitizeSummaryHtml (which escape-encodes
    // non-whitelisted markup). If a curated entry has a real summary but no
    // keyword pills (scholar with no findable web presence), still render
    // the summary honestly rather than falling back to a misleading
    // "not yet generated" placeholder.
    const summaryHtml = hasSummary
      ? `<p class="db-scholar-card__insight-summary">${sanitizeSummaryHtml(summaryText)}</p>`
      : `<p class="db-scholar-card__insight-summary db-scholar-card__insight-summary--empty">Insight not yet generated for this scholar. It will appear here after the next data refresh.</p>`;

    return `
      <button type="button" id="${btnId}" class="db-scholar-card__insight-btn"
              data-insight-btn aria-expanded="false" aria-controls="${panelId}">
        <span class="db-scholar-card__insight-btn-label">Explain their research</span>
        <span class="db-scholar-card__insight-btn-tag">(AI generated)</span>
        <span class="db-scholar-card__insight-btn-chev" aria-hidden="true">\u25be</span>
      </button>
      <div class="db-scholar-card__insight" id="${panelId}" data-insight-panel hidden>
        <div class="db-scholar-card__insight-section">
          <div class="db-scholar-card__insight-heading">Research keywords</div>
          <div class="db-scholar-card__insight-tags">${tagsHtml || '<span class="db-scholar-card__insight-caption">(none yet)</span>'}</div>
          <div class="db-scholar-card__insight-caption">Generated once from this scholar's indexed publications.</div>
        </div>
        <div class="db-scholar-card__insight-section">
          <div class="db-scholar-card__insight-heading">Plain-English summary</div>
          ${summaryHtml}
          <div class="db-scholar-card__insight-caption"><em>AI-generated summary based on this scholar's indexed publications \u2014 may not capture every nuance of their work.</em></div>
        </div>
      </div>
    `;
  }

  function wireScholarInsight(card) {
    const btn = card.querySelector('[data-insight-btn]');
    const panel = card.querySelector('[data-insight-panel]');
    if (!btn || !panel) return;
    btn.addEventListener('click', ev => {
      // Don't trip the outer card click-to-select handler.
      ev.stopPropagation();
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.hidden = open;
    });
  }

  function renderScholarPager(totalItems, totalPages) {
    const pager = $('[data-db-pager]');
    if (!pager) return;
    pager.innerHTML = '';
    if (totalPages <= 1) return;

    const btn = (label, onClick, opts = {}) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (opts.active) b.classList.add('is-active');
      if (opts.disabled) b.disabled = true;
      if (!opts.disabled) b.addEventListener('click', onClick);
      return b;
    };
    const goto = n => {
      state.scholarPage = Math.min(Math.max(1, n), totalPages);
      renderLeaders();
      $('.db-leaderboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    pager.appendChild(btn('‹ Prev', () => goto(state.scholarPage - 1), { disabled: state.scholarPage === 1 }));

    // Show a windowed page range: 1, current-1, current, current+1, totalPages
    const seen = new Set();
    const pages = [];
    const add = n => { if (n >= 1 && n <= totalPages && !seen.has(n)) { seen.add(n); pages.push(n); } };
    add(1);
    for (let d = -1; d <= 1; d++) add(state.scholarPage + d);
    add(totalPages);
    pages.sort((a,b) => a - b);
    let prev = 0;
    pages.forEach(n => {
      if (prev && n - prev > 1) {
        const gap = document.createElement('span');
        gap.textContent = '…';
        gap.style.color = 'var(--color-text-muted)';
        gap.style.padding = '0 4px';
        pager.appendChild(gap);
      }
      pager.appendChild(btn(String(n), () => goto(n), { active: n === state.scholarPage }));
      prev = n;
    });

    pager.appendChild(btn('Next ›', () => goto(state.scholarPage + 1), { disabled: state.scholarPage === totalPages }));
    const info = document.createElement('span');
    info.className = 'db-pager__info';
    info.textContent = `${totalItems} scholars · page ${state.scholarPage} of ${totalPages}`;
    pager.appendChild(info);
  }

  // ============ ITEMS FILTER + CARDS ============
  function itemMatches(item) {
    const f = state.filter;
    if (f.itemType) {
      // Support both the base Zotero itemType (`thesis`, `book`, ...) and our
      // visual sub-types (`thesisPhd`, `thesisMasters`, `thesisUnknown`).
      const vt = visualType(item);
      if (item.itemType !== f.itemType && vt !== f.itemType) return false;
    }
    if (f.year && item.year !== f.year) return false;

    if (f.decade) {
      const d = parseInt(f.decade, 10);
      if (!item.year || item.year < d || item.year >= d + 10) return false;
    }
    if (f.discipline) {
      const set = state.disciplinesByItem.get(item.key);
      if (!set || !set.has(f.discipline)) return false;
    }
    if (f.district) {
      const set = state.provincesByItem.get(item.key);
      if (!set || !set.has(f.district)) return false;
    }
    if (f.paternal) {
      const set = state.paternalByItem.get(item.key);
      if (!set || !set.has(f.paternal)) return false;
    }
    if (f.university) {
      const uni = state.universities.universities.find(u => u.name === f.university);
      if (!uni || !(item.collections || []).includes(uni.zoteroCollectionKey)) return false;
    }
    if (f.scholar) {
      const set = state.scholarByItem.get(item.key);
      if (!set || !set.has(f.scholar)) return false;
    }
    // Statistical Region/district dropdown filters on the scholar leaderboard also
    // narrow the item list below. An item passes if it belongs to at least one
    // scholar in the visible-cards set.
    if (state.scholarFilterNames) {
      const set = state.scholarByItem.get(item.key);
      if (!set) return false;
      let any = false;
      state.scholarFilterNames.forEach(n => { if (set.has(n)) any = true; });
      if (!any) return false;
    }
    // Panel B2 authorship view: filter by authorship category when set.
    if (f.b2Authorship) {
      const scholars = state.scholarProfilesByName || new Map();
      const creators = item.creators || [];
      const firstIsItaukei = !!itaukeiName(creators[0], scholars);
      const anyItaukei = firstIsItaukei || creators.slice(1).some(c => itaukeiName(c, scholars));
      if (f.b2Authorship === 'itaukeiFirst'    && !firstIsItaukei) return false;
      if (f.b2Authorship === 'includesItaukei' && !(anyItaukei && !firstIsItaukei)) return false;
      if (f.b2Authorship === 'noItaukei'       && anyItaukei) return false;
    }
    if (f.q) {
      const q = f.q.toLowerCase();
      const hay = [
        item.title, item.publicationTitle, item.university, item.thesisType,
        (item.creators || []).join(' '),
        (item.tags || []).join(' ')
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderItems() {
    const items = currentItems().filter(itemMatches);
    items.sort((a,b) => (b.year||0) - (a.year||0) || a.title.localeCompare(b.title));
    const list = $('[data-db-items]');
    list.innerHTML = '';
    const shown = items.slice(0, state.shown);
    $('[data-db-item-count]').textContent = items.length;

    if (items.length === 0) {
      list.appendChild(el('li', { className: 'db-item db-item__empty' },
        'No items match the current filters. Try clearing one, or use the search box.'
      ));
    }

    shown.forEach(it => list.appendChild(renderItemCard(it)));

    const btn = $('[data-db-load-more]');
    const remaining = items.length - state.shown;
    if (remaining > 0) {
      btn.style.display = 'block';
      btn.textContent = `Show 25 more (${remaining} remaining)`;
    } else {
      btn.style.display = 'none';
    }
  }

  function renderItemCard(it) {
    // data-type uses the visual sub-type so the coloured left border reflects
    // PhD/Masters/base for theses.
    const li = el('li', { className: 'db-item', 'data-type': visualType(it) });
    // Show the visual sub-type label (e.g. "PhD Thesis") when applicable
    const type = TYPE_LABELS[visualType(it)] || TYPE_LABELS[it.itemType] || TYPE_LABELS.document;
    const authorList = (it.creators || []).slice(0, 5).join(', ') + (it.creators && it.creators.length > 5 ? ', et al.' : '');
    const zoteroUrl = `https://www.zotero.org/groups/5983386/samoan_scholarly_research/items/${it.key}`;
    const doiUrl = it.DOI ? `https://doi.org/${it.DOI}` : null;
    const primaryLink = doiUrl || it.url || zoteroUrl;

    const metaParts = [];
    if (it.year) metaParts.push(String(it.year));
    if (it.publicationTitle) metaParts.push(`<em>${escapeHtml(it.publicationTitle)}</em>`);
    if (it.university) metaParts.push(escapeHtml(it.university));
    if (it.thesisType && !it.publicationTitle) metaParts.push(escapeHtml(it.thesisType));

    // Type + status badges
    const topline = document.createElement('div');
    topline.className = 'db-item__topline';
    topline.innerHTML = `
      <span class="db-item__badge db-item__badge--type-${it.itemType}">${type}</span>
      ${doiUrl ? `<span class="db-item__badge db-item__badge--doi" title="Has DOI">DOI</span>` : ''}
      ${isOpenAccess(it) ? `<span class="db-item__badge db-item__badge--oa" title="Open-access or freely available online">OA</span>` : ''}
      ${isItaukei(it) ? `<span class="db-item__badge db-item__badge--samoan">Samoan author</span>` : ''}
    `;
    li.appendChild(topline);

    // Title
    li.appendChild(el('p', {
      className: 'db-item__title',
      html: `<a href="${escapeAttr(primaryLink)}" target="_blank" rel="noopener">${escapeHtml(it.title || '(untitled)')}</a>`
    }));
    // Authors
    if (authorList) li.appendChild(el('p', { className: 'db-item__authors' }, authorList));
    // Meta
    if (metaParts.length) li.appendChild(el('p', { className: 'db-item__meta', html: metaParts.join(' · ') }));

    // Tag chips: districts + disciplines (clickable to filter)
    const tags = document.createElement('div');
    tags.className = 'db-item__tags';
    const provSet = state.provincesByItem.get(it.key);
    if (provSet && provSet.size) {
      provSet.forEach(name => {
        const chip = el('span', {
          className: 'db-item__badge db-item__badge--tag is-clickable',
          title: `Filter by district researched: ${name}`,
          onclick: () => {
            state.filter.district = name;
            state.filter.paternal = '';
            state.shown = state.pageSize;
            afterFilterChange();
          }
        }, `📍 ${name}`);
        tags.appendChild(chip);
      });
    }
    const discSet = state.disciplinesByItem.get(it.key);
    if (discSet && discSet.size) {
      discSet.forEach(name => {
        const chip = el('span', {
          className: 'db-item__badge db-item__badge--tag is-clickable',
          title: `Filter by discipline: ${name}`,
          onclick: () => {
            state.filter.discipline = name;
            state.shown = state.pageSize;
            const sel = $('[data-db-filter="discipline"]');
            if (sel) sel.value = name;
            afterFilterChange();
          }
        }, name);
        tags.appendChild(chip);
      });
    }
    if (tags.childNodes.length) li.appendChild(tags);

    // Action links top-right (open + copy buttons)
    const actions = document.createElement('div');
    actions.className = 'db-item__actions';
    if (doiUrl) {
      actions.innerHTML += `<a class="db-item__link" href="${escapeAttr(doiUrl)}" target="_blank" rel="noopener" title="Open via DOI">DOI ↗</a>`;
    } else if (it.url) {
      actions.innerHTML += `<a class="db-item__link" href="${escapeAttr(it.url)}" target="_blank" rel="noopener" title="Open source URL">Link ↗</a>`;
    }
    actions.innerHTML += `<a class="db-item__link" href="${escapeAttr(zoteroUrl)}" target="_blank" rel="noopener" title="Open in Zotero library">Zotero ↗</a>`;
    // Per-item copy buttons — formatted citation (respects state.citationFormat)
    // and BibTeX entry. Each button copies to clipboard and briefly shows a
    // "Copied" state so the user knows the click landed.
    const copyCite = el('button', {
      type: 'button',
      className: 'db-item__copy',
      title: 'Copy the formatted citation for this item in the currently-selected style',
      onclick: (ev) => {
        const text = formatCitation(it, state.citationFormat || 'apa');
        copyToClipboard(text, ev.currentTarget, 'Copied citation');
      }
    }, 'Copy cite');
    actions.appendChild(copyCite);
    const copyBib = el('button', {
      type: 'button',
      className: 'db-item__copy',
      title: 'Copy this item as a BibTeX entry',
      onclick: (ev) => {
        const text = formatBibTeXEntry(it);
        copyToClipboard(text, ev.currentTarget, 'Copied BibTeX');
      }
    }, 'Copy BibTeX');
    actions.appendChild(copyBib);
    li.appendChild(actions);

    return li;
  }

  // ============ COPY-TO-CLIPBOARD HELPER ============
  function copyToClipboard(text, buttonEl, feedback) {
    const done = () => {
      if (!buttonEl) return;
      const prev = buttonEl.textContent;
      buttonEl.textContent = feedback || 'Copied';
      buttonEl.disabled = true;
      setTimeout(() => {
        buttonEl.textContent = prev;
        buttonEl.disabled = false;
      }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  }

  function isOpenAccess(it) {
    // Heuristic: URL points to a known OA host or contains typical OA path signals
    const u = (it.url || '').toLowerCase();
    if (!u) return false;
    return /(\/pmc\/|ncbi\.nlm\.nih\.gov|arxiv\.org|biorxiv|ssrn|researchsquare|preprints\.org|zenodo|osf\.io|figshare|hindawi|plos\.org|frontiersin|mdpi|doaj|jstor.*\/stable|repository\.usp\.ac\.fj|scholarspace\.manoa|scholarworks|dspace|thesescanada|core\.ac\.uk|semanticscholar|springeropen|biomedcentral)/i.test(u);
  }

  // ============ FILTER CHIPS ============
  function renderFilterChips() {
    const chips = $('[data-db-chips]');
    chips.innerHTML = '';
    const add = (labelText, valueText, clear) => {
      const c = el('span', { className: 'db-filter-chip' });
      c.appendChild(el('span', { className: 'db-filter-chip__label' }, labelText));
      c.appendChild(document.createTextNode(valueText));
      const x = el('button', { type: 'button', 'aria-label': `Clear ${labelText} filter`, onclick: () => clear() }, '×');
      c.appendChild(x);
      chips.appendChild(c);
    };
    if (state.filter.q)          add('Search:',     `“${state.filter.q}”`, () => { $('[data-db-search]').value = ''; clearFilter('q'); });
    if (state.filter.itemType)   add('Type:',       TYPE_LABELS[state.filter.itemType] || state.filter.itemType, () => { $('[data-db-filter="itemType"]').value = ''; clearFilter('itemType'); });
    if (state.filter.discipline) add('Discipline:', state.filter.discipline, () => { const s = $('[data-db-filter="discipline"]'); if (s) s.value = ''; clearFilter('discipline'); });
    if (state.filter.decade)     add('Decade:',     `${state.filter.decade}s`, () => { const s = $('[data-db-filter="decade"]'); if (s) s.value = ''; clearFilter('decade'); });
    if (state.filter.year)       add('Year:',       String(state.filter.year), () => clearFilter('year'));
    if (state.filter.district)   add('District:',   state.filter.district, () => clearFilter('district'));
    if (state.filter.paternal)   add('Paternal:',   state.filter.paternal, () => clearFilter('paternal'));
    if (state.filter.university) add('University:', state.filter.university, () => clearFilter('university'));
    if (state.filter.scholar)    add('Scholar:',    state.filter.scholar, () => clearFilter('scholar'));
    if (state.filter.b2Authorship) {
      const auth = { itaukeiFirst: 'Samoan first author', includesItaukei: 'Samoan co-author, not first author', noItaukei: 'No Samoan author identified' }[state.filter.b2Authorship] || state.filter.b2Authorship;
      add('Authorship:', auth, () => clearFilter('b2Authorship'));
    }
  }

  // ============ CITATION FORMATTERS ============
  //
  // formatCitation() emits a single-line prose citation for the currently
  // selected style (APA 7 → default; Chicago 17 author-date; MLA 9). All
  // three implementations lean on the same normalised author list so the
  // output is predictable for exports and copy-to-clipboard.
  //
  // formatBibTeXEntry() and formatRISEntry() emit a single record in their
  // respective bibliographic-manager formats. These are used by the copy
  // buttons on each item card AND by exportBib() / exportRis() below.
  //
  // formatCSVRow() emits one row for exportCsv(). Header row is emitted by
  // exportCsv() directly.

  function _bibKeyFor(it) {
    const lastName = (it.creators && it.creators[0]) ? String(it.creators[0]).split(' ').pop() : 'anon';
    return lastName.toLowerCase().replace(/\W/g, '') + (it.year || '');
  }

  // Split "Given Family" → { family, given }. If a creator record has no
  // recognisable family name (single-token), we treat it as an organisation.
  function _splitName(name) {
    const s = String(name || '').trim();
    if (!s) return { family: '', given: '' };
    const parts = s.split(/\s+/);
    if (parts.length === 1) return { family: parts[0], given: '' };
    return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
  }

  function _apaAuthors(creators) {
    if (!creators || !creators.length) return '';
    const names = creators.map(_splitName).map(p => {
      if (!p.given) return p.family;
      const initials = p.given.split(/\s+/).map(g => g.charAt(0).toUpperCase() + '.').join(' ');
      return `${p.family}, ${initials}`;
    });
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, & ${names[1]}`;
    if (names.length <= 20) return names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1];
    // APA 7: for 21+ authors, list first 19, then "...", then final author.
    return names.slice(0, 19).join(', ') + ', ... ' + names[names.length - 1];
  }

  function _chicagoAuthors(creators) {
    if (!creators || !creators.length) return '';
    const names = creators.map((c, i) => {
      const p = _splitName(c);
      if (!p.given) return p.family;
      // First author "Family, Given"; subsequent "Given Family".
      return i === 0 ? `${p.family}, ${p.given}` : `${p.given} ${p.family}`;
    });
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    if (names.length <= 10) return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
    // Chicago: for 11+ authors, list first 7 then "et al.".
    return names.slice(0, 7).join(', ') + ', et al.';
  }

  function _mlaAuthors(creators) {
    if (!creators || !creators.length) return '';
    const first = _splitName(creators[0]);
    const firstText = first.given ? `${first.family}, ${first.given}` : first.family;
    if (creators.length === 1) return firstText;
    if (creators.length === 2) {
      const second = _splitName(creators[1]);
      const secondText = second.given ? `${second.given} ${second.family}` : second.family;
      return `${firstText}, and ${secondText}`;
    }
    // MLA 9: 3+ authors → first author + ", et al."
    return `${firstText}, et al.`;
  }

  function _apaTitleCase(s) {
    // APA: sentence case for article/chapter titles. We do a light touch:
    // capitalise the first letter and leave the rest alone (Zotero titles
    // are usually already sentence-cased).
    const t = String(s || '').trim();
    if (!t) return t;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function _apaThesisType(it) {
    const vt = visualType(it);
    if (vt === 'thesisPhd') return 'Doctoral dissertation';
    if (vt === 'thesisMasters') return "Master's thesis";
    return (it.thesisType || 'Thesis');
  }

  function formatCitationAPA(it) {
    const authors = _apaAuthors(it.creators);
    const year = it.year ? `(${it.year})` : '(n.d.)';
    const title = _apaTitleCase(it.title || '');
    const parts = [];
    if (authors) parts.push(authors + '.');
    parts.push(year + '.');
    switch (visualType(it)) {
      case 'journalArticle': {
        parts.push(title + '.');
        if (it.publicationTitle) parts.push(`*${it.publicationTitle}*.`);
        break;
      }
      case 'book': {
        parts.push(`*${title}*.`);
        if (it.publisher) parts.push(it.publisher + '.');
        break;
      }
      case 'bookSection': {
        parts.push(title + '.');
        if (it.publicationTitle) parts.push(`In *${it.publicationTitle}*.`);
        if (it.publisher) parts.push(it.publisher + '.');
        break;
      }
      case 'thesisPhd':
      case 'thesisMasters':
      case 'thesisUnknown':
      case 'thesis': {
        parts.push(`*${title}*`);
        parts.push(`[${_apaThesisType(it)}${it.university ? ', ' + it.university : ''}].`);
        break;
      }
      case 'report': {
        parts.push(`*${title}*`);
        if (it.publisher || it.university) parts.push('(' + (it.publisher || it.university) + ').');
        break;
      }
      default: {
        parts.push(title + '.');
        if (it.publicationTitle) parts.push(`*${it.publicationTitle}*.`);
      }
    }
    if (it.DOI) parts.push(`https://doi.org/${it.DOI}`);
    else if (it.url) parts.push(it.url);
    return parts.join(' ');
  }

  function formatCitationChicago(it) {
    const authors = _chicagoAuthors(it.creators);
    const parts = [];
    if (authors) parts.push(authors + '.');
    if (it.year) parts.push(it.year + '.');
    switch (visualType(it)) {
      case 'journalArticle': {
        parts.push(`“${it.title}.”`);
        if (it.publicationTitle) parts.push(`*${it.publicationTitle}*.`);
        break;
      }
      case 'book': {
        parts.push(`*${it.title}*.`);
        if (it.publisher) parts.push(it.publisher + '.');
        break;
      }
      case 'bookSection': {
        parts.push(`“${it.title}.”`);
        if (it.publicationTitle) parts.push(`In *${it.publicationTitle}*.`);
        if (it.publisher) parts.push(it.publisher + '.');
        break;
      }
      case 'thesisPhd':
      case 'thesisMasters':
      case 'thesisUnknown':
      case 'thesis': {
        parts.push(`“${it.title}.”`);
        parts.push(`${_apaThesisType(it)}, ${it.university || ''}.`.replace(/, \./, '.'));
        break;
      }
      default: {
        parts.push(`“${it.title}.”`);
        if (it.publicationTitle) parts.push(`*${it.publicationTitle}*.`);
      }
    }
    if (it.DOI) parts.push(`https://doi.org/${it.DOI}.`);
    else if (it.url) parts.push(it.url + '.');
    return parts.join(' ');
  }

  function formatCitationMLA(it) {
    const authors = _mlaAuthors(it.creators);
    const parts = [];
    if (authors) parts.push(authors + '.');
    switch (visualType(it)) {
      case 'journalArticle': {
        parts.push(`“${it.title}.”`);
        if (it.publicationTitle) parts.push(`*${it.publicationTitle}*, ` + (it.year || 'n.d.') + '.');
        else if (it.year) parts.push(it.year + '.');
        break;
      }
      case 'book': {
        parts.push(`*${it.title}*.`);
        if (it.publisher) parts.push(it.publisher + ', ' + (it.year || 'n.d.') + '.');
        else if (it.year) parts.push(it.year + '.');
        break;
      }
      case 'bookSection': {
        parts.push(`“${it.title}.”`);
        if (it.publicationTitle) parts.push(`*${it.publicationTitle}*, ` + (it.publisher ? it.publisher + ', ' : '') + (it.year || 'n.d.') + '.');
        break;
      }
      case 'thesisPhd':
      case 'thesisMasters':
      case 'thesisUnknown':
      case 'thesis': {
        parts.push(`*${it.title}*.`);
        parts.push(`${it.year || 'n.d.'}. ${it.university || ''}, ${_apaThesisType(it)}.`);
        break;
      }
      default: {
        parts.push(`“${it.title}.”`);
        if (it.year) parts.push(it.year + '.');
      }
    }
    if (it.DOI) parts.push(`https://doi.org/${it.DOI}.`);
    else if (it.url) parts.push(it.url + '.');
    return parts.join(' ');
  }

  function formatCitation(it, fmt) {
    switch ((fmt || 'apa').toLowerCase()) {
      case 'chicago': return formatCitationChicago(it);
      case 'mla':     return formatCitationMLA(it);
      case 'apa':
      default:        return formatCitationAPA(it);
    }
  }

  function formatBibTeXEntry(it) {
    // Use the visual sub-type so PhD Theses become @phdthesis and Master's
    // Theses become @mastersthesis — both are recognised by BibTeX and by
    // Zotero/EndNote/Mendeley on RIS-round-trip.
    const bibTypeByVisual = {
      thesisPhd: 'phdthesis',
      thesisMasters: 'mastersthesis',
      thesisUnknown: 'phdthesis',
      thesis: 'phdthesis',
      journalArticle: 'article',
      bookSection: 'incollection',
      book: 'book',
      conferencePaper: 'inproceedings',
      report: 'techreport',
      preprint: 'misc',
      document: 'misc'
    };
    const bibType = bibTypeByVisual[visualType(it)] || bibTypeByVisual[it.itemType] || 'misc';
    const key = _bibKeyFor(it);
    let out = `@${bibType}{${key},\n`;
    out += `  title = {${(it.title || '').replace(/[{}]/g, '')}},\n`;
    if (it.creators && it.creators.length) {
      out += `  author = {${it.creators.map(c => c.replace(/[{}]/g, '')).join(' and ')}},\n`;
    }
    if (it.year) out += `  year = {${it.year}},\n`;
    if (it.publicationTitle) out += `  ${bibType === 'incollection' ? 'booktitle' : 'journal'} = {${it.publicationTitle.replace(/[{}]/g, '')}},\n`;
    if (it.university && (bibType === 'phdthesis' || bibType === 'mastersthesis' || bibType === 'techreport')) {
      out += `  ${bibType === 'techreport' ? 'institution' : 'school'} = {${it.university.replace(/[{}]/g, '')}},\n`;
    }
    if (it.publisher) out += `  publisher = {${it.publisher.replace(/[{}]/g, '')}},\n`;
    if (it.DOI) out += `  doi = {${it.DOI}},\n`;
    if (it.url) out += `  url = {${it.url}},\n`;
    out += `}`;
    return out;
  }

  function formatRISEntry(it) {
    // RIS is a line-based key-value format consumed by EndNote, Zotero, and
    // Mendeley. Type codes map from Zotero's item types.
    const risTypeByVisual = {
      thesisPhd: 'THES',
      thesisMasters: 'THES',
      thesisUnknown: 'THES',
      thesis: 'THES',
      journalArticle: 'JOUR',
      bookSection: 'CHAP',
      book: 'BOOK',
      conferencePaper: 'CPAPER',
      report: 'RPRT',
      preprint: 'UNPD',
      document: 'GEN'
    };
    const ty = risTypeByVisual[visualType(it)] || risTypeByVisual[it.itemType] || 'GEN';
    const lines = [];
    lines.push('TY  - ' + ty);
    if (it.title) lines.push('TI  - ' + it.title);
    (it.creators || []).forEach(c => lines.push('AU  - ' + c));
    if (it.year) lines.push('PY  - ' + it.year);
    if (it.publicationTitle) {
      if (ty === 'CHAP' || ty === 'CPAPER') lines.push('T2  - ' + it.publicationTitle);
      else                                  lines.push('JO  - ' + it.publicationTitle);
    }
    if (it.publisher) lines.push('PB  - ' + it.publisher);
    if (it.university && ty === 'THES') {
      lines.push('PB  - ' + it.university);
      // M3 = degree/type of work — preserves PhD vs Master's split on
      // RIS-round-trip through Zotero/EndNote.
      if (visualType(it) === 'thesisPhd') lines.push("M3  - PhD Thesis");
      else if (visualType(it) === 'thesisMasters') lines.push("M3  - Master's Thesis");
    }
    if (it.DOI) lines.push('DO  - ' + it.DOI);
    if (it.url) lines.push('UR  - ' + it.url);
    lines.push('ER  - ');
    return lines.join('\r\n');
  }

  function _csvEscape(v) {
    const s = (v == null) ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function formatCSVRow(it, citationFmt) {
    const key   = it.key || '';
    const type  = TYPE_LABELS[visualType(it)] || TYPE_LABELS[it.itemType] || '';
    const auth  = (it.creators || []).join('; ');
    const cite  = formatCitation(it, citationFmt || 'apa');
    const doi   = it.DOI || '';
    const url   = it.url || '';
    const zot   = `https://www.zotero.org/groups/5983386/samoan_scholarly_research/items/${it.key}`;
    return [key, type, auth, it.year || '', it.title || '', it.publicationTitle || '', it.publisher || '', it.university || '', doi, url, zot, cite]
      .map(_csvEscape).join(',');
  }

  // ============ EXPORTS (.bib / .ris / .csv) ============
  function _downloadBlob(text, mime, filename) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function exportBib() {
    const items = currentItems().filter(itemMatches);
    const out = items.map(formatBibTeXEntry).join('\n\n') + '\n';
    _downloadBlob(out, 'application/x-bibtex', `samoan-research-${items.length}-items.bib`);
  }

  function exportRis() {
    const items = currentItems().filter(itemMatches);
    const out = items.map(formatRISEntry).join('\r\n\r\n') + '\r\n';
    _downloadBlob(out, 'application/x-research-info-systems', `samoan-research-${items.length}-items.ris`);
  }

  function exportCsv() {
    const items = currentItems().filter(itemMatches);
    const fmt = state.citationFormat || 'apa';
    const header = ['ZoteroKey', 'Type', 'Authors', 'Year', 'Title', 'Container', 'Publisher', 'University', 'DOI', 'URL', 'ZoteroURL', 'Citation_' + fmt.toUpperCase()]
      .map(_csvEscape).join(',');
    const rows = items.map(it => formatCSVRow(it, fmt));
    // Prepend UTF-8 BOM so Excel treats it as UTF-8 without asking.
    const out = '\uFEFF' + header + '\n' + rows.join('\n') + '\n';
    _downloadBlob(out, 'text/csv;charset=utf-8', `samoan-research-${items.length}-items.csv`);
  }

  // ============ WIRE UP CONTROLS ============
  function wire() {
    // Search bar with light debounce
    let searchTimer = null;
    const searchInput = $('[data-db-search]');
    searchInput.value = state.filter.q || '';
    searchInput.addEventListener('input', e => {
      clearTimeout(searchTimer);
      const v = e.target.value.trim();
      searchTimer = setTimeout(() => {
        state.filter.q = v;
        state.shown = state.pageSize;
        afterFilterChange();
      }, 150);
    });

    // Dropdown filters
    $$('.db-filter[data-db-filter]').forEach(sel => {
      const key = sel.dataset.dbFilter;
      sel.value = state.filter[key] || '';
      sel.addEventListener('change', e => {
        state.filter[key] = e.target.value;
        state.shown = state.pageSize;
        afterFilterChange();
      });
    });

    $('[data-db-load-more]').addEventListener('click', () => {
      state.shown += state.pageSize;
      renderItems();
    });
    $('[data-db-export="bib"]').addEventListener('click', exportBib);
    const risBtn = $('[data-db-export="ris"]');
    if (risBtn) risBtn.addEventListener('click', exportRis);
    const csvBtn = $('[data-db-export="csv"]');
    if (csvBtn) csvBtn.addEventListener('click', exportCsv);
    const citeSel = $('[data-db-cite-format]');
    if (citeSel) {
      citeSel.value = state.citationFormat || 'apa';
      citeSel.addEventListener('change', e => {
        state.citationFormat = e.target.value || 'apa';
        // No filter change; item cards already read the value dynamically
        // through onclick handlers, so no re-render is needed. Re-render
        // anyway so a subsequent CSV export title stays in sync visually.
        try { renderItems(); } catch (err) {}
      });
    }
    const clearBtn = $('[data-db-clear]');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);
  }

  // ============ MASTER-FILE STATUS (V2) ============
  // V2 preview: the authoritative data source is the Samoa_Master_file
  // Google Sheet snapshot refreshed every 2h. We do NOT contact Zotero from
  // this build — Zotero is no longer this dashboard's data source of truth.
  // Show the current snapshot timestamp instead, and only mark the sync
  // badge as an error if the snapshot itself failed to load.
  async function backgroundRefresh() {
    try {
      const snap = state.snapshot || { items: [] };
      // state.lastSync comes from adapter bundle.sync (== master.lastSync,
      // parsed from data/last-master-sync.json). Fall back to the raw master
      // blob just in case a future adapter refactor changes the field.
      const sync = state.lastSync
        || (state.master && state.master.lastSync)
        || null;
      const ts = sync && (sync.finishedAt || sync.startedAt || sync.generated_at || sync.timestamp || sync.last_master_sync || sync.updated_at);
      const note = $('[data-db-sync-note]');
      const parts = [];
      parts.push('Master-file snapshot');
      if (ts) {
        let human = ts;
        try {
          const d = new Date(ts);
          if (!isNaN(d.getTime())) human = d.toLocaleString();
        } catch (e) { /* keep raw ts */ }
        parts.push('Last Master File update: <strong>' + human + '</strong>');
      }
      parts.push(snap.items.length + ' publications');
      if (note) note.innerHTML = parts.join(' · ');
    } catch (e) {
      // Snapshot load succeeded (we're here from loadAll's success path) so
      // this is purely a badge-render issue — stay quiet.
      console.warn('Master-file status badge failed to render:', e);
    }
  }

  // ============ INIT ============
  // Split the boot in two: `bootApp` is the original init we always ran; the
  // DOMContentLoaded hook now hands off to `dbGate.boot(...)` which shows the
  // passcode lock screen first and only then calls bootApp() once the
  // visitor is verified. If dbGate isn't loaded (e.g. an unrelated page
  // reuses this script), we fall back to the direct boot.
  async function bootApp() {
    loadFilterFromUrl();
    try {
      await loadAll();
    } catch (err) {
      console.error('Failed to load database data', err);
      setSyncBadge('error', 'Master-file snapshot unavailable', 'The encrypted Master-file snapshot failed to load or decrypt — please refresh');
      showFallbackBanner('snapshot-load-failed');
      const items = $('[data-db-items]');
      if (items) items.innerHTML = '<li class="db-item db-item__empty">Unable to load the Master-file snapshot. Please refresh the page in a moment.</li>';
      return;
    }
    // Wire the shared "Submit info" modal once (button per card wires open handler).
    wireSubmitModalOnce();
    renderStats();
    renderDonut();
    populateDisciplineSelect();
    renderHistLegend();
    renderPanelB();
    renderPanelB2();
    wirePanelB2();
    renderPanelE();
    renderHistogram();
    renderLeaders();
    wireScholarFilterRow();
    wire();
    wireTypeFilter();
    wireHistTypeFilter();
    wireHistAuthorsTabs();
    wirePanelB1();
    wireWorldPanel();
    // Panel A2 country list is standalone (no toggle to reveal it),
    // so it needs to be populated on initial load.
    renderWorldPanel();
    wireHistControls();
    renderItems();
    renderFilterChips();
    updateClearAllButton();

    // Init map once Leaflet has loaded, then paint Panel A tallies + sync
    const initMapWhenReady = () => {
      if (window.L) { initMap(); renderPanelA(); }
      else setTimeout(initMapWhenReady, 100);
    };
    initMapWhenReady();

    wireImpactView();

    backgroundRefresh();

    // ================================================================
    // MASTER-FILE HYDRATION SIGNAL
    //
    // Expose the internal state to overrides + external debug tools, and
    // fire an event so js/samoa-panel-overrides.js can layer on the
    // Master-file-specific requirements (14-district TOTAL columns per
    // region, verbatim explanatory notes, timestamp badge).
    // ================================================================
    window.__vavelabDbState = state;
    window.__masterHydrated = true;
    window.dispatchEvent(new CustomEvent('vavelab:master-hydrated', {
      detail: { state: state, master: state.master }
    }));
    // Also emit a filters-changed event on every subsequent filter change
    // so panel overrides can re-render their totals in sync. We piggy-back
    // on the existing afterFilterChange path by monkey-patching it once.
    if (!window.__mfFiltersHooked && typeof afterFilterChange === 'function') {
      const _orig = afterFilterChange;
      window.__mfAfterFilterChange = function () {
        _orig.apply(null, arguments);
        window.dispatchEvent(new CustomEvent('vavelab:filters-changed'));
      };
      window.__mfFiltersHooked = true;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.dbGate && typeof window.dbGate.boot === 'function') {
      window.dbGate.boot(() => { bootApp(); });
    } else {
      bootApp();
    }
  });

  // ============================================================
  //  PANEL B2 — interactive multi-view chart
  // ============================================================
  // Four views:
  //   samoa-focused        → Samoan first-author, Samoa-focused, group by paternal district
  //   all-locations       → Samoan first-author, ANY location, group by paternal district
  //   all-authors         → any author, Samoa-focused, group by study district + Samoa-wide row
  //   authorship          → any author, Samoa-focused, group by study district, single stacked bar per district by authorship role
  //
  // Selected view + its type-filter checkboxes are persisted in URL hash so a
  // link like #b2=all-locations bookmarks the view.
  // B2 no longer has an Authorship tab (it moved to Panel B1). Remaining views
  // all group by first-author paternal district; only the scope + author-set
  // differ per tab. Title + description are now static in the HTML — only the
  // meta row (Grouped by / Scope / Authors) is refreshed per tab.
  // Every remaining B2 tab groups by Samoan first-author paternal district.
  // 'all-authors' was removed — that view aggregated by study district and
  // clashed with B1's scope now that B1 owns the study-district chart.
  const B2_VIEWS = ['samoa-focused', 'all-locations'];
  const B2_META = {
    'samoa-focused': {
      meta: [
        ['Grouped by',  'First-author paternal district'],
        ['Scope',       'Samoa-focused'],
        ['Authors',     'Samoan first authors']
      ]
    },
    'all-locations': {
      meta: [
        ['Grouped by',  'First-author paternal district'],
        ['Scope',       'Samoa + International'],
        ['Authors',     'Samoan first authors']
      ]
    }
  };
  // Colours for the authorship view. Deliberately distinct from the
  // publication-type stack so viewers don't confuse categories.
  const AUTHORSHIP_COLORS = {
    itaukeiFirst:    '#0f766e',  // dark teal — first author
    includesItaukei: '#5fa6ae',  // light teal — co-author, not first
    noItaukei:       '#9ca3af'   // neutral grey — not yet identified
  };
  const AUTHORSHIP_LABELS = {
    itaukeiFirst:    'Samoan first author',
    includesItaukei: 'Samoan co-author, not first author',
    noItaukei:       'No Samoan author identified'
  };
  const AUTHORSHIP_KEYS = ['itaukeiFirst', 'includesItaukei', 'noItaukei'];

  // Initial hydration from URL hash — e.g. #b2=all-authors
  state.b1Authors = 'samoan';
  // Panel B1 view mode: 'type' (default) shows publication-type stacked bars;
  // 'authorship' shows the Samoan-authorship stacked bar previously on B2.
  state.b1View = 'type';
  state.worldSelectedCountry = null;
  state.worldSelectedUniversity = null;
  state.worldSearchTerm = '';
  state.b2View = 'samoa-focused';
  state.b2TypeSet = new Set(TYPE_ORDER);
  state.b2AuthorshipMode = 'counts';
  state.b2AuthorshipSort = 'total';
  // Authorship dropdown: 'first' (default), 'co', or 'split'.
  // Layout dropdown (split view only): 'compact' or 'detailed'.
  state.b2Authorship = 'first';
  state.b2Layout = 'compact';
  (function readB2AuthorshipFromHash() {
    const h = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(h);
    const a = params.get('b2a');
    if (a === 'first' || a === 'co' || a === 'split') state.b2Authorship = a;
    const l = params.get('b2l');
    if (l === 'compact' || l === 'detailed') state.b2Layout = l;
  })();
  (function readB2FromHash() {
    const m = window.location.hash.match(/(?:^|[#&])b2=([a-z-]+)/);
    if (!m) return;
    // Migrate old slug from a prior release so pre-existing bookmarks still land
    // on the redesigned single-stacked-bar authorship view.
    const slug = m[1] === 'compare-authorship' ? 'authorship' : m[1];
    if (B2_VIEWS.includes(slug)) state.b2View = slug;
  })();

  function setB2ViewInHash(view) {
    // Preserve any other hash params
    const h = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(h);
    params.set('b2', view);
    const newHash = '#' + params.toString();
    if (newHash !== window.location.hash) history.replaceState(null, '', newHash);
  }

  // -------- shared: get Samoan scholar names + paternal-district lookup --------
  function samoanScholarMaps() {
    // Anyone with a saved profile record is considered an Samoan scholar.
    // Their paternal district may or may not be filled.
    const scholars = state.scholarProfilesByName || new Map();
    const paternalByName = new Map();
    scholars.forEach((p, name) => paternalByName.set(name, effectivePaternalProvince(p)));
    return { scholars, paternalByName };
  }

  // Determine the canonical scholar-name for a raw Zotero creator string.
  // Returns null when the creator doesn't map to a known Samoan scholar.
  function itaukeiName(creator, scholars) {
    if (!creator || typeof creator !== 'string') return null;
    let cn = creator.includes(',') ? creator.trim() : (function() {
      const parts = creator.trim().split(/\s+/);
      if (parts.length < 2) return null;
      return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
    })();
    if (!cn) return null;
    return scholars.has(cn) ? cn : null;
  }

  // -------- shared: render horizontal bar rows into a host --------
  // rows: [{ name, total, types: {vt: n}, conf, isConfirmed }]
  // opts: { activeName, onClick(row), confDotColor(row), maxTotal }
  function renderPanelBBarsInto(host, rows, opts) {
    host.innerHTML = '';
    if (!rows.length) {
      host.innerHTML = '<div style="padding:16px;color:#64748b;font-size:0.9rem;">No items match the current filters.</div>';
      return;
    }
    const maxTotal = opts.maxTotal || Math.max(1, ...rows.map(r => r.total));
    rows.forEach(r => {
      const label = document.createElement('div');
      label.className = 'db-bars__prov';
      if (opts.activeName && opts.activeName === r.name) label.classList.add('is-active');
      const dotColor = opts.confDotColor ? opts.confDotColor(r) : (r.conf ? CONF_COLORS[r.conf] : 'transparent');
      label.innerHTML = `<span>${escapeHtml(r.name)}</span><span class="db-bars__prov-dot" style="background:${dotColor};"></span>`;
      label.addEventListener('click', () => opts.onClick && opts.onClick(r));
      host.appendChild(label);

      const rowWrap = document.createElement('div');
      const bar = document.createElement('div');
      bar.className = 'db-bars__row';
      bar.style.width = `${(r.total / maxTotal) * 100}%`;
      bar.style.background = 'transparent';
      bar.style.boxShadow = 'inset 0 0 0 1.5px rgba(0,0,0,0.06)';
      bar.title = `${r.name} · ${r.total} items`;
      TYPE_ORDER.forEach(t => {
        const n = r.types[t] || 0;
        if (n > 0) {
          const seg = document.createElement('span');
          seg.className = 'db-bars__seg';
          seg.style.width = `${(n / r.total) * 100}%`;
          seg.style.background = TYPE_COLOR[t];
          seg.title = `${n} × ${TYPE_LABELS[t]}`;
          bar.appendChild(seg);
        }
      });
      bar.addEventListener('click', () => opts.onClick && opts.onClick(r));
      rowWrap.appendChild(bar);
      host.appendChild(rowWrap);

      const num = document.createElement('div');
      num.className = 'db-bars__total';
      num.textContent = r.total;
      host.appendChild(num);
    });
  }

  // -------- Row builders per view --------
  // Returns [{ name, total, types, conf, isConfirmed }] sorted desc, plus a
  // final “District not yet confirmed” row when appropriate.
  function buildB2Rows_paternalGrouped(includeAllLocations) {
    const { scholars, paternalByName } = samoanScholarMaps();
    const rows = new Map();
    state.districts.features.forEach(f => {
      rows.set(f.properties.name, { name: f.properties.name, conf: f.properties.region, total: 0, types: {}, isConfirmed: true });
    });
    const unconfirmed = { name: 'District not yet confirmed', conf: null, total: 0, types: {}, isConfirmed: false };

    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.b2TypeSet.has(vt)) return;

      // First creator must map to an Samoan scholar
      const first = (it.creators || [])[0];
      const scholar = itaukeiName(first, scholars);
      if (!scholar) return;

      // Samoa-focused rule (view 1) = has at least one Samoa-district tag OR the
      // scholar's paternal district is confirmed (paternal district acts as the
      // “national Samoa” fallback bucket for Samoan-authored work). This is a
      // pragmatic choice given the current data model.
      const provSet = state.provincesByItem.get(it.key);
      const hasProvinceTag = provSet && provSet.size > 0;
      if (!includeAllLocations && !hasProvinceTag && !paternalByName.get(scholar)) {
        // Samoa-focused view: skip items with no district tag AND no known
        // paternal district (we cannot confidently classify these as Samoa).
        return;
      }

      const paternal = paternalByName.get(scholar) || '';
      const bucket = paternal && rows.has(paternal) ? rows.get(paternal) : unconfirmed;
      bucket.total += 1;
      bucket.types[vt] = (bucket.types[vt] || 0) + 1;
    });

    const out = Array.from(rows.values()).sort((a, b) => b.total - a.total);
    if (unconfirmed.total > 0) out.push(unconfirmed);
    return out;
  }

  // Co-author view: for each publication where NO Samoan author is first but
  // at least one Samoan author appears elsewhere in the byline, add +1 to the
  // paternal district of every Samoan co-author. Type filter respects
  // state.b2TypeSet, but PhD/Masters thesis are inherently single-author works
  // that don't apply here — the caller disables those checkboxes.
  function buildB2Rows_coauthor(includeAllLocations) {
    const { scholars, paternalByName } = samoanScholarMaps();
    const rows = new Map();
    state.districts.features.forEach(f => {
      rows.set(f.properties.name, { name: f.properties.name, conf: f.properties.region, total: 0, types: {}, isConfirmed: true });
    });
    const unconfirmed = { name: 'District not yet confirmed', conf: null, total: 0, types: {}, isConfirmed: false };

    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.b2TypeSet.has(vt)) return;
      // Theses are single-author — don't count them here even if a stale
      // check state slips through the UI.
      if (vt === 'thesisPhd' || vt === 'thesisMasters') return;
      const creators = it.creators || [];
      if (!creators.length) return;
      const firstScholar = itaukeiName(creators[0], scholars);
      if (firstScholar) return; // 1st-author view territory, not us

      // Collect all Samoan co-authors on this paper
      const coScholars = [];
      for (let i = 1; i < creators.length; i++) {
        const s = itaukeiName(creators[i], scholars);
        if (s) coScholars.push(s);
      }
      if (!coScholars.length) return;

      // Samoa-focused rule: paper must have a Samoa district tag OR at least one
      // co-author with a confirmed paternal district (i.e., an Samoan scholar
      // contribution counts as Samoa-relevant even if the study site isn't tagged).
      const provSet = state.provincesByItem.get(it.key);
      const hasProvinceTag = provSet && provSet.size > 0;
      const anyPaternal = coScholars.some(s => paternalByName.get(s));
      if (!includeAllLocations && !hasProvinceTag && !anyPaternal) return;

      coScholars.forEach(s => {
        const paternal = paternalByName.get(s) || '';
        const bucket = paternal && rows.has(paternal) ? rows.get(paternal) : unconfirmed;
        bucket.total += 1;
        bucket.types[vt] = (bucket.types[vt] || 0) + 1;
      });
    });

    const out = Array.from(rows.values()).filter(r => r.total > 0).sort((a, b) => b.total - a.total);
    if (unconfirmed.total > 0) out.push(unconfirmed);
    return out;
  }

  // Split view: for each paternal district, count both (a) publications where
  // an Samoan person from that district is 1st author and (b) publications
  // where an Samoan person from that district is a co-author (and the paper
  // has no Samoan 1st author). One row per district with lead + co counts.
  //
  // Note: (a) counts each paper exactly once (against its lead's district),
  // (b) counts each paper once per distinct co-author district (so a paper
  // with two co-authors from Kadavu still adds only +1 to Kadavu, but adds
  // +1 to Lau too if one is from Lau).
  function buildB2Rows_split(includeAllLocations) {
    const { scholars, paternalByName } = samoanScholarMaps();
    const rows = new Map();
    state.districts.features.forEach(f => {
      rows.set(f.properties.name, {
        name: f.properties.name, conf: f.properties.region,
        lead: 0, co: 0, total: 0,
        leadTypes: {}, coTypes: {},
        isConfirmed: true
      });
    });
    const unconfirmed = {
      name: 'District not yet confirmed', conf: null,
      lead: 0, co: 0, total: 0,
      leadTypes: {}, coTypes: {},
      isConfirmed: false
    };

    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.b2TypeSet.has(vt)) return;
      const creators = it.creators || [];
      if (!creators.length) return;

      const firstScholar = itaukeiName(creators[0], scholars);
      const provSet = state.provincesByItem.get(it.key);
      const hasProvinceTag = provSet && provSet.size > 0;

      if (firstScholar) {
        // 1st-author case — counts once against the first author's district.
        if (!includeAllLocations && !hasProvinceTag && !paternalByName.get(firstScholar)) return;
        const paternal = paternalByName.get(firstScholar) || '';
        const bucket = paternal && rows.has(paternal) ? rows.get(paternal) : unconfirmed;
        bucket.lead += 1;
        bucket.leadTypes[vt] = (bucket.leadTypes[vt] || 0) + 1;
        bucket.total = bucket.lead + bucket.co;
      } else {
        // Co-author case — theses are single-author; skip.
        if (vt === 'thesisPhd' || vt === 'thesisMasters') return;
        const coScholars = [];
        for (let i = 1; i < creators.length; i++) {
          const s = itaukeiName(creators[i], scholars);
          if (s) coScholars.push(s);
        }
        if (!coScholars.length) return;
        const anyPaternal = coScholars.some(s => paternalByName.get(s));
        if (!includeAllLocations && !hasProvinceTag && !anyPaternal) return;
        // Distinct paternal districts — avoid double-counting a paper for
        // one district just because two of its co-authors happen to be
        // from that district.
        const seen = new Set();
        coScholars.forEach(s => {
          const paternal = paternalByName.get(s) || '__unconfirmed__';
          if (seen.has(paternal)) return;
          seen.add(paternal);
          const key = paternal === '__unconfirmed__' ? '' : paternal;
          const bucket = key && rows.has(key) ? rows.get(key) : unconfirmed;
          bucket.co += 1;
          bucket.coTypes[vt] = (bucket.coTypes[vt] || 0) + 1;
          bucket.total = bucket.lead + bucket.co;
        });
      }
    });

    const out = Array.from(rows.values()).filter(r => r.total > 0).sort((a, b) => b.total - a.total);
    if (unconfirmed.total > 0) out.push(unconfirmed);
    return out;
  }

  function buildB2Rows_studyProvince_allAuthors() {
    const rows = new Map();
    state.districts.features.forEach(f => {
      rows.set(f.properties.name, { name: f.properties.name, conf: f.properties.region, total: 0, types: {} });
    });
    const fijiWide = { name: 'Samoa-wide / national', conf: null, total: 0, types: {} };

    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.b2TypeSet.has(vt)) return;
      const provSet = state.provincesByItem.get(it.key);
      if (provSet && provSet.size > 0) {
        provSet.forEach(name => {
          const bucket = rows.get(name);
          if (bucket) {
            bucket.total += 1;
            bucket.types[vt] = (bucket.types[vt] || 0) + 1;
          }
        });
      }
      // “Samoa-wide / national” needs a positive signal. Without an explicit
      // Zotero tag we cannot fill this bucket for non-Samoan papers. Leaving
      // it visible (with 0) documents that the row exists once tagging arrives.
    });

    const out = Array.from(rows.values()).sort((a, b) => b.total - a.total);
    out.push(fijiWide);
    return out;
  }

  function buildB2Rows_compareAuthorship() {
    // For each Samoa district, count 3 authorship categories.
    const { scholars } = samoanScholarMaps();
    const rows = new Map();
    state.districts.features.forEach(f => {
      rows.set(f.properties.name, {
        name: f.properties.name, conf: f.properties.region,
        cats: { itaukeiFirst: 0, includesItaukei: 0, noItaukei: 0 },
        total: 0
      });
    });
    const fijiWide = { name: 'Samoa-wide / national', conf: null, cats: { itaukeiFirst: 0, includesItaukei: 0, noItaukei: 0 }, total: 0 };

    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.b2TypeSet.has(vt)) return;
      const provSet = state.provincesByItem.get(it.key);
      if (!provSet || provSet.size === 0) return; // Only Samoa-focused rows for this view

      const creators = it.creators || [];
      const firstIsItaukei = !!itaukeiName(creators[0], scholars);
      const anyItaukei = firstIsItaukei || creators.slice(1).some(c => itaukeiName(c, scholars));

      provSet.forEach(name => {
        const b = rows.get(name);
        if (!b) return;
        if (firstIsItaukei) b.cats.itaukeiFirst += 1;
        else if (anyItaukei) b.cats.includesItaukei += 1;
        else b.cats.noItaukei += 1;
        b.total = b.cats.itaukeiFirst + b.cats.includesItaukei + b.cats.noItaukei;
      });
    });

    const out = Array.from(rows.values()).sort((a, b) => b.total - a.total);
    out.push(fijiWide);
    return out;
  }

  // Build the inline Panel B2 title dropdown pill. Style comes from the shared
  // .db-title-select CSS (brown pill + cream text). Changing the selection
  // moves the user to the corresponding B2 view:
  //   Samoan authors → samoa-focused (Samoa-focused + Samoan first author)
  //   All authors     → all-authors  (Samoa-focused + any author)
  // We deliberately don't try to preserve 'all-locations' when switching to
  // 'all authors': there is no All locations + all authors view today, and
  // predictable behaviour trumps state-preservation guesswork here.
  function buildB2AuthorsPill(currentType) {
    const wrap = document.createElement('span');
    wrap.className = 'db-title-select';
    const sel  = document.createElement('select');
    sel.className = 'db-title-select__select';
    sel.setAttribute('data-b2-authors', '');
    sel.setAttribute('aria-label', 'Filter authors');
    const opts = [
      { value: 'samoan', label: 'Samoan authors' },
      { value: 'all',     label: 'All authors' }
    ];
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = currentType;
    sel.addEventListener('change', () => {
      state.b2View = sel.value === 'all' ? 'all-authors' : 'samoa-focused';
      renderPanelB2();
    });
    wrap.appendChild(sel);
    const chev = document.createElement('span');
    chev.className = 'db-title-select__chevron';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '\u25be';
    wrap.appendChild(chev);
    return wrap;
  }

  // -------- Render dispatcher --------
  function renderPanelB2() {
    const view = state.b2View;
    const meta = B2_META[view] || B2_META['samoa-focused'];
    const metaEl = $('[data-b2-meta]');
    const barsEl = $('[data-b2-bars]');
    if (!metaEl || !barsEl) return;

    // Title + description are now static in the HTML (rewritten to describe the
    // panel as a whole rather than the current tab). Only the meta row updates
    // per tab so the reader can see what scope / authorship the current tab uses.
    metaEl.innerHTML = meta.meta.map(([k, v]) => `<span><em>${escapeHtml(k)}:</em> ${escapeHtml(v)}</span>`).join('');

    // Toggle tab active state + tabindex per aria-tablist pattern. The chart
    // panel that owns these tabs is Panel C3 (the district multi-view chart).
    // Historically this selector said B2 and the active pill never updated —
    // fixed by scoping to the correct panel. Renumbered 2026-07-27 from C2
    // to C3 when Panel C1 (body composition) was inserted above.
    const b2Root = document.querySelector('[data-panel="C3"]');
    if (b2Root) {
      b2Root.querySelectorAll('.db-b2-tab').forEach(btn => {
        const on = btn.dataset.b2Tab === view;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
      });
    }

    // Update URL hash
    setB2ViewInHash(view);

    // Route by pill (view) x authorship dropdown x layout dropdown.
    // The pill controls scope (Samoa-focused vs Samoa + International);
    // the authorship dropdown chooses between 1st author / co-author / split;
    // the layout dropdown (only meaningful for 'split') picks compact vs detailed.
    const includeAll = (view === 'all-locations');
    const auth = state.b2Authorship || 'first';
    const layout = state.b2Layout || 'compact';
    const blurbEl = $('[data-b2-blurb]');
    const layoutWrap = $('[data-b2-layout-wrap]');
    const authSel = $('[data-b2-authorship]');
    const layoutSel = $('[data-b2-layout]');
    if (authSel && authSel.value !== auth) authSel.value = auth;
    if (layoutSel && layoutSel.value !== layout) layoutSel.value = layout;
    if (layoutWrap) layoutWrap.style.display = (auth === 'split') ? '' : 'none';

    // Toggle panel-level modifier for detailed layout so CSS can expand height / spacing.
    if (b2Root) b2Root.classList.toggle('is-detailed', auth === 'split' && layout === 'detailed');

    // Update type-filter checkbox enable/disable state based on authorship view.
    // Thesis types are single-author works; disable them in the co-author view.
    updateB2TypeFilterEnabledState(auth);

    // Persist authorship + layout to URL hash for shareability.
    setB2ExtraHash({ b2a: auth, b2l: auth === 'split' ? layout : null });

    if (view === 'samoa-focused' || view === 'all-locations') {
      if (auth === 'first') {
        const rows = buildB2Rows_paternalGrouped(includeAll);
        renderPanelBBarsInto(barsEl, rows, {
          activeName: state.filter.paternal || null,
          confDotColor: r => r.conf ? CONF_COLORS[r.conf] : '#94a3b8',
          onClick: r => {
            if (!r.isConfirmed) return;
            state.filter.paternal = state.filter.paternal === r.name ? '' : r.name;
            state.filter.district = '';
            state.filter.b2Group = state.filter.paternal ? 'paternal' : '';
            state.filter.b2Authorship = 'itaukeiFirst';
            state.shown = state.pageSize;
            afterFilterChange();
          }
        });
        barsEl.className = 'db-bars';
        renderPanelB2Blurb(blurbEl, { auth: 'first', includeAll, rows });
      } else if (auth === 'co') {
        const rows = buildB2Rows_coauthor(includeAll);
        renderPanelBBarsInto(barsEl, rows, {
          activeName: state.filter.paternal || null,
          confDotColor: r => r.conf ? CONF_COLORS[r.conf] : '#94a3b8',
          onClick: r => {
            if (!r.isConfirmed) return;
            state.filter.paternal = state.filter.paternal === r.name ? '' : r.name;
            state.filter.district = '';
            state.filter.b2Group = state.filter.paternal ? 'paternal' : '';
            state.filter.b2Authorship = 'includesItaukei';
            state.shown = state.pageSize;
            afterFilterChange();
          }
        });
        barsEl.className = 'db-bars';
        renderPanelB2Blurb(blurbEl, { auth: 'co', includeAll, rows });
      } else if (auth === 'split') {
        const rows = buildB2Rows_split(includeAll);
        if (layout === 'detailed') {
          renderPanelB2SplitDetailed(barsEl, rows);
        } else {
          renderPanelB2SplitCompact(barsEl, rows);
        }
        renderPanelB2Blurb(blurbEl, { auth: 'split', layout, includeAll, rows });
      }
    } else if (view === 'all-authors') {
      const rows = buildB2Rows_studyProvince_allAuthors();
      renderPanelBBarsInto(barsEl, rows, {
        activeName: state.filter.district || null,
        confDotColor: r => r.conf ? CONF_COLORS[r.conf] : '#94a3b8',
        onClick: r => {
          if (r.name === 'Samoa-wide / national') return; // no items tagged yet
          state.filter.district = state.filter.district === r.name ? '' : r.name;
          state.filter.paternal = '';
          state.filter.b2Group = state.filter.district ? 'district' : '';
          state.filter.b2Authorship = '';
          state.shown = state.pageSize;
          afterFilterChange();
        }
      });
      barsEl.classList.remove('db-bars--grouped');
    }

    // Authorship chrome (district note, legend, caveat) is no longer used in
    // B2 — the Authorship tab moved to Panel B1. Ensure it's hidden here.
    const hide = el => { if (el) el.style.display = 'none'; };
    hide($('[data-b2-district-note]'));
    hide($('[data-b2-authorship-controls]'));
    hide($('[data-b2-caveat]'));
  }

  // -------- Split view render helpers --------
  // Compact: one bar per district, two-tone teal (lead + co).
  function renderPanelB2SplitCompact(host, rows) {
    host.innerHTML = '';
    host.className = 'db-bars db-bars--split';
    if (!rows.length) {
      host.innerHTML = '<div style="padding:16px;color:#64748b;font-size:0.9rem;">No items match the current filters.</div>';
      return;
    }
    const maxTotal = Math.max(1, ...rows.map(r => r.total));
    rows.forEach(r => {
      const label = document.createElement('div');
      label.className = 'db-bars__prov';
      const dotColor = r.conf ? CONF_COLORS[r.conf] : '#94a3b8';
      label.innerHTML = `<span>${escapeHtml(r.name)}</span><span class="db-bars__prov-dot" style="background:${dotColor};"></span>`;
      host.appendChild(label);

      const rowWrap = document.createElement('div');
      const bar = document.createElement('div');
      bar.className = 'db-bars__row';
      bar.style.width = `${(r.total / maxTotal) * 100}%`;
      bar.style.background = 'transparent';
      bar.style.boxShadow = 'inset 0 0 0 1.5px rgba(0,0,0,0.06)';
      bar.title = `${r.name} · ${r.lead} first-author + ${r.co} co-author = ${r.total} total`;
      if (r.lead > 0) {
        const seg = document.createElement('span');
        seg.className = 'db-bars__seg db-bars__seg-lead';
        seg.style.width = `${(r.lead / r.total) * 100}%`;
        seg.title = `${r.lead} × first author`;
        bar.appendChild(seg);
      }
      if (r.co > 0) {
        const seg = document.createElement('span');
        seg.className = 'db-bars__seg db-bars__seg-co';
        seg.style.width = `${(r.co / r.total) * 100}%`;
        seg.title = `${r.co} × co-author (not first)`;
        bar.appendChild(seg);
      }
      rowWrap.appendChild(bar);
      host.appendChild(rowWrap);

      const num = document.createElement('div');
      num.className = 'db-bars__total';
      num.textContent = r.total;
      host.appendChild(num);
    });
  }

  // Detailed: two twin bars per district with publication-type colors.
  // Grid: district | role | bar | totals (district + totals span both rows).
  function renderPanelB2SplitDetailed(host, rows) {
    host.innerHTML = '';
    host.className = 'db-bars db-bars--split-detailed';
    if (!rows.length) {
      host.innerHTML = '<div style="padding:16px;color:#64748b;font-size:0.9rem;">No items match the current filters.</div>';
      return;
    }
    // Scale by the larger of lead/co so bars are comparable across districts.
    const maxSide = Math.max(1, ...rows.flatMap(r => [r.lead, r.co]));

    rows.forEach(r => {
      const prov = document.createElement('div');
      prov.className = 'db-bars__prov';
      const dotColor = r.conf ? CONF_COLORS[r.conf] : '#94a3b8';
      prov.innerHTML = `<span>${escapeHtml(r.name)}</span><span class="db-bars__prov-dot" style="background:${dotColor};"></span>`;
      host.appendChild(prov);

      // Row 1: 1st author
      const roleLead = document.createElement('div');
      roleLead.className = 'db-bars__role db-bars__role--lead';
      roleLead.textContent = '1st';
      host.appendChild(roleLead);

      const barLead = document.createElement('div');
      barLead.className = 'db-bars__row' + (r.lead === 0 ? ' db-bars__row--empty' : '');
      if (r.lead > 0) {
        barLead.style.width = `${(r.lead / maxSide) * 100}%`;
        TYPE_ORDER.forEach(t => {
          const n = (r.leadTypes && r.leadTypes[t]) || 0;
          if (n > 0) {
            const seg = document.createElement('span');
            seg.className = 'db-bars__seg';
            seg.style.width = `${(n / r.lead) * 100}%`;
            seg.style.background = TYPE_COLOR[t];
            seg.title = `${n} × ${TYPE_LABELS[t]} (first author)`;
            barLead.appendChild(seg);
          }
        });
      }
      host.appendChild(barLead);

      // Totals column (spans both rows). We drop the “co” word next to the
      // co-author number — the orange color + row alignment carry the meaning.
      const totals = document.createElement('div');
      totals.className = 'db-bars__totals';
      totals.innerHTML = `<span class="db-bars__totals-lead">${r.lead}</span><span class="db-bars__totals-co">${r.co}</span>`;
      host.appendChild(totals);

      // Row 2: co-author (skip district + totals cells — they span from row 1)
      const roleCo = document.createElement('div');
      roleCo.className = 'db-bars__role db-bars__role--co';
      roleCo.textContent = 'co';
      host.appendChild(roleCo);

      const barCo = document.createElement('div');
      barCo.className = 'db-bars__row' + (r.co === 0 ? ' db-bars__row--empty' : '');
      if (r.co > 0) {
        barCo.style.width = `${(r.co / maxSide) * 100}%`;
        TYPE_ORDER.forEach(t => {
          const n = (r.coTypes && r.coTypes[t]) || 0;
          if (n > 0) {
            const seg = document.createElement('span');
            seg.className = 'db-bars__seg';
            seg.style.width = `${(n / r.co) * 100}%`;
            seg.style.background = TYPE_COLOR[t];
            seg.title = `${n} × ${TYPE_LABELS[t]} (co-author, not first)`;
            barCo.appendChild(seg);
          }
        });
      }
      host.appendChild(barCo);
    });
  }

  // -------- Interpretation blurb --------
  // Auto-generated text that summarises the current filtered view. Placed
  // above the chart, below the description. Updates on every filter / view /
  // layout change. Uses <strong> for numbers/district names and <em> for
  // interpretive framing so the sentence reads as commentary, not caption.
  function renderPanelB2Blurb(el, ctx) {
    if (!el) return;
    const rows = (ctx && ctx.rows) || [];
    const confirmed = rows.filter(r => r.isConfirmed);
    if (!confirmed.length) { el.innerHTML = ''; return; }

    const auth = ctx.auth;
    const scopeWord = ctx.includeAll ? 'across all locations' : 'in Samoa-focused research';

    const fmt = (n) => `<strong>${n}</strong>`;
    const prov = (name) => `<strong>${escapeHtml(name)}</strong>`;

    let html = '';

    if (auth === 'first') {
      // Top-3 first-author districts
      const sorted = confirmed.slice().sort((a, b) => b.total - a.total);
      const [p1, p2, p3] = sorted;
      if (!p1) { el.innerHTML = ''; return; }
      html = `${prov(p1.name)} leads Samoan first-author publications ${scopeWord} with ${fmt(p1.total)} paper${p1.total === 1 ? '' : 's'}`;
      if (p2) html += `, followed by ${prov(p2.name)} (${fmt(p2.total)})`;
      if (p3) html += ` and ${prov(p3.name)} (${fmt(p3.total)})`;
      html += `. <em>Together, these three districts account for the bulk of Samoan-led scholarship represented in this database.</em>`;
    } else if (auth === 'co') {
      const sorted = confirmed.slice().sort((a, b) => b.total - a.total);
      const [p1, p2, p3] = sorted;
      if (!p1) { el.innerHTML = ''; return; }
      html = `${prov(p1.name)} tops Samoan co-authored publications ${scopeWord} at ${fmt(p1.total)}`;
      if (p2) html += `, followed by ${prov(p2.name)} (${fmt(p2.total)})`;
      if (p3) html += ` and ${prov(p3.name)} (${fmt(p3.total)})`;
      html += ` — <em>districts whose scholars appear more often as collaborators than as lead authors on these works.</em>`;
    } else if (auth === 'split') {
      // Find biggest lead-vs-co gaps in both directions.
      // Positive gap (co > lead): co-author role dominates.
      // Negative gap (lead > co): lead role dominates.
      const withGaps = confirmed.map(r => ({ ...r, gap: r.co - r.lead }));
      const coHeavy = withGaps.filter(r => r.gap > 0).sort((a, b) => b.gap - a.gap);
      const leadHeavy = withGaps.filter(r => r.gap < 0).sort((a, b) => a.gap - b.gap);
      const parts = [];
      if (coHeavy.length >= 2) {
        const [c1, c2] = coHeavy;
        parts.push(`${prov(c1.name)} and ${prov(c2.name)} contribute more as co-authors than as lead authors: ${prov(c1.name)} produces ${fmt(c1.lead)} first-author paper${c1.lead === 1 ? '' : 's'} but appears on ${fmt(c1.co)} as a co-author, while ${prov(c2.name)} shows ${fmt(c2.lead)} versus ${fmt(c2.co)}`);
      } else if (coHeavy.length === 1) {
        const c1 = coHeavy[0];
        parts.push(`${prov(c1.name)} contributes more as a co-author than as a lead author (${fmt(c1.lead)} first-author versus ${fmt(c1.co)} co-authored)`);
      }
      if (leadHeavy.length >= 1) {
        const l1 = leadHeavy[0];
        parts.push(`${prov(l1.name)}, by contrast, leads more than it co-authors (${fmt(l1.lead)} first-author versus ${fmt(l1.co)} co-authored)`);
      }
      if (!parts.length) {
        // Fallback: describe the top district by total.
        const top = confirmed.slice().sort((a, b) => b.total - a.total)[0];
        if (top) parts.push(`${prov(top.name)} has the highest combined presence with ${fmt(top.lead)} first-author and ${fmt(top.co)} co-authored papers`);
      }
      html = parts.join('. ') + `. <em>These asymmetries hint at differing research pathways — some districts are more visible as collaborators, others as lead investigators.</em>`;
    }
    el.innerHTML = html;
  }

  // Enable/disable PhD + Masters checkboxes based on authorship view.
  // Theses are single-author works, so they don't belong in the co-author view.
  function updateB2TypeFilterEnabledState(auth) {
    const wrap = $('[data-b2-type-filter]');
    if (!wrap) return;
    const disable = (auth === 'co');
    ['thesisPhd', 'thesisMasters'].forEach(vt => {
      const cb = wrap.querySelector(`input[type=checkbox][value="${vt}"]`);
      if (!cb) return;
      const lbl = cb.closest('label');
      cb.disabled = disable;
      if (lbl) {
        lbl.classList.toggle('is-disabled', disable);
        if (disable) lbl.title = 'Theses are single-author works — not applicable in the co-author view';
        else lbl.removeAttribute('title');
      }
      if (disable && cb.checked) {
        cb.checked = false;
        state.b2TypeSet.delete(vt);
      }
    });
  }

  // Preserve b2 hash param when writing b2a / b2l.
  function setB2ExtraHash({ b2a, b2l }) {
    const h = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(h);
    if (b2a) params.set('b2a', b2a); else params.delete('b2a');
    if (b2l) params.set('b2l', b2l); else params.delete('b2l');
    const newHash = '#' + params.toString();
    if (newHash !== window.location.hash) history.replaceState(null, '', newHash);
  }

  // Ensure a single tooltip element exists on document.body for the authorship
  // view. Positioned with position:fixed and toggled via the .is-visible class.
  function ensureAuthorshipTip() {
    if (state.b2Tip && document.body.contains(state.b2Tip)) return state.b2Tip;
    const tip = document.createElement('div');
    tip.className = 'db-b2-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    state.b2Tip = tip;
    return tip;
  }

  function hideAuthorshipTip() {
    if (state.b2Tip) state.b2Tip.classList.remove('is-visible');
  }

  function showAuthorshipTipForRow(r, focusKey, anchorEl) {
    const tip = ensureAuthorshipTip();
    const total = r.total || 0;
    const rows = AUTHORSHIP_KEYS.map(k => {
      const n = r.cats[k] || 0;
      const pct = total > 0 ? Math.round((n / total) * 100) : 0;
      const emph = focusKey === k ? ' style="font-weight:600;"' : '';
      return `<div class="db-b2-tip__row"${emph}>
        <span class="db-b2-tip__sw" style="background:${AUTHORSHIP_COLORS[k]};"></span>
        <span>${escapeHtml(AUTHORSHIP_LABELS[k])}</span>
        <span class="db-b2-tip__val">${n} (${pct}%)</span>
      </div>`;
    }).join('');
    const note = (r.cats.noItaukei || 0) > 0
      ? `<div class="db-b2-tip__note">“No Samoan author identified” means none has yet been identified in the current database.</div>`
      : '';
    tip.innerHTML = `
      <div class="db-b2-tip__title">${escapeHtml(r.name)}</div>
      ${rows}
      <div class="db-b2-tip__total">Total: ${total} publication${total === 1 ? '' : 's'}</div>
      ${note}`;

    // Position above the anchor, clamped to viewport.
    const rect = anchorEl.getBoundingClientRect();
    tip.classList.add('is-visible');
    // Force layout so we can measure the tip.
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 10;
    const pad = 8;
    if (left < pad) left = pad;
    if (left + tipRect.width > window.innerWidth - pad) left = window.innerWidth - tipRect.width - pad;
    if (top < pad) top = rect.bottom + 10; // flip below when no room above
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top  = `${Math.round(top)}px`;
  }

  function renderAuthorshipInto(host, rows) {
    host.innerHTML = '';
    hideAuthorshipTip();
    if (!rows.length) {
      host.innerHTML = '<div style="padding:16px;color:#64748b;font-size:0.9rem;">No items match the current filters.</div>';
      return;
    }
    const mode = state.b2AuthorshipMode || 'counts';
    const sort = state.b2AuthorshipSort || 'total';

    // Sort rows. Samoa-wide / national always pinned to the end. Zero-total
    // rows keep their alphabetical fallback so the layout stays readable.
    const sortable = rows.filter(r => r.name !== 'Samoa-wide / national');
    const trailing = rows.filter(r => r.name === 'Samoa-wide / national');
    const shareOf = (r, key) => (r.total > 0 ? (r.cats[key] || 0) / r.total : 0);
    sortable.sort((a, b) => {
      if (sort === 'first-share') {
        return shareOf(b, 'itaukeiFirst') - shareOf(a, 'itaukeiFirst') || (b.total - a.total);
      }
      if (sort === 'any-share') {
        return (shareOf(b, 'itaukeiFirst') + shareOf(b, 'includesItaukei'))
             - (shareOf(a, 'itaukeiFirst') + shareOf(a, 'includesItaukei'))
             || (b.total - a.total);
      }
      return b.total - a.total;
    });
    const ordered = sortable.concat(trailing);

    const maxTotal = Math.max(1, ...ordered.map(r => r.total));
    const activeProv = state.filter.district || null;
    const activeAuth = state.filter.b2Authorship || null;

    ordered.forEach(r => {
      // Column 1 — district label + statistical region dot + total-only click target
      const label = document.createElement('div');
      label.className = 'db-bars__prov';
      if (activeProv === r.name) label.classList.add('is-active');
      const dotColor = r.conf ? CONF_COLORS[r.conf] : '#94a3b8';
      label.innerHTML = `<span>${escapeHtml(r.name)}</span><span class="db-bars__prov-dot" style="background:${dotColor};"></span>`;
      const canFilterProv = r.name !== 'Samoa-wide / national' && r.total > 0;
      if (canFilterProv) {
        label.style.cursor = 'pointer';
        label.addEventListener('click', () => {
          state.filter.district = state.filter.district === r.name ? '' : r.name;
          state.filter.paternal = '';
          state.filter.b2Group = state.filter.district ? 'district' : '';
          state.filter.b2Authorship = '';
          state.shown = state.pageSize;
          afterFilterChange();
        });
      }
      host.appendChild(label);

      // Column 2 — stacked bar row
      const rowWrap = document.createElement('div');
      const bar = document.createElement('div');
      bar.className = 'db-bars__row db-bars__row--authorship';
      // In counts mode, bar width scales with total. In percent mode always 100%.
      const barPct = mode === 'percent' ? 100 : (r.total / maxTotal) * 100;
      bar.style.width = `${barPct}%`;

      if (r.total === 0) {
        // Draw an empty outline so the district still has a visual anchor.
        bar.style.width = '4px';
        bar.style.background = 'transparent';
        bar.style.boxShadow = 'inset 0 0 0 1.5px rgba(0,0,0,0.06)';
      } else {
        AUTHORSHIP_KEYS.forEach(k => {
          const n = r.cats[k] || 0;
          if (n <= 0) return;
          const share = n / r.total;
          const segPct = share * 100; // segment width as a share of the bar
          const seg = document.createElement('span');
          seg.className = 'db-bars__seg db-bars__seg--auth';
          seg.style.width = `${segPct}%`;
          seg.style.background = AUTHORSHIP_COLORS[k];
          seg.setAttribute('tabindex', '0');
          seg.setAttribute('role', 'button');
          const pct = Math.round(share * 100);
          seg.setAttribute('aria-label', `${r.name} · ${AUTHORSHIP_LABELS[k]}: ${n} (${pct}%)`);
          if (activeProv === r.name && activeAuth === k) seg.classList.add('is-active');
          // Show the count inside the segment when there's room. In counts
          // mode the visible width is `barPct * share`; in percent mode it's
          // just `segPct`.
          const visibleWidthPct = mode === 'percent' ? segPct : (barPct * share);
          if (visibleWidthPct >= 6) {
            const inner = mode === 'percent' ? `${pct}%` : `${n}`;
            seg.textContent = inner;
          }
          const openTip  = () => showAuthorshipTipForRow(r, k, seg);
          const closeTip = () => hideAuthorshipTip();
          seg.addEventListener('mouseenter', openTip);
          seg.addEventListener('mouseleave', closeTip);
          seg.addEventListener('focus', openTip);
          seg.addEventListener('blur', closeTip);
          const canFilterSeg = r.name !== 'Samoa-wide / national';
          if (canFilterSeg) {
            seg.style.cursor = 'pointer';
            const onActivate = () => {
              const sameProv = state.filter.district === r.name;
              const sameAuth = state.filter.b2Authorship === k;
              if (sameProv && sameAuth) {
                state.filter.district = '';
                state.filter.b2Authorship = '';
                state.filter.b2Group = '';
              } else {
                state.filter.district = r.name;
                state.filter.paternal = '';
                state.filter.b2Group = 'district';
                state.filter.b2Authorship = k;
              }
              state.shown = state.pageSize;
              afterFilterChange();
            };
            seg.addEventListener('click', onActivate);
            seg.addEventListener('keydown', ev => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onActivate();
              }
            });
          } else {
            seg.style.cursor = 'default';
          }
          bar.appendChild(seg);
        });
      }
      rowWrap.appendChild(bar);
      host.appendChild(rowWrap);

      // Column 3 — right-side total (also acts as a district filter target)
      const num = document.createElement('div');
      num.className = 'db-bars__total';
      num.textContent = r.total;
      if (canFilterProv) {
        num.style.cursor = 'pointer';
        num.addEventListener('click', () => {
          state.filter.district = state.filter.district === r.name ? '' : r.name;
          state.filter.paternal = '';
          state.filter.b2Group = state.filter.district ? 'district' : '';
          state.filter.b2Authorship = '';
          state.shown = state.pageSize;
          afterFilterChange();
        });
      }
      host.appendChild(num);
    });
  }

  // -------- Wire tabs, keyboard, and type checkboxes --------
  function wirePanelB2() {
    // Scope to elements carrying data-b2-tab so we don't accidentally hijack
    // the B1 tabs (which reuse the same .db-b2-tab class for styling).
    const tabs = $$('.db-b2-tab[data-b2-tab]');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        state.b2View = btn.dataset.b2Tab;
        renderPanelB2();
      });
      btn.addEventListener('keydown', ev => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        ev.preventDefault();
        const idx = tabs.indexOf(btn);
        const next = ev.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
        state.b2View = tabs[next].dataset.b2Tab;
        renderPanelB2();
        tabs[next].focus();
      });
    });
    // Panel B2 has its own type-filter checkboxes so B1 and B2 can be tuned
    // independently. Disabled checkboxes (theses in co-author view) are skipped.
    $$('[data-b2-type-filter] input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        state.b2TypeSet = new Set(
          $$('[data-b2-type-filter] input[type=checkbox]:checked:not(:disabled)').map(c => c.value)
        );
        renderPanelB2();
      });
    });
    const all = $('[data-b2-type-all]');
    if (all) all.addEventListener('click', () => {
      $$('[data-b2-type-filter] input[type=checkbox]:not(:disabled)').forEach(c => { c.checked = true; });
      state.b2TypeSet = new Set(
        $$('[data-b2-type-filter] input[type=checkbox]:checked:not(:disabled)').map(c => c.value)
      );
      renderPanelB2();
    });
    const none = $('[data-b2-type-none]');
    if (none) none.addEventListener('click', () => {
      $$('[data-b2-type-filter] input[type=checkbox]').forEach(c => { c.checked = false; });
      state.b2TypeSet = new Set();
      renderPanelB2();
    });

    // Authorship + Layout dropdowns (Panel C2 top-of-panel controls)
    const authSel = $('[data-b2-authorship]');
    if (authSel) authSel.addEventListener('change', () => {
      const v = authSel.value;
      if (v === 'first' || v === 'co' || v === 'split') {
        state.b2Authorship = v;
        renderPanelB2();
      }
    });
    const layoutSel = $('[data-b2-layout]');
    if (layoutSel) layoutSel.addEventListener('change', () => {
      const v = layoutSel.value;
      if (v === 'compact' || v === 'detailed') {
        state.b2Layout = v;
        renderPanelB2();
      }
    });

    // Authorship-view: Counts / Percentage toggle
    $$('[data-b2-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.b2Mode;
        if (!mode || state.b2AuthorshipMode === mode) return;
        state.b2AuthorshipMode = mode;
        $$('[data-b2-mode]').forEach(b => {
          const on = b.dataset.b2Mode === mode;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        renderPanelB2();
      });
    });

    // Authorship-view: Sort dropdown
    const sortSel = $('[data-b2-sort]');
    if (sortSel) {
      sortSel.addEventListener('change', () => {
        state.b2AuthorshipSort = sortSel.value || 'total';
        renderPanelB2();
      });
    }

    // Dismiss the authorship tooltip when scrolling or clicking outside a segment.
    window.addEventListener('scroll', hideAuthorshipTip, { passive: true });
    document.addEventListener('click', ev => {
      if (!state.b2Tip) return;
      const t = ev.target;
      if (t && (t.classList && t.classList.contains('db-bars__seg--auth'))) return;
      hideAuthorshipTip();
    });
  }

  // ============ IMPACT VIEW (Ron's presentation overlay) ============
  // Publications grouped by paternal statistical region of the Samoan lead author,
  // split by whether the item is Samoa-focused (has a Samoa-district tag) or
  // international-focused. Toggle filters restrict to PhD / Masters theses.
  function computeImpactData(filter) {
    const conf = { 'Rest of Upolu': {samoa:0, intl:0, scholars:new Set()},
                   'Apia Urban Area':     {samoa:0, intl:0, scholars:new Set()},
                   'North West Upolu':     {samoa:0, intl:0, scholars:new Set()} };
    const confByProv = new Map();
    state.districts.features.forEach(f => confByProv.set(f.properties.name, f.properties.region));

    // Look up each Samoan scholar's paternal statistical region from their filled
    // profile. Empty region = we can't attribute their work to a group.
    const scholarConf = new Map();
    (state.scholarProfilesByName || new Map()).forEach((prof, name) => {
      const c = confByProv.get(effectivePaternalProvince(prof));
      if (c) scholarConf.set(name, c);
    });

    let unattributed = 0;
    state.snapshot.items.forEach(it => {
      // Filter to just theses of the requested level when the user picked one
      if (filter === 'phd' && it.thesisLevel !== 'phd') return;
      if (filter === 'masters' && it.thesisLevel !== 'masters') return;
      // Determine the paternal statistical region from the lead Samoan author. We
      // check the first creator first, then fall back to any Samoan author.
      const creators = it.creators || [];
      let attributed = null, attributedName = null;
      for (let i = 0; i < creators.length; i++) {
        const cn = canonicalNameFromCreator(creators[i]);
        if (cn && scholarConf.has(cn)) {
          attributed = scholarConf.get(cn);
          attributedName = cn;
          if (i === 0) break; // strong preference for lead
        }
      }
      if (!attributed) { unattributed += 1; return; }
      const provSet = state.provincesByItem.get(it.key);
      const hasDistrict = provSet && provSet.size > 0;
      const bucket = conf[attributed];
      if (!bucket) return;
      if (hasDistrict) bucket.samoa += 1; else bucket.intl += 1;
      bucket.scholars.add(attributedName);
    });

    return { conf, unattributed };
  }

  // Local helper — same logic as admin.js canonicalName but limited scope.
  function canonicalNameFromCreator(creator) {
    if (!creator) return null;
    if (typeof creator !== 'string') creator = String(creator);
    if (creator.includes(',')) return creator.trim();
    const parts = creator.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(' ');
    return `${last}, ${first}`;
  }

  function renderImpactView(filter) {
    const data = computeImpactData(filter);
    const chart = $('[data-impact-chart]');
    if (!chart) return;

    // Headline numbers
    const total = ['Rest of Upolu','Apia Urban Area','North West Upolu'].reduce((s, c) => s + data.conf[c].samoa + data.conf[c].intl, 0);
    const samoa = ['Rest of Upolu','Apia Urban Area','North West Upolu'].reduce((s, c) => s + data.conf[c].samoa, 0);
    const intl = total - samoa;
    const allScholars = new Set();
    ['Rest of Upolu','Apia Urban Area','North West Upolu'].forEach(c => data.conf[c].scholars.forEach(n => allScholars.add(n)));
    $('[data-impact-total]').textContent = total.toLocaleString();
    $('[data-impact-samoa]').textContent = samoa.toLocaleString();
    $('[data-impact-intl]').textContent = intl.toLocaleString();
    $('[data-impact-scholars]').textContent = allScholars.size.toLocaleString();

    // Find max across all conf x scope for bar scaling
    const allValues = [];
    ['Rest of Upolu','Apia Urban Area','North West Upolu'].forEach(c => { allValues.push(data.conf[c].samoa, data.conf[c].intl); });
    const max = Math.max(1, ...allValues);
    const MAX_H = 220; // pixels

    const confs = [
      { name: 'Rest of Upolu', color: '#FF5A6E' },
      { name: 'Apia Urban Area',     color: '#4ECDE6' },
      { name: 'North West Upolu',     color: '#FFD84A' }
    ];

    chart.innerHTML = confs.map(c => {
      const d = data.conf[c.name];
      const total = d.samoa + d.intl;
      const scholarList = Array.from(d.scholars).sort().join('&#10;'); // linebreak-separated in tooltip
      return `
        <div class="impact-conf" style="border-top-color:${c.color};">
          <div class="impact-conf__title">${c.name}</div>
          <div class="impact-conf__total">${total} Publication${total === 1 ? '' : 's'} · ${d.scholars.size} scholar${d.scholars.size === 1 ? '' : 's'}</div>
          <div class="impact-conf__bars">
            <div class="impact-bar">
              <div class="impact-bar__value">${d.samoa}</div>
              <div class="impact-bar__col impact-bar__col--samoa" style="height:${Math.max(4, (d.samoa / max) * MAX_H)}px;" data-tooltip="${d.samoa} Samoa-focused item${d.samoa === 1 ? '' : 's'}"></div>
              <div class="impact-bar__label">Samoa-focused</div>
            </div>
            <div class="impact-bar">
              <div class="impact-bar__value">${d.intl}</div>
              <div class="impact-bar__col impact-bar__col--intl" style="height:${Math.max(4, (d.intl / max) * MAX_H)}px;" data-tooltip="${d.intl} international-focused item${d.intl === 1 ? '' : 's'}"></div>
              <div class="impact-bar__label">International</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Footnote text with methodology so viewers in the presentation understand.
    const filterLabel = filter === 'phd' ? 'PhD theses only'
                       : filter === 'masters' ? 'Masters theses only'
                       : 'all publication types';
    let note = `Showing ${filterLabel}. “Samoa-focused” means the item is tagged to at least one Samoan district in Zotero; “International” means it isn’t. Statistical Region is attributed via the lead Samoan author’s paternal district.`;
    if (data.unattributed > 0) {
      note += ` ${data.unattributed} item${data.unattributed === 1 ? ' was' : 's were'} not attributed — the lead scholar’s paternal district hasn’t been filled in the admin dashboard yet.`;
    }
    $('[data-impact-footnote]').textContent = note;
  }

  function wireImpactView() {
    const overlay = $('[data-impact-overlay]');
    const openBtn = $('[data-impact-open]');
    const closeBtn = $('[data-impact-close]');
    if (!overlay || !openBtn) return;

    const open = () => {
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      renderImpactView(state.impactFilter || 'all');
    };
    const close = () => {
      overlay.hidden = true;
      document.body.style.overflow = '';
    };

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    // Click backdrop to close (but not clicks inside the modal)
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    // ESC to close
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && !overlay.hidden) close();
    });
    // Filter tabs
    $$('.impact-filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.impact-filters button').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.impactFilter = btn.dataset.impactFilter;
        renderImpactView(state.impactFilter);
      });
    });
  }

  // ==========================================================================
  // PANEL B3 — Where Samoan research has been undertaken
  //
  // Data model:
  //   The Zotero "Where study was done" collection (key V3HLPDPL) contains
  //   one sub-collection per country. Every item in a country sub-collection
  //   is a publication whose research was carried out in that country.
  //   For each item we compute the first-author's Samoan status via
  //   itaukeiAuthorship(item): 'lead' = Samoan first-author (rust bucket),
  //   'coauth' | 'none' = someone else first-authored (teal bucket).
  //
  //   The pill above the map toggles which count drives the marker size:
  //     - With Samoan: total items with an Samoan author on the byline
  //                     (lead + coauth). Both slices of the pie visible.
  //     - Led by Samoan: only items where an Samoan is first author.
  //                       Pie collapses to the rust slice.
  //
  // Popup:
  //   Two-tier scrollable citation list — Samoan as Lead (rust) then
  //   Others as Lead (teal). Hovering a citation chip fills a detail slot
  //   with the lead author's photo/name/year + publication title.
  // ==========================================================================
  //
  // Hand-curated centroids for the 23 sub-collections currently under
  // V3HLPDPL. If Ron adds a new country later, the runtime falls back to
  // WORLD_COUNTRY_APPROX (loose lookup on the country name).
  //
  // Key = Zotero collection name (unchanged — do NOT rename "Samoa Districts"
  // in Zotero). displayName is what the UI shows; region drives the fullscreen
  // dropdown. "Samoa Districts" renders as "Samoa (Districts)" everywhere.
  const B3_COUNTRY_COORDS = {
    'Samoa Districts': { lat: -17.7134, lng: 178.0650, mapCountry: 'Samoa', displayName: 'Samoa (Districts)', region: 'Pacific' },
    'Australia':      { lat: -25.2744, lng: 133.7751, region: 'Oceania' },
    'New Zealand':    { lat: -41.2865, lng: 174.7762, region: 'Oceania' },
    'Tonga':          { lat: -21.1789, lng: -175.1982, region: 'Pacific' },
    'Samoa':          { lat: -13.7590, lng: -172.1046, region: 'Pacific' },
    'Solomon Islands':{ lat:  -9.6457, lng: 160.1562, region: 'Pacific' },
    'Vanuatu':        { lat: -15.3767, lng: 166.9592, region: 'Pacific' },
    'Japan':          { lat:  36.2048, lng: 138.2529, region: 'Asia' },
    'Kiribati':       { lat:  -3.3704, lng: -168.7340, region: 'Pacific' },
    'Indonesia':      { lat:  -0.7893, lng: 113.9213, region: 'Asia' },
    'China':          { lat:  35.8617, lng: 104.1954, region: 'Asia' },
    'Cook Islands':   { lat: -21.2367, lng: -159.7777, region: 'Pacific' },
    'Papua New Guinea': { lat: -6.3149, lng: 143.9555, region: 'Pacific' },
    'India':          { lat:  20.5937, lng:  78.9629, region: 'Asia' },
    'Philippines':    { lat:  12.8797, lng: 121.7740, region: 'Asia' },
    'Nauru':          { lat:  -0.5228, lng: 166.9315, region: 'Pacific' },
    // Zotero collection is named 'FSM'; displayName expands it for the
    // country-row label and popup title.
    // FSM parent center is placed in empty ocean between Yap (west) and
    // Chuuk (east) so it does not visually collide with the Chuuk pie when
    // both are present. Items filed in the FSM root (not in a state
    // sub-collection) render here.
    'FSM':            { lat:   8.5000, lng: 148.0000, region: 'Pacific',
                        displayName: 'Federated States of Micronesia' },
    // Exact-match alias for the canonical Master `Research Geography` value.
    // Both keys resolve to the same coord/region so items filed under either
    // name render at the same anchor and roll up into the same country total.
    'Federated States of Micronesia': { lat: 8.5000, lng: 148.0000, region: 'Pacific',
                        displayName: 'Federated States of Micronesia' },
    'Marshall Islands': { lat: 7.1315, lng: 171.1845, region: 'Pacific' },
    // The France sub-collection today holds a single study conducted in
    // waters off Mayotte (French overseas territory in the Indian Ocean),
    // so anchor the France pie there rather than mainland France. Region
    // stays 'Europe' to preserve the France regional-filter grouping.
    // Anchor is 12°49'26.0"S 45°09'19.3"E from a user-supplied Maps pin.
    'France':         { lat: -12.8239, lng:  45.1554, region: 'Europe' },
    'Tuvalu':         { lat:  -7.1095, lng: 177.6493, region: 'Pacific' },
    'Tahiti':         { lat: -17.6509, lng: -149.4260, region: 'Pacific' },
    'United States':  { lat:  39.8283, lng: -98.5795, region: 'Americas' },
    // Additional top-level country entries so every distinct Master
    // `Research Geography` Country value has an anchor coordinate. Adding
    // these explicitly (no fuzzy matching) keeps the country list in sync
    // with the Master file. Samoa here is the country-center anchor for
    // studies coded at the country level (Master rows that name only
    // 'Samoa' rather than a district).
    'Canada':         { lat:  56.1304, lng: -106.3468, region: 'Americas' },
    'Samoa':           { lat: -17.7134, lng:  178.0650, region: 'Pacific' },
    'Ghana':          { lat:   7.9465, lng:   -1.0232, region: 'Africa' },
    'South Africa':   { lat: -30.5595, lng:   22.9375, region: 'Africa' },
    'Sri Lanka':      { lat:   7.8731, lng:   80.7718, region: 'Asia' },
    'Vietnam':        { lat:  14.0583, lng:  108.2772, region: 'Asia' },
  };

  // Sub-locations are Zotero sub-collections nested INSIDE a parent country
  // (e.g. FSM/Chuuk, FSM/Pohnpei, United States/Hawaii). Items filed in a
  // sub-collection still count toward the parent country's total in the
  // sidebar/table, but the map renders a separate pie at the sub-location's
  // coordinates instead of the parent country's center. The Zotero key is
  // the leaf collection name; the value carries lat/lng for the pie anchor.
  const B3_SUBLOCATIONS = {
    'FSM': {
      'Chuuk':   { lat:  7.4467, lng: 151.8500, region: 'Pacific' },
      'Pohnpei': { lat:  6.8547, lng: 158.2189, region: 'Pacific' },
      'Kosrae':  { lat:  5.3167, lng: 162.9833, region: 'Pacific' },
      'Yap':     { lat:  9.5497, lng: 138.1103, region: 'Pacific' }
    },
    // Duplicate under the Master canonical name so items whose parent country
    // is emitted as 'Federated States of Micronesia' (Master convention)
    // still resolve their sub-location coords. Kept in sync with the 'FSM'
    // block above; edit both when adding new FSM sub-locations.
    'Federated States of Micronesia': {
      'Chuuk':   { lat:  7.4467, lng: 151.8500, region: 'Pacific' },
      'Pohnpei': { lat:  6.8547, lng: 158.2189, region: 'Pacific' },
      'Kosrae':  { lat:  5.3167, lng: 162.9833, region: 'Pacific' },
      'Yap':     { lat:  9.5497, lng: 138.1103, region: 'Pacific' }
    },
    'United States': {
      'Hawaii':        { lat: 20.5000, lng: -157.5000, region: 'Pacific' },
      'Hawaii (U.S.)': { lat: 20.5000, lng: -157.5000, region: 'Pacific' }
    }
  };

  // Display-name transform — the Zotero collection key is unchanged.
  function b3DisplayName(country) {
    const meta = B3_COUNTRY_COORDS[country];
    return (meta && meta.displayName) ? meta.displayName : country;
  }
  function b3RegionOf(country) {
    const meta = B3_COUNTRY_COORDS[country];
    return (meta && meta.region) ? meta.region : 'Other';
  }

  function initB3Map() {
    const el = document.getElementById('db-map-b3');
    if (!el || typeof L === 'undefined') return;
    if (!state.snapshot) return; // fires again from data load path

    // ---- 1. Build sub-collection -> country name map ----
    // "Where study was done" root (V3HLPDPL). Every direct child is a country.
    const cols = state.snapshot.collections || [];
    const byKey = new Map(cols.map(c => [c.key, c]));
    // Prefer stable key so panel-prefix renames (B3- etc.) don't break lookup.
    const whereRoot = byKey.get('V3HLPDPL')
                   || cols.find(c => c.name === 'B3-Where study was done (with Samoan lead & co-author)' && !c.parent)
                   || cols.find(c => c.name === 'Where study was done' && !c.parent)
                   || null;
    if (!whereRoot) {
      const err = document.querySelector('[data-db-b3-map-error]');
      if (err) { err.style.display = 'block'; err.textContent = 'Zotero "Where study was done" collection not found in snapshot.'; }
      return;
    }
    // countryOfKey[<any descendant key>] = <country name>
    // subLocOfKey[<any descendant key>] = <sub-location name> | null
    // A key is a sub-location if its collection sits under a country and its
    // NAME (not path) matches a B3_SUBLOCATIONS entry for that country. This
    // lets sub-collections like FSM/Chuuk and United States/Hawaii render as
    // separate pies at their own coords while still counting toward the
    // parent country total.
    const countryOfKey = new Map();
    const subLocOfKey = new Map();
    const countries = [];
    cols.filter(c => c.parent === whereRoot.key).forEach(country => {
      countries.push(country.name);
      countryOfKey.set(country.key, country.name);
      subLocOfKey.set(country.key, null);
      const subDef = B3_SUBLOCATIONS[country.name] || null;
      // Recurse into descendants. A descendant whose name matches a known
      // sub-location for this country is tagged with that sub-location; deeper
      // descendants inherit the same tag. Non-matching descendants inherit
      // the parent's sub-location (so an untagged nested tree behaves the
      // same as it always did — items count toward the country center).
      const stack = cols.filter(c => c.parent === country.key).map(c => ({ col: c, subLoc: subDef && subDef[c.name] ? c.name : null }));
      while (stack.length) {
        const { col, subLoc } = stack.shift();
        countryOfKey.set(col.key, country.name);
        subLocOfKey.set(col.key, subLoc);
        cols.filter(x => x.parent === col.key).forEach(x => stack.push({
          col: x,
          subLoc: (subLoc || (subDef && subDef[x.name])) ? (subLoc || x.name) : null
        }));
      }
    });

    // ---- 2. Bucket items by (country, subLocation) + lead/other ----
    // Each item picks up ALL matching (country, subLocation) pairs. An item
    // filed in both Samoa and Australia counts for both; an item filed in
    // FSM/Chuuk counts toward Chuuk pie only (not the FSM main pie).
    // Bucket key: `${country}\u0001${subLoc || ''}`. subLoc = null → parent pie.
    const perBucket = new Map();
    const bucketKey = (country, subLoc) => country + '\u0001' + (subLoc || '');
    const ensure = (country, subLoc) => {
      const k = bucketKey(country, subLoc);
      if (!perBucket.has(k)) perBucket.set(k, { country, subLoc, led: [], others: [] });
      return perBucket.get(k);
    };

    state.snapshot.items.forEach(item => {
      // Collect (country, subLoc) hits — a Set so an item filed in both a
      // sub-collection and its parent country (transitional / legacy) is
      // counted once per unique bucket, not double.
      const hits = new Set();
      (item.collections || []).forEach(k => {
        const cn = countryOfKey.get(k);
        if (!cn) return;
        const sub = subLocOfKey.get(k) || null;
        hits.add(cn + '\u0001' + (sub || ''));
      });
      if (!hits.size) return;
      const kind = itaukeiAuthorship(item); // 'lead' | 'coauth' | 'none'
      hits.forEach(key => {
        const [country, subRaw] = key.split('\u0001');
        const subLoc = subRaw || null;
        const bucket = ensure(country, subLoc);
        if (kind === 'lead') bucket.led.push(item);
        else bucket.others.push(item);
      });
    });

    // Country records with coords, sorted by total desc for stable rendering.
    // One record per (country, subLocation) pair — sub-locations render as
    // separate map pies at their own coords, while the sidebar aggregates
    // records with the same country name.
    const records = [];
    perBucket.forEach(b => {
      if (!b.led.length && !b.others.length) return;
      let lat, lng, region;
      if (b.subLoc) {
        const subDef = (B3_SUBLOCATIONS[b.country] || {})[b.subLoc];
        if (!subDef) { console.warn('B3: no coord for sub-location', b.country, b.subLoc); return; }
        lat = subDef.lat; lng = subDef.lng; region = subDef.region;
      } else {
        const meta = B3_COUNTRY_COORDS[b.country];
        if (!meta) { console.warn('B3: no coord for country', b.country); return; }
        lat = meta.lat; lng = meta.lng; region = meta.region;
      }
      records.push({
        country: b.country,
        subLoc: b.subLoc,
        lat, lng, region,
        led: b.led,
        others: b.others,
        total: b.led.length + b.others.length
      });
    });
    records.sort((a, b) => b.total - a.total);

    state.b3Records = records;
    state.b3View = 'with'; // 'with' | 'led'

    // ---- 3. Build the Leaflet map ----
    const bmap = L.map(el, {
      zoomSnap: 0.25,
      worldCopyJump: false,
      minZoom: 1,
      maxZoom: 10,
      maxBounds: [[-85, -210], [85, 210]],
      maxBoundsViscosity: 0.85
    });
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      attribution: 'Imagery &copy; Google',
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 20
    }).addTo(bmap);
    bmap.setView([-5, 165], 2.25);
    state.b3Map = bmap;

    renderB3Layer();
    renderB3CountryList();
    updateB3Stats();

    setTimeout(() => { if (state.b3Map) state.b3Map.invalidateSize(); }, 100);

    // Pill toggle
    document.querySelectorAll('[data-mapscope-panel="b3"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        document.querySelectorAll('[data-mapscope-panel="b3"] button').forEach(b => {
          b.classList.remove('is-active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
        state.b3View = btn.dataset.b3view;
        renderB3Layer();
        renderB3CountryList();
        updateB3Stats();
      });
    });

    // ---- 4. Wire the fullscreen expand button + click-to-expand ----
    // Reuses the generic wireMapFullscreen() helper (same one B2 uses).
    // On enter/exit we re-render the layer so labels + label culling match
    // the new pixel viewport. Also fit-to-bounds so the fullscreen view
    // frames all populated countries by default.
    wireMapFullscreen('[data-db-b3-map-wrap]', '[data-db-b3-fs-btn]', () => state.b3Map, {
      onOpen: () => {
        // Fit fullscreen view to all currently-plotted markers so the label
        // layer has room to breathe.
        setTimeout(() => {
          if (!state.b3Map || !state.b3Layer) return;
          const layers = state.b3Layer.getLayers();
          if (layers.length) {
            const group = L.featureGroup(layers);
            try { state.b3Map.fitBounds(group.getBounds().pad(0.2), { animate: false }); } catch (_) {}
          }
          renderB3Layer(); // recompute label placements at new zoom
        }, 180);
      },
      onClose: () => {
        setTimeout(() => {
          if (!state.b3Map) return;
          state.b3Map.setView([-5, 165], 2.25, { animate: false });
          renderB3Layer();
        }, 180);
      }
    });

    // Click anywhere on the map (not on a marker or popup) opens fullscreen.
    // We attach to the map instance rather than the wrap div so Leaflet's own
    // "originalEvent.target ancestor is a marker/popup" logic can filter
    // marker clicks out. In Leaflet: 'click' on the map fires only for clicks
    // that reach the tile pane (not clicks that bubble from markers or popups).
    bmap.on('click', () => {
      const wrap = document.querySelector('[data-db-b3-map-wrap]');
      if (!wrap || wrap.classList.contains('is-fullscreen')) return;
      const fsBtn = document.querySelector('[data-db-b3-fs-btn]');
      if (fsBtn) fsBtn.click();
    });

    // ---- 5. Wire the fullscreen dropdown toolbar ----
    initB3ToolbarDropdowns();

    // ---- 6. Wire B2 world-map click-to-expand (once) ----
    // Same UX rule applies to Panel B2's world map.
    if (state.worldMap && !state.worldMapClickWired) {
      state.worldMapClickWired = true;
      state.worldMap.on('click', () => {
        const wrap = document.querySelector('[data-db-map-world-wrap]');
        if (!wrap || wrap.classList.contains('is-fullscreen')) return;
        const fsBtn = document.querySelector('[data-db-map-fs-btn]');
        if (fsBtn) fsBtn.click();
      });
    }
  }

  // Fills and wires the fullscreen dropdown toolbar (Region › Country ›
  // Statistical Region › District + Authorship). Each pick sets state.b3Filter,
  // then rerenders everything. Running tallies on each option reflect the
  // count that would remain if that option were the active leaf.
  function initB3ToolbarDropdowns() {
    // Use country summaries (one row per parent country with sub-locations
    // rolled up) for region/country counts so numbers match the sidebar and
    // world table. Pass unfiltered=true so the full country universe is
    // available for the region/country dropdowns; the authorship gate is
    // applied by paintCountryList/paintRegionList themselves.
    const recs = b3CountrySummaries(true);
    if (!recs.length) return;

    // Precompute per-region totals (respecting authorship filter).
    const totalFor = (subset, authorship) => {
      let n = 0;
      subset.forEach(r => {
        n += (authorship === 'led') ? r.led.length
           : (authorship === 'others') ? r.others.length
           : (r.led.length + r.others.length);
      });
      return n;
    };

    // ---- Region dropdown ----
    const regionBtn   = document.querySelector('[data-db-b3-region-btn]');
    const regionLabel = document.querySelector('[data-db-b3-region-label]');
    const regionPanel = document.querySelector('[data-db-b3-region-panel]');
    const regionList  = document.querySelector('[data-db-b3-region-list]');
    const countryList = document.querySelector('[data-db-b3-country-drilldown]');
    const confCol     = document.querySelector('[data-db-b3-conf-col]');
    const confList    = document.querySelector('[data-db-b3-conf-list]');
    const provCol     = document.querySelector('[data-db-b3-prov-col]');
    const provList    = document.querySelector('[data-db-b3-prov-list]');

    // Build region → [country records] index.
    const regionMap = new Map();
    recs.forEach(r => {
      const region = b3RegionOf(r.country);
      if (!regionMap.has(region)) regionMap.set(region, []);
      regionMap.get(region).push(r);
    });
    const regionOrder = ['Pacific', 'Oceania', 'Asia', 'Americas', 'Europe', 'Africa', 'Other']
      .filter(r => regionMap.has(r));

    const escapeAttr = (s) => escapeHtml(String(s));

    function paintRegionList() {
      const auth = state.b3Filter.authorship;
      const allTotal = totalFor(recs, auth);
      let html = `<button type="button" class="db-map-fs-conf__row ${!state.b3Filter.region ? 'is-active' : ''}" data-region-pick="">All regions <span class="db-map-fs-conf__row-count">${allTotal}</span></button>`;
      regionOrder.forEach(region => {
        const subset = regionMap.get(region);
        const n = totalFor(subset, auth);
        const active = state.b3Filter.region === region ? 'is-active' : '';
        html += `<button type="button" class="db-map-fs-conf__row ${active}" data-region-pick="${escapeAttr(region)}">${escapeAttr(region)} <span class="db-map-fs-conf__row-count">${n}</span></button>`;
      });
      regionList.innerHTML = html;
    }

    function paintCountryList() {
      const auth = state.b3Filter.authorship;
      const subset = state.b3Filter.region ? (regionMap.get(state.b3Filter.region) || []) : recs;
      let html = `<button type="button" class="db-map-fs-conf__row ${!state.b3Filter.country ? 'is-active' : ''}" data-country-pick="">All countries <span class="db-map-fs-conf__row-count">${totalFor(subset, auth)}</span></button>`;
      subset.slice().sort((a, b) => b.total - a.total).forEach(r => {
        const n = (auth === 'led') ? r.led.length : (auth === 'others') ? r.others.length : r.total;
        if (n === 0) return;
        const active = state.b3Filter.country === r.country ? 'is-active' : '';
        html += `<button type="button" class="db-map-fs-conf__row ${active}" data-country-pick="${escapeAttr(r.country)}">${escapeAttr(b3DisplayName(r.country))} <span class="db-map-fs-conf__row-count">${n}</span></button>`;
      });
      countryList.innerHTML = html;
    }

    function paintConfProv() {
      const hasDistrict = state.b3Filter.country === 'Samoa Districts';
      confCol.hidden = !hasDistrict;
      provCol.hidden = !hasDistrict;
      if (!hasDistrict) { confList.innerHTML = ''; provList.innerHTML = ''; return; }

      // Compute per-statistical region and per-district counts against the Samoa record.
      const fijiRec = recs.find(r => r.country === 'Samoa Districts');
      if (!fijiRec) return;
      const provOfItem = state.provincesByItem || new Map();
      const auth = state.b3Filter.authorship;
      const items = (auth === 'led') ? fijiRec.led
                 : (auth === 'others') ? fijiRec.others
                 : fijiRec.led.concat(fijiRec.others);

      const confCount = new Map();
      const provCount = new Map();
      items.forEach(it => {
        const ps = provOfItem.get(it.key);
        if (!ps) return;
        ps.forEach(p => {
          provCount.set(p, (provCount.get(p) || 0) + 1);
          const c = DISTRICT_TO_REGION[p];
          if (c) confCount.set(c, (confCount.get(c) || 0) + 1);
        });
      });

      const totalConf = Array.from(confCount.values()).reduce((a, b) => a + b, 0);
      let cHtml = `<button type="button" class="db-map-fs-conf__row ${!state.b3Filter.region ? 'is-active' : ''}" data-conf-pick="">All statistical regions <span class="db-map-fs-conf__row-count">${totalConf}</span></button>`;
      ['Rest of Upolu', 'Apia Urban Area', 'North West Upolu'].forEach(c => {
        const n = confCount.get(c) || 0;
        const active = state.b3Filter.region === c ? 'is-active' : '';
        cHtml += `<button type="button" class="db-map-fs-conf__row ${active}" data-conf-pick="${escapeAttr(c)}">${escapeAttr(c)} <span class="db-map-fs-conf__row-count">${n}</span></button>`;
      });
      confList.innerHTML = cHtml;

      // District list: filter by active statistical region if set.
      const provOrder = Object.keys(DISTRICT_TO_REGION);
      const filteredProvs = state.b3Filter.region
        ? provOrder.filter(p => DISTRICT_TO_REGION[p] === state.b3Filter.region)
        : provOrder;
      const provTotal = filteredProvs.reduce((a, p) => a + (provCount.get(p) || 0), 0);
      let pHtml = `<button type="button" class="db-map-fs-conf__row ${!state.b3Filter.district ? 'is-active' : ''}" data-prov-pick="">All districts <span class="db-map-fs-conf__row-count">${provTotal}</span></button>`;
      filteredProvs.forEach(p => {
        const n = provCount.get(p) || 0;
        const active = state.b3Filter.district === p ? 'is-active' : '';
        pHtml += `<button type="button" class="db-map-fs-conf__row ${active}" data-prov-pick="${escapeAttr(p)}">${escapeAttr(p)} <span class="db-map-fs-conf__row-count">${n}</span></button>`;
      });
      provList.innerHTML = pHtml;
    }

    function repaintAllDropdowns() {
      paintRegionList();
      paintCountryList();
      paintConfProv();
      const parts = [];
      if (state.b3Filter.region)      parts.push(state.b3Filter.region);
      if (state.b3Filter.country)     parts.push(b3DisplayName(state.b3Filter.country));
      if (state.b3Filter.region) parts.push(state.b3Filter.region);
      if (state.b3Filter.district)    parts.push(state.b3Filter.district);
      regionLabel.textContent = parts.length ? parts.join(' › ') : 'All regions';
      // Enable Clear button only when at least one filter is set.
      const clearBtn = document.querySelector('[data-db-b3-clear]');
      if (clearBtn) {
        const hasFilter = !!(state.b3Filter.region || state.b3Filter.country ||
                             state.b3Filter.region || state.b3Filter.district ||
                             state.b3Filter.authorship);
        clearBtn.disabled = !hasFilter;
      }
    }

    function applyFilter() {
      renderB3Layer();
      renderB3CountryList();
      updateB3Stats();
      repaintAllDropdowns();
      paintAuthList(); // keep authorship label + active row in sync when reset
    }

    // ---- Clear filters button ----
    const clearBtn = document.querySelector('[data-db-b3-clear]');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.b3Filter.region      = null;
        state.b3Filter.country     = null;
        state.b3Filter.region = null;
        state.b3Filter.district    = null;
        state.b3Filter.authorship  = null;
        // Close any open dropdowns for a clean reset.
        if (regionPanel) { regionPanel.hidden = true; regionBtn && regionBtn.setAttribute('aria-expanded', 'false'); }
        applyFilter();
      });
    }

    // Wire the region-panel button clicks (event delegation).
    regionPanel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-region-pick],[data-country-pick],[data-conf-pick],[data-prov-pick]');
      if (!t) return;
      if (t.hasAttribute('data-region-pick')) {
        const v = t.getAttribute('data-region-pick') || null;
        state.b3Filter.region = v;
        // Changing region invalidates the deeper selections.
        state.b3Filter.country = null;
        state.b3Filter.region = null;
        state.b3Filter.district = null;
      } else if (t.hasAttribute('data-country-pick')) {
        const v = t.getAttribute('data-country-pick') || null;
        state.b3Filter.country = v;
        // Changing country invalidates Samoa-only sub-selections.
        state.b3Filter.region = null;
        state.b3Filter.district = null;
        // Auto-set region to match the country if not already scoped.
        if (v && !state.b3Filter.region) state.b3Filter.region = b3RegionOf(v);
      } else if (t.hasAttribute('data-conf-pick')) {
        state.b3Filter.region = t.getAttribute('data-conf-pick') || null;
        state.b3Filter.district = null;
      } else if (t.hasAttribute('data-prov-pick')) {
        state.b3Filter.district = t.getAttribute('data-prov-pick') || null;
      }
      applyFilter();
    });

    // Panel open/close.
    regionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = regionPanel.hidden;
      regionPanel.hidden = !open;
      regionBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // ---- Authorship dropdown ----
    const authBtn   = document.querySelector('[data-db-b3-auth-btn]');
    const authLabel = document.querySelector('[data-db-b3-auth-label]');
    const authPanel = document.querySelector('[data-db-b3-auth-panel]');
    const authList  = document.querySelector('[data-db-b3-auth-list]');

    function paintAuthList() {
      const total   = totalFor(recs, null);
      const ledN    = totalFor(recs, 'led');
      const othersN = totalFor(recs, 'others');
      const rows = [
        { key: null,     label: 'All authorship', n: total },
        { key: 'led',    label: 'Samoan led',    n: ledN   },
        { key: 'others', label: 'Other led',      n: othersN }
      ];
      authList.innerHTML = rows.map(r => {
        const active = state.b3Filter.authorship === r.key ? 'is-active' : '';
        return `<button type="button" class="db-map-fs-conf__row ${active}" data-auth-pick="${escapeAttr(r.key == null ? '' : r.key)}">${escapeAttr(r.label)} <span class="db-map-fs-conf__row-count">${r.n}</span></button>`;
      }).join('');
      authLabel.textContent = state.b3Filter.authorship === 'led' ? 'Samoan led'
                            : state.b3Filter.authorship === 'others' ? 'Other led'
                            : 'All authorship';
    }

    authPanel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-auth-pick]');
      if (!t) return;
      const v = t.getAttribute('data-auth-pick') || null;
      state.b3Filter.authorship = v || null;
      applyFilter();
      paintAuthList();
    });
    authBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = authPanel.hidden;
      authPanel.hidden = !open;
      authBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Close panels on outside click.
    document.addEventListener('click', (e) => {
      if (!regionPanel.hidden && !regionPanel.contains(e.target) && e.target !== regionBtn && !regionBtn.contains(e.target)) {
        regionPanel.hidden = true; regionBtn.setAttribute('aria-expanded', 'false');
      }
      if (!authPanel.hidden && !authPanel.contains(e.target) && e.target !== authBtn && !authBtn.contains(e.target)) {
        authPanel.hidden = true; authBtn.setAttribute('aria-expanded', 'false');
      }
    });

    paintRegionList();
    paintCountryList();
    paintConfProv();
    paintAuthList();
  }

  // B3 palette. Amber-gold reads against both dark-blue ocean tiles and land
  // imagery; teal blended into the ocean and got lost. Update both here and
  // in samoan-research-database.html (.b3-cite.is-others, .db-popup-scholar-
  // header.is-others) if you change it.
  const B3_RUST = '#712B13';
  const B3_GOLD = '#E8AF34';

  // Filter state for the fullscreen toolbar. All null = no filter.
  // authorship: null | 'led' | 'others'.
  state.b3Filter = state.b3Filter || {
    region: null,
    country: null,
    region: null,
    district: null,
    authorship: null
  };

  // Build the pie-per-country SVG icon: rust slice = led, gold slice = others.
  // Radius scales with the toggled bucket's total. In 'with' mode both slices
  // show; in 'led' mode only the rust slice, sized by led count alone.
  function b3MakePieIcon(rec, radius, mode) {
    const ledN = rec.led.length;
    const othN = rec.others.length;
    const totalForPie = (mode === 'led') ? ledN : (ledN + othN);
    if (totalForPie === 0) return null;
    const cx = radius + 2, cy = radius + 2;
    const size = (radius + 2) * 2;

    // Case 1: Led-only mode, or country is 100% led — draw solid rust circle.
    if (mode === 'led' || othN === 0) {
      return L.divIcon({
        className: 'b3-pie',
        html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${B3_RUST}" stroke="#fff" stroke-width="1.5" opacity="0.92"/>
        </svg>`,
        iconSize: [size, size],
        iconAnchor: [cx, cy]
      });
    }
    // Case 2: 100% others — solid gold.
    if (ledN === 0) {
      return L.divIcon({
        className: 'b3-pie',
        html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${B3_GOLD}" stroke="#fff" stroke-width="1.5" opacity="0.92"/>
        </svg>`,
        iconSize: [size, size],
        iconAnchor: [cx, cy]
      });
    }
    // Case 3: mixed — two-slice pie. Rust slice = led / total.
    const ledFrac = ledN / totalForPie;
    const angle = ledFrac * 2 * Math.PI;
    const x2 = cx + radius * Math.sin(angle);
    const y2 = cy - radius * Math.cos(angle);
    const largeArc = ledFrac > 0.5 ? 1 : 0;
    const rustPath = `M ${cx} ${cy} L ${cx} ${cy - radius} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return L.divIcon({
      className: 'b3-pie',
      html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${B3_GOLD}" stroke="#fff" stroke-width="1.5" opacity="0.92"/>
        <path d="${rustPath}" fill="${B3_RUST}" stroke="#fff" stroke-width="1.5" opacity="0.95"/>
      </svg>`,
      iconSize: [size, size],
      iconAnchor: [cx, cy]
    });
  }

  // Apply the current filter to a records array (country records) and produce
  // filtered per-country buckets. When authorship='led' or 'others', the other
  // bucket is emptied. When a Samoa district is active, non-Samoa records drop
  // and the Samoa record is narrowed to items whose provincesByItem set
  // contains that district. Statistical Region filter narrows the same way.
  function b3FilteredRecords() {
    const filter = state.b3Filter || {};
    const recs = state.b3Records || [];
    const provOfItem = state.provincesByItem || new Map();

    return recs.map(rec => {
      // Region gate.
      if (filter.region && b3RegionOf(rec.country) !== filter.region) return null;
      // Country gate.
      if (filter.country && rec.country !== filter.country) return null;

      let led = rec.led;
      let others = rec.others;

      // Samoa-only: region/district narrowing. Applies only when the
      // active country is Samoa Districts (or the Samoa-Districts branch of
      // the drilldown is selected).
      const hasDistrict = rec.country === 'Samoa Districts';
      if (hasDistrict && (filter.region || filter.district)) {
        const matchItem = (it) => {
          const set = provOfItem.get(it.key);
          if (!set || !set.size) return false;
          if (filter.district) return set.has(filter.district);
          if (filter.region) {
            for (const p of set) {
              if (DISTRICT_TO_REGION[p] === filter.region) return true;
            }
            return false;
          }
          return true;
        };
        led = led.filter(matchItem);
        others = others.filter(matchItem);
      } else if (!hasDistrict && (filter.region || filter.district)) {
        // Non-Samoa countries have no district tagging; drop them when the user
        // is drilling into a Samoa sub-scope.
        return null;
      }

      // Authorship gate.
      if (filter.authorship === 'led') others = [];
      else if (filter.authorship === 'others') led = [];

      if (!led.length && !others.length) return null;
      return {
        country: rec.country,
        subLoc: rec.subLoc,
        lat: rec.lat, lng: rec.lng,
        led, others,
        total: led.length + others.length
      };
    }).filter(Boolean);
  }

  // Aggregate records by parent country. Used by the sidebar table and the
  // country-dropdown drilldown so an item filed in FSM/Chuuk still rolls up
  // under the single "Federated States of Micronesia" row. Pass
  // `unfiltered=true` when you want the full country universe (e.g. to
  // populate dropdowns) instead of the current filter's visible set.
  function b3CountrySummaries(unfiltered) {
    const recs = unfiltered ? (state.b3Records || []) : b3FilteredRecords();
    const byCountry = new Map();
    recs.forEach(r => {
      if (!byCountry.has(r.country)) {
        // Use the country's own coords as the summary anchor (not any
        // sub-location's), so clicking the row zooms to the parent country.
        const meta = B3_COUNTRY_COORDS[r.country] || { lat: r.lat, lng: r.lng };
        byCountry.set(r.country, {
          country: r.country,
          lat: meta.lat, lng: meta.lng,
          led: [], others: []
        });
      }
      const s = byCountry.get(r.country);
      s.led = s.led.concat(r.led);
      s.others = s.others.concat(r.others);
    });
    const out = [];
    byCountry.forEach(s => {
      // Dedupe items that appear in multiple sub-locations (e.g. an item
      // filed in both FSM and FSM/Chuuk during a transition).
      const seenLed = new Set(), seenOth = new Set();
      s.led = s.led.filter(it => !seenLed.has(it.key) && (seenLed.add(it.key), true));
      s.others = s.others.filter(it => !seenOth.has(it.key) && (seenOth.add(it.key), true));
      s.total = s.led.length + s.others.length;
      out.push(s);
    });
    return out.sort((a, b) => b.total - a.total);
  }

  function renderB3Layer() {
    const bmap = state.b3Map;
    if (!bmap) return;
    if (state.b3Layer) { bmap.removeLayer(state.b3Layer); state.b3Layer = null; }
    if (state.b3LabelLayer) { bmap.removeLayer(state.b3LabelLayer); state.b3LabelLayer = null; }
    const records = b3FilteredRecords();
    const mode = state.b3View || 'with';
    // Radius by count of the toggled bucket. Samoa at 234 dwarfs everything so
    // we sqrt-scale to keep tail countries readable.
    const countFor = (r) => (mode === 'led') ? r.led.length : r.total;
    const maxN = Math.max(1, ...records.map(countFor));

    // Sort LARGEST first so we add largest markers first. In Leaflet, later-
    // added markers render on top of earlier ones, so this puts the smaller
    // pies visually on top of the larger ones. Belt-and-braces: also set
    // zIndexOffset inversely proportional to radius.
    const withMeta = records
      .map(rec => ({ rec, n: countFor(rec) }))
      .filter(x => x.n > 0)
      .map(x => ({
        ...x,
        radius: Math.max(6, Math.min(28, 6 + Math.sqrt(x.n / maxN) * 22))
      }))
      .sort((a, b) => b.radius - a.radius); // largest first

    const markers = [];
    withMeta.forEach(({ rec, radius }) => {
      const icon = b3MakePieIcon(rec, radius, mode);
      if (!icon) return;
      // Larger radius → lower zIndexOffset so smaller markers rise to the top.
      // Range: -1000 for the largest, up to 0 for the smallest.
      const zOffset = Math.round(-1000 * (radius / 30));
      const m = L.marker([rec.lat, rec.lng], { icon, zIndexOffset: zOffset });
      m._b3Record = rec;
      m._b3Radius = radius;
      // Tag the marker's DOM element with the country name so QA/automation can
      // locate a specific pie without hunting through Leaflet internals.
      m.on('add', () => {
        const el = m.getElement && m.getElement();
        if (el) el.setAttribute('data-b3-country', rec.country);
      });
      const html = b3BuildCountryPopupHtml(rec);
      // maxWidth/minWidth are 1.5× the default world-popup dimensions so long
      // report/thesis titles fit in the hover-detail slot without wrapping to
      // 4+ lines. Requested in the Revised-Panel-B3 spec (Jul 2026).
      m.bindPopup(html, {
        maxWidth: 690,
        minWidth: 510,
        className: 'db-world-popup db-world-popup--b3',
        autoClose: false,
        closeOnClick: false,
        autoPan: true,
        autoPanPadding: [40, 40],
        keepInView: true
      });
      m.on('mouseover', () => m.openPopup());
      m.on('popupopen', (evt) => {
        const popupEl = evt.popup && evt.popup.getElement && evt.popup.getElement();
        b3WirePopupHovers(popupEl, rec);
        // Reuse the B2 marker/popup auto-close bridge so moving the mouse
        // between the pie and its popup doesn't close it prematurely.
        if (typeof wirePopupAutoClose === 'function') {
          wirePopupAutoClose(popupEl, evt.popup, m);
        }
        setTimeout(() => {
          if (typeof nudgePopupIntoView === 'function') {
            nudgePopupIntoView(popupEl, state.b3Map);
          }
        }, 40);
      });
      markers.push(m);
    });
    state.b3Layer = L.layerGroup(markers).addTo(bmap);

    // Fullscreen-only: draw white country labels beside each pie. Non-overlap
    // check is greedy: sort by radius desc, drop later labels whose pixel bbox
    // would collide with any already-placed label. Labels use a divIcon so we
    // can position them relative to the pie anchor via CSS transform.
    renderB3CountryLabels(withMeta);
  }

  // Draw country-name labels next to each pie (fullscreen-only — CSS hides
  // them inline). Uses a greedy non-overlap heuristic based on projected
  // pixel coordinates so tightly-clustered pies (e.g. Pacific islands) don't
  // pile labels on top of each other.
  function renderB3CountryLabels(withMeta) {
    const bmap = state.b3Map;
    if (!bmap) return;
    // Convert lat/lng → container px so we can compute rough label bboxes.
    const items = withMeta.map(({ rec, radius }) => {
      const pt = bmap.latLngToContainerPoint([rec.lat, rec.lng]);
      return { rec, radius, x: pt.x, y: pt.y };
    }).sort((a, b) => b.radius - a.radius);

    // Rough label bbox: assume ~7px per character, height ~16px, anchored at
    // pt.x + radius + 6, pt.y - 8 (matches the CSS transform).
    const placed = [];
    const overlaps = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
    const labelMarkers = [];

    items.forEach(({ rec, radius, x, y }) => {
      const text = b3DisplayName(rec.country);
      const w = text.length * 7 + 6;
      const bbox = {
        x0: x + radius + 4,
        y0: y - 10,
        x1: x + radius + 4 + w,
        y1: y + 6
      };
      // Skip if it collides with an already-placed label.
      if (placed.some(p => overlaps(p, bbox))) return;
      placed.push(bbox);
      const icon = L.divIcon({
        className: 'b3-country-label',
        html: escapeHtml(text),
        iconSize: [w, 20],
        iconAnchor: [-radius - 4, 10]  // offset to right of the pie
      });
      labelMarkers.push(L.marker([rec.lat, rec.lng], {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }));
    });

    state.b3LabelLayer = L.layerGroup(labelMarkers).addTo(bmap);

    // Labels are anchored by lat/lng, so Leaflet reprojects them on pan/zoom
    // automatically. The non-overlap culling is computed once at the current
    // zoom — users pan around freely; labels won't retile until the next
    // full renderB3Layer() (which fires on filter/mode changes and on
    // enter/exit fullscreen).
  }

  function updateB3Stats() {
    // Stats always reflect the current filter/view.
    const records = b3FilteredRecords();
    let led = 0, others = 0;
    records.forEach(r => { led += r.led.length; others += r.others.length; });
    const setNum = (sel, n) => { const el = document.querySelector(sel); if (el) el.textContent = String(n); };
    setNum('[data-b3-stats-countries]', records.length);
    setNum('[data-b3-stats-total]', led + others);
    setNum('[data-b3-stats-led]', led);
    setNum('[data-b3-stats-others]', others);
  }

  function b3InTextCitation(item) {
    // V1-style citation, but sourced from the Master's bibliographic fields
    // when available (adapter emits _bibLead + _bibAuthorCount from the
    // Publications sheet). Falls back to Zotero-style item.creators for
    // records with no BibTeX-derived lead (unresolved / edited volumes).
    //   1 author  → "Grace (2020)"
    //   2 authors → "Grace & Ravulo (2021)"
    //   3+ authors→ "Grace et al. (2026)"
    //   0 authors → "Unknown (…)"
    // The et al. decision uses the TRUE bibliographic author count when known
    // — never inferred from item.creators.length (which for Samoan co-authored
    // works only counts the Samoan scholars linked in the Authorship
    // worksheet plus the true first author, so it under-counts).
    const year = item.year || 'n.d.';
    const creators = item.creators || [];
    const bibLead = (item._bibLead || '').trim();
    const bibCount = (typeof item._bibAuthorCount === 'number' && item._bibAuthorCount > 0)
      ? item._bibAuthorCount
      : null;

    // Choose the primary surname: bib lead when present, else creators[0].
    const primary = bibLead || (creators[0] || '');
    if (!primary) return `Unknown (${year})`;
    const surname = primary.includes(',')
      ? primary.split(',', 1)[0].trim()
      : (primary.trim().split(/\s+/).pop() || primary);

    // Total author count for the et al. decision.
    const total = bibCount != null
      ? bibCount
      : creators.length;

    if (total <= 1) return `${surname} (${year})`;
    if (total === 2) {
      // Two-author citation is only rendered as "A & B" when we can name the
      // second author reliably. When bib count says 2 but we don't have a
      // second name (e.g. two Samoan co-authors of a non-Samoan work would
      // still only expose one non-Samoan lead via creators[0]), fall back
      // to "A et al." so we don't mis-name the second author.
      const second = (bibLead && creators[1]) || creators[1] || '';
      if (second) {
        const surname2 = second.includes(',')
          ? second.split(',', 1)[0].trim()
          : (second.trim().split(/\s+/).pop() || second);
        // Guard against A & A rendering when creators duplicate the lead.
        if (surname2 && surname2.toLowerCase() !== surname.toLowerCase()) {
          return `${surname} & ${surname2} (${year})`;
        }
      }
      return `${surname} et al. (${year})`;
    }
    return `${surname} et al. (${year})`;
  }

  function b3BuildCountryPopupHtml(rec) {
    const total = rec.led.length + rec.others.length;
    // Render one section (Samoan-led OR others-led) as a single flowing
    // sentence: `Ali (2020); Bola et al. (2021); Cakau (2019)` with the
    // citation text alternating between two colors so the eye can pick out
    // where one citation ends and the next begins. Same visual pattern as
    // the B2 popup name lists (renderScholarNameList above). Requested in
    // the Revised-Panel-B3 spec (Jul 2026): the previous per-line list
    // wasted vertical space.
    const renderInlineList = (items, kind) => {
      if (!items.length) return '';
      const sorted = items.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
      const header = (kind === 'led')
        ? `<div class="db-popup-scholar-header is-led">Samoan as Lead (${sorted.length}):</div>`
        : `<div class="db-popup-scholar-header is-others">Others as Lead (${sorted.length}):</div>`;
      const parts = sorted.map((it, i) => {
        // Alternate between two color classes so consecutive citations are
        // visually distinct even without punctuation cues.
        const cls = (i % 2 === 0) ? 'is-alt-a' : 'is-alt-b';
        const cite = b3InTextCitation(it);
        return `<span class="b3-cite is-${kind} ${cls}" data-b3-item-key="${escapeHtml(it.key)}">${escapeHtml(cite)}</span>`;
      });
      return header + `<span class="b3-cite-list b3-cite-list--inline">` +
        parts.join(`<span class="b3-cite-sep">;</span> `) +
        `</span>`;
    };
    // Sub-location pies (FSM/Chuuk, United States/Hawaii, …) show the
    // sub-location as the primary popup title with the parent country name
    // in parentheses. Parent-country pies keep their existing title.
    const title = rec.subLoc
      ? `${rec.subLoc} (${b3DisplayName(rec.country)})`
      : b3DisplayName(rec.country);
    return (
      `<div class="db-popup-title">${escapeHtml(title)}</div>` +
      `<div class="db-popup-count-row">` +
        `<span class="db-popup-count">${total}</span>` +
        `<span class="db-popup-count-text">publication${total === 1 ? '' : 's'} where research was undertaken here</span>` +
      `</div>` +
      `<div class="b3-work-detail" data-b3-work-detail></div>` +
      `<div class="db-popup-scroll">` +
        renderInlineList(rec.led, 'led') +
        renderInlineList(rec.others, 'others') +
      `</div>`
    );
  }

  // Wire hover-to-detail behaviour: hovering a citation chip fills the
  // .b3-work-detail slot with a Panel-B2-style card — a picture-fill vertical
  // strip on the left, and a body on the right containing the lead author's
  // name + venue + title, plus a village/(district) – Statistical Region chip when
  // the lead is Samoan and their profile has that data.
  function b3WirePopupHovers(popupEl, rec) {
    if (!popupEl) return;
    const detail = popupEl.querySelector('[data-b3-work-detail]');
    if (!detail) return;
    // Build a quick lookup: item key -> { item, isLed }. Cheaper than a
    // linear scan of state.snapshot.items every hover.
    const byKey = new Map();
    rec.led.forEach(it => byKey.set(it.key, { item: it, isLed: true }));
    rec.others.forEach(it => byKey.set(it.key, { item: it, isLed: false }));
    // District → Statistical Region lookup (same table used by buildWorldPopupHtml
    // above). Inlined so we don't reach for the module-scope constant that
    // isn't guaranteed to be in scope this early in the popup lifecycle.
    const PROV_TO_CONF = {
      Kadavu: 'Rest of Upolu', 'Nadroga/Navosa': 'Rest of Upolu', Namosi: 'Rest of Upolu',
      Rewa: 'Rest of Upolu', Serua: 'Rest of Upolu',
      Ba: 'Apia Urban Area', Lomaiviti: 'Apia Urban Area', Naitasiri: 'Apia Urban Area',
      Ra: 'Apia Urban Area', Tailevu: 'Apia Urban Area',
      Bua: 'North West Upolu', Cakaudrove: 'North West Upolu', Lau: 'North West Upolu', Macuata: 'North West Upolu'
    };
    // Assemble the V2 hover-chip locality line from a scholar profile.
    //   'Naroi vlg (Moala Is), Lau District.'   (outer islands)
    //   'Naduri vlg, Macuata District.'         (Viti Levu / Vanua Levu — island suppressed)
    // Delegates to the shared formatScholarGeography() defined at the top
    // of this file. The `prof` argument is a scholar profile-shaped object;
    // if only village + district strings are available (legacy call site),
    // pass `{ village, paternalDistrict: district }` — no island will be
    // shown, which matches the pre-V2 behaviour for those chips. Returns
    // '' when nothing meaningful can be rendered.
    function mergeVillageProvince(prof) {
      if (!prof) return '';
      // Identity geography is strictly paternal. See
      // docs/PANELF-PATERNAL-GEOGRAPHY-2026-08-25.md.
      const village  = prof.paternalVillage  || '';
      const island   = prof.paternalIsland   || '';
      const district = prof.paternalDistrict || '';
      return formatScholarGeography(village, island, district);
    }
    // Track any active photo-rotation interval so we can clear it when the user
    // moves to a different citation. Multiple Samoan co-authors rotate every 2s.
    let photoRotationTimer = null;
    const clearPhotoRotation = () => {
      if (photoRotationTimer) { clearInterval(photoRotationTimer); photoRotationTimer = null; }
    };
    const chips = popupEl.querySelectorAll('.b3-cite[data-b3-item-key]');
    chips.forEach(chip => {
      chip.addEventListener('mouseenter', () => {
        clearPhotoRotation();
        const key = chip.getAttribute('data-b3-item-key');
        const rec = byKey.get(key);
        if (!rec) { detail.classList.remove('is-active'); detail.innerHTML = ''; return; }
        const it = rec.item;
        const firstAuthor = (it.creators && it.creators[0]) || 'Unknown';
        const leadProfile = b3LookupProfile(firstAuthor);
        const year = it.year || '';
        const title = it.title || '(untitled)';
        const venue = it.publicationTitle || it.university || '';

        // Collect Samoan co-authors (used only on Others-as-Lead entries per the
        // July 2026 spec: elevate Samoan scholarship visually even when the paper
        // isn't led by an Samoan scholar). Each entry keeps its profile so we can
        // pull photo + village + district.
        const itaukeiCoauthors = [];
        if (!rec.isLed) {
          const seen = new Set();
          (it.creators || []).forEach((nm, idx) => {
            if (idx === 0) return; // skip lead (already known non-Samoan on Others rows)
            if (!creatorIsItaukei(nm)) return;
            const prof = b3LookupProfile(nm);
            // Dedupe on the profile canonical name (or the raw creator string when
            // no profile exists) so a paper doesn't list the same person twice if
            // Zotero recorded a name variant on both a first and last creator slot.
            const dedupeKey = (prof && prof.name) ? prof.name : String(nm).toLowerCase();
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            itaukeiCoauthors.push({ name: nm, profile: prof });
          });
        }

        // ---- Left photo strip ----
        // Samoan-led:    use the lead's photo (unchanged behaviour).
        // Others + 1 iT: permanent photo of the sole Samoan co-author.
        // Others + >=2:  rotate through Samoan co-author photos every 2s.
        // Others + 0:    empty strip (same as before).
        let photoUrl = '';
        let rotationUrls = [];
        if (rec.isLed) {
          photoUrl = (leadProfile && leadProfile.photo) ? leadProfile.photo : '';
        } else if (itaukeiCoauthors.length) {
          rotationUrls = itaukeiCoauthors.map(c => (c.profile && c.profile.photo) || '').filter(Boolean);
          photoUrl = rotationUrls[0] || '';
        }

        // ---- Header line: lead name + year + (for Others rows) inline Samoan
        // co-authors, semicolon-separated with alternating tones, each followed
        // by their (Village, District) chip. Uses the lead's name in bold/dark
        // grey as the anchor so the reader still knows who first-authored.
        const displayLead = leadProfile ? leadProfile.name : firstAuthor;
        let coauthInline = '';
        if (!rec.isLed && itaukeiCoauthors.length) {
          const parts = itaukeiCoauthors.map((c, i) => {
            const cls = (i % 2 === 0) ? 'is-alt-a' : 'is-alt-b';
            // Prefer the profile's canonical "Last, First" split; fall back to a
            // best-effort flip of the raw Zotero string.
            let first = '', last = '';
            if (c.profile) {
              first = c.profile.first || '';
              last  = c.profile.last  || '';
              if (!first && !last && c.profile.name) {
                const p = String(c.profile.name).split(',', 2);
                last = (p[0] || '').trim();
                first = (p[1] || '').trim();
              }
            }
            if (!first && !last) {
              const s = String(c.name || '').trim();
              if (s.includes(',')) {
                const p = s.split(',', 2);
                last = (p[0] || '').trim();
                first = (p[1] || '').trim();
              } else {
                const toks = s.split(/\s+/);
                if (toks.length >= 2) { last = toks[toks.length-1]; first = toks.slice(0,-1).join(' '); }
                else { last = s; }
              }
            }
            const nameText = `${first} ${last}`.trim() || String(c.name || '');
            const chip = c.profile ? mergeVillageProvince(c.profile) : '';
            const chipHtml = chip ? ` <span class="b3-work-detail__coauth-chip">${escapeHtml(chip)}</span>` : '';
            return `<span class="b3-work-detail__coauth ${cls}">${escapeHtml(nameText)}</span>${chipHtml}`;
          });
          coauthInline = ' ' + parts.join('<span class="b3-work-detail__coauth-sep">;</span> ');
        }

        // Village/(district) chip on the *lead* line — only shown for Samoan-led
        // entries whose profile has village + district. Others-led rows carry the
        // village info inline next to each co-author instead.
        let villageLine = '';
        if (rec.isLed && leadProfile) {
          const label = mergeVillageProvince(leadProfile);
          if (label) {
            villageLine = `<div class="b3-work-detail__village">${escapeHtml(label)}</div>`;
          }
        }

        detail.classList.add('is-active');
        // Picture-fill vertical strip on the left; body on the right. When
        // there's no photo we still render an empty strip so the body's left
        // edge stays in the same place — prevents the popup from jumping
        // horizontally as the user hovers different citations.
        detail.innerHTML = (
          `<div class="b3-work-detail__row">` +
            `<div class="b3-work-detail__photo${photoUrl ? '' : ' is-empty'}" data-b3-photo-slot` +
              (photoUrl ? ` style="background-image:url('${escapeHtml(photoUrl)}')"` : '') +
            `></div>` +
            `<div class="b3-work-detail__body">` +
              `<div class="b3-work-detail__name">${escapeHtml(displayLead)}` +
                (year ? ` <span class="b3-work-detail__year">(${escapeHtml(String(year))})</span>` : '') +
                coauthInline +
              `</div>` +
              villageLine +
              `<div class="b3-work-detail__title">${escapeHtml(title)}</div>` +
              (venue ? `<div class="b3-work-detail__venue">${escapeHtml(venue)}</div>` : '') +
            `</div>` +
          `</div>`
        );

        // If multiple Samoan co-authors, cycle photos every 2s. Skips missing
        // photos so the strip only shows real portraits and doesn't briefly
        // flash the empty tile between real images.
        if (rotationUrls.length > 1) {
          const slot = detail.querySelector('[data-b3-photo-slot]');
          let idx = 0;
          photoRotationTimer = setInterval(() => {
            idx = (idx + 1) % rotationUrls.length;
            if (slot) slot.style.backgroundImage = `url('${rotationUrls[idx]}')`;
          }, 2000);
        }
      });
    });
    // Clear any running rotation when the popup itself closes (Leaflet fires this).
    popupEl.addEventListener('remove', clearPhotoRotation, { once: true });
    // Leave detail visible on mouseleave so the user can move over it if they
    // want; it clears when the popup closes.
  }

  // Resolve a Zotero creator name to a scholar-profile record so we can pull
  // the photo. Tries direct lookup, then alias resolution.
  function b3LookupProfile(creatorName) {
    if (!creatorName) return null;
    const map = state.scholarProfilesByName;
    if (!map) return null;
    const aliases = state.nameAliases || new Map();
    // Direct hit
    if (map.has(creatorName)) return map.get(creatorName);
    // Alias -> canonical
    if (aliases.has && aliases.has(creatorName)) {
      const canon = aliases.get(creatorName);
      if (map.has(canon)) return map.get(canon);
    }
    // Flip "First Last" -> "Last, First"
    const s = String(creatorName).trim();
    if (!s.includes(',')) {
      const toks = s.split(/\s+/);
      if (toks.length >= 2) {
        const flipped = toks[toks.length - 1] + ', ' + toks.slice(0, -1).join(' ');
        if (map.has(flipped)) return map.get(flipped);
        if (aliases.has && aliases.has(flipped)) {
          const canon = aliases.get(flipped);
          if (map.has(canon)) return map.get(canon);
        }
      }
    } else {
      // Drop middle initial(s): "Fong, Patrick S." -> "Fong, Patrick"
      const parts = s.split(',', 2);
      const first = (parts[1] || '').trim().split(/\s+/)[0] || '';
      if (first) {
        const trimmed = parts[0].trim() + ', ' + first;
        if (map.has(trimmed)) return map.get(trimmed);
      }
    }
    return null;
  }

  function renderB3CountryList() {
    const host = document.querySelector('[data-b3-country-list]');
    if (!host) return;
    // The list respects the active filter so it stays in sync with the map.
    // One row per parent country — sub-locations (Chuuk, Hawaii, …) are
    // aggregated into their parent so the sidebar count matches the country
    // total in the world table.
    const summaries = b3CountrySummaries();
    const rows = summaries.map(rec => {
      const ledN = rec.led.length;
      const othN = rec.others.length;
      return (
        `<div class="db-world-country-row" data-b3-country="${escapeHtml(rec.country)}">` +
          `<span class="db-world-country-row__name">${escapeHtml(b3DisplayName(rec.country))}</span>` +
          `<span class="db-world-country-row__num b3-cell--led">${ledN}</span>` +
          `<span class="db-world-country-row__num b3-cell--others">${othN}</span>` +
          `<span class="db-world-country-row__num b3-cell--total">${ledN + othN}</span>` +
        `</div>`
      );
    }).join('');
    host.innerHTML = rows || '<div class="db-world-empty" style="padding:8px 0;color:#666;">No countries match the current filter.</div>';
    // Click a country to zoom the map on it.
    host.querySelectorAll('[data-b3-country]').forEach(row => {
      row.addEventListener('click', () => {
        const name = row.getAttribute('data-b3-country');
        const summary = summaries.find(s => s.country === name);
        if (!summary || !state.b3Map) return;
        // Prefer the parent country's center for the zoom; if the parent has
        // no items of its own and all items live in sub-locations, this still
        // frames the sub-location pies since the parent center is nearby.
        state.b3Map.setView([summary.lat, summary.lng], 4.5, { animate: true });
        // Open the popup for the first matching pie (parent, then sub-locs).
        const layers = state.b3Layer ? state.b3Layer.getLayers() : [];
        const m = layers.find(l => l._b3Record && l._b3Record.country === name);
        if (m) setTimeout(() => m.openPopup(), 350);
      });
    });
  }

  // ================================================================
  // Samoa-native public hooks (for samoa-panel-overrides.js).
  // Exposed as `window.samoaDb` so the overrides file can reach in
  // and (a) mutate the filter-state slots that samoa-panel-overrides
  // introduced this session, and (b) trigger renderLeaders() /
  // renderItems() after a listbox selection. Keep the surface minimal.
  // ================================================================
  window.samoaDb = {
    state: state,
    renderLeaders: renderLeaders,
    renderItems: (typeof renderItems === 'function') ? renderItems : null
  };
  window.__samoaSetScholarFilter = function(key, value){
    if (!key) return;
    state[key] = (value == null) ? '' : value;
    state.scholarPage = 1;
  };
  window.__samoaSetDistrictRegions = function(map){
    // The main JS builds its district→region map from state.districts.
    // If bundle.geo provides a fresh authoritative map, replace the
    // per-feature `region` property so downstream lookups pick it up.
    if (!map || !state || !state.districts || !state.districts.features) return;
    state.districts.features.forEach(f => {
      const nm = f && f.properties && f.properties.name;
      if (nm && map[nm]) f.properties.region = map[nm];
    });
  };
})();
