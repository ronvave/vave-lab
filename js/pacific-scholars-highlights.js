/* Regional summary "Did you know" strip (approved Oct 31 2026): a rotating
   fact under "Across Our Sea of Islands", read from the encrypted regional
   bundle: Pacific Firsts (B1) and Vice-Chancellors / Chancellors (B2). */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE = { vc: 'Vice-Chancellor', chancellor: 'Chancellor' };
  let D, CN = {}, timer = null, facts = [], at = 0;

  const THE = new Set(['COK', 'SLB', 'MHL', 'FSM']);
  const cname = c => (THE.has(c) ? 'the ' : '') + (CN[c] || c);
  const flag = (c, cls) => `<img class="${cls}" src="img/regional/flags-rect/${c.toLowerCase()}.webp" alt="${esc(CN[c] || c)}" title="${esc(CN[c] || c)}" width="36" height="24">`;
  const dirIds = () => { try { return new Set((window.PSDirectory && window.PSDirectory.scholars() || []).map(s => s.id)); } catch (e) { return new Set(); } };
  const findId = (code, person) => { try { return (window.PSDirectory && window.PSDirectory.findId && window.PSDirectory.findId(code, person)) || ''; } catch (e) { return ''; } };
  const link = (id, label) => id ? `<a href="#dir=${esc(id)}" title="Open this scholar's card in the Regional Scholar Directory">${esc(label)}</a>` : `<b>${esc(label)}</b>`;
  const theUni = u => /^The /.test(u) ? 'the ' + u.slice(4) : (/^(University|Australian National|National University|Victoria University|École)/i.test(u) ? 'the ' : '') + u;
  // Where the university is, so readers know the country (skipped when the
  // name already says it).
  const UC = { US: 'the United States', USA: 'the United States', NZ: 'New Zealand', NZL: 'New Zealand', AU: 'Australia', AUS: 'Australia', UK: 'the United Kingdom', GB: 'the United Kingdom', GBR: 'the United Kingdom', FJ: 'Fiji', FJI: 'Fiji', CA: 'Canada', CAN: 'Canada', PG: 'Papua New Guinea', PNG: 'Papua New Guinea', MT: 'Malta', FR: 'France', FRA: 'France', WSM: 'Samoa', TON: 'Tonga', SLB: 'Solomon Islands', VUT: 'Vanuatu', PLW: 'Palau', FSM: 'the Federated States of Micronesia', MHL: 'the Marshall Islands', KIR: 'Kiribati', TUV: 'Tuvalu', COK: 'the Cook Islands', JP: 'Japan', JPN: 'Japan', GUM: 'Guam' };
  const ALIAS = { FSM: /micronesia|fsm/i };
  const where = (uni, cc) => {
    const c = UC[cc]; if (!c || !uni) return '';
    const bare = c.replace(/^the /, '');
    if (uni.toLowerCase().includes(bare.toLowerCase()) || (ALIAS[cc] && ALIAS[cc].test(uni))) return '';
    return ' in ' + c;
  };
  const uniOf = e => (e && e.u && e.u[0] && e.u[0][0]) || '';

  function stats() {
    return { S: (D.positions && D.positions.scholars) || [] };
  }

  // ---------- 2. Did you know ----------
  function buildFacts(t) {
    const out = [];
    const firstByCountry = {};
    D.firsts.filter(m => m.stage === 'phd').forEach(m => { if (!firstByCountry[m.code] || m.year < firstByCountry[m.code].year) firstByCountry[m.code] = m; });
    const mFirst = {};
    D.firsts.filter(m => m.stage === 'masters').forEach(m => { if (!mFirst[m.code] || m.year < mFirst[m.code].year) mFirst[m.code] = m; });
    D.firsts.forEach(m => {
      const deg = m.stage === 'phd' ? 'PhD' : "Master's degree";
      const earliest = (m.stage === 'phd' ? firstByCountry : mFirst)[m.code] === m;
      const who = m.gender === 'female' ? 'woman' : 'man';
      [{ person: m.person, uni: m.uni, uc: m.uc }].concat(m.also || []).forEach(p => {
        const id = findId(m.code, p.person);
        const what = earliest ? `earned the earliest recorded ${deg} from ${esc(cname(m.code))}` : `became the first recorded ${who} from ${esc(cname(m.code))} to earn a ${deg}`;
        out.push({ c: m.code, lead: earliest && m.stage === 'phd', y: m.year, html: `In ${m.year}, ${link(id, p.person)} ${what}, at ${esc(theUni(p.uni))}${esc(where(p.uni, p.uc))}.` });
      });
    });
    const ids = dirIds();
    t.S.forEach(s => ['vc', 'chancellor'].forEach(k => {
      const e = s.r[k]; if (!e || !uniOf(e)) return;
      const id = ids.has(s.id) ? s.id : '';
      out.push({ c: s.c, html: `${link(id, s.n)} of ${esc(cname(s.c))} ${e.cur ? 'serves' : 'has served'} as ${ROLE[k]} of ${esc(theUni(uniOf(e)))}${esc(where(uniOf(e), e.u[0][1]))}.` });
    }));
    // Mix the two kinds; the order changes each day, starting with the earliest PhD.
    const seed = Math.floor(Date.now() / 864e5);
    const rnd = i => { const x = Math.sin(seed * 9301 + i * 49297) * 233280; return x - Math.floor(x); };
    const li = out.reduce((b, f, i) => (f.lead && (b < 0 || f.y < out[b].y) ? i : b), -1);
    const lead = out.splice(Math.max(0, li), 1)[0];
    const rest = out.map((f, i) => [rnd(i), f]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    return [lead].concat(rest);
  }
  function showFact(i) {
    const el = document.getElementById('ps-hl-dyk'); if (!el || !facts.length) return;
    at = (i + facts.length) % facts.length;
    const f = facts[at];
    el.querySelector('.ps-hl-dyk__flag').outerHTML = flag(f.c, 'ps-hl-dyk__flag');
    el.querySelector('.ps-hl-dyk__txt').innerHTML = f.html;
    el.querySelector('.ps-hl-dyk__n').textContent = `${at + 1} of ${facts.length}`;
  }
  function start() { stop(); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => showFact(at + 1), 9000); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function renderDyk(t) {
    const el = document.getElementById('ps-hl-dyk'); if (!el) return;
    facts = buildFacts(t);
    if (!facts.length) { el.hidden = true; return; }
    if (!el.dataset.ready) {
      el.innerHTML = `<span class="ps-hl-dyk__lab">Did you know</span><img class="ps-hl-dyk__flag" alt=""><span class="ps-hl-dyk__txt" aria-live="polite"></span><span class="ps-hl-dyk__nav"><button type="button" data-dyk="-1" aria-label="Previous fact">&lsaquo;</button><span class="ps-hl-dyk__n"></span><button type="button" data-dyk="1" aria-label="Next fact">&rsaquo;</button></span>`;
      el.addEventListener('click', e => { const b = e.target.closest('[data-dyk]'); if (b) { showFact(at + Number(b.dataset.dyk)); start(); } });
      el.addEventListener('mouseenter', stop); el.addEventListener('mouseleave', start);
      el.addEventListener('focusin', stop); el.addEventListener('focusout', start);
      el.dataset.ready = '1';
    }
    el.hidden = false;
    showFact(at); start();
  }

  function render() {
    if (!D || !D.firsts) return;
    const t = stats();
    renderDyk(t);
  }

  function init(data) {
    D = data;
    (D.countries || []).forEach(c => { CN[c.code] = c.name; });
    (D.sources || []).forEach(s => { if (!CN[s.code]) CN[s.code] = s.name; });
    try { render(); } catch (e) { console.error(e); }
  }
  // Called again once the directory is decoded, so names link to scholar cards.
  function refresh() { try { render(); } catch (e) { console.error(e); } }
  window.PSHighlights = { init, refresh };
})();
