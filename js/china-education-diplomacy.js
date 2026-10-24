/* China Education Diplomacy · Pacific Scholars Dashboard (china-education-diplomacy.html)
 * Authored for Vave Lab, 2026. Visual language follows the Regional Pacific
 * Scholars Dashboard (css/pacific-scholars.css).
 *
 * Data flow: data/china-education-diplomacy.json.enc (IVAV v1:
 * magic|salt16|iv12|AES-GCM) is fetched, decrypted in the browser with a
 * PBKDF2-SHA256 (200k) key derived from the passcode, and rendered.
 * The bundle is built from the research Project's data tables (report v1.1);
 * it is read-only against the country Master files.
 *
 * Counting rules carried from the research brief:
 *  - verified series = mainland-PRC postgraduate episodes counted_in_baseline
 *  - Taiwan is a separate comparator series, never pooled
 *  - official reported totals are a separate series, never summed
 *  - review-queue candidates are never counted
 *  - every percentage states its denominator
 */
(function () {
  'use strict';

  const ENC_URL = 'data/china-education-diplomacy.json.enc';
  const COLORS = {
    FJI: '#2f86d6', TON: '#e0464f', SLB: '#14a99a', VUT: '#e9a40f', WSM: '#3a63d8', FSM: '#7b4fd8',
    KIR: '#13a9c4', MHL: '#d93a7a', TUV: '#22a663', COK: '#a463e6', PLW: '#ef7d1a',
  };
  const CARD_NAME = { FSM: 'FSM', SLB: 'Solomon Islands', MHL: 'Marshall Islands', COK: 'Cook Islands' };
  const CARD_LONG = { SLB: 1, MHL: 1 };
  const CARD_FOCUS = { FJI: '40% 50%', TON: '50% 45%', VUT: '45% 55%', SLB: '45% 60%', WSM: '50% 22%', COK: '45% 25%', MHL: '30% 50%', FSM: '55% 45%', TUV: '50% 50%', KIR: '25% 35%', PLW: '50% 60%' };
  const MAP_IMG = { src: 'img/regional/pacific-map.webp', w: 2400, h: 1891 };
  const MAP_ANCHOR = { PLW: [454, 478, 'r'], FSM: [774, 320, 'r'], MHL: [1433, 422, 'r'], KIR: [1783, 596, 'r'], SLB: [1127, 776, 'r'], TUV: [1606, 800, 'r'], WSM: [1844, 907, 'r'], FJI: [1358, 967, 'r'], TON: [1567, 1221, 'r'], COK: [2138, 1253, 'r'], VUT: [749, 1023, 'l'] };
  const METRICS = {
    people: { label: 'PRC scholars', unit: 'scholars (verified series)', def: 'PRC scholars = people with a mainland-PRC postgraduate study episode in the verified series (Master files, cut-off 24 Oct 2026).' },
    completed: { label: 'Verified completions', unit: 'verified completions', def: 'Verified completions = degrees with a conferral, commencement or thesis record. Self-reported and unverified completions are excluded.' },
    candidates: { label: 'Candidates', unit: 'review-queue candidates (not counted)', def: 'Review-queue candidates = possible scholars awaiting eligibility checks. They are not counted in the verified series.' },
    taiwan: { label: 'Taiwan episodes', unit: 'Taiwan study episodes (separate series)', def: 'Taiwan episodes = Taiwan-hosted study recorded in the Master files. A separate comparator series, never pooled with PRC study.' },
  };
  const STATUS = {
    completed_verified: { label: 'Completed (verified)', c: '#3fd0a0' },
    completed_self_reported: { label: 'Completed (self-reported)', c: '#f3c45a' },
    completed_unverified_lead: { label: 'Unverified lead', c: '#f08a5d' },
    completion_unresolved: { label: 'Completion unresolved', c: '#9fb3c8' },
    in_progress: { label: 'In progress', c: '#5aa9f0' },
  };
  const FUND = {
    confirmed_recipient_specific: { label: 'Confirmed (recipient-specific)', c: '#3fd0a0' },
    probable_group_statement: { label: 'Probable (scholarship named; funder in group statement or context)', short: 'Probable', c: '#f3c45a' },
    not_stated: { label: 'Not stated', c: '#5e7690' },
  };
  const LAYER = { master_core: 'Master core roster', master_other_roster: 'Master other roster', master_review_queue: 'Existing review queue', proposed_candidate: 'New candidate (provisional ID)' };
  const SECTOR_C = ['#19b5c4', '#f0a42b', '#3b5fbf', '#e4553f', '#6fb04a', '#8e5bc7', '#18a39a'];
  const DISC_C = ['#6fb04a', '#f0a42b', '#1f9ec9', '#e4553f', '#3b5fbf', '#8e5bc7', '#18a39a', '#c6c33a', '#9fb3c8'];
  const ICONS = {
    people: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M1.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5zM12 20c.3-2.4 1.5-4.4 3.4-5.6.2 0 .4-.1.6-.1 3.6 0 6.5 2.9 6.5 5.7z"/></svg>',
    cap: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3L1 9l11 6 9-4.9V17h2V9z"/><path d="M5 13.2V17c2 2 12 2 14 0v-3.8L12 17z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/></svg>',
    queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/><path d="M20.2 18.2L22 20"/></svg>',
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const uniq = a => [...new Set(a)];
  const yr = s => { const m = String(s || '').match(/(19|20)\d{2}/); return m ? +m[0] : null; };
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const links = s => {
    const urls = String(s || '').match(/https?:\/\/[^\s;|,]+/g);
    if (!urls) return s ? `<span class="ce-muted">${esc(s)}</span>` : '<span class="ce-muted">—</span>';
    return urls.map((u, i) => { let h = u; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch (e) {} return `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(h)}${urls.length > 1 ? ' ' + (i + 1) : ''}</a>`; }).join('<br>');
  };
  const pill = (map, key) => { const m = map[key] || { label: key || 'Unknown', c: '#5e7690' }; return `<span class="ce-badge" style="--b:${m.c}">${esc(m.short || m.label)}</span>`; };

  // ================= GATE =================
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decryptBundle(pass) {
    const res = await fetch(ENC_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch');
    const buf = new Uint8Array(await res.arrayBuffer());
    const key = await deriveKey(pass, buf.slice(4, 20));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(20, 32) }, key, buf.slice(32));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function setupGate() {
    const form = $('#ps-gate-form'), err = $('#ps-gate-err');
    $('#ps-pass').focus();
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = 'Decrypting…';
      try {
        const data = await decryptBundle($('#ps-pass').value);
        $('#ps-gate').hidden = true; err.textContent = '';
        init(data);
      } catch (x) { err.textContent = x.message === 'fetch' ? 'Could not load the data file. Check your connection and try again.' : 'That passcode did not unlock the dashboard.'; }
    });
  }

  // ================= STATE / DERIVED =================
  const state = { metric: 'people', sel: null, a4: 'all', mapView: null };
  const VIEW = { a2: 'map', b2: 'people', b3: 'uni', c1: 'careers', c2: 'totals', e: 'cand', f: 'heat' };
  let D, S, C = [], byCode = {}, PEOPLE = {}, PRC, BASE, QUEUE, TW, DISC;
  const nameOf = c => (byCode[c] ? byCode[c].country : c);
  const inSel = r => !state.sel || r.iso3 === state.sel;

  function derive() {
    S = D.summary;
    PEOPLE = Object.fromEntries(D.scholars.map(p => [p.person_id, p]));
    PRC = D.study_episodes.filter(e => e.host_jurisdiction === 'PRC');
    BASE = PRC.filter(e => e.counted_in_baseline === 'True');
    QUEUE = PRC.filter(e => e.counted_in_baseline !== 'True');
    TW = D.study_episodes.filter(e => e.host_jurisdiction === 'Taiwan');
    DISC = Object.fromEntries(D.discipline_crosswalk.map(d => [d.field_as_recorded, d.report_discipline_group]));
    const statusOf = Object.fromEntries(D.coverage_statements.map(s => [s.iso3, s]));
    C = D.country_subregion_crosswalk.map(c => {
      const b = BASE.filter(e => e.iso3 === c.iso3);
      const comp = b.filter(e => e.completion === 'completed_verified');
      return {
        ...c, code: c.iso3,
        people: uniq(b.map(e => e.person_id)).length,
        episodes: b.length,
        completed: comp.length,
        masters: comp.filter(e => e.degree_level === "Master's").length,
        doct: comp.filter(e => e.degree_level !== "Master's").length,
        confirmed: uniq(b.map(e => e.person_id)).filter(p => D.person_funding[p] === 'confirmed_recipient_specific').length,
        candidates: uniq(QUEUE.filter(e => e.iso3 === c.iso3).map(e => e.person_id)).length,
        taiwan: TW.filter(e => e.iso3 === c.iso3).length,
        coverage: statusOf[c.iso3] || {},
      };
    });
    byCode = Object.fromEntries(C.map(c => [c.code, c]));
    // Integrity checks against the report summary (fail loudly, never silently).
    const check = (a, b, what) => { if (a !== b) console.error('CEDP integrity check failed:', what, a, '!=', b); };
    check(uniq(BASE.map(e => e.person_id)).length, S.people_baseline, 'people');
    check(BASE.filter(e => e.completion === 'completed_verified').length, S.completed_verified, 'completions');
    check(TW.length, S.taiwan_episodes, 'taiwan episodes');
  }
  const sorted = () => C.slice().sort((a, b) => (b[state.metric] - a[state.metric]) || a.country.localeCompare(b.country));

  // ================= INIT =================
  function init(data) {
    D = data; derive();
    const p = new URLSearchParams(location.search);
    if (p.get('country') && byCode[p.get('country')]) state.sel = p.get('country');
    if (METRICS[p.get('metric')]) state.metric = p.get('metric');
    $('#ps-fresh').textContent = `Built from ${D.master_inventory.length} country Master files · snapshots ${D.meta.snapshots}`;
    renderKpis(); setupMenu(); setupViews(); setupMetric(); setupMap(); setupStatic(); setupDirectory();
    $('#ps-chip-clear').addEventListener('click', () => select(null));
    renderAll(true);
  }
  function renderAll(first) {
    renderStrip(first); renderMap(); renderBars(); renderTable(); renderA3(); renderA4(); renderB1(); renderB2(); renderB3(); renderC1(); renderDirectory();
    const chip = $('#ps-chip');
    chip.classList.toggle('is-on', !!state.sel);
    $('#ps-chip-text').textContent = state.sel ? `Showing ${nameOf(state.sel)}` : '';
    $('#ps-metric-def').textContent = METRICS[state.metric].def;
    const sp = new URLSearchParams(location.search);
    state.sel ? sp.set('country', state.sel) : sp.delete('country');
    state.metric === 'people' ? sp.delete('metric') : sp.set('metric', state.metric);
    const qs = sp.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  function select(code) { state.sel = code && state.sel !== code ? code : null; renderAll(); }

  // ================= KPIs =================
  function renderKpis() {
    const fp = S.funding_person;
    const items = [
      [ICONS.globe, `${C.filter(c => c.people).length}<small>/11</small>`, 'Countries with verified scholars'],
      [ICONS.people, S.people_baseline, 'PRC postgraduate scholars'],
      [ICONS.cap, S.completed_verified, 'Verified completions'],
      [ICONS.coin, `${fp.confirmed_recipient_specific}<small>/${S.people_baseline}</small>`, 'Confirmed PRC funding'],
      [ICONS.queue, S.new_candidates + S.rq_existing, 'Candidates in review (not counted)'],
    ];
    $('#ps-kpis').innerHTML = items.map(([i, v, l]) => `<div class="ps-kpi">${i}<dt class="ps-sr">${esc(l)}</dt><dd class="ps-kpi__dd"><span class="ps-kpi__v">${v}</span><span class="ps-kpi__l">${esc(l)}</span></dd></div>`).join('');
  }

  // ================= PANEL MENU =================
  function setupMenu() {
    const nav = $('#ps-pmenu'), strip = $('#ps-pmenu-pills'), drop = $('#ps-pmenu-drop');
    const GROUPS = { A: 'Overview', B: 'Study & funding', C: 'After study & context', D: 'Directory', E: 'Review queue', F: 'Coverage & audit' };
    const panels = $$('section[data-panel]');
    panels.forEach(el => { if (!el.id) el.id = 'panel-' + el.dataset.panel.toLowerCase(); });
    let opened = null;
    const close = () => { if (opened) opened.setAttribute('aria-expanded', 'false'); drop.hidden = true; opened = null; };
    const jump = (e, el) => {
      if (e) e.preventDefault(); close();
      const top = window.scrollY + el.getBoundingClientRect().top - nav.getBoundingClientRect().height - 50;
      window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    Object.keys(GROUPS).forEach(g => {
      const members = panels.filter(el => el.dataset.panel[0] === g);
      if (!members.length) return;
      let b;
      if (members.length === 1) {
        b = document.createElement('a'); b.href = '#' + members[0].id; b.className = 'ps-pmenu__pill';
        b.textContent = GROUPS[g]; b.addEventListener('click', e => jump(e, members[0]));
      } else {
        b = document.createElement('button'); b.type = 'button'; b.className = 'ps-pmenu__pill';
        b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-haspopup', 'true');
        b.innerHTML = `Panel ${g} <span aria-hidden="true">▾</span>`; b.title = GROUPS[g];
        b.addEventListener('click', () => {
          if (opened === b) return close();
          close(); opened = b; b.setAttribute('aria-expanded', 'true');
          drop.innerHTML = `<div class="ps-pmenu__head">Panel ${g} · ${esc(GROUPS[g])}</div>`;
          members.forEach(el => { const a = document.createElement('a'); a.href = '#' + el.id; a.textContent = `${el.dataset.panel} · ${el.dataset.panelTitle}`; a.addEventListener('click', e => jump(e, el)); drop.appendChild(a); });
          const r = b.getBoundingClientRect(), bar = nav.getBoundingClientRect(), w = Math.min(340, innerWidth - 24);
          drop.style.width = w + 'px'; drop.style.left = (Math.max(12, Math.min(r.left, innerWidth - w - 12)) - bar.left) + 'px'; drop.style.top = (r.bottom + 6 - bar.top) + 'px';
          drop.hidden = false;
        });
      }
      strip.appendChild(b);
    });
    document.addEventListener('click', e => { if (opened && !nav.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.addEventListener('scroll', () => { nav.classList.toggle('is-stuck', nav.getBoundingClientRect().top <= 0); close(); }, { passive: true });
  }

  // ================= VIEWS =================
  function setupViews() {
    $$('[data-views]').forEach(tl => $$('button[data-view]', tl).forEach(b => b.addEventListener('click', () => { VIEW[tl.dataset.views] = b.dataset.view; applyViews(); })));
    applyViews();
  }
  function applyViews() {
    $$('[data-pane]').forEach(el => { el.hidden = !el.dataset.pane.split(/\s+/).some(t => { const [k, v] = t.split(':'); return VIEW[k] === v; }); });
    $$('[data-views]').forEach(tl => $$('button[data-view]', tl).forEach(b => { const on = VIEW[tl.dataset.views] === b.dataset.view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }));
    renderMapSub();
  }
  function setupMetric() {
    $$('#ps-metric button').forEach(b => b.addEventListener('click', () => {
      state.metric = b.dataset.metric;
      $$('#ps-metric button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      renderAll();
    }));
    $$('#ps-metric button').forEach(x => x.setAttribute('aria-checked', String(x.dataset.metric === state.metric)));
  }

  // ================= A1 COUNTRY CARDS =================
  function renderStrip(first) {
    const ol = $('#ps-strip');
    const prev = new Map($$('.ps-card', ol).map(el => [el.dataset.code, el.getBoundingClientRect()]));
    const m = METRICS[state.metric];
    const LINES = { people: c => `${c.people} PRC scholars`, completed: c => `${c.completed} verified`, candidates: c => `${c.candidates} candidates`, taiwan: c => `${c.taiwan} Taiwan` };
    ol.innerHTML = sorted().map((c, i) => {
      const v = c[state.metric];
      const sub = ['people', 'completed', 'candidates'].filter(k => k !== state.metric).map(k => `<span>${LINES[k](c)}</span>`).join('');
      const btn = c.people
        ? `<button type="button" class="ps-card__btn" data-go="dir" data-code="${c.code}">View scholars<span aria-hidden="true">→</span></button>`
        : `<button type="button" class="ps-card__btn ps-card__btn--off ce-card__note" data-go="notes" data-code="${c.code}">Coverage note</button>`;
      return `<li class="ps-card${state.sel === c.code ? ' is-selected' : ''}${state.sel && state.sel !== c.code ? ' is-dim' : ''}" data-code="${c.code}" style="--c:${COLORS[c.code]}">
        <div class="ps-card__name${CARD_LONG[c.code] ? ' ps-card__name--long' : ''}" style="--img:url('${new URL('img/regional/' + c.code.toLowerCase() + '.webp', document.baseURI).href}')">${esc(CARD_NAME[c.code] || c.country)}</div>
        <img class="ps-card__flag" src="img/regional/flags-rect/${c.code.toLowerCase()}.webp" alt="" width="240" height="120" loading="${i < 6 ? 'eager' : 'lazy'}" />
        <img class="ps-card__photo" src="img/regional/${c.code.toLowerCase()}.webp" alt="" width="240" height="142" style="object-position:${CARD_FOCUS[c.code] || 'center'}" loading="${i < 6 ? 'eager' : 'lazy'}" />
        <div class="ps-card__body">
          <button type="button" class="ps-card__sel" aria-pressed="${state.sel === c.code}" aria-label="${esc(c.country)}: ${v} ${esc(m.unit)}. ${state.sel === c.code ? 'Selected; activate to clear filter' : 'Activate to filter dashboard'}">
            ${state.metric === 'completed' ? ICONS.cap : state.metric === 'candidates' ? ICONS.queue : ICONS.people}<span class="ps-card__vl"><span class="ps-card__v">${v}</span><span class="ps-card__l">${esc(m.label)}</span></span>
          </button>
          <div class="ps-card__sub">${sub}</div>
          <div class="ce-card__rel">${esc(c.m49_subregion)} · relations: ${c.relations_at_cutoff === 'PRC' ? 'PRC' : 'Taiwan'}</div>
          ${btn}
        </div></li>`;
    }).join('');
    $$('.ps-card__sel', ol).forEach(b => b.addEventListener('click', () => select(b.closest('.ps-card').dataset.code)));
    $$('[data-go]', ol).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.go === 'dir') { state.sel = b.dataset.code; renderAll(); scrollToPanel('D'); }
      else { VIEW.f = 'notes'; applyViews(); const el = document.getElementById('ce-note-' + b.dataset.code); scrollToPanel('F'); if (el) { el.open = true; } }
    }));
    if (!first && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $$('.ps-card', ol).forEach(el => {
        const p = prev.get(el.dataset.code); if (!p) return;
        const dx = p.left - el.getBoundingClientRect().left; if (!dx) return;
        el.style.transition = 'none'; el.style.transform = `translateX(${dx}px)`;
        requestAnimationFrame(() => { el.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)'; el.style.transform = ''; });
      });
    }
  }
  function scrollToPanel(code) {
    const el = $(`section[data-panel="${code}"]`); if (!el) return;
    const top = window.scrollY + el.getBoundingClientRect().top - $('#ps-pmenu').getBoundingClientRect().height - 50;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // ================= A2 MAP / CHART / TABLE =================
  let mapSvg, mk = {};
  function setupMap() {
    const host = $('#ps-map'), W = MAP_IMG.w, H = MAP_IMG.h;
    mapSvg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Map of the Pacific with the selected number beside each country' });
    const img = svgEl('image', { href: MAP_IMG.src, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'xMidYMid meet' });
    img.setAttribute('aria-hidden', 'true'); mapSvg.appendChild(img);
    const mg = svgEl('g');
    C.forEach(c => {
      const a = MAP_ANCHOR[c.code]; if (!a) return;
      const g = svgEl('g', { class: 'ps-mk', tabindex: '0', role: 'button', 'data-code': c.code });
      const pillR = svgEl('rect', { class: 'ps-mk__pill', rx: 31, ry: 31, height: 64, stroke: COLORS[c.code] });
      const label = svgEl('text', { class: 'ps-mk__n', 'dominant-baseline': 'central' });
      g.append(pillR, label);
      g.addEventListener('click', () => select(c.code));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.code); } });
      g.addEventListener('pointerenter', e => showTip(e, mapTip(c)));
      g.addEventListener('pointermove', moveTip);
      g.addEventListener('pointerleave', hideTip);
      mk[c.code] = { g, pill: pillR, label, a };
      mg.appendChild(g);
    });
    mapSvg.appendChild(mg); host.prepend(mapSvg); setView([0, 0, W, H]);
    $$('[data-zoom]', host).forEach(b => b.addEventListener('click', () => zoom(b.dataset.zoom)));
    let drag = null;
    mapSvg.addEventListener('pointerdown', e => { if (e.target.closest('.ps-mk')) return; drag = { x: e.clientX, y: e.clientY, v: state.mapView.slice() }; mapSvg.setPointerCapture(e.pointerId); });
    mapSvg.addEventListener('pointermove', e => { if (!drag) return; const k = Math.max(drag.v[2] / mapSvg.clientWidth, drag.v[3] / mapSvg.clientHeight); setView([drag.v[0] - (e.clientX - drag.x) * k, drag.v[1] - (e.clientY - drag.y) * k, drag.v[2], drag.v[3]]); });
    const end = () => { drag = null; };
    mapSvg.addEventListener('pointerup', end); mapSvg.addEventListener('pointercancel', end);
  }
  function setView(v) {
    const W = MAP_IMG.w, H = MAP_IMG.h;
    v[2] = Math.max(W / 6, Math.min(W, v[2])); v[3] = v[2] * H / W;
    v[0] = Math.max(0, Math.min(W - v[2], v[0])); v[1] = Math.max(0, Math.min(H - v[3], v[1]));
    state.mapView = v; mapSvg.setAttribute('viewBox', v.map(n => n.toFixed(1)).join(' '));
  }
  function zoom(dir) {
    const W = MAP_IMG.w, H = MAP_IMG.h, v = state.mapView;
    if (dir === 'reset') return setView([0, 0, W, H]);
    const f = dir === 'in' ? 0.7 : 1 / 0.7, cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2, w = v[2] * f;
    setView([cx - w / 2, cy - (w * H / W) / 2, w, w * H / W]);
  }
  function mapTip(c) {
    return `<b>${esc(c.country)}</b>${c.people} PRC scholars (verified series)<br>${c.completed} verified completions · ${c.confirmed} confirmed PRC funding<br>${c.candidates} review-queue candidates (not counted)<br>${c.taiwan} Taiwan episodes (separate series)<br><span style="color:#4a5d78">Relations at cut-off: ${c.relations_at_cutoff === 'PRC' ? 'PRC' : 'Taiwan'}. Click to filter.</span>`;
  }
  function renderMapSub() {
    const m = METRICS[state.metric];
    $('#ps-map-sub').textContent = VIEW.a2 === 'table' ? 'Every country in one table. Select a name to filter.' : VIEW.a2 === 'chart' ? `Number of ${m.unit} by country. Select a bar to filter.` : `Number of ${m.unit} beside each country. Select a number to filter.`;
  }
  function renderMap() {
    const m = METRICS[state.metric];
    C.forEach(c => {
      const o = mk[c.code]; if (!o) return;
      const txt = String(c[state.metric]);
      o.label.textContent = txt;
      const w = 31 * txt.length + 36, x = o.a[2] === 'l' ? o.a[0] - 14 - w : o.a[0] + 14;
      o.pill.setAttribute('x', x); o.pill.setAttribute('y', o.a[1] - 32); o.pill.setAttribute('width', w);
      o.label.setAttribute('x', x + w / 2); o.label.setAttribute('y', o.a[1] + 2); o.label.setAttribute('text-anchor', 'middle');
      o.g.setAttribute('aria-label', `${c.country}: ${txt} ${m.unit}.`);
      o.g.classList.toggle('is-selected', state.sel === c.code);
      o.g.classList.toggle('is-dim', !!state.sel && state.sel !== c.code);
      o.g.classList.toggle('ce-mk--zero', !c[state.metric]);
    });
    renderMapSub();
    $('#ps-map-note').textContent = state.metric === 'taiwan'
      ? 'Taiwan comparator series. These numbers are never added to the PRC counts.'
      : state.metric === 'candidates' ? 'Candidates are awaiting eligibility checks and are not counted in any total.'
      : 'Numbers are people or degrees from the verified series (mainland PRC only). A zero means none was verified by the cut-off, not that none exists.';
  }
  function hbars(el, rows, opts = {}) {
    const max = Math.max(1, ...rows.map(r => r.v));
    el.innerHTML = rows.map(r => `<${opts.click ? 'button type="button"' : 'div'} class="ce-hbar${r.sel ? ' is-selected' : ''}${r.dim ? ' is-dim' : ''}" ${r.code ? `data-code="${r.code}"` : ''} ${opts.click ? `aria-label="${esc(r.label)}: ${r.v}"` : ''}>
      <span class="ce-hbar__l">${esc(r.label)}</span>
      <span class="ce-hbar__t"><span class="ce-hbar__f" style="width:${(r.v / max) * 100}%;background:${r.c || '#19b5c4'}"></span></span>
      <span class="ce-hbar__v">${r.v}${r.extra ? ` <small>${esc(r.extra)}</small>` : ''}</span></${opts.click ? 'button' : 'div'}>`).join('') || '<p class="ce-muted">No records match.</p>';
    if (opts.click) $$('[data-code]', el).forEach(b => b.addEventListener('click', () => select(b.dataset.code)));
  }
  function renderBars() {
    hbars($('#ce-a2-bars'), sorted().map(c => ({ label: c.country, v: c[state.metric], c: COLORS[c.code], code: c.code, sel: state.sel === c.code, dim: state.sel && state.sel !== c.code })), { click: true });
  }
  function renderTable() {
    const groups = ['Melanesia', 'Micronesia', 'Polynesia'];
    let h = '<table class="ps-table"><caption>Countries grouped by UN M49 subregion · cut-off 24 Oct 2026</caption><thead><tr><th scope="col">Country</th><th scope="col">Relations at cut-off</th><th scope="col">PRC scholars</th><th scope="col">Verified completions</th><th scope="col">Confirmed PRC funding</th><th scope="col">Candidates (not counted)</th><th scope="col">Taiwan episodes (separate)</th></tr></thead><tbody>';
    groups.forEach(g => {
      const rows = C.filter(c => c.m49_subregion === g);
      h += `<tr class="ce-grp"><th colspan="7" scope="rowgroup">${g}</th></tr>`;
      h += rows.map(c => `<tr${state.sel === c.code ? ' class="is-sel"' : ''}><th scope="row"><button class="ps-prov" type="button" data-sel="${c.code}">${esc(c.country)}</button></th><td>${c.relations_at_cutoff === 'PRC' ? 'PRC' : 'Taiwan'}</td><td>${c.people}</td><td>${c.completed}</td><td>${c.confirmed}</td><td>${c.candidates}</td><td>${c.taiwan}</td></tr>`).join('');
    });
    const t = k => C.reduce((a, c) => a + c[k], 0);
    h += `<tr class="ce-tot"><th scope="row">Total</th><td></td><td>${t('people')}</td><td>${t('completed')}</td><td>${t('confirmed')}</td><td>${t('candidates')}</td><td>${t('taiwan')}</td></tr></tbody></table>`;
    const el = $('#ps-map-table'); el.innerHTML = h;
    $$('[data-sel]', el).forEach(b => b.addEventListener('click', () => select(b.dataset.sel)));
  }

  // ================= A3 COMPLETION =================
  function renderA3() {
    const eps = BASE.filter(inSel);
    const n = eps.length;
    const counts = Object.keys(STATUS).map(k => ({ k, n: eps.filter(e => e.completion === k).length }));
    const comp = eps.filter(e => e.completion === 'completed_verified');
    const ms = comp.filter(e => e.degree_level === "Master's").length, dc = comp.length - ms;
    const R = 54, L = 2 * Math.PI * R; let off = 0;
    const arcs = counts.filter(c => c.n).map(c => { const len = (c.n / n) * L; const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${STATUS[c.k].c}" stroke-width="20" stroke-dasharray="${len} ${L - len}" stroke-dashoffset="${-off}"/>`; off += len; return s; }).join('');
    $('#ce-a3-sub').textContent = `${n} study episode${n === 1 ? '' : 's'} in the verified series${state.sel ? ' for ' + nameOf(state.sel) : ''} · denominator = ${n} · cut-off 24 Oct 2026`;
    $('#ce-a3').innerHTML = n ? `
      <div class="ps-ring" role="img" aria-label="${comp.length} of ${n} episodes verified complete">
        <svg viewBox="0 0 140 140">${arcs}</svg>
        <div class="ps-ring__c"><div class="ps-ring__v">${comp.length}<small>/${n}</small></div><div class="ps-ring__l">Verified completions</div></div>
      </div>
      <div class="ce-a3__right">
        <div class="ps-degcards ce-degcards">
          <div class="ps-degcard">${ICONS.cap}<div><div class="ps-degcard__v">${ms}</div><div class="ps-degcard__l">Verified Master's</div></div></div>
          <div class="ps-degcard ps-degcard--phd">${ICONS.cap}<div><div class="ps-degcard__v">${dc}</div><div class="ps-degcard__l">Verified doctorates</div></div></div>
        </div>
        <ul class="ce-stacklegend">${counts.map(c => `<li><i style="background:${STATUS[c.k].c}"></i>${esc(STATUS[c.k].label)} <b>${c.n}</b> <span class="ce-muted">(${pct(c.n, n)}% of ${n})</span></li>`).join('')}</ul>
      </div>` : '<p class="ce-empty">No verified-series episodes for this country by the cut-off.</p>';
  }

  // ================= A4 FIELDS =================
  function renderA4() {
    let eps = BASE.filter(inSel);
    if (state.a4 !== 'all') eps = eps.filter(e => (state.a4 === 'Doctorate' ? e.degree_level !== "Master's" : e.degree_level === state.a4));
    const by = {};
    eps.forEach(e => { const g = DISC[e.field] || 'Unknown'; by[g] = (by[g] || 0) + 1; });
    const groups = Object.keys(by).sort((a, b) => (a === 'Unknown') - (b === 'Unknown') || by[b] - by[a]);
    $('#ce-a4-sub').textContent = `${eps.length} episode${eps.length === 1 ? '' : 's'} (verified series${state.sel ? ', ' + nameOf(state.sel) : ''}) · shares use ${eps.length} as denominator`;
    hbars($('#ce-a4'), groups.map((g, i) => ({ label: g, v: by[g], c: g === 'Unknown' ? '#9fb3c8' : DISC_C[i % DISC_C.length], extra: `${pct(by[g], eps.length)}%` })));
  }

  // ================= B1 TIMELINE =================
  function renderB1() {
    const eps = BASE.filter(inSel).map(e => ({ ...e, s: yr(e.start_year), f: yr(e.end_or_completion_year) }))
      .sort((a, b) => ((a.s || a.f || 9999) - (b.s || b.f || 9999)) || a.name.localeCompare(b.name));
    const Y0 = 2010, Y1 = 2027, span = Y1 - Y0;
    const x = y => ((y - Y0) / span) * 100;
    $('#ce-b1-sub').textContent = `${eps.length} episodes in the verified series${state.sel ? ' for ' + nameOf(state.sel) : ''}, ordered by start year.`;
    $('#ce-b1-legend').innerHTML = Object.keys(STATUS).map(k => `<span><i style="background:${STATUS[k].c}"></i>${esc(STATUS[k].label)}</span>`).join('');
    const ticks = []; for (let y = Y0; y <= Y1; y += 1) ticks.push(y);
    $('#ce-b1').innerHTML = `<div class="ce-tl__axis"><span></span><div class="ce-tl__ticks">${ticks.map(y => `<span style="left:${x(y)}%" class="${y % 5 ? 'ce-minor' : ''}">${y % 5 ? '' : y}</span>`).join('')}<span class="ce-tl__cutlab" style="left:${x(2026 + 9.8 / 12)}%">cut-off</span></div></div>` +
      eps.map(e => {
        const c = STATUS[e.completion].c;
        const CUT = 2026 + 9.8 / 12;
        const s = e.s || e.f, f = e.f || (e.completion === 'in_progress' ? CUT - 1 : e.s);
        const bar = s && f && f > s ? `<span class="ce-tl__bar" style="left:${x(s)}%;width:${Math.min(x(f + 1), x(CUT)) - x(s)}%;background:${c}"></span>` : (s ? `<span class="ce-tl__dot" style="left:${x(s + 0.5)}%;background:${c}"></span>` : '');
        const open = e.completion === 'in_progress' || (!e.f && e.s) ? '<span class="ce-muted"> → open</span>' : '';
        return `<div class="ce-tl__row" tabindex="0" aria-label="${esc(e.name)}, ${esc(e.qualification)}, ${esc(e.university)}, ${e.s || '?'} to ${e.f || '?'}, ${esc(STATUS[e.completion].label)}">
          <span class="ce-tl__name"><i style="background:${COLORS[e.iso3]}"></i>${esc(e.name)}<small>${esc(e.iso3)} · ${esc(e.degree_level)} · ${e.s || '?'}–${e.f || '?'}${open}</small></span>
          <span class="ce-tl__track"><span class="ce-tl__cut" style="left:${x(CUT)}%"></span>${bar}</span></div>`;
      }).join('');
  }

  // ================= B2 FUNDING =================
  function renderB2() {
    const people = uniq(BASE.filter(inSel).map(e => e.person_id));
    const n = people.length;
    const entries = Object.keys(FUND).map(k => ({ k, n: people.filter(p => D.person_funding[p] === k).length }));
    $('#ce-b2-sub').textContent = `Strongest funding evidence for each person · ${n} people in the verified series${state.sel ? ' (' + nameOf(state.sel) + ')' : ''} · denominator = ${n}`;
    $('#ce-b2-stack').innerHTML = entries.filter(e => e.n).map(e => `<span class="ce-stack__seg" style="flex:${e.n};background:${FUND[e.k].c}" title="${esc(FUND[e.k].label)}: ${e.n} of ${n}">${e.n}</span>`).join('');
    $('#ce-b2-stack').setAttribute('role', 'img');
    $('#ce-b2-stack').setAttribute('aria-label', entries.map(e => `${FUND[e.k].label}: ${e.n} of ${n}`).join('; '));
    $('#ce-b2-legend').innerHTML = entries.map(e => `<li><i style="background:${FUND[e.k].c}"></i>${esc(FUND[e.k].label)} <b>${e.n}</b> <span class="ce-muted">(${pct(e.n, n)}% of ${n})</span></li>`).join('');
    renderB2Table();
  }
  function renderB2Table() {
    const layer = $('#ce-b2-layer').value;
    const rows = D.funding_episodes.filter(r => (!layer || r.layer === layer) && (!state.sel || (PEOPLE[r.person_id] || {}).iso3 === state.sel));
    $('#ce-b2-table').innerHTML = `<table class="ps-table ce-table"><caption>${rows.length} funding records${layer ? ' · ' + (layer === 'baseline' ? 'verified series' : 'candidates, not counted') : ''}</caption><thead><tr><th>Person</th><th>Scheme</th><th>Funder</th><th>Evidence</th><th>Source</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc((PEOPLE[r.person_id] || {}).name || r.person_id)}<small class="ce-id">${esc(r.person_id)}</small></td><td>${esc(r.scheme)}</td><td>${esc(r.funder)}<small class="ce-id">${esc(r.funder_jurisdiction)}</small></td><td>${pill(FUND, r.evidence_status)}${r.note ? `<small class="ce-note2">${esc(r.note)}</small>` : ''}</td><td>${links(r.evidence_url)}</td></tr>`).join('')}</tbody></table>`;
  }

  // ================= B3 UNIVERSITIES =================
  function renderB3() {
    const eps = BASE.filter(inSel);
    const by = {};
    eps.forEach(e => { const u = e.university || 'Not recorded'; (by[u] = by[u] || { u, city: e.city, n: 0, done: 0, iso: new Set(), lv: new Set() }); by[u].n++; if (e.completion === 'completed_verified') by[u].done++; by[u].iso.add(e.iso3); by[u].lv.add(e.degree_level); if (!by[u].city && e.city) by[u].city = e.city; });
    const rows = Object.values(by).sort((a, b) => b.n - a.n || a.u.localeCompare(b.u));
    $('#ce-b3-sub').textContent = `${rows.length} host institutions for ${eps.length} episodes (verified series${state.sel ? ', ' + nameOf(state.sel) : ''}).`;
    $('#ce-b3-uni').innerHTML = `<table class="ps-table ce-table"><thead><tr><th>University (as recorded)</th><th>City</th><th>Episodes</th><th>Verified completions</th><th>Home countries</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.u)}<small class="ce-id">${esc([...r.lv].join(', '))}</small></td><td>${esc(r.city || '—')}</td><td>${r.n}</td><td>${r.done}</td><td>${[...r.iso].map(i => `<span class="ce-cc" style="--c:${COLORS[i]}">${i}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table>`;
  }

  // ================= C1 CAREERS =================
  function renderC1() {
    const basePeople = new Set(BASE.filter(inSel).map(e => e.person_id));
    const emp = D.employment.filter(r => r.layer === 'baseline' && basePeople.has(r.person_id));
    const withEv = uniq(emp.map(r => r.person_id)).length;
    const by = {};
    emp.forEach(r => { (by[r.sector] = by[r.sector] || new Set()).add(r.person_id); });
    const secs = Object.keys(by).sort((a, b) => by[b].size - by[a].size);
    $('#ce-c1-sub').textContent = `Employment evidence found for ${withEv} of ${basePeople.size} people (verified series${state.sel ? ', ' + nameOf(state.sel) : ''}). Bars count people per sector; one person can appear in more than one.`;
    hbars($('#ce-c1-bars'), secs.map((s, i) => ({ label: s, v: by[s].size, c: SECTOR_C[i % SECTOR_C.length] })));
    $('#ce-c1-table').innerHTML = emp.length ? `<table class="ps-table ce-table"><thead><tr><th>Person</th><th>Role</th><th>Organisation</th><th>When</th><th>Source</th></tr></thead><tbody>${emp.map(r => `<tr><td>${esc((PEOPLE[r.person_id] || {}).name || r.person_id)}</td><td>${esc(r.role)}</td><td>${esc(r.organisation)}<small class="ce-id">${esc(r.sector)}</small></td><td>${esc(r.timing)}<small class="ce-id">Confidence: ${esc(r.confidence)}</small></td><td>${links(r.evidence_url)}</td></tr>`).join('')}</tbody></table>` : '';
    const outs = D.research_outputs.filter(r => basePeople.has(r.person_id));
    $('#ce-c1-out').innerHTML = `<p class="ps-sub">${outs.length} thesis or research-output record${outs.length === 1 ? '' : 's'} linked to the verified series.</p>` + (outs.length ? `<table class="ps-table ce-table"><thead><tr><th>Person</th><th>Type</th><th>Title</th><th>Year</th><th>Institution</th><th>Evidence</th></tr></thead><tbody>${outs.map(r => `<tr><td>${esc((PEOPLE[r.person_id] || {}).name || r.person_id)}</td><td>${esc(r.type)}</td><td class="ce-wrap">${esc(r.title)}</td><td>${esc(r.year)}</td><td>${esc(r.institution)}</td><td>${links(r.evidence)}</td></tr>`).join('')}</tbody></table>` : '');
  }

  // ================= STATIC PANELS (C2, C3, E, F) =================
  function setupStatic() {
    // C2
    const scopes = uniq(D.official_reported_totals.map(r => r.scope_iso3));
    const scopeName = s => (s === 'REG' ? 'Regional (all Pacific)' : nameOf(s));
    $('#ce-c2-scope').innerHTML = '<option value="">All scopes</option>' + scopes.map(s => `<option value="${s}">${esc(scopeName(s))}</option>`).join('');
    const metrics = uniq(D.official_reported_totals.map(r => r.metric_type)).sort();
    const mName = m => m.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    $('#ce-c2-metric').innerHTML = '<option value="">All measures</option>' + metrics.map(m => `<option value="${m}">${esc(mName(m))}</option>`).join('');
    const c2 = () => {
      const sc = $('#ce-c2-scope').value, me = $('#ce-c2-metric').value;
      const rows = D.official_reported_totals.filter(r => (!sc || r.scope_iso3 === sc) && (!me || r.metric_type === me));
      $('#ce-c2-table').innerHTML = `<table class="ps-table ce-table"><caption>${rows.length} official figures · each shown as published · never summed</caption><thead><tr><th>Scope</th><th>Measure</th><th>Figure</th><th>Period</th><th>Publisher</th><th>Source</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(scopeName(r.scope_iso3))}</td><td>${esc(mName(r.metric_type))}</td><td class="ce-fig">${esc(r.value)} <small>${esc(r.unit)}</small></td><td>${esc(r.period)}<small class="ce-id">published ${esc(r.date_published)}</small></td><td>${esc(r.publisher)}</td><td>${links(r.source_url)}</td></tr>`).join('')}</tbody></table>`;
    };
    $('#ce-c2-scope').addEventListener('change', c2); $('#ce-c2-metric').addEventListener('change', c2); c2();
    $('#ce-c2-chron').innerHTML = `<ol class="ce-chron">${D.policy_chronology.map(r => `<li><span class="ce-chron__y">${esc(r.year)}</span><div><b>${esc(r.scope)}</b> ${esc(r.event)}<div>${links(r.source_url)}</div></div></li>`).join('')}</ol>`;
    $('#ce-c2-ptn').innerHTML = `<table class="ps-table ce-table"><thead><tr><th>Pacific party</th><th>Chinese party</th><th>Type</th><th>Dates</th><th>Source</th></tr></thead><tbody>${D.partnership_register.map(r => `<tr><td>${esc(r.pacific_party)}<small class="ce-id">${esc(r.iso3)}</small></td><td>${esc(r.chinese_party)}</td><td class="ce-wrap">${esc(r.type)}</td><td>${esc(r.dates)}</td><td>${links(r.source_url)}</td></tr>`).join('')}</tbody></table>`;
    $('#ce-b3-prog').innerHTML = `<table class="ps-table ce-table"><caption>${D.programme_register.length} programmes · funder jurisdiction shown separately; Taiwan programmes are not PRC programmes</caption><thead><tr><th>Programme</th><th>Funder</th><th>Levels</th><th>Benefits</th><th>Countries seen</th><th>Source</th></tr></thead><tbody>${D.programme_register.map(r => `<tr><td>${esc(r.programme)}<small class="ce-id">${esc(r.administrator)}</small></td><td><span class="ce-badge" style="--b:${r.funder_jurisdiction === 'Taiwan' ? '#c98a3a' : '#19b5c4'}">${esc(r.funder_jurisdiction)}</span></td><td>${esc(r.levels)}</td><td class="ce-wrap">${esc(r.benefits)}</td><td>${esc(r.countries_seen)}</td><td>${links(r.source_url)}</td></tr>`).join('')}</tbody></table>`;

    // C3 Taiwan
    const tby = {}; TW.forEach(e => { tby[e.iso3] = (tby[e.iso3] || 0) + 1; });
    const twPeople = uniq(TW.map(e => e.person_id)).length;
    $('#ce-c3-sub').textContent = `${TW.length} Taiwan study episodes for ${twPeople} people, from the Master files. Denominator for this panel only = ${TW.length} episodes.`;
    hbars($('#ce-c3-bars'), Object.keys(tby).sort((a, b) => tby[b] - tby[a]).map(k => ({ label: nameOf(k), v: tby[k], c: '#c98a3a' })));
    $('#ce-c3-table').innerHTML = `<table class="ps-table ce-table"><thead><tr><th>Record ID</th><th>Country</th><th>Degree</th><th>Qualification</th><th>University</th><th>Year</th><th>Completion</th></tr></thead><tbody>${TW.map(e => `<tr><td><code>${esc(e.episode_id)}</code><small class="ce-id">${esc(e.person_id)}</small></td><td>${esc(e.iso3)}</td><td>${esc(e.degree_level)}</td><td>${esc(e.qualification)}</td><td>${esc(e.university)}</td><td>${esc(e.end_or_completion_year || '—')}</td><td>${pill(STATUS, e.completion)}</td></tr>`).join('')}</tbody></table>`;

    // E Review queue
    const q = D.sources_and_review_queue;
    $('#ce-e-cand').innerHTML = `<table class="ps-table ce-table"><caption>${q.length} candidates (${S.new_candidates} new with provisional IDs, ${S.rq_existing} already in country review queues) · not counted</caption><thead><tr><th>ID</th><th>Name</th><th>Country</th><th>Layer</th><th>Episodes</th><th>Identity note</th><th>Status</th></tr></thead><tbody>${q.map(r => `<tr><td><code>${esc(r.person_id)}</code></td><td>${esc(r.name)}</td><td>${esc(nameOf(r.iso3))}</td><td>${esc(LAYER[r.record_layer] || r.record_layer)}</td><td>${esc(r.n_episodes)}</td><td class="ce-wrap">${esc(r.identity_note)}</td><td class="ce-wrap">${esc(r.queue_status)}</td></tr>`).join('')}</tbody></table>`;
    $('#ce-e-pu').innerHTML = `<table class="ps-table ce-table"><caption>${D.proposed_db_updates.length} proposed Master updates · all “PROPOSED – not applied”</caption><thead><tr><th>ID</th><th>Country</th><th>Record</th><th>Field</th><th>Current value</th><th>Proposed</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>${D.proposed_db_updates.map(r => `<tr><td><code>${esc(r.update_id)}</code></td><td>${esc(r.iso3)}</td><td><code>${esc(r.record_id)}</code><small class="ce-id">${esc(r.worksheet)}</small></td><td>${esc(r.field)}</td><td class="ce-wrap">${esc(r.current_value)}</td><td class="ce-wrap">${esc(r.proposed_value)}</td><td class="ce-wrap">${esc(r.confidence)}</td><td>${links(r.evidence_url)}</td></tr>`).join('')}</tbody></table>`;
    $('#ce-e-unres').innerHTML = `<table class="ps-table ce-table"><caption>${D.unresolved_identities.length} unresolved identities · nationality and heritage are not inferred from names</caption><thead><tr><th>ID</th><th>Country</th><th>Description</th><th>Issue</th><th>Evidence</th></tr></thead><tbody>${D.unresolved_identities.map(r => `<tr><td><code>${esc(r.unresolved_id)}</code></td><td>${esc(r.iso3)}</td><td class="ce-wrap">${esc(r.description)}</td><td class="ce-wrap">${esc(r.issue)}</td><td>${links(r.evidence_url)}</td></tr>`).join('')}</tbody></table>`;

    // F coverage heatmap (Reef: navy → teal/green → yellow)
    const cols = Object.keys(D.coverage_matrix[0]).filter(k => k !== 'iso3' && k !== 'subregion');
    const vmax = Math.max(1, ...D.coverage_matrix.flatMap(r => cols.map(k => +r[k] || 0)));
    const reef = v => { if (!v) return 'transparent'; const t = Math.min(1, v / vmax); const stops = [[10, 45, 82], [25, 181, 196], [61, 206, 110], [243, 214, 90]]; const p = t * 3, i = Math.min(2, Math.floor(p)), f = p - i; const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * f)); return `rgb(${c.join(',')})`; };
    let h = `<table class="ps-table ce-heat"><thead><tr><th>Country</th>${cols.map(k => `<th scope="col">${esc(k.replace(' (Master)', ''))}</th>`).join('')}</tr></thead><tbody>`;
    ['Melanesia', 'Micronesia', 'Polynesia'].forEach(g => {
      h += `<tr class="ce-grp"><th colspan="${cols.length + 1}">${g}</th></tr>`;
      D.coverage_matrix.filter(r => r.subregion === g).forEach(r => { h += `<tr><th scope="row">${esc(nameOf(r.iso3))}</th>${cols.map(k => { const v = +r[k] || 0; return `<td style="background:${reef(v)};color:${v / vmax > 0.6 ? '#031327' : '#fff'}">${v || ''}</td>`; }).join('')}</tr>`; });
    });
    $('#ce-f-heat').innerHTML = h + '</tbody></table>';
    $('#ce-f-notes').innerHTML = D.coverage_statements.map(s => `<details class="ce-note" id="ce-note-${esc(s.iso3)}"><summary><span class="ce-cc" style="--c:${COLORS[s.iso3] || '#5e7690'}">${esc(s.iso3)}</span> <b>${esc(s.country)}</b> <span class="ce-muted">${esc(s.subregion)} · ${esc(s.status)}</span></summary><p>${esc(s.coverage_statement)}</p></details>`).join('');
    const audit = [
      ['Research cut-off', `${D.meta.cutoff} (24 October 2026) · report v${D.meta.version}`],
      ['Master files read', `${D.master_inventory.length} countries · ${S.worksheets} worksheets · ${S.rows.toLocaleString('en-US')} rows · snapshots ${D.meta.snapshots} · read-only`],
      ['Web research', `${S.searches} searches · ${S.fetches} page reads`],
      ['Verified series', `${S.people_baseline} people / ${S.episodes_baseline} mainland-PRC postgraduate episodes (${S.people_core} on core rosters)`],
      ['Completions', `${S.completed_verified} verified (${S.completed_masters} Master's, ${S.completed_doct} doctorates); 1 self-reported; 1 unverified lead; 1 unresolved; 1 in progress`],
      ['Funding (by person, of 20)', `${S.funding_person.confirmed_recipient_specific} confirmed · ${S.funding_person.probable_group_statement} probable · ${S.funding_person.not_stated} not stated`],
      ['Taiwan comparator', `${S.taiwan_episodes} episodes / ${S.taiwan_people} people · coded separately, never pooled`],
      ['Review queue', `${S.new_candidates} new candidates (${S.new_candidate_episodes} episodes) + ${S.rq_existing} existing · ${S.proposed_updates} proposed updates · ${S.unresolved} unresolved identities · none applied`],
    ];
    const rules = [
      'Hong Kong, Macao and Taiwan are coded separately from mainland PRC.',
      'Official reported totals are a separate series and are never summed with verified counts.',
      'A course participant is never counted as a degree graduate.',
      'Chinese funding needs recipient-specific evidence; an award is never labelled Belt and Road solely because it is after 2013.',
      'Heritage, gender and nationality are not inferred from names or photographs.',
      'No scholar is ranked by presumed allegiance and no composite influence score is made.',
      'Countries are grouped by UN M49 subregion; every percentage states its denominator and scope.',
      'Nothing on this page changes the country Master files.',
    ];
    $('#ce-f-audit').innerHTML = `<dl class="ce-dl">${audit.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><h3 class="ps-h3">Research rules applied</h3><ul class="ce-rules">${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;

    // A4 level + B2 layer
    $$('#ce-a4-level button').forEach(b => b.addEventListener('click', () => { state.a4 = b.dataset.lv; $$('#ce-a4-level button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderA4(); }));
    $('#ce-b2-layer').addEventListener('change', renderB2Table);
  }

  // ================= D DIRECTORY =================
  function setupDirectory() {
    $('#ce-d-country').innerHTML = '<option value="">All countries</option>' + C.map(c => `<option value="${c.code}">${esc(c.country)}</option>`).join('');
    $('#ce-d-comp').innerHTML = '<option value="">All</option>' + Object.keys(STATUS).map(k => `<option value="${k}">${esc(STATUS[k].label)}</option>`).join('');
    ['#ce-d-q', '#ce-d-layer', '#ce-d-comp', '#ce-d-deg'].forEach(s => $(s).addEventListener('input', renderDirectory));
    $('#ce-d-country').addEventListener('input', () => { state.sel = $('#ce-d-country').value || null; renderAll(); });
    $('#ce-d-reset').addEventListener('click', () => { $('#ce-d-q').value = ''; $('#ce-d-layer').value = 'base'; $('#ce-d-comp').value = ''; $('#ce-d-deg').value = ''; select(null); });
  }
  function renderDirectory() {
    $('#ce-d-country').value = state.sel || '';
    const layer = $('#ce-d-layer').value, q = $('#ce-d-q').value.trim().toLowerCase(), comp = $('#ce-d-comp').value, deg = $('#ce-d-deg').value;
    const src = layer === 'base' ? BASE : layer === 'queue' ? QUEUE : PRC;
    const rows = src.filter(e => inSel(e) && (!comp || e.completion === comp) && (!deg || e.degree_level === deg) &&
      (!q || [e.name, e.university, e.qualification, e.field, e.person_id].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => a.iso3.localeCompare(b.iso3) || a.name.localeCompare(b.name));
    const ppl = uniq(rows.map(e => e.person_id)).length;
    $('#ce-d-count').textContent = `${rows.length} episode${rows.length === 1 ? '' : 's'} · ${ppl} ${ppl === 1 ? 'person' : 'people'}${layer !== 'base' ? ' · candidates are not counted' : ''}`;
    const fundOf = e => { const f = D.funding_episodes.find(r => r.episode_id === e.episode_id) || D.funding_episodes.find(r => r.person_id === e.person_id); return f; };
    $('#ce-d-cards').innerHTML = rows.map(e => {
      const p = PEOPLE[e.person_id] || {};
      const f = fundOf(e);
      const jobs = D.employment.filter(r => r.person_id === e.person_id);
      const isQ = e.counted_in_baseline !== 'True';
      const ini = e.name.split(/\s+/).filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('');
      return `<li class="ce-pcard${isQ ? ' ce-pcard--queue' : ''}" style="--c:${COLORS[e.iso3]}">
        <div class="ce-pcard__top">
          <span class="ce-pcard__av" aria-hidden="true">${esc(ini)}</span>
          <div class="ce-pcard__who"><b>${esc(e.name)}</b><span><img src="img/regional/flags/${e.iso3.toLowerCase()}.png" alt="" width="18" height="18" onerror="this.remove()" />${esc(nameOf(e.iso3))} · <code>${esc(e.person_id)}</code></span></div>
          ${isQ ? '<span class="ce-badge ce-badge--q" style="--b:#f3c45a">Not counted</span>' : ''}
        </div>
        <div class="ce-pcard__q">${esc(e.qualification)}</div>
        <div class="ce-pcard__u">${esc(e.university)}${e.city ? ' · ' + esc(e.city) : ''}</div>
        <div class="ce-pcard__meta"><span>${esc(e.degree_level)}</span><span>${esc(e.start_year || '?')}–${esc(e.end_or_completion_year || (e.completion === 'in_progress' ? 'now' : '?'))}</span><span>${esc(DISC[e.field] || e.field || 'Field unknown')}</span></div>
        <div class="ce-pcard__pills">${pill(STATUS, e.completion)}${!isQ ? pill(FUND, D.person_funding[e.person_id] || 'not_stated') : (f ? pill(FUND, f.evidence_status) : '')}</div>
        ${jobs.length ? `<div class="ce-pcard__jobs"><span class="ce-pcard__h">After study</span>${jobs.slice(0, 2).map(j => `<div>${esc(j.role)} · ${esc(j.organisation)}</div>`).join('')}</div>` : ''}
        ${e.thesis ? `<div class="ce-pcard__jobs"><span class="ce-pcard__h">Thesis</span><div>${esc(e.thesis)}</div></div>` : ''}
        <div class="ce-pcard__ev"><span class="ce-pcard__h">Evidence</span><span>${esc(e.evidence)}</span><span>${links(e.evidence_url)}</span></div>
        ${isQ ? `<div class="ce-pcard__idn">${esc(p.identity_note || LAYER[e.record_layer] || '')}</div>` : ''}
      </li>`;
    }).join('') || '<li class="ce-empty">No records match these filters.</li>';
  }

  // ================= TOOLTIP =================
  function showTip(e, html) { const t = $('#ps-tip'); t.innerHTML = html; t.classList.add('is-on'); moveTip(e); }
  function moveTip(e) { const t = $('#ps-tip'); const w = t.offsetWidth, h = t.offsetHeight; t.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px'; t.style.top = Math.max(8, e.clientY - h - 12) + 'px'; }
  function hideTip() { $('#ps-tip').classList.remove('is-on'); }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', setupGate) : setupGate();
})();
