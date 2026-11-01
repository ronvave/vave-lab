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


  // Link each directory scholar to their name in the author list, with their
  // home-country circle flag in front. Matching is by surname plus first name
  // or first initial; anyone not found (for example after "et al.") is added
  // at the end so every linked scholar still appears.
  const toks = n => fold(n).replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(t => t.length > 1);
  const NOISE = new Set(['dr', 'prof', 'professor', 'associate', 'assoc', 'mr', 'mrs', 'ms', 'ratu', 'adi', 'sir', 'rev', 'jr']);
  const compact = n => fold(n).replace(/[^a-z]/g, '');
  function authorParts(a) {
    a = a.trim();
    if (a.includes(',')) { const i = a.indexOf(','); return { last: a.slice(0, i), first: a.slice(i + 1) }; }
    const t = a.split(/\s+/); return { last: t.slice(-1).join(' '), first: t.slice(0, -1).join(' ') };
  }
  function scoreMatch(a, sTok, sFull) {
    const ap = authorParts(a), lt = toks(ap.last), lc = compact(ap.last);
    if (!lt.length && lc.length < 2) return 0;
    const lastOK = (lt.length && lt.every(t => sTok.has(t))) || (lc.length >= 4 && sFull.includes(lc));
    if (!lastOK) return 0;
    const fn = toks(ap.first).filter(t => !NOISE.has(t));
    if (fn.some(t => sTok.has(t))) return 3;
    const ini = fold(ap.first).replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(t => !NOISE.has(t)).map(t => t.charAt(0)).filter(Boolean)[0];
    if (!ini) return 1;
    return [...sTok].some(t => t.charAt(0) === ini) ? 2 : 0;
  }
  const smallFlag = (c, n) => `<img class="pub-aflag" src="img/regional/flags/${c.toLowerCase()}.png" alt="${esc(C[c] ? C[c].name : c)}" title="${esc((C[c] ? C[c].name : c) + ' scholar: ' + n)}" width="16" height="16" loading="lazy">`;
  const schLink = (s, label) => `<a class="pub-alink" href="#dir=${encodeURIComponent(s.id)}" title="Open ${esc(s.n)}'s card in the Regional Scholar Directory">${smallFlag(s.c, s.n)}${esc(label)}</a>`;
  function authorsHtml(it) {
    const list = it.authors ? it.authors.split(/\s*;\s*/).filter(Boolean) : [];
    const used = new Set(), hit = {};
    // Same person listed in two country databases: link once (first entry).
    const people = []; const seen = new Set();
    for (const s of it.sch) { const k = fold(s.n); if (!seen.has(k)) { seen.add(k); people.push(s); } }
    for (const s of people) {
      const sTok = new Set(toks(s.n)), sFull = compact(s.n); let best = -1, bs = 0;
      list.forEach((a, j) => { if (used.has(j)) return; const sc = scoreMatch(a, sTok, sFull); if (sc > bs) { bs = sc; best = j; } });
      if (best >= 0 && bs >= 2) { used.add(best); hit[best] = s; }
    }
    // Fallback for name changes (for example a married surname in the record):
    // a distinctive given name that appears for exactly one unlinked author.
    for (const s of people) {
      if (Object.values(hit).includes(s)) continue;
      const given = toks(s.n).filter(t => t.length >= 6 && !NOISE.has(t));
      const js = list.map((a, j) => j).filter(j => !used.has(j) && toks(authorParts(list[j]).first).some(t => given.includes(t)));
      const all = list.filter(a => toks(authorParts(a).first).some(t => given.includes(t)));
      if (js.length === 1 && all.length === 1) { used.add(js[0]); hit[js[0]] = s; }
    }
    const extra = people.filter(s => !Object.values(hit).includes(s));
    const etal = /\s*et al\.?$/i;
    let cut = !!it.p.more;
    if (list.length && etal.test(list[list.length - 1])) { list[list.length - 1] = list[list.length - 1].replace(etal, ''); cut = true; }
    const parts = list.map((a, j) => hit[j] ? schLink(hit[j], a) : esc(a));
    const ex = extra.map(s => schLink(s, s.n));
    const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    if (cut) return parts.join('; ') + ' et al.' + (ex.length ? ', including ' + andList(ex) : '');
    return parts.concat(ex).join('; ');
  }
  function summaryHtml(it) {
    const people = new Map();
    for (const s of it.sch) { const k = fold(s.n); if (!people.has(k)) people.set(k, s); }
    const byC = {};
    for (const s of people.values()) byC[s.c] = (byC[s.c] || 0) + 1;
    const cs = Object.keys(byC).sort((a, b) => byC[b] - byC[a] || order.indexOf(a) - order.indexOf(b));
    const SHORTN = { MHL: 'Marshall Is', FSM: 'FSM' };
    const nm = c => SHORTN[c] || (C[c] ? C[c].name : c);
    return `<div class="pub__sch"><b>Total Pasifika scholars: ${people.size}</b>` +
      cs.map(c => `<span class="pub-sum"><img class="pub-rflag" src="img/regional/flags-rect/${c.toLowerCase()}.webp" alt="" width="24" height="16" loading="lazy">${esc(nm(c))} <b>${byC[c]}</b></span>`).join('') + '</div>';
  }

  function item(it) {
    const t = TYPE[it.type];
    const p = it.p;
    const meta = [it.yr || 'Year not recorded', it.journal ? `<i>${esc(it.journal)}</i>` : '', p.pb && p.pb !== it.journal ? esc(p.pb) : ''].filter(Boolean).join(' \u00b7 ');
    const title = it.link ? `<a class="pub__tlink" href="${esc(it.link.href)}" target="_blank" rel="noopener noreferrer" title="${it.link.label} (opens in a new tab)">${esc(p.ti)}</a>` : esc(p.ti);
    const auth = (it.authors || it.sch.length) ? authorsHtml(it) : '';
    return `<article class="pub" style="--pub-c:${t.color}">
      <div class="pub__top">
        <div class="pub__badges">${flagHtml(it)}<span class="pub-badge" style="background:${t.color}">${esc(t.s)}</span>${it.link && it.link.doi ? '<span class="pub-badge pub-badge--doi">DOI</span>' : ''}${it.forth ? '<span class="pub-badge pub-badge--forth" title="Year after the current year, or marked forthcoming or in press">Forthcoming</span>' : ''}${it.first ? '<span class="pub-badge pub-badge--fa" title="A Pacific scholar in the directory is the first author">Indigenous first author</span>' : ''}</div>
      </div>
      <h3 class="pub__title">${title}</h3>
      ${auth ? `<div class="pub__authors">${auth}</div>` : ''}
      <div class="pub__meta">${meta}</div>
      ${it.sch.length ? summaryHtml(it) : ''}
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
