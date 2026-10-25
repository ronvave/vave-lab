/* Panel B2 "Countries of graduate study" table — shared by the Fiji, Tonga,
   Solomon Islands and Vanuatu dashboards (October 2026 redesign).

   Provides:
     B2StudyTable.renderCountries(host, countries, opts)  two-column sortable table
     B2StudyTable.renderRegions(host, countries, points, opts)  By Region rollup
     B2StudyTable.regionHost(listView)  lazily-created host for the region view
     B2StudyTable.setTallies(listView, {scholars, masters, phd})  tally cards

   Country objects are the per-country aggregates each dashboard already builds
   ({name, iso, masters, phd, unknown, total, unis}). Rows keep the existing
   .db-world-country-row / .db-world-country-row__name classes so selection
   highlighting and the country-filter behaviour are unchanged. */
(function () {
  'use strict';

  var ISO = {
    'Tonga': 'to', 'Fiji': 'fj', 'Samoa': 'ws', 'American Samoa': 'as', 'New Zealand': 'nz',
    'Australia': 'au', 'United States': 'us', 'United States of America': 'us', 'USA': 'us',
    'United Kingdom': 'gb', 'UK': 'gb', 'Canada': 'ca', 'Japan': 'jp', 'China': 'cn', 'Malta': 'mt',
    'India': 'in', 'Philippines': 'ph', 'Papua New Guinea': 'pg', 'Solomon Islands': 'sb',
    'Vanuatu': 'vu', 'Kiribati': 'ki', 'Cook Islands': 'ck', 'Niue': 'nu', 'Tuvalu': 'tv',
    'Nauru': 'nr', 'Palau': 'pw', 'Federated States of Micronesia': 'fm', 'Marshall Islands': 'mh',
    'French Polynesia': 'pf', 'New Caledonia': 'nc', 'Germany': 'de', 'France': 'fr',
    'Netherlands': 'nl', 'Belgium': 'be', 'Switzerland': 'ch', 'Austria': 'at', 'Ireland': 'ie',
    'Italy': 'it', 'Spain': 'es', 'Portugal': 'pt', 'Norway': 'no', 'Sweden': 'se', 'Denmark': 'dk',
    'Finland': 'fi', 'Singapore': 'sg', 'Malaysia': 'my', 'Indonesia': 'id', 'Thailand': 'th',
    'Vietnam': 'vn', 'South Korea': 'kr', 'Korea': 'kr', 'Taiwan': 'tw', 'Hong Kong': 'hk',
    'Trinidad and Tobago': 'tt', 'Jamaica': 'jm', 'Mexico': 'mx', 'Brazil': 'br', 'Chile': 'cl',
    'South Africa': 'za', 'Israel': 'il', 'Cuba': 'cu', 'Russia': 'ru', 'Bangladesh': 'bd',
    'Pakistan': 'pk', 'Sri Lanka': 'lk', 'Egypt': 'eg', 'Turkey': 'tr', 'United Arab Emirates': 'ae'
  };
  // Fallback only — each worldPoint's own `region` field wins.
  var REGION_FALLBACK = {
    Oceania: ['Fiji', 'Tonga', 'Samoa', 'American Samoa', 'Australia', 'New Zealand', 'Papua New Guinea',
      'Solomon Islands', 'Vanuatu', 'Kiribati', 'Cook Islands', 'Niue', 'Tuvalu', 'Nauru', 'Palau',
      'Federated States of Micronesia', 'Marshall Islands', 'French Polynesia', 'New Caledonia'],
    Asia: ['Japan', 'China', 'India', 'Philippines', 'Singapore', 'Malaysia', 'Indonesia', 'Thailand',
      'Vietnam', 'South Korea', 'Korea', 'Taiwan', 'Hong Kong', 'Bangladesh', 'Pakistan', 'Sri Lanka',
      'Israel', 'United Arab Emirates', 'Turkey'],
    Europe: ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Belgium', 'Switzerland', 'Austria',
      'Ireland', 'Italy', 'Spain', 'Portugal', 'Norway', 'Sweden', 'Denmark', 'Finland', 'Malta', 'Russia'],
    Americas: ['United States', 'Canada', 'Trinidad and Tobago', 'Jamaica', 'Mexico', 'Brazil', 'Chile', 'Cuba'],
    Africa: ['South Africa', 'Egypt']
  };

  var SORT_ICON = '<svg class="b2t__sort-icon" viewBox="0 0 10 14" aria-hidden="true">' +
    '<path class="b2t__sort-up" d="M5 1 9 5.5H1z"/><path class="b2t__sort-down" d="M5 13 1 8.5h8z"/></svg>';
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/></svg>';
  var ICONS = {
    scholars: '<svg viewBox="0 0 40 28" aria-hidden="true"><g fill="currentColor">' +
      '<circle cx="20" cy="7" r="5.2"/><path d="M10.5 26c0-6 4.2-10 9.5-10s9.5 4 9.5 10z"/>' +
      '<circle cx="8.5" cy="9.5" r="4"/><path d="M1 25c0-4.6 3.2-7.6 7.5-7.6 1.4 0 2.6.3 3.6.9-1.6 1.9-2.6 4.1-2.8 6.7z"/>' +
      '<circle cx="31.5" cy="9.5" r="4"/><path d="M39 25c0-4.6-3.2-7.6-7.5-7.6-1.4 0-2.6.3-3.6.9 1.6 1.9 2.6 4.1 2.8 6.7z"/></g></svg>',
    cap: '<svg viewBox="0 0 40 30" aria-hidden="true"><g fill="currentColor">' +
      '<path d="M20 2 1 10.5 20 19l19-8.5z"/><path d="M8.5 15.2v6.6c0 2.9 5.1 5.2 11.5 5.2s11.5-2.3 11.5-5.2v-6.6L20 20.4z"/>' +
      '<path d="M35 12.3v8.2h1.6v-8.9z"/><circle cx="35.8" cy="22" r="1.9"/></g></svg>'
  };

  var sortState = { key: null, dir: 'desc' }; // null = keep the dashboard's own order
  var regionOpen = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function totalOf(c) { return Number.isFinite(Number(c.total)) ? Number(c.total) : num(c.masters) + num(c.phd) + num(c.unknown); }

  function flagEl(c) {
    var iso = (c.iso && /^[A-Za-z]{2}$/.test(c.iso) ? c.iso : ISO[c.name] || '').toLowerCase();
    var f;
    if (iso) {
      f = document.createElement('img');
      f.src = 'https://flagcdn.com/w80/' + iso + '.png';
      f.alt = ''; f.loading = 'lazy'; f.width = 30; f.height = 20;
    } else { f = document.createElement('span'); }
    f.className = 'tcf-flag' + (iso ? '' : ' tcf-flag--none');
    f.setAttribute('aria-hidden', 'true');
    return f;
  }

  function sorted(list) {
    if (!sortState.key) return list.slice();
    var k = sortState.key, m = sortState.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      if (k === 'name') return m * String(a.name).localeCompare(String(b.name));
      var av = k === 'total' ? totalOf(a) : num(a[k]);
      var bv = k === 'total' ? totalOf(b) : num(b[k]);
      return (m * (av - bv)) || (totalOf(b) - totalOf(a)) || String(a.name).localeCompare(String(b.name));
    });
  }

  function header(firstLabel, rerender) {
    var h = document.createElement('div');
    h.className = 'b2t__head';
    h.setAttribute('role', 'row');
    [['name', firstLabel], ['masters', 'Master’s'], ['phd', 'PhD'], ['total', 'Total']].forEach(function (col) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'b2t__th b2t__th--' + col[0];
      b.setAttribute('role', 'columnheader');
      var active = sortState.key === col[0];
      if (active) b.classList.add('is-sorted', 'is-' + sortState.dir);
      b.setAttribute('aria-sort', active ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      b.innerHTML = '<span>' + col[1] + '</span>' + SORT_ICON;
      b.title = 'Sort by ' + col[1].replace(' (#)', '');
      b.addEventListener('click', function () {
        if (sortState.key === col[0]) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        else { sortState.key = col[0]; sortState.dir = col[0] === 'name' ? 'asc' : 'desc'; }
        rerender();
      });
      h.appendChild(b);
    });
    return h;
  }

  function numCells(row, c) {
    var t = totalOf(c);
    var m = document.createElement('span'); m.className = 'b2t__num'; m.textContent = num(c.masters);
    var p = document.createElement('span'); p.className = 'b2t__num'; p.textContent = num(c.phd);
    var tot = document.createElement('span'); tot.className = 'b2t__total'; tot.textContent = t;
    if (num(c.unknown)) tot.title = t + ' total, including ' + num(c.unknown) + ' unclassified degree' + (num(c.unknown) === 1 ? '' : 's');
    row.appendChild(m); row.appendChild(p); row.appendChild(tot);
  }

  function countryRow(c, opts, extraClass) {
    var row = document.createElement('div');
    row.className = 'db-world-country-row b2t__row' + (extraClass ? ' ' + extraClass : '');
    row.setAttribute('role', 'row');
    if (opts.selected && opts.selected === c.name) row.classList.add('is-filter-active');
    var wrap = document.createElement('span');
    wrap.className = 'db-world-country-row__name-wrap b2t__name-cell';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'db-world-country-row__name';
    btn.appendChild(flagEl(c));
    btn.appendChild(document.createTextNode(c.name));
    btn.setAttribute('aria-label', 'Filter panels below by ' + c.name);
    btn.addEventListener('click', function () { if (opts.onSelect) opts.onSelect(c.name); });
    wrap.appendChild(btn);
    // A plain space (not a margin) separates name and (#), so a wrapped (#)
    // starts exactly under the first letter of the country name.
    wrap.appendChild(document.createTextNode(' '));
    var uniN = Array.isArray(c.unis) ? c.unis.length : num(c.uniCount);
    var uc = document.createElement('span');
    uc.className = 'db-world-country-row__uni-count';
    uc.textContent = '(' + uniN + ')';
    uc.setAttribute('aria-label', uniN + (uniN === 1 ? ' university' : ' universities'));
    wrap.appendChild(uc);
    row.appendChild(wrap);
    numCells(row, c);
    return row;
  }

  function columns(host, items, firstLabel, buildRow, rerender) {
    host.innerHTML = '';
    host.classList.add('b2t-host');
    if (!items.length) return;
    var half = Math.ceil(items.length / 2);
    var parts = items.length > 1 ? [items.slice(0, half), items.slice(half)] : [items];
    parts.forEach(function (part) {
      var col = document.createElement('div');
      col.className = 'b2t';
      col.setAttribute('role', 'table');
      col.appendChild(header(firstLabel, rerender));
      part.forEach(function (it) { buildRow(col, it); });
      host.appendChild(col);
    });
  }

  function renderCountries(host, countries, opts) {
    if (!host) return;
    opts = opts || {};
    var list = sorted(countries || []);
    columns(host, list, 'Country (#)', function (col, c) { col.appendChild(countryRow(c, opts)); },
      function () { renderCountries(host, countries, opts); });
  }

  function regionOfFactory(points) {
    var map = new Map();
    (points || []).forEach(function (p) { if (p && p.country && p.region && !map.has(p.country)) map.set(p.country, p.region); });
    Object.keys(REGION_FALLBACK).forEach(function (r) {
      REGION_FALLBACK[r].forEach(function (c) { if (!map.has(c)) map.set(c, r); });
    });
    return function (name) { return map.get(name) || 'Other'; };
  }

  function renderRegions(host, countries, points, opts) {
    if (!host) return;
    opts = opts || {};
    var regionOf = regionOfFactory(points);
    var byRegion = new Map();
    (countries || []).forEach(function (c) {
      var r = regionOf(c.name);
      if (!byRegion.has(r)) byRegion.set(r, { name: r, masters: 0, phd: 0, unknown: 0, total: 0, countries: [] });
      var g = byRegion.get(r);
      g.masters += num(c.masters); g.phd += num(c.phd); g.unknown += num(c.unknown); g.total += totalOf(c);
      g.countries.push(c);
    });
    var regions = sorted(Array.from(byRegion.values()).sort(function (a, b) { return b.total - a.total; }));
    var rerender = function () { renderRegions(host, countries, points, opts); };
    columns(host, regions, 'Region (#)', function (col, g) {
      var open = !!regionOpen[g.name];
      var row = document.createElement('div');
      row.className = 'b2t__row b2t__row--region' + (open ? ' is-open' : '');
      row.setAttribute('role', 'row');
      var cell = document.createElement('span');
      cell.className = 'b2t__name-cell';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'b2t__region-name';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.innerHTML = '<span class="b2t__globe">' + GLOBE + '</span><span>' + esc(g.name) + '</span>' +
        '<span class="db-world-country-row__uni-count" aria-label="' + g.countries.length + ' countries">(' + g.countries.length + ')</span>' +
        '<svg class="b2t__chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      btn.title = (open ? 'Hide' : 'Show') + ' countries in ' + g.name;
      btn.addEventListener('click', function () { regionOpen[g.name] = !open; rerender(); });
      cell.appendChild(btn);
      row.appendChild(cell);
      numCells(row, g);
      col.appendChild(row);
      if (open) {
        g.countries.slice().sort(function (a, b) { return totalOf(b) - totalOf(a) || String(a.name).localeCompare(String(b.name)); })
          .forEach(function (c) { col.appendChild(countryRow(c, opts, 'b2t__row--sub')); });
      }
    }, rerender);
  }

  function regionHost(listView) {
    if (!listView) return null;
    var h = listView.querySelector('[data-world-region-list]');
    if (h) return h;
    var countryList = listView.querySelector('[data-world-country-list]');
    if (!countryList) return null;
    h = document.createElement('div');
    h.className = 'db-world-region-list';
    h.setAttribute('data-world-region-list', '');
    h.style.display = 'none';
    countryList.parentNode.insertBefore(h, countryList.nextSibling);
    return h;
  }

  function fmt(n) { return Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—'; }

  function setTallies(listView, t) {
    if (!listView) return;
    var tabs = listView.querySelector('[data-world-list-tabs]');
    if (!tabs) return;
    var bar = listView.querySelector('.b2t-toolbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'b2t-toolbar';
      tabs.parentNode.insertBefore(bar, tabs);
      bar.appendChild(tabs);
      var tallies = document.createElement('div');
      tallies.className = 'b2t-tallies';
      tallies.setAttribute('aria-label', 'Graduate study totals');
      [['scholars', 'Total # of Scholars', ICONS.scholars], ['masters', 'Master’s', ICONS.cap], ['phd', 'PhD', ICONS.cap]].forEach(function (d) {
        var card = document.createElement('div');
        card.className = 'b2t-tally b2t-tally--' + d[0];
        card.innerHTML = '<span class="b2t-tally__icon">' + d[2] + '</span>' +
          '<span class="b2t-tally__body"><span class="b2t-tally__label">' + d[1] + '</span>' +
          '<span class="b2t-tally__num" data-b2t-tally="' + d[0] + '">—</span></span>';
        tallies.appendChild(card);
      });
      bar.appendChild(tallies);
    }
    ['scholars', 'masters', 'phd'].forEach(function (k) {
      var el = bar.querySelector('[data-b2t-tally="' + k + '"]');
      if (el) el.textContent = fmt(t && t[k]);
    });
  }

  window.B2StudyTable = { renderCountries: renderCountries, renderRegions: renderRegions, regionHost: regionHost, setTallies: setTallies };
})();
