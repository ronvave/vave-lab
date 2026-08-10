/**
 * Alluvial ribbon filter by Masters-side origin country.
 *
 * The alluvial page shows every scholar's Masters → PhD mobility as a
 * coloured ribbon. For presentations, Ron wants to reveal ribbons one origin
 * country at a time (no ribbons → Fiji only → Australia only → …) so he can
 * export a PNG for each state and use them as slides.
 *
 * How it works:
 *   • The main alluvial script tags each ribbon <path.ribbon> with
 *     data-m-country="<origin country>" when it draws them.
 *   • This module reads the DOM after every draw() to figure out which origin
 *     countries actually appear in the current dataset (in the top-to-bottom
 *     order they show up on the left side of the chart) and re-populates the
 *     checkbox row with one box per country.
 *   • Toggling any checkbox sets `fill-opacity` on each ribbon: unchecked
 *     origins → 0 (hidden), checked origins → default. We use fill-opacity
 *     rather than opacity/display because the built-in PNG exporter
 *     serializes computed styles via getComputedStyle(), and SVG opacity is
 *     not reflected there — fill-opacity is.
 *   • Selection persists in localStorage across reloads.
 *
 * The main script fires window.__alluvialFilterRefresh() at the end of every
 * draw so this module can re-sync after level toggles or data reloads.
 */
(function(){
  "use strict";

  const LS_KEY = "vavelab.alluvial.originFilter.v1";
  const boxesEl = document.getElementById("country-filter-boxes");
  const btnAll  = document.getElementById("country-filter-all");
  const btnNone = document.getElementById("country-filter-none");
  if(!boxesEl || !btnAll || !btnNone) return;

  // Country → hex fill used for the small swatch next to each checkbox
  // label. Populated by reading the actual ribbon fill from the DOM, so the
  // swatch always matches whatever the chart is currently rendering.
  function colorFor(country){
    const el = document.querySelector(
      '#alluvial-chart .ribbons path.ribbon[data-m-country="'+cssEscape(country)+'"]'
    );
    if(!el) return "#999";
    return el.getAttribute("fill") || "#999";
  }

  // Minimal CSS.escape polyfill (Safari 10+ has it; we just need attr values).
  function cssEscape(s){
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // Return countries in the top-to-bottom order they appear on the Masters
  // (left) side of the chart.
  //
  // Primary source: the Masters-side country <rect> blocks, tagged with
  // data-side="m" data-country="<name>" by the alluvial script. These rects
  // have a real `y` attribute set explicitly by D3, so their vertical order
  // is unambiguous and unaffected by ribbon assignment or fill-opacity
  // hiding.
  //
  // Fallback: when the country column isn’t drawn (Level 1 = region only)
  // or when the alluvial script is a stale cached version without the
  // data-country attribute, sort by ribbon top-edge y using getBBox().
  function orderedOriginCountries(){
    const seen = new Set();
    const ordered = [];

    // Preferred path: read country rects on the Masters side.
    const rects = document.querySelectorAll(
      '#alluvial-chart .blocks rect[data-side="m"][data-country]'
    );
    if(rects.length > 0){
      const rows = [];
      rects.forEach(r => {
        const c = r.getAttribute("data-country");
        const y = parseFloat(r.getAttribute("y")) || 0;
        rows.push({ c, y });
      });
      rows.sort((a, b) => a.y - b.y);
      for(const r of rows){
        if(seen.has(r.c)) continue;
        seen.add(r.c);
        ordered.push(r.c);
      }
      // Only include countries that actually have ribbons attached (skip
      // any orphan country blocks with no scholar flow).
      const withRibbons = new Set();
      document.querySelectorAll("#alluvial-chart .ribbons path.ribbon").forEach(el => {
        const c = el.getAttribute("data-m-country");
        if(c) withRibbons.add(c);
      });
      return ordered.filter(c => withRibbons.has(c));
    }

    // Fallback: sort by ribbon path top-edge y.
    const rows = [];
    document.querySelectorAll("#alluvial-chart .ribbons path.ribbon").forEach(el => {
      const c = el.getAttribute("data-m-country");
      if(!c) return;
      let bb;
      try { bb = el.getBBox(); } catch(_) { bb = { y: 0 }; }
      rows.push({ c, y: bb.y });
    });
    rows.sort((a, b) => a.y - b.y);
    for(const r of rows){
      if(seen.has(r.c)) continue;
      seen.add(r.c);
      ordered.push(r.c);
    }
    return ordered;
  }

  function loadSelection(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return null;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr) : null;
    } catch(_){ return null; }
  }
  function saveSelection(set){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set))); } catch(_){}
  }

  // Apply the current selection to every ribbon in the DOM. Ribbons whose
  // origin country is NOT in the selection get fill-opacity:0 so they
  // disappear from both the on-page render and the PNG export.
  function applySelection(set){
    document.querySelectorAll("#alluvial-chart .ribbons path.ribbon").forEach(el => {
      const c = el.getAttribute("data-m-country") || "";
      el.style.fillOpacity = set.has(c) ? "" : "0";
    });
  }

  // (Re)build the checkbox row from the current dataset. Called on load and
  // whenever the alluvial redraws (level toggle, new CSV drop, etc.).
  function refresh(){
    const countries = orderedOriginCountries();
    if(countries.length === 0){
      boxesEl.innerHTML = "";
      return;
    }

    // Preserve the user's previous selection where possible. If nothing is
    // saved yet, default to everything checked (chart looks normal on first
    // visit).
    let saved = loadSelection();
    if(!saved){
      saved = new Set(countries);
      saveSelection(saved);
    }

    // Drop selection entries that no longer exist in the data.
    for(const c of Array.from(saved)){
      if(!countries.includes(c)) saved.delete(c);
    }

    // Render checkboxes.
    boxesEl.innerHTML = "";
    for(const c of countries){
      const id = "cf-" + c.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const label = document.createElement("label");
      label.setAttribute("for", id);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.value = c;
      cb.checked = saved.has(c);
      cb.addEventListener("change", () => {
        const s = loadSelection() || new Set();
        if(cb.checked) s.add(c); else s.delete(c);
        saveSelection(s);
        applySelection(s);
      });

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = colorFor(c);

      const text = document.createElement("span");
      text.textContent = c;

      label.appendChild(cb);
      label.appendChild(swatch);
      label.appendChild(text);
      boxesEl.appendChild(label);
    }

    applySelection(saved);
  }

  btnAll.addEventListener("click", () => {
    const countries = orderedOriginCountries();
    const s = new Set(countries);
    saveSelection(s);
    boxesEl.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
    applySelection(s);
  });
  btnNone.addEventListener("click", () => {
    const s = new Set();
    saveSelection(s);
    boxesEl.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
    applySelection(s);
  });

  // Expose refresh for the main alluvial script to call after every draw().
  window.__alluvialFilterRefresh = refresh;

  // Watch the chart for ribbon changes so we don’t rely on the alluvial
  // script explicitly calling us. Any time D3 re-creates the ribbons group
  // (initial draw, level toggle, CSV drop) this observer fires and we
  // re-populate the checkbox row from the current DOM. This makes the filter
  // robust to stale cached versions of the alluvial script.
  const chart = document.getElementById("alluvial-chart");
  if(chart){
    let scheduled = false;
    const scheduleRefresh = () => {
      if(scheduled) return;
      scheduled = true;
      // Debounce to the next frame so we run once per draw, not per node.
      requestAnimationFrame(() => {
        scheduled = false;
        if(document.querySelectorAll("#alluvial-chart .ribbons path.ribbon").length > 0){
          refresh();
        }
      });
    };
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(chart, { childList: true, subtree: true });
  }

  // Also try an immediate run in case data was already drawn by the time
  // this script loads.
  if(document.querySelectorAll("#alluvial-chart .ribbons path.ribbon").length > 0){
    refresh();
  }
})();
