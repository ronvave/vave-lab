/*
 * iTaukei Scholarly Research Database — MASTER-FILE V2 preview bundle
 * ===================================================================
 *
 * Loads Master-file JSON snapshots (produced by refresh-master-file.yml)
 * via the existing passcode-gated fetchJson() bridge in js/db-gate.js,
 * and renders every panel from Master-file authoritative data.
 *
 * Contract with the HTML (itaukei-research-database-master.html):
 *   - The HTML is identical to the production dashboard — same panels,
 *     same design tokens, same fonts, same demo-view button.
 *   - This bundle populates DOM anchors by `data-kpi`, `data-b2-kpi`,
 *     `data-master-panel`, and `id`.
 *   - Panels that use Master-file-specific semantics (14-province Fiji
 *     table, C_Uni-only aggregations, Authorship bridge for iTaukei-
 *     identity) are rendered directly from the Master JSON.
 *   - Panels backed by embedded standalone pages (B3 chord, C1 body
 *     composition) continue to iframe those pages as before.
 *
 * Snapshot files consumed (all decrypted client-side via db-gate.js):
 *   data/itaukei-master-scholars.json
 *   data/itaukei-master-publications.json
 *   data/itaukei-master-authorship.json
 *   data/itaukei-master-grad-degrees.json
 *   data/itaukei-master-mobility.json
 *   data/itaukei-master-geography.json
 *   data/itaukei-master-aggregates.json  (pre-computed KPIs)
 *   data/last-master-sync.json           (heartbeat timestamp)
 *
 * See docs/MASTER-FILE-REBUILD.md for the full pipeline description.
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------
  // Constants — mirror scripts/master_file_config.py
  // -------------------------------------------------------------------

  var HEADLINE_TYPES = [
    'Journal Article',
    "Master's Thesis",
    'PhD Thesis',
    'Book Chapter',
    'Book'
  ];

  var CONFEDERACIES = {
    Burebasaga: ['Kadavu', 'Nadroga/Navosa', 'Namosi', 'Rewa', 'Serua'],
    Kubuna:     ['Ba', 'Lomaiviti', 'Naitasiri', 'Ra', 'Tailevu'],
    Tovata:     ['Bua', 'Cakaudrove', 'Lau', 'Macuata']
  };

  var PROVINCES = [];
  Object.keys(CONFEDERACIES).forEach(function (c) {
    CONFEDERACIES[c].forEach(function (p) { PROVINCES.push(p); });
  });

  var PROVINCE_FIJI_UNSPEC = 'Fiji - no province specified';
  var PROVINCE_UNSURE = 'Unsure';
  var ALL_FIJI_LABELS = PROVINCES.concat([PROVINCE_FIJI_UNSPEC, PROVINCE_UNSURE]);

  // -------------------------------------------------------------------
  // In-memory state
  // -------------------------------------------------------------------

  var state = {
    scholars: null,
    publications: null,
    authorship: null,
    gradDegrees: null,
    mobility: null,
    geography: null,
    aggregates: null,
    lastSync: null,
    hydrated: false
  };

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function setKpi(attr, key, value, formatter) {
    // Sets textContent on every element with `data-<attr>="<key>"`.
    var sel = '[data-' + attr + '="' + key + '"]';
    var els = $$(sel);
    var text = formatter ? formatter(value) : formatNumber(value);
    els.forEach(function (el) { el.textContent = text; });
  }

  function formatNumber(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }

  function fetchJson(url) {
    // Prefer the passcode-gated fetch (window.dbGate.fetchJson) so we
    // decrypt .enc files client-side. Fall back to a plain fetch for
    // local development (open the HTML directly on disk).
    if (window.dbGate && typeof window.dbGate.fetchJson === 'function') {
      return window.dbGate.fetchJson(url);
    }
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }

  // -------------------------------------------------------------------
  // Data load
  // -------------------------------------------------------------------

  function loadAll() {
    return Promise.all([
      fetchJson('data/itaukei-master-scholars.json'),
      fetchJson('data/itaukei-master-publications.json'),
      fetchJson('data/itaukei-master-authorship.json'),
      fetchJson('data/itaukei-master-grad-degrees.json'),
      fetchJson('data/itaukei-master-mobility.json').catch(function () { return []; }),
      fetchJson('data/itaukei-master-geography.json').catch(function () { return []; }),
      fetchJson('data/itaukei-master-aggregates.json'),
      fetchJson('data/last-master-sync.json').catch(function () { return null; })
    ]).then(function (results) {
      state.scholars     = results[0];
      state.publications = results[1];
      state.authorship   = results[2];
      state.gradDegrees  = results[3];
      state.mobility     = results[4];
      state.geography    = results[5];
      state.aggregates   = results[6];
      state.lastSync     = results[7];
      state.hydrated = true;
      renderAll();
    });
  }

  // -------------------------------------------------------------------
  // Panels
  // -------------------------------------------------------------------

  function renderPanelA1() {
    // Database-wide totals (all publications, all scholars, all universities).
    var agg = state.aggregates;
    if (!agg) return;
    var totals = agg.totals;

    setKpi('kpi', 'db-works', totals.publications_total);

    // Unique authors: distinct Scholar IDs across the whole database.
    setKpi('kpi', 'db-authors', totals.scholars);

    // Theses: Master's + PhD in the headline breakdown (both all-records).
    var thesesAll = (agg.by_publication_type_headline["Master's Thesis"].all || 0)
                  + (agg.by_publication_type_headline['PhD Thesis'].all || 0);
    setKpi('kpi', 'db-theses', thesesAll);

    // Universities represented — unique C_Uni across all grad degrees.
    var unis = uniqueNonEmpty(state.gradDegrees, 'C_Uni name');
    setKpi('kpi', 'db-unis', unis.size);

    // Countries represented — unique Country across all grad degrees.
    var countries = uniqueNonEmpty(state.gradDegrees, 'Country');
    setKpi('kpi', 'db-countries', countries.size);

    // Fiji provinces studied — count of the 14 provinces that appear
    // as a research location in ANY publication.
    var provincesStudied = new Set();
    state.publications.forEach(function (p) {
      PROVINCES.forEach(function (prov) {
        if (Number(p[prov] || 0) > 0) provincesStudied.add(prov);
      });
    });
    setKpi('kpi', 'db-provinces', provincesStudied.size);
  }

  function renderPanelA2() {
    // iTaukei-only aggregates (using the Authorship bridge).
    var agg = state.aggregates;
    if (!agg) return;
    var totals = agg.totals;

    // Publications WITH or BY iTaukei — Authorship-bridge-based count
    // across ALL types (not just the headline 5).
    setKpi('kpi', 'it-works', totals.publications_itaukei_associated);

    // Lead vs. co-author counts — walk the Authorship bridge.
    // For each publication, check whether the linked iTaukei scholar has
    // Author Position = 1 or Is First Author = true.
    var scholarIdSet = new Set(state.scholars.map(function (s) { return s['Scholar ID']; }));
    var pubHasITaukeiLead = new Set();
    var pubHasITaukeiCoauth = new Set();
    state.authorship.forEach(function (a) {
      if (!scholarIdSet.has(a['Scholar ID'])) return;
      var pid = a['Publication ID / BibTeX Key'];
      if (a._is_lead) {
        pubHasITaukeiLead.add(pid);
      } else {
        pubHasITaukeiCoauth.add(pid);
      }
    });
    setKpi('kpi', 'it-led', pubHasITaukeiLead.size);
    // Co-author = has any bridge row that isn't the lead. A pub can be
    // both (co-authored with the lead being another iTaukei scholar).
    setKpi('kpi', 'it-coauth', pubHasITaukeiCoauth.size);

    // Theses by iTaukei scholars — headline 5 iTaukei-associated M's + PhD.
    var it = agg.by_publication_type_headline;
    var itTheses = (it["Master's Thesis"].itaukei || 0) + (it['PhD Thesis'].itaukei || 0);
    setKpi('kpi', 'it-theses', itTheses);

    // Universities attended by iTaukei grad researchers (C_Uni only).
    var itUnis = uniqueNonEmpty(state.gradDegrees, 'C_Uni name');
    setKpi('kpi', 'it-unis', itUnis.size);

    // Countries of iTaukei graduate study.
    var itCountries = uniqueNonEmpty(state.gradDegrees, 'Country');
    setKpi('kpi', 'it-countries', itCountries.size);
  }

  function renderPanelB2() {
    // Panel B2 KPIs — repeat A1-shape numbers scoped to theses.
    var itTheses = state.publications.filter(function (p) {
      return p._is_itaukei_associated &&
             (p['Publication Type'] === "Master's Thesis" || p['Publication Type'] === 'PhD Thesis');
    });
    setKpi('b2-kpi', 'theses', itTheses.length);

    var itThesesScholars = new Set();
    itTheses.forEach(function (p) {
      (p._linked_scholar_ids || []).forEach(function (sid) { itThesesScholars.add(sid); });
    });
    setKpi('b2-kpi', 'scholars', itThesesScholars.size);

    setKpi('b2-kpi', 'masters', itTheses.filter(function (p) {
      return p['Publication Type'] === "Master's Thesis";
    }).length);
    setKpi('b2-kpi', 'phd', itTheses.filter(function (p) {
      return p['Publication Type'] === 'PhD Thesis';
    }).length);

    var unis = uniqueNonEmpty(state.gradDegrees, 'C_Uni name');
    setKpi('b2-kpi', 'unis', unis.size);
    var countries = uniqueNonEmpty(state.gradDegrees, 'Country');
    setKpi('b2-kpi', 'countries', countries.size);
  }

  function renderTimestamp() {
    // Populate any element with `data-master-updated` or an existing
    // "Last updated" badge in the header.
    var ts = state.lastSync && state.lastSync.finishedAt
      ? new Date(state.lastSync.finishedAt)
      : new Date();
    var formatted = ts.toLocaleString('en-US', {
      dateStyle: 'medium', timeStyle: 'short'
    });
    $$('[data-master-updated]').forEach(function (el) {
      el.textContent = formatted;
    });
  }

  function renderAll() {
    // These panels render from the Master-file aggregates + raw arrays,
    // populating the SAME DOM anchors as the production dashboard.
    try { renderPanelA1(); }  catch (e) { console.error('A1 render failed', e); }
    try { renderPanelA2(); }  catch (e) { console.error('A2 render failed', e); }
    try { renderPanelB2(); }  catch (e) { console.error('B2 render failed', e); }
    try { renderTimestamp(); } catch (e) { console.error('Timestamp render failed', e); }

    // Expose state to the console for debugging + to allow future
    // panel code (maps, charts, filters) to hook into it.
    window.__masterState = state;

    // Emit a hydrated event so any listener (e.g. a future panel-B3 map
    // init, or the existing demo-gate.js) can respond after data lands.
    window.dispatchEvent(new CustomEvent('master-file:hydrated', {
      detail: { state: state }
    }));

    console.log(
      '[master-file] Hydrated. ' +
      state.scholars.length + ' scholars, ' +
      state.publications.length + ' publications, ' +
      state.authorship.length + ' authorship links, ' +
      state.gradDegrees.length + ' grad-degree episodes.'
    );
  }

  // -------------------------------------------------------------------
  // Utility: unique non-empty values in a column across a records array.
  // -------------------------------------------------------------------
  function uniqueNonEmpty(records, columnName) {
    var out = new Set();
    if (!records) return out;
    records.forEach(function (r) {
      var v = r && r[columnName];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        out.add(String(v).trim());
      }
    });
    return out;
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  function boot() {
    // Wait until db-gate.js is present. On the production dashboard,
    // db-gate.js loads first and installs window.dbGate. If the visitor
    // needs to enter a passcode, dbGate.fetchJson() blocks until the
    // gate resolves; we just call it and let it do its thing.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(loadAll, 0); });
    } else {
      setTimeout(loadAll, 0);
    }
  }

  boot();

  // Expose a small API for debugging / future integrations.
  window.masterFile = {
    reload: loadAll,
    state: function () { return state; },
    HEADLINE_TYPES: HEADLINE_TYPES,
    CONFEDERACIES: CONFEDERACIES,
    PROVINCES: PROVINCES
  };
})();
