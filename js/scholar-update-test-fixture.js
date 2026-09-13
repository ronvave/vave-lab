/*
 * Temporary scholar Update-info pipeline test fixture — 2026-09-13
 *
 * Purpose:
 *   - render one unmistakably fake scholar at the TOP of Panel F;
 *   - give it a displayed total of 90 publications so it remains first;
 *   - exercise the real Update info modal/submission code without adding a
 *     fake Scholar, degree, publication, or authorship row to Master data.
 *
 * IMPORTANT: this is DOM-only. It is deliberately excluded from every KPI,
 * map, chart, search total, publication total and Master-file export.
 * Remove this file/loader entry after the Update-info pipeline is validated.
 */
(function () {
  'use strict';

  var TEST_ID = 'TEST-S0001';
  var TEST_NAME = 'Test Scholar';

  function addStyles() {
    if (document.getElementById('scholar-update-test-fixture-style')) return;
    var s = document.createElement('style');
    s.id = 'scholar-update-test-fixture-style';
    s.textContent = [
      '[data-test-scholar-fixture]{border:2px dashed #b45309!important;position:relative!important;}',
      '[data-test-scholar-fixture] .test-fixture-head{background:#fff3cd;color:#7a4b00;padding:10px 18px;font:700 .78rem "DM Sans",sans-serif;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #f2d27b;}',
      '[data-test-scholar-fixture] .test-fixture-body{display:grid;grid-template-columns:112px 1fr;gap:18px;padding:18px 20px 10px;}',
      '[data-test-scholar-fixture] .test-fixture-photo{width:104px;height:104px;border-radius:14px;background:linear-gradient(135deg,#0e7490,#164e63);display:flex;align-items:center;justify-content:center;color:#fff;font:700 2rem "DM Sans",sans-serif;border:4px solid #fff;box-shadow:0 0 0 1px #cbd5e1;}',
      '[data-test-scholar-fixture] .test-fixture-name{margin:0 0 3px;font:700 1.45rem "DM Sans",sans-serif;color:#0f172a;}',
      '[data-test-scholar-fixture] .test-fixture-meta{font:400 .92rem "DM Sans",sans-serif;color:#64748b;margin:2px 0;}',
      '[data-test-scholar-fixture] .test-fixture-inst{font:600 .94rem "DM Sans",sans-serif;color:#0e7490;margin:5px 0 2px;}',
      '[data-test-scholar-fixture] .test-fixture-degree{font:500 .9rem "DM Sans",sans-serif;color:#334155;margin:4px 0 8px;}',
      '[data-test-scholar-fixture] .test-fixture-update{display:inline-flex;align-items:center;justify-content:center;background:#1267b1;color:#fff;border:0;border-radius:7px;padding:8px 18px;font:700 .86rem "DM Sans",sans-serif;cursor:pointer;box-shadow:0 2px 5px rgba(15,23,42,.16);}',
      '[data-test-scholar-fixture] .test-fixture-update:hover{background:#0d5696;}',
      '[data-test-scholar-fixture] .test-fixture-stats{display:flex;gap:34px;margin:8px 20px 0;padding:14px 0 8px;border-top:1px solid #d9dfdf;font-family:"DM Sans",sans-serif;}',
      '[data-test-scholar-fixture] .test-fixture-stat strong{font-size:1.8rem;color:#075c69;margin-right:7px;}',
      '[data-test-scholar-fixture] .test-fixture-stat span{font-size:.9rem;color:#64748b;}',
      '[data-test-scholar-fixture] .test-fixture-types{display:flex;gap:7px;flex-wrap:wrap;padding:0 20px 18px;font:500 .78rem "DM Sans",sans-serif;}',
      '[data-test-scholar-fixture] .test-fixture-chip{border:1px solid #d7c08d;background:#fff6df;color:#9a6700;border-radius:999px;padding:4px 10px;}',
      '[data-test-scholar-fixture] .test-fixture-chip--phd{border-color:#9dd2a1;background:#ecf9ed;color:#17752b;}',
      '@media(max-width:650px){[data-test-scholar-fixture] .test-fixture-body{grid-template-columns:86px 1fr;gap:13px;padding:14px;}[data-test-scholar-fixture] .test-fixture-photo{width:78px;height:78px;font-size:1.5rem;}}'
    ].join('');
    document.head.appendChild(s);
  }

  function setValue(form, selector, value) {
    var el = form.querySelector(selector);
    if (!el) return;
    el.value = value == null ? '' : String(value);
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
  }

  function populateTestForm() {
    var modal = document.getElementById('db-submit-modal');
    var form = document.getElementById('db-submit-form');
    if (!modal || !form) return;

    modal.dataset.scholarId = TEST_ID;
    var sub = document.getElementById('db-submit-modal-sub');
    if (sub) sub.textContent = 'TEST PIPELINE ONLY — correcting / adding info for Dr Test Scholar. No real scholar record is attached to this fixture.';

    setValue(form, '#db-sf-scholar-name', TEST_NAME);
    setValue(form, '#db-sf-scholar-slug', TEST_ID);
    setValue(form, '#db-sf-salutation', 'Dr.');
    setValue(form, '#db-sf-title', 'Pipeline Test Scholar');
    setValue(form, '#db-sf-institution', 'University of Fakery');
    setValue(form, '[name="phd_university"]', 'University of Fakery');
    setValue(form, '[name="phd_country"]', 'Fakeland');
    setValue(form, '[name="phd_year"]', '2008');
    setValue(form, '[name="phd_year_completed"]', '2008');
    setValue(form, '#db-sf-notes', 'TEST PIPELINE SUBMISSION — fake scholar fixture. Do not apply this submission to production scholar data.');

    // The 2026-09-13 enhanced modal adds lineage-specific fields dynamically.
    // Leave geography blank so a tester can deliberately enter/change values.
    ['paternal_province','paternal_district','paternal_village','paternal_island',
     'maternal_province','maternal_district','maternal_village','maternal_island']
      .forEach(function (name) { setValue(form, '[name="' + name + '"]', ''); });

    var status = document.getElementById('db-submit-status');
    if (status) {
      status.textContent = 'TEST PROFILE: submissions from this card are for pipeline testing only.';
      status.className = 'db-submit-modal__status is-visible';
      status.style.background = '#fff3cd';
      status.style.color = '#7a4b00';
      status.style.borderLeft = '4px solid #d97706';
    }
  }

  function openTestModal(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    var modal = document.getElementById('db-submit-modal');
    var form = document.getElementById('db-submit-form');
    if (!modal || !form) return;

    // Clear values from a previously opened real-scholar modal, while keeping
    // the normal event handlers installed by the production dashboard.
    try { form.reset(); } catch (_) {}
    modal.dataset.scholarId = TEST_ID;
    modal.classList.add('is-visible');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    // main.js may enhance the form (paternal/maternal + degree blocks) on the
    // same click. Populate after that enhancement has had a chance to run.
    setTimeout(populateTestForm, 80);
  }

  function buildCard() {
    var card = document.createElement('article');
    card.className = 'db-scholar-card';
    card.setAttribute('data-test-scholar-fixture', '1');
    card.setAttribute('data-test-scholar-id', TEST_ID);
    card.innerHTML = '' +
      '<div class="test-fixture-head">TEST PROFILE — UPDATE-INFO PIPELINE FIXTURE · NOT PART OF DATABASE TOTALS</div>' +
      '<div class="test-fixture-body">' +
        '<div>' +
          '<div class="test-fixture-photo" aria-hidden="true">TS</div>' +
          '<button type="button" class="test-fixture-update" data-test-update-info>Update info</button>' +
        '</div>' +
        '<div>' +
          '<h3 class="db-scholar-card__name test-fixture-name">Dr Test Scholar</h3>' +
          '<div class="test-fixture-meta">Synthetic record for testing only</div>' +
          '<div class="test-fixture-inst">University of Fakery</div>' +
          '<div class="test-fixture-meta">Department of Imaginary Studies</div>' +
          '<div class="test-fixture-degree"><strong>PhD</strong> — University of Fakery · 2008</div>' +
          '<div class="test-fixture-meta">Use <strong>Update info</strong> to test the complete scholar-correction submission path.</div>' +
        '</div>' +
      '</div>' +
      '<div class="test-fixture-stats">' +
        '<div class="test-fixture-stat"><strong>90</strong><span>Publications</span></div>' +
        '<div class="test-fixture-stat"><strong>90</strong><span>First-authored</span></div>' +
      '</div>' +
      '<div class="test-fixture-types">' +
        '<span class="test-fixture-chip">89 Journal articles</span>' +
        '<span class="test-fixture-chip test-fixture-chip--phd">1 PhD thesis</span>' +
      '</div>';
    var btn = card.querySelector('[data-test-update-info]');
    if (btn) btn.addEventListener('click', openTestModal);
    return card;
  }

  function ensureFixture() {
    // Never show the test record in a direct/shared scholar profile.
    if (document.body.classList.contains('scholar-direct-mode') || new URLSearchParams(location.search).get('share') === '1') return;
    var grid = document.querySelector('[data-db-leaders]');
    if (!grid || grid.querySelector('[data-test-scholar-fixture]')) return;
    var firstReal = grid.querySelector('.db-scholar-card');
    if (!firstReal) return;
    grid.insertBefore(buildCard(), firstReal);
  }

  function boot() {
    addStyles();
    ensureFixture();
    var grid = document.querySelector('[data-db-leaders]');
    if (grid) {
      new MutationObserver(function () { ensureFixture(); }).observe(grid, { childList: true });
      return;
    }
    var tries = 0;
    var timer = setInterval(function () {
      ensureFixture();
      if (document.querySelector('[data-db-leaders]') || ++tries > 200) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
