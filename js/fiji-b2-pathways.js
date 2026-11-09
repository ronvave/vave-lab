/* Fiji B2 — "Master's → PhD pathways" overlay for the world study map.
 *
 * Add-on only: reads window.__vavelabDbState (exposed by
 * itaukei-database-master.js) and draws on top of the existing Leaflet map.
 * It never edits the base markers' data, popups, filters or search; when the
 * switch is off the map is exactly as before.
 *
 * Data rule (from the Master-derived worldPoints, completed degrees only):
 *   a scholar with at least one completed Master's and one completed PhD gets
 *   one pathway per PhD, starting at the latest Master's completed in or
 *   before that PhD's year (or the earliest Master's if no year comparison is
 *   possible). Same university for both → pulsing ring instead of an arc.
 */
(function () {
  'use strict';

  var REGION_COLORS = {
    Oceania: '#20808E', Americas: '#8B2E3F', Europe: '#2C6DA8',
    Asia: '#E9AF34', Africa: '#848456'
  };
  var REGION_ORDER = ['Oceania', 'Americas', 'Europe', 'Asia', 'Africa'];
  var FALLBACK = '#9aa0a6';
  var PERIOD = 3600; // ms per trip

  function regionKey(r) {
    r = String(r || '');
    if (/america/i.test(r)) return 'Americas';
    for (var i = 0; i < REGION_ORDER.length; i++) if (r.indexOf(REGION_ORDER[i]) === 0) return REGION_ORDER[i];
    return r;
  }
  function colorFor(r) { return REGION_COLORS[regionKey(r)] || FALLBACK; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function displayName(n) {
    // "Surname, Given" → "Given Surname" (bracketed aliases kept as-is)
    var m = String(n || '').match(/^([^,]+),\s*(.+)$/);
    return m ? (m[2] + ' ' + m[1]) : String(n || '');
  }
  function level(degree) {
    var d = String(degree || '');
    if (/^PhD|Doctor/i.test(d)) return 'phd';
    if (/^Master/i.test(d)) return 'masters';
    return '';
  }

  var S = null;          // dashboard state
  var on = false, paused = false;
  var pane = null, linePane = null, canvas = null, ctx = null, renderer = null;
  var lineLayer = null, arcs = [], rings = [];
  var sig = '', clock = 0, last = 0, raf = 0;
  var ui = {};

  // ---------- data ----------
  function buildPathways() {
    var map = S.worldMap, layer = S.worldLayer;
    if (!map || !layer || S.worldMode === 'work' || S.worldView === 'publish') return [];
    // Current (filtered) points and their displayed positions.
    var byUni = {};
    layer.getLayers().forEach(function (m) {
      var p = m._worldPoint; if (!p) return;
      byUni[p.university + '|' + p.country] = {
        p: p, ll: m.getLatLng(),
        phd: new Set(p.phdScholars || []), mas: new Set(p.mastersScholars || [])
      };
    });
    // All completed records grouped by scholarId (full data, then gated by
    // the filtered name lists above so fullscreen filters apply).
    var people = {};
    (S.graduateStudies.worldPoints || []).forEach(function (p) {
      var cur = byUni[p.university + '|' + p.country];
      if (!cur) return;
      (p.scholars || []).forEach(function (r) {
        if (!r || !r.completed) return;
        var lv = level(r.degree); if (!lv) return;
        if (lv === 'phd' && !cur.phd.has(r.name)) return;
        if (lv === 'masters' && !cur.mas.has(r.name)) return;
        var key = r.scholarId || ('N:' + r.name);
        var e = people[key] || (people[key] = { name: r.name, m: [], p: [] });
        (lv === 'phd' ? e.p : e.m).push({ at: cur, y: Number(r.year) || null });
      });
    });
    var q = String(S.worldSearchTerm || '').trim().toLowerCase();
    var out = [];
    Object.keys(people).forEach(function (k) {
      var e = people[k];
      if (!e.m.length || !e.p.length) return;
      e.p.forEach(function (ph) {
        var cands = e.m.filter(function (m) { return m.y && ph.y && m.y <= ph.y; });
        var ms = cands.length
          ? cands.sort(function (a, b) { return b.y - a.y; })[0]
          : e.m.slice().sort(function (a, b) { return (a.y || 9999) - (b.y || 9999); })[0];
        out.push({ name: e.name, m: ms, p: ph });
      });
    });
    if (!q) return out;
    var hitName = out.filter(function (x) { return x.name.toLowerCase().indexOf(q) >= 0; });
    if (hitName.length) return hitName;
    return out.filter(function (x) {
      return [x.m.at.p.university, x.m.at.p.country, x.p.at.p.university, x.p.at.p.country]
        .some(function (s) { return String(s || '').toLowerCase().indexOf(q) >= 0; });
    });
  }

  // ---------- drawing ----------
  function ensureLayers() {
    var map = S.worldMap;
    if (!map.getPane('b2PathLines')) {
      linePane = map.createPane('b2PathLines');
      linePane.style.zIndex = 605;
      pane = map.createPane('b2PathDots');
      pane.style.zIndex = 606;
      pane.style.pointerEvents = 'none';
      canvas = L.DomUtil.create('canvas', 'b2-path-canvas', pane);
      canvas.style.position = 'absolute';
      canvas.style.pointerEvents = 'none';
      ctx = canvas.getContext('2d');
      renderer = L.svg({ pane: 'b2PathLines', padding: 0.5 });
    }
  }

  function curvePoints(map, a, b) {
    // Quadratic Bézier in projected space, bowed to the left of travel.
    var z = 4, pa = map.project(a, z), pb = map.project(b, z);
    var dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    var bow = Math.min(0.28 * d, 900);
    var c = L.point((pa.x + pb.x) / 2 - dy / d * bow, (pa.y + pb.y) / 2 + dx / d * bow);
    var pts = [];
    for (var i = 0; i <= 48; i++) {
      var t = i / 48, u = 1 - t;
      pts.push(map.unproject(L.point(
        u * u * pa.x + 2 * u * t * c.x + t * t * pb.x,
        u * u * pa.y + 2 * u * t * c.y + t * t * pb.y), z));
    }
    return pts;
  }

  function tipRow(x) {
    var my = x.m.y ? ' (' + x.m.y + ')' : '', py = x.p.y ? ' (' + x.p.y + ')' : '';
    return '<div class="b2pw-tip-row"><strong>' + esc(displayName(x.name)) + '</strong><br>' +
      'Master\u2019s: ' + esc(x.m.at.p.university) + my + '<br>' +
      'PhD: ' + esc(x.p.at.p.university) + py + '</div>';
  }

  function rebuild() {
    var map = S.worldMap;
    ensureLayers();
    if (lineLayer) { map.removeLayer(lineLayer); lineLayer = null; }
    arcs = []; rings = [];
    var list = buildPathways();
    var routes = {}, same = {};
    list.forEach(function (x) {
      var a = x.m.at, b = x.p.at;
      if (a === b) {
        var k0 = a.p.university + '|' + a.p.country;
        (same[k0] = same[k0] || { at: a, people: [] }).people.push(x);
      } else {
        var k = a.p.university + '|' + a.p.country + '>' + b.p.university + '|' + b.p.country;
        (routes[k] = routes[k] || { a: a, b: b, people: [] }).people.push(x);
      }
    });
    var group = [];
    Object.keys(routes).forEach(function (k, i) {
      var r = routes[k], A = r.a.ll, B = r.b.ll;
      // Always join the two circles exactly where they are drawn, so every
      // line ends on a visible university marker (no wrapped copies).
      var pts = curvePoints(map, A, B);
      var color = colorFor(r.b.p.region), n = r.people.length;
      var w = Math.min(9, 1.6 + 1.3 * n);
      var line = L.polyline(pts, { renderer: renderer, pane: 'b2PathLines', color: color, weight: w, opacity: 0.6, lineCap: 'round', interactive: true });
      var hit = L.polyline(pts, { renderer: renderer, pane: 'b2PathLines', color: '#000', weight: Math.max(14, w + 8), opacity: 0, interactive: true });
      var html = '<div class="b2pw-tip-head">' + esc(r.a.p.university) + ' \u2192 ' + esc(r.b.p.university) +
        ' \u00b7 ' + n + (n === 1 ? ' scholar' : ' scholars') + '</div>' + r.people.map(tipRow).join('');
      hit.bindTooltip(html, { sticky: true, className: 'b2pw-tip', direction: 'top', offset: [0, -8] });
      hit.on('mouseover', function () { line.setStyle({ opacity: 0.95 }); });
      hit.on('mouseout', function () { line.setStyle({ opacity: 0.6 }); });
      group.push(line, hit);
      for (var j = 0; j < n; j++) arcs.push({ pts: pts, color: color, phase: ((i * 0.37 + j / n) % 1) });
    });
    Object.keys(same).forEach(function (k) {
      var s = same[k], color = colorFor(s.at.p.region), n = s.people.length;
      var hit = L.circleMarker(s.at.ll, { renderer: renderer, pane: 'b2PathLines', radius: 16, stroke: false, fillOpacity: 0, interactive: true });
      var html = '<div class="b2pw-tip-head">Master\u2019s and PhD at ' + esc(s.at.p.university) +
        ' \u00b7 ' + n + (n === 1 ? ' scholar' : ' scholars') + '</div>' + s.people.map(tipRow).join('');
      hit.bindTooltip(html, { sticky: true, className: 'b2pw-tip', direction: 'top', offset: [0, -10] });
      group.push(hit);
      rings.push({ ll: s.at.ll, color: color, n: n });
    });
    lineLayer = L.layerGroup(group).addTo(map);
    dimMarkers(true);
    var routeCount = Object.keys(routes).length, ringCount = list.length - arcs.length;
    var scholars = new Set(list.map(function (x) { return x.name; })).size;
    var pl = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
    if (ui.count) ui.count.textContent = pl(scholars, 'scholar', 'scholars') + ' \u00b7 ' +
      pl(list.length, 'pathway', 'pathways') + ': ' + arcs.length + ' to a different university, ' +
      ringCount + ' at the same university';
    if (ui.root) ui.root.setAttribute('data-routes', routeCount);
  }

  function dimMarkers(dim) {
    if (!S || !S.worldLayer) return;
    S.worldLayer.getLayers().forEach(function (m) {
      if (m.setStyle) m.setStyle(dim ? { fillOpacity: 0.28, opacity: 0.45 } : { fillOpacity: 0.85, opacity: 1 });
    });
  }

  function teardown() {
    if (lineLayer && S.worldMap) S.worldMap.removeLayer(lineLayer);
    lineLayer = null; arcs = []; rings = [];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    dimMarkers(false);
    sig = '';
  }

  function stateSig() {
    return [S.worldLayer && L.stamp(S.worldLayer), S.worldMap && S.worldMap.getZoom(),
      S.worldMode, S.worldView, S.worldSearchTerm, !!S.worldMapFullscreen].join('|');
  }

  function at(pts, t) {
    var f = t * (pts.length - 1), i = Math.floor(f), r = f - i;
    var a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    return L.latLng(a.lat + (b.lat - a.lat) * r, a.lng + (b.lng - a.lng) * r);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!on || !S || !S.worldMap) return;
    var s = stateSig();
    if (s !== sig) { sig = s; rebuild(); }
    if (!paused && last) clock += now - last;
    last = now;
    var map = S.worldMap, size = map.getSize(), dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
      canvas.width = size.x * dpr; canvas.height = size.y * dpr;
      canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    var base = clock / PERIOD;
    arcs.forEach(function (a) {
      var t = (base + a.phase) % 1;
      // short fading tail
      for (var k = 6; k >= 0; k--) {
        var tt = t - k * 0.018; if (tt < 0) continue;
        var p = map.latLngToContainerPoint(at(a.pts, tt));
        ctx.globalAlpha = k === 0 ? 1 : (0.5 - k * 0.07);
        ctx.fillStyle = k === 0 ? '#ffffff' : a.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, k === 0 ? 3.2 : 3 - k * 0.3, 0, 6.2832); ctx.fill();
      }
      var h = map.latLngToContainerPoint(at(a.pts, t));
      var g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 11);
      g.addColorStop(0, a.color); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.85; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(h.x, h.y, 11, 0, 6.2832); ctx.fill();
    });
    rings.forEach(function (r, i) {
      var c = map.latLngToContainerPoint(r.ll);
      for (var w = 0; w < 2; w++) {
        var t = ((base * 0.8) + w * 0.5 + i * 0.13) % 1;
        ctx.globalAlpha = 0.9 * (1 - t);
        ctx.strokeStyle = r.color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, 6 + t * (14 + Math.min(r.n, 15) * 1.2), 0, 6.2832); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  // ---------- controls ----------
  function injectCss() {
    var css =
      '.leaflet-b2PathLines-pane svg,.leaflet-b2PathDots-pane canvas{max-width:none!important;max-height:none!important}' +
      '.b2pw-ctl{background:rgba(255,255,255,.95);border-radius:10px;padding:8px 10px;box-shadow:0 2px 10px rgba(0,0,0,.25);font:600 12.5px Arial,Helvetica,sans-serif;color:#1d2b33;max-width:320px}' +
      '.b2pw-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.b2pw-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;border:none;background:none;padding:0;font:inherit;color:inherit}' +
      '.b2pw-track{width:34px;height:18px;border-radius:9px;background:#b9c2c7;position:relative;transition:background .15s}' +
      '.b2pw-track::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}' +
      '.b2pw-switch[aria-checked="true"] .b2pw-track{background:#20808E}' +
      '.b2pw-switch[aria-checked="true"] .b2pw-track::after{left:18px}' +
      '.b2pw-pause{border:1px solid #20808E;color:#20808E;background:#fff;border-radius:999px;padding:3px 10px;font:inherit;cursor:pointer}' +
      '.b2pw-pause:hover{background:#e7f3f4}' +
      '.b2pw-extra{margin-top:6px;font-weight:400}' +
      '.b2pw-legend{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px}' +
      '.b2pw-legend span{display:inline-flex;align-items:center;gap:4px}' +
      '.b2pw-legend i{width:14px;height:4px;border-radius:2px;display:inline-block}' +
      '.b2pw-legend i.ring{width:10px;height:10px;border-radius:50%;border:2px solid #20808E;background:none}' +
      '.b2pw-count{color:#4a5a63;margin-top:4px;font-size:11.5px}' +
      '.leaflet-tooltip.b2pw-tip{font:12px Arial,Helvetica,sans-serif;width:280px;max-width:280px;white-space:normal;max-height:300px;overflow:auto;pointer-events:none}' +
      '.b2pw-tip-head{font-weight:700;margin-bottom:4px;color:#0e4d55}' +
      '.b2pw-tip-row{padding:3px 0;border-top:1px solid #eee}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  function addControl() {
    var Ctl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: function () {
        var root = L.DomUtil.create('div', 'b2pw-ctl');
        root.innerHTML =
          '<div class="b2pw-row">' +
            '<button type="button" class="b2pw-switch" role="switch" aria-checked="false" data-b2pw-toggle>' +
              '<span class="b2pw-track" aria-hidden="true"></span><span>Master\u2019s \u2192 PhD pathways</span></button>' +
            '<button type="button" class="b2pw-pause" data-b2pw-pause hidden>Pause</button>' +
          '</div>' +
          '<div class="b2pw-extra" data-b2pw-extra hidden>' +
            '<div>Line colour = region of the PhD university; thicker = more scholars on that route. Hover a line or ring for names.</div>' +
            '<div class="b2pw-legend">' +
              REGION_ORDER.map(function (r) { return '<span><i style="background:' + REGION_COLORS[r] + '"></i>' + r + '</span>'; }).join('') +
              '<span><i class="ring"></i>Same university</span>' +
            '</div>' +
            '<div class="b2pw-count" data-b2pw-count></div>' +
          '</div>';
        L.DomEvent.disableClickPropagation(root);
        L.DomEvent.disableScrollPropagation(root);
        ui.root = root;
        ui.toggle = root.querySelector('[data-b2pw-toggle]');
        ui.pause = root.querySelector('[data-b2pw-pause]');
        ui.extra = root.querySelector('[data-b2pw-extra]');
        ui.count = root.querySelector('[data-b2pw-count]');
        ui.toggle.addEventListener('click', function () { setOn(!on); });
        ui.pause.addEventListener('click', function () {
          paused = !paused;
          ui.pause.textContent = paused ? 'Play' : 'Pause';
          ui.pause.setAttribute('aria-pressed', paused ? 'true' : 'false');
        });
        return root;
      }
    });
    new Ctl().addTo(S.worldMap);
  }

  function setOn(v) {
    on = !!v;
    ui.toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    ui.pause.hidden = !on; ui.extra.hidden = !on;
    if (on) { sig = ''; last = 0; } else { teardown(); }
  }

  function boot() {
    S = window.__vavelabDbState;
    if (!S || !S.worldMap || !S.graduateStudies || typeof L === 'undefined') { setTimeout(boot, 400); return; }
    injectCss();
    ensureLayers();
    addControl();
    raf = requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
