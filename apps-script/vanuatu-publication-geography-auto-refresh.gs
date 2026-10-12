/** Vanuatu geography approval refresh. Replace the old refresh file; do not
 * install a second copy. Existing trigger handler names are preserved.
 * Uses GITHUB_ACTIONS_TOKEN in Script Properties; never put its value here.
 */
var GEO_REFRESH_WORKFLOW_OWNER = 'ronvave';
var GEO_REFRESH_WORKFLOW_REPO = 'vave-lab';
var GEO_REFRESH_WORKFLOW_FILE = 'refresh-vanuatu-master-file.yml';
var GEO_REFRESH_WORKFLOW_REF = 'main';
var GEO_REFRESH_MARKER_PROPERTY = 'VANUATU_LAST_GEO_APPROVAL_REFRESH_MS';
var GEO_REFRESH_TOKEN_PROPERTY = 'GITHUB_ACTIONS_TOKEN';
var GEO_REFRESH_TRIGGER_HANDLER = 'publicationGeographyAutoRefreshTick';
var GEO_REFRESH_VANUATU_SHEET = '1jfS6Yqyy559kLdoeKW4F4t8RhyBooXpCiwOMukxpPW0';

function setupPublicationGeographyAutoRefresh() {
  // Check the source and token before changing any existing trigger.
  var newest = newestApprovedGeographyReviewTimestamp_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(GEO_REFRESH_TOKEN_PROPERTY)) throw Error('GITHUB_ACTIONS_TOKEN Script Property is missing.');
  removePublicationGeographyAutoRefresh();
  ScriptApp.newTrigger(GEO_REFRESH_TRIGGER_HANDLER).timeBased().everyMinutes(1).create();
  if (!props.getProperty(GEO_REFRESH_MARKER_PROPERTY)) props.setProperty(GEO_REFRESH_MARKER_PROPERTY, String(newest));
  Logger.log('Vanuatu geography watcher installed. Historical approvals are not replayed automatically.');
}
function removePublicationGeographyAutoRefresh() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === GEO_REFRESH_TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}
function publicationGeographyAutoRefreshTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var newest = newestApprovedGeographyReviewTimestamp_();
    var props = PropertiesService.getScriptProperties();
    if (!newest || newest <= Number(props.getProperty(GEO_REFRESH_MARKER_PROPERTY) || 0)) return;
    var result = dispatchMasterRefreshFromServer_();
    if (!result.ok) throw Error(result.message);
    props.setProperty(GEO_REFRESH_MARKER_PROPERTY, String(newest));
    console.log('Vanuatu refresh dispatch accepted; check GitHub Actions for completion.');
  } finally { lock.releaseLock(); }
}
function forcePublicationGeographyMasterRefresh() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var newest = newestApprovedGeographyReviewTimestamp_();
    var result = dispatchMasterRefreshFromServer_();
    if (!result.ok) throw Error(result.message);
    PropertiesService.getScriptProperties().setProperty(GEO_REFRESH_MARKER_PROPERTY, String(newest));
    Logger.log('Vanuatu refresh dispatch accepted; check GitHub Actions for completion.');
  } finally { lock.releaseLock(); }
}
function inspectPublicationGeographyAutoRefresh() {
  var props = PropertiesService.getScriptProperties();
  var newest = newestApprovedGeographyReviewTimestamp_();
  var marker = Number(props.getProperty(GEO_REFRESH_MARKER_PROPERTY) || 0);
  Logger.log(JSON.stringify({ spreadsheetId: GEO_REFRESH_VANUATU_SHEET,
    workflow: GEO_REFRESH_WORKFLOW_FILE, tokenPresent: !!props.getProperty(GEO_REFRESH_TOKEN_PROPERTY),
    watcherTriggers: ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === GEO_REFRESH_TRIGGER_HANDLER; }).length,
    lastDispatchedApprovalKey: marker, newestApprovedReviewKey: newest, refreshPending: newest > marker }, null, 2));
}
function vanGeographyReviewTime_(value, timezone) {
  if (value instanceof Date) return isNaN(value.getTime()) ? 0 : value.getTime();
  var s = String(value || '').trim();
  if (!s) return 0;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    var ms = Date.parse(s); if (isFinite(ms)) return ms;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    var parsed = Utilities.parseDate(s, timezone, 'yyyy-MM-dd HH:mm:ss');
    if (!isNaN(parsed.getTime())) return parsed.getTime();
  }
  throw Error('Unrecognized Approved Reviewed At value. Correct the timestamp before refresh.');
}
function newestApprovedGeographyReviewTimestamp_() {
  if (typeof SPREADSHEET_ID_HINT !== 'undefined' && SPREADSHEET_ID_HINT !== GEO_REFRESH_VANUATU_SHEET) throw Error('Vanuatu spreadsheet configuration mismatch.');
  var ss = SpreadsheetApp.openById(GEO_REFRESH_VANUATU_SHEET);
  var sh = ss.getSheetByName('Publication Geography Submissions');
  if (!sh) throw Error('Missing Publication Geography Submissions worksheet.');
  var width = sh.getLastColumn();
  var headers = sh.getRange(4, 1, 1, width).getDisplayValues()[0].map(function(v) { return String(v).trim(); });
  var status = headers.indexOf('Status'), reviewed = headers.indexOf('Reviewed At');
  if (status < 0 || reviewed < 0 || headers.lastIndexOf('Status') !== status || headers.lastIndexOf('Reviewed At') !== reviewed) throw Error('Status / Reviewed At headers are missing or duplicated.');
  if (sh.getLastRow() < 5) return 0;
  var newest = 0, timezone = ss.getSpreadsheetTimeZone();
  sh.getRange(5, 1, sh.getLastRow() - 4, width).getValues().forEach(function(r) {
    if (String(r[status] || '').trim() !== 'Approved') return;
    newest = Math.max(newest, vanGeographyReviewTime_(r[reviewed], timezone));
  });
  return newest;
}
function dispatchMasterRefreshFromServer_() {
  var token = PropertiesService.getScriptProperties().getProperty(GEO_REFRESH_TOKEN_PROPERTY);
  if (!token) return {ok:false, message:'GITHUB_ACTIONS_TOKEN Script Property is missing.'};
  var url = 'https://api.github.com/repos/' + GEO_REFRESH_WORKFLOW_OWNER + '/' + GEO_REFRESH_WORKFLOW_REPO + '/actions/workflows/' + GEO_REFRESH_WORKFLOW_FILE + '/dispatches';
  try {
    var response = UrlFetchApp.fetch(url, {method:'post', muteHttpExceptions:true, contentType:'application/json',
      headers:{Authorization:'Bearer ' + token, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'},
      payload:JSON.stringify({ref:GEO_REFRESH_WORKFLOW_REF, inputs:{dry_run:'false'}})});
    var code = response.getResponseCode();
    return code === 204 ? {ok:true, code:code} : {ok:false, code:code, message:'Vanuatu refresh dispatch returned HTTP ' + code + '. Check token permissions and workflow availability.'};
  } catch (err) { return {ok:false, message:'Vanuatu refresh dispatch could not reach GitHub.'}; }
}
