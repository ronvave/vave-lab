// ========================= PANEL A3 NEWS (Vanuatu) ===========================
// Public "Share a story" links (action submitNewsStory, no secret; honeypot,
// daily limits, blocklist and duplicate-link checks) queue in the private
// "News Submissions" tab. The Admin page (owner credential) reads them
// (readVanuatuNews, previewVanuatuNewsLink) and approves or rejects
// (resolveVanuatuNews, needs VANUATU_WRITE_ENABLED = true). Approving appends
// one row to the Master "News" tab with Show on Dashboard = Yes and writes a
// Change Log entry. Event details, flyers and QR images use news-events.gs.
var VAN_NEWS_VERSION = 'vanuatu-news-1.0';
var VAN_NEWS_SHEET = 'News';
var VAN_NEWS_QUEUE_SHEET = 'News Submissions';
var VAN_NEWS_QUEUE_HEADERS = ['Submission ID','Submitted At','Status','Article URL','Announcement Type','Scholar(s) Named','Submitter Name','Submitter Email','Submitter Note','Reviewed By','Reviewed At','Decision Notes','News ID',
  'Event Details','Flyer File ID','QR Image File ID'];
var VAN_NEWS_TYPES = ['News','Defense','Thesis','Publication','Event'];
// New theses and publications may be about Vanuatu by an author outside the
// database (Scholar ID blank, author name given).
var VAN_NEWS_OPEN_TYPES = ['Thesis','Publication'];
var VAN_NEWS_TIMED_TYPES = ['Defense','Event'];
// 'News' = general news with no more specific category (listed last on purpose).
var VAN_NEWS_CATEGORIES = ['Award','Appointment','Graduation','Milestone','Publication','Research','News'];
var VAN_NEWS_EMAIL_DAILY_LIMIT = 5;
var VAN_NEWS_GLOBAL_DAILY_LIMIT = 40;
var VAN_NEWS_TZ = 'Pacific/Efate';

function vanNewsLiteral_(v) { return typeof v === 'string' && /^[=+@'-]/.test(v) ? "'" + v : v; }
function vanNewsType_(v) { var t = String(v || 'News'); if (t === 'Webinar') t = 'Event'; return VAN_NEWS_TYPES.indexOf(t) >= 0 ? t : 'News'; }
function vanNewsNow_() { return Utilities.formatDate(new Date(), VAN_NEWS_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function vanNewsEmail_(v) { return String(v || '').trim().toLowerCase(); }

function vanNewsQueue_(ss) {
  var sh = ss.getSheetByName(VAN_NEWS_QUEUE_SHEET);
  if (!sh) throw new Error('News Submissions worksheet missing');
  if (sh.getMaxColumns() < VAN_NEWS_QUEUE_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), VAN_NEWS_QUEUE_HEADERS.length - sh.getMaxColumns());
  var cur = sh.getRange(4, 1, 1, VAN_NEWS_QUEUE_HEADERS.length).getDisplayValues()[0];
  if (!vlEvHeadersOk_(cur, VAN_NEWS_QUEUE_HEADERS)) throw new Error('News Submissions headers differ');
  if (cur.join('|') !== VAN_NEWS_QUEUE_HEADERS.join('|')) sh.getRange(4, 1, 1, VAN_NEWS_QUEUE_HEADERS.length).setValues([VAN_NEWS_QUEUE_HEADERS]);
  return sh;
}
// Blocked submitters (Scholar Submission Blocklist tab, headers on row 4).
function vanNewsBlocked_(ss, email) {
  var sh = ss.getSheetByName('Scholar Submission Blocklist');
  if (!sh || sh.getLastRow() < 5) return false;
  var h = sh.getRange(4, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  var ec = h.indexOf('Email (private)'), stc = h.indexOf('Status');
  if (ec < 0) return false;
  return sh.getRange(5, 1, sh.getLastRow() - 4, sh.getLastColumn()).getDisplayValues().some(function (r) {
    return vanNewsEmail_(r[ec]) === email && !(stc >= 0 && /^(lifted|removed|inactive)$/i.test(String(r[stc]).trim()));
  });
}
/* Drop tracking codes (fbclid, utm_*, gclid ...) that social apps add to links. */
function vanNewsClean_(u) {
  var m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(u); if (!m || !m[2]) return u;
  var keep = m[2].slice(1).split('&').filter(function (kv) {
    var k = kv.split('=')[0].toLowerCase();
    return kv && !/^(fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|yclid|_ga|mibextid|utm_[a-z_]+)$/.test(k);
  });
  return m[1] + (keep.length ? '?' + keep.join('&') : '') + (m[3] || '');
}
function vanNewsUrl_(v) {
  var s = vanNewsClean_(String(v || '').trim());
  if (s.length > 700 || !/^https?:\/\/[^\s\/$.?#][^\s]*$/i.test(s)) return '';
  return s;
}
function vanNewsKey_(u) { return String(u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/+$/, ''); }
function vanNewsKnownUrls_(ss) {
  var keys = {};
  [VAN_NEWS_SHEET, VAN_NEWS_QUEUE_SHEET].forEach(function (name) {
    var sh = ss.getSheetByName(name); if (!sh || sh.getLastRow() < 5) return;
    var h = sh.getRange(4, 1, 1, sh.getLastColumn()).getDisplayValues()[0], c = h.indexOf('Article URL'); if (c < 0) return;
    var st = h.indexOf('Status');
    sh.getRange(5, 1, sh.getLastRow() - 4, sh.getLastColumn()).getDisplayValues().forEach(function (r) {
      if (r[c] && !(st >= 0 && r[st] === 'Rejected')) keys[vanNewsKey_(r[c])] = true;
    });
  });
  return keys;
}
/* Public: returns a plain object ({status:'ok'|'bad_request'|...}) for the dashboard form. */
function vanNewsSubmit_(body) {
  // Bots fill the hidden "website" field or post instantly; accept silently, store nothing.
  if (String(body.website || '').trim() || Number(body.elapsedMs || 0) < 3000) return { status: 'ok', queued: 1 };
  var url = vanNewsUrl_(body.articleUrl), type = vanNewsType_(body.type);
  var name = String(body.submitterName || '').trim(), email = vanNewsEmail_(body.submitterEmail);
  var evr = type === 'Event' && body.event ? vlEvClean_(body.event) : null;
  if (evr && evr.err) return { status: 'bad_request', reason: evr.err };
  if (!url && (String(body.articleUrl || '').trim() || !evr)) return { status: 'bad_request', reason: 'A full web link starting with https:// is required.' };
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: 'bad_request', reason: 'Your name and a valid email are required.' };
  var ss = vanBook_();
  if (vanNewsBlocked_(ss, email)) return { status: 'forbidden', reason: 'Submissions from this email are blocked.' };
  var cache = CacheService.getScriptCache(), day = Utilities.formatDate(new Date(), VAN_NEWS_TZ, 'yyyyMMdd');
  var ek = 'vnews-e-' + day + '-' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email)).slice(0, 22), gk = 'vnews-g-' + day;
  var en = Number(cache.get(ek) || 0), gn = Number(cache.get(gk) || 0);
  if (en >= VAN_NEWS_EMAIL_DAILY_LIMIT || gn >= VAN_NEWS_GLOBAL_DAILY_LIMIT) return { status: 'rate_limited', reason: 'Thank you. We have received many links today; please try again tomorrow.' };
  if (url && vanNewsKnownUrls_(ss)[vanNewsKey_(url)]) return { status: 'ok', queued: 0, duplicate: true };
  var now = new Date(), id = 'VNWS-' + Utilities.formatDate(now, VAN_NEWS_TZ, 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 6);
  var files = evr ? vlEvSaveFiles_(ss, 'Vanuatu', id, body) : { flyerId: '', qrId: '' };
  if (files.err) return { status: 'bad_request', reason: files.err };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = vanNewsQueue_(ss);
    var row = [id, Utilities.formatDate(now, VAN_NEWS_TZ, 'yyyy-MM-dd HH:mm:ss'), 'Pending', url, type,
      String(body.scholars || '').trim().slice(0, 300), name.slice(0, 160), email.slice(0, 240), String(body.note || '').trim().slice(0, 800),
      '', '', '', '', evr ? JSON.stringify(evr.ev) : '', files.flyerId, files.qrId];
    sh.getRange(Math.max(sh.getLastRow(), 4) + 1, 1, 1, row.length).setValues([row.map(vanNewsLiteral_)]);
    cache.put(ek, String(en + 1), 21600); cache.put(gk, String(gn + 1), 21600);
    return { status: 'ok', queued: 1, submissionId: id };
  } finally { lock.releaseLock(); }
}
function vanNewsRows_(ss) {
  var sh = vanNewsQueue_(ss), last = sh.getLastRow();
  if (last < 5) return [];
  return sh.getRange(5, 1, last - 4, VAN_NEWS_QUEUE_HEADERS.length).getDisplayValues().map(function (r, i) {
    var o = { _row: i + 5 }; VAN_NEWS_QUEUE_HEADERS.forEach(function (h, j) { o[h] = r[j] || ''; }); return o;
  }).filter(function (o) { return !!o['Submission ID']; });
}
// Public scholars only (Verified and Public Display Approved), as on the dashboard.
function vanNewsScholars_() {
  return vanData_('Scholars').records.map(function (x) { return x.value; }).filter(function (r) {
    return r['Identity Verification Status'] === 'Verified' && /^(yes|true|1)$/i.test(String(r['Public Display Approved'] || '').trim());
  }).map(function (r) { return { id: String(r['Scholar ID']).toUpperCase(), name: String(r['Scholar Name'] || '').replace(/\s+/g, ' ').trim() }; });
}
function vanNewsFold_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‘’ʻʼ']/g, '').toLowerCase(); }
function vanNewsMeta_(html, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var m = new RegExp('<meta[^>]+(?:property|name)=["\']' + k + '["\'][^>]*content=["\']([^"\']*)["\']', 'i').exec(html) ||
            new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + k + '["\']', 'i').exec(html);
    if (m && m[1]) return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
  }
  return '';
}
/* Publication date (YYYY-MM-DD) from a news page: meta tags and JSON-LD,
 * <time datetime>, a visible "Published 16 March 2026" line, or a /2026/03/16/ path. */
function vanNewsDate_(html, url) {
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function iso(t) { var m = /(\d{4})-(\d{2})-(\d{2})/.exec(t || ''); return m ? m[0] : ''; }
  function out(y, mo, d) { return (mo && d >= 1 && d <= 31) ? y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2) : ''; }
  function words(t) {
    var m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(t);
    if (m) return out(m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
    m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(t);
    return m ? out(m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]) : '';
  }
  var v = iso(vanNewsMeta_(html, ['article:published_time', 'datePublished', 'date', 'pubdate', 'publish-date', 'dc.date', 'parsely-pub-date']));
  if (v) return v;
  v = iso((/datePublished[\\"]*\s*:\s*[\\"]*([0-9T:.\-]+)/.exec(html) || [])[1]); if (v) return v;
  v = iso((/<time[^>]+datetime=["']([^"']+)["']/i.exec(html) || [])[1]); if (v) return v;
  var plain = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  var pm = /\b(?:Published|Posted)\b[:\s]*(?:on\s+)?(.{0,40})/i.exec(plain);
  if (pm) { v = words(pm[1]); if (v) return v; }
  var um = /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(url);
  return um ? um[1] + '-' + um[2] + '-' + um[3] : '';
}
function vanNewsNextId_(sh, idCol) {
  var max = 0, last = sh.getLastRow();
  if (last >= 5) sh.getRange(5, idCol + 1, last - 4, 1).getDisplayValues().forEach(function (r) { var m = /^VAN-NEWS(\d+)$/.exec(r[0]); if (m) max = Math.max(max, +m[1]); });
  return 'VAN-NEWS' + ('000' + (max + 1)).slice(-4);
}

// ---- Owner routes (called through doPost after owner authentication) ----
function readVanuatuNews(payload) {
  vanActor_(false);
  var want = String((payload && payload.status) || '').trim();
  var rows = vanNewsRows_(vanBook_()).filter(function (o) { return !want || o.Status === want; });
  rows.forEach(function (o) { delete o._row; vlEvDecorateRow_(o); });
  rows.reverse();
  return { status: 'ok', version: VAN_NEWS_VERSION, rows: rows, types: VAN_NEWS_TYPES, categories: VAN_NEWS_CATEGORIES, eventStatuses: VL_EVENT_STATUS };
}
/* Reviewer helper: reads the linked page's title, image, outlet and date and
 * suggests matching scholars. Suggestions only; the reviewer confirms each field. */
function previewVanuatuNewsLink(payload) {
  vanActor_(false);
  payload = payload || {};
  var url = vanNewsUrl_(payload.url); if (!url) return { status: 'bad_request', reason: 'invalid-url' };
  var out = { status: 'ok', url: url, headline: '', image: '', outlet: '', date: '', description: '', candidates: [] };
  var text = String(payload.scholars || '');
  try {
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaveLab news review)' } });
    if (r.getResponseCode() === 200) {
      var html = r.getContentText().slice(0, 600000);
      out.headline = vanNewsMeta_(html, ['og:title', 'twitter:title']) || ((/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || '').trim();
      out.image = vanNewsMeta_(html, ['og:image', 'twitter:image']);
      out.outlet = vanNewsMeta_(html, ['og:site_name']);
      out.description = vanNewsMeta_(html, ['og:description', 'description']).slice(0, 400);
      out.date = vanNewsDate_(html, url);
      text += ' ' + out.headline + ' ' + out.description + ' ' + html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').slice(0, 60000);
    } else out.fetchNote = 'The page returned HTTP ' + r.getResponseCode() + '; enter the details by hand.';
  } catch (e) { out.fetchNote = 'The page could not be read; enter the details by hand.'; }
  if (out.image && !/^https?:\/\//i.test(out.image)) out.image = url.replace(/^(https?:\/\/[^\/]+).*$/, '$1') + (out.image.charAt(0) === '/' ? '' : '/') + out.image;
  var hay = vanNewsFold_(text);
  vanNewsScholars_().forEach(function (s) {
    var parts = vanNewsFold_(s.name).replace(/^(dr|rev|prof|professor|mr|mrs|ms)\.?\s+/, '').split(/\s+/).filter(function (w) { return w.length > 2; });
    if (parts.length < 2) return;
    var family = parts[parts.length - 1], given = parts[0], gi = hay.indexOf(given), fi = hay.indexOf(family);
    if (hay.indexOf(given + ' ' + family) >= 0 || (gi >= 0 && fi > gi && fi - gi < 60)) out.candidates.push(s);
  });
  out.candidates = out.candidates.slice(0, 8);
  return out;
}
function resolveVanuatuNews(payload) {
  var actor = vanActor_(false); vanWriteEnabled_();
  payload = payload || {};
  var id = String(payload.submissionId || ''), decision = String(payload.decision || '');
  if (['approve', 'reject'].indexOf(decision) < 0) return { status: 'bad_request', reason: 'decision must be approve or reject' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = vanBook_(), qs = vanNewsQueue_(ss), o = vanNewsRows_(ss).filter(function (x) { return x['Submission ID'] === id; })[0];
    if (!o) return { status: 'bad_request', reason: 'Submission not found' };
    if (o.Status !== 'Pending') { delete o._row; return { status: 'already_resolved', row: o }; }
    var note = String(payload.reviewNotes || '').slice(0, 1500), when = vanNewsNow_(), newsId = '', audit = null;
    if (decision === 'approve') {
      var f = payload.story || {};
      var type = vanNewsType_(f.type), shown = String(f.displayName || '').trim().slice(0, 160);
      var sid = String(f.scholarId || '').trim().toUpperCase(), scholar = sid ? vanNewsScholars_().filter(function (s) { return s.id === sid; })[0] : null;
      if (sid && !scholar) return { status: 'bad_request', reason: 'Scholar ID ' + sid + ' is not a public scholar in the database.' };
      if (!scholar && !(VAN_NEWS_OPEN_TYPES.indexOf(type) >= 0 && shown)) return { status: 'bad_request', reason: VAN_NEWS_OPEN_TYPES.indexOf(type) >= 0 ? 'Choose a scholar, or enter the author name(s) for a thesis or publication about Vanuatu.' : 'Choose a scholar from the database.' };
      var cat = type === 'News' ? (VAN_NEWS_CATEGORIES.indexOf(String(f.category)) >= 0 ? String(f.category) : '') : '';
      var evo = type === 'Event' && o['Event Details'] ? vlEvApprove_(f, o) : null;
      if (evo && evo.err) return { status: 'bad_request', reason: evo.err };
      var evx = evo && evo.ev ? evo.ev : null;
      var head = String(f.headline || (evx ? evx.title : '')).trim().slice(0, 300), date = String(f.date || (evx ? evx.start : '')).trim();
      var rawUrl = String(f.articleUrl || o['Article URL'] || '').trim();
      var url = vanNewsUrl_(rawUrl), img = String(f.imageUrl || '').trim() ? vanNewsUrl_(f.imageUrl) : '';
      if (!head) return { status: 'bad_request', reason: 'Headline is required.' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 'bad_request', reason: 'Date must be YYYY-MM-DD.' };
      if (!url && (rawUrl || !evx)) return { status: 'bad_request', reason: 'Article link is not a valid web address.' };
      if (type === 'News' && !cat) return { status: 'bad_request', reason: 'Choose a category for a news story.' };
      if (String(f.imageUrl || '').trim() && !img) return { status: 'bad_request', reason: 'Image link is not a valid web address.' };
      var ns = ss.getSheetByName(VAN_NEWS_SHEET); if (!ns) throw Error('News worksheet missing');
      var h = ns.getRange(4, 1, 1, ns.getLastColumn()).getDisplayValues()[0];
      if (h.indexOf('News ID') < 0 || h.indexOf('Article URL') < 0 || h.indexOf('Announcement Type') < 0) throw Error('News headers missing');
      if (evx) h = vlEvEnsureNewsCols_(ns, 4);
      newsId = vanNewsNextId_(ns, h.indexOf('News ID'));
      var vals = { 'News ID': newsId, 'Scholar ID': sid, 'Scholar Display Name': shown || scholar.name,
        'Category': cat, 'Headline': head, 'Outlet': String(f.outlet || '').trim().slice(0, 160), 'Publication Date': date, 'Article URL': url,
        'Image URL': img, 'Image Credit': String(f.imageCredit || '').trim().slice(0, 200), 'Summary': String(f.summary || '').trim().slice(0, 600),
        'Also Covered By': String(f.also || '').trim().slice(0, 300), 'Show on Dashboard': 'Yes', 'Added By': actor.email, 'Added On': when.slice(0, 10),
        'Notes': ('From ' + id + ', sent by ' + o['Submitter Name'] + (o['Submitter Note'] ? ': ' + o['Submitter Note'] : '') + (note ? ' | Review: ' + note : '')).slice(0, 1500),
        'Announcement Type': type, 'Event Time': VAN_NEWS_TIMED_TYPES.indexOf(type) >= 0 ? String(f.eventTime || '').trim().slice(0, 120) : '', 'Event Location': VAN_NEWS_TIMED_TYPES.indexOf(type) >= 0 ? String(f.eventLocation || '').trim().slice(0, 200) : '' };
      if (evx) {
        Object.keys(evo.vals).forEach(function (k) { vals[k] = evo.vals[k]; });
        if (!vals['Event Time']) vals['Event Time'] = vlEvWhenText_(evx).slice(0, 120);
        if (!vals['Event Location']) vals['Event Location'] = vlEvWhereText_(evx).slice(0, 200);
      }
      var row = h.map(function (name) { return Object.prototype.hasOwnProperty.call(vals, name) ? vals[name] : ''; });
      ns.getRange(Math.max(ns.getLastRow(), 4) + 1, 1, 1, row.length).setValues([row.map(vanNewsLiteral_)]);
      audit = vanAudit_(actor, 'News', sid || '(not in database)', 'News ID', '', newsId + ' · ' + type + ' · ' + head, 'Approved Share a story submission ' + id);
    } else {
      audit = vanAudit_(actor, 'News Submissions', id, 'Status', 'Pending', 'Rejected', 'Rejected Share a story submission');
    }
    var status = decision === 'approve' ? 'Approved' : 'Rejected';
    qs.getRange(o._row, VAN_NEWS_QUEUE_HEADERS.indexOf('Status') + 1).setValue(status);
    qs.getRange(o._row, VAN_NEWS_QUEUE_HEADERS.indexOf('Reviewed By') + 1, 1, 4).setValues([[actor.email, when, note, newsId].map(vanNewsLiteral_)]);
    Sheets.Spreadsheets.batchUpdate({ requests: [audit] }, VAN_SHEET_);
    o.Status = status; o['Reviewed By'] = actor.email; o['Reviewed At'] = when; o['Decision Notes'] = note; o['News ID'] = newsId; delete o._row;
    var result = { status: 'ok', row: o, newsId: newsId };
  } finally { lock.releaseLock(); }
  // An approved story only reaches Panel A3 through the next Vanuatu snapshot, so queue
  // one now. The row is already saved; a failed dispatch is reported, never rolled back.
  if (decision === 'approve') result.refresh = vanNewsQueueRefresh_();
  return result;
}
function vanNewsQueueRefresh_() {
  if (typeof dispatchMasterRefreshFromServer_ !== 'function') return { ok: false, message: 'Vanuatu refresh helper is missing; run the refresh manually.' };
  var r = dispatchMasterRefreshFromServer_();
  return r && r.ok ? { ok: true, message: 'Vanuatu snapshot refresh queued.' } : { ok: false, message: (r && r.message) || 'Vanuatu refresh could not be queued; run the refresh manually.' };
}
