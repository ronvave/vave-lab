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

  const state = {
    snapshot: null,
    provinces: null,
    universities: null,
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
    const [snap, geo, unis, provFlat] = await Promise.all([
      fetchJson('data/itaukei-zotero-snapshot.json'),
      fetchJson('data/fiji-provinces.geojson'),
      fetchJson('data/world-universities.json'),
      fetchJson('data/fiji-provinces.json')
    ]);
    state.snapshot = snap;
    state.provinces = geo;
    state.universities = unis;

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

  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);
    return r.json();
  }

  function isItaukei(item) {
    return (item.collections || []).some(k => state.itaukeiKeys.has(k));
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
        center: [-17.7, 178.3],
        zoom: 7,
        minZoom: 2,
        maxZoom: 12,
        worldCopyJump: true,
        scrollWheelZoom: true
      });
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
        maxZoom: 18
      }).addTo(map);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        attribution: '', maxZoom: 18, opacity: 0.6
      }).addTo(map);
      state.map = map;

      renderProvincesOnMap();
      renderUniversitiesOnMap();

      $$('.db-map-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('.db-map-toggle button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
          state.view = btn.dataset.view;
          applyMapView();
        });
      });
      applyMapView();
    } catch (e) {
      console.error('Map init failed', e);
      const mapEl = $('#db-map');
      const err = $('[data-db-map-error]');
      if (mapEl) mapEl.style.display = 'none';
      if (err) err.style.display = 'block';
    }
  }

  function provinceBreakdown(view) {
    const geo = state.provinces;
    const items = state.snapshot.items;
    const result = new Map();
    geo.features.forEach(f => {
      const p = f.properties;
      const key = view === 'paternal'
        ? p.zoteroCollectionKey_paternalProvince
        : p.zoteroCollectionKey_publicationLocation;
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

  function renderProvincesOnMap() {
    if (state.provinceLayer) state.map.removeLayer(state.provinceLayer);
    if (state.provinceHaloLayer) state.map.removeLayer(state.provinceHaloLayer);
    if (state.provincePinsLayer) state.map.removeLayer(state.provincePinsLayer);
    const geo = state.provinces;
    const view = state.view;
    const counts = provinceBreakdown(view);

    state.provinceHaloLayer = L.geoJSON(geo, {
      style: () => ({ fillOpacity: 0, color: 'rgba(0,0,0,0.55)', weight: 7, opacity: 0.7, lineJoin: 'round' }),
      interactive: false
    }).addTo(state.map);

    state.provinceLayer = L.geoJSON(geo, {
      style: (feature) => ({
        fillOpacity: 0,
        color: CONF_COLORS[feature.properties.confederacy],
        weight: 3.5, opacity: 1, lineJoin: 'round', lineCap: 'round'
      }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const b = counts.get(p.name) || { total: 0 };
        layer.bindPopup(makeProvincePopup(p, b, view), { maxWidth: 260 });
        layer.on('click', () => setProvinceFilterFromMap(p.name, view));
      }
    }).addTo(state.map);

    const pins = [];
    geo.features.forEach(f => {
      const p = f.properties;
      const b = counts.get(p.name) || { total: 0 };
      const meta = state.provinceMetaByName.get(p.name);
      let lat = meta.centroid[0], lng = meta.centroid[1];
      if (lng < 0) lng += 360;
      const offset = PIN_OFFSETS[p.name];
      if (offset) { lat += offset[0]; lng += offset[1]; }
      const border = CONF_COLORS[p.confederacy];
      const html = `
        <div class="db-prov-pin" style="border-color:${border};">
          <div class="db-prov-pin__name">${p.name}</div>
          <div class="db-prov-pin__total" style="color:${border};">${b.total}</div>
        </div>`;
      const icon = L.divIcon({ className: 'db-prov-pin-wrap', html, iconSize: [72, 46], iconAnchor: [36, 46] });
      const m = L.marker([lat, lng], { icon, riseOnHover: true });
      m.bindPopup(makeProvincePopup(p, b, view), { maxWidth: 260, offset: [0, -38] });
      m.on('click', () => setProvinceFilterFromMap(p.name, view));
      pins.push(m);
    });
    state.provincePinsLayer = L.layerGroup(pins).addTo(state.map);
  }

  function setProvinceFilterFromMap(name, view) {
    if (view === 'paternal') {
      state.filter.paternal = state.filter.paternal === name ? '' : name;
      state.filter.province = '';
    } else {
      state.filter.province = state.filter.province === name ? '' : name;
      state.filter.paternal = '';
    }
    state.shown = state.pageSize;
    afterFilterChange();
  }

  function makeProvincePopup(p, b, view) {
    const label = view === 'paternal' ? 'iTaukei 1st-author from' : 'Research on';
    const rows = [];
    const push = (n, lbl) => { if (n > 0) rows.push(`<tr><td style="padding:2px 8px 2px 0;font-variant-numeric:tabular-nums;font-weight:700;color:${CONF_COLORS[p.confederacy]}">${n}</td><td style="padding:2px 0;color:#4b5563;">${lbl}</td></tr>`); };
    push(b.journalArticle,  'Journal Article' + (b.journalArticle === 1 ? '' : 's'));
    push(b.thesis,          'Thesis' + (b.thesis === 1 ? '' : 'es'));
    push(b.bookSection,     'Book Chapter' + (b.bookSection === 1 ? '' : 's'));
    push(b.book,            'Book' + (b.book === 1 ? '' : 's'));
    push(b.conferencePaper, 'Conference Paper' + (b.conferencePaper === 1 ? '' : 's'));
    push(b.report,          'Report' + (b.report === 1 ? '' : 's'));
    push(b.preprint,        'Preprint' + (b.preprint === 1 ? '' : 's'));
    const rowsHtml = rows.length ? `<table style="border-collapse:collapse;margin-top:6px;">${rows.join('')}</table>` : '<p class="db-popup-meta" style="opacity:0.6;">No items yet</p>';
    return `
      <div class="db-popup-title">${p.name} Province</div>
      <p class="db-popup-meta">${p.confederacy} Confederacy &middot; ${p.mainArea}</p>
      <p class="db-popup-meta" style="margin-top:6px;"><span class="db-popup-count" style="font-size:1.5rem;">${b.total}</span> total publications</p>
      <p class="db-popup-meta" style="font-size:0.75rem;font-style:italic;">${label} ${p.name}</p>
      ${rowsHtml}
      <p class="db-popup-meta" style="margin-top:8px;font-size:0.78rem;color:#0e7490;">Click to filter items below ↓</p>
    `;
  }

  function renderUniversitiesOnMap() {
    if (state.universityLayer) state.map.removeLayer(state.universityLayer);
    const unis = state.universities.universities;
    const layers = unis.map(u => {
      const r = 4 + 3 * Math.log2(u.thesisCount + 1);
      const m = L.circleMarker([u.location[0], u.location[1]], {
        radius: r, fillColor: '#062f35', color: '#ffffff', weight: 1.5, fillOpacity: 0.85
      });
      m.bindPopup(`
        <div class="db-popup-title">${u.name}</div>
        <p class="db-popup-meta">${u.city}, ${u.country}</p>
        <p class="db-popup-meta"><span class="db-popup-count">${u.thesisCount}</span> ${u.thesisCount === 1 ? 'thesis' : 'theses'} by iTaukei scholar${u.thesisCount === 1 ? '' : 's'}</p>
        <p class="db-popup-meta" style="margin-top:6px;">Click to filter items below</p>
      `);
      m.on('click', () => {
        state.filter.university = state.filter.university === u.name ? '' : u.name;
        state.shown = state.pageSize;
        afterFilterChange();
      });
      return m;
    });
    state.universityLayer = L.layerGroup(layers);
  }

  function applyMapView() {
    if (!state.map) return;
    if (state.view === 'universities') {
      if (state.provinceLayer) state.map.removeLayer(state.provinceLayer);
      if (state.provinceHaloLayer) state.map.removeLayer(state.provinceHaloLayer);
      if (state.provincePinsLayer) state.map.removeLayer(state.provincePinsLayer);
      state.universityLayer.addTo(state.map);
      state.map.setView([15, 100], 2);
    } else {
      if (state.universityLayer) state.map.removeLayer(state.universityLayer);
      renderProvincesOnMap();
      state.map.setView([-17.7, 179.4], 7);
    }
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

  // ============ YEAR HISTOGRAM ============
  function renderHistogram() {
    const items = state.snapshot.items;
    const byYear = new Map();
    items.forEach(i => { if (i.year) byYear.set(i.year, (byYear.get(i.year)||0)+1); });
    const years = Array.from(byYear.keys()).sort((a,b) => a-b);
    if (!years.length) return;
    const y0 = years[0], y1 = years[years.length-1];
    const svg = $('#db-histogram');
    svg.innerHTML = '';
    const W = 640, H = 220, PAD = 30;
    const range = y1 - y0 + 1;
    const bw = (W - PAD*2) / range;
    const maxN = Math.max(...byYear.values());
    for (let y = y0; y <= y1; y++) {
      const n = byYear.get(y) || 0;
      const h = n ? (H - PAD*2) * (n / maxN) : 0;
      const x = PAD + (y - y0) * bw;
      const isFocus = state.filter.year === y;
      const decadeStart = state.filter.decade ? parseInt(state.filter.decade, 10) : null;
      const inDecade = decadeStart != null && y >= decadeStart && y < decadeStart + 10;
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', x + 0.5);
      rect.setAttribute('y', H - PAD - h);
      rect.setAttribute('width', Math.max(1, bw - 1));
      rect.setAttribute('height', h);
      rect.setAttribute('fill', isFocus ? '#B23A48' : (inDecade ? '#c8a84b' : '#0e7490'));
      rect.setAttribute('opacity', n ? '0.85' : '0');
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => {
        state.filter.year = state.filter.year === y ? '' : y;
        state.shown = state.pageSize;
        afterFilterChange();
      });
      const t = document.createElementNS('http://www.w3.org/2000/svg','title');
      t.textContent = `${y} · ${n} publication${n===1?'':'s'}`;
      rect.appendChild(t);
      svg.appendChild(rect);
    }
    for (let y = Math.ceil(y0/10)*10; y <= y1; y += 10) {
      const x = PAD + (y - y0) * bw;
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', x); txt.setAttribute('y', H - PAD + 14);
      txt.setAttribute('font-family','DM Sans'); txt.setAttribute('font-size','10');
      txt.setAttribute('fill','#6b7280'); txt.setAttribute('text-anchor','middle');
      txt.textContent = y;
      svg.appendChild(txt);
    }
    // Populate decade dropdown once
    populateDecadeSelect(y0, y1);
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

  // ============ LEADERBOARD ============
  function renderLeaders() {
    const cols = state.snapshot.collections;
    const root = cols.find(c => c.name === 'iTaukei authors (>3 papers)');
    if (!root) return;
    const authors = cols.filter(c => c.parent === root.key)
      .map(c => ({ name: c.name, count: c.numItems, key: c.key }))
      .sort((a,b) => b.count - a.count);
    const grid = $('[data-db-leaders]');
    grid.innerHTML = '';
    authors.forEach(a => {
      const active = state.filter.scholar === a.name;
      const item = el('button', {
        className: 'db-leader' + (active ? ' is-active' : ''),
        type: 'button',
        title: `Filter items to papers in ${a.name}'s bucket`,
        onclick: () => {
          state.filter.scholar = state.filter.scholar === a.name ? '' : a.name;
          state.shown = state.pageSize;
          afterFilterChange();
          $('.db-items').scrollIntoView({behavior:'smooth', block:'start'});
        }
      },
        el('span', { className: 'db-leader__name' }, a.name),
        el('span', { className: 'db-leader__count' }, String(a.count))
      );
      grid.appendChild(item);
    });
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
    renderHistogram();
    renderLeaders();
    wire();
    renderItems();
    renderFilterChips();
    updateClearAllButton();

    // Init map once Leaflet has loaded
    const initMapWhenReady = () => {
      if (window.L) initMap();
      else setTimeout(initMapWhenReady, 100);
    };
    initMapWhenReady();

    backgroundRefresh();
  });
})();
