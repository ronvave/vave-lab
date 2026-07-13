/**
 * upsertRoster — sync admin-tagged iTaukei scholars into the Scholars sheet
 *
 * ONE-TIME SETUP:
 *   1. Leave your existing `const ADMIN_KEY = '...'` alone — whatever key
 *      you already set in the live script is the one this handler will
 *      check against. Admin.html prompts for it once per browser and
 *      caches it in localStorage; the key never lives in the repo.
 *
 *   2. In your doPost(e) switch statement, add ONE new case above the
 *      `default:` line:
 *
 *        case 'upsertRoster':     return handleUpsertRoster_(ss, payload);
 *
 *   3. Paste the handleUpsertRoster_ function below into the script
 *      (anywhere, but the WRITE HANDLERS section is a good home).
 *
 *   4. Save (Cmd+S). Then Deploy → Manage deployments → your active web
 *      app deployment → pencil icon → Version: "New version" → Deploy.
 *      This is required — Apps Script web apps only serve the *deployed*
 *      version, not the editor version. Without this step admin.html
 *      will get "Unknown type: upsertRoster".
 *
 * WHAT IT DOES:
 *   - Accepts POST body: { type: 'upsertRoster', key: '<ADMIN_KEY>',
 *                          scholars: [ {lastName, firstName}, ... ] }
 *   - Rejects the call if key doesn't match ADMIN_KEY (returns 401-style error)
 *   - Reads the Scholars sheet
 *   - For each incoming scholar, checks whether last||first already exists
 *     (case-insensitive, whitespace-trimmed)
 *   - Appends only the ones missing, assigning the next available ID
 *   - Marks each new row with the tag "admin-synced" in column D and a
 *     light-yellow background so they're easy to spot in the sheet
 *   - Returns { status:'ok', added: N, skipped: M, addedNames: [...] }
 *
 * SAFE TO RE-RUN: the dedup check means clicking sync 10 times in a row
 * only ever adds each name once. Existing rows are never modified.
 */


function handleUpsertRoster_(ss, payload) {
  // Auth check
  var providedKey = String(payload.key || '');
  if (providedKey !== ADMIN_KEY) {
    return jsonOut_({ status: 'error', message: 'Unauthorized: bad or missing key' });
  }

  var incoming = Array.isArray(payload.scholars) ? payload.scholars : [];
  if (!incoming.length) {
    return jsonOut_({ status: 'ok', added: 0, skipped: 0, addedNames: [], message: 'Empty scholar list' });
  }

  var sc = ss.getSheetByName('Scholars');
  if (!sc) return jsonOut_({ status: 'error', message: 'Scholars sheet not found' });

  var lastRow = sc.getLastRow();
  var maxId = 0;
  var existingKeys = {};
  if (lastRow >= 2) {
    var vals = sc.getRange(2, 1, lastRow - 1, 3).getValues();
    vals.forEach(function (r) {
      var id = Number(r[0]) || 0;
      if (id > maxId) maxId = id;
      var k = (String(r[1] || '').trim().toLowerCase()) + '||' +
              (String(r[2] || '').trim().toLowerCase());
      if (k !== '||') existingKeys[k] = true;
    });
  }

  var toAppend = [];
  var addedNames = [];
  var skipped = 0;
  var seenThisBatch = {}; // guard against dupes within the same POST

  incoming.forEach(function (s) {
    var last = String((s && s.lastName) || '').trim();
    var first = String((s && s.firstName) || '').trim();
    if (!last && !first) { skipped++; return; }
    var key = last.toLowerCase() + '||' + first.toLowerCase();
    if (existingKeys[key] || seenThisBatch[key]) { skipped++; return; }
    seenThisBatch[key] = true;
    maxId += 1;
    toAppend.push([maxId, last, first, 'admin-synced']);
    addedNames.push(last + ', ' + first);
  });

  if (toAppend.length) {
    // Append at the bottom, then apply the light-yellow highlight so newly
    // synced rows are visually distinct until Ron reviews them.
    var startRow = sc.getLastRow() + 1;
    sc.getRange(startRow, 1, toAppend.length, 4).setValues(toAppend);
    sc.getRange(startRow, 1, toAppend.length, 4).setBackground('#FFF9DB');
  }

  return jsonOut_({
    status: 'ok',
    added: toAppend.length,
    skipped: skipped,
    addedNames: addedNames
  });
}
