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
    thesis:          'Thesis',
    bookSection:     'Book Chapter',
    book:            'Book',
    conferencePaper: 'Conference',
    report:          'Report',
    preprint:        'Preprint',
    document:        'Document'
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
    thesis: '#6b3e26', journalArticle: '#0e7490', bookSection: '#7a1419',
    book: '#7a1419', report: '#1e40af', conferencePaper: '#92400e', preprint: '#6b7280',
    document: '#9ca3af'
  };
  const TYPE_ORDER = ['thesis','journalArticle','bookSection','book','report','conferencePaper','preprint'];

  const state = {
    snapshot: null,
    provinces: null,
    universities: null,
    mapView: 'all',                      // 'all' | 'lead' | 'coauth'
    typeSet: new Set(TYPE_ORDER),        // which types are shown in panels B, C, D
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
    const [snap, geo, unis, provFlat, profiles] = await Promise.all([
      fetchJson('data/itaukei-zotero-snapshot.json'),
      fetchJson('data/fiji-provinces.geojson'),
      fetchJson('data/world-universities.json'),
      fetchJson('data/fiji-provinces.json'),
      // Optional — enrichment file. Absence is fine (all cards will show placeholders).
      fetchJson('data/scholar-profiles.json').catch(() => ({ scholars: [] }))
    ]);
    state.snapshot = snap;
    state.provinces = geo;
    state.universities = unis;

    // Build the scholar-name look-up. Starts with the local JSON snapshot, then
    // overlays Google Sheet CSV if the admin has configured one (URL stored in
    // localStorage under 'vavelab_scholar_sheet_url').
    state.scholarProfilesByName = new Map();
    (profiles.scholars || []).forEach(p => {
      const name = (p.last && p.first) ? `${p.last}, ${p.first}` : (p.name || '');
      if (name) state.scholarProfilesByName.set(name, p);
    });
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
    const r = await fetch(url, { cache: 'no-cache' });
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

    // Sync badge — set from snapshot generatedAt
    const ago = relativeTime(snap.generatedAt);
    const iso = new Date(snap.generatedAt).toISOString();
    const daysOld = (Date.now() - new Date(snap.generatedAt).getTime()) / 86400000;
    const status = daysOld > 45 ? 'stale' : 'ok';
    setSyncBadge(status,
      `Synced ${ago}`,
      status === 'stale' ? 'Snapshot is over 45 days old — refresh pending' : ''
    );
    const badge = $('[data-db-sync]');
    if (badge) badge.setAttribute('title', `Snapshot generated ${iso}`);

    $('[data-db-updated]').textContent = `Snapshot generated ${new Date(snap.generatedAt).toLocaleString()} · ${snap.items.length} items indexed`;
  }

  // ============ MAP ============
  function initMap() {
    try {
      const map = L.map('db-map', {
        center: [-17.6, 178.5],
        zoom: 7,
        minZoom: 6,
        maxZoom: 12,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false
      });
      // Esri World Imagery (attributed "Esri — Esri, Maxar, Earthstar Geographics,
      // and the GIS User Community"). Sits under the choropleth polygons.
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 18
      }).addTo(map);
      state.map = map;
      renderChoropleth();

      // Panel A mapview toggle
      $$('.db-map-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('.db-map-toggle button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.mapView = btn.dataset.mapview;
          renderPanelA();
        });
      });

      // Bounds tuned to the crop in Ron's revision-notes screenshot: shows all
      // three confederacies (Viti Levu + Vanua Levu + Lau) without wasting
      // vertical whitespace above Vanua Levu or below Kadavu.
      map.fitBounds([[-19.7, 176.4], [-15.6, 180.8]], { padding: [8, 8] });
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
      const bucket = { total: 0, journalArticle: 0, thesis: 0, bookSection: 0, book: 0, conferencePaper: 0, report: 0, preprint: 0, document: 0 };
      if (key) {
        items.forEach(it => {
          if ((it.collections || []).includes(key)) {
            bucket.total += 1;
            if (bucket[it.itemType] != null) bucket[it.itemType] += 1;
          }
        });
      }
      result.set(p.name, bucket);
    });
    return result;
  }

  function choroFill(n) {
    if (n === 0) return '#e8f2f3';
    if (n <= 3) return '#a9d3d8';
    if (n <= 6) return '#5fa6ae';
    if (n <= 9) return '#0e7490';
    return '#062f35';
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
        layer.bindPopup(makeProvincePopup(p, b), { maxWidth: 260 });
        layer.on('mouseover', () => layer.setStyle({ weight: 4 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 2.5 }));
        layer.on('click', () => setProvinceFilterFromMap(p.name));
      }
    }).addTo(state.map);
  }

  function setProvinceFilterFromMap(name) {
    state.filter.province = state.filter.province === name ? '' : name;
    state.filter.paternal = '';
    state.shown = state.pageSize;
    afterFilterChange();
  }

  function makeProvincePopup(p, b) {
    const viewLabel = state.mapView === 'lead'
      ? 'iTaukei lead-authored'
      : (state.mapView === 'coauth' ? 'Co-authored with iTaukei' : 'All publications on');
    const rows = [];
    const push = (n, lbl) => { if (n > 0) rows.push(`<tr><td style="padding:2px 8px 2px 0;font-variant-numeric:tabular-nums;font-weight:700;color:${CONF_COLORS[p.confederacy]}">${n}</td><td style="padding:2px 0;color:#4b5563;">${lbl}</td></tr>`); };
    push(b.journalArticle,  'Journal Article' + (b.journalArticle === 1 ? '' : 's'));
    push(b.thesis,          'Thesis' + (b.thesis === 1 ? '' : 'es'));
    push(b.bookSection,     'Book Chapter' + (b.bookSection === 1 ? '' : 's'));
    push(b.book,            'Book' + (b.book === 1 ? '' : 's'));
    push(b.conferencePaper, 'Conference Paper' + (b.conferencePaper === 1 ? '' : 's'));
    push(b.report,          'Report' + (b.report === 1 ? '' : 's'));
    push(b.preprint,        'Preprint' + (b.preprint === 1 ? '' : 's'));
    const rowsHtml = rows.length ? `<table style="border-collapse:collapse;margin-top:6px;">${rows.join('')}</table>` : '<p class="db-popup-meta" style="opacity:0.6;">No items in this view</p>';
    return `
      <div class="db-popup-title">${p.name} Province</div>
      <p class="db-popup-meta">${p.confederacy} Confederacy &middot; ${p.mainArea}</p>
      <p class="db-popup-meta" style="margin-top:6px;"><span class="db-popup-count" style="font-size:1.5rem;">${b.total}</span> ${viewLabel} ${p.name}</p>
      ${rowsHtml}
      <p class="db-popup-meta" style="margin-top:8px;font-size:0.78rem;color:#0e7490;">Click to filter items below ↓</p>
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
      if (cell) cell.innerHTML = `${byConf[name].total} <span style="color:var(--color-text-muted);font-weight:400;">|</span> <em>${byConf[name].itaukei}</em>`;
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

    // Sync inline
    const inline = $('[data-db-sync-inline]');
    if (inline && state.snapshot) {
      const iso = state.snapshot.generatedAt;
      const d = new Date(iso);
      inline.textContent = `${relativeTime(iso)} · ${d.toLocaleDateString(undefined,{month:'short', day:'numeric', year:'numeric'})}`;
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
      if (!state.typeSet.has(it.itemType)) return;
      const ps = state.provincesByItem.get(it.key);
      if (!ps) return;
      ps.forEach(name => {
        const bucket = byProv.get(name);
        if (bucket) {
          bucket.total += 1;
          bucket.types[it.itemType] = (bucket.types[it.itemType] || 0) + 1;
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
      if (!state.typeSet.has(it.itemType)) return;
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

    // Count items per type in the current snapshot
    const typeCounts = new Map();
    state.snapshot.items.forEach(it => {
      typeCounts.set(it.itemType, (typeCounts.get(it.itemType) || 0) + 1);
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
    state.snapshot.items.forEach(it => counts.set(it.itemType, (counts.get(it.itemType) || 0) + 1));
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

  // ============ SOURCE-TYPE HISTOGRAM (Panel C) — filtered by typeSet ============
  // One bar per item type. Reflects the checkboxes in Panel B.
  function renderHistogram() {
    const items = state.snapshot.items;
    // Total items per type (all in the snapshot; we grey-out types not in typeSet)
    const byType = new Map();
    items.forEach(i => byType.set(i.itemType, (byType.get(i.itemType) || 0) + 1));
    // Only include types that (a) exist in the data and (b) are currently enabled
    const visible = TYPE_ORDER.filter(t => (byType.get(t) || 0) > 0 && state.typeSet.has(t));

    // Keep the item-list decade dropdown populated (was a side effect of the old
    // year histogram). Populate here from the item snapshot instead.
    const yearsAll = items.map(i => i.year).filter(y => y);
    if (yearsAll.length) populateDecadeSelect(Math.min(...yearsAll), Math.max(...yearsAll));

    const svg = $('#db-source-histogram');
    if (!svg) return;
    svg.innerHTML = '';

    if (!visible.length) {
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', 450); t.setAttribute('y', 170);
      t.setAttribute('text-anchor','middle'); t.setAttribute('font-family','DM Sans');
      t.setAttribute('font-size','15'); t.setAttribute('fill','#6b7280');
      t.textContent = 'No item types selected — check at least one in panel B.';
      svg.appendChild(t);
      return;
    }

    const W = 900, H = 340;
    const PAD_LEFT = 190, PAD_RIGHT = 90, PAD_TOP = 20, PAD_BOTTOM = 20;
    const rowH = (H - PAD_TOP - PAD_BOTTOM) / visible.length;
    const barH = Math.min(38, rowH - 12);
    const maxN = Math.max(...visible.map(t => byType.get(t) || 0));
    const scale = (W - PAD_LEFT - PAD_RIGHT) / maxN;

    visible.forEach((t, i) => {
      const n = byType.get(t) || 0;
      const y = PAD_TOP + i * rowH + (rowH - barH) / 2;
      // Row label
      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x', PAD_LEFT - 12);
      label.setAttribute('y', y + barH / 2 + 4);
      label.setAttribute('text-anchor','end');
      label.setAttribute('font-family','DM Sans');
      label.setAttribute('font-size','14');
      label.setAttribute('font-weight','600');
      label.setAttribute('fill','#1a1a1a');
      label.textContent = TYPE_LABELS[t] || t;
      svg.appendChild(label);
      // Bar
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', PAD_LEFT);
      rect.setAttribute('y', y);
      rect.setAttribute('width', Math.max(2, n * scale));
      rect.setAttribute('height', barH);
      rect.setAttribute('fill', TYPE_COLOR[t]);
      rect.setAttribute('rx', 3);
      const ttl = document.createElementNS('http://www.w3.org/2000/svg','title');
      ttl.textContent = `${TYPE_LABELS[t] || t} · ${n} publication${n===1?'':'s'}`;
      rect.appendChild(ttl);
      svg.appendChild(rect);
      // Count label at bar end
      const num = document.createElementNS('http://www.w3.org/2000/svg','text');
      num.setAttribute('x', PAD_LEFT + n * scale + 10);
      num.setAttribute('y', y + barH / 2 + 5);
      num.setAttribute('text-anchor','start');
      num.setAttribute('font-family','Cormorant Garamond, serif');
      num.setAttribute('font-size','20');
      num.setAttribute('font-weight','600');
      num.setAttribute('fill','#062f35');
      num.textContent = n;
      svg.appendChild(num);
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
  const SCHOLAR_PAGE_SIZE = 10;
  state.scholarPage = 1;

  // Placeholder silhouette shown when no photo is provided
  const PHOTO_PLACEHOLDER_SVG = `
    <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="50" cy="40" r="22" fill="#b6bcc2"/>
      <path d="M12 120 C 12 85, 88 85, 88 120 Z" fill="#b6bcc2"/>
    </svg>`;

  function renderLeaders() {
    const grid = $('[data-db-leaders]');
    if (!grid) return;

    // Build the sorted, enriched scholar list. Enrichment comes from
    // data/scholar-profiles.json (loaded once during init). If a profile row is
    // missing we still render the card using derived counts.
    const derived = deriveScholarRows();
    const enrichedByName = state.scholarProfilesByName || new Map();
    const rows = derived
      .map(r => Object.assign({}, r, enrichedByName.get(r.name) || {}))
      .sort((a, b) => b.total - a.total);

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
      const types = { journalArticle: 0, thesis: 0, bookSection: 0, book: 0, report: 0 };
      let firstAuthored = 0;
      state.snapshot.items.forEach(it => {
        if (!(it.collections || []).includes(c.key)) return;
        if (types[it.itemType] != null) types[it.itemType] += 1;
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

  function renderScholarCard(r) {
    const active = state.filter.scholar === r.name;
    const salutation = r.salutation || '';
    const first = r.first || (r.name.includes(',') ? r.name.split(',')[1].trim() : '');
    const last  = r.last  || (r.name.includes(',') ? r.name.split(',')[0].trim() : r.name);
    const displayName = `${salutation ? salutation + ' ' : ''}${first} ${last}`.trim();
    const village = r.village || '';
    const paternal = r.paternalProvince || '';
    const villageLine = (village || paternal)
      ? `${village}${village && paternal ? ', ' : ''}${paternal ? paternal + ' Province' : ''}`
      : '';
    const institution = r.institution || '';
    const t = r.types || {};

    const card = document.createElement('article');
    card.className = 'db-scholar-card' + (active ? ' is-active' : '');
    card.title = `Click to filter items to ${r.name}’s papers`;
    card.addEventListener('click', ev => {
      // Ignore clicks on the Google Scholar link
      if (ev.target.closest('.db-scholar-card__scholar')) return;
      state.filter.scholar = state.filter.scholar === r.name ? '' : r.name;
      state.shown = state.pageSize;
      afterFilterChange();
      $('.db-items').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Photo
    const photoBox = document.createElement('div');
    photoBox.className = 'db-scholar-card__photo';
    if (r.photo) photoBox.style.backgroundImage = `url('${escapeAttr(r.photo)}')`;
    else photoBox.innerHTML = PHOTO_PLACEHOLDER_SVG;
    card.appendChild(photoBox);

    // Body
    const body = document.createElement('div');
    body.className = 'db-scholar-card__body';
    body.innerHTML = `
      <div class="db-scholar-card__row">
        <span class="db-scholar-card__key">Name:</span>
        <span class="db-scholar-card__val">${escapeHtml(displayName || (first + ' ' + last).trim())}</span>
      </div>
      <div class="db-scholar-card__row">
        <span class="db-scholar-card__key">Village:</span>
        <span class="${villageLine ? 'db-scholar-card__val' : 'db-scholar-card__val--empty'}">${villageLine ? escapeHtml(villageLine) : 'Village &amp; Province name'}</span>
      </div>
      <div class="db-scholar-card__institution">${institution
          ? (r.institutionUrl
              ? `<a href="${escapeAttr(r.institutionUrl)}" target="_blank" rel="noopener">${escapeHtml(institution)}</a>`
              : escapeHtml(institution))
          : '<span class="db-scholar-card__val--empty">Institution name</span>'}</div>
      <div class="db-scholar-card__totals">
        Total: <span class="db-scholar-card__totals--num-total">${r.total} Publication${r.total === 1 ? '' : 's'}</span> &nbsp;|&nbsp; <span class="db-scholar-card__totals--num-first">${r.firstAuthored} First authored</span>
      </div>
      <div class="db-scholar-card__types">
        <span>Journal articles: <em>${t.journalArticle || 0}</em></span>
        <span>Reports: <em>${t.report || 0}</em></span>
        <span>Books: <em>${t.book || 0}</em></span>
        <span>Book chapters: <em>${t.bookSection || 0}</em></span>
      </div>
    `;
    card.appendChild(body);

    // Google Scholar link (top right)
    const scholarBtn = document.createElement('a');
    scholarBtn.className = 'db-scholar-card__scholar' + (r.googleScholarUrl ? '' : ' is-missing');
    scholarBtn.href = r.googleScholarUrl || '#';
    if (r.googleScholarUrl) { scholarBtn.target = '_blank'; scholarBtn.rel = 'noopener'; }
    scholarBtn.title = r.googleScholarUrl ? 'Open Google Scholar profile' : 'Google Scholar profile not yet linked';
    scholarBtn.innerHTML = `<img src="img/icons/google-scholar.png" alt="Google Scholar" />`;
    card.appendChild(scholarBtn);

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
    if (f.itemType && item.itemType !== f.itemType) return false;
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
    const li = el('li', { className: 'db-item', 'data-type': it.itemType });
    const type = TYPE_LABELS[it.itemType] || TYPE_LABELS.document;
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
    wire();
    wireTypeFilter();
    renderItems();
    renderFilterChips();
    updateClearAllButton();

    // Init map once Leaflet has loaded, then paint Panel A tallies + sync
    const initMapWhenReady = () => {
      if (window.L) { initMap(); renderPanelA(); }
      else setTimeout(initMapWhenReady, 100);
    };
    initMapWhenReady();

    backgroundRefresh();
  });
})();
