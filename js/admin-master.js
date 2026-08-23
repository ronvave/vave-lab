/* ============================================================================
 * admin-master.js  —  Vave Lab Master-file Admin (V2)
 *
 * Purpose
 * -------
 * Manage the admin-owned supplementary data that overlays the Master Google
 * Sheet for the new iTaukei Scholar dashboard:
 *
 *   - data/scholar-enrichment.json.enc      (Scholar-ID keyed)
 *   - data/scholar-insights-master.json.enc (Scholar-ID keyed)
 *   - img/scholars/<ITK-Sxxxx>.jpg          (400×400 in-browser resize)
 *
 * The Master Google Sheet remains the single source of truth for scholar
 * demographics, publication authorship, etc. This admin only writes fields
 * the sheet does NOT own: profile photo path, external URLs (institution
 * homepage, department homepage, public profile URL), sector categorisation,
 * years of birth/death, and long-form research insights.
 *
 * Publication counts shown here call the SAME canonical function the public
 * dashboard uses — window.MasterFileAdapter.computePublicationTotals(...) —
 * so counts can never drift between Admin and Panel F.
 *
 * File-level encryption is handled by window.dbGate (same PBKDF2/AES-GCM
 * pipeline that protects all V2 data files). Every push generates a fresh
 * per-file salt, so uploading one file NEVER invalidates any other.
 * ==========================================================================*/
(function () {
  'use strict';

  // ------------------------- constants -------------------------
  var PASSWORD_HASH = 'd4d3d9ac6a90ffff854263c3edade0c83c5cc1836cb581f67aa91789ece296d6';
  var SESSION_KEY   = 'vavelab_admin_master_session';
  var GH_TOKEN_KEY  = 'vavelab_gh_token';
  var GH_OWNER      = 'ronvave';
  var GH_REPO       = 'vave-lab';
  var GH_BRANCH     = 'main';

  // Province → Confederacy lookup (derived from the Master Sheet Lookups tab,
  // columns I & J). Used to derive Maternal Confederacy read-only for display
  // (Doc 1 req #5, #14) and, once write-back is enabled, to drive dependent
  // dropdowns for Paternal Province → Paternal Confederacy and Maternal
  // Province → Maternal Confederacy. Kubuna / Tovata / Burebasaga are the
  // three canonical confederacies.
  var PROVINCE_TO_CONFED = {
    'Ba': 'Kubuna', 'Bua': 'Tovata', 'Cakaudrove': 'Tovata',
    'Kadavu': 'Burebasaga', 'Lau': 'Tovata', 'Lomaiviti': 'Kubuna',
    'Macuata': 'Tovata', 'Nadroga/Navosa': 'Burebasaga',
    'Naitasiri': 'Kubuna', 'Namosi': 'Burebasaga', 'Ra': 'Kubuna',
    'Rewa': 'Burebasaga', 'Serua': 'Burebasaga', 'Tailevu': 'Kubuna',
    'Unclassified': 'Unclassified'
  };

  var ENRICHMENT_URL = 'data/scholar-enrichment.json';
  var INSIGHTS_URL   = 'data/scholar-insights-master.json';
  var ENRICHMENT_ENC = 'data/scholar-enrichment.json.enc';
  var INSIGHTS_ENC   = 'data/scholar-insights-master.json.enc';

  // ------------------------- runtime state -------------------------
  var state = {
    bundle: null,            // full adapter bundle (adapter.load())
    scholars: [],            // master.scholars (raw rows)
    scholarById: {},         // Scholar ID -> raw row
    enrichmentDoc: null,     // full { version, scholars: { SID: {...} } }
    insightsDoc: null,       // full { version, scholars: { SID: {...} } }
    oldZoteroBySid: {},      // Scholar ID -> old-dashboard { total, firstAuthored }
    counts: {},              // Scholar ID -> canonical { total, firstAuthored, types, gap }
    filterQuery: '',
    filterConfederacy: '',
    filterChips: {},         // { chipName -> bool }
    gapFilterReason: '',
    gapFilterStatus: '',
    gapChipOldOnly: false,
    // Default sort is publication count descending so the most-published
    // scholar appears first every time the dashboard loads (Doc 1 req #1).
    sortKey: 'total',
    sortDir: 'desc',
    // Default gap-table sort is by repair priority (VERY HIGH first) so the
    // biggest expected-vs-canonical gaps land at the top of the repair queue
    // (Doc 2 req #27; Doc 3 #9).
    gapSortKey: 'priority',
    gapSortDir: 'asc',
    editingSid: null,
    photoDataUrl: null,      // dataURL of the current (unsaved) resized JPEG
    photoDirty: false        // has the user changed the photo this session?
  };

  // ------------------------- tiny utils -------------------------
  function $ (sel, root) { return (root || document).querySelector(sel); }
  function $$ (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }
  function toast (msg, kind, ms) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast is-visible' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = 'toast'; }, ms || 3500);
    log(msg, kind);
  }
  function log (msg, kind) {
    var box = $('#action-log');
    if (!box) return;
    var t = new Date().toLocaleTimeString('en-GB');
    var cls = kind === 'error' ? 'log-error' : (kind === 'ok' ? 'log-ok' : '');
    var line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = '<span class="log-time">' + esc(t) + '</span> ' +
                     (cls ? '<span class="' + cls + '">' + esc(msg) + '</span>' : esc(msg));
    box.insertBefore(line, box.firstChild);
    while (box.children.length > 200) box.removeChild(box.lastChild);
  }
  function b64encodeBytes (bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 4096) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 4096, bytes.length)));
    }
    return btoa(s);
  }
  async function sha256 (str) {
    var buf = new TextEncoder().encode(str);
    var hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.prototype.map.call(new Uint8Array(hash), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  // ------------------------- password gate -------------------------
  document.addEventListener('DOMContentLoaded', function () {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      startDashboard();
    }
    $('#login-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var pw = $('#pw').value;
      var h = await sha256(pw);
      if (h === PASSWORD_HASH) {
        sessionStorage.setItem(SESSION_KEY, '1');
        startDashboard();
      } else {
        $('#login-error').classList.add('is-visible');
        $('#pw').value = '';
      }
    });
    $('#logout').addEventListener('click', function () {
      sessionStorage.removeItem(SESSION_KEY);
      // Do NOT clear the GH token — user may want it to survive.
      location.reload();
    });
  });

  async function startDashboard () {
    $('#login').style.display = 'none';
    $('#dashboard').classList.add('is-visible');
    $('#db-status').textContent = 'unlocking data…';

    // dbGate: unlock the encrypted data files with the shared preview passcode.
    if (window.dbGate && typeof window.dbGate.boot === 'function') {
      await new Promise(function (r) { window.dbGate.boot(r); });
    }
    $('#db-status').textContent = 'loading Master…';

    try {
      await loadEverything();
      $('#db-status').textContent = 'ready';
      $('#db-status').style.background = 'rgba(22,163,74,0.2)';
    } catch (e) {
      console.error(e);
      $('#db-status').textContent = 'load error';
      $('#db-status').style.background = 'rgba(185,28,28,0.28)';
      toast('Failed to load data: ' + (e && e.message ? e.message : e), 'error', 8000);
      return;
    }

    wireControls();
    renderKpi();
    renderScholars();
    renderGaps();
    refreshGhTokenStatus();
  }

  // ------------------------- load pipeline -------------------------
  async function loadEverything () {
    if (!window.MasterFileAdapter) {
      throw new Error('MasterFileAdapter not loaded');
    }
    var bundle = await window.MasterFileAdapter.load();
    state.bundle = bundle;
    state.scholars = (bundle.master && bundle.master.scholars) || [];
    state.scholars.forEach(function (s) {
      var sid = s['Scholar ID'];
      if (sid) state.scholarById[sid] = s;
    });
    state.enrichmentDoc = bundle.master.adminEnrichment || { version: 1, scholars: {} };
    state.insightsDoc   = bundle.master.adminInsights   || { version: 1, scholars: {} };

    // Cache canonical counts once. computePublicationTotals memoises internally.
    state.scholars.forEach(function (s) {
      var sid = s['Scholar ID'];
      if (!sid) return;
      try {
        state.counts[sid] = window.MasterFileAdapter.computePublicationTotals(bundle.master, sid);
      } catch (e) {
        state.counts[sid] = { total: 0, firstAuthored: 0, types: {}, gap: 'error' };
      }
    });

    // Best-effort load of the old V1 Zotero snapshot so we can (a) show Ron
    // an "old count" reference on the linkage-gap panel, and (b) sort the
    // gap list by scholars whose old dashboard displayed the most pubs.
    // Never used as an authoritative count — read-only diagnostic reference.
    await loadOldZoteroCountsBySid();
  }

  async function loadOldZoteroCountsBySid () {
    if (!window.dbGate || !window.dbGate.fetchJson) return;
    var scholarProfiles = null;
    try {
      scholarProfiles = await window.dbGate.fetchJson('data/scholar-profiles.json');
    } catch (e) {
      log('Old Zotero profiles unavailable — diagnostic column will be blank', 'warn');
      return;
    }
    if (!scholarProfiles || !Array.isArray(scholarProfiles.scholars)) return;

    // scholar-profiles.json is name-keyed (V1 shape). Match to Master rows by
    // canonical "Family, Given" — this is the same join the V1 dashboard used.
    // We keep the join tolerant: if names disagree we simply drop the row.
    var byCanonical = {};
    scholarProfiles.scholars.forEach(function (p) {
      var key = (p.canonical || p.name || '').trim().toLowerCase();
      if (key) byCanonical[key] = p;
    });
    state.scholars.forEach(function (s) {
      var canonical = ((s['Family Name'] || '') + ', ' + (s['Given Names'] || '')).trim().toLowerCase();
      var p = byCanonical[canonical];
      if (!p) return;
      // Prefer explicit fields; fall back to array lengths if present.
      var total = null, firstAuth = null;
      if (typeof p.publicationCount === 'number') total = p.publicationCount;
      else if (Array.isArray(p.publications)) total = p.publications.length;
      if (typeof p.firstAuthoredCount === 'number') firstAuth = p.firstAuthoredCount;
      if (total === null) return;
      state.oldZoteroBySid[s['Scholar ID']] = { total: total, firstAuthored: firstAuth };
    });
    log('Loaded old Zotero counts for ' + Object.keys(state.oldZoteroBySid).length + ' scholars (diagnostic reference only).');
  }

  // ------------------------- KPI strip -------------------------
  function renderKpi () {
    var scholars = state.scholars;
    var total = scholars.length;
    var withPhotos = 0, withInsights = 0, deceased = 0, gaps = 0, incomplete = 0;
    scholars.forEach(function (s) {
      var sid = s['Scholar ID'];
      var enr = state.enrichmentDoc.scholars[sid] || {};
      var ins = state.insightsDoc.scholars[sid] || {};
      if (enr.photo) withPhotos++;
      if (ins.summaryHtml || (ins.keywords && ins.keywords.length)) withInsights++;
      var alive = String(s['Alive / Deceased'] || s['Alive/Deceased'] || '').toLowerCase();
      if (alive.indexOf('deceased') !== -1) deceased++;
      var linkageStatus = classifyLinkage(sid);
      if (linkageStatus === 'no-authorship-rows') gaps++;
      else if (linkageStatus === 'sparse-authorship') incomplete++;
    });
    var kpis = [
      { label: 'Scholars in Master', value: total },
      { label: 'With admin photo',   value: withPhotos },
      { label: 'With research insights', value: withInsights },
      { label: 'Zero-Authorship gaps',   value: gaps },
      { label: 'Sparse (1 row) gaps',    value: incomplete },
    ];
    $('#kpi-row').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="value">' + esc(k.value) +
             '</div><div class="label">' + esc(k.label) + '</div></div>';
    }).join('');
  }

  // ------------------------- linkage classification -------------------------
  // Returns:
  //   'ok'                     — enough Authorship rows to trust as-is
  //   'sparse-authorship'      — 1 row (likely incomplete linkage)
  //   'no-authorship-rows'     — 0 rows (either genuinely zero-pub OR unlinked)
  //   'no-scholar-id'          — Scholar has no ID at all
  function classifyLinkage (sid) {
    if (!sid) return 'no-scholar-id';
    var c = state.counts[sid];
    if (!c) return 'no-authorship-rows';
    if (c.total === 0) return 'no-authorship-rows';
    if (c.total === 1) return 'sparse-authorship';
    return 'ok';
  }

  // ------------------------- scholar list rendering -------------------------
  function renderScholars () {
    var rows = state.scholars.slice();

    // filter
    var q = state.filterQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (s) {
        return [s['Scholar ID'], s['Scholar Name'], s['Family Name'], s['Given Names'],
                s['Current Institution'], s['Current Department / Unit'], s['Current Department']]
          .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
      });
    }
    if (state.filterConfederacy) {
      rows = rows.filter(function (s) {
        return String(s['Confederacy'] || '').trim() === state.filterConfederacy;
      });
    }
    var chips = state.filterChips;
    if (chips['has-photo'])        rows = rows.filter(function (s) { return !!(state.enrichmentDoc.scholars[s['Scholar ID']] || {}).photo; });
    if (chips['missing-photo'])    rows = rows.filter(function (s) { return !(state.enrichmentDoc.scholars[s['Scholar ID']] || {}).photo; });
    if (chips['has-insights'])     rows = rows.filter(function (s) { var i = state.insightsDoc.scholars[s['Scholar ID']] || {}; return !!(i.summaryHtml || (i.keywords && i.keywords.length)); });
    if (chips['missing-insights']) rows = rows.filter(function (s) { var i = state.insightsDoc.scholars[s['Scholar ID']] || {}; return !(i.summaryHtml || (i.keywords && i.keywords.length)); });
    if (chips['linkage-gap'])      rows = rows.filter(function (s) { var st = classifyLinkage(s['Scholar ID']); return st === 'no-authorship-rows' || st === 'sparse-authorship'; });

    // sort
    var key = state.sortKey, dir = state.sortDir;
    rows.sort(function (a, b) {
      var va = sortValue(a, key), vb = sortValue(b, key);
      if (va < vb) return dir === 'asc' ? -1 :  1;
      if (va > vb) return dir === 'asc' ?  1 : -1;
      return 0;
    });

    // update chip counts (over full unfiltered scholars, so counts don't disappear as you filter)
    updateChipCounts();

    // render body
    var tbody = $('#scholars-tbody');
    tbody.innerHTML = rows.map(scholarRowHtml).join('');
    $('#row-count').textContent = rows.length + ' of ' + state.scholars.length;

    // click handler
    $$('#scholars-tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openEditModal(tr.getAttribute('data-sid')); });
    });

    // sort-arrow indicators
    $$('table.scholars thead th.sortable').forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.getAttribute('data-sort') === state.sortKey) {
        th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function sortValue (s, key) {
    var sid = s['Scholar ID'];
    var c = state.counts[sid] || { total: 0, firstAuthored: 0 };
    switch (key) {
      case 'scholarId':    return sid || '';
      case 'name':         return (s['Scholar Name'] || (s['Family Name'] + ', ' + s['Given Names']) || '').toLowerCase();
      case 'confederacy':  return String(s['Confederacy'] || '');
      case 'discipline':   return String(s['Discipline'] || s['Primary Discipline / Field'] || '');
      case 'total':        return c.total;
      case 'firstAuthored':return c.firstAuthored;
      default:             return '';
    }
  }

  function scholarRowHtml (s) {
    var sid = s['Scholar ID'] || '';
    var enr = state.enrichmentDoc.scholars[sid] || {};
    var ins = state.insightsDoc.scholars[sid] || {};
    var c = state.counts[sid] || { total: 0, firstAuthored: 0 };
    var link = classifyLinkage(sid);
    var conf = (s['Confederacy'] || '').trim();
    var confSlug = ['Burebasaga', 'Kubuna', 'Tovata'].indexOf(conf) !== -1 ? conf : 'none';
    var confLabel = confSlug === 'none' ? '—' : conf;
    var name = s['Scholar Name'] || ((s['Family Name'] || '') + ', ' + (s['Given Names'] || ''));
    var discipline = s['Discipline'] || s['Primary Discipline / Field'] || '—';
    var totalClass = link === 'no-authorship-rows' ? 'pub-count gap' :
                     link === 'sparse-authorship'  ? 'pub-count sparse' : 'pub-count';

    var flagBadges = [];
    if (link === 'no-authorship-rows')  flagBadges.push('<span class="badge badge-gap" title="Master Authorship has zero rows for this scholar">0 rows</span>');
    if (link === 'sparse-authorship')   flagBadges.push('<span class="badge badge-incomplete" title="Master Authorship has only 1 row — likely incomplete">1 row</span>');
    if (String(s['Alive / Deceased'] || s['Alive/Deceased'] || '').toLowerCase().indexOf('deceased') !== -1) flagBadges.push('<span class="badge" style="background:#eee;color:var(--muted)">deceased</span>');

    var linkBits = [];
    if (s['ORCID / Researcher ID']) linkBits.push('<span class="check" title="ORCID / Researcher ID present">O</span>');
    if (s['Google Scholar URL']) linkBits.push('<span class="check" title="Google Scholar URL present">G</span>');
    if (s['Current Profile URL'] || enr.profileUrl) linkBits.push('<span class="check" title="Profile URL present">P</span>');

    return '<tr data-sid="' + esc(sid) + '">' +
      '<td class="sid">' + esc(sid) + '</td>' +
      '<td>' + esc(name) + '</td>' +
      '<td><span class="conf-chip conf-' + confSlug + '">' + esc(confLabel) + '</span></td>' +
      '<td>' + esc(discipline) + '</td>' +
      '<td class="' + totalClass + '">' + esc(c.total) + '</td>' +
      '<td class="' + totalClass + '">' + esc(c.firstAuthored) + '</td>' +
      '<td>' + (enr.photo ? '<span class="check" title="Photo saved">✓</span>' : '<span class="cross">—</span>') + '</td>' +
      '<td>' + ((ins.summaryHtml || (ins.keywords && ins.keywords.length)) ? '<span class="check">✓</span>' : '<span class="cross">—</span>') + '</td>' +
      '<td>' + (linkBits.length ? linkBits.join(' ') : '<span class="cross">—</span>') + '</td>' +
      '<td>' + flagBadges.join(' ') + '</td>' +
      '</tr>';
  }

  function updateChipCounts () {
    var counts = {
      'has-photo': 0, 'missing-photo': 0,
      'has-insights': 0, 'missing-insights': 0,
      'linkage-gap': 0
    };
    state.scholars.forEach(function (s) {
      var sid = s['Scholar ID']; if (!sid) return;
      var enr = state.enrichmentDoc.scholars[sid] || {};
      var ins = state.insightsDoc.scholars[sid] || {};
      if (enr.photo) counts['has-photo']++; else counts['missing-photo']++;
      if (ins.summaryHtml || (ins.keywords && ins.keywords.length)) counts['has-insights']++; else counts['missing-insights']++;
      var st = classifyLinkage(sid);
      if (st === 'no-authorship-rows' || st === 'sparse-authorship') counts['linkage-gap']++;
    });
    Object.keys(counts).forEach(function (chip) {
      var el = document.querySelector('[data-chip-count="' + chip + '"]');
      if (el) el.textContent = counts[chip];
    });
  }

  // ------------------------- edit modal -------------------------
  function openEditModal (sid) {
    var s = state.scholarById[sid];
    if (!s) { toast('Scholar not found: ' + sid, 'error'); return; }
    state.editingSid = sid;
    state.photoDataUrl = null;
    state.photoDirty = false;

    var enr = state.enrichmentDoc.scholars[sid] || {};
    var ins = state.insightsDoc.scholars[sid] || {};

    // Header
    $('#modal-name').textContent = s['Scholar Name'] || ((s['Family Name'] || '') + ', ' + (s['Given Names'] || ''));
    $('#modal-sid').textContent = sid;

    // Count summary
    var c = state.counts[sid] || { total: 0, firstAuthored: 0 };
    var linkage = classifyLinkage(sid);
    var summaryClass = 'count-summary';
    var flagLine = '';
    if (linkage === 'no-authorship-rows') {
      summaryClass += ' gap';
      flagLine = '<span class="flag-note"><strong>Authorship linkage incomplete.</strong> Master `Authorship` has 0 rows for this scholar. Not treated as final; the number will refresh once the linkage is repaired in the sheet.</span>';
    } else if (linkage === 'sparse-authorship') {
      summaryClass += ' sparse';
      flagLine = '<span class="flag-note"><strong>Authorship linkage sparse.</strong> Master `Authorship` has only 1 row; likely incomplete.</span>';
    }
    var oldRef = state.oldZoteroBySid[sid];
    var oldRefLine = oldRef ? '<div style="margin-top:4px; color: var(--muted); font-size: 0.82rem;">Old V1 dashboard showed <strong>' + esc(oldRef.total) + '</strong> pubs' +
                              (oldRef.firstAuthored != null ? ' (' + esc(oldRef.firstAuthored) + ' first-authored)' : '') +
                              ' — diagnostic reference only.</div>' : '';
    $('#modal-count-summary').className = summaryClass;
    $('#modal-count-summary').innerHTML =
      '<div class="headline">Canonical counts: ' + esc(c.total) + ' publications · ' + esc(c.firstAuthored) + ' first-authored</div>' +
      flagLine + oldRefLine;

    // Master read-only
    $('#ro-family').value           = s['Family Name'] || '';
    $('#ro-given').value            = s['Given Names'] || '';
    $('#ro-gender').value           = s['Gender'] || '';
    $('#ro-alive').value            = s['Alive / Deceased'] || s['Alive/Deceased'] || '';
    // Paternal confederacy: Master value if present, else derived via Lookups.
    $('#ro-confed').value            = s['Paternal Confederacy'] || s['Confederacy'] || '';
    // Maternal confederacy: currently derived read-only from Maternal Province
    // via the Lookups tab (Doc 1 req #5). Becomes an editable Master column
    // once write-back is approved.
    // Derive maternal confederacy from Maternal Province via Lookups.
    var _matProv = (s['Province Maternal'] || s['Maternal Province'] || '').trim();
    $('#ro-confed-maternal').value   = PROVINCE_TO_CONFED[_matProv] || '';
    $('#ro-discipline').value        = s['Discipline'] || s['Primary Discipline / Field'] || '';
    $('#ro-prov-paternal').value     = s['Province Paternal'] || s['Paternal Province'] || '';
    $('#ro-prov-maternal').value     = s['Province Maternal'] || s['Maternal Province'] || '';
    if ($('#ro-dist-paternal')) $('#ro-dist-paternal').value = s['District Paternal'] || '';
    if ($('#ro-dist-maternal')) $('#ro-dist-maternal').value = s['District Maternal'] || '';
    $('#ro-vil-paternal').value      = s['Village Paternal'] || s['Paternal Village'] || '';
    $('#ro-vil-maternal').value      = s['Village Maternal'] || s['Maternal Village'] || '';
    $('#ro-title').value            = s['Current Title / Role'] || s['Current Title'] || '';
    $('#ro-institution').value      = s['Current Institution'] || '';
    $('#ro-inst-country').value     = s['Institution Country'] || s['Current Country'] || '';
    $('#ro-department').value       = s['Current Department / Unit'] || s['Current Department'] || '';
    $('#ro-masters-uni').value      = s['Masters University'] || '';
    $('#ro-masters-country').value  = s['Masters Country'] || '';
    $('#ro-phd-uni').value          = s['PhD University'] || '';
    $('#ro-phd-country').value      = s['PhD Country'] || '';
    $('#ro-orcid').value            = s['ORCID / Researcher ID'] || s['ORCID'] || '';
    $('#ro-gs-url').value           = s['Google Scholar URL'] || '';
    $('#ro-profile-url').value      = s['Current Profile URL'] || '';

    // Admin editable
    $('#pf-sector').value            = enr.sector || '';
    $('#pf-institution-url').value   = enr.institutionUrl || '';
    $('#pf-department-url').value    = enr.departmentUrl || '';
    $('#pf-birth').value             = enr.yearOfBirth || '';
    $('#pf-death').value             = enr.yearOfDeath || '';

    // Photo
    var photoPath = enr.photo || '';
    $('#pf-photo').value = photoPath;
    setPhotoPreview(photoPath ? photoPath + '?t=' + Date.now() : null);

    // Insights JSON
    var insText = '';
    if (ins && (ins.keywords || ins.summaryHtml || ins.sources)) {
      try {
        var payload = {};
        if (ins.keywords)     payload.keywords = ins.keywords;
        if (ins.summaryHtml)  payload.summaryHtml = ins.summaryHtml;
        if (ins.summaryFormat)payload.summaryFormat = ins.summaryFormat;
        if (ins.sources)      payload.sources = ins.sources;
        insText = JSON.stringify(payload, null, 2);
      } catch (e) { insText = ''; }
    }
    $('#pf-insights-json').value = insText;
    updateInsightsPreview();

    $('#edit-modal').classList.add('is-visible');
  }

  function closeEditModal () {
    $('#edit-modal').classList.remove('is-visible');
    state.editingSid = null;
    state.photoDataUrl = null;
    state.photoDirty = false;
  }

  function setPhotoPreview (src) {
    var box = $('#pf-photo-preview');
    if (!src) { box.innerHTML = ''; return; }
    box.innerHTML = '<img src="' + esc(src) + '" onerror="this.onerror=null;this.remove();" />';
  }

  function updateInsightsPreview () {
    var raw = $('#pf-insights-json').value.trim();
    var box = $('#pf-insights-preview');
    if (!raw) { box.innerHTML = '<em style="color: var(--muted);">Empty. This scholar has no research insights.</em>'; return; }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      box.innerHTML = '<span style="color: var(--danger);">Invalid JSON: ' + esc(e.message) + '</span>';
      return;
    }
    var html = '';
    if (Array.isArray(parsed.keywords) && parsed.keywords.length) {
      html += '<div>' + parsed.keywords.map(function (k) { return '<span class="kw">' + esc(k) + '</span>'; }).join('') + '</div>';
    }
    if (parsed.summaryHtml) {
      // Preview only — inserted as innerHTML because the field is meant to hold sanitised markup Ron writes.
      // Same trust model as the old admin's insights preview.
      html += '<div class="summary">' + parsed.summaryHtml + '</div>';
    }
    if (Array.isArray(parsed.sources) && parsed.sources.length) {
      html += '<ul class="sources">' + parsed.sources.map(function (src) {
        return '<li><a href="' + esc(src.url || '#') + '" target="_blank" rel="noopener">' + esc(src.title || src.url || '(untitled)') + '</a></li>';
      }).join('') + '</ul>';
    }
    box.innerHTML = html || '<em style="color: var(--muted);">Parsed, but no keywords / summaryHtml / sources fields.</em>';
  }

  // ------------------------- photo pipeline (400×400 JPEG) -------------------------
  function handlePhotoFile (file) {
    if (!file || !file.type.match(/^image\//)) { toast('Not an image file.', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        // center-crop square, resize to 400×400, encode JPEG 0.9
        var size = 400;
        var sw = img.naturalWidth, sh = img.naturalHeight;
        var side = Math.min(sw, sh);
        var sx = (sw - side) / 2, sy = (sh - side) / 2;
        var canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        state.photoDataUrl = dataUrl;
        state.photoDirty = true;
        setPhotoPreview(dataUrl);
        // Auto-fill path
        var sid = state.editingSid || '';
        if (sid) {
          $('#pf-photo').value = 'img/scholars/' + sid + '.jpg';
        }
        var kb = Math.round((dataUrl.length * 0.75) / 1024);
        $('#pf-photo-hint').textContent = 'Resized to 400×400 JPEG (~' + kb + ' KB). Push on save.';
      };
      img.onerror = function () { toast('Could not decode that image.', 'error'); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ------------------------- save flow -------------------------
  async function saveEditModal () {
    if (!state.editingSid) return;
    var sid = state.editingSid;
    var saveBtn = $('#modal-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      var token = getGhToken();
      if (!token) throw new Error('Save a GitHub PAT under Data source before pushing.');

      // 1) Build enrichment overlay
      var newEnr = Object.assign({}, state.enrichmentDoc.scholars[sid] || {});
      var sector           = $('#pf-sector').value.trim();
      var institutionUrl   = $('#pf-institution-url').value.trim();
      var departmentUrl    = $('#pf-department-url').value.trim();
      var birth            = $('#pf-birth').value.trim();
      var death            = $('#pf-death').value.trim();
      var photoPath        = $('#pf-photo').value.trim();

      if (sector)          newEnr.sector = sector;         else delete newEnr.sector;
      if (institutionUrl)  newEnr.institutionUrl = institutionUrl; else delete newEnr.institutionUrl;
      if (departmentUrl)   newEnr.departmentUrl = departmentUrl;   else delete newEnr.departmentUrl;
      if (birth)           newEnr.yearOfBirth = parseInt(birth, 10);   else delete newEnr.yearOfBirth;
      if (death) {
        newEnr.yearOfDeath = parseInt(death, 10);
        newEnr.deceased = true;
      } else {
        delete newEnr.yearOfDeath;
        delete newEnr.deceased;
      }
      if (photoPath)       newEnr.photo = photoPath;        else delete newEnr.photo;
      newEnr.updatedAt = new Date().toISOString();

      // Determine what actually needs pushing:
      var willUploadPhoto = state.photoDirty && !!state.photoDataUrl && !!photoPath;

      // 2) Parse insights (if any) BEFORE any push, so a syntax error aborts cleanly
      var insText = $('#pf-insights-json').value.trim();
      var newIns = null;
      if (insText) {
        try { newIns = JSON.parse(insText); }
        catch (e) { throw new Error('Insights JSON is invalid: ' + e.message); }
        newIns.updatedAt = new Date().toISOString();
      }

      // 3) Upload photo (if dirty)
      if (willUploadPhoto) {
        var jpegBytes = dataUrlToBytes(state.photoDataUrl);
        await githubUploadBinary(photoPath, jpegBytes, 'admin(master): update photo for ' + sid);
        log('Uploaded ' + photoPath + ' (' + Math.round(jpegBytes.length / 1024) + ' KB)', 'ok');
      }

      // 4) Merge back into full docs and push whichever changed
      var enrDoc = deepCloneDoc(state.enrichmentDoc);
      enrDoc.scholars[sid] = newEnr;
      enrDoc.updatedAt = new Date().toISOString();
      await pushEncryptedJson(ENRICHMENT_ENC, enrDoc, 'admin(master): update enrichment for ' + sid);
      state.enrichmentDoc = enrDoc;
      log('Pushed ' + ENRICHMENT_ENC, 'ok');

      if (newIns) {
        var insDoc = deepCloneDoc(state.insightsDoc);
        insDoc.scholars[sid] = newIns;
        insDoc.updatedAt = new Date().toISOString();
        await pushEncryptedJson(INSIGHTS_ENC, insDoc, 'admin(master): update insights for ' + sid);
        state.insightsDoc = insDoc;
        log('Pushed ' + INSIGHTS_ENC, 'ok');
      } else {
        // If Ron clears the JSON, remove that scholar's entry
        if (state.insightsDoc.scholars[sid]) {
          var insDoc2 = deepCloneDoc(state.insightsDoc);
          delete insDoc2.scholars[sid];
          insDoc2.updatedAt = new Date().toISOString();
          await pushEncryptedJson(INSIGHTS_ENC, insDoc2, 'admin(master): clear insights for ' + sid);
          state.insightsDoc = insDoc2;
          log('Cleared insights for ' + sid + ' in ' + INSIGHTS_ENC, 'ok');
        }
      }

      toast('Saved ' + sid + ' — GitHub Pages will refresh in 1–2 minutes.', 'ok', 6000);
      closeEditModal();
      renderKpi();
      renderScholars();
      renderGaps();
    } catch (e) {
      console.error(e);
      toast('Save failed: ' + (e.message || e), 'error', 8000);
      log('Save failed: ' + (e.message || e), 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & push';
    }
  }

  function deepCloneDoc (doc) {
    return JSON.parse(JSON.stringify(doc || { version: 1, scholars: {} }));
  }

  function dataUrlToBytes (dataUrl) {
    var comma = dataUrl.indexOf(',');
    var b64 = dataUrl.slice(comma + 1);
    var raw = atob(b64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  // ------------------------- encrypted JSON push -------------------------
  async function pushEncryptedJson (path, jsonObj, commitMsg) {
    if (!window.dbGate || typeof window.dbGate.encryptForUpload !== 'function') {
      throw new Error('dbGate.encryptForUpload not available (page not unlocked?)');
    }
    var plaintext = JSON.stringify(jsonObj, null, 2);
    var encBytes = await window.dbGate.encryptForUpload(plaintext);
    return githubUploadBinary(path, encBytes, commitMsg);
  }

  async function githubUploadBinary (path, bytes, commitMsg) {
    var token = getGhToken();
    if (!token) throw new Error('No GitHub token');
    // 1) look up current SHA (needed for updates, absent for creates)
    var getUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + encodeURI(path) + '?ref=' + GH_BRANCH;
    var sha = null;
    var head = await fetch(getUrl, { headers: ghHeaders(token) });
    if (head.status === 200) {
      var j = await head.json();
      sha = j && j.sha;
    } else if (head.status !== 404) {
      throw new Error('GitHub read failed (' + head.status + '): ' + await head.text());
    }
    // 2) PUT the new content
    var body = {
      message: commitMsg || ('admin(master): update ' + path),
      content: b64encodeBytes(bytes),
      branch: GH_BRANCH
    };
    if (sha) body.sha = sha;

    var putUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + encodeURI(path);
    var put = await fetch(putUrl, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
      body: JSON.stringify(body)
    });
    if (put.status === 409 || put.status === 422) {
      // sha race — one retry with a fresh sha
      var refetch = await fetch(getUrl, { headers: ghHeaders(token) });
      if (refetch.ok) {
        var jj = await refetch.json();
        body.sha = jj && jj.sha;
        put = await fetch(putUrl, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
          body: JSON.stringify(body)
        });
      }
    }
    if (!put.ok) {
      throw new Error('GitHub write failed (' + put.status + '): ' + await put.text());
    }
    return true;
  }

  function ghHeaders (token) {
    return {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function getGhToken () {
    try { return localStorage.getItem(GH_TOKEN_KEY) || ''; }
    catch (e) { return ''; }
  }

  async function refreshGhTokenStatus () {
    var el = $('#gh-token-status');
    var token = getGhToken();
    if (!token) {
      el.textContent = 'no token'; el.style.background = 'var(--warning-bg)'; el.style.color = 'var(--warning)';
      return;
    }
    el.textContent = 'checking…'; el.style.background = 'var(--cream)'; el.style.color = 'var(--muted)';
    try {
      var res = await fetch('https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO, { headers: ghHeaders(token) });
      if (res.ok) {
        el.textContent = 'token ok';
        el.style.background = 'var(--success-bg)'; el.style.color = 'var(--success)';
      } else if (res.status === 401) {
        el.textContent = 'token invalid';
        el.style.background = 'var(--danger-bg)'; el.style.color = 'var(--danger)';
      } else {
        el.textContent = 'status ' + res.status;
        el.style.background = 'var(--warning-bg)'; el.style.color = 'var(--warning)';
      }
    } catch (e) {
      el.textContent = 'network err'; el.style.background = 'var(--danger-bg)'; el.style.color = 'var(--danger)';
    }
  }

  // ------------------------- refresh workflow dispatch -------------------------
  async function dispatchRefresh () {
    var token = getGhToken();
    if (!token) { toast('Save a GitHub PAT first.', 'error'); return; }
    $('#dispatch-status').textContent = 'dispatching…';
    try {
      var url = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/actions/workflows/refresh-master-file.yml/dispatches';
      var res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
        body: JSON.stringify({ ref: GH_BRANCH })
      });
      if (res.status === 204) {
        $('#dispatch-status').textContent = 'dispatched — check GitHub Actions in ~30s.';
        log('Dispatched refresh-master-file.yml', 'ok');
      } else {
        var txt = await res.text();
        $('#dispatch-status').textContent = 'failed ' + res.status;
        log('Dispatch failed: ' + res.status + ' ' + txt, 'error');
      }
    } catch (e) {
      $('#dispatch-status').textContent = 'error ' + (e.message || e);
      log('Dispatch error: ' + e.message, 'error');
    }
  }

  // ------------------------- linkage gap panel -------------------------
  // Repair-priority ladder (Doc 2 req #29). Uses OLD-Zotero diagnostic
  // counts as the driver of "expected volume" — old counts are NEVER
  // treated as authoritative, only as a heuristic for prioritising Master
  // repair work. Once the Master ⇄ Publication ⇄ Authorship linkages are
  // repaired, the canonical Master totals rise naturally (Doc 3 #9).
  function computeRepairPriority (canonicalTotal, oldTotal, reason) {
    // No old-Zotero footprint ⇒ we have no diagnostic signal; treat as LOW
    // and let alphabetical/roster ordering decide within the LOW bucket.
    if (oldTotal == null || oldTotal === 0) return 'LOW';
    // Delta between old-Zotero volume and current canonical volume drives
    // priority. A large old footprint that dropped to zero is the highest
    // repair value: e.g. Ravulo ITK-S0379 with old 68 / current 0.
    var delta = oldTotal - (canonicalTotal || 0);
    if (reason === 'no-authorship-rows') {
      if (oldTotal >= 30) return 'VERY HIGH';
      if (oldTotal >= 10) return 'HIGH';
      if (oldTotal >= 3)  return 'MEDIUM';
      return 'LOW';
    }
    // sparse-authorship: has 1 row but old count suggests more missing
    if (delta >= 30) return 'VERY HIGH';
    if (delta >= 10) return 'HIGH';
    if (delta >= 3)  return 'MEDIUM';
    return 'LOW';
  }

  function gapRows () {
    var rows = [];
    // Pre-index Authorship rows per scholar so gap-row counting is O(N+M)
    // instead of O(N*M). Rebuilt once per call because Ron may reload the
    // Master bundle after refresh.
    var authRowsBySid = {};
    if (state.bundle && state.bundle.master && state.bundle.master.authorship) {
      state.bundle.master.authorship.forEach(function (a) {
        var asid = a['Scholar ID'];
        if (asid) authRowsBySid[asid] = (authRowsBySid[asid] || 0) + 1;
      });
    }
    state.scholars.forEach(function (s) {
      var sid = s['Scholar ID']; if (!sid) return;
      var st = classifyLinkage(sid);
      if (st !== 'no-authorship-rows' && st !== 'sparse-authorship') return;
      var c = state.counts[sid] || { total: 0, firstAuthored: 0 };
      var old = state.oldZoteroBySid[sid] || null;
      var oldTotal = old ? old.total : null;
      var oldFirst = old ? old.firstAuthored : null;
      var authRows = authRowsBySid[sid] || 0;
      var delta = (oldTotal == null) ? null : oldTotal - (c.total || 0);
      rows.push({
        scholarId:      sid,
        name:           s['Scholar Name'] || ((s['Family Name'] || '') + ', ' + (s['Given Names'] || '')),
        total:          c.total,
        firstAuthored:  c.firstAuthored,
        oldTotal:       oldTotal,
        oldFirst:       oldFirst,
        authorshipRows: authRows,
        delta:          delta,
        // Human-readable linkage status per Doc 2 #29.
        linkageStatus:  st === 'no-authorship-rows' ? 'INCOMPLETE'
                       : st === 'sparse-authorship'  ? 'SPARSE'
                       : 'OK',
        reason:         st,
        priority:       computeRepairPriority(c.total, oldTotal, st),
        aliveDeceased:  s['Alive / Deceased'] || s['Alive/Deceased'] || '',
        discipline:     s['Discipline'] || s['Primary Discipline / Field'] || '',
        confederacy:    s['Paternal Confederacy'] || s['Confederacy'] || '',
        rosterTier:     s['Roster Tier'] || s['Roster Tier / Priority'] || ''
      });
    });
    return rows;
  }

  function renderGaps () {
    var rows = gapRows();

    if (state.gapFilterReason) rows = rows.filter(function (r) { return r.reason === state.gapFilterReason; });
    if (state.gapFilterStatus) rows = rows.filter(function (r) {
      var s = (r.aliveDeceased || '').toLowerCase();
      if (state.gapFilterStatus === 'Alive')    return s.indexOf('alive')    !== -1 || (s !== '' && s.indexOf('deceased') === -1);
      if (state.gapFilterStatus === 'Deceased') return s.indexOf('deceased') !== -1;
      return true;
    });
    if (state.gapChipOldOnly) rows = rows.filter(function (r) { return r.oldTotal && r.oldTotal > 0; });

    // Sort — default is by oldTotal DESC so scholars with the biggest old
    // dashboard footprint float to the top of the repair queue. Priority is
    // sorted by ordinal (VERY HIGH < HIGH < MEDIUM < LOW).
    var priRankTable = { 'VERY HIGH': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    var key = state.gapSortKey, dir = state.gapSortDir;
    rows.sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (key === 'priority') { va = priRankTable[va]; vb = priRankTable[vb]; }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // nulls always last
      if (vb == null) return -1;
      if (va < vb) return dir === 'asc' ? -1 :  1;
      if (va > vb) return dir === 'asc' ?  1 : -1;
      return 0;
    });

    $('#gap-chip-old-count').textContent = gapRows().filter(function (r) { return r.oldTotal && r.oldTotal > 0; }).length;

    var tbody = $('#gaps-tbody');
    tbody.innerHTML = rows.map(function (r) {
      var reasonBadge = r.reason === 'no-authorship-rows'
        ? '<span class="badge badge-gap">0 rows</span>'
        : '<span class="badge badge-incomplete">1 row</span>';
      var oldCol = r.oldTotal
        ? '<strong>' + esc(r.oldTotal) + '</strong>' + (r.oldFirst != null ? ' <span class="old-count">(' + esc(r.oldFirst) + ' 1st)</span>' : '')
        : '<span class="cross">—</span>';
      var priCls = 'pri-' + r.priority.toLowerCase().replace(/\s+/g, '-');
      var priBadge = '<span class="badge ' + priCls + '">' + esc(r.priority) + '</span>';
      return '<tr data-sid="' + esc(r.scholarId) + '">' +
        '<td class="sid">' + esc(r.scholarId) + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td class="pub-count">' + esc(r.total) + '</td>' +
        '<td class="pub-count">' + oldCol + '</td>' +
        '<td class="reason">' + reasonBadge + '</td>' +
        '<td>' + priBadge + '</td>' +
        '<td>' + esc(r.aliveDeceased || '—') + '</td>' +
        '<td>' + esc(r.discipline || '—') + '</td>' +
        '<td>' + esc(r.rosterTier || '—') + '</td>' +
        '</tr>';
    }).join('');

    $('#gap-row-count').textContent = rows.length + ' of ' + gapRows().length;

    $$('#gaps-tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openEditModal(tr.getAttribute('data-sid')); });
    });

    $$('.gap-table thead th.sortable').forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.getAttribute('data-gap-sort') === state.gapSortKey) {
        th.classList.add(state.gapSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function exportGapsCsv () {
    var rows = gapRows();
    // Sort by repair priority (VERY HIGH > HIGH > MEDIUM > LOW) then by
    // delta desc so the biggest expected-vs-actual gaps float to the top.
    // This matches Doc 2 req #27: "largest likely missing volume first".
    var priRank = { 'VERY HIGH': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    rows.sort(function (a, b) {
      var pa = priRank[a.priority] == null ? 9 : priRank[a.priority];
      var pb = priRank[b.priority] == null ? 9 : priRank[b.priority];
      if (pa !== pb) return pa - pb;
      var da = a.delta == null ? -1 : a.delta;
      var db = b.delta == null ? -1 : b.delta;
      if (da !== db) return db - da;
      var oa = a.oldTotal == null ? -1 : a.oldTotal;
      var ob = b.oldTotal == null ? -1 : b.oldTotal;
      return ob - oa;
    });
    // Column order per Doc 2 req #26: Scholar ID, name, old total, old 1st,
    // canonical total, canonical 1st, Authorship row count, delta,
    // linkage status, repair priority — plus context columns for filtering.
    var header = [
      'Scholar ID', 'Scholar Name',
      'Old-Zotero Total (diagnostic)', 'Old-Zotero First-Author (diagnostic)',
      'Current Canonical Total', 'Current Canonical First-Author',
      'Master Authorship Rows',
      'Delta (Old - Canonical)',
      'Linkage Status', 'Repair Priority',
      'Alive/Deceased', 'Discipline', 'Paternal Confederacy', 'Roster Tier'
    ];
    var lines = [header.join(',')];
    rows.forEach(function (r) {
      lines.push([
        csvCell(r.scholarId),
        csvCell(r.name),
        r.oldTotal == null ? '' : r.oldTotal,
        r.oldFirst == null ? '' : r.oldFirst,
        r.total,
        r.firstAuthored,
        r.authorshipRows,
        r.delta == null ? '' : r.delta,
        csvCell(r.linkageStatus),
        csvCell(r.priority),
        csvCell(r.aliveDeceased),
        csvCell(r.discipline),
        csvCell(r.confederacy),
        csvCell(r.rosterTier)
      ].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'master-authorship-linkage-gaps-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('Exported ' + rows.length + '-row linkage-gap CSV', 'ok');
  }
  function csvCell (v) {
    var s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ------------------------- event wiring -------------------------
  function wireControls () {
    // tabs
    function activateTab(tab) {
      $$('.tab-btn').forEach(function (x) { x.classList.remove('active'); });
      $$('.tab-panel').forEach(function (x) { x.classList.remove('active'); });
      var btn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
      if (btn) btn.classList.add('active');
      var panel = document.getElementById('tab-' + tab);
      if (panel) panel.classList.add('active');
    }
    $$('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        activateTab(b.getAttribute('data-tab'));
      });
    });
    $$('[data-jump-tab]').forEach(function (b) {
      b.addEventListener('click', function () { activateTab(b.getAttribute('data-jump-tab')); });
    });

    // Migration tab (Doc 2 #22-#25) — client-side V1 → Scholar-ID insights.
    var migRunBtn = $('#migration-run-btn');
    var migWriteBtn = $('#migration-write-btn');
    var migReportBtn = $('#migration-download-report-btn');
    var migSummary = $('#migration-summary');
    var migDetails = $('#migration-details');
    var migState = { lastResult: null };
    function renderMigrationSummary(result) {
      var c = result.counts;
      migSummary.innerHTML =
        '<strong>V1 total:</strong> ' + c.v1Total + ' · ' +
        '<strong>MATCHED:</strong> ' + c.matched + ' · ' +
        '<strong>AMBIGUOUS:</strong> ' + c.ambiguous + ' · ' +
        '<strong>UNMATCHED:</strong> ' + c.unmatched + ' · ' +
        '<strong>INVALID:</strong> ' + c.invalid +
        (c.duplicateCollisions ? ' · <strong>Duplicate SIDs:</strong> ' + c.duplicateCollisions : '') +
        '<br><span class="muted">Existing V2 insights (kept): ' + c.v2ExistingBefore +
        '. V2 total after this migration: ' + c.v2TotalAfter + '.</span>';
      function sample(list) {
        return list.slice(0, 8).map(function (x) {
          return '<li><span class="mono">' + escapeHtml(x.v1Key || '') + '</span>' +
            (x.sid ? ' → <span class="mono">' + escapeHtml(x.sid) + '</span>' : '') +
            ' <span class="muted">(' + escapeHtml(x.reason || '') + ')</span></li>';
        }).join('') + (list.length > 8 ? '<li class="muted">… and ' + (list.length - 8) + ' more (see full JSON report)</li>' : '');
      }
      migDetails.innerHTML =
        '<details open><summary><strong>AMBIGUOUS (' + result.ambiguous.length + ')</strong> — need your review</summary><ul>' + sample(result.ambiguous) + '</ul></details>' +
        '<details><summary><strong>UNMATCHED (' + result.unmatched.length + ')</strong> — no Master row found</summary><ul>' + sample(result.unmatched) + '</ul></details>' +
        '<details><summary><strong>INVALID (' + result.invalid.length + ')</strong> — missing keywords/summary</summary><ul>' + sample(result.invalid) + '</ul></details>' +
        '<details><summary><strong>MATCHED (' + result.matched.length + ')</strong> — first 8 shown</summary><ul>' + sample(result.matched) + '</ul></details>';
    }
    if (migRunBtn) migRunBtn.addEventListener('click', async function () {
      migRunBtn.disabled = true;
      migSummary.textContent = 'Running migration — this stays entirely in your browser…';
      migDetails.innerHTML = '';
      try {
        if (!window.adminInsightsMigration) throw new Error('Migration module not loaded.');
        window.adminInsightsMigration.install({
          getMaster: function () { return state.master; },
          getGhPushHelper: function () { return githubUploadBinary; },
          logChange: function (evt) { if (Array.isArray(state.actionLog)) state.actionLog.push(Object.assign({ ts: new Date().toISOString() }, evt)); }
        });
        var result = await window.adminInsightsMigration.runMigration();
        migState.lastResult = result;
        renderMigrationSummary(result);
        migWriteBtn.disabled = (result.counts.matched === 0);
        migReportBtn.disabled = false;
        toast('Dry run complete. Review, then click Write to publish.', 'ok');
      } catch (e) {
        migSummary.textContent = 'Migration failed: ' + e.message;
        toast('Migration failed: ' + e.message, 'error');
      } finally {
        migRunBtn.disabled = false;
      }
    });
    if (migWriteBtn) migWriteBtn.addEventListener('click', async function () {
      if (!migState.lastResult) return;
      if (!confirm('Publish ' + migState.lastResult.counts.v2TotalAfter + ' Scholar-ID-keyed insights to data/scholar-insights-master.json.enc?')) return;
      migWriteBtn.disabled = true;
      try {
        await window.adminInsightsMigration.publishV2(migState.lastResult.v2Doc);
        toast('Published data/scholar-insights-master.json.enc.', 'ok');
      } catch (e) {
        toast('Publish failed: ' + e.message, 'error');
        migWriteBtn.disabled = false;
      }
    });
    if (migReportBtn) migReportBtn.addEventListener('click', function () {
      if (!migState.lastResult) return;
      var text = window.adminInsightsMigration.serializeReport(migState.lastResult);
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'insights-migration-report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });

    // scholar filters
    $('#search-scholars').addEventListener('input', function (e) {
      state.filterQuery = e.target.value; renderScholars();
    });
    $('#filter-confederacy').addEventListener('change', function (e) {
      state.filterConfederacy = e.target.value; renderScholars();
    });
    $$('[data-chip]').forEach(function (ch) {
      ch.addEventListener('click', function () {
        var name = ch.getAttribute('data-chip');
        state.filterChips[name] = !state.filterChips[name];
        ch.classList.toggle('active', !!state.filterChips[name]);
        renderScholars();
      });
    });

    // scholar sort
    $$('table.scholars thead th.sortable').forEach(function (th) {
      if (th.hasAttribute('data-gap-sort')) return; // gap table handled below
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = key; state.sortDir = (key === 'total' || key === 'firstAuthored') ? 'desc' : 'asc'; }
        renderScholars();
      });
    });

    // gap filters
    $('#gap-filter-reason').addEventListener('change', function (e) {
      state.gapFilterReason = e.target.value; renderGaps();
    });
    $('#gap-filter-status').addEventListener('change', function (e) {
      state.gapFilterStatus = e.target.value; renderGaps();
    });
    $$('[data-gap-chip]').forEach(function (ch) {
      ch.addEventListener('click', function () {
        state.gapChipOldOnly = !state.gapChipOldOnly;
        ch.classList.toggle('active', state.gapChipOldOnly);
        renderGaps();
      });
    });
    $$('.gap-table thead th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-gap-sort');
        if (state.gapSortKey === key) state.gapSortDir = state.gapSortDir === 'asc' ? 'desc' : 'asc';
        else { state.gapSortKey = key; state.gapSortDir = (key === 'oldTotal' || key === 'total') ? 'desc' : 'asc'; }
        renderGaps();
      });
    });
    $('#export-gaps-csv').addEventListener('click', exportGapsCsv);

    // Master write-back endpoint (Phase 2, approval-doc #1). Endpoint URL +
    // shared secret are held only in this browser's localStorage.
    var wbEndpointInput = $('#writeback-endpoint');
    var wbSecretInput   = $('#writeback-secret');
    var wbStatus        = $('#writeback-status');
    var wbDetail        = $('#writeback-detail');
    function refreshWritebackStatus(pingResult) {
      if (!window.adminWriteback) return;
      var configured = window.adminWriteback.isConfigured();
      if (!configured) {
        wbStatus.textContent = 'unconfigured';
        wbStatus.style.background = 'var(--cream)'; wbStatus.style.color = 'var(--muted)';
        wbDetail.textContent = 'Paste the Web app URL + shared secret above, then click Test connection.';
        return;
      }
      if (pingResult && pingResult.status === 'ok') {
        wbStatus.textContent = 'connected';
        wbStatus.style.background = '#e0f2e9'; wbStatus.style.color = '#0f5a3c';
        wbDetail.textContent = 'ping ok · WRITE_ENABLED=' + pingResult.writeEnabled + ' · actor=' + (pingResult.actor || '(unknown)') + ' · tz=' + (pingResult.tz || '(unknown)');
      } else if (pingResult) {
        wbStatus.textContent = pingResult.status || 'error';
        wbStatus.style.background = '#fde8e8'; wbStatus.style.color = '#7a1414';
        wbDetail.textContent = 'Test failed: ' + (pingResult.error || pingResult.reason || JSON.stringify(pingResult));
      } else {
        wbStatus.textContent = 'unchecked';
        wbStatus.style.background = 'var(--cream)'; wbStatus.style.color = 'var(--muted)';
        wbDetail.textContent = 'Endpoint saved. Click Test connection to verify.';
      }
    }
    // Prefill from localStorage on load (secret is shown as a placeholder-only mask).
    if (window.adminWriteback) {
      wbEndpointInput.value = window.adminWriteback.getEndpoint();
      if (window.adminWriteback.getSecret()) wbSecretInput.placeholder = '••• secret already saved in this browser — leave blank to keep';
      refreshWritebackStatus(null);
    }
    $('#writeback-save').addEventListener('click', function () {
      var url = (wbEndpointInput.value || '').trim();
      var sec = (wbSecretInput.value   || '').trim();
      if (!url) { toast('Paste the endpoint URL first.', 'error'); return; }
      if (!/^https:\/\/script\.google\.com\//.test(url)) { toast('Endpoint must be an https://script.google.com URL.', 'error'); return; }
      window.adminWriteback.setEndpoint(url);
      if (sec) { window.adminWriteback.setSecret(sec); wbSecretInput.value = ''; wbSecretInput.placeholder = '••• secret already saved in this browser — leave blank to keep'; }
      toast('Endpoint saved locally.', 'ok');
      refreshWritebackStatus(null);
    });
    $('#writeback-test').addEventListener('click', async function () {
      try {
        var r = await window.adminWriteback.ping();
        refreshWritebackStatus(r);
        toast(r.status === 'ok' ? 'Endpoint reachable.' : ('Endpoint test: ' + r.status), r.status === 'ok' ? 'ok' : 'error');
      } catch (e) {
        refreshWritebackStatus({ status: 'error', error: e.message });
        toast('Endpoint test failed: ' + e.message, 'error');
      }
    });
    $('#writeback-clear').addEventListener('click', function () {
      window.adminWriteback.clear();
      wbEndpointInput.value = '';
      wbSecretInput.value = '';
      wbSecretInput.placeholder = 'paste the 64-char hex string from generateSecret()';
      refreshWritebackStatus(null);
      toast('Endpoint cleared.', 'ok');
    });

    // token
    $('#save-gh-token').addEventListener('click', function () {
      var tok = $('#gh-token').value.trim();
      if (!tok) { toast('Paste a token first.', 'error'); return; }
      try {
        localStorage.setItem(GH_TOKEN_KEY, tok);
        $('#gh-token').value = '';
        refreshGhTokenStatus();
        toast('Token saved locally.', 'ok');
      } catch (e) { toast('Could not save token: ' + e.message, 'error'); }
    });
    $('#clear-gh-token').addEventListener('click', function () {
      try { localStorage.removeItem(GH_TOKEN_KEY); } catch (e) {}
      refreshGhTokenStatus();
      toast('Token forgotten.', 'ok');
    });

    // dispatch
    $('#dispatch-refresh').addEventListener('click', dispatchRefresh);
    $('#refresh-master').addEventListener('click', dispatchRefresh);

    // modal
    $('#modal-close').addEventListener('click', closeEditModal);
    $('#modal-cancel').addEventListener('click', closeEditModal);
    $('#modal-save').addEventListener('click', saveEditModal);
    $('#edit-modal').addEventListener('click', function (e) {
      if (e.target && e.target.id === 'edit-modal') closeEditModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('#edit-modal').classList.contains('is-visible')) closeEditModal();
    });

    // photo widget
    var drop = $('#pf-photo-drop');
    var fileInput = $('#pf-photo-file');
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handlePhotoFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handlePhotoFile(e.target.files[0]);
    });
    $('#pf-photo-clear').addEventListener('click', function () {
      $('#pf-photo').value = '';
      state.photoDataUrl = null; state.photoDirty = true;
      setPhotoPreview(null);
      $('#pf-photo-hint').textContent = 'Path cleared — save to remove reference from enrichment.';
    });

    // insights preview
    $('#pf-insights-json').addEventListener('input', updateInsightsPreview);
  }
})();
