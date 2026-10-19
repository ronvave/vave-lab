/* Panel G: Collaborators, for the Regional Pacific Scholars Dashboard.
   Map (same base image and anchors as panel A1) with up to two key
   collaborator photos beside each country, plus one card per country that
   expands to show every collaborator. People are listed in
   data/regional-collaborators.json (names, titles and institutions only; no
   contact details). */
(function () {
  'use strict';
  const DATA_URL = 'data/regional-collaborators.json';
  const MAP = { src: 'img/regional/pacific-map.webp', w: 2400, h: 1891 };
  // Top-left corner of each country's photo row, in map-image pixels, placed
  // in open sea next to the baked-in label so nothing covers a flag or name.
  const SPOT = { SLB: [990, 588], FJI: [1342, 1000], TON: [1330, 1285], WSM: [1862, 852], VUT: [920, 1082],
    TUV: [1625, 840], KIR: [1800, 640], PLW: [470, 520], COK: [2150, 1300], MHL: [1450, 470], FSM: [790, 362] };
  const R = 56, GAP = 8;
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
    const line = [p.vc ? 'Vice Chancellor' : p.role, instName(p.inst)].filter(Boolean);
    if (p.vc && p.role && p.role !== 'Vice Chancellor') line.splice(1, 0, p.role);
    return `<li class="pc-person">${photoHtml(p, 'pc-ph')}<div><div class="pc-name">${esc(full(p))}</div>${line.length ? `<div class="pc-role">${esc(line.join(' \u00b7 '))}</div>` : ''}</div></li>`;
  }

  function cards() {
    const host = document.getElementById('pc-cards');
    host.innerHTML = DATA.countries.map((c, n) => {
      const { key, more } = split(c);
      const total = (c.people || []).length;
      const logos = (c.logos || []).map(k => DATA.institutions[k] && DATA.institutions[k].logo ? `<img class="pc-logo" src="${esc(DATA.institutions[k].logo)}" alt="${esc(instName(k))}" title="${esc(instName(k))}" loading="lazy">` : '').join('');
      return `<article class="pc-card${total ? '' : ' is-empty'}" id="pc-${c.code}" data-code="${c.code}">
        <header class="pc-card__head">
          <img class="pc-flag" src="img/regional/flags/${c.code.toLowerCase()}.png" alt="" width="34" height="34">
          <div class="pc-card__t"><h3><span class="pc-n">[${n + 1}]</span> ${esc(NAMES[c.code] || c.code)}</h3><span class="pc-count">${total ? `${total} collaborator${total === 1 ? '' : 's'}` : 'No collaborators listed yet'}</span></div>
          ${logos ? `<div class="pc-logos">${logos}</div>` : ''}
        </header>
        ${total ? `<ul class="pc-people">${key.map(personHtml).join('')}</ul>` : ''}
        ${more.length ? `<ul class="pc-people pc-more" id="pc-more-${c.code}" hidden>${more.map(personHtml).join('')}</ul>
          <button class="pc-toggle" type="button" aria-expanded="false" aria-controls="pc-more-${c.code}" data-more="${more.length}">Show ${more.length} more collaborator${more.length === 1 ? '' : 's'}</button>` : ''}
      </article>`;
    }).join('');
    host.addEventListener('click', e => {
      const b = e.target.closest('.pc-toggle'); if (!b) return;
      setOpen(b.closest('.pc-card'), b.getAttribute('aria-expanded') !== 'true');
    });
  }
  function setOpen(card, open) {
    const b = card.querySelector('.pc-toggle'); if (!b) return;
    const n = +b.dataset.more;
    card.querySelector('.pc-more').hidden = !open;
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? 'Show fewer' : `Show ${n} more collaborator${n === 1 ? '' : 's'}`;
  }
  function focusCountry(code) {
    const card = document.getElementById('pc-' + code); if (!card) return;
    setOpen(card, true);
    document.querySelectorAll('.pc-card.is-target').forEach(x => x.classList.remove('is-target'));
    card.classList.add('is-target');
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  function map() {
    const host = document.getElementById('pc-map');
    svg = svgEl('svg', { viewBox: `0 0 ${MAP.w} ${MAP.h}`, role: 'group', 'aria-label': 'Map of the Pacific with key collaborator photos beside each country' });
    const defs = svgEl('defs', {}, svg);
    svgEl('image', { href: MAP.src, x: 0, y: 0, width: MAP.w, height: MAP.h, 'aria-hidden': 'true' }, svg);
    const layer = svgEl('g', {}, svg);
    DATA.countries.forEach(c => {
      const { key, more } = split(c);
      const at = SPOT[c.code]; if (!at || !key.length) return;
      const g = svgEl('g', { class: 'pc-mk', tabindex: '0', role: 'button', 'data-code': c.code,
        'aria-label': `${NAMES[c.code] || c.code}: ${(c.people || []).map(full).join(', ')}. Show all collaborators.` }, layer);
      svgEl('title', {}, g).textContent = `${NAMES[c.code] || c.code}: ${(c.people || []).map(full).join(', ')}`;
      let x = at[0] + R; const y = at[1] + R;
      key.forEach((p, i) => {
        const id = `pc-clip-${c.code}-${i}`;
        svgEl('circle', { cx: x, cy: y, r: R }, svgEl('clipPath', { id }, defs));
        svgEl('circle', { cx: x, cy: y, r: R, class: 'pc-mk__bg' }, g);
        if (p.photo) svgEl('image', { href: p.photo, x: x - R, y: y - R, width: 2 * R, height: 2 * R, 'clip-path': `url(#${id})`, preserveAspectRatio: 'xMidYMid slice' }, g);
        else { const t = svgEl('text', { x, y, class: 'pc-mk__ini', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g); t.textContent = initials(p.name); }
        svgEl('circle', { cx: x, cy: y, r: R - 3, class: 'pc-mk__ring' + (p.vc ? ' is-vc' : '') }, g);
        x += 2 * R + GAP;
      });
      if (more.length) {
        svgEl('circle', { cx: x - 4, cy: y, r: R - 6, class: 'pc-mk__more' }, g);
        const t = svgEl('text', { x: x - 4, y, class: 'pc-mk__moretxt', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g); t.textContent = '+' + more.length;
      }
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
    cards();
    map();
  }
  window.PSCollaborators = { init };
})();
