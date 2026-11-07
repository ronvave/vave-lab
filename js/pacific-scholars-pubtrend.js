/* Panel B3: Publication Output Over Time (Regional Pacific Scholars Dashboard).
   Lines of publications per year for each country, read from each country's
   anonymous `pubCube` in the encrypted regional bundle: rows of
   [year, type, mask, n]. The mask has two bits per scholar category
   (k = degree*3 + gender; degree 0 PhD, 1 Master's without PhD, 2 none
   recorded; gender 0 female, 1 male, 2 not recorded): bit 2k = a linked
   roster scholar of that category is an author, bit 2k+1 = that scholar is
   the lead author. Mask 0 = no linked roster scholar ("All authors" only).
   Counts only; no titles, names or IDs. Countries without a cube are shown
   as "not recorded", never as zero. No CSV download. */
(function () {
  'use strict';
  const COLORS = { FJI: '#2f86d6', TON: '#e0464f', SLB: '#14a99a', VUT: '#e9a40f', WSM: '#3a63d8', FSM: '#7b4fd8', KIR: '#13a9c4', MHL: '#d93a7a', TUV: '#22a663', COK: '#a463e6', PLW: '#ef7d1a', HAW: '#c0602f' };
  const SHORT = { FJI: 'Fiji', TON: 'Tonga', SLB: 'Solomon Is.', VUT: 'Vanuatu', WSM: 'Samoa', FSM: 'FSM', KIR: 'Kiribati', MHL: 'Marshall Is.', TUV: 'Tuvalu', COK: 'Cook Is.', PLW: 'Palau', HAW: 'Hawaiʻi' };
  const TYPES = ['PhD thesis', "Master's thesis", 'Journal article', 'Book chapter', 'Book', 'Report'];
  const ROLE_TXT = { lead: 'Indigenous lead author', coauth: 'Indigenous coauthor', either: 'either role', all: 'all authors' };
  const DEG = { all: [0, 1, 2], mp: [0, 1], m: [1], p: [0] };
  const GEN = { all: [0, 1, 2], f: [0], m: [1], u: [2] };
  const NS = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const NOW_Y = new Date().getFullYear();

  let panel, C = [], order = [], hoverY = null, focusC = null;
  const S = { view: 'chart', role: 'either', scale: 'lin', deg: 'all', gen: 'all', types: new Set(TYPES), on: new Set(), ra: null, rb: null };
  let FULL = { a: 1950, b: NOW_Y }, drag = null;

  function init(D) {
    panel = $('ps-po-panel');
    if (!panel || !D || !Array.isArray(D.countries)) return;
    C = D.countries.filter(c => COLORS[c.code]);
    if (!C.some(c => Array.isArray(c.pubCube))) { panel.hidden = true; return; }
    // Order: most publications first (default view), so the legend reads like the chart.
    order = C.slice().sort((a, b) => total(b) - total(a)).map(c => c.code);
    order.forEach(code => { if (Array.isArray(byCode(code).pubCube)) S.on.add(code); });
    panel.hidden = false;
    buildTypes(); buildCountries(); wire();
    render();
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 120); });
  }
  const byCode = code => C.find(c => c.code === code);
  const total = c => (c.pubCube || []).reduce((s, r) => s + r[3], 0);

  function buildTypes() {
    const row = $('ps-po-types');
    TYPES.forEach(t => {
      const lab = document.createElement('label');
      lab.className = 'ps-po-chk';
      lab.innerHTML = `<input type="checkbox" checked value="${esc(t)}">${esc(t)}`;
      if (t === 'Report') lab.title = "Reports are counted in Fiji's Master file only";
      row.appendChild(lab);
    });
    row.insertAdjacentHTML('beforeend', '<button type="button" class="ps-po-link" data-po-types="all">Select all</button><button type="button" class="ps-po-link" data-po-types="none">Clear</button>');
  }
  function buildCountries() {
    const row = $('ps-po-countries');
    order.forEach(code => {
      const has = Array.isArray(byCode(code).pubCube);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ps-po-cc'; b.dataset.code = code;
      b.style.setProperty('--c', COLORS[code]);
      b.setAttribute('aria-pressed', String(has));
      b.disabled = !has;
      b.title = has ? `Show or hide ${SHORT[code]}` : 'Publication data not recorded for this country in this build';
      b.innerHTML = `<img src="img/regional/flags/${code.toLowerCase()}.png" alt=""><span class="sw" aria-hidden="true"></span>${esc(SHORT[code])}${has ? '' : ' (not recorded)'}`;
      row.appendChild(b);
    });
    row.insertAdjacentHTML('beforeend', '<button type="button" class="ps-po-link" data-po-cc="all">Select all</button><button type="button" class="ps-po-link" data-po-cc="none">Clear</button>');
  }

  function seg(attr, key) {
    panel.querySelectorAll(`[data-po-${attr}]`).forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      S[key] = b.dataset['po' + attr[0].toUpperCase() + attr.slice(1)];
      sync(); render();
    }));
  }
  function sync() {
    const set = (attr, v) => panel.querySelectorAll(`[data-po-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(`data-po-${attr}`) === v)));
    if (S.role === 'all') { S.deg = 'all'; S.gen = 'all'; }
    set('view', S.view); set('role', S.role); set('scale', S.scale); set('deg', S.deg); set('gen', S.gen);
    panel.querySelectorAll('[data-po-deg],[data-po-gen]').forEach(b => { b.disabled = S.role === 'all'; });
    $('ps-po-whonote').hidden = S.role !== 'all';
    const pre = S.ra == null && S.rb == null ? 'all' : (S.rb == null || S.rb === FULL.b) ? (S.ra === 1980 ? '1980' : S.ra === 2000 ? '2000' : S.ra === FULL.b - 9 ? '10' : '') : '';
    set('preset', pre);
    const a = S.ra == null ? FULL.a : S.ra, b = S.rb == null ? FULL.b : S.rb;
    [['ps-po-from', a], ['ps-po-to', b]].forEach(([id, v]) => { const i = $(id); i.min = FULL.a; i.max = FULL.b; i.value = v; });
    $('ps-po-zin').disabled = b - a <= 4;
    $('ps-po-zout').disabled = a <= FULL.a && b >= FULL.b;
    $('ps-po-zreset').hidden = S.ra == null && S.rb == null;
    panel.querySelectorAll('[data-po-pane]').forEach(p => { p.hidden = p.dataset.poPane !== S.view; });
    panel.querySelectorAll('#ps-po-types input').forEach(i => { i.checked = S.types.has(i.value); });
    panel.querySelectorAll('#ps-po-countries .ps-po-cc').forEach(b => { if (!b.disabled) b.setAttribute('aria-pressed', String(S.on.has(b.dataset.code))); });
  }
  function wire() {
    seg('view', 'view'); seg('role', 'role'); seg('scale', 'scale'); seg('deg', 'deg'); seg('gen', 'gen');
    $('ps-po-types').addEventListener('change', e => { const i = e.target; if (i.type !== 'checkbox') return; i.checked ? S.types.add(i.value) : S.types.delete(i.value); render(); });
    $('ps-po-countries').addEventListener('click', e => { const b = e.target.closest('.ps-po-cc'); if (!b || b.disabled) return; const c = b.dataset.code; S.on.has(c) ? S.on.delete(c) : S.on.add(c); render(); });
    panel.querySelectorAll('[data-po-types]').forEach(b => b.addEventListener('click', () => { S.types = new Set(b.dataset.poTypes === 'all' ? TYPES : []); sync(); render(); }));
    panel.querySelectorAll('[data-po-cc]').forEach(b => b.addEventListener('click', () => { S.on = new Set(b.dataset.poCc === 'all' ? order.filter(c => Array.isArray(byCode(c).pubCube)) : []); sync(); render(); }));
    // Hover a country in the checklist to highlight its line.
    $('ps-po-countries').addEventListener('mouseover', e => { const l = e.target.closest('.ps-po-cc'); setFocus(l ? l.dataset.code : null); });
    $('ps-po-countries').addEventListener('mouseleave', () => setFocus(null));
    // Zoom: presets, From/To boxes, + / − buttons, drag-to-zoom, double-click to reset.
    const setRange = (a, b) => {
      a = Math.max(FULL.a, Math.min(FULL.b, Math.round(a))); b = Math.max(FULL.a, Math.min(FULL.b, Math.round(b)));
      if (a > b) [a, b] = [b, a];
      if (b - a < 2) { const m = (a + b) / 2; a = Math.max(FULL.a, Math.floor(m - 1)); b = Math.min(FULL.b, a + 2); }
      if (a <= FULL.a && b >= FULL.b) { S.ra = S.rb = null; } else { S.ra = a; S.rb = b; }
      render();
    };
    const cur = () => [S.ra == null ? FULL.a : S.ra, S.rb == null ? FULL.b : S.rb];
    panel.querySelectorAll('[data-po-preset]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.poPreset;
      if (v === 'all') { S.ra = S.rb = null; render(); } else setRange(v === '10' ? FULL.b - 9 : +v, FULL.b);
    }));
    ['ps-po-from', 'ps-po-to'].forEach(id => $(id).addEventListener('change', () => { const f = +$('ps-po-from').value, t = +$('ps-po-to').value; if (f && t) setRange(f, t); else render(); }));
    $('ps-po-zin').addEventListener('click', () => { const [a, b] = cur(), m = hoverY != null ? hoverY : (a + b) / 2, h = Math.max(2, (b - a) / 4); setRange(m - h, m + h); });
    $('ps-po-zout').addEventListener('click', () => { const [a, b] = cur(), m = (a + b) / 2, h = Math.max(4, (b - a)); setRange(m - h, m + h); });
    $('ps-po-zreset').addEventListener('click', () => { S.ra = S.rb = null; render(); });
    const svg = $('ps-po-svg');
    svg.addEventListener('mousedown', e => { if (e.button) return; const y = yearAt(e); if (y == null) return; drag = { a: y, b: y }; e.preventDefault(); });
    window.addEventListener('mouseup', () => { if (!drag) return; const d = drag; drag = null; if (Math.abs(d.b - d.a) >= 2) setRange(d.a, d.b); else drawHover(); });
    svg.addEventListener('dblclick', () => { S.ra = S.rb = null; render(); });
    svg.addEventListener('mousemove', e => { const y = yearAt(e); if (drag && y != null) { drag.b = y; } if (y !== hoverY || drag) { hoverY = y; drawHover(); } });
    svg.addEventListener('mouseleave', () => { hoverY = null; drawHover(); });
    svg.addEventListener('keydown', e => {
      if (!G) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); hoverY = Math.max(G.Y0, Math.min(G.Y1, (hoverY == null ? G.Y1 : hoverY) + (e.key === 'ArrowRight' ? 1 : -1))); drawHover(); }
      if (e.key === 'Escape') { hoverY = null; drawHover(); }
    });
    svg.addEventListener('blur', () => { hoverY = null; drawHover(); });
    // Full screen: the whole panel (filters + chart), with a fixed-position fallback.
    const fb = $('ps-po-full');
    const changed = () => { const on = document.fullscreenElement === panel || panel.classList.contains('is-full'); fb.textContent = on ? '✕ Exit full screen' : '⛶ Full screen'; fb.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); render(); };
    fb.addEventListener('click', () => {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (panel.classList.contains('is-full')) { panel.classList.remove('is-full'); changed(); return; }
      panel.classList.add('is-full');
      if (panel.requestFullscreen) panel.requestFullscreen().catch(() => {}).finally(changed); else changed();
    });
    document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement !== panel) panel.classList.remove('is-full'); changed(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.fullscreenElement && panel.classList.contains('is-full')) { panel.classList.remove('is-full'); changed(); } });
  }

  // Count publications per year for one country under the current filters.
  function series(c) {
    const cats = []; DEG[S.deg].forEach(d => GEN[S.gen].forEach(g => cats.push(d * 3 + g)));
    let pres = 0, lead = 0; cats.forEach(k => { pres += 2 ** (2 * k); lead += 2 ** (2 * k + 1); });
    const out = new Map(); let first = Infinity, later = 0;
    for (const [y, t, mask, n] of c.pubCube) {
      if (!S.types.has(t)) continue;
      let ok;
      if (S.role === 'all') ok = true;
      else {
        const p = andBits(mask, pres) !== 0, l = andBits(mask, lead) !== 0;
        ok = S.role === 'lead' ? l : S.role === 'coauth' ? (p && !l) : p;
      }
      if (!ok) continue;
      if (y > NOW_Y) { later += n; continue; }
      out.set(y, (out.get(y) || 0) + n);
      if (y < first) first = y;
    }
    return { m: out, first, later };
  }
  // Masks reach 2^18, beyond 32-bit bitwise operators' safe range in some paths; do it arithmetically.
  function andBits(a, b) { let r = 0, bit = 1; while (a > 0 && b > 0) { if ((a % 2) && (b % 2)) r += bit; a = Math.floor(a / 2); b = Math.floor(b / 2); bit *= 2; } return r; }

  let G = null;
  function render() {
    if (!panel || panel.hidden) return;
    sync();
    const on = order.filter(code => S.on.has(code) && Array.isArray(byCode(code).pubCube));
    const data = on.map(code => ({ code, ...series(byCode(code)) }));
    const later = data.reduce((s, d) => s + d.later, 0);
    const firstY = Math.min(...data.map(d => d.first).filter(Number.isFinite), 1950);
    FULL = { a: Math.floor(firstY / 10) * 10, b: NOW_Y };
    if (S.ra != null && S.ra < FULL.a) S.ra = FULL.a;
    sync();
    const Y0 = S.ra == null ? FULL.a : S.ra, Y1 = S.rb == null ? FULL.b : S.rb;
    renderChart(data, Y0, Y1);
    renderList(data, Y0, Y1);
    const missing = C.filter(c => !Array.isArray(c.pubCube)).map(c => SHORT[c.code]);
    const desc = `${ROLE_TXT[S.role]}${S.role === 'all' ? '' : `, ${({ all: 'all scholars', mp: "scholars with a Master's or PhD", m: "scholars whose highest degree is a Master's", p: 'scholars with a PhD' })[S.deg]}, ${({ all: 'all genders', f: 'female', m: 'male', u: 'gender not recorded' })[S.gen]}`}`;
    $('ps-po-note').textContent = `Showing ${desc}. Each publication is counted once within each country; work coauthored by scholars from two countries appears in both lines. Lead author = listed first in the Master's Authorship tab. Each line starts at that country's first recorded publication. ${NOW_Y} is a partial year.` +
      (later ? ` ${later} record${later === 1 ? '' : 's'} dated after ${NOW_Y} (forthcoming) ${later === 1 ? 'is' : 'are'} not plotted.` : '') +
      (Y0 !== FULL.a || Y1 !== FULL.b ? ` Zoomed to ${Y0}–${Y1}.` : '') +
      (missing.length ? ` Not recorded in this build: ${missing.join(', ')}.` : '') +
      ' Hover over or use the arrow keys on the chart to see each country\u2019s count; click a country to show or hide its line.';
  }

  function renderChart(data, Y0, Y1) {
    const box = $('ps-po-chart'), svg = $('ps-po-svg');
    const full = panel.classList.contains('is-full') || document.fullscreenElement === panel;
    const W = Math.max(720, box.clientWidth - 16);
    const H = full ? Math.max(380, box.clientHeight - 14) : 470;
    const L = 52, R = 118, T = 32, B = 36;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H); svg.textContent = '';
    const x = y => L + (y - Y0) / (Y1 - Y0) * (W - L - R);
    let max = 0; data.forEach(d => d.m.forEach((v, y) => { if (y >= Y0 && y <= Y1 && v > max) max = v; }));
    const log = S.scale === 'log';
    const step = max > 100 ? 20 : max > 40 ? 10 : max > 16 ? 5 : max > 6 ? 2 : 1;
    const top = log ? Math.max(1, max) : Math.max(step, Math.ceil(max / step) * step);
    const f = v => log ? Math.log10(v + 1) / Math.log10(top + 1) : v / top;
    const yy = v => H - B - f(v) * (H - T - B);
    // Decade bands with labels across the top (same look as B1).
    for (let d = Math.floor(Y0 / 10) * 10; d <= Y1; d += 10) {
      const i = Math.round(d / 10), x0 = x(Math.max(d, Y0)), x1 = x(Math.min(d + 10, Y1));
      if (x1 <= x0) continue;
      el('rect', { x: x0, y: T - 22, width: x1 - x0, height: H - B - T + 22, fill: i % 2 ? 'rgba(127,227,230,0.11)' : 'rgba(3,19,39,0.35)' }, svg);
      if (x1 - x0 > 30) el('text', { x: (x0 + x1) / 2, y: T - 8, 'text-anchor': 'middle', fill: '#a9c0d8', 'font-size': 12.5, 'font-weight': 700 }, svg).textContent = d + 's';
    }
    // Partial current year.
    if (Y1 === NOW_Y) {
      el('rect', { x: x(Y1 - 0.5), y: T, width: x(Y1) - x(Y1 - 0.5), height: H - B - T, fill: 'rgba(255,237,41,0.10)' }, svg);
      el('text', { x: x(Y1) - 4, y: T + 14, 'text-anchor': 'end', fill: '#FFED29', 'font-size': 11 }, svg).textContent = `${Y1} partial`;
    }
    // Y grid.
    const ticks = log ? [0, 1, 2, 5, 10, 20, 50, 100, 200, 500].filter(v => v <= top) : Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
    ticks.forEach(v => {
      el('line', { x1: L, x2: W - R, y1: yy(v), y2: yy(v), stroke: 'rgba(169,192,216,0.16)' }, svg);
      el('text', { x: L - 8, y: yy(v) + 4, 'text-anchor': 'end', fill: '#a9c0d8', 'font-size': 12 }, svg).textContent = v;
    });
    el('text', { x: 14, y: (T + H - B) / 2, transform: `rotate(-90 14 ${(T + H - B) / 2})`, 'text-anchor': 'middle', fill: '#a9c0d8', 'font-size': 12 }, svg).textContent = log ? 'Publications per year (log scale)' : 'Publications per year';
    el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: '#a9c0d8', 'stroke-width': 1.2 }, svg);
    const span = Y1 - Y0, minor = span <= 16 ? 1 : 5, lab = span <= 16 ? 1 : span <= 40 ? 5 : 10;
    for (let y = Math.ceil(Y0 / minor) * minor; y <= Y1; y += minor) {
      const major = y % lab === 0;
      el('line', { x1: x(y), x2: x(y), y1: H - B, y2: H - B + (major ? 6 : 3), stroke: '#a9c0d8' }, svg);
      if (major) el('text', { x: x(y), y: H - B + 21, 'text-anchor': 'middle', fill: '#eaf3fb', 'font-size': 13 }, svg).textContent = y;
    }
    const gl = el('g', {}, svg);
    if (!data.length || !S.types.size || data.every(d => !d.m.size)) {
      el('text', { x: (L + W - R) / 2, y: (T + H - B) / 2, 'text-anchor': 'middle', fill: '#a9c0d8', 'font-size': 15 }, svg).textContent =
        !data.length ? 'No countries selected. Click a country to show it.' : !S.types.size ? 'No publication types ticked. Tick at least one type.' : 'No publications recorded for this selection.';
    }
    const ends = [];
    const dots = span <= 25;
    data.slice().reverse().forEach(d => {
      if (!Number.isFinite(d.first) || d.first > Y1) return;
      let p = '';
      if (dots) for (let y = Math.max(Y0, d.first); y <= Y1; y++) el('circle', { class: 'ps-po-line', 'data-code': d.code, cx: x(y), cy: yy(d.m.get(y) || 0), r: 2.6, fill: COLORS[d.code] }, gl);
      for (let y = Math.max(Y0, d.first); y <= Y1; y++) p += (p ? 'L' : 'M') + x(y).toFixed(1) + ',' + yy(d.m.get(y) || 0).toFixed(1);
      const big = data.indexOf(d) < 3;
      el('path', { d: p, class: 'ps-po-line', 'data-code': d.code, fill: 'none', stroke: COLORS[d.code], 'stroke-width': big ? 2.6 : 1.8, 'stroke-linejoin': 'round' }, gl);
      ends.push({ code: d.code, py: yy(d.m.get(Y1) || 0) });
    });
    ends.sort((a, b) => a.py - b.py);
    let last = -1e9; ends.forEach(e => { e.ly = Math.max(e.py, last + 14); last = e.ly; });
    const over = last - (H - B); if (over > 0) ends.forEach(e => { e.ly -= over; });
    ends.forEach(e => {
      const g = el('g', { class: 'ps-po-line', 'data-code': e.code }, gl);
      el('line', { x1: x(Y1) + 3, x2: x(Y1) + 12, y1: e.py, y2: e.ly, stroke: COLORS[e.code] }, g);
      el('text', { x: x(Y1) + 15, y: e.ly + 4, fill: COLORS[e.code], 'font-size': 12, 'font-weight': 700 }, g).textContent = SHORT[e.code];
    });
    G = { x, yy, Y0, Y1, L, R, W, H, T, B, data, hover: el('g', {}, svg) };
    el('rect', { x: L, y: T, width: W - L - R, height: H - B - T, fill: 'transparent' }, svg);
    if (hoverY != null && (hoverY < Y0 || hoverY > Y1)) hoverY = null;
    drawHover(); setFocus(focusC);
  }

  function yearAt(e) {
    if (!G) return null;
    const svg = $('ps-po-svg'), r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (G.W / r.width);
    if (px < G.L - 10 || px > G.W - G.R + 10) return null;
    const y = Math.round(G.Y0 + (px - G.L) / (G.W - G.L - G.R) * (G.Y1 - G.Y0));
    return Math.max(G.Y0, Math.min(G.Y1, y));
  }
  function drawHover() {
    const tip = $('ps-po-tip');
    if (!G) return;
    G.hover.textContent = '';
    if (drag) {
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
      el('rect', { x: G.x(a), y: G.T, width: Math.max(2, G.x(b) - G.x(a)), height: G.H - G.B - G.T, fill: 'rgba(255,237,41,0.16)', stroke: '#FFED29', 'stroke-dasharray': '4 3' }, G.hover);
      el('text', { x: (G.x(a) + G.x(b)) / 2, y: G.T + 30, 'text-anchor': 'middle', fill: '#FFED29', 'font-size': 13, 'font-weight': 700 }, G.hover).textContent = b - a >= 2 ? `${a}–${b}` : 'Drag wider to zoom';
      tip.classList.remove('show'); return;
    }
    if (hoverY == null) { tip.classList.remove('show'); return; }
    const X = G.x(hoverY);
    el('line', { x1: X, x2: X, y1: G.T, y2: G.H - G.B, stroke: 'rgba(255,255,255,0.55)', 'stroke-dasharray': '4 4' }, G.hover);
    const rows = G.data.filter(d => Number.isFinite(d.first) && d.first <= hoverY).map(d => ({ code: d.code, v: d.m.get(hoverY) || 0 }));
    rows.forEach(r => el('circle', { cx: X, cy: G.yy(r.v), r: 3.6, fill: COLORS[r.code], stroke: '#fff', 'stroke-width': 1 }, G.hover));
    rows.sort((a, b) => b.v - a.v);
    const later = G.data.filter(d => !(Number.isFinite(d.first) && d.first <= hoverY)).map(d => SHORT[d.code]);
    tip.innerHTML = `<h4>${hoverY}${hoverY === G.Y1 ? ' (partial)' : ''} <span>· ${esc(ROLE_TXT[S.role])}</span></h4>` +
      (rows.length ? rows.map(r => `<div class="r"><span><i style="background:${COLORS[r.code]}"></i>${esc(SHORT[r.code])}</span><b>${r.v}</b></div>`).join('') : '<div>No country has publications recorded by this year.</div>') +
      (later.length ? `<div style="margin-top:4px;color:#4b5b6e">None yet in this view: ${esc(later.join(', '))}</div>` : '');
    tip.classList.add('show');
    const svg = $('ps-po-svg'), sc = svg.getBoundingClientRect().width / G.W;
    const tw = tip.offsetWidth, px = X * sc + 8;
    tip.style.left = (X > (G.L + G.W - G.R) / 2 ? Math.max(4, px - tw - 18) : px + 18) + 'px';
    tip.style.top = (G.T * sc + 10) + 'px';
  }
  function setFocus(code) {
    focusC = code;
    const box = $('ps-po-chart');
    box.classList.toggle('ps-po-dim', !!code && S.on.has(code));
    box.querySelectorAll('.ps-po-line').forEach(p => p.classList.toggle('is-on', p.dataset.code === code));
  }

  function renderList(data, Y0, Y1) {
    const host = $('ps-po-list');
    if (!data.length) { host.innerHTML = '<p style="padding:14px">No countries selected. Click a country to show it.</p>'; return; }
    const head = `<thead><tr><th scope="col">Year</th>${data.map(d => `<th scope="col"><img src="img/regional/flags/${d.code.toLowerCase()}.png" alt="">${esc(SHORT[d.code])}</th>`).join('')}</tr></thead>`;
    let body = '';
    for (let dec = Math.floor(Y1 / 10) * 10; dec + 9 >= Y0; dec -= 10) {
      const lo = Math.max(dec, Y0), hi = Math.min(dec + 9, Y1);
      const sums = data.map(d => { let s = 0; for (let y = lo; y <= hi; y++) s += d.m.get(y) || 0; return s; });
      body += `<tr class="dec"><th scope="row">${lo === dec && hi === dec + 9 ? dec + 's total' : `${lo}–${hi} total`}</th>${sums.map(s => `<td${s ? '' : ' class="z"'}>${s}</td>`).join('')}</tr>`;
      for (let y = hi; y >= lo; y--) {
        body += `<tr${y === NOW_Y ? ' class="part"' : ''}><th scope="row">${y}</th>${data.map(d => {
          if (!Number.isFinite(d.first) || y < d.first) return '<td class="z">–</td>';
          const v = d.m.get(y) || 0; return `<td${v ? '' : ' class="z"'}>${v}</td>`;
        }).join('')}</tr>`;
      }
    }
    host.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;
  }

  window.PSPubTrend = { init };
})();
