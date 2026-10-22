/* Tonga dashboard: turn grey text inside the panels black so it reads clearly
   on the mat background. Only greys are changed (coloured, white and black
   text are left alone); the image headers are skipped. Re-applies when
   charts or lists redraw. */
(function () {
  'use strict';
  var SKIP = '.tph-hero, .leaflet-control-attribution, .leaflet-tile-pane, input, select, textarea, option';
  function parse(c) {
    var m = c && c.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  }
  function isGrey(c) {
    var v = parse(c); if (!v) return false;
    var mx = Math.max(v[0], v[1], v[2]), mn = Math.min(v[0], v[1], v[2]);
    if (mx - mn > 26) return false;                 // has a real hue
    if (v[3] < 0.95 && mx < 80) return true;        // translucent black reads as grey
    return mx >= 60 && mx <= 200 && v[3] > 0.3;     // mid greys
  }
  function hasText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }
  function check(el) {
    if (el.nodeType !== 1 || el.classList.contains('tct-dark') || el.closest(SKIP)) return;
    if (!hasText(el)) return;
    var cs = getComputedStyle(el);
    if (el instanceof SVGElement) {
      if (isGrey(cs.fill)) el.classList.add('tct-dark');
    } else if (isGrey(cs.color)) el.classList.add('tct-dark');
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    check(root);
    root.querySelectorAll('*').forEach(check);
  }
  var queue = [], t = 0;
  function flush() { t = 0; var q = queue; queue = []; q.forEach(scan); }
  function run() {
    var panels = document.querySelectorAll('.tph-panel');
    panels.forEach(function (p) {
      scan(p);
      new MutationObserver(function (ms) {
        ms.forEach(function (m) {
          if (m.type === 'childList') m.addedNodes.forEach(function (n) { if (n.nodeType === 1) queue.push(n); else if (n.parentElement) queue.push(n.parentElement); });
          else if (m.target.nodeType === 1) queue.push(m.target);
        });
        if (!t) t = setTimeout(flush, 120);
      }).observe(p, { childList: true, subtree: true, characterData: false, attributes: true, attributeFilter: ['class', 'style'] });
    });
  }
  // Wait for the panel headers (tongan-panel-hero.js) to be built first.
  function start() { if (document.querySelector('.tph-panel')) run(); else setTimeout(start, 200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
