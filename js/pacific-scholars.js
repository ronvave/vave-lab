/* Regional Pacific Scholars Dashboard (pacific-scholars.html)
 * Authored for Vave Lab, 2026.
 *
 * Data flow: data/regional-scholars.json.enc (IVAV v1: magic|salt16|iv12|AES-GCM)
 * is fetched, decrypted locally with a PBKDF2-SHA256 (200k) key derived from
 * the passcode, and rendered. The bundle holds aggregates plus a minimal
 * scholar search index (name, country, degree levels, field, university).
 * No spreadsheet IDs, tokens, contact details, geography, genealogy or notes.
 */
(function () {
  'use strict';

  const ENC_URL = 'data/regional-scholars.json.enc';
  const BASEMAP_URL = 'data/regional-basemap.json';
  const CREDITS_URL = 'img/regional/credits.json';

  const COLORS = {
    FJI: '#2f86d6', TON: '#e0464f', SLB: '#14a99a', VUT: '#e9a40f', WSM: '#3a63d8', FSM: '#7b4fd8',
    KIR: '#13a9c4', MHL: '#d93a7a', TUV: '#22a663', COK: '#a463e6', PLW: '#ef7d1a',
  };
  const SHORT = { FJI: 'Fiji', TON: 'Tonga', SLB: 'Solomon Is.', VUT: 'Vanuatu', WSM: 'Samoa', FSM: 'FSM', KIR: 'Kiribati', MHL: 'Marshall Is.', TUV: 'Tuvalu', COK: 'Cook Is.', PLW: 'Palau' };
  const CARD_SUB = {};
  const METRICS = {
    scholars: { key: 'scholars', label: 'Scholars', unit: 'Indigenous scholars', def: 'Scholars = unique Indigenous scholar on each country\u2019s included roster.' },
    phd: { key: 'phd', label: 'PhDs', unit: 'completed PhDs / doctorates', def: 'PhDs = completed PhD and doctorate degree records held by those scholars.' },
    masters: { key: 'masters', label: "Master's", unit: "completed Master's degrees", def: "Master's = completed Master's degree records held by those scholars." },
  };
  const DEST_ORDER = ['Pacific', 'Australia', 'New Zealand', 'North America', 'Europe', 'Asia', 'Other', 'Unknown'];
  const DEST_COLOR = { Pacific: '#3fd0d8', Australia: '#f3c45a', 'New Zealand': '#7ee08a', 'North America': '#f39a4a', Europe: '#c58cf5', Asia: '#ff6f91', Other: '#9fb3c8', Unknown: '#5e7690' };
  const DISC_COLOR = ['#6fb04a', '#f0a42b', '#1f9ec9', '#e4553f', '#3b5fbf', '#8e5bc7', '#18a39a', '#c6c33a'];
  const ICONS = {
    person: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M1.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5zM12 20c.3-2.4 1.5-4.4 3.4-5.6.2 0 .4-.1.6-.1 3.6 0 6.5 2.9 6.5 5.7z"/></svg>',
    cap: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3L1 9l11 6 9-4.9V17h2V9z"/><path d="M5 13.2V17c2 2 12 2 14 0v-3.8L12 17z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z"/><path d="M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/></svg>',
  };

  const state = { metric: 'scholars', sel: null, barView: 'metric', disc: 'ALL', discLevel: 'all', destHome: '', destLevel: 'all', destDec: '', mapView: null };
  let D = null, BM = null, CREDITS = null, byCode = {};

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = n => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US'));
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const nameOf = code => (byCode[code] ? byCode[code].name : code);
  const countries = () => (D ? D.countries : []);

  // ================= DECRYPTION =================
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decryptBundle(pass) {
    const res = await fetch(ENC_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('missing');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (String.fromCharCode(...buf.slice(0, 4)) !== 'IVAV') throw new Error('format');
    const key = await deriveKey(pass, buf.slice(4, 20));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(20, 32) }, key, buf.slice(32));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function initGate() {
    const gate = $('#ps-gate'), form = $('#ps-gate-form'), err = $('#ps-gate-err'), input = $('#ps-pass');
    const tryPass = async (pass, silent) => {
      try {
        const data = await decryptBundle(pass);
        gate.hidden = true;
        document.body.style.overflow = '';
        await boot(data);
        return true;
      } catch (e) {
        if (!silent) err.textContent = e.message === 'missing' ? 'The encrypted regional data file is not available yet.' : 'That passcode did not unlock the data. Please try again.';
        return false;
      }
    };
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      err.textContent = 'Decrypting…';
      if (await tryPass(input.value, false)) input.value = '';
    });
    document.body.style.overflow = 'hidden';
    input.focus(); // passcode is held in memory only; never persisted
  }

  // ================= BOOT =================
  async function boot(data) {
    D = data;
    byCode = Object.fromEntries(D.countries.map(c => [c.code, c]));
    const [bm, cr] = await Promise.all([
      fetch(BASEMAP_URL).then(r => r.json()).catch(() => null),
      fetch(CREDITS_URL).then(r => r.json()).catch(() => null),
    ]);
    BM = bm; CREDITS = cr;
    readUrl();
    renderFresh();
    renderKpis();
    setupMetric();
    setupMap();
    setupBars();
    setupDisc();
    setupDest();
    setupFind();
    setupFirsts();
    setupPositions();
    setupDialogs();
    renderCredits();
    renderAll(true);
    if (window.PSDirectory) window.PSDirectory.init(D);
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    if (METRICS[p.get('metric')]) state.metric = p.get('metric');
    if (byCode[p.get('country')]) state.sel = p.get('country');
  }
  function writeUrl() {
    const p = new URLSearchParams(location.search);
    state.metric === 'scholars' ? p.delete('metric') : p.set('metric', state.metric);
    state.sel ? p.set('country', state.sel) : p.delete('country');
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  function renderFresh() {
    const g = new Date(D.generated);
    const latest = D.sources.filter(s => s.modified).map(s => new Date(s.modified)).sort((a, b) => b - a)[0];
    const opts = { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    $('#ps-fresh').textContent = `Built ${g.toLocaleString(undefined, opts)} from ${D.sources.filter(s => s.file).length} country Master files` + (latest ? ` · latest Master edit ${latest.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : '');
  }

  function totals(list = countries()) {
    return list.reduce((a, c) => { a.scholars += c.scholars; a.masters += c.masters; a.phd += c.phd; a.profDoc += c.profDoc; a.pubsIndexed += c.pubsIndexed; a.pubsIndigenous += c.pubsIndigenous; return a; }, { scholars: 0, masters: 0, phd: 0, profDoc: 0, pubsIndexed: 0, pubsIndigenous: 0 });
  }

  function renderKpis() {
    const t = totals();
    const connected = D.sources.filter(s => s.file).length;
    const items = [
      [ICONS.globe, fmt(connected), connected === D.sources.length ? 'Countries' : `of ${D.sources.length} countries connected`],
      [ICONS.people, fmt(t.scholars), 'Indigenous scholars'],
      [ICONS.cap, fmt(t.masters), "Completed Master's"],
      [ICONS.cap, fmt(t.phd), 'Completed PhDs'],
      [ICONS.doc, fmt(D.regional.uniqueIndigenousPubs), 'Indigenous\u2011linked publications'],
    ];
    $('#ps-kpis').innerHTML = items.map(([i, v, l]) => `<div class="ps-kpi">${i}<dt class="ps-sr">${esc(l)}</dt><dd class="ps-kpi__dd"><span class="ps-kpi__v">${v}</span><span class="ps-kpi__l">${esc(l)}</span></dd></div>`).join('');
  }

  // ================= METRIC TOGGLE =================
  function setupMetric() {
    const btns = $$('#ps-metric button');
    const set = m => { state.metric = m; btns.forEach(b => { b.setAttribute('aria-checked', String(b.dataset.metric === m)); b.tabIndex = b.dataset.metric === m ? 0 : -1; }); writeUrl(); renderAll(); };
    btns.forEach((b, i) => {
      b.addEventListener('click', () => set(b.dataset.metric));
      b.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length;
        btns[n].focus(); set(btns[n].dataset.metric);
      });
    });
    btns.forEach(b => { b.setAttribute('aria-checked', String(b.dataset.metric === state.metric)); b.tabIndex = b.dataset.metric === state.metric ? 0 : -1; });
    $('#ps-chip-clear').addEventListener('click', () => select(null));
  }

  function select(code) {
    state.sel = state.sel === code ? null : code;
    if (state.sel && D.disciplineCountries.includes(state.sel)) state.disc = state.sel;
    state.destHome = state.sel || '';
    writeUrl();
    renderAll();
  }

  function sorted() {
    const k = METRICS[state.metric].key;
    return countries().slice().sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1) || a.name.localeCompare(b.name));
  }

  function renderAll(first) {
    const m = METRICS[state.metric];
    $('#ps-metric-def').textContent = m.def;
    const chip = $('#ps-chip');
    chip.classList.toggle('is-on', !!state.sel);
    $('#ps-chip-text').textContent = state.sel ? `Filtered to ${nameOf(state.sel)}` : '';
    renderStrip(first);
    renderMap();
    renderBars();
    renderDegrees();
    renderOutputs();
    renderDisc();
    renderGender();
    renderDest();
    renderFirsts();
    renderPositions();
  }

  // ================= COUNTRY STRIP =================
  function renderStrip(first) {
    const ol = $('#ps-strip');
    const m = METRICS[state.metric];
    const prev = new Map($$('.ps-card', ol).map(el => [el.dataset.code, el.getBoundingClientRect()]));
    const list = sorted();
    ol.setAttribute('aria-label', `Countries in descending order of ${m.unit}`);
    const html = list.map((c, i) => {
      const v = c[m.key];
      const LINES = { scholars: `${fmt(c.scholars)} Scholars`, masters: `${fmt(c.masters)} Masters`, phd: `${fmt(c.phd)} PhD` };
      const sub = ['scholars', 'masters', 'phd'].filter(k => k !== state.metric).map(k => `<span>${LINES[k]}</span>`).join('');
      const icon = state.metric === 'scholars' ? ICONS.people : ICONS.cap;
      const btn = c.dashboard
        ? `<a class="ps-card__btn" href="${esc(c.dashboard)}" target="_blank" rel="noopener" aria-label="View ${esc(c.name)} dashboard (opens in a new tab; separate passcode)">View Dashboard<span aria-hidden="true">→</span></a>`
        : `<span class="ps-card__btn ps-card__btn--off">${c.dashboardStatus === 'development' ? 'Dashboard in development' : 'No dashboard yet'}</span>`;
      const valText = v == null ? 'Not available' : fmt(v);
      return `<li class="ps-card${state.sel === c.code ? ' is-selected' : ''}${state.sel && state.sel !== c.code ? ' is-dim' : ''}" data-code="${c.code}" style="--c:${COLORS[c.code]}">
        <div class="ps-card__name">${esc(c.code === 'FSM' ? 'FSM' : c.name)}${CARD_SUB[c.code] ? `<small>${CARD_SUB[c.code]}</small>` : ''}</div>
        <img class="ps-card__photo" src="img/regional/${c.code.toLowerCase()}.webp" alt="" width="240" height="150" loading="${i < 6 ? 'eager' : 'lazy'}" />
        <div class="ps-card__body">
          <button type="button" class="ps-card__sel" aria-pressed="${state.sel === c.code}" aria-label="Rank ${i + 1}: ${esc(c.name)}, ${valText} ${esc(m.unit)}. ${state.sel === c.code ? 'Selected; activate to clear filter' : 'Activate to filter dashboard'}">
            ${icon}<span class="ps-card__vl"><span class="ps-card__v">${valText}</span><span class="ps-card__l">${esc(m.label)}</span></span>
          </button>
          <div class="ps-card__sub">${sub}</div>
          ${btn}
        </div></li>`;
    }).join('');
    ol.innerHTML = html;
    $$('.ps-card__sel', ol).forEach(b => b.addEventListener('click', () => select(b.closest('.ps-card').dataset.code)));
    // FLIP re-sort animation
    if (!first && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $$('.ps-card', ol).forEach(el => {
        const p = prev.get(el.dataset.code); if (!p) return;
        const n = el.getBoundingClientRect(); const dx = p.left - n.left;
        if (!dx) return;
        el.style.transition = 'none'; el.style.transform = `translateX(${dx}px)`;
        requestAnimationFrame(() => { el.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)'; el.style.transform = ''; });
      });
    }
  }

  // ================= MAP =================
  // Map image: img/regional/pacific-map.webp (2400 x 1891 px, flags and labels baked in).
  // Badge anchors are measured in image pixels at the end of each label (side 'r') or
  // before its flag (side 'l'); badges live in the same coordinate space so they zoom with the image.
  const MAP_IMG = { src: 'img/regional/pacific-map.webp', w: 2400, h: 1891 };
  const MAP_ANCHOR = {"PLW": [454, 478, 'r'], "FSM": [774, 320, 'r'], "MHL": [1433, 422, 'r'], "KIR": [1783, 596, 'r'], "SLB": [1127, 776, 'r'], "TUV": [1606, 800, 'r'], "WSM": [1844, 907, 'r'], "FJI": [1358, 967, 'r'], "TON": [1567, 1221, 'r'], "COK": [2138, 1253, 'r'], "VUT": [749, 1023, 'l']};
  let mapSvg, mk = {};
  function setupMap() {
    const host = $('#ps-map');
    const W = MAP_IMG.w, H = MAP_IMG.h;
    mapSvg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Map of the Pacific with the number of Indigenous scholars beside each country' });
    const img = svgEl('image', { href: MAP_IMG.src, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'xMidYMid meet' });
    img.setAttribute('aria-hidden', 'true');
    mapSvg.appendChild(img);
    const mg = svgEl('g');
    countries().forEach(c => {
      const a = MAP_ANCHOR[c.code]; if (!a) return;
      const g = svgEl('g', { class: 'ps-mk', tabindex: '0', role: 'button', 'data-code': c.code });
      const pill = svgEl('rect', { class: 'ps-mk__pill', rx: 31, ry: 31, height: 64, stroke: COLORS[c.code] });
      const label = svgEl('text', { class: 'ps-mk__n', 'dominant-baseline': 'central' });
      g.append(pill, label);
      g.addEventListener('click', () => select(c.code));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.code); } });
      g.addEventListener('pointerenter', e => showTip(e, mapTip(c)));
      g.addEventListener('pointermove', e => moveTip(e));
      g.addEventListener('pointerleave', hideTip);
      g.addEventListener('focus', () => { const r = pill.getBoundingClientRect(); showTip({ clientX: r.right, clientY: r.top }, mapTip(c)); });
      g.addEventListener('blur', hideTip);
      mk[c.code] = { g, pill, label, a };
      mg.appendChild(g);
    });
    mapSvg.appendChild(mg);
    host.prepend(mapSvg);
    setView([0, 0, W, H]);
    // zoom & pan
    $$('[data-zoom]', host).forEach(b => b.addEventListener('click', () => zoom(b.dataset.zoom)));
    let drag = null;
    mapSvg.addEventListener('pointerdown', e => { if (e.target.closest('.ps-mk')) return; drag = { x: e.clientX, y: e.clientY, v: state.mapView.slice() }; mapSvg.setPointerCapture(e.pointerId); });
    mapSvg.addEventListener('pointermove', e => {
      if (!drag) return;
      const k = Math.max(drag.v[2] / mapSvg.clientWidth, drag.v[3] / mapSvg.clientHeight);
      setView([drag.v[0] - (e.clientX - drag.x) * k, drag.v[1] - (e.clientY - drag.y) * k, drag.v[2], drag.v[3]]);
    });
    const end = () => { drag = null; };
    mapSvg.addEventListener('pointerup', end); mapSvg.addEventListener('pointercancel', end);
    mapSvg.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoom(e.deltaY < 0 ? 'in' : 'out'); }, { passive: false });
    $('#ps-map-table-btn').addEventListener('click', e => {
      const t = $('#ps-map-table'); t.hidden = !t.hidden; e.currentTarget.setAttribute('aria-expanded', String(!t.hidden)); e.currentTarget.textContent = t.hidden ? 'Table view' : 'Hide table';
    });
  }
  function setView(v) {
    const W = MAP_IMG.w, H = MAP_IMG.h;
    v[2] = Math.max(W / 6, Math.min(W, v[2])); v[3] = v[2] * H / W;
    v[0] = Math.max(0, Math.min(W - v[2], v[0])); v[1] = Math.max(0, Math.min(H - v[3], v[1]));
    state.mapView = v; mapSvg.setAttribute('viewBox', v.map(n => n.toFixed(1)).join(' '));
  }
  function zoom(dir) {
    const W = MAP_IMG.w, H = MAP_IMG.h; const v = state.mapView;
    if (dir === 'reset') return setView([0, 0, W, H]);
    const f = dir === 'in' ? 0.7 : 1 / 0.7;
    const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2; const w = v[2] * f;
    setView([cx - w / 2, cy - (w * H / W) / 2, w, w * H / W]);
  }
  function mapTip(c) {
    const link = c.dashboard ? 'Country dashboard available (separate passcode)' : (c.dashboardStatus === 'development' ? 'Dashboard in development' : 'No country dashboard yet');
    return `<b>${esc(c.name)}</b>${fmt(c.scholars)} Indigenous scholars<br>${fmt(c.masters)} completed Master's · ${fmt(c.phd)} completed PhDs${c.profDoc ? ` (incl. ${c.profDoc} professional doctorate${c.profDoc > 1 ? 's' : ''})` : ''}<br>${fmt(c.pubsIndigenous)} Indigenous-linked publications<br><span style="color:#4a5d78">${link}. Click to filter.</span>`;
  }
  function renderMap() {
    const m = METRICS[state.metric];
    countries().forEach(c => {
      const o = mk[c.code]; if (!o) return;
      const txt = fmt(c.scholars);
      o.label.textContent = txt;
      const w = 31 * txt.length + 36, x = o.a[2] === 'l' ? o.a[0] - 14 - w : o.a[0] + 14;
      o.pill.setAttribute('x', x); o.pill.setAttribute('y', o.a[1] - 32); o.pill.setAttribute('width', w);
      o.label.setAttribute('x', x + w / 2); o.label.setAttribute('y', o.a[1] + 2); o.label.setAttribute('text-anchor', 'middle');
      o.g.setAttribute('aria-label', `${c.name}: ${txt} Indigenous scholars. ${state.sel === c.code ? 'Selected.' : ''} Activate to ${state.sel === c.code ? 'clear' : 'filter'}.`);
      o.g.setAttribute('aria-pressed', String(state.sel === c.code));
      o.g.classList.toggle('is-selected', state.sel === c.code);
      o.g.classList.toggle('is-dim', !!state.sel && state.sel !== c.code);
    });
    $('#ps-map-sub').textContent = 'Number of Indigenous scholars beside each country. Select a number to filter.';
    // accessible table
    const rows = sorted();
    const t = $('#ps-map-table');
    t.innerHTML = `<table class="ps-table"><caption>Countries sorted by ${esc(m.unit)} (descending)</caption><thead><tr><th scope="col">Country</th><th scope="col">Scholars (people)</th><th scope="col">Completed Master's</th><th scope="col">Completed PhDs</th><th scope="col">Dashboard</th></tr></thead><tbody>${rows.map(c => `<tr><th scope="row"><button class="ps-prov" type="button" data-sel="${c.code}">${esc(c.name)}</button></th><td>${fmt(c.scholars)}</td><td>${fmt(c.masters)}</td><td>${fmt(c.phd)}</td><td>${c.dashboard ? `<a href="${esc(c.dashboard)}">Open</a>` : (c.dashboardStatus === 'development' ? 'In development' : '—')}</td></tr>`).join('')}</tbody></table>`;
    $$('[data-sel]', t).forEach(b => b.addEventListener('click', () => select(b.dataset.sel)));
  }

  // ================= TOOLTIP =================
  const tip = () => $('#ps-tip');
  function showTip(e, html) { const t = tip(); t.innerHTML = html; t.classList.add('is-on'); moveTip(e); }
  function moveTip(e) { const t = tip(); const w = t.offsetWidth, h = t.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14; if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14; t.style.left = x + 'px'; t.style.top = y + 'px'; }
  function hideTip() { tip().classList.remove('is-on'); }

  // ================= DEGREES PANEL =================
  function renderDegrees() {
    const scope = state.sel ? [byCode[state.sel]] : countries();
    const t = totals(scope);
    const all = t.masters + t.phd;
    const C = 2 * Math.PI * 52;
    const mFrac = all ? t.masters / all : 0;
    const where = state.sel ? nameOf(state.sel) : `${scope.length} countries`;
    $('#ps-deg-sub').textContent = `Completed degrees held by Indigenous scholars — ${where}.`;
    $('#ps-deg').innerHTML = `
      <div class="ps-ring" role="img" aria-label="${fmt(all)} completed degrees: ${fmt(t.masters)} Master's and ${fmt(t.phd)} PhDs">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="#0b2a4f" stroke-width="12"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="#2aa7e6" stroke-width="12" stroke-dasharray="${(C * mFrac).toFixed(1)} ${C.toFixed(1)}"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="#123f86" stroke-width="12" stroke-dasharray="${(C * (1 - mFrac)).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-C * mFrac).toFixed(1)}"/></svg>
        <div class="ps-ring__c"><div class="ps-ring__v">${fmt(all)}</div><div class="ps-ring__l">Completed postgraduate degrees</div></div>
      </div>
      <div class="ps-degcards">
        <div class="ps-degcard">${ICONS.cap}<div><div class="ps-degcard__v">${fmt(t.masters)}</div><div class="ps-degcard__l">Completed Master's (${pct(t.masters, all)}%)</div></div></div>
        <div class="ps-degcard ps-degcard--phd">${ICONS.cap}<div><div class="ps-degcard__v">${fmt(t.phd)}</div><div class="ps-degcard__l">Completed PhDs / doctorates (${pct(t.phd, all)}%)${t.profDoc ? `<br>incl. ${t.profDoc} professional doctorate${t.profDoc > 1 ? 's' : ''}` : ''}</div></div></div>
      </div>
      <div class="ps-callout"><h3>Growing Pacific Knowledge Leadership</h3>
        <p>${fmt(t.scholars)} Indigenous scholars ${state.sel ? 'from ' + esc(nameOf(state.sel)) : 'across these databases'} hold ${fmt(all)} completed Master's and PhD degrees. Degrees are counted separately from people: a scholar with both counts once as a person and in both degree totals.</p></div>`;
  }

  // ================= OUTPUTS =================
  function renderOutputs() {
    const c = state.sel ? byCode[state.sel] : null;
    const years = c ? c.pubYears : D.regional.indigenousPubYears;
    const head = c ? c.pubsIndigenous : D.regional.uniqueIndigenousPubs;
    const yrs = []; for (let y = 2015; y <= 2026; y++) yrs.push(y);
    const vals = yrs.map(y => years[String(y)] || 0);
    const totalYears = Object.values(years).reduce((a, b) => a + b, 0);
    const future = Object.entries(years).filter(([y]) => +y > 2026).reduce((a, [, v]) => a + v, 0);
    const before = Object.entries(years).filter(([y]) => +y < 2015).reduce((a, [, v]) => a + v, 0);
    const noYear = head - totalYears;
    const max = Math.max(1, ...vals);
    const W = 340, H = 150, pad = 18, bw = (W - 10) / yrs.length;
    const bars = yrs.map((y, i) => {
      const h = (vals[i] / max) * (H - 32); const x = 5 + i * bw; const yy = H - pad - h;
      const partial = y === 2026;
      return `<g><rect class="ps-bar" x="${(x + 3).toFixed(1)}" y="${yy.toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${partial ? 'url(#ps-hatch)' : `hsl(${200 - i * 3} 70% ${58 - i * 3}%)`}"><title>${y}: ${fmt(vals[i])} Indigenous-linked publications${partial ? ' (partial year)' : ''}</title></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(yy - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0c2140">${vals[i]}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#4a5d78">${y}</text></g>`;
    }).join('');
    $('#ps-out').innerHTML = `
      <div class="ps-out__head">${ICONS.book}<div><div class="ps-out__v">${fmt(head)}</div><div class="ps-out__l">Indigenous-linked publications${c ? ' — ' + esc(c.name) : ' (regionally deduplicated)'}</div></div></div>
      <div class="ps-out__meta">
        <div><b>${fmt(c ? c.pubsIndexed : D.regional.uniquePubs)}</b>${c ? 'country-indexed records (headline types)' : 'unique country-indexed records, deduplicated'}</div>
        <div><b>${fmt(c ? c.pubsIndigenous : totals().pubsIndigenous)}</b>${c ? 'with an authorship link to an included scholar' : 'Indigenous-linked, summed before deduplication'}</div>
      </div>
      <div class="ps-chart" role="img" aria-label="Indigenous-linked publications per year, 2015 to 2026: ${yrs.map((y, i) => y + ' ' + vals[i]).join(', ')}">
        <svg viewBox="0 0 ${W} ${H}"><defs><pattern id="ps-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#9cc3e6"/><line x1="0" y1="0" x2="0" y2="5" stroke="#1d4f8a" stroke-width="2"/></pattern></defs>${bars}</svg>
      </div>
      <p class="ps-note">2026 is a partial year (hatched). ${fmt(before)} dated before 2015 not shown${noYear > 0 ? `; ${fmt(noYear)} have no year` : ''}${future ? `; <strong>${fmt(future)} dated after 2026 flagged as probable data-entry errors</strong>` : ''}.</p>`;
  }

  // ================= BARS =================
  function setupBars() {
    $$('[data-barview]').forEach(b => b.addEventListener('click', () => { state.barView = b.dataset.barview; $$('[data-barview]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderBars(); }));
    let wasNarrow = null;
    new ResizeObserver(() => { const n = ($('#ps-bars').clientWidth || 600) < 520; if (wasNarrow !== null && n !== wasNarrow) renderBars(); wasNarrow = n; }).observe($('#ps-bars'));
  }
  function renderBars() {
    const m = METRICS[state.metric];
    const list = sorted();
    const stack = state.barView === 'stack';
    const vals = list.map(c => (stack ? c.masters + c.phd : c[m.key] || 0));
    const max = Math.max(1, ...vals);
    const nice = (() => { const e = Math.pow(10, Math.floor(Math.log10(max))); return [1, 2, 2.5, 5, 10].map(f => f * e).find(v => v >= max); })();
    const narrow = ($('#ps-bars').clientWidth || 600) < 520;
    const W = narrow ? 400 : 520, H = narrow ? 270 : 240, L = 34, B = narrow ? 64 : 40, T = 16, Rt = 4;
    const cw = (W - L - Rt) / list.length, bw = Math.min(28, cw * 0.66);
    const y = v => T + (H - T - B) * (1 - v / nice);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = nice * i / 4; g += `<line x1="${L}" x2="${W - Rt}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#dfe6ef"/><text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#4a5d78">${fmt(Math.round(v))}</text>`; }
    list.forEach((c, i) => {
      const x = L + i * cw + (cw - bw) / 2;
      const col = COLORS[c.code];
      const dim = state.sel && state.sel !== c.code ? ' opacity=".35"' : '';
      if (stack) {
        const hm = (H - T - B) * c.masters / nice, hp = (H - T - B) * c.phd / nice;
        g += `<g data-code="${c.code}" class="ps-bargrp" tabindex="0" role="button" aria-label="${esc(c.name)}: ${fmt(c.masters)} completed Master's, ${fmt(c.phd)} completed PhDs"${dim}>
          <rect class="ps-bar" x="${x.toFixed(1)}" y="${(H - B - hm).toFixed(1)}" width="${bw.toFixed(1)}" height="${hm.toFixed(1)}" fill="${col}" fill-opacity=".5"/>
          <rect class="ps-bar" x="${x.toFixed(1)}" y="${(H - B - hm - hp).toFixed(1)}" width="${bw.toFixed(1)}" height="${hp.toFixed(1)}" fill="${col}" rx="2"/>
          <text x="${(x + bw / 2).toFixed(1)}" y="${(H - B - hm - hp - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0c2140">${fmt(c.masters + c.phd)}</text></g>`;
      } else {
        const v = c[m.key] || 0; const h = (H - T - B) * v / nice;
        g += `<g data-code="${c.code}" class="ps-bargrp" tabindex="0" role="button" aria-label="${esc(c.name)}: ${fmt(v)} ${esc(m.unit)}"${dim}>
          <rect class="ps-bar" x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" rx="3"/>
          <text x="${(x + bw / 2).toFixed(1)}" y="${(H - B - h - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0c2140">${fmt(v)}</text></g>`;
      }
      const lab = SHORT[c.code].split(' ');
      if (narrow) { const lx = (L + i * cw + cw / 2).toFixed(1), ly = H - B + 12; g += `<text x="${lx}" y="${ly}" text-anchor="end" font-size="11.5" fill="#0c2140" transform="rotate(-45 ${lx} ${ly})">${esc(SHORT[c.code])}</text>`; return; }
      g += `<text x="${(L + i * cw + cw / 2).toFixed(1)}" y="${H - B + 13}" text-anchor="middle" font-size="9.5" fill="#0c2140">${esc(lab[0])}</text>${lab[1] ? `<text x="${(L + i * cw + cw / 2).toFixed(1)}" y="${H - B + 24}" text-anchor="middle" font-size="9.5" fill="#0c2140">${esc(lab[1])}</text>` : ''}`;
    });
    const legend = stack ? `<g transform="translate(${W - 190},2)"><rect width="10" height="10" fill="#2f86d6" fill-opacity=".5"/><text x="14" y="9" font-size="10" fill="#0c2140">Master's (lighter)</text><rect x="104" width="10" height="10" fill="#2f86d6"/><text x="118" y="9" font-size="10" fill="#0c2140">PhD (darker)</text></g>` : '';
    const host = $('#ps-bars');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="false">${g}${legend}</svg>`;
    host.setAttribute('aria-label', stack ? "Completed Master's and PhDs by country, stacked" : `${m.unit} by country, descending`);
    $('#ps-bars-sub').textContent = stack ? "Secondary view: completed Master's and PhD degrees stacked. Country order still follows the selected metric." : `Showing ${m.unit}, sorted descending. ${m.key === 'scholars' ? 'People, not degrees.' : 'Degree records, not people.'}`;
    $$('.ps-bargrp', host).forEach(el => {
      const c = byCode[el.dataset.code];
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => select(c.code));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.code); } });
      el.addEventListener('pointerenter', e => showTip(e, mapTip(c)));
      el.addEventListener('pointermove', moveTip);
      el.addEventListener('pointerleave', hideTip);
    });
  }
  function exportCsv() {
    const rows = [['Country', 'Scholars (unique people)', "Completed Master's", 'Completed PhDs/doctorates', 'of which professional doctorates', 'Country-indexed publications', 'Indigenous-linked publications', 'Master file last modified', 'Bundle generated']];
    sorted().forEach(c => { const s = D.sources.find(x => x.code === c.code) || {}; rows.push([c.name, c.scholars, c.masters, c.phd, c.profDoc, c.pubsIndexed, c.pubsIndigenous, s.modified || '', D.generated]); });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = `regional-graduate-degrees-${state.metric}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  // ================= DISCIPLINES =================
  function setupDisc() {
    $$('[data-disc]').forEach(b => b.addEventListener('click', () => { state.disc = b.dataset.disc; renderDisc(); }));
    $('#ps-disc-level').addEventListener('change', e => { state.discLevel = e.target.value; renderDisc(); });
  }
  function renderDisc() {
    $$('[data-disc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.disc === state.disc)));
    const codes = state.disc === 'ALL' ? D.disciplineCountries : [state.disc];
    const cats = D.disciplineCategories.concat(['Unknown / unmapped']);
    const counts = Object.fromEntries(cats.map(k => [k, 0]));
    codes.forEach(code => { const d = byCode[code] && byCode[code].disciplines; if (!d) return; ['M', 'P'].forEach(l => { if (state.discLevel !== 'all' && state.discLevel !== l) return; for (const k in d[l] || {}) counts[k] = (counts[k] || 0) + d[l][k]; }); });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const order = D.disciplineCategories.slice().sort((a, b) => counts[b] - counts[a]);
    const colorOf = k => DISC_COLOR[D.disciplineCategories.indexOf(k)] || '#b9c6d4';
    let a0 = -Math.PI / 2; const R = 72, r = 45, cx = 75, cy = 75;
    const arcs = order.concat(['Unknown / unmapped']).filter(k => counts[k] > 0).map(k => {
      const a1 = a0 + 2 * Math.PI * counts[k] / total; const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
      const d = counts[k] === total ? `M ${p(R, 0)} A ${R} ${R} 0 1 1 ${p(R, Math.PI)} A ${R} ${R} 0 1 1 ${p(R, 0)} M ${p(r, 0)} A ${r} ${r} 0 1 0 ${p(r, Math.PI)} A ${r} ${r} 0 1 0 ${p(r, 0)}` : `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${k.startsWith('Unknown') ? '#b9c6d4' : colorOf(k)}" stroke="#f6f8fb" stroke-width="1.5"><title>${esc(k)}: ${fmt(counts[k])} (${pct(counts[k], total)}%)</title></path>`;
    }).join('');
    const scopeLabel = state.disc === 'ALL' ? 'Fiji, Tonga & Vanuatu' : nameOf(state.disc);
    const lvl = state.discLevel === 'M' ? "completed Master's" : state.discLevel === 'P' ? 'completed PhDs' : 'completed degrees';
    $('#ps-disc').innerHTML = total ? `
      <div class="ps-donut" role="img" aria-label="Fields of research for ${esc(scopeLabel)}: ${order.map(k => `${k} ${counts[k]}`).join(', ')}; unknown or unmapped ${counts['Unknown / unmapped']}">
        <svg viewBox="0 0 150 150">${arcs}</svg>
        <div class="ps-donut__c"><div class="ps-donut__v">${fmt(total)}</div><div class="ps-donut__l">${esc(lvl)}</div></div>
      </div>
      <ul class="ps-legend">${order.map(k => `<li><i style="background:${colorOf(k)}"></i><span>${esc(k)}</span><span class="n">${fmt(counts[k])}</span><span class="p">${pct(counts[k], total)}%</span></li>`).join('')}
        <li class="is-unknown"><i style="background:#b9c6d4"></i><span>Unknown / unmapped</span><span class="n">${fmt(counts['Unknown / unmapped'])}</span><span class="p">${pct(counts['Unknown / unmapped'], total)}%</span></li></ul>`
      : '<div class="ps-empty">No completed degrees with discipline data for this selection.</div>';
    if (state.sel && !D.disciplineCountries.includes(state.sel)) $('#ps-disc').insertAdjacentHTML('afterbegin', `<div class="ps-empty" style="grid-column:1/-1;margin-bottom:8px">${esc(nameOf(state.sel))} is not included: discipline data are approved for Fiji, Tonga and Vanuatu only.</div>`);
  }

  // ================= GENDER =================
  function figure(color, female) {
    return female
      ? `<svg viewBox="0 0 18 34" aria-hidden="true"><circle cx="9" cy="4" r="3.6" fill="${color}"/><path d="M9 8.5c-3 0-4 2-4.6 4.5L2.6 22h3.6l.4 11h4.8l.4-11h3.6L13.6 13C13 10.5 12 8.5 9 8.5z" fill="${color}"/></svg>`
      : `<svg viewBox="0 0 18 34" aria-hidden="true"><circle cx="9" cy="4" r="3.6" fill="${color}"/><path d="M4 9h10c1.2 0 2 .8 2 2v10h-2.4v12H10.2V22H7.8v11H4.4V21H2V11c0-1.2.8-2 2-2z" fill="${color}"/></svg>`;
  }
  function renderGender() {
    const scope = state.sel ? [byCode[state.sel]] : countries();
    const sum = key => scope.reduce((a, c) => { a.female += c[key].female; a.male += c[key].male; a.unknown += c[key].unknown; return a; }, { female: 0, male: 0, unknown: 0 });
    const card = (title, g, what) => {
      const n = g.female + g.male + g.unknown;
      return `<div class="ps-gcard"><h3>${esc(title)}</h3><div class="d">n = ${fmt(n)} ${esc(what)}</div>
        <div class="ps-grow"><div class="ps-g">${figure('#e0464f', true)}<div><b>${pct(g.female, n)}%</b><span>Female (${fmt(g.female)})</span></div></div>
        <div class="ps-g">${figure('#1f5fae', false)}<div><b>${pct(g.male, n)}%</b><span>Male (${fmt(g.male)})</span></div></div></div>
        <div class="ps-gunk">Not recorded: ${pct(g.unknown, n)}% (${fmt(g.unknown)})</div></div>`;
    };
    $('#ps-gender-sub').textContent = `Gender as recorded in each Master file — ${state.sel ? nameOf(state.sel) : 'all countries'}. Percentages use the full denominator, including not recorded.`;
    $('#ps-gender').innerHTML = card('Indigenous scholars', sum('gender'), 'people') + card('Publishing scholars', sum('pubGender'), 'people with ≥1 linked publication');
  }

  // ================= PACIFIC FIRSTS TIMELINE =================
  const FT = { stage: 'both', gender: 'both', Y0: 1950, R: 16, GAP: 6 };
  const FT_LBL = { masters: "Master's", phd: 'PhD' };
  function setupFirsts() {
    const panel = $('#ps-firsts-panel');
    if (!Array.isArray(D.firsts) || !D.firsts.length) { panel.hidden = true; return; }
    panel.hidden = false;
    const wire = (sel, attr, key) => {
      const btns = [...document.querySelectorAll(`${sel} button`)];
      btns.forEach(b => b.addEventListener('click', () => {
        FT[key] = b.dataset[attr];
        btns.forEach(x => x.setAttribute('aria-checked', String(x === b)));
        renderFirsts();
      }));
    };
    wire('#ps-ft-stage', 'ftstage', 'stage');
    wire('#ps-ft-gender', 'ftgender', 'gender');
    let w = 0;
    new ResizeObserver(() => { const nw = $('#ps-ft-chart').clientWidth; if (nw !== w) { w = nw; renderFirsts(); } }).observe($('#ps-ft-chart'));
    const missing = countries().filter(c => ['male', 'female'].some(g => !D.firsts.some(m => m.code === c.code && m.gender === g)));
    $('#ps-ft-missing').textContent = missing.map(c => {
      const gs = ['male', 'female'].filter(g => !D.firsts.some(m => m.code === c.code && m.gender === g));
      return `${c.name}: ${gs.join(' and ')} firsts are not shown because Gender is not recorded for ${fmt(c.gender.unknown)} of its ${fmt(c.scholars)} scholars.`;
    }).join(' ');
  }
  function ftLayout(items, xOf, rowH) {
    const byYear = {};
    items.forEach(m => (byYear[m.year] = byYear[m.year] || []).push(m));
    Object.values(byYear).forEach(g => g.forEach((m, i) => { m._x = xOf(m.year) + (i - (g.length - 1) / 2) * 5; }));
    const placed = [], R = FT.R;
    for (const m of [...items].sort((a, b) => a._x - b._x)) {
      let best = null;
      for (let row = 0; row < 20; row++) {
        let ok = true, cross = 0;
        for (const p of placed) {
          const dx = Math.abs(p._x - m._x), dr = Math.abs(p._row - row) * rowH;
          if (Math.hypot(dx, dr) < 2 * R + FT.GAP) { ok = false; break; } // flags never overlap
          if (dx < R + 2) cross++;                                        // a dashed line would pass behind a flag
        }
        if (!ok) continue;
        const score = cross * 10 + row;
        if (!best || score < best.score) best = { row, score };
        if (cross === 0) break;
      }
      m._row = best ? best.row : 0; placed.push(m);
    }
    return placed.length ? Math.max(...placed.map(p => p._row)) + 1 : 0;
  }
  function renderFirsts() {
    const panel = $('#ps-firsts-panel');
    if (!panel || panel.hidden) return;
    const chart = $('#ps-ft-chart'), svg = $('#ps-ft-svg'), tip = $('#ps-ft-tip');
    const NS = 'http://www.w3.org/2000/svg';
    const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
    const cs = getComputedStyle(panel), COL = { male: cs.getPropertyValue('--ft-male').trim() || '#19c3d6', female: cs.getPropertyValue('--ft-female').trim() || '#ff3fa4' };
    const R = FT.R, ROWH = 2 * R + 10, Y1 = new Date().getFullYear(), Y0 = FT.Y0;
    const W = chart.clientWidth || 880, padL = 18, padR = 18, top = 30;
    const xOf = y => padL + (y - Y0) / (Y1 - Y0) * (W - padL - padR);
    const items = D.firsts.filter(m => (FT.stage === 'both' || m.stage === FT.stage) && (FT.gender === 'both' || m.gender === FT.gender) && (!state.sel || m.code === state.sel)).map(m => ({ ...m }));
    const rows = ftLayout(items, xOf, ROWH);
    const plotH = Math.max(rows * ROWH + 30, 150), axisY = top + plotH, H = axisY + 34;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H); svg.textContent = '';
    tip.classList.remove('show'); chart.classList.remove('ps-ft-dim');
    for (let d = Y0, i = 0; d < Y1; d += 10, i++) {
      const x0 = xOf(d), x1 = xOf(Math.min(d + 10, Y1));
      el('rect', { x: x0, y: top - 22, width: x1 - x0, height: plotH + 22, fill: i % 2 ? 'rgba(127,227,230,0.11)' : 'rgba(3,19,39,0.35)' }, svg);
      if (x1 - x0 > 30) el('text', { x: (x0 + x1) / 2, y: top - 8, 'text-anchor': 'middle', fill: '#a9c0d8', 'font-size': 12.5, 'font-weight': 600 }, svg).textContent = d + 's';
    }
    el('line', { x1: padL, x2: W - padR, y1: axisY, y2: axisY, stroke: '#a9c0d8', 'stroke-width': 1.2 }, svg);
    for (let y = Y0; y <= Y1; y += 5) {
      const major = y % 10 === 0;
      el('line', { x1: xOf(y), x2: xOf(y), y1: axisY, y2: axisY + (major ? 6 : 3), stroke: '#a9c0d8' }, svg);
      if (major) el('text', { x: xOf(y), y: axisY + 20, 'text-anchor': 'middle', fill: '#eaf3fb', 'font-size': 13 }, svg).textContent = y;
    }
    if (!items.length) {
      el('text', { x: W / 2, y: top + plotH / 2, 'text-anchor': 'middle', fill: '#a9c0d8', 'font-size': 14 }, svg).textContent = 'No firsts recorded for this selection.';
    }
    const gl = el('g', {}, svg), gf = el('g', {}, svg);
    const show = (m, g, cy) => {
      chart.classList.add('ps-ft-dim'); g.classList.add('is-on'); m._line.classList.add('is-on');
      tip.style.setProperty('--c', m.gender === 'male' ? '#0d8a99' : '#c4127a');
      tip.innerHTML = `<div class="ps-ft-tip__h"><img src="img/regional/flags/${esc(m.code.toLowerCase())}.png" alt="">${esc(m.country)}</div>
        <div class="ps-ft-tip__y"><strong>${m.year}:</strong> First ${esc(m.gender)} ${FT_LBL[m.stage]}</div>
        <div class="ps-ft-tip__p">${esc(m.person)}</div><div class="ps-ft-tip__u">${esc(m.uni)}${m.uc ? ` (${esc(m.uc)})` : ''}</div>
        ${m.also && m.also.length ? `<div class="ps-ft-tip__also">Also ${m.year}: ${m.also.map(a => `${esc(a.person)}, ${esc(a.uni)}${a.uc ? ` (${esc(a.uc)})` : ''}`).join('; ')}</div>` : ''}`;
      tip.classList.add('show');
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const left = Math.min(Math.max(m._x - tw / 2, 4), W - tw - 4);
      let ty = cy - R - 12 - th; if (ty < 0) ty = cy + R + 12;
      tip.style.left = left + 'px'; tip.style.top = ty + 'px';
    };
    const hide = (m, g) => { chart.classList.remove('ps-ft-dim'); g.classList.remove('is-on'); m._line.classList.remove('is-on'); tip.classList.remove('show'); };
    items.forEach((m, i) => {
      const cy = axisY - 22 - m._row * ROWH, c = COL[m.gender];
      m._line = el('line', { class: 'ps-ft-line', x1: m._x, x2: m._x, y1: axisY, y2: cy + R, stroke: c }, gl);
      el('circle', { cx: m._x, cy: axisY, r: 2.4, fill: c }, gl);
      const g = el('g', { class: 'ps-ft-flag', tabindex: 0, role: 'button', 'aria-label': `${m.year}: first ${m.gender} ${FT_LBL[m.stage]}, ${m.country}, ${m.person}, ${m.uni}` }, gf);
      const id = 'ps-ft-clip' + i, cp = el('clipPath', { id }, g);
      el('circle', { cx: m._x, cy, r: R - 1 }, cp);
      el('image', { href: `img/regional/flags/${m.code.toLowerCase()}.png`, x: m._x - R, y: cy - R, width: 2 * R, height: 2 * R, 'clip-path': `url(#${id})`, preserveAspectRatio: 'xMidYMid slice' }, g);
      el('circle', { cx: m._x, cy, r: R, fill: 'none', stroke: c, 'stroke-width': 3 }, g);
      if (m.stage === 'phd') el('circle', { cx: m._x, cy, r: R + 3.6, fill: 'none', stroke: c, 'stroke-width': 1.6 }, g);
      el('circle', { class: 'ps-ft-focus', cx: m._x, cy, r: R + 6, fill: 'none', stroke: 'none' }, g);
      const on = () => show(m, g, cy), off = () => hide(m, g);
      g.addEventListener('mouseenter', on); g.addEventListener('mouseleave', off);
      g.addEventListener('focus', on); g.addEventListener('blur', off); g.addEventListener('click', on);
    });
    const nC = new Set(items.map(m => m.code)).size;
    $('#ps-ft-count').textContent = `${items.length} first${items.length === 1 ? '' : 's'} shown across ${nC} countr${nC === 1 ? 'y' : 'ies'}${state.sel ? ` (filtered to ${nameOf(state.sel)})` : ''}.`;
  }

  // ================= UNIVERSITY POSITIONS (table + leadership by gender) =================
  let posTouch = false;
  const POS = { held: 'ever', gen: 'b', leadC: '*', lastSel: null };
  const posHas = c => D.positions && D.positions.coverage.positions[c] > 0;
  function setupPositions() {
    const P = D.positions;
    if (!P || !Array.isArray(P.scholars) || !P.scholars.length) return;
    $('#ps-pos-panel').hidden = false; $('#ps-lead-panel').hidden = false;
    $('#ps-where-panel').hidden = false; $('#ps-rank-panel').hidden = false;
    setupWhereRank();
    const seg = (sel, key) => { const bs = [...document.querySelectorAll(`${sel} button`)]; bs.forEach(b => b.addEventListener('click', () => { POS[key] = b.dataset.v; bs.forEach(x => x.setAttribute('aria-checked', String(x === b))); renderPosTable(); })); };
    seg('#ps-pos-held', 'held'); seg('#ps-pos-gen', 'gen');
    const sel = $('#ps-lead-country');
    sel.innerHTML = '<option value="*">All countries</option>' + countries().filter(c => posHas(c.code)).map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
    sel.addEventListener('change', () => { POS.leadC = sel.value; renderLead(); });
    const tip = $('#ps-pos-tip');
    const hide = () => tip.classList.remove('show');
    const show = (td, x, y) => {
      const k = td.dataset.k, c = td.dataset.c, L = posCell(k, c);
      if (!L.length) return hide();
      const role = [...P.lead, ...P.rank].find(r => r[0] === k)[1];
      const names = L.map(s => esc(s.n) + (c === '*' ? ` <span style="opacity:.7">(${esc(SHORT[s.c] || s.c)})</span>` : '')).sort((a, b) => a.localeCompare(b));
      tip.innerHTML = `<b>${esc(role)}</b> · ${c === '*' ? 'Region' : esc(nameOf(c))}<br>${L.length} scholar${L.length > 1 ? 's' : ''}${POS.held === 'cur' ? ' (current)' : ''}<ul>${names.slice(0, 12).map(n => `<li>${n}</li>`).join('')}${names.length > 12 ? `<li>and ${names.length - 12} more</li>` : ''}</ul>`;
      tip.classList.add('show');
      const r = td.getBoundingClientRect();
      const px = x ?? r.right, py = y ?? r.bottom;
      tip.style.left = Math.max(8, Math.min(px + 12, innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(py + 12, innerHeight - tip.offsetHeight - 8)) + 'px';
    };
    const t = $('#ps-pos-table');
    t.addEventListener('mousemove', e => { const td = e.target.closest('td[data-k]'); td ? show(td, e.clientX, e.clientY) : hide(); });
    t.addEventListener('mouseleave', () => { if (!posTouch) hide(); });
    addEventListener('pointerdown', e => { posTouch = e.pointerType === 'touch'; }, true);
    document.addEventListener('click', e => { if (posTouch && !e.target.closest('#ps-pos-table td[data-k], #ps-where-table td[data-h], #ps-rank-bars span[data-k]')) hide(); });
    t.addEventListener('click', e => { const td = e.target.closest('td[data-k]'); if (td) show(td); });
    t.addEventListener('focusin', e => { const td = e.target.closest('td[data-k]'); if (td) show(td); });
    t.addEventListener('focusout', hide);
    addEventListener('scroll', () => { const f = document.activeElement; if (f && f.matches && f.matches('#ps-pos-table td[data-k]')) show(f); else if (!posTipBound.some(([sel]) => f && f.matches && f.matches(sel))) hide(); }, { passive: true });
    const nPos = Object.values(P.coverage.positions).reduce((a, b) => a + b, 0);
    const nWith = Object.values(P.coverage.withPositions).reduce((a, b) => a + b, 0);
    const empty = countries().filter(c => !posHas(c.code)).map(c => c.name);
    $('#ps-pos-note').textContent = `${fmt(nPos)} position records for ${fmt(nWith)} scholars on the included rosters. Striped columns: that country's Positions sheet has no records yet${empty.length ? ` (${empty.join(', ')})` : ''}. Region total counts unique scholars. Leadership roles count only at universities and other higher-education institutions, and include acting appointments. Academic ranks use the recorded title; "Assistant Professor" and "Lecturer" are kept separate.`;
  }

  // ----- Mock-ups B (where positions are held) and C (highest academic rank) -----
  const WR = { scale: 'pct' };
  const HOMEN = { FJI: 'Fiji', TON: 'Tonga', SLB: 'Solomon Islands', WSM: 'Samoa', VUT: 'Vanuatu', TUV: 'Tuvalu', KIR: 'Kiribati', PLW: 'Palau', COK: 'Cook Islands', MHL: 'Marshall Islands', FSM: 'Federated States of Micronesia' };
  const RANKC = { prof: '#0a2d52', assoc: '#145a8a', senlec: '#1f86b8', asst: '#19b5c4', lec: '#5fd0d6', asstlec: '#9fe2e3', rf: '#e0a52a', adj: '#b3bfcc' };
  const RANKDARK = new Set(['lec', 'asstlec', 'adj']);
  let posGroups = [];
  function posTipAt(html, el, x, y) {
    const tip = $('#ps-pos-tip'); tip.innerHTML = html; tip.classList.add('show');
    const r = el.getBoundingClientRect(), px = x ?? r.right, py = y ?? r.bottom;
    tip.style.left = Math.max(8, Math.min(px + 12, innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(8, Math.min(py + 12, innerHeight - tip.offsetHeight - 8)) + 'px';
  }
  const posTipHide = () => $('#ps-pos-tip').classList.remove('show');
  function nameList(L) {
    const n = L.map(s => esc(s.n)).sort((a, b) => a.localeCompare(b));
    return `<ul>${n.slice(0, 12).map(x => `<li>${x}</li>`).join('')}${n.length > 12 ? `<li>and ${n.length - 12} more</li>` : ''}</ul>`;
  }
  const posTipBound = [];
  function bindTip(root, sel, html) {
    posTipBound.push([`#${root.id} ${sel}`, html]);
    root.addEventListener('mousemove', e => { const el = e.target.closest(sel); if (el) posTipAt(html(el), el, e.clientX, e.clientY); else posTipHide(); });
    root.addEventListener('mouseleave', () => { if (!posTouch) posTipHide(); });
    root.addEventListener('click', e => { const el = e.target.closest(sel); if (el) posTipAt(html(el), el); });
    root.addEventListener('focusin', e => { const el = e.target.closest(sel); if (el) posTipAt(html(el), el); });
    root.addEventListener('focusout', posTipHide);
  }
  function setupWhereRank() {
    const P = D.positions, LK = P.lead.map(x => x[0]);
    posGroups = [['all', 'All university positions', null], ['lead', 'Any leadership role', LK], ['exec', 'Vice-Chancellor, PVC/DVC or Dean', ['vc', 'pvc', 'dean']], ['profs', 'Professors and Associate Professors', ['prof', 'assoc']], ['lects', 'Lecturers and Senior Lecturers', ['lec', 'senlec']]];
    const sel = $('#ps-where-role');
    sel.innerHTML = posGroups.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    sel.addEventListener('change', renderWhere);
    const bs = [...document.querySelectorAll('#ps-rank-scale button')];
    bs.forEach(b => b.addEventListener('click', () => { WR.scale = b.dataset.v; bs.forEach(x => x.setAttribute('aria-checked', String(x === b))); renderRank(); }));
    bindTip($('#ps-where-table'), 'td[data-h]', td => {
      const L = whereList(td.dataset.c, td.dataset.h);
      return `<b>${esc(nameOf(td.dataset.c))}</b> scholars · ${esc(td.dataset.h)}<br>${L.length} scholar${L.length > 1 ? 's' : ''} (${esc(sel.selectedOptions[0].textContent)})${nameList(L)}`;
    });
    let rankRz; addEventListener('resize', () => { clearTimeout(rankRz); rankRz = setTimeout(renderRank, 150); });
    bindTip($('#ps-rank-bars'), 'span[data-k]', sp => {
      const L = P.scholars.filter(s => s.c === sp.dataset.c && posTop(s) === sp.dataset.k), all = P.scholars.filter(s => s.c === sp.dataset.c && posTop(s)).length;
      return `<b>${esc(P.rank.find(r => r[0] === sp.dataset.k)[1])}</b> · ${esc(nameOf(sp.dataset.c))}<br>${L.length} of ${all} scholars (${Math.round(100 * L.length / all)}%)`;
    });
    addEventListener('scroll', () => { const f = document.activeElement; const b = posTipBound.find(([sel]) => f && f.matches && f.matches(sel)); if (b) posTipAt(b[1](f), f); }, { passive: true });
  }
  function posTop(s) { const R = D.positions.rank; for (const [k] of R) if (s.r[k]) return k; return null; }
  function whereKeys() { return (posGroups.find(g => g[0] === $('#ps-where-role').value) || posGroups[0])[2]; }
  function whereHosts(s, keys) { const hs = new Set(); Object.entries(s.r).forEach(([k, e]) => { if (!keys || keys.includes(k)) (e.h || []).forEach(h => hs.add(h)); }); return hs; }
  let whereOther = [];
  function whereList(c, h) {
    const keys = whereKeys();
    return D.positions.scholars.filter(s => s.c === c && (h === 'Other' ? whereOther.some(x => whereHosts(s, keys).has(x)) : whereHosts(s, keys).has(h)));
  }
  function renderWhere() {
    if (!D.positions || $('#ps-where-panel').hidden) return;
    const keys = whereKeys(), M = {}, tot = {};
    for (const s of D.positions.scholars) whereHosts(s, keys).forEach(h => { (M[s.c] = M[s.c] || {})[h] = ((M[s.c] || {})[h] || 0) + 1; tot[h] = (tot[h] || 0) + 1; });
    const hosts = Object.keys(tot).sort((a, b) => tot[b] - tot[a] || a.localeCompare(b));
    const top = hosts.slice(0, 9); whereOther = hosts.slice(9);
    const cols = whereOther.length ? [...top, 'Other'] : top;
    const homes = countries().map(c => c.code).filter(posHas);
    const val = (c, h) => h === 'Other' ? whereList(c, 'Other').length : ((M[c] || {})[h] || 0);
    const mx = Math.max(1, ...homes.flatMap(c => cols.map(h => val(c, h))));
    let html = '<thead><tr><th scope="col"><span class="ps-sr">Home country</span></th>' + cols.map(h => `<th scope="col"><span>${esc(h)}</span></th>`).join('') + '</tr></thead><tbody>';
    for (const c of homes) {
      html += `<tr class="${state.sel === c ? 'sel' : ''}"><th class="home" scope="row"><img src="img/regional/flags/${c.toLowerCase()}.png" alt="">${esc(nameOf(c))}</th>` + cols.map(h => {
        const v = val(c, h), a = v / mx;
        const bg = v ? `rgba(127,227,230,${(0.15 + 0.75 * a).toFixed(2)})` : 'rgba(255,255,255,.04)';
        const attrs = v ? ` data-c="${c}" data-h="${esc(h)}" tabindex="0" aria-label="${esc(nameOf(c))} scholars in ${esc(h)}: ${v}"` : '';
        return `<td class="${HOMEN[c] === h ? 'self' : ''}" style="background:${bg};color:${a > .45 ? '#04121f' : '#eaf3fb'}"${attrs}>${v || ''}</td>`;
      }).join('') + '</tr>';
    }
    $('#ps-where-table').innerHTML = html + '</tbody>';
    posTipHide();
  }
  function renderRank() {
    if (!D.positions || $('#ps-rank-panel').hidden) return;
    const P = D.positions;
    const rows = countries().map(c => c.code).filter(posHas).map(c => { const L = P.scholars.filter(s => s.c === c && posTop(s)); const cnt = {}; L.forEach(s => { const k = posTop(s); cnt[k] = (cnt[k] || 0) + 1; }); return { c, n: L.length, cnt }; }).filter(r => r.n);
    const mx = Math.max(1, ...rows.map(r => r.n));
    $('#ps-rank-bars').innerHTML = rows.map(r => {
      const w = WR.scale === 'pct' ? 100 : 100 * r.n / mx;
      const segs = P.rank.map(([k, l]) => { const v = r.cnt[k] || 0; if (!v) return ''; const p = 100 * v / r.n; return `<span data-c="${r.c}" data-k="${k}" tabindex="0" style="flex:0 0 ${p}%;background:${RANKC[k] || '#7d8da1'};${RANKDARK.has(k) ? 'color:#0a2d52' : ''}" aria-label="${esc(l)}: ${v} (${Math.round(p)}%)">${p >= 9 ? (WR.scale === 'pct' ? Math.round(p) + '%' : v) : ''}</span>`; }).join('');
      return `<div class="ps-ld-row${state.sel === r.c ? ' sel' : ''}"><div class="nm"><img src="img/regional/flags/${r.c.toLowerCase()}.png" alt="">${esc(nameOf(r.c))}</div><div><div class="ps-ld-bar" style="width:${w}%">${segs}</div></div><div class="ps-ld-n">n=${r.n}</div></div>`;
    }).join('');
    $('#ps-rank-bars').querySelectorAll('span[data-k]').forEach(sp => { if (sp.textContent && sp.scrollWidth > sp.clientWidth + 1) sp.textContent = ''; });
    $('#ps-rank-legend').innerHTML = P.rank.map(([k, l]) => `<span><i style="background:${RANKC[k] || '#7d8da1'}"></i>${esc(l)}</span>`).join('');
    posTipHide();
  }
  function posPick(s) { return POS.gen === 'b' || s.g === POS.gen; }
  function posHeld(s, k) { return s.r[k] && (POS.held === 'ever' || s.r[k].cur); }
  function posCell(k, c) { return D.positions.scholars.filter(s => (c === '*' || s.c === c) && posPick(s) && posHeld(s, k)); }
  function renderPositions() {
    if (!D.positions || $('#ps-pos-panel').hidden) return;
    if (state.sel !== POS.lastSel) {
      POS.lastSel = state.sel;
      POS.leadC = state.sel && posHas(state.sel) ? state.sel : '*';
      $('#ps-lead-country').value = POS.leadC;
    }
    renderPosTable(); renderLead(); renderWhere(); renderRank();
  }
  function renderPosTable() {
    const P = D.positions, C = countries().map(c => c.code);
    let h = '<thead><tr><th class="role" scope="col">Position</th>' + C.map(c => `<th scope="col" class="${posHas(c) ? '' : 'nodata'}${state.sel === c ? ' sel' : ''}"><img src="img/regional/flags/${c.toLowerCase()}.png" alt="">${esc(SHORT[c] || c)}</th>`).join('') + '<th scope="col" class="tot">Region</th></tr></thead><tbody>';
    for (const [grp, list] of [['University leadership', P.lead], ['Academic rank', P.rank]]) {
      h += `<tr class="grp"><th colspan="${C.length + 2}" scope="rowgroup"><span>${grp}</span></th></tr>`;
      for (const [k, l] of list) {
        const tot = posCell(k, '*').length;
        h += `<tr><th class="role" scope="row">${esc(l)}</th>` + C.map(c => {
          if (!posHas(c)) return '<td class="c nd"><span class="ps-sr">no records</span>·</td>';
          const n = posCell(k, c).length;
          return `<td class="c${n ? '' : ' z'}${state.sel === c ? ' selcol' : ''}" data-k="${k}" data-c="${c}"${n ? ' tabindex="0"' : ''}>${n || '–'}</td>`;
        }).join('') + `<td class="tot" data-k="${k}" data-c="*"${tot ? ' tabindex="0"' : ''}>${tot}</td></tr>`;
      }
    }
    const any = c => P.scholars.filter(s => (c === '*' || s.c === c) && posPick(s) && Object.keys(s.r).some(k => posHeld(s, k))).length;
    h += '</tbody><tfoot><tr><th class="role" scope="row">Scholars with any of these</th>' + C.map(c => `<td>${posHas(c) ? any(c) : '·'}</td>`).join('') + `<td class="tot">${any('*')}</td></tr>`;
    h += '<tr><th class="role" scope="row">Roster size</th>' + C.map(c => `<td>${fmt(byCode[c].scholars)}</td>`).join('') + `<td class="tot">${fmt(countries().reduce((a, c) => a + c.scholars, 0))}</td></tr></tfoot>`;
    const t = $('#ps-pos-table'); t.innerHTML = h;
    const cells = [...t.querySelectorAll('td.c[data-k]')], mx = Math.max(1, ...cells.map(td => +td.textContent || 0));
    cells.forEach(td => { const v = +td.textContent || 0; if (v) td.style.background = `rgba(25,181,196,${(0.12 + 0.6 * v / mx).toFixed(2)})`; });
    $('#ps-pos-tip').classList.remove('show');
  }
  function renderLead() {
    const P = D.positions, cc = POS.leadC;
    const L = P.scholars.filter(s => cc === '*' || s.c === cc);
    const rows = P.lead.map(([k, l]) => { const g = { f: 0, m: 0, u: 0 }; L.forEach(s => { if (s.r[k]) g[s.g] = (g[s.g] || 0) + 1; }); return { l, g, n: g.f + g.m + g.u }; });
    const mx = Math.max(1, ...rows.map(r => r.n));
    $('#ps-lead-bars').innerHTML = rows.some(r => r.n) ? rows.map(r => `<div class="ps-gd-row"><div class="ps-gd-l">${esc(r.l)}</div><div class="ps-gd-bar" style="width:${r.n ? Math.max(4, 100 * r.n / mx) : 0}%" role="img" aria-label="${esc(r.l)}: ${r.g.f} female, ${r.g.m} male${r.g.u ? `, ${r.g.u} not recorded` : ''}">${['f', 'm', 'u'].map(k => r.g[k] ? `<span class="ps-gd-${k}" style="flex:${r.g[k]}">${r.g[k]}</span>` : '').join('')}</div><div class="ps-gd-n">${r.n ? `${r.n} · ${Math.round(100 * r.g.f / r.n)}% F` : '0'}</div></div>`).join('')
      : '<p class="ps-gd-empty">No university leadership roles recorded for this country yet.</p>';
  }

  // ================= DESTINATIONS =================
  function setupDest() {
    const home = $('#ps-dest-home');
    home.innerHTML = '<option value="">All home countries</option>' + countries().slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
    const decs = new Set(); countries().forEach(c => c.destinations.forEach(d => decs.add(d.dec)));
    $('#ps-dest-dec').innerHTML = '<option value="">All years</option>' + [...decs].filter(Boolean).sort().map(d => `<option value="${d}">${d}s</option>`).join('') + (decs.has(0) ? '<option value="0">Year not recorded</option>' : '');
    home.addEventListener('change', e => { state.destHome = e.target.value; if (state.destHome !== (state.sel || '')) { state.sel = state.destHome || null; writeUrl(); renderAll(); } else renderDest(); });
    $('#ps-dest-level').addEventListener('change', e => { state.destLevel = e.target.value; renderDest(); });
    $('#ps-dest-dec').addEventListener('change', e => { state.destDec = e.target.value; renderDest(); });
  }
  function renderDest() {
    state.destHome = state.sel || state.destHome || '';
    if (state.sel === null && $('#ps-dest-home').value !== '' && !state.destHome) $('#ps-dest-home').value = '';
    $('#ps-dest-home').value = state.destHome;
    const scope = state.destHome ? [byCode[state.destHome]] : countries();
    const cnt = Object.fromEntries(DEST_ORDER.map(k => [k, 0]));
    scope.forEach(c => c.destinations.forEach(d => {
      if (state.destLevel !== 'all' && d.l !== state.destLevel) return;
      if (state.destDec !== '' && String(d.dec) !== state.destDec) return;
      cnt[d.r] = (cnt[d.r] || 0) + d.n;
    }));
    const total = Object.values(cnt).reduce((a, b) => a + b, 0);
    const unresolvedCampus = scope.reduce((a, c) => a + (((c.destinationCountries || {}).Pacific || {})['(country unresolved)'] || 0), 0);
    const host = $('#ps-world');
    if (!BM) { host.innerHTML = '<div class="ps-empty">World basemap unavailable.</div>'; }
    else {
      const Wd = BM.world; const o = Wd.dest.origin;
      const maxv = Math.max(1, ...DEST_ORDER.filter(k => Wd.dest[k]).map(k => cnt[k]));
      const arcs = DEST_ORDER.filter(k => Wd.dest[k] && k !== 'Pacific' && cnt[k] > 0).map(k => {
        const [x, y] = Wd.dest[k]; const mx = (o[0] + x) / 2, my = Math.min(o[1], y) - Math.abs(x - o[0]) * 0.28 - 30;
        return `<path class="ps-arc" d="M${o[0]} ${o[1]} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x} ${y}" stroke="${DEST_COLOR[k]}" stroke-width="${(1.5 + 7 * cnt[k] / maxv).toFixed(1)}" stroke-opacity=".9"/>`;
      }).join('');
      const nodes = DEST_ORDER.filter(k => Wd.dest[k]).map(k => {
        const [x, y] = Wd.dest[k]; const p = pct(cnt[k], total);
        const dx = k === 'New Zealand' ? 18 : k === 'Australia' ? -18 : 0, anchor = k === 'Australia' ? 'end' : k === 'New Zealand' ? 'start' : 'middle';
        const dy = k === 'Pacific' ? -20 : k === 'Australia' || k === 'New Zealand' ? 10 : -20;
        return `<g class="ps-dnode"><circle cx="${x}" cy="${y}" r="${k === 'Pacific' ? 12 : 10}" fill="${DEST_COLOR[k]}" stroke="#fff" stroke-width="2"/><text x="${x + dx}" y="${y + dy}" text-anchor="${anchor}">${esc(k)} ${p}%</text><title>${esc(k)}: ${fmt(cnt[k])} of ${fmt(total)} completed degrees (${p}%)</title></g>`;
      }).join('');
      host.innerHTML = `<svg viewBox="0 0 ${Wd.w} ${Wd.h}" role="img" aria-label="Study destinations: ${DEST_ORDER.map(k => `${k} ${pct(cnt[k], total)}%`).join(', ')}"><path d="${Wd.sphere}" fill="#082c52"/>${Wd.shapes.map(s => `<path class="ps-wland" d="${s.d}"/>`).join('')}${arcs}<circle cx="${o[0]}" cy="${o[1]}" r="5" fill="#fff"/>${nodes}</svg>`;
    }
    $('#ps-dlist').innerHTML = total ? DEST_ORDER.map(k => `<li><span><i style="background:${DEST_COLOR[k]}"></i>${esc(k)}</span><b>${pct(cnt[k], total)}% <span style="font-weight:400;color:var(--ps-text-muted)">(${fmt(cnt[k])})</span></b></li>`).join('') : '<li>No completed degrees match these filters.</li>';
    $('#ps-dest-note').innerHTML = `Completed degree records (n = ${fmt(total)}), by the awarding institution's country. Pacific = Pacific Island countries and territories; Australia and New Zealand are separate. United States includes Hawaiʻi; Guam is counted as Pacific.${unresolvedCampus ? ` ${fmt(unresolvedCampus)} USP degree${unresolvedCampus > 1 ? 's have' : ' has'} an unverified campus (counted as Pacific, country unresolved).` : ''}`;
  }

  // ================= FIND A SCHOLAR =================
  let INDEX = [];
  function setupFind() {
    INDEX = [];
    countries().forEach(c => (c.index || []).forEach(r => INDEX.push({ ...r, cn: c.name, dash: c.dashboard, hay: [r.n, r.k, c.name, ...(r.f || []), ...(r.s || []), ...(r.u || []), r.d.includes('P') ? 'phd doctorate doctoral' : '', r.d.includes('M') ? "master's masters" : ''].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() })));
    $('#ps-f-country').innerHTML = '<option value="">All Countries</option>' + countries().slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
    $('#ps-f-field').innerHTML = '<option value="">All Fields</option>' + D.disciplineCategories.map(k => `<option>${esc(k)}</option>`).join('');
    $('#ps-find').addEventListener('submit', e => { e.preventDefault(); runSearch(false); });
    $('#ps-q').addEventListener('input', debounce(() => runSearch(false), 180));
    ['#ps-f-country', '#ps-f-field', '#ps-f-level'].forEach(s => $(s).addEventListener('change', () => runSearch(false)));
    $('#ps-f-reset').addEventListener('click', () => { $('#ps-q').value = ''; $('#ps-f-country').value = ''; $('#ps-f-field').value = ''; $('#ps-f-level').value = ''; $('#ps-results').innerHTML = ''; $('#ps-q').focus(); });
    $('#ps-f-az').addEventListener('click', () => runSearch(true));
  }
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function runSearch(az) {
    const q = $('#ps-q').value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const country = $('#ps-f-country').value, field = $('#ps-f-field').value, level = $('#ps-f-level').value;
    if (!az && !q && !country && !field && !level) { $('#ps-results').innerHTML = ''; return; }
    const terms = q.split(/\s+/).filter(Boolean);
    let res = INDEX.filter(r => (!country || r.c === country) && (!field || (r.s || []).includes(field)) && (!level || r.d.includes(level)) && terms.every(t => r.hay.includes(t)));
    res.sort((a, b) => a.n.localeCompare(b.n));
    const LIMIT = 150;
    const fieldNote = field ? '<div class="ps-results__count">Field filter uses the eight short-discipline categories, available for Fiji, Tonga and Vanuatu only.</div>' : '';
    $('#ps-results').innerHTML = res.length ? `<div class="ps-results__count">${fmt(res.length)} scholar${res.length > 1 ? 's' : ''} found${res.length > LIMIT ? ` · showing first ${LIMIT}; refine your search` : ''}</div>${fieldNote}<ol>${res.slice(0, LIMIT).map(r => {
      const deg = [r.d.includes('M') ? "Master's" : '', r.d.includes('P') ? 'PhD' : ''].filter(Boolean).join(' · ') || 'No completed degree recorded';
      const meta = [deg, (r.s && r.s.length ? r.s : r.f || []).slice(0, 2).join('; '), (r.u || []).slice(0, 2).join('; ')].filter(Boolean).join(' — ');
      const link = r.dash ? `<a href="${esc(r.dash)}?scholar=${encodeURIComponent(r.k)}">Open in ${esc(r.cn)} dashboard →</a> <span class="na">(country passcode required)</span>` : '<span class="na">Country profile page not yet available</span>';
      return `<li><span class="ps-dot" style="background:${COLORS[r.c]}"></span><b>${esc(r.n)}</b> <span class="na">· ${esc(r.cn)}</span><span class="m">${esc(meta)}</span>${link}</li>`;
    }).join('')}</ol>` : `<div class="ps-empty" style="margin-top:8px">No scholars match these filters. Try a shorter name, a different spelling, or clear the filters.</div>${fieldNote}`;
  }

  // ================= DIALOGS =================
  function setupDialogs() {
    const dlg = $('#ps-dialog');
    $('#ps-dialog-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    $$('[data-dialog]').forEach(b => b.addEventListener('click', () => openDialog(b.dataset.dialog)));
    $$('[data-prov]').forEach(b => b.addEventListener('click', () => openProv(b.dataset.prov)));
  }
  function show(title, html) { $('#ps-dialog-title').textContent = title; $('#ps-dialog-body').innerHTML = html; $('#ps-dialog').showModal(); }
  function sourceTable() {
    return `<table class="ps-table"><caption>Source-of-truth inventory (read-only access via Google Sheets API at build time)</caption><thead><tr><th>Country</th><th>Authoritative Master file</th><th>Access</th><th>Master last modified</th><th>Dashboard</th></tr></thead><tbody>${D.sources.map(s => { const c = byCode[s.code] || {}; return `<tr><td>${esc(s.name)}</td><td>${esc(s.file || '—')}</td><td>${esc(s.status)}</td><td>${s.modified ? new Date(s.modified).toLocaleString() : '—'}</td><td>${c.dashboard ? 'Live (gated)' : c.dashboardStatus === 'development' ? 'In development' : 'None'}</td></tr>`; }).join('')}</tbody></table>`;
  }
  function reconTable() {
    const d = (a, b) => { if (b == null) return ''; const x = a - b; return x === 0 ? '0' : `<span class="${x > 0 ? 'diff-up' : 'diff-down'}">${x > 0 ? '+' : ''}${x}</span>`; };
    let tm = 0, tp = 0, om = 0, op = 0;
    const rows = countries().map(c => { const o = c.oct5 || {}; tm += c.masters; tp += c.phd; om += o.masters || 0; op += o.phd || 0; return `<tr><td>${esc(c.name)}</td><td>${fmt(o.masters)}</td><td>${fmt(c.masters)}</td><td>${d(c.masters, o.masters)}</td><td>${fmt(o.phd)}</td><td>${fmt(c.phd)}</td><td>${d(c.phd, o.phd)}</td><td>${fmt(o.indig)}</td><td>${fmt(c.pubsIndigenous)}</td></tr>`; }).join('');
    return `<table class="ps-table"><caption>Live Master-file figures vs the 5 October 2026 (9 am HST) checkpoint</caption><thead><tr><th>Country</th><th>Oct 5 Master's</th><th>Live</th><th>Δ</th><th>Oct 5 PhD</th><th>Live</th><th>Δ</th><th>Oct 5 pubs by/with Indigenous</th><th>Live Indigenous-linked</th></tr></thead><tbody>${rows}<tr><th>Total</th><th>${fmt(om)}</th><th>${fmt(tm)}</th><th>${d(tm, om)}</th><th>${fmt(op)}</th><th>${fmt(tp)}</th><th>${d(tp, op)}</th><th></th><th></th></tr></tbody></table>
      <p>The October 5 table header states “542 Masters and 278 PhDs across 11 countries”, but its own rows sum to 910 Master's and 461 PhDs (542 + 278 equals Fiji + Tonga only). Publication columns on October 5 counted all item types; this dashboard uses each country's headline publication categories, so the publication columns are not directly comparable.</p>`;
  }
  function openDialog(which) {
    if (which === 'about') show('About this Dashboard', `<p>The Regional Pacific Scholars Dashboard brings together eleven country scholarly databases led by Asst Prof Ron Vave (Center for Pacific Islands Studies, University of Hawaiʻi at Mānoa) with partner institutions across the region. It celebrates Indigenous Pacific scholars, their completed postgraduate degrees and their research.</p><p>All country databases are <strong>pre-launch, confidential project materials</strong>. This page shows aggregates and a minimal search index only; it never exposes raw Master files, contact details, geography, genealogy or unpublished notes. Country dashboards keep their own passcodes.</p><p>Data bundle generated ${esc(new Date(D.generated).toLocaleString())}. Timestamps show in your local time zone; the data are stored in UTC.</p>`);
    if (which === 'method') show('Methodology', `<h3>People and degrees</h3><ul><li><strong>Scholars</strong> — unique Scholar IDs on each country's included roster: Fiji excludes the Part-iTaukei roster; Tonga excludes retained profiles flagged “excluded from Indigenous Tongan counts”; Solomon Islands and Samoa require Inclusion Status = Included; the other countries require Identity Verification Status = Verified.</li><li><strong>Master's / PhDs</strong> — Graduate Degrees records whose stage is Master's or PhD/doctorate and whose completion status begins with “Completed” (or “Awarded”), held by an included scholar. Professional doctorates are counted with PhDs and reported separately. A person with both degrees counts once as a scholar and in both degree totals.</li><li>Regional scholar totals sum country rosters; a person recorded in two country databases has not yet been reconciled across countries.</li></ul><h3>Publications</h3><ul><li><strong>Country-indexed records</strong> — non-duplicate, non-excluded Publications rows in each country's headline categories (Journal Article, Master's Thesis, PhD Thesis, Book Chapter, Book; Fiji also includes Report, matching its six-category Master dashboard). Samoa uses V2 Inclusion Flag = Included.</li><li><strong>Indigenous-linked</strong> — records with an Authorship link to an included scholar.</li><li><strong>Regionally deduplicated</strong> — de-duplicated across countries by DOI, else normalised title + year.</li></ul><h3>Fields of Research</h3><p>Fiji, Tonga and Vanuatu only. Fiji and Tonga use the repository classifier (master_short_disciplines.py) that mirrors the Graduate Degrees Short Discipline formula; Vanuatu uses its own documented crosswalk (vanuatu-dashboard-model.js). The eight categories are: ${D.disciplineCategories.map(esc).join('; ')}. Unmapped records are reported as Unknown / unmapped.</p><h3>Study destinations</h3><p>Awarding institution's recorded country. Pacific = Pacific Island countries and territories (including Guam and New Caledonia), excluding Australia and New Zealand. USP records without a verified campus are counted as Pacific with country unresolved. Unknown locations are shown separately.</p>`);
    if (which === 'coverage') show('Data Coverage & Notes', `${sourceTable()}<h3>Reconciliation with 5 October 2026</h3>${reconTable()}<h3>Curation stage</h3><p>Tuvalu, Kiribati, Palau, Cook Islands, Marshall Islands, Federated States of Micronesia and Samoa are at an early curation stage. Their publication tables were re-initialised after 5 October and authorship links are still sparse, so Indigenous-linked publication counts are provisional. Gender is not yet recorded for many Samoa and Marshall Islands scholars.</p>`);
  }
  function openProv(which) {
    const base = `<p>Source: ${D.sources.filter(s => s.file).length} country Master files (Google Sheets, read-only), bundle generated ${esc(new Date(D.generated).toLocaleString())} by <code>scripts/build_regional_scholars.py</code>.</p>`;
    const map = {
      map: ['Map — provenance', base + '<p>Scholars sheet (included roster) and Graduate Degrees sheet. Marker locations are national capitals (positions only). Basemap: Natural Earth via world-atlas (public domain), 1:10m for Pacific Island countries.</p>'],
      degrees: ['Regional Postgraduate Degrees — provenance', base + '<p>Graduate Degrees: Degree Stage/Level + Completion Status, linked to included Scholar IDs. Duplicate Degree IDs are counted once.</p>'],
      outputs: ['Research Outputs — provenance', base + '<p>Publications sheet (Year, Publication Type, DOI, Title) and Authorship sheet (Scholar ID ↔ Publication ID). Year series counts regionally deduplicated Indigenous-linked records by publication year.</p>'],
      bars: ['Graduate Degrees by Country — provenance', base + '<p>Same counts as the country strip and the map. CSV export includes each Master file\u2019s last-modified time.</p>'],
      disc: ['Fields of Research — provenance', base + '<p>Graduate Degrees: Field / Discipline and Broad discipline, classified into the eight short-discipline categories. Completed degree records, not people.</p>'],
      gender: ['Gender — provenance', base + '<p>Scholars sheet Gender field, normalised (Female / Fefine / Fafine; Male / Tangata / Tāne). Blank or other values are reported as not recorded. Publishing scholars = included scholars with at least one Authorship link to a headline-category publication.</p>'],
      firsts: ['Pacific Firsts — provenance', base + '<p>Graduate Degrees: completed Master\u2019s and PhD / doctorate records (professional doctorates excluded) held by included scholars, dated by the completion-year column (Finish / Completion Year; Completion Year; Graduation Year or End Year where that is the country\u2019s column). Gender from the Scholars sheet, never inferred. Display name = title + first given name + family name; university = canonical name and its recorded country. The earliest year per country, degree and gender is shown; ties are listed together.</p>'],
      dest: ['Where Our Scholars Study — provenance', base + '<p>Graduate Degrees: University Country / Country and canonical university name. Completion decade from the completion/finish year.</p>'],
    };
    const [t, h] = map[which] || ['Provenance', base];
    show(t, h);
  }

  function renderCredits() {
    if (!CREDITS) return;
    const items = Object.entries(CREDITS).map(([k, c]) => `${esc(k === 'hero' ? 'Header' : k === 'impact' ? 'Impact & gender panels' : nameOf(k))}: <a href="${esc(c.page)}" rel="noopener">${esc(c.title.replace(/\.(jpe?g|png)$/i, ''))}</a> by ${esc(c.artist)}, <a href="${esc(c.licenseUrl)}" rel="noopener license">${esc(c.license)}</a>`);
    $('#ps-credits').innerHTML = `Photographs via Wikimedia Commons, cropped and resized: ${items.join(' · ')}. Map data: Natural Earth (public domain).`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGate); else initGate();
})();
