/* Panel B5 "Global locations of research" country list — B2 table styling
   (Oct 2026). Each dashboard's own renderB3CountryList() still builds the rows
   and counts; this add-on regroups those rows into the two B2-style table
   cards (header bar, flag, rounded row pills, Total pill). Rows are moved, not
   re-created, so their click-to-zoom handlers keep working. */
(function () {
  'use strict';
  function init() {
    var host = document.querySelector('[data-b3-country-list]');
    if (!host) return;
    var thead = document.querySelector('[data-b3-country-thead]');
    var labels = ['Country', 'Led', 'Others', 'Total'];
    var titles = ['', '', '', ''];
    if (thead) {
      var spans = thead.querySelectorAll('span:not(.b3-country-table-head__spacer)');
      for (var i = 0; i < 4 && i < spans.length; i++) {
        labels[i] = spans[i].textContent.trim() || labels[i];
        titles[i] = spans[i].getAttribute('title') || '';
      }
      thead.classList.add('b5t-hidden');
    }
    var KIND = ['name', 'led', 'others', 'total'];
    var busy = false;

    function header() {
      var h = document.createElement('div');
      h.className = 'b2t__head b5t__head';
      h.setAttribute('role', 'row');
      labels.forEach(function (l, i) {
        var c = document.createElement('span');
        c.className = 'b2t__th b2t__th--' + KIND[i] + ' b5t__th--' + KIND[i];
        c.setAttribute('role', 'columnheader');
        c.textContent = l;
        if (titles[i]) c.title = titles[i];
        h.appendChild(c);
      });
      return h;
    }

    function styleRow(row) {
      if (row.classList.contains('b2t__row')) return;
      row.classList.add('b2t__row', 'b5t__row');
      row.setAttribute('role', 'row');
      var name = row.querySelector('.db-world-country-row__name');
      if (name) {
        var country = row.getAttribute('data-b3-country') || name.textContent;
        var wrap = document.createElement('span');
        wrap.className = 'db-world-country-row__name-wrap b2t__name-cell';
        row.insertBefore(wrap, name);
        wrap.appendChild(name);
        if (window.B2StudyTable && window.B2StudyTable.flag) {
          name.insertBefore(window.B2StudyTable.flag(country), name.firstChild);
        }
      }
      var nums = row.querySelectorAll('.db-world-country-row__num');
      Array.prototype.forEach.call(nums, function (n) {
        n.classList.add(n.classList.contains('b3-cell--total') ? 'b2t__total' : 'b2t__num');
      });
    }

    function build() {
      var rows = Array.prototype.filter.call(host.children, function (c) {
        return c.classList.contains('db-world-country-row');
      });
      if (!rows.length) {
        // Our own rebuild also triggers the observer; only drop the layout
        // when the dashboard rendered an empty-state message instead of rows.
        if (!host.querySelector('.b5t')) host.classList.remove('b2t-host', 'b5t-host');
        return;
      }
      busy = true;
      try {
        rows.forEach(styleRow);
        host.classList.add('b2t-host', 'b5t-host');
        var half = Math.ceil(rows.length / 2);
        var parts = rows.length > 1 ? [rows.slice(0, half), rows.slice(half)] : [rows];
        var frag = document.createDocumentFragment();
        parts.forEach(function (part) {
          var col = document.createElement('div');
          col.className = 'b2t b5t';
          col.setAttribute('role', 'table');
          col.appendChild(header());
          part.forEach(function (r) { col.appendChild(r); });
          frag.appendChild(col);
        });
        host.innerHTML = '';
        host.appendChild(frag);
      } finally {
        busy = false;
      }
    }

    new MutationObserver(function () { if (!busy) build(); }).observe(host, { childList: true });
    build();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
