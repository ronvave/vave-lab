/* Read-only presentation of Tonga's existing audit records. No write routes. */
(function (root) {
  'use strict';
  // Display aliases only; these hashes neither grant access nor verify identity.
  // Exact email matching avoids attributing unrelated accounts with similar names.
  var DISPLAY_NAMES = {"db76fff2cfe406a081a3a6d4de7f74cdbbe2a55d80ff53576d217168f3012162": "Ron Vave", "16ac84bc2a55bcaf9949cc39eb230268f4c3db90c7f8afbac9a8637ccd040079": "Inoke", "1b80099f109b67485f14d5be0679a111bccc756b53d8bf2464895fcc8a1360d9": "Tevita", "7bb5705ab84b73d8b23ae1c5af6863cf6c5846a5b55272bbf6dee6b8f21c0889": "Ashton"};
  var text = function (v) { return v == null ? '' : String(v); };
  var esc = function (v) { return text(v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  async function actor(raw) {
    raw = text(raw);
    if (/^Owner \(legacy secret\)$/i.test(raw)) return {name:'Owner', role:'Owner', note:'Legacy login — individual not recorded'};
    var email = raw.match(/^([^\s]+@[^\s()]+)/);
    var role = /\(owner[;)]/i.test(raw) ? 'Owner' : /\(admin[;)]/i.test(raw) ? 'Admin' : '';
    if (email) {
      try {
        var bytes = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(email[1].toLowerCase()));
        var hash = Array.from(new Uint8Array(bytes), function (b) { return b.toString(16).padStart(2,'0'); }).join('');
        return {name:DISPLAY_NAMES[hash] || email[1], role:role, note:''};
      } catch (_) { return {name:email[1],role:role,note:''}; }
    }
    return {name:raw || 'Not recorded',role:role,note:''};
  }
  function when(row) {
    // The writer's admin-YYYYMMDD-HHMMSS reference is explicitly Hawaii time.
    var m = text(row.version).match(/^admin-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    var day = m ? m[1]+'-'+m[2]+'-'+m[3] : text(row.date);
    var valid = /^\d{4}-\d{2}-\d{2}$/.test(day);
    var label = valid ? new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}) : day || 'Not recorded';
    return {date:label,time:m ? ((+m[4] % 12)||12)+':'+m[5]+' '+(+m[4]<12?'am':'pm') : 'Time not recorded'};
  }
  function normalize(row, scholars, submissions) {
    var scope = text(row.scope), parts = scope.split(' · ');
    var sid = text(row.scholarId || (parts.length >= 3 ? parts[1] : ''));
    var submission = submissions[text(row.field)] || {};
    sid = sid || text(submission['Scholar ID']);
    var scholar = scholars[sid] || {};
    var name = text(scholar['Scholar Name'] || submission['Scholar Name'] || [scholar['Given Names'],scholar['Family Name']].filter(Boolean).join(' '));
    var ws = text(row.worksheet), field = text(row.field);
    var geo = ws === 'Publication Geography Submissions';
    var profile = ws === 'Scholar Profile Submissions';
    var review = geo || profile;
    var outcome = text(row.newValue), category = review ? 'Review decision' : field ? 'Master data edit' : 'Other activity';
    var action = field || text(row.change) || 'Recorded activity';
    if (review) action = (geo ? 'Geography suggestion' : 'Scholar update') + ({Approved:' approved',Rejected:' declined',Reviewed:' reviewed',Pending:' awaiting review'}[outcome] || ' status changed');
    var note = review ? 'Review status only. Exact Master data changes are not recorded in this entry.' : '';
    if (review && outcome === 'Rejected') note = 'Declined in this event; no Master data change recorded here.';
    var knownValues = review || !!field || scope.includes(' → ');
    var value = function (v) { return text(v) || (knownValues ? 'Not recorded / blank' : 'Not available'); };
    return {raw:row,sid:sid,scholar:name || (sid ? 'Scholar '+sid : 'Record not identified'),publication:text(submission['Publication Title']),
      when:when(row),category:category,action:action,worksheet:ws,
      before:review && row.oldValue==='Pending' ? 'Awaiting review' : value(row.oldValue),
      after:review && outcome==='Rejected' ? 'Declined' : value(row.newValue),
      outcome:review ? outcome : '',note:note,shortened:/…$/.test(text(row.oldValue)) || /…$/.test(text(row.newValue)),
      proposed: [text(submission['Proposed Pacific Countries']),text(submission['Proposed Other Countries'])].filter(Boolean).join('; ')};
  }
  function details(r) {
    var fields = [['Log row',r.raw.rowNumber],['Event reference (Version)',r.raw.version],['Recorded date',r.raw.date],['Recorded actor',r.raw.actor],['Scholar ID',r.sid],['Worksheet',r.worksheet],['Original field / submission ID',r.raw.field],['Source',r.raw.source],['Recorded change',r.raw.change],['Original scope / impact',r.raw.scope]];
    return '<details class="tcl-details"><summary>Technical details</summary><dl>'+fields.map(function (p) { return '<dt>'+esc(p[0])+'</dt><dd>'+esc(p[1] || 'Not recorded')+'</dd>'; }).join('')+'</dl></details>';
  }
  function renderRow(r) {
    var badge = r.outcome==='Approved' ? 'approved' : r.outcome==='Rejected' ? 'declined' : '';
    return '<tr><td data-label="When (HST)"><span class="tcl-date">'+esc(r.when.date)+'</span><small>'+esc(r.when.time)+'</small></td>'+
      '<td data-label="Changed by"><strong>'+esc(r.actor.name)+'</strong>'+(r.actor.role?'<span class="tcl-role">'+esc(r.actor.role)+'</span>':'')+(r.actor.note?'<small>'+esc(r.actor.note)+'</small>':'')+'</td>'+
      '<td data-label="Scholar / publication"><strong>'+esc(r.scholar)+'</strong>'+(r.publication?'<span class="tcl-publication">'+esc(r.publication)+'</span>':'')+'</td>'+
      '<td data-label="What changed"><strong>'+esc(r.action)+'</strong><small>'+esc(r.category)+(r.worksheet?' · '+esc(r.worksheet):'')+'</small>'+details(r)+'</td>'+
      '<td data-label="Before"><div class="tcl-value">'+esc(r.before)+'</div></td>'+
      '<td data-label="After"><div class="tcl-value '+badge+'">'+esc(r.after)+'</div>'+(r.note?'<small>'+esc(r.note)+'</small>':'')+(r.shortened?'<small class="tcl-warning">Stored value shortened to 120 characters; full change unavailable in this log.</small>':'')+(r.proposed?'<details class="tcl-details"><summary>Submitted country suggestion</summary><p>'+esc(r.proposed)+'</p><small>This is the proposal, not a historical before/after comparison.</small></details>':'')+'</td></tr>';
  }
  var generation = 0;
  async function show(options) {
    var current = ++generation, wrap=options.wrap, status=options.status;
    var index={}, rows=options.rows || [], contextPromise=null;
    wrap.innerHTML='<p class="meta">Preparing readable change history…</p>';
    // One optional bulk read, never one request per record or per filter change.
    if (rows.some(function(r){return r.worksheet==='Publication Geography Submissions';}) && options.client.readGeographySubmissions) {
      contextPromise=Promise.resolve().then(function(){return options.client.readGeographySubmissions('');}).catch(function(){return {status:'error'};});
    }
    var models=await Promise.all(rows.map(async function(row){var r=normalize(row,options.scholars || {},index);r.actor=await actor(row.actor);return r;}));
    if (current!==generation) return;
    if (!models.length) {wrap.innerHTML='<p>No entries in the Master change log yet.</p>';status.textContent='0 entries';return;}
    var people=Array.from(new Set(models.map(function(r){return r.actor.name;}))).sort();
    var types=Array.from(new Set(models.map(function(r){return r.category;}))).sort();
    var opts=function(values){return values.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join('');};
    wrap.innerHTML='<div class="tcl-filters"><label>Search scholar or publication<input type="search" id="tcl-search" placeholder="Name, title or information changed"></label><label>Changed by<select id="tcl-person"><option value="">All reviewers</option>'+opts(people)+'</select></label><label>Change type<select id="tcl-type"><option value="">All change types</option>'+opts(types)+'</select></label></div>'+
      '<p class="tcl-help">Before and After show the recorded change. Review decisions show submission status, not the publication’s complete location history. Filters apply to the latest '+models.length+' loaded entries.</p>'+
      '<p class="tcl-context meta" role="status">'+(contextPromise?'Loading publication titles…':'')+'</p>'+
      '<div class="tcl-scroll"><table class="tcl-table"><caption class="tcl-sr-only">Master change history, most recent first</caption><thead><tr>'+['When (HST)','Changed by','Scholar / publication','What changed','Before','After'].map(function(s){return '<th scope="col">'+s+'</th>';}).join('')+'</tr></thead><tbody></tbody></table></div><p class="tcl-empty" hidden>No entries match these filters.</p>';
    var search=wrap.querySelector('#tcl-search'), person=wrap.querySelector('#tcl-person'), type=wrap.querySelector('#tcl-type');
    function filter() {
      var q=search.value.trim().toLowerCase();
      var filtered=models.filter(function(r){return (!person.value||person.value===r.actor.name)&&(!type.value||type.value===r.category)&&(!q||[r.scholar,r.sid,r.publication,r.actor.name,r.action,r.before,r.after,r.proposed].join(' ').toLowerCase().includes(q));});
      wrap.querySelector('tbody').innerHTML=filtered.map(renderRow).join('');
      wrap.querySelector('.tcl-empty').hidden=filtered.length!==0;
      status.textContent=filtered.length+' of '+models.length+' loaded entries · most recent first';
    }
    search.addEventListener('input',filter);person.addEventListener('change',filter);type.addEventListener('change',filter);filter();
    // Render the log first. Optional title lookup never blocks readable history.
    if(contextPromise) contextPromise.then(function(response){
      if(current!==generation)return;
      if(response.status!=='ok'){wrap.querySelector('.tcl-context').textContent='Publication titles could not be loaded. Recorded changes remain available; try Refresh.';return;}
      (response.rows||[]).forEach(function(r){index[r['Submission ID']]=r;});
      models=models.map(function(r){var enriched=normalize(r.raw,options.scholars||{},index);enriched.actor=r.actor;return enriched;});
      wrap.querySelector('.tcl-context').textContent='';filter();
    });
  }
  var api={show:show,normalize:normalize,actor:actor,when:when,renderRow:renderRow};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.TongaChangeLog=api;
})(typeof window!=='undefined'?window:globalThis);
