/*
 * iTaukei Scholarly Research Database
 * Loads /data/itaukei-zotero-snapshot.json, /data/fiji-provinces.geojson, and
 * /data/world-universities.json, then renders an interactive map, charts, and filterable table.
 * A background live-fetch to api.zotero.org keeps totals fresh; falls back to the snapshot on error.
 */
(function () {
  'use strict';

  // Bright, satellite-legible border colors — one per chiefly confederacy
  const CONF_COLORS = {
    Burebasaga: '#FF5A6E',  // vivid coral
    Kubuna:     '#4ECDE6',  // bright cyan
    Tovata:     '#FFD84A'   // bright gold
  };
  const TYPE_LABELS = {
    journalArticle:  { short: 'Journal Article', klass: 'journal' },
    thesis:          { short: 'Thesis',          klass: 'thesis'  },
    bookSection:     { short: 'Book Chapter',    klass: 'chapter' },
    book:            { short: 'Book',            klass: 'book'    },
    conferencePaper: { short: 'Conference',      klass: 'conf'    },
    report:          { short: 'Report',          klass: 'report'  },
    preprint:        { short: 'Preprint',        klass: 'other'   },
    document:        { short: 'Document',        klass: 'other'   }
  };

  const state = {
    snapshot: null,
    provinces: null,
    universities: null,
    filter: { search: '', itemType: '', province: null, paternalProvince: null, university: null, year: null, itaukei: null },
    pageSize: 25,
    shown: 25,
    view: 'location',
    map: null,
    provinceLayer: null,
    universityLayer: null,
    itaukeiKeys: new Set()
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'className') n.className = attrs[k];
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(n.style, attrs[k]);
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  }

  // ============ DATA LOAD ============
  async function loadAll() {
    const [snap, geo, unis] = await Promise.all([
      fetch('data/itaukei-zotero-snapshot.json').then(r => r.json()),
      fetch('data/fiji-provinces.geojson').then(r => r.json()),
      fetch('data/world-universities.json').then(r => r.json())
    ]);
    state.snapshot = snap;
    state.provinces = geo;
    state.universities = unis;

    // Cache province metadata by name for centroid lookup
    state.provinceMetaByName = new Map();
    // Fetch flat province index (has centroids)
    const provFlat = await fetch('data/fiji-provinces.json').then(r => r.json());
    provFlat.provinces.forEach(p => state.provinceMetaByName.set(p.name, p));

    // Pre-compute which collection keys correspond to "iTaukei-authored" bucket
    const itaukeiParents = snap.collections.filter(c =>
      c.name === 'By or with iTaukei authors' || c.name.startsWith('iTaukei authors')
    );
    const itaukeiParentKeys = new Set(itaukeiParents.map(c => c.key));
    // Author-name buckets are children of "iTaukei authors (>3 papers)"
    const authorRoot = snap.collections.find(c => c.name === 'iTaukei authors (>3 papers)');
    if (authorRoot) {
      snap.collections.forEach(c => {
        if (c.parent === authorRoot.key) itaukeiParentKeys.add(c.key);
      });
    }
    // Also the "By or with iTaukei authors" collection itself
    const byWith = snap.collections.find(c => c.name === 'By or with iTaukei authors');
    if (byWith) itaukeiParentKeys.add(byWith.key);
    state.itaukeiKeys = itaukeiParentKeys;

    // Build a quick lookup: collectionKey -> collection object
    state.colByKey = new Map(snap.collections.map(c => [c.key, c]));
  }

  function isItaukei(item) {
    return item.collections.some(k => state.itaukeiKeys.has(k));
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
    $('[data-db-updated]').textContent = 'Snapshot generated ' + new Date(snap.generatedAt).toLocaleString();
  }

  // ============ MAP ============
  function initMap() {
    const map = L.map('db-map', {
      center: [-17.7, 178.3],
      zoom: 7,
      minZoom: 2,
      maxZoom: 12,
      worldCopyJump: true,
      scrollWheelZoom: true
    });
    // Esri World Imagery satellite layer
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Imagery &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
      maxZoom: 18
    }).addTo(map);
    // Ocean labels & country boundaries overlay (thin reference layer)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      attribution: '',
      maxZoom: 18,
      opacity: 0.6
    }).addTo(map);
    state.map = map;

    // Build province polygons + confederacy boundary overlay
    renderProvincesOnMap();
    renderUniversitiesOnMap();

    // Toggle handlers
    $$('.db-map-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.db-map-toggle button').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
        btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
        state.view = btn.dataset.view;
        applyMapView();
      });
    });
    applyMapView();
  }

  // Compute per-province breakdown by item type using Zotero collection membership
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
          if (it.collections.includes(key)) {
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
    if (state.provincePinsLayer) state.map.removeLayer(state.provincePinsLayer);
    const geo = state.provinces;
    const view = state.view;
    const counts = provinceBreakdown(view);

    // 1) Halo layer under the polygon strokes so borders read on satellite
    state.provinceHaloLayer = L.geoJSON(geo, {
      style: () => ({
        fillOpacity: 0,
        color: 'rgba(0,0,0,0.55)',
        weight: 7,
        opacity: 0.7,
        lineJoin: 'round'
      }),
      interactive: false
    }).addTo(state.map);

    // 2) Province polygons: NO fill, thick colored border by confederacy
    state.provinceLayer = L.geoJSON(geo, {
      style: (feature) => {
        const conf = feature.properties.confederacy;
        return {
          fillOpacity: 0,
          color: CONF_COLORS[conf],
          weight: 3.5,
          opacity: 1,
          lineJoin: 'round',
          lineCap: 'round'
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const b = counts.get(p.name) || { total: 0 };
        layer.bindPopup(makeProvincePopup(p, b, view), { maxWidth: 260 });
        layer.on('click', () => {
          if (view === 'paternal') {
            state.filter.paternalProvince = state.filter.paternalProvince === p.name ? null : p.name;
            state.filter.province = null;
          } else {
            state.filter.province = state.filter.province === p.name ? null : p.name;
            state.filter.paternalProvince = null;
          }
          state.shown = state.pageSize;
          renderItems(); renderFilterChips();
        });
      }
    }).addTo(state.map);

    // 3) Compact data pins at pin-offset positions to avoid overlap on Viti Levu
    const pins = [];
    geo.features.forEach(f => {
      const p = f.properties;
      const b = counts.get(p.name) || { total: 0 };
      const meta = state.provinceMetaByName.get(p.name);
      let lat = meta.centroid[0], lng = meta.centroid[1];
      if (lng < 0) lng += 360; // antimeridian shift for Lau
      const offset = PIN_OFFSETS[p.name];
      if (offset) { lat += offset[0]; lng += offset[1]; }

      const border = CONF_COLORS[p.confederacy];
      const html = `
        <div class="db-prov-pin" style="border-color:${border};">
          <div class="db-prov-pin__name">${p.name}</div>
          <div class="db-prov-pin__total" style="color:${border};">${b.total}</div>
        </div>`;
      const icon = L.divIcon({
        className: 'db-prov-pin-wrap',
        html,
        iconSize: [72, 46],
        iconAnchor: [36, 46]
      });
      const m = L.marker([lat, lng], { icon, riseOnHover: true });
      m.bindPopup(makeProvincePopup(p, b, view), { maxWidth: 260, offset: [0, -38] });
      m.on('click', (e) => {
        // First open the detailed popup, then set the filter
        if (view === 'paternal') {
          state.filter.paternalProvince = state.filter.paternalProvince === p.name ? null : p.name;
          state.filter.province = null;
        } else {
          state.filter.province = state.filter.province === p.name ? null : p.name;
          state.filter.paternalProvince = null;
        }
        state.shown = state.pageSize;
        renderItems(); renderFilterChips();
      });
      pins.push(m);
    });
    state.provincePinsLayer = L.layerGroup(pins).addTo(state.map);
  }

  // Build the rich popup content shared by polygons and pins
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

  // Manual offsets (in decimal degrees) to pull pins apart on the mainland cluster.
  // Positive lat = north, positive lng = east.
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

  function renderUniversitiesOnMap() {
    if (state.universityLayer) state.map.removeLayer(state.universityLayer);
    const unis = state.universities.universities;
    const layers = unis.map(u => {
      const r = 4 + 3 * Math.log2(u.thesisCount + 1);
      const m = L.circleMarker([u.location[0], u.location[1]], {
        radius: r,
        fillColor: '#062f35',
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.85
      });
      m.bindPopup(`
        <div class="db-popup-title">${u.name}</div>
        <p class="db-popup-meta">${u.city}, ${u.country}</p>
        <p class="db-popup-meta"><span class="db-popup-count">${u.thesisCount}</span> ${u.thesisCount === 1 ? 'thesis' : 'theses'} by iTaukei scholar${u.thesisCount === 1 ? '' : 's'}</p>
        <p class="db-popup-meta" style="margin-top:6px;">Click to filter items below</p>
      `);
      m.on('click', () => {
        state.filter.university = state.filter.university === u.name ? null : u.name;
        state.shown = state.pageSize;
        renderItems(); renderFilterChips();
      });
      return m;
    });
    state.universityLayer = L.layerGroup(layers);
  }

  function applyMapView() {
    // Provinces visible only when NOT in universities view
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
  function renderDonut() {
    const items = state.snapshot.items;
    const cols = state.snapshot.collections;
    const disciplineRoot = cols.find(c => c.name === 'Discipline');
    if (!disciplineRoot) return;
    // Build item -> set of disciplines via collection membership
    const disciplineByKey = new Map();
    cols.forEach(c => {
      if (c.parent === disciplineRoot.key || (c.parent && disciplineByKey.has(c.parent))) {
        // Walk up to root discipline
        let cur = c, root = null;
        while (cur) {
          if (cur.parent === disciplineRoot.key) { root = cur; break; }
          cur = cols.find(x => x.key === cur.parent);
          if (!cur) break;
        }
        if (root) disciplineByKey.set(c.key, root.name);
      }
    });
    const counts = {};
    items.forEach(i => {
      const seen = new Set();
      i.collections.forEach(k => {
        const disc = disciplineByKey.get(k);
        if (disc && !seen.has(disc)) { counts[disc] = (counts[disc]||0) + 1; seen.add(disc); }
      });
    });
    const total = Object.values(counts).reduce((a,b) => a+b, 0);
    const entries = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    // Palette
    const palette = ['#0e7490','#6b3e26','#7a1419','#c8a84b','#3d5a35','#1e40af','#a8431f','#4b5563','#B23A48','#1F6E8C','#7c3aed','#0f766e','#92400e'];
    const svg = $('#db-donut');
    svg.innerHTML = '';
    const cx = 120, cy = 120, R = 100, r = 60;
    let a0 = -Math.PI/2;
    entries.forEach(([name, n], i) => {
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
      p.setAttribute('fill', palette[i % palette.length]);
      p.setAttribute('stroke', '#fff');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('data-discipline', name);
      p.style.cursor = 'pointer';
      p.addEventListener('mouseenter', () => p.setAttribute('opacity', '0.75'));
      p.addEventListener('mouseleave', () => p.setAttribute('opacity', '1'));
      svg.appendChild(p);
      a0 = a1;
    });
    // Center text
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

    // Legend
    const leg = $('#db-donut-legend');
    leg.innerHTML = '';
    entries.forEach(([name, n], i) => {
      const row = el('div', { style: 'display:flex;align-items:center;gap:6px;padding:3px 0;' },
        el('span', { style: `width:12px;height:12px;border-radius:2px;display:inline-block;background:${palette[i % palette.length]};` }),
        el('span', { style: 'flex:1;color:var(--color-text);' }, name),
        el('span', { style: 'color:var(--color-text-muted);font-weight:600;' }, String(n))
      );
      leg.appendChild(row);
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
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', x + 0.5);
      rect.setAttribute('y', H - PAD - h);
      rect.setAttribute('width', Math.max(1, bw - 1));
      rect.setAttribute('height', h);
      rect.setAttribute('fill', state.filter.year === y ? '#B23A48' : '#0e7490');
      rect.setAttribute('opacity', n ? '0.85' : '0');
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => {
        state.filter.year = state.filter.year === y ? null : y;
        state.shown = state.pageSize;
        renderHistogram(); renderItems(); renderFilterChips();
      });
      const t = document.createElementNS('http://www.w3.org/2000/svg','title');
      t.textContent = `${y} · ${n} publication${n===1?'':'s'}`;
      rect.appendChild(t);
      svg.appendChild(rect);
    }
    // X-axis year labels (decades)
    for (let y = Math.ceil(y0/10)*10; y <= y1; y += 10) {
      const x = PAD + (y - y0) * bw;
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', x); txt.setAttribute('y', H - PAD + 14);
      txt.setAttribute('font-family','DM Sans'); txt.setAttribute('font-size','10');
      txt.setAttribute('fill','#6b7280'); txt.setAttribute('text-anchor','middle');
      txt.textContent = y;
      svg.appendChild(txt);
    }
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
      const item = el('button', {
        className: 'db-leader',
        type: 'button',
        onclick: () => {
          state.filter.search = a.name.split(',')[0]; // filter by last name
          $('[data-db-search]').value = state.filter.search;
          state.shown = state.pageSize;
          renderItems(); renderFilterChips();
          $('.db-items').scrollIntoView({behavior:'smooth', block:'start'});
        }
      },
        el('span', { className: 'db-leader__name' }, a.name),
        el('span', { className: 'db-leader__count' }, String(a.count))
      );
      grid.appendChild(item);
    });
  }

  // ============ ITEMS TABLE + FILTERS ============
  function itemMatches(item) {
    const f = state.filter;
    if (f.itemType && item.itemType !== f.itemType) return false;
    if (f.year && item.year !== f.year) return false;
    if (f.province) {
      const provCol = state.provinces.features.find(feat => feat.properties.name === f.province);
      const key = provCol && provCol.properties.zoteroCollectionKey_publicationLocation;
      if (!key || !item.collections.includes(key)) return false;
    }
    if (f.paternalProvince) {
      const provCol = state.provinces.features.find(feat => feat.properties.name === f.paternalProvince);
      const key = provCol && provCol.properties.zoteroCollectionKey_paternalProvince;
      if (!key || !item.collections.includes(key)) return false;
    }
    if (f.university) {
      const uni = state.universities.universities.find(u => u.name === f.university);
      if (!uni || !item.collections.includes(uni.zoteroCollectionKey)) return false;
    }
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = [item.title, item.publicationTitle, item.university, ...(item.creators||[])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderItems() {
    const items = state.snapshot.items.filter(itemMatches);
    // Sort by year desc, then title
    items.sort((a,b) => (b.year||0) - (a.year||0) || a.title.localeCompare(b.title));
    const list = $('[data-db-items]');
    list.innerHTML = '';
    const shown = items.slice(0, state.shown);
    $('[data-db-item-count]').textContent = items.length;
    shown.forEach(it => {
      const authorList = (it.creators || []).slice(0, 5).join(', ') + (it.creators.length > 5 ? ', et al.' : '');
      const type = TYPE_LABELS[it.itemType] || TYPE_LABELS.document;
      const zoteroUrl = `https://www.zotero.org/groups/5983386/itaukei_academic_research/items/${it.key}`;
      const primaryLink = it.DOI ? `https://doi.org/${it.DOI}` : (it.url || zoteroUrl);
      const meta = [];
      if (it.year) meta.push(it.year);
      if (it.publicationTitle) meta.push(`<em>${escapeHtml(it.publicationTitle)}</em>`);
      if (it.university) meta.push(escapeHtml(it.university));
      if (it.thesisType) meta.push(escapeHtml(it.thesisType));

      const li = el('li', { className: 'db-item' });
      li.innerHTML = `
        <p class="db-item__title"><a href="${escapeAttr(primaryLink)}" target="_blank" rel="noopener">${escapeHtml(it.title || '(untitled)')}</a></p>
        <p class="db-item__meta">${escapeHtml(authorList)}</p>
        <p class="db-item__meta">${meta.join(' &middot; ')}</p>
        <div class="db-item__badges">
          <span class="db-item__badge db-item__badge--type-${type.klass}">${type.short}</span>
          ${isItaukei(it) ? '<span class="db-item__badge db-item__badge--itaukei">iTaukei author</span>' : ''}
          <a href="${escapeAttr(zoteroUrl)}" target="_blank" rel="noopener" class="db-item__badge" style="background:#e5e7eb;color:#374151;text-decoration:none;">Zotero</a>
        </div>
      `;
      list.appendChild(li);
    });
    const btn = $('[data-db-load-more]');
    btn.hidden = state.shown >= items.length;
    btn.textContent = `Show ${Math.min(25, items.length - state.shown)} more (${items.length - state.shown} remaining)`;
  }

  function renderFilterChips() {
    const chips = $('#db-filter-chips');
    chips.innerHTML = '';
    const add = (label, clear) => {
      const c = el('span', { className: 'db-filter-chip' }, label);
      const x = el('button', { type: 'button', 'aria-label': 'Clear filter', onclick: () => { clear(); state.shown = state.pageSize; renderItems(); renderFilterChips(); if (state.provinceLayer) applyMapView(); renderHistogram(); } }, '×');
      c.appendChild(x);
      chips.appendChild(c);
    };
    if (state.filter.province)         add(`Province: ${state.filter.province}`,           () => state.filter.province = null);
    if (state.filter.paternalProvince) add(`Paternal: ${state.filter.paternalProvince}`,   () => state.filter.paternalProvince = null);
    if (state.filter.university)       add(`University: ${state.filter.university}`,       () => state.filter.university = null);
    if (state.filter.year)             add(`Year: ${state.filter.year}`,                   () => state.filter.year = null);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ============ EXPORT .BIB ============
  function exportBib() {
    const items = state.snapshot.items.filter(itemMatches);
    let out = '';
    items.forEach(it => {
      const bibType = ({journalArticle:'article', thesis:'phdthesis', bookSection:'incollection', book:'book', conferencePaper:'inproceedings', report:'techreport', preprint:'misc', document:'misc'})[it.itemType] || 'misc';
      const key = (it.creators[0]?.split(' ').pop() || 'anon').toLowerCase().replace(/\W/g,'') + (it.year || '');
      out += `@${bibType}{${key},\n`;
      out += `  title = {${it.title.replace(/[{}]/g,'')}},\n`;
      if (it.creators.length) out += `  author = {${it.creators.map(c => c.replace(/[{}]/g,'')).join(' and ')}},\n`;
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
    $('[data-db-search]').addEventListener('input', e => {
      state.filter.search = e.target.value.trim();
      state.shown = state.pageSize;
      renderItems();
    });
    $('[data-db-filter="itemType"]').addEventListener('change', e => {
      state.filter.itemType = e.target.value;
      state.shown = state.pageSize;
      renderItems();
    });
    $('[data-db-load-more]').addEventListener('click', () => {
      state.shown += state.pageSize;
      renderItems();
    });
    $('[data-db-export="bib"]').addEventListener('click', exportBib);
  }

  // ============ LIVE REFRESH (background) ============
  async function backgroundRefresh() {
    try {
      const r = await fetch('https://api.zotero.org/groups/5983386?format=json');
      if (!r.ok) return;
      const d = await r.json();
      const live = d.meta && d.meta.numItems;
      if (live && Math.abs(live - state.snapshot.totals.items) > 0) {
        const note = $('[data-db-updated]');
        note.innerHTML = `Snapshot has <strong>${state.snapshot.totals.items}</strong> items; the live Zotero library now has <strong>${live}</strong>. <a href="https://www.zotero.org/groups/5983386/itaukei_academic_research/library" target="_blank" rel="noopener" style="color:#0E7490;text-decoration:underline;">Open the live library</a> for the latest additions.`;
      }
    } catch (e) { /* silent */ }
  }

  // ============ INIT ============
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await loadAll();
    } catch (err) {
      console.error('Failed to load database data', err);
      $('[data-db-updated]').textContent = 'Unable to load the database. Please refresh the page.';
      return;
    }
    renderStats();
    renderDonut();
    renderHistogram();
    renderLeaders();
    wire();
    renderItems();

    // Init map once Leaflet has loaded
    const initMapWhenReady = () => {
      if (window.L) initMap();
      else setTimeout(initMapWhenReady, 100);
    };
    initMapWhenReady();

    backgroundRefresh();
  });
})();
