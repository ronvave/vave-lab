/* Panel E: Publications, for the Regional Pacific Scholars Dashboard.
   Same layout as the Fiji dashboard's publications list: one list across every
   country, read from the regional directory inside the encrypted bundle (the
   directory module decodes it and calls PSPublications.init). Each item carries
   the circle flag of the country of the linked scholar(s). Read-only; no
   Master-file IDs, contact details or unpublished records. */
(function () {
  'use strict';
  const PAGE = 25;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bb\u02bc`']/g, '').toLowerCase();
  let root, items = [], shown = [], page = 1, TYPE = {}, C = {}, order = [];
  const F = { q: '', type: '', country: '', disc: '', decade: '', fa: '' };
  let SORT = 'new';
  const NOW_Y = new Date().getFullYear();
  // Forthcoming: a year after the current one, or "forthcoming" / "in press" in the record.
  const isForth = (p, yr) => (yr && yr > NOW_Y) || /\b(forthcoming|in press)\b/i.test([p.ti, p.j, p.pb].join(' '));
  const q = id => document.getElementById('psp-' + id);

  // Broken records keep a DOI or an internal key in the author field; never show those.
  const cleanAuthors = a => (!a || /^(doi:|title-year:)/i.test(a)) ? '' : a;
  const linkOf = p => {
    if (p.doi) return { href: 'https://doi.org/' + p.doi, label: 'DOI', doi: true };
    if (p.u && /^10\.\d{4,}\//.test(p.u)) return { href: 'https://doi.org/' + p.u, label: 'DOI', doi: true };
    if (p.u && /^https?:\/\//i.test(p.u)) return { href: p.u, label: 'Link', doi: false };
    return null;
  };

  function build(S, P) {
    const by = P.map(() => ({ sch: [], first: false }));
    for (const s of S) {
      const f = new Set(s.f || []);
      for (const i of (s.p || [])) { if (by[i]) { by[i].sch.push(s); if (f.has(i)) by[i].first = true; } }
    }
    items = P.map((p, i) => {
      const sch = by[i].sch;
      const cs = order.filter(c => sch.some(s => s.c === c));
      const disc = [...new Set(sch.flatMap(s => s.s || []))];
      const yr = p.y || null;
      const journal = (p.j && !/^\d{4}$/.test(p.j)) ? p.j : '';
      const authors = cleanAuthors(p.a);
      const type = TYPE[p.t] ? p.t : 'other';
      return {
        i, p, type, yr, journal, authors, cs, disc, sch, first: by[i].first, link: linkOf(p), forth: isForth(p, yr),
        key: fold([p.ti, authors, journal, p.pb, sch.map(s => s.n).join(' ')].join(' '))
      };
    });
    // Other outputs are excluded, matching the scholar cards and country dashboards.
    items = items.filter(it => it.type !== 'other');
    items.sort((a, b) => (b.yr || 0) - (a.yr || 0) || fold(a.p.ti).localeCompare(fold(b.p.ti)));
  }

  function match(it) {
    if (F.type && it.type !== F.type) return false;
    if (F.country && !it.cs.includes(F.country)) return false;
    if (F.disc && !it.disc.includes(F.disc)) return false;
    if (F.decade === 'forth') { if (!it.forth) return false; }
    else if (F.decade === 'none') { if (it.yr) return false; }
    else if (F.decade && !(it.yr && !it.forth && Math.floor(it.yr / 10) * 10 === +F.decade)) return false;
    if (F.fa === 'first' && !it.first) return false;
    if (F.fa === 'co' && it.first) return false;
    if (F.q) { const words = fold(F.q).split(/\s+/).filter(Boolean); if (!words.every(w => it.key.includes(w))) return false; }
    return true;
  }

  function flagHtml(it) {
    return it.cs.map(c => {
      const names = it.sch.filter(s => s.c === c).map(s => s.n);
      const title = `${C[c] ? C[c].name : c} scholar${names.length > 1 ? 's' : ''}: ${names.join(', ')}`;
      return `<img class="pub-flag" src="img/regional/flags/${c.toLowerCase()}.png" alt="${esc(title)}" title="${esc(title)}" width="26" height="26" loading="lazy">`;
    }).join('');
  }

  function item(it) {
    const t = TYPE[it.type];
    const p = it.p;
    const meta = [it.yr || 'Year not recorded', it.journal ? `<i>${esc(it.journal)}</i>` : '', p.pb && p.pb !== it.journal ? esc(p.pb) : ''].filter(Boolean).join(' \u00b7 ');
    const by = it.sch.map(s => `<a href="#dir=${encodeURIComponent(s.id)}" title="Open ${esc(s.n)}'s card in the Regional Scholar Directory">${esc(s.n)}</a>`).join(', ');
    return `<article class="pub" style="--pub-c:${t.color}">
      <div class="pub__top">
        <div class="pub__badges">${flagHtml(it)}<span class="pub-badge" style="background:${t.color}">${esc(t.s)}</span>${it.link && it.link.doi ? '<span class="pub-badge pub-badge--doi">DOI</span>' : ''}${it.forth ? '<span class="pub-badge pub-badge--forth" title="Year after the current year, or marked forthcoming or in press">Forthcoming</span>' : ''}${it.first ? '<span class="pub-badge pub-badge--fa" title="A Pacific scholar in the directory is the first author">Indigenous first author</span>' : ''}</div>
        ${it.link ? `<a class="pub-link" href="${esc(it.link.href)}" target="_blank" rel="noopener noreferrer" aria-label="${it.link.label} for ${esc(p.ti)} (opens in a new tab)">${it.link.label} \u2197</a>` : ''}
      </div>
      <h3 class="pub__title">${esc(p.ti)}</h3>
      ${it.authors ? `<div class="pub__authors">${esc(it.authors)}${p.more && !/et al\.?$/i.test(it.authors) ? ' et al.' : ''}</div>` : ''}
      <div class="pub__meta">${meta}</div>
      ${by ? `<div class="pub__sch">Scholar${it.sch.length > 1 ? 's' : ''} in the directory: ${by}</div>` : ''}
    </article>`;
  }

  function render(keepPage) {
    if (!keepPage) page = 1;
    shown = items.filter(match);
    const t = it => fold(it.p.ti);
    // Newest first keeps forthcoming items together at the end of the list, under a heading.
    const cmp = SORT === 'old' ? (a, b) => (!!a.forth - !!b.forth) || (a.yr || 9999) - (b.yr || 9999) || t(a).localeCompare(t(b))
      : SORT === 'title' ? (a, b) => t(a).localeCompare(t(b))
      : (a, b) => (!!a.forth - !!b.forth) || (b.yr || 0) - (a.yr || 0) || t(a).localeCompare(t(b));
    shown.sort(cmp);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    page = Math.min(Math.max(1, page), pages);
    const slice = shown.slice((page - 1) * PAGE, page * PAGE);
    const nF = shown.filter(x => x.forth).length;
    q('list').innerHTML = shown.length ? slice.map((it, k) => {
      const prev = k ? slice[k - 1] : shown[(page - 1) * PAGE - 1];
      const head = SORT !== 'title' && it.forth && (!prev || !prev.forth) ? `<h3 class="pub-group">Forthcoming or in press (${nF.toLocaleString()})</h3>` : '';
      return head + item(it);
    }).join('') : '<div class="pub-empty">No publications match these filters. Try removing one.</div>';
    const filtered = Object.values(F).some(Boolean);
    q('count').textContent = filtered ? `Matching items (${shown.length.toLocaleString()} of ${items.length.toLocaleString()})` : `All items (${items.length.toLocaleString()})`;
    q('clear').hidden = !filtered;
    renderPager(pages);
  }

  function renderPager(pages) {
    const el = q('pager');
    if (pages <= 1) { el.innerHTML = shown.length ? `<span class="db-pager__info">${shown.length.toLocaleString()} item${shown.length === 1 ? '' : 's'}</span>` : ''; return; }
    const list = [...new Set([1, page - 1, page, page + 1, pages].filter(n => n >= 1 && n <= pages))].sort((a, b) => a - b);
    let html = `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">\u2039 Prev</button>`;
    let prev = 0;
    for (const n of list) {
      if (prev && n - prev > 1) html += '<span class="db-pager__gap" aria-hidden="true">\u2026</span>';
      html += `<button type="button" data-page="${n}" class="${n === page ? 'is-active' : ''}" ${n === page ? 'aria-current="page"' : ''} aria-label="Page ${n}">${n}</button>`;
      prev = n;
    }
    html += `<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">Next \u203a</button>`;
    html += `<span class="db-pager__info">${shown.length.toLocaleString()} items \u00b7 page ${page} of ${pages}</span>`;
    el.innerHTML = html;
  }

  function setup() {
    const typeOrder = ['journalArticle', 'book', 'bookSection', 'thesisPhd', 'thesisMasters', 'report', 'other'];
    const n = k => items.filter(it => it.type === k).length;
    q('f-type').innerHTML = '<option value="">All types</option>' + typeOrder.filter(n).map(k => `<option value="${k}">${esc(TYPE[k].p)} (${n(k).toLocaleString()})</option>`).join('');
    q('f-country').innerHTML = '<option value="">All countries</option>' + order.map(c => [c, items.filter(it => it.cs.includes(c)).length]).filter(([, k]) => k).map(([c, k]) => `<option value="${c}">${esc(C[c].name)} (${k.toLocaleString()})</option>`).join('');
    const discs = (window.PSDirectoryDisciplines || []).filter(d => items.some(it => it.disc.includes(d)));
    q('f-disc').innerHTML = '<option value="">All disciplines</option>' + discs.map(d => `<option>${esc(d)}</option>`).join('');
    const decs = [...new Set(items.filter(it => it.yr).map(it => Math.floor(it.yr / 10) * 10))].sort((a, b) => b - a);
    const nF = items.filter(it => it.forth).length, nN = items.filter(it => !it.yr).length;
    q('f-decade').innerHTML = '<option value="">All decades</option>' + decs.filter(d => items.some(it => it.yr && !it.forth && Math.floor(it.yr / 10) * 10 === d)).map(d => `<option value="${d}">${d}s</option>`).join('') + (nF ? `<option value="forth">Forthcoming or in press (${nF})</option>` : '') + (nN ? `<option value="none">Year not recorded (${nN})</option>` : '');
    if (q('sort')) q('sort').addEventListener('change', e => { SORT = e.target.value; render(); });
    const ids = { q: 'q', type: 'f-type', country: 'f-country', disc: 'f-disc', decade: 'f-decade', fa: 'f-fa' };
    for (const [k, id] of Object.entries(ids)) q(id).addEventListener(k === 'q' ? 'input' : 'change', e => { F[k] = e.target.value.trim(); render(); });
    q('clear').addEventListener('click', () => { for (const [k, id] of Object.entries(ids)) { F[k] = ''; q(id).value = ''; } render(); });
    q('pager').addEventListener('click', e => {
      const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
      page = +b.dataset.page; render(true);
      q('count').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const act = q('pager').querySelector('.is-active'); act && act.focus({ preventScroll: true });
    });
    // Scholar names jump to the directory card (the directory listens for #dir=ID).
    q('list').addEventListener('click', e => {
      const a = e.target.closest('a[href^="#dir="]'); if (!a) return;
      // Same name clicked again: the hash does not change, so re-announce it.
      if (location.hash === a.getAttribute('href')) { e.preventDefault(); dispatchEvent(new HashChangeEvent('hashchange')); }
    });
  }

  function init(o) {
    root = document.getElementById('ps-pubs');
    const panel = document.getElementById('ps-pubs-panel');
    if (!root || !panel) return;
    TYPE = o.TYPE; C = o.C; order = o.order;
    build(o.S, o.P);
    panel.hidden = false;
    setup();
    render();
    document.dispatchEvent(new CustomEvent('ps:pubs-ready'));
  }
  window.PSPublications = { init, items: () => items, TYPE: () => TYPE, isReady: () => items.length > 0 };
})();
