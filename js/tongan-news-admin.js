/* Tonga Admin: "News Story Submissions" queue.
 * Links sent from dashboard Panel A4 ("Share a story") wait here. An Owner or
 * Admin opens the link, completes the story details and approves; the backend
 * then appends one row to the Master's News tab with Show on Dashboard = Yes.
 * Rejecting keeps the link out of the panel. Calls go through the signed-in
 * review session (window.adminWriteback); nothing here holds credentials. */
(function () {
  'use strict';
  var host = document.getElementById('news-queue');
  if (!host) return;
  var tab = document.querySelector('[data-tab="news-submissions"]');
  var TYPES = [['News', 'News story'], ['Defense', 'Thesis defense'], ['Thesis', 'New thesis'], ['Publication', 'New publication'], ['Event', 'Event (including webinars)']];
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
    if (u) { var a = el('a', row['Article URL'], p); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; } else p.textContent = row['Article URL'];
    var dl = el('dl', null, c, 'tnews-dl');
    [['Scholar(s) or author(s)', row['Scholar(s) Named'] || 'Not given'], ['Sent by', row['Submitter Name'] + ' · ' + row['Submitter Email']], ['Their note', row['Submitter Note'] || 'None']].forEach(function (kv) {
      el('dt', kv[0], dl); el('dd', kv[1], dl);
    });
    if (row.Status !== 'Pending') {
      el('p', row.Status + ' by ' + (row['Reviewed By'] || '').split(' (')[0] + ' on ' + row['Reviewed At'] + (row['News ID'] ? ' · added as ' + row['News ID'] : '') + (row['Decision Notes'] ? ' · ' + row['Decision Notes'] : ''), c, 'meta');
      return;
    }
    var form = el('div', null, c, 'tnews-form');
    var fill = el('button', 'Fill details from the link', form, 'tnews-fill'); fill.type = 'button';
    var fillMsg = el('span', 'Reads the page title, picture, outlet and date and suggests matching scholars. Check every field.', form, 'meta tnews-fill-msg');
    var grid = el('div', null, form, 'tnews-grid');
    var scholar = field(grid, 'Scholar', 'scholarSel', 'select', '', { options: [['', 'Choose after filling, or type an ID below']] });
    var sid = field(grid, 'Scholar ID', 'scholarId', 'text', '', { placeholder: 'TNG-S0000' });
    var type = field(grid, 'Type', 'type', 'select', typeKey(row['Announcement Type']), { options: TYPES });
    var shown = field(grid, 'Name shown on the dashboard', 'displayName', 'text', '', { hint: 'Optional for database scholars. For a new thesis or publication about Tonga by someone outside the database, leave Scholar ID blank and enter the author name(s) here.' });
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
    var notes = field(grid, 'Review note (private)', 'notes', 'text', '', { wide: true });
    var thumb = el('img', null, form, 'tnews-thumb'); thumb.alt = ''; thumb.hidden = true;
    function sync() {
      var news = type.value === 'News', timed = !!TIMED[type.value];
      cat.closest('label').hidden = !news;
      when.closest('label').hidden = !timed; where.closest('label').hidden = !timed;
      sid.placeholder = OPEN[type.value] ? 'TNG-S0000, or blank if the author is not in the database' : 'TNG-S0000';
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
      if (decision === 'approve') {
        var miss = [];
        if (!story.scholarId && !(OPEN[story.type] && story.displayName)) miss.push(OPEN[story.type] ? 'scholar, or the author name(s)' : 'scholar'); if (!story.headline) miss.push('headline'); if (!story.date) miss.push('date');
        if (story.type === 'News' && !story.category) miss.push('category');
        if (miss.length) { msg.textContent = 'Add the ' + miss.join(', ') + ' first.'; msg.classList.add('tonga-error'); return; }
        if (!window.confirm('Add this ' + (TYPES.filter(function (t) { return t[0] === story.type; })[0] || TYPES[0])[1].toLowerCase() + ' to the News tab with Show on Dashboard = Yes?')) return;
      } else if (!window.confirm('Reject this link? It will not appear on the dashboard.')) return;
      busy = true; approve.disabled = reject.disabled = true; msg.className = 'tonga-queue-status'; msg.textContent = 'Saving…';
      Promise.resolve().then(function () { return api().resolveNewsSubmission(row['Submission ID'], decision, story, notes.value.trim()); }).then(function (r) {
        if (!r || (r.status !== 'ok' && r.status !== 'already_resolved')) throw new Error((r && (r.reason || r.error)) || 'No response');
        msg.classList.add('tonga-positive');
        msg.textContent = r.status === 'already_resolved' ? 'Someone has already reviewed this link.' :
          decision === 'approve' ? 'Added to the News tab as ' + r.newsId + '. It appears on the dashboard after the next Tonga refresh.' : 'Rejected.';
        form.querySelectorAll('input,select,textarea,button').forEach(function (x) { x.disabled = true; });
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
