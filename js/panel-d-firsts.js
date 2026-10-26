/* Panel D firsts toolbar and list (2026-10-25).
 *
 * Adds the Regional B1 toggles to a country dashboard's Panel D:
 *   Timeline | List      Master's and PhD | Master's only | PhD only      Both | Male | Female
 * Timeline keeps the existing chart and only shows the milestone callouts
 * that match the degree and gender toggles. List swaps the chart for a
 * chronological table of every completed Master's and PhD recipient, with
 * checkbox filters for the country's two location columns.
 *
 * Data comes from the dashboard's own state (window.__vavelabDbState):
 * milestonesCache (built by getPanelDData), master.gradDegrees,
 * master.scholars and scholarProfilesByName. Nothing is fetched.
 * Country is chosen by data-country on the script tag: fj, to, sb, vu.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var COUNTRY = (script && script.getAttribute('data-country')) || 'fj';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var str = function (v) { return String(v == null ? '' : v).trim(); };
  var clean = function (v) { var t = str(v); return /^(unclassified|unknown|n\/a|-)$/i.test(t) ? '' : t; };
  var first = function () { for (var i = 0; i < arguments.length; i++) { var v = clean(arguments[i]); if (v) return v; } return ''; };

  // Paternal value first; a maternal value is shown with an "M:" prefix, as on the profile cards.
  // Tongan names are stored with either a straight apostrophe or the ʻokina
  // (Ha'apai / Haʻapai). Use the ʻokina so both land under one checkbox.
  var okina = function (v) { return COUNTRY === 'to' ? v.replace(/['\u2018\u2019`](?=\w)/g, '\u02bb') : v; };
  function pm(pat, mat) { var p = first.apply(null, pat); if (p) return okina(p); var m = first.apply(null, mat); return m ? 'M: ' + okina(m) : ''; }

  var COLS = {
    fj: [['prov', 'Province', function (s, p) { return pm([s['Province Paternal'], s.effective_paternal_province, p.paternalProvince], [s['Province Maternal'], p.maternalProvince]); }],
         ['conf', 'Confederacy', function (s, p) { return pm([s['Paternal Confederacy'], s.effective_confederacy, p.paternalConfederacy], [p.maternalConfederacy]); }]],
    to: [['clan', 'Clan', function (s, p) { return pm([s['Clan Paternal'], p.paternalClan, p.haaLineagePaternal], [s['Clan Maternal'], p.maternalClan, p.haaLineageMaternal]); }],
         ['isl', 'Island', function (s, p) { return pm([s['Specific Island Paternal'], p.paternalSpecificIsland, s['Island Paternal'], s['Paternal Island Division'], p.paternalIslandDivision], [s['Specific Island Maternal'], p.maternalSpecificIsland, s['Island Maternal'], s['Maternal Island Division'], p.maternalIslandDivision]); }]],
    sb: [['isl', 'Island', function (s, p) { return pm([s['Paternal Specific Island'], s.effective_specific_island, p.paternalSpecificIsland], [p.maternalSpecificIsland]); }],
         ['prov', 'Province', function (s, p) { return pm([s['Paternal Province/City Area'], s['Province/City Area'], s.effective_province_group, p.paternalProvinceCityArea], [p.maternalProvinceCityArea]); }]],
    vu: [['isl', 'Island', function (s, p) { return pm([s['Specific Island Paternal'], s['Paternal Island'], p.paternalSpecificIsland], [s['Specific Island Maternal'], s['Maternal Island'], p.maternalSpecificIsland]); }],
         ['prov', 'Province', function (s, p) { return pm([s['Paternal Province'], s['Paternal Island Division'], p.paternalIslandDivision], [s['Maternal Province'], s['Maternal Island Division'], p.maternalIslandDivision]); }]]
  }[COUNTRY] || [];

  var UC = { 'Fiji': 'FJ', 'New Zealand': 'NZ', 'Australia': 'AU', 'United Kingdom': 'UK', 'United States': 'US', 'United States of America': 'US', 'USA': 'US', 'Canada': 'CA', 'Japan': 'JP', 'India': 'IN', 'China': 'CN', 'Papua New Guinea': 'PG', 'Solomon Islands': 'SB', 'Vanuatu': 'VU', 'Samoa': 'WS', 'Tonga': 'TO', 'France': 'FR', 'Germany': 'DE', 'Netherlands': 'NL', 'Philippines': 'PH', 'Malaysia': 'MY', 'Singapore': 'SG', 'Thailand': 'TH', 'Taiwan': 'TW', 'South Korea': 'KR', 'Indonesia': 'ID', 'Ireland': 'IE', 'Malta': 'MT' };
  var UC_NAME = {}; Object.keys(UC).forEach(function (k) { if (!UC_NAME[UC[k]]) UC_NAME[UC[k]] = k; });
  var UC_PILL = { US: ['#F6BB1F', '#1a1206'], NZ: ['#1E8AE0', '#fff'], AU: ['#F07A3A', '#1a0b04'], UK: ['#6A47C9', '#fff'], FJ: ['#3BB273', '#04140b'], CA: ['#E0393E', '#fff'], PG: ['#8B4A22', '#fff'], MT: ['#8FA3BF', '#0b1626'], FR: ['#4F6BED', '#fff'] };
  var UC_LOCAL = ['us', 'nz', 'au', 'gb', 'fj', 'ca', 'pg', 'mt', 'fr', 'jp', 'cn', 'ph', 'in', 'de', 'nl', 'ie', 'sb', 'to', 'ws', 'vu', 'ki', 'tv', 'ck', 'nu', 'pw', 'fm', 'mh', 'nr', 'th', 'my', 'sg', 'id', 'kr', 'tw', 'ch', 'se', 'no', 'it', 'es', 'za'];
  function ccFor(country) { var s = str(country); if (!s) return ''; return UC[s] || s.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase(); }
  function ucPill(k) {
    var c = UC_PILL[k], bg, fg;
    if (c) { bg = c[0]; fg = c[1]; } else { var h = 0; for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 360; bg = 'hsl(' + h + ',55%,62%)'; fg = '#0b1626'; }
    return '<span class="pdf-uc" style="background:' + bg + ';color:' + fg + '" title="' + esc(UC_NAME[k] || k) + '">' + esc(k) + '</span>';
  }
  function ucFlag(k) {
    var iso = k === 'UK' ? 'gb' : k.toLowerCase();
    if (UC_LOCAL.indexOf(iso) < 0) return '<span class="pdf-ufx"></span>';
    return '<img class="pdf-uf" src="img/regional/flags-uni/' + iso + '.png" alt="" width="34" height="23" title="' + esc(UC_NAME[k] || k) + '">';
  }

  var ICON = {
    time: '<svg class="pdf-bi" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2zm12 8H5v9h14v-9zM7 12h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z"/></svg>',
    list: '<svg class="pdf-bi" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h2v2H3V5zm4 0h14v2H7V5zM3 11h2v2H3v-2zm4 0h14v2H7v-2zm-4 6h2v2H3v-2zm4 0h14v2H7v-2z"/></svg>',
    cap: '<svg class="pdf-bi" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3zm-6.82 9.62v3.87C6.94 18.06 9.3 19 12 19s5.06-.94 6.82-2.51v-3.87L12 16.34l-6.82-3.72z"/></svg>',
    person: function (cls) { return '<svg class="pdf-bi ' + cls + '" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="3.6" fill="currentColor"/><path fill="currentColor" d="M5.5 21v-5.2C5.5 12.6 8.4 11 12 11s6.5 1.6 6.5 4.8V21h-13z"/></svg>'; },
    sort: '<svg class="pdf-sort" viewBox="0 0 8 12" aria-hidden="true"><path class="up" d="M4 0 8 5H0z"/><path class="dn" d="M4 12 0 7h8z"/></svg>'
  };
  var LBL = { masters: "Master's", phd: 'PhD' };
  var UI = { view: 'time', stage: 'both', gender: 'both', key: 'year', dir: 1, excl: {} };

  // Tonga stores gender in Tongan (Tangata = male, Fefine = female).
  function gnorm(v) {
    var g = str(v).toLowerCase();
    if (g === 'male' || g === 'm' || g === 'tangata') return 'male';
    if (g === 'female' || g === 'f' || g === 'fefine') return 'female';
    return g;
  }
  window.__panelDFirstsShow = function (m) {
    var g = gnorm(m && m.gender);
    return (UI.stage === 'both' || m.stage === UI.stage) && (UI.gender === 'both' || g === UI.gender);
  };

  function seg(label, attr, opts, role) {
    return '<div class="pdf-seg" role="' + (role || 'radiogroup') + '" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      var on = UI[attr] === o[0];
      var aria = role === 'tablist' ? 'role="tab" aria-selected="' + on + '"' : 'role="radio" aria-checked="' + on + '"';
      return '<button type="button" ' + aria + ' data-pdf-' + attr + '="' + o[0] + '">' + (o[2] || '') + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function buildToolbar(panel) {
    var bar = document.createElement('div');
    bar.className = 'pdf-tools';
    bar.innerHTML = seg('Panel D view', 'view', [['time', 'Timeline', ICON.time], ['list', 'List', ICON.list]], 'tablist') +
      seg("Degrees shown", 'stage', [['both', "Master's and PhD", ICON.cap], ['masters', "Master's only", ICON.cap], ['phd', 'PhD only', ICON.cap]]) +
      '<span class="pdf-sep" aria-hidden="true"></span>' +
      seg('Gender shown', 'gender', [['both', 'Both'], ['male', 'Male', ICON.person('pdf-bi--m')], ['female', 'Female', ICON.person('pdf-bi--f')]]) +
      '<span class="pdf-count" aria-live="polite"></span>';
    var list = document.createElement('div');
    list.className = 'pdf-list';
    list.hidden = true;
    list.innerHTML = '<div class="pdf-filters"></div><div class="pdf-scroll"><table class="pdf-table"></table></div>' +
      '<p class="pdf-note">Every completed Master\u2019s and PhD record in this dashboard\u2019s Master file (Graduate Degrees), in order of completion year. Location columns use the paternal line; M: marks a maternal-line value.</p>';
    var anchor = panel.querySelector('[data-hist-type-filter]');
    anchor.parentNode.insertBefore(bar, anchor);
    anchor.parentNode.insertBefore(list, anchor);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ['view', 'stage', 'gender'].forEach(function (k) {
        var v = b.getAttribute('data-pdf-' + k); if (v == null) return;
        UI[k] = v;
        bar.querySelectorAll('[data-pdf-' + k + ']').forEach(function (x) {
          var on = x === b; x.setAttribute(x.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-checked', String(on));
        });
      });
      apply(panel);
    });
    list.addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-pdf-f]'); if (!cb) return;
      var k = cb.getAttribute('data-pdf-f'); UI.excl[k] = UI.excl[k] || new Set();
      if (cb.checked) UI.excl[k].delete(cb.value); else UI.excl[k].add(cb.value);
      apply(panel);
    });
    list.addEventListener('click', function (e) {
      var fa = e.target.closest('[data-pdf-fall]'), fn = e.target.closest('[data-pdf-fnone]');
      if (fa) { UI.excl[fa.getAttribute('data-pdf-fall')] = new Set(); apply(panel); return; }
      if (fn) {
        var k = fn.getAttribute('data-pdf-fnone'), all = new Set();
        list.querySelectorAll('input[data-pdf-f="' + k + '"]').forEach(function (x) { all.add(x.value); });
        UI.excl[k] = all; apply(panel); return;
      }
      var th = e.target.closest('[data-pdf-sort]');
      if (th) { var k = th.getAttribute('data-pdf-sort'); if (UI.key === k) UI.dir = -UI.dir; else { UI.key = k; UI.dir = 1; } renderList(panel); return; }
      var a = e.target.closest('a[data-pdf-sid]');
      if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); openProfile(a.getAttribute('data-pdf-sid'), a.getAttribute('data-pdf-name'), a.getAttribute('data-pdf-q')); }
    });
  }

  // Raw location value for a column, without the "M:" prefix, used as the
  // checkbox key. '' means not recorded.
  function locKey(v) { return str(v).replace(/^M:\s*/, ''); }

  // Every completed Master's and PhD record, the same rows the Panel D KPIs
  // count. Stage and gender toggles apply here; checkbox filters apply in rows().
  function allRows() {
    var st = window.__vavelabDbState || {};
    var master = st.master || {};
    var scholars = new Map((master.scholars || []).map(function (s) { return [str(s['Scholar ID']), s]; }));
    var profiles = new Map();
    // A scholar can have more than one profile entry (name variants). Keep the
    // one with the most filled-in fields so location details are not lost.
    var filled = function (o) { var n = 0; for (var k in o) if (o[k] && typeof o[k] !== 'object' && !/^unclassified$/i.test(String(o[k]))) n++; return n; };
    if (st.scholarProfilesByName && st.scholarProfilesByName.forEach) st.scholarProfilesByName.forEach(function (p) {
      if (!p || !p.scholarId) return;
      var cur = profiles.get(p.scholarId);
      if (!cur || filled(p) > filled(cur)) profiles.set(p.scholarId, p);
    });
    var stageOf = function (r) { var v = str(r['Degree Stage'] || r.Stage || r['Degree Level']); return /phd|doctor/i.test(v) ? 'phd' : (/master/i.test(v) ? 'masters' : ''); };
    var yr = function (r) { var m = str(r['Finish / Completion Year'] || r['Graduation Year'] || r['Completion Year'] || r['End Year']).match(/\d{4}/); return m ? +m[0] : null; };
    var base = Array.isArray(st.panelDCompletedRows) ? st.panelDCompletedRows
      : (master.gradDegrees || []).filter(function (r) { return /^completed/i.test(str(r['Completion Status'])) && stageOf(r); });
    var out = [];
    base.forEach(function (g) {
      var stage = stageOf(g); if (!stage) return;
      var sid = str(g['Scholar ID']);
      var s = scholars.get(sid) || {}, p = profiles.get(sid) || {};
      var gender = gnorm(s.Gender || p.gender);
      var given = str(s['Given Names']).split(/\s+/)[0] || '';
      var fam = str(s['Family Name']);
      var title = stage === 'phd' ? 'Dr' : (gender === 'male' ? 'Mr' : (gender === 'female' ? 'Ms' : ''));
      var plain = (given && fam) ? given + ' ' + fam : str(g['Scholar Name'] || p.name);
      var r = {
        stage: stage, sid: sid, gender: gender, year: yr(g), person: [title, plain].filter(Boolean).join(' '), bare: plain, q: fam,
        photo: str(p.photo),
        first: (gender === 'male' ? 'Male ' : (gender === 'female' ? 'Female ' : '')) + LBL[stage],
        field: first(g['Field / Discipline'], g['Field/Discipline'], g['Short Discipline'], g['Broad Discipline']),
        uni: first(g['C_Uni name'], g['O_Uni name'], g['Canonical University Name (C_Uni)']),
        uc: ccFor(first(g.Country, g['University Country']))
      };
      COLS.forEach(function (c) { r[c[0]] = c[2](s, p); });
      out.push(r);
    });
    return out;
  }

  function toggled(r) {
    return (UI.stage === 'both' || r.stage === UI.stage) && (UI.gender === 'both' || r.gender === UI.gender);
  }

  function rows(base) {
    return base.filter(function (r) {
      if (!toggled(r)) return false;
      for (var i = 0; i < COLS.length; i++) { var k = COLS[i][0]; if (UI.excl[k] && UI.excl[k].has(locKey(r[k]))) return false; }
      return true;
    });
  }

  // Checkbox filters for the country's two location columns (Fiji: Province
  // and Confederacy). Counts follow the degree and gender toggles.
  function renderFilters(panel, base) {
    var box = panel.querySelector('.pdf-filters'); if (!box) return;
    var shown = base.filter(toggled);
    box.innerHTML = COLS.map(function (c) {
      var k = c[0], counts = new Map();
      shown.forEach(function (r) { var v = locKey(r[k]); counts.set(v, (counts.get(v) || 0) + 1); });
      base.forEach(function (r) { var v = locKey(r[k]); if (!counts.has(v)) counts.set(v, 0); });
      var vals = Array.from(counts.keys()).sort(function (a, b) { return a === '' ? 1 : (b === '' ? -1 : a.replace(/\u02bb/g, '').localeCompare(b.replace(/\u02bb/g, ''))); });
      var ex = UI.excl[k] || new Set();
      return '<div class="pdf-fgroup" role="group" aria-label="' + esc(c[1]) + '"><span class="pdf-flabel">' + esc(c[1]) + '</span><div class="pdf-fopts">' +
        vals.map(function (v) {
          return '<label class="pdf-chk"><input type="checkbox" data-pdf-f="' + k + '" value="' + esc(v) + '"' + (ex.has(v) ? '' : ' checked') + '><span>' + (v ? esc(v) : 'Not recorded') + '</span><span class="pdf-fn">' + counts.get(v) + '</span></label>';
        }).join('') +
        '</div><span class="pdf-fact"><button type="button" data-pdf-fall="' + k + '">Check all</button><button type="button" data-pdf-fnone="' + k + '">Clear</button></span></div>';
    }).join('');
  }

  function renderList(panel) {
    var t = panel.querySelector('.pdf-table'); if (!t) return;
    var base = allRows();
    renderFilters(panel, base);
    var rs = rows(base);
    var cols = [['year', 'Year'], ['person', 'Scholar'], ['first', 'Degree'], ['field', 'Major / Field of study'], ['uni', 'University']].concat(COLS.map(function (c) { return [c[0], c[1]]; }));
    rs.sort(function (a, b) {
      var x = a[UI.key], y = b[UI.key];
      var c;
      if (UI.key === 'year') c = (x == null ? 99999 : x) - (y == null ? 99999 : y);
      else c = String(locKey(x) || '\uffff').localeCompare(String(locKey(y) || '\uffff'));
      return UI.dir * c || (a.year || 99999) - (b.year || 99999) || a.person.localeCompare(b.person);
    });
    var head = cols.map(function (c) {
      var on = UI.key === c[0], srt = on ? (UI.dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" aria-sort="' + srt + '"><button type="button" class="pdf-th' + (on ? ' is-' + srt : '') + '" data-pdf-sort="' + c[0] + '" title="Sort by ' + esc(c[1].toLowerCase()) + '">' + esc(c[1]) + ICON.sort + '</button></th>';
    }).join('');
    var place = function (g) { return 'img/regional/firsts/placeholder-' + (g === 'female' ? 'female' : 'male') + '.webp'; };
    var body = rs.length ? rs.map(function (r) {
      var href = location.pathname + '?scholar=' + encodeURIComponent(r.sid) + '&name=' + encodeURIComponent(r.bare);
      var img = '<img class="pdf-ph" src="' + esc(r.photo || place(r.gender)) + '" alt="" width="30" height="30" loading="lazy" data-fallback="' + esc(place(r.gender)) + '">';
      var name = r.sid ? '<a href="' + esc(href) + '" data-pdf-sid="' + esc(r.sid) + '" data-pdf-name="' + esc(r.bare) + '" data-pdf-q="' + esc(r.q || r.bare) + '" title="Open this scholar\u2019s profile">' + esc(r.person) + '</a>' : esc(r.person);
      var extra = COLS.map(function (c) { return '<td class="pdf-geo">' + (r[c[0]] ? esc(r[c[0]]) : '<span class="pdf-na">Not recorded</span>') + '</td>'; }).join('');
      return '<tr class="pdf--' + (r.gender || 'male') + ' pdf--' + r.stage + '"><td class="y">' + (r.year || '<span class="pdf-na">Not recorded</span>') + '</td><td><span class="pdf-sch">' + img + name + '</span></td><td><span class="pdf-tag">' + ICON.cap + esc(r.first) + '</span></td><td class="pdf-fld">' + (r.field ? esc(r.field) : '<span class="pdf-na">Not recorded</span>') + '</td><td><span class="pdf-u">' + (r.uc ? ucFlag(r.uc) : '<span class="pdf-ufx"></span>') + '<span class="pdf-un">' + esc(r.uni) + '</span>' + (r.uc ? ucPill(r.uc) : '') + '</span></td>' + extra + '</tr>';
    }).join('') : '<tr><td colspan="' + cols.length + '">No Master\u2019s or PhD recipients match this selection.</td></tr>';
    t.innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>';
    t.querySelectorAll('img[data-fallback]').forEach(function (img) { img.addEventListener('error', function () { var f = img.getAttribute('data-fallback'); if (f && img.getAttribute('src') !== f) img.setAttribute('src', f); }, { once: true }); });
    t.querySelectorAll('img.pdf-uf').forEach(function (img) { img.addEventListener('error', function () { var s = document.createElement('span'); s.className = 'pdf-ufx'; img.replaceWith(s); }, { once: true }); });
    return rs.length;
  }

  function apply(panel) {
    var list = UI.view === 'list';
    var hide = ['[data-hist-type-filter]', '[data-panel-d-chart]', '[data-hist-note]', '[data-db-hist-controls]', '[data-hist-authors-tabs]'];
    hide.forEach(function (sel) { var el = panel.querySelector(sel); if (el) el.classList.toggle('pdf-hidden', list); });
    panel.querySelector('.pdf-list').hidden = !list;
    var n = renderList(panel);
    panel.querySelector('.pdf-count').textContent = n + (n === 1 ? ' recipient' : ' recipients') + ' shown';
    if (!list && typeof window.__panelDRerender === 'function') { try { window.__panelDRerender(); } catch (e) { /* chart keeps its last drawing */ } }
  }

  function openProfile(sid, name, q) {
    var bare = str(name);
    var tries = 0;
    var find = function () {
      var byId = document.querySelector('[data-scholar-id="' + sid + '"]');
      if (byId) return byId;
      var want = bare.toLowerCase(); if (!want) return null;
      var cards = document.querySelectorAll('[data-db-leaders] .db-scholar-card');
      for (var i = 0; i < cards.length; i++) if ((cards[i].innerText || '').toLowerCase().indexOf(want) !== -1) return cards[i];
      return null;
    };
    var input = document.querySelector('[data-scholar-name-search]');
    if (!find() && input && bare) { input.value = str(q) || bare; input.dispatchEvent(new Event('input', { bubbles: true })); }
    var timer = setInterval(function () {
      tries += 1;
      var card = find();
      if (card || tries > 40) {
        clearInterval(timer);
        if (!card) { location.href = location.pathname + '?scholar=' + encodeURIComponent(sid) + '&name=' + encodeURIComponent(bare); return; }
        var off = 12, h = document.querySelector('.site-header'), bar = document.querySelector('.db-panel-menu');
        if (h) off += h.getBoundingClientRect().height;
        if (bar) off += bar.getBoundingClientRect().height;
        window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - off), behavior: 'smooth' });
        card.classList.add('pdf-flash'); setTimeout(function () { card.classList.remove('pdf-flash'); }, 2600);
      }
    }, 150);
  }

  var started = false;
  var wait = setInterval(function () {
    var panel = document.querySelector('[data-panel="D"]');
    var st = window.__vavelabDbState;
    if (!panel || !st || !Array.isArray(st.milestonesCache) || !panel.querySelector('[data-hist-type-filter]')) return;
    clearInterval(wait);
    if (started) return; started = true;
    buildToolbar(panel);
    apply(panel);
    // The dashboard can rebuild its data (for example after unlocking). Keep
    // the list and count in step with the current milestones.
    var last = st.panelDCompletedRows;
    setInterval(function () {
      var s = window.__vavelabDbState;
      if (s && s.panelDCompletedRows && s.panelDCompletedRows !== last) { last = s.panelDCompletedRows; apply(panel); }
    }, 1500);
  }, 300);
})();
