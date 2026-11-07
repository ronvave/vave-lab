/* Link Analytics dashboard (private). Opens data/link-analytics.json.enc with
 * the analytics passcode (PBKDF2-SHA256 200k + AES-GCM, same format as the
 * Regional bundle). Everything is computed in the browser from aggregated
 * Google Analytics rows; no visitor-level identifiers exist in the file. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n || 0).toLocaleString();

  const LC = ['FJI', 'HAW', 'WSM', 'SLB', 'TON', 'VUT', 'COK', 'FSM', 'KIR', 'MHL', 'PLW', 'TUV', 'UHM', 'none'];
  const LC_NAME = { FJI: 'Fiji', HAW: 'Hawaiʻi', WSM: 'Samoa', SLB: 'Solomon Islands', TON: 'Tonga', VUT: 'Vanuatu', COK: 'Cook Islands', FSM: 'Federated States of Micronesia', KIR: 'Kiribati', MHL: 'Marshall Islands', PLW: 'Palau', TUV: 'Tuvalu', UHM: 'UH Mānoa leadership', none: 'No link (your passcode)' };
  const LC_SHORT = { FSM: 'FSM', SLB: 'Solomon Is.', COK: 'Cook Is.', MHL: 'Marshall Is.', UHM: 'UH Mānoa', none: 'No link' };
  const COLORS = { FJI: '#2f86d6', TON: '#e0464f', SLB: '#14a99a', VUT: '#e9a40f', WSM: '#3a63d8', FSM: '#7b4fd8', KIR: '#13a9c4', MHL: '#d93a7a', TUV: '#22a663', COK: '#a463e6', PLW: '#ef7d1a', HAW: '#9c3b1b', UHM: '#024731', none: '#8a8f96' };
  const LT = ['c', 'r', 'a1', 'none'];
  const LT_NAME = { c: 'Country link', r: 'Regional link', a1: 'From Regional A1', none: 'Passcode or direct' };
  const DASH = ['REG', 'FJI', 'HAW', 'WSM', 'SLB', 'TON', 'VUT'];
  const DASH_NAME = { REG: 'Regional', FJI: 'Fiji', HAW: 'Hawaiʻi', WSM: 'Samoa', SLB: 'Solomon Islands', TON: 'Tonga', VUT: 'Vanuatu' };
  const DASH_COLOR = { REG: '#0b2a3c', FJI: '#2f86d6', HAW: '#9c3b1b', WSM: '#3a63d8', SLB: '#14a99a', TON: '#e0464f', VUT: '#e9a40f' };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const GEO_ALIAS = { 'United States': 'United States of America', 'Micronesia': 'Micronesia', 'Federated States of Micronesia': 'Micronesia', 'Marshall Islands': 'Marshall Is.', 'Solomon Islands': 'Solomon Is.', 'Cook Islands': 'Cook Is.', 'Czechia': 'Czechia', 'South Korea': 'South Korea', 'Hong Kong': 'Hong Kong', 'Côte d’Ivoire': "Côte d'Ivoire", 'Bosnia & Herzegovina': 'Bosnia and Herz.', 'Dominican Republic': 'Dominican Rep.' };

  let D = null, charts = {}, worldP = null;
  const S = { from: '', to: '', days: 0, lc: new Set(LC), lt: new Set(LT), dash: new Set(DASH), geo: new Set(), geoAll: [], trendM: 'sessions', mapM: 'sessions', panelM: 'secs', techM: 'browser', sort: { k: 'total', asc: false }, recentN: 25 };

  // ---------- gate ----------
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  $('#la-gate-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = $('#la-gate-err'), pass = $('#la-pass').value;
    err.textContent = 'Opening…';
    try {
      const res = await fetch('data/link-analytics.json.enc?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) { err.textContent = 'No analytics yet. The first refresh runs once Google Analytics is connected.'; return; }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (String.fromCharCode(...buf.slice(0, 4)) !== 'IVAV') throw new Error('format');
      const key = await deriveKey(pass, buf.slice(4, 20));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(20, 32) }, key, buf.slice(32)).catch(() => null);
      if (!plain) { err.textContent = 'That passcode is not correct.'; return; }
      D = JSON.parse(new TextDecoder().decode(plain));
      $('#la-pass').value = '';
      $('#la-gate').hidden = true; $('#la-app').hidden = false;
      boot();
    } catch (e) { err.textContent = 'The analytics file could not be opened.'; }
  });
  $('#la-pass').focus();

  // ---------- helpers ----------
  const ymd = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const toInput = s => s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
  const fromInput = s => s.replace(/-/g, '');
  function dur(s) {
    s = Math.round(s || 0);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' m ' + String(s % 60).padStart(2, '0') + ' s';
    return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' m';
  }
  function dhm(v) {
    const d = new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12));
    return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function dhmShort(v) {
    const d = new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12));
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  const flag = code => code === 'UHM' ? '<span class="la-dot" style="background:#024731"></span>' : code !== 'none' ? `<img src="img/regional/flags-rect/${code.toLowerCase()}.webp" alt="" loading="lazy" />` : '<span class="la-dot" style="background:#8a8f96"></span>';
  const geoName = c => (c && c !== '(not set)') ? c : 'Unknown location';
  const cityName = (c, k) => (c && c !== '(not set)' ? c + ', ' : 'Unknown city, ') + geoName(k);
  function pass(r, geoIdx, dateLen) {
    const d = r[0].slice(0, dateLen || 8);
    return (!S.from || d >= S.from) && (!S.to || d <= S.to) && S.dash.has(r[1]) && S.lc.has(r[2]) && S.lt.has(r[3]) && (geoIdx == null || S.geo.has(geoName(r[geoIdx])));
  }
  const geoFiltered = () => S.geo.size !== S.geoAll.length;
  const dateFiltered = () => !!(S.from && S.from > D.start.replace(/-/g, '')) || !!(S.to && S.to < ymd(new Date()));
  const shade = (v, max, rgb) => v ? `background:rgba(${rgb},${(0.12 + 0.78 * v / max).toFixed(3)});color:${v / max > 0.55 ? '#fff' : 'inherit'}` : 'background:#f3eee3;color:#b3aa98';

  function chart(id, cfg) {
    if (!window.Chart) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }
  function emptyIn(el, msg) {
    const box = el.closest('.la-chart') || el;
    let e = box.querySelector('.la-empty');
    if (msg) {
      if (!e) { e = document.createElement('div'); e.className = 'la-empty'; box.appendChild(e); }
      e.textContent = msg; if (el.tagName === 'CANVAS') el.style.display = 'none';
    } else if (e) { e.remove(); el.style.display = ''; }
  }
  const NO_DATA = 'No visits match these filters yet.';

  // ---------- filters ----------
  function checks(host, key, items, label) {
    host.innerHTML = items.map(v => `<label class="la-check"><input type="checkbox" data-k="${key}" value="${esc(v)}" ${S[key].has(v) ? 'checked' : ''} />${label(v)}<span class="la-n" data-n="${key}:${esc(v)}"></span></label>`).join('');
  }
  function buildFilters() {
    checks($('#la-f-lc'), 'lc', LC, v => `${flag(v)}<span>${esc(LC_SHORT[v] || LC_NAME[v])}</span>`);
    checks($('#la-f-lt'), 'lt', LT, v => `<span class="la-pill la-pill--${v}">${esc(LT_NAME[v])}</span>`);
    checks($('#la-f-dash'), 'dash', DASH, v => `<span class="la-dot" style="background:${DASH_COLOR[v]}"></span><span>${esc(DASH_NAME[v])}</span>`);
    checks($('#la-f-geo'), 'geo', S.geoAll, v => `<span>${esc(v)}</span>`);
  }
  function filterCounts() {
    const n = { lc: {}, lt: {}, dash: {}, geo: {} };
    for (const r of D.visits) {
      const d = r[0];
      if ((S.from && d < S.from) || (S.to && d > S.to)) continue;
      n.lc[r[2]] = (n.lc[r[2]] || 0) + r[6]; n.lt[r[3]] = (n.lt[r[3]] || 0) + r[6];
      n.dash[r[1]] = (n.dash[r[1]] || 0) + r[6]; const g = geoName(r[4]); n.geo[g] = (n.geo[g] || 0) + r[6];
    }
    document.querySelectorAll('[data-n]').forEach(el => { const [k, v] = el.dataset.n.split(/:(.*)/); el.textContent = fmt(n[k][v] || 0); });
  }
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('input[type=checkbox][data-k]')) { const set = S[t.dataset.k]; t.checked ? set.add(t.value) : set.delete(t.value); S.recentN = 25; render(); }
  });
  document.querySelectorAll('[data-all],[data-none]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.all || b.dataset.none, all = { lc: LC, lt: LT, dash: DASH, geo: S.geoAll }[k];
    S[k] = new Set(b.dataset.all ? all : []);
    document.querySelectorAll(`input[data-k="${k}"]`).forEach(i => { i.checked = S[k].has(i.value); });
    S.recentN = 25; render();
  }));
  function setDays(days) {
    S.days = days;
    const start = D.start.replace(/-/g, '');
    S.to = ymd(new Date());
    S.from = days ? (() => { const d = new Date(); d.setDate(d.getDate() - days + 1); const f = ymd(d); return f < start ? start : f; })() : start;
    $('#la-from').value = toInput(S.from); $('#la-to').value = toInput(S.to);
    document.querySelectorAll('#la-range button').forEach(b => b.classList.toggle('is-on', +b.dataset.days === days));
  }
  document.querySelectorAll('#la-range button').forEach(b => b.addEventListener('click', () => { setDays(+b.dataset.days); S.recentN = 25; render(); }));
  ['#la-from', '#la-to'].forEach(id => $(id).addEventListener('change', () => {
    S.from = fromInput($('#la-from').value); S.to = fromInput($('#la-to').value);
    if (S.from && S.to && S.from > S.to) { [S.from, S.to] = [S.to, S.from]; $('#la-from').value = toInput(S.from); $('#la-to').value = toInput(S.to); }
    document.querySelectorAll('#la-range button').forEach(b => b.classList.remove('is-on'));
    S.recentN = 25; render();
  }));
  $('#la-reset').addEventListener('click', () => {
    S.lc = new Set(LC); S.lt = new Set(LT); S.dash = new Set(DASH); S.geo = new Set(S.geoAll);
    document.querySelectorAll('input[data-k]').forEach(i => { i.checked = true; });
    setDays(0); S.recentN = 25; render();
  });
  function seg(id, key) {
    document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener('click', () => {
      S[key] = b.dataset.m;
      document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('is-on', x === b));
      render();
    }));
  }
  seg('la-trend-metric', 'trendM'); seg('la-map-metric', 'mapM'); seg('la-panel-metric', 'panelM'); seg('la-tech-metric', 'techM');
  $('#la-recent-more').addEventListener('click', () => { S.recentN += 25; renderRecent(); });

  // ---------- boot ----------
  function boot() {
    $('#la-sample').hidden = !D.sample;
    const g = new Date(D.generated);
    $('#la-updated').textContent = 'Updated ' + g.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const geos = new Set();
    [D.visits.map(r => r[4]), D.panels.map(r => r[5]), D.tech.map(r => r[4]), D.when.map(r => r[4]), D.recent.map(r => r[4])].flat().forEach(c => geos.add(geoName(c)));
    S.geoAll = [...geos].sort((a, b) => a === 'Unknown location' ? 1 : b === 'Unknown location' ? -1 : a.localeCompare(b));
    S.geo = new Set(S.geoAll);
    if (window.Chart) { Chart.defaults.font.family = 'Arial, Helvetica, sans-serif'; Chart.defaults.color = '#5b6b76'; }
    buildFilters(); setDays(0); render();
  }

  function render() {
    filterCounts();
    const V = D.visits.filter(r => pass(r, 4));
    const P = D.panels.filter(r => pass(r, 5));
    renderKpis(V, P); renderTrend(V); renderScore(V, P); renderMap(V); renderPanels(P);
    renderMatrix(V); renderWhen(); renderTech(); renderRecent();
  }

  function renderKpis(V, P) {
    const sum = i => V.reduce((a, r) => a + r[i], 0);
    const sessions = sum(6), secs = sum(9), views = sum(8), pv = P.reduce((a, r) => a + r[6], 0);
    let users, approx = false;
    if (!dateFiltered() && !geoFiltered()) users = D.users.filter(r => S.dash.has(r[0]) && S.lc.has(r[1]) && S.lt.has(r[2])).reduce((a, r) => a + r[3], 0);
    else { users = sum(7); approx = true; }
    const R = D.recent.filter(r => pass(r, 4, 8));
    const last = R.length ? R.reduce((m, r) => r[0] > m ? r[0] : m, '') : '';
    const k = [
      [fmt(sessions), 'Visits'], [fmt(users), 'Visitors', approx ? 'Daily visitors added up' : 'Unique per link and page'],
      [fmt(views), 'Page views'], [dur(secs), 'Time engaged'], [sessions ? dur(secs / sessions) : '—', 'Average per visit'],
      [fmt(pv), 'Panel views'], [last ? dhmShort(last) : '—', 'Last visit'],
    ];
    $('#la-kpis').innerHTML = k.map(([v, l, n]) => `<div class="la-kpi"><b>${esc(v)}</b><span>${esc(l)}</span>${n ? `<small>${esc(n)}</small>` : ''}</div>`).join('');
  }

  function dayList() {
    const out = [], a = S.from || D.start.replace(/-/g, ''), b = S.to || ymd(new Date());
    const d = new Date(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8));
    for (let i = 0; i < 800 && ymd(d) <= b; i++) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function renderTrend(V) {
    const el = $('#la-trend'), idx = { sessions: 6, secs: 9, views: 8 }[S.trendM];
    if (!V.length) { emptyIn(el, NO_DATA); return; } emptyIn(el, '');
    const days = dayList(), pos = Object.fromEntries(days.map((d, i) => [d, i])), by = {};
    for (const r of V) { if (pos[r[0]] == null) continue; (by[r[2]] = by[r[2]] || Array(days.length).fill(0))[pos[r[0]]] += idx === 9 ? r[idx] / 60 : r[idx]; }
    const datasets = LC.filter(c => by[c]).map(c => ({ label: LC_SHORT[c] || LC_NAME[c], data: by[c].map(v => Math.round(v * 10) / 10), backgroundColor: COLORS[c], borderRadius: 2, maxBarThickness: 26 }));
    chart('la-trend', { type: 'bar', data: { labels: days.map(d => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })), datasets },
      options: { maintainAspectRatio: false, animation: false, scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: { sessions: 'Visits', secs: 'Minutes engaged', views: 'Page views' }[S.trendM] } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { mode: 'index', filter: i => i.raw > 0 } } } });
  }

  function renderScore(V, P) {
    const rows = {};
    const blank = c => ({ code: c, c: 0, r: 0, a1: 0, none: 0, total: 0, secs: 0, panels: 0, last: '', top: {} });
    for (const r of V) { const o = rows[r[2]] = rows[r[2]] || blank(r[2]); o[r[3]] += r[6]; o.total += r[6]; o.secs += r[9]; }
    for (const r of P) { const o = rows[r[2]] = rows[r[2]] || blank(r[2]); o.panels += r[6]; const k = r[1] + '|' + r[4].replace(/^panel_/, ''); o.top[k] = (o.top[k] || 0) + r[7]; }
    for (const r of D.recent) if (pass(r, 4, 8)) { const o = rows[r[2]] = rows[r[2]] || blank(r[2]); if (r[0] > o.last) o.last = r[0]; }
    const list = LC.filter(c => S.lc.has(c)).map(c => rows[c] || blank(c));
    list.forEach(o => { o.avg = o.total ? o.secs / o.total : 0; const t = Object.entries(o.top).sort((a, b) => b[1] - a[1])[0]; o.topK = t ? t[0] : ''; o.name = o.code === 'none' ? 'No link (passcode)' : (LC_SHORT[o.code] || LC_NAME[o.code]); });
    const { k, asc } = S.sort;
    list.sort((a, b) => { const x = a[k], y = b[k]; const c = typeof x === 'string' ? x.localeCompare(y) : x - y; return asc ? c : -c; });
    const max = Math.max(1, ...list.map(o => o.total));
    const cols = [['name', 'Whose link', 'la-l'], ['c', 'Country link'], ['r', 'Regional link'], ['a1', 'From A1'], ['total', 'Total visits'], ['secs', 'Time engaged'], ['avg', 'Avg per visit'], ['panels', 'Panel views'], ['topK', 'Most-viewed panel', 'la-l'], ['last', 'Last visit']];
    const z = v => v ? fmt(v) : '<span class="la-zero">0</span>';
    const panelLabel = key => { if (!key) return '<span class="la-zero">—</span>'; const [dsh, id] = key.split('|'); const t = ((D.titles || {})[dsh] || {})[id] || ''; return `<span title="${esc(DASH_NAME[dsh] + ' · ' + id + (t ? ' ' + t : ''))}">${esc(DASH_NAME[dsh])} · <b>${esc(id)}</b></span>`; };
    $('#la-score').innerHTML = `<thead><tr>${cols.map(([key, l, cls]) => `<th scope="col" tabindex="0" data-sort="${key}" class="${cls || ''}${k === key ? ' is-sorted' + (asc ? ' is-asc' : '') : ''}">${l}</th>`).join('')}</tr></thead><tbody>${list.map(o => `<tr>
      <td><span class="la-flag">${flag(o.code)}${esc(o.name)}</span></td><td>${o.code === 'none' || (!DASH_NAME[o.code] && o.code !== 'UHM') ? '<span class="la-zero">—</span>' : z(o.c)}</td><td>${o.code === 'none' ? '<span class="la-zero">—</span>' : z(o.r)}</td><td>${o.code === 'none' ? '<span class="la-zero">—</span>' : z(o.a1)}</td>
      <td><b>${z(o.total)}</b><span class="la-bar" style="width:${Math.round(60 * o.total / max)}px"></span></td><td>${o.secs ? dur(o.secs) : '<span class="la-zero">—</span>'}</td><td>${o.total ? dur(o.avg) : '<span class="la-zero">—</span>'}</td><td>${z(o.panels)}</td>
      <td class="la-l">${panelLabel(o.topK)}</td><td>${o.last ? esc(dhmShort(o.last)) : '<span class="la-zero">Not yet</span>'}</td></tr>`).join('')}</tbody>`;
    $('#la-score').querySelectorAll('th[data-sort]').forEach(th => {
      const go = () => { const key = th.dataset.sort; S.sort = { k: key, asc: S.sort.k === key ? !S.sort.asc : (key === 'name' || key === 'topK') }; renderScore(V, P); };
      th.addEventListener('click', go); th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  function renderMap(V) {
    const host = $('#la-map'), idx = S.mapM === 'secs' ? 9 : 6, by = {}, city = {};
    for (const r of V) { const g = geoName(r[4]); by[g] = (by[g] || 0) + r[idx]; const c = cityName(r[5], r[4]); city[c] = (city[c] || 0) + r[idx]; }
    const top = Object.entries(city).sort((a, b) => b[1] - a[1]).slice(0, 20);
    $('#la-cities').innerHTML = top.length ? top.map(([c, v]) => `<li>${esc(c)}<span>${idx === 9 ? dur(v) : fmt(v)}</span></li>`).join('') : '<li class="la-zero">No visits yet</li>';
    if (!window.d3 || !window.topojson) { host.innerHTML = '<div class="la-empty">The map could not load. The city list still works.</div>'; return; }
    worldP = worldP || d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
    worldP.then(world => {
      const feats = topojson.feature(world, world.objects.countries).features;
      const byName = Object.fromEntries(feats.map(f => [f.properties.name, f]));
      const W = host.clientWidth || 800, H = Math.round(W * 0.46);
      const proj = d3.geoNaturalEarth1().rotate([-165, 0]).fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' });
      const path = d3.geoPath(proj);
      host.innerHTML = '';
      const svg = d3.select(host).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'World map of visitor locations');
      svg.append('path').attr('d', path({ type: 'Sphere' })).attr('fill', '#e8f1f3');
      svg.append('g').selectAll('path').data(feats).join('path').attr('class', 'land').attr('d', path);
      const max = Math.max(1, ...Object.values(by));
      const pts = Object.entries(by).map(([g, v]) => { const f = byName[GEO_ALIAS[g] || g] || byName[g]; return f && v ? { g, v, xy: proj(d3.geoCentroid(f)) } : null; }).filter(p => p && p.xy).sort((a, b) => b.v - a.v);
      const tip = d3.select(host).append('div').attr('class', 'la-tip').style('display', 'none');
      const sole = S.geo.size === 1 ? [...S.geo][0] : null;
      svg.append('g').selectAll('circle').data(pts).join('circle').attr('class', d => 'bub' + (d.g === sole ? ' is-sel' : ''))
        .attr('cx', d => d.xy[0]).attr('cy', d => d.xy[1]).attr('r', d => 4 + 22 * Math.sqrt(d.v / max))
        .attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => `${d.g}: ${idx === 9 ? dur(d.v) : fmt(d.v) + ' visits'}. Activate to filter.`)
        .on('mousemove', (e, d) => { const [x, y] = d3.pointer(e, host); tip.style('display', 'block').style('left', x + 'px').style('top', y + 'px').text(`${d.g}: ${idx === 9 ? dur(d.v) : fmt(d.v) + ' visits'}`); })
        .on('mouseleave', () => tip.style('display', 'none'))
        .on('click keydown', (e, d) => {
          if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          S.geo = new Set(sole === d.g ? S.geoAll : [d.g]);
          document.querySelectorAll('input[data-k="geo"]').forEach(i => { i.checked = S.geo.has(i.value); });
          S.recentN = 25; render();
        });
      if (!pts.length) d3.select(host).append('div').attr('class', 'la-empty').style('position', 'absolute').style('inset', '40% 30% auto').text(NO_DATA);
    }).catch(() => { host.innerHTML = '<div class="la-empty">The map could not load. The city list still works.</div>'; });
  }

  function renderPanels(P) {
    const el = $('#la-panels'), agg = {};
    for (const r of P) { const id = r[4].replace(/^panel_/, ''), k = r[1] + '|' + id; const o = agg[k] = agg[k] || { dash: r[1], id, count: 0, secs: 0 }; o.count += r[6]; o.secs += r[7]; }
    const list = Object.values(agg).map(o => Object.assign(o, { avg: o.count ? o.secs / o.count : 0 })).sort((a, b) => b[S.panelM] - a[S.panelM]).slice(0, 20);
    if (!list.length) { emptyIn(el, 'No panel views match these filters yet.'); return; } emptyIn(el, '');
    const lab = o => { const t = ((D.titles || {})[o.dash] || {})[o.id] || ''; const s = `${DASH_NAME[o.dash]} · ${o.id}${t ? ' ' + t : ''}`; return s.length > 58 ? s.slice(0, 56) + '…' : s; };
    const val = o => S.panelM === 'count' ? o.count : Math.round((S.panelM === 'secs' ? o.secs / 60 : o.avg) * 10) / 10;
    chart('la-panels', { type: 'bar', data: { labels: list.map(lab), datasets: [{ data: list.map(val), backgroundColor: list.map(o => DASH_COLOR[o.dash]), borderRadius: 3, maxBarThickness: 18 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const o = list[c.dataIndex]; return [`${fmt(o.count)} views`, `${dur(o.secs)} in total`, `${dur(o.avg)} per view`]; } } } },
        scales: { x: { beginAtZero: true, title: { display: true, text: { secs: 'Minutes on screen', avg: 'Seconds per view', count: 'Views' }[S.panelM] } }, y: { grid: { display: false }, ticks: { font: { size: 11.5 } } } } } });
  }

  function renderMatrix(V) {
    const m = {}, rowsSet = new Set();
    for (const r of V) { (m[r[2]] = m[r[2]] || {})[r[1]] = (m[r[2]][r[1]] || 0) + r[6]; rowsSet.add(r[2]); }
    const rows = LC.filter(c => S.lc.has(c) && rowsSet.has(c)), cols = DASH.filter(d => S.dash.has(d));
    if (!rows.length) { $('#la-matrix').innerHTML = `<tbody><tr><td class="la-empty" style="font-size:13px">${NO_DATA}</td></tr></tbody>`; return; }
    const max = Math.max(1, ...rows.flatMap(r => cols.map(c => (m[r] || {})[c] || 0)));
    $('#la-matrix').innerHTML = `<thead><tr><th></th>${cols.map(c => `<th scope="col">${esc(DASH_NAME[c])}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><th scope="row"><span class="la-flag">${flag(r)}${esc(LC_SHORT[r] || LC_NAME[r])}</span></th>${cols.map(c => { const v = (m[r] || {})[c] || 0; return `<td style="${shade(v, max, '11,92,102')}" title="${esc(LC_NAME[r])} → ${esc(DASH_NAME[c])}: ${fmt(v)} visits">${v ? fmt(v) : '·'}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
  }

  function renderWhen() {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    let any = 0;
    for (const r of D.when) if (pass(r, 4)) { g[+r[5]][+r[6]] += r[7]; any += r[7]; }
    const max = Math.max(1, ...g.flat());
    $('#la-when').innerHTML = `<thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th scope="col">${h % 3 === 0 ? (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p') : ''}</th>`).join('')}</tr></thead><tbody>${g.map((row, d) => `<tr><th scope="row">${DOW[d]}</th>${row.map((v, h) => `<td style="${shade(v, max, '232,180,74').replace('color:#fff', 'color:#3b2a00')}" title="${DOW[d]} ${h}:00–${h}:59: ${fmt(v)} visits">${v}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('#la-when-sub').textContent = any ? 'Visits by day and hour (Analytics time zone). Hover a square for the count.' : NO_DATA;
  }

  function renderTech() {
    const dev = {}, tech = {};
    for (const r of D.tech) if (pass(r, 4)) { dev[r[5]] = (dev[r[5]] || 0) + r[8]; const k = S.techM === 'browser' ? r[6] : r[7]; tech[k] = (tech[k] || 0) + r[8]; }
    const donut = (id, obj, palette) => {
      const el = document.getElementById(id);
      let e = Object.entries(obj).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
      if (!e.length) { emptyIn(el, NO_DATA); return; } emptyIn(el, '');
      if (e.length > 6) e = e.slice(0, 5).concat([['Other', e.slice(5).reduce((a, x) => a + x[1], 0)]]);
      chart(id, { type: 'doughnut', data: { labels: e.map(x => x[0] === '(not set)' ? 'Unknown' : x[0].replace(/^./, c => c.toUpperCase())), datasets: [{ data: e.map(x => x[1]), backgroundColor: palette, borderWidth: 2, borderColor: '#fffdf8' }] },
        options: { maintainAspectRatio: false, animation: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)} visits` } } } } });
    };
    donut('la-devices', dev, ['#0B5C66', '#e8b44a', '#e0464f', '#7b4fd8']);
    donut('la-tech', tech, ['#0b2a3c', '#13808c', '#e8b44a', '#e0464f', '#7b4fd8', '#a9a196']);
  }

  function renderRecent() {
    const R = D.recent.filter(r => pass(r, 4, 8)).sort((a, b) => b[0].localeCompare(a[0]));
    const show = R.slice(0, S.recentN);
    $('#la-recent-count').textContent = R.length ? `Showing ${fmt(show.length)} of ${fmt(R.length)}` : '';
    $('#la-recent').innerHTML = `<thead><tr><th class="la-l">When</th><th class="la-l">Whose link</th><th class="la-l">Link type</th><th class="la-l">Dashboard</th><th class="la-l">Location</th><th class="la-l">Device</th><th>Visits</th><th>Time engaged</th></tr></thead><tbody>${show.length ? show.map(r => `<tr>
      <td>${esc(dhm(r[0]))}</td><td class="la-l"><span class="la-flag">${flag(r[2])}${esc(LC_SHORT[r[2]] || LC_NAME[r[2]])}</span></td><td class="la-l"><span class="la-pill la-pill--${r[3]}">${esc(LT_NAME[r[3]])}</span></td>
      <td class="la-l">${esc(DASH_NAME[r[1]])}</td><td class="la-l">${esc(cityName(r[5], r[4]))}</td><td class="la-l">${esc((r[6] || 'unknown').replace(/^./, c => c.toUpperCase()))}</td><td>${fmt(r[7])}</td><td>${dur(r[8])}</td></tr>`).join('') : `<tr><td colspan="8" class="la-l la-zero">${NO_DATA}</td></tr>`}</tbody>`;
    $('#la-recent-more').hidden = R.length <= S.recentN;
  }

  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => D && renderMap(D.visits.filter(r => pass(r, 4))), 200); });
})();
