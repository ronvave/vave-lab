/* Shared Event support for the "Share a story" forms and the event cards
 * on the Regional A2 and country A3 news panels.
 *
 *   VLEvent.formHtml()        event fields, shown when "What is it?" = Event
 *   VLEvent.wire(form)        show/hide rules, flyer preview, time zone default
 *   VLEvent.validate(form)    '' or a plain-language problem
 *   VLEvent.collect(form)     Promise -> { event, flyer, qrImage }
 *   VLEvent.feature(it, h)    featured event card body (h = page helpers)
 *   VLEvent.wireFeature(el, it)  card buttons: calendar, join details, QR, flyer
 *   VLEvent.tags(it)          ['Upcoming'|'Past', event type] for the dropdown
 *   VLEvent.listMeta(it)      short list line, e.g. "Thu 12 Nov · 9:00 am · Online"
 *
 * Times are entered in the event's own time zone and shown to each viewer in
 * their local time, with the original time zone underneath.
 * Defaults (Ron, 2026-10-31): meeting ID and passcode stay hidden until the
 * viewer clicks "Show join details"; the contact person is shown only when the
 * submitter ticks the consent box; flyers are kept in the Owner's Drive.
 */
(function () {
  'use strict';

  var TYPES = [
    ['Webinar', 'Webinar or online talk'],
    ['Seminar', 'Seminar, lecture or panel'],
    ['Workshop', 'Workshop or training'],
    ['Conference', 'Conference or symposium'],
    ['Defense', 'Thesis defense or oral exam'],
    ['Launch', 'Book or report launch'],
    ['Community', 'Talanoa, fono or community meeting'],
    ['Exhibition', 'Exhibition or performance'],
    ['Ceremony', 'Ceremony (award, graduation, installation)'],
    ['Other', 'Other event']
  ];
  var SHORT = { Webinar: 'Webinar', Seminar: 'Seminar', Workshop: 'Workshop', Conference: 'Conference', Defense: 'Thesis defense',
    Launch: 'Launch', Community: 'Community meeting', Exhibition: 'Exhibition', Ceremony: 'Ceremony', Other: 'Event' };
  var PLURAL = { Webinar: 'Webinars', Seminar: 'Seminars', Workshop: 'Workshops', Conference: 'Conferences', Defense: 'Thesis defenses',
    Launch: 'Launches', Community: 'Community meetings', Exhibition: 'Exhibitions', Ceremony: 'Ceremonies', Other: 'Other events' };
  var ZONES = [
    ['Pacific/Fiji', 'Fiji'], ['Pacific/Tongatapu', 'Tonga'], ['Pacific/Guadalcanal', 'Solomon Islands'], ['Pacific/Apia', 'Samoa'],
    ['Pacific/Efate', 'Vanuatu'], ['Pacific/Funafuti', 'Tuvalu'], ['Pacific/Tarawa', 'Kiribati (Tarawa)'], ['Pacific/Palau', 'Palau'],
    ['Pacific/Rarotonga', 'Cook Islands'], ['Pacific/Majuro', 'Marshall Islands'], ['Pacific/Pohnpei', 'FSM (Pohnpei)'],
    ['Pacific/Chuuk', 'FSM (Chuuk, Yap)'], ['Pacific/Kosrae', 'FSM (Kosrae)'], ['Pacific/Guam', 'Guam'], ['Pacific/Port_Moresby', 'Papua New Guinea'],
    ['Pacific/Noumea', 'New Caledonia'], ['Pacific/Tahiti', 'Tahiti'], ['Pacific/Niue', 'Niue'], ['Pacific/Honolulu', 'Hawai\u02bbi'],
    ['Pacific/Auckland', 'Aotearoa New Zealand'], ['Australia/Sydney', 'Sydney, Canberra, Melbourne'], ['Australia/Brisbane', 'Brisbane'],
    ['Australia/Perth', 'Perth'], ['Asia/Tokyo', 'Japan'], ['Asia/Shanghai', 'China'], ['America/Los_Angeles', 'US Pacific'],
    ['America/New_York', 'US Eastern'], ['Europe/London', 'United Kingdom'], ['UTC', 'UTC']
  ];
  var PLATFORMS = ['Zoom', 'Microsoft Teams', 'Google Meet', 'YouTube Live', 'Facebook Live', 'Other'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function svg(p) { return '<svg class="ev-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var I = {
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    pin: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    video: svg('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>'),
    reg: svg('<path d="M9 11l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="3"/>'),
    qr: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
    flyer: svg('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h5"/>'),
    host: svg('<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>'),
    person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    rec: svg('<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>'),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>')
  };

  // ------------------------------------------------------------ time zones
  function viewerZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
  function zoneOffsetMs(utcMs, tz) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  }
  // "2026-11-12" + "09:00" in Pacific/Fiji -> UTC milliseconds.
  function toUtc(date, time, tz) {
    if (!date) return NaN;
    var d = date.split('-'), t = (time || '00:00').split(':');
    var guess = Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1]);
    var off = zoneOffsetMs(guess, tz || 'UTC');
    var ms = guess - off;
    var off2 = zoneOffsetMs(ms, tz || 'UTC');
    return off2 === off ? ms : guess - off2;
  }
  function fmt(ms, tz, opts) { var o = { timeZone: tz }; for (var k in opts) o[k] = opts[k]; return new Intl.DateTimeFormat('en-GB', o).format(new Date(ms)); }
  function fmtTime(ms, tz) { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).toLowerCase().replace(/\s/g, '\u202f'); }
  function zoneAbbr(ms, tz) {
    try {
      var n = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms)).filter(function (x) { return x.type === 'timeZoneName'; })[0];
      return n ? n.value : tz;
    } catch (e) { return tz; }
  }
  function zoneName(tz) { var z = ZONES.filter(function (x) { return x[0] === tz; })[0]; return z ? z[1] : tz.replace(/^.*\//, '').replace(/_/g, ' '); }

  // Start/end instants for an event item.
  function span(ev) {
    var tz = ev.tz || 'UTC';
    var s = toUtc(ev.start, ev.allDay ? '00:00' : ev.stime, tz);
    var eDate = ev.end || ev.start;
    var e = ev.allDay ? toUtc(eDate, '23:59', tz) : (ev.etime ? toUtc(eDate, ev.etime, tz) : s + 3600000);
    if (!(e > s)) e = s + 3600000;
    return { s: s, e: e, tz: tz };
  }
  function status(ev, now) {
    if (ev.status === 'Cancelled' || ev.status === 'Postponed') return ev.status;
    var t = span(ev); now = now || Date.now();
    if (now > t.e) return 'Past';
    if (now >= t.s) return 'Happening now';
    return 'Upcoming';
  }
  function countdown(ms, now) {
    var d = ms - (now || Date.now());
    if (d <= 0) return '';
    var h = Math.round(d / 3600000), days = Math.round(d / 86400000);
    if (h < 1) return 'Starts in under an hour';
    if (h < 24) return 'Starts in ' + h + ' hour' + (h > 1 ? 's' : '');
    if (days < 14) return 'Starts in ' + days + ' day' + (days > 1 ? 's' : '');
    var w = Math.round(days / 7); return 'Starts in ' + w + ' weeks';
  }
  // Viewer-local line plus original-zone line.
  function whenLines(ev) {
    var t = span(ev), vz = viewerZone();
    var sameDay = fmt(t.s, vz, { year: 'numeric', month: 'numeric', day: 'numeric' }) === fmt(t.e, vz, { year: 'numeric', month: 'numeric', day: 'numeric' });
    var day = fmt(t.s, vz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    var local, orig = '';
    if (ev.allDay) {
      local = fmt(t.s, ev.tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
        (ev.end && ev.end !== ev.start ? ' to ' + fmt(t.e, ev.tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '') + ' (all day, ' + zoneName(ev.tz) + ')';
      return { local: local, orig: '' };
    }
    local = day + ', ' + fmtTime(t.s, vz) + '\u2013' + (sameDay ? '' : fmt(t.e, vz, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ') + fmtTime(t.e, vz) + ' ' + zoneAbbr(t.s, vz) + ' (your time)';
    if (ev.tz !== vz && zoneOffsetMs(t.s, ev.tz) !== zoneOffsetMs(t.s, vz)) {
      orig = fmt(t.s, ev.tz, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + fmtTime(t.s, ev.tz) + '\u2013' + fmtTime(t.e, ev.tz) + ' ' + zoneName(ev.tz) + ' time';
    }
    return { local: local, orig: orig };
  }

  // ------------------------------------------------------------ form
  function opt(v, l, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>'; }
  function inp(name, label, attrs, hint) {
    return '<label><span>' + label + '</span><input name="' + name + '" ' + (attrs || 'type="text" maxlength="200"') + '>' + (hint ? '<small class="ev-hint">' + hint + '</small>' : '') + '</label>';
  }
  var REQ = ' <span class="nw-req">(required)</span>';
  function formHtml() {
    return '<div class="ev-form" hidden>' +
      '<fieldset class="ev-sec"><legend>Event details</legend>' +
      inp('evTitle', 'Event title' + REQ, 'type="text" maxlength="200" placeholder="For example, Talanoa on ocean governance"') +
      '<label><span>Event type' + REQ + '</span><select name="evType">' + opt('', 'Choose one') + TYPES.map(function (t) { return opt(t[0], t[1]); }).join('') + '</select></label>' +
      '<label><span>Short description</span><textarea name="evDesc" rows="2" maxlength="300" placeholder="One or two sentences. Up to 300 characters."></textarea></label>' +
      '<label><span>Role of the featured scholar(s)</span><select name="evRole">' + ['Speaker', 'Presenter', 'Panelist', 'Keynote', 'Candidate', 'Organiser', 'Honouree', 'Other'].map(function (r) { return opt(r, r); }).join('') + '</select></label>' +
      // Type-specific details
      '<div class="ev-x" data-ev-for="Webinar Seminar Conference">' + inp('evTalk', 'Talk or paper title(s)', 'type="text" maxlength="300"') + '</div>' +
      '<div class="ev-x" data-ev-for="Defense">' +
        '<div class="nw-form__row">' + inp('evCandidate', 'Candidate', 'type="text" maxlength="160"') +
        '<label><span>Degree</span><select name="evDegree">' + opt('PhD', 'PhD') + opt('Master\u2019s', 'Master\u2019s') + opt('Other', 'Other') + '</select></label></div>' +
        inp('evThesis', 'Thesis title', 'type="text" maxlength="300"') +
        '<div class="nw-form__row">' + inp('evUni', 'University', 'type="text" maxlength="160"') + inp('evChair', 'Chair or supervisor', 'type="text" maxlength="160"') + '</div>' +
        '<label><span>Open to the public?</span><select name="evPublic">' + opt('Yes', 'Yes') + opt('No', 'No, invited guests only') + '</select></label></div>' +
      '<div class="ev-x" data-ev-for="Conference">' +
        '<div class="nw-form__row">' + inp('evSite', 'Conference website', 'type="url" maxlength="700" placeholder="https://"') + inp('evAbstract', 'Abstract deadline', 'type="date"') + '</div></div>' +
      '<div class="ev-x" data-ev-for="Workshop">' +
        '<div class="nw-form__row">' + inp('evFor', 'Who it is for', 'type="text" maxlength="200" placeholder="For example, early-career researchers"') + inp('evCap', 'Places available', 'type="number" min="1" max="100000"') + '</div></div>' +
      '<div class="ev-x" data-ev-for="Launch">' +
        '<div class="nw-form__row">' + inp('evWork', 'Book or report title', 'type="text" maxlength="300"') + inp('evPublisher', 'Publisher', 'type="text" maxlength="160"') + '</div></div>' +
      '<div class="ev-x" data-ev-for="Community">' + inp('evProtocol', 'Protocol notes', 'type="text" maxlength="300" placeholder="For example, sevusevu at 9 am; modest dress"') + '</div>' +
      '<div class="ev-x" data-ev-for="Exhibition">' + inp('evHours', 'Opening hours', 'type="text" maxlength="200" placeholder="For example, Mon to Fri, 9 am to 4 pm"') + '</div>' +
      '<div class="ev-x" data-ev-for="Ceremony">' + inp('evHonour', 'Who is being honoured, and by which institution', 'type="text" maxlength="300"') + '</div>' +
      '</fieldset>' +

      '<fieldset class="ev-sec"><legend>When</legend>' +
      '<div class="nw-form__row">' + inp('evStart', 'Start date' + REQ, 'type="date"') + inp('evStime', 'Start time', 'type="time"') + '</div>' +
      '<div class="nw-form__row">' + inp('evEnd', 'End date', 'type="date"', 'Leave blank if it ends the same day.') + inp('evEtime', 'End time', 'type="time"') + '</div>' +
      '<label class="ev-check"><input type="checkbox" name="evAllDay"> All day</label>' +
      '<label><span>Time zone of the event' + REQ + '</span><select name="evTz">' + ZONES.map(function (z) { return opt(z[0], z[1] + ' (' + z[0].replace(/_/g, ' ') + ')'); }).join('') + '</select>' +
      '<small class="ev-hint">Enter the times as they are in this time zone. Each viewer sees them in their own local time.</small></label>' +
      inp('evSeries', 'Part of a series?', 'type="text" maxlength="200" placeholder="For example, every second Thursday until December"') +
      '</fieldset>' +

      '<fieldset class="ev-sec"><legend>Where</legend>' +
      '<div class="ev-seg" role="radiogroup" aria-label="Format">' +
        ['In person', 'Online', 'Hybrid'].map(function (f, i) { return '<label><input type="radio" name="evFormat" value="' + f + '"' + (i ? '' : ' checked') + '><span>' + f + '</span></label>'; }).join('') + '</div>' +
      '<div class="ev-x" data-ev-fmt="In person|Hybrid">' +
        '<div class="nw-form__row">' + inp('evVenue', 'Venue' + REQ, 'type="text" maxlength="200" placeholder="For example, USP Laucala Campus"') + inp('evRoom', 'Room', 'type="text" maxlength="120"') + '</div>' +
        '<div class="nw-form__row">' + inp('evCity', 'Town or city', 'type="text" maxlength="120"') + inp('evCountry', 'Country', 'type="text" maxlength="120"') + '</div></div>' +
      '<div class="ev-x" data-ev-fmt="Online|Hybrid">' +
        '<div class="nw-form__row"><label><span>Platform</span><select name="evPlatform">' + PLATFORMS.map(function (p) { return opt(p, p); }).join('') + '</select></label>' +
        inp('evJoin', 'Join link' + REQ, 'type="url" maxlength="700" placeholder="https://"') + '</div>' +
        '<div class="nw-form__row">' + inp('evMid', 'Meeting ID', 'type="text" maxlength="80"') + inp('evPass', 'Passcode', 'type="text" maxlength="80"') + '</div>' +
        inp('evLive', 'Livestream link', 'type="url" maxlength="700" placeholder="https://"') +
        '<label class="ev-check"><input type="checkbox" name="evRec"> A recording will be posted afterwards</label>' +
        '<small class="ev-hint">The meeting ID and passcode stay hidden until a viewer clicks Show join details.</small></div>' +
      '</fieldset>' +

      '<fieldset class="ev-sec"><legend>Taking part</legend>' +
      '<div class="nw-form__row"><label><span>Who can come</span><select name="evAccess">' + opt('Open to all', 'Open to all') + opt('Registration required', 'Registration required') + opt('Invite only', 'Invite only') + '</select></label>' +
      '<label><span>Cost</span><select name="evCost">' + opt('Free', 'Free') + opt('Paid', 'Paid') + '</select></label></div>' +
      '<div class="ev-x" data-ev-acc="Registration required"><div class="nw-form__row">' + inp('evReg', 'Registration link' + REQ, 'type="url" maxlength="700" placeholder="https://"') + inp('evRegBy', 'Register by', 'type="date"') + '</div></div>' +
      '<div class="nw-form__row">' + inp('evLang', 'Language(s)', 'type="text" maxlength="120" placeholder="For example, English, iTaukei"') + inp('evA11y', 'Accessibility', 'type="text" maxlength="200" placeholder="Captions, interpreters, wheelchair access"') + '</div>' +
      '</fieldset>' +

      '<fieldset class="ev-sec"><legend>Flyer and QR code</legend>' +
      '<label><span>Flyer</span><input name="evFlyer" type="file" accept="image/jpeg,image/png,application/pdf"><small class="ev-hint">JPG, PNG or PDF, up to 5 MB. Once approved, it becomes the event\u2019s picture on the dashboard.</small></label>' +
      '<div class="ev-flyer-prev" hidden></div>' +
      '<p class="ev-note">' + I.qr + 'A QR code is made automatically from the registration or join link.</p>' +
      '<label><span>Different QR code? (optional)</span><input name="evQr" type="file" accept="image/jpeg,image/png"><small class="ev-hint">Only if the flyer\u2019s QR code goes somewhere other than the links above.</small></label>' +
      '</fieldset>' +

      '<fieldset class="ev-sec"><legend>Contact person</legend>' +
      '<div class="nw-form__row">' + inp('evCName', 'Name', 'type="text" maxlength="160"') + inp('evCRole', 'Role and organisation', 'type="text" maxlength="200"') + '</div>' +
      '<div class="nw-form__row">' + inp('evCEmail', 'Email', 'type="email" maxlength="240"') + inp('evCPhone', 'Phone or WhatsApp (optional)', 'type="tel" maxlength="60"') + '</div>' +
      '<label class="ev-check"><input type="checkbox" name="evCShow"> OK to show this contact on the dashboard</label>' +
      '<small class="ev-hint">If this is not ticked, the contact goes to the reviewing collaborator only.</small>' +
      '</fieldset>' +

      '<fieldset class="ev-sec"><legend>Hosts</legend>' +
      inp('evHosts', 'Host organisation(s)', 'type="text" maxlength="300" placeholder="For example, Pacific Islands Forum Secretariat"') +
      inp('evSponsors', 'Co-sponsors', 'type="text" maxlength="300"') +
      '<label><span>How are you involved?</span><select name="evInvolved">' + opt('Organiser', 'I am an organiser') + opt('Speaker', 'I am a speaker or presenter') + opt('Seen', 'I saw it advertised') + '</select></label>' +
      '</fieldset></div>';
  }

  function sel(form, n) { return form.querySelector('[name="' + n + '"]'); }
  function val(form, n) { var e = sel(form, n); return e ? String(e.value || '').trim() : ''; }
  function wire(form) {
    var box = form.querySelector('.ev-form'), type = sel(form, 'type');
    var tz = sel(form, 'evTz'), vz = viewerZone();
    if (!ZONES.some(function (z) { return z[0] === vz; })) tz.insertAdjacentHTML('afterbegin', opt(vz, zoneName(vz) + ' (' + vz + ')'));
    tz.value = vz;
    function sync() {
      var on = type.value === 'Event';
      box.hidden = !on;
      form.classList.toggle('is-event', on);
      var t = val(form, 'evType'), f = (form.querySelector('[name=evFormat]:checked') || {}).value || '', a = val(form, 'evAccess');
      box.querySelectorAll('[data-ev-for]').forEach(function (x) { x.hidden = x.dataset.evFor.split(' ').indexOf(t) < 0; });
      box.querySelectorAll('[data-ev-fmt]').forEach(function (x) { x.hidden = x.dataset.evFmt.split('|').indexOf(f) < 0; });
      box.querySelectorAll('[data-ev-acc]').forEach(function (x) { x.hidden = x.dataset.evAcc !== a; });
      var all = sel(form, 'evAllDay').checked;
      ['evStime', 'evEtime'].forEach(function (n) { sel(form, n).disabled = all; });
      var lab = form.querySelector('[data-link-label]');
      if (lab) lab.innerHTML = on ? 'Link to the event page or announcement <span class="nw-req">(optional for events)</span>' : 'Link to the story or announcement <span class="nw-req">(required)</span>';
      var send = form.querySelector('[type=submit]');
      if (send && !send.dataset.done) send.textContent = on ? 'Send event' : 'Send link';
      var dh = form.closest('dialog'); dh = dh && dh.querySelector('h2');
      if (dh) { if (!dh.dataset.base) dh.dataset.base = dh.textContent; dh.textContent = on ? 'Share an event' : dh.dataset.base; }
    }
    form.addEventListener('change', sync);
    form.addEventListener('input', function (e) { if (e.target.name === 'evType') sync(); });
    var fl = sel(form, 'evFlyer'), prev = box.querySelector('.ev-flyer-prev');
    fl.addEventListener('change', function () {
      var f = fl.files && fl.files[0];
      prev.hidden = !f; prev.innerHTML = '';
      if (!f) return;
      if (/^image\//.test(f.type)) { var u = URL.createObjectURL(f); prev.innerHTML = '<img src="' + u + '" alt="Flyer preview">'; }
      else prev.textContent = f.name;
    });
    sync();
    return sync;
  }
  function isUrl(s) { return /^https?:\/\/\S+\.\S+/i.test(s); }
  function validate(form) {
    if (!val(form, 'evTitle')) return ['evTitle', 'Please add the event title.'];
    if (!val(form, 'evType')) return ['evType', 'Please choose the event type.'];
    if (!val(form, 'evStart')) return ['evStart', 'Please add the start date.'];
    if (!sel(form, 'evAllDay').checked && !val(form, 'evStime')) return ['evStime', 'Please add the start time, or tick All day.'];
    var end = val(form, 'evEnd');
    if (end && end < val(form, 'evStart')) return ['evEnd', 'The end date is before the start date.'];
    var f = (form.querySelector('[name=evFormat]:checked') || {}).value;
    if (f !== 'Online' && !val(form, 'evVenue')) return ['evVenue', 'Please add the venue.'];
    if (f !== 'In person' && !isUrl(val(form, 'evJoin'))) return ['evJoin', 'Please add the full join link, starting with https://'];
    if (val(form, 'evAccess') === 'Registration required' && !isUrl(val(form, 'evReg'))) return ['evReg', 'Please add the full registration link, starting with https://'];
    var fl = sel(form, 'evFlyer').files[0];
    if (fl && fl.size > 5 * 1024 * 1024) return ['evFlyer', 'The flyer is larger than 5 MB. Please choose a smaller file.'];
    var q = sel(form, 'evQr').files[0];
    if (q && q.size > 2 * 1024 * 1024) return ['evQr', 'The QR code image is larger than 2 MB.'];
    var ce = val(form, 'evCEmail');
    if (ce && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ce)) return ['evCEmail', 'Please check the contact email.'];
    return null;
  }
  function readFile(f) {
    return new Promise(function (ok, bad) {
      if (!f) { ok(null); return; }
      var r = new FileReader();
      r.onload = function () { ok({ name: f.name, mimeType: f.type, data: String(r.result).replace(/^data:[^,]*,/, '') }); };
      r.onerror = bad; r.readAsDataURL(f);
    });
  }
  function collect(form) {
    var f = (form.querySelector('[name=evFormat]:checked') || {}).value || 'In person';
    var t = val(form, 'evType');
    var ev = {
      etype: t, title: val(form, 'evTitle'), desc: val(form, 'evDesc'), role: val(form, 'evRole'),
      start: val(form, 'evStart'), stime: val(form, 'evStime'), end: val(form, 'evEnd'), etime: val(form, 'evEtime'),
      allDay: sel(form, 'evAllDay').checked, tz: val(form, 'evTz'), series: val(form, 'evSeries'), format: f,
      access: val(form, 'evAccess'), cost: val(form, 'evCost'), lang: val(form, 'evLang'), a11y: val(form, 'evA11y'),
      hosts: val(form, 'evHosts'), sponsors: val(form, 'evSponsors'), involved: val(form, 'evInvolved'),
      contact: { name: val(form, 'evCName'), role: val(form, 'evCRole'), email: val(form, 'evCEmail'), phone: val(form, 'evCPhone'), show: sel(form, 'evCShow').checked }
    };
    if (f !== 'Online') { ev.venue = val(form, 'evVenue'); ev.room = val(form, 'evRoom'); ev.city = val(form, 'evCity'); ev.country = val(form, 'evCountry'); }
    if (f !== 'In person') { ev.platform = val(form, 'evPlatform'); ev.join = val(form, 'evJoin'); ev.mid = val(form, 'evMid'); ev.pass = val(form, 'evPass'); ev.live = val(form, 'evLive'); ev.rec = sel(form, 'evRec').checked; }
    if (ev.access === 'Registration required') { ev.reg = val(form, 'evReg'); ev.regBy = val(form, 'evRegBy'); }
    var x = {};
    form.querySelectorAll('.ev-x[data-ev-for]').forEach(function (box) {
      if (box.dataset.evFor.split(' ').indexOf(t) < 0) return;
      box.querySelectorAll('input,select').forEach(function (e) { if (String(e.value || '').trim()) x[e.name.replace(/^ev/, '').toLowerCase()] = String(e.value).trim(); });
    });
    ev.extra = x;
    return Promise.all([readFile(sel(form, 'evFlyer').files[0]), readFile(sel(form, 'evQr').files[0])])
      .then(function (r) { return { event: ev, flyer: r[0], qrImage: r[1] }; });
  }
  function reset(form) { var b = form.querySelector('.ev-form .ev-flyer-prev'); if (b) { b.hidden = true; b.innerHTML = ''; } }

  // ------------------------------------------------------------ card
  function placeLine(ev) {
    var parts = [];
    if (ev.format !== 'Online') parts.push([ev.venue, ev.room, ev.city, ev.country].filter(Boolean).join(', '));
    if (ev.format !== 'In person') parts.push((ev.format === 'Hybrid' ? 'and online via ' : 'Online via ') + (ev.platform || 'video link'));
    return parts.filter(Boolean).join(' ');
  }
  function qrSvg(text, cell) {
    if (!text || typeof window.qrcode !== 'function') return '';
    var q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: cell || 5, margin: 2, scalable: true });
  }
  function regLink(ev) { return ev.reg || ''; }
  function qrTarget(ev) { return ev.reg || ev.join || ev.live || ''; }
  function chipsHtml(it, h) {
    var ev = it.ev, st = status(ev);
    var stCls = { Upcoming: 'up', 'Happening now': 'now', Past: 'past', Cancelled: 'cx', Postponed: 'cx' }[st];
    return '<span class="nw__chips"><span class="nw__chip nw__chip--Event">' + esc(SHORT[ev.etype] || 'Event') + '</span>' +
      '<span class="nw__chip ev-st ev-st--' + stCls + '">' + esc(st) + '</span>' +
      '<span class="nw__chip ev-fmt">' + esc(ev.format) + '</span></span>';
  }
  function feature(it, h) {
    var ev = it.ev, t = span(ev), st = status(ev), w = whenLines(ev), now = Date.now();
    var badge = '<span class="ev-badge"><span class="ev-badge__m">' + esc(fmt(t.s, ev.allDay ? ev.tz : viewerZone(), { month: 'short' })) + '</span><span class="ev-badge__d">' + esc(fmt(t.s, ev.allDay ? ev.tz : viewerZone(), { day: 'numeric' })) + '</span></span>';
    var cd = st === 'Upcoming' ? countdown(t.s, now) : '';
    var lines = [];
    lines.push('<div class="ev-when">' + badge + '<span><b>' + esc(w.local) + '</b>' + (w.orig ? '<small>' + esc(w.orig) + '</small>' : '') + (cd ? '<em class="ev-cd">' + esc(cd) + '</em>' : '') + (ev.series ? '<small>' + esc(ev.series) + '</small>' : '') + '</span></div>');
    var pl = placeLine(ev);
    if (pl) lines.push('<div class="ev-line">' + (ev.format === 'Online' ? I.video : I.pin) + '<span>' + esc(pl) + '</span></div>');
    if (ev.hosts) lines.push('<div class="ev-line">' + I.host + '<span>Hosted by ' + esc(ev.hosts) + (ev.sponsors ? '; with ' + esc(ev.sponsors) : '') + '</span></div>');
    var take = [ev.cost, ev.access + (ev.regBy && st === 'Upcoming' ? ' by ' + fmt(toUtc(ev.regBy, '12:00', ev.tz), ev.tz, { day: 'numeric', month: 'short' }) : ''), ev.lang, ev.a11y].filter(Boolean);
    if (take.length) lines.push('<div class="ev-line">' + I.info + '<span>' + esc(take.join(' \u00b7 ')) + '</span></div>');
    var x = ev.extra || {};
    var xl = [];
    if (ev.etype === 'Defense') xl.push([x.degree, 'thesis' + (x.uni ? ' at ' + x.uni : '')].filter(Boolean).join(' ') + (x.thesis ? ': \u201c' + x.thesis + '\u201d' : '') + (x.chair ? ' \u00b7 Chair: ' + x.chair : '') + (x['public'] === 'No' ? ' \u00b7 Invited guests only' : ''));
    if (x.talk) xl.push('Talk: ' + x.talk);
    if (x.abstract && st === 'Upcoming') xl.push('Abstracts due ' + fmt(toUtc(x.abstract, '12:00', ev.tz), ev.tz, { day: 'numeric', month: 'short', year: 'numeric' }));
    if (x['for']) xl.push('For ' + x['for'] + (x.cap ? ' \u00b7 ' + x.cap + ' places' : ''));
    if (x.work) xl.push(x.work + (x.publisher ? ' (' + x.publisher + ')' : ''));
    if (x.protocol) xl.push(x.protocol);
    if (x.hours) xl.push('Open ' + x.hours);
    if (x.honour) xl.push(x.honour);
    if (xl.length) lines.push('<div class="ev-line ev-line--x">' + I.info + '<span>' + esc(xl.join(' \u00b7 ')) + '</span></div>');
    var c = ev.contact || {};
    if (c.show && c.name) lines.push('<div class="ev-line">' + I.person + '<span>Contact: ' + esc(c.name) + (c.role ? ', ' + esc(c.role) : '') +
      (c.email ? ' \u00b7 <a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '') + (c.phone ? ' \u00b7 ' + esc(c.phone) : '') + '</span></div>');

    // Buttons
    var acts = [], live = st === 'Upcoming' || st === 'Happening now';
    var near = live && t.s - now <= 3600000;
    if (live && regLink(ev)) acts.push('<a class="nw__a nw__a--p" href="' + esc(ev.reg) + '" target="_blank" rel="noopener">' + I.reg + 'Register' + I.ext + '</a>');
    if (live && ev.join && near) acts.push('<a class="nw__a nw__a--p" href="' + esc(ev.join) + '" target="_blank" rel="noopener">' + I.video + 'Join now' + I.ext + '</a>');
    else if (live && ev.join) acts.push('<button type="button" class="nw__a" data-ev-join aria-expanded="false">' + I.video + 'Show join details</button>');
    if (live && ev.live) acts.push('<a class="nw__a" href="' + esc(ev.live) + '" target="_blank" rel="noopener">' + I.rec + 'Watch live' + I.ext + '</a>');
    if (st === 'Past' && ev.recUrl) acts.push('<a class="nw__a nw__a--p" href="' + esc(ev.recUrl) + '" target="_blank" rel="noopener">' + I.rec + 'Watch the recording' + I.ext + '</a>');
    if (live) acts.push('<button type="button" class="nw__a" data-ev-ics>' + I.cal + 'Add to calendar</button>');
    if (it.flyer) acts.push('<a class="nw__a" href="' + esc(it.flyer) + '" target="_blank" rel="noopener">' + I.flyer + 'View flyer</a>');
    if (live && (ev.qrImg || qrTarget(ev))) acts.push('<button type="button" class="nw__a" data-ev-qr aria-expanded="false">' + I.qr + 'QR code</button>');
    if (it.url) acts.push('<a class="nw__a" href="' + esc(it.url) + '" target="_blank" rel="noopener">Event page' + I.ext + '</a>');
    if (it.sid) acts.push('<button type="button" class="nw__a" data-nw-open>' + h.ico('card') + 'Open scholar card</button>');
    var joinBox = live && ev.join ? '<div class="ev-pop ev-joinbox" hidden><b>' + esc(ev.platform || 'Join link') + '</b><a href="' + esc(ev.join) + '" target="_blank" rel="noopener">' + esc(ev.join) + '</a>' +
      (ev.mid ? '<span>Meeting ID: <b>' + esc(ev.mid) + '</b></span>' : '') + (ev.pass ? '<span>Passcode: <b>' + esc(ev.pass) + '</b></span>' : '') + '</div>' : '';
    var qrBox = live && (ev.qrImg || qrTarget(ev)) ? '<div class="ev-pop ev-qrbox" hidden>' + (ev.qrImg ? '<img src="' + esc(ev.qrImg) + '" alt="QR code">' : qrSvg(qrTarget(ev), 4)) +
      '<span>Scan to ' + (ev.reg ? 'register' : 'join') + '</span></div>' : '';

    return '<div class="nw__img-wrap ev-img' + (it.flyer ? ' has-flyer' : '') + '">' + (it.flyer ? '<span class="ev-flyer"><img src="' + esc(it.flyer) + '" alt="Event flyer" loading="lazy" referrerpolicy="no-referrer"></span>' : h.imgHtml(it, 'nw__img')) + '</div>' +
      '<div class="nw__body ev-body">' + chipsHtml(it, h) +
      '<h3 class="nw__title">' + esc(ev.title || it.head) + '</h3>' +
      '<div class="nw__meta pn-people">' + h.peopleLine(it) + (ev.role ? '<span class="ev-role">' + esc(ev.role) + '</span>' : '') + '</div>' +
      (ev.desc ? '<p class="nw__sum">' + esc(ev.desc) + '</p>' : '') +
      '<div class="ev-lines">' + lines.join('') + '</div>' +
      '<div class="nw__acts ev-acts">' + acts.join('') + '</div>' + joinBox + qrBox + '</div>';
  }
  function icsText(it) {
    var ev = it.ev, t = span(ev);
    function z(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    function e(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); }
    var loc = placeLine(ev) + (ev.join ? ' ' + ev.join : '');
    var desc = [ev.desc, ev.hosts ? 'Hosted by ' + ev.hosts : '', ev.reg ? 'Register: ' + ev.reg : '', ev.join ? 'Join: ' + ev.join : '', it.url || ''].filter(Boolean).join('\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vave Lab//Pacific scholars events//EN', 'BEGIN:VEVENT',
      'UID:' + (it.id || ev.start + '-' + (ev.title || '').replace(/\W+/g, '').slice(0, 30)) + '@vave-lab',
      'DTSTAMP:' + z(Date.now()), 'DTSTART:' + z(t.s), 'DTEND:' + z(t.e),
      'SUMMARY:' + e(ev.title || it.head), 'DESCRIPTION:' + e(desc), 'LOCATION:' + e(loc), (it.url || ev.reg ? 'URL:' + (ev.reg || it.url) : ''),
      'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  }
  function wireFeature(el, it) {
    var j = el.querySelector('[data-ev-join]'), jb = el.querySelector('.ev-joinbox');
    if (j) j.addEventListener('click', function () { jb.hidden = !jb.hidden; j.setAttribute('aria-expanded', String(!jb.hidden)); });
    var q = el.querySelector('[data-ev-qr]'), qb = el.querySelector('.ev-qrbox');
    if (q) q.addEventListener('click', function () { qb.hidden = !qb.hidden; q.setAttribute('aria-expanded', String(!qb.hidden)); });
    var c = el.querySelector('[data-ev-ics]');
    if (c) c.addEventListener('click', function () {
      var b = new Blob([icsText(it)], { type: 'text/calendar' }), a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = (it.ev.title || 'event').replace(/[^\w\- ]+/g, '').slice(0, 60) + '.ics';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }

  // ------------------------------------------------------------ list + dropdown
  var ORDER_TAGS = ['Upcoming', 'Past', 'Off'].concat(TYPES.map(function (t) { return t[0]; }));
  function tags(it) {
    if (!it.ev) return [];
    var st = status(it.ev);
    return [st === 'Past' ? 'Past' : (st === 'Cancelled' || st === 'Postponed') ? 'Off' : 'Upcoming', it.ev.etype || 'Other'];
  }
  function tagLabel(c) { return c === 'Upcoming' ? 'Upcoming and happening now' : c === 'Past' ? 'Past events' : c === 'Off' ? 'Postponed or cancelled' : (PLURAL[c] || c); }
  function tagRank(c) { var k = ORDER_TAGS.indexOf(c); return k < 0 ? 99 : k; }
  // Upcoming soonest first, then past most recent first, then postponed or cancelled.
  function sort(list) {
    var now = Date.now();
    function grp(it) { if (!it.ev) return 3; var st = status(it.ev, now); return st === 'Postponed' || st === 'Cancelled' ? 2 : st === 'Past' ? 1 : 0; }
    return list.slice().sort(function (a, b) {
      var ga = grp(a), gb = grp(b);
      if (ga !== gb) return ga - gb;
      var A = a.ev ? span(a.ev) : { s: 0 }, B = b.ev ? span(b.ev) : { s: 0 };
      return ga === 0 ? A.s - B.s : B.s - A.s;
    });
  }
  function listMeta(it) {
    var ev = it.ev, t = span(ev), vz = ev.allDay ? ev.tz : viewerZone();
    var d = fmt(t.s, vz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return [d, ev.allDay ? 'All day' : fmtTime(t.s, vz), ev.format].join(' \u00b7 ');
  }
  function listLabel(it) { return SHORT[it.ev.etype] || 'Event'; }

  window.VLEvent = {
    formHtml: formHtml, wire: wire, validate: validate, collect: collect, reset: reset,
    feature: feature, wireFeature: wireFeature, tags: tags, tagLabel: tagLabel, tagRank: tagRank,
    sort: sort, listMeta: listMeta, listLabel: listLabel, status: status, span: span, icsText: icsText, qrSvg: qrSvg
  };
})();
