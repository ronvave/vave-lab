/* Regional Scholar Directory — bottom panel of pacific-scholars.html.
 *
 * Reads D.directory from the decrypted regional bundle (gzip + base64 inside the
 * encrypted file). Nothing here is fetched from a Master file or stored outside
 * the browser's memory. Cards reuse the country dashboards' scholar-card design.
 * Card fields are limited to what the regional build exports (see
 * scripts/regional_directory.py): no share tokens, notes or contact details.
 * Share copies a link back to the scholar's card on this regional dashboard.
 * "View on <country> dashboard" opens the scholar's profile on the country
 * dashboard. No share tokens are copied into the regional bundle.
 */
(() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f\u02bb\u2018\u2019'`]/g, '').toLowerCase();
  const PAGE = 24;

  const BAND = {
    FJI: { label: 'Fijian Scholar', from: '#4ECDE6', to: '#0891b2', ink: '#111' },
    TON: { label: 'Tongan Scholar', from: '#FF5A6E', to: '#c93e50', ink: '#111' },
    SLB: { label: 'Solomon Islands Scholar', from: '#2b86c5', to: '#145a8a', ink: '#fff' },
    WSM: { label: 'Samoan Scholar', from: '#3b5fc0', to: '#22397a', ink: '#fff' },
    VUT: { label: 'Ni-Vanuatu Scholar', from: '#2f9e5c', to: '#1d6b3c', ink: '#fff' },
    TUV: { label: 'Tuvaluan Scholar', from: '#FFD84A', to: '#f7b500', ink: '#111' },
    KIR: { label: 'I-Kiribati Scholar', from: '#F2994A', to: '#c9701f', ink: '#111' },
    PLW: { label: 'Palauan Scholar', from: '#56CCF2', to: '#1f8fbf', ink: '#111' },
    COK: { label: 'Cook Islands Scholar', from: '#1e3a8a', to: '#172554', ink: '#fff' },
    MHL: { label: 'Marshallese Scholar', from: '#B48CE6', to: '#7c4dbd', ink: '#fff' },
    FSM: { label: 'Micronesian Scholar', from: '#0e7490', to: '#062f35', ink: '#fff' }
  };
  // Share copies this link: the scholar's card on the regional dashboard, with
  // Explain their research opened (after the regional passcode).
  const regionalCardUrl = s => `${location.origin}${location.pathname}#dir=${s.id}&explain=1`;
  function profileUrl(s) {
    const dash = C[s.c] && C[s.c].dashboard;
    if (!dash) return '';
    const u = new URL(dash, location.href);
    u.searchParams.set('scholar', s.id);
    u.searchParams.set('explain', '1');
    if (s.n) u.searchParams.set('name', s.n);
    return u.href;
  }

  const TYPE = {
    journalArticle: { color: '#8a6408', bg: '#f8efd6', border: '#e6c98a', s: 'Journal article', p: 'Journal articles', bib: 'article' },
    bookSection: { color: '#9b5a60', bg: '#f7e8ea', border: '#e1a8ae', s: 'Book chapter', p: 'Book chapters', bib: 'incollection' },
    book: { color: '#7a1419', bg: '#f7e8ea', border: '#e1a8ae', s: 'Book', p: 'Books', bib: 'book' },
    thesisPhd: { color: '#1d6f1d', bg: '#e5f4e5', border: '#a4d3a4', s: 'PhD thesis', p: 'PhD theses', bib: 'phdthesis' },
    thesisMasters: { color: '#3f7a3f', bg: '#eef7ee', border: '#c9e2c9', s: "Master's thesis", p: "Master's theses", bib: 'mastersthesis' },
    report: { color: '#1e40af', bg: '#e6ecf7', border: '#a8b8dc', s: 'Report', p: 'Reports', bib: 'techreport' },
    other: { color: '#475569', bg: '#f1f5f9', border: '#cbd5e1', s: 'Other output', p: 'Other outputs', bib: 'misc' }
  };
  // Local labels: Fiji, Tonga, Solomon Islands and Vanuatu only, with the live
  // country dashboards' wording and colours.
  const PAL = ['#FF5A6E', '#4ECDE6', '#FFD84A', '#6FCF97', '#B48CE6', '#F2994A', '#56CCF2', '#BB6BD9', '#219653'];
  const DARK = ['#c93e50', '#0891b2', '#f7b500', '#2f9e5c', '#7c4dbd', '#c9701f', '#1f8fbf', '#8e3fae', '#15703c'];
  const g = i => [PAL[i], DARK[i]];
  const LOCAL = {
    FJI: { src: 'iTaukei dashboard', field: 'Paternal Province → confederacy', fmt: v => `${v} Confederacy`, ink: '#111', map: { Burebasaga: ['#FF5A6E', '#c93e50'], Kubuna: ['#4ECDE6', '#0891b2'], Tovata: ['#FFD84A', '#f7b500'] } },
    TON: { src: 'Tonga dashboard', field: 'Paternal island division', fmt: v => v, ink: '#111', map: { Tongatapu: ['#FF5A6E', '#c93e50'], "Vava'u": ['#4ECDE6', '#0891b2'], "Ha'apai": ['#FFD84A', '#f7b500'], "'Eua": ['#6FCF97', '#2f9e5c'], 'Ongo Niua': ['#B48CE6', '#7c4dbd'] } },
    SLB: { src: 'Solomon Islands dashboard', field: 'Paternal Province', fmt: v => `${v} Province`, ink: '#111', map: { Central: g(0), Choiseul: g(1), Guadalcanal: g(2), Isabel: g(3), 'Makira-Ulawa': g(4), Malaita: g(5), 'Rennell-Bellona': g(6), Temotu: g(7), Western: g(8) } },
    VUT: { src: 'Vanuatu dashboard', field: 'Paternal Province', fmt: v => v, ink: '#fff', map: { Torba: ['#496a9c', '#496a9c'], Sanma: ['#007d83', '#007d83'], Penama: ['#80703a', '#80703a'], Malampa: ['#a0543c', '#a0543c'], Shefa: ['#87639d', '#87639d'], Tafea: ['#486c49', '#486c49'] } }
  };
  const REGIONS = ['Pacific', 'New Zealand', 'Australia', 'North America', 'Europe', 'Asia'];
  const regionLabel = v => v === NONE ? 'Not recorded' : String(v).replace('|', ' \u203a ');
  const SECTORS = ['University or tertiary', 'Other workplace', 'Not recorded'];
  const ORCID = '<svg viewBox="0 0 256 256" aria-hidden="true"><circle cx="128" cy="128" r="128" fill="#A6CE39"/><path fill="#fff" d="M86.3 186.2H70.9V79.1h15.4v107.1zM108.9 79.1h41.6c39.6 0 57 28.3 57 53.6 0 27.5-21.5 53.6-56.8 53.6h-41.8V79.1zm15.4 93.3h24.5c34.9 0 42.9-26.5 42.9-39.7C191.7 111.5 178 92 148 92h-23.7v80.4zM88.7 56.8a10.1 10.1 0 1 1-20.2 0 10.1 10.1 0 0 1 20.2 0z"/></svg>';
  const GS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>';
  const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';

  let root, S = [], P = [], X = {}, C = {}, order = [], shown = [], page = 1;
  const F = { country: '', disc: '', degree: '', gender: '', work: '', region: '', sector: '', expl: '', q: '', only: '' };
  let SORT = 'pubs';
  const SORT_LABEL = { pubs: 'Sorted by publications, most first', fa: 'Sorted by first-authored publications, most first', name: 'Sorted by name, A to Z', country: 'Sorted by country, then publications' };
  const LABEL = { country: 'Country', disc: 'Discipline', degree: 'Degree', gender: 'Gender', work: 'Work region', region: 'Study region', sector: 'Sector', expl: 'Research explanation', q: 'Search', only: 'Shared scholar' };
  const IDS = { country: 'f-country', disc: 'f-disc', degree: 'f-degree', gender: 'f-gender', sector: 'f-sector', expl: 'f-expl', q: 'q' };
  const MENUS = { work: 'm-work', region: 'm-region' };   // Region -> Country fly-out menus
  const NONE = '__none';
  const q = id => root.querySelector('#psd-' + id);

  async function unpack(dir) {
    if (!dir) return null;
    if (!dir.gz) return dir;
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open the directory data. Please update your browser.');
    const bin = Uint8Array.from(atob(dir.gz), c => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  function localChip(s) {
    const L = LOCAL[s.c]; if (!L || !s.loc) return '';
    const col = L.map[s.loc]; if (!col) return '';
    return `<span class="lchip" style="background:linear-gradient(135deg,${col[0]},${col[1]});color:${L.ink}" title="Same label as the ${esc(L.src)} (from ${esc(L.field)})">${esc(L.fmt(s.loc))}</span>`;
  }
  const degLabel = s => (s.d || []).includes('P') ? ((s.d || []).includes('M') ? "Master's and PhD" : 'PhD') : ((s.d || []).includes('M') ? "Master's" : '');
  function hay(s) {
    if (s._h) return s._h;
    const L = LOCAL[s.c];
    const parts = [s.sal, s.n, C[s.c].name, s.inst, s.dept, s.role, s.geo, L && s.loc ? L.fmt(s.loc) : '', s.fld, ...(s.s || []), ...(s.p || []).map(i => P[i].ti), ...((X[s.id] || {}).kw || [])];
    return (s._h = fold(parts.filter(Boolean).join(' ')));
  }
  function match(s) {
    if (F.only) return s.id === F.only;
    if (F.country && s.c !== F.country) return false;
    if (F.disc && !(s.s || []).includes(F.disc)) return false;
    if (F.degree && !(s.d || []).includes(F.degree)) return false;
    if (F.gender && s.g !== F.gender) return false;
    if (F.work) {
      if (F.work === NONE) { if (s.wr) return false; }
      else { const [r, c] = F.work.split('|'); if (s.wr !== r || (c && s.wc !== c)) return false; }
    }
    if (F.region && !(F.region.includes('|') ? (s.sc || []).includes(F.region) : (s.r || []).includes(F.region))) return false;
    if (F.sector && s.sec !== F.sector) return false;
    if (F.expl) { const has = !!(X[s.id] && String(X[s.id].sm || '').trim()); if ((F.expl === 'yes') !== has) return false; }
    if (F.q) { const h = hay(s); if (!fold(F.q).split(/\s+/).filter(Boolean).every(w => h.includes(w.replace(/"/g, '')))) return false; }
    return true;
  }

  // "Explain their research (AI generated)" — copied from the country cards.
  // Summaries may contain <a>, <em>, <strong>, <br>; everything else is escaped
  // and links are limited to http(s) / mailto (same rule as the Fiji card).
  function sanitizeSummaryHtml(input) {
    const src = String(input ?? '');
    if (src.indexOf('<') === -1) return esc(src);
    let out = '', i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch !== '<') { out += ch === '&' ? '&amp;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch === "'" ? '&#39;' : ch; i++; continue; }
      const rest = src.slice(i, i + 12).toLowerCase();
      const end = src.indexOf('>', i);
      if (rest.startsWith('</a>')) { out += '</a>'; i += 4; continue; }
      if (/^<a[\s]/.test(rest) && end !== -1) {
        const attrs = src.substring(i + 2, end);
        const m = /href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs);
        const href = m ? m[1].trim() : '';
        if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) out += `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">`;
        i = end + 1; continue;
      }
      const t = /^<\/?(em|strong|i|b)>/.exec(rest) || /^<br\s*\/?>/.exec(rest);
      if (t) { out += t[0].startsWith('<br') ? '<br>' : t[0]; i += t[0].length; continue; }
      out += '&lt;'; i++;
    }
    return out.replace(/<a [^>]*>(?![\s\S]*?<\/a>)/g, m => m + '</a>');
  }
  // Positions panel, as on the Fiji and Tonga dashboard cards: Positions sheet rows only
  // (title, leadership title, department, institution, country, years; current first).
  let POS = {};
  const posYears = r => r.s && r.e ? (r.s === r.e ? r.s : `${r.s}\u2013${r.e}`) : r.s ? (r.cur ? `since ${r.s}` : `from ${r.s}`) : r.e ? `until ${r.e}` : '';
  function positionsBlock(s) {
    const rows = (POS[s.id] || []).map((r, i) => [r, i]).sort((a, b) => (a[0].cur !== b[0].cur ? (a[0].cur ? -1 : 1) : ((parseInt(b[0].s, 10) || 0) - (parseInt(a[0].s, 10) || 0)) || a[1] - b[1])).map(x => x[0]);
    if (!rows.length) return '';
    const id = String(s.id).replace(/[^A-Za-z0-9_-]/g, '_'), nCur = rows.filter(r => r.cur).length;
    const items = rows.map(r => {
      const sub = [r.d, r.i, r.c, posYears(r)].filter(Boolean).map(esc).join(' \u00b7 ');
      return `<li class="psd-pos__item"><span class="psd-pos__pill ${r.cur ? 'is-cur">Current' : 'is-past">Past'}</span><div class="psd-pos__text"><div class="psd-pos__title">${esc(r.t)}${r.l ? `; ${esc(r.l)}` : ''}</div>${sub ? `<div class="psd-pos__sub">${sub}</div>` : ''}</div></li>`;
    }).join('');
    return `<div class="db-scholar-card__insight-wrap psd-pos">
      <button type="button" class="db-scholar-card__insight-btn psd-pos__btn" data-insight-btn aria-expanded="false" aria-controls="psd-pos-${id}">
        <span class="db-scholar-card__insight-btn-label">Positions</span>
        <span class="db-scholar-card__insight-btn-tag">(${rows.length}${nCur ? `, ${nCur} current` : ''})</span>
        <span class="db-scholar-card__insight-btn-chev" aria-hidden="true">\u25be</span>
      </button>
      <div class="db-scholar-card__insight psd-pos__panel" id="psd-pos-${id}" hidden>
        <div class="db-scholar-card__insight-heading">Positions recorded in the Master file</div>
        <ul class="psd-pos__list">${items}</ul>
      </div>
    </div>`;
  }
  function insightBlock(s, ex) {
    const kw = ex.kw || [], sm = ex.sm || '';
    const id = esc(s.id);
    const tags = kw.map((k, i) => `<span class="db-scholar-card__insight-tag" data-tag-color="${i % 8}" role="button" tabindex="0" data-kw="${esc(k)}" title="Search the directory for \u201c${esc(k)}\u201d">${esc(k)}</span>`).join('');
    const summary = sm.trim()
      ? `<p class="db-scholar-card__insight-summary">${sanitizeSummaryHtml(sm)}</p>`
      : '<p class="db-scholar-card__insight-summary db-scholar-card__insight-summary--empty">Insight not yet generated for this scholar. It will appear here after the next data refresh.</p>';
    return `<div class="db-scholar-card__insight-wrap">
      <button type="button" class="db-scholar-card__insight-btn" data-insight-btn aria-expanded="false" aria-controls="psd-ins-${id}">
        <span class="db-scholar-card__insight-btn-label">Explain their research</span>
        <span class="db-scholar-card__insight-btn-tag">(AI generated)</span>
        <span class="db-scholar-card__insight-btn-chev" aria-hidden="true">\u25be</span>
      </button>
      <div class="db-scholar-card__insight" id="psd-ins-${id}" hidden>
        <div class="db-scholar-card__insight-section">
          <div class="db-scholar-card__insight-heading">Research keywords</div>
          <div class="db-scholar-card__insight-tags">${tags || '<span class="db-scholar-card__insight-caption">(none yet)</span>'}</div>
          <div class="db-scholar-card__insight-caption">Generated once from this scholar's indexed publications.</div>
        </div>
        <div class="db-scholar-card__insight-section">
          <div class="db-scholar-card__insight-heading">Plain-English summary</div>
          ${summary}
          <div class="db-scholar-card__insight-caption"><em>AI-generated summary based on this scholar's indexed publications \u2014 may not capture every nuance of their work.</em></div>
        </div>
      </div>
    </div>`;
  }

  function card(s) {
    const cc = C[s.c], band = BAND[s.c] || BAND.FSM;
    const words = s.n.split(/\s+/).filter(w => /^\p{L}/u.test(w));
    const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
    // Opens this scholar's profile on the country dashboard, with Explain their research open when recorded.
    const dash = cc.dashboard ? `<a href="${esc(profileUrl(s))}" target="_blank" rel="noopener" title="Open ${esc(s.n)}\u2019s profile on the ${esc(cc.name)} dashboard">View on ${esc(cc.name)} dashboard \u2197</a>`
      : `<span class="muted">${cc.dashboardStatus === 'development' ? `${esc(cc.name)} dashboard in development` : `No ${esc(cc.name)} dashboard yet`}</span>`;
    const types = {}; (s.p || []).forEach(i => { const t = TYPE[P[i].t] ? P[i].t : 'other'; types[t] = (types[t] || 0) + 1; });
    const chips = Object.entries(TYPE).filter(([k]) => types[k]).map(([k, t]) => `<span class="tchip" style="background:${t.bg};border-color:${t.border};color:${t.color}"><span class="n">${types[k]}</span> ${types[k] === 1 ? t.s : t.p}</span>`).join('');
    const name = `${s.sal ? s.sal + ' ' : ''}${s.n}`;
    // Photo and links: Master file first, then the country dashboard's admin
    // enrichment (cardExtras), as on the country cards.
    const ex = X[s.id] || {};
    const ph = s.ph || ex.ph || '', iu = s.iu || ex.iu || '', du = s.du || ex.du || '';
    const chip = localChip(s);
    // Memorial strip (deceased only), same rules as the country cards:
    // birth + death -> "1931 – 2008"; death only -> "d. 2008"; else "In memoriam".
    const yb = s.yb || ex.yb || null, yd = s.yd || ex.yd || null;
    const memorial = s.dec ? (yb && yd ? `${yb} \u2013 ${yd}` : (yd ? `d. ${yd}` : 'In memoriam')) : '';
    const metaLine = (s.geo || chip) ? `<div class="db-scholar-card__meta">${esc(s.geo || '')}${chip ? (s.geo ? ' ' : '') + chip : ''}</div>` : '';
    const degLine = [degLabel(s), s.fld || (s.s || []).join(', ')].filter(Boolean).join(' \u00b7 ');
    return `<article class="db-scholar-card" style="--conf-from:${band.from};--conf-to:${band.to};--conf-ink:${band.ink}" data-id="${esc(s.id)}">
      <div class="db-scholar-card__banner"><span class="db-scholar-card__conf-label"><img class="band-flag" src="img/regional/flags/${s.c.toLowerCase()}.png" alt="">${esc(band.label)}</span></div>
      ${s.iso ? `<img class="db-scholar-card__flag" src="https://flagcdn.com/${esc(s.iso)}.svg" alt="Works in ${esc(s.wc)}" title="Works in ${esc(s.wc)}" loading="lazy" width="49" height="34">` : ''}
      ${s.orcid ? `<a class="db-scholar-card__orcid" href="https://orcid.org/${esc(s.orcid)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(s.n)}\u2019s ORCID profile" aria-label="Open ${esc(s.n)}\u2019s ORCID profile">${ORCID}</a>` : `<span class="db-scholar-card__orcid is-missing" role="img" aria-label="ORCID profile not yet linked" title="ORCID profile not yet linked">${ORCID}</span>`}
      ${s.gs ? `<a class="db-scholar-card__gs" href="${esc(s.gs)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(s.n)}\u2019s Google Scholar profile" aria-label="Open ${esc(s.n)}\u2019s Google Scholar profile">${GS}</a>` : `<span class="db-scholar-card__gs is-missing" role="img" aria-label="Google Scholar profile not yet linked" title="Google Scholar profile not yet linked">${GS}</span>`}
      <div class="db-scholar-card__body">
        <div class="db-scholar-card__photo-col${s.dec ? ' db-scholar-card__photo-col--is-deceased' : ''}">
          <div class="db-scholar-card__photo"><div class="db-scholar-card__initials">${esc(initials)}</div>${ph ? `<img src="${esc(ph)}" alt="Photo of ${esc(s.n)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</div>
          ${memorial ? `<div class="db-scholar-card__memorial" aria-label="Memorial: ${esc(memorial)}">${esc(memorial)}</div>` : ''}
          ${s.ret && !s.dec ? '<span class="db-scholar-card__retired" title="This scholar is retired">Retired</span>' : ''}
          <button type="button" class="db-scholar-card__share" data-share="${esc(s.id)}" title="Copy a link to this scholar's card on the regional dashboard" aria-label="Copy a link to this scholar's card on the regional dashboard">${SHARE}<span>Share</span></button>
        </div>
        <div class="db-scholar-card__info">
          <h3>${esc(name)}</h3>
          ${metaLine}
          ${s.inst ? `<div class="db-scholar-card__institution">${iu ? `<a href="${esc(iu)}" target="_blank" rel="noopener noreferrer" title="Open the ${esc(s.inst)} website">${esc(s.inst)}</a>` : esc(s.inst)}</div>` : ''}
          ${s.dept ? `<div class="db-scholar-card__department">${du ? `<a href="${esc(du)}" target="_blank" rel="noopener noreferrer" title="Open the ${esc(s.dept)} page">${esc(s.dept)}</a>` : esc(s.dept)}</div>` : ''}
          ${s.role ? `<div class="db-scholar-card__title">${s.pu ? `<a href="${esc(s.pu)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(s.n)}\u2019s profile">${esc(s.role)}</a>` : esc(s.role)}</div>` : (s.pu ? `<div class="db-scholar-card__title"><a href="${esc(s.pu)}" target="_blank" rel="noopener noreferrer">View profile</a></div>` : '')}
          ${degLine ? `<div class="db-scholar-card__updated">${esc(degLine)}</div>` : ''}
        </div>
      </div>
      ${insightBlock(s, ex)}
      ${positionsBlock(s)}
      <div class="db-scholar-card__stats"><div class="stat"><b>${(s.p || []).length}</b><span>Publications</span></div><div class="stat"><b class="accent">${s.fa || 0}</b><span>First-authored</span></div></div>
      ${chips ? `<div class="db-scholar-card__types">${chips}</div>` : ''}
      <div class="card-foot">${dash}</div>
    </article>`;
  }

  function render(keepPage) {
    if (!keepPage) page = 1;
    shown = S.filter(match);
    if (SORT !== 'pubs') {
      const fam = x => fold(String(x.n || '').split(/\s+/).pop());
      const ord = c => order.indexOf(c);
      const cmp = SORT === 'fa' ? (a, b) => (b.fa || 0) - (a.fa || 0) || (b.p || []).length - (a.p || []).length || a._o - b._o
        : SORT === 'name' ? (a, b) => fold(a.n).localeCompare(fold(b.n)) || a._o - b._o
        : (a, b) => ord(a.c) - ord(b.c) || a._o - b._o;
      shown = shown.slice().sort(cmp);
    }
    const sl = q('sortlabel'); if (sl) sl.textContent = SORT_LABEL[SORT];
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    page = Math.min(Math.max(1, page), pages);
    const grid = q('grid');
    grid.innerHTML = shown.length ? shown.slice((page - 1) * PAGE, page * PAGE).map(card).join('') : '<div class="empty">No scholars match these filters. Try removing one.</div>';
    const active = Object.entries(F).filter(([, v]) => v);
    q('chips').innerHTML = active.map(([k, v]) => `<span class="db-filter-chip"><span>${LABEL[k]}:</span>${esc(k === 'country' ? C[v].name : k === 'degree' ? (v === 'P' ? 'PhD or doctorate' : "Master's") : k === 'gender' ? (v === 'F' ? 'Female' : 'Male') : k === 'expl' ? (v === 'yes' ? 'Recorded' : 'Not yet recorded') : k === 'only' ? (S.find(s => s.id === v) || {}).n || '' : (k === 'work' || k === 'region') ? regionLabel(v) : v)}<button type="button" data-rm="${k}" aria-label="Remove ${LABEL[k]} filter">\u00d7</button></span>`).join('');
    q('clear').classList.toggle('is-hidden', !active.length);
    const from = shown.length ? (page - 1) * PAGE + 1 : 0, to = Math.min(page * PAGE, shown.length);
    q('count').textContent = `Showing ${from.toLocaleString()}\u2013${to.toLocaleString()} of ${shown.length.toLocaleString()} matching scholars \u00b7 ${S.length.toLocaleString()} in the directory`;
    renderPager(pages);
    for (const k of Object.keys(MENUS)) syncMenu(k);
  }

  // Page-number pager, same layout as the Fiji dashboard:
  // ‹ Prev  1 … 4 5 6 … 51  Next ›   1,205 scholars · page 5 of 51
  function renderPager(pages) {
    const el = q('pager');
    if (pages <= 1) { el.innerHTML = shown.length ? `<span class="db-pager__info">${shown.length.toLocaleString()} scholar${shown.length === 1 ? '' : 's'}</span>` : ''; return; }
    const set = new Set([1, page - 1, page, page + 1, pages].filter(n => n >= 1 && n <= pages));
    const list = [...set].sort((a, b) => a - b);
    let html = `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">\u2039 Prev</button>`;
    let prev = 0;
    for (const n of list) {
      if (prev && n - prev > 1) html += '<span class="db-pager__gap" aria-hidden="true">\u2026</span>';
      html += `<button type="button" data-page="${n}" class="${n === page ? 'is-active' : ''}" ${n === page ? 'aria-current="page"' : ''} aria-label="Page ${n}">${n}</button>`;
      prev = n;
    }
    html += `<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">Next \u203a</button>`;
    html += `<span class="db-pager__info">${shown.length.toLocaleString()} scholars \u00b7 page ${page} of ${pages}</span>`;
    el.innerHTML = html;
  }

  // ---- Region -> Country fly-out menus (Work region, Study region) ----
  function menuData(k) {
    const groups = new Map(REGIONS.map(r => [r, new Map()]));
    let none = 0;
    for (const s of S) {
      if (k === 'work') {
        if (!s.wr) { none++; continue; }
        if (!groups.has(s.wr)) groups.set(s.wr, new Map());
        const g = groups.get(s.wr); g.set(s.wc, (g.get(s.wc) || 0) + 1);
      } else {
        for (const v of s.sc || []) { const [r, c] = v.split('|'); if (!groups.has(r)) groups.set(r, new Map()); const g = groups.get(r); g.set(c, (g.get(c) || 0) + 1); }
      }
    }
    const total = r => k === 'work' ? S.filter(s => s.wr === r).length : S.filter(s => (s.r || []).includes(r)).length;
    return { groups: [...groups].filter(([, m]) => m.size).map(([r, m]) => ({ r, n: total(r), cs: [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) })), none };
  }
  function buildMenu(k) {
    const box = q(MENUS[k]); const { groups, none } = menuData(k);
    const all = k === 'work' ? 'All work regions' : 'All study regions';
    box.innerHTML = `<button type="button" class="cmenu__btn db-filter" aria-haspopup="menu" aria-expanded="false"><span class="cmenu__val">${all}</span><span class="cmenu__chev" aria-hidden="true">\u25be</span></button>
      <div class="cmenu__pop" role="menu" hidden>
        <button type="button" role="menuitem" class="cmenu__item" data-v="">${all}</button>
        ${groups.map(g => `<div class="cmenu__row">
          <button type="button" role="menuitem" class="cmenu__item cmenu__reg" aria-haspopup="menu" aria-expanded="false" data-reg="${esc(g.r)}"><span>${esc(g.r)}</span><span class="cmenu__n">${g.n.toLocaleString()}</span><span class="cmenu__arrow" aria-hidden="true">\u203a</span></button>
          <div class="cmenu__sub" role="menu" hidden>
            <button type="button" role="menuitem" class="cmenu__item cmenu__item--all" data-v="${esc(g.r)}">All of ${esc(g.r)}<span class="cmenu__n">${g.n.toLocaleString()}</span></button>
            ${g.cs.map(([c, n]) => `<button type="button" role="menuitem" class="cmenu__item" data-v="${esc(g.r + '|' + c)}">${esc(c)}<span class="cmenu__n">${n.toLocaleString()}</span></button>`).join('')}
          </div></div>`).join('')}
        ${k === 'work' && none ? `<button type="button" role="menuitem" class="cmenu__item" data-v="${NONE}">Not recorded<span class="cmenu__n">${none.toLocaleString()}</span></button>` : ''}
      </div>`;
    const btn = box.querySelector('.cmenu__btn'), pop = box.querySelector('.cmenu__pop');
    const closeSubs = except => box.querySelectorAll('.cmenu__reg').forEach(r => { if (r !== except) { r.setAttribute('aria-expanded', 'false'); r.nextElementSibling.hidden = true; r.closest('.cmenu__row').classList.remove('is-open'); } });
    const openSub = reg => {
      closeSubs(reg);
      const sub = reg.nextElementSibling; sub.hidden = false; reg.setAttribute('aria-expanded', 'true'); reg.closest('.cmenu__row').classList.add('is-open');
      sub.classList.remove('to-left', 'inline');
      if (innerWidth < 640) sub.classList.add('inline');
      else if (sub.getBoundingClientRect().right > innerWidth - 8) sub.classList.add('to-left');
    };
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); closeSubs(); };
    box._close = close;
    btn.addEventListener('click', () => { const open = pop.hidden; document.querySelectorAll('#ps-dir .cmenu').forEach(m => m._close && m._close()); if (open) { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); pop.style.left = ''; pop.style.right = ''; if (pop.getBoundingClientRect().right > innerWidth - 8) { pop.style.left = 'auto'; pop.style.right = '0'; } const cur = F[k] && F[k] !== NONE ? box.querySelector(`.cmenu__reg[data-reg="${CSS.escape(F[k].split('|')[0])}"]`) : null; if (cur) openSub(cur); (pop.querySelector('.cmenu__item')).focus(); } });
    box.querySelectorAll('.cmenu__reg').forEach(reg => {
      reg.addEventListener('click', () => (reg.getAttribute('aria-expanded') === 'true' && innerWidth < 640) ? closeSubs() : openSub(reg));
      reg.addEventListener('mouseenter', () => { if (matchMedia('(hover:hover)').matches && innerWidth >= 640) openSub(reg); });
      reg.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); openSub(reg); reg.nextElementSibling.querySelector('.cmenu__item').focus(); } });
    });
    box.querySelectorAll('.cmenu__sub').forEach(sub => sub.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); const reg = sub.previousElementSibling; closeSubs(); reg.focus(); } }));
    pop.addEventListener('click', e => { const it = e.target.closest('[data-v]'); if (!it) return; F[k] = it.dataset.v; F.only = ''; clearHash(); close(); btn.focus(); render(); });
    pop.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const scope = e.target.closest('.cmenu__sub') || pop;
        const items = [...scope.querySelectorAll(':scope > .cmenu__item, :scope > .cmenu__row > .cmenu__reg')].filter(x => x.offsetParent !== null);
        const i = items.indexOf(e.target); const nx = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; nx && nx.focus();
      }
    });
  }
  function syncMenu(k) {
    const box = q(MENUS[k]); if (!box) return;
    const v = F[k];
    box.querySelector('.cmenu__val').textContent = v ? regionLabel(v) : (k === 'work' ? 'All work regions' : 'All study regions');
    box.querySelectorAll('[data-v]').forEach(it => it.classList.toggle('is-current', it.dataset.v === v));
    box.classList.toggle('is-set', !!v);
  }

  const toast = msg => { const t = q('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3600); };

  function readHash() {
    const m = /(?:^|[#&])dir=([A-Z]{3}-S\d+)/i.exec(location.hash);
    return m && S.some(s => s.id === m[1].toUpperCase()) ? m[1].toUpperCase() : '';
  }
  function clearHash() {
    if (/dir=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }

  function setup() {
    const countries = order.filter(c => C[c]);
    const n = c => S.filter(s => s.c === c).length;
    q('kpis').innerHTML = `<span><svg class="kpi-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg><b>${S.length.toLocaleString()}</b>scholars in the directory</span><span><svg class="kpi-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C7.58 2 4 3.57 4 5.5v13C4 20.43 7.58 22 12 22s8-1.57 8-3.5v-13C20 3.57 16.42 2 12 2zm6 16.5c-.4.6-2.6 1.5-6 1.5s-5.6-.9-6-1.5v-2.23c1.52.8 3.69 1.23 6 1.23s4.48-.43 6-1.23v2.23zm0-4.5c-.4.6-2.6 1.5-6 1.5S6.4 14.6 6 14v-2.23c1.52.8 3.69 1.23 6 1.23s4.48-.43 6-1.23V14zm-6-3.5c-3.4 0-5.6-.9-6-1.5V7.27C7.52 8.07 9.69 8.5 12 8.5s4.48-.43 6-1.23V9c-.4.6-2.6 1.5-6 1.5zm0-4C8.6 6.5 6.4 5.6 6 5.5 6.4 4.9 8.6 4 12 4s5.6.9 6 1.5c-.4.1-2.6 1-6 1z"/></svg><b>${countries.length}</b>country databases</span><span><svg class="kpi-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 3H3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 13H3V5h18v11z"/></svg><b>${countries.filter(c => C[c].dashboard).length}</b>with a live country dashboard</span>`;
    q('f-country').innerHTML = '<option value="">All countries</option>' + countries.map(c => `<option value="${c}">${esc(C[c].name)} (${n(c)})</option>`).join('');
    q('f-disc').innerHTML = '<option value="">All disciplines</option>' + (window.PSDirectoryDisciplines || []).map(d => `<option>${esc(d)}</option>`).join('');
    for (const k of Object.keys(MENUS)) buildMenu(k);
    document.addEventListener('click', e => { if (!e.target.closest('#ps-dir .cmenu')) root.querySelectorAll('.cmenu').forEach(m => m._close && m._close()); });
    q('f-sector').innerHTML = '<option value="">All sectors</option>' + SECTORS.map(d => `<option>${esc(d)}</option>`).join('');
    const withEx = S.filter(s => X[s.id] && String(X[s.id].sm || '').trim()).length;
    if (q('f-expl')) q('f-expl').innerHTML = `<option value="">All scholars</option><option value="yes">Explanation recorded (${withEx.toLocaleString()})</option><option value="no">Not yet recorded (${(S.length - withEx).toLocaleString()})</option>`;
    if (q('sort')) q('sort').addEventListener('change', e => { SORT = e.target.value; render(); });
    for (const [k, id] of Object.entries(IDS)) q(id).addEventListener(k === 'q' ? 'input' : 'change', e => { F[k] = e.target.value.trim(); F.only = ''; clearHash(); render(); });
    q('clear').addEventListener('click', () => { for (const [k, id] of Object.entries(IDS)) { F[k] = ''; q(id).value = ''; } F.work = F.region = ''; F.only = ''; clearHash(); render(); });
    q('chips').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; const k = b.dataset.rm; F[k] = ''; if (IDS[k]) q(IDS[k]).value = ''; if (k === 'only') clearHash(); render(); });
    q('pager').addEventListener('click', e => {
      const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
      page = +b.dataset.page; render(true);
      q('resultbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const act = q('pager').querySelector(`[data-page="${page}"].is-active`); act && act.focus({ preventScroll: true });
    });
    q('grid').addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.closest('.db-scholar-card__photo')) e.target.remove(); }, true);
    const searchKw = k => { q('q').value = k; F.q = k; F.only = ''; clearHash(); render(); q('resultbar').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    q('grid').addEventListener('keydown', e => { const t = e.target.closest('[data-kw]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); searchKw(t.dataset.kw); } });
    q('grid').addEventListener('click', async e => {
      const ib = e.target.closest('[data-insight-btn]');
      if (ib) { const open = ib.getAttribute('aria-expanded') === 'true'; ib.setAttribute('aria-expanded', open ? 'false' : 'true'); document.getElementById(ib.getAttribute('aria-controls')).hidden = open; return; }
      const kwt = e.target.closest('[data-kw]'); if (kwt) { searchKw(kwt.dataset.kw); return; }
      const sh = e.target.closest('[data-share]'); if (!sh || sh.disabled) return;
      const s = S.find(x => x.id === sh.dataset.share); if (!s) return;
      const url = regionalCardUrl(s);
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch (_) {
        const f = document.createElement('textarea'); f.value = url; f.setAttribute('readonly', ''); f.style.position = 'fixed'; f.style.opacity = '0';
        document.body.appendChild(f); f.select(); try { ok = document.execCommand('copy'); } catch (_) { ok = false; } f.remove();
      }
      if (!ok) { window.prompt('Copy this link:', url); return; }
      // Same feedback as the country dashboard cards: green "Copied", then back to the red Share button.
      clearTimeout(sh._copyT);
      sh.classList.add('is-copied'); sh.innerHTML = `${SHARE}<span>Copied</span>`; sh.setAttribute('aria-label', 'Link copied to clipboard');
      sh._copyT = setTimeout(() => { sh.classList.remove('is-copied'); sh.innerHTML = `${SHARE}<span>Share</span>`; sh.setAttribute('aria-label', "Copy a link to this scholar's card on the regional dashboard"); }, 1600);
    });
    q('lkey').innerHTML = Object.entries(LOCAL).map(([c, L]) => `<div class="lk"><div class="lk-h"><img src="img/regional/flags/${c.toLowerCase()}.png" alt="">${esc(C[c] ? C[c].name : c)}<span>Same as the ${esc(L.src)}</span></div><div class="lk-f">Field: ${esc(L.field)}</div><div class="lk-c">${Object.entries(L.map).map(([k, [f, t]]) => `<span class="lchip" style="background:linear-gradient(135deg,${f},${t});color:${L.ink}">${esc(L.fmt(k))}</span>`).join('')}</div></div>`).join('');
    q('lkey-none').textContent = `No local label shown: ${countries.filter(c => !LOCAL[c]).map(c => C[c].name).join(', ')}.`;
    addEventListener('hashchange', () => { const id = readHash(); if (id) { F.only = id; render(); focusTarget(); } });
  }
  function focusTarget() {
    const el = q('grid').querySelector('.db-scholar-card');
    if (!el) return;
    el.classList.add('is-target');
    if (/(?:^|[#&])explain=1(?:&|$)/.test(location.hash)) {
      const ib = el.querySelector('[data-insight-btn]');
      if (ib && ib.getAttribute('aria-expanded') !== 'true') { ib.setAttribute('aria-expanded', 'true'); const pnl = document.getElementById(ib.getAttribute('aria-controls')); if (pnl) pnl.hidden = false; }
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function init(D) {
    root = document.getElementById('ps-dir');
    const panel = document.getElementById('ps-dir-panel');
    if (!root || !panel || !D || !D.directory) return;
    try {
      const dir = await unpack(D.directory);
      S = dir.scholars || []; P = dir.pubs || []; X = D.cardExtras || {}; POS = D.posCards || {};
      // Rule: like the country cards, only the six main publication types count.
      // Other outputs (conference papers, misc, unpublished, etc.) are left out of
      // card totals, first-authored counts, chips, sorting, search and Panel E.
      const MAIN = i => P[i] && TYPE[P[i].t] && P[i].t !== 'other';
      S.forEach(s => { s.p = (s.p || []).filter(MAIN); s.f = (s.f || []).filter(MAIN); s.fa = s.f.length; });
      order = (D.countries || []).map(c => c.code);
      // Most publications first; ties by first-authored count, then country order
      // and family name (the build's order).
      S.forEach((s, i) => { s._o = i; });
      S.sort((a, b) => (b.p || []).length - (a.p || []).length || (b.fa || 0) - (a.fa || 0) || a._o - b._o);
      C = Object.fromEntries((D.countries || []).map(c => [c.code, c]));
      window.PSDirectoryDisciplines = D.disciplineCategories || [];
      // Panel E (Publications) lists the same linked publications.
      if (window.PSPublications) { try { window.PSPublications.init({ S, P, C, order, TYPE }); } catch (e) { console.error(e); } }
      panel.hidden = false;
      setup();
      const id = readHash();
      if (id) F.only = id;
      render();
      if (id) focusTarget();
    } catch (err) {
      panel.hidden = false;
      root.innerHTML = `<p class="dir__intro">${esc(err.message || 'The directory could not be opened.')}</p>`;
    }
  }
  // Panel B1 uses the same profile photo as the country card, for the four
  // live dashboards only. A unique name match is required so a shared family
  // name never shows the wrong person.
  const DASH_PHOTO = new Set(['FJI', 'TON', 'SLB', 'VUT']);
  const bare = person => fold(person).replace(/^(dr|mr|ms|prof|sir)\s+/, '');
  function scholarPhoto(code, person) {
    if (!DASH_PHOTO.has(code)) return '';
    const want = bare(person).split(/\s+/).filter(Boolean);
    if (want.length < 2) return '';
    const given = want[0], fam = want.slice(1);
    const hits = S.filter(s => {
      if (s.c !== code) return false;
      const toks = fold(s.n).split(/[^a-z0-9]+/).filter(Boolean);
      if (!toks.includes(given) || toks.length < fam.length) return false;
      return fam.every((t, i) => toks[toks.length - fam.length + i] === t);
    });
    if (hits.length !== 1) return '';
    const s = hits[0];
    const ex = X[s.id] && X[s.id].ph;
    if (ex) return ex;
    const file = window.PSFirstsById && window.PSFirstsById[s.id];
    if (file) return file;
    return s.ph || '';
  }
  // Panel B1 list: link a first to the directory card only on a unique name match.
  function findId(code, person) {
    const want = bare(person).split(/\s+/).filter(Boolean);
    if (want.length < 2) return '';
    const given = want[0], fam = want.slice(1);
    const hits = S.filter(s => {
      if (s.c !== code) return false;
      const toks = fold(s.n).split(/[^a-z0-9]+/).filter(Boolean);
      if (!toks.includes(given) || toks.length < fam.length) return false;
      return fam.every((t, i) => toks[toks.length - fam.length + i] === t);
    });
    return hits.length === 1 ? hits[0].id : '';
  }
  window.PSDirectory = { init, scholarPhoto, findId, scholars: () => S };
})();
