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
  const FILTER_KEYS = ['q', 'itemType', 'discipline', 'decade', 'province', 'paternal', 'university', 'year', 'scholar'];

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
  const TYPE_ORDER = ['thesisPhd','thesisMasters','journalArticle','bookSection','book','report','conferencePaper','preprint'];

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

  // ============ DATA LOAD ============
  async function loadAll() {
    const [snap, geo, unis, provFlat, profiles, sync, grad] = await Promise.all([
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
      fetchJson('data/itaukei-graduate-studies.json').catch(() => ({ scholars: {}, worldPoints: [] }))
    ]);
    state.snapshot = snap;
    state.provinces = geo;
    state.universities = unis;
    state.lastSync = sync;
    state.graduateStudies = grad;

    // Build the scholar-name look-up. Starts with the local JSON snapshot, then
    // overlays Google Sheet CSV if the admin has configured one (URL stored in
    // localStorage under 'vavelab_scholar_sheet_url').
    state.scholarProfilesByName = new Map();
    (profiles.scholars || []).forEach(p => {
      const name = (p.last && p.first) ? `${p.last}, ${p.first}` : (p.name || '');
      if (name) state.scholarProfilesByName.set(name, p);
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
          if (name) state.scholarProfilesByName.set(name, Object.assign({}, state.scholarProfilesByName.get(name) || {}, p));
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

    // iTaukei collection keys (used to compute the "iTaukei author" badge)
    const itaukeiParents = snap.collections.filter(c =>
      c.name === 'By or with iTaukei authors' || c.name.startsWith('iTaukei authors')
    );
    const itaukeiParentKeys = new Set(itaukeiParents.map(c => c.key));
    const authorRoot = snap.collections.find(c => c.name === 'iTaukei authors (>3 papers)');
    if (authorRoot) {
      snap.collections.forEach(c => { if (c.parent === authorRoot.key) itaukeiParentKeys.add(c.key); });
    }
    const byWith = snap.collections.find(c => c.name === 'By or with iTaukei authors');
    if (byWith) itaukeiParentKeys.add(byWith.key);
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

  function clearFilter(key) {
    if (key === 'year') state.filter.year = '';
    else state.filter[key] = '';
    state.shown = state.pageSize;
    afterFilterChange();
  }
  function clearAllFilters() {
    FILTER_KEYS.forEach(k => { state.filter[k] = (k === 'year') ? '' : ''; });
    state.shown = state.pageSize;
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
    const any = FILTER_KEYS.some(k => state.filter[k] !== '' && state.filter[k] != null);
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
  function renderStats() {
    const snap = state.snapshot;
    const items = snap.items;
    const stats = $('[data-db-stats]');
    const total = items.length;
    const theses = items.filter(i => i.itemType === 'thesis').length;
    const itaukeiCount = items.filter(isItaukei).length;
    stats.querySelector('[data-stat="items"]').textContent = total;
    stats.querySelector('[data-stat="itaukei"]').textContent = itaukeiCount;
    stats.querySelector('[data-stat="theses"]').textContent = theses;
    stats.querySelector('[data-stat="universities"]').textContent = state.universities.totalUniversities;
    stats.querySelector('[data-stat="countries"]').textContent = state.universities.totalCountries;

    // Sync badge — prefer the workflow heartbeat (advances every run) over the
    // snapshot's generatedAt (only advances when data materially changes).
    const sync = state.lastSync;
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

    // Footer line: always show the data-change timestamp so it's clear when the numbers actually moved
    const dataChangedAt = new Date(changedIso).toLocaleString();
    $('[data-db-updated]').textContent =
      `Sync checked ${new Date(checkedIso).toLocaleString()} · last data change ${dataChangedAt} · ${snap.items.length} items indexed`;
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
      // Esri World Imagery (attributed "Esri — Esri, Maxar, Earthstar Geographics,
      // and the GIS User Community"). Sits under the choropleth polygons.
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 18
      }).addTo(map);
      state.map = map;
      renderChoropleth();

      // Panel A mapview toggle (Fiji sub-tabs)
      $$('[data-mapscope-panel="fiji"] button').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('[data-mapscope-panel="fiji"] button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.mapView = btn.dataset.mapview;
          renderPanelA();
        });
      });
      // World-view sub-tabs (Where iTaukei graduates study / have published)
      $$('[data-mapscope-panel="world"] button').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          $$('[data-mapscope-panel="world"] button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.worldView = btn.dataset.worldview;
          renderWorldMap();
        });
      });
      // TOP-level scope toggle: Fiji ↔ World
      $$('.db-map-scope button').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('.db-map-scope button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.mapScope = btn.dataset.mapscope;
          // Show/hide the corresponding sub-tab row and note
          $$('[data-mapscope-panel]').forEach(p => { p.style.display = (p.dataset.mapscopePanel === state.mapScope) ? '' : 'none'; });
          $$('[data-mapscope-note]').forEach(n => { n.style.display = (n.dataset.mapscopeNote === state.mapScope) ? '' : 'none'; });
          if (state.mapScope === 'world') {
            renderWorldMap();
          } else {
            // Restore Fiji view
            if (state.worldLayer) { state.map.removeLayer(state.worldLayer); state.worldLayer = null; }
            state.map.setMinZoom(6);
            state.map.setMaxZoom(12);
            state.map.fitBounds(state.mapDefaultBounds || [[-19.6, 176.8], [-15.9, 180.9]], { padding: [4, 4] });
            renderPanelA();
          }
        });
      });

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
  function renderWorldMap() {
    if (!state.map) return;
    // Remove any Fiji choropleth to avoid cluttering the wider view
    if (state.provinceLayer) { state.map.removeLayer(state.provinceLayer); state.provinceLayer = null; }
    // Clear previous world layer
    if (state.worldLayer) { state.map.removeLayer(state.worldLayer); state.worldLayer = null; }

    state.map.setMinZoom(2);
    state.map.setMaxZoom(10);

    const grad = state.graduateStudies || { worldPoints: [] };
    const points = grad.worldPoints || [];

    if (state.worldView === 'publish') {
      // Placeholder — publication-country tagging is a follow-up feature.
      state.worldLayer = L.layerGroup([]).addTo(state.map);
      state.map.fitBounds([[-45, 100], [50, -100]], { padding: [30, 30] });
      return;
    }

    // Where iTaukei graduates study.
    // We plot Americas/Europe longitudes shifted by +360 so all points sit on
    // the same side of a Pacific-centric map, keeping Fiji + Hawaii + UK
    // visible without the map jumping across the antimeridian.
    const markers = points.map(p => {
      const total = (p.phdScholars.length + p.mastersScholars.length);
      const radius = Math.min(28, 6 + total * 3);
      const color = total >= 5 ? '#7a1419' : total >= 3 ? '#c93e50' : total >= 2 ? '#e6550d' : '#fd8d3c';
      const displayLng = p.lng < 0 ? p.lng + 360 : p.lng;
      const m = L.circleMarker([p.lat, displayLng], {
        radius,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85
      });
      const phdList = p.phdScholars.length
        ? `<div style="margin-top:6px;"><strong style="color:#228B22;">PhD (${p.phdScholars.length}):</strong> ${p.phdScholars.join(', ')}</div>`
        : '';
      const mastersList = p.mastersScholars.length
        ? `<div style="margin-top:4px;"><strong style="color:#5f9c5f;">Masters (${p.mastersScholars.length}):</strong> ${p.mastersScholars.join(', ')}</div>`
        : '';
      m.bindPopup(
        `<div class="db-popup-title">${p.university}</div>` +
        `<p class="db-popup-meta">${p.country}</p>` +
        `<p class="db-popup-meta" style="margin-top:6px;"><span class="db-popup-count" style="font-size:1.5rem;color:${color};">${total}</span> iTaukei scholar${total === 1 ? '' : 's'} completed graduate work here</p>` +
        phdList + mastersList,
        { maxWidth: 320 }
      );
      m.on('mouseover', () => m.openPopup());
      return m;
    });

    state.worldLayer = L.layerGroup(markers).addTo(state.map);

    // Pacific-centric framing. Because iTaukei graduate work spans Fiji, NZ,
    // Australia, Hawaii, UK, Bremen — more than 180° of longitude — no single
    // Leaflet bounds can show them all without one edge or the other clipping.
    // We optimise for the primary Pacific cluster (Fiji + NZ + Australia +
    // Hawaii) which contains the vast majority of scholars. Europe points sit
    // shifted to 360+ and remain reachable by scroll/drag.
    state.map.setView([-5, 190], 3);
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
    push(b.thesisUnknown,   b.thesisUnknown === 1 ? 'Thesis' : 'Theses');
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
    // Confederacy tallies — total = sum of province-row totals (matches Panel D).
    // iTaukei column = strictly iTaukei lead-authored items only (first creator is iTaukei),
    // as specified in the revision notes.
    const byConf = { Burebasaga: {total:0, itaukei:0}, Kubuna: {total:0, itaukei:0}, Tovata: {total:0, itaukei:0} };
    const confByProv = new Map();
    state.provinces.features.forEach(f => confByProv.set(f.properties.name, f.properties.confederacy));
    items.forEach(it => {
      const provs = provOfItem.get(it.key);
      if (!provs || !provs.size) return;
      const isLead = itaukeiAuthorship(it) === 'lead';
      provs.forEach(p => {
        const c = confByProv.get(p);
        if (c && byConf[c]) {
          byConf[c].total += 1;
          if (isLead) byConf[c].itaukei += 1;
        }
      });
    });
    Object.keys(byConf).forEach(name => {
      const cell = document.querySelector(`[data-conf="${name}"]`);
      if (!cell) return;
      const t = byConf[name].total, k = byConf[name].itaukei;
      cell.innerHTML =
        `<span class="db-conf-row__stat"><strong>${t}</strong> Publications ` +
        `<span class="db-conf-row__stat--lead">[<strong>${k}</strong> iTaukei as Lead author]</span></span>`;
    });

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
  }

  // ============ PANEL B — ranked bar chart ============
  function renderPanelB() {
    const host = $('[data-db-bars]');
    if (!host) return;
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
    state.snapshot.items.forEach(it => {
      const vt = visualType(it);
      if (!state.typeSet.has(vt)) return;
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
      renderLeaders();
    });
    provSel.addEventListener('change', () => {
      state.scholarProvFilter = provSel.value;
      state.scholarPage = 1;
      renderLeaders();
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
    let rows = derived
      .filter(r => !hidden.has(r.name))
      .map(r => {
        // Merge order matters: enrichment (village, institution, photo, etc.)
        // sits UNDERNEATH the Zotero-derived counts (total, firstAuthored,
        // types, key, name). Otherwise old totals baked into scholar-profiles
        // .json at toggle-time would override the live Zotero numbers.
        const enrichment = enrichedByName.get(r.name) || {};
        const enriched = Object.assign({}, enrichment, r);
        enriched._prov = enrichment.paternalProvince || '';
        enriched._conf = enriched._prov ? (provConf.get(enriched._prov) || '') : '';
        return enriched;
      })
      .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

    // Apply confederacy filter
    const confF = state.scholarConfFilter;
    if (confF === '__untagged__') {
      rows = rows.filter(r => !r._conf);
    } else if (confF) {
      rows = rows.filter(r => r._conf === confF);
    }
    // Apply province filter
    const provF = state.scholarProvFilter;
    if (provF === '__untagged__') {
      rows = rows.filter(r => !r._prov);
    } else if (provF) {
      rows = rows.filter(r => r._prov === provF);
    }

    // Pagination state (10 per page)
    const totalPages = Math.max(1, Math.ceil(rows.length / SCHOLAR_PAGE_SIZE));
    if (state.scholarPage > totalPages) state.scholarPage = totalPages;
    const start = (state.scholarPage - 1) * SCHOLAR_PAGE_SIZE;
    const pageRows = rows.slice(start, start + SCHOLAR_PAGE_SIZE);

    grid.innerHTML = '';
    pageRows.forEach(r => grid.appendChild(renderScholarCard(r)));
    renderScholarPager(rows.length, totalPages);
  }

  // Derive scholar rows from the Zotero snapshot (independent of the enrichment JSON).
  // Returns [{ name ("Last, First"), key, total, firstAuthored, types }]
  function deriveScholarRows() {
    const cols = state.snapshot.collections;
    const root = cols.find(c => c.name === 'iTaukei authors (>3 papers)');
    if (!root) return [];
    const subs = cols.filter(c => c.parent === root.key);
    return subs.map(c => {
      const last = c.name.split(',')[0].trim().toLowerCase();
      const types = { journalArticle: 0, thesisPhd: 0, thesisMasters: 0, thesisUnknown: 0, bookSection: 0, book: 0, report: 0, conferencePaper: 0, preprint: 0 };
      let firstAuthored = 0;
      state.snapshot.items.forEach(it => {
        if (!(it.collections || []).includes(c.key)) return;
        const vt = visualType(it);
        if (types[vt] != null) types[vt] += 1;
        const creators = it.creators || [];
        if (creators.length) {
          const lastTok = (creators[0].includes(',') ? creators[0].split(',')[0].trim()
                                                    : creators[0].trim().split(/\s+/).pop()).toLowerCase();
          if (lastTok === last) firstAuthored += 1;
        }
      });
      return { name: c.name, key: c.key, total: c.numItems, firstAuthored, types };
    });
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
  const CHIP_ORDER = ['journalArticle', 'bookSection', 'book', 'thesisPhd', 'thesisMasters', 'thesisUnknown', 'report', 'conferencePaper', 'preprint'];

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
    const paternal = r.paternalProvince || '';
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
      // Ignore clicks on external-profile icons
      if (ev.target.closest('.db-scholar-card__gs, .db-scholar-card__orcid')) return;
      state.filter.scholar = state.filter.scholar === r.name ? '' : r.name;
      state.shown = state.pageSize;
      afterFilterChange();
      $('.db-items').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Photo (as background image) or initials fallback
    const photoHtml = r.photo
      ? `<div class="db-scholar-card__photo" style="background-image:url('${escapeAttr(r.photo)}')"></div>`
      : `<div class="db-scholar-card__photo"><div class="db-scholar-card__initials">${escapeHtml(initials)}</div></div>`;

    card.innerHTML = `
      <div class="db-scholar-card__banner"><span class="db-scholar-card__conf-label">${escapeHtml(bannerLabel)}</span></div>
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
      <div class="db-scholar-card__stats">
        <div class="db-scholar-card__stat"><span class="db-scholar-card__stat-num">${r.total}</span><span class="db-scholar-card__stat-label">Publication${r.total === 1 ? '' : 's'}</span></div>
        <div class="db-scholar-card__stat"><span class="db-scholar-card__stat-num accent">${r.firstAuthored}</span><span class="db-scholar-card__stat-label">First-authored</span></div>
      </div>
      ${chipsHtml ? `<div class="db-scholar-card__types">${chipsHtml}</div>` : ''}
    `;
    return card;
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
    const items = state.snapshot.items.filter(itemMatches);
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
  }

  // ============ EXPORT .BIB ============
  function exportBib() {
    const items = state.snapshot.items.filter(itemMatches);
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
  document.addEventListener('DOMContentLoaded', async () => {
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
    renderStats();
    renderDonut();
    populateDisciplineSelect();
    renderHistLegend();
    renderPanelB();
    renderPanelD();
    renderHistogram();
    renderLeaders();
    wireScholarFilters();
    wire();
    wireTypeFilter();
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
  });

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
      const c = confByProv.get(prof.paternalProvince || '');
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
