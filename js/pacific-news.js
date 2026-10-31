/* Regional Panel A2 "Celebrating Pasifika scholars".
 *
 * Same behaviour as the country "Celebrating ... scholars" panels (featured
 * story that rotates every 8 seconds, clickable list, type toggles, scholar
 * photos split when a story has 2+ scholars, Share a story form), plus:
 *   - an 11-country checklist with Check all and Clear all;
 *   - "Any checked country" or "Shared only" (stories with scholars from
 *     every checked country);
 *   - square flags on every story, lead database scholar's country first;
 *   - a stacked bar chart of stories by country and type;
 *   - Share a story routes to the chosen country's Admin review queue, or to
 *     the Fiji Admin queue for countries without a news queue yet.
 *
 * Data: D.news from the encrypted Regional bundle (scripts/regional_news.py).
 * Started by js/pacific-scholars.js: window.PSNews.init(D).
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var ROTATE_MS = 8000;
  var MAX_FACES = 4;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Countries with their own Admin "News Story Submissions" queue. Others go
  // to the Fiji queue, marked with the country, for the database owner.
  var QUEUES = {
    FJI: (me && me.dataset.submitFji) || '',
    TON: (me && me.dataset.submitTon) || '',
    SLB: (me && me.dataset.submitSlb) || ''
  };
  var ORDER = ['FJI', 'TON', 'SLB', 'WSM', 'VUT', 'TUV', 'KIR', 'PLW', 'COK', 'MHL', 'FSM'];
  var NAMES = { FJI: 'Fiji', TON: 'Tonga', SLB: 'Solomon Islands', WSM: 'Samoa', VUT: 'Vanuatu', TUV: 'Tuvalu',
    KIR: 'Kiribati', PLW: 'Palau', COK: 'Cook Islands', MHL: 'Marshall Islands', FSM: 'Federated States of Micronesia' };
  var SHORT = { FSM: 'FSM', MHL: 'Marshall Islands' };
  var AUTO_IN_ALL = { Publication: 5, Thesis: 3 };   // per lead country, as on the country panels

  var D = null, N = null, X = {}, DIR = {};
  var A = { i: 0, timer: null, paused: false, root: null, type: 'all', list: [], on: {}, shared: false, scale: 'count' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function flag(code, cls) {
    return '<img class="' + (cls || 'pn-flag') + '" src="img/regional/flags-square/' + code.toLowerCase() + '.svg" alt="' + esc(NAMES[code] || code) + '" title="' + esc(NAMES[code] || code) + '" width="18" height="18">';
  }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  function dateLabel(it) { return it.dlabel || fmtDate(it.date); }
  function shortName(name) {
    return String(name || '').split(/(, | and )/).map(function (part) {
      if (part === ', ' || part === ' and ' || part === 'others') return part;
      var w = part.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
      return w.length > 2 ? w[0] + ' ' + w[w.length - 1] : w.join(' ');
    }).join('');
  }
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
  function initials(name) {
    var w = String(name || '').split(/,| and /)[0].replace(/\([^)]*\)/g, ' ')
      .replace(/^\s*(Dr|Rev Dr|Rev|Prof|Professor|Mr|Mrs|Ms)\s+/i, '')
      .split(/\s+/).map(function (x) { return x.replace(/^[^A-Za-zÀ-ž]+/, ''); }).filter(Boolean);
    if (w.length > 2) w = [w[0], w[w.length - 1]];
    return w.map(function (x) { return x[0]; }).join('').toUpperCase();
  }

  // ------------------------------------------------------------ photos
  // Same sources as the Regional directory cards: Master photo, then the
  // country dashboard's Admin enrichment (cardExtras).
  function photoOf(sid) {
    var s = DIR[sid], ex = X[sid] || {};
    return (s && s.ph) || ex.ph || '';
  }
  function resolvePhotos() {
    N.items.forEach(function (it) {
      if (it.ownImg === undefined) it.ownImg = it.img || '';
      it.img = it.ownImg; it.portrait = false; it.faces = null;
      if (it.img || !it.ppl || !it.ppl.length) return;
      // One person listed in two databases (for example Fiji and Tonga) is one face.
      var seen = {}, faces = [];
      it.ppl.forEach(function (p) {
        var key = (p[2] || p[1]).toLowerCase();
        if (seen[key]) { if (!seen[key].img) seen[key].img = photoOf(p[1]); return; }
        seen[key] = { img: photoOf(p[1]), name: p[2], c: p[0] };
        faces.push(seen[key]);
      });
      var u = faces[0].img || '';
      if (u) { it.img = u; it.portrait = true; }
      if (faces.length > 1) { it.faces = faces; it.portrait = true; }
    });
  }
  function imgHtml(it, cls) {
    // The small list thumbnails keep single initials when nobody has a photo.
    if (it.faces && it.faces.length > 1 && (cls !== 'nw__av' || it.faces.some(function (x) { return x.img; }))) return splitHtml(it, cls);
    var ini = '<span class="' + cls + '__ini">' + esc(initials(it.full || it.name)) + '</span>';
    if (!it.img) return '<span class="' + cls + ' is-ini">' + ini + '</span>';
    return '<span class="' + cls + (it.portrait ? ' is-portrait' : '') + '">' + ini + '<img src="' + esc(it.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>';
  }
  function splitHtml(it, cls) {
    var f = it.faces;
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

  // ------------------------------------------------------------ filters
  // Small inline icons (decorative; buttons keep their text labels).
  function ico(name) {
    var P = {
      News: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2V5zm13 4h3v8a2 2 0 0 1-2 2h-1M7 8h7M7 11h7M7 14h4"/>',
      Thesis: '<path d="M2 9l10-5 10 5-10 5L2 9zm4 2.2V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.8M21 9v6"/>',
      Publication: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v17H5.5A1.5 1.5 0 0 1 4 18.5v-14zM20 4.5A1.5 1.5 0 0 0 18.5 3H13v17h5.5a1.5 1.5 0 0 0 1.5-1.5v-14z"/>',
      Event: '<path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h2M14 14h2M8 17h2"/>',
      check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
      clear: '<path d="M6 6l12 12M18 6L6 18"/>',
      ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
      card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14 10h4M14 13h4"/>',
      chev: '<path d="M9 5l7 7-7 7"/>',
      chart: '<path d="M5 20V12M10 20V7M15 20V10M20 20V4"/>',
      pause: '<path d="M9 5v14M15 5v14"/>',
      play: '<path d="M8 5l11 7-11 7z"/>',
      inst: '<path d="M3 9.5L12 4l9 5.5M4.5 10v8M9.5 10v8M14.5 10v8M19.5 10v8M3 20h18"/>'
    };
    return '<svg class="pn-ico pn-ico--' + name + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
  }
  var TYPES = [
    { key: 'all', label: 'All' },
    { key: 'News', label: 'News' },
    { key: 'Thesis', label: 'New theses', empty: 'No new theses for the checked countries yet.', auto: 'Theses added to the country Publications records appear here automatically.' },
    { key: 'Publication', label: 'New publications', empty: 'No new publications for the checked countries yet.', auto: 'Publications by database scholars appear here automatically.' },
    { key: 'Event', label: 'Events', empty: 'No events posted yet.', note: 'Events include webinars, talks, workshops, conferences, launches and thesis defenses.' }
  ];
  var TYPE_COLOR = { News: '#e39b2d', Thesis: '#228B22', Publication: '#0b7479', Event: '#7b4fb3' };
  var LABEL = { Thesis: 'New thesis', Publication: 'New publication', Defense: 'Thesis defense' };
  var TIMED = { Defense: 1, Event: 1 };
  // News sub-categories for the News type dropdown, in menu order.
  var SUB_LABEL = { Appointment: 'Appointments', Award: 'Awards', Graduation: 'Graduations', Milestone: 'Milestones', Research: 'Research', News: 'Other news' };
  function plural(v) {
    // Sentence case (Journal articles, PhD theses), keeping acronyms like PhD.
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
  function label(it) { return LABEL[it.cat] || it.cat; }
  function typeOf(it) { var t = it.type || 'News'; return (t === 'Webinar' || t === 'Defense') ? 'Event' : t; }
  function isEvent(it) { return !!TIMED[typeOf(it)]; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function checked() { return ORDER.filter(function (c) { return A.on[c]; }); }
  // Any: at least one checked country. Shared only: every checked country.
  function matches(it) {
    var sel = checked();
    if (!sel.length) return false;
    if (A.shared && sel.length > 1) return sel.every(function (c) { return it.c.indexOf(c) >= 0; });
    return it.c.some(function (c) { return A.on[c]; });
  }
  function filtered() { return N.items.filter(matches); }
  // "All" keeps every news story and event, plus the newest few theses and
  // publications for each lead country (country panels show the newest few).
  function allView(items) {
    var n = {};
    return items.filter(function (it) {
      if (!it.auto) return true;
      var k = it.c[0] + '|' + it.type;
      n[k] = (n[k] || 0) + 1;
      return n[k] <= (AUTO_IN_ALL[it.type] || 0);
    });
  }

  // ------------------------------------------------------------ story
  function goLabel(it) {
    var t = typeOf(it);
    if (TIMED[t]) return 'Event details';
    if (t === 'Thesis') return 'View the thesis';
    if (t === 'Publication') return 'View the publication';
    return 'Read at ' + (it.outlet || 'source');
  }
  function flagRow(it) {
    return '<span class="pn-flags">' + it.c.map(function (c, k) {
      return '<span class="pn-flagtag' + (k === 0 ? ' is-lead' : '') + '">' + flag(c) + esc(SHORT[c] || NAMES[c] || c) + '</span>';
    }).join('') + '</span>';
  }
  // One row per scholar: home-country flag + their institution (country name
  // if the directory has no institution). Same flag + institution shown once.
  function instRows(it) {
    var ppl = Array.isArray(it.ppl) && it.ppl.length ? it.ppl : it.c.map(function (c) { return [c, it.sid, it.name]; });
    var seen = {}, rows = [];
    ppl.forEach(function (p) {
      var key = p[1] || p[2];
      if (seen[key]) return; seen[key] = 1;
      var sc = DIR[p[1]] || {};
      rows.push([p[0], p[2], sc.inst || NAMES[p[0]] || p[0]]);
    });
    var more = rows.length > 4 ? rows.length - 4 : 0;
    return '<span class="pn-insts">' + rows.slice(0, 4).map(function (r, k) {
      return '<span class="pn-inst' + (k === 0 ? ' is-lead' : '') + '">' + flag(r[0], 'pn-flag pn-flag--m') +
        '<span><b class="pn-inst__name">' + esc(r[1]) + '</b>, ' + esc(r[2]) + '</span></span>';
    }).join('') + (more ? '<span class="pn-inst pn-inst--more">and ' + more + ' more</span>' : '') + '</span>';
  }
  // One line per scholar under the title: home-country flag, name (bold blue),
  // position (bold italic brown), institution (bold black). Same person once.
  function peopleLine(it) {
    var ppl = Array.isArray(it.ppl) && it.ppl.length ? it.ppl : it.c.slice(0, 1).map(function (c) { return [c, it.sid, it.name]; });
    var seen = {}, rows = [];
    ppl.forEach(function (p) {
      var key = p[1] || p[2];
      if (seen[key]) return; seen[key] = 1;
      rows.push(p);
    });
    var shown = rows.slice(0, 3).map(function (p) {
      var sc = DIR[p[1]] || {}, inst = sc.inst || NAMES[p[0]] || p[0];
      return '<span class="pn-person">' + flag(p[0], 'pn-flag pn-flag--m') + '<span><b class="pn-person__name">' + esc(p[2]) + '</b>' +
        (sc.role ? ', <b><i>' + esc(sc.role) + '</i></b>' : '') +
        (inst ? ' <b class="pn-person__inst">' + ico('inst') + esc(inst) + '</b>' : '') + '</span></span>';
    });
    var rest = rows.length - shown.length;
    return shown.join('') + (rest > 0 ? '<span class="pn-person pn-person--more">and ' + rest + ' other' + (rest > 1 ? 's' : '') + '</span>' : '');
  }
  function feature(it) {
    if (it.ev && window.VLEvent) return window.VLEvent.feature(it, { ico: ico, imgHtml: imgHtml, peopleLine: peopleLine });
    var credit = it.credit ? '<span class="nw__credit">Photo: ' + esc(it.credit) + '</span>' : '';
    var ev = isEvent(it), soon = ev && it.date >= today();
    var pub = typeOf(it) === 'Publication';
    var meta = ev ? [it.when || dateLabel(it), it.where] : [it.outlet, dateLabel(it)];
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
      '<a class="nw__a nw__a--p" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + ico(typeOf(it) === 'Publication' || typeOf(it) === 'Thesis' ? 'Publication' : 'News') + esc(goLabel(it)) + ico('ext') + '</a>' +
      (it.sid ? '<button type="button" class="nw__a" data-nw-open>' + ico('card') + 'Open scholar card</button>' : '') +
      '</div></div>';
  }
  function emptyFeature(t) {
    if (!checked().length) {
      return '<div class="nw__empty"><p class="nw__empty-h">No countries checked.</p><p>Check one or more countries above, or choose Check all.</p></div>';
    }
    if (A.shared && checked().length > 1) {
      return '<div class="nw__empty"><p class="nw__empty-h">No shared stories for these countries yet.</p>' +
        '<p>Shared only lists stories with scholars from every checked country. Switch to Any checked country to see each country\u2019s stories.</p></div>';
    }
    return '<div class="nw__empty"><p class="nw__empty-h">' + esc(t.empty || 'No stories for the checked countries yet.') + '</p>' +
      (t.note ? '<p>' + esc(t.note) + '</p>' : '') + (t.auto ? '<p>' + esc(t.auto) + '</p>' : '') +
      (t.key === 'Event' ? '<p>Know of one? Share the details, flyer or link, and a collaborator will review it before it appears here.</p>' +
        '<button type="button" class="nw__a nw__a--p" data-nw-share>Share an event</button></div>'
      : '<p>Know of one? Share the link and a collaborator will review it before it appears here.</p>' +
      '<button type="button" class="nw__a nw__a--p" data-nw-share>Share a story</button></div>');
  }

  function openCard(it) {
    var panel = document.getElementById('ps-dir-panel');
    var input = document.getElementById('psd-q');
    if (!input) return;
    input.value = it.full || it.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var tries = 0;
    (function wait() {
      var card = document.querySelector('#ps-dir .db-scholar-card[data-id="' + it.sid + '"]');
      if (!card) { if (++tries < 25) setTimeout(wait, 150); return; }
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('nw-flash');
      setTimeout(function () { card.classList.remove('nw-flash'); }, 2200);
    })();
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
      var flags = '<span class="pn-lflags">' + it.c.map(function (c) { return flag(c, 'pn-flag pn-flag--s'); }).join('') + '</span>';
      return '<button type="button" class="nw__li" data-k="' + k + '">' + imgHtml(it, 'nw__av') +
        '<span class="nw__li-text"><span class="nw__lt">' + flags + (it.sub
          ? '<span class="pn-lname">' + esc(shortName(it.name)) + '</span> <span class="nw__lpill ' + ptClass(it.sub) + '">' + esc(it.sub) + '</span>'
          : '<span class="pn-lname">' + esc(it.name) + '</span> · ' + esc(it.ev && window.VLEvent ? window.VLEvent.listLabel(it) : label(it))) + '</span>' +
        '<span class="nw__ls">' + (it.ev && window.VLEvent ? [esc(window.VLEvent.listMeta(it))] : isEvent(it) ? [it.when || dateLabel(it), it.where].filter(Boolean).map(esc) : [it.outlet ? (typeOf(it) === 'Publication' ? '<i class="pn-outlet">' + esc(it.outlet) + '</i>' : esc(it.outlet)) : '', esc(dateLabel(it))].filter(Boolean)).join(' · ') + '</span></span>' + ico('chev') + '</button>';
    }).join('');
  }

  // Recount the type toggles, rebuild the list and chart for the current filters.
  function refresh(keepStory) {
    var root = A.root, items = filtered();
    var counts = { all: allView(items).length };
    items.forEach(function (it) { counts[typeOf(it)] = (counts[typeOf(it)] || 0) + 1; });
    root.querySelectorAll('[data-nw-type]').forEach(function (b) {
      b.querySelector('.nw__n').textContent = counts[b.dataset.nwType] || 0;
    });
    var t = TYPES.filter(function (x) { return x.key === A.type; })[0] || TYPES[0];
    root.querySelectorAll('[data-nw-type]').forEach(function (b) {
      var on = b.dataset.nwType === t.key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var prev = keepStory && A.list[A.i];
    A.list = t.key === 'all' ? allView(items) : items.filter(function (it) { return typeOf(it) === t.key; });
    // News, New theses and New publications: the selected button turns into
    // a dropdown of its sub-types (News by category; theses and publications
    // by their type, e.g. PhD thesis, Journal article).
    var sk = SUBS[t.key];
    root.querySelectorAll('.pn-sub').forEach(function (w) {
      var on = !!sk && w.dataset.pnSubFor === t.key && A.list.length > 0;
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
    } else {
      A.sub = '';
    }
    var many = A.list.length > 1;
    root.querySelector('.nw__list-items').innerHTML = listHtml(A.list);
    root.querySelectorAll('.nw__li').forEach(function (b) {
      b.addEventListener('click', function () { show(+b.dataset.k); schedule(); });
    });
    root.querySelector('.nw__dots').innerHTML = many && A.list.length <= 15 ? A.list.map(function () { return '<span class="nw__dot"></span>'; }).join('') : '';
    root.querySelector('.nw__ctrls').hidden = !many;
    var feat = root.querySelector('.nw__feat');
    if (A.list.length) {
      var k = prev ? A.list.indexOf(prev) : -1;
      show(k >= 0 ? k : 0);
    } else {
      feat.classList.add('is-empty');
      feat.innerHTML = emptyFeature(t);
      var sb = feat.querySelector('[data-nw-share]');
      if (sb) sb.addEventListener('click', openForm);
    }
    syncChecks();
    chart();
    schedule();
  }
  function syncChecks() {
    var root = A.root, n = checked().length;
    root.querySelectorAll('[data-pn-c]').forEach(function (b) {
      var on = !!A.on[b.dataset.pnC];
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var multi = n > 1;
    root.querySelectorAll('[data-pn-mode]').forEach(function (b) {
      var on = (b.dataset.pnMode === 'shared') === (A.shared && multi);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = !multi;
    });
    root.querySelector('.pn-mode').classList.toggle('is-off', !multi);
    root.querySelector('.pn-mode__hint').textContent = multi
      ? (A.shared ? 'Stories with scholars from every checked country.' : 'Stories from any checked country.')
      : 'Check 2 or more countries to compare or find shared stories.';
  }

  // ------------------------------------------------------------ chart
  // One bar per country, stacked by story type. A story with scholars from
  // two countries counts for both. Unchecked countries are faded; clicking a
  // segment shows that country's stories of that type.
  function chart() {
    var box = A.root.querySelector('[data-pn-chart]');
    if (!box) return;
    var rows = ORDER.map(function (c) {
      var r = { c: c, n: { News: 0, Thesis: 0, Publication: 0, Event: 0 }, total: 0 };
      N.items.forEach(function (it) {
        if (it.c.indexOf(c) < 0) return;
        r.n[typeOf(it)] = (r.n[typeOf(it)] || 0) + 1;
        r.total++;
      });
      return r;
    }).sort(function (a, b) { return b.total - a.total || ORDER.indexOf(a.c) - ORDER.indexOf(b.c); });
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
    var keys = ['News', 'Thesis', 'Publication', 'Event'];
    var cname = function (c) { return c === 'FSM' ? 'FSM' : NAMES[c]; };
    // Column totals count each story once, even when it has scholars from two countries.
    var tot = { News: 0, Thesis: 0, Publication: 0, Event: 0 }, totAll = 0;
    N.items.forEach(function (it) { if (it.c.some(function (c) { return ORDER.indexOf(c) >= 0; })) { tot[typeOf(it)] = (tot[typeOf(it)] || 0) + 1; totAll++; } });
    var lbl = { News: 'News', Thesis: 'New theses', Publication: 'New publications', Event: 'Events' };
    var legend = A.root.querySelector('.pn-legend');
    if (legend) legend.hidden = A.scale === 'heat';
    box.classList.toggle('is-heat', A.scale === 'heat');
    var csub = A.root.querySelector('.pn-chart__sub');
    if (csub) csub.textContent = csub.textContent.replace(/Select a (bar segment|cell)/, A.scale === 'heat' ? 'Select a cell' : 'Select a bar segment');
    if (A.scale === 'heat') {
      // Heatmap: one row per country, one column per story type. Shade uses a
      // square-root scale so small counts stay visible next to Fiji's 75.
      var cmax = Math.max.apply(null, rows.map(function (r) { return Math.max(r.n.News, r.n.Thesis, r.n.Publication, r.n.Event); }).concat([1]));
      var shade = function (v) {
        if (!v) return 'background:#f4f1ea;color:#111';
        var t = Math.sqrt(v / cmax), l = 92 - t * 66;
        return 'background:hsl(184,62%,' + l.toFixed(1) + '%);color:' + (l < 42 ? '#fff' : '#111');
      };
      box.innerHTML = '<div class="pn-hm" role="table" aria-label="Stories by country and type">' +
        '<div class="pn-hm__row pn-hm__row--head" role="row"><span role="columnheader"></span>' +
        keys.map(function (k) { return '<span class="pn-hm__colh" role="columnheader"><i style="background:' + TYPE_COLOR[k] + '"></i>' + lbl[k] + '</span>'; }).join('') +
        '<span class="pn-hm__colh pn-hm__colh--tot" role="columnheader">Total</span></div>' +
        rows.map(function (r) {
          return '<div class="pn-hm__row' + (A.on[r.c] ? '' : ' is-off') + '" role="row"><span class="pn-row__lab" role="rowheader"><span>' + esc(cname(r.c)) + '</span>' + flag(r.c, 'pn-flag pn-flag--l') + '</span>' +
            keys.map(function (k) {
              var v = r.n[k];
              return v ? '<button type="button" class="pn-hm__cell pn-seg" role="cell" data-c="' + r.c + '" data-t="' + k + '" style="' + shade(v) + '" title="' + esc(NAMES[r.c] + ': ' + v + ' ' + lbl[k].toLowerCase()) + '" aria-label="' + esc(NAMES[r.c] + ', ' + lbl[k] + ', ' + v) + '">' + v + '</button>'
                : '<span class="pn-hm__cell is-zero" role="cell" style="' + shade(0) + '">0</span>';
            }).join('') +
            '<span class="pn-hm__tot" role="cell">' + r.total + '</span></div>';
        }).join('') +
        '<div class="pn-hm__row pn-hm__row--tot" role="row"><span class="pn-row__lab" role="rowheader"><span>Total</span></span>' +
        keys.map(function (k) { return '<span class="pn-hm__cell pn-hm__cell--tot" role="cell">' + tot[k] + '</span>'; }).join('') +
        '<span class="pn-hm__tot" role="cell">' + totAll + '</span></div>' +
        '<div class="pn-hm__key"><span>Fewer</span><span class="pn-hm__ramp"></span><span>More stories</span></div></div>';
    } else
    box.innerHTML = rows.map(function (r) {
      var segs = keys.map(function (k) {
        var v = r.n[k]; if (!v) return '';
        var w = A.scale === 'share' ? (100 * v / r.total) : (100 * v / max);
        var txt = A.scale === 'share' ? Math.round(100 * v / r.total) + '%' : v;
        return '<button type="button" class="pn-seg" data-c="' + r.c + '" data-t="' + k + '" style="width:' + w.toFixed(2) + '%;background:' + TYPE_COLOR[k] + (k === 'News' ? ';color:#111' : '') + '" title="' +
          esc(NAMES[r.c] + ': ' + v + ' ' + lbl[k].toLowerCase()) + '" aria-label="' + esc(NAMES[r.c] + ', ' + lbl[k] + ', ' + v) + '">' +
          '<span>' + txt + '</span></button>';
      }).join('');
      return '<div class="pn-row' + (A.on[r.c] ? '' : ' is-off') + '"><span class="pn-row__lab">' +
        '<span>' + esc(cname(r.c)) + '</span>' + flag(r.c, 'pn-flag pn-flag--l') + '</span><span class="pn-row__bar">' + (segs || '<span class="pn-row__none">No stories yet</span>') + '</span>' +
        '<span class="pn-row__n">' + r.total + '</span></div>';
    }).join('') +
      // Totals row: one bar for all stories, split by type (its own full width).
      '<div class="pn-row pn-row--tot"><span class="pn-row__lab"><span>Total</span></span><span class="pn-row__bar">' +
      keys.map(function (k) {
        var v = tot[k]; if (!v) return '';
        var w = 100 * v / (totAll || 1), txt = A.scale === 'share' ? Math.round(w) + '%' : v;
        return '<span class="pn-seg pn-seg--tot" style="width:' + w.toFixed(2) + '%;background:' + TYPE_COLOR[k] + (k === 'News' ? ';color:#111' : '') + '" title="' + esc('All countries: ' + v + ' ' + lbl[k].toLowerCase()) + '"><span>' + txt + '</span></span>';
      }).join('') + '</span><span class="pn-row__n">' + totAll + '</span></div>';
    box.querySelectorAll('.pn-seg').forEach(function (b) {
      b.addEventListener('click', function () {
        A.on = {}; A.on[b.dataset.c] = true; A.shared = false; A.type = b.dataset.t; A.sub = '';
        refresh();
        A.root.querySelector('.nw__grid').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    A.root.querySelectorAll('[data-pn-scale]').forEach(function (b) {
      var on = b.dataset.pnScale === A.scale;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ------------------------------------------------------------ panel
  function buildPanel() {
    var root = document.querySelector('[data-pnews-panel]');
    if (!root || !N.items.length || root.dataset.built) return;
    root.dataset.built = '1';
    A.root = root;
    ORDER.forEach(function (c) { A.on[c] = true; });
    var years = N.items.filter(function (it) { return it.auto; }).map(function (it) { return +String(it.date).slice(0, 4); });
    var since = years.length ? Math.min.apply(null, years) : new Date().getFullYear();
    var anyQueue = QUEUES.FJI || QUEUES.TON || QUEUES.SLB;
    var share = anyQueue ? '<button type="button" class="nw__share" data-nw-share>Share a story</button>' : '';
    var foot = '<p class="nw__foot">New theses and publications come from each country\u2019s database records. Flags show each scholar\u2019s home country, lead scholar first. Shared stories are checked by a collaborator before they appear.' +
      (anyQueue ? ' Know of a news story, new thesis or publication, or an event? <button type="button" class="nw__link" data-nw-share>Share the link</button>.' : '') + '</p>';
    root.querySelector('[data-pnews-body]').innerHTML =
      '<div class="pn-filter">' +
      '<div class="pn-countries" role="group" aria-label="Countries">' +
      ORDER.map(function (c) {
        return '<button type="button" class="pn-c" role="checkbox" aria-checked="true" data-pn-c="' + c + '"><span class="pn-c__box" aria-hidden="true"></span>' +
          flag(c, 'pn-flag pn-flag--m') + '<span>' + esc(SHORT[c] || NAMES[c]) + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="pn-mode"><span class="pn-mode__lab">Show</span><span class="pn-seg2" role="group" aria-label="How to combine countries">' +
      '<button type="button" data-pn-mode="any" aria-pressed="true">Any checked country</button>' +
      '<button type="button" data-pn-mode="shared" aria-pressed="false">Shared only</button></span>' +
      '<span class="pn-mode__hint"></span>' +
      '<span class="pn-acts"><button type="button" class="pn-act" data-pn-all>' + ico('check') + 'Check all</button><button type="button" class="pn-act" data-pn-none>' + ico('clear') + 'Clear all</button></span></div></div>' +
      '<div class="nw__bar"><div class="nw__types" role="group" aria-label="Show announcements">' +
      TYPES.map(function (t) {
        return '<button type="button" class="nw__type" data-nw-type="' + t.key + '" aria-pressed="false">' + (t.key === 'all' ? '' : ico(t.key)) + esc(t.label) + '<span class="nw__n">0</span></button>' +
          // When News is selected, the News button turns into the News type dropdown.
          (SUBS[t.key] ? '<label class="pn-sub" data-pn-sub-for="' + t.key + '" hidden>' + ico(t.key) + '<select data-pn-sub aria-label="' + esc(SUBS[t.key].aria) + '"></select></label>' : '');
      }).join('') + '</div>' + share + '</div>' +
      '<div class="nw__grid"><div class="nw__main"><div class="pn-card"><div class="nw__feat" aria-live="polite"></div>' +
      '<div class="nw__under"><div class="nw__ctrls">' +
      '<button type="button" class="nw__btn" data-nw-prev aria-label="Previous story">&lsaquo;</button>' +
      '<button type="button" class="nw__pause" data-nw-pause aria-pressed="false" aria-label="Pause">' + ico('pause') + '</button>' +
      '<button type="button" class="nw__btn" data-nw-next aria-label="Next story">&rsaquo;</button></div>' +
      '<div class="nw__dots" aria-hidden="true"></div></div>' + foot +
      '</div></div><div class="nw__list"><h3 class="pn-list__h">Latest from Pasifika scholars</h3><div class="nw__list-items"></div></div></div>' +
      '<div class="pn-chart"><div class="pn-chart__head"><div><h3 class="pn-chart__h">' + ico('chart') + 'Stories by country for ' + new Date().getFullYear() + '</h3>' +
      '<p class="pn-chart__sub">News stories, new theses and publications, and events since ' + since + '. A story with scholars from two countries counts for both; the Total row counts each story once. Select a bar segment to see those stories.</p></div>' +
      '<span class="pn-seg2" role="group" aria-label="Bar scale"><button type="button" data-pn-scale="count" aria-pressed="true">Bar chart</button><button type="button" data-pn-scale="share" aria-pressed="false">Share of each country</button><button type="button" data-pn-scale="heat" aria-pressed="false">Heatmap</button></span></div>' +
      '<div class="pn-legend">' + ['News', 'Thesis', 'Publication', 'Event'].map(function (k) {
        return '<span><i style="background:' + TYPE_COLOR[k] + '"></i>' + ({ News: 'News', Thesis: 'New theses', Publication: 'New publications', Event: 'Events' })[k] + '</span>';
      }).join('') + '</div>' +
      '<div class="pn-rows" data-pn-chart></div></div>';
    root.classList.add('nw--foot-under');

    root.querySelectorAll('[data-pn-c]').forEach(function (b) {
      b.addEventListener('click', function () { A.on[b.dataset.pnC] = !A.on[b.dataset.pnC]; refresh(true); });
    });
    root.querySelector('[data-pn-all]').addEventListener('click', function () { ORDER.forEach(function (c) { A.on[c] = true; }); A.shared = false; refresh(true); });
    root.querySelector('[data-pn-none]').addEventListener('click', function () { A.on = {}; refresh(); });
    root.querySelectorAll('[data-pn-mode]').forEach(function (b) {
      b.addEventListener('click', function () { A.shared = b.dataset.pnMode === 'shared'; refresh(true); });
    });
    root.querySelectorAll('[data-pn-scale]').forEach(function (b) {
      b.addEventListener('click', function () { A.scale = b.dataset.pnScale; chart(); });
    });
    root.querySelectorAll('[data-pn-sub]').forEach(function (sel) { sel.addEventListener('change', function (e) { A.sub = e.target.value; refresh(); }); });
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
      b.addEventListener('click', function () { A.type = b.dataset.nwType; A.sub = ''; refresh(); });
    });
    root.querySelectorAll('.nw__bar [data-nw-share], .nw__foot [data-nw-share]').forEach(function (b) { b.addEventListener('click', openForm); });
    var grid = root.querySelector('.nw__grid');
    grid.addEventListener('mouseenter', function () { clearInterval(A.timer); });
    grid.addEventListener('mouseleave', schedule);
    grid.addEventListener('focusin', function () { clearInterval(A.timer); });
    grid.addEventListener('focusout', function (e) { if (!grid.contains(e.relatedTarget)) schedule(); });
    root.hidden = false;
    refresh();
  }

  // ------------------------------------------------------------ share form
  // The first country chosen decides the review queue. Countries without
  // their own queue go to the Fiji Admin queue, marked with the country.
  var F = null;
  function buildForm() {
    var d = document.createElement('dialog');
    d.className = 'nw-dlg';
    d.setAttribute('aria-labelledby', 'pn-dlg-h');
    d.innerHTML =
      '<form method="dialog" class="nw-form" novalidate>' +
      '<h2 id="pn-dlg-h">Share a story</h2>' +
      '<p class="nw-form__intro">Send us a link to a news story, new thesis, new publication or event, including thesis defenses, featuring Pacific Island scholars. A collaborator for the country checks each link before it appears here and on the country dashboard.</p>' +
      '<label><span>What is it?</span><select name="type"><option value="News">News story</option><option value="Thesis">New thesis</option><option value="Publication">New publication</option><option value="Event">Event (including webinars and thesis defenses)</option></select></label>' +
      '<label><span data-link-label>Link to the story or announcement <span class="nw-req">(required)</span></span><input name="articleUrl" type="url" maxlength="700" placeholder="https://"></label>' +
      '<fieldset class="pn-fcs"><legend>Home country of the scholar(s) <span class="nw-req">(required)</span></legend>' +
      '<p class="pn-fcs__hint">Choose the lead scholar\u2019s country first. Add other countries if scholars from more than one country are featured.</p>' +
      '<div class="pn-fcs__grid">' + ORDER.map(function (c) {
        return '<label class="pn-fc"><input type="checkbox" name="pnc" value="' + c + '">' + flag(c, 'pn-flag pn-flag--m') + '<span>' + esc(NAMES[c]) + '</span></label>';
      }).join('') + '</div></fieldset>' +
      '<label><span>Scholar(s) or author(s)</span><input name="scholars" type="text" maxlength="300" placeholder="For example, Dr Joeli Veitayaki"></label>' +
      (window.VLEvent ? window.VLEvent.formHtml() : '') +
      '<div class="nw-form__row"><label><span>Your name <span class="nw-req">(required)</span></span><input name="submitterName" type="text" required maxlength="160" autocomplete="name"></label>' +
      '<label><span>Your email <span class="nw-req">(required)</span></span><input name="submitterEmail" type="email" required maxlength="240" autocomplete="email"></label></div>' +
      '<label><span>Anything we should know?</span><textarea name="note" rows="3" maxlength="600" placeholder="Optional"></textarea></label>' +
      '<label class="nw-hp" aria-hidden="true">Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label>' +
      '<p class="nw-form__small">Your email is only used if we need to ask about the link. It is never shown on the dashboard.</p>' +
      '<p class="nw-form__msg" role="status"></p>' +
      '<div class="nw-form__acts"><button type="button" class="nw__a" data-nw-cancel>Cancel</button><button type="submit" class="nw__a nw__a--p">Send link</button></div>' +
      '</form>';
    document.body.appendChild(d);
    var form = d.querySelector('form'), msg = d.querySelector('.nw-form__msg'), send = form.querySelector('[type=submit]');
    d._syncEv = window.VLEvent ? window.VLEvent.wire(form) : function () {};
    var picked = [];   // order the countries were ticked; the first decides the queue
    form.querySelectorAll('input[name=pnc]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        picked = picked.filter(function (c) { return c !== cb.value; });
        if (cb.checked) picked.push(cb.value);
      });
    });
    F.reset = function () { picked = []; form.querySelectorAll('input[name=pnc]').forEach(function (cb) { cb.checked = false; }); };
    d.querySelector('[data-nw-cancel]').addEventListener('click', function () { d.close(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (send.dataset.done) { d.close(); return; }
      msg.className = 'nw-form__msg';
      var url = form.articleUrl.value.trim(), isEv = form.type.value === 'Event' && window.VLEvent;
      if ((!isEv || url) && !/^https?:\/\/\S+\.\S+/i.test(url)) { msg.textContent = 'Please paste the full web link, starting with https://'; msg.classList.add('is-err'); form.articleUrl.focus(); return; }
      if (!picked.length) { msg.textContent = 'Please choose the scholar\u2019s home country.'; msg.classList.add('is-err'); return; }
      var evErr = isEv && window.VLEvent.validate(form);
      if (evErr) { msg.textContent = evErr[1]; msg.classList.add('is-err'); var fe = form.querySelector('[name="' + evErr[0] + '"]'); if (fe) fe.focus(); return; }
      if (!form.submitterName.value.trim()) { msg.textContent = 'Please add your name.'; msg.classList.add('is-err'); form.submitterName.focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.submitterEmail.value.trim())) { msg.textContent = 'Please add a valid email.'; msg.classList.add('is-err'); form.submitterEmail.focus(); return; }
      var lead = picked[0], endpoint = QUEUES[lead] || QUEUES.FJI;
      if (!endpoint) { msg.textContent = 'The link could not be sent just now. Please try again later.'; msg.classList.add('is-err'); return; }
      // The queue keeps the country in the submitter note, e.g.
      // "[Regional dashboard: Samoa; also Tonga]".
      var tag = '[Regional dashboard: ' + NAMES[lead] + (picked.length > 1 ? '; also ' + picked.slice(1).map(function (c) { return NAMES[c]; }).join(', ') : '') + ']';
      send.disabled = true; msg.textContent = 'Sending…';
      var body = {
        action: 'submitNewsStory', articleUrl: url, type: form.type.value, scholars: form.scholars.value.trim(),
        submitterName: form.submitterName.value.trim(), submitterEmail: form.submitterEmail.value.trim(),
        note: (tag + ' ' + form.note.value.trim()).trim().slice(0, 800), website: form.website.value,
        elapsedMs: Date.now() - (F.opened || Date.now()), country: lead, countries: picked.join(';'), source: 'regional'
      };
      (isEv ? window.VLEvent.collect(form) : Promise.resolve(null))
        .then(function (ex) {
          if (ex) { body.event = ex.event; body.flyer = ex.flyer; body.qrImage = ex.qrImage; }
          return fetch(endpoint, { method: 'POST', credentials: 'omit', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
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
    if (!F) { F = {}; F.dlg = buildForm(); }
    var form = F.dlg.querySelector('form'), send = form.querySelector('[type=submit]');
    if (send.dataset.done) F.reset();
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

  // ------------------------------------------------------------ boot
  function indexDirectory() {
    var list = (window.PSDirectory && window.PSDirectory.scholars && window.PSDirectory.scholars()) || [];
    list.forEach(function (s) { if (s && s.id) DIR[s.id] = s; });
    return list.length;
  }
  function init(data) {
    D = data;
    N = D && D.news;
    if (!N || !Array.isArray(N.items) || !N.items.length) return;
    X = D.cardExtras || {};
    // Local preview only: sample events injected by the preview harness.
    if (typeof window.__VL_EVENT_SAMPLES === 'function') N.items = window.__VL_EVENT_SAMPLES(N.items, 'regional').concat(N.items);
    N.items.forEach(function (it) { if (!Array.isArray(it.c) || !it.c.length) it.c = ['FJI']; });
    resolvePhotos();
    buildPanel();
    // Master photos arrive with the scholar directory; re-render once it is ready.
    var tries = 0;
    (function wait() {
      if (indexDirectory()) { resolvePhotos(); refresh(true); return; }
      if (++tries < 60) setTimeout(wait, 250);
    })();
  }
  window.PSNews = { init: init };
})();
