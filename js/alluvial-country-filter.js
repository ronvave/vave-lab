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
    // Add any newly-appearing countries to the selection so a fresh row in
    // the source data (e.g. a scholar from a country we hadn't seen before)
    // shows its ribbon by default instead of being silently hidden by a
    // stale saved selection. Persist the merged set so subsequent loads
    // are stable.
    let addedNew = false;
    for(const c of countries){
      if(!saved.has(c)){ saved.add(c); addedNew = true; }
    }
    if(addedNew) saveSelection(saved);

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

  // ---------------- Batch PNG export (A-series / B-series) ----------------
  //
  // Two “automation” checkboxes drive a slide-by-slide PNG export series:
  //   • A (Individual countries): 0 no ribbons → A1 first country only → A2
  //     second country only → … → AN last country only.
  //   • B (Additive flow): 0 no ribbons → B1 first country → B2 first+second
  //     → … → BN all countries.
  //
  // Each series starts with its own 0-frame (empty state) prefixed with the
  // series letter (A0 for individual, B0 for additive) so the two runs never
  // overwrite each other on disk. Subsequent frames use the existing
  // itaukei-alluvial timestamp convention, prefixed with the series letter
  // and the country index (e.g. A2_itaukei-alluvial_level3_9Aug2026_1147pm.png).
  //
  // The runner uses the existing PNG render pipeline exposed on window by
  // itaukei-alluvial.js (__alluvialRenderPng, __alluvialDefaultFilename).
  // Between frames we set the checkbox selection, apply it to ribbons, wait
  // a short debounce so the SVG has repainted, then trigger a download. The
  // browser downloads each PNG immediately — users may need to allow
  // multiple downloads from the site the first time.
  const batchStatus = document.getElementById("batch-status");
  const batchIndCb  = document.getElementById("batch-individual");
  const batchAddCb  = document.getElementById("batch-additive");
  let batchRunning = false;

  function setBatchStatus(text){
    if(batchStatus) batchStatus.textContent = text || "";
  }
  function setBatchCheckboxesDisabled(disabled){
    if(batchIndCb) batchIndCb.disabled = disabled;
    if(batchAddCb) batchAddCb.disabled = disabled;
  }
  // Reflect a Set of country names onto the checkbox UI + ribbon fill-opacity.
  function reflectSelection(set){
    saveSelection(set);
    boxesEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = set.has(cb.value);
    });
    applySelection(set);
  }
  // Wait for one animation frame + a small buffer so the SVG repaints with
  // the new fill-opacity values before we serialize it to PNG.
  function waitForRepaint(ms){
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTimeout(resolve, ms || 120));
      });
    });
  }

  async function runBatch(mode){
    if(batchRunning) return;
    if(typeof window.__alluvialRenderPng !== "function"
       || typeof window.__alluvialDefaultFilename !== "function"){
      setBatchStatus("Export pipeline not ready \u2014 reload the page and try again.");
      return;
    }
    const countries = orderedOriginCountries();
    if(countries.length === 0){
      setBatchStatus("No countries to export \u2014 load data first.");
      return;
    }

    batchRunning = true;
    setBatchCheckboxesDisabled(true);
    // Remember the user’s current selection so we can restore it when done.
    const savedSelection = loadSelection() || new Set(countries);

    try{
      const total = 1 + countries.length; // 0-frame + one per country
      const seriesLetter = (mode === "individual" ? "A" : "B");
      // Frame 0: no ribbons. Prefixed with the series letter (A0 / B0) so
      // running both series back-to-back produces two distinct empty-state
      // files rather than overwriting the same one.
      const zeroPrefix = seriesLetter + "0";
      setBatchStatus("Exporting frame 1 of " + total + " \u2026 (" + zeroPrefix + " \u2014 no ribbons)");
      reflectSelection(new Set());
      await waitForRepaint();
      await window.__alluvialRenderPng(window.__alluvialDefaultFilename(zeroPrefix));

      // Frames 1..N: one per country, either isolated (A) or additive (B).
      const additive = new Set();
      for(let i = 0; i < countries.length; i++){
        const c = countries[i];
        let sel;
        if(mode === "individual"){
          sel = new Set([c]);
        } else {
          additive.add(c);
          sel = new Set(additive);
        }
        reflectSelection(sel);
        await waitForRepaint();
        const prefix = seriesLetter + (i + 1);
        setBatchStatus("Exporting frame " + (i + 2) + " of " + total
          + " \u2026 (" + prefix + " \u2014 " + (mode === "individual" ? c : Array.from(additive).join(", ")) + ")");
        await window.__alluvialRenderPng(window.__alluvialDefaultFilename(prefix));
      }

      setBatchStatus("Done \u2014 " + total + " PNG" + (total === 1 ? "" : "s") + " downloaded.");
    } catch(err){
      console.error("Batch export failed", err);
      setBatchStatus("Export failed \u2014 see browser console.");
    } finally {
      // Restore user’s pre-batch selection so their manual work isn’t lost.
      reflectSelection(savedSelection);
      // Uncheck the automation checkbox so it’s ready to run again.
      if(batchIndCb) batchIndCb.checked = false;
      if(batchAddCb) batchAddCb.checked = false;
      setBatchCheckboxesDisabled(false);
      batchRunning = false;
    }
  }

  if(batchIndCb){
    batchIndCb.addEventListener("change", () => {
      if(batchIndCb.checked) runBatch("individual");
    });
  }
  if(batchAddCb){
    batchAddCb.addEventListener("change", () => {
      if(batchAddCb.checked) runBatch("additive");
    });
  }

  // ---------------- End batch export ----------------

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
