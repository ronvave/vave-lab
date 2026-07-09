/*
 * iTaukei Scholarly Research Database
 * Loads /data/itaukei-zotero-snapshot.json, /data/fiji-provinces.geojson, and
 * /data/world-universities.json, then renders an interactive map, charts, and filterable cards.
 * Every filter is reflected in the URL query string so a filtered view can be shared as a link.
 * A background live-fetch to api.zotero.org keeps the freshness badge accurate; failure never
 * breaks the map or charts.
 */
(function () {
  'use strict';

  // Bright, satellite-legible border colors — one per chiefly confederacy
  const CONF_COLORS = {
    Burebasaga: '#FF5A6E',
    Kubuna:     '#4ECDE6',
    Tovata:     '#FFD84A'
  };
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
  const FILTER_KEYS = ['q', 'itemType', 'discipline', 'decade', 'province', 'paternal', 'university', 'year', 'scholar', 'b2Group', 'b2Authorship'];

  const TYPE_COLOR = {
    thesisPhd:      '#228B22',   // forest green — PhD
    thesisMasters:  '#8FBC8F',   // dark sea green — lighter forest, Masters
    thesisUnknown:  '#4CAF50',   // material green — unclassified thesis
    journalArticle: '#0e7490',
    bookSection:    '#7a1419',
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
  // NOTE: `conferencePaper` is intentionally omitted from TYPE_ORDER.
  // The visualization panels (B1, B2, C, D) iterate over TYPE_ORDER, so this
  // drops conference papers from bars, histogram, and type-filter checkboxes.
  // The underlying items remain in the item list and BibTeX export (which do
  // not depend on TYPE_ORDER).
  const TYPE_ORDER = ['thesisPhd','thesisMasters','journalArticle','bookSection','book','report','preprint'];

  // Effective paternal-province for a scholar profile: prefer the explicit
  // paternal province, but fall back to the maternal province when paternal
  // is blank. Used for confederacy chips, Panel B2 grouping, and every place
  // the dashboard describes a scholar's 'home' province. This handles the
  // case where a scholar considers themselves iTaukei via their mother
  // (e.g. Aporosa Apo — Naduri village, Macuata Province via mother).
  // The admin form records `nonItaukeiDad` and `maternalProvince` explicitly;
  // the public dashboard doesn't need those flags separately, just the
  // effective province.
  function effectivePaternalProvince(profile) {
    if (!profile) return '';
    return (profile.paternalProvince || profile.maternalProvince || '').trim();
  }

  // Find the top-level Zotero collection that groups every iTaukei-authored
  // sub-collection. Historically named 'iTaukei authors (>3 papers)' but Ron
  // has renamed it (e.g. '(>2 papers)'), so we match any top-level collection
  // whose name begins with 'iTaukei authors' — that's still the unambiguous
  // root in this Zotero group. Returns null if no such collection exists.
  function findItaukeiRootCollection(cols) {
    if (!Array.isArray(cols)) return null;
    return cols.find(c => !c.parent && /^iTaukei authors\b/i.test(String(c.name || ''))) || null;
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
    provinces: null,
    universities: null,
    graduateStudies: null,               // data/itaukei-graduate-studies.json
    mapScope: 'fiji',                    // 'fiji' | 'world' (Ron's 2nd tab set)
    worldView: 'study',                  // 'study' | 'publish'
    worldLayer: null,                    // Leaflet layer holding world-map markers
    mapView: 'all',                      // 'all' | 'lead' | 'coauth'
    typeSet: new Set(TYPE_ORDER),        // which types are shown in panels B, C, D
    // Panel C x-axis range — null means "use full data range" (default: All)
    histRange: { start: null, end: null, preset: 'all' },
    filter: {
      q: '',
      itemType: '',
      discipline: '',
      decade: '',
      province: '',
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
    provincesByItem:    new Map(),   // itemKey -> Set(province name)   (research-location view)
    paternalByItem:     new Map(),   // itemKey -> Set(province name)
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
    const [snap, geo, unis, provFlat, profiles, sync, grad, insightsDoc] = await Promise.all([
      fetchJson('data/itaukei-zotero-snapshot.json'),
      fetchJson('data/fiji-provinces.geojson'),
      fetchJson('data/world-universities.json'),
      fetchJson('data/fiji-provinces.json'),
      // Optional — enrichment file. Absence is fine (all cards will show placeholders).
      fetchJson('data/scholar-profiles.json').catch(() => ({ scholars: [] })),
      // Optional — heartbeat written by the GitHub Actions refresh workflow.
      // Absence is fine; badge falls back to snapshot.generatedAt.
      fetchJson('data/last-sync.json').catch(() => null),
      // Optional — iTaukei graduate-studies extracted from Zotero theses.
      // Absence is fine; the world-map tab just falls back to an empty state.
      fetchJson('data/itaukei-graduate-studies.json').catch(() => ({ scholars: {}, worldPoints: [] })),
      // Optional — pre-generated "Explain their research" insight cache.
      // Written by scripts/build_scholar_insights.py; regenerated whenever
      // the Zotero snapshot changes so keywords and summary stay in sync.
      fetchJson('data/scholar-insights.json').catch(() => ({ insights: {} }))
    ]);
    state.snapshot = snap;
    state.provinces = geo;
    state.universities = unis;
    state.lastSync = sync;
    state.graduateStudies = grad;
    state.scholarInsights = (insightsDoc && insightsDoc.insights) || {};

    // Name-variant aliases. Curated by the admin in the merge panel and pushed
    // via data/scholar-profiles.json. Keys are Zotero-creator variants and
    // values are the canonical author name. Applied when we scan creators so
    // publications authored under, say, "Tabunakawai, K." are folded into
    // "Tabunakawai, Kesaia" for pub counts and scholar-card totals.
    state.nameAliases = new Map(Object.entries((profiles && profiles.nameAliases) || {}));

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
    // Explicit hide-list — names the admin dashboard has removed from the iTaukei list.
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
    provFlat.provinces.forEach(p => state.provinceMetaByName.set(p.name, p));

    // Province collection key lookups
    geo.features.forEach(f => {
      const p = f.properties;
      if (p.zoteroCollectionKey_publicationLocation) state.provinceColKeyByName.location.set(p.name, p.zoteroCollectionKey_publicationLocation);
      if (p.zoteroCollectionKey_paternalProvince)    state.provinceColKeyByName.paternal.set(p.name, p.zoteroCollectionKey_paternalProvince);
    });

    // iTaukei collection keys (used to compute the "iTaukei author" badge).
    // We treat an item as iTaukei-authored if it sits in ANY of these trees:
    //   1. 'iTaukei authors (>N papers)' → direct child author sub-collections
    //   2. 'By or with iTaukei authors'
    //   3. 'iTaukei Thesis by Country/Universities' → country → university tree
    //      (this catches ~1000 iTaukei-graduate theses that don't have their own
    //      author sub-collection under the >N-papers root)
    // The trees are collected via a recursive descendant walk so nested
    // country/university sub-collections all resolve to iTaukei.
    const itaukeiParents = snap.collections.filter(c =>
      c.name === 'By or with iTaukei authors' || c.name.startsWith('iTaukei authors')
    );
    const itaukeiParentKeys = new Set(itaukeiParents.map(c => c.key));
    const authorRoot = findItaukeiRootCollection(snap.collections);
    if (authorRoot) {
      snap.collections.forEach(c => { if (c.parent === authorRoot.key) itaukeiParentKeys.add(c.key); });
    }
    const byWith = snap.collections.find(c => c.name === 'By or with iTaukei authors');
    if (byWith) itaukeiParentKeys.add(byWith.key);

    // Recursively add every descendant under the iTaukei Thesis tree.
    const thesisRoot = snap.collections.find(c => c.name === 'iTaukei Thesis by Country/Universities');
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
    // Build iTaukei last-name set from the scholar leaderboard ("Last, First" → "Last").
    // Used to identify iTaukei lead-authored items via first-creator surname match.
    const itaukeiLastNames = new Set();
    state.scholarKeyByName.forEach((_, fullName) => {
      const last = fullName.split(',')[0].trim().toLowerCase();
      if (last) itaukeiLastNames.add(last);
    });
    state.itaukeiLastNames = itaukeiLastNames;

    snap.items.forEach(it => {
      const disc = new Set();
      const provs = new Set();
      const paternal = new Set();
      const scholars = new Set();
      (it.collections || []).forEach(k => {
        const d = state.disciplineByColKey.get(k);
        if (d) disc.add(d);
        // province lookups
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

  // Match a Zotero creator string ("Ron Vave", "R. Vave", "Nabobo-Baba, Unaisi", etc.)
  // against the set of known iTaukei scholar surnames.
  function creatorIsItaukei(name) {
    if (!name) return false;
    const lastNames = state.itaukeiLastNames;
    if (!lastNames || !lastNames.size) return false;
    // Handle "Last, First" form
    let candidate = name;
    if (name.includes(',')) candidate = name.split(',')[0].trim();
    const cleaned = candidate.toLowerCase().replace(/[.]/g, '').trim();
    const tokens = cleaned.split(/\s+/);
    if (!tokens.length) return false;
    // Try last single token, last two joined, last two hyphenated
    if (lastNames.has(tokens[tokens.length - 1])) return true;
    if (tokens.length >= 2) {
      if (lastNames.has(tokens.slice(-2).join(' '))) return true;
      if (lastNames.has(tokens.slice(-2).join('-'))) return true;
    }
    return false;
  }

  // Classify item authorship w.r.t. iTaukei scholars
  //   returns 'lead'   — first-listed creator is iTaukei
  //           'coauth' — an iTaukei author is present but not first
  //           'none'   — no iTaukei author on the record
  function itaukeiAuthorship(item) {
    const creators = item.creators || [];
    if (creators.length && creatorIsItaukei(creators[0])) return 'lead';
    if (isItaukei(item)) return 'coauth';
    // Fall-back: creator-name match for items that are NOT in an iTaukei Zotero collection
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

  // Broad definition: item is "iTaukei-authored" if it belongs to any iTaukei
  // Zotero collection, OR any of its creators' surnames match a known iTaukei
  // scholar (this catches the ~21 items authored by iTaukei scholars that were
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
    renderPanelB();           // re-render bar chart to update active-province highlight
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
  //   2) iTaukei scholarship — statistics filtered to iTaukei-authored items and
  //                            iTaukei graduate research.
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

    // Fiji provinces studied — any province tagged on ≥1 publication.
    const provsStudied = new Set();
    state.provincesByItem.forEach(s => s.forEach(p => provsStudied.add(p)));

    // ---- iTaukei-scholarship counts ----
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

    // iTaukei graduate-study universities and countries — from the graduate
    // studies data (theses that appear in a scholar's iTaukei sub-collection).
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
    setText('[data-kpi="db-unis"]',      fmt(state.universities.totalUniversities));
    setText('[data-kpi="db-countries"]', fmt(state.universities.totalCountries));
    setText('[data-kpi="db-provinces"]', fmt(provsStudied.size));

    // iTaukei scholarship
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
    setText('[data-db-itaukei-count]', fmt(itWorks));

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

  // Dynamic paragraph + four insight blocks for the iTaukei narrative card.
  function renderTopNarrative(x) {
    const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;
    const bodyEl = document.querySelector('[data-narrative-body]');
    if (bodyEl) {
      // Contract the paragraph gracefully when counts are zero.
      const fmt = n => (typeof n === 'number') ? n.toLocaleString() : String(n);
      const parts = [];
      parts.push(`Of the ${fmt(x.totalWorks)} works currently indexed, ${fmt(x.itWorks)} include at least one identified iTaukei author.`);
      if (x.itWorks > 0) {
        parts.push(`Of these, ${fmt(x.itLed)} are led by an iTaukei first author, while ${fmt(x.itCoauth)} include an iTaukei scholar as a co-author.`);
      }
      if (x.itMasters + x.itPhd > 0) {
        parts.push(`The database documents ${fmt(x.itMasters)} Master\u2019s theses and ${fmt(x.itPhd)} PhD theses by iTaukei scholars, completed across ${fmt(x.gradUnis)} universities in ${fmt(x.gradCountries)} countries.`);
      }
      parts.push('This scholarship spans diverse fields and connects with communities across all 14 provinces of Fiji.');
      bodyEl.textContent = parts.join(' ');
    }
    const setText = (sel, txt) => { const n = document.querySelector(sel); if (n) n.textContent = txt; };
    setText('[data-insight="participation"]',
      `${pct(x.itWorks, x.totalWorks)}% of indexed works include at least one identified iTaukei author.`);
    setText('[data-insight="leadership"]',
      x.itWorks > 0
        ? `${pct(x.itLed, x.itWorks)}% of works involving iTaukei scholars are led by an iTaukei first author.`
        : 'No iTaukei-authored works have been indexed yet.');
    setText('[data-insight="grad"]',
      `iTaukei scholars completed ${x.itMasters} Master\u2019s and ${x.itPhd} PhD theses across ${x.gradUnis} universities.`);
    setText('[data-insight="geo"]',
      `iTaukei scholarship extends across ${x.gradCountries} countries and connects with all 14 provinces of Fiji.`);
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
      // Fullscreen toggle for the Fiji choropleth map. On expand we
      // re-fit to the province layer bounds so the map re-centers on
      // Fiji at the wider aspect ratio; on collapse we restore.
      wireMapFullscreen('[data-db-map-fiji-wrap]', '[data-db-map-fiji-fs-btn]', () => state.map, {
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

      // Panel A mapview toggle (Fiji sub-tabs)
      $$('[data-mapscope-panel="fiji"] button').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('[data-mapscope-panel="fiji"] button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.mapView = btn.dataset.mapview;
          renderPanelA();
        });
      });
      // Panel A2 world-view sub-tabs (Where iTaukei graduates study /
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

      // Initialise the standalone Panel A2 world map after Fiji is ready.
      // Wrapped in try/catch because the world map is a progressive
      // enhancement — Panel A1 must still work if this fails.
      try { initWorldMap(); } catch (e) { console.error('World map init failed', e); }

      // Bounds tuned to the crop in Ron's revision-notes screenshot: shows all
      // three confederacies (Viti Levu + Vanua Levu + Lau) without wasting
      // vertical whitespace above Vanua Levu or below Kadavu.
      // Tighter Fiji-focused framing (Ron's image-4 reference): Vanua Levu +
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

  // Province publication breakdown (Panel A choropleth + confederacy legend numbers).
  // Uses provinces-researched collection membership.
  function provinceBreakdown(items) {
    const geo = state.provinces;
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
            // Count unique iTaukei leaderboard scholars tied to this province
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
  // These are the YlOrRd-style ColorBrewer stops adjusted for Fiji imagery.
  function choroFill(n) {
    if (n === 0) return '#fff5eb';
    if (n <= 3) return '#fdd0a2';
    if (n <= 6) return '#fd8d3c';
    if (n <= 9) return '#e6550d';
    return '#a63603';
  }

  // ============ WORLD MAP (Ron's 2nd tab set) ============
  // Renders circle markers for universities where iTaukei scholars have
  // completed graduate studies. Size + colour indicate scholar counts.
  // Data comes from data/itaukei-graduate-studies.json (see refresh-graduate-studies.py).
  // -------- Right-hand panel for the World scope: countries → universities.
  // Aggregates worldPoints by country, sorts descending by total degrees, and
  // supports a drill-down into any country to reveal its universities. Clicks
  // are wired here; the map zoom is delegated to zoomToWorldCountry().
  function renderWorldPanel() {
    const listView   = document.querySelector('[data-world-list-view]');
    const detailView = document.querySelector('[data-world-detail-view]');
    const listHost   = document.querySelector('[data-world-country-list]');
    if (!listHost || !listView || !detailView) return;

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
          const groups = [
            { key: 'phd', label: 'PhD', cls: 'is-phd', names: uni.phdScholars },
            { key: 'masters', label: 'Masters', cls: 'is-masters', names: uni.mastersScholars },
            { key: 'other', label: 'Other', cls: 'is-other', names: uni.unknownScholars || [] }
          ];
          groups.forEach(g => {
            if (!g.names.length) return;
            const wrap = document.createElement('div');
            wrap.className = `db-scholar-group ${g.cls}`;
            wrap.innerHTML =
              `<h5>${g.label} (${g.names.length})</h5>` +
              renderScholarNameList(g.names);
            scholarsHost.appendChild(wrap);
          });
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
            counts.innerHTML =
              `<b>Masters</b> ${m} ` +
              `<span class="pipe"></span> <b>PhD</b> ${p}` +
              (k ? ` <span class="pipe"></span> <b>Other</b> ${k}` : '');
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'db-world-country-row__name';
      btn.textContent = c.name;
      btn.setAttribute('aria-label', 'Filter panels below by ' + c.name);
      btn.addEventListener('click', () => selectWorldCountry(c.name));
      row.appendChild(btn);
      const counts = document.createElement('span');
      counts.className = 'db-world-country-row__counts';
      counts.innerHTML =
        `<b>Masters</b> ${c.masters} ` +
        `<span class="pipe"></span> <b>PhD</b> ${c.phd} ` +
        `<span class="pipe"></span> <span class="db-world-total">Total ${c.total}</span>`;
      row.appendChild(counts);
      listHost.appendChild(row);
    });

    const narrEl = document.querySelector('[data-world-narrative]');
    if (narrEl) {
      const totM = countries.reduce((a, r) => a + r.masters, 0);
      const totP = countries.reduce((a, r) => a + r.phd, 0);
      const totU = countries.reduce((a, r) => a + (r.unknown || 0), 0);
      const totalDeg = totM + totP + totU;
      const otherClause = totU > 0 ? `, and ${totU} other higher-degree ${totU === 1 ? 'thesis' : 'theses'}` : '';
      narrEl.textContent = `iTaukei scholars completed ${totM} Master\u2019s and ${totP} PhD ` +
        `${(totM + totP) === 1 ? 'degree' : 'degrees'}${otherClause} across ${countries.length} ` +
        `${countries.length === 1 ? 'country' : 'countries'}.`;
    }
  }

  // -------- Panel B2 world-map default framing --------
  // Whole-world equator-centred framing (matches Ron's reference view).
  // Zoom 1 gives one world width of 512px; centre latitude 15° puts Europe/UK
  // near the top and NZ/Australia near the bottom without wasting polar space.
  const WORLD_MAP_DEFAULT_CENTER = [15, 30];
  const WORLD_MAP_DEFAULT_ZOOM = 1;

  // -------- World-filter helpers --------
  // When a country or university is clicked in Panel B2, we filter every
  // downstream data panel (B1, C1, C2, D, E, F, G) to only items authored by
  // iTaukei scholars whose graduate work took place in that country/uni.
  //
  // `worldFilteredScholarSet()` returns the Set of scholar names to keep, or
  // `null` when no filter is active. `worldFilterItems(items)` narrows an
  // item array using state.scholarByItem lookups. Item retained when any of
  // the item's tagged iTaukei scholars is in the active-scholar set.
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
    // Scholar-panel filter (name, keyword, sector, discipline, confederacy,
    // province, country/uni of study or work) also narrows Panel G below.
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
  function renderScholarNameList(names) {
    if (!names || !names.length) return '';
    const parts = names.map((n, i) => {
      const cls = (i % 2 === 0) ? 'is-blue' : 'is-dark';
      // data-scholar-name lets popup mouseover handlers look up the person's
      // thesis title + year and reveal the expanded detail slot.
      return `<span class="db-scholar-name ${cls}" data-scholar-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`;
    });
    return `<span class="db-scholar-list">${parts.join('<span class="db-scholar-sep">;</span>')}</span>`;
  }

  // Build the shared popup HTML for a worldPoint. Split into PhD / Masters /
  // Other sections, each with the blue/black alternating scholar list.
  function buildWorldPopupHtml(p) {
    const total = (p.phdScholars.length + p.mastersScholars.length + (p.unknownScholars || []).length);
    const color = total >= 5 ? '#7a1419' : total >= 3 ? '#c93e50' : total >= 2 ? '#e6550d' : '#fd8d3c';
    const sections = [];
    if (p.phdScholars.length) {
      sections.push(
        `<div class="db-popup-scholar-header is-phd">PhD (${p.phdScholars.length}):</div>` +
        renderScholarNameList(p.phdScholars)
      );
    }
    if (p.mastersScholars.length) {
      sections.push(
        `<div class="db-popup-scholar-header is-masters">Masters (${p.mastersScholars.length}):</div>` +
        renderScholarNameList(p.mastersScholars)
      );
    }
    if ((p.unknownScholars || []).length) {
      sections.push(
        `<div class="db-popup-scholar-header is-other">Other (${p.unknownScholars.length}):</div>` +
        renderScholarNameList(p.unknownScholars)
      );
    }
    // Detail slot appears between the header row and the scholar sections.
    // Populated dynamically by the mouseover handler when a name is hovered.
    // Scholar sections live inside a bounded, scrollable container so the
    // popup stays compact even for countries with hundreds of scholars
    // (Fiji, USP). The detail slot sits ABOVE the scroll container so it
    // remains visible regardless of scroll position.
    return (
      `<div class="db-popup-title">${escapeHtml(p.university)}</div>` +
      `<p class="db-popup-meta">${escapeHtml(p.country)}</p>` +
      `<p class="db-popup-meta" style="margin-top:6px;"><span class="db-popup-count" style="font-size:1.5rem;color:${color};">${total}</span> iTaukei scholar${total === 1 ? '' : 's'} completed graduate work here</p>` +
      `<div class="db-popup-scholar-detail" data-popup-detail></div>` +
      `<div class="db-popup-scroll">` + sections.join('') + `</div>`
    );
  }

  // Look up a scholar's thesis metadata by name. Returns { title, year, level }
  // for the record that matches the world-map point's university/country when
  // possible, so hovering "Ron Vave" in the University of Hawaii popup shows
  // his UH PhD, not (say) his USP Masters. Falls back to the first record if
  // no exact match is found.
  function lookupScholarThesisForPoint(name, point) {
    const grad = state.graduateStudies;
    if (!grad || !grad.scholars) return null;
    const rec = grad.scholars[name];
    if (!rec) return null;
    // Prefer records whose university matches this point.
    if (rec.all && point) {
      const match = rec.all.find(t => t.university === point.university && t.country === point.country);
      if (match) return match;
    }
    return rec.phd || rec.masters || (rec.all && rec.all[0]) || null;
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
        const rec = lookupScholarThesisForPoint(nm, point);
        if (!rec) {
          detail.classList.remove('is-active');
          detail.innerHTML = '';
          return;
        }
        const title = rec.title || '(untitled)';
        const year = rec.year || '';
        const level = (rec.level === 'phd') ? 'PhD' : (rec.level === 'masters') ? "Master's" : 'Thesis';
        detail.innerHTML =
          `<div class="db-popup-scholar-detail__name">${escapeHtml(nm)} · ${level}${year ? ' · <span class="db-popup-scholar-detail__year">' + year + '</span>' : ''}</div>` +
          `<div class="db-popup-scholar-detail__thesis">${escapeHtml(title)}</div>`;
        detail.classList.add('is-active');
      });
      nameEl.addEventListener('mouseleave', () => {
        detail.classList.remove('is-active');
        detail.innerHTML = '';
      });
    });
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
  // for tall Fiji popups; or the right, when the marker sits near the
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

  function zoomToWorldCountry(name) {
    const grad = state.graduateStudies || { worldPoints: [] };
    const pts = (grad.worldPoints || []).filter(p => p.country === name);
    if (!pts.length || !state.worldMap) return;
    // Use the points' native longitudes now that the whole-world view is
    // equator-centred rather than Pacific-centric.
    const latlngs = pts.map(p => [p.lat, p.lng]);
    if (latlngs.length === 1) {
      state.worldMap.setView(latlngs[0], 5, { animate: true });
    } else {
      const bounds = L.latLngBounds(latlngs);
      state.worldMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 6, animate: true });
    }
  }
  function zoomToWorldUniversity(uniName) {
    const grad = state.graduateStudies || { worldPoints: [] };
    const p = (grad.worldPoints || []).find(x => x.university === uniName);
    if (!p || !state.worldMap) return;
    state.worldMap.setView([p.lat, p.lng], 8, { animate: true });
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
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        state.worldSearchTerm = '';
        searchClear.style.display = 'none';
        renderWorldPanel();
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
  // the Fiji choropleth. Uses the same Esri World Imagery basemap.
  function initWorldMap() {
    const el = document.getElementById('db-map-world');
    if (!el || typeof L === 'undefined') return;
    // maxBounds is padded ~30° east/west of the true world edges so Leaflet's
    // autoPan (used to keep large popups in view for Fiji, NZ, USA-west, etc.)
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
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      attribution: 'Imagery &copy; Google',
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 20
    }).addTo(wmap);
    wmap.setView(WORLD_MAP_DEFAULT_CENTER, WORLD_MAP_DEFAULT_ZOOM);
    state.worldMap = wmap;
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
    // slicing Fiji. We also re-render the marker layer with duplicate
    // copies at ±360° longitude so dots appear in every world copy.
    wireMapFullscreen('[data-db-map-world-wrap]', '[data-db-map-fs-btn]', () => state.worldMap, {
      onOpen: () => {
        const m = state.worldMap; if (!m) return;
        state.worldMapPrevView = { center: m.getCenter(), zoom: m.getZoom() };
        // Remove the boxed-world constraints so tiles wrap seamlessly
        // across the antimeridian. Google's tile server returns tiles
        // for any x (wrapping modulo the world width), so with the
        // Leaflet tileLayer default (noWrap:false) the map repeats.
        m.setMaxBounds(null);
        m.options.worldCopyJump = true;
        state.worldMapFullscreen = true;
        // Re-render markers so each point has copies in the adjacent
        // world panels (-360, 0, +360). Without this, dragging past
        // the antimeridian would show blank continents.
        renderWorldMap();
        // Frame the useful latitude band (~55S to 60N) centered on the
        // Pacific so Fiji sits mid-screen. Leaflet's fitBounds picks a
        // zoom that makes this rectangle fill the container; because
        // we widened the viewport to 16:9, the resulting view fills
        // the screen with no empty backdrop.
        m.fitBounds([[-55, 60], [60, 260]], { animate: false, padding: [0, 0] });
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
  }

  const MAP_FS_EXPAND_SVG = '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>';
  const MAP_FS_COLLAPSE_SVG = '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>';

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

  function renderWorldMap() {
    if (!state.worldMap) return;
    if (state.worldLayer) { state.worldMap.removeLayer(state.worldLayer); state.worldLayer = null; }

    const grad = state.graduateStudies || { worldPoints: [] };
    const points = grad.worldPoints || [];

    if (state.worldView === 'publish') {
      // Placeholder — publication-country tagging is a follow-up feature.
      state.worldLayer = L.layerGroup([]).addTo(state.worldMap);
      state.worldMap.setView([15, 20], 2);
      return;
    }

    // Where iTaukei graduates study.
    // Inline view: single-copy world (no tile wrap). Markers plotted once at
    // their real coordinates, then auto-framed to marker bounds below.
    // Fullscreen view: tiles wrap seamlessly, so we plot each marker three
    // times — at lng-360, lng, lng+360 — so dragging across the antimeridian
    // shows dots on every visible world copy.
    const isFs = !!state.worldMapFullscreen;
    const lngOffsets = isFs ? [-360, 0, 360] : [0];
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
      // viewport — critical for Fiji/NZ markers that sit near the right edge
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

      lngOffsets.forEach(dx => {
        const m = L.circleMarker([p.lat, p.lng + dx], {
          radius, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.85
        });
        m.bindPopup(popupHtml, popupOpts);
        m.on('mouseover', () => m.openPopup());
        m.on('popupopen', (evt) => {
          const el = evt.popup && evt.popup.getElement && evt.popup.getElement();
          wirePopupScholarHovers(el, p);
          wirePopupAutoClose(el, evt.popup, m);
          // Give autoPan a beat, then verify the popup is fully inside the map
          // viewport. If it isn't (common for Fiji's huge popups near the map
          // edges), pan the map manually so the popup sits comfortably.
          setTimeout(() => nudgePopupIntoView(el, state.worldMap), 40);
        });
        markers.push(m);
        if (dx === 0) latlngs.push([p.lat, p.lng]);
      });
    });

    state.worldLayer = L.layerGroup(markers).addTo(state.worldMap);

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

  function renderChoropleth() {
    if (!state.map) return;
    if (state.provinceLayer) state.map.removeLayer(state.provinceLayer);
    const geo = state.provinces;
    const filteredItems = itemsForMapView();
    const counts = provinceBreakdown(filteredItems);
    state.provinceLayer = L.geoJSON(geo, {
      style: (feature) => {
        const n = (counts.get(feature.properties.name) || { total: 0 }).total;
        return {
          fillColor: choroFill(n),
          fillOpacity: 0.92,
          color: CONF_COLORS[feature.properties.confederacy] || '#333',
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
    state.filter.province = state.filter.province === name ? '' : name;
    state.filter.paternal = '';
    state.shown = state.pageSize;
    afterFilterChange();
  }

  function filterAndScrollToProvince(name) {
    // Always SETS (does not toggle) — used by the popup pill
    state.filter.province = name;
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
    const name = link.getAttribute('data-province');
    if (!name) return;
    if (state.map) state.map.closePopup();
    filterAndScrollToProvince(name);
  });

  function makeProvincePopup(p, b) {
    const viewLabel = state.mapView === 'lead'
      ? 'iTaukei lead-authored'
      : (state.mapView === 'coauth' ? 'Co-authored with iTaukei' : 'All publications on');
    const rows = [];
    const push = (n, lbl) => { if (n > 0) rows.push(`<tr><td style="padding:2px 8px 2px 0;font-variant-numeric:tabular-nums;font-weight:700;color:${CONF_COLORS[p.confederacy]}">${n}</td><td style="padding:2px 0;color:#4b5563;">${lbl}</td></tr>`); };
    push(b.journalArticle,  b.journalArticle === 1 ? 'Journal Article' : 'Journal Articles');
    push(b.thesisPhd,       b.thesisPhd === 1 ? 'PhD Thesis' : 'PhD Theses');
    push(b.thesisMasters,   b.thesisMasters === 1 ? 'Masters Thesis' : 'Masters Theses');
    push(b.bookSection,     b.bookSection === 1 ? 'Book Chapter' : 'Book Chapters');
    push(b.book,            b.book === 1 ? 'Book' : 'Books');
    push(b.conferencePaper, b.conferencePaper === 1 ? 'Conference Paper' : 'Conference Papers');
    push(b.report,          b.report === 1 ? 'Report' : 'Reports');
    push(b.preprint,        b.preprint === 1 ? 'Preprint' : 'Preprints');
    const rowsHtml = rows.length ? `<table style="border-collapse:collapse;margin-top:6px;">${rows.join('')}</table>` : '<p class="db-popup-meta" style="opacity:0.6;">No items in this view</p>';
    const scholarLine = b.scholars > 0
      ? `<p class="db-popup-meta" style="margin-top:8px;padding-top:6px;border-top:1px dashed #cbd5e1;"><span style="font-weight:700;color:${CONF_COLORS[p.confederacy]};font-variant-numeric:tabular-nums;">${b.scholars}</span> iTaukei scholar${b.scholars === 1 ? '' : 's'} on this map</p>`
      : '';
    // The filter link needs data-province so a delegated click handler can
    // pick it up — Leaflet re-renders popups on every open, so inline
    // onclick / direct listeners on this node don't survive.
    return `
      <div class="db-popup-title">${p.name} Province</div>
      <p class="db-popup-meta">${p.confederacy} Confederacy &middot; ${p.mainArea}</p>
      <p class="db-popup-meta" style="margin-top:6px;"><span class="db-popup-count" style="font-size:1.5rem;">${b.total}</span> ${viewLabel} ${p.name}</p>
      ${rowsHtml}
      ${scholarLine}
      <p style="margin:8px 0 0;"><a href="#" class="db-popup-filter-link" data-province="${p.name}" style="display:inline-block;font-size:0.82rem;color:#fff;background:#0e7490;padding:5px 10px;border-radius:999px;text-decoration:none;font-weight:600;">Filter items below ↓</a></p>
    `;
  }

  // ============ PANEL A — map + legend + confederacy tallies + sync ============
  function renderPanelA() {
    renderChoropleth();

    const items = state.snapshot.items;
    const provOfItem = state.provincesByItem;

    // Confederacy tallies. For each confederacy we track three counts:
    //   total    — all Fiji-focused publications (province-tagged), regardless of authorship
    //   itaukei  — strictly iTaukei-lead-authored items (first creator is iTaukei)
    //   coauth   — iTaukei co-authored items (any iTaukei author present, not first)
    // These feed both the two-line legend rows and the dynamic sidebar narrative.
    const byConf = {
      Burebasaga: { total:0, itaukei:0, coauth:0 },
      Kubuna:     { total:0, itaukei:0, coauth:0 },
      Tovata:     { total:0, itaukei:0, coauth:0 }
    };
    const confByProv = new Map();
    state.provinces.features.forEach(f => confByProv.set(f.properties.name, f.properties.confederacy));
    items.forEach(it => {
      const provs = provOfItem.get(it.key);
      if (!provs || !provs.size) return;
      const role = itaukeiAuthorship(it);
      provs.forEach(p => {
        const c = confByProv.get(p);
        if (!c || !byConf[c]) return;
        byConf[c].total  += 1;
        if (role === 'lead')   byConf[c].itaukei += 1;
        if (role === 'coauth') byConf[c].coauth  += 1;
      });
    });

    // Dynamic map legend title — reflects the currently-selected Panel A sub-tab.
    const legendTitles = {
      all:    'All Fiji-focused publications by study province',
      lead:   'iTaukei-led publications by study province',
      coauth: 'Publications co-authored with iTaukei scholars by study province'
    };
    const legendTitleEl = $('[data-db-map-legend-title]');
    if (legendTitleEl) legendTitleEl.textContent = legendTitles[state.mapView] || legendTitles.all;

    // Dynamic explanation sentence for the confederacy summary.
    const explainSentences = {
      all:    'All Fiji-focused publications, grouped by the confederacy of the province studied.',
      lead:   'Publications led by an iTaukei first author, grouped by the confederacy of the province studied.',
      coauth: 'Publications co-authored with iTaukei scholars, grouped by the confederacy of the province studied.'
    };
    const explainEl = $('[data-db-conf-explain]');
    if (explainEl) explainEl.textContent = explainSentences[state.mapView] || explainSentences.all;

    // Populate the two-line confederacy rows. The primary number always reflects
    // ALL Fiji-focused publications for that confederacy (so the reader gets a
    // stable point of reference). The secondary line adapts to the active
    // sub-tab so it complements what the map is currently showing.
    Object.keys(byConf).forEach(name => {
      const t = byConf[name].total;
      const k = byConf[name].itaukei;
      const co = byConf[name].coauth;
      const totalEl = document.querySelector(`[data-conf-total="${name}"]`);
      const subEl   = document.querySelector(`[data-conf-sub="${name}"]`);
      if (totalEl) totalEl.textContent = t.toLocaleString();
      if (subEl) {
        let secondary;
        if (state.mapView === 'lead') {
          secondary = `${k} iTaukei-led · ${co} co-authored`;
        } else if (state.mapView === 'coauth') {
          secondary = `${co} co-authored with iTaukei · ${k} iTaukei-led`;
        } else {
          secondary = `${k} iTaukei-led publication${k === 1 ? '' : 's'}`;
        }
        subEl.textContent = secondary;
      }
    });

    // Dynamic narrative sentence beneath the confederacy rows. Ranks the three
    // confederacies by total and reports the total iTaukei-led count.
    const narrativeEl = $('[data-db-conf-narrative]');
    if (narrativeEl) {
      const ranked = Object.keys(byConf)
        .map(n => ({ name: n, total: byConf[n].total, led: byConf[n].itaukei, coauth: byConf[n].coauth }))
        .sort((a, b) => b.total - a.total);
      const totalLed    = ranked.reduce((a, r) => a + r.led, 0);
      const totalCoauth = ranked.reduce((a, r) => a + r.coauth, 0);
      const [a, b, c] = ranked;
      let s = `Fiji-focused publications are most concentrated in ${a.name} (${a.total.toLocaleString()}), followed by ${b.name} (${b.total.toLocaleString()}) and ${c.name} (${c.total.toLocaleString()}). `;
      if (state.mapView === 'coauth') {
        s += `Of these, ${totalCoauth.toLocaleString()} include an iTaukei scholar as a co-author.`;
      } else if (state.mapView === 'lead') {
        s += `Of these, ${totalLed.toLocaleString()} are led by an iTaukei first author.`;
      } else {
        s += `Of these, ${totalLed.toLocaleString()} are led by an iTaukei first author.`;
      }
      narrativeEl.textContent = s;
    }

    // Non-Fiji publications by iTaukei authors: iTaukei items with NO province tag
    let nonFiji = 0;
    items.forEach(it => {
      if (!isItaukei(it)) return;
      const p = provOfItem.get(it.key);
      if (!p || !p.size) nonFiji += 1;
    });
    const nfEl = $('[data-db-nonfiji]');
    if (nfEl) nfEl.textContent = nonFiji;

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
    // Reuses B2's authorship rendering (single stacked bar per province,
    // segmented by iTaukei first / co-author / no iTaukei identified).
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
      if (groupedLabel) groupedLabel.textContent = 'Study province · iTaukei authorship role';
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
    if (groupedLabel) groupedLabel.textContent = 'Study province';

    host.innerHTML = '';
    const provs = state.provinces.features.map(f => f.properties);
    const byProv = new Map();
    provs.forEach(p => {
      byProv.set(p.name, {
        conf: p.confederacy,
        total: 0,
        types: {}
      });
    });
    // Panel B1 authors filter — defaults to iTaukei-only. Toggled via the
    // Authors dropdown in the meta row (see wirePanelB1).
    const authorsMode = state.b1Authors || 'itaukei';
    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.typeSet.has(vt)) return;
      if (authorsMode === 'itaukei' && !isItaukei(it)) return;
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
      if (state.filter.province === r.name) label.classList.add('is-active');
      label.title = `${r.conf} Confederacy`;
      label.innerHTML = `<span>${r.name}</span><span class="db-bars__prov-dot" style="background:${CONF_COLORS[r.conf]};"></span>`;
      label.addEventListener('click', () => {
        state.filter.province = state.filter.province === r.name ? '' : r.name;
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
        state.filter.province = state.filter.province === r.name ? '' : r.name;
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

    // ============ Non-provincial/Fiji bottom bar ============
    // Aggregates publications that ARE about Fiji broadly (title mentions Fiji /
    // Fijian / iTaukei) but have no specific province tag — e.g. "Fiji national
    // legislation", "Fiji mental health policy", national-scale studies.
    //
    // Rendering differs from the province bars in three key ways:
    //   1. Anchored at the bottom regardless of ranking.
    //   2. The bar is always drawn at 100% width of the longest visible province
    //      bar (not scaled to its own raw count).
    //   3. Segments are % share of the category's own total — unchecking a type
    //      re-normalises the remaining segments back to 100%.
    // No confederacy dot on the label; an "i" tooltip explains the category.
    const nonProv = { total: 0, types: {} };
    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.typeSet.has(vt)) return;
      if (authorsMode === 'itaukei' && !isItaukei(it)) return;
      const ps = state.provincesByItem.get(it.key);
      if (ps && ps.size > 0) return; // has province tag — already counted above
      // Require an explicit Fiji signal so we don't sweep in unrelated diaspora
      // or Pacific-broad papers by iTaukei authors.
      const hay = String(it.title || '');
      if (!/\bfiji\b|\bfijian\b|\bitaukei\b|\bi-taukei\b/i.test(hay)) return;
      nonProv.total += 1;
      nonProv.types[vt] = (nonProv.types[vt] || 0) + 1;
    });

    if (nonProv.total > 0) {
      // Column 1 — label + info icon (no confederacy dot).
      const npLabel = document.createElement('div');
      npLabel.className = 'db-bars__prov db-bars__prov--nonprov';
      const tipText = 'Publications about Fiji broadly or national-level topics '
                    + '\u2014 such as legislation, policy, or nationwide studies '
                    + '\u2014 that are not tied to a specific province.';
      npLabel.innerHTML = `<span>Non-provincial/Fiji</span>`
        + `<span class="db-bars__info" tabindex="0" role="button" aria-label="About Non-provincial/Fiji" title="${escapeAttr(tipText)}">i</span>`;
      host.appendChild(npLabel);

      // Column 2 — bar at 100% width, percentage-normalised segments.
      const rowWrap = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'db-bars__row db-bars__row--nonprov';
      row.style.width = '100%';
      row.style.background = 'transparent';
      row.style.boxShadow = `inset 0 0 0 1.5px rgba(0,0,0,0.06)`;
      row.title = `Non-provincial/Fiji \u00b7 ${nonProv.total} items`;
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

      // Column 3 — total count on the right, same style as province rows.
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

  // ============ PANEL D — confederacy small multiples ============
  function renderPanelD() {
    const host = $('[data-db-conf-grid]');
    if (!host) return;
    host.innerHTML = '';
    const confs = ['Burebasaga','Kubuna','Tovata'];
    const provs = state.provinces.features.map(f => f.properties);
    const perProvTotal = new Map();
    provs.forEach(p => perProvTotal.set(p.name, 0));
    state.snapshot.items.forEach(it => {
      if (!state.typeSet.has(visualType(it))) return;
      const ps = state.provincesByItem.get(it.key);
      if (!ps) return;
      ps.forEach(name => perProvTotal.set(name, (perProvTotal.get(name)||0) + 1));
    });
    confs.forEach(cf => {
      const provInCf = provs.filter(p => p.confederacy === cf)
        .map(p => ({ name: p.name, total: perProvTotal.get(p.name) || 0 }))
        .sort((a,b) => b.total - a.total);
      const sub = provInCf.reduce((a,p) => a + p.total, 0);
      const max = Math.max(1, ...provInCf.map(p => p.total));
      const panel = document.createElement('div');
      panel.className = 'db-conf-panel';
      panel.innerHTML = `
        <div class="db-conf-panel__head">
          <p class="db-conf-panel__name">${cf}</p>
          <p class="db-conf-panel__total">${sub}</p>
        </div>
        <div class="db-conf-panel__stripe" style="background:${CONF_COLORS[cf]};"></div>
        <div class="db-conf-panel__provs"></div>
        <p class="db-conf-panel__foot">${provInCf.length} provinces · ${sub} publications</p>
      `;
      const inner = panel.querySelector('.db-conf-panel__provs');
      provInCf.forEach(p => {
        const row = document.createElement('div');
        row.className = 'db-conf-mini';
        row.innerHTML = `
          <span class="db-conf-mini__name" data-prov="${escapeAttr(p.name)}">${p.name}</span>
          <span class="db-conf-mini__bar"><span class="db-conf-mini__fill" style="width:${(p.total/max)*100}%;background:${CONF_COLORS[cf]};"></span></span>
          <span class="db-conf-mini__n">${p.total}</span>
        `;
        row.querySelector('.db-conf-mini__name').addEventListener('click', () => {
          state.filter.province = state.filter.province === p.name ? '' : p.name;
          state.filter.paternal = '';
          state.shown = state.pageSize;
          afterFilterChange();
        });
        inner.appendChild(row);
      });
      host.appendChild(panel);
    });
  }

  // ============ Type-filter checkbox wiring ============
  // Panel B1 title dropdown: switches the ranked-bar chart between iTaukei
  // authors (default) and all authors. Keeps the meta pill in sync.
  function wirePanelB1() {
    const sel = document.querySelector('[data-b1-authors]');
    if (sel) {
      sel.value = state.b1Authors || 'itaukei';
      sel.addEventListener('change', () => {
        state.b1Authors = sel.value === 'all' ? 'all' : 'itaukei';
        renderPanelB();
      });
    }
    // Panel B1 has two mutually exclusive views:
    //   "type"       — the default publication-type stacked bar
    //   "authorship" — reuses the visualization that used to live in B2's
    //                  Authorship tab (iTaukei first / co-author / no iTaukei
    //                  identified per province).
    // The dropdown 'Authors: iTaukei / All' is meaningful only in the type
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
      renderPanelD();
      renderHistogram();
    };
    visibleBoxes.forEach(b => b.addEventListener('change', syncChecked));
    const allBtn = host.querySelector('[data-db-type-all]');
    const noneBtn = host.querySelector('[data-db-type-none]');
    if (allBtn)  allBtn.addEventListener('click',  () => { visibleBoxes.forEach(b => b.checked = true);  syncChecked(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { visibleBoxes.forEach(b => b.checked = false); syncChecked(); });
    syncChecked();
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

  // ============ STACKED-BY-TYPE YEAR HISTOGRAM (Panel C) ============
  // Bars per year, stacked bottom-up by item type. Reflects Panel B checkboxes.
  // The x-axis window is controlled by state.histRange (start/end year).
  function renderHistogram() {
    const items = state.snapshot.items;

    // Aggregate: year -> { itemType: n } and keep list of years present in data
    const perYear = new Map();
    const yearsAll = [];
    items.forEach(it => {
      if (!it.year) return;
      yearsAll.push(it.year);
      const vt = visualType(it);
      if (!state.typeSet.has(vt)) return;
      let bucket = perYear.get(it.year);
      if (!bucket) { bucket = {}; perYear.set(it.year, bucket); }
      bucket[vt] = (bucket[vt] || 0) + 1;
    });

    // Keep decade dropdown populated for the item-list filter
    if (yearsAll.length) populateDecadeSelect(Math.min(...yearsAll), Math.max(...yearsAll));

    const svg = $('#db-source-histogram');
    if (!svg) return;
    svg.innerHTML = '';

    // Which item types are enabled AND actually appear in the data
    const typesInData = new Set(items.map(i => visualType(i)));
    const visibleTypes = TYPE_ORDER.filter(t => state.typeSet.has(t) && typesInData.has(t));

    if (!visibleTypes.length || !perYear.size) {
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', 450); t.setAttribute('y', 170);
      t.setAttribute('text-anchor','middle'); t.setAttribute('font-family','DM Sans');
      t.setAttribute('font-size','15'); t.setAttribute('fill','#6b7280');
      t.textContent = 'No item types selected — check at least one in panel B.';
      svg.appendChild(t);
      return;
    }

    // Layout constants
    const W = 900, H = 340;
    const PAD_LEFT = 44, PAD_RIGHT = 20, PAD_TOP = 44, PAD_BOTTOM = 46;
    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOTTOM;

    // Data range (full)
    const dataMin = Math.min(...yearsAll);
    const dataMax = Math.max(...yearsAll);

    // Apply the user-selected window. Clamp to data range so out-of-band values are ignored.
    let yMin = state.histRange.start != null ? state.histRange.start : dataMin;
    let yMax = state.histRange.end   != null ? state.histRange.end   : dataMax;
    if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
    yMin = Math.max(dataMin, Math.min(dataMax, yMin));
    yMax = Math.max(dataMin, Math.min(dataMax, yMax));

    // Sync the input boxes to the resolved range (in case caller passed nulls
    // or preset changed the range).
    const startEl = $('[data-hist-start]');
    const endEl   = $('[data-hist-end]');
    if (startEl) {
      startEl.min = dataMin; startEl.max = dataMax;
      if (document.activeElement !== startEl) startEl.value = yMin;
    }
    if (endEl) {
      endEl.min = dataMin; endEl.max = dataMax;
      if (document.activeElement !== endEl) endEl.value = yMax;
    }

    const yearCount = yMax - yMin + 1;
    // Bars widen or narrow to fill the plot width equally at all zoom levels.
    const bandW = plotW / yearCount;
    const barW = Math.max(1.5, Math.min(40, bandW * 0.78));
    const bandGap = (bandW - barW) / 2;

    // Y scale: max stacked total in any single year WITHIN THE VISIBLE WINDOW.
    // Recomputing here means the y-axis tightens automatically when the user
    // zooms into a narrower time range.
    let maxStack = 0;
    perYear.forEach((b, yr) => {
      if (yr < yMin || yr > yMax) return;
      const total = visibleTypes.reduce((a,t) => a + (b[t] || 0), 0);
      if (total > maxStack) maxStack = total;
    });
    if (maxStack === 0) maxStack = 1;
    // Nice round tick above maxStack
    const niceMax = niceCeil(maxStack);

    const yScale = n => plotH * (n / niceMax);
    const yZero = PAD_TOP + plotH; // bottom of plot

    // Legend inside the SVG so the caption sits directly over the chart
    const legendY = PAD_TOP - 26;
    let legendX = PAD_LEFT;
    visibleTypes.forEach(t => {
      const sw = document.createElementNS('http://www.w3.org/2000/svg','rect');
      sw.setAttribute('x', legendX);
      sw.setAttribute('y', legendY);
      sw.setAttribute('width', 12); sw.setAttribute('height', 12);
      sw.setAttribute('rx', 2);
      sw.setAttribute('fill', TYPE_COLOR[t]);
      svg.appendChild(sw);
      const lbl = document.createElementNS('http://www.w3.org/2000/svg','text');
      lbl.setAttribute('x', legendX + 17);
      lbl.setAttribute('y', legendY + 10);
      lbl.setAttribute('font-family','DM Sans');
      lbl.setAttribute('font-size','12');
      lbl.setAttribute('fill','#1a1a1a');
      lbl.textContent = TYPE_LABELS[t] || t;
      svg.appendChild(lbl);
      legendX += 17 + measureTextWidth(TYPE_LABELS[t] || t, 12) + 20;
    });

    // Gridlines + Y axis ticks (0, niceMax/2, niceMax)
    const ticks = [0, niceMax / 2, niceMax];
    ticks.forEach(v => {
      const y = yZero - yScale(v);
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', PAD_LEFT); line.setAttribute('x2', W - PAD_RIGHT);
      line.setAttribute('y1', y);        line.setAttribute('y2', y);
      line.setAttribute('stroke', '#d1d5db');
      line.setAttribute('stroke-dasharray', v === 0 ? '0' : '2 3');
      line.setAttribute('stroke-width', v === 0 ? '1' : '0.7');
      svg.appendChild(line);
      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x', PAD_LEFT - 6);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-family','DM Sans');
      label.setAttribute('font-size','10');
      label.setAttribute('fill','#6b7280');
      label.textContent = Number.isInteger(v) ? String(v) : v.toFixed(1);
      svg.appendChild(label);
    });

    // Stacked bars per year (only within the visible window)
    for (let year = yMin; year <= yMax; year++) {
      const bucket = perYear.get(year);
      if (!bucket) continue;
      const xLeft = PAD_LEFT + (year - yMin) * bandW + bandGap;
      let stackTop = 0; // running total from bottom up
      visibleTypes.forEach(t => {
        const n = bucket[t] || 0;
        if (n === 0) return;
        const h = yScale(n);
        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x', xLeft);
        rect.setAttribute('y', yZero - yScale(stackTop) - h);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', h);
        rect.setAttribute('fill', TYPE_COLOR[t]);
        rect.style.cursor = 'pointer';
        const total = visibleTypes.reduce((a,tt) => a + (bucket[tt] || 0), 0);
        const parts = visibleTypes.filter(tt => (bucket[tt] || 0) > 0)
          .map(tt => `${bucket[tt]} × ${TYPE_LABELS[tt] || tt}`).join(', ');
        const ttl = document.createElementNS('http://www.w3.org/2000/svg','title');
        ttl.textContent = `${year} · ${total} publication${total===1?'':'s'} (${parts})`;
        rect.appendChild(ttl);
        rect.addEventListener('click', () => {
          state.filter.year = state.filter.year === year ? '' : year;
          state.shown = state.pageSize;
          afterFilterChange();
        });
        svg.appendChild(rect);
        stackTop += n;
      });
    }

    // X-axis year labels — tick interval adapts to visible window
    const span = yMax - yMin + 1;
    let tickStep;
    if (span <= 8)       tickStep = 1;
    else if (span <= 20) tickStep = 2;
    else if (span <= 40) tickStep = 5;
    else                 tickStep = 10;
    const firstTick = Math.ceil(yMin / tickStep) * tickStep;
    for (let year = firstTick; year <= yMax; year += tickStep) {
      const x = PAD_LEFT + (year - yMin) * bandW + bandW / 2;
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', x);
      txt.setAttribute('y', H - PAD_BOTTOM + 20);
      txt.setAttribute('text-anchor','middle');
      txt.setAttribute('font-family','DM Sans');
      txt.setAttribute('font-size','12');
      txt.setAttribute('fill','#6b7280');
      txt.textContent = year;
      svg.appendChild(txt);
      // Tick mark
      const tick = document.createElementNS('http://www.w3.org/2000/svg','line');
      tick.setAttribute('x1', x); tick.setAttribute('x2', x);
      tick.setAttribute('y1', yZero); tick.setAttribute('y2', yZero + 4);
      tick.setAttribute('stroke', '#9ca3af');
      svg.appendChild(tick);
    }

    // Reflect active preset button (if any) in the controls row
    $$('[data-hist-presets] button').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.preset === state.histRange.preset);
    });
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

    // Reset link
    const resetBtn = $('[data-hist-reset]');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      state.histRange = { start: null, end: null, preset: 'all' };
      renderHistogram();
    });
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
  state.scholarConfFilter = '';  // '', '__untagged__', 'Burebasaga', 'Kubuna', 'Tovata'
  state.scholarProvFilter = '';  // '', '__untagged__', or a province name
  state.scholarNameSearch = '';  // free-text name search (case-insensitive substring)
  state.scholarKeywordSearch = ''; // research-keyword search across insights + publications
  state.scholarSectorFilter = ''; // '' or one of SECTORS
  state.scholarDisciplineFilter = new Set();  // AND across checked disciplines
  state.scholarStudyCountry = '';  // country selected in the Study combo
  state.scholarStudyUni = '';      // optional narrower selection within that country
  state.scholarWorkCountry = '';   // country selected in the Work combo
  state.scholarWorkUni = '';       // optional narrower selection within that country
  // Cache: scholar name → Set<discipline>. Populated lazily on first renderLeaders.
  state.scholarDisciplines = null;

  // Placeholder silhouette shown when no photo is provided
  const PHOTO_PLACEHOLDER_SVG = `
    <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="50" cy="40" r="22" fill="#b6bcc2"/>
      <path d="M12 120 C 12 85, 88 85, 88 120 Z" fill="#b6bcc2"/>
    </svg>`;

  // Province groupings per confederacy — used to rebuild the province dropdown
  // when the confederacy dropdown changes.
  // The 14 Fijian provinces grouped by chiefly confederacy.
  // Sourced from fiji-provinces.geojson (each feature has a `confederacy`
  // property). Ra is part of Kubuna — previously missed.
  const CONFEDERACY_PROVINCES = {
    Burebasaga: ['Kadavu', 'Nadroga/Navosa', 'Namosi', 'Rewa', 'Serua'],
    Kubuna:     ['Ba', 'Lomaiviti', 'Naitasiri', 'Ra', 'Tailevu'],
    Tovata:     ['Bua', 'Cakaudrove', 'Lau', 'Macuata']
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
    ['Indigenous Knowledge & Culture',     /(vanua|itaukei|i[- ]?taukei|indigenous knowledge|indigenous fijian|traditional (knowledge|practice|ecological|resource|medicine)|customary|storytelling|oral tradition|indigenous educ|indigenous methodolog|decolonis|decoloniz|cultural (identity|value|belief|loss|practice)|marama|fijian ethos|fijian way|bula vakavanua|funeral|funerary|kava (drink|circle|ceremonial))/i],
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

  // Set of scholar names whose card is currently visible under the confederacy/
  // province dropdowns at the top of the leaderboard. Also used by the item
  // list at the bottom so "filter to Ra" narrows both the cards AND the
  // publications shown below.
  state.scholarFilterNames = null; // null = no dropdown filter active

  function computeScholarFilterNames() {
    const conf = state.scholarConfFilter;
    const prov = state.scholarProvFilter;
    if (!conf && !prov) { state.scholarFilterNames = null; return; }

    const provConf = new Map();
    if (state.provinces && state.provinces.features) {
      state.provinces.features.forEach(f => provConf.set(f.properties.name, f.properties.confederacy));
    }

    const names = new Set();
    (state.scholarProfilesByName || new Map()).forEach((profile, name) => {
      const p = effectivePaternalProvince(profile);
      const c = p ? (provConf.get(p) || '') : '';

      // Confederacy check
      if (conf === '__untagged__') {
        if (c) return;
      } else if (conf) {
        if (c !== conf) return;
      }
      // Province check
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

    // Rebuild the province dropdown options based on the currently-selected
    // confederacy (or show all provinces if 'All confederacies' is chosen).
    function rebuildProvinceOptions() {
      const conf = state.scholarConfFilter;
      // Preserve the selected value if it's still valid
      const prevProv = state.scholarProvFilter;
      let provinces;
      if (!conf || conf === '__untagged__') {
        provinces = Object.values(CONFEDERACY_PROVINCES).flat().sort();
      } else {
        provinces = (CONFEDERACY_PROVINCES[conf] || []).slice().sort();
      }
      // Build options: All, Untagged, then each province
      provSel.innerHTML =
        '<option value="">All provinces</option>' +
        '<option value="__untagged__">Untagged (no province)</option>' +
        provinces.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
      // Restore selection if still available; otherwise reset to All
      if (prevProv && (prevProv === '__untagged__' || provinces.includes(prevProv))) {
        provSel.value = prevProv;
      } else {
        provSel.value = '';
        state.scholarProvFilter = '';
      }
    }
    // Initial build so the province list starts with all 14 provinces
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

    // Province → confederacy map (from fiji-provinces.geojson) so we can
    // classify each scholar's paternal province into a confederacy.
    const provConf = new Map();
    if (state.provinces && state.provinces.features) {
      state.provinces.features.forEach(f => provConf.set(f.properties.name, f.properties.confederacy));
    }

    // Build the sorted, enriched scholar list. Enrichment comes from
    // data/scholar-profiles.json (loaded once during init). If a profile row is
    // missing we still render the card using derived counts.
    const derived = deriveScholarRows();
    const enrichedByName = state.scholarProfilesByName || new Map();
    const hidden = state.hiddenScholars || new Set();
    // Count the visible (non-hidden) scholars BEFORE any filters are applied.
    // The Confederacy Total pill uses this to show "N of M" once a filter narrows
    // the result set. Hidden scholars are excluded from both numerator and
    // denominator so the ratio stays meaningful.
    const unfilteredTotal = derived.filter(r => !hidden.has(r.name)).length;
    let rows = derived
      .filter(r => !hidden.has(r.name))
      .map(r => {
        // Merge order matters: enrichment (village, institution, photo, etc.)
        // sits UNDERNEATH the Zotero-derived counts (total, firstAuthored,
        // types, key, name). Otherwise old totals baked into scholar-profiles
        // .json at toggle-time would override the live Zotero numbers.
        const enrichment = enrichedByName.get(r.name) || {};
        const enriched = Object.assign({}, enrichment, r);
        enriched._prov = effectivePaternalProvince(enrichment);
        enriched._conf = enriched._prov ? (provConf.get(enriched._prov) || '') : '';
        return enriched;
      })
      .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

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
    // Confederacy
    const confF = state.scholarConfFilter;
    if (confF === '__untagged__') {
      rows = rows.filter(r => !r._conf);
    } else if (confF) {
      rows = rows.filter(r => r._conf === confF);
    }
    // Province
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

    // Recompute the confederacy breakdown counts for the summary bar based on
    // the CURRENTLY-visible scholar set. Called after filtering so counts
    // always reflect what the user is actually looking at.
    renderScholarSummary(rows, unfilteredTotal);

    // ------- Feed Panel G (All items) with the filtered scholar set -------
    // Any active Panel F filter (name search, keyword search, sector,
    // discipline, confederacy, province, country/uni of study or work)
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
  //  Summary bar — counts per confederacy on the CURRENT filter result
  // ============================================================
  // Any scholar filter active? Used to decide whether the Confederacy Total
  // pill shows "Total: N" (unfiltered) or "Total: N of M" (filtered).
  function anyScholarFilterActive() {
    return !!(state.scholarNameSearch && state.scholarNameSearch.trim())
        || !!(state.scholarKeywordSearch && state.scholarKeywordSearch.trim())
        || !!state.scholarConfFilter
        || !!state.scholarProvFilter
        || !!state.scholarSectorFilter
        || (state.scholarDisciplineFilter && state.scholarDisciplineFilter.size > 0)
        || !!state.scholarStudyCountry || !!state.scholarStudyUni
        || !!state.scholarWorkCountry  || !!state.scholarWorkUni;
  }

  function renderScholarSummary(rows, unfilteredTotal) {
    const bar = document.querySelector('[data-scholar-summary]');
    if (!bar) return;
    const counts = { Kubuna: 0, Tovata: 0, Burebasaga: 0, Unclassified: 0 };
    (rows || []).forEach(r => {
      const c = r._conf;
      if (c && counts[c] != null) counts[c] += 1;
      else counts.Unclassified += 1;
    });
    const total = (rows || []).length;
    // Confederacy Total pill:
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
    bar.querySelector('[data-count-kubuna]').textContent = String(counts.Kubuna);
    bar.querySelector('[data-count-tovata]').textContent = String(counts.Tovata);
    bar.querySelector('[data-count-burebasaga]').textContent = String(counts.Burebasaga);
    bar.querySelector('[data-count-unclass]').textContent = String(counts.Unclassified);

    // Reorder Kubuna/Tovata/Burebasaga chips by count descending, tie-broken
    // alphabetically by confederacy name. Unclassified is anchored to the end
    // of the row regardless of its count (it isn't a confederacy, so it never
    // enters the ranked sequence). Order recomputes on every render.
    const chipsHost = bar.querySelector('[data-scholar-summary-chips]');
    if (chipsHost) {
      const CONFED = ['Kubuna', 'Tovata', 'Burebasaga'];
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
    const pub = {
      thesisPhd: 0, thesisMasters: 0, journalArticle: 0,
      bookSection: 0, book: 0, report: 0, conferencePaper: 0, preprint: 0
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
    const chipMap = {
      thesisPhd: '[data-count-pub-phd]',
      thesisMasters: '[data-count-pub-masters]',
      journalArticle: '[data-count-pub-journal]',
      bookSection: '[data-count-pub-chapter]',
      book: '[data-count-pub-book]',
      report: '[data-count-pub-report]',
      conferencePaper: '[data-count-pub-conf]',
      preprint: '[data-count-pub-preprint]'
    };
    // Update counts + hide zero-count chips, then reorder the remaining
    // chips by count descending so the row reads as a natural ranking
    // (largest category first). All chips live in the inner .dsf-summary__chips
    // container so wrapped rows align to the first-chip column (right after
    // the fixed-width label).
    const chipsHostII = barII.querySelector('[data-scholar-summary-ii-chips]') || barII;
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
    // ---- Fiji (universities, museums, regional NGOs headquartered in Suva) ----
    [/\bfiji national university\b|\bfnu\b/i, 'Fiji'],
    [/\buniversity of the south pacific\b|\busp\b/i, 'Fiji'],
    [/\bnature\s*fiji\b|\bfiji museum\b|\bblue prosperity fiji\b|\bwish fiji\b/i, 'Fiji'],
    [/\bministry.*fiji|\bfiji.*ministry|\bsuva\b|\blautoka\b|\bnadi\b|\bnadroga\b/i, 'Fiji'],
    // Pacific-regional bodies + NGOs that are based in Suva even though the parent org is global.
    [/\blocally managed marine area\b|\blmma\b|\bgiz pacific\b|\bpacific community\b|\bspc\b|\bsprep\b|\bffa\b|\bwwf pacific\b|\bwildlife conservation society.*fiji\b|\bconservation international.*(fiji|pacific)\b|\biucn oceania\b|\bcaritas.*fiji\b/i, 'Fiji'],
    // Conservation International / WWF / WCS without a region suffix — assume the Pacific office.
    [/\bconservation international\b|\bwildlife conservation society\b|\bwwf\b/i, 'Fiji'],
    // Fijian government + hospitals + health service.
    [/\bhealth service.*fiji\b|\blautoka hospital\b|\bcwm hospital\b|\bcolonial war memorial\b|\bfiji cdc\b/i, 'Fiji'],
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
    // Same shape as country → unis: confederacy → alphabetized provinces.
    const tree = new Map();
    ['Burebasaga', 'Kubuna', 'Tovata'].sort().forEach(c => {
      tree.set(c, (CONFEDERACY_PROVINCES[c] || []).slice().sort((a, b) => a.localeCompare(b)));
    });
    // 'Unclassified' is anchored at the bottom — clicking it filters for
    // iTaukei scholars whose paternal province info isn't yet known.
    // It has no child provinces (no sub-tree).
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
  //  Two-column combo control (Confederacy/Province, Study, Work)
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

    // ---- Confederacy / Province combo ----
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
        tree, parentLabelSingular: 'Provinces',
        buildLabel: () => 'All confederacies',
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
          // internal '__untagged__' sentinel to mean "no paternal province".
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
  //   Source A: Zotero sub-collections under 'iTaukei authors (>3 papers)'.
  //             These are the primary iTaukei-scholar collections curated in
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

    // Turn a raw Zotero creator string into a canonical "Last, First" form,
    // applying the admin's alias map. Returns null on non-string / empty input.
    function canonicalizeCreator(raw) {
      if (typeof raw !== 'string' || !raw.trim()) return null;
      const s = raw.trim();
      const asLastFirst = s.includes(',') ? s : (() => {
        const toks = s.split(/\s+/);
        return `${toks[toks.length - 1]}, ${toks.slice(0, -1).join(' ')}`;
      })();
      return aliases.get(asLastFirst) || aliases.get(s) || asLastFirst;
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
      const direct = aliases.get(rawName);
      if (direct) return direct;
      if (typeof rawName !== 'string' || !rawName.includes(',')) return rawName;
      const [lastPart, firstPart] = rawName.split(',', 2).map(s => (s || '').trim());
      const subTok = firstToken(firstPart).toLowerCase();
      if (!lastPart || !subTok) return rawName;
      const lastLow = lastPart.toLowerCase();
      for (const [variant, canon] of aliases.entries()) {
        if (typeof variant !== 'string' || !variant.includes(',')) continue;
        const [vLast, vFirst] = variant.split(',', 2).map(s => (s || '').trim());
        if (vLast.toLowerCase() !== lastLow) continue;
        if (firstToken(vFirst).toLowerCase() === subTok) return canon;
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

  // Confederacy → gradient stops for the banner + initials background.
  // Matches Panel A/B/C confederacy colours.
  const CONF_GRADIENT = {
    Burebasaga: { from: '#FF5A6E', to: '#c93e50' },
    Kubuna:     { from: '#4ECDE6', to: '#0891b2' },
    Tovata:     { from: '#FFD84A', to: '#f7b500' }
  };
  const NEUTRAL_GRADIENT = { from: '#0e7490', to: '#062f35' };

  // Type styling matches the Panel B/C stacked-histogram palette.
  const TYPE_STYLES = {
    journalArticle: { color: '#0e7490', bg: '#e6f3f5', border: '#a8d1d8', s: 'Journal article',  p: 'Journal articles' },
    thesisPhd:      { color: '#228B22', bg: '#e5f4e5', border: '#a4d3a4', s: 'PhD thesis',       p: 'PhD theses' },
    thesisMasters:  { color: '#5f9c5f', bg: '#eef7ee', border: '#c9e2c9', s: 'Masters thesis',   p: 'Masters theses' },
    thesisUnknown:  { color: '#4CAF50', bg: '#eaf5ea', border: '#b8dab8', s: 'Thesis',           p: 'Theses' },
    bookSection:    { color: '#7a1419', bg: '#f7e8ea', border: '#e1a8ae', s: 'Book chapter',     p: 'Book chapters' },
    book:           { color: '#7a1419', bg: '#f7e8ea', border: '#e1a8ae', s: 'Book',             p: 'Books' },
    report:         { color: '#1e40af', bg: '#e6ecf7', border: '#a8b8dc', s: 'Report',           p: 'Reports' },
    conferencePaper:{ color: '#92400e', bg: '#f7ecdf', border: '#d9b58a', s: 'Conference paper', p: 'Conference papers' },
    preprint:       { color: '#6b7280', bg: '#eef0f2', border: '#c7cbd1', s: 'Preprint',         p: 'Preprints' }
  };
  // Order in which chips are rendered (only shown if count > 0)
  // 'thesisUnknown' is intentionally omitted — "Thesis (unspecified)" is never
  // surfaced on the public dashboard (per Ron's directive).
  const CHIP_ORDER = ['journalArticle', 'bookSection', 'book', 'thesisPhd', 'thesisMasters', 'report', 'conferencePaper', 'preprint'];

  // Country name → ISO 3166-1 alpha-2 code, used for flag icons in the card header.
  // Only countries that actually appear in the current dataset (or are
  // reasonably likely to appear given the iTaukei diaspora — Pacific + common
  // graduate-study destinations) are enumerated. Names are matched exactly to
  // what `scholarWorkCountry(p)` returns (which mirrors the admin's Country of
  // Work datalist), plus a handful of common alternate spellings.
  const COUNTRY_ISO = {
    'Fiji': 'fj', 'Australia': 'au', 'New Zealand': 'nz', 'Aotearoa': 'nz',
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

  function provinceToConfederacy(name) {
    if (!name || !state.provinces) return null;
    const f = state.provinces.features.find(x => x.properties.name === name);
    return f ? f.properties.confederacy : null;
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
    const village = r.village || '';
    const paternal = effectivePaternalProvince(r);
    const confederacy = provinceToConfederacy(paternal);
    const gradient = (confederacy && CONF_GRADIENT[confederacy]) || NEUTRAL_GRADIENT;
    const bannerLabel = confederacy ? `${confederacy} Confederacy` : 'iTaukei Scholar';
    const institution = r.institution || '';
    const title = r.title || '';
    const lastUpdate = formatLastUpdate(r.lastUpdate);
    const t = r.types || {};
    const initials = ((first || last).slice(0, 1) + (last ? last.slice(0, 1) : '')).toUpperCase() || 'iT';

    // Meta line: village · paternal province
    const metaBits = [];
    if (village) metaBits.push(escapeHtml(village));
    else metaBits.push('<span class="db-scholar-card__meta--empty">Village not yet added</span>');
    if (paternal) metaBits.push(escapeHtml(paternal) + ' Province');
    const metaHtml = metaBits.join('<span class="sep">·</span>');

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
    // Professional title: linked to r.profileUrl (faculty profile page) if present
    let titleHtml = '';
    if (title) {
      titleHtml = r.profileUrl
        ? `<a href="${escapeAttr(r.profileUrl)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
        : escapeHtml(title);
    }

    // Type chips (only non-zero, in CHIP_ORDER)
    const chipsHtml = CHIP_ORDER.filter(k => (t[k] || 0) > 0).map(k => {
      const s = TYPE_STYLES[k];
      const label = t[k] === 1 ? s.s : s.p;
      return `<span class="db-scholar-card__type-chip" style="background:${s.bg};border-color:${s.border};color:${s.color};">`
        + `<span class="n" style="color:${s.color};">${t[k]}</span> ${label}</span>`;
    }).join('');

    const card = document.createElement('article');
    const isNeutral = !confederacy || !CONF_GRADIENT[confederacy];
    card.className = 'db-scholar-card'
      + (active ? ' is-active' : '')
      + (isNeutral ? ' db-scholar-card--neutral' : '');
    card.title = `Click to filter items to ${r.name}’s papers`;
    card.style.setProperty('--conf-from', gradient.from);
    card.style.setProperty('--conf-to', gradient.to);
    card.addEventListener('click', ev => {
      // Ignore clicks on external-profile icons or the Submit-info button
      if (ev.target.closest('.db-scholar-card__gs, .db-scholar-card__orcid, .db-scholar-card__submit')) return;
      state.filter.scholar = state.filter.scholar === r.name ? '' : r.name;
      state.shown = state.pageSize;
      afterFilterChange();
      $('.db-items').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Photo (as background image) or initials fallback. Wrapped in a
    // photo-column container so the 'Submit info' button can stack directly
    // beneath the photo without ever running under the confederacy banner
    // title (which sits in the same row and would otherwise be overlapped
    // on shorter names or wider titles like BUREBASAGA CONFEDERACY).
    const photoInnerHtml = r.photo
      ? `<div class="db-scholar-card__photo" style="background-image:url('${escapeAttr(r.photo)}')"></div>`
      : `<div class="db-scholar-card__photo"><div class="db-scholar-card__initials">${escapeHtml(initials)}</div></div>`;
    const photoHtml = `
      <div class="db-scholar-card__photo-col">
        ${photoInnerHtml}
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
      <a class="db-scholar-card__orcid${r.orcidUrl ? '' : ' is-missing'}"
         href="${escapeAttr(r.orcidUrl || '#')}"
         ${r.orcidUrl ? 'target="_blank" rel="noopener"' : ''}
         title="${r.orcidUrl ? 'Open ORCID iD' : 'ORCID iD not yet linked'}"
         aria-label="ORCID iD${r.orcidUrl ? '' : ' not linked'}">${ORCID_SVG}</a>
      <a class="db-scholar-card__gs${r.googleScholarUrl ? '' : ' is-missing'}"
         href="${escapeAttr(r.googleScholarUrl || '#')}"
         ${r.googleScholarUrl ? 'target="_blank" rel="noopener"' : ''}
         title="${r.googleScholarUrl ? 'Open Google Scholar profile' : 'Google Scholar profile not yet linked'}">${GS_SVG}</a>
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

  // Fill the paternal-province dropdown with the same province list the site
  // already ships. Called lazily on first modal open so the DOM is ready.
  let provinceOptionsFilled = false;
  function fillProvinceOptions() {
    if (provinceOptionsFilled) return;
    const sel = document.getElementById('db-sf-paternal');
    if (!sel) return;
    const provList = (state.provinces && state.provinces.features)
      ? state.provinces.features.map(f => (f.properties && (f.properties.name || f.properties.NAME)) || '').filter(Boolean)
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
    setVal('db-sf-paternal',     profile.paternalProvince || '');
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
          paternalProvince: form.querySelector('#db-sf-paternal').value.trim(),
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
    const hasSummary  = !!insight && !!(insight.summary && insight.summary.trim());
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
      ? `<p class="db-scholar-card__insight-summary">${sanitizeSummaryHtml(insight.summary || '')}</p>`
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
    if (f.province) {
      const set = state.provincesByItem.get(item.key);
      if (!set || !set.has(f.province)) return false;
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
    // Confederacy/province dropdown filters on the scholar leaderboard also
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
    const zoteroUrl = `https://www.zotero.org/groups/5983386/itaukei_academic_research/items/${it.key}`;
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
      ${isItaukei(it) ? `<span class="db-item__badge db-item__badge--itaukei">iTaukei author</span>` : ''}
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

    // Tag chips: provinces + disciplines (clickable to filter)
    const tags = document.createElement('div');
    tags.className = 'db-item__tags';
    const provSet = state.provincesByItem.get(it.key);
    if (provSet && provSet.size) {
      provSet.forEach(name => {
        const chip = el('span', {
          className: 'db-item__badge db-item__badge--tag is-clickable',
          title: `Filter by province researched: ${name}`,
          onclick: () => {
            state.filter.province = name;
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

    // Action links top-right
    const actions = document.createElement('div');
    actions.className = 'db-item__actions';
    if (doiUrl) {
      actions.innerHTML += `<a class="db-item__link" href="${escapeAttr(doiUrl)}" target="_blank" rel="noopener" title="Open via DOI">DOI ↗</a>`;
    } else if (it.url) {
      actions.innerHTML += `<a class="db-item__link" href="${escapeAttr(it.url)}" target="_blank" rel="noopener" title="Open source URL">Link ↗</a>`;
    }
    actions.innerHTML += `<a class="db-item__link" href="${escapeAttr(zoteroUrl)}" target="_blank" rel="noopener" title="Open in Zotero library">Zotero ↗</a>`;
    li.appendChild(actions);

    return li;
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
    if (state.filter.province)   add('Province:',   state.filter.province, () => clearFilter('province'));
    if (state.filter.paternal)   add('Paternal:',   state.filter.paternal, () => clearFilter('paternal'));
    if (state.filter.university) add('University:', state.filter.university, () => clearFilter('university'));
    if (state.filter.scholar)    add('Scholar:',    state.filter.scholar, () => clearFilter('scholar'));
    if (state.filter.b2Authorship) {
      const auth = { itaukeiFirst: 'iTaukei first author', includesItaukei: 'iTaukei co-author, not first author', noItaukei: 'No iTaukei author identified' }[state.filter.b2Authorship] || state.filter.b2Authorship;
      add('Authorship:', auth, () => clearFilter('b2Authorship'));
    }
  }

  // ============ EXPORT .BIB ============
  function exportBib() {
    const items = currentItems().filter(itemMatches);
    let out = '';
    items.forEach(it => {
      const bibType = ({journalArticle:'article', thesis:'phdthesis', bookSection:'incollection', book:'book', conferencePaper:'inproceedings', report:'techreport', preprint:'misc', document:'misc'})[it.itemType] || 'misc';
      const key = ((it.creators && it.creators[0]) ? it.creators[0].split(' ').pop() : 'anon').toLowerCase().replace(/\W/g,'') + (it.year || '');
      out += `@${bibType}{${key},\n`;
      out += `  title = {${(it.title || '').replace(/[{}]/g,'')}},\n`;
      if (it.creators && it.creators.length) out += `  author = {${it.creators.map(c => c.replace(/[{}]/g,'')).join(' and ')}},\n`;
      if (it.year) out += `  year = {${it.year}},\n`;
      if (it.publicationTitle) out += `  journal = {${it.publicationTitle.replace(/[{}]/g,'')}},\n`;
      if (it.university) out += `  school = {${it.university.replace(/[{}]/g,'')}},\n`;
      if (it.DOI) out += `  doi = {${it.DOI}},\n`;
      if (it.url) out += `  url = {${it.url}},\n`;
      out += `}\n\n`;
    });
    const blob = new Blob([out], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `itaukei-research-${items.length}-items.bib`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
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
    const clearBtn = $('[data-db-clear]');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);
  }

  // ============ LIVE REFRESH (background, non-blocking) ============
  async function backgroundRefresh() {
    try {
      const r = await fetch('https://api.zotero.org/groups/5983386?format=json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('Zotero HTTP ' + r.status);
      const d = await r.json();
      const live = d && d.meta && d.meta.numItems;
      const snapItems = state.snapshot.items.length;
      if (live && live !== snapItems) {
        const note = $('[data-db-sync-note]');
        if (note) note.innerHTML = `Live library now has <strong>${live}</strong> items (snapshot: ${snapItems}). <a href="https://www.zotero.org/groups/5983386/itaukei_academic_research/library" target="_blank" rel="noopener">See latest additions</a>.`;
      } else if (live) {
        const note = $('[data-db-sync-note]');
        if (note) note.textContent = `Live Zotero check confirmed · ${live} items`;
      }
    } catch (e) {
      // Silent — snapshot remains the source of truth. Show a light fallback banner
      // only if network is genuinely unreachable.
      const note = $('[data-db-sync-note]');
      if (note) note.textContent = 'Live Zotero check offline · showing local snapshot';
      showFallbackBanner('live-check-failed');
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
      setSyncBadge('error', 'Data unavailable', 'Local snapshot files failed to load — please refresh');
      showFallbackBanner('snapshot-load-failed');
      const items = $('[data-db-items]');
      if (items) items.innerHTML = '<li class="db-item db-item__empty">Unable to load the database snapshot. Please refresh the page in a moment.</li>';
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
    renderPanelD();
    renderHistogram();
    renderLeaders();
    wireScholarFilterRow();
    wire();
    wireTypeFilter();
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
  //   fiji-focused        → iTaukei first-author, Fiji-focused, group by paternal province
  //   all-locations       → iTaukei first-author, ANY location, group by paternal province
  //   all-authors         → any author, Fiji-focused, group by study province + Fiji-wide row
  //   authorship          → any author, Fiji-focused, group by study province, single stacked bar per province by authorship role
  //
  // Selected view + its type-filter checkboxes are persisted in URL hash so a
  // link like #b2=all-locations bookmarks the view.
  // B2 no longer has an Authorship tab (it moved to Panel B1). Remaining views
  // all group by first-author paternal province; only the scope + author-set
  // differ per tab. Title + description are now static in the HTML — only the
  // meta row (Grouped by / Scope / Authors) is refreshed per tab.
  // Every remaining B2 tab groups by iTaukei first-author paternal province.
  // 'all-authors' was removed — that view aggregated by study province and
  // clashed with B1's scope now that B1 owns the study-province chart.
  const B2_VIEWS = ['fiji-focused', 'all-locations'];
  const B2_META = {
    'fiji-focused': {
      meta: [
        ['Grouped by',  'First-author paternal province'],
        ['Scope',       'Fiji-focused'],
        ['Authors',     'iTaukei first authors']
      ]
    },
    'all-locations': {
      meta: [
        ['Grouped by',  'First-author paternal province'],
        ['Scope',       'Fiji + International'],
        ['Authors',     'iTaukei first authors']
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
    itaukeiFirst:    'iTaukei first author',
    includesItaukei: 'iTaukei co-author, not first author',
    noItaukei:       'No iTaukei author identified'
  };
  const AUTHORSHIP_KEYS = ['itaukeiFirst', 'includesItaukei', 'noItaukei'];

  // Initial hydration from URL hash — e.g. #b2=all-authors
  state.b1Authors = 'itaukei';
  // Panel B1 view mode: 'type' (default) shows publication-type stacked bars;
  // 'authorship' shows the iTaukei-authorship stacked bar previously on B2.
  state.b1View = 'type';
  state.worldSelectedCountry = null;
  state.worldSelectedUniversity = null;
  state.worldSearchTerm = '';
  state.b2View = 'fiji-focused';
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

  // -------- shared: get iTaukei scholar names + paternal-province lookup --------
  function iTaukeiScholarMaps() {
    // Anyone with a saved profile record is considered an iTaukei scholar.
    // Their paternal province may or may not be filled.
    const scholars = state.scholarProfilesByName || new Map();
    const paternalByName = new Map();
    scholars.forEach((p, name) => paternalByName.set(name, effectivePaternalProvince(p)));
    return { scholars, paternalByName };
  }

  // Determine the canonical scholar-name for a raw Zotero creator string.
  // Returns null when the creator doesn't map to a known iTaukei scholar.
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
  // final “Province not yet confirmed” row when appropriate.
  function buildB2Rows_paternalGrouped(includeAllLocations) {
    const { scholars, paternalByName } = iTaukeiScholarMaps();
    const rows = new Map();
    state.provinces.features.forEach(f => {
      rows.set(f.properties.name, { name: f.properties.name, conf: f.properties.confederacy, total: 0, types: {}, isConfirmed: true });
    });
    const unconfirmed = { name: 'Province not yet confirmed', conf: null, total: 0, types: {}, isConfirmed: false };

    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.b2TypeSet.has(vt)) return;

      // First creator must map to an iTaukei scholar
      const first = (it.creators || [])[0];
      const scholar = itaukeiName(first, scholars);
      if (!scholar) return;

      // Fiji-focused rule (view 1) = has at least one Fiji-province tag OR the
      // scholar's paternal province is confirmed (paternal province acts as the
      // “national Fiji” fallback bucket for iTaukei-authored work). This is a
      // pragmatic choice given the current data model.
      const provSet = state.provincesByItem.get(it.key);
      const hasProvinceTag = provSet && provSet.size > 0;
      if (!includeAllLocations && !hasProvinceTag && !paternalByName.get(scholar)) {
        // Fiji-focused view: skip items with no province tag AND no known
        // paternal province (we cannot confidently classify these as Fiji).
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

  // Co-author view: for each publication where NO iTaukei author is first but
  // at least one iTaukei author appears elsewhere in the byline, add +1 to the
  // paternal province of every iTaukei co-author. Type filter respects
  // state.b2TypeSet, but PhD/Masters thesis are inherently single-author works
  // that don't apply here — the caller disables those checkboxes.
  function buildB2Rows_coauthor(includeAllLocations) {
    const { scholars, paternalByName } = iTaukeiScholarMaps();
    const rows = new Map();
    state.provinces.features.forEach(f => {
      rows.set(f.properties.name, { name: f.properties.name, conf: f.properties.confederacy, total: 0, types: {}, isConfirmed: true });
    });
    const unconfirmed = { name: 'Province not yet confirmed', conf: null, total: 0, types: {}, isConfirmed: false };

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

      // Collect all iTaukei co-authors on this paper
      const coScholars = [];
      for (let i = 1; i < creators.length; i++) {
        const s = itaukeiName(creators[i], scholars);
        if (s) coScholars.push(s);
      }
      if (!coScholars.length) return;

      // Fiji-focused rule: paper must have a Fiji province tag OR at least one
      // co-author with a confirmed paternal province (i.e., an iTaukei scholar
      // contribution counts as Fiji-relevant even if the study site isn't tagged).
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

  // Split view: for each paternal province, count both (a) publications where
  // an iTaukei person from that province is 1st author and (b) publications
  // where an iTaukei person from that province is a co-author (and the paper
  // has no iTaukei 1st author). One row per province with lead + co counts.
  //
  // Note: (a) counts each paper exactly once (against its lead's province),
  // (b) counts each paper once per distinct co-author province (so a paper
  // with two co-authors from Kadavu still adds only +1 to Kadavu, but adds
  // +1 to Lau too if one is from Lau).
  function buildB2Rows_split(includeAllLocations) {
    const { scholars, paternalByName } = iTaukeiScholarMaps();
    const rows = new Map();
    state.provinces.features.forEach(f => {
      rows.set(f.properties.name, {
        name: f.properties.name, conf: f.properties.confederacy,
        lead: 0, co: 0, total: 0,
        leadTypes: {}, coTypes: {},
        isConfirmed: true
      });
    });
    const unconfirmed = {
      name: 'Province not yet confirmed', conf: null,
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
        // 1st-author case — counts once against the first author's province.
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
        // Distinct paternal provinces — avoid double-counting a paper for
        // one province just because two of its co-authors happen to be
        // from that province.
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
    state.provinces.features.forEach(f => {
      rows.set(f.properties.name, { name: f.properties.name, conf: f.properties.confederacy, total: 0, types: {} });
    });
    const fijiWide = { name: 'Fiji-wide / national', conf: null, total: 0, types: {} };

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
      // “Fiji-wide / national” needs a positive signal. Without an explicit
      // Zotero tag we cannot fill this bucket for non-iTaukei papers. Leaving
      // it visible (with 0) documents that the row exists once tagging arrives.
    });

    const out = Array.from(rows.values()).sort((a, b) => b.total - a.total);
    out.push(fijiWide);
    return out;
  }

  function buildB2Rows_compareAuthorship() {
    // For each Fiji province, count 3 authorship categories.
    const { scholars } = iTaukeiScholarMaps();
    const rows = new Map();
    state.provinces.features.forEach(f => {
      rows.set(f.properties.name, {
        name: f.properties.name, conf: f.properties.confederacy,
        cats: { itaukeiFirst: 0, includesItaukei: 0, noItaukei: 0 },
        total: 0
      });
    });
    const fijiWide = { name: 'Fiji-wide / national', conf: null, cats: { itaukeiFirst: 0, includesItaukei: 0, noItaukei: 0 }, total: 0 };

    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.b2TypeSet.has(vt)) return;
      const provSet = state.provincesByItem.get(it.key);
      if (!provSet || provSet.size === 0) return; // Only Fiji-focused rows for this view

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
  //   iTaukei authors → fiji-focused (Fiji-focused + iTaukei first author)
  //   All authors     → all-authors  (Fiji-focused + any author)
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
      { value: 'itaukei', label: 'iTaukei authors' },
      { value: 'all',     label: 'All authors' }
    ];
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = currentType;
    sel.addEventListener('change', () => {
      state.b2View = sel.value === 'all' ? 'all-authors' : 'fiji-focused';
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
    const meta = B2_META[view] || B2_META['fiji-focused'];
    const metaEl = $('[data-b2-meta]');
    const barsEl = $('[data-b2-bars]');
    if (!metaEl || !barsEl) return;

    // Title + description are now static in the HTML (rewritten to describe the
    // panel as a whole rather than the current tab). Only the meta row updates
    // per tab so the reader can see what scope / authorship the current tab uses.
    metaEl.innerHTML = meta.meta.map(([k, v]) => `<span><em>${escapeHtml(k)}:</em> ${escapeHtml(v)}</span>`).join('');

    // Toggle tab active state + tabindex per aria-tablist pattern. The chart
    // panel that owns these tabs is Panel C2 (Panel B2 is the world map above
    // it, which has no such tabs). Historically this selector said B2 and the
    // active pill never updated — fixed by scoping to the C2 panel.
    const b2Root = document.querySelector('[data-panel="C2"]');
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
    // The pill controls scope (Fiji-focused vs Fiji + International);
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

    if (view === 'fiji-focused' || view === 'all-locations') {
      if (auth === 'first') {
        const rows = buildB2Rows_paternalGrouped(includeAll);
        renderPanelBBarsInto(barsEl, rows, {
          activeName: state.filter.paternal || null,
          confDotColor: r => r.conf ? CONF_COLORS[r.conf] : '#94a3b8',
          onClick: r => {
            if (!r.isConfirmed) return;
            state.filter.paternal = state.filter.paternal === r.name ? '' : r.name;
            state.filter.province = '';
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
            state.filter.province = '';
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
        activeName: state.filter.province || null,
        confDotColor: r => r.conf ? CONF_COLORS[r.conf] : '#94a3b8',
        onClick: r => {
          if (r.name === 'Fiji-wide / national') return; // no items tagged yet
          state.filter.province = state.filter.province === r.name ? '' : r.name;
          state.filter.paternal = '';
          state.filter.b2Group = state.filter.province ? 'province' : '';
          state.filter.b2Authorship = '';
          state.shown = state.pageSize;
          afterFilterChange();
        }
      });
      barsEl.classList.remove('db-bars--grouped');
    }

    // Authorship chrome (province note, legend, caveat) is no longer used in
    // B2 — the Authorship tab moved to Panel B1. Ensure it's hidden here.
    const hide = el => { if (el) el.style.display = 'none'; };
    hide($('[data-b2-province-note]'));
    hide($('[data-b2-authorship-controls]'));
    hide($('[data-b2-caveat]'));
  }

  // -------- Split view render helpers --------
  // Compact: one bar per province, two-tone teal (lead + co).
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

  // Detailed: two twin bars per province with publication-type colors.
  // Grid: province | role | bar | totals (province + totals span both rows).
  function renderPanelB2SplitDetailed(host, rows) {
    host.innerHTML = '';
    host.className = 'db-bars db-bars--split-detailed';
    if (!rows.length) {
      host.innerHTML = '<div style="padding:16px;color:#64748b;font-size:0.9rem;">No items match the current filters.</div>';
      return;
    }
    // Scale by the larger of lead/co so bars are comparable across provinces.
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

      // Row 2: co-author (skip province + totals cells — they span from row 1)
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
  // layout change. Uses <strong> for numbers/province names and <em> for
  // interpretive framing so the sentence reads as commentary, not caption.
  function renderPanelB2Blurb(el, ctx) {
    if (!el) return;
    const rows = (ctx && ctx.rows) || [];
    const confirmed = rows.filter(r => r.isConfirmed);
    if (!confirmed.length) { el.innerHTML = ''; return; }

    const auth = ctx.auth;
    const scopeWord = ctx.includeAll ? 'across all locations' : 'in Fiji-focused research';

    const fmt = (n) => `<strong>${n}</strong>`;
    const prov = (name) => `<strong>${escapeHtml(name)}</strong>`;

    let html = '';

    if (auth === 'first') {
      // Top-3 first-author provinces
      const sorted = confirmed.slice().sort((a, b) => b.total - a.total);
      const [p1, p2, p3] = sorted;
      if (!p1) { el.innerHTML = ''; return; }
      html = `${prov(p1.name)} leads iTaukei first-author publications ${scopeWord} with ${fmt(p1.total)} paper${p1.total === 1 ? '' : 's'}`;
      if (p2) html += `, followed by ${prov(p2.name)} (${fmt(p2.total)})`;
      if (p3) html += ` and ${prov(p3.name)} (${fmt(p3.total)})`;
      html += `. <em>Together, these three provinces account for the bulk of iTaukei-led scholarship represented in this database.</em>`;
    } else if (auth === 'co') {
      const sorted = confirmed.slice().sort((a, b) => b.total - a.total);
      const [p1, p2, p3] = sorted;
      if (!p1) { el.innerHTML = ''; return; }
      html = `${prov(p1.name)} tops iTaukei co-authored publications ${scopeWord} at ${fmt(p1.total)}`;
      if (p2) html += `, followed by ${prov(p2.name)} (${fmt(p2.total)})`;
      if (p3) html += ` and ${prov(p3.name)} (${fmt(p3.total)})`;
      html += ` — <em>provinces whose scholars appear more often as collaborators than as lead authors on these works.</em>`;
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
        // Fallback: describe the top province by total.
        const top = confirmed.slice().sort((a, b) => b.total - a.total)[0];
        if (top) parts.push(`${prov(top.name)} has the highest combined presence with ${fmt(top.lead)} first-author and ${fmt(top.co)} co-authored papers`);
      }
      html = parts.join('. ') + `. <em>These asymmetries hint at differing research pathways — some provinces are more visible as collaborators, others as lead investigators.</em>`;
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
      ? `<div class="db-b2-tip__note">“No iTaukei author identified” means none has yet been identified in the current database.</div>`
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

    // Sort rows. Fiji-wide / national always pinned to the end. Zero-total
    // rows keep their alphabetical fallback so the layout stays readable.
    const sortable = rows.filter(r => r.name !== 'Fiji-wide / national');
    const trailing = rows.filter(r => r.name === 'Fiji-wide / national');
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
    const activeProv = state.filter.province || null;
    const activeAuth = state.filter.b2Authorship || null;

    ordered.forEach(r => {
      // Column 1 — province label + confederacy dot + total-only click target
      const label = document.createElement('div');
      label.className = 'db-bars__prov';
      if (activeProv === r.name) label.classList.add('is-active');
      const dotColor = r.conf ? CONF_COLORS[r.conf] : '#94a3b8';
      label.innerHTML = `<span>${escapeHtml(r.name)}</span><span class="db-bars__prov-dot" style="background:${dotColor};"></span>`;
      const canFilterProv = r.name !== 'Fiji-wide / national' && r.total > 0;
      if (canFilterProv) {
        label.style.cursor = 'pointer';
        label.addEventListener('click', () => {
          state.filter.province = state.filter.province === r.name ? '' : r.name;
          state.filter.paternal = '';
          state.filter.b2Group = state.filter.province ? 'province' : '';
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
        // Draw an empty outline so the province still has a visual anchor.
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
          const canFilterSeg = r.name !== 'Fiji-wide / national';
          if (canFilterSeg) {
            seg.style.cursor = 'pointer';
            const onActivate = () => {
              const sameProv = state.filter.province === r.name;
              const sameAuth = state.filter.b2Authorship === k;
              if (sameProv && sameAuth) {
                state.filter.province = '';
                state.filter.b2Authorship = '';
                state.filter.b2Group = '';
              } else {
                state.filter.province = r.name;
                state.filter.paternal = '';
                state.filter.b2Group = 'province';
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

      // Column 3 — right-side total (also acts as a province filter target)
      const num = document.createElement('div');
      num.className = 'db-bars__total';
      num.textContent = r.total;
      if (canFilterProv) {
        num.style.cursor = 'pointer';
        num.addEventListener('click', () => {
          state.filter.province = state.filter.province === r.name ? '' : r.name;
          state.filter.paternal = '';
          state.filter.b2Group = state.filter.province ? 'province' : '';
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
  // Publications grouped by paternal confederacy of the iTaukei lead author,
  // split by whether the item is Fiji-focused (has a Fiji-province tag) or
  // international-focused. Toggle filters restrict to PhD / Masters theses.
  function computeImpactData(filter) {
    const conf = { Burebasaga: {fiji:0, intl:0, scholars:new Set()},
                   Kubuna:     {fiji:0, intl:0, scholars:new Set()},
                   Tovata:     {fiji:0, intl:0, scholars:new Set()} };
    const confByProv = new Map();
    state.provinces.features.forEach(f => confByProv.set(f.properties.name, f.properties.confederacy));

    // Look up each iTaukei scholar's paternal confederacy from their filled
    // profile. Empty confederacy = we can't attribute their work to a group.
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
      // Determine the paternal confederacy from the lead iTaukei author. We
      // check the first creator first, then fall back to any iTaukei author.
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
      const isFiji = provSet && provSet.size > 0;
      const bucket = conf[attributed];
      if (!bucket) return;
      if (isFiji) bucket.fiji += 1; else bucket.intl += 1;
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
    const total = ['Burebasaga','Kubuna','Tovata'].reduce((s, c) => s + data.conf[c].fiji + data.conf[c].intl, 0);
    const fiji = ['Burebasaga','Kubuna','Tovata'].reduce((s, c) => s + data.conf[c].fiji, 0);
    const intl = total - fiji;
    const allScholars = new Set();
    ['Burebasaga','Kubuna','Tovata'].forEach(c => data.conf[c].scholars.forEach(n => allScholars.add(n)));
    $('[data-impact-total]').textContent = total.toLocaleString();
    $('[data-impact-fiji]').textContent = fiji.toLocaleString();
    $('[data-impact-intl]').textContent = intl.toLocaleString();
    $('[data-impact-scholars]').textContent = allScholars.size.toLocaleString();

    // Find max across all conf x scope for bar scaling
    const allValues = [];
    ['Burebasaga','Kubuna','Tovata'].forEach(c => { allValues.push(data.conf[c].fiji, data.conf[c].intl); });
    const max = Math.max(1, ...allValues);
    const MAX_H = 220; // pixels

    const confs = [
      { name: 'Burebasaga', color: '#FF5A6E' },
      { name: 'Kubuna',     color: '#4ECDE6' },
      { name: 'Tovata',     color: '#FFD84A' }
    ];

    chart.innerHTML = confs.map(c => {
      const d = data.conf[c.name];
      const total = d.fiji + d.intl;
      const scholarList = Array.from(d.scholars).sort().join('&#10;'); // linebreak-separated in tooltip
      return `
        <div class="impact-conf" style="border-top-color:${c.color};">
          <div class="impact-conf__title">${c.name}</div>
          <div class="impact-conf__total">${total} Publication${total === 1 ? '' : 's'} · ${d.scholars.size} scholar${d.scholars.size === 1 ? '' : 's'}</div>
          <div class="impact-conf__bars">
            <div class="impact-bar">
              <div class="impact-bar__value">${d.fiji}</div>
              <div class="impact-bar__col impact-bar__col--fiji" style="height:${Math.max(4, (d.fiji / max) * MAX_H)}px;" data-tooltip="${d.fiji} Fiji-focused item${d.fiji === 1 ? '' : 's'}"></div>
              <div class="impact-bar__label">Fiji-focused</div>
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
    let note = `Showing ${filterLabel}. “Fiji-focused” means the item is tagged to at least one Fijian province in Zotero; “International” means it isn’t. Confederacy is attributed via the lead iTaukei author’s paternal province.`;
    if (data.unattributed > 0) {
      note += ` ${data.unattributed} item${data.unattributed === 1 ? ' was' : 's were'} not attributed — the lead scholar’s paternal province hasn’t been filled in the admin dashboard yet.`;
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
})();
