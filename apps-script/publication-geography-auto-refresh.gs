/**
 * publication-geography-auto-refresh.gs
 *
 * Server-side safety net for Publication Geography Submissions.
 *
 * Why this exists:
 * Admin V2 approvals write verified rows into the Master file immediately, but
 * the public dashboard reads generated/encrypted snapshots in GitHub. The old
 * client-side refresh depended on a GitHub token being present in the browser.
 * This file moves that dependency to the bound Apps Script project instead.
 *
 * One-time setup in the bound Apps Script project:
 *   1) Project Settings -> Script Properties:
 *        GITHUB_ACTIONS_TOKEN = <fine-grained token with Actions: Read/Write
 *                                access to ronvave/vave-lab>
 *   2) Add this file to the same Apps Script project as master-writeback.gs.
 *   3) Run setupPublicationGeographyAutoRefresh() once from the editor and
 *      authorize it. It installs a one-minute time trigger.
 *
 * The trigger is cheap: it does NOT dispatch GitHub every minute. It scans the
 * Publication Geography Submissions sheet for the newest Approved review time
 * and dispatches refresh-master-file.yml only when it sees an approval newer
 * than the last successful dispatch marker stored in Script Properties.
 */

var GEO_REFRESH_WORKFLOW_OWNER = 'ronvave';
var GEO_REFRESH_WORKFLOW_REPO = 'vave-lab';
var GEO_REFRESH_WORKFLOW_FILE = 'refresh-master-file.yml';
var GEO_REFRESH_WORKFLOW_REF = 'main';
var GEO_REFRESH_MARKER_PROPERTY = 'LAST_GEO_APPROVAL_REFRESH_TS';
var GEO_REFRESH_TOKEN_PROPERTY = 'GITHUB_ACTIONS_TOKEN';
var GEO_REFRESH_TRIGGER_HANDLER = 'publicationGeographyAutoRefreshTick';

/** Install exactly one 1-minute trigger for the geography refresh watcher. */
function setupPublicationGeographyAutoRefresh() {
  removePublicationGeographyAutoRefresh();
  ScriptApp.newTrigger(GEO_REFRESH_TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(1)
    .create();

  // Seed the marker to the newest already-approved review time so installing
  // the trigger does not replay every historical approval. Use the explicit
  // force helper below if an immediate rebuild is desired after installation.
  var newest = newestApprovedGeographyReviewTimestamp_();
  if (newest) {
    PropertiesService.getScriptProperties()
      .setProperty(GEO_REFRESH_MARKER_PROPERTY, String(newest));
  }
  Logger.log('Publication-geography auto refresh installed.');
}

/** Remove any existing watcher triggers. Safe to run repeatedly. */
function removePublicationGeographyAutoRefresh() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === GEO_REFRESH_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

/**
 * Runs every minute. Dispatches the Master refresh workflow only after one or
 * more newly-approved geography submissions have appeared since the previous
 * successful dispatch.
 */
function publicationGeographyAutoRefreshTick() {
  var newest = newestApprovedGeographyReviewTimestamp_();
  if (!newest) return;

  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty(GEO_REFRESH_MARKER_PROPERTY) || 0);
  if (newest <= last) return;

  var result = dispatchMasterRefreshFromServer_('publication-geography-approval');
  if (!result.ok) {
    console.error('Master refresh dispatch failed: ' + result.message);
    return; // do not advance marker; next minute retries
  }

  props.setProperty(GEO_REFRESH_MARKER_PROPERTY, String(newest));
  console.log('Master refresh dispatched after geography approval(s).');
}

/** Manual diagnostic/repair helper: dispatch immediately, regardless of marker. */
function forcePublicationGeographyMasterRefresh() {
  var result = dispatchMasterRefreshFromServer_('manual-geography-refresh');
  if (!result.ok) throw new Error(result.message);
  var newest = newestApprovedGeographyReviewTimestamp_();
  if (newest) {
    PropertiesService.getScriptProperties()
      .setProperty(GEO_REFRESH_MARKER_PROPERTY, String(newest));
  }
  Logger.log('Master refresh workflow dispatched successfully.');
}

/** Read-only diagnostic. */
function inspectPublicationGeographyAutoRefresh() {
  var props = PropertiesService.getScriptProperties();
  var hasToken = !!props.getProperty(GEO_REFRESH_TOKEN_PROPERTY);
  var marker = Number(props.getProperty(GEO_REFRESH_MARKER_PROPERTY) || 0);
  var newest = newestApprovedGeographyReviewTimestamp_();
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === GEO_REFRESH_TRIGGER_HANDLER;
  }).length;
  Logger.log(JSON.stringify({
    tokenPresent: hasToken,
    watcherTriggers: triggers,
    lastDispatchedApprovalMs: marker,
    newestApprovedReviewMs: newest,
    refreshPending: newest > marker
  }, null, 2));
}

/** Return newest Approved row's Reviewed At as epoch ms, or 0. */
function newestApprovedGeographyReviewTimestamp_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID_HINT);
  var sh = ss.getSheetByName('Publication Geography Submissions');
  if (!sh || sh.getLastRow() < 5) return 0;

  var lastRow = sh.getLastRow();
  // C = Status, S = Reviewed At (19th column)
  var vals = sh.getRange(5, 3, lastRow - 4, 17).getDisplayValues();
  var newest = 0;
  vals.forEach(function (r) {
    if (String(r[0] || '').trim() !== 'Approved') return;
    var reviewedAt = String(r[16] || '').trim();
    if (!reviewedAt) return;
    // Stored as yyyy-MM-dd HH:mm:ss in Pacific/Honolulu. Convert explicitly so
    // comparisons are stable regardless of project locale.
    var m = reviewedAt.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return;
    // Utilities.formatDate wrote local HST. Convert to an ordering-safe numeric
    // key rather than relying on Date parsing/time-zone assumptions.
    var key = Number(m[1] + m[2] + m[3] + m[4] + m[5] + m[6]);
    if (key > newest) newest = key;
  });
  return newest;
}

/** Server-side GitHub Actions workflow dispatch. Token never reaches browser. */
function dispatchMasterRefreshFromServer_(reason) {
  var token = PropertiesService.getScriptProperties()
    .getProperty(GEO_REFRESH_TOKEN_PROPERTY);
  if (!token) {
    return {
      ok: false,
      message: GEO_REFRESH_TOKEN_PROPERTY + ' Script Property is missing.'
    };
  }

  var url = 'https://api.github.com/repos/' +
    GEO_REFRESH_WORKFLOW_OWNER + '/' + GEO_REFRESH_WORKFLOW_REPO +
    '/actions/workflows/' + GEO_REFRESH_WORKFLOW_FILE + '/dispatches';

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      payload: JSON.stringify({
        ref: GEO_REFRESH_WORKFLOW_REF,
        inputs: { trigger_reason: String(reason || 'geography-approval') }
      })
    });
  } catch (err) {
    return { ok: false, message: String(err && err.message || err) };
  }

  var code = response.getResponseCode();
  if (code === 204) return { ok: true, code: code };

  var body = response.getContentText();
  return {
    ok: false,
    code: code,
    message: 'GitHub workflow dispatch returned HTTP ' + code + ': ' + body
  };
}
