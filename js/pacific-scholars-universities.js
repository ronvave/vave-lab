/* Panel C1 · Universities view, for the Regional Pacific Scholars Dashboard.
   Same idea as the Fiji dashboard's university map: one circle per university,
   sized by completed degrees. The popup counts Pacific scholars by home country
   (Master's and PhD) and never lists names. Selecting the popup lists that
   university's graduates below, by completion year; a name appears only when
   the scholar is in the Regional Scholar Directory (Public Display Approved or
   already shown on a country dashboard). Everyone else is counted only.
   Data: studyMap in the encrypted bundle. Map tiles load from Google; Leaflet
   loads only when this view is first opened. */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bb\u02bc`']/g, '').toLowerCase();
  const $ = id => document.getElementById(id);
  const REGIONS = ['Pacific Islands', 'Australia and New Zealand', 'North America', 'Europe', 'Asia', 'Other regions'];
  const RCOL = { 'Pacific Islands': '#3dce6e', 'Australia and New Zealand': '#1ec4f0', 'North America': '#f0b42a', Europe: '#a44cf0', Asia: '#f06080', 'Other regions': '#9fb3c8' };
  const LEAF = {
    css: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='],
    js: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='],
  };
  let D, H = {}, SM, map, layer, mk = {}, loading = null, shown = false;
  const st = { home: '', level: 'all', q: '', region: '', country: '', uni: -1, sumBy: 'country', fly: { r: '', c: '' } };

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAF.css[0]; l.integrity = LEAF.css[1]; l.crossOrigin = ''; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = LEAF.js[0]; s.integrity = LEAF.js[1]; s.crossOrigin = ''; s.onload = res; s.onerror = () => rej(new Error('Map library could not load.')); document.head.appendChild(s);
    });
    return loading;
  }
  const lngP = lng => (lng < -25 ? lng + 360 : lng); // Pacific-centred: the Americas sit east of the Pacific
  const ctryOf = u => u.c || 'Country not recorded';
  const cname = code => (H.nameOf ? H.nameOf(code) : code);
  const flag = (code, cls) => `<img class="${cls || 'psu-flag'}" src="img/regional/flags/${String(code).toLowerCase()}.png" alt="" width="20" height="20">`;

  // ---------- data ----------
  function degs() { return SM.degs.filter(d => (!st.home || d[1] === st.home) && (st.level === 'all' || d[2] === st.level)); }
  function qMatch(u) { if (!st.q) return true; const h = fold(u.n + ' ' + u.c + ' ' + (u.city || '')); return fold(st.q).split(/\s+/).filter(Boolean).every(w => h.includes(w)); }
  function agg() {
    const A = new Map();
    let none = { M: 0, P: 0 }, campus = { M: 0, P: 0 };
    for (const d of degs()) {
      if (d[0] < 0) { none[d[2]]++; continue; }
      const u = SM.unis[d[0]];
      if (u.lat == null) { campus[d[2]]++; }
      let a = A.get(d[0]); if (!a) A.set(d[0], a = { ix: d[0], u, M: 0, P: 0, home: {} });
      a[d[2]]++;
      const h = a.home[d[1]] || (a.home[d[1]] = { M: 0, P: 0 }); h[d[2]]++;
    }
    return { A, none, campus };
  }
  const inPlace = a => (!st.region || a.u.r === st.region) && (!st.country || ctryOf(a.u) === st.country);

  // ---------- setup ----------
  function init(data, helpers) {
    D = data; H = helpers || {}; SM = D && D.studyMap;
    const tab = document.querySelector('[data-views="c1top"]');
    if (!SM || !SM.unis || !SM.degs) { if (tab) tab.remove(); return; }
    const homes = [...new Set(SM.degs.map(d => d[1]))];
    const order = (D.countries || []).map(c => c.code).filter(c => homes.includes(c));
    $('psu-home').innerHTML = '<option value="">All home countries</option>' + order.map(c => `<option value="${c}">${esc(cname(c))}</option>`).join('');
    $('psu-home').addEventListener('change', e => { st.home = e.target.value; H.select && H.select(st.home || null); render(); });
    $('psu-level').addEventListener('change', e => { st.level = e.target.value; render(); });
    $('psu-search').addEventListener('input', e => { st.q = e.target.value.trim(); render(); });
    $('psu-search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fitTo(a => qMatch(a.u)); } });
    $('psu-reset').addEventListener('click', reset);
    $('psu-full').addEventListener('click', toggleFull);
    document.addEventListener('fullscreenchange', () => { const on = document.fullscreenElement === $('psu'); $('psu').classList.toggle('is-full', on); $('psu-full').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen map'); fullChanged(); });
    document.querySelectorAll('#psu-sum-by button').forEach(b => b.addEventListener('click', () => { st.sumBy = b.dataset.v; document.querySelectorAll('#psu-sum-by button').forEach(x => x.setAttribute('aria-checked', String(x === b))); renderSummary(agg()); }));
    $('psu-sum').addEventListener('click', e => {
      const r = e.target.closest('[data-act]'); if (!r) return;
      const v = r.dataset.v;
      if (r.dataset.act === 'country') { st.region = ''; st.country = v; fitTo(a => ctryOf(a.u) === v); render(); }
      else if (r.dataset.act === 'uni') openUni(+v, true);
      else if (r.dataset.act === 'home') { st.home = v; $('psu-home').value = v; H.select && H.select(v); render(); }
    });
    $('psu-detail').addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { st.uni = -1; renderDetail(); return; }
      const a = e.target.closest('a[href^="#dir="]');
      if (a && location.hash === a.getAttribute('href')) { e.preventDefault(); dispatchEvent(new HashChangeEvent('hashchange')); }
    });
    setupFly();
    $('psu-note').textContent = 'Opening the map…';
  }

  async function show() {
    shown = true;
    if (map) { setTimeout(() => map.invalidateSize(), 60); render(); return; }
    try { await loadLeaflet(); } catch (e) { $('psu-map').innerHTML = `<div class="ps-empty">${esc(e.message)} The summary tables below still work.</div>`; render(); return; }
    map = L.map('psu-map', { worldCopyJump: false, minZoom: 1, maxZoom: 17, zoomSnap: 0.5, scrollWheelZoom: false, attributionControl: true }).setView([5, 175], 2);
    // Google satellite with labels, as on the Fiji dashboard. If Google refuses the
    // tiles (some networks block them), switch once to Esri World Imagery.
    const google = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { subdomains: ['0', '1', '2', '3'], maxZoom: 20, attribution: 'Imagery © Google' }).addTo(map);
    let bad = 0, ok = 0;
    google.on('tileload', () => { ok++; });
    google.on('tileerror', () => {
      if (++bad < 4 || ok > 0 || map._psuEsri) return;
      map._psuEsri = true; map.removeLayer(google);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }).addTo(map);
    });
    map.getContainer().addEventListener('click', e => { const b = e.target.closest('[data-uni]'); if (b) { e.preventDefault(); openUni(+b.dataset.uni, false); } });
    map.on('focus', () => map.scrollWheelZoom.enable()); map.on('blur', () => map.scrollWheelZoom.disable());
    layer = L.layerGroup().addTo(map);
    render();
    home(false);
  }
  // Initial / reset view: every mapped university, Pacific-centred.
  function home(anim) {
    const pts = SM.unis.filter(u => u.lat != null).map(u => [u.lat, lngP(u.lng)]);
    if (!pts.length) return;
    const full = $('psu').classList.contains('is-full');
    // Full screen: fit tightly to the universities (finer zoom steps, small edge margin).
    map.options.zoomSnap = full ? 0.1 : 0.5;
    const b = L.latLngBounds(pts).pad(full ? 0 : 0.04);
    const o = full ? { padding: [44, 44] } : {};
    anim ? map.flyToBounds(b, Object.assign({ duration: 0.6 }, o)) : map.fitBounds(b, o);
  }
  // Entering or leaving full screen: resize, then re-fit the default view unless
  // the user has picked a region, country or search (then keep their view).
  function fullChanged() {
    setTimeout(() => {
      if (!map) return;
      map.invalidateSize();
      if (!st.region && !st.country && !st.q) home(false);
    }, 120);
  }

  function setHome(code) { if (st.home === (code || '')) return; st.home = code || ''; if ($('psu-home')) $('psu-home').value = st.home; if (shown) render(); }
  function refresh() { if (shown) renderDetail(); }

  // ---------- render ----------
  function render() {
    if (!SM) return;
    const G = agg();
    renderKpis(G); renderMarkers(G); renderSummary(G); renderDetail(); renderFlyBtn();
    const tot = degs().length, onMap = [...G.A.values()].filter(a => a.u.lat != null).reduce((s, a) => s + a.M + a.P, 0);
    const nn = G.none.M + G.none.P, nc = G.campus.M + G.campus.P;
    $('psu-note').textContent = `${fmt(onMap)} of ${fmt(tot)} completed degrees are on the map.` + (nn ? ` ${fmt(nn)} have no university recorded` : '') + (nc ? `${nn ? ' and' : ''} ${fmt(nc)} ${nc === 1 ? 'is a' : 'are'} USP degree${nc === 1 ? '' : 's'} with the campus not recorded` : '') + (nn || nc ? '; they are counted in the tables only.' : '') + ' Circles are sized by completed degrees. University locations: repository location files, country Master files, and OpenStreetMap.';
  }
  function renderKpis(G) {
    const L0 = [...G.A.values()];
    const M = L0.reduce((s, a) => s + a.M, 0) + G.none.M, P = L0.reduce((s, a) => s + a.P, 0) + G.none.P;
    const ctr = new Set(L0.map(a => ctryOf(a.u)));
    const homes = new Set(degs().map(d => d[1]));
    $('psu-kpis').innerHTML = [[fmt(L0.length), 'Universities'], [fmt(ctr.size), 'Countries of study'], [fmt(M), "Master's"], [fmt(P), 'PhDs / doctorates'], [fmt(homes.size), 'Pacific home countries']]
      .map(([v, l]) => `<div class="psu-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
  }
  function popupHtml(a) {
    const homes = Object.entries(a.home).sort((x, y) => (y[1].M + y[1].P) - (x[1].M + x[1].P) || cname(x[0]).localeCompare(cname(y[0])));
    return `<div class="psu-pop" data-uni="${a.ix}" role="button" tabindex="0" title="Select to list this university's graduates below the map">
      <div class="psu-pop__h">${esc(a.u.n)}</div><div class="psu-pop__s">${esc([a.u.city, ctryOf(a.u)].filter(Boolean).join(', '))}</div>
      <table class="psu-pop__t"><thead><tr><th>Pacific scholars from</th><th>Master's</th><th>PhD</th></tr></thead><tbody>
      ${homes.map(([c, v]) => `<tr><td>${flag(c)}${esc(cname(c))}</td><td>${v.M || '–'}</td><td>${v.P || '–'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Total</td><td>${a.M}</td><td>${a.P}</td></tr></tfoot></table>
      <div class="psu-pop__go">Select to list graduates below ▾</div></div>`;
  }
  function renderMarkers(G) {
    if (!map) return;
    layer.clearLayers(); mk = {};
    for (const a of G.A.values()) {
      if (a.u.lat == null || !qMatch(a.u)) continue;
      const n = a.M + a.P, dim = !inPlace(a);
      const m = L.circleMarker([a.u.lat, lngP(a.u.lng)], { radius: 5 + 3.2 * Math.sqrt(n), color: '#fff', weight: 1.5, fillColor: RCOL[a.u.r] || '#9fb3c8', fillOpacity: dim ? 0.25 : 0.85, opacity: dim ? 0.4 : 1 });
      m.bindPopup(() => popupHtml(a), { maxWidth: 320, minWidth: 220, autoPanPadding: [20, 20] });
      m.bindTooltip(`${esc(a.u.n)} · ${n} degree${n === 1 ? '' : 's'}`, { direction: 'top', offset: [0, -6] });
      m.on('popupopen', ev => { const el = ev.popup.getElement().querySelector('.psu-pop'); el && el.addEventListener('keydown', k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); openUni(a.ix, false); } }); });
      m.addTo(layer); mk[a.ix] = m;
    }
  }
  function openUni(ix, fly) {
    st.uni = ix; renderDetail();
    const m = mk[ix];
    if (m && map) {
      if (fly) { map.closePopup(); map.once('moveend', () => { if (!m.isPopupOpen()) m.openPopup(); }); map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 9), { duration: 0.8 }); }
      else if (!m.isPopupOpen()) m.openPopup();
    }
    const d = $('psu-detail'); if (!d.hidden && !$('psu').classList.contains('is-full')) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function renderDetail() {
    const box = $('psu-detail');
    if (st.uni < 0) { box.hidden = true; box.innerHTML = ''; return; }
    const u = SM.unis[st.uni];
    const S = (window.PSDirectory && window.PSDirectory.scholars && window.PSDirectory.scholars()) || [];
    const byId = new Map(S.map(s => [s.id, s]));
    const rows = degs().filter(d => d[0] === st.uni).sort((a, b) => (a[3] || 9999) - (b[3] || 9999) || (a[2] === b[2] ? 0 : a[2] === 'M' ? -1 : 1));
    const named = rows.filter(d => byId.has(d[4])).length;
    const filt = [st.home ? cname(st.home) + ' scholars' : '', st.level === 'M' ? "Master's only" : st.level === 'P' ? 'PhD only' : ''].filter(Boolean).join(' · ');
    box.hidden = false;
    box.innerHTML = `<div class="psu-detail__bar"><div><h3 class="psu-h3">${esc(u.n)}</h3><p class="psu-detail__s">${esc([u.city, ctryOf(u)].filter(Boolean).join(', '))} · ${rows.length} completed degree${rows.length === 1 ? '' : 's'}${filt ? ' · ' + esc(filt) : ''}</p></div><button type="button" class="ps-iconbtn" data-close aria-label="Close the graduate list">×</button></div>
      <div class="psu-sum__scroll"><table class="psu-table psu-table--detail"><thead><tr><th scope="col">Year</th><th scope="col">Scholar</th><th scope="col">Home country</th><th scope="col">Degree</th></tr></thead><tbody>
      ${rows.length ? rows.map(d => { const s = byId.get(d[4]); return `<tr><td class="y">${d[3] || '<span class="psu-muted">Not recorded</span>'}</td><td>${flag(d[1], 'psu-flag psu-flag--lg')}${s ? `<a href="#dir=${esc(s.id)}" title="Open ${esc(s.n)}'s card in the Regional Scholar Directory">${esc(s.n)}</a>` : '<span class="psu-muted">Name not shown (not in the public directory)</span>'}</td><td>${esc(cname(d[1]))}</td><td><span class="psu-deg psu-deg--${d[2]}">${d[2] === 'P' ? 'PhD / doctorate' : "Master's"}</span></td></tr>`; }).join('') : '<tr><td colspan="4">No completed degrees match these filters.</td></tr>'}
      </tbody></table></div>
      <p class="ps-note">Listed by completion year. ${fmt(named)} of ${fmt(rows.length)} names shown: names appear only for scholars in the Regional Scholar Directory; the others are counted but not named.</p>`;
  }
  function renderSummary(G) {
    const t = $('psu-sum');
    const list = [...G.A.values()].filter(a => qMatch(a.u) && inPlace(a));
    const row = (cells, act, v, label) => `<tr${act ? ` data-act="${act}" data-v="${esc(v)}" tabindex="0" role="button" aria-label="${esc(label)}"` : ''}>${cells}</tr>`;
    const nums = (M, P) => `<td>${fmt(M)}</td><td>${fmt(P)}</td><td class="tot">${fmt(M + P)}</td>`;
    const noneRow = (st.region || st.country || st.q) ? '' : (G.none.M + G.none.P ? row(`<th scope="row" class="psu-muted">University not recorded</th>${st.sumBy === 'uni' ? '<td></td>' : ''}${nums(G.none.M, G.none.P)}`) : '');
    let h = '';
    if (st.sumBy === 'uni') {
      list.sort((a, b) => (b.M + b.P) - (a.M + a.P) || a.u.n.localeCompare(b.u.n));
      h = `<thead><tr><th scope="col">University</th><th scope="col">Country</th><th scope="col">Master's</th><th scope="col">PhD</th><th scope="col">Total</th></tr></thead><tbody>${list.map(a => row(`<th scope="row">${esc(a.u.n)}${a.u.lat == null ? ' <span class="psu-muted">(campus not recorded)</span>' : ''}</th><td>${esc(ctryOf(a.u))}</td>${nums(a.M, a.P)}`, 'uni', a.ix, 'Show ' + a.u.n)).join('')}${noneRow}</tbody>`;
    } else if (st.sumBy === 'home') {
      const by = {};
      degs().forEach(d => { const u = d[0] >= 0 ? SM.unis[d[0]] : null; if ((st.region || st.country || st.q) && (!u || !qMatch(u) || (st.region && u.r !== st.region) || (st.country && ctryOf(u) !== st.country))) return; const b = by[d[1]] || (by[d[1]] = { M: 0, P: 0 }); b[d[2]]++; });
      const L0 = Object.entries(by).sort((a, b) => (b[1].M + b[1].P) - (a[1].M + a[1].P));
      h = `<thead><tr><th scope="col">Home country</th><th scope="col">Master's</th><th scope="col">PhD</th><th scope="col">Total</th></tr></thead><tbody>${L0.map(([c, v]) => row(`<th scope="row">${flag(c)}${esc(cname(c))}</th>${nums(v.M, v.P)}`, 'home', c, 'Filter to ' + cname(c) + ' scholars')).join('')}</tbody>`;
    } else {
      const by = {};
      list.forEach(a => { const k = ctryOf(a.u); const b = by[k] || (by[k] = { M: 0, P: 0, n: 0, r: a.u.r }); b.M += a.M; b.P += a.P; b.n++; });
      const L0 = Object.entries(by).sort((a, b) => (b[1].M + b[1].P) - (a[1].M + a[1].P) || a[0].localeCompare(b[0]));
      h = `<thead><tr><th scope="col">Country of study</th><th scope="col">Universities</th><th scope="col">Master's</th><th scope="col">PhD</th><th scope="col">Total</th></tr></thead><tbody>${L0.map(([k, v]) => row(`<th scope="row"><i class="psu-dot" style="background:${RCOL[v.r] || '#9fb3c8'}"></i>${esc(k)}</th><td>${fmt(v.n)}</td>${nums(v.M, v.P)}`, 'country', k, 'Zoom to ' + k)).join('')}${noneRow.replace('<th scope="row" class="psu-muted">University not recorded</th>', '<th scope="row" class="psu-muted">University not recorded</th><td></td>')}</tbody>`;
    }
    t.innerHTML = h;
    t.querySelectorAll('tr[data-act]').forEach(r => r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); } }));
  }

  // ---------- region / country / university fly-out ----------
  function setupFly() {
    const btn = $('psu-fly-btn'), pop = $('psu-fly-pop');
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', e => { e.stopPropagation(); if (pop.hidden) { st.fly = { r: st.region, c: st.country }; drawFly(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); } else close(); });
    document.addEventListener('click', e => { if (!$('psu-fly').contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop.hidden && !document.fullscreenElement && $('psu').classList.contains('is-full')) { $('psu').classList.remove('is-full'); fullChanged(); } });
    const hoverable = () => matchMedia('(hover:hover)').matches && innerWidth >= 700;
    pop.addEventListener('mouseover', e => {
      if (!hoverable()) return;
      const it = e.target.closest('[data-fr],[data-fc]'); if (!it) return;
      if (it.dataset.fr !== undefined && st.fly.r !== it.dataset.fr) { st.fly = { r: it.dataset.fr, c: '' }; drawFly(); }
      else if (it.dataset.fc !== undefined && st.fly.c !== it.dataset.fc) { st.fly.c = it.dataset.fc; drawFly(); }
    });
    pop.addEventListener('click', e => {
      e.stopPropagation();
      const it = e.target.closest('[data-fr],[data-fc],[data-fu],[data-fall]'); if (!it) return;
      if (it.dataset.fall !== undefined) { close(); reset(); return; }
      if (it.dataset.fu !== undefined) { close(); st.region = ''; st.country = ''; render(); openUni(+it.dataset.fu, true); return; }
      if (it.dataset.fc !== undefined) { st.region = ''; st.country = it.dataset.fc; st.fly.c = it.dataset.fc; render(); fitTo(a => ctryOf(a.u) === st.country); drawFly(); return; }
      if (it.dataset.fr !== undefined) { st.region = it.dataset.fr; st.country = ''; st.fly = { r: it.dataset.fr, c: '' }; render(); fitTo(a => a.u.r === st.region); drawFly(); }
    });
  }
  function drawFly() {
    const G = agg(), L0 = [...G.A.values()].filter(a => a.u.lat != null);
    const sum = f => L0.filter(f).reduce((s, a) => s + a.M + a.P, 0);
    const regs = REGIONS.filter(r => L0.some(a => a.u.r === r));
    const ctrs = st.fly.r ? [...new Set(L0.filter(a => a.u.r === st.fly.r).map(a => ctryOf(a.u)))].sort((a, b) => sum(x => ctryOf(x.u) === b) - sum(x => ctryOf(x.u) === a) || a.localeCompare(b)) : [];
    const unis = st.fly.c ? L0.filter(a => ctryOf(a.u) === st.fly.c).sort((a, b) => (b.M + b.P) - (a.M + a.P) || a.u.n.localeCompare(b.u.n)) : [];
    const item = (attr, v, label, n, on, arrow) => `<button type="button" class="psu-fly__it${on ? ' is-on' : ''}" ${attr}="${esc(v)}"><span>${esc(label)}</span><b>${fmt(n)}</b>${arrow ? '<i aria-hidden="true">›</i>' : ''}</button>`;
    $('psu-fly-pop').innerHTML = `<div class="psu-fly__col"><div class="psu-fly__h">Region</div><button type="button" class="psu-fly__it" data-fall><span>All regions (reset view)</span></button>${regs.map(r => item('data-fr', r, r, sum(a => a.u.r === r), st.fly.r === r, true)).join('')}</div>
      ${st.fly.r ? `<div class="psu-fly__col"><div class="psu-fly__h">Country</div>${ctrs.map(c => item('data-fc', c, c, sum(a => ctryOf(a.u) === c), st.fly.c === c, true)).join('')}</div>` : ''}
      ${st.fly.c ? `<div class="psu-fly__col psu-fly__col--u"><div class="psu-fly__h">University</div>${unis.map(a => item('data-fu', a.ix, a.u.n, a.M + a.P, st.uni === a.ix, false)).join('')}</div>` : ''}`;
  }
  function renderFlyBtn() { $('psu-fly-btn').textContent = (st.country || st.region || 'Region / Country') + ' ▾'; }
  function fitTo(f) {
    if (!map) return;
    const pts = [];
    for (const a of agg().A.values()) if (a.u.lat != null && f(a)) pts.push([a.u.lat, lngP(a.u.lng)]);
    if (!pts.length) return;
    if (pts.length === 1) map.flyTo(pts[0], 10, { duration: 0.8 });
    else map.flyToBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 9, duration: 0.8 });
  }
  function reset() {
    st.region = ''; st.country = ''; st.q = ''; $('psu-search').value = '';
    if (map) { map.closePopup(); home(true); }
    render();
  }
  function toggleFull() {
    const el = $('psu');
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => { el.classList.toggle('is-full'); fullChanged(); });
    else { el.classList.toggle('is-full'); fullChanged(); }
  }

  window.PSUniversities = { init, show, setHome, refresh };
})();
