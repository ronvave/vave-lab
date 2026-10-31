/* Admin V2: "News Story Submissions" queue (Tonga, Fiji and Solomon Islands).
 * Country wording comes from #news-queue data attributes (data-place,
 * data-id-example); without them the Tonga wording is used.
 * Links sent from dashboard Panel A3 ("Share a story") wait here. An Owner or
 * Admin opens the link, completes the story details and approves; the backend
 * then appends one row to the Master's News tab with Show on Dashboard = Yes.
 * Rejecting keeps the link out of the panel. Calls go through the signed-in
 * review session (window.adminWriteback); nothing here holds credentials. */
(function () {
  'use strict';
  var host = document.getElementById('news-queue');
  if (!host) return;
  var PLACE = host.getAttribute('data-place') || 'Tonga';
  var IDX = host.getAttribute('data-id-example') || 'TNG-S0000';
  var tab = document.querySelector('[data-tab="news-submissions"]');
  var TYPES = [['News', 'News story'], ['Thesis', 'New thesis'], ['Publication', 'New publication'], ['Event', 'Event (including webinars and thesis defenses)']];
  var OPEN = { Thesis: 1, Publication: 1 }, TIMED = { Defense: 1, Event: 1 };
  function typeKey(t) { return t === 'Webinar' ? 'Event' : (t || 'News'); }
  var CATS = ['Award', 'Appointment', 'Graduation', 'Milestone', 'Publication', 'Research', 'News']; // News = general news, last on purpose
  var loaded = false, busy = false;

  function el(tag, text, parent, cls) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  // Event submissions ("Share an event" form) carry row.event, plus private
  // flyer and QR previews (row.flyerPreview, row.qrPreview) while pending.
  function evWhen(ev) {
    if (ev.allDay) return ev.start + (ev.end ? ' to ' + ev.end : '') + ' (all day, ' + ev.tz + ')';
    return ev.start + ', ' + ev.stime + (ev.etime ? '\u2013' + ev.etime : '') + (ev.end ? ' (ends ' + ev.end + ')' : '') + ' ' + ev.tz;
  }
  function evWhere(ev) {
    var p = [];
    if (ev.format !== 'Online') p.push([ev.venue, ev.room, ev.city, ev.country].filter(Boolean).join(', '));
    if (ev.format !== 'In person') p.push((ev.format === 'Hybrid' ? 'and online via ' : 'Online via ') + (ev.platform || 'video link'));
    return p.join(' ');
  }
  var EXTRA = { talk: 'Talk title', candidate: 'Candidate', degree: 'Degree', thesis: 'Thesis title', uni: 'University', chair: 'Chair', 'public': 'Open to the public', site: 'Event website', abstract: 'Abstract deadline', 'for': 'Who it is for', cap: 'Places', work: 'Work launched', publisher: 'Publisher', protocol: 'Protocol', hours: 'Opening hours', honour: 'Honour' };
  function evDetails(c, row) {
    var ev = row.event, box = el('div', null, c, 'tnews-ev');
    el('h4', 'Event details from the form', box);
    var dl = el('dl', null, box, 'tnews-dl');
    var co = ev.contact || {};
    [['Event', ev.etype + ' · ' + ev.title], ['Their role', ev.role], ['When', evWhen(ev) + (ev.series ? ' · ' + ev.series : '')], ['Where', evWhere(ev)],
      ['Format and access', [ev.format, ev.access, ev.cost, ev.lang].filter(Boolean).join(' · ')],
      ['Join link', ev.join ? ev.join + (ev.mid ? ' · ID ' + ev.mid : '') + (ev.pass ? ' · passcode ' + ev.pass : '') : ''],
      ['Livestream', ev.live || ''], ['Recording planned', ev.format !== 'In person' ? (ev.rec ? 'Yes' : 'No') : ''],
      ['Registration', ev.reg ? ev.reg + (ev.regBy ? ' · by ' + ev.regBy : '') : ''],
      ['Hosts', ev.hosts], ['Sponsors', ev.sponsors], ['Accessibility', ev.a11y], ['Description', ev.desc]]
      .concat(Object.keys(EXTRA).filter(function (k) { return ev.extra && ev.extra[k]; }).map(function (k) { return [EXTRA[k], ev.extra[k]]; }))
      .concat([['Contact', co.name ? [co.name, co.role, co.email, co.phone].filter(Boolean).join(' · ') + (co.show ? ' (agreed to show it)' : ' (private, not shown)') : ''],
        ['How they are involved', ev.involved === 'Seen' ? 'Saw it advertised' : ev.involved]])
      .forEach(function (kv) { if (kv[1]) { el('dt', kv[0], dl); el('dd', kv[1], dl); } });
    if (row.flyerPreview || row.qrPreview) {
      var pics = el('div', null, box, 'tnews-ev-pics');
      [[row.flyerPreview, 'Flyer (private until approved)'], [row.qrPreview, 'Their QR code image']].forEach(function (x) {
        if (!x[0] || !/^data:image\/(png|jpeg);base64,/.test(x[0])) return;
        var f = el('figure', null, pics), im = el('img', null, f); im.src = x[0]; im.alt = x[1]; el('figcaption', x[1], f);
      });
    } else if (row['Flyer File ID']) el('p', 'A flyer was uploaded (a PDF or a file too large to preview). Open the Event Flyers folder in Drive to see it.', box, 'meta');
  }
  function safeUrl(u) { try { var x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (_) { return ''; } }
  function api() {
    var w = window.adminWriteback;
    if (!w || !w.readNewsSubmissions) throw new Error('Sign in first.');
    return w;
  }

  var bar = el('div', null, host, 'tnews-bar');
  var filter = el('select', null, bar);
  [['Pending', 'Pending'], ['Approved', 'Approved'], ['Rejected', 'Rejected'], ['', 'All']].forEach(function (o) { var op = el('option', o[1], filter); op.value = o[0]; });
  var refresh = el('button', 'Refresh', bar); refresh.type = 'button';
  var status = el('p', 'Open this tab to load news links.', host, 'tonga-queue-status'); status.setAttribute('role', 'status');
  var list = el('div', null, host, 'tnews-list');
  var badge = tab ? el('span', null, tab, 'tonga-submission-badge') : null;
  if (badge) badge.hidden = true;

  function setBadge(n) { if (!badge) return; badge.textContent = String(n); badge.hidden = !n; badge.title = n + ' pending news links'; }

  function field(form, label, name, type, value, opts) {
    var w = el('label', null, form, 'tnews-f' + (opts && opts.wide ? ' tnews-f--wide' : ''));
    el('span', label, w);
    var input;
    if (type === 'select') {
      input = el('select', null, w);
      (opts.options || []).forEach(function (o) { var op = el('option', o[1], input); op.value = o[0]; });
      input.value = value || '';
    } else if (type === 'textarea') {
      input = el('textarea', null, w); input.rows = 3; input.value = value || '';
    } else {
      input = el('input', null, w); input.type = type; input.value = value || '';
    }
    input.name = name;
    if (opts && opts.placeholder) input.placeholder = opts.placeholder;
    if (opts && opts.hint) el('small', opts.hint, w);
    return input;
  }

  function card(row) {
    var c = el('article', null, list, 'tnews-card');
    var head = el('div', null, c, 'tnews-head');
    el('span', row.Status, head, 'tonga-status-pill');
    el('strong', (TYPES.filter(function (t) { return t[0] === typeKey(row['Announcement Type']); })[0] || TYPES[0])[1], head);
    el('span', row['Submitted At'], head, 'meta');
    var u = safeUrl(row['Article URL']);
    var p = el('p', null, c, 'tnews-link');
    if (u) { var a = el('a', row['Article URL'], p); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; } else p.textContent = row['Article URL'] || (row.event ? 'No web page given. This event was sent with the event form.' : '');
    var dl = el('dl', null, c, 'tnews-dl');
    [['Scholar(s) or author(s)', row['Scholar(s) Named'] || 'Not given'], ['Sent by', row['Submitter Name'] + ' · ' + row['Submitter Email']], ['Their note', row['Submitter Note'] || 'None']].forEach(function (kv) {
      el('dt', kv[0], dl); el('dd', kv[1], dl);
    });
    var ev = row.event && row.event.title ? row.event : null;
    if (ev) evDetails(c, row);
    if (row.Status !== 'Pending') {
      el('p', row.Status + ' by ' + (row['Reviewed By'] || '').split(' (')[0] + ' on ' + row['Reviewed At'] + (row['News ID'] ? ' · added as ' + row['News ID'] : '') + (row['Decision Notes'] ? ' · ' + row['Decision Notes'] : ''), c, 'meta');
      return;
    }
    var form = el('div', null, c, 'tnews-form');
    var fill = el('button', 'Fill details from the link', form, 'tnews-fill'); fill.type = 'button';
    var fillMsg = el('span', 'Reads the page title, picture, outlet and date and suggests matching scholars. Check every field.', form, 'meta tnews-fill-msg');
    if (!u) { fill.hidden = true; fillMsg.textContent = 'The fields below are filled from the event form. Choose the scholar and check every field.'; }
    var grid = el('div', null, form, 'tnews-grid');
    var scholar = field(grid, 'Scholar', 'scholarSel', 'select', '', { options: [['', 'Choose after filling, or type an ID below']] });
    var sid = field(grid, 'Scholar ID', 'scholarId', 'text', '', { placeholder: IDX });
    var type = field(grid, 'Type', 'type', 'select', typeKey(row['Announcement Type']), { options: TYPES });
    var shown = field(grid, 'Name shown on the dashboard', 'displayName', 'text', '', { hint: 'Optional for database scholars. For a new thesis or publication about ' + PLACE + ' by someone outside the database, leave Scholar ID blank and enter the author name(s) here.' });
    var cat = field(grid, 'Category (news stories)', 'category', 'select', '', { options: [['', 'Choose']].concat(CATS.map(function (x) { return [x, x]; })) });
    var head2 = field(grid, 'Headline', 'headline', 'text', '', { wide: true });
    var outlet = field(grid, 'Outlet (or university, journal or publisher)', 'outlet', 'text', '');
    var date = field(grid, 'Date (story date, or the event date)', 'date', 'date', '');
    var when = field(grid, 'Event time (shown as written)', 'eventTime', 'text', '', { placeholder: '20 Nov 2026, 12:00 pm NZDT' });
    var where = field(grid, 'Event location', 'eventLocation', 'text', '', { placeholder: 'Zoom, or a venue' });
    var img = field(grid, 'Image link', 'imageUrl', 'url', '', { wide: true, hint: 'The outlet picture. Leave blank to show the scholar initials.' });
    var credit = field(grid, 'Image credit', 'imageCredit', 'text', '');
    var also = field(grid, 'Also covered by', 'also', 'text', '');
    var sum = field(grid, 'Summary (one or two sentences in your own words)', 'summary', 'textarea', '', { wide: true });
    var evStatus = null, evRec = null, useFlyer = null, useQr = null;
    if (ev) {
      evStatus = field(grid, 'Event status', 'eventStatus', 'select', '', { options: [['', 'Going ahead'], ['Postponed', 'Postponed'], ['Cancelled', 'Cancelled']], hint: 'You can change this later in the News tab (Event Status column).' });
      evRec = field(grid, 'Recording link (after the event)', 'recordingUrl', 'url', '', { hint: 'Optional. You can add it later in the News tab (Recording URL column).' });
      if (row['Flyer File ID']) { useFlyer = el('input', null, el('label', null, grid, 'tnews-f tnews-check')); useFlyer.type = 'checkbox'; useFlyer.checked = true; useFlyer.parentNode.appendChild(document.createTextNode(' Show the flyer on the dashboard (makes only this file viewable by link)')); }
      if (row['QR Image File ID']) { useQr = el('input', null, el('label', null, grid, 'tnews-f tnews-check')); useQr.type = 'checkbox'; useQr.checked = true; useQr.parentNode.appendChild(document.createTextNode(' Use their QR code image')); }
      head2.value = ev.title || ''; date.value = ev.start || ''; when.value = evWhen(ev); where.value = evWhere(ev);
      sum.value = ev.desc || ''; outlet.value = ev.hosts || '';
      if (row['Flyer File ID']) img.closest('label').querySelector('small').textContent = 'Leave blank to use the flyer as the picture.';
    }
    var notes = field(grid, 'Review note (private)', 'notes', 'text', '', { wide: true });
    var thumb = el('img', null, form, 'tnews-thumb'); thumb.alt = ''; thumb.hidden = true;
    function sync() {
      var news = type.value === 'News', timed = !!TIMED[type.value];
      cat.closest('label').hidden = !news;
      when.closest('label').hidden = !timed; where.closest('label').hidden = !timed;
      sid.placeholder = OPEN[type.value] ? IDX + ', or blank if the author is not in the database' : IDX;
    }
    type.addEventListener('change', sync); sync();
    scholar.addEventListener('change', function () { if (scholar.value) sid.value = scholar.value; });
    img.addEventListener('input', function () { var s = safeUrl(img.value); thumb.hidden = !s; if (s) thumb.src = s; });
    fill.addEventListener('click', function () {
      fill.disabled = true; fillMsg.textContent = 'Reading the page…';
      Promise.resolve().then(function () { return api().previewNewsLink(row['Article URL'], row['Scholar(s) Named']); }).then(function (r) {
        if (!r || r.status !== 'ok') throw new Error((r && (r.reason || r.error)) || 'No response');
        if (r.headline && !head2.value) head2.value = r.headline;
        if (r.outlet && !outlet.value) outlet.value = r.outlet;
        if (r.date && !date.value) date.value = r.date;
        if (r.image && !img.value) { img.value = r.image; img.dispatchEvent(new Event('input')); if (!credit.value) credit.value = r.outlet || ''; }
        while (scholar.options.length > 1) scholar.remove(1);
        (r.candidates || []).forEach(function (s) { var o = el('option', s.name + ' (' + s.id + ')', scholar); o.value = s.id; });
        if (r.candidates && r.candidates.length === 1) { scholar.value = r.candidates[0].id; sid.value = r.candidates[0].id; }
        fillMsg.textContent = (r.fetchNote ? r.fetchNote + ' ' : 'Filled from the page. ') + ((r.candidates || []).length ? (r.candidates.length + ' possible scholar match' + (r.candidates.length > 1 ? 'es' : '') + '. ') : 'No scholar match found; type the Scholar ID. ') + 'Check every field before approving.';
      }).catch(function (e) { fillMsg.textContent = 'Could not read the page: ' + e.message + '. Enter the details by hand.'; })
        .then(function () { fill.disabled = false; });
    });
    var acts = el('div', null, form, 'tnews-acts');
    var msg = el('p', '', form, 'tonga-queue-status'); msg.setAttribute('role', 'status');
    var approve = el('button', 'Approve and add to the dashboard', acts, 'tnews-approve'); approve.type = 'button';
    var reject = el('button', 'Reject', acts); reject.type = 'button';
    function decide(decision) {
      if (busy) return;
      var story = {
        scholarId: sid.value.trim(), displayName: shown.value.trim(), type: type.value, category: cat.value, headline: head2.value.trim(), outlet: outlet.value.trim(),
        date: date.value, eventTime: when.value.trim(), eventLocation: where.value.trim(), imageUrl: img.value.trim(),
        imageCredit: credit.value.trim(), also: also.value.trim(), summary: sum.value.trim(), articleUrl: row['Article URL']
      };
      if (ev) {
        story.eventStatus = evStatus.value; story.recordingUrl = evRec.value.trim();
        story.useFlyer = useFlyer ? useFlyer.checked : false; story.useQr = useQr ? useQr.checked : false;
      }
      if (decision === 'approve') {
        var miss = [];
        if (!story.scholarId && !(OPEN[story.type] && story.displayName)) miss.push(OPEN[story.type] ? 'scholar, or the author name(s)' : 'scholar'); if (!story.headline) miss.push('headline'); if (!story.date) miss.push('date');
        if (story.type === 'News' && !story.category) miss.push('category');
        if (ev && story.recordingUrl && !safeUrl(story.recordingUrl)) miss.push('full recording link (starting with https://)');
        if (miss.length) { msg.textContent = 'Add the ' + miss.join(', ') + ' first.'; msg.classList.add('tonga-error'); return; }
        if (!window.confirm('Add this ' + (TYPES.filter(function (t) { return t[0] === story.type; })[0] || TYPES[0])[1].toLowerCase() + ' to the News tab with Show on Dashboard = Yes?')) return;
      } else if (!window.confirm('Reject this link? It will not appear on the dashboard.')) return;
      busy = true; approve.disabled = reject.disabled = true; msg.className = 'tonga-queue-status'; msg.textContent = 'Saving…';
      Promise.resolve().then(function () { return api().resolveNewsSubmission(row['Submission ID'], decision, story, notes.value.trim()); }).then(function (r) {
        if (!r || (r.status !== 'ok' && r.status !== 'already_resolved')) throw new Error((r && (r.reason || r.error)) || 'No response');
        msg.classList.add('tonga-positive');
        msg.textContent = r.status === 'already_resolved' ? 'Someone has already reviewed this link.' :
          decision === 'approve' ? 'Added to the News tab as ' + r.newsId + '. It appears on the dashboard after the next ' + PLACE + ' refresh.' : 'Rejected.';
        form.querySelectorAll('input,select,textarea,button').forEach(function (x) { x.disabled = true; });
        // Take the reviewed card out of this view straight away (no Refresh needed).
        // The All view keeps it, now marked with its new status.
        var done = r.status === 'already_resolved' ? '' : decision === 'approve' ? 'Approved' : 'Rejected';
        var label = (story.headline || row['Article URL'] || row['Submission ID']).slice(0, 90);
        if (filter.value) {
          c.remove();
          var left = list.querySelectorAll('.tnews-card').length;
          status.className = 'tonga-queue-status tonga-positive';
          status.textContent = (done || 'Already reviewed by someone else') + ': ' + label + '. ' + (done === 'Approved' ? msg.textContent + ' ' : '') +
            (left ? left + ' ' + filter.value.toLowerCase() + ' link' + (left === 1 ? '' : 's') + ' left.' : 'No ' + filter.value.toLowerCase() + ' links left.');
          if (filter.value === 'Pending') setBadge(left);
        } else if (done) {
          var pill = c.querySelector('.tonga-status-pill'); if (pill) pill.textContent = done;
        }
        counts();
      }).catch(function (e) {
        msg.classList.add('tonga-error'); msg.textContent = 'Not saved: ' + e.message;
        approve.disabled = reject.disabled = false;
      }).then(function () { busy = false; });
    }
    approve.addEventListener('click', function () { decide('approve'); });
    reject.addEventListener('click', function () { decide('reject'); });
  }

  function counts() {
    try { api().reviewQueueCounts().then(function (r) { if (r && r.status === 'ok' && typeof r.news === 'number') setBadge(r.news); }).catch(function () {}); } catch (_) {}
  }
  function load() {
    status.className = 'tonga-queue-status'; status.textContent = 'Loading…';
    Promise.resolve().then(function () { return api().readNewsSubmissions(filter.value); }).then(function (r) {
      if (!r || r.status !== 'ok') throw new Error((r && (r.reason || r.error)) || 'No response');
      list.textContent = '';
      (r.rows || []).forEach(card);
      status.textContent = (r.rows || []).length ? (r.rows.length + ' ' + (filter.value || 'total').toLowerCase() + ' link' + (r.rows.length === 1 ? '' : 's') + '.') : 'No ' + (filter.value || '').toLowerCase() + ' links.';
      if (filter.value === 'Pending') setBadge((r.rows || []).length);
      loaded = true;
    }).catch(function (e) { status.classList.add('tonga-error'); status.textContent = 'Could not load: ' + e.message; });
  }
  filter.addEventListener('change', load);
  refresh.addEventListener('click', load);
  if (tab) tab.addEventListener('click', function () { if (!loaded) load(); });
  // Show the pending count once signed in.
  var tries = 0;
  (function wait() { var w = window.adminWriteback; if (w && w.isConfigured && w.isConfigured()) counts(); else if (++tries < 240) setTimeout(wait, 1000); })();
})();
