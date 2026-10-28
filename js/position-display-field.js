/* "Positions shown on your profile" checklist for the Update info form
 * (Fiji and Tonga, 2026-10-28).
 *
 * Lists every position recorded for the scholar in the Positions sheet of the
 * Master file, each with a tick box. Ticked = shown on the scholar card.
 * Unticking a position asks the reviewer to set that row's
 * 'Public Display Approved' to FALSE; re-ticking sets it back to TRUE.
 *
 * Each box is named  position_show__<Position ID>  with value "Yes", so the
 * forms' existing "send changed fields only" logic submits just the boxes the
 * person changed ("Yes" = show, "" or "No" = hide).
 *
 * Positions come from js/country-positions.js (window.countryPositions).
 */
(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function injectCss() {
    if (document.getElementById('pdisp-css')) return;
    var s = document.createElement('style');
    s.id = 'pdisp-css';
    s.textContent =
      '.pdisp-help{margin:0 0 10px;font-size:13px;line-height:1.45;color:#111}' +
      '.pdisp-tools{display:flex;gap:8px;margin:0 0 8px}' +
      '.pdisp-tools button{all:unset;cursor:pointer;font-size:12.5px;font-weight:600;color:#0b5d6b;padding:3px 10px;border:1px solid #9fc4ca;border-radius:999px;background:#fff}' +
      '.pdisp-tools button:hover{background:#eef6f7}' +
      '.pdisp-list{list-style:none;margin:0;padding:0;border:1px solid #d5dde0;border-radius:10px;max-height:340px;overflow:auto;background:#fff}' +
      '.pdisp-item{border-top:1px solid #e6ecee}' +
      '.pdisp-item:first-child{border-top:0}' +
      '.pdisp-item label{display:grid!important;grid-template-columns:18px 1fr auto;align-items:start;gap:10px;padding:9px 12px;cursor:pointer;margin:0!important;text-align:left;font-weight:400}' +
      '.pdisp-item input[type=checkbox]{width:16px!important;height:16px;min-width:0!important;margin:2px 0 0!important;padding:0!important;flex:none}' +
      '.pdisp-item.is-off .pdisp-title,.pdisp-item.is-off .pdisp-sub{text-decoration:line-through;color:#555}' +
      '.pdisp-title{display:block;font-size:13.5px;font-weight:600;color:#111;line-height:1.35}' +
      '.pdisp-sub{display:block;font-size:12.5px;color:#111;line-height:1.35;margin-top:2px}' +
      '.pdisp-tag{font-size:11px;font-weight:700;letter-spacing:.02em;padding:2px 8px;border-radius:999px;white-space:nowrap;margin-top:1px}' +
      '.pdisp-tag.is-cur{background:#e3f4ea;color:#14532d}' +
      '.pdisp-tag.is-past{background:#eceff1;color:#111}' +
      '.pdisp-count{font-size:12.5px;color:#111;margin:6px 0 0}';
    document.head.appendChild(s);
  }

  function years(r) {
    var api = window.countryPositions;
    return api && typeof api.years === 'function' ? api.years(r) : [r.start, r.end].filter(Boolean).join('–');
  }

  /* render(container, rows) -> [{id, box, initial}]
   * container: element to append into (a fieldset or grid cell). */
  function render(container, rows) {
    injectCss();
    var out = [];
    var help = el('p', 'pdisp-help',
      'These are the positions recorded for this scholar. Untick any position you do not want shown on the public profile. ' +
      'Unticked positions are kept in the Master file and can be shown again later. Changes are reviewed before the profile is updated.');
    container.appendChild(help);
    var tools = el('div', 'pdisp-tools');
    var all = el('button', null, 'Tick all'); all.type = 'button';
    var none = el('button', null, 'Untick all'); none.type = 'button';
    tools.appendChild(all); tools.appendChild(none);
    container.appendChild(tools);
    var list = el('ul', 'pdisp-list');
    var count = el('p', 'pdisp-count');
    function recount() {
      var on = out.filter(function (x) { return x.box.checked; }).length;
      count.textContent = on + ' of ' + out.length + ' position' + (out.length === 1 ? '' : 's') + ' will be shown.';
    }
    rows.forEach(function (r) {
      var li = el('li', 'pdisp-item');
      var lab = el('label');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.name = 'position_show__' + r.id;
      box.value = 'Yes';
      box.checked = !r.hide;
      box.setAttribute('data-position-id', r.id);
      var text = el('span');
      text.appendChild(el('span', 'pdisp-title', (r.title || r.lead || 'Position') + (r.title && r.lead ? '; ' + r.lead : '')));
      var sub = [r.dept, r.inst, r.country, years(r)].filter(Boolean).join(' · ');
      if (sub) text.appendChild(el('span', 'pdisp-sub', sub));
      var tag = el('span', 'pdisp-tag ' + (r.cur ? 'is-cur' : 'is-past'), r.cur ? 'Current' : 'Past');
      lab.appendChild(box); lab.appendChild(text); lab.appendChild(tag);
      li.appendChild(lab);
      list.appendChild(li);
      function sync() { li.classList.toggle('is-off', !box.checked); recount(); }
      box.addEventListener('change', sync);
      out.push({ id: r.id, box: box, initial: box.checked, sync: sync });
      li.classList.toggle('is-off', !box.checked);
    });
    all.addEventListener('click', function () { out.forEach(function (x) { x.box.checked = true; x.sync(); }); });
    none.addEventListener('click', function () { out.forEach(function (x) { x.box.checked = false; x.sync(); }); });
    container.appendChild(list);
    container.appendChild(count);
    recount();
    return out;
  }

  function forSid(sid) {
    var api = window.countryPositions;
    if (!api || typeof api.forSid !== 'function' || !sid) return Promise.resolve([]);
    return api.forSid(sid).catch(function () { return []; });
  }

  window.PositionDisplayField = { render: render, forSid: forSid };
})();
