/* Panel A4 "Celebrating <people> scholars" + scholar-card "In the news".
 *
 * Reads the encrypted News snapshot written by the Master-file refresh
 * (scripts/country_news.py) through the page's passcode gate, then:
 *   1. fills the A4 panel ([data-news-panel]) with a featured story that
 *      rotates every 8 seconds, beside a clickable list of stories;
 *   2. adds an "In the news" toggle to every Panel F scholar card that has
 *      published stories.
 * Stories are curated by hand in the Master's News tab. The panel stays
 * hidden until the gate has unlocked at least one story.
 *
 * Configured from its own <script> tag:
 *   data-src  snapshot URL (plaintext name; the gate maps it to .enc)
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var SRC = (me && me.dataset.src) || '';
  if (!SRC) return;
  var ROTATE_MS = 8000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var N = null, bySid = {}, loading = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  function initials(name) {
    return String(name || '').replace(/^(Dr|Rev Dr|Rev|Prof|Professor|Mr|Mrs|Ms)\s+/i, '')
      .split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  // Outlet image when it loads; initials otherwise.
  function imgHtml(it, cls) {
    var ini = '<span class="' + cls + '__ini">' + esc(initials(it.name)) + '</span>';
    if (!it.img) return '<span class="' + cls + ' is-ini">' + ini + '</span>';
    return '<span class="' + cls + '">' + ini + '<img src="' + esc(it.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>';
  }

  function load() {
    if (N) return Promise.resolve(N);
    if (loading) return loading;
    var gate = window.dbGate || window.demoGate;
    if (!gate || typeof gate.fetchJson !== 'function') return Promise.reject(new Error('no gate'));
    loading = gate.fetchJson(SRC).then(function (doc) {
      if (!doc || !Array.isArray(doc.items)) throw new Error('bad news snapshot');
      N = doc; bySid = {};
      doc.items.forEach(function (it) { (bySid[it.sid] = bySid[it.sid] || []).push(it); });
      return N;
    }).catch(function (e) { loading = null; throw e; });
    return loading;
  }

  // ------------------------------------------------------------ open card
  function openCard(it) {
    var input = document.querySelector('[data-scholar-name-search]');
    var sel = '.db-scholar-card[data-scholar-id="' + it.sid + '"]';
    function reveal() {
      var card = document.querySelector(sel);
      if (!card) return false;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('nw-flash');
      setTimeout(function () { card.classList.remove('nw-flash'); }, 2200);
      return true;
    }
    if (input) {
      input.value = it.full || it.name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var tries = 0;
      (function wait() { if (!reveal() && ++tries < 20) setTimeout(wait, 150); })();
    } else {
      reveal();
    }
  }

  // ------------------------------------------------------------ A4 panel
  var A = { i: 0, timer: null, paused: false, root: null };

  function feature(it) {
    var credit = it.credit ? '<span class="nw__credit">Photo: ' + esc(it.credit) + '</span>' : '';
    return '<div class="nw__img-wrap">' + imgHtml(it, 'nw__img') + credit + '</div>' +
      '<div class="nw__body">' +
      '<span class="nw__chip nw__chip--' + esc(it.cat) + '">' + esc(it.cat) + '</span>' +
      '<h3 class="nw__title">' + esc(it.head) + '</h3>' +
      '<div class="nw__meta">' + [it.name, it.outlet, fmtDate(it.date)].filter(Boolean).map(esc).join(' · ') + '</div>' +
      (it.sum ? '<p class="nw__sum">' + esc(it.sum) + '</p>' : '') +
      (it.also ? '<div class="nw__also">Also covered by ' + esc(it.also) + '</div>' : '') +
      '<div class="nw__acts">' +
      '<a class="nw__a nw__a--p" href="' + esc(it.url) + '" target="_blank" rel="noopener">Read at ' + esc(it.outlet || 'source') + '</a>' +
      '<button type="button" class="nw__a" data-nw-open>Open scholar card</button>' +
      '</div></div>';
  }

  function show(i) {
    var items = N.items, root = A.root;
    A.i = (i + items.length) % items.length;
    var it = items[A.i];
    var feat = root.querySelector('.nw__feat');
    feat.innerHTML = feature(it);
    feat.querySelector('[data-nw-open]').addEventListener('click', function () { openCard(it); });
    root.querySelectorAll('.nw__li').forEach(function (b, k) {
      b.classList.toggle('is-on', k === A.i);
      b.setAttribute('aria-current', k === A.i ? 'true' : 'false');
    });
    root.querySelectorAll('.nw__dot').forEach(function (d, k) { d.classList.toggle('is-on', k === A.i); });
  }

  function schedule() {
    clearInterval(A.timer);
    if (A.paused || N.items.length < 2) return;
    A.timer = setInterval(function () { show(A.i + 1); }, ROTATE_MS);
  }

  function buildPanel() {
    var root = document.querySelector('[data-news-panel]');
    if (!root || !N.items.length || root.dataset.built) return;
    root.dataset.built = '1';
    A.root = root;
    var items = N.items, many = items.length > 1;
    root.querySelector('[data-news-body]').innerHTML =
      '<div class="nw__grid"><div class="nw__main"><div class="nw__feat" aria-live="polite"></div>' +
      (many ? '<div class="nw__dots" aria-hidden="true">' + items.map(function () { return '<span class="nw__dot"></span>'; }).join('') + '</div>' : '') +
      '</div><div class="nw__list">' +
      items.map(function (it, k) {
        return '<button type="button" class="nw__li" data-k="' + k + '">' + imgHtml(it, 'nw__av') +
          '<span class="nw__li-text"><span class="nw__lt">' + esc(it.name) + ' · ' + esc(it.cat) + '</span>' +
          '<span class="nw__ls">' + [it.outlet, fmtDate(it.date)].filter(Boolean).map(esc).join(' · ') + '</span></span></button>';
      }).join('') +
      '<p class="nw__foot">Stories are reviewed before they appear. Suggest a story: <a href="mailto:ronvave@hawaii.edu">ronvave@hawaii.edu</a></p>' +
      '</div></div>';
    var ctrls = root.querySelector('.nw__ctrls');
    if (many) {
      ctrls.hidden = false;
      ctrls.querySelector('[data-nw-prev]').addEventListener('click', function () { show(A.i - 1); schedule(); });
      ctrls.querySelector('[data-nw-next]').addEventListener('click', function () { show(A.i + 1); schedule(); });
      var pause = ctrls.querySelector('[data-nw-pause]');
      pause.addEventListener('click', function () {
        A.paused = !A.paused;
        pause.textContent = A.paused ? 'Play' : 'Pause';
        pause.setAttribute('aria-pressed', A.paused ? 'true' : 'false');
        schedule();
      });
      // Hovering or focusing the story holds it; leaving resumes the cycle.
      root.addEventListener('mouseenter', function () { clearInterval(A.timer); });
      root.addEventListener('mouseleave', schedule);
      root.addEventListener('focusin', function () { clearInterval(A.timer); });
      root.addEventListener('focusout', function (e) { if (!root.contains(e.relatedTarget)) schedule(); });
    }
    root.querySelectorAll('.nw__li').forEach(function (b) {
      b.addEventListener('click', function () { show(+b.dataset.k); schedule(); });
    });
    root.hidden = false;
    show(0);
    if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) schedule();
  }

  // ------------------------------------------------------------ cards
  function cardHtml(sid, rows) {
    var id = 'cnews-' + sid.replace(/[^A-Za-z0-9_-]/g, '_');
    var items = rows.map(function (it) {
      return '<li class="cnews-item"><span class="cnews-pill">' + esc(it.cat) + '</span>' +
        '<div class="cnews-item__text"><a class="cnews-item__title" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.head) + '</a>' +
        '<div class="cnews-item__sub">' + [it.outlet, fmtDate(it.date)].filter(Boolean).map(esc).join(' · ') + '</div></div></li>';
    }).join('');
    return '<button type="button" class="db-scholar-card__insight-btn cnews-btn" aria-expanded="false" aria-controls="' + id + '">' +
      '<span class="db-scholar-card__insight-btn-label">In the news</span>' +
      '<span class="db-scholar-card__insight-btn-tag">(' + rows.length + ')</span>' +
      '<span class="db-scholar-card__insight-btn-chev" aria-hidden="true">\u25be</span></button>' +
      '<div class="db-scholar-card__insight cnews-panel" id="' + id + '" hidden>' +
      '<div class="db-scholar-card__insight-heading">News stories about this scholar</div>' +
      '<ul class="cnews-list">' + items + '</ul></div>';
  }

  function decorate(card) {
    if (card.hasAttribute('data-cnews')) return;
    card.setAttribute('data-cnews', '');
    var sid = (card.dataset.scholarId || '').toUpperCase();
    var rows = sid && bySid[sid];
    if (!rows || !rows.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'cnews-wrap';
    wrap.innerHTML = cardHtml(sid, rows);
    var stats = card.querySelector('.db-scholar-card__stats');
    if (stats) card.insertBefore(wrap, stats); else card.appendChild(wrap);
    var btn = wrap.querySelector('.cnews-btn'), panel = wrap.querySelector('.cnews-panel');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.hidden = !open;
    });
    // Story links open the article without triggering the card's filter click.
    wrap.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function (ev) { ev.stopPropagation(); }); });
  }

  function decorateAll() {
    if (!N) return;
    document.querySelectorAll('.db-scholar-card[data-scholar-id]:not([data-cnews])').forEach(decorate);
  }

  // ------------------------------------------------------------ boot
  function start() {
    load().then(function () { buildPanel(); decorateAll(); })
      .catch(function () { /* gate locked or file not yet published: show nothing */ });
  }
  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType === 1 && (n.matches('.db-scholar-card') || (n.querySelector && n.querySelector('.db-scholar-card')))) {
          if (N) decorateAll(); else start();
          return;
        }
      }
    }
  });
  function boot() {
    mo.observe(document.body, { childList: true, subtree: true });
    if (document.querySelector('.db-scholar-card')) start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
