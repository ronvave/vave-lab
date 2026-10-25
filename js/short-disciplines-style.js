/* Panel B4 "Graduate research disciplines" — visual layer (Oct 2026).
   Shared by the Fiji, Tonga and Vanuatu dashboards. Each country script
   (js/<country>-short-disciplines.js) still builds the table and its counts;
   this file only decorates the rendered cells: discipline icons, header
   icons/colours, and proportional bars next to each Male/Female or
   Completed Master's/Completed PhD number. No values are changed. */
(function () {
  'use strict';
  var root = document.getElementById('graduate-disciplines');
  if (!root) return;
  var table = root.querySelector('.short-disciplines-table');
  if (!table) return;
  table.classList.add('sd-styled');

  var SVG = function (body) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };
  var ICONS = {
    social: SVG('<circle cx="12" cy="7.5" r="2.6" fill="currentColor" stroke="none"/><circle cx="5.6" cy="9" r="2.1" fill="currentColor" stroke="none"/><circle cx="18.4" cy="9" r="2.1" fill="currentColor" stroke="none"/><path d="M7.6 18.5c0-2.8 2-4.6 4.4-4.6s4.4 1.8 4.4 4.6z" fill="currentColor" stroke="none"/><path d="M2.4 18c0-2.3 1.4-3.8 3.3-3.8 .8 0 1.4.2 2 .6M21.6 18c0-2.3-1.4-3.8-3.3-3.8-.8 0-1.4.2-2 .6"/>'),
    life: SVG('<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 8-7 0 4.5-3 7-8 7z"/><path d="M12 15c0-3.3-2.5-6-6.5-6 0 3.6 2.4 6 6.5 6z"/>'),
    health: SVG('<path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 0 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z"/><path d="M6 12h3l1.5-2.5 2 5 1.5-2.5H18"/>'),
    education: SVG('<path d="M2.5 5.5c3-1 6.3-.8 9.5 1.2v12.6c-3.2-2-6.5-2.2-9.5-1.2z"/><path d="M21.5 5.5c-3-1-6.3-.8-9.5 1.2v12.6c3.2-2 6.5-2.2 9.5-1.2z"/>'),
    engineering: SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    earth: SVG('<path d="M2 15c2.2 0 2.2-1.5 4.4-1.5s2.2 1.5 4.4 1.5 2.2-1.5 4.4-1.5 2.2 1.5 4.4 1.5"/><path d="M2 19.5c2.2 0 2.2-1.5 4.4-1.5s2.2 1.5 4.4 1.5 2.2-1.5 4.4-1.5 2.2 1.5 4.4 1.5"/><path d="M6 11c.6-3.8 3.6-6.5 7.3-6.5 2.4 0 4.4 1.1 5.7 2.8-2.8-.6-5.3.8-6 3.7"/>'),
    theology: SVG('<path d="M12 2.5v19M6.5 8h11" stroke-width="3"/>'),
    humanities: SVG('<path d="M3 9.5 12 4l9 5.5z" fill="currentColor"/><path d="M5.5 11v7M9.8 11v7M14.2 11v7M18.5 11v7M3.5 20.5h17"/>'),
    other: SVG('<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'),
    male: SVG('<circle cx="12" cy="4.5" r="2.3" fill="currentColor" stroke="none"/><path d="M9 8.5h6l-.7 6.5h-1.3l-.5 6h-1l-.5-6H9.7z" fill="currentColor" stroke="none"/>'),
    female: SVG('<circle cx="12" cy="4.5" r="2.3" fill="currentColor" stroke="none"/><path d="M10 8.5h4l2.4 7.5h-2.6l-.4 5h-2.8l-.4-5H7.6z" fill="currentColor" stroke="none"/>'),
    cap: SVG('<path d="M1.5 9 12 4l10.5 5L12 14z" fill="currentColor"/><path d="M5.5 11v4.8c1.7 1.5 4 2.2 6.5 2.2s4.8-.7 6.5-2.2V11"/><path d="M21 9.5v5"/>')
  };
  function disciplineKey(name) {
    var n = String(name || '').toLowerCase();
    if (/social/.test(n)) return 'social';
    if (/life|environment/.test(n)) return 'life';
    if (/health|medic/.test(n)) return 'health';
    if (/educat/.test(n)) return 'education';
    if (/engineer|technolog|planning/.test(n)) return 'engineering';
    if (/earth|ocean|atmos|marine/.test(n)) return 'earth';
    if (/theolog|relig/.test(n)) return 'theology';
    if (/humanit|arts|history|language/.test(n)) return 'humanities';
    return 'other';
  }
  function columnKind(label) {
    var t = String(label || '').toLowerCase();
    if (t === 'male') return 'male';
    if (t === 'female') return 'female';
    if (/master/.test(t)) return 'masters';
    if (/phd|doctor/.test(t)) return 'phd';
    if (/total/.test(t)) return 'total';
    return '';
  }
  var HEAD_ICON = { male: 'male', female: 'female', masters: 'cap', phd: 'cap' };
  var parse = function (s) { var v = Number(String(s).replace(/[^0-9.-]/g, '')); return Number.isFinite(v) ? v : 0; };

  var busy = false;
  function decorate() {
    if (busy || table.hidden) return;
    var headRow = table.tHead && table.tHead.rows[0];
    if (!headRow) return;
    busy = true;
    try {
      var kinds = Array.prototype.map.call(headRow.cells, function (c) { return c.dataset.sdKind || columnKind(c.textContent.trim()); });
      table.dataset.sdView = kinds.indexOf('male') >= 0 ? 'gender' : 'degree';
      Array.prototype.forEach.call(headRow.cells, function (c, i) {
        var k = kinds[i];
        c.className = 'sd-th' + (k ? ' sd-th--' + k : '') + (i === 0 ? ' sd-th--name' : '');
        if (HEAD_ICON[k] && !c.dataset.sdKind) {
          var label = c.textContent.trim();
          c.innerHTML = '<span class="sd-th__inner"><span class="sd-th__icon">' + ICONS[HEAD_ICON[k]] + '</span><span>' + label.replace(/[&<>]/g, '') + '</span></span>';
        }
        c.dataset.sdKind = k || 'name';
      });
      var barCols = [];
      kinds.forEach(function (k, i) { if (k && k !== 'total' && i > 0) barCols.push(i); });
      var bodyRows = table.tBodies[0] ? Array.prototype.slice.call(table.tBodies[0].rows) : [];
      // One shared scale for both bar columns so bars compare fairly.
      var bodyMax = 0;
      bodyRows.forEach(function (r) {
        barCols.forEach(function (i) { if (r.cells[i]) bodyMax = Math.max(bodyMax, parse(r.cells[i].textContent)); });
      });
      bodyRows.forEach(function (r) {
        if (r.cells.length < 2) return; // empty-state message row
        var nameCell = r.cells[0];
        if (!nameCell.querySelector('.sd-ico')) {
          var name = nameCell.textContent.trim();
          var key = disciplineKey(name);
          nameCell.innerHTML = '<span class="sd-name"><span class="sd-ico sd-ico--' + key + '">' + ICONS[key] + '</span><span class="sd-name__text"></span></span>';
          nameCell.querySelector('.sd-name__text').textContent = name;
        }
        barCols.forEach(function (i) { barCell(r.cells[i], kinds[i], bodyMax ? parse(r.cells[i].textContent) / bodyMax * 0.78 : 0); });
        var tot = r.cells[r.cells.length - 1];
        if (tot) tot.classList.add('sd-total');
      });
      var foot = table.tFoot && table.tFoot.rows[0];
      if (foot) {
        foot.classList.add('sd-foot');
        var overallTotal = parse(foot.cells[foot.cells.length - 1] && foot.cells[foot.cells.length - 1].textContent);
        // Overall row: bar = share of all unique scholars in this table.
        barCols.forEach(function (i) { if (foot.cells[i]) barCell(foot.cells[i], kinds[i], overallTotal ? parse(foot.cells[i].textContent) / overallTotal : 0); });
        var ft = foot.cells[foot.cells.length - 1];
        if (ft) ft.classList.add('sd-total');
      }
    } finally { busy = false; }
  }
  function barCell(cell, kind, frac) {
    if (!cell) return;
    var existing = cell.querySelector('.sd-num');
    var value = existing ? existing.textContent : cell.textContent.trim();
    var pct = Math.max(0, Math.min(1, frac)) * 100;
    cell.className = 'sd-cell sd-cell--' + kind;
    cell.innerHTML = '<span class="sd-bar-cell"><span class="sd-num"></span><span class="sd-track"><i style="width:' + pct.toFixed(1) + '%"></i></span></span>';
    cell.querySelector('.sd-num').textContent = value;
  }
  function boldCaption() {
    var cap = root.querySelector('.short-disciplines-caption');
    if (!cap || cap.querySelector('.sd-cap-lead')) return;
    var txt = cap.textContent;
    var m = /^Interpretation:\s*/.exec(txt);
    if (!m) return;
    cap.textContent = '';
    var b = document.createElement('strong'); b.className = 'sd-cap-lead'; b.textContent = 'Interpretation:';
    cap.appendChild(b); cap.appendChild(document.createTextNode(' ' + txt.slice(m[0].length)));
  }

  var queued = false;
  function schedule() {
    if (queued) return; queued = true;
    Promise.resolve().then(function () { queued = false; decorate(); boldCaption(); });
  }
  var mo = new MutationObserver(function () { if (!busy) schedule(); });
  [table.tHead, table.tBodies[0], table.tFoot].forEach(function (sec) { if (sec) mo.observe(sec, { childList: true }); });
  mo.observe(table, { attributes: true, attributeFilter: ['hidden'] });
  var cap = root.querySelector('.short-disciplines-caption');
  if (cap) mo.observe(cap, { childList: true });
  schedule();
})();
