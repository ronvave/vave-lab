/* ================================================================
 * samoa-panel-overrides.js
 * ----------------------------------------------------------------
 * Samoa-native runtime patches loaded AFTER samoa-database-master.js.
 * Responsibilities:
 *   1. Bridge the adapter's `bundle.geo` payload to the panel-code
 *      global lookups (SAMOA_DISTRICT_TO_REGION) so no non-Samoa
 *      geography lookup ever touches Samoa data.
 *   2. Wire the four Samoa-specific interactive filter listboxes on
 *      the leaderboard toolbar (Village, Specific Island, Traditional
 *      Itūmālō, Electoral Constituency). Each listbox is single-
 *      select, hydrated from bundle.geo, and updates the matching
 *      state slot in samoa-database-master.js before re-rendering
 *      Panel F (leaderboard) and Panel G (items browser).
 *   3. Display village names with a district-qualified suffix
 *      (Falefa — Anoama'a East) whenever a raw village name occurs
 *      in multiple political/census districts. The V-#### composite
 *      ID from the Session 2 adapter drives dedup; the visible label
 *      keeps the raw village first with the district as a soft suffix.
 *   4. Preserve five unresolved Specific Island entries as
 *      "Island unrecorded" (not inferred): Tausagi, Olo, Paepaeala,
 *      Satuilagi, Satoi. The listbox surfaces "Island unrecorded"
 *      as an explicit choice so Ron can find them.
 *
 * IMPORTANT: This file does NOT infer any missing geography. Villages
 * with a blank Specific Island cell remain SPECIFIC_ISLAND_UNSURE and
 * are surfaced as such — never guessed.
 * ================================================================ */

(function samoaPanelOverrides(){
  'use strict';

  // ---- 1. Bridge bundle.geo → panel-code globals ----------------
  function hydrateFromBundle(bundle){
    if (!bundle || !bundle.geo) return;
    const map = bundle.geo.politicalDistrictToRegion || {};
    if (typeof window.__samoaSetDistrictRegions === 'function') {
      window.__samoaSetDistrictRegions(map);
    }
    window.SAMOA_DISTRICT_TO_REGION = Object.assign({}, map);
    // Stash the full geo payload for the listbox wiring below.
    window.__samoaGeoBundle = bundle.geo;
  }

  function patchAdapter(){
    const A = window.SamoaScholarDatabaseAdapter;
    if (!A || A.__samoaOverridePatched) return;
    A.__samoaOverridePatched = true;
    const origLoad = A.load;
    A.load = async function(){
      const bundle = await origLoad.apply(this, arguments);
      try {
        hydrateFromBundle(bundle);
        // Once hydrated, re-wire the four listboxes so they populate
        // from the fresh bundle.geo payload.
        wireSamoaListboxes();
      } catch(e){ console.warn('[samoa-overrides] hydrate failed', e); }
      return bundle;
    };
  }

  // ---- 2. District-qualified village label helper ---------------
  // Given a raw village name and a full villages list from bundle.geo,
  // return "{village} — {district}" when the raw name repeats across
  // districts, else the raw name unchanged. The 12 name-collisions
  // documented in Session 2's adapter live here.
  function buildDistrictQualifier(villages){
    const counts = new Map();
    const nameToVillages = new Map();  // name -> [{name, district, id}, ...]
    (villages || []).forEach(v => {
      const nm = (v && v.name) || '';
      if (!nm) return;
      counts.set(nm, (counts.get(nm) || 0) + 1);
      if (!nameToVillages.has(nm)) nameToVillages.set(nm, []);
      nameToVillages.get(nm).push(v);
    });
    function labelFor(v){
      if (!v) return '';
      // Support two call shapes:
      //   labelFor({name, district}) → object shape from bundle.geo.villages
      //   labelFor("Falefa", "Anoama'a East")
      //     → string+context shape used by the scholar-card renderer, which
      //     only ever knows the raw village name and the current scholar's
      //     home district. If the second argument is provided we honour it;
      //     otherwise we look up the districts we know about for that name.
      if (typeof v === 'string') {
        var name = v.trim();
        if (!name) return '';
        var contextDistrict = (arguments.length > 1 && arguments[1]) ? String(arguments[1]).trim() : '';
        if (counts.get(name) > 1 && contextDistrict) {
          return name + ' \u2014 ' + contextDistrict;
        }
        return name;
      }
      if (!v.name) return '';
      var nm = v.name;
      var district = (v.district || '').trim();
      if (counts.get(nm) > 1 && district) {
        // U+2014 em-dash separator so district reads as a soft suffix,
        // matching Ron's card-label convention.
        return nm + ' \u2014 ' + district;
      }
      return nm;
    }
    // Expose the collision counts so the scholar-card renderer can tell,
    // without owning the villages list, whether a raw name is ambiguous
    // and therefore whether it must append a district qualifier.
    labelFor.isAmbiguous = function(name){
      if (!name) return false;
      return (counts.get(String(name).trim()) || 0) > 1;
    };
    labelFor.villagesFor = function(name){
      return (nameToVillages.get(String(name || '').trim()) || []).slice();
    };
    return labelFor;
  }

  // Expose the label helper on window so the leaderboard card renderer
  // in samoa-database-master.js (if it hooks a formatter) or downstream
  // code can call it directly.
  window.__samoaVillageLabel = null;

  // ---- 3. Generic single-select listbox for the four filters ----
  // Anchors on the existing dsf-input--combo button in the leaderboard
  // toolbar. Renders a positioned panel below the button with a
  // scrollable list of options + a top-of-list "Any {dim}" clear item.
  // No external combo helper dependency; kept self-contained here.
  function initListbox(config){
    const {
      buttonSel,     // '[data-scholar-village-combo]' etc
      labelDefault,  // 'Village' etc — label when nothing is selected
      options,       // [{ value, display, hint? }, ...]
      allLabel,      // 'Any village' / 'Any island' etc
      unrecordedLabel, // optional; e.g. 'Island unrecorded'
      stateKey,      // 'scholarVillageFilter' etc
      onChange       // function(newValue) — after state has been updated
    } = config;

    const btn = document.querySelector(buttonSel);
    if (!btn) return null;
    if (btn.__samoaListboxWired) return null;
    btn.__samoaListboxWired = true;

    // Any previously-attached stub-click handler must be removed. We
    // set __samoaListboxWired so the stub-guard skips this button, and
    // stop propagation on the outer click to defeat any lingering
    // capture-phase listener.
    btn.addEventListener('click', function(ev){ ev.stopPropagation(); }, true);

    // Build the popover panel.
    const panel = document.createElement('div');
    panel.className = 'dsf-listbox-panel samoa-listbox-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', allLabel);
    panel.style.cssText = [
      'position:absolute',
      'z-index:9999',
      'background:var(--color-surface,#fff)',
      'border:1px solid var(--color-border,#dcdcdc)',
      'border-radius:8px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.12)',
      'padding:6px 0',
      'max-height:340px',
      'overflow-y:auto',
      'min-width:240px',
      'display:none',
      'font-family:var(--font-body,inherit)',
      'font-size:0.85rem'
    ].join(';');

    // Search box at the top of the panel for the Village listbox
    // (329 options) — helps Ron find a village quickly.
    let searchInput = null;
    if (options.length > 40) {
      const searchWrap = document.createElement('div');
      searchWrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--color-border,#eee);';
      searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.placeholder = 'Search…';
      searchInput.setAttribute('aria-label', 'Search ' + labelDefault + ' options');
      searchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;font:inherit;border:1px solid var(--color-border,#dcdcdc);border-radius:4px;';
      searchWrap.appendChild(searchInput);
      panel.appendChild(searchWrap);
    }

    // "Any {dim}" clear option at the top of the option list.
    const optWrap = document.createElement('div');
    optWrap.style.cssText = 'padding:2px 0;';
    panel.appendChild(optWrap);

    function rowFor(value, display, isClear){
      const row = document.createElement('div');
      row.setAttribute('role', 'option');
      row.setAttribute('data-value', value == null ? '' : String(value));
      row.textContent = display;
      row.style.cssText = 'padding:5px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
        (isClear ? 'font-weight:600;color:var(--color-text-muted,#666);border-bottom:1px dashed var(--color-border,#eee);margin-bottom:2px;' : '');
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(0,0,0,0.05)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', function(){
        applyValue(value, display, isClear);
        closePanel();
      });
      return row;
    }

    function renderOptions(filterQuery){
      optWrap.innerHTML = '';
      // "Any {dim}" clear row
      optWrap.appendChild(rowFor('', allLabel, true));
      const q = (filterQuery || '').trim().toLowerCase();
      let shown = 0;
      options.forEach(opt => {
        if (q && opt.display.toLowerCase().indexOf(q) === -1) return;
        optWrap.appendChild(rowFor(opt.value, opt.display, false));
        shown++;
      });
      if (q && shown === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No match';
        empty.style.cssText = 'padding:8px 12px;color:var(--color-text-muted,#666);font-style:italic;';
        optWrap.appendChild(empty);
      }
    }

    renderOptions('');
    document.body.appendChild(panel);

    function positionPanel(){
      const r = btn.getBoundingClientRect();
      panel.style.top  = (window.scrollY + r.bottom + 4) + 'px';
      panel.style.left = (window.scrollX + r.left) + 'px';
      panel.style.minWidth = Math.max(240, r.width) + 'px';
    }

    let isOpen = false;
    function openPanel(){
      positionPanel();
      panel.style.display = 'block';
      isOpen = true;
      if (searchInput) { searchInput.value = ''; renderOptions(''); setTimeout(() => searchInput.focus(), 10); }
      document.addEventListener('mousedown', outsideClose, true);
      document.addEventListener('keydown', escClose);
    }
    function closePanel(){
      panel.style.display = 'none';
      isOpen = false;
      document.removeEventListener('mousedown', outsideClose, true);
      document.removeEventListener('keydown', escClose);
    }
    function outsideClose(ev){
      if (!panel.contains(ev.target) && !btn.contains(ev.target)) closePanel();
    }
    function escClose(ev){ if (ev.key === 'Escape') closePanel(); }

    btn.addEventListener('click', function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      if (isOpen) { closePanel(); return; }
      openPanel();
    });

    if (searchInput) {
      searchInput.addEventListener('input', function(){
        renderOptions(searchInput.value);
      });
    }

    // Clear button on the button pill (× to right of label).
    const clearBtn = btn.querySelector('[data-clear-combo]');
    if (clearBtn) {
      clearBtn.addEventListener('click', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        applyValue('', allLabel, true);
      });
    }

    function applyValue(value, display, isClear){
      const s = window.SamoaState || null; // no runtime dependency
      // The main JS keeps state in a module-scope object; we call
      // renderLeaders through a small hook (see below), which reads
      // its own `state`. To poke that state we use a small setter
      // exposed by the main JS. If that's not available, we walk the
      // known `state` object via a global escape hatch:
      if (typeof window.__samoaSetScholarFilter === 'function') {
        window.__samoaSetScholarFilter(stateKey, value);
      } else if (window.samoaDb && window.samoaDb.state) {
        window.samoaDb.state[stateKey] = value;
        if (typeof window.samoaDb.state.scholarPage === 'number') window.samoaDb.state.scholarPage = 1;
      }
      // Update the button label to show the selection.
      const labelSlot = btn.querySelector('[data-label-slot]');
      if (labelSlot) labelSlot.textContent = isClear ? labelDefault : display;
      btn.classList.toggle('is-active', !isClear);
      // Show/hide the ×
      if (clearBtn) clearBtn.style.display = isClear ? 'none' : '';
      if (typeof onChange === 'function') {
        try { onChange(value); } catch(e){ console.warn('[samoa-listbox] onChange failed', e); }
      }
      // Trigger re-render of the leaderboard / items list.
      if (window.samoaDb && typeof window.samoaDb.renderLeaders === 'function') {
        try { window.samoaDb.renderLeaders(); } catch(e){ console.warn('[samoa-listbox] renderLeaders failed', e); }
      }
    }

    // Return handle so wireSamoaListboxes can refresh options once the
    // adapter finishes and bundle.geo is available.
    return {
      button: btn,
      panel: panel,
      setOptions(newOptions){
        options.length = 0;
        newOptions.forEach(o => options.push(o));
        renderOptions(searchInput ? searchInput.value : '');
      }
    };
  }

  // ---- 4. Build option lists from bundle.geo --------------------
  function buildVillageOptions(geo){
    const villages = (geo && geo.villages) || [];
    if (!villages.length) return [{ value: '__unrecorded__', display: 'Village unrecorded' }];
    const labelFor = buildDistrictQualifier(villages);
    window.__samoaVillageLabel = labelFor;
    const opts = villages.slice().sort((a,b) => {
      const na = (a && a.name) || '';
      const nb = (b && b.name) || '';
      return na.localeCompare(nb, 'en');
    }).map(v => ({
      // Prefer composite id when the adapter provides one; otherwise
      // fall back to the raw name. `state.scholarVillageFilter` matches
      // on either.
      value: v.id || v.name,
      display: labelFor(v)
    }));
    opts.push({ value: '__unrecorded__', display: 'Village unrecorded' });
    return opts;
  }

  function buildIslandOptions(geo){
    const islands = (geo && geo.specificIslands) || [];
    const opts = islands.slice().sort().map(name => ({
      value: name,
      display: name
    }));
    // Always surface the "Island unrecorded" bucket (5 villages: Tausagi,
    // Olo, Paepaeala, Satuilagi, Satoi). Never inferred.
    opts.push({ value: '__unrecorded__', display: 'Island unrecorded' });
    return opts;
  }

  function buildItumaloOptions(geo){
    const itumalo = (geo && geo.itumalo) || [];
    const opts = itumalo.slice().sort().map(name => ({
      value: name,
      display: name
    }));
    opts.push({ value: '__unrecorded__', display: 'Itūmālō unrecorded' });
    return opts;
  }

  function buildConstituencyOptions(geo){
    // The adapter exposes constituencies grouped by version. We flatten
    // to a single dropdown with version prefix so the same "Vaimauga
    // West" label doesn't collide between the 2019-Act and Pre-2019
    // vocabularies.
    const cons = (geo && geo.electoralConstituencies) || null;
    const opts = [];
    if (cons && cons.byVersion) {
      Object.keys(cons.byVersion).sort().forEach(version => {
        const list = cons.byVersion[version] || [];
        list.slice().sort().forEach(name => {
          opts.push({
            value: version + ':' + name,
            display: name + ' (' + version + ')'
          });
        });
      });
    } else if (Array.isArray(cons)) {
      cons.slice().sort().forEach(name => opts.push({ value: name, display: name }));
    }
    opts.push({ value: '__unrecorded__', display: 'Constituency unrecorded' });
    return opts;
  }

  // ---- 5. Wire the four leaderboard listboxes -------------------
  const listboxHandles = {};

  function wireSamoaListboxes(){
    const geo = window.__samoaGeoBundle || {};

    if (!listboxHandles.village) {
      listboxHandles.village = initListbox({
        buttonSel: '[data-scholar-village-combo]',
        labelDefault: 'Village',
        allLabel: 'Any village',
        options: buildVillageOptions(geo),
        stateKey: 'scholarVillageFilter'
      });
    } else {
      listboxHandles.village.setOptions(buildVillageOptions(geo));
    }

    if (!listboxHandles.island) {
      listboxHandles.island = initListbox({
        buttonSel: '[data-scholar-island-combo]',
        labelDefault: 'Specific Island',
        allLabel: 'Any island',
        options: buildIslandOptions(geo),
        stateKey: 'scholarIslandFilter'
      });
    } else {
      listboxHandles.island.setOptions(buildIslandOptions(geo));
    }

    if (!listboxHandles.itumalo) {
      listboxHandles.itumalo = initListbox({
        buttonSel: '[data-scholar-itumalo-combo]',
        labelDefault: 'Traditional Itūmālō',
        allLabel: 'Any itūmālō',
        options: buildItumaloOptions(geo),
        stateKey: 'scholarItumaloFilter'
      });
    } else {
      listboxHandles.itumalo.setOptions(buildItumaloOptions(geo));
    }

    if (!listboxHandles.constituency) {
      listboxHandles.constituency = initListbox({
        buttonSel: '[data-scholar-constituency-combo]',
        labelDefault: 'Electoral Constituency',
        allLabel: 'Any constituency',
        options: buildConstituencyOptions(geo),
        stateKey: 'scholarConstituencyFilter'
      });
    } else {
      listboxHandles.constituency.setOptions(buildConstituencyOptions(geo));
    }
  }

  // ---- 6. Boot --------------------------------------------------
  function boot(){
    patchAdapter();
    // Also try wiring immediately in case the adapter finished before
    // this file evaluated (dev-reload path). Options will be empty and
    // repopulated once wireSamoaListboxes() runs again post-hydrate.
    wireSamoaListboxes();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
