/*
 * Link analytics (Google Analytics G-7LJP79H70W).
 *
 * Load synchronously before the page's gtag('config') call, then pass
 * window.vlGaCfg as the config's third argument.
 *
 * Shared links carry two extra hash values: lc=<country code> (whose link it
 * is) and lt=<c|r|a1> (country link, Regional link, or a country dashboard
 * opened from Regional Panel A1). Visits without them are tagged lc=none.
 * Google Analytics receives only page path + ?lc=..&lt=.. : never the hash,
 * link keys, tokens, scholar IDs or names.
 *
 * Panel time: every second the tab is visible, each badged panel (A1, B2…) that fills enough of the screen (and is not covered by a passcode
 * screen or popup) gains a second. When it leaves the screen, or the tab is
 * hidden, an event panel_<ID> is sent with value = seconds (2 s minimum).
 */
(function () {
  'use strict';
  var h = location.hash || '';
  function hv(k, re) { var m = new RegExp('(?:^|[#&])' + k + '=(' + re + ')(?:&|$)').exec(h); return m ? m[1] : ''; }
  var lc = hv('lc', '[A-Z]{3}') || 'none';
  var lt = hv('lt', 'c|r|a1') || (lc !== 'none' && /pacific-scholars\.html$/.test(location.pathname) ? 'r' : (lc === 'none' ? 'none' : 'c'));
  window.vlGaCfg = { page_location: location.origin + location.pathname + '?lc=' + lc + '&lt=' + lt };

  var MIN_S = 2, MAX_S = 1800, acc = {}, titles = {};
  function send(id) {
    var s = Math.round((acc[id] || 0) / 1000);
    acc[id] = 0;
    if (s < MIN_S || typeof window.gtag !== 'function') return;
    window.gtag('event', 'panel_' + id, { value: Math.min(s, MAX_S), panel_title: titles[id] || id, transport_type: 'beacon' });
  }
  // Country dashboards mark panels with a badge (.db-panel__label "B2");
  // the Regional page uses data-panel="B2". Outermost panel per code wins.
  function panels() {
    var out = [], seen = {};
    function add(code, el, title) {
      var id = String(code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
      if (!id || !el || seen[id]) return;
      seen[id] = 1; out.push([id, el]);
      if (!titles[id]) titles[id] = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    var labels = document.querySelectorAll('.db-panel__label');
    for (var i = 0; i < labels.length; i++) {
      var code = labels[i].textContent.trim();
      if (!/^[A-H][0-9]?$/.test(code)) continue;
      var p = labels[i].closest('.has-panel-badge, .db-panel');
      add(code, p, p && ((p.querySelector('h2, h3') || {}).textContent || ''));
    }
    var all = document.querySelectorAll('[data-panel]');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (el.parentElement && el.parentElement.closest('[data-panel]')) continue;
      add(el.getAttribute('data-panel'), el, el.getAttribute('data-panel-title') || ((el.querySelector('h2, h3') || {}).textContent || ''));
    }
    return out;
  }
  function onScreen(el) {
    var r = el.getBoundingClientRect(), vh = window.innerHeight || 1;
    var top = Math.max(r.top, 0), bot = Math.min(r.bottom, vh), vis = bot - top;
    if (vis <= 0 || r.width === 0) return false;
    if (vis < Math.min(0.35 * r.height, 0.5 * vh)) return false;
    var x = Math.min(Math.max(r.left + r.width / 2, 1), (window.innerWidth || 2) - 1);
    var hit = document.elementFromPoint(x, top + vis / 2);
    return !!(hit && el.contains(hit));
  }
  var last = {};
  function tick() {
    if (document.visibilityState !== 'visible') return;
    var now = {}, list = panels();
    for (var i = 0; i < list.length; i++) {
      var id = list[i][0];
      if (onScreen(list[i][1])) { now[id] = 1; acc[id] = (acc[id] || 0) + 1000; }
    }
    for (var k in last) if (!now[k]) send(k);
    last = now;
  }
  function flushAll() { for (var k in acc) send(k); last = {}; }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
  setInterval(tick, 1000);
})();
