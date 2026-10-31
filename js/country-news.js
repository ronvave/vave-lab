/* Panel A3 "Celebrating <people> scholars" + scholar-card "In the news".
 *
 * Reads the encrypted News snapshot written by the Master-file refresh
 * (scripts/country_news.py) through the page's passcode gate, then:
 *   1. fills the A3 panel ([data-news-panel]) with a featured story that
 *      rotates every 8 seconds, beside a clickable list of stories;
 *   2. adds an "In the news" toggle to every Panel F scholar card that has
 *      published stories.
 * Stories are curated by hand in the Master's News tab; recent theses and
 * publications are added automatically from the Publications records
 * (the All view shows only the newest few of those). The panel stays
 * hidden until the gate has unlocked at least one story.
 *
 * Configured from its own <script> tag:
 *   data-src     snapshot URL (plaintext name; the gate maps it to .enc)
 *   data-submit  Apps Script endpoint that queues "Share a story" links
 *   data-people  word used in the form, e.g. "Tongan"
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var SRC = (me && me.dataset.src) || '';
  // Scholar photos (same sources as the Panel F cards): Admin enrichment
  // photo by Scholar ID, then the Master Scholars "Photo URL" column.
  var PHOTOS = (me && me.dataset.photos) || SRC.replace('master-news', 'scholar-enrichment');
  var ROSTER = (me && me.dataset.roster) || SRC.replace('master-news', 'master-scholars');
  var SUBMIT = (me && me.dataset.submit) || '';   // review-queue endpoint for "Share a story"
  var PEOPLE = (me && me.dataset.people) || 'our';
  var PLACE = (me && me.dataset.place) || 'the country';
  var FOOT_UNDER = !!(me && me.dataset.footUnder);  // note under the Pause row, list fills full height
  var EXAMPLE = (me && me.dataset.example) || 'Dr Suliana Mone';  // form placeholder name
  // Home-country flag shown before each scholar's name (img/regional/flags-square/<code>.svg).
  var FLAG = (me && me.dataset.flag) || '';
  // Stories by 2+ database scholars show every scholar's photo side by side
  // (up to 4 tiles; the last tile notes how many more). Opt-in per page.
  var SPLIT = !!(me && me.dataset.splitPhotos);
  var MAX_FACES = 4;
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
  function dateLabel(it) { return it.dlabel || fmtDate(it.date); }
  // Side list: first and last name of each person, e.g. "Suliana Mone".
  function shortName(name) {
    return String(name || '').split(/(, | and )/).map(function (part) {
      if (part === ', ' || part === ' and ' || part === 'others') return part;
      var w = part.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
      return w.length > 2 ? w[0] + ' ' + w[w.length - 1] : w.join(' ');
    }).join('');
  }
  // Publication-type pill colours match Panel G.
  function ptClass(sub) {
    var t = String(sub || '').toLowerCase();
    if (/chapter|section/.test(t)) return 'nw-pt--chapter';
    if (/^book/.test(t)) return 'nw-pt--book';
    if (/journal|article/.test(t)) return 'nw-pt--article';
    if (/phd|doctor/.test(t)) return 'nw-pt--phd';
    if (/master/.test(t)) return 'nw-pt--masters';
    if (/thesis|dissertation/.test(t)) return 'nw-pt--thesis';
    if (/report/.test(t)) return 'nw-pt--report';
    return '';
  }
  function inAll(it) { return !it.auto || it.inAll; }
  function initials(name) {
    // First and last name of the first person named, e.g. "SM" for
    // "Suliana Alouaivaha Mone"; okina and apostrophes are skipped.
    var w = String(name || '').split(/,| and /)[0].replace(/\([^)]*\)/g, ' ')
      .replace(/^\s*(Dr|Rev Dr|Rev|Prof|Professor|Mr|Mrs|Ms)\s+/i, '')
      .split(/\s+/).map(function (x) { return x.replace(/^[^A-Za-zÀ-ž]+/, ''); }).filter(Boolean);
    if (w.length > 2) w = [w[0], w[w.length - 1]];
    return w.map(function (x) { return x[0]; }).join('').toUpperCase();
  }
  // Outlet image when it loads; initials otherwise.
  function imgHtml(it, cls) {
    // The small list thumbnails keep single initials when nobody has a photo.
    if (it.faces && it.faces.length > 1 && (cls !== 'nw__av' || it.faces.some(function (x) { return x.img; }))) return splitHtml(it, cls);
    var ini = '<span class="' + cls + '__ini">' + esc(initials(it.name)) + '</span>';
    if (!it.img) return '<span class="' + cls + ' is-ini">' + ini + '</span>';
    return '<span class="' + cls + (it.portrait ? ' is-portrait' : '') + '">' + ini + '<img src="' + esc(it.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>';
  }

  // One tile per scholar: photo when it loads, initials otherwise.
  function splitHtml(it, cls) {
    var f = it.faces;
    // More scholars than tiles: those with photos take the tiles first.
    if (f.length > MAX_FACES) f = f.filter(function (x) { return x.img; }).concat(f.filter(function (x) { return !x.img; }));
    var shown = f.slice(0, MAX_FACES), more = f.length - shown.length;
    return '<span class="' + cls + ' is-portrait is-split nw-split--' + shown.length + '">' +
      shown.map(function (x, i) {
        var extra = (more > 0 && i === shown.length - 1) ? '<span class="nw-face__more">+' + more + '</span>' : '';
        return '<span class="nw-face"><span class="' + cls + '__ini">' + esc(initials(x.name)) + '</span>' +
          (x.img ? '<img src="' + esc(x.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') +
          extra + '</span>';
      }).join('') + '</span>';
  }

  // Stories without their own image show the scholar's profile photo.
  function addPhotos(gate, doc) {
    var need = doc.items.some(function (it) { return it.sid && !it.img; });
    if (!need) return Promise.resolve();
    var none = function () { return null; };
    return Promise.all([
      PHOTOS && PHOTOS !== SRC ? gate.fetchJson(PHOTOS).catch(none) : null,
      ROSTER && ROSTER !== SRC ? gate.fetchJson(ROSTER).catch(none) : null
    ]).then(function (r) {
      var enr = (r[0] && r[0].scholars) || {}, photo = {}, names = {};
      (Array.isArray(r[1]) ? r[1] : []).forEach(function (s) {
        var id = String(s && s['Scholar ID'] || '').toUpperCase();
        if (!id) return;
        var u = String(s['Photo URL'] || '').trim();
        if (u) photo[id] = u;
        // Roster names are "Family, Given"; tiles use "Given Family" initials.
        var nm = String(s['Scholar Name'] || s['Display Name'] || '');
        var m = /^([^,]+),\s*(.+)$/.exec(nm);
        names[id] = m ? m[2] + ' ' + m[1] : nm;
      });
      function photoOf(id) {
        var sid = String(id).toUpperCase(), e = enr[sid] || enr[id];
        return photo[sid] || (e && e.photo) || '';
      }
      doc.items.forEach(function (it) {
        if (it.img || !it.sid) return;
        var u = photoOf(it.sid);
        if (u) { it.img = u; it.portrait = true; }
        if (!SPLIT || !Array.isArray(it.sids) || it.sids.length < 2) return;
        var faces = it.sids.map(function (id) {
          return { img: photoOf(id), name: names[String(id).toUpperCase()] || '' };
        });
        it.faces = faces; it.portrait = true;
      });
    }).catch(function () {});
  }

  function load() {
    if (N) return Promise.resolve(N);
    if (loading) return loading;
    var gate = window.dbGate || window.demoGate;
    if (!gate || typeof gate.fetchJson !== 'function') return Promise.reject(new Error('no gate'));
    loading = gate.fetchJson(SRC).then(function (doc) {
      if (!doc || !Array.isArray(doc.items)) throw new Error('bad news snapshot');
      // Local preview only: sample events injected by the preview harness.
      if (typeof window.__VL_EVENT_SAMPLES === 'function') doc.items = window.__VL_EVENT_SAMPLES(doc.items, 'country').concat(doc.items);
      N = doc; bySid = {};
      doc.items.forEach(function (it) { if (it.sid && !it.auto) (bySid[it.sid] = bySid[it.sid] || []).push(it); });
      return addPhotos(gate, doc).then(function () { return N; });
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

  // ------------------------------------------------------------ look helpers
  // Small inline icons (decorative; buttons keep their text labels).
  function ico(name) {
    var P = {
      News: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2V5zm13 4h3v8a2 2 0 0 1-2 2h-1M7 8h7M7 11h7M7 14h4"/>',
      Thesis: '<path d="M2 9l10-5 10 5-10 5L2 9zm4 2.2V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.8M21 9v6"/>',
      Publication: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v17H5.5A1.5 1.5 0 0 1 4 18.5v-14zM20 4.5A1.5 1.5 0 0 0 18.5 3H13v17h5.5a1.5 1.5 0 0 0 1.5-1.5v-14z"/>',
      Event: '<path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h2M14 14h2M8 17h2"/>',
      ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
      card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14 10h4M14 13h4"/>',
      chev: '<path d="M9 5l7 7-7 7"/>',
      pause: '<path d="M9 5v14M15 5v14"/>',
      play: '<path d="M8 5l11 7-11 7z"/>',
      inst: '<path d="M3 9.5L12 4l9 5.5M4.5 10v8M9.5 10v8M14.5 10v8M19.5 10v8M3 20h18"/>'
    };
    return '<svg class="pn-ico pn-ico--' + name + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
  }
  function flag(cls) {
    if (!FLAG) return '';
    return '<img class="' + (cls || 'pn-flag') + '" src="img/regional/flags-square/' + esc(FLAG) + '.svg" alt="" width="18" height="18">';
  }
  // Scholar position and institution, from the same records as the Panel F cards.
  var PROF = null;
  function profiles() {
    if (PROF) return PROF;
    var st = window.__vavelabDbState, m = st && st.scholarProfilesByName;
    if (!m) return null;
    var vals = typeof m.values === 'function' ? Array.from(m.values()) : Object.keys(m).map(function (k) { return m[k]; });
    if (!vals.length) return null;
    PROF = {};
    vals.forEach(function (v) { if (v && v.scholarId) PROF[String(v.scholarId).toUpperCase()] = v; });
    return PROF;
  }
  // 3-letter country code for the institution, from the Panel F record's
  // institution country. Unknown or non-country values show no code.
  var ISO3 = { 'fiji': 'FJI', 'new zealand': 'NZL', 'aotearoa new zealand': 'NZL', 'australia': 'AUS', 'united states': 'USA', 'united states of america': 'USA', 'usa': 'USA',
    'tonga': 'TON', 'solomon islands': 'SLB', 'samoa': 'WSM', 'vanuatu': 'VUT', 'papua new guinea': 'PNG', 'kiribati': 'KIR', 'tuvalu': 'TUV', 'nauru': 'NRU',
    'cook islands': 'COK', 'niue': 'NIU', 'marshall islands': 'MHL', 'federated states of micronesia': 'FSM', 'palau': 'PLW', 'guam': 'GUM', 'new caledonia': 'NCL',
    'french polynesia': 'PYF', 'american samoa': 'ASM', 'united kingdom': 'GBR', 'uk': 'GBR', 'england': 'GBR', 'scotland': 'GBR', 'ireland': 'IRL', 'canada': 'CAN',
    'japan': 'JPN', 'china': 'CHN', 'taiwan': 'TWN', 'south korea': 'KOR', 'korea': 'KOR', 'india': 'IND', 'malaysia': 'MYS', 'singapore': 'SGP', 'indonesia': 'IDN',
    'philippines': 'PHL', 'thailand': 'THA', 'united arab emirates': 'ARE', 'switzerland': 'CHE', 'italy': 'ITA', 'germany': 'DEU', 'france': 'FRA', 'netherlands': 'NLD',
    'norway': 'NOR', 'sweden': 'SWE', 'denmark': 'DNK', 'spain': 'ESP', 'belgium': 'BEL', 'austria': 'AUT', 'cuba': 'CUB', 'south africa': 'ZAF', 'kenya': 'KEN', 'brazil': 'BRA' };
  function cc(pr) {
    var c = pr && String(pr.institutionCountry || '').split('/')[0].trim().toLowerCase();
    return (c && ISO3[c]) || '';
  }
  function profName(pr) {
    return pr ? String((pr.first || '') + ' ' + (pr.last || '')).replace(/\s+/g, ' ').trim() : '';
  }
  // One line per scholar under the title: flag, name (blue), position (brown
  // italic), institution badge. Same person once; up to 3 then "and N others".
  function peopleLine(it) {
    var P = profiles() || {};
    var ids = Array.isArray(it.sids) && it.sids.length ? it.sids : (it.sid ? [it.sid] : []);
    var seen = {}, rows = [];
    ids.forEach(function (id) {
      var k = String(id).toUpperCase();
      if (seen[k]) return; seen[k] = 1;
      rows.push(P[k] || null);
    });
    if (!rows.length) rows = [null];
    var shown = rows.slice(0, 3).map(function (pr, k) {
      var nm = profName(pr) || (k === 0 ? (it.full || it.name) : '');
      if (!nm) return '';
      var role = pr && pr.title, inst = pr && pr.institution;
      return '<span class="pn-person">' + flag('pn-flag pn-flag--m') + '<span><b class="pn-person__name">' + esc(nm) + '</b>' +
        (role ? ', <b><i>' + esc(role) + '</i></b>' : '') +
        (inst ? (role ? ', ' : ' ') + '<b class="pn-person__inst">' + esc(inst) + '</b>' + (cc(pr) ? ' <b class="pn-person__cc">(' + cc(pr) + ')</b>' : '') : '') + '</span></span>';
    });
    var rest = rows.length - shown.length;
    return shown.join('') + (rest > 0 ? '<span class="pn-person pn-person--more">and ' + rest + ' other' + (rest > 1 ? 's' : '') + '</span>' : '');
  }

  // ------------------------------------------------------------ A3 panel
  // Toggle groups. "All" plus one button per announcement type; a type with
  // no stories yet still shows, with an invitation to share one.
  var TYPES = [
    { key: 'all', label: 'All' },
    { key: 'News', label: 'News' },
    { key: 'Thesis', label: 'New theses', empty: 'No new theses posted yet.', note: 'New theses by ' + PEOPLE + ' scholars or about ' + PLACE + '.', auto: 'Theses added to the Publications records appear here automatically.' },
    { key: 'Publication', label: 'New publications', empty: 'No new publications posted yet.', note: 'New publications by ' + PEOPLE + ' scholars or about ' + PLACE + '.', auto: 'Publications by database scholars appear here automatically.' },
    { key: 'Event', label: 'Events', empty: 'No events posted yet.', note: 'Events include webinars, talks, workshops, conferences, launches and thesis defenses.' }
  ];
  var LABEL = { Thesis: 'New thesis', Publication: 'New publication', Defense: 'Thesis defense' };
  var TIMED = { Defense: 1, Event: 1 };
  function label(it) { return LABEL[it.cat] || it.cat; }
  // News, New theses and New publications: the selected button turns into a
  // dropdown of its sub-types (same as the Regional A2 panel).
  var SUB_LABEL = { Appointment: 'Appointments', Award: 'Awards', Graduation: 'Graduations', Milestone: 'Milestones', Research: 'Research', News: 'Other news' };
  function plural(v) {
    v = String(v).split(' ').map(function (w, i) { return i && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w; }).join(' ');
    return /thesis$/i.test(v) ? v.replace(/thesis$/i, 'theses') : (/s$/i.test(v) ? v : v + 's');
  }
  var PT_RANK = { 'nw-pt--phd': 0, 'nw-pt--masters': 1, 'nw-pt--article': 0, 'nw-pt--book': 1, 'nw-pt--chapter': 2 };
  function ptRank(v) { var r = PT_RANK[ptClass(v)]; return r === undefined ? 9 : r; }
  var SUBS = {
    News: { field: 'cat', all: 'News: all types', aria: 'News type', label: function (c) { return SUB_LABEL[c] || c; },
      rank: function (c) { var k = Object.keys(SUB_LABEL).indexOf(c); return k < 0 ? 99 : k; } },
    Thesis: { field: 'sub', all: 'New theses: all types', aria: 'Thesis type', label: plural, rank: ptRank },
    Publication: { field: 'sub', all: 'New publications: all types', aria: 'Publication type', label: plural, rank: ptRank },
    Event: { tags: function (it) { return window.VLEvent ? window.VLEvent.tags(it) : []; }, all: 'Events: all', aria: 'Event type',
      label: function (c) { return window.VLEvent ? window.VLEvent.tagLabel(c) : c; }, rank: function (c) { return window.VLEvent ? window.VLEvent.tagRank(c) : 0; } }
  };
  function subTags(sk, it) { return sk.tags ? sk.tags(it) : (it[sk.field] ? [it[sk.field]] : []); }
  var A = { i: 0, timer: null, paused: false, root: null, type: 'all', list: [], sub: '' };

  function typeOf(it) { var t = it.type || 'News'; return (t === 'Webinar' || t === 'Defense') ? 'Event' : t; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function isEvent(it) { return !!TIMED[typeOf(it)]; }
  function goLabel(it) {
    var t = typeOf(it);
    if (TIMED[t]) return 'Event details';
    if (t === 'Thesis') return 'View the thesis';
    if (t === 'Publication') return 'View the publication';
    return 'Read at ' + (it.outlet || 'source');
  }

  function feature(it) {
    if (it.ev && window.VLEvent) return window.VLEvent.feature(it, { ico: ico, imgHtml: imgHtml, peopleLine: peopleLine });
    var credit = it.credit ? '<span class="nw__credit">Photo: ' + esc(it.credit) + '</span>' : '';
    var ev = isEvent(it), soon = ev && it.date >= today();
    var pub = typeOf(it) === 'Publication';
    var meta = ev ? [it.when || dateLabel(it), it.where] : [it.outlet, dateLabel(it)];
    var go = goLabel(it);
    return '<div class="nw__img-wrap">' + imgHtml(it, 'nw__img') + credit + '</div>' +
      '<div class="nw__body">' +
      '<span class="nw__chips"><span class="nw__chip nw__chip--' + esc(it.cat) + '">' + esc(label(it)) + '</span>' +
      (soon ? '<span class="nw__chip nw__chip--soon">Upcoming</span>' : '') +
      (it.sub ? '<span class="nw__chip nw__chip--sub ' + ptClass(it.sub) + '">' + esc(it.sub) + '</span>' : '') + '</span>' +
      '<h3 class="nw__title">' + esc(it.head) + '</h3>' +
      '<div class="nw__meta pn-people">' + peopleLine(it) + '</div>' +
      '<div class="nw__meta">' + meta.filter(Boolean).map(function (m) { return pub && m === it.outlet ? '<i class="pn-outlet">' + esc(m) + '</i>' : esc(m); }).join(' · ') + '</div>' +
      (it.sum ? '<p class="nw__sum">' + esc(it.sum) + '</p>' : '') +
      (it.also ? '<div class="nw__also">Also covered by ' + esc(it.also) + '</div>' : '') +
      '<div class="nw__acts">' +
      '<a class="nw__a nw__a--p" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + ico(typeOf(it) === 'Publication' || typeOf(it) === 'Thesis' ? 'Publication' : 'News') + esc(go) + ico('ext') + '</a>' +
      (it.sid ? '<button type="button" class="nw__a" data-nw-open>' + ico('card') + 'Open scholar card</button>' : '') +
      '</div></div>';
  }

  function emptyFeature(t) {
    return '<div class="nw__empty"><p class="nw__empty-h">' + esc(t.empty || 'No stories yet.') + '</p>' +
      (t.note ? '<p>' + esc(t.note) + '</p>' : '') +
      (t.auto ? '<p>' + esc(t.auto) + '</p>' : '') +
      (t.key === 'Event' ? '<p>Know of one? Share the details, flyer or link, and a collaborator will review it before it appears here.</p>' +
        '<button type="button" class="nw__a nw__a--p" data-nw-share>Share an event</button></div>'
      : '<p>Know of one? Share the link and a collaborator will review it before it appears here.</p>' +
      '<button type="button" class="nw__a nw__a--p" data-nw-share>Share a story</button></div>');
  }

  function show(i) {
    var items = A.list, root = A.root, feat = root.querySelector('.nw__feat');
    if (!items.length) return;
    A.i = (i + items.length) % items.length;
    var it = items[A.i];
    feat.classList.remove('is-empty');
    feat.innerHTML = feature(it);
    if (it.ev && window.VLEvent) window.VLEvent.wireFeature(feat, it);
    var ob = feat.querySelector('[data-nw-open]');
    if (ob) ob.addEventListener('click', function () { openCard(it); });
    root.querySelectorAll('.nw__li').forEach(function (b, k) {
      b.classList.toggle('is-on', k === A.i);
      b.setAttribute('aria-current', k === A.i ? 'true' : 'false');
    });
    root.querySelectorAll('.nw__dot').forEach(function (d, k) { d.classList.toggle('is-on', k === A.i); });
    var on = root.querySelector('.nw__li.is-on'), box = root.querySelector('.nw__list-items');
    if (on && box && (on.offsetTop < box.scrollTop || on.offsetTop + on.offsetHeight > box.scrollTop + box.clientHeight)) {
      box.scrollTop = on.offsetTop - 8;
    }
  }

  function schedule() {
    clearInterval(A.timer);
    if (A.paused || A.list.length < 2) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    A.timer = setInterval(function () { show(A.i + 1); }, ROTATE_MS);
  }

  function listHtml(items) {
    return items.map(function (it, k) {
      var pub = typeOf(it) === 'Publication';
      return '<button type="button" class="nw__li" data-k="' + k + '">' + imgHtml(it, 'nw__av') +
        '<span class="nw__li-text"><span class="nw__lt">' + (FLAG ? '<span class="pn-lflags">' + flag('pn-flag pn-flag--s') + '</span>' : '') + (it.sub
          ? '<span class="pn-lname">' + esc(shortName(it.name)) + '</span> <span class="nw__lpill ' + ptClass(it.sub) + '">' + esc(it.sub) + '</span>'
          : '<span class="pn-lname">' + esc(it.name) + '</span> · ' + esc(it.ev && window.VLEvent ? window.VLEvent.listLabel(it) : label(it))) + '</span>' +
        '<span class="nw__ls">' + (it.ev && window.VLEvent ? [esc(window.VLEvent.listMeta(it))] : isEvent(it) ? [it.when || dateLabel(it), it.where].filter(Boolean).map(esc) : [it.outlet ? (pub ? '<i class="pn-outlet">' + esc(it.outlet) + '</i>' : esc(it.outlet)) : '', esc(dateLabel(it))].filter(Boolean)).join(' · ') + '</span></span>' + ico('chev') + '</button>';
    }).join('');
  }

  function setType(key, sub) {
    var root = A.root, t = TYPES.filter(function (x) { return x.key === key; })[0] || TYPES[0];
    A.type = t.key;
    A.sub = sub || '';
    A.list = t.key === 'all' ? N.items.filter(inAll) : N.items.filter(function (it) { return typeOf(it) === t.key; });
    root.querySelectorAll('[data-nw-type]').forEach(function (b) {
      var on = b.dataset.nwType === t.key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var sk = SUBS[t.key];
    root.querySelectorAll('.pn-sub').forEach(function (w) {
      var on = !!sk && w.dataset.pnSubFor === t.key;
      w.hidden = !on;
      root.querySelector('[data-nw-type="' + w.dataset.pnSubFor + '"]').hidden = on;
    });
    if (sk) {
      var subSel = root.querySelector('.pn-sub[data-pn-sub-for="' + t.key + '"] select');
      var sc = {};
      if (t.key === 'Event' && window.VLEvent) A.list = window.VLEvent.sort(A.list);
      A.list.forEach(function (it) { subTags(sk, it).forEach(function (v) { sc[v] = (sc[v] || 0) + 1; }); });
      if (A.sub && !sc[A.sub]) A.sub = '';
      var cats = Object.keys(sc).sort(function (x, y) { return sk.rank(x) - sk.rank(y) || sc[y] - sc[x] || (x < y ? -1 : 1); });
      subSel.innerHTML = '<option value="">' + esc(sk.all) + ' (' + A.list.length + ')</option>' + cats.map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === A.sub ? ' selected' : '') + '>' + esc(sk.label(c)) + ' (' + sc[c] + ')</option>';
      }).join('');
      if (A.sub) A.list = A.list.filter(function (it) { return subTags(sk, it).indexOf(A.sub) >= 0; });
    }
    var many = A.list.length > 1;
    root.querySelector('.nw__list-items').innerHTML = listHtml(A.list);
    root.querySelectorAll('.nw__li').forEach(function (b) {
      b.addEventListener('click', function () { show(+b.dataset.k); schedule(); });
    });
    root.querySelector('.nw__dots').innerHTML = many && A.list.length <= 15 ? A.list.map(function () { return '<span class="nw__dot"></span>'; }).join('') : '';
    root.querySelector('.nw__ctrls').hidden = !many;
    var feat = root.querySelector('.nw__feat');
    if (A.list.length) { show(0); }
    else {
      feat.classList.add('is-empty');
      feat.innerHTML = emptyFeature(t);
      feat.querySelector('[data-nw-share]').addEventListener('click', openForm);
    }
    schedule();
  }

  function buildPanel() {
    var root = document.querySelector('[data-news-panel]');
    if (!root || !N.items.length || root.dataset.built) return;
    root.dataset.built = '1';
    A.root = root;
    var counts = {};
    N.items.forEach(function (it) { counts[typeOf(it)] = (counts[typeOf(it)] || 0) + 1; });
    var share = SUBMIT ? '<button type="button" class="nw__share" data-nw-share>Share a story</button>' : '';
    var foot = '<p class="nw__foot">New theses and publications come from the database records. Shared stories are checked by a collaborator before they appear.' +
      (SUBMIT ? ' Know of a news story, new thesis or publication, or an event? <button type="button" class="nw__link" data-nw-share>Share the link</button>.' : '') +
      '</p>';
    if (FOOT_UNDER) root.classList.add('nw--foot-under');
    root.classList.add('cn');
    root.querySelector('[data-news-body]').innerHTML =
      '<div class="nw__bar"><div class="nw__types" role="group" aria-label="Show announcements">' +
      TYPES.map(function (t) {
        var n = t.key === 'all' ? N.items.filter(inAll).length : (counts[t.key] || 0);
        return '<button type="button" class="nw__type" data-nw-type="' + t.key + '" aria-pressed="false">' + (t.key === 'all' ? '' : ico(t.key)) + esc(t.label) +
          '<span class="nw__n">' + n + '</span></button>' +
          (SUBS[t.key] && n ? '<label class="pn-sub" data-pn-sub-for="' + t.key + '" hidden>' + ico(t.key) + '<select data-pn-sub aria-label="' + esc(SUBS[t.key].aria) + '"></select></label>' : '');
      }).join('') + '</div>' + share + '</div>' +
      '<div class="nw__grid"><div class="nw__main"><div class="pn-card"><div class="nw__feat" aria-live="polite"></div>' +
      '<div class="nw__under"><div class="nw__ctrls">' +
      '<button type="button" class="nw__btn" data-nw-prev aria-label="Previous story">&lsaquo;</button>' +
      '<button type="button" class="nw__pause" data-nw-pause aria-pressed="false" aria-label="Pause">' + ico('pause') + '</button>' +
      '<button type="button" class="nw__btn" data-nw-next aria-label="Next story">&rsaquo;</button></div>' +
      '<div class="nw__dots" aria-hidden="true"></div></div>' +
      (FOOT_UNDER ? foot : '') +
      '</div></div><div class="nw__list"><h3 class="pn-list__h">Latest from ' + esc(PEOPLE) + ' scholars</h3><div class="nw__list-items"></div>' +
      (FOOT_UNDER ? '' : foot) + '</div></div>';
    var ctrls = root.querySelector('.nw__ctrls');
    ctrls.querySelector('[data-nw-prev]').addEventListener('click', function () { show(A.i - 1); schedule(); });
    ctrls.querySelector('[data-nw-next]').addEventListener('click', function () { show(A.i + 1); schedule(); });
    var pause = ctrls.querySelector('[data-nw-pause]');
    pause.addEventListener('click', function () {
      A.paused = !A.paused;
      pause.innerHTML = ico(A.paused ? 'play' : 'pause');
      pause.setAttribute('aria-label', A.paused ? 'Play' : 'Pause');
      pause.setAttribute('aria-pressed', A.paused ? 'true' : 'false');
      schedule();
    });
    root.querySelectorAll('[data-nw-type]').forEach(function (b) {
      b.addEventListener('click', function () { setType(b.dataset.nwType); });
    });
    root.querySelectorAll('[data-pn-sub]').forEach(function (sel) {
      sel.addEventListener('change', function (e) { setType(A.type, e.target.value); });
    });
    root.querySelectorAll('.nw__bar [data-nw-share], .nw__foot [data-nw-share]').forEach(function (b) { b.addEventListener('click', openForm); });
    // Hovering or focusing the story holds it; leaving resumes the cycle.
    var grid = root.querySelector('.nw__grid');
    grid.addEventListener('mouseenter', function () { clearInterval(A.timer); });
    grid.addEventListener('mouseleave', schedule);
    grid.addEventListener('focusin', function () { clearInterval(A.timer); });
    grid.addEventListener('focusout', function (e) { if (!grid.contains(e.relatedTarget)) schedule(); });
    root.hidden = false;
    setType('all');
    // Positions and institutions come with the Panel F records; redraw once they are ready.
    if (!profiles()) {
      var tries = 0;
      (function wait() {
        if (profiles()) { if (A.list.length) show(A.i); return; }
        if (++tries < 40) setTimeout(wait, 500);
      })();
    }
  }

  // ------------------------------------------------------------ share form
  // Short public form: a link plus who sent it. It goes to the country's
  // review queue (Admin "News Story Submissions"); nothing is published
  // until a collaborator approves it.
  var F = null;
  function buildForm() {
    var d = document.createElement('dialog');
    d.className = 'nw-dlg';
    d.setAttribute('aria-labelledby', 'nw-dlg-h');
    d.innerHTML =
      '<form method="dialog" class="nw-form" novalidate>' +
      '<h2 id="nw-dlg-h">Share a story</h2>' +
      '<p class="nw-form__intro">Send us a link to a news story, new thesis, new publication or event, including thesis defenses. It should feature ' + esc(PEOPLE) + ' scholars, or for theses and publications, be by ' + esc(PEOPLE) + ' scholars or about ' + esc(PLACE) + '. A collaborator checks each link before it appears in this panel.</p>' +
      '<label><span>What is it?</span><select name="type"><option value="News">News story</option><option value="Thesis">New thesis</option><option value="Publication">New publication</option><option value="Event">Event (including webinars and thesis defenses)</option></select></label>' +
      '<label><span data-link-label>Link to the story or announcement <span class="nw-req">(required)</span></span><input name="articleUrl" type="url" maxlength="700" placeholder="https://"></label>' +
      '<label><span>Scholar(s) or author(s)</span><input name="scholars" type="text" maxlength="300" placeholder="For example, ' + EXAMPLE + '"></label>' +
      (window.VLEvent ? window.VLEvent.formHtml() : '') +
      '<div class="nw-form__row"><label><span>Your name <span class="nw-req">(required)</span></span><input name="submitterName" type="text" required maxlength="160" autocomplete="name"></label>' +
      '<label><span>Your email <span class="nw-req">(required)</span></span><input name="submitterEmail" type="email" required maxlength="240" autocomplete="email"></label></div>' +
      '<label><span>Anything we should know?</span><textarea name="note" rows="3" maxlength="800" placeholder="Optional"></textarea></label>' +
      '<label class="nw-hp" aria-hidden="true">Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label>' +
      '<p class="nw-form__small">Your email is only used if we need to ask about the link. It is never shown on the dashboard.</p>' +
      '<p class="nw-form__msg" role="status"></p>' +
      '<div class="nw-form__acts"><button type="button" class="nw__a" data-nw-cancel>Cancel</button><button type="submit" class="nw__a nw__a--p">Send link</button></div>' +
      '</form>';
    document.body.appendChild(d);
    var form = d.querySelector('form'), msg = d.querySelector('.nw-form__msg'), send = form.querySelector('[type=submit]');
    d._syncEv = window.VLEvent ? window.VLEvent.wire(form) : function () {};
    d.querySelector('[data-nw-cancel]').addEventListener('click', function () { d.close(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (send.dataset.done) { d.close(); return; }
      msg.className = 'nw-form__msg';
      var url = form.articleUrl.value.trim(), isEv = form.type.value === 'Event' && window.VLEvent;
      if ((!isEv || url) && !/^https?:\/\/\S+\.\S+/i.test(url)) { msg.textContent = 'Please paste the full web link, starting with https://'; msg.classList.add('is-err'); form.articleUrl.focus(); return; }
      var evErr = isEv && window.VLEvent.validate(form);
      if (evErr) { msg.textContent = evErr[1]; msg.classList.add('is-err'); var fe = form.querySelector('[name="' + evErr[0] + '"]'); if (fe) fe.focus(); return; }
      if (!form.submitterName.value.trim()) { msg.textContent = 'Please add your name.'; msg.classList.add('is-err'); form.submitterName.focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.submitterEmail.value.trim())) { msg.textContent = 'Please add a valid email.'; msg.classList.add('is-err'); form.submitterEmail.focus(); return; }
      send.disabled = true; msg.textContent = 'Sending…';
      var body = {
        action: 'submitNewsStory', articleUrl: url, type: form.type.value, scholars: form.scholars.value.trim(),
        submitterName: form.submitterName.value.trim(), submitterEmail: form.submitterEmail.value.trim(),
        note: form.note.value.trim(), website: form.website.value, elapsedMs: Date.now() - (F.opened || Date.now())
      };
      (isEv ? window.VLEvent.collect(form) : Promise.resolve(null))
        .then(function (ex) {
          if (ex) { body.event = ex.event; body.flyer = ex.flyer; body.qrImage = ex.qrImage; }
          return fetch(SUBMIT, { method: 'POST', credentials: 'omit', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
        })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (!r || r.status !== 'ok') throw new Error((r && r.reason) || 'not-sent');
          msg.textContent = r.duplicate ? 'Thank you. We already have this link, so there is nothing more to do.' : isEv ? 'Thank you. Your event has been sent for review.' : 'Thank you. Your link has been sent for review.';
          msg.classList.add('is-ok');
          ['articleUrl', 'scholars', 'note'].forEach(function (n) { form[n].value = ''; });
          if (isEv) { form.querySelectorAll('.ev-form input:not([type=radio]):not([type=checkbox]), .ev-form textarea').forEach(function (e) { e.value = ''; }); window.VLEvent.reset(form); }
          send.textContent = 'Close'; send.dataset.done = '1';
        })
        .catch(function (err) {
          var m = String(err && err.message || '');
          msg.textContent = /required|valid|blocked|tomorrow/i.test(m) ? m : 'The link could not be sent just now. Please try again later.';
          msg.classList.add('is-err');
        })
        .then(function () { send.disabled = false; });
    });
    return d;
  }
  function openForm() {
    if (!SUBMIT) return;
    if (!F) F = { dlg: buildForm() };
    var form = F.dlg.querySelector('form'), send = form.querySelector('[type=submit]');
    delete send.dataset.done; send.textContent = 'Send link';
    var msg = F.dlg.querySelector('.nw-form__msg'); msg.textContent = ''; msg.className = 'nw-form__msg';
    // The form opens on the type being viewed (Events tab -> Event).
    if (A.type && A.type !== 'all') form.type.value = A.type;
    if (F.dlg._syncEv) F.dlg._syncEv();
    F.opened = Date.now();
    clearInterval(A.timer);
    if (typeof F.dlg.showModal === 'function') F.dlg.showModal(); else F.dlg.setAttribute('open', '');
    F.dlg.addEventListener('close', schedule, { once: true });
    (form.type.value === 'Event' ? form.querySelector('[name=evTitle]') || form.articleUrl : form.articleUrl).focus();
  }

  // ------------------------------------------------------------ cards
  function cardHtml(sid, rows) {
    var id = 'cnews-' + sid.replace(/[^A-Za-z0-9_-]/g, '_');
    var items = rows.map(function (it) {
      return '<li class="cnews-item"><span class="cnews-pill">' + esc(label(it)) + '</span>' +
        '<div class="cnews-item__text"><a class="cnews-item__title" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.head) + '</a>' +
        '<div class="cnews-item__sub">' + (isEvent(it) ? [it.when || dateLabel(it), it.where] : [it.outlet, dateLabel(it)]).filter(Boolean).map(esc).join(' · ') + '</div></div></li>';
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
