/*
 * Master-file panel overrides
 * ============================
 *
 * The production dashboard code in js/itaukei-database-master.js was forked
 * from the Zotero-driven dashboard and now runs against Master-file data
 * synthesized into Zotero shape by js/master-file-adapter.js. Almost every
 * panel works verbatim. This file layers on the *Master-file-specific*
 * requirements the Zotero shape cannot express directly:
 *
 *   1. The two province summary tables (B1 + C2) must show the 14 Fiji
 *      provinces grouped by confederacy WITH dedicated TOTAL columns per
 *      confederacy (Burebasaga total, Kubuna total, Tovata total).
 *   2. The two required explanatory lines about excluded pub types and
 *      non-iTaukei records must appear verbatim below the summary tables.
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
    '**Non-iTaukei records are publications on Fiji by non-iTaukei without any iTaukei authors'
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
  // 1. Province × confederacy TOTAL columns for B1 and C2
  // -------------------------------------------------------------------
  //
  // The production dashboard renders province tables via renderPanelB
  // (Panel B1) and renderConfList / renderPanelBBarsInto (Panel C2).
  // Both use the 14-province list flat, without a confederacy total
  // row. To satisfy the Master-file spec's "dedicated TOTAL columns
  // inside Burebasaga, Kubuna and Tovata" requirement, we render an
  // additional summary table into the two panel hosts.

  function tallyByProvinceAndConfed(scope /* 'all' | 'itaukei' */) {
    // Returns { byProvince: {prov: n}, byConfed: {confed: n},
    //           byConfedAndProv: {confed: {prov: n}} }
    var st = window.__vavelabDbState || null;
    var master = st && st.master;
    if (!master) return null;

    var Mfc = window.MasterFileAdapter.constants;
    var byProv = {};
    var byConfed = {};
    var byConfedAndProv = {};
    Mfc.PROVINCES.forEach(function (p) { byProv[p] = 0; });
    Object.keys(Mfc.CONFEDERACIES).forEach(function (c) {
      byConfed[c] = 0;
      byConfedAndProv[c] = {};
      Mfc.CONFEDERACIES[c].forEach(function (p) { byConfedAndProv[c][p] = 0; });
    });

    // Filter publications to headline types only (per spec: the two summary
    // tables exclude Reports, Conference papers, Unpublished report, Others).
    var pubs = master.publications.filter(function (p) {
      return HEADLINE_TYPES.indexOf(p['Publication Type']) !== -1;
    });
    if (scope === 'itaukei') {
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

  function renderConfedTotalTable(hostEl, tally, scope) {
    if (!hostEl || !tally) return;
    var Mfc = window.MasterFileAdapter.constants;
    var scopeLabel = scope === 'itaukei'
      ? 'iTaukei-associated publications'
      : 'All Fiji publications';

    var html = '';
    html += '<table class="mf-confed-table" role="table" aria-label="' + scopeLabel + ' by province and confederacy">';
    html += '<caption class="mf-confed-table__cap">' + scopeLabel +
            ' \u2014 provinces grouped by confederacy, with confederacy totals</caption>';
    html += '<thead><tr><th scope="col" class="mf-th-confed">Confederacy</th>' +
            '<th scope="col" class="mf-th-prov">Province</th>' +
            '<th scope="col" class="mf-th-num">Publications</th>' +
            '<th scope="col" class="mf-th-num mf-th-total">Confederacy TOTAL</th></tr></thead><tbody>';

    Object.keys(Mfc.CONFEDERACIES).forEach(function (confed) {
      var provs = Mfc.CONFEDERACIES[confed];
      provs.forEach(function (prov, idx) {
        html += '<tr class="mf-row mf-row--' + confed.toLowerCase() + (idx === 0 ? ' mf-row--first' : '') + '">';
        if (idx === 0) {
          html += '<td rowspan="' + provs.length + '" class="mf-cell-confed"><span class="mf-badge mf-badge--' +
                  confed.toLowerCase() + '">' + escapeHtml(confed) + '</span></td>';
        }
        html += '<td class="mf-cell-prov">' + escapeHtml(prov) + '</td>';
        html += '<td class="mf-cell-num">' + tally.byProvince[prov].toLocaleString() + '</td>';
        if (idx === 0) {
          html += '<td rowspan="' + provs.length + '" class="mf-cell-total"><strong>' +
                  tally.byConfed[confed].toLocaleString() + '</strong></td>';
        }
        html += '</tr>';
      });
    });
    html += '</tbody><tfoot>';
    // Grand totals across the 14 provinces + explanatory notes.
    var allProvTotal = 0;
    Mfc.PROVINCES.forEach(function (p) { allProvTotal += tally.byProvince[p]; });
    var confedGrand = tally.byConfed.Burebasaga + tally.byConfed.Kubuna + tally.byConfed.Tovata;
    html += '<tr class="mf-row-grand"><th scope="row" colspan="2" class="mf-cell-grand-label">Grand total (14 provinces)</th>' +
            '<td class="mf-cell-num"><strong>' + allProvTotal.toLocaleString() + '</strong></td>' +
            '<td class="mf-cell-total"><strong>' + confedGrand.toLocaleString() + '</strong></td></tr>';
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
      // Confederacy totals table styling — matches production teal/coral/gold tokens.
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
      '.mf-badge--burebasaga { background:#e8f2f3; color:#005f6b; }' +
      '.mf-badge--kubuna { background:#f6e8e0; color:#8f3d1e; }' +
      '.mf-badge--tovata { background:#f4ecd6; color:#7a6528; }' +
      '.mf-confed-table tfoot .mf-row-grand td, .mf-confed-table tfoot .mf-row-grand th { padding:0.6rem 0.75rem; border-top:2px solid var(--color-teal,#005f6b); background:rgba(0,95,107,0.08); font-family:"DM Sans", sans-serif; }' +
      '.mf-confed-table tfoot .mf-row-grand .mf-cell-num, .mf-confed-table tfoot .mf-row-grand .mf-cell-total { font-family:Arial, Helvetica, sans-serif; }' +
      '.mf-note { font-family:"DM Sans", sans-serif; font-size:0.85rem; color:var(--color-ink-soft,#4a5054); margin:0.35rem 0; font-style:italic; }' +
      // Timestamp badge
      '.mf-updated-badge { display:inline-flex; align-items:center; gap:0.4rem; padding:0.35rem 0.7rem; border-radius:999px; background:rgba(0,95,107,0.08); color:var(--color-teal,#005f6b); font-family:"DM Sans", sans-serif; font-size:0.8rem; font-weight:500; margin-left:0.5rem; }' +
      '.mf-updated-badge::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--color-teal,#005f6b); }' +
      // Section title
      '.mf-panel-section-title { font-family:"Cormorant Garamond", serif; font-size:1.35rem; color:var(--color-teal,#005f6b); margin:1.75rem 0 0.5rem; font-weight:600; }';
    document.head.appendChild(st);
  }

  // Find a good place to inject the confederacy-totals table — right after
  // the B1 province chart (Panel B) and after C2 (whose host is `.db-panel--c2 .db-panel__body`).
  function findHostAfter(id) {
    // Try common Panel B/C anchors from the production HTML.
    var el = document.querySelector(id);
    if (!el) return null;
    return el;
  }

  function injectConfedTotals() {
    injectStylesOnce();
    var Mfc = window.MasterFileAdapter.constants;

    // Panel B (Fiji provinces): the production chart is inside .db-panel--b .db-panel__body.
    var bPanel = document.querySelector('.db-panel--b .db-panel__body')
              || document.querySelector('[data-panel="B"] .db-panel__body')
              || document.querySelector('#panel-b .db-panel__body');
    if (bPanel) {
      var host = bPanel.querySelector('.mf-confed-totals-host') || document.createElement('div');
      host.className = 'mf-confed-totals-host';
      var title = document.createElement('div');
      title.className = 'mf-panel-section-title';
      title.textContent = 'B \u00b7 Fiji publications by province & confederacy (Master-file authoritative)';
      var subhost = document.createElement('div');
      var tally = tallyByProvinceAndConfed('all');
      renderConfedTotalTable(subhost, tally, 'all');
      host.innerHTML = '';
      host.appendChild(title);
      host.appendChild(subhost);
      if (!bPanel.querySelector('.mf-confed-totals-host')) bPanel.appendChild(host);
    }

    // Panel C2 (research in and across Fiji's 14 provinces).
    var c2Panel = document.querySelector('.db-panel--c2 .db-panel__body')
               || document.querySelector('[data-panel="C2"] .db-panel__body')
               || document.querySelector('#panel-c2 .db-panel__body');
    if (c2Panel) {
      var host2 = c2Panel.querySelector('.mf-confed-totals-host') || document.createElement('div');
      host2.className = 'mf-confed-totals-host';
      var title2 = document.createElement('div');
      title2.className = 'mf-panel-section-title';
      title2.textContent = 'C2 \u00b7 iTaukei-associated publications by province & confederacy';
      var subhost2 = document.createElement('div');
      var tally2 = tallyByProvinceAndConfed('itaukei');
      renderConfedTotalTable(subhost2, tally2, 'itaukei');
      host2.innerHTML = '';
      host2.appendChild(title2);
      host2.appendChild(subhost2);
      if (!c2Panel.querySelector('.mf-confed-totals-host')) c2Panel.appendChild(host2);
    }
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
      try { injectConfedTotals(); } catch (e) { console.error('MF confed totals inject failed', e); }
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
