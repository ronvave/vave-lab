/*
 * Solomon Islands Master-file panel overrides
 * ===================================
 *
 * Sister clone of js/master-file-panel-overrides.js (iTaukei). The
 * production dashboard code in js/solomon-database-master.js was forked
 * from js/itaukei-database-master.js and now runs against Solomon Islands
 * Master-file data synthesized into Zotero shape by
 * js/solomon-database-adapter.js. Almost every panel works verbatim. This
 * file layers on the *Master-file-specific* requirements the Zotero shape
 * cannot express directly:
 *
 *   1. The two ward summary tables (B1 + C2) show the 182 Solomon Islands
 *      wards grouped by Province/City Area WITH dedicated TOTAL columns per
 *      province (one total per province, plus a separate Honiara City
 *      total -- Honiara is a sibling reporting area, never folded into
 *      Guadalcanal). Per the crosswalk's explicit rule, no Fijian or
 *      Tongan grouping name is ever shown here -- every place the
 *      iTaukei/Tongan dashboards show ProvinceGroup/Island Division, this
 *      clone shows Province/City Area, labeled as such.
 *   2. The two required explanatory lines about excluded pub types and
 *      non-Solomon-Islander records appear verbatim below the summary tables.
 *   3. The "Last Master-file update: [timestamp]" badge in the header.
 *   4. Panel A1/A2 headline KPIs reconciled against the Master-file
 *      aggregates (extra safety belt over the Zotero-shape pass).
 *
 * All overrides run *after* the production code has hydrated state.master
 * and finished its first render pass. We hook into a small custom event
 * ("vavelab:master-hydrated") fired near the tail of loadAll().
 */

(function () {
  'use strict';

  var TWO_NOTE_LINES = [
    '*The above summary does not include Reports, Conference papers, Unpublished report, and Others.',
    '**Non-Solomon-Islander records are publications on Solomon Islands by non-Solomon-Islander without any Solomon Islands authors'
  ];

  var HEADLINE_TYPES = [
    'Journal Article',
    "Master's Thesis",
    'PhD Thesis',
    'Book Chapter',
    'Book'
  ];

  function once(fn) { var done = false; return function () { if (done) return; done = true; fn.apply(this, arguments); }; }

  // Wait for the master state to be present (production loadAll finishes and
  // then dispatches DOMContentLoaded's downstream renders). Poll cheaply.
  function whenMasterReady(cb) {
    var attempts = 0;
    (function tick() {
      var w = window;
      if (w.__masterHydrated) { cb(); return; }
      attempts++;
      if (attempts > 200) return; // ~10s max wait
      setTimeout(tick, 50);
    })();
  }

  // -------------------------------------------------------------------
  // 1. District × Province/City Area TOTAL columns for B1 and C2
  // -------------------------------------------------------------------
  //
  // The production dashboard renders district tables via renderPanelB
  // (Panel B1) and renderConfList / renderPanelBBarsInto (Panel C2).
  // Both use the 23-district list flat, without an Island-Division total
  // row. To satisfy the Master-file spec's "dedicated TOTAL columns
  // inside each Province/City Area" requirement, we render an additional
  // summary table into the two panel hosts.
  //
  // NOTE: the underlying adapter (js/solomon-database-adapter.js) keeps the
  // internal constant names PROVINCE_GROUPS / PROVINCE_TO_CONFED / PROVINCES
  // for logic compatibility with the cloned dashboard JS — but their
  // *contents* are Solomon Islands' 5 Province/City Areas and 23 Districts, never a
  // Fijian provinceGroup. This file reads those same constants and displays
  // them exclusively under Solomon Islands-appropriate labels.

  function tallyByProvinceAndConfed(scope /* 'all' | 'solomon' */) {
    // Returns { byProvince: {district: n}, byConfed: {division: n},
    //           byConfedAndProv: {division: {district: n}} }
    var st = window.__vavelabDbState || null;
    var master = st && st.master;
    if (!master) return null;

    var Mfc = window.MasterFileAdapter.constants;
    var byProv = {};
    var byConfed = {};
    var byConfedAndProv = {};
    Mfc.PROVINCES.forEach(function (p) { byProv[p] = 0; });
    Object.keys(Mfc.PROVINCE_GROUPS).forEach(function (c) {
      byConfed[c] = 0;
      byConfedAndProv[c] = {};
      Mfc.PROVINCE_GROUPS[c].forEach(function (p) { byConfedAndProv[c][p] = 0; });
    });

    // Filter publications to headline types only (per spec: the two summary
    // tables exclude Reports, Conference papers, Unpublished report, Others).
    var pubs = master.publications.filter(function (p) {
      return HEADLINE_TYPES.indexOf(p['Publication Type']) !== -1;
    });
    if (scope === 'solomon') {
      pubs = pubs.filter(function (p) { return p._is_itaukei_associated === true; });
    }

    pubs.forEach(function (p) {
      Mfc.PROVINCES.forEach(function (prov) {
        if (Number(p[prov] || 0) > 0) {
          byProv[prov]++;
          var c = Mfc.PROVINCE_TO_CONFED[prov];
          if (c) {
            byConfed[c]++;
            byConfedAndProv[c][prov]++;
          }
        }
      });
    });
    return { byProvince: byProv, byConfed: byConfed, byConfedAndProv: byConfedAndProv };
  }

  // Stable display order + CSS-safe slug for Solomon Islands' 9 Provinces +
  // Honiara City (10 first-level reporting areas). Honiara City is its own
  // reporting area, a sibling of the 9 provinces -- never folded into
  // Guadalcanal.
  var DIVISION_ORDER = ['Central', 'Choiseul', 'Guadalcanal', 'Isabel', 'Makira-Ulawa', 'Malaita', 'Rennell-Bellona', 'Temotu', 'Western', 'Honiara City'];
  var DIVISION_SLUG = {
    'Central': 'central',
    'Choiseul': 'choiseul',
    'Guadalcanal': 'guadalcanal',
    'Isabel': 'isabel',
    'Makira-Ulawa': 'makira-ulawa',
    'Malaita': 'malaita',
    'Rennell-Bellona': 'rennell-bellona',
    'Temotu': 'temotu',
    'Western': 'western',
    'Honiara City': 'honiara-city'
  };
  function divisionSlug(name) { return DIVISION_SLUG[name] || 'other'; }
  function orderedDivisions(keys) {
    var present = keys.slice();
    return DIVISION_ORDER.filter(function (d) { return present.indexOf(d) !== -1; })
      .concat(present.filter(function (d) { return DIVISION_ORDER.indexOf(d) === -1; }));
  }

  function renderConfedTotalTable(hostEl, tally, scope) {
    if (!hostEl || !tally) return;
    var Mfc = window.MasterFileAdapter.constants;
    var scopeLabel = scope === 'solomon'
      ? 'Solomon-Islander-associated publications'
      : 'All Solomon Islands publications';

    var html = '';
    html += '<table class="mf-confed-table" role="table" aria-label="' + scopeLabel + ' by district and Province/City Area">';
    html += '<caption class="mf-confed-table__cap">' + scopeLabel +
            ' \u2014 districts grouped by Province/City Area, with division totals</caption>';
    html += '<thead><tr><th scope="col" class="mf-th-confed">Province/City Area</th>' +
            '<th scope="col" class="mf-th-prov">District</th>' +
            '<th scope="col" class="mf-th-num">Publications</th>' +
            '<th scope="col" class="mf-th-num mf-th-total">Division TOTAL</th></tr></thead><tbody>';

    orderedDivisions(Object.keys(Mfc.PROVINCE_GROUPS)).forEach(function (division) {
      var provs = Mfc.PROVINCE_GROUPS[division];
      provs.forEach(function (prov, idx) {
        html += '<tr class="mf-row mf-row--' + divisionSlug(division) + (idx === 0 ? ' mf-row--first' : '') + '">';
        if (idx === 0) {
          html += '<td rowspan="' + provs.length + '" class="mf-cell-confed"><span class="mf-badge mf-badge--' +
                  divisionSlug(division) + '">' + escapeHtml(division) + '</span></td>';
        }
        html += '<td class="mf-cell-prov">' + escapeHtml(prov) + '</td>';
        html += '<td class="mf-cell-num">' + tally.byProvince[prov].toLocaleString() + '</td>';
        if (idx === 0) {
          html += '<td rowspan="' + provs.length + '" class="mf-cell-total"><strong>' +
                  tally.byConfed[division].toLocaleString() + '</strong></td>';
        }
        html += '</tr>';
      });
    });
    html += '</tbody><tfoot>';
    // Grand totals across the 23 districts + explanatory notes.
    var allProvTotal = 0;
    Mfc.PROVINCES.forEach(function (p) { allProvTotal += tally.byProvince[p]; });
    var divisionGrand = 0;
    Object.keys(tally.byConfed).forEach(function (d) { divisionGrand += tally.byConfed[d]; });
    html += '<tr class="mf-row-grand"><th scope="row" colspan="2" class="mf-cell-grand-label">Grand total (23 districts)</th>' +
            '<td class="mf-cell-num"><strong>' + allProvTotal.toLocaleString() + '</strong></td>' +
            '<td class="mf-cell-total"><strong>' + divisionGrand.toLocaleString() + '</strong></td></tr>';
    html += '</tfoot></table>';

    // The two explanatory lines — always verbatim, per spec.
    html += '<p class="mf-note">' + escapeHtml(TWO_NOTE_LINES[0]) + '</p>';
    html += '<p class="mf-note">' + escapeHtml(TWO_NOTE_LINES[1]) + '</p>';

    hostEl.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]);
    });
  }

  function injectStylesOnce() {
    if (document.getElementById('mf-panel-overrides-style')) return;
    var st = document.createElement('style');
    st.id = 'mf-panel-overrides-style';
    st.textContent =
      // Province/City Area totals table styling — matches production teal/coral/gold tokens.
      '.mf-confed-table { width:100%; margin:1.25rem 0 0.5rem; border-collapse:collapse; font-family:"DM Sans", sans-serif; font-size:0.925rem; }' +
      '.mf-confed-table__cap { text-align:left; font-family:"Cormorant Garamond", serif; font-size:1.15rem; font-weight:600; color:var(--color-teal,#005f6b); padding-bottom:0.5rem; caption-side:top; }' +
      '.mf-confed-table thead th { text-align:left; padding:0.55rem 0.75rem; border-bottom:2px solid var(--color-teal,#005f6b); background:rgba(0,95,107,0.05); font-weight:600; color:var(--color-teal,#005f6b); }' +
      '.mf-confed-table .mf-th-num, .mf-confed-table .mf-cell-num, .mf-confed-table .mf-cell-total { text-align:right; font-family:Arial, Helvetica, sans-serif; font-variant-numeric: tabular-nums; }' +
      '.mf-confed-table .mf-th-total { color:var(--color-coral,#c9552a); }' +
      '.mf-confed-table tbody td { padding:0.45rem 0.75rem; border-bottom:1px solid rgba(0,0,0,0.06); }' +
      '.mf-confed-table tbody tr.mf-row--first td.mf-cell-confed { border-top:1px solid rgba(0,0,0,0.15); }' +
      '.mf-confed-table .mf-cell-confed { vertical-align:middle; background:rgba(0,95,107,0.04); }' +
      '.mf-confed-table .mf-cell-total { vertical-align:middle; background:rgba(201,85,42,0.06); color:var(--color-coral,#c9552a); font-family:Arial, Helvetica, sans-serif; }' +
      '.mf-badge { display:inline-block; padding:0.15rem 0.55rem; border-radius:999px; font-size:0.8rem; font-weight:600; }' +
      // Five Solomon Islands Province/City Area badge colors (distinct from the iTaukei/Solomon Islands
      // 3-provinceGroup palette; chosen from the same teal/coral/gold family
      // plus two additional neutral tones for the extra two divisions).
      '.mf-badge--solomon-islandstapu { background:#e8f2f3; color:#005f6b; }' +
      '.mf-badge--vavau { background:#f6e8e0; color:#8f3d1e; }' +
      '.mf-badge--haapai { background:#f4ecd6; color:#7a6528; }' +
      '.mf-badge--eua { background:#eaf0e2; color:#3d5c1e; }' +
      '.mf-badge--ongoniua { background:#eee6f5; color:#5a2d8f; }' +
      '.mf-confed-table tfoot .mf-row-grand td, .mf-confed-table tfoot .mf-row-grand th { padding:0.6rem 0.75rem; border-top:2px solid var(--color-teal,#005f6b); background:rgba(0,95,107,0.08); font-family:"DM Sans", sans-serif; }' +
      '.mf-confed-table tfoot .mf-row-grand .mf-cell-num, .mf-confed-table tfoot .mf-row-grand .mf-cell-total { font-family:Arial, Helvetica, sans-serif; }' +
      '.mf-note { font-family:"DM Sans", sans-serif; font-size:0.85rem; color:var(--color-ink-soft,#4a5054); margin:0.35rem 0; font-style:italic; }' +
      // Timestamp badge
      '.mf-updated-badge { display:inline-flex; align-items:center; gap:0.4rem; padding:0.35rem 0.7rem; border-radius:999px; background:rgba(0,95,107,0.08); color:var(--color-teal,#005f6b); font-family:"DM Sans", sans-serif; font-size:0.8rem; font-weight:500; margin-left:0.5rem; }' +
      '.mf-updated-badge::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--color-teal,#005f6b); }' +
      // Section title
      '.mf-panel-section-title { font-family:"Cormorant Garamond", serif; font-size:1.35rem; color:var(--color-teal,#005f6b); margin:1.75rem 0 0.5rem; font-weight:600; }' +
      // Empty-state note used for panels with no Solomon Islands data yet.
      '.mf-empty-state { font-family:"DM Sans", sans-serif; font-size:0.95rem; color:var(--color-ink-soft,#5c6368); background:rgba(0,95,107,0.05); border:1px dashed rgba(0,95,107,0.25); border-radius:10px; padding:1.1rem 1.3rem; margin:1rem 0; }' +
      '.mf-empty-state strong { color:var(--color-teal,#005f6b); }';
    document.head.appendChild(st);
  }

  // Find a good place to inject the Island-Division-totals table — right
  // after the B1 district chart (Panel B) and after C2 (whose host is
  // `.db-panel--c2 .db-panel__body`).
  function findHostAfter(id) {
    var el = document.querySelector(id);
    if (!el) return null;
    return el;
  }

  function injectConfedTotals() {
    injectStylesOnce();
    var Mfc = window.MasterFileAdapter.constants;

    // Panel B (Solomon Islands districts): the production chart is inside .db-panel--b .db-panel__body.
    var bPanel = document.querySelector('.db-panel--b .db-panel__body')
              || document.querySelector('[data-panel="B"] .db-panel__body')
              || document.querySelector('#panel-b .db-panel__body');
    if (bPanel) {
      var host = bPanel.querySelector('.mf-confed-totals-host') || document.createElement('div');
      host.className = 'mf-confed-totals-host';
      var title = document.createElement('div');
      title.className = 'mf-panel-section-title';
      title.textContent = 'B \u00b7 Solomon Islands publications by district & Province/City Area (Master-file authoritative)';
      var subhost = document.createElement('div');
      var tally = tallyByProvinceAndConfed('all');
      if (tally && anyNonZero(tally.byProvince)) {
        renderConfedTotalTable(subhost, tally, 'all');
      } else {
        subhost.innerHTML = '<p class="mf-empty-state"><strong>Data not yet available.</strong> '
          + 'District-tagged Solomon Islands publications have not been populated in the Master file yet. '
          + 'This panel will populate automatically once records are added.</p>';
      }
      host.innerHTML = '';
      host.appendChild(title);
      host.appendChild(subhost);
      if (!bPanel.querySelector('.mf-confed-totals-host')) bPanel.appendChild(host);
    }

    // Panel C2 (research in and across Solomon Islands' 23 districts).
    var c2Panel = document.querySelector('.db-panel--c2 .db-panel__body')
               || document.querySelector('[data-panel="C2"] .db-panel__body')
               || document.querySelector('#panel-c2 .db-panel__body');
    if (c2Panel) {
      var host2 = c2Panel.querySelector('.mf-confed-totals-host') || document.createElement('div');
      host2.className = 'mf-confed-totals-host';
      var title2 = document.createElement('div');
      title2.className = 'mf-panel-section-title';
      title2.textContent = 'C2 \u00b7 Solomon-Islander-associated publications by district & Province/City Area';
      var subhost2 = document.createElement('div');
      var tally2 = tallyByProvinceAndConfed('solomon');
      if (tally2 && anyNonZero(tally2.byProvince)) {
        renderConfedTotalTable(subhost2, tally2, 'solomon');
      } else {
        subhost2.innerHTML = '<p class="mf-empty-state"><strong>Data not yet available.</strong> '
          + 'No Solomon-Islander-associated, district-tagged publications have been populated yet. '
          + 'This panel will populate automatically once records are added.</p>';
      }
      host2.innerHTML = '';
      host2.appendChild(title2);
      host2.appendChild(subhost2);
      if (!c2Panel.querySelector('.mf-confed-totals-host')) c2Panel.appendChild(host2);
    }
  }

  function anyNonZero(obj) {
    return Object.keys(obj || {}).some(function (k) { return Number(obj[k]) > 0; });
  }

  // -------------------------------------------------------------------
  // 2. Last Master-file update timestamp badge.
  // -------------------------------------------------------------------
  function injectTimestamp() {
    injectStylesOnce();
    var st = window.__vavelabDbState;
    var master = st && st.master;
    if (!master || !master.lastSync) return;
    // Find the sync badge in the header (production wires a #db-sync-badge)
    // and append our own subtle badge next to it.
    var badgeHost = document.getElementById('db-sync-badge') ||
                    document.querySelector('.db-hero__meta') ||
                    document.querySelector('.db-header') ||
                    document.querySelector('h1');
    if (!badgeHost) return;
    var existing = document.getElementById('mf-updated-badge');
    if (existing) existing.remove();
    var badge = document.createElement('span');
    badge.id = 'mf-updated-badge';
    badge.className = 'mf-updated-badge';
    var when = new Date(master.lastSync.finishedAt || Date.now());
    badge.textContent = 'Last Master-file update: ' + when.toLocaleString('en-US', {
      dateStyle: 'medium', timeStyle: 'short'
    });
    badge.title = 'Master-file JSON snapshot last refreshed at this time by the every-2h GitHub Actions workflow.';
    // Insert AFTER the sync badge, or into the host.
    if (badgeHost.parentNode) {
      badgeHost.parentNode.insertBefore(badge, badgeHost.nextSibling);
    } else {
      badgeHost.appendChild(badge);
    }
  }

  // -------------------------------------------------------------------
  // Boot: run overrides after production render pass.
  // -------------------------------------------------------------------
  function boot() {
    whenMasterReady(function () {
      try { injectTimestamp(); } catch (e) { console.error('MF timestamp inject failed', e); }
      try { injectConfedTotals(); } catch (e) { console.error('MF Island-Division totals inject failed', e); }
      // Also re-run on filter changes so counts stay accurate if the state changes.
      window.addEventListener('vavelab:filters-changed', function () {
        try { injectConfedTotals(); } catch (e) {}
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose overrides for debugging.
  window.MasterFilePanelOverrides = {
    injectConfedTotals: injectConfedTotals,
    injectTimestamp:    injectTimestamp,
    tallyByProvinceAndConfed: tallyByProvinceAndConfed,
    HEADLINE_TYPES: HEADLINE_TYPES,
    NOTE_LINES: TWO_NOTE_LINES
  };
})();
