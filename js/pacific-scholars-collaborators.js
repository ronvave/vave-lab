/* Panel F: Collaborators, for the Regional Pacific Scholars Dashboard.
   Partnership map image (img/regional/collab-partnership-map.webp, photos
   and logos baked in) with a clickable area for each country, plus a Regional Collaborators board
   with one card per country listing every collaborator. People are listed in
   data/regional-collaborators.json (names, titles and institutions only; no
   contact details). */
(function () {
  'use strict';
  const DATA_URL = 'data/regional-collaborators.json';
  const MAP = { src: 'img/regional/collab-partnership-map.webp', w: 4000, h: 2251 };
  // Clickable area around each country's label, flag, photos and logo on the
  // partnership map (map-image pixels: x, y, width, height). The photos and
  // logos are part of the image itself.
  const k = 4000 / 1200;
  const HOT = { PLW: [255, 150, 80, 72], FSM: [362, 146, 86, 90], SLB: [415, 228, 252, 100], MHL: [745, 128, 178, 68],
    KIR: [928, 176, 90, 70], TUV: [738, 254, 86, 68], WSM: [916, 274, 246, 98], VUT: [403, 362, 124, 140],
    FJI: [563, 388, 140, 114], TON: [698, 442, 192, 120], COK: [948, 440, 140, 66] };
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const initials = n => n.replace(/['\u2018\u2019]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const full = p => [p.title, p.name].filter(Boolean).join(' ');
  let DATA, NAMES = {}, svg, view;

  // Up to two key people (key: true) lead; the rest appear when expanded.
  function split(c) {
    const ppl = c.people || [];
    const key = ppl.filter(p => p.key).slice(0, 2);
    for (const p of ppl) { if (key.length >= 2) break; if (!key.includes(p)) key.push(p); }
    return { key, more: ppl.filter(p => !key.includes(p)) };
  }
  const instName = k => (DATA.institutions[k] || {}).name || k || '';

  function photoHtml(p, cls) {
    return `<span class="${cls}${p.vc ? ' is-vc' : ''}">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" width="120" height="120">` : `<b aria-hidden="true">${esc(initials(p.name))}</b>`}</span>`;
  }
  function personHtml(p) {
    const role = [p.vc && !p.role ? 'Vice Chancellor' : p.role].filter(Boolean);
    const inst = DATA.institutions[p.inst] || {};
    const logo = inst.logo ? `<img class="pc-rowlogo" src="${esc(inst.logo)}" alt="" title="${esc(inst.name || '')}" loading="lazy">` : '';
    return `<li class="pc-person">${photoHtml(p, 'pc-ph')}<div class="pc-person__t"><div class="pc-name">${esc(full(p))}</div>${role.length ? `<div class="pc-role">${esc(role[0])}</div>` : ''}${inst.name ? `<div class="pc-inst">${esc(inst.name)}</div>` : ''}</div>${logo}</li>`;
  }
  const PEOPLE_ICON = '<svg class="pc-empty__ic" viewBox="0 0 48 36" aria-hidden="true"><circle cx="17" cy="9" r="8"/><path d="M1 34c0-9 7-15 16-15s16 6 16 15z"/><circle cx="34" cy="11" r="6.5"/><path d="M35 21c7 0 12 5 12 13H36c0-5-1.5-9-4.5-12 1-.6 2.2-1 3.5-1z"/></svg>';

  function stats() {
    const ppl = DATA.countries.reduce((n, c) => n + (c.people || []).length, 0);
    const withC = DATA.countries.filter(c => (c.people || []).length).length;
    const without = DATA.countries.length - withC;
    const box = (ic, n, l) => `<div class="pc-stat">${ic}<div><dt>${n}</dt><dd>${l}</dd></div></div>`;
    const I = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    document.getElementById('pc-stats').innerHTML =
      box(I('<circle cx="9" cy="8" r="3.4"/><path d="M2.5 19c0-3.7 2.9-6 6.5-6s6.5 2.3 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 13.2c2.8.2 5 2.3 5 5.8"/>'), ppl, `Collaborator${ppl === 1 ? '' : 's'}`) +
      box(I('<circle cx="12" cy="12" r="9"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="2.2"/>'), withC, `Countr${withC === 1 ? 'y' : 'ies'} with collaborators`) +
      box(I('<rect x="5" y="3" width="11" height="14" rx="1.5"/><path d="M8 7h5M8 10h5M8 13h3"/><path d="M19 8v11.5A1.5 1.5 0 0 1 17.5 21H9"/>'), without, `Countr${without === 1 ? 'y' : 'ies'} without collaborators`);
  }

  function cards() {
    const host = document.getElementById('pc-cards');
    const n = DATA.countries.length, rest = n % 4;
    host.innerHTML = DATA.countries.map((c, i) => {
      const ppl = c.people || [];
      const total = ppl.length;
      const code = c.code.toLowerCase();
      const name = NAMES[c.code] || c.code;
      const wide = rest && i >= n - rest ? ` style="grid-column: span ${12 / rest}"` : '';
      const logos = (c.logos || []).map(k => DATA.institutions[k] && DATA.institutions[k].logo ? `<img class="pc-logo" src="${esc(DATA.institutions[k].logo)}" alt="${esc(instName(k))}" title="${esc(instName(k))}" loading="lazy">` : '').join('');
      return `<article class="pc-card${total ? '' : ' is-empty'}" id="pc-${c.code}" data-code="${c.code}"${wide}>
        <header class="pc-card__head"><span class="pc-card__bg" style="background-image: url('img/regional/${code}.webp')" aria-hidden="true"></span>
          <img class="pc-flag" src="img/regional/flags-rect/${code}.webp" alt="" width="64" height="44">
          <div class="pc-card__t"><h3>${esc(name)}</h3><span class="pc-count">${total ? `${total} collaborator${total === 1 ? '' : 's'}` : 'No collaborators listed yet'}</span></div>
          ${logos ? `<div class="pc-logos">${logos}</div>` : ''}
        </header>
        ${total ? `<h4 class="pc-label">Collaborators</h4><ul class="pc-people">${ppl.map(personHtml).join('')}</ul>`
          : `<div class="pc-empty">${PEOPLE_ICON}<strong>No collaborators listed yet</strong><span>This country currently has no collaborators recorded in the directory.</span></div>`}
      </article>`;
    }).join('');
  }
  function focusCountry(code) {
    const card = document.getElementById('pc-' + code); if (!card) return;
    document.querySelectorAll('.pc-card.is-target').forEach(x => x.classList.remove('is-target'));
    card.classList.add('is-target');
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  function map() {
    const host = document.getElementById('pc-map');
    svg = svgEl('svg', { viewBox: `0 0 ${MAP.w} ${MAP.h}`, role: 'group', 'aria-label': 'Pacific Scholar Country Databases partnership map with collaborator photos and university logos for each country' });
    svgEl('image', { href: MAP.src, x: 0, y: 0, width: MAP.w, height: MAP.h, 'aria-hidden': 'true' }, svg);
    const layer = svgEl('g', {}, svg);
    DATA.countries.forEach(c => {
      const at = HOT[c.code]; if (!at) return;
      const name = NAMES[c.code] || c.code;
      const ppl = (c.people || []).map(full);
      const label = ppl.length ? `${name}: ${ppl.join(', ')}. Show collaborators.` : `${name}: no collaborators listed yet. Show card.`;
      const g = svgEl('g', { class: 'pc-mk', tabindex: '0', role: 'button', 'data-code': c.code, 'aria-label': label }, layer);
      svgEl('title', {}, g).textContent = ppl.length ? `${name}: ${ppl.join(', ')}` : `${name}: no collaborators listed yet`;
      svgEl('rect', { x: at[0] * k, y: at[1] * k, width: at[2] * k, height: at[3] * k, rx: 14, class: 'pc-hot' }, g);
      g.addEventListener('click', () => focusCountry(c.code));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusCountry(c.code); } });
    });
    host.prepend(svg);
    setView([0, 0, MAP.w, MAP.h]);
    host.querySelectorAll('[data-pczoom]').forEach(b => b.addEventListener('click', () => zoom(b.dataset.pczoom)));
    let drag = null;
    svg.addEventListener('pointerdown', e => { if (e.target.closest('.pc-mk')) return; drag = { x: e.clientX, y: e.clientY, v: view.slice() }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const k = Math.max(drag.v[2] / svg.clientWidth, drag.v[3] / svg.clientHeight);
      setView([drag.v[0] - (e.clientX - drag.x) * k, drag.v[1] - (e.clientY - drag.y) * k, drag.v[2], drag.v[3]]);
    });
    const end = () => { drag = null; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }
  function setView(v) {
    v[2] = Math.max(MAP.w / 6, Math.min(MAP.w, v[2])); v[3] = v[2] * MAP.h / MAP.w;
    v[0] = Math.max(0, Math.min(MAP.w - v[2], v[0])); v[1] = Math.max(0, Math.min(MAP.h - v[3], v[1]));
    view = v; svg.setAttribute('viewBox', v.map(n => n.toFixed(1)).join(' '));
  }
  function zoom(dir) {
    if (dir === 'reset') return setView([0, 0, MAP.w, MAP.h]);
    const f = dir === 'in' ? 0.7 : 1 / 0.7, v = view;
    const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2, w = v[2] * f;
    setView([cx - w / 2, cy - (w * MAP.h / MAP.w) / 2, w, 0]);
  }

  async function init(D) {
    const panel = document.getElementById('ps-collab-panel');
    if (!panel) return;
    NAMES = Object.fromEntries(((D && D.countries) || []).map(c => [c.code, c.name]));
    try {
      const r = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!r.ok) throw new Error('missing');
      DATA = await r.json();
    } catch (e) { return; }
    panel.hidden = false;
    stats();
    cards();
    map();
  }
  window.PSCollaborators = { init };
})();
