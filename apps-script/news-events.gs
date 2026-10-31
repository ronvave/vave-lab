// ===================== SHARE AN EVENT (shared by Tonga, Fiji, Solomon) =====================
// Event submissions from the dashboard "Share a story" form (type = Event).
// The form sends body.event (the event details), and optionally body.flyer and
// body.qrImage ({name, mimeType, data base64}).
//
//   * Event details are checked here, then stored as JSON in the queue's
//     "Event Details" column.
//   * Flyer and QR image files are saved privately in a "<Country> Event
//     Flyers" Drive folder (next to the Master). Nobody else can open them
//     until a reviewer approves the event; approving makes only that file
//     viewable by link so the dashboard can show it.
//   * On approval the News tab row gets "Event Details" (JSON, contact removed
//     unless the submitter ticked consent), "Event Status", "Recording URL"
//     and "Flyer URL". Missing columns are added at the end of row 4.
//   * Ron can later change "Event Status" (Postponed or Cancelled) or add a
//     "Recording URL" straight in the News tab.
var VL_EVENT_VERSION = 'events-1.0';
var VL_EVENT_QUEUE_EXTRA = ['Event Details', 'Flyer File ID', 'QR Image File ID'];
var VL_EVENT_NEWS_EXTRA = ['Event Details', 'Event Status', 'Recording URL', 'Flyer URL'];
var VL_EVENT_TYPES = ['Webinar', 'Seminar', 'Workshop', 'Conference', 'Defense', 'Launch', 'Community', 'Exhibition', 'Ceremony', 'Other'];
var VL_EVENT_ROLES = ['Speaker', 'Presenter', 'Panelist', 'Keynote', 'Candidate', 'Organiser', 'Honouree', 'Other'];
var VL_EVENT_FORMATS = ['In person', 'Online', 'Hybrid'];
var VL_EVENT_ACCESS = ['Open to all', 'Registration required', 'Invite only'];
var VL_EVENT_STATUS = ['', 'Postponed', 'Cancelled'];
var VL_EVENT_FLYER_MAX = 5 * 1024 * 1024;
var VL_EVENT_QR_MAX = 2 * 1024 * 1024;

// Queue headers: the original 13 columns, then the three event columns.
// An existing queue with only the original headers is extended in place.
function vlEvHeadersOk_(cur, want) {
  var blankFrom = -1;
  for (var i = 0; i < want.length; i++) {
    var c = String(cur[i] || '');
    if (!c) { if (blankFrom < 0) blankFrom = i; continue; }
    if (blankFrom >= 0 || c !== want[i]) return false;
  }
  return true;
}

function vlEvStr_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max || 200); }
function vlEvUrl_(v) {
  var s = vlEvStr_(v, 700);
  return s && /^https?:\/\/[^\s\/$.?#][^\s]*$/i.test(s) ? s : '';
}
function vlEvDate_(v) { var s = vlEvStr_(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function vlEvTime_(v) { var s = vlEvStr_(v, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : ''; }
function vlEvPick_(v, list, dflt) { var s = vlEvStr_(v, 60); return list.indexOf(s) >= 0 ? s : dflt; }
function vlEvZone_(v) {
  var s = vlEvStr_(v, 60);
  if (!/^[A-Za-z_]+(\/[A-Za-z_\-+0-9]+){0,2}$/.test(s)) return '';
  try { Utilities.formatDate(new Date(), s, 'HH'); return s; } catch (_) { return ''; }
}

// Returns {ev: cleaned event} or {err: plain-language problem}.
function vlEvClean_(raw) {
  if (!raw || typeof raw !== 'object') return { err: 'The event details are missing.' };
  var ev = {
    etype: vlEvPick_(raw.etype, VL_EVENT_TYPES, ''),
    title: vlEvStr_(raw.title, 200),
    desc: vlEvStr_(raw.desc, 300),
    role: vlEvPick_(raw.role, VL_EVENT_ROLES, 'Speaker'),
    start: vlEvDate_(raw.start),
    stime: vlEvTime_(raw.stime),
    end: vlEvDate_(raw.end),
    etime: vlEvTime_(raw.etime),
    allDay: raw.allDay === true,
    tz: vlEvZone_(raw.tz),
    series: vlEvStr_(raw.series, 200),
    format: vlEvPick_(raw.format, VL_EVENT_FORMATS, 'In person'),
    access: vlEvPick_(raw.access, VL_EVENT_ACCESS, 'Open to all'),
    cost: vlEvPick_(raw.cost, ['Free', 'Paid'], 'Free'),
    lang: vlEvStr_(raw.lang, 120),
    a11y: vlEvStr_(raw.a11y, 200),
    hosts: vlEvStr_(raw.hosts, 300),
    sponsors: vlEvStr_(raw.sponsors, 300),
    involved: vlEvPick_(raw.involved, ['Organiser', 'Speaker', 'Seen'], 'Seen')
  };
  if (!ev.title) return { err: 'Please add the event title.' };
  if (!ev.etype) return { err: 'Please choose the event type.' };
  if (!ev.start) return { err: 'Please add the start date.' };
  if (!ev.tz) return { err: 'Please choose the time zone of the event.' };
  if (!ev.allDay && !ev.stime) return { err: 'Please add the start time, or tick All day.' };
  if (ev.allDay) { ev.stime = ''; ev.etime = ''; }
  if (ev.end && ev.end < ev.start) return { err: 'The end date is before the start date.' };
  if (ev.end === ev.start) ev.end = '';
  if (ev.format !== 'Online') {
    ev.venue = vlEvStr_(raw.venue, 200); ev.room = vlEvStr_(raw.room, 120);
    ev.city = vlEvStr_(raw.city, 120); ev.country = vlEvStr_(raw.country, 120);
    if (!ev.venue) return { err: 'Please add the venue.' };
  }
  if (ev.format !== 'In person') {
    ev.platform = vlEvStr_(raw.platform, 60);
    ev.join = vlEvUrl_(raw.join);
    ev.mid = vlEvStr_(raw.mid, 80); ev.pass = vlEvStr_(raw.pass, 80);
    ev.live = vlEvUrl_(raw.live);
    ev.rec = raw.rec === true;
    if (!ev.join) return { err: 'Please add the full join link, starting with https://' };
  }
  if (ev.access === 'Registration required') {
    ev.reg = vlEvUrl_(raw.reg); ev.regBy = vlEvDate_(raw.regBy);
    if (!ev.reg) return { err: 'Please add the full registration link, starting with https://' };
  }
  var c = raw.contact && typeof raw.contact === 'object' ? raw.contact : {};
  ev.contact = { name: vlEvStr_(c.name, 160), role: vlEvStr_(c.role, 200), email: vlEvStr_(c.email, 240), phone: vlEvStr_(c.phone, 60), show: c.show === true };
  if (ev.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ev.contact.email)) return { err: 'Please check the contact email.' };
  var x = raw.extra && typeof raw.extra === 'object' ? raw.extra : {}, ex = {};
  var KEYS = { talk: 300, candidate: 160, degree: 40, thesis: 300, uni: 160, chair: 160, 'public': 10, site: 0, abstract: -1,
    'for': 200, cap: 8, work: 300, publisher: 160, protocol: 300, hours: 200, honour: 300 };
  Object.keys(KEYS).forEach(function (k) {
    var n = KEYS[k], v = n === 0 ? vlEvUrl_(x[k]) : n === -1 ? vlEvDate_(x[k]) : vlEvStr_(x[k], n);
    if (k === 'cap' && v && !/^\d{1,6}$/.test(v)) v = '';
    if (v) ex[k] = v;
  });
  ev.extra = ex;
  return { ev: ev };
}

// One line for the queue's "Event Time" / "Event Location" text, as written
// in the event's own time zone.
function vlEvWhenText_(ev) {
  if (!ev) return '';
  var d = ev.start + (ev.end ? ' to ' + ev.end : '');
  if (ev.allDay) return d + ' (all day, ' + ev.tz + ')';
  return ev.start + ', ' + ev.stime + (ev.etime ? '\u2013' + ev.etime : '') + (ev.end ? ' (ends ' + ev.end + ')' : '') + ' ' + ev.tz;
}
function vlEvWhereText_(ev) {
  if (!ev) return '';
  var p = [];
  if (ev.format !== 'Online') p.push([ev.venue, ev.room, ev.city, ev.country].filter(Boolean).join(', '));
  if (ev.format !== 'In person') p.push((ev.format === 'Hybrid' ? 'and online via ' : 'Online via ') + (ev.platform || 'video link'));
  return p.join(' ');
}

// ------------------------------------------------------------ files
function vlEvFolder_(ss, label) {
  var props = PropertiesService.getScriptProperties(), key = 'VL_EVENT_FLYER_FOLDER_ID';
  var saved = props.getProperty(key);
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (_) {} }
  var parent;
  try { var ps = DriveApp.getFileById(ss.getId()).getParents(); parent = ps.hasNext() ? ps.next() : DriveApp.getRootFolder(); }
  catch (_) { parent = DriveApp.getRootFolder(); }
  var name = label + ' Event Flyers', m = parent.getFoldersByName(name);
  var folder = m.hasNext() ? m.next() : parent.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}
// Checks type and size from the file bytes, not just the stated type.
function vlEvBlob_(f, allowPdf, maxBytes, label) {
  if (!f) return { blob: null };
  if (typeof f !== 'object' || !f.data) return { err: 'The ' + label + ' could not be read.' };
  var bytes;
  try { bytes = Utilities.base64Decode(String(f.data)); } catch (_) { return { err: 'The ' + label + ' could not be read.' }; }
  if (!bytes.length) return { blob: null };
  if (bytes.length > maxBytes) return { err: 'The ' + label + ' is larger than ' + Math.round(maxBytes / 1048576) + ' MB.' };
  var b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255, b3 = bytes[3] & 255, mime = '', ext = '';
  if (b0 === 0xFF && b1 === 0xD8) { mime = 'image/jpeg'; ext = 'jpg'; }
  else if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) { mime = 'image/png'; ext = 'png'; }
  else if (allowPdf && b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) { mime = 'application/pdf'; ext = 'pdf'; }
  if (!mime) return { err: 'The ' + label + ' must be a ' + (allowPdf ? 'JPG, PNG or PDF' : 'JPG or PNG') + ' file.' };
  return { blob: Utilities.newBlob(bytes, mime), ext: ext };
}
// Saves the flyer and QR image privately. Returns {flyerId, qrId} or {err}.
function vlEvSaveFiles_(ss, label, id, body) {
  var fl = vlEvBlob_(body.flyer, true, VL_EVENT_FLYER_MAX, 'flyer');
  if (fl.err) return { err: fl.err };
  var qr = vlEvBlob_(body.qrImage, false, VL_EVENT_QR_MAX, 'QR code image');
  if (qr.err) return { err: qr.err };
  var out = { flyerId: '', qrId: '' };
  if (!fl.blob && !qr.blob) return out;
  var folder = vlEvFolder_(ss, label);
  if (fl.blob) out.flyerId = folder.createFile(fl.blob.setName(id + '-flyer.' + fl.ext)).getId();
  if (qr.blob) out.qrId = folder.createFile(qr.blob.setName(id + '-qr.' + qr.ext)).getId();
  return out;
}
// Reviewer preview of a private flyer (small image as a data URL).
function vlEvPreview_(fileId) {
  if (!fileId) return '';
  try {
    var f = DriveApp.getFileById(fileId), b = f.getBlob(), mime = b.getContentType();
    if (/^image\//.test(mime) && f.getSize() <= 1500000) return 'data:' + mime + ';base64,' + Utilities.base64Encode(b.getBytes());
    var t = f.getThumbnail();
    return t ? 'data:' + t.getContentType() + ';base64,' + Utilities.base64Encode(t.getBytes()) : '';
  } catch (_) { return ''; }
}
// Makes one approved file viewable by link; returns its view address.
function vlEvPublish_(fileId) {
  if (!fileId) return '';
  var f = DriveApp.getFileById(fileId);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/file/d/' + fileId + '/view';
}
function vlEvThumb_(fileId) { return fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600' : ''; }

// Adds any missing event columns to the end of the News tab header row.
function vlEvEnsureNewsCols_(ns, headerRow) {
  var h = ns.getRange(headerRow, 1, 1, ns.getLastColumn()).getDisplayValues()[0];
  while (h.length && !h[h.length - 1]) h.pop();
  var miss = VL_EVENT_NEWS_EXTRA.filter(function (x) { return h.indexOf(x) < 0; });
  if (!miss.length) return h;
  if (ns.getMaxColumns() < h.length + miss.length) ns.insertColumnsAfter(ns.getMaxColumns(), h.length + miss.length - ns.getMaxColumns());
  ns.getRange(headerRow, h.length + 1, 1, miss.length).setValues([miss]);
  return h.concat(miss);
}

// The public copy of an approved event: no private contact, no "how are you involved".
function vlEvPublic_(ev, qrImg) {
  var o = JSON.parse(JSON.stringify(ev));
  delete o.involved;
  if (!o.contact || !o.contact.show || !o.contact.name) delete o.contact;
  else delete o.contact.show;
  if (qrImg) o.qrImg = qrImg;
  return o;
}

// Read helper: parses the queue JSON and adds a private flyer preview for pending rows.
function vlEvDecorateRow_(o) {
  var raw = o['Event Details'];
  if (!raw) return o;
  try { o.event = JSON.parse(raw); } catch (_) { o.event = null; }
  if (o.Status === 'Pending' && o['Flyer File ID']) o.flyerPreview = vlEvPreview_(o['Flyer File ID']);
  if (o.Status === 'Pending' && o['QR Image File ID']) o.qrPreview = vlEvPreview_(o['QR Image File ID']);
  return o;
}

// Approval helper. Returns {err} or {vals} (extra News tab values) and publishes files.
// f = reviewer's story fields; o = queue row.
function vlEvApprove_(f, o) {
  var ev = null;
  try { ev = o['Event Details'] ? JSON.parse(o['Event Details']) : null; } catch (_) { ev = null; }
  if (!ev) return { vals: {} };
  var re = vlEvClean_(ev);
  if (re.err) return { err: 'Event details: ' + re.err };
  ev = re.ev;
  if (f.headline) ev.title = vlEvStr_(f.headline, 200);
  var status = vlEvPick_(f.eventStatus, VL_EVENT_STATUS, '');
  var rec = vlEvStr_(f.recordingUrl, 700) ? vlEvUrl_(f.recordingUrl) : '';
  if (vlEvStr_(f.recordingUrl, 700) && !rec) return { err: 'The recording link is not a valid web address.' };
  var flyer = o['Flyer File ID'] && f.useFlyer !== false ? vlEvPublish_(o['Flyer File ID']) : '';
  var qr = o['QR Image File ID'] && f.useQr !== false ? (vlEvPublish_(o['QR Image File ID']), vlEvThumb_(o['QR Image File ID'])) : '';
  return { vals: { 'Event Details': JSON.stringify(vlEvPublic_(ev, qr)), 'Event Status': status, 'Recording URL': rec, 'Flyer URL': flyer }, ev: ev };
}
