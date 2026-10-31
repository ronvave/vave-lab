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
  // Card titles. Long names get a smaller size so every title stays on one line.
  const CARD_NAME = { FSM: 'FSM' };
  const CARD_LONG = { SLB: 1, MHL: 1 };
  // Crop point for each card photo (x y), matched to the approved mock-up.
  const CARD_FOCUS = { FJI: '40% 50%', TON: '50% 45%', VUT: '45% 55%', SLB: '45% 60%', WSM: '50% 22%', COK: '45% 25%', MHL: '30% 50%', FSM: '55% 45%', TUV: '50% 50%', KIR: '25% 35%', PLW: '50% 60%' };
  const METRICS = {
    scholars: { key: 'scholars', label: 'Scholars', unit: 'Indigenous scholars', def: 'Scholars = unique Indigenous scholar on each country\u2019s included roster.' },
    phd: { key: 'phd', label: 'PhDs', unit: 'completed PhDs / doctorates', def: 'PhDs = completed PhD and doctorate degree records held by those scholars.' },
    masters: { key: 'masters', label: "Master's", unit: "completed Master's degrees", def: "Master's = completed Master's degree records held by those scholars." },
  };
  const DEST_ORDER = ['Pacific', 'Australia', 'New Zealand', 'North America', 'Europe', 'Asia', 'Other', 'Unknown'];
  // Centres sit on the basemap region points, except New Zealand, which sits
  // just east of the islands so its bubble does not cover Australia.
  const BUBBLE_AT = {
    Europe: [137, 112, 'start'],
    Asia: [411, 168, 'end'],
    Pacific: [530, 255, 'start'],
    'North America': [744, 130, 'end'],
    Australia: [455, 368, 'end'],
    'New Zealand': [620, 400, 'start']
  };
  const DEST_COLOR = { Pacific: '#3dce6e', Australia: '#f0a020', 'New Zealand': '#1ec4f0', 'North America': '#f0b42a', Europe: '#a44cf0', Asia: '#f06080', Other: '#9fb3c8', Unknown: '#5e7690' };
  const DISC_COLOR = ['#6fb04a', '#f0a42b', '#1f9ec9', '#e4553f', '#3b5fbf', '#8e5bc7', '#18a39a', '#c6c33a'];
  const ICONS = {
    person: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M1.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5zM12 20c.3-2.4 1.5-4.4 3.4-5.6.2 0 .4-.1.6-.1 3.6 0 6.5 2.9 6.5 5.7z"/></svg>',
    cap: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3L1 9l11 6 9-4.9V17h2V9z"/><path d="M5 13.2V17c2 2 12 2 14 0v-3.8L12 17z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z"/><path d="M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/></svg>',
  };

  const state = { metric: 'scholars', sel: null, barView: 'scholars', disc: 'ALL', discLevel: 'all', destHome: '', destLevel: 'all', destDec: '', destMode: 'study', mapView: null, discG: 'all', discScale: 'pct', gView: 'people', out: { type: '', fa: '', range: 'recent' } };
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
    setupViews();
    renderFresh();
    renderKpis();
    renderKpisB();
    setupMetric();
    setupMap();
    setupBars();
    setupDisc();
    setupDest();
    setupWorkHeat();
    setupFirsts();
    setupPositions();
    setupDialogs();
    setupGender();
    setupOutputs();
    renderCredits();
    if (window.PSUniversities) { try { window.PSUniversities.init(D, { nameOf, select: setSel }); } catch (e) { console.error(e); } }
    renderAll(true);
    if (window.PSDirectory) window.PSDirectory.init(D).then(() => { renderDest(); renderWorkHeat(); renderFirsts(); renderCList(); renderCWork(); window.PSUniversities && window.PSUniversities.refresh(); window.PSCollaborators && window.PSCollaborators.onDirectoryReady && window.PSCollaborators.onDirectoryReady(); }).catch(() => {});
    if (window.PSCollaborators) window.PSCollaborators.init(D);
    if (window.PSNews) { try { window.PSNews.init(D); } catch (e) { console.error(e); } }
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
    if (!$('#ps-kpis')) return;
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

  // Replicate ribbon (alternative style): same figures as renderKpis, shown as large coloured tiles.
  const WAVES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M2 8c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1"/><path d="M2 13c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1"/><path d="M2 18c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1"/></svg>';
  function renderKpisB() {
    const el = $('#ps-kpis-b'); if (!el) return;
    const t = totals();
    const connected = D.sources.filter(s => s.file).length;
    const items = [
      ['nat', ICONS.globe, fmt(connected), connected === D.sources.length ? 'Countries' : `of ${D.sources.length} countries connected`],
      ['sch', ICONS.people, fmt(t.scholars), 'Indigenous scholars'],
      ['ma', ICONS.cap, fmt(t.masters), "Completed Master's"],
      ['phd', ICONS.cap, fmt(t.phd), 'Completed PhDs'],
      ['pub', ICONS.doc, fmt(D.regional.uniqueIndigenousPubs), 'Indigenous\u2011linked publications'],
    ];
    el.innerHTML = items.map(([k, i, v, l]) => `<div class="ps-sea__tile ps-sea__tile--${k}">${i}<dt class="ps-sr">${esc(l)}</dt><dd><span class="ps-sea__v">${v}</span><span class="ps-sea__l">${esc(l)}</span></dd></div>`).join('');
  }

  // ================= METRIC TOGGLE =================
  function setupMetric() {
    const btns = $$('#ps-metric button');
    const set = m => { state.metric = m; syncBarView(m); btns.forEach(b => { b.setAttribute('aria-checked', String(b.dataset.metric === m)); b.tabIndex = b.dataset.metric === m ? 0 : -1; }); writeUrl(); renderAll(); };
    btns.forEach(b => {
      const grp = $$('button', b.parentElement), i = grp.indexOf(b);
      b.addEventListener('click', () => set(b.dataset.metric));
      b.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? grp.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : grp.length - 1)) % grp.length;
        grp[n].focus(); set(grp[n].dataset.metric);
      });
    });
    btns.forEach(b => { b.setAttribute('aria-checked', String(b.dataset.metric === state.metric)); b.tabIndex = b.dataset.metric === state.metric ? 0 : -1; });
    $('#ps-chip-clear').addEventListener('click', () => select(null));
  }

  function setSel(code) { code = code || null; if (state.sel === code) return; state.sel = null; select(code); }
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
    renderCards('#ps-cards', '#ps-a1-title', true);
    renderMap();
    renderBars();
    renderDegrees();
    renderOutputs();
    renderDisc();
    renderGender();
    renderDest();
    renderFirsts();
    renderPositions();
    renderWorkHeat();
    renderStudyMatrix();
    if (window.PSUniversities) window.PSUniversities.setHome(state.sel || '');
  }

  // ================= VIEW SWITCHER =================
  // Tabs: [data-views="key"] > button[data-view]; dropdowns: select[data-views-select="key"].
  // Panes: [data-pane="key:view key2:view2"] (shown when any token is active).
  // Controls that belong to one view: [data-pane-of="key:view ..."].
  const VIEW = {};
  const VIEW_HOOK = {
    a1: v => { if (v === 'chart') renderBars(); renderMap(); },
    a2: v => { if (v === 'out') renderOutputs(); },
    b1: () => renderFirsts(),
    b2: () => { renderWhere(); renderRank(); renderCList(); renderCWork(); },
    c1top: v => setViewKey('c1', v === 'uni' ? 'uni' : (state.c1Agg || 'study')),
    c1: v => { if (v !== 'uni') state.c1Agg = v; if (v === 'uni') { window.PSUniversities && window.PSUniversities.show(); } else { state.destMode = v; renderDest(); renderStudyMatrix(); renderWorkHeat(); } },
    c1d: () => { syncDestFilters(); renderStudyMatrix(); renderWorkHeat(); },
  };
  function setupViews() {
    $$('[data-views]').forEach(tl => {
      const k = tl.dataset.views, bs = $$('button[data-view]', tl);
      VIEW[k] = (bs.find(b => b.getAttribute('aria-selected') === 'true') || bs[0]).dataset.view;
      bs.forEach((b, i) => {
        b.addEventListener('click', () => setViewKey(k, b.dataset.view));
        b.addEventListener('keydown', e => {
          if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
          e.preventDefault();
          const nx = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
          nx.focus(); setViewKey(k, nx.dataset.view);
        });
      });
    });
    $$('[data-views-select]').forEach(sel => { const k = sel.dataset.viewsSelect; VIEW[k] = sel.value; sel.addEventListener('change', () => setViewKey(k, sel.value)); });
    applyViews();
  }
  const viewOn = attr => String(attr || '').split(/\s+/).filter(Boolean).some(t => { const [k, v] = t.split(':'); return VIEW[k] === v; });
  function applyViews() {
    $$('[data-pane]').forEach(el => { el.hidden = !viewOn(el.dataset.pane); });
    $$('[data-pane-of]').forEach(el => { el.hidden = !viewOn(el.dataset.paneOf); });
    $$('[data-views]').forEach(tl => $$('button[data-view]', tl).forEach(b => { const on = VIEW[tl.dataset.views] === b.dataset.view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }));
    $$('[data-views-select]').forEach(sel => { sel.value = VIEW[sel.dataset.viewsSelect]; });
  }
  function setViewKey(k, v) {
    VIEW[k] = v;
    if (k === 'c1') VIEW.c1top = v === 'uni' ? 'uni' : 'agg';
    applyViews(); hideTip();
    const tip = $('#ps-pos-tip'); tip && tip.classList.remove('show');
    if (D && VIEW_HOOK[k]) VIEW_HOOK[k](v);
  }

  // ================= A1 COUNTRY CARDS =================
  const GREET = { TON: 'M\u0101l\u014d e lelei', FJI: 'Bula vinaka', WSM: 'Talofa lava', SLB: 'Halo olgeta', VUT: 'Halo', COK: 'Kia orana', FSM: 'Kaselehlie', KIR: 'Mauri', TUV: 'Talofa', MHL: 'Iakwe', PLW: 'Alii' };
  const B_HEAD = { scholars: 'Indigenous Scholars by Country', phd: 'Completed PhDs by Country', masters: "Completed Master's by Country" };
  const B_UNIT = { scholars: 'Indigenous scholars', phd: 'completed PhDs', masters: "completed Master's" };
  const B_MINI = { scholars: 'Scholars', phd: 'PhDs', masters: "Master's" };
  const B_NAME = { FSM: 'FSM' };
  function renderCards(olSel, titleSel, photo = false) {
    const ol = $(olSel); if (!ol) return;
    const m = METRICS[state.metric];
    $(titleSel).textContent = B_HEAD[state.metric];
    const list = sorted();
    const max = Math.max(1, ...list.map(c => c[m.key] || 0));
    ol.setAttribute('aria-label', `Countries in descending order of ${m.unit}`);
    // Remember where each card sits so reordered cards can slide to their new place.
    const before = {};
    $$('.ps-b-card', ol).forEach(li => { before[li.dataset.code] = li.getBoundingClientRect(); });
    ol.innerHTML = list.map((c, i) => {
      const v = c[m.key];
      const valText = v == null ? 'Not available' : fmt(v);
      const minis = ['phd', 'masters', 'scholars'].filter(k => k !== state.metric)
        .map((k, j) => `<span class="ps-b-card__mini ps-b-card__mini--${j ? 'b' : 'a'}"><b>${fmt(c[k])}</b>${B_MINI[k]}</span>`).join('');
      const btn = c.dashboard
        ? `<a class="ps-b-card__btn" href="${esc(c.dashboard)}" target="_blank" rel="noopener" aria-label="View ${esc(c.name)} dashboard (opens in a new tab; separate passcode)">View dashboard</a>`
        : c.dashboardStatus === 'development'
          ? '<span class="ps-b-card__btn ps-b-card__btn--dev">In development</span>'
          : '<span class="ps-b-card__btn ps-b-card__btn--none">No dashboard yet</span>';
      const on = state.sel === c.code;
      return `<li class="ps-b-card${on ? ' is-selected' : ''}${state.sel && !on ? ' is-dim' : ''}${c.code === 'VUT' ? ' ps-b-card--darktext' : ''}" data-code="${c.code}" style="--c:${COLORS[c.code]}">
        <button type="button" class="ps-b-card__sel" aria-pressed="${on}" aria-label="Rank ${i + 1}: ${esc(c.name)}, ${valText} ${esc(m.unit)}. ${on ? 'Selected; activate to clear filter' : 'Activate to filter dashboard'}">
          <span class="ps-b-card__flagband"><img src="img/regional/flags-rect/${c.code.toLowerCase()}.webp" alt="" width="240" height="120" loading="lazy" /></span>
          <span class="ps-b-card__name${CARD_LONG[c.code] ? ' ps-b-card__name--long' : ''}">${esc(B_NAME[c.code] || c.name)}</span>
          <span class="ps-b-card__greet">${esc(GREET[c.code] || '')}</span>
          <span class="ps-b-card__vrow">${state.metric === 'scholars' ? ICONS.people : ICONS.cap}<span class="ps-b-card__v">${valText}</span></span>
          <span class="ps-b-card__l">${B_UNIT[state.metric]}</span>
          <span class="ps-b-card__bar" aria-hidden="true"><i style="width:${v == null ? 0 : Math.max(3, Math.round(v / max * 100))}%"></i></span>
        </button>
        <div class="ps-b-card__minis">${minis}</div>
        ${btn}
        ${photo ? `<img class="ps-b-card__photo" src="img/regional/${c.code.toLowerCase()}.webp" alt="" width="240" height="142" loading="lazy" style="object-position:${CARD_FOCUS[c.code] || 'center'}" />` : ''}
      </li>`;
    }).join('');
    $$('.ps-b-card__sel', ol).forEach(b => b.addEventListener('click', () => select(b.closest('.ps-b-card').dataset.code)));
    shuffleCards(ol, before);
  }

  // Slide cards from their old positions to their new ones (FLIP); cards that stay put don't move.
  function shuffleCards(ol, before) {
    if (!Object.keys(before).length || !Element.prototype.animate) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    $$('.ps-b-card', ol).forEach(li => {
      const o = before[li.dataset.code]; if (!o) return;
      const n = li.getBoundingClientRect(), dx = o.left - n.left, dy = o.top - n.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      li.style.zIndex = '2';
      li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => { li.style.zIndex = ''; };
    });
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
    $('#ps-map-sub').textContent = VIEW.a1 === 'table' ? 'Every country in one table, sorted by the selected metric.' : VIEW.a1 === 'chart' ? 'Each country compared on the number chosen below. Select a bar to filter.' : 'Number of Indigenous scholars beside each country. Select a number to filter.';
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

  // ================= OUTPUTS (A2: Publications over time) =================
  // Uses the same linked-publication list as Panel E, so the two always agree.
  function setupOutputs() {
    const csel = $('#ps-out-country');
    csel.innerHTML = '<option value="">All countries</option>' + countries().map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
    csel.addEventListener('change', () => setSel(csel.value));
    $('#ps-out-type').addEventListener('change', e => { state.out.type = e.target.value; renderOutputs(); });
    $('#ps-out-fa').addEventListener('change', e => { state.out.fa = e.target.value; renderOutputs(); });
    $('#ps-out-range').addEventListener('change', e => { state.out.range = e.target.value; renderOutputs(); });
    document.addEventListener('ps:pubs-ready', () => {
      const P = window.PSPublications, T = P.TYPE(), items = P.items();
      const order = ['journalArticle', 'book', 'bookSection', 'thesisPhd', 'thesisMasters', 'report', 'other'];
      $('#ps-out-type').innerHTML = '<option value="">All types</option>' + order.filter(k => T[k] && items.some(it => it.type === k)).map(k => `<option value="${k}">${esc(T[k].p)}</option>`).join('');
      renderOutputs();
    });
  }
  function renderOutputs() {
    const host = $('#ps-out'); if (!host) return;
    $('#ps-out-country').value = state.sel || '';
    const P = window.PSPublications;
    if (!P || !P.isReady || !P.isReady()) { host.innerHTML = '<div class="ps-empty">Publications are loading…</div>'; return; }
    const c = state.sel ? byCode[state.sel] : null;
    const NOW = new Date().getFullYear();
    const items = P.items().filter(it => (!state.out.type || it.type === state.out.type) && (!state.out.fa || (state.out.fa === 'first' ? it.first : !it.first)) && (!c || it.cs.includes(c.code)));
    const dated = items.filter(it => it.yr && !it.forth), forth = items.filter(it => it.forth).length, noYear = items.filter(it => !it.yr && !it.forth).length;
    const recent = state.out.range === 'recent';
    let bins = [];
    if (recent) { for (let y = NOW - 11; y <= NOW; y++) bins.push({ a: y, b: y, l: String(y) }); }
    else {
      const y0 = dated.length ? Math.floor(Math.min(...dated.map(it => it.yr)) / 5) * 5 : NOW - 20;
      for (let y = y0; y <= NOW; y += 5) bins.push({ a: y, b: Math.min(y + 4, NOW), l: `${y}` });
    }
    bins.forEach(b => { b.n = dated.filter(it => it.yr >= b.a && it.yr <= b.b).length; });
    const before = recent ? dated.filter(it => it.yr < NOW - 11).length : 0;
    if (forth) bins.push({ l: 'Forth.', n: forth, forth: true });
    const max = Math.max(1, ...bins.map(b => b.n));
    const W = 360, H = 160, pad = 18, bw = (W - 10) / bins.length;
    const bars = bins.map((b, i) => {
      const h = (b.n / max) * (H - 34), x = 5 + i * bw, yy = H - pad - h;
      const partial = !b.forth && b.b === NOW;
      const fill = b.forth ? '#e0a52a' : partial ? 'url(#ps-hatch)' : `hsl(${200 - i * 2} 62% ${46 - Math.min(i, 14)}%)`;
      const label = b.forth ? 'Forthcoming or in press' : (b.a === b.b ? String(b.a) : `${b.a}–${b.b}`);
      return `<g><rect x="${(x + 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(1, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"><title>${label}: ${fmt(b.n)} linked publication${b.n === 1 ? '' : 's'}${partial ? ' (year to date)' : ''}</title></rect>
        ${b.n ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(yy - 4).toFixed(1)}" text-anchor="middle" font-size="${bins.length > 14 ? 7.5 : 9.5}" font-weight="700" fill="#0c2140">${fmt(b.n)}</text>` : ''}
        <text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="${bins.length > 14 ? 7 : 8.5}" fill="#4a5d78">${recent && !b.forth ? "'" + String(b.a).slice(2) : b.l}</text></g>`;
    }).join('');
    const headline = c ? c.pubsIndigenous : D.regional.uniqueIndigenousPubs;
    const tl = state.out.type ? (P.TYPE()[state.out.type] || {}).p : '';
    host.innerHTML = `
      <div class="ps-out__head">${ICONS.book}<div><div class="ps-out__v">${fmt(items.length)}</div><div class="ps-out__l">${tl ? esc(tl) + ' · ' : ''}publications linked to directory scholars${c ? ' from ' + esc(c.name) : ''}${state.out.fa === 'first' ? ', Indigenous first author' : state.out.fa === 'co' ? ', co-authored or other' : ''}</div></div></div>
      <div class="ps-chart" role="img" aria-label="Linked publications by ${recent ? 'year' : 'five-year group'}: ${bins.map(b => (b.forth ? 'forthcoming' : b.l) + ' ' + b.n).join(', ')}">
        <svg viewBox="0 0 ${W} ${H}"><defs><pattern id="ps-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#9cc3e6"/><line x1="0" y1="0" x2="0" y2="5" stroke="#1d4f8a" stroke-width="2"/></pattern></defs>${bars}</svg>
      </div>
      <p class="ps-note">${recent ? `${NOW} is year to date (hatched). ${fmt(before)} dated before ${NOW - 11} are not shown; switch to All years to see them.` : `Five-year groups, labelled by their first year; ${NOW} is year to date.`}${forth ? ` ${fmt(forth)} forthcoming or in press (gold).` : ''}${noYear ? ` ${fmt(noYear)} have no year.` : ''} Same list as <a href="#ps-pubs-panel">Panel E</a>, which includes theses, reports and other types. Headline figure for comparison: ${fmt(headline)} Indigenous-linked publications in the main types${c ? '' : ', regionally deduplicated'}.</p>`;
  }

  // ================= BARS =================
  function setupBars() {
    syncBarView(state.metric);
    $$('[data-barview]').forEach(b => b.addEventListener('click', () => { syncBarView(b.dataset.barview); renderBars(); }));
    let wasNarrow = null;
    let lastW = 0;
    new ResizeObserver(() => { const cw = $('#ps-bars').clientWidth; const n = (cw || 600) < 520; if ((wasNarrow !== null && n !== wasNarrow) || (cw && Math.abs(cw - lastW) > 4)) { lastW = cw; renderBars(); } wasNarrow = n; }).observe($('#ps-bars'));
  }
  // A2 chart series: Scholars, Master's + PhD (stacked), Masters or PhD. Follows the
  // A1 metric when that changes; choosing a series here changes only this chart.
  function syncBarView(v) {
    state.barView = v === 'stack' || METRICS[v] ? v : 'scholars';
    $$('[data-barview]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.barview === state.barView)));
  }
  function renderBars() {
    const stack = state.barView === 'stack';
    const m = METRICS[stack ? 'scholars' : state.barView] || METRICS.scholars;
    const sortVal = c => (stack ? (c.masters == null && c.phd == null ? null : (c.masters || 0) + (c.phd || 0)) : c[m.key]);
    const list = countries().slice().sort((a, b) => (sortVal(b) ?? -1) - (sortVal(a) ?? -1) || a.name.localeCompare(b.name));
    const vals = list.map(c => (stack ? c.masters + c.phd : c[m.key] || 0));
    const max = Math.max(1, ...vals);
    const nice = (() => { const e = Math.pow(10, Math.floor(Math.log10(max))); return [1, 2, 2.5, 5, 10].map(f => f * e).find(v => v >= max); })();
    const narrow = ($('#ps-bars').clientWidth || 600) < 520;
    // Desktop: fill the panel height set by the panels beside it, so the chart has no empty band below.
    let fillH = 400;
    if (!narrow) {
      const el = $('#ps-bars'), sec = el.closest('section'), cw = el.clientWidth;
      if (cw && sec) { const room = sec.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 34; fillH = Math.max(400, Math.min(720, Math.round(520 * room / cw))); }
    }
    const W = narrow ? 400 : 520, H = narrow ? 300 : fillH, L = 34, B = narrow ? 64 : 40, T = 16, Rt = 4;
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
    $('#ps-bars-sub').textContent = stack ? "Showing completed Master's and PhD degrees stacked, sorted by their total. Degree records, not people." : `Showing ${m.unit}, sorted descending. ${m.key === 'scholars' ? 'People, not degrees.' : 'Degree records, not people.'}`;
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

  // ================= DISCIPLINES =================
  function setupDisc() {
    $$('[data-disc]').forEach(b => b.addEventListener('click', () => { state.disc = b.dataset.disc; renderDisc(); }));
    $('#ps-disc-level').addEventListener('change', e => { state.discLevel = e.target.value; renderDisc(); });
    $$('[data-dg]').forEach(b => b.addEventListener('click', () => { state.discG = b.dataset.dg; renderDisc(); }));
    $$('[data-ds]').forEach(b => b.addEventListener('click', () => { state.discScale = b.dataset.ds; renderDisc(); }));
  }
  // Discipline counts for one gender (or all) from the encrypted study map aggregates.
  function discCounts(g) {
    const codes = state.disc === 'ALL' ? D.disciplineCountries : [state.disc];
    const cats = D.disciplineCategories.concat(['Unknown / unmapped']);
    const counts = Object.fromEntries(cats.map(k => [k, 0]));
    const DG = (D.studyMap && D.studyMap.discGender) || {};
    codes.forEach(code => {
      ['M', 'P'].forEach(l => {
        if (state.discLevel !== 'all' && state.discLevel !== l) return;
        if (g === 'all') { const d = byCode[code] && byCode[code].disciplines; for (const k in (d && d[l]) || {}) counts[k] = (counts[k] || 0) + d[l][k]; }
        else { const d = ((DG[code] || {})[l] || {})[g] || {}; for (const k in d) counts[k] = (counts[k] || 0) + d[k]; }
      });
    });
    return counts;
  }
  function renderDisc() {
    $$('[data-disc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.disc === state.disc)));
    $$('[data-dg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dg === state.discG)));
    $$('[data-ds]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ds === state.discScale)));
    $('#ps-disc-scale').hidden = state.discG !== 'compare';
    const hasG = !!(D.studyMap && D.studyMap.discGender);
    if (state.discG === 'compare') return renderDiscCompare();
    const counts = discCounts(hasG ? state.discG : 'all');
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
    const lvl = (state.discLevel === 'M' ? "completed Master's" : state.discLevel === 'P' ? 'completed PhDs' : 'completed degrees') + (state.discG === 'female' ? ' (women)' : state.discG === 'male' ? ' (men)' : '');
    $('#ps-disc').innerHTML = total ? `
      <div class="ps-donut" role="img" aria-label="Fields of research for ${esc(scopeLabel)}: ${order.map(k => `${k} ${counts[k]}`).join(', ')}; unknown or unmapped ${counts['Unknown / unmapped']}">
        <svg viewBox="0 0 150 150">${arcs}</svg>
        <div class="ps-donut__c"><div class="ps-donut__v">${fmt(total)}</div><div class="ps-donut__l">${esc(lvl)}</div></div>
      </div>
      <ul class="ps-legend">${order.map(k => `<li><i style="background:${colorOf(k)}"></i><span>${esc(k)}</span><span class="n">${fmt(counts[k])}</span><span class="p">${pct(counts[k], total)}%</span></li>`).join('')}
        <li class="is-unknown"><i style="background:#b9c6d4"></i><span>Unknown / unmapped</span><span class="n">${fmt(counts['Unknown / unmapped'])}</span><span class="p">${pct(counts['Unknown / unmapped'], total)}%</span></li></ul>`
      : '<div class="ps-empty">No completed degrees with discipline data for this selection.</div>';
    discSelNote();
  }
  function discSelNote() {
    if (state.sel && !D.disciplineCountries.includes(state.sel)) $('#ps-disc').insertAdjacentHTML('afterbegin', `<div class="ps-empty" style="grid-column:1/-1;margin-bottom:8px">${esc(nameOf(state.sel))} is not included: discipline data are approved for Fiji, Tonga and Vanuatu only.</div>`);
  }
  function renderDiscCompare() {
    const F = discCounts('female'), M = discCounts('male');
    const tf = Object.values(F).reduce((a, b) => a + b, 0), tm = Object.values(M).reduce((a, b) => a + b, 0);
    const share = state.discScale === 'pct';
    const cats = D.disciplineCategories.slice().sort((a, b) => (F[b] + M[b]) - (F[a] + M[a])).concat(['Unknown / unmapped']);
    const v = (n, t) => share ? (t ? 100 * n / t : 0) : n;
    const max = Math.max(1, ...cats.flatMap(k => [v(F[k], tf), v(M[k], tm)]));
    const lab = (n, t) => share ? `${pct(n, t)}%` : fmt(n);
    $('#ps-disc').innerHTML = (tf + tm) ? `<div class="ps-dcmp" role="table" aria-label="Fields of research, women compared with men">
      <div class="ps-dcmp__key" aria-hidden="true"><span><i class="ps-gd-f"></i>Women (n = ${fmt(tf)})</span><span><i class="ps-gd-m"></i>Men (n = ${fmt(tm)})</span></div>
      ${cats.map(k => `<div class="ps-dcmp__row" role="row"><div class="ps-dcmp__l" role="rowheader">${esc(k)}</div><div class="ps-dcmp__bars" role="cell">
        <div class="ps-dcmp__bar"><span class="ps-gd-f" style="width:${(100 * v(F[k], tf) / max).toFixed(1)}%"></span><b>${lab(F[k], tf)}</b></div>
        <div class="ps-dcmp__bar"><span class="ps-gd-m" style="width:${(100 * v(M[k], tm) / max).toFixed(1)}%"></span><b>${lab(M[k], tm)}</b></div></div></div>`).join('')}
      </div>` : '<div class="ps-empty">No completed degrees with discipline and gender data for this selection.</div>';
    discSelNote();
  }

  // ================= GENDER =================
  function figure(color, female) {
    return female
      ? `<svg viewBox="0 0 18 34" aria-hidden="true"><circle cx="9" cy="4" r="3.6" fill="${color}"/><path d="M9 8.5c-3 0-4 2-4.6 4.5L2.6 22h3.6l.4 11h4.8l.4-11h3.6L13.6 13C13 10.5 12 8.5 9 8.5z" fill="${color}"/></svg>`
      : `<svg viewBox="0 0 18 34" aria-hidden="true"><circle cx="9" cy="4" r="3.6" fill="${color}"/><path d="M4 9h10c1.2 0 2 .8 2 2v10h-2.4v12H10.2V22H7.8v11H4.4V21H2V11c0-1.2.8-2 2-2z" fill="${color}"/></svg>`;
  }
  const G_VIEW = {
    people: ['Indigenous scholars', 'people', c => c.gender],
    M: ["Completed Master's", "Master's degrees", c => degG(c.code, 'M')],
    P: ['Completed PhDs / doctorates', 'PhD and doctorate degrees', c => degG(c.code, 'P')],
    pub: ['Publishing scholars', 'people with ≥1 linked publication', c => c.pubGender],
  };
  function degG(code, L) { const g = (((D.studyMap || {}).degGender || {})[code] || {})[L]; return g || null; }
  function setupGender() {
    const sel = $('#ps-gender-country');
    sel.innerHTML = '<option value="">All countries</option>' + countries().map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
    sel.addEventListener('change', () => setSel(sel.value));
    const bs = $$('#ps-gender-view button');
    if (!(D.studyMap && D.studyMap.degGender)) bs.filter(b => b.dataset.v === 'M' || b.dataset.v === 'P').forEach(b => b.remove());
    $$('#ps-gender-view button').forEach(b => b.addEventListener('click', () => { state.gView = b.dataset.v; renderGender(); }));
    $('#ps-gender-list').addEventListener('click', e => { const b = e.target.closest('[data-gsel]'); if (b) setSel(b.dataset.gsel); });
  }
  function renderGender() {
    $('#ps-gender-country').value = state.sel || '';
    $$('#ps-gender-view button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === state.gView)));
    const [title, what, get] = G_VIEW[state.gView] || G_VIEW.people;
    const scope = state.sel ? [byCode[state.sel]] : countries();
    const sum = list => list.reduce((a, c) => { const g = get(c); if (g) { a.female += g.female; a.male += g.male; a.unknown += g.unknown; } return a; }, { female: 0, male: 0, unknown: 0 });
    const g = sum(scope), n = g.female + g.male + g.unknown;
    $('#ps-gender-sub').textContent = `Gender as recorded in each Master file — ${state.sel ? nameOf(state.sel) : 'all countries'}. Percentages use the full denominator, including not recorded.`;
    $('#ps-gender').innerHTML = `<div class="ps-gcard"><h3>${esc(title)}</h3><div class="d">n = ${fmt(n)} ${esc(what)}</div>
        <div class="ps-grow"><div class="ps-g">${figure('#e0464f', true)}<div><b>${pct(g.female, n)}%</b><span>Female (${fmt(g.female)})</span></div></div>
        <div class="ps-g">${figure('#1f5fae', false)}<div><b>${pct(g.male, n)}%</b><span>Male (${fmt(g.male)})</span></div></div></div>
        <div class="ps-gunk">Not recorded: ${pct(g.unknown, n)}% (${fmt(g.unknown)})</div></div>`;
    $('#ps-gender-list-h').textContent = `Women's share by country · ${title}`;
    const rows = countries().map(c => { const x = get(c) || { female: 0, male: 0, unknown: 0 }; const k = x.female + x.male, all = k + x.unknown; return { c, f: x.female, k, all, u: x.unknown }; }).filter(r => r.all);
    const key = r => (r.k && r.u / r.all <= 0.5) ? r.f / r.k : -1;
    rows.sort((a, b) => key(b) - key(a) || a.c.name.localeCompare(b.c.name));
    $('#ps-gender-list').innerHTML = rows.map(r => {
      const mostly = r.u / r.all > 0.5, p = r.k ? Math.round(100 * r.f / r.k) : 0;
      return `<li class="${state.sel === r.c.code ? 'sel' : ''}"><button type="button" data-gsel="${r.c.code}" aria-pressed="${state.sel === r.c.code}" title="${esc(r.c.name)}: ${fmt(r.f)} women of ${fmt(r.k)} with gender recorded${r.u ? `; ${fmt(r.u)} not recorded` : ''}"><img src="img/regional/flags/${r.c.code.toLowerCase()}.png" alt="">${esc(SHORT[r.c.code] || r.c.name)}</button>
        ${mostly ? `<span class="ps-gshare__na">Mostly not recorded (${fmt(r.u)} of ${fmt(r.all)})</span>` : `<span class="ps-gshare__bar"><i style="width:${p}%"></i></span><b>${p}%</b>`}</li>`;
    }).join('');
  }

  // ================= PACIFIC FIRSTS TIMELINE =================
  const FT = { stage: 'both', gender: 'both', Y0: 1950, R: 16, GAP: 6, photos: {}, byId: {} };
  const ftBare = person => String(person || '').normalize('NFD').replace(/[\u0300-\u036f\u02bb\u2018\u2019'`]/g, '').toLowerCase().replace(/^(dr|mr|ms|prof|sir)\s+/, '').replace(/\s+/g, ' ').trim();
  function ftPhoto(code, person) {
    const supplied = FT.photos[code + '|' + ftBare(person)];
    if (supplied) return supplied;
    try { return (window.PSDirectory && window.PSDirectory.scholarPhoto(code, person)) || ''; }
    catch (e) { return ''; }
  }
  const FT_PLACE = { male: 'img/regional/firsts/placeholder-male.webp', female: 'img/regional/firsts/placeholder-female.webp' };
  function ftPhotoHtml(code, person, cls, gender) {
    const real = ftPhoto(code, person);
    const src = real || FT_PLACE[gender] || '';
    if (!src) return '';
    const mini = cls.indexOf('mini') !== -1;
    return `<img class="${cls}" src="${esc(src)}" alt="" width="${mini ? 22 : 84}" height="${mini ? 22 : 104}"${real ? ` data-fallback="${esc(FT_PLACE[gender] || '')}"` : ''}>`;
  }
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
    fetch('data/regional-firsts-photos.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).then(d => {
      FT.photos = d.photos || {}; window.PSFirstsById = d.byId || {};
    }).catch(() => {});
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
      const photo = ftPhotoHtml(m.code, m.person, 'ps-ft-tip__photo', m.gender);
      const also = m.also && m.also.length ? `<div class="ps-ft-tip__also">Also ${m.year}: ${m.also.map(a => `${ftPhotoHtml(m.code, a.person, 'ps-ft-tip__mini', m.gender)}${esc(a.person)}, ${esc(a.uni)}${a.uc ? ` (${esc(a.uc)})` : ''}`).join('; ')}</div>` : '';
      tip.classList.toggle('has-photo', !!photo);
      tip.innerHTML = `<div class="ps-ft-tip__main">${photo}<div><div class="ps-ft-tip__h"><img src="img/regional/flags/${esc(m.code.toLowerCase())}.png" alt="">${esc(m.country)}</div>
        <div class="ps-ft-tip__y"><strong>${m.year}:</strong> First ${esc(m.gender)} ${FT_LBL[m.stage]}</div>
        <div class="ps-ft-tip__p">${esc(m.person)}</div><div class="ps-ft-tip__u">${esc(m.uni)}${m.uc ? ` (${esc(m.uc)})` : ''}</div></div></div>
        ${also}`;
      tip.querySelectorAll('img[data-fallback]').forEach(img => img.addEventListener('error', () => { if (img.dataset.fallback && !img.src.endsWith(img.dataset.fallback)) img.src = img.dataset.fallback; }));
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
    renderFirstsList(items);
    const nC = new Set(items.map(m => m.code)).size;
    $('#ps-ft-count').textContent = `${items.length} first${items.length === 1 ? '' : 's'} shown across ${nC} countr${nC === 1 ? 'y' : 'ies'}${state.sel ? ` (filtered to ${nameOf(state.sel)})` : ''}.`;
  }

  // University-country flags in the B1 list: a small rectangular flag (with the
  // country name as its tooltip) replaces the old two-letter pill.
  const UC_NAME = { US: 'United States', NZ: 'New Zealand', AU: 'Australia', UK: 'United Kingdom', GB: 'United Kingdom', FJ: 'Fiji', CA: 'Canada', PG: 'Papua New Guinea', MT: 'Malta', FR: 'France', JP: 'Japan', CN: 'China', PH: 'Philippines', IN: 'India', DE: 'Germany', NL: 'Netherlands', IE: 'Ireland', SB: 'Solomon Islands', TO: 'Tonga', WS: 'Samoa', VU: 'Vanuatu', KI: 'Kiribati', TV: 'Tuvalu', CK: 'Cook Islands', NU: 'Niue', PW: 'Palau', FM: 'Federated States of Micronesia', MH: 'Marshall Islands', NR: 'Nauru', TH: 'Thailand', MY: 'Malaysia', SG: 'Singapore', ID: 'Indonesia', KR: 'South Korea', TW: 'Taiwan', CH: 'Switzerland', SE: 'Sweden', NO: 'Norway', IT: 'Italy', ES: 'Spain', ZA: 'South Africa' };
  // University-country pills (restored next to the flag, as in the B1 mockup).
  const UC_PILL = { US: ['#F6BB1F', '#1a1206'], NZ: ['#1E8AE0', '#fff'], AU: ['#F07A3A', '#1a0b04'], UK: ['#6A47C9', '#fff'], GB: ['#6A47C9', '#fff'], FJ: ['#3BB273', '#04140b'], CA: ['#E0393E', '#fff'], PG: ['#8B4A22', '#fff'], MT: ['#8FA3BF', '#0b1626'], FR: ['#4F6BED', '#fff'] };
  function ucPill(code) {
    const k = String(code).toUpperCase();
    let [bg, fg] = UC_PILL[k] || [];
    if (!bg) { let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 360; bg = `hsl(${h},55%,62%)`; fg = '#0b1626'; }
    return `<span class="ps-ftl__uc" style="background:${bg};color:${fg}" title="${esc(UC_NAME[k] || k)}">${esc(k)}</span>`;
  }
  const UC_LOCAL = new Set(['us', 'nz', 'au', 'gb', 'fj', 'ca', 'pg', 'mt', 'fr', 'jp', 'cn', 'ph', 'in', 'de', 'nl', 'ie', 'sb', 'to', 'ws', 'vu', 'ki', 'tv', 'ck', 'nu', 'pw', 'fm', 'mh', 'nr', 'th', 'my', 'sg', 'id', 'kr', 'tw', 'ch', 'se', 'no', 'it', 'es', 'za']);
  function ucFlag(code) {
    const k = String(code).toUpperCase(), iso = (k === 'UK' ? 'gb' : k.toLowerCase());
    const label = UC_NAME[k] || k;
    if (!/^[a-z]{2}$/.test(iso)) return `<span class="ps-ftl__ucx" title="${esc(label)}">${esc(k)}</span>`;
    const src = UC_LOCAL.has(iso) ? `img/regional/flags-uni/${iso}.png` : `https://flagcdn.com/w80/${iso}.png`;
    return `<img class="ps-ftl__uf" src="${src}" alt="${esc(label)}" title="${esc(label)}" width="40" height="27" loading="lazy" data-uc="${esc(k)}">`;
  }
  const FTL = { key: 'year', dir: 1, items: [] };
  const FTL_COLS = [['year', 'Year'], ['country', 'Country'], ['first', 'First'], ['scholar', 'Scholar'], ['uni', 'University']];
  const FTL_ICON = {
    cap: '<svg class="ps-ftl__ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3zm-6.82 9.62v3.87C6.94 18.06 9.3 19 12 19s5.06-.94 6.82-2.51v-3.87L12 16.34l-6.82-3.72z"/></svg>',
    sort: '<svg class="ps-ftl__sort" viewBox="0 0 10 14" aria-hidden="true"><path class="up" d="M5 1 9 6H1z"/><path class="dn" d="M5 13 1 8h8z"/></svg>'
  };
  function ftlSortVal(r, key) {
    if (key === 'year') return r.m.year;
    if (key === 'country') return r.m.country;
    if (key === 'first') return (r.m.stage === 'phd' ? 1 : 0) * 2 + (r.m.gender === 'female' ? 1 : 0);
    if (key === 'scholar') return String(r.person).replace(/^(Sir|Dame|Dr|Prof|Professor|Mr|Mrs|Ms|Miss|Ratu|Adi|Rev)\.?\s+/gi, '').replace(/^(Sir|Ratu|Adi)\s+/i, '');
    return r.uni || '';
  }
  function renderFirstsList(items) {
    const t = $('#ps-ft-list'); if (!t) return;
    if (items) FTL.items = items; else items = FTL.items;
    const rows = [];
    items.forEach(m => { rows.push({ m, person: m.person, uni: m.uni, uc: m.uc }); (m.also || []).forEach(a => rows.push({ m, person: a.person, uni: a.uni, uc: a.uc })); });
    const cmp = (a, b) => { const x = ftlSortVal(a, FTL.key), y = ftlSortVal(b, FTL.key); return typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); };
    rows.sort((a, b) => FTL.dir * cmp(a, b) || a.m.year - b.m.year || a.m.country.localeCompare(b.m.country));
    const find = (code, person) => { try { return (window.PSDirectory && window.PSDirectory.findId && window.PSDirectory.findId(code, person)) || ''; } catch (e) { return ''; } };
    const head = FTL_COLS.map(([k, l]) => { const on = FTL.key === k, srt = on ? (FTL.dir > 0 ? 'ascending' : 'descending') : 'none'; return `<th scope="col" aria-sort="${srt}"><button type="button" class="ps-ftl__th${on ? ` is-${srt}` : ''}" data-ftlsort="${k}" title="Sort by ${l.toLowerCase()}">${l}${FTL_ICON.sort}</button></th>`; }).join('');
    t.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${rows.length ? rows.map(r => {
      const id = find(r.m.code, r.person);
      const name = id ? `<a href="#dir=${esc(id)}" title="Open this scholar's card in the Regional Scholar Directory">${esc(r.person)}</a>` : esc(r.person);
      return `<tr class="ps-ftl--${r.m.gender} ps-ftl--${r.m.stage}"><td class="y">${r.m.year}</td><td><div class="ps-ftl__cc"><span class="ps-ftl__c"><img src="img/regional/flags-rect/${r.m.code.toLowerCase()}.webp" alt="" width="40" height="27">${esc(r.m.country)}</span></div></td><td><span class="ps-ftl__tag">${FTL_ICON.cap}${esc(r.m.gender === 'male' ? 'Male' : 'Female')} ${FT_LBL[r.m.stage]}</span></td><td><span class="ps-ftl__sch">${ftPhotoHtml(r.m.code, r.person, 'ps-ft-tip__mini', r.m.gender)}${name}</span></td><td><span class="ps-ftl__u">${r.uc ? ucFlag(r.uc) : '<span class="ps-ftl__ufx"></span>'}<span>${esc(r.uni)}</span>${r.uc ? ucPill(r.uc) : ''}</span></td></tr>`;
    }).join('') : '<tr><td colspan="5">No firsts recorded for this selection.</td></tr>'}</tbody>`;
    t.querySelectorAll('img[data-fallback]').forEach(img => img.addEventListener('error', () => { if (img.dataset.fallback && !img.src.endsWith(img.dataset.fallback)) img.src = img.dataset.fallback; }));
    t.querySelectorAll('img.ps-ftl__uf').forEach(img => img.addEventListener('error', () => { const s = document.createElement('span'); s.className = 'ps-ftl__ufx'; img.replaceWith(s); }, { once: true }));
    t.querySelectorAll('[data-ftlsort]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.ftlsort;
      if (FTL.key === k) FTL.dir = -FTL.dir; else { FTL.key = k; FTL.dir = 1; }
      renderFirstsList();
      const nb = t.querySelector(`[data-ftlsort="${k}"]`); if (nb) nb.focus();
    }));
  }

  // ================= UNIVERSITY POSITIONS (table + leadership by gender) =================
  let posTouch = false;
  const POS = { held: 'ever', gen: 'b', leadC: '*', lastSel: null };
  const posHas = c => D.positions && (D.positions.coverage.positions[c] > 0 || ((D.positions.coverage.profile || {})[c] || 0) > 0);
  const posProfileOnly = c => D.positions && !(D.positions.coverage.positions[c] > 0) && ((D.positions.coverage.profile || {})[c] || 0) > 0;
  function setupPositions() {
    const P = D.positions;
    if (!P || !Array.isArray(P.scholars) || !P.scholars.length) return;
    $('#ps-careers-panel').hidden = false;
    setupWhereRank(); setupCareerViews();
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
      const uniOf = s => {
        let U = (s.r[k] && s.r[k].u) || [];
        if (POS.held === 'cur' && U.some(u => u[2])) U = U.filter(u => u[2]);
        return U.length ? ` <span class="ps-pos-tip__sep">|</span> <span class="ps-pos-tip__uni">${U.map(u => esc(u[0]) + (u[1] ? ` <span class="ps-pos-tip__cc">(${esc(u[1])})</span>` : '')).join('; ')}</span>` : '';
      };
      const names = L.slice().sort((a, b) => a.n.localeCompare(b.n)).map(s => esc(s.n) + (c === '*' ? ` <span style="opacity:.7">(${esc(SHORT[s.c] || s.c)})</span>` : '') + uniOf(s));
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
    const profOnly = countries().filter(c => posProfileOnly(c.code)).map(c => c.name);
    const nProf = Object.values(P.coverage.profile || {}).reduce((a, b) => a + b, 0);
    $('#ps-pos-note').textContent = `${fmt(nPos)} position records for ${fmt(nWith)} scholars on the included rosters, plus the current title on ${fmt(nProf)} scholar profiles (so a recent promotion shown on a profile is counted even if the Positions sheet is not yet updated).${profOnly.length ? ` ${profOnly.join(', ')}: no Positions sheet records yet, so counts come from profile titles only and are a minimum.` : ''}${empty.length ? ` Striped columns: no records yet (${empty.join(', ')}).` : ''} Each cell shows the share of that column's "Scholars with any of these", with the count in brackets (in the Region column, the share of all the region's \"Scholars with any of these\"). \"Scholars with any of these\" also shows its share of each roster, and \"Roster size\" shows each country's share of the regional roster. Colours by share: grey 1–3%, blue 4–7%, yellow 8–9%, orange 10–14%, rose 15–24%, maroon 25% and over. Region total counts unique scholars. Leadership roles count only at universities and other higher-education institutions, and include acting appointments. Academic ranks use the recorded title; "Assistant Professor" and "Lecturer" are kept separate.`;
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
    if (!D.positions || $('#ps-careers-panel').hidden) return;
    const keys = whereKeys(), M = {}, tot = {};
    for (const s of D.positions.scholars) whereHosts(s, keys).forEach(h => { (M[s.c] = M[s.c] || {})[h] = ((M[s.c] || {})[h] || 0) + 1; tot[h] = (tot[h] || 0) + 1; });
    const hosts = Object.keys(tot).sort((a, b) => tot[b] - tot[a] || a.localeCompare(b));
    const top = hosts.slice(0, 9); whereOther = hosts.slice(9);
    const cols = whereOther.length ? [...top, 'Other'] : top;
    const homes = countries().map(c => c.code).filter(posHas);
    const val = (c, h) => h === 'Other' ? whereList(c, 'Other').length : ((M[c] || {})[h] || 0);
    // Row base: unique scholars from this home country with at least one position in the chosen group.
    const base = c => D.positions.scholars.filter(s => s.c === c && whereHosts(s, keys).size).length;
    let html = '<thead><tr><th scope="col"><span class="ps-sr">Home country</span></th>' + cols.map(h => `<th scope="col"><span>${esc(h)}</span></th>`).join('') + '<th scope="col" class="ps-hm-n"><span>Scholars</span></th></tr></thead><tbody>';
    for (const c of homes) {
      const n = base(c);
      html += `<tr class="${state.sel === c ? 'sel' : ''}"><th class="home" scope="row"><img src="img/regional/flags/${c.toLowerCase()}.png" alt="">${esc(nameOf(c))}</th>` + cols.map(h => {
        const v = val(c, h), a = n ? v / n : 0, p = Math.round(100 * a), rc = bandCell(a);
        const bg = v ? rc.bg : 'rgba(255,255,255,.04)';
        const attrs = v ? ` data-c="${c}" data-h="${esc(h)}" tabindex="0" aria-label="${esc(nameOf(c))} scholars in ${esc(h)}: ${v} of ${n} (${p}%)"` : '';
        return `<td class="${HOMEN[c] === h ? 'self' : ''}" style="background:${bg};color:${v ? rc.fg : '#eaf3fb'}"${attrs}>${v ? `${p}% <small>(${fmt(v)})</small>` : ''}</td>`;
      }).join('') + `<td class="ps-hm-n" title="${fmt(n)} scholars with a position in this group">${fmt(n)}</td></tr>`;
    }
    $('#ps-where-table').innerHTML = html + '</tbody>';
    posTipHide();
  }
  function renderRank() {
    if (!D.positions || $('#ps-careers-panel').hidden) return;
    const P = D.positions;
    const rows = countries().map(c => c.code).filter(posHas).map(c => { const L = P.scholars.filter(s => s.c === c && posTop(s)); const cnt = {}; L.forEach(s => { const k = posTop(s); cnt[k] = (cnt[k] || 0) + 1; }); return { c, n: L.length, cnt }; }).filter(r => r.n);
    const mx = Math.max(1, ...rows.map(r => r.n));
    $('#ps-rank-bars').innerHTML = rows.map(r => {
      const w = WR.scale === 'pct' ? 100 : 100 * r.n / mx;
      const segs = P.rank.map(([k, l]) => { const v = r.cnt[k] || 0; if (!v) return ''; const p = 100 * v / r.n; return `<span data-c="${r.c}" data-k="${k}" tabindex="0" style="flex:0 0 ${p}%;background:${RANKC[k] || '#7d8da1'};${RANKDARK.has(k) ? 'color:#0a2d52' : ''}" aria-label="${esc(l)}: ${v} (${Math.round(p)}%)">${p >= 9 ? (WR.scale === 'pct' ? Math.round(p) + '%' : v) : ''}</span>`; }).join('');
      return `<div class="ps-ld-row${state.sel === r.c ? ' sel' : ''}"><div class="nm"><img class="rect" src="img/regional/flags-rect/${r.c.toLowerCase()}.webp" alt="" width="30" height="20">${esc(nameOf(r.c))}</div><div><div class="ps-ld-bar" style="width:${w}%">${segs}</div></div><div class="ps-ld-n${r.n < 10 ? ' is-small' : ''}"${r.n < 10 ? ' title="Fewer than 10 scholars: shares can swing widely"' : ''}>n=${r.n}${r.n < 10 ? '*' : ''}</div></div>`;
    }).join('');
    const small = rows.filter(r => r.n < 10).map(r => nameOf(r.c));
    $('#ps-rank-note').textContent = 'Countries with positions recorded. Hover over or tap a segment for the count.' + (small.length ? ` * Fewer than 10 scholars with a recorded rank (${small.join(', ')}): read these shares with care.` : '');
    $('#ps-rank-bars').querySelectorAll('span[data-k]').forEach(sp => { if (sp.textContent && sp.scrollWidth > sp.clientWidth + 1) sp.textContent = ''; });
    $('#ps-rank-legend').innerHTML = P.rank.map(([k, l]) => `<span><i style="background:${RANKC[k] || '#7d8da1'}"></i>${esc(l)}</span>`).join('');
    posTipHide();
  }
  // ----- B2 "Scholar list" (default) and "Where they have worked" views -----
  const ISO2 = { FJI: 'fj', NZL: 'nz', USA: 'us', WSM: 'ws', AUS: 'au', SLB: 'sb', TON: 'to', VUT: 'vu', PNG: 'pg', PLW: 'pw', CAN: 'ca', GBR: 'gb', MHL: 'mh', GUM: 'gu', COK: 'ck', FSM: 'fm', TUV: 'tv', KIR: 'ki', DEU: 'de', ITA: 'it', FRA: 'fr', JPN: 'jp', CHN: 'cn', PHL: 'ph', IND: 'in', NLD: 'nl', IRL: 'ie', NIU: 'nu', NRU: 'nr', THA: 'th', MYS: 'my', SGP: 'sg', IDN: 'id', KOR: 'kr', TWN: 'tw', CHE: 'ch', SWE: 'se', NOR: 'no', ESP: 'es', ZAF: 'za', MLT: 'mt' };
  const HOST_NAME = { ...Object.fromEntries(Object.entries(ISO2).map(([k, v]) => [k, UC_NAME[v.toUpperCase()] || k])), GUM: 'Guam', GBR: 'United Kingdom' };
  const hostName = c => HOMEN[c] || HOST_NAME[c] || c;
  const CL = { cat: 'lead', pos: null, home: '*', held: 'ever', gen: 'b', sort: 'cur', open: new Set(), lastSel: null };
  const CW = { cat: 'both', home: '*', held: 'ever', gen: 'b', host: null, uni: null, allHosts: false, allUnis: false };
  const catKeys = cat => { const P = D.positions; return cat === 'lead' ? P.lead.map(x => x[0]) : cat === 'rank' ? P.rank.map(x => x[0]) : [...P.lead, ...P.rank].map(x => x[0]); };
  const posLabel = k => ([...D.positions.lead, ...D.positions.rank].find(x => x[0] === k) || [k, k])[1];
  function dirMap() {
    const L = (window.PSDirectory && window.PSDirectory.scholars && window.PSDirectory.scholars()) || [];
    return new Map(L.map(s => [s.id, s]));
  }
  // Institutions for one role, honouring Ever / Currently held (same rule as the B2 popup).
  function roleUnis(e, held) { let U = e.u || []; if (held === 'cur' && U.some(u => u[2])) U = U.filter(u => u[2]); return U; }
  // Years of service for one role: "Since 2025" (current), "2010–2012" (former); only what the Positions sheets record.
  function roleYears(e, U) {
    const st = U.map(u => u[3]).filter(Boolean).sort(), en = U.map(u => u[4]).filter(Boolean).sort();
    if (e.cur) { const cs = U.filter(u => u[2]).map(u => u[3]).filter(Boolean).sort(); return cs.length ? `Since ${cs[0]}` : ''; }
    if (st.length && en.length) return st[0] === en[en.length - 1] ? st[0] : `${st[0]}–${en[en.length - 1]}`;
    if (st.length) return `From ${st[0]}`;
    if (en.length) return `Until ${en[en.length - 1]}`;
    return '';
  }
  const ICO = {
    cap: 'M12 3L1 9l11 6 9-4.9V17h2V9L12 3zM5 13.2v3.8c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8-7-3.8z',
    inst: 'M12 2L2 7v2h20V7L12 2zM4 11v7h3v-7H4zm6.5 0v7h3v-7h-3zM17 11v7h3v-7h-3zM2 20v2h20v-2H2z',
    podium: 'M12 1.5a3 3 0 110 6 3 3 0 010-6zM8.5 9h7l1.2 3.5H7.3L8.5 9zM4 13.5h16V16h-2.2l-1.3 6.5h-9L6.2 16H4v-2.5z',
    group: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    woman: 'M12 1.5a2.6 2.6 0 110 5.2 2.6 2.6 0 010-5.2zM9.6 8h4.8l3.3 8.6h-3.2V22h-4.9v-5.4H6.3L9.6 8z',
    globe: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
    bulb: 'M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z',
    book: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
  };
  const svgI = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${ICO[k]}"/></svg>`;
  const POS_ICO = { chancellor: 'inst', pvc: 'podium', vc: 'podium', dean: 'group', adean: 'group', head: 'group', director: 'bulb', prof: 'cap', assoc: 'cap', senlec: 'book', asst: 'book', lec: 'book', asstlec: 'book', rf: 'bulb', adj: 'book' };
  const flagRect = c => `<img class="ps-cl-flag" src="img/regional/flags-rect/${c.toLowerCase()}.webp" alt="${esc(nameOf(c))}" title="${esc(nameOf(c))}" width="42" height="28">`;
  const hostFlag = c => HOMEN[c] ? `<img class="ps-cl-hflag" src="img/regional/flags-rect/${c.toLowerCase()}.webp" alt="" width="30" height="20">` : (ISO2[c] && UC_LOCAL.has(ISO2[c]) ? `<img class="ps-cl-hflag" src="img/regional/flags-uni/${ISO2[c]}.png" alt="" width="30" height="20">` : '<span class="ps-cl-hflag ps-cl-hflag--none" title="Flag not available"></span>');
  const clPick = s => (CL.home === '*' || s.c === CL.home) && (CL.gen === 'b' || s.g === CL.gen);
  const clHeld = (s, k) => s.r[k] && (CL.held === 'ever' || s.r[k].cur);
  function clRows(k) {
    const L = D.positions.scholars.filter(s => clPick(s) && clHeld(s, k));
    const by = { cur: (a, b) => (b.r[k].cur - a.r[k].cur) || a.c.localeCompare(b.c) || a.n.localeCompare(b.n), name: (a, b) => a.n.localeCompare(b.n), country: (a, b) => nameOf(a.c).localeCompare(nameOf(b.c)) || a.n.localeCompare(b.n),
      recent: (a, b) => { const y = s => Math.max(0, ...(s.r[k].u || []).map(u => +(u[2] && s.r[k].cur ? 9999 : (u[4] || u[3] || 0)))); return y(b) - y(a) || a.n.localeCompare(b.n); } };
    return L.sort(by[CL.sort] || by.cur);
  }
  function clRowHtml(s, k, DM) {
    const e = s.r[k], U = roleUnis(e, CL.held), yrs = roleYears(e, U), d = DM.get(s.id);
    const name = d ? `<a href="#dir=${esc(s.id)}" title="Open this scholar's card in the Regional Scholar Directory">${esc(s.n)}</a>` : esc(s.n);
    const place = d && d.geo ? `<div class="ps-cl-place">${esc(d.geo)}</div>` : '';
    const uni = U.length ? `<div class="ps-cl-uni">${U.map(u => `${esc(u[0])}${u[1] ? ` <b>(${esc(u[1])})</b>` : ''}`).join('; ')}</div>` : '<div class="ps-cl-uni ps-cl-uni--na">Institution not recorded</div>';
    return `<li class="ps-cl-row">${flagRect(s.c)}<div class="ps-cl-who"><div class="ps-cl-nm">${name}${yrs ? `<span class="ps-cl-yrs">${esc(yrs)}</span>` : ''}</div>${place}${uni}</div><span class="ps-cl-pill ${e.cur ? 'cur' : 'for'}">${e.cur ? 'Current' : 'Former'}</span></li>`;
  }
  function setupCareerViews() {
    const P = D.positions; if (!P) return;
    const homes = countries().map(c => c.code).filter(posHas);
    const opts = '<option value="*">All countries</option>' + homes.map(c => `<option value="${c}">${esc(nameOf(c))}</option>`).join('');
    $('#ps-cl-home').innerHTML = opts; $('#ps-cw-home').innerHTML = opts;
    const seg = (id, obj, key, after) => { const bs = [...document.querySelectorAll(`#${id} button`)]; bs.forEach(b => b.addEventListener('click', () => { obj[key] = b.dataset.v; bs.forEach(x => x.setAttribute('aria-checked', String(x === b))); after(); })); };
    seg('ps-cl-cat', CL, 'cat', () => { CL.pos = null; CL.open.clear(); renderCList(); });
    seg('ps-cl-held', CL, 'held', renderCList); seg('ps-cl-gen', CL, 'gen', renderCList);
    seg('ps-cw-cat', CW, 'cat', () => { CW.uni = null; renderCWork(); }); seg('ps-cw-held', CW, 'held', () => { CW.uni = null; renderCWork(); }); seg('ps-cw-gen', CW, 'gen', () => { CW.uni = null; renderCWork(); });
    $('#ps-cl-home').addEventListener('change', e => { CL.home = e.target.value; renderCList(); });
    $('#ps-cl-sort').addEventListener('change', e => { CL.sort = e.target.value; renderCList(); });
    $('#ps-cw-home').addEventListener('change', e => { CW.home = e.target.value; CW.uni = null; renderCWork(); });
    $('#ps-cl-pos').addEventListener('click', e => {
      const b = e.target.closest('button[data-k]'); if (!b) return;
      const all = catKeys(CL.cat), cur = new Set(CL.pos || all);
      if (b.dataset.k === '*') { CL.pos = null; } else { cur.has(b.dataset.k) ? cur.delete(b.dataset.k) : cur.add(b.dataset.k); CL.pos = cur.size ? all.filter(k => cur.has(k)) : null; }
      renderCList();
    });
    $('#ps-cl-list').addEventListener('click', e => { const b = e.target.closest('button[data-more]'); if (!b) return; const k = b.dataset.more; CL.open.has(k) ? CL.open.delete(k) : CL.open.add(k); renderCList(); });
    $('#ps-cw-hosts').addEventListener('click', e => { const b = e.target.closest('button[data-h]'); if (b) { CW.host = b.dataset.h; CW.uni = null; CW.allUnis = false; renderCWork(); } const m = e.target.closest('button[data-allhosts]'); if (m) { CW.allHosts = !CW.allHosts; renderCWork(); } });
    $('#ps-cw-unis').addEventListener('click', e => { const r = e.target.closest('[data-u]'); if (r) { CW.uni = CW.uni === r.dataset.u ? null : r.dataset.u; renderCWork(); } const m = e.target.closest('button[data-allunis]'); if (m) { CW.allUnis = !CW.allUnis; renderCWork(); } });
    const flTip = (el, x, y) => {
      const tr = el.closest('tr[data-u]'); if (!tr || !CWLAST || !CW.host) return;
      const X = (CWLAST.H[CW.host] || { unis: {} }).unis[tr.dataset.u]; if (!X) return;
      const c = el.dataset.c, order = [...D.positions.lead, ...D.positions.rank].map(x => x[0]);
      const L = [...X.people.values()].filter(p => p.s.c === c).sort((a, b) => a.s.n.localeCompare(b.s.n));
      const li = L.map(({ s, roles }) => `<li>${esc(s.n)} <span class="ps-pos-tip__sep">|</span> <span class="ps-pos-tip__uni">${roles.slice().sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, e, U]) => { const y = roleYears(e, U); return esc(posLabel(k)) + (y ? ` <span class="ps-pos-tip__cc">(${esc(y)})</span>` : '') + (e.cur ? ' · current' : ''); }).join('; ')}</span></li>`);
      posTipAt(`<b>${esc(tr.dataset.u)}</b> · ${esc(nameOf(c))}<br>${L.length} scholar${L.length > 1 ? 's' : ''} from ${esc(nameOf(c))}${CW.held === 'cur' ? ' (current)' : ''}<ul>${li.slice(0, 14).join('')}${li.length > 14 ? `<li>and ${li.length - 14} more</li>` : ''}</ul>`, el, x, y);
    };
    $('#ps-cw-unis').addEventListener('mousemove', e => { const f = e.target.closest('.ps-cw-fl'); f ? flTip(f, e.clientX, e.clientY) : posTipHide(); });
    $('#ps-cw-unis').addEventListener('mouseleave', posTipHide);
    $('#ps-cw-unis').addEventListener('focusin', e => { const f = e.target.closest('.ps-cw-fl'); if (f) flTip(f); });
    $('#ps-cw-unis').addEventListener('focusout', posTipHide);
    $('#ps-cw-unis').addEventListener('keydown', e => { const r = e.target.closest('[data-u]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); } });
  }
  function clTiles() {
    const P = D.positions, LK = P.lead.map(x => x[0]);
    const S = P.scholars.filter(s => CL.home === '*' || s.c === CL.home);
    const who = CL.home === '*' ? 'Pacific scholars' : `scholars from ${nameOf(CL.home)}`;
    const has = k => S.filter(s => s.r[k]);
    const nC = L => new Set(L.map(s => s.c)).size;
    const leaders = S.filter(s => LK.some(k => s.r[k])), women = leaders.filter(s => s.g === 'f').length, gk = leaders.filter(s => s.g === 'f' || s.g === 'm').length;
    const hosts = new Set(S.flatMap(s => Object.values(s.r).flatMap(e => (e.u || []).map(u => u[1]).filter(Boolean))));
    const ch = has('chancellor'), vc = has('vc'), pf = has('prof');
    const from = L => CL.home === '*' ? `, from ${nC(L)} ${nC(L) === 1 ? 'country' : 'countries'}` : '';
    const T = [
      ['cap', '', fmt(leaders.length), `${who} have held a university leadership role`],
      ['inst', '', fmt(ch.length), `Chancellors / Pro-Chancellors${from(ch)}`],
      ['podium', '', fmt(vc.length), `Vice-Chancellors / Presidents (${vc.filter(s => s.r.vc.cur).length} serving now)`],
      ['group', '', fmt(pf.length), `Full Professors${from(pf)}`],
      ['woman', 'g', fmt(women), gk ? `of the ${fmt(leaders.length)} leaders are women (${Math.round(100 * women / leaders.length)}%)` : 'leaders are women (gender not recorded)'],
      ['globe', '', fmt(hosts.size), `countries where these scholars have held positions`]];
    $('#ps-cl-tiles').innerHTML = T.map(([ic, c, n, t]) => `<div class="ps-cl-tile ${c}">${svgI(ic, 'ic')}<div class="n">${n}</div><div class="t">${esc(t)}</div></div>`).join('');
  }
  function renderCList() {
    if (!D.positions || $('#ps-careers-panel').hidden || $('#ps-clist-panel').hidden) return;
    const all = catKeys(CL.cat), sel = new Set(CL.pos || all), DM = dirMap();
    $('#ps-cl-home').value = CL.home; $('#ps-cl-sort').value = CL.sort;
    $('#ps-cl-pos').innerHTML = `<button type="button" class="ps-cl-chip${CL.pos ? '' : ' on'}" data-k="*" aria-pressed="${!CL.pos}">All</button>` + all.map(k => `<button type="button" class="ps-cl-chip${CL.pos && sel.has(k) ? ' on' : ''}" data-k="${k}" aria-pressed="${!!(CL.pos && sel.has(k))}">${esc(posLabel(k))}</button>`).join('');
    clTiles();
    const MAX = 12; let shown = 0, gi = 0;
    const html = all.filter(k => sel.has(k)).map(k => {
      const L = clRows(k); if (!L.length) return '';
      shown += L.length;
      const open = CL.open.has(k), list = open ? L : L.slice(0, MAX), nc = new Set(L.map(s => s.c)).size, ncur = L.filter(s => s.r[k].cur).length;
      const tone = (gi++ % 2) ? 'green' : 'blue';
      return `<section class="ps-cl-grp ps-cl-grp--${tone}"><div class="ps-cl-ban"><span class="ps-cl-ban__ic">${svgI(POS_ICO[k] || 'cap')}</span><div><h3>${esc(posLabel(k))}</h3><p>${fmt(L.length)} scholar${L.length > 1 ? 's' : ''} <i>·</i> ${nc} home ${nc > 1 ? 'countries' : 'country'} <i>·</i> ${ncur} current</p></div></div><ul class="ps-cl-list">${list.map(s => clRowHtml(s, k, DM)).join('')}</ul>${L.length > MAX ? `<button type="button" class="ps-cl-more" data-more="${k}" aria-expanded="${open}">${open ? 'Show fewer <span aria-hidden="true">↑</span>' : `Show all ${fmt(L.length)} <span aria-hidden="true">→</span>`}</button>` : ''}</section>`;
    }).join('');
    $('#ps-cl-list').innerHTML = html || '<p class="ps-empty">No scholars match these filters.</p>';
    $('#ps-cl-note').textContent = 'Each scholar appears once under every selected position they have held. Years come from the Positions sheets where recorded ("Since" for current roles); no years are shown where none are recorded, including titles taken from scholar profiles. Home place (village, island or province) is shown where it is published in the Regional Scholar Directory. Names open the scholar\'s directory card. Leadership roles count only at universities and other higher-education institutions, and include acting appointments.';
  }
  function cwData() {
    const LK = new Set(D.positions.lead.map(x => x[0])), keys = new Set(catKeys(CW.cat));
    const H = {}, notRec = new Set();
    for (const s of D.positions.scholars) {
      if (!((CW.home === '*' || s.c === CW.home) && (CW.gen === 'b' || s.g === CW.gen))) continue;
      let any = false;
      for (const [k, e] of Object.entries(s.r)) {
        if (!keys.has(k) || !(CW.held === 'ever' || e.cur)) continue;
        const U = roleUnis(e, CW.held).filter(u => u[1]);
        if (!U.length) continue;
        any = true;
        for (const u of U) {
          const h = H[u[1]] = H[u[1]] || { sch: new Set(), lead: new Set(), unis: {} };
          h.sch.add(s.id); if (LK.has(k)) h.lead.add(s.id);
          const X = h.unis[u[0]] = h.unis[u[0]] || { sch: new Set(), lead: new Set(), home: {}, roles: {}, people: new Map() };
          if (!X.sch.has(s.id)) X.home[s.c] = (X.home[s.c] || 0) + 1;
          X.sch.add(s.id); if (LK.has(k)) X.lead.add(s.id); X.roles[k] = (X.roles[k] || 0) + 1;
          const pp = X.people.get(s.id) || { s, roles: [] }; pp.roles.push([k, e, [u]]); X.people.set(s.id, pp);
        }
      }
      if (!any && Object.entries(s.r).some(([k, e]) => keys.has(k) && (CW.held === 'ever' || e.cur))) notRec.add(s.id);
    }
    return { H, notRec };
  }
  let CWLAST = null;
  function renderCWork() {
    if (!D.positions || $('#ps-careers-panel').hidden || $('#ps-cwork-panel').hidden) return;
    $('#ps-cw-home').value = CW.home;
    const { H, notRec } = CWLAST = cwData(), order = [...D.positions.lead, ...D.positions.rank].map(x => x[0]), LK = new Set(D.positions.lead.map(x => x[0]));
    const hs = Object.entries(H).sort((a, b) => b[1].sch.size - a[1].sch.size || hostName(a[0]).localeCompare(hostName(b[0])));
    if (!hs.length) { $('#ps-cw-hosts').innerHTML = '<p class="ps-empty">No positions match these filters.</p>'; $('#ps-cw-unis').innerHTML = ''; return; }
    if (!CW.host || !H[CW.host]) CW.host = hs[0][0];
    const mx = hs[0][1].sch.size, LIM = 16, list = CW.allHosts ? hs : hs.slice(0, LIM);
    $('#ps-cw-hosts').innerHTML = `<div class="ps-cw-lbl">Countries where positions are held <span>(scholars · <i class="a"></i>any position <i class="l"></i>leadership)</span></div><div class="ps-cw-hl">` + list.map(([c, h]) => { const ni = Object.keys(h.unis).length; return `<button type="button" class="ps-cw-h${c === CW.host ? ' on' : ''}" data-h="${c}" aria-pressed="${c === CW.host}">${hostFlag(c)}<span class="ps-cw-hn"><b>${esc(hostName(c))}</b> <em>· ${ni} institution${ni > 1 ? 's' : ''}</em><span class="tr"><i style="width:${100 * h.sch.size / mx}%"></i></span><span class="tr l"><i style="width:${100 * h.lead.size / mx}%"></i></span></span><span class="ps-cw-n">${fmt(h.sch.size)}</span></button>`; }).join('') + '</div>' +
      (hs.length > LIM ? `<button type="button" class="ps-cl-more" data-allhosts="1" aria-expanded="${CW.allHosts}">${CW.allHosts ? 'Show fewer ▴' : `Show all ${hs.length} countries ▸`}</button>` : '') +
      (notRec.size ? `<p class="ps-cw-nr">Not recorded: ${fmt(notRec.size)} scholar${notRec.size > 1 ? 's' : ''} with no institution country (not ranked).</p>` : '');
    const h = H[CW.host], us = Object.entries(h.unis).sort((a, b) => b[1].sch.size - a[1].sch.size || a[0].localeCompare(b[0]));
    const ULIM = 10, ulist = CW.allUnis ? us : us.slice(0, ULIM);
    const rows = ulist.map(([u, X]) => {
      const open = CW.uni === u;
      let tr = `<tr class="ps-cw-u${open ? ' open' : ''}" data-u="${esc(u)}" tabindex="0" aria-expanded="${open}"><td><b>${esc(u)}</b></td><td class="num">${fmt(X.sch.size)}</td><td class="num">${X.lead.size ? fmt(X.lead.size) : '–'}</td><td>${Object.entries(X.home).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<span class="ps-cw-fl" data-c="${c}" tabindex="0" aria-label="${esc(nameOf(c))}: ${v} scholar${v > 1 ? 's' : ''}. Hover or focus to list them"><img src="img/regional/flags-rect/${c.toLowerCase()}.webp" alt="" width="33" height="22">${v}</span>`).join('')}</td><td>${order.filter(k => X.roles[k]).slice(0, 5).map(k => `<span class="ps-cw-rk${LK.has(k) ? ' l' : ''}">${esc(posLabel(k))} ${X.roles[k]}</span>`).join('')}</td></tr>`;
      if (open) {
        const DM = dirMap();
        const ppl = [...X.people.values()].sort((a, b) => a.s.n.localeCompare(b.s.n));
        tr += `<tr class="ps-cw-people"><td colspan="5"><ul>${ppl.map(({ s, roles }) => { const d = DM.get(s.id); const nm = d ? `<a href="#dir=${esc(s.id)}">${esc(s.n)}</a>` : esc(s.n); return `<li>${flagRect(s.c)}<span>${nm}${d && d.geo ? ` <em>${esc(d.geo)}</em>` : ''}<br>${roles.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, e, U]) => { const y = roleYears(e, U); return `${esc(posLabel(k))}${y ? ` (${esc(y)})` : ''}${e.cur ? ' · current' : ''}`; }).join('; ')}</span></li>`; }).join('')}</ul></td></tr>`;
      }
      return tr;
    }).join('');
    $('#ps-cw-unis').innerHTML = `<div class="ps-cw-lbl">${esc(hostName(CW.host))}: ${us.length} institution${us.length > 1 ? 's' : ''} · ${fmt(h.sch.size)} Pacific scholar${h.sch.size > 1 ? 's' : ''} · ${fmt(h.lead.size)} in leadership</div><table class="ps-cw-t"><thead><tr><th scope="col">University / institution</th><th scope="col">Scholars</th><th scope="col">Leaders</th><th scope="col">Home countries of scholars</th><th scope="col">Most senior roles held (count)</th></tr></thead><tbody>${rows}</tbody></table>` +
      (us.length > ULIM ? `<button type="button" class="ps-cl-more" data-allunis="1" aria-expanded="${CW.allUnis}">${CW.allUnis ? 'Show fewer ▴' : `Show all ${us.length} institutions ▸`}</button>` : '') + '<p class="ps-cw-hint">Click a university to list its scholars.</p>';
  }
  function posPick(s) { return POS.gen === 'b' || s.g === POS.gen; }
  function posHeld(s, k) { return s.r[k] && (POS.held === 'ever' || s.r[k].cur); }
  function posCell(k, c) { return D.positions.scholars.filter(s => (c === '*' || s.c === c) && posPick(s) && posHeld(s, k)); }
  function renderPositions() {
    if (!D.positions || $('#ps-careers-panel').hidden) return;
    if (state.sel !== POS.lastSel) {
      POS.lastSel = state.sel;
      POS.leadC = state.sel && posHas(state.sel) ? state.sel : '*';
      $('#ps-lead-country').value = POS.leadC;
    }
    if (state.sel !== CL.lastSel) { CL.lastSel = state.sel; CL.home = state.sel && posHas(state.sel) ? state.sel : '*'; CW.home = CL.home; CW.uni = null; }
    renderPosTable(); renderLead(); renderWhere(); renderRank(); renderCList(); renderCWork();
  }
  function renderPosTable() {
    const P = D.positions, C = countries().map(c => c.code);
    let h = '<thead><tr><th class="role" scope="col">Position</th>' + C.map(c => `<th scope="col" class="${posHas(c) ? '' : 'nodata'}${state.sel === c ? ' sel' : ''}"><img src="img/regional/flags-rect/${c.toLowerCase()}.webp" alt="" width="36" height="24">${esc(SHORT[c] || c)}</th>`).join('') + '<th scope="col" class="tot">Region</th></tr></thead><tbody>';
    // Column base for the shares: scholars in that column with any of these positions (same as the first footer row).
    const anyOf = c => P.scholars.filter(s => (c === '*' || s.c === c) && posPick(s) && Object.keys(s.r).some(k => posHeld(s, k))).length;
    const anyN = Object.fromEntries(['*', ...C].map(c => [c, posHas(c) || c === '*' ? anyOf(c) : 0]));
    for (const [grp, list] of [['University leadership', P.lead], ['Academic rank', P.rank]]) {
      h += `<tr class="grp"><th colspan="${C.length + 2}" scope="rowgroup"><div class="ps-hm-ban ps-hm-ban--${list === P.lead ? 'blue' : 'green'}"><span class="ps-hm-ban__ic">${svgI(list === P.lead ? 'inst' : 'cap')}</span><span class="ps-hm-ban__t">${grp}</span><span class="ps-hm-ban__fl" aria-hidden="true">${C.map(c => `<span class="ps-hm-ban__f${posHas(c) ? '' : ' nodata'}${state.sel === c ? ' sel' : ''}" data-c="${c}"><img src="img/regional/flags-rect/${c.toLowerCase()}.webp" alt="" width="30" height="20"><b>${esc(SHORT[c] || c)}</b></span>`).join('')}<span class="ps-hm-ban__f ps-hm-ban__f--tot" data-c="*"><b>Region</b></span></span></div></th></tr>`;
      for (const [k, l] of list) {
        const tot = posCell(k, '*').length;
        h += `<tr><th class="role" scope="row">${esc(l)}</th>` + C.map(c => {
          if (!posHas(c)) return '<td class="c nd"><span class="ps-sr">no records</span>·</td>';
          const n = posCell(k, c).length;
          const b = anyN[c], a = b ? n / b : 0, rc = bandCell(a);
          return `<td class="c${n ? '' : ' z'}${state.sel === c ? ' selcol' : ''}" data-k="${k}" data-c="${c}"${n ? ` tabindex="0" style="background:${rc.bg};color:${rc.fg}" aria-label="${esc(l)}, ${esc(nameOf(c))}: ${n} of ${b} (${Math.round(100 * a)}%)"` : ''}>${n ? `${Math.round(100 * a)}% <small>(${fmt(n)})</small>` : '–'}</td>`;
        }).join('') + `<td class="tot" data-k="${k}" data-c="*"${tot ? ' tabindex="0"' : ''}>${tot ? `${anyN['*'] ? Math.round(100 * tot / anyN['*']) : 0}% <small>(${fmt(tot)})</small>` : '0'}</td></tr>`;
      }
    }
    const any = c => anyN[c];
    // Footer shares: "Scholars with any of these" as a share of that column's roster; "Roster size" as a share of the regional roster.
    const rosterAll = countries().reduce((a, c) => a + c.scholars, 0);
    const pctOf = (n, d) => d ? `${Math.round(100 * n / d)}% <small>(${fmt(n)})</small>` : fmt(n);
    h += '</tbody><tfoot><tr class="ps-pt-any"><th class="role" scope="row">Scholars with any of these</th>' + C.map(c => `<td>${posHas(c) ? pctOf(any(c), byCode[c].scholars) : '·'}</td>`).join('') + `<td class="tot">${pctOf(any('*'), rosterAll)}</td></tr>`;
    h += '<tr class="ps-pt-roster"><th class="role" scope="row">Roster size</th>' + C.map(c => `<td>${pctOf(byCode[c].scholars, rosterAll)}</td>`).join('') + `<td class="tot">${pctOf(rosterAll, rosterAll)}</td></tr></tfoot>`;
    const t = $('#ps-pos-table'); t.innerHTML = h;
    placeBanFlags();
    if (!t._banRO && window.ResizeObserver) { t._banRO = new ResizeObserver(placeBanFlags); t._banRO.observe(t); }
    $('#ps-pos-tip').classList.remove('show');
  }
  // Line the banner flags up with the country columns of the heatmap header.
  function placeBanFlags() {
    const t = $('#ps-pos-table'); if (!t || !t.offsetWidth) return;
    // Measure a body row (the header row is collapsed): its cells after the role label line up with the country columns.
    const row = t.querySelector('tbody tr:not(.grp)'); if (!row) return;
    const cells = [...row.children].slice(1);
    $$('.ps-hm-ban', t).forEach(ban => {
      const b0 = ban.getBoundingClientRect().left;
      $$('.ps-hm-ban__f', ban).forEach((f, i) => { const th = cells[i]; if (!th) return; const r = th.getBoundingClientRect(); f.style.left = (r.left - b0) + 'px'; f.style.width = r.width + 'px'; });
    });
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
  function setupWorkHeat() {
    const box = $('#ps-work-heat-country');
    if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';
    const pop = box.querySelector('.ps-hm-countries__pop');
    const btn = box.querySelector('.ps-hm-countries__btn');
    const val = box.querySelector('.ps-hm-countries__val');
    const homeLabel = c => c.code === 'FSM' ? 'FSM' : c.name;
    pop.innerHTML = '<button type="button" class="ps-hm-uncheck" data-uncheck>Uncheck all</button><label><input type="checkbox" data-all checked> All home countries</label>' + countries().map(c => `<label><input type="checkbox" data-code="${c.code}" data-label="${esc(homeLabel(c))}" checked> ${esc(homeLabel(c))}</label>`).join('');
    const boxes = () => [...pop.querySelectorAll('input[data-code]')];
    const syncLabel = () => {
      const on = boxes().filter(b => b.checked);
      pop.querySelector('input[data-all]').checked = on.length === boxes().length;
      val.textContent = on.length === boxes().length ? 'All home countries' : on.length === 0 ? 'No home countries' : on.length <= 2 ? on.map(b => b.dataset.label).join(', ') : on.length + ' home countries';
    };
    pop.addEventListener('change', e => {
      if (e.target.dataset.all !== undefined) boxes().forEach(b => { b.checked = e.target.checked; });
      syncLabel();
      renderWorkHeat();
    });
    pop.addEventListener('click', e => {
      if (!e.target.closest('[data-uncheck]')) return;
      boxes().forEach(b => { b.checked = false; });
      pop.querySelector('input[data-all]').checked = false;
      syncLabel();
      renderWorkHeat();
    });
    $('#ps-work-heat-reset').addEventListener('click', () => {
      boxes().forEach(b => { b.checked = true; });
      syncLabel();
      setWorkUnknown('exclude');
      renderDest();
      $('#ps-work-heat-gender').querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x.dataset.v === 'all')));
      renderWorkHeat();
    });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', e => { if (!box.contains(e.target)) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    ['ps-work-heat-unknown', 'ps-work-heat-gender'].forEach(id => {
      $('#' + id).addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        $('#' + id).querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
        if (id === 'ps-work-heat-unknown') { setWorkUnknown(b.dataset.v); renderDest(); }
        renderWorkHeat();
      });
    });
  }

  // One "Not recorded" choice shared by the C1 Work map and Work matrix.
  function setWorkUnknown(v) {
    ['ps-dest-unknown', 'ps-work-heat-unknown'].forEach(id => {
      const g = $('#' + id);
      if (g) g.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x.dataset.v === v)));
    });
  }

  function renderWorkHeat() {
    const panel = $('#ps-work-heat');
    const host = $('#ps-work-heat-table');
    if (!panel || !host) return;
    const people = window.PSDirectory && window.PSDirectory.scholars ? window.PSDirectory.scholars() : null;
    if (!people || !people.length) { host.innerHTML = '<tbody><tr><td class="ps-hm-wait">Workplace records load with the Regional Scholar Directory…</td></tr></tbody>'; return; }
    const regions = ['Pacific', 'Australia', 'New Zealand', 'North America', 'Europe', 'Asia'];
    const exclude = ($('#ps-work-heat-unknown button[aria-checked="true"]') || {}).dataset.v !== 'include';
    const gender = ($('#ps-work-heat-gender button[aria-checked="true"]') || {}).dataset.v || 'all';
    const boxes = [...document.querySelectorAll('#ps-work-heat-country input[data-code]')];
    const picked = boxes.filter(b => b.checked).map(b => b.dataset.code);
    const allOn = !boxes.length || picked.length === boxes.length;
    const homes = countries().map(c => c.code).filter(c => allOn || picked.includes(c));
    const blank = () => Object.fromEntries([...regions, 'Unknown'].map(k => [k, 0]));
    const cnt = Object.fromEntries(countries().map(c => [c.code, blank()]));
    people.forEach(s => {
      if (!cnt[s.c] || (gender !== 'all' && s.g !== gender)) return;
      const r = s.wr && cnt[s.c][s.wr] !== undefined ? s.wr : 'Unknown';
      cnt[s.c][r] += 1;
    });
    const sum = codes => codes.reduce((bag, c) => {
      Object.keys(bag).forEach(k => { bag[k] += cnt[c][k]; });
      return bag;
    }, blank());
    const knownOf = bag => regions.reduce((a, k) => a + bag[k], 0);
    const shareCell = (n, t, who, region) => {
      const p = t ? Math.round(n / t * 100) : 0;
      // Same Reef scale as the C1 Study matrix: brighter = larger share of the row.
      const a = t ? n / t : 0, rc = reefCell(a);
      const bg = n ? rc.bg : 'rgba(255,255,255,.04)';
      const color = n ? rc.fg : '#eaf3fb';
      return `<td style="background:${bg};color:${color}" title="${esc(who)}: ${fmt(n)} of ${fmt(t)} with a workplace in this share (${p}%)">${n ? `${p}% <small>(${fmt(n)})</small>` : '—'}</td>`;
    };
    const missCell = (n, who) => `<td style="background:#424242;color:#fff" title="${esc(who)}: ${fmt(n)} with no recorded workplace, excluded from the share">${n ? fmt(n) : '—'}</td>`;
    const row = (name, bag, extra) => {
      const known = knownOf(bag);
      const total = known + bag.Unknown;
      const base = exclude ? known : total;
      const who = name.replace(/<[^>]+>/g, '');
      const miss = exclude ? missCell(bag.Unknown, who) : shareCell(bag.Unknown, base, who, 'Not recorded');
      return `<tr class="${extra || ''}"><th class="home" scope="row">${name}</th>${regions.map(k => shareCell(bag[k], base, who, k)).join('')}<td class="ps-hm-n" title="${fmt(base)} scholars used for the share">${fmt(base)}</td>${miss}</tr>`;
    };
    let html = `<thead><tr><th class="home" scope="col"><span class="ps-sr">Home country</span></th>${regions.map(k => `<th scope="col"><span>${esc(k)}</span></th>`).join('')}<th class="ps-hm-n" scope="col"><span>Scholars</span></th><th scope="col"><span>Not recorded</span></th></tr></thead><tbody>`;
    if (!homes.length) html += '<tr><td colspan="9">Choose at least one home country.</td></tr>';
    else {
      if (allOn) html += row('All countries', sum(homes), 'ps-hm-all');
      homes.forEach(c => {
        const n = knownOf(cnt[c]) + cnt[c].Unknown;
        if (!n) return;
        const name = `<img src="img/regional/flags/${c.toLowerCase()}.png" alt="">${esc(c === 'FSM' ? 'FSM' : nameOf(c))}`;
        html += row(name, cnt[c], state.sel === c ? 'sel' : '');
      });
    }
    host.innerHTML = html + '</tbody>';
    const missKey = $('#ps-work-heat-miss');
    if (missKey) missKey.hidden = !exclude;
    const note = $('#ps-work-heat-note');
    if (note) note.textContent = exclude
      ? 'Shares are of directory scholars with a known workplace. Not recorded is the last column and is not part of the share. Scholars is that known total.'
      : 'Shares include scholars whose workplace country is missing or not mapped. Scholars is the full total, and Not recorded is part of the share.';
  }

  function setupDest() {
    const home = $('#ps-dest-home');
    home.innerHTML = '<option value="">All home countries</option>' + countries().slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
    const decs = new Set(); countries().forEach(c => c.destinations.forEach(d => decs.add(d.dec)));
    $('#ps-dest-dec').innerHTML = '<option value="">All years</option>' + [...decs].filter(Boolean).sort().map(d => `<option value="${d}">${d}s</option>`).join('') + (decs.has(0) ? '<option value="0">Year not recorded</option>' : '');
    home.addEventListener('change', e => { state.destHome = e.target.value; if (state.destHome !== (state.sel || '')) { state.sel = state.destHome || null; writeUrl(); renderAll(); } else renderDest(); });
    $('#ps-dest-level').addEventListener('change', e => { state.destLevel = e.target.value; renderDest(); renderStudyMatrix(); });
    $('#ps-dest-dec').addEventListener('change', e => { state.destDec = e.target.value; renderDest(); renderStudyMatrix(); });
    $('#ps-dest-unknown').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      setWorkUnknown(b.dataset.v);
      renderDest();
      renderWorkHeat();
    });
  }
  // The Work matrix has its own home-country menu and Exclude/Include toggle, so hide the map's copies there.
  function syncDestFilters() {
    const bar = $('.ps-filters[data-pane-of="c1:study c1:work"]');
    if (bar) bar.hidden = state.destMode === 'work' && VIEW.c1d === 'matrix';
  }
  // Reef scale (deep water to lagoon to sunlit shallows) for the C1 Study and Work matrices; t = share of the row, 0 to 1.
  const REEF = [[22, 48, 79], [31, 95, 139], [21, 158, 138], [108, 206, 89], [244, 227, 74]];
  // Volcanic plum scale for heatmaps on a white background: dusky rose (small share) to deep plum (large share).
  const PLUM = [[194, 102, 122], [154, 63, 99], [113, 40, 83], [74, 26, 66], [38, 12, 38]];
  function plumCell(t) { return rampCell(PLUM, t); }
  // Sky-to-violet scale for the B2 Positions by country heatmap: light blue (small share) through lavender to deep purple (large share).
  const SKYV = [[214, 236, 251], [146, 192, 241], [176, 160, 238], [140, 84, 200], [100, 36, 130], [72, 18, 92]];
  function skyCell(t) { return rampCell(SKYV, t); }
  // Banded colours for the B2 heatmaps, chosen by the displayed (rounded) percentage.
  const BANDS = [[3, '#E2E5E9', '#0b1626'], [7, '#8CB9DC', '#0b1626'], [9, '#F4D35E', '#0b1626'], [14, '#E6A052', '#0b1626'], [24, '#C76C70', '#ffffff'], [Infinity, '#842D48', '#ffffff']];
  function bandCell(t) { const p = Math.round(100 * Math.max(0, t)); const [, bg, fg] = BANDS.find(([m]) => p <= m); return { bg, fg }; }
  function reefCell(t) { return rampCell(REEF, t); }
  function rampCell(R, t) {
    t = Math.max(0, Math.min(1, t)); const u = 0.08 + 0.92 * Math.pow(Math.min(t, 0.85) / 0.85, 0.6);
    const n = R.length - 1, i = Math.min(Math.floor(u * n), n - 1), f = u * n - i;
    const c = R[i].map((v, j) => Math.round(v + (R[i + 1][j] - v) * f));
    const lin = x => Math.pow(x / 255, 2.2), lum = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    return { bg: `rgb(${c.join(',')})`, fg: lum > 0.28 ? '#0b1626' : '#f3f6fa' };
  }
  function renderDest() {
    syncDestFilters();
    state.destHome = state.sel || state.destHome || '';
    if (state.sel === null && $('#ps-dest-home').value !== '' && !state.destHome) $('#ps-dest-home').value = '';
    $('#ps-dest-home').value = state.destHome;
    const work = state.destMode === 'work';
    $('#ps-dest-level').hidden = work;
    $('#ps-dest-dec').hidden = work;
    $('#ps-dest-unknown').hidden = !work;
    const excludeMissing = work && ($('#ps-dest-unknown button[aria-checked="true"]') || {}).dataset.v !== 'include';
    const regionName = k => (work && k === 'Unknown') ? 'Not recorded' : k;
    const scope = state.destHome ? [byCode[state.destHome]].filter(Boolean) : countries();
    const cnt = Object.fromEntries(DEST_ORDER.map(k => [k, 0]));
    const people = work && window.PSDirectory && window.PSDirectory.scholars ? window.PSDirectory.scholars() : null;
    if (work && people) {
      people.forEach(s => {
        if (state.destHome && s.c !== state.destHome) return;
        const r = s.wr && cnt[s.wr] !== undefined ? s.wr : 'Unknown';
        cnt[r] += 1;
      });
    } else if (!work) {
      scope.forEach(c => c.destinations.forEach(d => {
        if (state.destLevel !== 'all' && d.l !== state.destLevel) return;
        if (state.destDec !== '' && String(d.dec) !== state.destDec) return;
        cnt[d.r] = (cnt[d.r] || 0) + d.n;
      }));
    }
    const missing = work ? cnt.Unknown || 0 : 0;
    if (excludeMissing) cnt.Unknown = 0;
    const total = Object.values(cnt).reduce((a, b) => a + b, 0);
    const unresolvedCampus = work ? 0 : scope.reduce((a, c) => a + (((c.destinationCountries || {}).Pacific || {})['(country unresolved)'] || 0), 0);
    const host = $('#ps-world');
    if (!BM) { host.innerHTML = '<div class="ps-empty">World basemap unavailable.</div>'; }
    else {
      const Wd = BM.world;
      const shown = DEST_ORDER.filter(k => BUBBLE_AT[k] && cnt[k] > 0 && Math.round(cnt[k] / Math.max(total, 1) * 100) > 0);
      const maxv = Math.max(1, ...shown.map(k => cnt[k]));
      const share0 = k => total ? Math.round(cnt[k] / total * 100) : 0;
      const mix = (c, t, toward) => {
        const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
        const out = [0, 1, 2].map(i => Math.round(ch(c, i) + (ch(toward, i) - ch(c, i)) * t));
        return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
      };
      const grads = shown.map(k => {
        const c = DEST_COLOR[k], id = 'ps-bub-' + k.replace(/\s/g, '');
        return `<radialGradient id="${id}" cx="32%" cy="28%" r="74%"><stop offset="0%" stop-color="${mix(c, .7, '#ffffff')}"/><stop offset="18%" stop-color="${mix(c, .22, '#ffffff')}"/><stop offset="55%" stop-color="${c}"/><stop offset="100%" stop-color="${mix(c, .42, '#0a2744')}"/></radialGradient><radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%"><stop offset="68%" stop-color="${c}" stop-opacity="0"/><stop offset="80%" stop-color="${c}" stop-opacity=".7"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
      }).join('');
      const bubbles = shown.map(k => {
        const [x, y, side] = BUBBLE_AT[k];
        const r = 14 + 24 * Math.sqrt(cnt[k] / maxv);
        const id = 'ps-bub-' + k.replace(/\s/g, '');
        const p = share0(k);
        const lx = side === 'end' ? x - r - 12 : x + r + 12;
        const a1 = -2.55, a2 = -0.5, rr = r * 0.76;
        const x1 = x + rr * Math.cos(a1), y1 = y + rr * Math.sin(a1), x2 = x + rr * Math.cos(a2), y2 = y + rr * Math.sin(a2);
        const unit = work ? 'directory scholars' : 'completed degrees';
        return `<g class="ps-dnode"><circle cx="${x}" cy="${y}" r="${(r * 1.38).toFixed(1)}" fill="url(#${id}-glow)"/><circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="url(#${id})"/><path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A ${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="${Math.max(1.8, r * 0.16).toFixed(1)}" stroke-linecap="round"/><text class="ps-dnode__name" x="${lx.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="${side}">${esc(regionName(k))}</text><text class="ps-dnode__pct" x="${lx.toFixed(1)}" y="${(y + 22).toFixed(1)}" text-anchor="${side}" fill="${DEST_COLOR[k]}">${p}%</text><title>${esc(regionName(k))}: ${fmt(cnt[k])} of ${fmt(total)} ${unit} (${p}%)</title></g>`;
      }).join('');
      host.innerHTML = `<svg viewBox="0 0 ${Wd.w} ${Wd.h}" role="img" aria-label="${work ? 'Workplaces' : 'Study destinations'}: ${DEST_ORDER.map(k => `${regionName(k)} ${share0(k)}%`).join(', ')}"><defs>${grads}</defs><path d="${Wd.sphere}" fill="#082c52"/>${Wd.shapes.map(s => `<path class="ps-wland" d="${s.d}"/>`).join('')}${bubbles}</svg>`;
    }
    const share0 = k => total ? Math.round(cnt[k] / total * 100) : 0;
    const ranked = DEST_ORDER.filter(k => cnt[k] > 0).sort((a, b) => cnt[b] - cnt[a] || DEST_ORDER.indexOf(a) - DEST_ORDER.indexOf(b));
    const empty = work ? (people ? 'No directory scholars match these filters.' : 'Workplace records are still loading.') : 'No completed degrees match these filters.';
    const missRow = excludeMissing && missing ? `<li class="ps-dlist__miss"><span><i style="background:${DEST_COLOR.Unknown || '#6b7785'}"></i>Not recorded</span><b><span style="font-weight:400;color:var(--ps-text-muted)">${fmt(missing)}, not in the share</span></b></li>` : '';
    $('#ps-dlist').innerHTML = total ? ranked.map(k => `<li><span><i style="background:${DEST_COLOR[k]}"></i>${esc(regionName(k))}</span><b>${share0(k)}% <span style="font-weight:400;color:var(--ps-text-muted)">(${fmt(cnt[k])})</span></b></li>`).join('') + missRow : (missRow ? `<li>No directory scholars with a recorded workplace match these filters.</li>${missRow}` : `<li>${empty}</li>`);
    $('#ps-dest-note').innerHTML = work
      ? `${excludeMissing ? `Directory scholars with a recorded workplace (n = ${fmt(total)} of ${fmt(total + missing)}), counted once at their current workplace. Shares leave out the ${fmt(missing)} whose workplace is not recorded.` : `Directory scholars (n = ${fmt(total)}), counted once at their current workplace.`} Pacific = Pacific Island countries and territories; Australia and New Zealand are separate. United States includes Hawaiʻi. Not recorded means the workplace country is missing or not mapped to a region. This is the approved directory, so it is not the same total as the study degrees.`
      : `Completed degree records (n = ${fmt(total)}), by the awarding institution's country. Pacific = Pacific Island countries and territories; Australia and New Zealand are separate. United States includes Hawaiʻi; Guam is counted as Pacific.${unresolvedCampus ? ` ${fmt(unresolvedCampus)} USP degree${unresolvedCampus > 1 ? 's have' : ' has'} an unverified campus (counted as Pacific, country unresolved).` : ''}`;
  }

  // Study matrix: home country (rows) by study region (columns), completed degrees.
  function renderStudyMatrix() {
    const t = $('#ps-study-matrix'); if (!t || VIEW.c1 !== 'study' || VIEW.c1d !== 'matrix') return;
    const cols = DEST_ORDER.filter(k => countries().some(c => c.destinations.some(d => d.r === k)));
    const cnt = code => { const o = Object.fromEntries(cols.map(k => [k, 0])); byCode[code].destinations.forEach(d => { if (state.destLevel !== 'all' && d.l !== state.destLevel) return; if (state.destDec !== '' && String(d.dec) !== state.destDec) return; if (o[d.r] !== undefined) o[d.r] += d.n; }); return o; };
    const rows = countries().map(c => ({ c, o: cnt(c.code) })).map(r => ({ ...r, n: cols.reduce((a, k) => a + r.o[k], 0) })).filter(r => r.n);
    const all = Object.fromEntries(cols.map(k => [k, rows.reduce((a, r) => a + r.o[k], 0)])), nAll = rows.reduce((a, r) => a + r.n, 0);
    const lab = k => k === 'Unknown' ? 'Not recorded' : k;
    const cell = (v, n, who, k) => { const p = n ? Math.round(100 * v / n) : 0; const a = n ? v / n : 0, rc = reefCell(a); return `<td style="background:${v ? rc.bg : 'rgba(255,255,255,.04)'};color:${v ? rc.fg : '#eaf3fb'}" title="${esc(who)}: ${fmt(v)} of ${fmt(n)} degrees in ${esc(lab(k))} (${p}%)">${v ? `${p}% <small>(${fmt(v)})</small>` : '—'}</td>`; };
    t.innerHTML = `<thead><tr><th class="home" scope="col"><span class="ps-sr">Home country</span></th>${cols.map(k => `<th scope="col"><span>${esc(lab(k))}</span></th>`).join('')}<th scope="col" class="ps-hm-n"><span>Degrees</span></th></tr></thead><tbody>
      <tr class="ps-hm-all"><th class="home" scope="row">All countries</th>${cols.map(k => cell(all[k], nAll, 'All countries', k)).join('')}<td class="ps-hm-n">${fmt(nAll)}</td></tr>
      ${rows.map(r => `<tr class="${state.sel === r.c.code ? 'sel' : ''}"><th class="home" scope="row"><img src="img/regional/flags/${r.c.code.toLowerCase()}.png" alt="">${esc(r.c.code === 'FSM' ? 'FSM' : r.c.name)}</th>${cols.map(k => cell(r.o[k], r.n, r.c.name, k)).join('')}<td class="ps-hm-n">${fmt(r.n)}</td></tr>`).join('')}</tbody>`;
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
    if (which === 'about') show('About this Dashboard', `<p>The Regional Pacific Scholars Dashboard brings together eleven country scholarly databases led by Asst Prof Ron Vave (Center for Pacific Islands Studies, University of Hawaiʻi at Mānoa) with partner institutions across the region. It celebrates Indigenous Pacific scholars, their completed postgraduate degrees and their research.</p><p>All country databases are <strong>pre-launch, confidential project materials</strong>. This page shows aggregates and a minimal search index only; it never exposes raw Master files, contact details, geography, genealogy or unpublished notes. Country dashboards keep their own passcodes.</p><p>Data bundle generated ${esc(new Date(D.generated).toLocaleString())}. Timestamps show in your local time zone; the data are stored in UTC.</p>
      <h3>From learning to impact</h3><ol class="ps-steps ps-steps--dlg"><li>Postgraduate study</li><li>Research &amp; publication</li><li>Community &amp; policy impact</li><li>Stronger Pacific futures</li></ol>
      <p class="ps-quote">“Pacific knowledge for a resilient, healthy and prosperous ocean region.”</p><p>An illustrative pathway, not a measured outcome. This dashboard does not quantify impact.</p>`);
    if (which === 'cite') {
      const when = new Date(D.generated);
      const cite = `Vave, R. (${when.getFullYear()}). Regional Pacific Scholars Dashboard [Data dashboard, pre-launch; data built ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}]. Vave Lab, Center for Pacific Islands Studies, University of Hawaiʻi at Mānoa. ${location.origin}${location.pathname}`;
      show('Cite this Dashboard', `<p>Please cite the dashboard and the date of the data you used:</p><blockquote class="ps-cite" id="ps-cite-text">${esc(cite)}</blockquote><p><button type="button" class="ps-iconbtn ps-iconbtn--text" id="ps-cite-copy">Copy citation</button> <span id="ps-cite-msg" role="status"></span></p><p>Figures come from each country's Master file and can change after every refresh. Each country dashboard remains the authoritative record for its scholars.</p>`);
      $('#ps-cite-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(cite); $('#ps-cite-msg').textContent = 'Copied.'; } catch (e) { window.prompt('Copy this citation:', cite); } });
    }
    if (which === 'correct') {
      const live = countries().filter(c => c.dashboard);
      show('Suggest a Correction', `<p>This regional page only reads the country Master files, so corrections are made at the source and appear here after the next refresh.</p><ol><li><strong>For your own record</strong>, use your country dashboard's profile review (opened from your profile there).</li><li><strong>For another scholar's record, a missing publication or a wrong university</strong>, contact the curator of that country's database through the Vave Lab website.</li></ol><p>Country dashboards (each has its own passcode):</p><ul>${live.map(c => `<li><a href="${esc(c.dashboard)}" target="_blank" rel="noopener">${esc(c.name)} dashboard ↗</a></li>`).join('')}</ul><p>Countries without a live dashboard yet: ${esc(countries().filter(c => !c.dashboard).map(c => c.name).join(', '))}. Please write through the <a href="index.html" target="_blank" rel="noopener">Vave Lab website</a>.</p>`);
    }
    if (which === 'method') show('Methodology', `<h3>People and degrees</h3><ul><li><strong>Scholars</strong> — unique Scholar IDs on each country's included roster: Fiji excludes the Part-iTaukei roster; Tonga excludes retained profiles flagged “excluded from Indigenous Tongan counts”; Solomon Islands and Samoa require Inclusion Status = Included; the other countries require Identity Verification Status = Verified.</li><li><strong>Master's / PhDs</strong> — Graduate Degrees records whose stage is Master's or PhD/doctorate and whose completion status begins with “Completed” (or “Awarded”), held by an included scholar. Professional doctorates are counted with PhDs and reported separately. A person with both degrees counts once as a scholar and in both degree totals.</li><li>Regional scholar totals sum country rosters; a person recorded in two country databases has not yet been reconciled across countries.</li></ul><h3>Publications</h3><ul><li><strong>Country-indexed records</strong> — non-duplicate, non-excluded Publications rows in each country's headline categories (Journal Article, Master's Thesis, PhD Thesis, Book Chapter, Book; Fiji also includes Report, matching its six-category Master dashboard). Samoa uses V2 Inclusion Flag = Included.</li><li><strong>Indigenous-linked</strong> — records with an Authorship link to an included scholar.</li><li><strong>Regionally deduplicated</strong> — de-duplicated across countries by DOI, else normalised title + year.</li></ul><h3>Fields of Research</h3><p>Fiji, Tonga and Vanuatu only. Fiji and Tonga use the repository classifier (master_short_disciplines.py) that mirrors the Graduate Degrees Short Discipline formula; Vanuatu uses its own documented crosswalk (vanuatu-dashboard-model.js). The eight categories are: ${D.disciplineCategories.map(esc).join('; ')}. Unmapped records are reported as Unknown / unmapped.</p><h3>Study destinations</h3><p>Awarding institution's recorded country. Pacific = Pacific Island countries and territories (including Guam and New Caledonia), excluding Australia and New Zealand. USP records without a verified campus are counted as Pacific with country unresolved. Unknown locations are shown separately.</p><h3>Workplaces</h3><p>Panel C1 Work and Panel B2 count each directory scholar once, at the current workplace country. It is not the same population as the study-degree counts. A missing or unmapped workplace country is shown as Not recorded. Panel B2's default share excludes those scholars; Scholars is then the known-workplace total, and Not recorded is a separate grey column.</p>`);
    if (which === 'coverage') show('Data Coverage & Notes', `${sourceTable()}<h3>Reconciliation with 5 October 2026</h3>${reconTable()}<h3>Curation stage</h3><p>Tuvalu, Kiribati, Palau, Cook Islands, Marshall Islands, Federated States of Micronesia and Samoa are at an early curation stage. Their publication tables were re-initialised after 5 October and authorship links are still sparse, so Indigenous-linked publication counts are provisional. Gender is not yet recorded for many Samoa and Marshall Islands scholars.</p>`);
  }
  function openProv(which) {
    const base = `<p>Source: ${D.sources.filter(s => s.file).length} country Master files (Google Sheets, read-only), bundle generated ${esc(new Date(D.generated).toLocaleString())} by <code>scripts/build_regional_scholars.py</code>.</p>`;
    const map = {
      map: ['Map — provenance', base + '<p>Scholars sheet (included roster) and Graduate Degrees sheet. Marker locations are national capitals (positions only). Basemap: Natural Earth via world-atlas (public domain), 1:10m for Pacific Island countries.</p>'],
      degrees: ['Regional Postgraduate Degrees — provenance', base + '<p>Graduate Degrees: Degree Stage/Level + Completion Status, linked to included Scholar IDs. Duplicate Degree IDs are counted once.</p>'],
      outputs: ['Research Outputs — provenance', base + '<p>Publications sheet (Year, Publication Type, DOI, Title) and Authorship sheet (Scholar ID ↔ Publication ID). Year series counts regionally deduplicated Indigenous-linked records by publication year.</p>'],
      bars: ['Graduate Degrees by Country — provenance', base + '<p>Same counts as the country strip and the map.</p>'],
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

  // Scale the header contents with the screen width (1 at 2560px and wider) so
  // the canoes, sails and people stay clear of the text and the Sea of Islands
  // bar on laptops. Below 1240px the stacked header layout is left unchanged.
  function fitHero() {
    const w = window.innerWidth;
    const z = w > 1240 ? Math.min(1, w / 2560) : 1;
    document.documentElement.style.setProperty('--ps-hz', z.toFixed(4));
  }
  fitHero();
  window.addEventListener('resize', fitHero);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGate); else initGate();
})();
