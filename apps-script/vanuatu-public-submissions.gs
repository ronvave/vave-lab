// ===================== PUBLIC PROFILE SUBMISSIONS (Vanuatu) =====================
// Used by the shared scholar profile page (s-vanuatu.html?scholar=VAN-Sxxxx):
//   submitScholarProfileUpdate  -> one Pending row in 'Scholar Profile Submissions'
//   submitPublicationGeography  -> one Pending row per publication in
//                                  'Publication Geography Submissions'
// No secret is needed, and nothing reaches the public dashboard: rows wait in the
// private Master review queues for the owner (Vanuatu Admin > review queues).
// Guards: honeypot + minimum time on page, blocklist, per-email and global daily
// limits, scholar must exist, publications must be linked to that scholar.
// Turn off at any time with Script property VANUATU_PUBLIC_SUBMISSIONS_ENABLED = false.
var VAN_PUB_TZ = 'Pacific/Efate';
var VAN_PUB_EMAIL_DAILY_LIMIT = 10;
var VAN_PUB_GLOBAL_DAILY_LIMIT = 200;

function vanPublicEnabled_() {
  return PropertiesService.getScriptProperties().getProperty('VANUATU_PUBLIC_SUBMISSIONS_ENABLED') !== 'false';
}
function vanPublicCapabilities_() {
  return { status: 'ok', country: 'Vanuatu', publicSubmissionsEnabled: vanPublicEnabled_(), version: 'vanuatu-public-1.0' };
}
function vanPubLiteral_(v) { v = v == null ? '' : String(v); return /^[=+@-]/.test(v) ? "'" + v : v; }
function vanPubNow_() { return Utilities.formatDate(new Date(), VAN_PUB_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function vanPubText_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }

function vanPublicSubmit_(body) {
  if (!vanPublicEnabled_()) return { status: 'disabled', reason: 'Vanuatu submissions are not open yet.' };
  // Bots fill the hidden "website" field or post instantly; accept silently, store nothing.
  if (String(body.website || '').trim() || Number(body.elapsedMs || 0) < 3000) return { status: 'ok', queued: 1 };
  var sid = String(body.scholarId || '').toUpperCase();
  if (!/^VAN-S\d{4,}$/.test(sid)) return { status: 'bad_request', reason: 'Unknown scholar.' };
  var name = vanPubText_(body.submitterName, 160), email = String(body.submitterEmail || '').trim().toLowerCase(), rel = vanPubText_(body.submitterRelationship, 100);
  if (!name || !rel || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 240) return { status: 'bad_request', reason: 'Your name, a valid email and your relationship to the scholar are required.' };
  var ss = vanBook_();
  if (vanNewsBlocked_(ss, email)) return { status: 'forbidden', reason: 'Submissions from this email are blocked.' };
  var scholars = vanData_('Scholars'), match = scholars.records.filter(function (r) { return r.value['Scholar ID'] === sid; });
  if (match.length !== 1) return { status: 'bad_request', reason: 'Unknown scholar.' };
  var cache = CacheService.getScriptCache(), day = Utilities.formatDate(new Date(), VAN_PUB_TZ, 'yyyyMMdd');
  var ek = 'vpub-e-' + day + '-' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email)).slice(0, 22), gk = 'vpub-g-' + day;
  var en = Number(cache.get(ek) || 0), gn = Number(cache.get(gk) || 0);
  if (en >= VAN_PUB_EMAIL_DAILY_LIMIT || gn >= VAN_PUB_GLOBAL_DAILY_LIMIT) return { status: 'rate_limited', reason: 'Thank you. We have received many submissions today; please try again tomorrow.' };
  var who = { sid: sid, scholar: match[0].value, name: name, email: email, rel: rel, scholarName: vanPubText_(body.scholarName || match[0].value['Scholar Name'], 240), profileUrl: vanPubText_(body.profileUrl, 700) };
  var result = body.action === 'submitScholarProfileUpdate' ? vanPublicProfile_(ss, body, who) : vanPublicGeography_(body, who);
  if (result.status === 'ok') { cache.put(ek, String(en + 1), 21600); cache.put(gk, String(gn + 1), 21600); }
  return result;
}

// Append rows by header name (row 4), so column order in the Master never matters.
function vanPublicAppend_(table, objects) {
  var d = vanData_(table), lock = LockService.getScriptLock();
  var rows = objects.map(function (o) { return d.headers.map(function (h) { return vanPubLiteral_(h && Object.prototype.hasOwnProperty.call(o, h) ? o[h] : ''); }); });
  lock.waitLock(30000);
  try { var sh = d.sheet; sh.getRange(Math.max(sh.getLastRow(), 4) + 1, 1, rows.length, d.headers.length).setValues(rows); }
  finally { lock.releaseLock(); }
}

function vanPublicProfile_(ss, body, who) {
  var fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};
  var changed = {}, ignored = [];
  Object.keys(fields).forEach(function (field) {
    var proposed = vanPubText_(fields[field], 500);
    if (VAN_REVIEW_FIELDS_.indexOf(field) < 0) { ignored.push(field); return; }
    var current = String(who.scholar[field] || '');
    if (proposed !== current.trim()) changed[field] = { current: current, proposed: proposed };
  });
  var structured = body.structuredSubmission && typeof body.structuredSubmission === 'object' ? body.structuredSubmission : {};
  structured = { notes: vanPubText_(structured.notes, 4000), degreeSummary: vanPubText_(structured.degreeSummary, 2000), degrees: Array.isArray(structured.degrees) ? structured.degrees.slice(0, 12) : [], ignoredFields: ignored };
  var structuredJson = JSON.stringify(structured);
  if (structuredJson.length > 45000) return { status: 'bad_request', reason: 'Submission is too large.' };
  var files = Array.isArray(body.files) ? body.files.filter(function (f) { return f && f.data; }) : [];
  if (!Object.keys(changed).length && !files.length && !structured.notes) return { status: 'bad_request', reason: 'No changes were found.' };
  var now = new Date(), id = 'SPS-' + Utilities.formatDate(now, VAN_PUB_TZ, 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 8), attachments;
  try { attachments = vanPublicFiles_(ss, who.sid, files); } catch (err) { return { status: 'bad_request', reason: String(err.message || err) }; }
  vanPublicAppend_('Scholar Profile Submissions', [{
    'Submission ID': id, 'Submitted At': vanPubNow_(), 'Status': 'Pending', 'Scholar ID': who.sid, 'Scholar Name': who.scholarName,
    'Submitter Name': who.name, 'Submitter Email': who.email, 'Relationship': who.rel, 'Profile URL': who.profileUrl,
    'Changed Fields JSON': JSON.stringify(changed), 'Structured Submission JSON': structuredJson, 'Attachments JSON': JSON.stringify(attachments),
    'Provenance Source': 'Public scholar profile link', 'Country Project': 'Vanuatu'
  }]);
  return { status: 'ok', submissionId: id, queued: 1, attachments: attachments.length };
}

function vanPublicFiles_(ss, sid, files) {
  if (!files.length) return [];
  if (files.length > 6) throw new Error('Too many attachments (maximum 6).');
  var props = PropertiesService.getScriptProperties(), folder = null, saved = props.getProperty('VANUATU_SUBMISSION_FOLDER_ID');
  if (saved) { try { folder = DriveApp.getFolderById(saved); } catch (_) { folder = null; } }
  if (!folder) {
    var parent; try { var ps = DriveApp.getFileById(ss.getId()).getParents(); parent = ps.hasNext() ? ps.next() : DriveApp.getRootFolder(); } catch (_) { parent = DriveApp.getRootFolder(); }
    var found = parent.getFoldersByName('Vanuatu Scholar Submissions (private)');
    folder = found.hasNext() ? found.next() : parent.createFolder('Vanuatu Scholar Submissions (private)');
    props.setProperty('VANUATU_SUBMISSION_FOLDER_ID', folder.getId());
  }
  var total = 0;
  return files.map(function (f) {
    var bytes = Utilities.base64Decode(String(f.data)); total += bytes.length;
    if (bytes.length > 12 * 1024 * 1024 || total > 30 * 1024 * 1024) throw new Error('Attachments exceed the size limit.');
    var original = String(f.name || 'attachment').replace(/[\\\/:*?"<>|]+/g, '-').slice(0, 180);
    var name = original.indexOf(sid + '-') === 0 ? original : sid + '-' + original;
    var file = folder.createFile(Utilities.newBlob(bytes, String(f.type || 'application/octet-stream'), name));
    return { field: String(f.field || 'attachment').slice(0, 80), name: name, url: file.getUrl(), size: bytes.length, type: file.getMimeType(), fileId: file.getId() };
  });
}

function vanPublicList_(v) {
  return (Array.isArray(v) ? v : []).map(function (x) { return vanPubText_(x, 120); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 30);
}
function vanPublicGeography_(body, who) {
  if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > 100) return { status: 'bad_request', reason: 'Provide 1–100 publication changes.' };
  var linked = {};
  vanData_('Authorship').records.forEach(function (r) { if (r.value['Scholar ID'] === who.sid) linked[r.value['Publication ID']] = true; });
  var titles = {};
  vanData_('Publications').records.forEach(function (r) { if (linked[r.value['Publication ID']]) titles[r.value['Publication ID']] = r.value['Title'] || ''; });
  var rows = [], now = vanPubNow_();
  for (var i = 0; i < body.changes.length; i++) {
    var c = body.changes[i] || {}, key = vanPubText_(c.item_key, 300);
    if (!key || !linked[key]) return { status: 'bad_request', reason: 'A publication is not linked to this scholar.' };
    var locs = (Array.isArray(c.vanuatu_locations) ? c.vanuatu_locations : []).slice(0, 30).map(function (l) {
      l = l || {}; var p = VAN_PROVINCES_.indexOf(String(l.province || '')) >= 0 ? String(l.province) : '';
      return { national: l.national === true && !p, province: p, island: p ? vanPubText_(l.island, 80) : '' };
    }).filter(function (l) { return l.national || l.province; });
    var pac = vanPublicList_(c.pacific_countries).filter(function (x) { return x !== 'Vanuatu'; });
    var other = vanPublicList_(c.other_countries).filter(function (x) { return x !== 'Vanuatu' && pac.indexOf(x) < 0; });
    if (!locs.length && !pac.length && !other.length) return { status: 'bad_request', reason: 'Choose at least one research location.' };
    var provinces = [], islands = [], types = [];
    locs.forEach(function (l) {
      if (l.national && types.indexOf('National') < 0) types.push('National');
      if (l.province && provinces.indexOf(l.province) < 0) provinces.push(l.province);
      if (l.island && islands.indexOf(l.island) < 0) islands.push(l.island);
    });
    if (provinces.length) types.push(islands.length ? 'Province / Island' : 'Province');
    if (pac.length) types.push('Pacific Island country');
    if (other.length) types.push('Other country');
    rows.push({
      'Submission ID': 'PGS-' + Utilities.getUuid(), 'Submitted At': now, 'Status': 'Pending', 'Publication ID': key,
      'Publication Title': vanPubText_(titles[key] || c.title, 700), 'Submitter Name': who.name, 'Submitter Email': who.email,
      'Geography Type': types.join('; '), 'Country': locs.length ? 'Vanuatu' : (pac.concat(other)[0] || ''),
      'Province': provinces.join('; '), 'Island': islands.join('; '),
      'Evidence': 'Suggested through the shared scholar profile by ' + who.name + ' (' + who.rel + ')' + (who.profileUrl ? ': ' + who.profileUrl : ''),
      'Country Project': 'Vanuatu', 'Scholar ID': who.sid, 'Proposed Locations JSON': JSON.stringify(locs),
      'Proposed Pacific Countries': pac.join('; '), 'Proposed Other Countries': other.join('; ')
    });
  }
  vanPublicAppend_('Publication Geography Submissions', rows);
  return { status: 'ok', queued: rows.length };
}
