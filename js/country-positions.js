/* University positions on a country dashboard (Fiji, Tonga).
 *
 * Reads the encrypted Positions snapshot written by the Master-file refresh
 * (scripts/country_positions.py) through the page's passcode gate, then:
 *   1. adds a "Positions" toggle to every Panel F scholar card that has
 *      Positions sheet records, listing each appointment (Current / Past);
 *   2. adds a "Study pathways | University positions" toggle to Panel B3.
 *      The positions view counts unique scholars per canonical role, for
 *      Ever held or Currently held, split by gender.
 *
 * Configured from its own <script> tag:
 *   data-src     snapshot URL (plaintext name; the gate maps it to .enc)
 *   data-people  e.g. "iTaukei" or "Tongan"
 *   data-b3      "off" to add the scholar card tab only (no Panel B3 toggle)
 * Nothing is shown until the gate has unlocked the data. Scholars with no
 * Positions records are not counted (missing coverage is not zero).
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var SRC = (me && me.dataset.src) || '';
  var PEOPLE = (me && me.dataset.people) || '';
  var B3_OFF = !!(me && me.dataset.b3 === 'off');
  if (!SRC) return;

  var P = null;          // snapshot
  var bySid = {};        // sid -> rows
  var loading = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    if (P) return Promise.resolve(P);
    if (loading) return loading;
    var gate = window.dbGate || window.demoGate;
    if (!gate || typeof gate.fetchJson !== 'function') return Promise.reject(new Error('no gate'));
    loading = gate.fetchJson(SRC).then(function (doc) {
      if (!doc || !Array.isArray(doc.rows)) throw new Error('bad positions snapshot');
      P = doc; bySid = {};
      doc.rows.forEach(function (r) { (bySid[r.sid] = bySid[r.sid] || []).push(r); });
      return P;
    }).catch(function (e) { loading = null; throw e; });
    return loading;
  }

  // ---------------------------------------------------------------- cards
  function years(r) {
    var s = r.start, e = r.end;
    if (s && e) return s === e ? s : s + '–' + e;
    if (s) return r.cur ? 'since ' + s : 'from ' + s;
    if (e) return 'until ' + e;
    return '';
  }

  function sortRows(rows) {
    return rows.map(function (r, i) { return [r, i]; }).sort(function (a, b) {
      if (a[0].cur !== b[0].cur) return a[0].cur ? -1 : 1;
      var ya = parseInt(a[0].start, 10) || 0, yb = parseInt(b[0].start, 10) || 0;
      if (ya !== yb) return yb - ya;
      return a[1] - b[1];
    }).map(function (x) { return x[0]; });
  }

  function cardHtml(sid, rows) {
    var id = 'cpos-' + sid.replace(/[^A-Za-z0-9_-]/g, '_');
    var items = sortRows(rows).map(function (r) {
      var title = [r.title, r.lead].filter(Boolean).map(esc).join('; ');
      var sub = [r.dept, r.inst, r.country, years(r)].filter(Boolean).map(esc).join(' · ');
      return '<li class="cpos-item"><span class="cpos-pill ' + (r.cur ? 'is-cur">Current' : 'is-past">Past') + '</span>' +
        '<div class="cpos-item__text"><div class="cpos-item__title">' + title + '</div>' +
        (sub ? '<div class="cpos-item__sub">' + sub + '</div>' : '') + '</div></li>';
    }).join('');
    var nCur = rows.filter(function (r) { return r.cur; }).length;
    return '<button type="button" class="db-scholar-card__insight-btn cpos-btn" aria-expanded="false" aria-controls="' + id + '">' +
      '<span class="db-scholar-card__insight-btn-label">Positions</span>' +
      '<span class="db-scholar-card__insight-btn-tag">(' + rows.length + (nCur ? ', ' + nCur + ' current' : '') + ')</span>' +
      '<span class="db-scholar-card__insight-btn-chev" aria-hidden="true">\u25be</span></button>' +
      '<div class="db-scholar-card__insight cpos-panel" id="' + id + '" hidden>' +
      '<div class="db-scholar-card__insight-heading">Positions recorded in the Master file</div>' +
      '<ul class="cpos-list">' + items + '</ul></div>';
  }

  function decorate(card) {
    if (card.hasAttribute('data-cpos')) return;
    var sid = (card.dataset.scholarId || '').toUpperCase();
    card.setAttribute('data-cpos', '');
    // Positions the scholar unticked on the Update info form stay in the
    // snapshot (so the form can list them) but are not shown on the card.
    var rows = sid && (bySid[sid] || []).filter(function (r) { return !r.hide; });
    if (!rows || !rows.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'cpos-wrap';
    wrap.innerHTML = cardHtml(sid, rows);
    var stats = card.querySelector('.db-scholar-card__stats');
    if (stats) card.insertBefore(wrap, stats); else card.appendChild(wrap);
    var btn = wrap.querySelector('.cpos-btn'), panel = wrap.querySelector('.cpos-panel');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.hidden = !open;
    });
  }

  function decorateAll() {
    if (!P) return;
    document.querySelectorAll('.db-scholar-card[data-scholar-id]:not([data-cpos])').forEach(decorate);
  }

  // ---------------------------------------------------------------- B3 view
  var B3 = { built: false, mode: 'ever', sel: null };

  function counts() {
    var roles = {};   // key -> {f:Set, m:Set, all:Set}
    var any = { f: new Set(), m: new Set(), all: new Set() };
    P.rows.forEach(function (r) {
      if (B3.mode === 'cur' && !r.cur) return;
      var g = (P.scholars[r.sid] || {}).g || '';
      (r.roles || []).forEach(function (k) {
        var c = roles[k] = roles[k] || { f: new Set(), m: new Set(), all: new Set() };
        c.all.add(r.sid); if (g) c[g].add(r.sid);
        any.all.add(r.sid); if (g) any[g].add(r.sid);
      });
    });
    return { roles: roles, any: any };
  }

  function namesOf(set) {
    return Array.from(set).map(function (sid) { return (P.scholars[sid] || {}).n || sid; })
      .sort(function (a, b) { return a.localeCompare(b); });
  }

  function renderTable(view) {
    var C = counts();
    var cols = [['f', 'Women'], ['m', 'Men'], ['all', 'All']];
    var max = 1;
    Object.keys(C.roles).forEach(function (k) { max = Math.max(max, C.roles[k].all.size); });
    function cell(k, g, set) {
      var n = set ? set.size : 0;
      if (!n) return '<td class="cpos-c is-zero">–</td>';
      var a = 0.08 + 0.5 * (n / max);
      var sel = B3.sel && B3.sel.k === k && B3.sel.g === g ? ' is-sel' : '';
      return '<td class="cpos-c' + sel + '"><button type="button" data-k="' + k + '" data-g="' + g + '" style="--a:' + a.toFixed(2) + '">' + n + '</button></td>';
    }
    function group(label, list) {
      return '<tr class="cpos-group"><th colspan="4" scope="colgroup">' + label + '</th></tr>' + list.map(function (x) {
        var c = C.roles[x[0]] || {};
        return '<tr><th scope="row">' + esc(x[1]) + '</th>' + cols.map(function (g) { return cell(x[0], g[0], c[g[0]]); }).join('') + '</tr>';
      }).join('');
    }
    var h = '<table class="cpos-table"><thead><tr><th scope="col">Position</th>' +
      cols.map(function (g) { return '<th scope="col">' + g[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      group('University leadership', P.lead) + group('Academic rank', P.rank) +
      '</tbody><tfoot><tr><th scope="row">Scholars with any of these</th>' +
      cols.map(function (g) { return cell('*', g[0], C.any[g[0]]); }).join('') + '</tr>' +
      '<tr class="cpos-roster"><th scope="row">Scholars on this dashboard</th><td>' + P.gender.f + '</td><td>' + P.gender.m + '</td><td>' + P.roster + '</td></tr>' +
      '</tfoot></table>';
    view.querySelector('.cpos-tablewrap').innerHTML = h;
    renderDetail(view, C);
  }

  function renderDetail(view, C) {
    var box = view.querySelector('.cpos-detail');
    if (!B3.sel) { box.innerHTML = '<p class="cpos-detail__hint">Select a number to see who.</p>'; return; }
    C = C || counts();
    var set = B3.sel.k === '*' ? C.any[B3.sel.g] : (C.roles[B3.sel.k] || {})[B3.sel.g];
    var label = B3.sel.k === '*' ? 'Any of these positions'
      : (P.lead.concat(P.rank).filter(function (x) { return x[0] === B3.sel.k; })[0] || [0, ''])[1];
    var gl = { f: 'Women', m: 'Men', all: 'All' }[B3.sel.g];
    var names = set ? namesOf(set) : [];
    box.innerHTML = '<div class="cpos-detail__head"><strong>' + esc(label) + '</strong> · ' + gl + ' · ' +
      (B3.mode === 'cur' ? 'Currently held' : 'Ever held') + ' · ' + names.length + ' scholar' + (names.length === 1 ? '' : 's') + '</div>' +
      (names.length ? '<ol class="cpos-detail__list">' + names.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ol>' : '<p class="cpos-detail__hint">No scholars.</p>');
  }

  function buildB3() {
    if (B3.built) return;
    var panel = document.querySelector('[data-panel="B3"].db-panel');
    if (!panel) return;
    var title = panel.querySelector('.db-panel__title');
    var hint = panel.querySelector('.db-panel__hint');
    if (!title) return;
    B3.built = true;
    var titleStudy = title.textContent;
    var hintStudy = hint ? hint.innerHTML : '';
    var studyEls = Array.prototype.slice.call(panel.children).filter(function (el) {
      return el.classList.contains('db-panel__embed') || el.classList.contains('db-panel__embed-close');
    });

    var tg = document.createElement('div');
    tg.className = 'cpos-toggle';
    tg.setAttribute('role', 'tablist');
    tg.setAttribute('aria-label', 'Panel B3 view');
    tg.innerHTML = '<button type="button" role="tab" class="is-active" aria-selected="true" data-view="study">Study pathways</button>' +
      '<button type="button" role="tab" aria-selected="false" data-view="pos">University positions</button>';
    (hint || title).insertAdjacentElement('afterend', tg);

    var view = document.createElement('div');
    view.className = 'cpos-view';
    view.hidden = true;
    var nWith = Object.keys(P.scholars).length;
    view.innerHTML =
      '<div class="cpos-toggle cpos-toggle--sub" role="group" aria-label="Count positions">' +
      '<button type="button" class="is-active" aria-pressed="true" data-mode="ever">Ever held</button>' +
      '<button type="button" aria-pressed="false" data-mode="cur">Currently held</button></div>' +
      '<div class="cpos-grid"><div class="cpos-tablewrap"></div><div class="cpos-detail" aria-live="polite"></div></div>' +
      '<p class="cpos-note">' + P.rows.length + ' position records for ' + nWith + ' of ' + P.roster + ' scholars on this dashboard, from the Positions sheet of the Master file. ' +
      'Each scholar is counted once per position. Scholars with no Positions records are not counted, so these are minimums. ' +
      'Leadership roles count only at universities and other higher-education institutions, and include acting appointments. ' +
      'Academic ranks use the recorded title; "Assistant Professor" and "Lecturer" are kept separate. The same rules are used on the Regional Pacific Scholars Dashboard.</p>';
    tg.insertAdjacentElement('afterend', view);

    var hintPos = 'Number of ' + esc(PEOPLE) + ' scholars who have held each university position, by gender. Select a number to see who.';

    tg.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-view]'); if (!b) return;
      var pos = b.dataset.view === 'pos';
      tg.querySelectorAll('button').forEach(function (x) {
        var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      title.textContent = pos ? 'UNIVERSITY POSITIONS' : titleStudy;
      if (hint) hint.innerHTML = pos ? hintPos : hintStudy;
      studyEls.forEach(function (el) { el.hidden = pos; });
      view.hidden = !pos;
      if (pos) renderTable(view);
    });
    view.querySelector('.cpos-toggle--sub').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-mode]'); if (!b) return;
      B3.mode = b.dataset.mode;
      this.querySelectorAll('button').forEach(function (x) {
        var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderTable(view);
    });
    view.querySelector('.cpos-tablewrap').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-k]'); if (!b) return;
      B3.sel = { k: b.dataset.k, g: b.dataset.g };
      renderTable(view);
    });
  }

  // Used by the Update info form: every position recorded for a scholar,
  // including hidden ones, current first. Resolves to [] if unavailable.
  window.countryPositions = {
    forSid: function (sid) {
      sid = String(sid || '').toUpperCase();
      return load().then(function () { return sortRows(bySid[sid] || []); }, function () { return []; });
    },
    years: years
  };

  // ---------------------------------------------------------------- boot
  function start() {
    load().then(function () {
      decorateAll();
      if (!B3_OFF) buildB3();
    }).catch(function () { /* gate locked or file not yet published: show nothing */ });
  }

  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType === 1 && (n.matches('.db-scholar-card') || n.querySelector && n.querySelector('.db-scholar-card'))) {
          if (P) decorateAll(); else start();
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
