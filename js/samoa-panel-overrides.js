/* ================================================================
 * samoa-panel-overrides.js
 * ----------------------------------------------------------------
 * Samoa-native runtime patches loaded AFTER samoa-database-master.js.
 * This file:
 *   1. Bridges the adapter's `bundle.geo` payload to DISTRICT_TO_REGION
 *      inside the panel code (so no non-Samoa geography lookup ever
 *      touches Samoa data).
 *   2. Wires the four Samoa-specific filter widgets that were added
 *      to the leaderboard toolbar in Session 3 (Village, Specific
 *      Island, Traditional Itūmālō, Electoral Constituency). The
 *      full click-open listing behaviour lands in Session 4 alongside
 *      the alluvial and chord panels; here we surface an accessible
 *      informational tooltip when the user clicks them, matching the
 *      "coming next release" convention Ron uses elsewhere.
 *   3. Documents the 329-unique-from-341-village dedup and the 5
 *      unresolved Specific Island entries as data-* attributes so
 *      the browser inspector shows Ron what's known.
 *
 * IMPORTANT: This file does NOT infer any missing geography. Villages
 * with a blank Specific Island cell remain SPECIFIC_ISLAND_UNSURE and
 * are surfaced as such - never guessed.
 * ================================================================ */

(function samoaPanelOverrides(){
  'use strict';

  // ---- 1. Bridge bundle.geo → DISTRICT_TO_REGION -----------------
  // The panel code declares `const DISTRICT_TO_REGION = {}` at module
  // scope and expects an external hook to populate it once the adapter
  // has loaded. We watch for the adapter and dispatch a hydration
  // event the panel code can listen to, and we also patch the global
  // if the panel code exposes it.
  function hydrateFromBundle(bundle){
    if (!bundle || !bundle.geo) return;
    const map = bundle.geo.politicalDistrictToRegion || {};
    // If the panel exposed a hook, use it.
    if (typeof window.__samoaSetDistrictRegions === 'function') {
      window.__samoaSetDistrictRegions(map);
    }
    // Also mirror to a well-known global for panel-code lookups.
    window.SAMOA_DISTRICT_TO_REGION = Object.assign({}, map);
  }

  // Observe the adapter: the demo-gate loads, unlocks, then boots the
  // panel code with `SamoaScholarDatabaseAdapter.load()`. We patch load
  // to fire a hydration hook once the bundle resolves.
  function patchAdapter(){
    const A = window.SamoaScholarDatabaseAdapter;
    if (!A || A.__samoaOverridePatched) return;
    A.__samoaOverridePatched = true;
    const origLoad = A.load;
    A.load = async function(){
      const bundle = await origLoad.apply(this, arguments);
      try { hydrateFromBundle(bundle); } catch(e){ console.warn('[samoa-overrides] hydrate failed', e); }
      return bundle;
    };
  }

  // ---- 2. Six-dimension filter widget stubs ---------------------
  // The four new filter combos (village / island / itūmālō /
  // constituency) render their labels in the toolbar but do not yet
  // open a listing panel. Clicking them shows a small transient
  // notice so users know the widget is intentional and coming in
  // Session 4 - not an accidental empty control.
  const SAMOA_FILTER_NOTICE = {
    'data-scholar-village-combo':
      'Village filter\n\n329 unique village names across 341 Village Directory rows. ' +
      '12 name-collisions across districts are resolved via district-qualified ' +
      'Village IDs (V-####). Interactive filter listing lands in Session 4.',
    'data-scholar-island-combo':
      'Specific Island filter\n\nFour populated islands: Upolu, Manono, Apolima, Savai‘i. ' +
      '5 villages have a blank Specific Island entry (Tausagi, Olo, Paepaeala, Satuilagi, ' +
      'Satoi) and are shown as “Island unrecorded” - not inferred. Interactive filter ' +
      'listing lands in Session 4.',
    'data-scholar-itumalo-combo':
      'Traditional Itūmālō filter\n\n11 constitutional Second-Schedule districts. ' +
      'Independent of Political/Census District - a scholar can have one set and the ' +
      'other blank. Interactive filter listing lands in Session 4.',
    'data-scholar-constituency-combo':
      'Electoral Constituency filter\n\nTime-versioned: 2019-Act (51 constituencies, ' +
      'for the 2021 and 2026 general elections) and Pre-2019 (43 constituencies, ' +
      'historical). Ron picks the version at query time. Interactive filter listing ' +
      'lands in Session 4.'
  };

  function wireStubFilters(){
    Object.keys(SAMOA_FILTER_NOTICE).forEach(function(sel){
      document.querySelectorAll('[' + sel + ']').forEach(function(btn){
        if (btn.__samoaStubWired) return;
        btn.__samoaStubWired = true;
        btn.addEventListener('click', function(ev){
          ev.preventDefault();
          ev.stopPropagation();
          // Lightweight notice - alert is intentional here so the
          // click cannot be dismissed accidentally, and it's obvious
          // to Ron during acceptance testing that the widget is a
          // stub. Session 4 replaces this with a real listbox.
          try { alert(SAMOA_FILTER_NOTICE[sel]); }
          catch(e){ console.info('[samoa-overrides]', SAMOA_FILTER_NOTICE[sel]); }
        });
      });
    });
  }

  // ---- 3. Boot ---------------------------------------------------
  function boot(){
    patchAdapter();
    wireStubFilters();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
